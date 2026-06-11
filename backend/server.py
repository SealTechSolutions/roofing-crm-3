from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import logging
import uuid
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Literal

import bcrypt
import jwt
import csv
import io
from openpyxl import load_workbook
from fastapi import FastAPI, APIRouter, Depends, HTTPException, Request, status, UploadFile, File, Form, Query, Header
from fastapi.responses import Response, StreamingResponse
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr, ConfigDict

from storage import init_storage, put_object, get_object, APP_NAME
from exports import to_excel, to_pdf, CATEGORIES as EXPORT_CATEGORIES


# ----- DB -----
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]


# ----- App -----
app = FastAPI(title="Roofing CRM API")
api_router = APIRouter(prefix="/api")

JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_MINUTES = 60 * 24  # 24h for convenience


# ----- Helpers -----
def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def now_iso() -> str:
    return now_utc().isoformat()


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def get_jwt_secret() -> str:
    return os.environ["JWT_SECRET"]


def create_access_token(user_id: str, email: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "exp": now_utc() + timedelta(minutes=ACCESS_TOKEN_MINUTES),
        "type": "access",
    }
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user = await db.users.find_one({"id": payload["sub"]})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        user.pop("_id", None)
        user.pop("password_hash", None)
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


def strip_id(doc: dict) -> dict:
    if doc is None:
        return None
    doc.pop("_id", None)
    return doc


# ----- Models -----
LEAD_SOURCES = ["Referral", "Marketing", "Website", "Email Campaign", "Personal"]
PROJECT_TYPES = ["Repair", "Restoration", "Replacement"]
ROOF_TYPES = [
    "FARM (Fluid Applied Reinforced Membrane)",
    "Silicone w/ Granules",
    "Silicone",
    "Tile",
    "Shingle",
    "Metal",
    "BUR (Built-Up)",
    "ModBit",
    "EPDM w/ Ballast",
    "EPDM",
    "PVC",
    "TPO",
]
DEAL_STATUSES = ["Lead", "Sent", "Won", "Lost", "Past Lead"]
DEAL_TYPES = ["Assessment", "Scope"]
VENDOR_KINDS = ["Vendor", "Subcontractor"]
VENDOR_CATEGORIES = ["Material Supplier", "Labor", "Subcontractor", "Other"]
COST_CATEGORIES = ["Materials", "Labor", "Subcontractor", "Other"]
MILESTONE_STATUSES = ["Pending", "Invoiced", "Paid"]
COST_ITEM_STATUSES = ["Pending", "Paid"]
CONTACT_TYPES = ["Owner", "Property Manager", "Tenant", "Other"]
DOCUMENT_CATEGORIES = ["Measurement Report", "Assessment", "Scope", "Proposal", "Invoice", "Photo", "Insurance/COI", "W-9", "Other"]
PARENT_TYPES = ["project", "vendor", "subcontractor", "contact", "property"]
IMPORT_CATEGORIES = ["contacts", "properties", "projects", "vendors", "subcontractors"]
DUPLICATE_MODES = ["skip", "update", "create"]


class RegisterReq(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    name: str = Field(min_length=1)


class LoginReq(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    id: str
    email: str
    name: str
    role: str = "user"


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class ContactIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    contact_name: str
    company_name: str = ""
    contact_type: str = "Owner"  # Owner | Property Manager | Tenant | Other
    phone: str = ""
    work_phone: str = ""
    mobile_phone: str = ""
    fax: str = ""
    email: str = ""
    address: str = ""
    address_line2: str = ""
    city: str = ""
    state: str = ""
    zip_code: str = ""
    billing_same_as_address: bool = True
    billing_address: str = ""
    billing_address_line2: str = ""
    billing_city: str = ""
    billing_state: str = ""
    billing_zip: str = ""


class Contact(ContactIn):
    id: str
    created_at: str


class PropertyIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    property_name: str
    property_address: str = ""
    property_address_line2: str = ""
    property_city: str = ""
    property_state: str = ""
    property_zip: str = ""
    property_contact_id: Optional[str] = None
    property_contact_name: str = ""
    property_contact_phone: str = ""
    notes: str = ""


class Property(PropertyIn):
    id: str
    created_at: str


class PaymentMilestone(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    label: str = ""
    percent: float = 0.0
    amount: float = 0.0
    due_date: str = ""
    status: str = "Pending"  # Pending | Invoiced | Paid
    paid_date: str = ""
    notes: str = ""


class CostItem(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    category: str = "Materials"  # Materials | Labor | Subcontractor | Other
    vendor_id: Optional[str] = None
    vendor_name: str = ""
    description: str = ""
    amount: float = 0.0
    date: str = ""
    status: str = "Pending"  # Pending | Paid


class VendorIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str
    kind: str = "Vendor"  # Vendor | Subcontractor
    category: str = "Other"
    phone: str = ""
    work_phone: str = ""
    mobile_phone: str = ""
    fax: str = ""
    email: str = ""
    tin_ein: str = ""
    address: str = ""
    address_line2: str = ""
    city: str = ""
    state: str = ""
    zip_code: str = ""
    notes: str = ""


class Vendor(VendorIn):
    id: str
    created_at: str


class DealIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    title: str
    deal_type: str = "Scope"  # Assessment | Scope
    contact_id: Optional[str] = None
    customer_contact_id: Optional[str] = None
    owner_contact_id: Optional[str] = None
    property_id: Optional[str] = None
    lead_source: str = "Personal"
    referral_source: str = ""
    project_type: str = "Repair"
    current_roof_type: str = "TPO"
    proposed_roof_type: str = "TPO"
    proposal_option_1: float = 0.0
    proposal_option_2: float = 0.0
    proposal_option_3: float = 0.0
    chosen_amount: float = 0.0
    chosen_date: str = ""
    date_sent: str = ""
    status: str = "Lead"
    materials_cost: float = 0.0
    labor_cost: float = 0.0
    subcontractor_cost: float = 0.0
    other_expenses: float = 0.0
    payment_milestones: List[PaymentMilestone] = Field(default_factory=list)
    cost_items: List[CostItem] = Field(default_factory=list)
    notes: str = ""


class Deal(DealIn):
    id: str
    created_at: str


# ----- Auth Routes -----
@api_router.post("/auth/register", response_model=TokenOut)
async def register(body: RegisterReq):
    email = body.email.lower()
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    user_id = str(uuid.uuid4())
    doc = {
        "id": user_id,
        "email": email,
        "name": body.name,
        "role": "user",
        "password_hash": hash_password(body.password),
        "created_at": now_iso(),
    }
    await db.users.insert_one(doc)
    token = create_access_token(user_id, email)
    return TokenOut(access_token=token, user=UserOut(id=user_id, email=email, name=body.name, role="user"))


@api_router.post("/auth/login", response_model=TokenOut)
async def login(body: LoginReq):
    email = body.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_access_token(user["id"], email)
    return TokenOut(
        access_token=token,
        user=UserOut(id=user["id"], email=email, name=user.get("name", ""), role=user.get("role", "user")),
    )


@api_router.get("/auth/me", response_model=UserOut)
async def me(current=Depends(get_current_user)):
    return UserOut(id=current["id"], email=current["email"], name=current.get("name", ""), role=current.get("role", "user"))


# ----- Options Route -----
@api_router.get("/options")
async def options(current=Depends(get_current_user)):
    return {
        "lead_sources": LEAD_SOURCES,
        "project_types": PROJECT_TYPES,
        "roof_types": ROOF_TYPES,
        "deal_statuses": DEAL_STATUSES,
        "deal_types": DEAL_TYPES,
        "vendor_kinds": VENDOR_KINDS,
        "vendor_categories": VENDOR_CATEGORIES,
        "cost_categories": COST_CATEGORIES,
        "milestone_statuses": MILESTONE_STATUSES,
        "cost_item_statuses": COST_ITEM_STATUSES,
        "contact_types": CONTACT_TYPES,
        "document_categories": DOCUMENT_CATEGORIES,
        "import_categories": IMPORT_CATEGORIES,
        "duplicate_modes": DUPLICATE_MODES,
        "milestone_templates": {
            "50/50": [{"label": "Deposit", "percent": 50}, {"label": "Completion", "percent": 50}],
            "50/25/25": [{"label": "Deposit", "percent": 50}, {"label": "Mid-Job", "percent": 25}, {"label": "Completion", "percent": 25}],
        },
    }


# ----- Contacts -----
@api_router.get("/contacts", response_model=List[Contact])
async def list_contacts(current=Depends(get_current_user)):
    cursor = db.contacts.find({}, {"_id": 0}).sort("created_at", -1)
    return await cursor.to_list(1000)


@api_router.post("/contacts", response_model=Contact)
async def create_contact(body: ContactIn, current=Depends(get_current_user)):
    data = body.model_dump()
    if data["billing_same_as_address"]:
        data["billing_address"] = data["address"]
        data["billing_address_line2"] = data["address_line2"]
        data["billing_city"] = data["city"]
        data["billing_state"] = data["state"]
        data["billing_zip"] = data["zip_code"]
    data["id"] = str(uuid.uuid4())
    data["created_at"] = now_iso()
    await db.contacts.insert_one(data.copy())
    return strip_id(data)


@api_router.get("/contacts/{contact_id}", response_model=Contact)
async def get_contact(contact_id: str, current=Depends(get_current_user)):
    doc = await db.contacts.find_one({"id": contact_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Contact not found")
    return doc


@api_router.put("/contacts/{contact_id}", response_model=Contact)
async def update_contact(contact_id: str, body: ContactIn, current=Depends(get_current_user)):
    data = body.model_dump()
    if data["billing_same_as_address"]:
        data["billing_address"] = data["address"]
        data["billing_address_line2"] = data["address_line2"]
        data["billing_city"] = data["city"]
        data["billing_state"] = data["state"]
        data["billing_zip"] = data["zip_code"]
    result = await db.contacts.update_one({"id": contact_id}, {"$set": data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Contact not found")
    doc = await db.contacts.find_one({"id": contact_id}, {"_id": 0})
    return doc


@api_router.delete("/contacts/{contact_id}")
async def delete_contact(contact_id: str, current=Depends(get_current_user)):
    result = await db.contacts.delete_one({"id": contact_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Contact not found")
    return {"ok": True}


# ----- Properties -----
@api_router.get("/properties", response_model=List[Property])
async def list_properties(current=Depends(get_current_user)):
    cursor = db.properties.find({}, {"_id": 0}).sort("created_at", -1)
    return await cursor.to_list(1000)


@api_router.post("/properties", response_model=Property)
async def create_property(body: PropertyIn, current=Depends(get_current_user)):
    data = body.model_dump()
    data["id"] = str(uuid.uuid4())
    data["created_at"] = now_iso()
    await db.properties.insert_one(data.copy())
    return strip_id(data)


@api_router.get("/properties/{property_id}", response_model=Property)
async def get_property(property_id: str, current=Depends(get_current_user)):
    doc = await db.properties.find_one({"id": property_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Property not found")
    return doc


@api_router.put("/properties/{property_id}", response_model=Property)
async def update_property(property_id: str, body: PropertyIn, current=Depends(get_current_user)):
    data = body.model_dump()
    result = await db.properties.update_one({"id": property_id}, {"$set": data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Property not found")
    doc = await db.properties.find_one({"id": property_id}, {"_id": 0})
    return doc


@api_router.delete("/properties/{property_id}")
async def delete_property(property_id: str, current=Depends(get_current_user)):
    result = await db.properties.delete_one({"id": property_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Property not found")
    return {"ok": True}


def normalize_deal(data: dict) -> dict:
    """Auto-fill cost line item ids, milestone ids/amounts, and roll up aggregate cost buckets."""
    chosen = float(data.get("chosen_amount") or 0)

    # Milestones: ensure id, recompute amount from percent * chosen
    milestones = data.get("payment_milestones") or []
    for m in milestones:
        if not m.get("id"):
            m["id"] = str(uuid.uuid4())
        try:
            pct = float(m.get("percent") or 0)
        except (TypeError, ValueError):
            pct = 0.0
        m["percent"] = pct
        m["amount"] = round(chosen * pct / 100.0, 2)
    data["payment_milestones"] = milestones

    # Cost items: ensure id; aggregate buckets
    items = data.get("cost_items") or []
    buckets = {"Materials": 0.0, "Labor": 0.0, "Subcontractor": 0.0, "Other": 0.0}
    for it in items:
        if not it.get("id"):
            it["id"] = str(uuid.uuid4())
        try:
            amt = float(it.get("amount") or 0)
        except (TypeError, ValueError):
            amt = 0.0
        it["amount"] = amt
        cat = it.get("category") or "Other"
        if cat not in buckets:
            cat = "Other"
            it["category"] = cat
        buckets[cat] += amt
    data["cost_items"] = items
    data["materials_cost"] = round(buckets["Materials"], 2)
    data["labor_cost"] = round(buckets["Labor"], 2)
    data["subcontractor_cost"] = round(buckets["Subcontractor"], 2)
    data["other_expenses"] = round(buckets["Other"], 2)
    return data


# ----- Deals -----
@api_router.get("/deals", response_model=List[Deal])
async def list_deals(current=Depends(get_current_user)):
    cursor = db.deals.find({}, {"_id": 0}).sort("created_at", -1)
    return await cursor.to_list(1000)


@api_router.post("/deals", response_model=Deal)
async def create_deal(body: DealIn, current=Depends(get_current_user)):
    data = normalize_deal(body.model_dump())
    data["id"] = str(uuid.uuid4())
    data["created_at"] = now_iso()
    await db.deals.insert_one(data.copy())
    return strip_id(data)


@api_router.get("/deals/{deal_id}", response_model=Deal)
async def get_deal(deal_id: str, current=Depends(get_current_user)):
    doc = await db.deals.find_one({"id": deal_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Deal not found")
    return doc


@api_router.put("/deals/{deal_id}", response_model=Deal)
async def update_deal(deal_id: str, body: DealIn, current=Depends(get_current_user)):
    data = normalize_deal(body.model_dump())
    result = await db.deals.update_one({"id": deal_id}, {"$set": data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Deal not found")
    doc = await db.deals.find_one({"id": deal_id}, {"_id": 0})
    return doc


@api_router.delete("/deals/{deal_id}")
async def delete_deal(deal_id: str, current=Depends(get_current_user)):
    result = await db.deals.delete_one({"id": deal_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Deal not found")
    return {"ok": True}


# ----- Vendors -----
@api_router.get("/vendors", response_model=List[Vendor])
async def list_vendors(kind: Optional[str] = None, current=Depends(get_current_user)):
    query = {}
    if kind:
        query["kind"] = kind
    cursor = db.vendors.find(query, {"_id": 0}).sort("name", 1)
    return await cursor.to_list(1000)


@api_router.post("/vendors", response_model=Vendor)
async def create_vendor(body: VendorIn, current=Depends(get_current_user)):
    data = body.model_dump()
    data["id"] = str(uuid.uuid4())
    data["created_at"] = now_iso()
    await db.vendors.insert_one(data.copy())
    return strip_id(data)


@api_router.get("/vendors/{vendor_id}", response_model=Vendor)
async def get_vendor(vendor_id: str, current=Depends(get_current_user)):
    doc = await db.vendors.find_one({"id": vendor_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Vendor not found")
    return doc


@api_router.put("/vendors/{vendor_id}", response_model=Vendor)
async def update_vendor(vendor_id: str, body: VendorIn, current=Depends(get_current_user)):
    data = body.model_dump()
    result = await db.vendors.update_one({"id": vendor_id}, {"$set": data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Vendor not found")
    doc = await db.vendors.find_one({"id": vendor_id}, {"_id": 0})
    return doc


@api_router.delete("/vendors/{vendor_id}")
async def delete_vendor(vendor_id: str, current=Depends(get_current_user)):
    result = await db.vendors.delete_one({"id": vendor_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Vendor not found")
    return {"ok": True}


# ----- Files (Documents) -----
@api_router.post("/files/upload")
async def upload_file(
    file: UploadFile = File(...),
    parent_type: str = Form(...),
    parent_id: str = Form(...),
    category: str = Form("Other"),
    current=Depends(get_current_user),
):
    if parent_type not in PARENT_TYPES:
        raise HTTPException(status_code=400, detail="Invalid parent_type")
    if category not in DOCUMENT_CATEGORIES:
        category = "Other"
    ext = (file.filename.rsplit(".", 1)[-1] if "." in file.filename else "bin").lower()
    file_id = str(uuid.uuid4())
    storage_path = f"{APP_NAME}/uploads/{parent_type}/{parent_id}/{file_id}.{ext}"
    data = await file.read()
    if len(data) > 50 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large (max 50MB)")
    try:
        result = put_object(storage_path, data, file.content_type or "application/octet-stream")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Upload failed: {e}")
    doc = {
        "id": file_id,
        "parent_type": parent_type,
        "parent_id": parent_id,
        "category": category,
        "storage_path": result["path"],
        "original_filename": file.filename,
        "content_type": file.content_type or "application/octet-stream",
        "size": len(data),
        "is_deleted": False,
        "uploaded_by": current["id"],
        "created_at": now_iso(),
    }
    await db.files.insert_one(doc.copy())
    doc.pop("_id", None)
    return doc


@api_router.get("/files")
async def list_files(
    parent_type: str = Query(...),
    parent_id: str = Query(...),
    current=Depends(get_current_user),
):
    cursor = db.files.find(
        {"parent_type": parent_type, "parent_id": parent_id, "is_deleted": False},
        {"_id": 0},
    ).sort("created_at", -1)
    return await cursor.to_list(1000)


@api_router.get("/files/{file_id}/download")
async def download_file(
    file_id: str,
    token: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    # Auth check - support either Bearer header or token query (for browser links)
    raw = None
    if authorization and authorization.startswith("Bearer "):
        raw = authorization[7:]
    elif token:
        raw = token
    if not raw:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(raw, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
        user = await db.users.find_one({"id": payload["sub"]})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid token")
    rec = await db.files.find_one({"id": file_id, "is_deleted": False})
    if not rec:
        raise HTTPException(status_code=404, detail="File not found")
    try:
        data, content_type = get_object(rec["storage_path"])
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Download failed: {e}")
    return Response(
        content=data,
        media_type=rec.get("content_type") or content_type,
        headers={"Content-Disposition": f'attachment; filename="{rec["original_filename"]}"'},
    )


@api_router.delete("/files/{file_id}")
async def delete_file(file_id: str, current=Depends(get_current_user)):
    result = await db.files.update_one({"id": file_id}, {"$set": {"is_deleted": True, "deleted_at": now_iso()}})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="File not found")
    return {"ok": True}


# ----- Export -----
async def _records_for(category: str) -> list:
    if category == "contacts":
        return await db.contacts.find({}, {"_id": 0}).sort("contact_name", 1).to_list(5000)
    if category == "properties":
        return await db.properties.find({}, {"_id": 0}).sort("property_name", 1).to_list(5000)
    if category == "projects":
        return await db.deals.find({}, {"_id": 0}).sort("created_at", -1).to_list(5000)
    if category == "vendors":
        return await db.vendors.find({"kind": "Vendor"}, {"_id": 0}).sort("name", 1).to_list(5000)
    if category == "subcontractors":
        return await db.vendors.find({"kind": "Subcontractor"}, {"_id": 0}).sort("name", 1).to_list(5000)
    raise HTTPException(status_code=400, detail="Unknown category")


@api_router.get("/export/{category}.{fmt}")
async def export_category(category: str, fmt: str, current=Depends(get_current_user)):
    if category == "all":
        sections = [(c, await _records_for(c)) for c in IMPORT_CATEGORIES]
    else:
        if category not in IMPORT_CATEGORIES:
            raise HTTPException(status_code=400, detail="Unknown category")
        sections = [(category, await _records_for(category))]
    if fmt == "xlsx":
        data = to_excel(sections)
        return Response(
            content=data,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="sealtech-{category}.xlsx"'},
        )
    if fmt == "pdf":
        data = to_pdf(sections)
        return Response(
            content=data,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="sealtech-{category}.pdf"'},
        )
    raise HTTPException(status_code=400, detail="Unsupported format (use xlsx or pdf)")


@api_router.get("/export/template/{category}.xlsx")
async def export_template(category: str, current=Depends(get_current_user)):
    if category not in IMPORT_CATEGORIES:
        raise HTTPException(status_code=400, detail="Unknown category")
    sections = [(category, [])]
    data = to_excel(sections)
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="sealtech-{category}-template.xlsx"'},
    )


# ----- Import -----
def _parse_rows(data: bytes, filename: str):
    name = (filename or "").lower()
    if name.endswith(".csv"):
        text = data.decode("utf-8-sig", errors="replace")
        reader = csv.DictReader(io.StringIO(text))
        return [dict(r) for r in reader]
    # default to xlsx
    wb = load_workbook(io.BytesIO(data), data_only=True)
    ws = wb.active
    headers = [str(c.value).strip() if c.value is not None else "" for c in ws[1]]
    rows = []
    for row in ws.iter_rows(min_row=2, values_only=True):
        if all(v in (None, "") for v in row):
            continue
        rec = {}
        for i, h in enumerate(headers):
            if not h:
                continue
            v = row[i] if i < len(row) else None
            rec[h] = "" if v is None else v
        rows.append(rec)
    return rows


def _normalize_row(category: str, raw: dict) -> dict:
    """Map exported headers back to model field keys."""
    cfg = EXPORT_CATEGORIES[
        "vendors" if category == "vendors" else "subcontractors" if category == "subcontractors" else category
    ]
    header_to_key = dict(zip(cfg["headers"], cfg["keys"]))
    out = {}
    for h, v in raw.items():
        key = header_to_key.get(h.strip()) if isinstance(h, str) else None
        if not key or key.startswith("_"):
            continue
        out[key] = v if isinstance(v, str) else ("" if v is None else v)
    return out


async def _find_existing(category: str, rec: dict):
    if category == "contacts":
        q = []
        if rec.get("email"):
            q.append({"email": str(rec["email"]).lower()})
        if rec.get("company_name") and rec.get("contact_name"):
            q.append({"company_name": rec["company_name"], "contact_name": rec["contact_name"]})
        if not q:
            return None
        return await db.contacts.find_one({"$or": q})
    if category == "properties":
        if rec.get("property_address") and rec.get("property_city"):
            return await db.properties.find_one({
                "property_address": rec["property_address"],
                "property_city": rec["property_city"],
            })
        return None
    if category == "projects":
        if rec.get("title"):
            return await db.deals.find_one({"title": rec["title"]})
        return None
    if category in ("vendors", "subcontractors"):
        kind = "Vendor" if category == "vendors" else "Subcontractor"
        q = {"kind": kind, "name": rec.get("name", "")}
        if rec.get("tin_ein"):
            q["tin_ein"] = rec["tin_ein"]
        return await db.vendors.find_one(q) if rec.get("name") else None
    return None


@api_router.post("/import/{category}")
async def import_category(
    category: str,
    file: UploadFile = File(...),
    duplicate_mode: str = Form("skip"),
    current=Depends(get_current_user),
):
    if category not in IMPORT_CATEGORIES:
        raise HTTPException(status_code=400, detail="Unknown category")
    if duplicate_mode not in DUPLICATE_MODES:
        duplicate_mode = "skip"

    raw_bytes = await file.read()
    try:
        rows = _parse_rows(raw_bytes, file.filename)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not parse file: {e}")

    imported = 0
    updated = 0
    skipped = 0
    errors = []

    for idx, raw in enumerate(rows, start=2):  # row index in spreadsheet (header is row 1)
        try:
            rec = _normalize_row(category, raw)
            if not rec:
                continue
            # category-specific seeding
            if category == "vendors":
                rec["kind"] = "Vendor"
            elif category == "subcontractors":
                rec["kind"] = "Subcontractor"
            # Coerce numeric for projects
            if category == "projects":
                for nk in ["proposal_option_1", "proposal_option_2", "proposal_option_3", "chosen_amount"]:
                    try:
                        rec[nk] = float(rec.get(nk) or 0)
                    except (TypeError, ValueError):
                        rec[nk] = 0.0
            # Required field check
            required = {
                "contacts": "contact_name",
                "properties": "property_name",
                "projects": "title",
                "vendors": "name",
                "subcontractors": "name",
            }[category]
            if not rec.get(required):
                skipped += 1
                errors.append({"row": idx, "error": f"Missing required field: {required}"})
                continue

            existing = await _find_existing(category, rec)

            if existing and duplicate_mode == "skip":
                skipped += 1
                continue
            if existing and duplicate_mode == "update":
                coll = "deals" if category == "projects" else ("vendors" if category in ("vendors", "subcontractors") else category)
                await db[coll].update_one({"id": existing["id"]}, {"$set": rec})
                updated += 1
                continue
            # create
            rec["id"] = str(uuid.uuid4())
            rec["created_at"] = now_iso()
            coll = "deals" if category == "projects" else ("vendors" if category in ("vendors", "subcontractors") else category)
            await db[coll].insert_one(rec.copy())
            imported += 1
        except Exception as e:
            errors.append({"row": idx, "error": str(e)})

    return {
        "imported": imported,
        "updated": updated,
        "skipped": skipped,
        "errors": errors,
        "total": len(rows),
    }


# ----- Dashboard -----
@api_router.get("/dashboard/summary")
async def dashboard_summary(current=Depends(get_current_user)):
    deals = await db.deals.find({}, {"_id": 0}).to_list(5000)
    contacts_count = await db.contacts.count_documents({})
    properties_count = await db.properties.count_documents({})

    open_leads = 0
    won_deals = 0
    lost_deals = 0
    pipeline_revenue = 0.0
    won_revenue = 0.0
    total_costs = 0.0

    year_start = datetime(now_utc().year, 1, 1, tzinfo=timezone.utc).isoformat()
    profit_ytd = 0.0

    for d in deals:
        status_v = d.get("status", "Lead")
        chosen = float(d.get("chosen_amount", 0) or 0)
        costs = float(d.get("materials_cost", 0) or 0) + float(d.get("labor_cost", 0) or 0) + float(d.get("subcontractor_cost", 0) or 0) + float(d.get("other_expenses", 0) or 0)
        if status_v == "Won":
            won_deals += 1
            won_revenue += chosen
            total_costs += costs
            if d.get("created_at", "") >= year_start:
                profit_ytd += (chosen - costs)
        elif status_v == "Lost":
            lost_deals += 1
        else:
            open_leads += 1
            pipeline_revenue += chosen

    return {
        "contacts_count": contacts_count,
        "properties_count": properties_count,
        "deals_count": len(deals),
        "open_leads": open_leads,
        "won_deals": won_deals,
        "lost_deals": lost_deals,
        "pipeline_revenue": round(pipeline_revenue, 2),
        "won_revenue": round(won_revenue, 2),
        "total_costs": round(total_costs, 2),
        "total_profit": round(won_revenue - total_costs, 2),
        "profit_ytd": round(profit_ytd, 2),
    }


# ----- Startup -----
@app.on_event("startup")
async def on_startup():
    await db.users.create_index("email", unique=True)
    await db.contacts.create_index("id", unique=True)
    await db.properties.create_index("id", unique=True)
    await db.deals.create_index("id", unique=True)
    await db.vendors.create_index("id", unique=True)
    await db.files.create_index("id", unique=True)
    await db.files.create_index([("parent_type", 1), ("parent_id", 1)])

    # Migrate deprecated status "Proposal Sent" → "Sent"
    await db.deals.update_many({"status": "Proposal Sent"}, {"$set": {"status": "Sent"}})

    # Init object storage (non-fatal)
    try:
        init_storage()
        logger.info("Object storage initialized")
    except Exception as e:
        logger.warning(f"Storage init failed (uploads will not work): {e}")

    admin_email = os.environ.get("ADMIN_EMAIL", "admin@roofingcrm.com").lower()
    admin_password = os.environ.get("ADMIN_PASSWORD", "admin123")
    existing = await db.users.find_one({"email": admin_email})
    if existing is None:
        await db.users.insert_one({
            "id": str(uuid.uuid4()),
            "email": admin_email,
            "name": "Admin",
            "role": "admin",
            "password_hash": hash_password(admin_password),
            "created_at": now_iso(),
        })


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()


# ----- Router & CORS -----
app.include_router(api_router)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)
