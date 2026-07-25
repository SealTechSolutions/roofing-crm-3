"""Commission module — Phase 1B: statements, sign flow, payables + CSV.

Tracks sales-rep and subcontractor commissions across the CRM.

## Data flow (locked in `/app/memory/COMMISSION_PRD.md`)
- **Base:** Net Profit = Contract Amount − 20% base overhead − (Job Costs × 1.20)
  where Job Costs = materials + labor + equipment (from Vendor Bills posted
  against the deal). The ×1.20 multiplier covers taxes / shipping on inputs.
- **Rate:** default 5% per rep, admin-configurable.
- **Splits:** each deal has a primary rep (default 100%) and an optional
  secondary rep with a percentage. Stored on the deal doc as `commission_splits`.
- **Deposit gating:** deposits accrue on collection but stay `pending_job_start`
  until the admin toggles `job_started_at` on the deal. Finals accrue immediately.
- **Statement period:** bi-weekly, every other Friday, 1 week behind.
  See `bi_weekly_period(gen_date)`.
- **Subcontractor bonus:** 5% of WO total by default; admin can override % or $.

## Collections created here
- `commission_rates`     — per-user rate history (append-only)
- `commission_accruals`  — one row per payment event × rep (or subcontractor)
- `commission_statements`— bundled statements per rep per period

Sign-flow lifecycle
-------------------
draft → sent_to_rep (magic link mailed) → signed → paid (or exported)
"""
from __future__ import annotations

import csv
import io
import logging
import secrets
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Optional, List, Dict, Any

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

logger = logging.getLogger(__name__)


# --- Constants (locked in the PRD) ------------------------------------------

DEFAULT_RATE_PCT = 5.0           # rep default
DEFAULT_SUB_RATE_PCT = 5.0       # subcontractor default (of WO total)
BASE_OVERHEAD_PCT = 20.0         # subtracted from contract before profit calc
JOB_COST_LOAD_PCT = 20.0         # multiplier applied to job costs (×1.20)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# --- Pydantic bodies --------------------------------------------------------

class RatePut(BaseModel):
    model_config = ConfigDict(extra="ignore")
    rate_pct: float = Field(..., ge=0, le=100)
    effective_from: Optional[str] = None       # ISO yyyy-mm-dd; defaults to today
    payroll_type: Optional[str] = None          # "1099" | "W2"
    notes: str = ""


class SplitsPut(BaseModel):
    """Two-rep split (primary + optional secondary). Percentages must sum to 100."""
    model_config = ConfigDict(extra="ignore")
    primary_rep_id: Optional[str] = None
    primary_rep_pct: float = Field(100.0, ge=0, le=100)
    secondary_rep_id: Optional[str] = None
    secondary_rep_pct: float = Field(0.0, ge=0, le=100)


class SubCommissionPut(BaseModel):
    """Per-work-order subcontractor bonus override (percent OR flat $).

    If both are given, `amount` wins. Sending {rate_pct: null, amount: null}
    clears the override so the WO reverts to the default 5%."""
    model_config = ConfigDict(extra="ignore")
    rate_pct: Optional[float] = Field(None, ge=0, le=100)
    amount: Optional[float] = Field(None, ge=0)


class GenerateStatementsBody(BaseModel):
    """Admin trigger: bundle open accruals into statements for a period."""
    model_config = ConfigDict(extra="ignore")
    # If not provided, defaults to "today" — pick the Friday nearest today
    # and compute the 14-day window ending the previous Friday.
    generation_date: Optional[str] = None            # ISO date
    # Optional filter — usually admin generates for all reps; passing a list
    # limits generation to those user_ids (useful for one-off corrections).
    user_ids: Optional[List[str]] = None


class SendStatementBody(BaseModel):
    """Mail a statement's magic sign-link to the rep."""
    model_config = ConfigDict(extra="ignore")
    override_email: Optional[str] = None             # override the rep's default email
    cc: Optional[str] = None
    subject: Optional[str] = None
    message: Optional[str] = None                    # extra body copy above the link


class MarkPaidBody(BaseModel):
    """Close a signed statement — auto-drafts a payable (1099) or marks
    ready-for-payroll (W2). Idempotent — safe to call twice."""
    model_config = ConfigDict(extra="ignore")
    method: Optional[str] = None                     # "payables" | "payroll_csv" | "manual"
    external_ref: Optional[str] = None               # bank ref / check # / etc.


# --- Bi-weekly period helper ------------------------------------------------

def bi_weekly_period(generation_date: Optional[date] = None) -> Dict[str, str]:
    """Compute the 14-day window covered by a statement generated on `generation_date`.

    Per the locked PRD (row #C): "Every other Friday, 1 week behind."
      - `generation_date` (any Friday the admin clicks Generate on)
      - period_end  = generation_date − 7 days      (the Friday one week prior)
      - period_start= generation_date − 20 days     (14 days before period_end, exclusive)

    Both dates are inclusive strings (YYYY-MM-DD). Non-Friday generation
    dates still work — the helper simply anchors the window off the passed
    date so admin can back-fill or catch-up-generate on an off day.
    """
    gd = generation_date or datetime.now(timezone.utc).date()
    period_end = gd - timedelta(days=7)
    period_start = gd - timedelta(days=20)
    return {
        "generation_date": gd.isoformat(),
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
    }


# --- Net-profit computation -------------------------------------------------

async def compute_deal_costs(db, deal_id: str) -> Dict[str, float]:
    """Aggregate posted vendor bills for a deal into {materials, labor, equipment,
    other, total_raw}. Only "posted" (non-void) bills count. Uses the bill's
    `category` field to bucket costs when present; otherwise buckets under
    `other`."""
    buckets = {"materials": 0.0, "labor": 0.0, "equipment": 0.0, "other": 0.0}
    cursor = db.vendor_bills.find(
        {"deal_id": deal_id, "is_deleted": {"$ne": True}, "status": {"$in": ["Open", "Paid", "Partial"]}},
        {"_id": 0},
    )
    async for b in cursor:
        # Categorise by explicit field first, then infer from the vendor kind
        cat = (b.get("category") or "").strip().lower()
        amount = float(b.get("total") or b.get("amount") or 0)
        if cat in ("materials", "material"):
            buckets["materials"] += amount
        elif cat in ("labor", "subcontractor", "sub"):
            buckets["labor"] += amount
        elif cat in ("equipment", "rental", "rentals"):
            buckets["equipment"] += amount
        else:
            buckets["other"] += amount
    buckets["total_raw"] = sum(v for k, v in buckets.items() if k != "total_raw")
    return {k: round(v, 2) for k, v in buckets.items()}


async def compute_deal_net_profit(db, deal_id: str) -> Dict[str, float]:
    """Return the audit-friendly net-profit breakdown for a deal.

    Formula (per PRD row #B):
        contract_amount = chosen_amount (or sum of paid invoices if no chosen)
        overhead = contract_amount × 20%
        loaded_costs = raw_job_costs × 1.20  (adds 20% for taxes/shipping)
        net_profit = contract_amount − overhead − loaded_costs
    """
    deal = await db.deals.find_one({"id": deal_id}, {"_id": 0})
    if not deal:
        raise HTTPException(404, "Deal not found")
    # Contract = the chosen customer price. Falls back to sum of paid invoices
    # so the formula still works for deals that never had chosen_amount set.
    contract_amount = float(deal.get("chosen_amount") or 0)
    if contract_amount <= 0:
        agg = await db.invoices.aggregate([
            {"$match": {"deal_id": deal_id, "is_deleted": {"$ne": True}}},
            {"$group": {"_id": None, "total": {"$sum": "$total"}}},
        ]).to_list(1)
        contract_amount = float((agg[0] or {}).get("total") or 0) if agg else 0.0
    costs = await compute_deal_costs(db, deal_id)
    overhead = contract_amount * (BASE_OVERHEAD_PCT / 100.0)
    loaded_costs = costs["total_raw"] * (1 + JOB_COST_LOAD_PCT / 100.0)
    net_profit = contract_amount - overhead - loaded_costs
    return {
        "contract_amount": round(contract_amount, 2),
        "base_overhead_pct": BASE_OVERHEAD_PCT,
        "base_overhead": round(overhead, 2),
        "raw_job_costs": costs["total_raw"],
        "job_cost_load_pct": JOB_COST_LOAD_PCT,
        "loaded_job_costs": round(loaded_costs, 2),
        "net_profit": round(net_profit, 2),
        "cost_breakdown": {k: v for k, v in costs.items() if k != "total_raw"},
    }


async def net_profit_ratio(db, deal_id: str) -> float:
    """Fraction of contract that is net profit. Used to convert a partial
    payment ("collected $3,000 of a $10,000 contract") into the proportional
    net-profit share for commission accrual."""
    breakdown = await compute_deal_net_profit(db, deal_id)
    if breakdown["contract_amount"] <= 0:
        return 0.0
    return max(0.0, breakdown["net_profit"] / breakdown["contract_amount"])


# --- Current-rate lookup ----------------------------------------------------

async def get_current_rate(db, user_id: str) -> Optional[Dict[str, Any]]:
    """Return the latest `commission_rates` row whose `effective_from <= today`
    for `user_id`, or None if no rate is set (meaning: no commission earned).
    Rate history is append-only so historical statements can look up the rate
    in effect at the payment's collection date."""
    today = datetime.now(timezone.utc).date().isoformat()
    cursor = db.commission_rates.find(
        {"user_id": user_id, "effective_from": {"$lte": today}},
        {"_id": 0},
    ).sort("effective_from", -1).limit(1)
    docs = await cursor.to_list(1)
    return docs[0] if docs else None


# --- Router factory ---------------------------------------------------------

def create_router(db, get_current_user, require_admin):
    router = APIRouter(prefix="/commissions", tags=["commissions"])

    # ---------- Rates ----------
    @router.get("/rates")
    async def list_rates(_admin=Depends(require_admin)):
        """Return current rate + payroll_type per user. Empty rate rows mean the
        user is not on commission."""
        users = await db.users.find({"is_deleted": {"$ne": True}}, {"_id": 0, "id": 1, "name": 1, "email": 1, "role": 1}).to_list(500)
        out = []
        for u in users:
            rate = await get_current_rate(db, u["id"])
            out.append({
                "user_id": u["id"],
                "name": u.get("name") or u.get("email"),
                "email": u.get("email"),
                "role": u.get("role"),
                "rate_pct": (rate or {}).get("rate_pct"),
                "payroll_type": (rate or {}).get("payroll_type") or "1099",
                "effective_from": (rate or {}).get("effective_from"),
                "notes": (rate or {}).get("notes", ""),
            })
        return out

    @router.put("/rates/{user_id}")
    async def upsert_rate(user_id: str, body: RatePut, admin=Depends(require_admin)):
        user = await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1})
        if not user:
            raise HTTPException(404, "User not found")
        effective_from = (body.effective_from or datetime.now(timezone.utc).date().isoformat())
        doc = {
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "rate_pct": float(body.rate_pct),
            "effective_from": effective_from,
            "payroll_type": body.payroll_type or "1099",
            "notes": body.notes or "",
            "created_by": admin["id"],
            "created_at": _now_iso(),
        }
        await db.commission_rates.insert_one(doc.copy())
        doc.pop("_id", None)
        return doc

    # ---------- Deal splits ----------
    @router.get("/deals/{deal_id}/splits")
    async def get_splits(deal_id: str, _user=Depends(get_current_user)):
        deal = await db.deals.find_one({"id": deal_id, "is_deleted": {"$ne": True}}, {"_id": 0})
        if not deal:
            raise HTTPException(404, "Deal not found")
        splits = deal.get("commission_splits") or {}
        # Sensible defaults: primary rep = the deal's assigned_to_user_id at 100%
        primary_id = splits.get("primary_rep_id") or deal.get("assigned_to_user_id")
        primary_pct = splits.get("primary_rep_pct", 100.0 if primary_id else 0.0)
        return {
            "deal_id": deal_id,
            "primary_rep_id": primary_id,
            "primary_rep_pct": float(primary_pct),
            "secondary_rep_id": splits.get("secondary_rep_id"),
            "secondary_rep_pct": float(splits.get("secondary_rep_pct") or 0.0),
            "job_started_at": deal.get("job_started_at") or None,
        }

    @router.put("/deals/{deal_id}/splits")
    async def put_splits(deal_id: str, body: SplitsPut, _admin=Depends(require_admin)):
        deal = await db.deals.find_one({"id": deal_id, "is_deleted": {"$ne": True}}, {"_id": 0})
        if not deal:
            raise HTTPException(404, "Deal not found")
        total = float(body.primary_rep_pct) + float(body.secondary_rep_pct or 0)
        if abs(total - 100.0) > 0.01 and body.primary_rep_id:
            raise HTTPException(400, f"Split must total 100% (got {total}%)")
        # Store splits nested so the deal doc doesn't sprout 4 top-level fields.
        splits = {
            "primary_rep_id": body.primary_rep_id,
            "primary_rep_pct": float(body.primary_rep_pct),
            "secondary_rep_id": body.secondary_rep_id,
            "secondary_rep_pct": float(body.secondary_rep_pct or 0.0),
            "updated_at": _now_iso(),
        }
        await db.deals.update_one({"id": deal_id}, {"$set": {"commission_splits": splits}})
        return splits

    # ---------- Job-started toggle (releases held deposit accruals) ----------
    @router.post("/deals/{deal_id}/job-started")
    async def mark_job_started(deal_id: str, admin=Depends(require_admin)):
        deal = await db.deals.find_one({"id": deal_id, "is_deleted": {"$ne": True}}, {"_id": 0})
        if not deal:
            raise HTTPException(404, "Deal not found")
        stamp = _now_iso()
        await db.deals.update_one(
            {"id": deal_id},
            {"$set": {"job_started_at": stamp, "job_started_by": admin["id"]}},
        )
        # Release any accruals that were pending job start
        result = await db.commission_accruals.update_many(
            {"deal_id": deal_id, "status": "pending_job_start"},
            {"$set": {"status": "open", "released_at": stamp}},
        )
        return {"job_started_at": stamp, "released_accruals": result.modified_count}

    @router.delete("/deals/{deal_id}/job-started")
    async def clear_job_started(deal_id: str, _admin=Depends(require_admin)):
        deal = await db.deals.find_one({"id": deal_id, "is_deleted": {"$ne": True}}, {"_id": 0})
        if not deal:
            raise HTTPException(404, "Deal not found")
        await db.deals.update_one(
            {"id": deal_id},
            {"$unset": {"job_started_at": "", "job_started_by": ""}},
        )
        # Re-hold any deposit accruals that were auto-released
        await db.commission_accruals.update_many(
            {"deal_id": deal_id, "status": "open", "kind": "deposit"},
            {"$set": {"status": "pending_job_start"}, "$unset": {"released_at": ""}},
        )
        return {"cleared": True}

    # ---------- Net profit preview (audit / debug) ----------
    @router.get("/deals/{deal_id}/net-profit-preview")
    async def net_profit_preview(deal_id: str, _user=Depends(get_current_user)):
        """Show the exact math that would be used to accrue commission on
        this deal — used by the admin to sanity-check before signing off."""
        return await compute_deal_net_profit(db, deal_id)

    # ---------- Accruals ledger ----------
    @router.get("/accruals")
    async def list_accruals(
        user_id: Optional[str] = Query(None),
        deal_id: Optional[str] = Query(None),
        status: Optional[str] = Query(None),
        recipient_type: Optional[str] = Query(None),
        _admin=Depends(require_admin),
    ):
        """Filterable ledger view. Returns accruals newest-first."""
        q: Dict[str, Any] = {}
        if user_id: q["user_id"] = user_id
        if deal_id: q["deal_id"] = deal_id
        if status: q["status"] = status
        if recipient_type: q["recipient_type"] = recipient_type
        rows = await db.commission_accruals.find(q, {"_id": 0}).sort("accrued_at", -1).limit(2000).to_list(2000)
        return rows

    # ---------- Statements ----------
    @router.get("/period-preview")
    async def period_preview(generation_date: Optional[str] = Query(None)):
        """Show what period `generation_date` (default today) will cover.
        Used by the admin UI to preview before hitting Generate."""
        gd = date.fromisoformat(generation_date) if generation_date else None
        return bi_weekly_period(gd)

    @router.post("/statements/generate")
    async def generate_statements(body: GenerateStatementsBody, admin=Depends(require_admin)):
        """Bundle open accruals for each rep into a statement for the given
        period. Only accruals with status="open" AND statement_id=null are
        included. Deposit accruals still `pending_job_start` stay held."""
        gd = date.fromisoformat(body.generation_date) if body.generation_date else None
        period = bi_weekly_period(gd)
        start = period["period_start"]
        end = period["period_end"]
        now = _now_iso()
        base_q: Dict[str, Any] = {
            "status": "open",
            "statement_id": None,
            "accrued_at": {"$gte": start, "$lte": end + "T23:59:59.999+00:00"},
        }
        if body.user_ids:
            base_q["user_id"] = {"$in": body.user_ids}
        # Subcontractor accruals bypass rep statements — they route straight
        # to Payables on job completion (Phase 1C follow-up).
        accruals = await db.commission_accruals.find(
            {**base_q, "recipient_type": {"$ne": "subcontractor"}},
            {"_id": 0},
        ).to_list(10000)
        by_user: Dict[str, List[dict]] = {}
        for a in accruals:
            by_user.setdefault(a["user_id"], []).append(a)

        created = []
        for uid, rows in by_user.items():
            total = round(sum(float(r.get("commission_amount") or 0) for r in rows), 2)
            if total <= 0:
                continue
            rate = await get_current_rate(db, uid) or {}
            stmt = {
                "id": str(uuid.uuid4()),
                "user_id": uid,
                "period_start": start,
                "period_end": end,
                "generated_at": now,
                "generated_by": admin["id"],
                "status": "draft",
                "total": total,
                "accrual_ids": [r["id"] for r in rows],
                "sign_token": secrets.token_urlsafe(24),
                "payroll_type": rate.get("payroll_type") or "1099",
                "sent_at": None,
                "signed_at": None,
                "signed_by_name": None,
                "signed_signature": None,
                "paid_at": None,
                "paid_via": None,
                "vendor_bill_id": None,
                "created_at": now,
            }
            await db.commission_statements.insert_one(stmt.copy())
            await db.commission_accruals.update_many(
                {"id": {"$in": stmt["accrual_ids"]}},
                {"$set": {"statement_id": stmt["id"]}},
            )
            stmt.pop("_id", None)
            created.append(stmt)
        return {"period": period, "generated": len(created), "statements": created}

    @router.get("/statements")
    async def list_statements(
        user_id: Optional[str] = Query(None),
        status: Optional[str] = Query(None),
        _admin=Depends(require_admin),
    ):
        q: Dict[str, Any] = {}
        if user_id: q["user_id"] = user_id
        if status: q["status"] = status
        rows = await db.commission_statements.find(q, {"_id": 0}).sort("generated_at", -1).to_list(500)
        uids = list({r["user_id"] for r in rows})
        users = await db.users.find({"id": {"$in": uids}}, {"_id": 0, "id": 1, "name": 1, "email": 1}).to_list(len(uids))
        u_by_id = {u["id"]: u for u in users}
        for r in rows:
            u = u_by_id.get(r["user_id"]) or {}
            r["rep_name"] = u.get("name") or u.get("email")
            r["rep_email"] = u.get("email")
            r.pop("sign_token", None)
            r.pop("signed_signature", None)
        return rows

    async def _load_statement_bundle(statement_id: str) -> Dict[str, Any]:
        stmt = await db.commission_statements.find_one({"id": statement_id}, {"_id": 0})
        if not stmt:
            raise HTTPException(404, "Statement not found")
        rep = await db.users.find_one({"id": stmt["user_id"]}, {"_id": 0, "id": 1, "name": 1, "email": 1}) or {}
        accruals = await db.commission_accruals.find(
            {"id": {"$in": stmt.get("accrual_ids") or []}}, {"_id": 0},
        ).sort("accrued_at", 1).to_list(len(stmt.get("accrual_ids") or []) or 1)
        deal_ids = list({a.get("deal_id") for a in accruals if a.get("deal_id")})
        inv_ids = list({a.get("invoice_id") for a in accruals if a.get("invoice_id")})
        deals = await db.deals.find({"id": {"$in": deal_ids}}, {"_id": 0, "id": 1, "title": 1}).to_list(len(deal_ids) or 1) if deal_ids else []
        invs = await db.invoices.find({"id": {"$in": inv_ids}}, {"_id": 0, "id": 1, "invoice_number": 1}).to_list(len(inv_ids) or 1) if inv_ids else []
        return {
            "statement": stmt, "rep": rep, "accruals": accruals,
            "deals_by_id": {d["id"]: d for d in deals},
            "invoices_by_id": {i["id"]: i for i in invs},
        }

    @router.get("/statements/{statement_id}")
    async def get_statement(statement_id: str, _admin=Depends(require_admin)):
        return await _load_statement_bundle(statement_id)

    @router.get("/statements/{statement_id}/pdf")
    async def statement_pdf(statement_id: str, _admin=Depends(require_admin)):
        bundle = await _load_statement_bundle(statement_id)
        from commission_statement_pdf import build_statement_pdf
        pdf = build_statement_pdf(
            bundle["statement"], bundle["rep"], bundle["accruals"],
            bundle["deals_by_id"], bundle["invoices_by_id"],
            signed_signature=bundle["statement"].get("signed_signature"),
        )
        return StreamingResponse(
            io.BytesIO(pdf), media_type="application/pdf",
            headers={"Content-Disposition": f'inline; filename="SealTech-Commission-{statement_id[:8]}.pdf"'},
        )

    @router.post("/statements/{statement_id}/send")
    async def send_statement(statement_id: str, body: SendStatementBody, admin=Depends(require_admin)):
        bundle = await _load_statement_bundle(statement_id)
        stmt = bundle["statement"]
        rep = bundle["rep"]
        to_addr = body.override_email or rep.get("email")
        if not to_addr:
            raise HTTPException(400, "Rep has no email on file — pass override_email.")
        from commission_statement_pdf import build_statement_pdf
        pdf_bytes = build_statement_pdf(
            stmt, rep, bundle["accruals"], bundle["deals_by_id"], bundle["invoices_by_id"],
        )
        # Resolve the frontend base URL for the magic-link
        import os
        base = os.environ.get("PUBLIC_BASE_URL") or ""
        if not base:
            try:
                with open("/app/frontend/.env") as _fe:
                    for _ln in _fe:
                        if _ln.startswith("REACT_APP_BACKEND_URL"):
                            base = _ln.split("=", 1)[1].strip()
                            break
            except OSError:
                pass
        sign_url = f"{base.rstrip('/')}/commissions/sign/{stmt['sign_token']}"
        subject = body.subject or f"Your SealTech Commission Statement — {stmt['period_start']} to {stmt['period_end']}"
        extra = (body.message or "").strip()
        body_text = (
            f"Hi {rep.get('name') or 'team'},\n\n"
            f"Your commission statement for {stmt['period_start']} through "
            f"{stmt['period_end']} is ready to review and sign.\n\n"
            f"Total earned: ${stmt['total']:,.2f}\n\n"
            f"Sign here: {sign_url}\n\n"
            f"{extra}\n\nThanks,\nSealTech Building Solutions"
        ).strip()
        body_html = (
            f'<p>Hi {rep.get("name") or "team"},</p>'
            f'<p>Your commission statement for <b>{stmt["period_start"]}</b> through '
            f'<b>{stmt["period_end"]}</b> is ready to review and sign.</p>'
            f'<p style="font-size:18px;"><b>Total earned:</b> ${stmt["total"]:,.2f}</p>'
            f'<p><a href="{sign_url}" style="background:#1E40AF;color:#fff;'
            f'padding:10px 18px;text-decoration:none;border-radius:4px;font-weight:bold;">Review &amp; Sign</a></p>'
            f'<p style="color:#52525B;font-size:12px;">Link: <a href="{sign_url}">{sign_url}</a></p>'
            + (f'<p>{extra}</p>' if extra else '')
            + '<p>Thanks,<br/>SealTech Building Solutions</p>'
        )
        try:
            from email_sender import send_email
            send_email(
                to=to_addr, subject=subject, body_text=body_text, body_html=body_html,
                cc=body.cc,
                attachments=[{
                    "filename": f"SealTech-Commission-{stmt['id'][:8]}.pdf",
                    "data": pdf_bytes, "mime": "application/pdf",
                }],
            )
            email_sent = True
        except Exception as e:
            logger.warning("Commission statement email failed: %s", e)
            email_sent = False
        await db.commission_statements.update_one(
            {"id": statement_id},
            {"$set": {
                "status": "sent_to_rep", "sent_at": _now_iso(),
                "sent_to": to_addr, "sent_by": admin["id"],
            }},
        )
        return {"ok": True, "email_sent": email_sent, "sign_url": sign_url, "sent_to": to_addr}

    @router.post("/statements/{statement_id}/mark-paid")
    async def mark_statement_paid(statement_id: str, body: MarkPaidBody, admin=Depends(require_admin)):
        stmt = await db.commission_statements.find_one({"id": statement_id}, {"_id": 0})
        if not stmt:
            raise HTTPException(404, "Statement not found")
        if stmt.get("status") == "paid":
            return {"ok": True, "already_paid": True, "statement": stmt}
        if stmt.get("status") != "signed":
            raise HTTPException(400, f"Statement must be signed before marking paid (current: {stmt.get('status')})")
        payroll = stmt.get("payroll_type") or "1099"
        method = body.method or ("payables" if payroll == "1099" else "payroll_csv")
        now = _now_iso()
        vendor_bill_id: Optional[str] = None
        if method == "payables":
            rep = await db.users.find_one({"id": stmt["user_id"]}, {"_id": 0, "id": 1, "name": 1, "email": 1}) or {}
            vendor_name = f"{rep.get('name') or rep.get('email') or 'Sales Rep'} (1099 Commissions)"
            vendor = await db.vendors.find_one({"linked_user_id": stmt["user_id"], "is_deleted": {"$ne": True}}, {"_id": 0})
            if not vendor:
                vendor = {
                    "id": str(uuid.uuid4()), "vendor_name": vendor_name,
                    "email": rep.get("email"), "linked_user_id": stmt["user_id"],
                    "kind": "1099-Rep", "is_deleted": False,
                    "created_at": now, "created_by": admin["id"],
                }
                await db.vendors.insert_one(vendor.copy())
                vendor.pop("_id", None)
            bill = {
                "id": str(uuid.uuid4()),
                "vendor_id": vendor["id"], "vendor_name": vendor["vendor_name"],
                "bill_number": f"CMSN-{stmt['id'][:8].upper()}",
                "issue_date": now[:10], "due_date": now[:10],
                "memo": f"Commission statement {stmt['period_start']} — {stmt['period_end']}",
                "line_items": [{
                    "description": f"Sales commissions for {stmt['period_start']} to {stmt['period_end']}",
                    "quantity": 1, "unit_cost": float(stmt.get("total") or 0),
                    "amount": float(stmt.get("total") or 0), "category": "labor",
                }],
                "subtotal": float(stmt.get("total") or 0), "tax": 0.0,
                "total": float(stmt.get("total") or 0), "amount_paid": 0.0,
                "status": "Open", "source_type": "commission_statement",
                "source_id": stmt["id"], "is_deleted": False,
                "created_at": now, "created_by": admin["id"],
            }
            await db.vendor_bills.insert_one(bill.copy())
            vendor_bill_id = bill["id"]
        await db.commission_statements.update_one(
            {"id": statement_id},
            {"$set": {
                "status": "paid", "paid_at": now, "paid_via": method,
                "paid_by": admin["id"], "external_ref": body.external_ref or "",
                "vendor_bill_id": vendor_bill_id,
            }},
        )
        await db.commission_accruals.update_many(
            {"id": {"$in": stmt.get("accrual_ids") or []}},
            {"$set": {"status": "paid", "paid_at": now}},
        )
        return {"ok": True, "method": method, "vendor_bill_id": vendor_bill_id}

    @router.get("/statements/export/w2-csv")
    async def export_w2_csv(status: Optional[str] = Query("signed"), _admin=Depends(require_admin)):
        """CSV export for W2 reps whose signed statements are ready for payroll."""
        rows = await db.commission_statements.find(
            {"payroll_type": "W2", "status": status or "signed"}, {"_id": 0},
        ).sort("period_end", 1).to_list(1000)
        uids = list({r["user_id"] for r in rows})
        users = await db.users.find({"id": {"$in": uids}}, {"_id": 0, "id": 1, "name": 1, "email": 1}).to_list(len(uids))
        u_by_id = {u["id"]: u for u in users}
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["statement_id", "rep_name", "rep_email", "period_start",
                    "period_end", "total", "signed_at", "generated_at"])
        for r in rows:
            u = u_by_id.get(r["user_id"]) or {}
            w.writerow([
                r["id"], u.get("name") or "", u.get("email") or "",
                r.get("period_start"), r.get("period_end"),
                f'{float(r.get("total") or 0):.2f}',
                r.get("signed_at") or "", r.get("generated_at") or "",
            ])
        return StreamingResponse(
            io.BytesIO(buf.getvalue().encode("utf-8")),
            media_type="text/csv",
            headers={"Content-Disposition": 'attachment; filename="sealtech-commissions-w2.csv"'},
        )

    return router


# ---------- Public router — rep-facing magic-link sign flow ----------

def create_public_router(db):
    """Public (unauthenticated) endpoints for the rep sign flow.

    Mounted under `/api/public/commission-statements` in server.py.
    """
    router = APIRouter(prefix="/public/commission-statements", tags=["commissions-public"])

    @router.get("/{token}")
    async def public_view(token: str):
        stmt = await db.commission_statements.find_one({"sign_token": token}, {"_id": 0})
        if not stmt:
            raise HTTPException(404, "Statement not found or revoked")
        rep = await db.users.find_one({"id": stmt["user_id"]}, {"_id": 0, "id": 1, "name": 1, "email": 1}) or {}
        accruals = await db.commission_accruals.find(
            {"id": {"$in": stmt.get("accrual_ids") or []}}, {"_id": 0},
        ).sort("accrued_at", 1).to_list(len(stmt.get("accrual_ids") or []) or 1)
        deal_ids = list({a.get("deal_id") for a in accruals if a.get("deal_id")})
        deals = await db.deals.find({"id": {"$in": deal_ids}}, {"_id": 0, "id": 1, "title": 1}).to_list(len(deal_ids) or 1) if deal_ids else []
        deals_by_id = {d["id"]: d for d in deals}
        return {
            "id": stmt["id"],
            "period_start": stmt["period_start"], "period_end": stmt["period_end"],
            "total": stmt["total"], "status": stmt["status"],
            "already_signed": bool(stmt.get("signed_at")),
            "signed_at": stmt.get("signed_at"),
            "signed_by_name": stmt.get("signed_by_name"),
            "rep_name": rep.get("name") or rep.get("email"),
            "rep_email": rep.get("email"),
            "accruals": [
                {
                    "accrued_at": a.get("accrued_at"),
                    "deal_title": (deals_by_id.get(a.get("deal_id")) or {}).get("title") or (a.get("deal_id") or "")[:8],
                    "kind": a.get("kind"),
                    "payment_amount_collected": a.get("payment_amount_collected"),
                    "profit_share": a.get("profit_share"),
                    "rate_pct_at_time": a.get("rate_pct_at_time"),
                    "commission_amount": a.get("commission_amount"),
                }
                for a in accruals
            ],
        }

    @router.get("/{token}/pdf")
    async def public_pdf(token: str):
        stmt = await db.commission_statements.find_one({"sign_token": token}, {"_id": 0})
        if not stmt:
            raise HTTPException(404, "Statement not found or revoked")
        rep = await db.users.find_one({"id": stmt["user_id"]}, {"_id": 0, "id": 1, "name": 1, "email": 1}) or {}
        accruals = await db.commission_accruals.find(
            {"id": {"$in": stmt.get("accrual_ids") or []}}, {"_id": 0},
        ).sort("accrued_at", 1).to_list(len(stmt.get("accrual_ids") or []) or 1)
        deal_ids = list({a.get("deal_id") for a in accruals if a.get("deal_id")})
        inv_ids = list({a.get("invoice_id") for a in accruals if a.get("invoice_id")})
        deals = await db.deals.find({"id": {"$in": deal_ids}}, {"_id": 0, "id": 1, "title": 1}).to_list(len(deal_ids) or 1) if deal_ids else []
        invs = await db.invoices.find({"id": {"$in": inv_ids}}, {"_id": 0, "id": 1, "invoice_number": 1}).to_list(len(inv_ids) or 1) if inv_ids else []
        from commission_statement_pdf import build_statement_pdf
        pdf = build_statement_pdf(
            stmt, rep, accruals,
            {d["id"]: d for d in deals}, {i["id"]: i for i in invs},
            signed_signature=stmt.get("signed_signature"),
        )
        return StreamingResponse(
            io.BytesIO(pdf), media_type="application/pdf",
            headers={"Content-Disposition": f'inline; filename="SealTech-Commission-{stmt["id"][:8]}.pdf"'},
        )

    @router.post("/{token}/sign")
    async def public_sign(token: str, body: dict = Body(...)):
        stmt = await db.commission_statements.find_one({"sign_token": token})
        if not stmt:
            raise HTTPException(404, "Statement not found or revoked")
        if stmt.get("signed_at"):
            return {"ok": True, "already_signed": True, "signed_at": stmt["signed_at"]}
        name = (body.get("signer_name") or "").strip()
        signed_text = (body.get("signature_text") or "").strip()
        signed_font = (body.get("signature_font") or "").strip()[:40]
        drawn = (body.get("signature_data_url") or "").strip()
        accepted = bool(body.get("accepted"))
        if not accepted or not name or (not signed_text and not drawn):
            raise HTTPException(400, "Acceptance, signer name, and a typed or drawn signature are required.")
        signed_signature = {"signed_at": _now_iso()}
        if drawn and drawn.startswith("data:image/"):
            try:
                import base64
                head, _, b64 = drawn.partition(",")
                ct = "image/png" if "image/png" in head else ("image/jpeg" if "image/jpeg" in head else "image/png")
                img_bytes = base64.b64decode(b64)
                if len(img_bytes) > 2_500_000:
                    raise ValueError("signature image too large")
                signed_signature.update(image_bytes=img_bytes, content_type=ct)
            except Exception:
                signed_signature.update(text=signed_text or name, font=signed_font or "Caveat")
        else:
            signed_signature.update(text=signed_text or name, font=signed_font or "Caveat")
        persist_sig = {k: v for k, v in signed_signature.items() if k != "image_bytes"}
        if signed_signature.get("image_bytes"):
            try:
                from storage import put_object, APP_NAME
                file_id = secrets.token_urlsafe(16)
                sp = f"{APP_NAME}/uploads/commission/{stmt['id']}/signature-{file_id}.png"
                put_object(sp, signed_signature["image_bytes"], signed_signature.get("content_type") or "image/png")
                await db.files.insert_one({
                    "id": file_id, "parent_type": "commission_statement", "parent_id": stmt["id"],
                    "category": "Signature", "storage_path": sp,
                    "original_filename": f"commission-signature-{stmt['id'][:8]}.png",
                    "content_type": signed_signature.get("content_type") or "image/png",
                    "size": len(signed_signature["image_bytes"]),
                    "is_deleted": False, "uploaded_by": "public-sign",
                    "uploaded_at": _now_iso(), "created_at": _now_iso(),
                })
                persist_sig["signature_file_id"] = file_id
            except Exception:
                pass
        await db.commission_statements.update_one(
            {"id": stmt["id"]},
            {"$set": {
                "status": "signed", "signed_at": signed_signature["signed_at"],
                "signed_by_name": name, "signed_signature": persist_sig,
            }},
        )
        return {"ok": True, "signed_at": signed_signature["signed_at"]}

    return router


# ---------- Accrual hook (called by server.py after invoice payment) --------

async def accrue_on_invoice_payment(db, invoice: dict, payment_amount: float, payment_date: Optional[str] = None) -> List[Dict[str, Any]]:
    """Create commission accruals for a newly-collected invoice payment.

    Called from server.py's invoice-payment code path (post-`_recalc_invoice`)
    with the invoice doc and the *newly-collected* amount (not the running
    `amount_paid` total — the delta collected right now).

    Returns the list of accrual docs inserted (for logging / audit). Safe to
    call with 0 or negative payment_amount — returns empty list without
    mutating state.
    """
    if not invoice or payment_amount <= 0:
        return []
    deal_id = invoice.get("deal_id")
    if not deal_id:
        return []
    deal = await db.deals.find_one({"id": deal_id, "is_deleted": {"$ne": True}}, {"_id": 0})
    if not deal:
        return []
    # Convert the raw payment amount into its net-profit-proportional share.
    ratio = await net_profit_ratio(db, deal_id)
    profit_share = payment_amount * ratio
    if profit_share <= 0:
        return []
    # Determine invoice "kind" — deposits are gated until job starts.
    inv_type = (invoice.get("invoice_type") or "").strip().lower()
    is_deposit = inv_type == "deposit"
    status_default = "open" if (not is_deposit or deal.get("job_started_at")) else "pending_job_start"
    kind = "deposit" if is_deposit else ("final" if inv_type == "final" else "invoice")
    # Resolve rep splits (fall back to deal.assigned_to_user_id at 100%)
    splits = deal.get("commission_splits") or {}
    primary_id = splits.get("primary_rep_id") or deal.get("assigned_to_user_id")
    primary_pct = float(splits.get("primary_rep_pct", 100.0 if primary_id else 0.0))
    secondary_id = splits.get("secondary_rep_id")
    secondary_pct = float(splits.get("secondary_rep_pct") or 0.0)
    reps = []
    if primary_id and primary_pct > 0:
        reps.append((primary_id, primary_pct))
    if secondary_id and secondary_pct > 0:
        reps.append((secondary_id, secondary_pct))
    if not reps:
        return []
    accrued_at = payment_date or _now_iso()
    inserted: List[Dict[str, Any]] = []
    for rep_id, split_pct in reps:
        rate = await get_current_rate(db, rep_id)
        if not rate or float(rate.get("rate_pct") or 0) <= 0:
            continue
        rep_share = profit_share * (split_pct / 100.0)
        commission = round(rep_share * float(rate["rate_pct"]) / 100.0, 2)
        if commission <= 0:
            continue
        doc = {
            "id": str(uuid.uuid4()),
            "user_id": rep_id,
            "deal_id": deal_id,
            "invoice_id": invoice.get("id"),
            "payment_amount_collected": round(payment_amount, 2),
            "profit_share": round(rep_share, 2),
            "rate_pct_at_time": float(rate["rate_pct"]),
            "split_pct_at_time": split_pct,
            "commission_amount": commission,
            "kind": kind,                     # "deposit" | "final" | "invoice"
            "status": status_default,         # "open" | "pending_job_start" | ...
            "accrued_at": accrued_at,
            "statement_id": None,
            "created_at": _now_iso(),
        }
        await db.commission_accruals.insert_one(doc.copy())
        doc.pop("_id", None)
        inserted.append(doc)
    return inserted


# ---------- Subcontractor bonus hook (called from work_orders on WO send) ---

async def accrue_subcontractor_bonus(db, deal_id: str, work_order: dict) -> Optional[Dict[str, Any]]:
    """Create a subcontractor commission accrual when a WO is issued.

    Uses the deal-level override if present, else the default 5% of WO total.
    Held as `pending_job_start` until the admin marks the job started.
    """
    total = float(work_order.get("total") or 0)
    if total <= 0:
        return None
    deal = await db.deals.find_one({"id": deal_id, "is_deleted": {"$ne": True}}, {"_id": 0})
    if not deal:
        return None
    override = deal.get("subcontractor_commission") or {}
    if override.get("amount") is not None:
        commission = float(override["amount"])
        rate_used = None
    else:
        rate_used = float(override.get("rate_pct")) if override.get("rate_pct") is not None else DEFAULT_SUB_RATE_PCT
        commission = round(total * rate_used / 100.0, 2)
    if commission <= 0:
        return None
    sub_id = deal.get("primary_subcontractor_id")
    if not sub_id:
        return None
    status = "open" if deal.get("job_started_at") else "pending_job_start"
    doc = {
        "id": str(uuid.uuid4()),
        "recipient_type": "subcontractor",
        "vendor_id": sub_id,
        "deal_id": deal_id,
        "work_order_id": work_order.get("id"),
        "wo_total": round(total, 2),
        "rate_pct_at_time": rate_used,
        "commission_amount": commission,
        "kind": "subcontractor_bonus",
        "status": status,
        "accrued_at": _now_iso(),
        "statement_id": None,
        "created_at": _now_iso(),
    }
    await db.commission_accruals.insert_one(doc.copy())
    doc.pop("_id", None)
    return doc
