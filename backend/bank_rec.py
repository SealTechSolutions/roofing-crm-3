"""Bank Reconciliation — single-account, single-statement-period.

A reconciliation matches the GL bank account balance to the bank statement.
Workflow:
  1. User picks an entity + bank-category account + statement_date + statement_balance.
  2. System lists all journal lines posted to that account through statement_date,
     joined with `bank_clearings` so already-cleared lines show as cleared.
  3. User toggles each line cleared/uncleared. Live recompute of `cleared_total`
     and `reconciled_balance` (= cleared deposits − cleared payments).
  4. Saving creates/updates a `bank_reconciliations` doc and clears the marked
     journals (writes `bank_clearings` records). Locking a rec freezes its
     `cleared_journal_ids` so they stay cleared on future reconciliations.

Data model:
  bank_reconciliations  { id, entity_id, account_id, statement_date,
                          statement_balance, beginning_balance, cleared_total,
                          reconciled_balance, difference, status (open|locked),
                          cleared_journal_ids: [str], created_at, completed_at,
                          completed_by_user_id }
  bank_clearings        { id, entity_id, account_id, journal_entry_id,
                          reconciliation_id, cleared_at }
"""
from typing import Optional, List
import uuid
import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def ensure_indexes(db):
    await db.bank_reconciliations.create_index("id", unique=True)
    await db.bank_reconciliations.create_index([("entity_id", 1), ("account_id", 1), ("statement_date", -1)])
    await db.bank_clearings.create_index("id", unique=True)
    await db.bank_clearings.create_index([("entity_id", 1), ("account_id", 1), ("journal_entry_id", 1)], unique=True)


async def list_bank_accounts(db, entity_id: str) -> List[dict]:
    """Bank-category accounts available for reconciliation on this entity."""
    out = []
    async for a in db.chart_of_accounts.find(
        {"entity_id": entity_id, "category": "Bank", "is_active": True},
        {"_id": 0},
    ).sort("number", 1):
        out.append(a)
    return out


async def list_lines_for_recon(
    db, *, entity_id: str, account_id: str, date_to: Optional[str], include_cleared_in_prior_recs: bool = True
) -> dict:
    """Return all journal lines hitting `account_id` through `date_to` (exclusive of voided/reversed).
    Each row carries: journal_id, date, memo, source_type, source_id, debit, credit,
    cleared (bool from bank_clearings)."""
    match: dict = {
        "entity_id": entity_id,
        "is_reversed": {"$ne": True},
    }
    if date_to:
        match["date"] = {"$lte": date_to}
    pipeline = [
        {"$match": match},
        {"$unwind": "$lines"},
        {"$match": {"lines.account_id": account_id}},
        {"$project": {
            "_id": 0,
            "journal_id": "$id",
            "date": 1,
            "memo": 1,
            "source_type": 1,
            "source_id": 1,
            "debit": "$lines.debit",
            "credit": "$lines.credit",
        }},
        {"$sort": {"date": 1}},
    ]
    # Load existing clearings for this account
    cleared_ids = set()
    async for c in db.bank_clearings.find({"entity_id": entity_id, "account_id": account_id}, {"_id": 0, "journal_entry_id": 1}):
        cleared_ids.add(c["journal_entry_id"])

    rows = []
    total_debit = 0.0
    total_credit = 0.0
    cleared_debit = 0.0
    cleared_credit = 0.0
    async for r in db.journal_entries.aggregate(pipeline):
        is_cleared = r["journal_id"] in cleared_ids
        rows.append({
            "journal_id": r["journal_id"],
            "date": r.get("date"),
            "memo": r.get("memo", ""),
            "source_type": r.get("source_type"),
            "source_id": r.get("source_id"),
            "debit": round(float(r.get("debit", 0)), 2),
            "credit": round(float(r.get("credit", 0)), 2),
            "cleared": is_cleared,
        })
        total_debit += float(r.get("debit", 0))
        total_credit += float(r.get("credit", 0))
        if is_cleared:
            cleared_debit += float(r.get("debit", 0))
            cleared_credit += float(r.get("credit", 0))

    gl_balance = round(total_debit - total_credit, 2)
    cleared_balance = round(cleared_debit - cleared_credit, 2)
    return {
        "entity_id": entity_id,
        "account_id": account_id,
        "date_to": date_to,
        "rows": rows,
        "gl_balance": gl_balance,  # Total balance per GL through date_to
        "cleared_balance": cleared_balance,  # Sum of cleared (post-prior-recs)
        "uncleared_balance": round(gl_balance - cleared_balance, 2),
    }


async def list_recs(db, *, entity_id: Optional[str] = None) -> List[dict]:
    q: dict = {} if not entity_id else {"entity_id": entity_id}
    out = []
    async for r in db.bank_reconciliations.find(q, {"_id": 0}).sort([("statement_date", -1)]):
        out.append(r)
    return out


async def get_rec(db, rec_id: str) -> Optional[dict]:
    return await db.bank_reconciliations.find_one({"id": rec_id}, {"_id": 0})


async def save_rec(
    db,
    *,
    rec_id: Optional[str],
    entity_id: str,
    account_id: str,
    statement_date: str,
    statement_balance: float,
    cleared_journal_ids: List[str],
    status: str = "open",
    user_id: Optional[str] = None,
) -> dict:
    """Create or update a bank reconciliation."""
    # Recompute totals from cleared journal lines
    pipeline = [
        {"$match": {"id": {"$in": cleared_journal_ids}, "is_reversed": {"$ne": True}}},
        {"$unwind": "$lines"},
        {"$match": {"lines.account_id": account_id}},
        {"$group": {"_id": None, "debit": {"$sum": "$lines.debit"}, "credit": {"$sum": "$lines.credit"}}},
    ]
    debit = 0.0
    credit = 0.0
    async for r in db.journal_entries.aggregate(pipeline):
        debit = float(r.get("debit", 0))
        credit = float(r.get("credit", 0))
    cleared_total = round(debit - credit, 2)

    # Beginning balance = previous reconciliation's reconciled_balance, or 0
    prev = await db.bank_reconciliations.find_one(
        {
            "entity_id": entity_id, "account_id": account_id,
            "statement_date": {"$lt": statement_date},
            "status": "locked",
        },
        sort=[("statement_date", -1)],
    )
    beginning_balance = round(float((prev or {}).get("reconciled_balance", 0)), 2)
    reconciled_balance = round(beginning_balance + cleared_total, 2)
    difference = round(reconciled_balance - float(statement_balance), 2)
    balanced = abs(difference) < 0.01

    rec = {
        "entity_id": entity_id,
        "account_id": account_id,
        "statement_date": statement_date,
        "statement_balance": round(float(statement_balance), 2),
        "beginning_balance": beginning_balance,
        "cleared_total": cleared_total,
        "reconciled_balance": reconciled_balance,
        "difference": difference,
        "balanced": balanced,
        "status": status if status in ("open", "locked") else "open",
        "cleared_journal_ids": cleared_journal_ids,
        "updated_at": _now_iso(),
    }
    if rec_id:
        existing = await db.bank_reconciliations.find_one({"id": rec_id}, {"_id": 0})
        if not existing:
            return {"error": "Reconciliation not found"}
        if existing.get("status") == "locked":
            return {"error": "Reconciliation is locked — reopen first to edit"}
        rec["id"] = rec_id
        await db.bank_reconciliations.update_one({"id": rec_id}, {"$set": rec})
    else:
        rec["id"] = str(uuid.uuid4())
        rec["created_at"] = _now_iso()
        rec["created_by_user_id"] = user_id
        await db.bank_reconciliations.insert_one(rec.copy())

    if rec["status"] == "locked":
        # Stamp completion + persist clearings
        await db.bank_reconciliations.update_one(
            {"id": rec["id"]},
            {"$set": {"completed_at": _now_iso(), "completed_by_user_id": user_id}},
        )
        for jid in cleared_journal_ids:
            try:
                await db.bank_clearings.update_one(
                    {"entity_id": entity_id, "account_id": account_id, "journal_entry_id": jid},
                    {"$setOnInsert": {
                        "id": str(uuid.uuid4()),
                        "entity_id": entity_id,
                        "account_id": account_id,
                        "journal_entry_id": jid,
                        "reconciliation_id": rec["id"],
                        "cleared_at": _now_iso(),
                    }},
                    upsert=True,
                )
            except Exception as e:
                logger.warning(f"bank_clearing insert failed for journal {jid}: {e}")

    rec.pop("_id", None)
    return rec


async def reopen_rec(db, *, rec_id: str) -> dict:
    rec = await db.bank_reconciliations.find_one({"id": rec_id}, {"_id": 0})
    if not rec:
        return {"error": "Not found"}
    if rec.get("status") != "locked":
        return {"error": "Reconciliation is not locked"}
    await db.bank_reconciliations.update_one(
        {"id": rec_id},
        {"$set": {"status": "open", "completed_at": None, "completed_by_user_id": None, "updated_at": _now_iso()}},
    )
    # Remove clearings tied to this rec
    await db.bank_clearings.delete_many({"reconciliation_id": rec_id})
    rec["status"] = "open"
    return rec


async def delete_rec(db, *, rec_id: str) -> dict:
    rec = await db.bank_reconciliations.find_one({"id": rec_id}, {"_id": 0})
    if not rec:
        return {"error": "Not found"}
    if rec.get("status") == "locked":
        return {"error": "Cannot delete a locked reconciliation — reopen first"}
    await db.bank_reconciliations.delete_one({"id": rec_id})
    await db.bank_clearings.delete_many({"reconciliation_id": rec_id})
    return {"ok": True, "deleted": rec_id}
