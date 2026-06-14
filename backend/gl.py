"""General Ledger (GL) auto-posting + KPI reporting for the Books module.

Phase 2 deliverable. Hooks fire from CRM events (invoice, vendor bill) and
write double-entry rows to the `journal_entries` collection. KPI queries are
read directly off that collection so the Books Dashboard strip can show
Cash on hand · Open AR · Open AP · MTD/YTD revenue per entity in real time.

Posting key convention (for idempotency):
    f"{source_type}:{source_id}:{kind}"  →  e.g.  "invoice:abc-123:issue"
Re-posting the same key overwrites the existing entry (so a partial-payment
bump can simply re-run and the total paid amount stays correct). Voiding /
deletion marks the entry `is_reversed=true` which excludes it from KPI calcs.
"""
from typing import Optional, List, Dict
import uuid
import logging
from datetime import datetime, timezone, timedelta


logger = logging.getLogger(__name__)


# ---------- Account mapping helpers ----------

def revenue_account_for(invoice: dict, deal: Optional[dict]) -> str:
    """Pick the 4xxx revenue account number based on invoice/deal context."""
    src = (invoice.get("source_type") or "").lower()
    if src == "maintenance_visit":
        return "4100"
    inv_type = (invoice.get("invoice_type") or "").lower()
    if "maintenance" in inv_type or "repair" in inv_type:
        return "4100"
    rt = ""
    if deal:
        rt = (deal.get("proposed_roof_type") or "").upper()
    if "FARM" in rt:
        return "4030"
    if "SILICONE" in rt or "RESTORATION" in rt:
        return "4000"
    if "NEW CONSTRUCTION" in rt:
        return "4020"
    # Default = Re-Roof / Replacement (TPO/EPDM/ModBit/PVC/BUR/Metal/Shingle/Tile)
    return "4010"


def cogs_account_for(vendor: Optional[dict]) -> str:
    """Map a vendor → the COGS account their bills should hit.

    - Subcontractor (kind OR category)              → 5010 Subcontractor Labor
    - Equipment / Porta Potty / Dumpster / Storage  → 5020 Equipment Rental
      Container Supplier                              (site-service rentals share one COGS bucket)
    - Everything else (incl. Material Supplier)     → 5000 Materials — Direct
    """
    if not vendor:
        return "5000"
    kind = (vendor.get("kind") or "").lower()
    cat = (vendor.get("category") or "").lower()
    if kind == "subcontractor" or cat == "subcontractor":
        return "5010"
    if cat in (
        "equipment supplier",
        "porta potty supplier",
        "dumpster supplier",
        "storage container supplier",
    ):
        return "5020"
    return "5000"


# ---------- Core posting ----------

async def _account_by_number(db, entity_id: str, number: str) -> Optional[dict]:
    return await db.chart_of_accounts.find_one(
        {"entity_id": entity_id, "number": number, "is_active": True}, {"_id": 0}
    )


async def _build_line(db, entity_id: str, number: str, debit: float, credit: float, memo: str = "") -> Optional[dict]:
    acct = await _account_by_number(db, entity_id, number)
    if not acct:
        logger.warning(f"GL: missing account {number} for entity {entity_id} — skipping line")
        return None
    return {
        "account_id": acct["id"],
        "account_number": acct["number"],
        "account_name": acct["name"],
        "account_type": acct["type"],
        "debit": round(float(debit or 0), 2),
        "credit": round(float(credit or 0), 2),
        "memo": memo,
    }


async def _entity_name(db, entity_id: str) -> str:
    e = await db.entities.find_one({"id": entity_id}, {"_id": 0, "name": 1})
    return (e or {}).get("name", "Entity")


async def check_period_lock(db, entity_id: Optional[str], posting_date: Optional[str]) -> Optional[str]:
    """Returns the entity's lock_through date if it covers `posting_date`, else None.
    Used by CRM endpoints to surface a "posting deferred — period locked" warning to the user.
    """
    if not entity_id or not posting_date:
        return None
    ent = await db.entities.find_one({"id": entity_id}, {"_id": 0, "lock_through": 1})
    lock = (ent or {}).get("lock_through") or ""
    return lock if (lock and posting_date <= lock) else None


async def post_journal(
    db,
    *,
    entity_id: str,
    source_type: str,
    source_id: str,
    kind: str,
    lines: List[dict],
    memo: str = "",
    posting_date: Optional[str] = None,
    posted_by_user_id: Optional[str] = None,
    bypass_period_lock: bool = False,
) -> Optional[dict]:
    """Idempotent upsert of one journal entry. Returns the stored doc (or None if no valid lines).
    Refuses to post if the entity's `lock_through` date covers the posting date — unless bypass_period_lock=True
    (used by the period-close orchestrator to post late-fee + depreciation entries on its way to locking)."""
    clean_lines = [ln for ln in lines if ln is not None and (ln["debit"] > 0 or ln["credit"] > 0)]
    if not clean_lines:
        return None
    total_debit = round(sum(ln["debit"] for ln in clean_lines), 2)
    total_credit = round(sum(ln["credit"] for ln in clean_lines), 2)
    if abs(total_debit - total_credit) > 0.01:
        logger.warning(
            f"GL: unbalanced entry for {source_type}:{source_id}:{kind} — "
            f"D={total_debit} C={total_credit} — skipping post"
        )
        return None
    posting_date_str = posting_date or datetime.now(timezone.utc).date().isoformat()
    if not bypass_period_lock:
        ent = await db.entities.find_one({"id": entity_id}, {"_id": 0, "lock_through": 1})
        lock = (ent or {}).get("lock_through") or ""
        if lock and posting_date_str <= lock:
            logger.warning(
                f"GL: refused to post {source_type}:{source_id}:{kind} on {posting_date_str} — entity "
                f"{entity_id} closed through {lock}. Reopen the period to post."
            )
            return None
    posting_key = f"{source_type}:{source_id}:{kind}"
    now_iso = datetime.now(timezone.utc).isoformat()
    doc = {
        "entity_id": entity_id,
        "source_type": source_type,
        "source_id": source_id,
        "kind": kind,
        "posting_key": posting_key,
        "date": posting_date_str,
        "memo": memo,
        "lines": clean_lines,
        "total_debit": total_debit,
        "total_credit": total_credit,
        "is_reversed": False,
        "posted_by_user_id": posted_by_user_id,
        "posted_at": now_iso,
        "updated_at": now_iso,
    }
    existing = await db.journal_entries.find_one({"posting_key": posting_key}, {"_id": 0, "id": 1})
    if existing:
        await db.journal_entries.update_one({"posting_key": posting_key}, {"$set": doc})
        doc["id"] = existing["id"]
    else:
        doc["id"] = str(uuid.uuid4())
        doc["created_at"] = now_iso
        await db.journal_entries.insert_one(doc.copy())
    doc.pop("_id", None)
    return doc


async def reverse_journals(db, *, source_type: str, source_id: str, kind: Optional[str] = None) -> int:
    """Mark journals for a source doc as reversed. If kind omitted, reverses all kinds for that source."""
    q: dict = {"source_type": source_type, "source_id": source_id}
    if kind:
        q["kind"] = kind
    res = await db.journal_entries.update_many(
        q, {"$set": {"is_reversed": True, "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    return res.modified_count


# ---------- High-level hooks ----------

async def post_invoice_issue(db, invoice: dict, posted_by_user_id: Optional[str] = None):
    """DR 1100 AR / CR 4xxx Sales (account chosen by roof type).
    If `counter_entity_id` is set on the invoice, post as inter-company:
      Issuer:  DR 1900 Inter-Co A/R / CR 4900 Inter-Co Revenue
      Mirror:  DR 6700 Inter-Co Expense / CR 2900 Inter-Co A/P  (on counter_entity)
    """
    ent = invoice.get("entity_id")
    if not ent:
        return None
    total = round(float(invoice.get("total") or 0), 2)
    if total <= 0:
        return None
    status = (invoice.get("status") or "").lower()
    if status in ("draft", "void", ""):
        # If invoice is voided after being issued — reverse BOTH the issue and any payment journal
        await reverse_journals(db, source_type="invoice", source_id=invoice["id"], kind="issue")
        await reverse_journals(db, source_type="invoice", source_id=invoice["id"], kind="payment")
        # Also reverse any inter-co mirrors
        await reverse_journals(db, source_type="invoice_ic_mirror", source_id=invoice["id"])
        return None

    counter = invoice.get("counter_entity_id") or None
    deal = None
    if invoice.get("deal_id"):
        deal = await db.deals.find_one({"id": invoice["deal_id"]}, {"_id": 0})

    if counter:
        # Inter-company posting on issuer
        lines = [
            await _build_line(db, ent, "1900", debit=total, credit=0, memo=f"Inter-Co A/R · Invoice {invoice.get('invoice_number','')}"),
            await _build_line(db, ent, "4900", debit=0, credit=total, memo=f"Inter-Co revenue from {await _entity_name(db, counter)}"),
        ]
        memo = f"Inter-Co Invoice {invoice.get('invoice_number','')} — {invoice.get('bill_to_company') or invoice.get('bill_to_name','')}"
        issuer_post = await post_journal(
            db,
            entity_id=ent,
            source_type="invoice",
            source_id=invoice["id"],
            kind="issue",
            lines=lines,
            memo=memo,
            posting_date=invoice.get("invoice_date"),
            posted_by_user_id=posted_by_user_id,
        )
        # Mirror on counter entity
        mirror_lines = [
            await _build_line(db, counter, "6700", debit=total, credit=0, memo=f"Inter-Co Expense · Invoice {invoice.get('invoice_number','')} from {await _entity_name(db, ent)}"),
            await _build_line(db, counter, "2900", debit=0, credit=total, memo=f"Inter-Co A/P to {await _entity_name(db, ent)}"),
        ]
        mirror_post = await post_journal(
            db,
            entity_id=counter,
            source_type="invoice_ic_mirror",
            source_id=invoice["id"],
            kind="issue_mirror",
            lines=mirror_lines,
            memo=f"Mirror · Inter-Co Invoice {invoice.get('invoice_number','')} from {await _entity_name(db, ent)}",
            posting_date=invoice.get("invoice_date"),
            posted_by_user_id=posted_by_user_id,
        )
        # Tag counter_entity_id on the issuer-side journal so the IC report can pivot
        if issuer_post:
            await db.journal_entries.update_one(
                {"id": issuer_post["id"]},
                {"$set": {"counter_entity_id": counter, "is_inter_company": True}},
            )
        if mirror_post:
            await db.journal_entries.update_one(
                {"id": mirror_post["id"]},
                {"$set": {"counter_entity_id": ent, "is_inter_company": True, "is_ic_mirror": True}},
            )
        return issuer_post

    # Normal (non-IC) posting
    rev_no = revenue_account_for(invoice, deal)
    lines = [
        await _build_line(db, ent, "1100", debit=total, credit=0, memo=f"Invoice {invoice.get('invoice_number','')}"),
        await _build_line(db, ent, rev_no, debit=0, credit=total, memo=f"Sale — {invoice.get('project_title','')}"),
    ]
    memo = f"Invoice {invoice.get('invoice_number','')} — {invoice.get('bill_to_company') or invoice.get('bill_to_name','')}"
    return await post_journal(
        db,
        entity_id=ent,
        source_type="invoice",
        source_id=invoice["id"],
        kind="issue",
        lines=lines,
        memo=memo,
        posting_date=invoice.get("invoice_date"),
        posted_by_user_id=posted_by_user_id,
    )


async def post_invoice_payment(db, invoice: dict, posted_by_user_id: Optional[str] = None):
    """DR 1000 Bank / CR 1100 AR (or CR 1900 if inter-co) — total amount_paid (idempotent overwrite)."""
    ent = invoice.get("entity_id")
    if not ent:
        return None
    paid = round(float(invoice.get("amount_paid") or 0), 2)
    if paid <= 0:
        await reverse_journals(db, source_type="invoice", source_id=invoice["id"], kind="payment")
        await reverse_journals(db, source_type="invoice_ic_mirror", source_id=invoice["id"], kind="payment_mirror")
        return None
    counter = invoice.get("counter_entity_id") or None
    ar_no = "1900" if counter else "1100"
    lines = [
        await _build_line(db, ent, "1000", debit=paid, credit=0, memo=f"Payment received — Invoice {invoice.get('invoice_number','')}"),
        await _build_line(db, ent, ar_no, debit=0, credit=paid, memo=f"Apply to {'Inter-Co ' if counter else ''}A/R — Invoice {invoice.get('invoice_number','')}"),
    ]
    memo = f"Payment — Invoice {invoice.get('invoice_number','')} ({invoice.get('payment_method') or 'cash/ck'})"
    res = await post_journal(
        db,
        entity_id=ent,
        source_type="invoice",
        source_id=invoice["id"],
        kind="payment",
        lines=lines,
        memo=memo,
        posting_date=invoice.get("payment_date") or invoice.get("invoice_date"),
        posted_by_user_id=posted_by_user_id,
    )
    if counter:
        mirror_lines = [
            await _build_line(db, counter, "2900", debit=paid, credit=0, memo=f"Paid Inter-Co A/P — Invoice {invoice.get('invoice_number','')}"),
            await _build_line(db, counter, "1000", debit=0, credit=paid, memo=f"Bank disbursement — {await _entity_name(db, ent)}"),
        ]
        m = await post_journal(
            db,
            entity_id=counter,
            source_type="invoice_ic_mirror",
            source_id=invoice["id"],
            kind="payment_mirror",
            lines=mirror_lines,
            memo=f"Mirror · Inter-Co Invoice payment {invoice.get('invoice_number','')}",
            posting_date=invoice.get("payment_date") or invoice.get("invoice_date"),
            posted_by_user_id=posted_by_user_id,
        )
        if res:
            await db.journal_entries.update_one({"id": res["id"]}, {"$set": {"counter_entity_id": counter, "is_inter_company": True}})
        if m:
            await db.journal_entries.update_one({"id": m["id"]}, {"$set": {"counter_entity_id": ent, "is_inter_company": True, "is_ic_mirror": True}})
    return res


async def post_bill_received(db, bill: dict, posted_by_user_id: Optional[str] = None):
    """DR 5000 Materials (or 5010 Sub Labor) / CR 2000 AP.
    If counter_entity_id set, post as inter-company on buyer:
      Buyer:   DR 6700 IC Expense / CR 2900 IC A/P
      Mirror:  DR 1900 IC A/R / CR 4900 IC Revenue  (on counter_entity = seller)
    """
    ent = bill.get("entity_id")
    if not ent:
        return None
    total = round(float(bill.get("total") or 0), 2)
    if total <= 0:
        return None
    status = (bill.get("status") or "").lower()
    if status in ("void", "draft", ""):
        await reverse_journals(db, source_type="vendor_bill", source_id=bill["id"], kind="bill_received")
        await reverse_journals(db, source_type="vendor_bill", source_id=bill["id"], kind="bill_payment")
        await reverse_journals(db, source_type="vendor_bill_ic_mirror", source_id=bill["id"])
        return None
    counter = bill.get("counter_entity_id") or None

    if counter:
        lines = [
            await _build_line(db, ent, "6700", debit=total, credit=0, memo=f"Inter-Co Expense · Bill {bill.get('bill_number','')} from {await _entity_name(db, counter)}"),
            await _build_line(db, ent, "2900", debit=0, credit=total, memo=f"Inter-Co A/P to {await _entity_name(db, counter)}"),
        ]
        memo = f"Inter-Co Bill {bill.get('bill_number','')} — {bill.get('vendor_name','')}"
        buyer = await post_journal(
            db,
            entity_id=ent,
            source_type="vendor_bill",
            source_id=bill["id"],
            kind="bill_received",
            lines=lines,
            memo=memo,
            posting_date=bill.get("bill_date") or bill.get("received_date"),
            posted_by_user_id=posted_by_user_id,
        )
        mirror_lines = [
            await _build_line(db, counter, "1900", debit=total, credit=0, memo=f"Inter-Co A/R · Bill {bill.get('bill_number','')} to {await _entity_name(db, ent)}"),
            await _build_line(db, counter, "4900", debit=0, credit=total, memo=f"Inter-Co revenue from {await _entity_name(db, ent)}"),
        ]
        seller = await post_journal(
            db,
            entity_id=counter,
            source_type="vendor_bill_ic_mirror",
            source_id=bill["id"],
            kind="bill_received_mirror",
            lines=mirror_lines,
            memo=f"Mirror · Inter-Co Bill {bill.get('bill_number','')} to {await _entity_name(db, ent)}",
            posting_date=bill.get("bill_date") or bill.get("received_date"),
            posted_by_user_id=posted_by_user_id,
        )
        if buyer:
            await db.journal_entries.update_one({"id": buyer["id"]}, {"$set": {"counter_entity_id": counter, "is_inter_company": True}})
        if seller:
            await db.journal_entries.update_one({"id": seller["id"]}, {"$set": {"counter_entity_id": ent, "is_inter_company": True, "is_ic_mirror": True}})
        return buyer

    vendor = None
    if bill.get("vendor_id"):
        vendor = await db.vendors.find_one({"id": bill["vendor_id"]}, {"_id": 0})
    cogs_no = cogs_account_for(vendor)
    lines = [
        await _build_line(db, ent, cogs_no, debit=total, credit=0, memo=f"Bill {bill.get('bill_number','')} — {bill.get('vendor_name','')}"),
        await _build_line(db, ent, "2000", debit=0, credit=total, memo=f"A/P — {bill.get('vendor_name','')}"),
    ]
    memo = f"Vendor Bill {bill.get('bill_number','')} — {bill.get('vendor_name','')}"
    return await post_journal(
        db,
        entity_id=ent,
        source_type="vendor_bill",
        source_id=bill["id"],
        kind="bill_received",
        lines=lines,
        memo=memo,
        posting_date=bill.get("bill_date") or bill.get("received_date"),
        posted_by_user_id=posted_by_user_id,
    )


async def post_bill_payment(db, bill: dict, posted_by_user_id: Optional[str] = None):
    """DR 2000 AP (or 2900 if IC) / CR 1000 Bank."""
    ent = bill.get("entity_id")
    if not ent:
        return None
    paid = round(float(bill.get("paid_amount") or 0), 2)
    if paid <= 0:
        await reverse_journals(db, source_type="vendor_bill", source_id=bill["id"], kind="bill_payment")
        await reverse_journals(db, source_type="vendor_bill_ic_mirror", source_id=bill["id"], kind="bill_payment_mirror")
        return None
    counter = bill.get("counter_entity_id") or None
    ap_no = "2900" if counter else "2000"
    lines = [
        await _build_line(db, ent, ap_no, debit=paid, credit=0, memo=f"Paid — Bill {bill.get('bill_number','')}"),
        await _build_line(db, ent, "1000", debit=0, credit=paid, memo=f"Bank disbursement — {bill.get('vendor_name','')}"),
    ]
    memo = f"Bill payment — {bill.get('vendor_name','')} ({bill.get('paid_method') or 'cash/ck'})"
    res = await post_journal(
        db,
        entity_id=ent,
        source_type="vendor_bill",
        source_id=bill["id"],
        kind="bill_payment",
        lines=lines,
        memo=memo,
        posting_date=bill.get("paid_date") or bill.get("bill_date"),
        posted_by_user_id=posted_by_user_id,
    )
    if counter:
        mirror_lines = [
            await _build_line(db, counter, "1000", debit=paid, credit=0, memo=f"Received from {await _entity_name(db, ent)}"),
            await _build_line(db, counter, "1900", debit=0, credit=paid, memo=f"Applied to Inter-Co A/R · Bill {bill.get('bill_number','')}"),
        ]
        m = await post_journal(
            db,
            entity_id=counter,
            source_type="vendor_bill_ic_mirror",
            source_id=bill["id"],
            kind="bill_payment_mirror",
            lines=mirror_lines,
            memo=f"Mirror · Inter-Co Bill payment {bill.get('bill_number','')}",
            posting_date=bill.get("paid_date") or bill.get("bill_date"),
            posted_by_user_id=posted_by_user_id,
        )
        if res:
            await db.journal_entries.update_one({"id": res["id"]}, {"$set": {"counter_entity_id": counter, "is_inter_company": True}})
        if m:
            await db.journal_entries.update_one({"id": m["id"]}, {"$set": {"counter_entity_id": ent, "is_inter_company": True, "is_ic_mirror": True}})
    return res


# ---------- Reports / KPIs ----------

CASH_ACCOUNT_NUMBERS = ("1000", "1010", "1020")
AR_ACCOUNT_NUMBER = "1100"
AP_ACCOUNT_NUMBER = "2000"


async def _sum_for_accounts(db, entity_id: str, account_numbers, *, date_from: Optional[str] = None, date_to: Optional[str] = None, account_type: Optional[str] = None, category: Optional[str] = None):
    """Returns (total_debit, total_credit) for given accounts within an optional date window.
    Filter by any combination of numbers, type, or category (e.g. all Bank accounts)."""
    match: dict = {"entity_id": entity_id, "is_reversed": {"$ne": True}}
    if date_from:
        match.setdefault("date", {})["$gte"] = date_from
    if date_to:
        match.setdefault("date", {})["$lte"] = date_to
    pipeline = [{"$match": match}, {"$unwind": "$lines"}]
    line_match: dict = {}
    if account_numbers:
        line_match["lines.account_number"] = {"$in": list(account_numbers)}
    if account_type:
        line_match["lines.account_type"] = account_type
    if category:
        # Resolve account ids in this entity with the given category, then filter by ids
        ids = [a["id"] async for a in db.chart_of_accounts.find({"entity_id": entity_id, "category": category}, {"id": 1, "_id": 0})]
        line_match["lines.account_id"] = {"$in": ids}
    if line_match:
        pipeline.append({"$match": line_match})
    pipeline.append({"$group": {"_id": None, "debit": {"$sum": "$lines.debit"}, "credit": {"$sum": "$lines.credit"}}})
    cursor = db.journal_entries.aggregate(pipeline)
    docs = await cursor.to_list(1)
    if not docs:
        return 0.0, 0.0
    return round(float(docs[0].get("debit") or 0), 2), round(float(docs[0].get("credit") or 0), 2)


async def entity_kpis(db, entity_id: str) -> dict:
    today = datetime.now(timezone.utc).date()
    month_start = today.replace(day=1).isoformat()
    year_start = today.replace(month=1, day=1).isoformat()

    # Cash = all Asset accounts with category='Bank' (includes custom bank accounts beyond the seeded 1000/1010/1020)
    cash_d, cash_c = await _sum_for_accounts(db, entity_id, [], category="Bank")
    ar_d, ar_c = await _sum_for_accounts(db, entity_id, [AR_ACCOUNT_NUMBER])
    ap_d, ap_c = await _sum_for_accounts(db, entity_id, [AP_ACCOUNT_NUMBER])
    rev_mtd_d, rev_mtd_c = await _sum_for_accounts(db, entity_id, [], date_from=month_start, account_type="Revenue")
    rev_ytd_d, rev_ytd_c = await _sum_for_accounts(db, entity_id, [], date_from=year_start, account_type="Revenue")
    cogs_ytd_d, cogs_ytd_c = await _sum_for_accounts(db, entity_id, [], date_from=year_start, account_type="COGS")

    return {
        "entity_id": entity_id,
        "as_of": today.isoformat(),
        "cash_on_hand": round(cash_d - cash_c, 2),
        "open_ar": round(ar_d - ar_c, 2),
        "open_ap": round(ap_c - ap_d, 2),
        "mtd_revenue": round(rev_mtd_c - rev_mtd_d, 2),
        "ytd_revenue": round(rev_ytd_c - rev_ytd_d, 2),
        "ytd_cogs": round(cogs_ytd_d - cogs_ytd_c, 2),
        "ytd_gross_profit": round((rev_ytd_c - rev_ytd_d) - (cogs_ytd_d - cogs_ytd_c), 2),
    }


async def ensure_indexes(db):
    await db.journal_entries.create_index("id", unique=True)
    await db.journal_entries.create_index("posting_key", unique=True)
    await db.journal_entries.create_index([("entity_id", 1), ("date", -1)])
    await db.journal_entries.create_index([("source_type", 1), ("source_id", 1)])


# ---------- P&L / Balance Sheet Reports ----------

async def _account_balances(db, entity_id: str, *, date_from: Optional[str] = None, date_to: Optional[str] = None) -> List[dict]:
    """Return one row per account in the entity's COA with debit/credit totals from journal lines in the window."""
    match: dict = {"entity_id": entity_id, "is_reversed": {"$ne": True}}
    if date_from:
        match.setdefault("date", {})["$gte"] = date_from
    if date_to:
        match.setdefault("date", {})["$lte"] = date_to
    pipeline = [
        {"$match": match},
        {"$unwind": "$lines"},
        {"$group": {
            "_id": "$lines.account_id",
            "account_number": {"$first": "$lines.account_number"},
            "account_name": {"$first": "$lines.account_name"},
            "account_type": {"$first": "$lines.account_type"},
            "debit": {"$sum": "$lines.debit"},
            "credit": {"$sum": "$lines.credit"},
        }},
    ]
    out = []
    async for row in db.journal_entries.aggregate(pipeline):
        out.append({
            "account_id": row["_id"],
            "account_number": row.get("account_number"),
            "account_name": row.get("account_name"),
            "account_type": row.get("account_type"),
            "debit": round(float(row.get("debit") or 0), 2),
            "credit": round(float(row.get("credit") or 0), 2),
        })
    return out


def _natural_balance(account_type: str, debit: float, credit: float) -> float:
    """Compute the natural-side balance for an account based on its type."""
    if account_type in ("Asset", "COGS", "Expense"):
        return round(debit - credit, 2)
    # Liability, Equity, Revenue (and "Other" defaults to credit-positive)
    return round(credit - debit, 2)


async def report_profit_loss(db, entity_id: str, date_from: Optional[str], date_to: Optional[str]) -> dict:
    """Build a P&L (Income Statement) for an entity over a date range."""
    rows = await _account_balances(db, entity_id, date_from=date_from, date_to=date_to)
    sections = {"Revenue": [], "COGS": [], "Expense": [], "Other": []}
    for r in rows:
        t = r["account_type"]
        if t in sections:
            sections[t].append({**r, "balance": _natural_balance(t, r["debit"], r["credit"])})
    for k in sections:
        sections[k].sort(key=lambda x: x["account_number"] or "")
    total_revenue = round(sum(a["balance"] for a in sections["Revenue"]), 2)
    total_cogs = round(sum(a["balance"] for a in sections["COGS"]), 2)
    gross_profit = round(total_revenue - total_cogs, 2)
    total_expense = round(sum(a["balance"] for a in sections["Expense"]), 2)
    total_other = round(sum(a["balance"] for a in sections["Other"]), 2)
    net_income = round(gross_profit - total_expense + total_other, 2)
    return {
        "entity_id": entity_id,
        "date_from": date_from,
        "date_to": date_to,
        "sections": sections,
        "totals": {
            "revenue": total_revenue,
            "cogs": total_cogs,
            "gross_profit": gross_profit,
            "gross_margin_pct": round((gross_profit / total_revenue * 100), 2) if total_revenue else 0,
            "operating_expense": total_expense,
            "other_income_expense": total_other,
            "net_income": net_income,
            "net_margin_pct": round((net_income / total_revenue * 100), 2) if total_revenue else 0,
        },
    }


async def report_balance_sheet(db, entity_id: str, as_of: Optional[str]) -> dict:
    """Build a Balance Sheet as of a date. Equity includes net income earned through as_of."""
    # All journals through as_of for B/S accounts
    rows = await _account_balances(db, entity_id, date_to=as_of)
    sections = {"Asset": [], "Liability": [], "Equity": []}
    for r in rows:
        t = r["account_type"]
        if t in sections:
            sections[t].append({**r, "balance": _natural_balance(t, r["debit"], r["credit"])})
    for k in sections:
        sections[k].sort(key=lambda x: x["account_number"] or "")

    # Net income line for retained earnings — sum all Rev - COGS - Expense + Other up to as_of
    income_rows = await _account_balances(db, entity_id, date_to=as_of)
    rev = sum(_natural_balance("Revenue", r["debit"], r["credit"]) for r in income_rows if r["account_type"] == "Revenue")
    cogs = sum(_natural_balance("COGS", r["debit"], r["credit"]) for r in income_rows if r["account_type"] == "COGS")
    opex = sum(_natural_balance("Expense", r["debit"], r["credit"]) for r in income_rows if r["account_type"] == "Expense")
    other = sum(_natural_balance("Other", r["debit"], r["credit"]) for r in income_rows if r["account_type"] == "Other")
    current_earnings = round(rev - cogs - opex + other, 2)

    total_assets = round(sum(a["balance"] for a in sections["Asset"]), 2)
    total_liabilities = round(sum(a["balance"] for a in sections["Liability"]), 2)
    total_equity_accts = round(sum(a["balance"] for a in sections["Equity"]), 2)
    total_equity = round(total_equity_accts + current_earnings, 2)
    out_of_balance = round(total_assets - (total_liabilities + total_equity), 2)
    return {
        "entity_id": entity_id,
        "as_of": as_of,
        "sections": sections,
        "current_earnings": current_earnings,
        "totals": {
            "assets": total_assets,
            "liabilities": total_liabilities,
            "equity_accounts": total_equity_accts,
            "equity_total": total_equity,
            "liab_plus_equity": round(total_liabilities + total_equity, 2),
            "out_of_balance": out_of_balance,
            "balanced": abs(out_of_balance) < 0.01,
        },
    }


# ---------- Cash Flow Statement (Indirect Method) ----------

def _cf_classify(account: dict) -> str:
    """Bucket an account into one of the cash-flow sections.

    Returns: 'cash', 'operating', 'investing', 'financing', or 'pl'.
    - cash: Bank accounts (1000-series category='Bank') — the thing being reconciled
    - pl: P&L accounts (Revenue/COGS/Expense/Other) — captured via Net Income
    - investing: Fixed-asset purchases/sales (category='Fixed Asset')
    - financing: Long-term debt + Equity contributions/distributions (excludes RE & IC)
    - operating: Everything else (AR, AP, current liabilities, inventory…)
    """
    t = account.get("account_type")
    cat = (account.get("category") or "")
    num = (account.get("account_number") or "")
    if cat == "Bank":
        return "cash"
    if t in ("Revenue", "COGS", "Expense", "Other"):
        return "pl"
    if cat in ("Fixed Asset", "Contra-Fixed"):
        # Contra-Fixed (accumulated depreciation) handled implicitly via depreciation add-back
        return "skip" if cat == "Contra-Fixed" else "investing"
    if t == "Liability":
        # 2500+ numbered liabilities = long-term debt → financing (excl. IC 2900)
        if num and num >= "2500" and num != "2900":
            return "financing"
        return "operating"
    if t == "Equity":
        # 3100 Retained Earnings is rolled into Net Income — skip
        if num == "3100":
            return "skip"
        return "financing"
    # Default Asset (AR, Inventory, WIP, IC Receivable etc.)
    return "operating"


async def report_cash_flow(db, entity_id: str, date_from: Optional[str], date_to: Optional[str]) -> dict:
    """Indirect-method Cash Flow Statement for an entity over a date range.

    Sections:
      • Operating  = Net Income + Depreciation add-back ± Δ non-cash working capital
      • Investing  = − Δ Fixed Assets (purchases out, sales in)
      • Financing  = + Δ Long-term liabilities + Δ Equity contributions − Δ Distributions

    Reconciliation: (Operating + Investing + Financing) should equal Δ Cash
    (sum of period activity on all category='Bank' accounts).
    """
    # 1) Get full COA so we can classify each account
    accounts = []
    async for a in db.chart_of_accounts.find({"entity_id": entity_id}, {"_id": 0}):
        accounts.append(a)
    acct_by_id = {a["id"]: a for a in accounts}

    # 2) Period activity (debit/credit totals per account during [date_from, date_to])
    activity_rows = await _account_balances(db, entity_id, date_from=date_from, date_to=date_to)

    # 3) Compute Net Income from period activity on Revenue/COGS/Expense/Other
    rev = cogs = opex = other = 0.0
    depreciation = 0.0
    for r in activity_rows:
        t = r["account_type"]
        nb = _natural_balance(t, r["debit"], r["credit"])
        if t == "Revenue":
            rev += nb
        elif t == "COGS":
            cogs += nb
        elif t == "Expense":
            opex += nb
            # Depreciation expense (6600) is non-cash; track for add-back
            if (r.get("account_number") or "") == "6600":
                depreciation += nb
        elif t == "Other":
            other += nb
    net_income = round(rev - cogs - opex + other, 2)

    # 4) Walk each Asset/Liability/Equity account and bucket its period delta
    operating_items = []  # working-capital deltas
    investing_items = []
    financing_items = []

    for r in activity_rows:
        acct_id = r["account_id"]
        acct = acct_by_id.get(acct_id) or {}
        acct_for_class = {**acct, "account_type": r.get("account_type"), "account_number": r.get("account_number")}
        section = _cf_classify(acct_for_class)
        if section in ("pl", "cash", "skip"):
            continue
        nb_change = _natural_balance(r["account_type"], r["debit"], r["credit"])
        # Cash impact direction:
        # - Asset increase (positive nb) consumes cash → negate
        # - Liability/Equity increase (positive nb) provides cash → keep sign
        if r["account_type"] == "Asset":
            cash_impact = round(-nb_change, 2)
        else:
            cash_impact = round(nb_change, 2)
        if abs(cash_impact) < 0.005:
            continue
        item = {
            "account_id": acct_id,
            "account_number": r["account_number"],
            "account_name": r["account_name"],
            "account_type": r["account_type"],
            "delta": round(nb_change, 2),
            "cash_impact": cash_impact,
        }
        if section == "operating":
            operating_items.append(item)
        elif section == "investing":
            investing_items.append(item)
        elif section == "financing":
            financing_items.append(item)

    for lst in (operating_items, investing_items, financing_items):
        lst.sort(key=lambda x: x.get("account_number") or "")

    # 5) Totals
    operating_wc = round(sum(i["cash_impact"] for i in operating_items), 2)
    operating_total = round(net_income + depreciation + operating_wc, 2)
    investing_total = round(sum(i["cash_impact"] for i in investing_items), 2)
    financing_total = round(sum(i["cash_impact"] for i in financing_items), 2)
    net_change_in_cash = round(operating_total + investing_total + financing_total, 2)

    # 6) Reconciliation: actual cash balance at date_from-1 vs date_to
    # Sum all Bank-category accounts' natural balance
    async def _cash_balance(as_of: Optional[str]) -> float:
        rows = await _account_balances(db, entity_id, date_to=as_of)
        total = 0.0
        for rr in rows:
            acct = acct_by_id.get(rr["account_id"]) or {}
            if (acct.get("category") or "") == "Bank":
                total += _natural_balance(rr["account_type"], rr["debit"], rr["credit"])
        return round(total, 2)

    # Beginning cash = balance as of day before date_from (or 0 if no date_from)
    beginning_cash = 0.0
    if date_from:
        try:
            d = datetime.fromisoformat(date_from[:10]).date()
            prev = (d - timedelta(days=1)).isoformat()
            beginning_cash = await _cash_balance(prev)
        except Exception:
            beginning_cash = 0.0
    ending_cash = await _cash_balance(date_to) if date_to else beginning_cash
    actual_cash_change = round(ending_cash - beginning_cash, 2)
    reconciliation_diff = round(actual_cash_change - net_change_in_cash, 2)

    return {
        "entity_id": entity_id,
        "date_from": date_from,
        "date_to": date_to,
        "operating": {
            "net_income": net_income,
            "depreciation": round(depreciation, 2),
            "working_capital_items": operating_items,
            "working_capital_total": operating_wc,
            "total": operating_total,
        },
        "investing": {
            "items": investing_items,
            "total": investing_total,
        },
        "financing": {
            "items": financing_items,
            "total": financing_total,
        },
        "totals": {
            "net_change_in_cash": net_change_in_cash,
            "beginning_cash": beginning_cash,
            "ending_cash": ending_cash,
            "actual_cash_change": actual_cash_change,
            "reconciliation_diff": reconciliation_diff,
            "reconciled": abs(reconciliation_diff) < 0.01,
        },
    }


# ---------- Late-Fee Accrual Batch ----------

LATE_FEE_MONTHLY_RATE = 0.015  # 1.5% per month (18% APR) — DEFAULT FALLBACK ONLY. See resolve_late_fee_rate().
LATE_FEE_GRACE_DAYS = 30
LATE_FEE_REVENUE_ACCT = "4200"
LATE_FEE_AR_ACCT = "1100"


def resolve_late_fee_rate(entity: Optional[dict], customer: Optional[dict]) -> float:
    """Resolve the monthly late-fee rate (as a decimal, e.g. 0.015 for 1.5%) for a given
    customer-on-entity pairing. Precedence:
      1. customer.late_fee_rate_pct (per-customer override)
      2. entity.late_fee_rate_pct (entity default)
      3. Global fallback (1.5%)
    Values are stored as PERCENT (1.5 == 1.5%); this helper returns DECIMAL."""
    for src in (customer, entity):
        if not src:
            continue
        v = src.get("late_fee_rate_pct")
        if v is None:
            continue
        try:
            pct = float(v)
        except (TypeError, ValueError):
            continue
        if pct < 0:
            continue
        return round(pct / 100.0, 6)
    return LATE_FEE_MONTHLY_RATE


def resolve_late_fee_rate_pct(entity: Optional[dict], customer: Optional[dict]) -> float:
    """Same as resolve_late_fee_rate but returns PERCENT (e.g. 1.5) — for display strings."""
    return round(resolve_late_fee_rate(entity, customer) * 100.0, 4)


def _days_between(d1: str, d2: str) -> int:
    try:
        a = datetime.fromisoformat(d1[:10])
        b = datetime.fromisoformat(d2[:10])
        return (b - a).days
    except Exception:
        return 0


async def accrue_late_fees(
    db,
    *,
    entity_id: Optional[str] = None,
    as_of: Optional[str] = None,
    posted_by_user_id: Optional[str] = None,
) -> dict:
    """Walk eligible unpaid invoices and post a 1.5% monthly late-fee accrual journal per invoice.

    - Eligible: invoice has entity_id, status != Void/Draft, balance_due > 0, days_overdue > 30
    - Per-invoice fee = balance_due * 1.5% (one month's worth)
    - Idempotent on posting_key `late_fee:{invoice_id}:{YYYY-MM}` — re-running same month overwrites
    """
    today_str = as_of or datetime.now(timezone.utc).date().isoformat()
    period = today_str[:7]  # YYYY-MM

    q: dict = {
        "is_deleted": {"$ne": True},
        "entity_id": {"$exists": True, "$nin": [None, ""]},
    }
    if entity_id:
        q["entity_id"] = entity_id

    accrued_invoices = 0
    accrued_total = 0.0
    skipped = 0
    entities_touched = set()
    entity_cache: dict = {}
    customer_cache: dict = {}

    async for inv in db.invoices.find(q):
        status = (inv.get("status") or "").lower()
        if status in ("void", "draft"):
            skipped += 1
            continue
        balance = round(float(inv.get("balance_due") or (float(inv.get("total") or 0) - float(inv.get("amount_paid") or 0))), 2)
        if balance <= 0:
            skipped += 1
            continue
        due_date = inv.get("due_date") or inv.get("invoice_date")
        if not due_date:
            skipped += 1
            continue
        days_overdue = _days_between(due_date, today_str)
        if days_overdue <= LATE_FEE_GRACE_DAYS:
            skipped += 1
            continue
        ent = inv["entity_id"]
        # Resolve per-invoice rate: customer override → entity default → global 1.5%
        if ent not in entity_cache:
            entity_cache[ent] = await db.entities.find_one({"id": ent}, {"_id": 0, "late_fee_rate_pct": 1}) or {}
        cust_id = inv.get("bill_to_contact_id") or inv.get("contact_id")
        cust_doc = None
        if cust_id:
            if cust_id not in customer_cache:
                customer_cache[cust_id] = await db.contacts.find_one({"id": cust_id}, {"_id": 0, "late_fee_rate_pct": 1}) or {}
            cust_doc = customer_cache[cust_id]
        rate = resolve_late_fee_rate(entity_cache[ent], cust_doc)
        rate_pct_str = f"{rate * 100:.2f}".rstrip("0").rstrip(".")
        fee = round(balance * rate, 2)
        if fee <= 0:
            skipped += 1
            continue
        entities_touched.add(ent)
        lines = [
            await _build_line(db, ent, LATE_FEE_AR_ACCT, debit=fee, credit=0, memo=f"Late fee — Invoice {inv.get('invoice_number','')}"),
            await _build_line(db, ent, LATE_FEE_REVENUE_ACCT, debit=0, credit=fee, memo=f"{rate_pct_str}% late fee accrual ({period})"),
        ]
        memo = f"Late-fee accrual {period} · Invoice {inv.get('invoice_number','')} · {days_overdue}d overdue · balance ${balance:,.2f} · rate {rate_pct_str}%"
        # idempotent: source_type='invoice', source_id=inv['id'], kind=f"late_fee:{period}"
        posted = await post_journal(
            db,
            entity_id=ent,
            source_type="invoice",
            source_id=inv["id"],
            kind=f"late_fee:{period}",
            lines=lines,
            memo=memo,
            posting_date=today_str,
            posted_by_user_id=posted_by_user_id,
        )
        if posted:
            accrued_invoices += 1
            accrued_total += fee
    return {
        "as_of": today_str,
        "period": period,
        "entities_touched": len(entities_touched),
        "invoices_accrued": accrued_invoices,
        "invoices_skipped": skipped,
        "total_late_fees": round(accrued_total, 2),
    }


# ---------- Inter-Company Reconciliation ----------

async def inter_company_report(db) -> dict:
    """Pivot journal_entries by (entity_id, counter_entity_id) for IC accounts 1900 & 2900.
    For each A↔B pair: A's 1900-receivable should match B's 2900-payable (and vice versa)."""
    name_by_id = {}
    async for e in db.entities.find({"is_active": True}, {"_id": 0, "id": 1, "name": 1}):
        name_by_id[e["id"]] = e["name"]

    pipeline = [
        {"$match": {"is_reversed": {"$ne": True}, "is_inter_company": True}},
        {"$unwind": "$lines"},
        {"$match": {"lines.account_number": {"$in": ["1900", "2900"]}}},
        {"$group": {
            "_id": {
                "entity_id": "$entity_id",
                "counter_entity_id": "$counter_entity_id",
                "account_number": "$lines.account_number",
            },
            "debit": {"$sum": "$lines.debit"},
            "credit": {"$sum": "$lines.credit"},
        }},
    ]
    raw = {}
    async for r in db.journal_entries.aggregate(pipeline):
        k = (r["_id"]["entity_id"], r["_id"]["counter_entity_id"], r["_id"]["account_number"])
        raw[k] = (round(float(r["debit"]), 2), round(float(r["credit"]), 2))

    seen_pairs = set()
    rows = []
    total_out = 0.0
    for (eid, cid, _acct), (_d, _c) in raw.items():
        if not cid:
            continue
        pair = tuple(sorted([eid, cid]))
        if pair in seen_pairs:
            continue
        seen_pairs.add(pair)
        a, b = pair
        a_1900 = raw.get((a, b, "1900"), (0, 0))
        a_2900 = raw.get((a, b, "2900"), (0, 0))
        b_1900 = raw.get((b, a, "1900"), (0, 0))
        b_2900 = raw.get((b, a, "2900"), (0, 0))
        a_receivable = round(a_1900[0] - a_1900[1], 2)
        a_payable = round(a_2900[1] - a_2900[0], 2)
        b_receivable = round(b_1900[0] - b_1900[1], 2)
        b_payable = round(b_2900[1] - b_2900[0], 2)
        diff_recv = round(a_receivable - b_payable, 2)
        diff_payable = round(a_payable - b_receivable, 2)
        rows.append({
            "entity_a_id": a, "entity_a_name": name_by_id.get(a, a),
            "entity_b_id": b, "entity_b_name": name_by_id.get(b, b),
            "a_receivable_from_b": a_receivable, "b_payable_to_a": b_payable,
            "diff_recv_vs_payable": diff_recv,
            "a_payable_to_b": a_payable, "b_receivable_from_a": b_receivable,
            "diff_payable_vs_recv": diff_payable,
            "balanced": abs(diff_recv) < 0.01 and abs(diff_payable) < 0.01,
        })
        total_out += abs(diff_recv) + abs(diff_payable)

    rows.sort(key=lambda r: (r["entity_a_name"], r["entity_b_name"]))
    return {
        "as_of": datetime.now(timezone.utc).date().isoformat(),
        "rows": rows,
        "total_out_of_balance": round(total_out, 2),
        "all_balanced": total_out < 0.01,
    }


# ============================================================
# Aging Reports — A/R and A/P
# ============================================================
async def _build_aging(
    db,
    *,
    collection: str,                        # "invoices" or "vendor_bills"
    entity_id: str,
    as_of: Optional[str],
    group_label_key: str,                   # field on the doc to group by (customer or vendor name)
    fallback_key: Optional[str] = None,     # secondary field if group_label_key missing
) -> dict:
    """Generic aging-report builder. Buckets: current (not yet due), 1-30, 31-60, 61-90, 90+."""
    as_of_date = (
        datetime.strptime((as_of or "")[:10], "%Y-%m-%d").date()
        if as_of else datetime.now(timezone.utc).date()
    )

    q = {
        "entity_id": entity_id,
        "is_deleted": {"$ne": True},
        "status": {"$nin": ["Draft", "Void"]},
        # Exclude inter-company — those live on their own books and confuse normal AR/AP
        "$or": [{"counter_entity_id": None}, {"counter_entity_id": ""}, {"counter_entity_id": {"$exists": False}}],
    }
    docs = await db[collection].find(q, {"_id": 0}).to_list(50000)

    buckets_blank = {"current": 0.0, "b1_30": 0.0, "b31_60": 0.0, "b61_90": 0.0, "b90_plus": 0.0}
    groups: dict[str, dict] = {}
    totals = {**buckets_blank, "balance": 0.0, "count": 0}

    for d in docs:
        balance = float(d.get("balance_due") or 0.0)
        if balance <= 0.01:
            # Fall back to total - paid in case balance_due not maintained
            try:
                balance = round(float(d.get("total") or 0) - float(d.get("amount_paid") or 0), 2)
            except (TypeError, ValueError):
                balance = 0.0
            if balance <= 0.01:
                continue

        due_raw = (d.get("due_date") or d.get("invoice_date") or d.get("bill_date") or "")[:10]
        try:
            due = datetime.strptime(due_raw, "%Y-%m-%d").date()
        except (ValueError, TypeError):
            # Treat undated as "due today" so it still surfaces in the report
            due = as_of_date
        days_past = (as_of_date - due).days

        if days_past < 0:
            bucket = "current"
        elif days_past <= 30:
            bucket = "b1_30"
        elif days_past <= 60:
            bucket = "b31_60"
        elif days_past <= 90:
            bucket = "b61_90"
        else:
            bucket = "b90_plus"

        label = (d.get(group_label_key) or "").strip()
        if not label and fallback_key:
            label = (d.get(fallback_key) or "").strip()
        if not label:
            label = "(Unspecified)"

        g = groups.setdefault(label, {"label": label, "balance": 0.0, "count": 0, **buckets_blank, "rows": []})
        g[bucket] = round(g[bucket] + balance, 2)
        g["balance"] = round(g["balance"] + balance, 2)
        g["count"] += 1
        g["rows"].append({
            "id": d.get("id"),
            "number": d.get("invoice_number") or d.get("bill_number") or "",
            "date": (d.get("invoice_date") or d.get("bill_date") or "")[:10],
            "due_date": due_raw,
            "days_past_due": days_past,
            "bucket": bucket,
            "balance": balance,
            "total": float(d.get("total") or 0),
            "amount_paid": float(d.get("amount_paid") or 0),
            "status": d.get("status") or "",
            "project_title": d.get("project_title") or "",
        })
        totals[bucket] = round(totals[bucket] + balance, 2)
        totals["balance"] = round(totals["balance"] + balance, 2)
        totals["count"] += 1

    # Sort: largest balance first; sort each group's rows by oldest due-date first
    rows = sorted(groups.values(), key=lambda g: -g["balance"])
    for g in rows:
        g["rows"].sort(key=lambda r: r.get("due_date") or "")

    return {
        "as_of": as_of_date.isoformat(),
        "entity_id": entity_id,
        "groups": rows,
        "totals": totals,
    }


async def report_ar_aging(db, entity_id: str, as_of: Optional[str] = None) -> dict:
    """Accounts Receivable aging — open invoices bucketed by days-past-due, grouped by customer."""
    return await _build_aging(
        db, collection="invoices", entity_id=entity_id, as_of=as_of,
        group_label_key="bill_to_company", fallback_key="bill_to_name",
    )


async def report_ap_aging(db, entity_id: str, as_of: Optional[str] = None) -> dict:
    """Accounts Payable aging — open vendor bills bucketed by days-past-due, grouped by vendor."""
    return await _build_aging(
        db, collection="vendor_bills", entity_id=entity_id, as_of=as_of,
        group_label_key="vendor_name", fallback_key="vendor",
    )
