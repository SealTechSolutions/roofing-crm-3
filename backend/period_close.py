"""Period Close — Monthly close-the-books orchestrator.

What a "close" does for one entity for one YYYY-MM period:
  1. Run the 1.5% late-fee accrual for that month
  2. Post a depreciation entry: DR 6600 Depreciation Expense / CR 1510 Accumulated Depreciation
     (only if entity.monthly_depreciation > 0)
  3. Snapshot the P&L (period) + Balance Sheet (as-of period end) into PDFs
  4. Upload PDFs to the Document Library under category 'Books' / 'Period Close Snapshots'
  5. Lock the period — set entity.lock_through = period-end date so post_journal refuses
     any further postings dated on or before that date (unless someone Reopens).
  6. Persist a `period_closes` record with all the totals + PDF doc ids for audit.

Reopening reverses step 5 only — the journal entries posted by steps 1/2 are left in place
and the PDFs in the Library are kept (mark closing record as `is_reopened=true`).
"""
from typing import Optional, List
import uuid
import logging
import calendar
from datetime import datetime, timezone, date

import gl
from storage import put_object, APP_NAME

logger = logging.getLogger(__name__)


def _period_end_date(period: str) -> str:
    """Given 'YYYY-MM' return ISO date of last day of that month."""
    y, m = period.split("-")
    last = calendar.monthrange(int(y), int(m))[1]
    return f"{y}-{m.zfill(2)}-{last:02d}"


def _period_start_date(period: str) -> str:
    y, m = period.split("-")
    return f"{y}-{m.zfill(2)}-01"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def ensure_indexes(db):
    await db.period_closes.create_index("id", unique=True)
    await db.period_closes.create_index([("entity_id", 1), ("period", 1)], unique=True)


async def get_period_close(db, entity_id: str, period: str) -> Optional[dict]:
    doc = await db.period_closes.find_one({"entity_id": entity_id, "period": period}, {"_id": 0})
    return doc


async def list_period_closes(db, entity_id: Optional[str] = None) -> List[dict]:
    q = {} if not entity_id else {"entity_id": entity_id}
    out = []
    async for d in db.period_closes.find(q, {"_id": 0}).sort([("period", -1)]):
        out.append(d)
    return out


async def preview_close(db, *, entity_id: str, period: str) -> dict:
    """Compute what the close *would* do without writing anything."""
    ent = await db.entities.find_one({"id": entity_id}, {"_id": 0})
    if not ent:
        return {"error": f"Entity {entity_id} not found"}
    period_end = _period_end_date(period)
    period_start = _period_start_date(period)
    existing = await get_period_close(db, entity_id, period)
    pl = await gl.report_profit_loss(db, entity_id, period_start, period_end)
    bs = await gl.report_balance_sheet(db, entity_id, period_end)
    # Estimate late-fee accrual: count + sum of all unpaid invoices >30d overdue as of period_end
    estimated_fee_total = 0.0
    estimated_fee_count = 0
    async for inv in db.invoices.find({"entity_id": entity_id, "is_deleted": {"$ne": True}}):
        status = (inv.get("status") or "").lower()
        if status in ("draft", "void"):
            continue
        balance = round(float(inv.get("balance_due") or (float(inv.get("total") or 0) - float(inv.get("amount_paid") or 0))), 2)
        if balance <= 0:
            continue
        due = inv.get("due_date") or inv.get("invoice_date")
        if not due:
            continue
        days = gl._days_between(due, period_end)
        if days <= gl.LATE_FEE_GRACE_DAYS:
            continue
        estimated_fee_total += round(balance * gl.LATE_FEE_MONTHLY_RATE, 2)
        estimated_fee_count += 1
    depreciation_amount = round(float(ent.get("monthly_depreciation") or 0), 2)
    return {
        "entity_id": entity_id,
        "entity_name": ent.get("name"),
        "period": period,
        "period_start": period_start,
        "period_end": period_end,
        "already_closed": bool(existing and not existing.get("is_reopened")),
        "previous_close": existing,
        "current_lock_through": ent.get("lock_through", ""),
        "actions": {
            "late_fee_accrual": {
                "invoices_eligible": estimated_fee_count,
                "estimated_total": round(estimated_fee_total, 2),
            },
            "depreciation": {
                "amount": depreciation_amount,
                "will_post": depreciation_amount > 0,
                "debit_account": "6600 Depreciation Expense",
                "credit_account": "1510 Accumulated Depreciation",
            },
            "pdf_snapshots": ["P&L (period)", "Balance Sheet (as of period end)"],
            "lock_through_after": period_end,
        },
        "snapshot_totals": {
            "revenue": pl["totals"]["revenue"],
            "cogs": pl["totals"]["cogs"],
            "gross_profit": pl["totals"]["gross_profit"],
            "operating_expense": pl["totals"]["operating_expense"],
            "net_income": pl["totals"]["net_income"],
            "assets": bs["totals"]["assets"],
            "liabilities": bs["totals"]["liabilities"],
            "equity_total": bs["totals"]["equity_total"],
            "balanced": bs["totals"]["balanced"],
        },
    }


async def _post_depreciation(db, *, entity_id: str, period: str, period_end: str, amount: float, posted_by: Optional[str]) -> Optional[dict]:
    if amount <= 0:
        return None
    lines = [
        await gl._build_line(db, entity_id, "6600", debit=amount, credit=0, memo=f"Monthly depreciation — {period}"),
        await gl._build_line(db, entity_id, "1510", debit=0, credit=amount, memo=f"Accum. depreciation — {period}"),
    ]
    return await gl.post_journal(
        db,
        entity_id=entity_id,
        source_type="period_close",
        source_id=entity_id,
        kind=f"depreciation:{period}",
        lines=lines,
        memo=f"Month-end depreciation accrual · {period}",
        posting_date=period_end,
        posted_by_user_id=posted_by,
        bypass_period_lock=True,
    )


async def _generate_period_pdfs(db, *, entity: dict, period: str, period_start: str, period_end: str) -> List[dict]:
    """Render P&L + Balance Sheet PDFs and upload to Library. Returns list of library_files docs."""
    from period_close_pdf import build_period_close_pdfs  # local import to avoid heavy reportlab at module load
    pl = await gl.report_profit_loss(db, entity["id"], period_start, period_end)
    bs = await gl.report_balance_sheet(db, entity["id"], period_end)
    files = build_period_close_pdfs(entity=entity, period=period, pl=pl, bs=bs)
    out = []
    for f in files:
        file_id = str(uuid.uuid4())
        safe_period = period.replace("-", "_")
        safe_ent = (entity.get("name") or "entity").replace(" ", "_").replace("&", "and").replace(",", "")
        storage_path = f"{APP_NAME}/library/Books/Period_Close_Snapshots/{safe_ent}_{safe_period}_{f['kind']}_{file_id}.pdf"
        try:
            result = put_object(storage_path, f["bytes"], "application/pdf")
        except Exception as e:
            logger.warning(f"Period-close PDF upload failed for {f['kind']}: {e}")
            continue
        doc = {
            "id": file_id,
            "category": "Books",
            "subcategory": "Period Close Snapshots",
            "display_name": f["display_name"],
            "description": f["description"],
            "storage_path": result["path"],
            "original_filename": f["filename"],
            "content_type": "application/pdf",
            "size": len(f["bytes"]),
            "is_deleted": False,
            "uploaded_by": "system:period_close",
            "uploader_name": f"Period Close · {period}",
            "created_at": _now_iso(),
            "books_entity_id": entity["id"],
            "books_period": period,
        }
        await db.library_files.insert_one(doc.copy())
        doc.pop("_id", None)
        out.append(doc)
    return out


async def run_close(db, *, entity_id: str, period: str, posted_by: Optional[str]) -> dict:
    """Execute the close. Idempotent — running on an already-closed period returns the existing record."""
    existing = await get_period_close(db, entity_id, period)
    if existing and not existing.get("is_reopened"):
        return {**existing, "rerun": True}

    ent = await db.entities.find_one({"id": entity_id}, {"_id": 0})
    if not ent:
        return {"error": f"Entity {entity_id} not found"}
    period_end = _period_end_date(period)
    period_start = _period_start_date(period)

    # 1) Late-fee accrual for period
    fee_summary = await gl.accrue_late_fees(db, entity_id=entity_id, as_of=period_end, posted_by_user_id=posted_by)

    # 2) Depreciation
    depr_amount = round(float(ent.get("monthly_depreciation") or 0), 2)
    depr_journal = await _post_depreciation(
        db, entity_id=entity_id, period=period, period_end=period_end, amount=depr_amount, posted_by=posted_by
    )

    # 3+4) Generate + upload PDFs (after late-fee + depreciation so the numbers reflect everything)
    pdf_docs = await _generate_period_pdfs(db, entity=ent, period=period, period_start=period_start, period_end=period_end)

    # 5) Lock through period_end
    await db.entities.update_one({"id": entity_id}, {"$set": {"lock_through": period_end}})

    # 6) Persist close record
    pl = await gl.report_profit_loss(db, entity_id, period_start, period_end)
    bs = await gl.report_balance_sheet(db, entity_id, period_end)
    record_id = (existing or {}).get("id") or str(uuid.uuid4())
    rec = {
        "id": record_id,
        "entity_id": entity_id,
        "entity_name": ent.get("name"),
        "period": period,
        "period_start": period_start,
        "period_end": period_end,
        "closed_at": _now_iso(),
        "closed_by_user_id": posted_by,
        "is_reopened": False,
        "reopened_at": None,
        "reopened_by_user_id": None,
        "late_fee_accrual": fee_summary,
        "depreciation_posted": depr_amount if depr_journal else 0.0,
        "depreciation_journal_id": (depr_journal or {}).get("id"),
        "pdf_document_ids": [d["id"] for d in pdf_docs],
        "snapshot": {
            "revenue": pl["totals"]["revenue"],
            "cogs": pl["totals"]["cogs"],
            "gross_profit": pl["totals"]["gross_profit"],
            "operating_expense": pl["totals"]["operating_expense"],
            "net_income": pl["totals"]["net_income"],
            "assets": bs["totals"]["assets"],
            "liabilities": bs["totals"]["liabilities"],
            "equity_total": bs["totals"]["equity_total"],
            "balanced": bs["totals"]["balanced"],
        },
    }
    if existing:
        await db.period_closes.update_one({"id": record_id}, {"$set": rec})
    else:
        await db.period_closes.insert_one(rec.copy())
    rec.pop("_id", None)
    return rec


async def reopen_period(db, *, entity_id: str, period: str, reopened_by: Optional[str]) -> dict:
    """Mark close as reopened and recompute entity.lock_through (= max period_end of remaining closed periods)."""
    rec = await get_period_close(db, entity_id, period)
    if not rec:
        return {"error": "No close record exists for that entity/period"}
    if rec.get("is_reopened"):
        return {**rec, "noop": True}
    await db.period_closes.update_one(
        {"id": rec["id"]},
        {"$set": {"is_reopened": True, "reopened_at": _now_iso(), "reopened_by_user_id": reopened_by}},
    )
    # Recompute lock_through from remaining non-reopened closes
    new_lock = ""
    async for d in db.period_closes.find(
        {"entity_id": entity_id, "is_reopened": {"$ne": True}}, {"period_end": 1, "_id": 0}
    ).sort([("period_end", -1)]):
        new_lock = d["period_end"]
        break
    await db.entities.update_one({"id": entity_id}, {"$set": {"lock_through": new_lock}})
    rec["is_reopened"] = True
    rec["new_lock_through"] = new_lock
    return rec
