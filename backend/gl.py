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
from datetime import datetime, timezone


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
    """Decide between 5010 Subcontractor Labor and 5000 Materials Direct."""
    kind = ""
    if vendor:
        kind = (vendor.get("kind") or "").lower()
    if kind == "subcontractor":
        return "5010"
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
) -> Optional[dict]:
    """Idempotent upsert of one journal entry. Returns the stored doc (or None if no valid lines)."""
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
    posting_key = f"{source_type}:{source_id}:{kind}"
    now_iso = datetime.now(timezone.utc).isoformat()
    doc = {
        "entity_id": entity_id,
        "source_type": source_type,
        "source_id": source_id,
        "kind": kind,
        "posting_key": posting_key,
        "date": posting_date or datetime.now(timezone.utc).date().isoformat(),
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
    """DR 1100 AR / CR 4xxx Sales (account chosen by roof type)."""
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
        return None
    deal = None
    if invoice.get("deal_id"):
        deal = await db.deals.find_one({"id": invoice["deal_id"]}, {"_id": 0})
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
    """DR 1000 Bank / CR 1100 AR — total amount_paid (idempotent overwrite)."""
    ent = invoice.get("entity_id")
    if not ent:
        return None
    paid = round(float(invoice.get("amount_paid") or 0), 2)
    if paid <= 0:
        # No payment — make sure any previous payment journal is wiped
        await reverse_journals(db, source_type="invoice", source_id=invoice["id"], kind="payment")
        return None
    lines = [
        await _build_line(db, ent, "1000", debit=paid, credit=0, memo=f"Payment received — Invoice {invoice.get('invoice_number','')}"),
        await _build_line(db, ent, "1100", debit=0, credit=paid, memo=f"Apply to A/R — Invoice {invoice.get('invoice_number','')}"),
    ]
    memo = f"Payment — Invoice {invoice.get('invoice_number','')} ({invoice.get('payment_method') or 'cash/ck'})"
    return await post_journal(
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


async def post_bill_received(db, bill: dict, posted_by_user_id: Optional[str] = None):
    """DR 5000 Materials (or 5010 Sub Labor) / CR 2000 AP."""
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
        return None
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
    """DR 2000 AP / CR 1000 Bank — total paid amount (idempotent)."""
    ent = bill.get("entity_id")
    if not ent:
        return None
    paid = round(float(bill.get("paid_amount") or 0), 2)
    if paid <= 0:
        await reverse_journals(db, source_type="vendor_bill", source_id=bill["id"], kind="bill_payment")
        return None
    lines = [
        await _build_line(db, ent, "2000", debit=paid, credit=0, memo=f"Paid — Bill {bill.get('bill_number','')}"),
        await _build_line(db, ent, "1000", debit=0, credit=paid, memo=f"Bank disbursement — {bill.get('vendor_name','')}"),
    ]
    memo = f"Bill payment — {bill.get('vendor_name','')} ({bill.get('paid_method') or 'cash/ck'})"
    return await post_journal(
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


# ---------- Late-Fee Accrual Batch ----------

LATE_FEE_MONTHLY_RATE = 0.015  # 1.5% per month (18% APR)
LATE_FEE_GRACE_DAYS = 30
LATE_FEE_REVENUE_ACCT = "4200"
LATE_FEE_AR_ACCT = "1100"


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
        fee = round(balance * LATE_FEE_MONTHLY_RATE, 2)
        if fee <= 0:
            skipped += 1
            continue
        ent = inv["entity_id"]
        entities_touched.add(ent)
        lines = [
            await _build_line(db, ent, LATE_FEE_AR_ACCT, debit=fee, credit=0, memo=f"Late fee — Invoice {inv.get('invoice_number','')}"),
            await _build_line(db, ent, LATE_FEE_REVENUE_ACCT, debit=0, credit=fee, memo=f"1.5% late fee accrual ({period})"),
        ]
        memo = f"Late-fee accrual {period} · Invoice {inv.get('invoice_number','')} · {days_overdue}d overdue · balance ${balance:,.2f}"
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
