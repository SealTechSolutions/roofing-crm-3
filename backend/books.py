"""SealTech Books module — multi-entity Chart of Accounts foundation.

Phase 1 deliverable: Entities + Chart of Accounts only. Auto-journal hooks
(Invoice → GL, Bill → GL, etc.) come in Phase 2.

Exposes a factory `make_router(db, get_current_user, require_admin)` that
returns a FastAPI APIRouter mounted under /api/books in server.py.
"""
from typing import Optional, List
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict


ACCOUNT_TYPES = ["Asset", "Liability", "Equity", "Revenue", "COGS", "Expense", "Other"]


# Default Chart of Accounts seeded for every new entity (matches the design sketch).
DEFAULT_COA = [
    # 1000s — Assets
    {"number": "1000", "name": "Bank — Operating Checking", "type": "Asset", "category": "Bank"},
    {"number": "1010", "name": "Bank — Payroll Checking", "type": "Asset", "category": "Bank"},
    {"number": "1020", "name": "Bank — Savings / Reserves", "type": "Asset", "category": "Bank"},
    {"number": "1100", "name": "Accounts Receivable", "type": "Asset", "category": "AR", "system": True},
    {"number": "1150", "name": "Allowance for Doubtful Accounts", "type": "Asset", "category": "Contra-AR", "is_contra": True},
    {"number": "1200", "name": "Materials Inventory", "type": "Asset", "category": "Inventory"},
    {"number": "1250", "name": "Work-In-Progress (WIP)", "type": "Asset", "category": "Inventory"},
    {"number": "1500", "name": "Trucks & Equipment", "type": "Asset", "category": "Fixed Asset"},
    {"number": "1510", "name": "Accumulated Depreciation", "type": "Asset", "category": "Contra-Fixed", "is_contra": True},
    {"number": "1900", "name": "Inter-Company Receivable", "type": "Asset", "category": "Inter-Co", "system": True},
    # 2000s — Liabilities
    {"number": "2000", "name": "Accounts Payable", "type": "Liability", "category": "AP", "system": True},
    {"number": "2050", "name": "Credit Card — Operating", "type": "Liability", "category": "Credit Card"},
    {"number": "2100", "name": "Customer Deposits", "type": "Liability", "category": "Deferred Revenue", "system": True},
    {"number": "2150", "name": "Sales Tax Payable", "type": "Liability", "category": "Tax"},
    {"number": "2200", "name": "Payroll Liabilities", "type": "Liability", "category": "Payroll"},
    {"number": "2900", "name": "Inter-Company Payable", "type": "Liability", "category": "Inter-Co", "system": True},
    # 3000s — Equity
    {"number": "3000", "name": "Owner's Capital", "type": "Equity", "category": "Equity"},
    {"number": "3100", "name": "Retained Earnings", "type": "Equity", "category": "Equity", "system": True},
    {"number": "3900", "name": "Distributions", "type": "Equity", "category": "Equity"},
    # 4000s — Revenue
    {"number": "4000", "name": "Roofing Revenue — Restoration (Silicone)", "type": "Revenue", "category": "Sales", "system": True},
    {"number": "4010", "name": "Roofing Revenue — Re-Roof / Replacement", "type": "Revenue", "category": "Sales", "system": True},
    {"number": "4020", "name": "Roofing Revenue — New Construction", "type": "Revenue", "category": "Sales", "system": True},
    {"number": "4030", "name": "Roofing Revenue — FARM", "type": "Revenue", "category": "Sales", "system": True},
    {"number": "4100", "name": "Maintenance Plan Revenue", "type": "Revenue", "category": "Sales", "system": True},
    {"number": "4150", "name": "Change Order Revenue", "type": "Revenue", "category": "Sales"},
    {"number": "4200", "name": "Late Fees Earned", "type": "Revenue", "category": "Other Income", "system": True},
    {"number": "4900", "name": "Inter-Company Revenue", "type": "Revenue", "category": "Inter-Co", "system": True},
    # 5000s — COGS
    {"number": "5000", "name": "Materials — Direct", "type": "COGS", "category": "Job Cost", "system": True},
    {"number": "5010", "name": "Subcontractor Labor", "type": "COGS", "category": "Job Cost", "system": True},
    {"number": "5020", "name": "Equipment Rental", "type": "COGS", "category": "Job Cost"},
    {"number": "5030", "name": "Direct Labor / Crew Wages", "type": "COGS", "category": "Job Cost"},
    {"number": "5040", "name": "Job Supplies", "type": "COGS", "category": "Job Cost"},
    {"number": "5050", "name": "Permits & Inspections", "type": "COGS", "category": "Job Cost"},
    # 6000s — Operating Expense
    {"number": "6000", "name": "Rent — Office / Yard", "type": "Expense", "category": "Facilities"},
    {"number": "6100", "name": "Vehicle — Fuel", "type": "Expense", "category": "Vehicle"},
    {"number": "6110", "name": "Vehicle — Repairs", "type": "Expense", "category": "Vehicle"},
    {"number": "6200", "name": "Insurance — General Liability", "type": "Expense", "category": "Insurance"},
    {"number": "6210", "name": "Insurance — Workers Comp", "type": "Expense", "category": "Insurance"},
    {"number": "6300", "name": "Office & Admin", "type": "Expense", "category": "Office"},
    {"number": "6400", "name": "Sales Commissions", "type": "Expense", "category": "Sales"},
    {"number": "6500", "name": "Marketing & Advertising", "type": "Expense", "category": "Marketing"},
    {"number": "6600", "name": "Depreciation Expense", "type": "Expense", "category": "Depreciation", "system": True},
    {"number": "6700", "name": "Inter-Company Expense", "type": "Expense", "category": "Inter-Co", "system": True},
    {"number": "6900", "name": "Bank / Credit Card Fees", "type": "Expense", "category": "Bank Fees"},
    # 9000s — Other
    {"number": "9000", "name": "Interest Income / Expense", "type": "Other", "category": "Other"},
    {"number": "9100", "name": "Gain/Loss on Asset Sale", "type": "Other", "category": "Other"},
]


# Default 4 SealTech entities seeded on first boot.
DEFAULT_ENTITIES = [
    {
        "name": "SealTech Holdings",
        "legal_name": "SealTech Holdings, LLC",
        "role": "Parent",
        "is_parent": True,
        "entity_type": "LLC",
    },
    {
        "name": "Western States Contracting Services",
        "legal_name": "Western States Contracting Services, Inc.",
        "role": "Operations / Labor",
        "is_parent": False,
        "entity_type": "C-Corp",
    },
    {
        "name": "SLO & Steady, LLC",
        "legal_name": "SLO & Steady, LLC",
        "role": "Real Estate Holding",
        "is_parent": False,
        "entity_type": "LLC",
    },
    {
        "name": "Darren Oliver, LLC",
        "legal_name": "Darren Oliver, LLC",
        "role": "Sales / Commissions",
        "is_parent": False,
        "entity_type": "LLC",
    },
]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class EntityIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str
    legal_name: str = ""
    role: str = ""
    entity_type: str = ""  # LLC, C-Corp, S-Corp, Sole Prop
    is_parent: bool = False
    tax_id: str = ""
    tax_id_kind: str = "EIN"  # "EIN" | "SSN"
    address: str = ""
    city: str = ""
    state: str = ""
    zip_code: str = ""
    email: str = ""
    phone: str = ""
    remit_to_address: str = ""
    monthly_depreciation: float = 0.0  # Posted during month-end close: DR 6600 / CR 1510
    lock_through: str = ""  # ISO date — last day of most recent closed period; managed by period-close logic
    is_active: bool = True


class AccountIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    entity_id: str
    number: str
    name: str
    type: str
    category: str = ""
    description: str = ""
    is_contra: bool = False
    is_active: bool = True


class ManualJournalLineIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    account_id: str
    debit: float = 0.0
    credit: float = 0.0
    memo: str = ""


class ManualJournalIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    entity_id: str
    date: str  # ISO YYYY-MM-DD posting date
    memo: str = ""
    lines: List[ManualJournalLineIn]


def _clean(doc: dict) -> dict:
    """Strip Mongo _id from outgoing docs."""
    if not doc:
        return doc
    doc.pop("_id", None)
    return doc


async def seed_default_coa_for_entity(db, entity_id: str) -> int:
    """Insert the DEFAULT_COA into chart_of_accounts for `entity_id` (idempotent)."""
    existing_numbers = set()
    async for a in db.chart_of_accounts.find({"entity_id": entity_id}, {"number": 1}):
        existing_numbers.add(a.get("number"))
    inserted = 0
    for tpl in DEFAULT_COA:
        if tpl["number"] in existing_numbers:
            continue
        await db.chart_of_accounts.insert_one({
            "id": str(uuid.uuid4()),
            "entity_id": entity_id,
            "number": tpl["number"],
            "name": tpl["name"],
            "type": tpl["type"],
            "category": tpl.get("category", ""),
            "description": "",
            "is_contra": tpl.get("is_contra", False),
            "system": tpl.get("system", False),
            "is_active": True,
            "created_at": _now_iso(),
        })
        inserted += 1
    return inserted


async def seed_default_entities(db) -> None:
    """On first boot, create the 4 SealTech entities + their COA. Idempotent."""
    await db.entities.create_index("id", unique=True)
    await db.chart_of_accounts.create_index("id", unique=True)
    await db.chart_of_accounts.create_index([("entity_id", 1), ("number", 1)], unique=True)

    for tpl in DEFAULT_ENTITIES:
        existing = await db.entities.find_one({"name": tpl["name"]})
        if existing:
            # ensure COA still seeded for existing entity
            await seed_default_coa_for_entity(db, existing["id"])
            continue
        ent_id = str(uuid.uuid4())
        await db.entities.insert_one({
            "id": ent_id,
            "name": tpl["name"],
            "legal_name": tpl.get("legal_name", ""),
            "role": tpl.get("role", ""),
            "entity_type": tpl.get("entity_type", ""),
            "is_parent": tpl.get("is_parent", False),
            "tax_id": "",
            "address": "",
            "city": "",
            "state": "",
            "zip_code": "",
            "email": "",
            "phone": "",
            "remit_to_address": "",
            "is_active": True,
            "created_at": _now_iso(),
        })
        await seed_default_coa_for_entity(db, ent_id)


def make_router(db, get_current_user, require_admin) -> APIRouter:
    """Build the Books APIRouter with dependencies injected."""
    router = APIRouter(prefix="/books", tags=["books"])

    # ---------- Entities ----------
    @router.get("/entities")
    async def list_entities(include_inactive: bool = False, current=Depends(get_current_user)):
        q = {} if include_inactive else {"is_active": True}
        out = []
        async for e in db.entities.find(q).sort([("is_parent", -1), ("name", 1)]):
            out.append(_clean(e))
        return out

    @router.post("/entities")
    async def create_entity(body: EntityIn, current=Depends(require_admin)):
        existing = await db.entities.find_one({"name": body.name})
        if existing:
            raise HTTPException(status_code=400, detail=f"Entity '{body.name}' already exists")
        ent_id = str(uuid.uuid4())
        doc = {"id": ent_id, **body.model_dump(), "created_at": _now_iso()}
        await db.entities.insert_one(doc)
        await seed_default_coa_for_entity(db, ent_id)
        return _clean(doc)

    @router.get("/entities/{entity_id}")
    async def get_entity(entity_id: str, current=Depends(get_current_user)):
        e = await db.entities.find_one({"id": entity_id})
        if not e:
            raise HTTPException(status_code=404, detail="Entity not found")
        return _clean(e)

    @router.put("/entities/{entity_id}")
    async def update_entity(entity_id: str, body: EntityIn, current=Depends(require_admin)):
        e = await db.entities.find_one({"id": entity_id})
        if not e:
            raise HTTPException(status_code=404, detail="Entity not found")
        update = body.model_dump()
        # Never silently reactivate a deactivated entity via plain edit — preserve current is_active
        update["is_active"] = e.get("is_active", True)
        # lock_through is system-managed by period-close — never editable through Entity form
        update["lock_through"] = e.get("lock_through", "")
        await db.entities.update_one({"id": entity_id}, {"$set": update})
        merged = {**e, **update}
        return _clean(merged)

    @router.delete("/entities/{entity_id}")
    async def delete_entity(entity_id: str, current=Depends(require_admin)):
        e = await db.entities.find_one({"id": entity_id})
        if not e:
            raise HTTPException(status_code=404, detail="Entity not found")
        if e.get("is_parent"):
            raise HTTPException(status_code=400, detail="Cannot deactivate the parent entity")
        await db.entities.update_one({"id": entity_id}, {"$set": {"is_active": False}})
        return {"ok": True}

    # ---------- Accounts ----------
    @router.get("/accounts")
    async def list_accounts(entity_id: str, include_inactive: bool = False, current=Depends(get_current_user)):
        q: dict = {"entity_id": entity_id}
        if not include_inactive:
            q["is_active"] = True
        out = []
        async for a in db.chart_of_accounts.find(q).sort("number", 1):
            out.append(_clean(a))
        return out

    @router.post("/accounts")
    async def create_account(body: AccountIn, current=Depends(require_admin)):
        if body.type not in ACCOUNT_TYPES:
            raise HTTPException(status_code=400, detail=f"type must be one of {ACCOUNT_TYPES}")
        ent = await db.entities.find_one({"id": body.entity_id})
        if not ent:
            raise HTTPException(status_code=404, detail="Entity not found")
        dup = await db.chart_of_accounts.find_one({"entity_id": body.entity_id, "number": body.number})
        if dup:
            raise HTTPException(status_code=400, detail=f"Account number {body.number} already exists for this entity")
        doc = {
            "id": str(uuid.uuid4()),
            **body.model_dump(),
            "system": False,
            "created_at": _now_iso(),
        }
        await db.chart_of_accounts.insert_one(doc)
        return _clean(doc)

    @router.put("/accounts/{account_id}")
    async def update_account(account_id: str, body: AccountIn, current=Depends(require_admin)):
        if body.type not in ACCOUNT_TYPES:
            raise HTTPException(status_code=400, detail=f"type must be one of {ACCOUNT_TYPES}")
        existing = await db.chart_of_accounts.find_one({"id": account_id})
        if not existing:
            raise HTTPException(status_code=404, detail="Account not found")
        # System accounts: allow rename/description/category but lock number+type+is_contra
        update = body.model_dump()
        # entity_id is immutable — cannot move an account between entities (would corrupt ledgers)
        update["entity_id"] = existing["entity_id"]
        if existing.get("system"):
            update["number"] = existing["number"]
            update["type"] = existing["type"]
            update["is_contra"] = existing.get("is_contra", False)
        else:
            # number-uniqueness check if number changed
            if update["number"] != existing.get("number"):
                dup = await db.chart_of_accounts.find_one({
                    "entity_id": update["entity_id"], "number": update["number"], "id": {"$ne": account_id}
                })
                if dup:
                    raise HTTPException(status_code=400, detail=f"Account number {update['number']} already exists for this entity")
        await db.chart_of_accounts.update_one({"id": account_id}, {"$set": update})
        merged = {**existing, **update}
        return _clean(merged)

    @router.delete("/accounts/{account_id}")
    async def delete_account(account_id: str, current=Depends(require_admin)):
        existing = await db.chart_of_accounts.find_one({"id": account_id})
        if not existing:
            raise HTTPException(status_code=404, detail="Account not found")
        if existing.get("system"):
            raise HTTPException(status_code=400, detail="System accounts cannot be deleted (you may deactivate by editing instead)")
        await db.chart_of_accounts.update_one({"id": account_id}, {"$set": {"is_active": False}})
        return {"ok": True}

    @router.get("/account-types")
    async def get_account_types(current=Depends(get_current_user)):
        return {"types": ACCOUNT_TYPES}

    # ---------- Journal Entries (read-only feed) ----------
    @router.get("/journal-entries")
    async def list_journal_entries(
        entity_id: Optional[str] = None,
        account_id: Optional[str] = None,
        account_number: Optional[str] = None,
        source_id: Optional[str] = None,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
        limit: int = 100,
        include_reversed: bool = False,
        current=Depends(get_current_user),
    ):
        q: dict = {}
        if entity_id:
            q["entity_id"] = entity_id
        if source_id:
            q["source_id"] = source_id
        if date_from or date_to:
            q["date"] = {}
            if date_from:
                q["date"]["$gte"] = date_from
            if date_to:
                q["date"]["$lte"] = date_to
        if account_id:
            q["lines.account_id"] = account_id
        if account_number:
            q["lines.account_number"] = account_number
        if not include_reversed:
            q["is_reversed"] = {"$ne": True}
        out = []
        async for j in db.journal_entries.find(q).sort("date", -1).limit(max(1, min(500, limit))):
            out.append(_clean(j))
        return out

    # ---------- Manual Journal Entries (owner draws, year-end adjustments) ----------
    @router.post("/journal-entries/manual")
    async def create_manual_journal(body: ManualJournalIn, current=Depends(require_admin)):
        ent = await db.entities.find_one({"id": body.entity_id})
        if not ent:
            raise HTTPException(status_code=404, detail="Entity not found")
        if not ent.get("is_active", True):
            raise HTTPException(status_code=400, detail="Entity is inactive — cannot post journal")
        if not body.date or len(body.date) < 10:
            raise HTTPException(status_code=400, detail="Posting date is required (YYYY-MM-DD)")
        if not body.lines or len(body.lines) < 2:
            raise HTTPException(status_code=400, detail="At least 2 journal lines are required")

        # Period lock check (manual entries respect the lock — no bypass)
        lock = (ent.get("lock_through") or "").strip()
        if lock and body.date <= lock:
            raise HTTPException(
                status_code=400,
                detail=f"Period is locked through {lock}. Reopen the period before posting on {body.date}.",
            )

        # Build & validate lines
        built_lines = []
        total_debit = 0.0
        total_credit = 0.0
        for idx, ln in enumerate(body.lines):
            d = round(float(ln.debit or 0), 2)
            c = round(float(ln.credit or 0), 2)
            if d <= 0 and c <= 0:
                continue  # skip empty rows
            if d > 0 and c > 0:
                raise HTTPException(status_code=400, detail=f"Line {idx + 1}: a line cannot have both a debit and a credit")
            acct = await db.chart_of_accounts.find_one(
                {"id": ln.account_id, "entity_id": body.entity_id, "is_active": True}, {"_id": 0}
            )
            if not acct:
                raise HTTPException(status_code=400, detail=f"Line {idx + 1}: account not found or inactive for this entity")
            built_lines.append({
                "account_id": acct["id"],
                "account_number": acct["number"],
                "account_name": acct["name"],
                "account_type": acct["type"],
                "debit": d,
                "credit": c,
                "memo": ln.memo or "",
            })
            total_debit += d
            total_credit += c

        if len(built_lines) < 2:
            raise HTTPException(status_code=400, detail="At least 2 non-zero lines are required")
        if abs(round(total_debit - total_credit, 2)) > 0.01:
            raise HTTPException(
                status_code=400,
                detail=f"Journal does not balance: debits ${total_debit:,.2f} vs credits ${total_credit:,.2f}",
            )

        from gl import post_journal
        source_id = str(uuid.uuid4())
        doc = await post_journal(
            db,
            entity_id=body.entity_id,
            source_type="manual",
            source_id=source_id,
            kind="adjustment",
            lines=built_lines,
            memo=body.memo or "Manual adjustment",
            posting_date=body.date,
            posted_by_user_id=current.get("id"),
        )
        if not doc:
            raise HTTPException(status_code=500, detail="Failed to post journal entry")
        # Tag as manual for UI affordances (reverse button)
        await db.journal_entries.update_one(
            {"id": doc["id"]},
            {"$set": {"is_manual": True, "posted_by_name": current.get("name") or current.get("email", "")}},
        )
        doc["is_manual"] = True
        doc["posted_by_name"] = current.get("name") or current.get("email", "")
        return doc

    @router.post("/journal-entries/{journal_id}/reverse")
    async def reverse_manual_journal(journal_id: str, current=Depends(require_admin)):
        j = await db.journal_entries.find_one({"id": journal_id})
        if not j:
            raise HTTPException(status_code=404, detail="Journal entry not found")
        if j.get("source_type") != "manual":
            raise HTTPException(status_code=400, detail="Only manual journal entries can be reversed from the Activity feed")
        if j.get("is_reversed"):
            raise HTTPException(status_code=400, detail="Journal entry is already reversed")
        # Respect the period lock on the original entry's date
        ent = await db.entities.find_one({"id": j["entity_id"]}, {"_id": 0, "lock_through": 1})
        lock = ((ent or {}).get("lock_through") or "").strip()
        if lock and j.get("date", "") <= lock:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot reverse — original posting date {j.get('date')} is within locked period (through {lock}).",
            )
        now_iso = datetime.now(timezone.utc).isoformat()
        await db.journal_entries.update_one(
            {"id": journal_id},
            {"$set": {
                "is_reversed": True,
                "reversed_at": now_iso,
                "reversed_by_user_id": current.get("id"),
                "updated_at": now_iso,
            }},
        )
        return {"ok": True, "id": journal_id}

    # ---------- Reports / KPIs ----------
    @router.get("/reports/kpis")
    async def report_kpis(entity_id: str, current=Depends(get_current_user)):
        from gl import entity_kpis
        return await entity_kpis(db, entity_id)

    @router.get("/reports/kpis/all")
    async def report_kpis_all(current=Depends(get_current_user)):
        from gl import entity_kpis
        out = []
        async for e in db.entities.find({"is_active": True}).sort([("is_parent", -1), ("name", 1)]):
            kpi = await entity_kpis(db, e["id"])
            kpi["entity_name"] = e["name"]
            kpi["entity_role"] = e.get("role", "")
            kpi["is_parent"] = e.get("is_parent", False)
            out.append(kpi)
        return out

    @router.get("/reports/profit-loss")
    async def report_profit_loss_endpoint(
        entity_id: str,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
        current=Depends(get_current_user),
    ):
        from gl import report_profit_loss
        return await report_profit_loss(db, entity_id, date_from, date_to)

    @router.get("/reports/balance-sheet")
    async def report_balance_sheet_endpoint(
        entity_id: str,
        as_of: Optional[str] = None,
        current=Depends(get_current_user),
    ):
        from gl import report_balance_sheet
        return await report_balance_sheet(db, entity_id, as_of)

    # ---------- Late-Fee Accrual Batch ----------
    @router.post("/late-fees/accrue")
    async def late_fees_accrue(
        entity_id: Optional[str] = None,
        as_of: Optional[str] = None,
        current=Depends(require_admin),
    ):
        from gl import accrue_late_fees
        return await accrue_late_fees(db, entity_id=entity_id, as_of=as_of, posted_by_user_id=current.get("id"))

    # ---------- Period Close ----------
    @router.get("/period-close/list")
    async def period_close_list(entity_id: Optional[str] = None, current=Depends(get_current_user)):
        import period_close as pc
        return await pc.list_period_closes(db, entity_id=entity_id)

    @router.get("/period-close/preview")
    async def period_close_preview(entity_id: str, period: str, current=Depends(get_current_user)):
        import period_close as pc
        return await pc.preview_close(db, entity_id=entity_id, period=period)

    @router.post("/period-close/run")
    async def period_close_run(entity_id: str, period: str, current=Depends(require_admin)):
        import period_close as pc
        return await pc.run_close(db, entity_id=entity_id, period=period, posted_by=current.get("id"))

    @router.post("/period-close/reopen")
    async def period_close_reopen(entity_id: str, period: str, current=Depends(require_admin)):
        import period_close as pc
        return await pc.reopen_period(db, entity_id=entity_id, period=period, reopened_by=current.get("id"))

    # ---------- Inter-Company Reconciliation ----------
    @router.get("/reports/inter-company")
    async def inter_company_endpoint(current=Depends(get_current_user)):
        from gl import inter_company_report
        return await inter_company_report(db)

    # ---------- Bank Reconciliation ----------
    @router.get("/bank-rec/accounts")
    async def bank_rec_accounts(entity_id: str, current=Depends(get_current_user)):
        import bank_rec as br
        return await br.list_bank_accounts(db, entity_id)

    @router.get("/bank-rec/lines")
    async def bank_rec_lines(entity_id: str, account_id: str, date_to: Optional[str] = None, current=Depends(get_current_user)):
        import bank_rec as br
        return await br.list_lines_for_recon(db, entity_id=entity_id, account_id=account_id, date_to=date_to)

    @router.get("/bank-rec/list")
    async def bank_rec_list(entity_id: Optional[str] = None, current=Depends(get_current_user)):
        import bank_rec as br
        return await br.list_recs(db, entity_id=entity_id)

    @router.get("/bank-rec/{rec_id}")
    async def bank_rec_get(rec_id: str, current=Depends(get_current_user)):
        import bank_rec as br
        r = await br.get_rec(db, rec_id)
        if not r:
            raise HTTPException(status_code=404, detail="Not found")
        return r

    @router.post("/bank-rec/save")
    async def bank_rec_save(body: dict, current=Depends(require_admin)):
        import bank_rec as br
        return await br.save_rec(
            db,
            rec_id=body.get("id"),
            entity_id=body["entity_id"],
            account_id=body["account_id"],
            statement_date=body["statement_date"],
            statement_balance=float(body.get("statement_balance") or 0),
            cleared_journal_ids=body.get("cleared_journal_ids", []),
            status=body.get("status", "open"),
            user_id=current.get("id"),
        )

    @router.post("/bank-rec/{rec_id}/reopen")
    async def bank_rec_reopen_endpoint(rec_id: str, current=Depends(require_admin)):
        import bank_rec as br
        return await br.reopen_rec(db, rec_id=rec_id)

    @router.delete("/bank-rec/{rec_id}")
    async def bank_rec_delete(rec_id: str, current=Depends(require_admin)):
        import bank_rec as br
        return await br.delete_rec(db, rec_id=rec_id)

    return router
