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
    address: str = ""
    city: str = ""
    state: str = ""
    zip_code: str = ""
    email: str = ""
    phone: str = ""
    remit_to_address: str = ""
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
        if existing.get("system"):
            update["number"] = existing["number"]
            update["type"] = existing["type"]
            update["is_contra"] = existing.get("is_contra", False)
            update["entity_id"] = existing["entity_id"]
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

    return router
