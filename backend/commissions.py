"""Commission module — Phase 1A: foundation.

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
- **Subcontractor bonus:** 5% of WO total by default; admin can override % or $.

## Collections created here
- `commission_rates`     — per-user rate history (append-only)
- `commission_accruals`  — one row per payment event × rep (or subcontractor)
- `commission_statements`— bundled statements per rep per period

Endpoints exposed:
  GET    /commissions/rates
  PUT    /commissions/rates/{user_id}
  GET    /commissions/deals/{deal_id}/splits
  PUT    /commissions/deals/{deal_id}/splits
  POST   /commissions/deals/{deal_id}/job-started        (toggle on)
  DELETE /commissions/deals/{deal_id}/job-started        (toggle off)
  GET    /commissions/deals/{deal_id}/net-profit-preview (debug / audit view)
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any

from fastapi import APIRouter, Depends, HTTPException, Body
from pydantic import BaseModel, ConfigDict, Field


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
