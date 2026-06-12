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
from io import BytesIO
import smtplib
import secrets
import string
import re
from openpyxl import load_workbook
from fastapi import FastAPI, APIRouter, Depends, HTTPException, Request, status, UploadFile, File, Form, Query, Header, Body
from fastapi.responses import Response, StreamingResponse
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr, ConfigDict

from storage import init_storage, put_object, get_object, APP_NAME
from exports import to_excel, to_pdf, CATEGORIES as EXPORT_CATEGORIES
from spec_sheet import build_silicone_spec


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
PROJECT_TYPES = ["Repair", "Roof Restoration", "Roof Replacement", "Maintenance", "New Construction", "Other"]
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
USER_ROLES = ["admin", "manager", "sales"]
FINANCIAL_FIELDS = ["proposal_option_1", "proposal_option_2", "proposal_option_3", "chosen_amount", "materials_cost", "labor_cost", "subcontractor_cost", "other_expenses", "payment_milestones", "cost_items"]


def proposal_mid_amount(d: dict) -> float:
    """Return the middle (median by value) of the 3 proposal options, ignoring zeros.
    Falls back to the single non-zero value if only one is set.
    Used as the default tracking amount before a chosen_amount is locked in."""
    opts = []
    for i in (1, 2, 3):
        v = float(d.get(f"proposal_option_{i}", 0) or 0)
        if v > 0:
            opts.append(v)
    if not opts:
        return 0.0
    opts.sort()
    return opts[len(opts) // 2]


def generate_password(length: int = 12) -> str:
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


def is_admin(user: dict) -> bool:
    return user.get("role") == "admin"


def scrub_deal(doc: dict, user: dict) -> dict:
    """For non-admin viewers, hide financial fields unless they own/created the deal."""
    if is_admin(user):
        return doc
    owns = doc.get("assigned_to_user_id") == user["id"] or doc.get("created_by_user_id") == user["id"]
    if owns:
        return doc
    out = dict(doc)
    for f in FINANCIAL_FIELDS:
        if f in out:
            out[f] = [] if isinstance(out[f], list) else 0
    out["_financial_hidden"] = True
    return out


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
    role: str = "admin"
    phone: str = ""
    title: str = ""


class UserCreateReq(BaseModel):
    email: EmailStr
    name: str
    role: str = "sales"  # admin | manager | sales
    phone: str = ""
    title: str = ""


class UserUpdateReq(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    phone: Optional[str] = None
    title: Optional[str] = None


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
    property_sqft: float = 0.0
    perimeter_lnft: float = 0.0
    avg_parapet_height: float = 0.0
    total_sqft: float = 0.0
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
    assigned_to_user_id: Optional[str] = None
    product_description: str = ""
    warranty_20yr_add: float = 0.0
    warranty_15yr_add: float = 0.0
    warranty_10yr_add: float = 0.0
    warranty_color: str = "white"
    cover_photo_file_id: Optional[str] = None
    # Change orders — approved scope additions/deductions that affect the contract total
    change_orders: List[dict] = Field(default_factory=list)
    # Maintenance plan tracking
    maintenance_plan: bool = False
    maintenance_rate: float = 0.0
    maintenance_start_date: str = ""
    next_maintenance_date: str = ""
    last_maintenance_date: str = ""
    maintenance_visits: List[dict] = Field(default_factory=list)


class Deal(DealIn):
    id: str
    created_at: str


# ----- Invoice Models -----
class InvoiceLineItem(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    description: str = ""
    quantity: float = 1.0
    unit_price: float = 0.0
    amount: float = 0.0  # qty * unit_price (server-computed)


class InvoiceIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    deal_id: Optional[str] = None
    customer_contact_id: Optional[str] = None
    invoice_type: str = ""  # Project Amount | Deposit | Mid-Project | Final | Maintenance | Repair | (blank)
    # Bill-to snapshot (frozen at creation time)
    bill_to_company: str = ""
    bill_to_name: str = ""
    bill_to_address: str = ""
    bill_to_address_line2: str = ""
    bill_to_city: str = ""
    bill_to_state: str = ""
    bill_to_zip: str = ""
    bill_to_email: str = ""
    # Email send config
    cc_email: str = ""
    # Invoice fields
    invoice_date: str = ""  # ISO yyyy-mm-dd
    due_date: str = ""
    terms: str = "Due Upon Receipt"
    project_title: str = ""
    project_address: str = ""
    project_total: float = 0.0  # Contract total of the parent project (for context on partial invoices)
    notes: str = ""
    line_items: List[InvoiceLineItem] = Field(default_factory=list)
    status: str = "Draft"  # Draft | Sent | Paid | Partial | Void | Overdue
    # Payment
    amount_paid: float = 0.0
    payment_date: str = ""
    payment_method: str = ""
    payment_reference: str = ""
    # Source link (which milestone or maintenance visit created this)
    source_type: str = ""  # milestone | maintenance_visit | manual
    source_id: str = ""


class Invoice(InvoiceIn):
    id: str
    invoice_number: str
    subtotal: float = 0.0
    total: float = 0.0
    balance_due: float = 0.0
    created_at: str
    created_by_user_id: Optional[str] = None
    last_sent_at: str = ""
    pdf_generated_at: str = ""


# ----- Vendor Bill (Payables) Models -----
class VendorBillLine(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    description: str = ""
    project_id: Optional[str] = None
    project_title: str = ""
    quantity: float = 1.0
    unit_price: float = 0.0
    amount: float = 0.0


class VendorBillIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    vendor_id: Optional[str] = None
    vendor_name: str = ""  # snapshot for display
    bill_number: str = ""
    bill_date: str = ""
    received_date: str = ""
    due_date: str = ""
    terms: str = "Due on Receipt"
    total: float = 0.0
    subtotal: float = 0.0
    tax: float = 0.0
    shipping: float = 0.0
    status: str = "Pending"  # Pending | Approved | Paid | Disputed | Void
    notes: str = ""
    attached_file_id: Optional[str] = None
    parsed_by_ai: bool = False
    line_items: List[VendorBillLine] = Field(default_factory=list)
    # Payment tracking
    paid_amount: float = 0.0
    paid_date: str = ""
    paid_method: str = ""
    paid_reference: str = ""


class VendorBill(VendorBillIn):
    id: str
    created_at: str
    created_by_user_id: Optional[str] = None


# ----- Materials Catalog -----
MATERIAL_CATEGORIES = ["Coating", "Primer", "Fabric", "Mastic", "Fasteners", "Sealant", "Equipment", "Tools", "Other"]


class MaterialIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    sku: str = ""
    name: str = Field(min_length=1)
    category: str = "Other"
    unit: str = "each"
    default_price: float = 0.0
    shipping_pct: float = 0.0  # typical shipping load %, default per material
    markup_pct: float = 0.0    # internal target markup % (for your P&L planning only — never shown to customers)
    vendor_id: Optional[str] = None
    vendor_name: str = ""
    notes: str = ""


class Material(MaterialIn):
    id: str
    created_at: str
    updated_at: str


# ----- Auth Routes -----
@api_router.post("/auth/register", response_model=TokenOut)
async def register(body: RegisterReq):
    # Self-registration disabled if any users exist (admin must create users)
    count = await db.users.count_documents({})
    if count > 0:
        raise HTTPException(status_code=403, detail="Registration disabled. Ask an admin to add you.")
    email = body.email.lower()
    user_id = str(uuid.uuid4())
    doc = {
        "id": user_id,
        "email": email,
        "name": body.name,
        "role": "admin",
        "phone": "",
        "title": "",
        "password_hash": hash_password(body.password),
        "created_at": now_iso(),
    }
    await db.users.insert_one(doc)
    token = create_access_token(user_id, email)
    return TokenOut(access_token=token, user=UserOut(id=user_id, email=email, name=body.name, role="admin"))


@api_router.post("/auth/login", response_model=TokenOut)
async def login(body: LoginReq):
    email = body.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_access_token(user["id"], email)
    return TokenOut(
        access_token=token,
        user=UserOut(
            id=user["id"], email=email, name=user.get("name", ""), role=user.get("role", "admin"),
            phone=user.get("phone", ""), title=user.get("title", ""),
        ),
    )


@api_router.get("/auth/me", response_model=UserOut)
async def me(current=Depends(get_current_user)):
    return UserOut(
        id=current["id"], email=current["email"], name=current.get("name", ""),
        role=current.get("role", "admin"), phone=current.get("phone", ""), title=current.get("title", ""),
    )


# ----- Users (admin only) -----
def require_admin(current=Depends(get_current_user)) -> dict:
    if not is_admin(current):
        raise HTTPException(status_code=403, detail="Admin access required")
    return current


@api_router.get("/users", response_model=List[UserOut])
async def list_users(current=Depends(require_admin)):
    cursor = db.users.find({}, {"_id": 0, "password_hash": 0}).sort("name", 1)
    return await cursor.to_list(1000)


@api_router.post("/users")
async def create_user(body: UserCreateReq, current=Depends(require_admin)):
    email = body.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email already exists")
    if body.role not in USER_ROLES:
        raise HTTPException(status_code=400, detail="Invalid role")
    user_id = str(uuid.uuid4())
    generated = generate_password(12)
    doc = {
        "id": user_id,
        "email": email,
        "name": body.name,
        "role": body.role,
        "phone": body.phone or "",
        "title": body.title or "",
        "password_hash": hash_password(generated),
        "created_at": now_iso(),
        "created_by": current["id"],
    }
    await db.users.insert_one(doc)
    return {
        "user": {"id": user_id, "email": email, "name": body.name, "role": body.role, "phone": doc["phone"], "title": doc["title"]},
        "generated_password": generated,
    }


@api_router.put("/users/{user_id}", response_model=UserOut)
async def update_user(user_id: str, body: UserUpdateReq, current=Depends(require_admin)):
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    if "role" in patch and patch["role"] not in USER_ROLES:
        raise HTTPException(status_code=400, detail="Invalid role")
    if not patch:
        raise HTTPException(status_code=400, detail="Nothing to update")
    result = await db.users.update_one({"id": user_id}, {"$set": patch})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    return user


@api_router.post("/users/{user_id}/regenerate-password")
async def regenerate_password(user_id: str, current=Depends(require_admin)):
    user = await db.users.find_one({"id": user_id})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    new_pw = generate_password(12)
    await db.users.update_one({"id": user_id}, {"$set": {"password_hash": hash_password(new_pw)}})
    return {"generated_password": new_pw}


@api_router.delete("/users/{user_id}")
async def delete_user(user_id: str, current=Depends(require_admin)):
    if user_id == current["id"]:
        raise HTTPException(status_code=400, detail="You cannot delete yourself")
    admin_count = await db.users.count_documents({"role": "admin"})
    target = await db.users.find_one({"id": user_id})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target.get("role") == "admin" and admin_count <= 1:
        raise HTTPException(status_code=400, detail="Cannot delete the last admin")
    await db.users.delete_one({"id": user_id})
    return {"ok": True}


# ----- Options Route -----
@api_router.get("/options")
async def options(current=Depends(get_current_user)):
    return {
        "lead_sources": LEAD_SOURCES,
        "project_types": PROJECT_TYPES,
        "material_categories": MATERIAL_CATEGORIES,
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
        "user_roles": USER_ROLES,
        "milestone_templates": {
            "50/50": [{"label": "Deposit", "percent": 50}, {"label": "Completion", "percent": 50}],
            "50/25/25": [{"label": "Deposit", "percent": 50}, {"label": "Mid-Job", "percent": 25}, {"label": "Completion", "percent": 25}],
        },
    }


# ----- Contacts -----
@api_router.get("/contacts", response_model=List[Contact])
async def list_contacts(current=Depends(get_current_user)):
    query = {"is_deleted": {"$ne": True}}
    if current.get("role") == "sales":
        query["$or"] = [{"assigned_to_user_id": current["id"]}, {"created_by_user_id": current["id"]}]
    cursor = db.contacts.find(query, {"_id": 0}).sort("created_at", -1)
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
    data["created_by_user_id"] = current["id"]
    if not data.get("assigned_to_user_id"):
        data["assigned_to_user_id"] = current["id"]
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
    if is_admin(current):
        result = await db.contacts.delete_one({"id": contact_id})
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Contact not found")
    else:
        result = await db.contacts.update_one(
            {"id": contact_id},
            {"$set": {"is_deleted": True, "deleted_at": now_iso(), "deleted_by": current["id"]}},
        )
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Contact not found")
    return {"ok": True}


# ----- Properties -----
@api_router.get("/properties", response_model=List[Property])
async def list_properties(current=Depends(get_current_user)):
    cursor = db.properties.find({"is_deleted": {"$ne": True}}, {"_id": 0}).sort("created_at", -1)
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
    if is_admin(current):
        result = await db.properties.delete_one({"id": property_id})
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Property not found")
    else:
        result = await db.properties.update_one(
            {"id": property_id},
            {"$set": {"is_deleted": True, "deleted_at": now_iso(), "deleted_by": current["id"]}},
        )
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Property not found")
    return {"ok": True}


def normalize_deal(data: dict) -> dict:
    """Auto-fill cost line item ids, milestone ids/amounts, and roll up aggregate cost buckets."""
    chosen = float(data.get("chosen_amount") or 0)

    # Measurements: auto-compute total_sqft = property_sqft + (perimeter_lnft * avg_parapet_height)
    try:
        psqft = float(data.get("property_sqft") or 0)
        plnft = float(data.get("perimeter_lnft") or 0)
        pht = float(data.get("avg_parapet_height") or 0)
    except (TypeError, ValueError):
        psqft = plnft = pht = 0.0
    data["property_sqft"] = round(psqft, 2)
    data["perimeter_lnft"] = round(plnft, 2)
    data["avg_parapet_height"] = round(pht, 2)
    data["total_sqft"] = round(psqft + (plnft * pht), 2)

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

    # Maintenance: derive next_maintenance_date / last_maintenance_date from visits + start date
    visits = data.get("maintenance_visits") or []
    cleaned_visits = []
    for v in visits:
        if not v.get("id"):
            v["id"] = str(uuid.uuid4())
        try:
            v["amount"] = float(v.get("amount") or 0)
        except (TypeError, ValueError):
            v["amount"] = 0.0
        cleaned_visits.append(v)
    # Sort visits by date descending
    cleaned_visits.sort(key=lambda x: x.get("visit_date", ""), reverse=True)
    data["maintenance_visits"] = cleaned_visits
    last_visit_date = cleaned_visits[0].get("visit_date", "") if cleaned_visits else ""
    data["last_maintenance_date"] = last_visit_date

    # Normalize change orders
    change_orders = data.get("change_orders") or []
    cleaned_cos = []
    for co in change_orders:
        if not co.get("id"):
            co["id"] = str(uuid.uuid4())
        try:
            co["amount"] = float(co.get("amount") or 0)
        except (TypeError, ValueError):
            co["amount"] = 0.0
        if not co.get("status"):
            co["status"] = "Approved"
        cleaned_cos.append(co)
    data["change_orders"] = cleaned_cos

    # Compute next_maintenance_date: last_visit + 1 year, else start_date + 1 year
    start = data.get("maintenance_start_date", "") or ""
    base = last_visit_date or start
    next_due = ""
    if base:
        try:
            base_dt = datetime.fromisoformat(base[:10])
            next_dt = base_dt.replace(year=base_dt.year + 1)
            next_due = next_dt.date().isoformat()
        except (ValueError, TypeError):
            next_due = ""
    data["next_maintenance_date"] = next_due
    return data


# ----- Deals -----
@api_router.get("/deals", response_model=List[Deal])
async def list_deals(current=Depends(get_current_user)):
    query = {"is_deleted": {"$ne": True}}
    if current.get("role") == "sales":
        query["$or"] = [{"assigned_to_user_id": current["id"]}, {"created_by_user_id": current["id"]}]
    cursor = db.deals.find(query, {"_id": 0}).sort("created_at", -1)
    items = await cursor.to_list(1000)
    return [scrub_deal(d, current) for d in items]


@api_router.post("/deals", response_model=Deal)
async def create_deal(body: DealIn, current=Depends(get_current_user)):
    data = normalize_deal(body.model_dump())
    data["id"] = str(uuid.uuid4())
    data["created_at"] = now_iso()
    data["created_by_user_id"] = current["id"]
    if not data.get("assigned_to_user_id"):
        data["assigned_to_user_id"] = current["id"]
    await db.deals.insert_one(data.copy())
    return strip_id(data)


@api_router.get("/deals/{deal_id}", response_model=Deal)
async def get_deal(deal_id: str, current=Depends(get_current_user)):
    doc = await db.deals.find_one({"id": deal_id, "is_deleted": {"$ne": True}}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Deal not found")
    if current.get("role") == "sales":
        owns = doc.get("assigned_to_user_id") == current["id"] or doc.get("created_by_user_id") == current["id"]
        if not owns:
            raise HTTPException(status_code=403, detail="Not your project")
    return scrub_deal(doc, current)


@api_router.put("/deals/{deal_id}", response_model=Deal)
async def update_deal(deal_id: str, body: DealIn, current=Depends(get_current_user)):
    existing = await db.deals.find_one({"id": deal_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Deal not found")
    if current.get("role") == "sales":
        owns = existing.get("assigned_to_user_id") == current["id"] or existing.get("created_by_user_id") == current["id"]
        if not owns:
            raise HTTPException(status_code=403, detail="Not your project")
    data = normalize_deal(body.model_dump())
    await db.deals.update_one({"id": deal_id}, {"$set": data})
    doc = await db.deals.find_one({"id": deal_id}, {"_id": 0})
    return scrub_deal(doc, current)


@api_router.delete("/deals/{deal_id}")
async def delete_deal(deal_id: str, current=Depends(get_current_user)):
    if is_admin(current):
        result = await db.deals.delete_one({"id": deal_id})
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Deal not found")
    else:
        result = await db.deals.update_one(
            {"id": deal_id},
            {"$set": {"is_deleted": True, "deleted_at": now_iso(), "deleted_by": current["id"]}},
        )
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Deal not found")
    return {"ok": True}


# ----- Maintenance Plan -----
class MaintenanceVisitIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    visit_date: str
    amount: float = 0.0
    subcontractor_id: Optional[str] = None
    subcontractor_name: str = ""
    notes: str = ""


@api_router.post("/deals/{deal_id}/maintenance-visits", response_model=Deal)
async def add_maintenance_visit(deal_id: str, body: MaintenanceVisitIn, current=Depends(get_current_user)):
    existing = await db.deals.find_one({"id": deal_id, "is_deleted": {"$ne": True}})
    if not existing:
        raise HTTPException(status_code=404, detail="Project not found")
    if current.get("role") == "sales":
        owns = existing.get("assigned_to_user_id") == current["id"] or existing.get("created_by_user_id") == current["id"]
        if not owns:
            raise HTTPException(status_code=403, detail="Not your project")
    visit = body.model_dump()
    visit["id"] = str(uuid.uuid4())
    # Auto-fill subcontractor_name from id if not provided
    if visit.get("subcontractor_id") and not visit.get("subcontractor_name"):
        sub = await db.vendors.find_one({"id": visit["subcontractor_id"]}, {"_id": 0})
        if sub:
            visit["subcontractor_name"] = sub.get("name", "")
    visits = list(existing.get("maintenance_visits") or [])
    visits.append(visit)
    # Re-run normalize via update_deal to recompute next_maintenance_date
    merged = {**existing, "maintenance_visits": visits, "maintenance_plan": True}
    # Strip server-managed before re-normalizing
    for k in ("id", "created_at", "_id", "is_deleted", "deleted_at", "deleted_by"):
        merged.pop(k, None)
    cleaned = normalize_deal(merged)
    await db.deals.update_one({"id": deal_id}, {"$set": cleaned})
    doc = await db.deals.find_one({"id": deal_id}, {"_id": 0})
    return scrub_deal(doc, current)


@api_router.delete("/deals/{deal_id}/maintenance-visits/{visit_id}", response_model=Deal)
async def delete_maintenance_visit(deal_id: str, visit_id: str, current=Depends(get_current_user)):
    existing = await db.deals.find_one({"id": deal_id, "is_deleted": {"$ne": True}})
    if not existing:
        raise HTTPException(status_code=404, detail="Project not found")
    if current.get("role") == "sales":
        owns = existing.get("assigned_to_user_id") == current["id"] or existing.get("created_by_user_id") == current["id"]
        if not owns:
            raise HTTPException(status_code=403, detail="Not your project")
    visits = [v for v in (existing.get("maintenance_visits") or []) if v.get("id") != visit_id]
    merged = {**existing, "maintenance_visits": visits}
    for k in ("id", "created_at", "_id", "is_deleted", "deleted_at", "deleted_by"):
        merged.pop(k, None)
    cleaned = normalize_deal(merged)
    await db.deals.update_one({"id": deal_id}, {"$set": cleaned})
    doc = await db.deals.find_one({"id": deal_id}, {"_id": 0})
    return scrub_deal(doc, current)


@api_router.get("/maintenance")
async def list_maintenance(current=Depends(get_current_user)):
    """Return all projects with maintenance_plan=True, with denormalized contact + property info."""
    query = {"is_deleted": {"$ne": True}, "maintenance_plan": True}
    if current.get("role") == "sales":
        query["$or"] = [{"assigned_to_user_id": current["id"]}, {"created_by_user_id": current["id"]}]
    deals = await db.deals.find(query, {"_id": 0}).sort("next_maintenance_date", 1).to_list(2000)
    today = datetime.now(timezone.utc).date().isoformat()
    soon_cutoff = (datetime.now(timezone.utc) + timedelta(days=30)).date().isoformat()
    out = []
    for d in deals:
        # Status
        nxt = d.get("next_maintenance_date") or ""
        if not nxt:
            status = "Unscheduled"
        elif nxt < today:
            status = "Overdue"
        elif nxt <= soon_cutoff:
            status = "Due Soon"
        else:
            status = "Upcoming"
        # Pull denormalized contact + property snippets
        contact_name = ""
        contact_phone = ""
        if d.get("customer_contact_id") or d.get("contact_id"):
            cid = d.get("customer_contact_id") or d.get("contact_id")
            cust = await db.contacts.find_one({"id": cid}, {"_id": 0})
            if cust:
                contact_name = cust.get("contact_name", "") or ""
                contact_phone = (cust.get("mobile_phone") or cust.get("phone") or cust.get("work_phone") or "").strip()
        property_name = ""
        property_address = ""
        if d.get("property_id"):
            prop = await db.properties.find_one({"id": d["property_id"]}, {"_id": 0})
            if prop:
                property_name = prop.get("property_name", "") or ""
                addr = prop.get("property_address", "") or ""
                city = prop.get("property_city", "") or ""
                st = prop.get("property_state", "") or ""
                zp = prop.get("property_zip", "") or ""
                tail = ", ".join([p for p in [city, st] if p])
                if zp:
                    tail = f"{tail} {zp}".strip()
                property_address = " · ".join([p for p in [addr, tail] if p])
        out.append({
            "id": d["id"],
            "title": d.get("title", ""),
            "contact_name": contact_name,
            "contact_phone": contact_phone,
            "property_name": property_name,
            "property_address": property_address,
            "maintenance_rate": d.get("maintenance_rate", 0),
            "maintenance_start_date": d.get("maintenance_start_date", ""),
            "last_maintenance_date": d.get("last_maintenance_date", ""),
            "next_maintenance_date": nxt,
            "status": status,
            "visit_count": len(d.get("maintenance_visits") or []),
        })
    return out


# ----- Invoices -----
# Number sequence seed: INV-2026-1100 (user-specified starting point)
INVOICE_SEQ_SEED = {"year": 2026, "next": 1100}


async def _next_invoice_number() -> str:
    """Atomic counter per year stored in `settings` collection (key=invoice_seq_{year})."""
    year = datetime.now(timezone.utc).year
    key = f"invoice_seq_{year}"
    seed = INVOICE_SEQ_SEED["next"] if year == INVOICE_SEQ_SEED["year"] else 1
    doc = await db.settings.find_one_and_update(
        {"key": key},
        {"$inc": {"value": 1}, "$setOnInsert": {"key": key}},
        upsert=True,
        return_document=True,
    )
    raw = doc.get("value", 1)
    # If we just inserted and value is 1 but year matches seed, jump to seed
    if year == INVOICE_SEQ_SEED["year"] and raw < INVOICE_SEQ_SEED["next"]:
        await db.settings.update_one({"key": key}, {"$set": {"value": INVOICE_SEQ_SEED["next"]}})
        raw = INVOICE_SEQ_SEED["next"]
    return f"INV-{year}-{raw:04d}"


def _recalc_invoice(inv: dict) -> dict:
    """Compute line-item amounts + subtotal + total + balance_due."""
    items = inv.get("line_items") or []
    sub = 0.0
    for it in items:
        if not it.get("id"):
            it["id"] = str(uuid.uuid4())
        try:
            qty = float(it.get("quantity") or 0)
            unit = float(it.get("unit_price") or 0)
        except (TypeError, ValueError):
            qty = 0.0
            unit = 0.0
        it["quantity"] = qty
        it["unit_price"] = unit
        it["amount"] = round(qty * unit, 2)
        sub += it["amount"]
    inv["line_items"] = items
    inv["subtotal"] = round(sub, 2)
    inv["total"] = round(sub, 2)  # no tax
    paid = float(inv.get("amount_paid") or 0)
    inv["amount_paid"] = round(paid, 2)
    inv["balance_due"] = round(inv["total"] - paid, 2)
    # Status auto-rules
    today_iso = datetime.now(timezone.utc).date().isoformat()
    status = inv.get("status", "Draft")
    if status not in ("Void", "Draft"):
        if inv["balance_due"] <= 0.01:
            status = "Paid"
        elif paid > 0:
            status = "Partial"
        elif inv.get("due_date") and inv["due_date"] < today_iso:
            status = "Overdue"
    inv["status"] = status
    return inv


async def _build_bill_to_from_contact(contact_id: str) -> dict:
    """Pull billing address snapshot from a contact, defaulting to primary address if billing_same."""
    if not contact_id:
        return {}
    c = await db.contacts.find_one({"id": contact_id}, {"_id": 0})
    if not c:
        return {}
    same = c.get("billing_same_as_address", True)
    if same:
        return {
            "bill_to_company": c.get("company_name", ""),
            "bill_to_name": c.get("contact_name", ""),
            "bill_to_address": c.get("address", ""),
            "bill_to_address_line2": c.get("address_line2", ""),
            "bill_to_city": c.get("city", ""),
            "bill_to_state": c.get("state", ""),
            "bill_to_zip": c.get("zip_code", ""),
            "bill_to_email": c.get("email", ""),
        }
    return {
        "bill_to_company": c.get("company_name", ""),
        "bill_to_name": c.get("contact_name", ""),
        "bill_to_address": c.get("billing_address", ""),
        "bill_to_address_line2": c.get("billing_address_line2", ""),
        "bill_to_city": c.get("billing_city", ""),
        "bill_to_state": c.get("billing_state", ""),
        "bill_to_zip": c.get("billing_zip", ""),
        "bill_to_email": c.get("email", ""),
    }


@api_router.get("/invoices")
async def list_invoices(status: Optional[str] = None, deal_id: Optional[str] = None, current=Depends(get_current_user)):
    query = {"is_deleted": {"$ne": True}}
    if status:
        query["status"] = status
    if deal_id:
        query["deal_id"] = deal_id
    if current.get("role") == "sales":
        query["created_by_user_id"] = current["id"]
    cursor = db.invoices.find(query, {"_id": 0}).sort("created_at", -1)
    items = await cursor.to_list(2000)
    return items


@api_router.post("/invoices", response_model=Invoice)
async def create_invoice(body: InvoiceIn, current=Depends(get_current_user)):
    data = body.model_dump()
    # Pre-fill bill-to from contact if not provided
    if data.get("customer_contact_id") and not data.get("bill_to_company") and not data.get("bill_to_name"):
        bt = await _build_bill_to_from_contact(data["customer_contact_id"])
        for k, v in bt.items():
            if not data.get(k):
                data[k] = v
    # Pre-fill project info if deal_id supplied
    if data.get("deal_id"):
        deal = await db.deals.find_one({"id": data["deal_id"]}, {"_id": 0})
        if deal:
            if not data.get("project_title"):
                data["project_title"] = deal.get("title", "")
            if not data.get("project_total"):
                # Use chosen_amount if set, else MID proposal option (typical buy point)
                pt = float(deal.get("chosen_amount", 0) or 0)
                if pt <= 0:
                    pt = proposal_mid_amount(deal)
                # Add approved change orders
                co_total = sum(
                    float(co.get("amount", 0) or 0)
                    for co in (deal.get("change_orders") or [])
                    if (co.get("status") or "Approved") == "Approved"
                )
                data["project_total"] = round(pt + co_total, 2)
            if not data.get("customer_contact_id"):
                data["customer_contact_id"] = deal.get("customer_contact_id") or deal.get("contact_id")
            # Auto-fill bill-to from deal's contact if still empty
            if not data.get("bill_to_company") and not data.get("bill_to_name") and data.get("customer_contact_id"):
                bt = await _build_bill_to_from_contact(data["customer_contact_id"])
                for k, v in bt.items():
                    if not data.get(k):
                        data[k] = v
            # Property address
            if not data.get("project_address") and deal.get("property_id"):
                prop = await db.properties.find_one({"id": deal["property_id"]}, {"_id": 0})
                if prop:
                    addr1 = " ".join([p for p in [prop.get("property_address", ""), prop.get("property_address_line2", "")] if p]).strip()
                    line2 = ", ".join([p for p in [prop.get("property_city", ""), prop.get("property_state", "")] if p])
                    if prop.get("property_zip"):
                        line2 = f"{line2} {prop.get('property_zip')}".strip()
                    data["project_address"] = "  ·  ".join([p for p in [addr1, line2] if p])
    # Defaults
    if not data.get("invoice_date"):
        data["invoice_date"] = datetime.now(timezone.utc).date().isoformat()
    if not data.get("due_date"):
        data["due_date"] = data["invoice_date"]  # "Due Upon Receipt"
    if not data.get("terms"):
        data["terms"] = "Due Upon Receipt"
    data = _recalc_invoice(data)
    data["id"] = str(uuid.uuid4())
    data["invoice_number"] = await _next_invoice_number()
    data["created_at"] = now_iso()
    data["created_by_user_id"] = current["id"]
    data["is_deleted"] = False
    await db.invoices.insert_one(data.copy())
    return strip_id(data)


@api_router.get("/invoices/{invoice_id}", response_model=Invoice)
async def get_invoice(invoice_id: str, current=Depends(get_current_user)):
    doc = await db.invoices.find_one({"id": invoice_id, "is_deleted": {"$ne": True}}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return doc


@api_router.put("/invoices/{invoice_id}", response_model=Invoice)
async def update_invoice(invoice_id: str, body: InvoiceIn, current=Depends(get_current_user)):
    existing = await db.invoices.find_one({"id": invoice_id, "is_deleted": {"$ne": True}}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Invoice not found")
    data = body.model_dump()
    # Preserve immutable fields
    data["id"] = existing["id"]
    data["invoice_number"] = existing["invoice_number"]
    data["created_at"] = existing["created_at"]
    data["created_by_user_id"] = existing.get("created_by_user_id")
    data["last_sent_at"] = existing.get("last_sent_at", "")
    data["pdf_generated_at"] = existing.get("pdf_generated_at", "")
    data = _recalc_invoice(data)
    await db.invoices.update_one({"id": invoice_id}, {"$set": data})
    return strip_id(data)


@api_router.delete("/invoices/{invoice_id}")
async def delete_invoice(invoice_id: str, current=Depends(get_current_user)):
    if is_admin(current):
        await db.invoices.delete_one({"id": invoice_id})
    else:
        await db.invoices.update_one({"id": invoice_id}, {"$set": {"is_deleted": True, "deleted_at": now_iso(), "deleted_by": current["id"]}})
    return {"ok": True}


@api_router.post("/invoices/from-milestone")
async def invoice_from_milestone(deal_id: str = Body(...), milestone_id: str = Body(...), current=Depends(get_current_user)):
    """Auto-generate a draft invoice for a single milestone of a deal."""
    deal = await db.deals.find_one({"id": deal_id, "is_deleted": {"$ne": True}}, {"_id": 0})
    if not deal:
        raise HTTPException(status_code=404, detail="Deal not found")
    ms = next((m for m in (deal.get("payment_milestones") or []) if m.get("id") == milestone_id), None)
    if not ms:
        raise HTTPException(status_code=404, detail="Milestone not found")
    body = InvoiceIn(
        deal_id=deal_id,
        customer_contact_id=deal.get("customer_contact_id") or deal.get("contact_id"),
        source_type="milestone",
        source_id=milestone_id,
        project_title=deal.get("title", ""),
        line_items=[InvoiceLineItem(description=f"{ms.get('label') or 'Project Milestone'} — {ms.get('percent', 0)}% of contract", quantity=1, unit_price=float(ms.get("amount") or 0))],
    )
    return await create_invoice(body, current)


@api_router.post("/invoices/from-maintenance-visit")
async def invoice_from_maintenance_visit(deal_id: str = Body(...), visit_id: str = Body(...), current=Depends(get_current_user)):
    """Auto-generate a draft invoice for a maintenance visit."""
    deal = await db.deals.find_one({"id": deal_id, "is_deleted": {"$ne": True}}, {"_id": 0})
    if not deal:
        raise HTTPException(status_code=404, detail="Deal not found")
    visit = next((v for v in (deal.get("maintenance_visits") or []) if v.get("id") == visit_id), None)
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found")
    visit_date = visit.get("visit_date", "")
    desc_bits = [f"Annual Maintenance Visit ({visit_date})" if visit_date else "Annual Maintenance Visit"]
    if visit.get("notes"):
        desc_bits.append(visit["notes"])
    body = InvoiceIn(
        deal_id=deal_id,
        customer_contact_id=deal.get("customer_contact_id") or deal.get("contact_id"),
        source_type="maintenance_visit",
        source_id=visit_id,
        project_title=deal.get("title", ""),
        invoice_date=visit_date or datetime.now(timezone.utc).date().isoformat(),
        line_items=[InvoiceLineItem(description=" — ".join(desc_bits), quantity=1, unit_price=float(visit.get("amount") or 0))],
    )
    return await create_invoice(body, current)


@api_router.get("/invoices/{invoice_id}/pdf")
async def invoice_pdf(invoice_id: str, token: Optional[str] = Query(None), authorization: Optional[str] = Header(None)):
    # Allow ?token= for browser downloads
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

    inv = await db.invoices.find_one({"id": invoice_id, "is_deleted": {"$ne": True}}, {"_id": 0})
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    from invoice_pdf import build_invoice_pdf
    pdf_bytes = build_invoice_pdf(inv)
    # Mark PDF generated
    await db.invoices.update_one({"id": invoice_id}, {"$set": {"pdf_generated_at": now_iso()}})
    fname = f"{inv['invoice_number']}.pdf"
    return Response(content=pdf_bytes, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{fname}"'})


@api_router.post("/invoices/{invoice_id}/email")
async def email_invoice(invoice_id: str, body: dict = Body(...), current=Depends(get_current_user)):
    """Send the invoice via Gmail SMTP with PDF attached. Marks invoice as Sent."""
    inv = await db.invoices.find_one({"id": invoice_id, "is_deleted": {"$ne": True}}, {"_id": 0})
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    to_email = (body.get("to_email") or inv.get("bill_to_email") or "").strip()
    cc_email = (body.get("cc_email") or inv.get("cc_email") or "").strip()
    if not to_email:
        raise HTTPException(status_code=400, detail="No recipient email — please provide one.")

    # Generate the PDF in-memory
    from invoice_pdf import build_invoice_pdf
    pdf_bytes = build_invoice_pdf(inv)

    # Compose email
    inv_num = inv.get("invoice_number", "")
    total = float(inv.get("total") or 0)
    balance = float(inv.get("balance_due") or 0)
    bill_to = inv.get("bill_to_company") or inv.get("bill_to_name") or "—"
    project = inv.get("project_title") or ""
    due_date = inv.get("due_date") or "Due upon receipt"

    subject = f"Invoice {inv_num} from SealTech Building Solutions"
    if project:
        subject += f" — {project}"

    body_text = (
        f"Hello,\n\n"
        f"Please find attached Invoice {inv_num} for {bill_to}.\n\n"
        f"  Total:        ${total:,.2f}\n"
        f"  Balance Due:  ${balance:,.2f}\n"
        f"  Due Date:     {due_date}\n"
        f"  Terms:        {inv.get('terms', 'Due Upon Receipt')}\n\n"
        f"Remit payment to:\n"
        f"  SealTech Building Solutions\n"
        f"  2278 Mannatt Ct, Castle Rock, CO 80104\n\n"
        f"If you have any questions, please reply to this email.\n\n"
        f"Thank you for your business,\n"
        f"SealTech Building Solutions\n"
        f"720-715-9955  ·  info@sealtechbuildingsolutions.com"
    )

    body_html = f"""
    <html><body style="font-family: Arial, Helvetica, sans-serif; color: #0A0A0A; max-width: 620px;">
      <p style="margin: 0 0 16px;">Hello,</p>
      <p style="margin: 0 0 16px;">Please find attached <b>Invoice {inv_num}</b> for {bill_to}.</p>
      <table style="border-collapse: collapse; margin: 16px 0;">
        <tr><td style="padding: 4px 16px 4px 0; color: #52525B; font-size: 13px;">Total</td><td style="padding: 4px 0; font-weight: bold; font-family: monospace;">${total:,.2f}</td></tr>
        <tr><td style="padding: 4px 16px 4px 0; color: #52525B; font-size: 13px;">Balance Due</td><td style="padding: 4px 0; font-weight: bold; font-family: monospace; color: #1D4ED8;">${balance:,.2f}</td></tr>
        <tr><td style="padding: 4px 16px 4px 0; color: #52525B; font-size: 13px;">Due Date</td><td style="padding: 4px 0; font-family: monospace;">{due_date}</td></tr>
        <tr><td style="padding: 4px 16px 4px 0; color: #52525B; font-size: 13px;">Terms</td><td style="padding: 4px 0;">{inv.get('terms', 'Due Upon Receipt')}</td></tr>
      </table>
      <p style="margin: 16px 0 8px; color: #52525B; font-size: 13px;"><b>Remit payment to:</b></p>
      <p style="margin: 0 0 16px; line-height: 1.5;">
        SealTech Building Solutions<br/>
        2278 Mannatt Ct, Castle Rock, CO 80104
      </p>
      <p style="margin: 16px 0;">If you have any questions, please reply to this email.</p>
      <p style="margin: 24px 0 0; padding-top: 16px; border-top: 1px solid #E4E4E7; color: #52525B; font-size: 12px;">
        <b style="color: #0A0A0A;">SealTech Building Solutions</b><br/>
        720-715-9955  ·  info@sealtechbuildingsolutions.com  ·  www.sealtechbuildingsolutions.com
      </p>
    </body></html>
    """

    try:
        from email_sender import send_email, EmailNotConfigured
        result = send_email(
            to=to_email,
            cc=cc_email,
            subject=subject,
            body_text=body_text,
            body_html=body_html,
            reply_to=os.environ.get("GMAIL_FROM_EMAIL") or None,
            attachments=[{"filename": f"{inv_num}.pdf", "data": pdf_bytes, "mime": "application/pdf"}],
        )
    except EmailNotConfigured as e:
        raise HTTPException(status_code=500, detail=str(e))
    except smtplib.SMTPAuthenticationError as e:
        raise HTTPException(status_code=500, detail=f"Gmail authentication failed — check the App Password. ({e.smtp_code}: {e.smtp_error.decode() if e.smtp_error else ''})")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Email send failed: {type(e).__name__}: {e}")

    # Mark invoice as Sent (preserves Paid/Partial)
    patch = {
        "bill_to_email": to_email,
        "cc_email": cc_email,
        "last_sent_at": now_iso(),
    }
    if inv.get("status") in ("Draft", "Overdue"):
        patch["status"] = "Sent"
    await db.invoices.update_one({"id": invoice_id}, {"$set": patch})

    return {
        "ok": True,
        "mocked": False,
        "message": f"Invoice {inv_num} emailed to {to_email}" + (f" (cc: {cc_email})" if cc_email else ""),
        "to_email": to_email,
        "cc_email": cc_email,
        "message_id": result.get("message_id"),
    }


# ----- Vendor Bills (Payables) -----
def _recalc_bill(bill: dict) -> dict:
    """Compute subtotal/total from line items, and auto-fill due_date from terms if missing."""
    items = bill.get("line_items") or []
    sub = 0.0
    for it in items:
        if not it.get("id"):
            it["id"] = str(uuid.uuid4())
        try:
            qty = float(it.get("quantity") or 0)
            unit = float(it.get("unit_price") or 0)
        except (TypeError, ValueError):
            qty = 0.0
            unit = 0.0
        amt = float(it.get("amount") or 0)
        if not amt and qty and unit:
            amt = round(qty * unit, 2)
        it["quantity"] = qty
        it["unit_price"] = unit
        it["amount"] = round(amt, 2)
        sub += it["amount"]
    bill["line_items"] = items
    # If user provided a total, keep it; else compute from line items + tax + shipping
    if not float(bill.get("total") or 0):
        tax = float(bill.get("tax") or 0)
        shipping = float(bill.get("shipping") or 0)
        bill["subtotal"] = round(sub, 2)
        bill["total"] = round(sub + tax + shipping, 2)
    # Auto-fill paid_amount when status = Paid
    if (bill.get("status") or "").lower() == "paid":
        total = float(bill.get("total") or 0)
        paid = float(bill.get("paid_amount") or 0)
        if paid < total - 0.01:
            bill["paid_amount"] = total
        if not bill.get("paid_date"):
            bill["paid_date"] = datetime.now(timezone.utc).date().isoformat()
    # Auto-compute due_date from terms when missing
    if not bill.get("due_date") and bill.get("bill_date"):
        try:
            base = datetime.fromisoformat(bill["bill_date"][:10]).date()
            terms = (bill.get("terms") or "").lower()
            days = 0
            if "net" in terms:
                m = re.search(r"net\s*(\d+)", terms)
                if m:
                    days = int(m.group(1))
            if days > 0:
                bill["due_date"] = (base + timedelta(days=days)).isoformat()
            else:
                bill["due_date"] = base.isoformat()
        except (ValueError, TypeError):
            pass
    return bill


@api_router.get("/vendor-bills")
async def list_vendor_bills(status: Optional[str] = None, vendor_id: Optional[str] = None, project_id: Optional[str] = None, current=Depends(get_current_user)):
    query = {"is_deleted": {"$ne": True}}
    if status:
        query["status"] = status
    if vendor_id:
        query["vendor_id"] = vendor_id
    if project_id:
        query["line_items.project_id"] = project_id
    if current.get("role") == "sales":
        query["created_by_user_id"] = current["id"]
    items = await db.vendor_bills.find(query, {"_id": 0}).sort("bill_date", -1).to_list(2000)
    return items


@api_router.post("/vendor-bills", response_model=VendorBill)
async def create_vendor_bill(body: VendorBillIn, current=Depends(get_current_user)):
    data = body.model_dump()
    # Snapshot vendor name from vendor_id if missing
    if data.get("vendor_id") and not data.get("vendor_name"):
        v = await db.vendors.find_one({"id": data["vendor_id"]}, {"_id": 0})
        if v:
            data["vendor_name"] = v.get("name", "")
    # Snapshot project titles on each line item
    for li in data.get("line_items", []) or []:
        if li.get("project_id") and not li.get("project_title"):
            d = await db.deals.find_one({"id": li["project_id"]}, {"_id": 0})
            if d:
                li["project_title"] = d.get("title", "")
    if not data.get("received_date"):
        data["received_date"] = datetime.now(timezone.utc).date().isoformat()
    data = _recalc_bill(data)
    data["id"] = str(uuid.uuid4())
    data["created_at"] = now_iso()
    data["created_by_user_id"] = current["id"]
    data["is_deleted"] = False
    await db.vendor_bills.insert_one(data.copy())
    return strip_id(data)


@api_router.get("/vendor-bills/{bill_id}", response_model=VendorBill)
async def get_vendor_bill(bill_id: str, current=Depends(get_current_user)):
    doc = await db.vendor_bills.find_one({"id": bill_id, "is_deleted": {"$ne": True}}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Bill not found")
    return doc


@api_router.put("/vendor-bills/{bill_id}", response_model=VendorBill)
async def update_vendor_bill(bill_id: str, body: VendorBillIn, current=Depends(get_current_user)):
    existing = await db.vendor_bills.find_one({"id": bill_id, "is_deleted": {"$ne": True}}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Bill not found")
    data = body.model_dump()
    # Snapshot project titles
    for li in data.get("line_items", []) or []:
        if li.get("project_id") and not li.get("project_title"):
            d = await db.deals.find_one({"id": li["project_id"]}, {"_id": 0})
            if d:
                li["project_title"] = d.get("title", "")
    data["id"] = existing["id"]
    data["created_at"] = existing["created_at"]
    data["created_by_user_id"] = existing.get("created_by_user_id")
    data = _recalc_bill(data)
    await db.vendor_bills.update_one({"id": bill_id}, {"$set": data})
    return strip_id(data)


@api_router.delete("/vendor-bills/{bill_id}")
async def delete_vendor_bill(bill_id: str, current=Depends(get_current_user)):
    if is_admin(current):
        await db.vendor_bills.delete_one({"id": bill_id})
    else:
        await db.vendor_bills.update_one({"id": bill_id}, {"$set": {"is_deleted": True, "deleted_at": now_iso(), "deleted_by": current["id"]}})
    return {"ok": True}


@api_router.post("/vendor-bills/parse")
async def parse_vendor_bill(file: UploadFile = File(...), current=Depends(get_current_user)):
    """Upload a vendor invoice (PDF/image), parse with Gemini Vision, return suggested structured data
    + suggested vendor match + suggested project matches per line item.
    Does NOT save anything — the frontend opens an editor pre-filled for user review."""
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(raw) > 25 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large (max 25 MB)")
    try:
        from vendor_bill_parser import parse_invoice_bytes
        parsed = await parse_invoice_bytes(raw, file.filename or "invoice.pdf", file.content_type)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Parse failed: {type(e).__name__}: {e}")

    # Match vendor
    suggested_vendor_id = None
    vname = (parsed.get("vendor_name") or "").strip().lower()
    if vname:
        all_vendors = await db.vendors.find({"is_deleted": {"$ne": True}}, {"_id": 0, "id": 1, "name": 1}).to_list(500)
        # Exact match first
        for v in all_vendors:
            if (v.get("name") or "").strip().lower() == vname:
                suggested_vendor_id = v["id"]
                break
        # Substring match fallback
        if not suggested_vendor_id:
            for v in all_vendors:
                vn = (v.get("name") or "").strip().lower()
                if vn and (vn in vname or vname in vn):
                    suggested_vendor_id = v["id"]
                    break

    # Match projects against PO number / line item description
    suggested_project_matches = {}
    deals = await db.deals.find({"is_deleted": {"$ne": True}}, {"_id": 0, "id": 1, "title": 1}).to_list(1000)
    po = (parsed.get("po_number") or "").strip().lower()
    for i, line in enumerate(parsed.get("line_items") or []):
        desc_l = (line.get("description") or "").lower()
        haystack = f"{desc_l} {po}".strip()
        if not haystack:
            continue
        for d in deals:
            t = (d.get("title") or "").strip().lower()
            if not t:
                continue
            if t in haystack:
                suggested_project_matches[str(i)] = d["id"]
                break

    # Upload the file to object storage so it's available as an attachment
    attached_file_id = None
    try:
        ext = (file.filename.rsplit(".", 1)[-1] if file.filename and "." in file.filename else "pdf").lower()
        file_id = str(uuid.uuid4())
        storage_path = f"{APP_NAME}/uploads/vendor_bill/pending/{file_id}.{ext}"
        put_result = put_object(storage_path, raw, file.content_type or "application/pdf")
        await db.files.insert_one({
            "id": file_id,
            "parent_type": "vendor_bill",
            "parent_id": "pending",
            "category": "Invoice",
            "storage_path": put_result["path"],
            "original_filename": file.filename or "invoice.pdf",
            "content_type": file.content_type or "application/pdf",
            "size": len(raw),
            "is_deleted": False,
            "uploaded_by": current["id"],
            "created_at": now_iso(),
        })
        attached_file_id = file_id
    except Exception as e:
        logger.warning(f"Vendor bill PDF stash failed: {e}")
        attached_file_id = None

    return {
        "parsed": parsed,
        "suggested_vendor_id": suggested_vendor_id,
        "suggested_project_matches": suggested_project_matches,
        "attached_file_id": attached_file_id,
    }


@api_router.get("/payables/report")
async def payables_report(current=Depends(get_current_user)):
    """List bills due within the next 7 days plus all currently overdue, grouped by vendor."""
    today = datetime.now(timezone.utc).date()
    horizon = today + timedelta(days=7)
    today_iso = today.isoformat()
    horizon_iso = horizon.isoformat()

    query = {
        "is_deleted": {"$ne": True},
        "status": {"$in": ["Pending", "Approved"]},
    }
    if current.get("role") == "sales":
        query["created_by_user_id"] = current["id"]
    bills = await db.vendor_bills.find(query, {"_id": 0}).to_list(2000)

    overdue = []
    due_this_week = []
    for b in bills:
        dd = (b.get("due_date") or "")[:10]
        if not dd:
            continue
        if dd < today_iso:
            overdue.append(b)
        elif dd <= horizon_iso:
            due_this_week.append(b)

    def group_by_vendor(bs):
        groups = {}
        for b in bs:
            key = b.get("vendor_id") or b.get("vendor_name") or "Unknown"
            grp = groups.setdefault(key, {"vendor_id": b.get("vendor_id"), "vendor_name": b.get("vendor_name") or "Unknown", "bills": [], "total": 0.0})
            grp["bills"].append(b)
            grp["total"] += float(b.get("total") or 0) - float(b.get("paid_amount") or 0)
        rows = list(groups.values())
        for r in rows:
            r["total"] = round(r["total"], 2)
            r["bills"].sort(key=lambda x: (x.get("due_date") or ""))
        rows.sort(key=lambda x: -x["total"])
        return rows

    overdue.sort(key=lambda b: (b.get("due_date") or ""))
    due_this_week.sort(key=lambda b: (b.get("due_date") or ""))
    return {
        "today": today_iso,
        "horizon": horizon_iso,
        "overdue": group_by_vendor(overdue),
        "due_this_week": group_by_vendor(due_this_week),
        "overdue_count": len(overdue),
        "due_this_week_count": len(due_this_week),
        "overdue_total": round(sum(float(b.get("total") or 0) - float(b.get("paid_amount") or 0) for b in overdue), 2),
        "due_this_week_total": round(sum(float(b.get("total") or 0) - float(b.get("paid_amount") or 0) for b in due_this_week), 2),
    }


@api_router.get("/payables/report.{fmt}")
async def payables_report_export(fmt: str, current=Depends(get_current_user)):
    """Export the payables report as Excel or PDF."""
    report = await payables_report(current)
    if fmt == "xlsx":
        from openpyxl import Workbook
        from openpyxl.styles import Font, PatternFill, Alignment
        wb = Workbook()
        ws = wb.active
        ws.title = "Payables"
        headers = ["Bucket", "Vendor", "Bill #", "Bill Date", "Due Date", "Terms", "Total", "Paid", "Balance"]
        ws.append(headers)
        for cell in ws[1]:
            cell.font = Font(bold=True, color="FFFFFF", size=11)
            cell.fill = PatternFill("solid", fgColor="B91C1C")
            cell.alignment = Alignment(horizontal="left")
        # Overdue
        for grp in report["overdue"]:
            for b in grp["bills"]:
                ws.append(["OVERDUE", grp["vendor_name"], b.get("bill_number", ""), b.get("bill_date", ""), b.get("due_date", ""), b.get("terms", ""), float(b.get("total") or 0), float(b.get("paid_amount") or 0), round(float(b.get("total") or 0) - float(b.get("paid_amount") or 0), 2)])
        for grp in report["due_this_week"]:
            for b in grp["bills"]:
                ws.append(["DUE THIS WEEK", grp["vendor_name"], b.get("bill_number", ""), b.get("bill_date", ""), b.get("due_date", ""), b.get("terms", ""), float(b.get("total") or 0), float(b.get("paid_amount") or 0), round(float(b.get("total") or 0) - float(b.get("paid_amount") or 0), 2)])
        ws.freeze_panes = "A2"
        for i in range(1, 10):
            ws.column_dimensions[ws.cell(row=1, column=i).column_letter].width = 18
        buf = BytesIO()
        wb.save(buf)
        return Response(content=buf.getvalue(), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": 'attachment; filename="sealtech-payables.xlsx"'})
    raise HTTPException(status_code=400, detail="Use fmt=xlsx")


@api_router.post("/payables/email")
async def email_payables_report(body: dict = Body(default={}), current=Depends(get_current_user)):
    """Manually trigger a 'this week's payables' email to the user (or any address provided)."""
    to_email = (body.get("to_email") or os.environ.get("GMAIL_FROM_EMAIL") or "").strip()
    if not to_email:
        raise HTTPException(status_code=400, detail="Recipient email required")
    report = await payables_report(current)
    # Build the email
    try:
        from email_sender import send_email
        html = _render_payables_email_html(report)
        text = _render_payables_email_text(report)
        result = send_email(
            to=to_email,
            subject=f"SealTech Payables — Week of {report['today']} — {report['overdue_count']} overdue · {report['due_this_week_count']} due",
            body_text=text,
            body_html=html,
        )
        return {"ok": True, "message_id": result.get("message_id"), "to": to_email}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Email failed: {type(e).__name__}: {e}")


def _render_payables_email_text(report: dict) -> str:
    lines = [
        f"SealTech Payables — Week of {report['today']}",
        "",
        f"OVERDUE ({report['overdue_count']} bills · ${report['overdue_total']:,.2f})",
    ]
    for grp in report["overdue"]:
        lines.append(f"  {grp['vendor_name']}  ${grp['total']:,.2f}")
        for b in grp["bills"]:
            balance = float(b.get("total") or 0) - float(b.get("paid_amount") or 0)
            lines.append(f"    - {b.get('bill_number') or '-'}  due {b.get('due_date')}  ${balance:,.2f}")
    lines += ["", f"DUE THIS WEEK ({report['due_this_week_count']} bills · ${report['due_this_week_total']:,.2f})"]
    for grp in report["due_this_week"]:
        lines.append(f"  {grp['vendor_name']}  ${grp['total']:,.2f}")
        for b in grp["bills"]:
            balance = float(b.get("total") or 0) - float(b.get("paid_amount") or 0)
            lines.append(f"    - {b.get('bill_number') or '-'}  due {b.get('due_date')}  ${balance:,.2f}")
    return "\n".join(lines)


def _render_payables_email_html(report: dict) -> str:
    def grp_table(grps, color="#B91C1C"):
        if not grps:
            return '<p style="color:#52525B; font-style:italic;">None</p>'
        rows = []
        for grp in grps:
            rows.append(f'<tr style="background:#F4F4F5;"><td colspan="3" style="padding:8px 12px; font-weight:bold; color:{color};">{grp["vendor_name"]}</td><td style="padding:8px 12px; text-align:right; font-weight:bold; font-family:monospace;">${grp["total"]:,.2f}</td></tr>')
            for b in grp["bills"]:
                balance = float(b.get("total") or 0) - float(b.get("paid_amount") or 0)
                rows.append(f'<tr><td style="padding:6px 12px; padding-left:24px; font-size:13px;">{b.get("bill_number") or "—"}</td><td style="padding:6px 12px; font-size:13px; color:#52525B;">{b.get("bill_date") or "—"}</td><td style="padding:6px 12px; font-size:13px; color:#52525B;">Due {b.get("due_date") or "—"}</td><td style="padding:6px 12px; text-align:right; font-family:monospace;">${balance:,.2f}</td></tr>')
        return f'<table style="width:100%; border-collapse:collapse; margin:8px 0;"><thead><tr style="border-bottom:1px solid #E4E4E7;"><th style="text-align:left; padding:6px 12px; font-size:10px; color:#52525B; text-transform:uppercase; letter-spacing:1px;">Bill #</th><th style="text-align:left; padding:6px 12px; font-size:10px; color:#52525B; text-transform:uppercase; letter-spacing:1px;">Date</th><th style="text-align:left; padding:6px 12px; font-size:10px; color:#52525B; text-transform:uppercase; letter-spacing:1px;">Due</th><th style="text-align:right; padding:6px 12px; font-size:10px; color:#52525B; text-transform:uppercase; letter-spacing:1px;">Balance</th></tr></thead><tbody>{"".join(rows)}</tbody></table>'

    return f"""<html><body style="font-family: Arial, Helvetica, sans-serif; color:#0A0A0A; max-width:720px; margin:0 auto; padding:20px;">
<div style="border-bottom:3px solid #1D4ED8; padding-bottom:12px; margin-bottom:20px;">
  <div style="font-size:10px; font-weight:bold; letter-spacing:3px; color:#A0703A; text-transform:uppercase;">Weekly Payables</div>
  <h1 style="font-size:24px; margin:4px 0 0;">Bills to Pay — {report['today']}</h1>
</div>
<div style="display:flex; gap:16px; margin-bottom:20px;">
  <div style="flex:1; border:1px solid #E4E4E7; padding:16px;">
    <div style="font-size:10px; color:#52525B; text-transform:uppercase; letter-spacing:1px;">Overdue</div>
    <div style="font-size:24px; font-weight:bold; color:#B91C1C;">${report['overdue_total']:,.2f}</div>
    <div style="font-size:11px; color:#52525B;">{report['overdue_count']} bills</div>
  </div>
  <div style="flex:1; border:1px solid #E4E4E7; padding:16px;">
    <div style="font-size:10px; color:#52525B; text-transform:uppercase; letter-spacing:1px;">Due This Week</div>
    <div style="font-size:24px; font-weight:bold; color:#A0703A;">${report['due_this_week_total']:,.2f}</div>
    <div style="font-size:11px; color:#52525B;">{report['due_this_week_count']} bills</div>
  </div>
</div>
<h2 style="color:#B91C1C; font-size:14px; text-transform:uppercase; letter-spacing:2px; margin:20px 0 4px;">Overdue</h2>
{grp_table(report['overdue'], color='#B91C1C')}
<h2 style="color:#A0703A; font-size:14px; text-transform:uppercase; letter-spacing:2px; margin:24px 0 4px;">Due This Week (Next 7 Days)</h2>
{grp_table(report['due_this_week'], color='#A0703A')}
<p style="margin-top:24px; padding-top:16px; border-top:1px solid #E4E4E7; color:#52525B; font-size:11px;">
  SealTech Building Solutions  -  720-715-9955  -  finance@sealtechsolutions.co
</p>
</body></html>"""


# ----- Vendors -----
@api_router.get("/vendors", response_model=List[Vendor])
async def list_vendors(kind: Optional[str] = None, current=Depends(get_current_user)):
    query = {"is_deleted": {"$ne": True}}
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


# ----- Spec Sheet -----
@api_router.get("/deals/{deal_id}/spec-sheet.pdf")
async def deal_spec_sheet(
    deal_id: str,
    token: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    # Auth (Bearer header OR ?token= for browser links)
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

    deal = await db.deals.find_one({"id": deal_id, "is_deleted": {"$ne": True}}, {"_id": 0})
    if not deal:
        raise HTTPException(status_code=404, detail="Project not found")

    # Build address from linked property
    project_address = "—"
    if deal.get("property_id"):
        prop = await db.properties.find_one({"id": deal["property_id"]}, {"_id": 0})
        if prop:
            parts = [prop.get("property_address", ""), prop.get("property_address_line2", "")]
            line1 = " ".join([p for p in parts if p]).strip()
            city = prop.get("property_city", "")
            st = prop.get("property_state", "")
            zp = prop.get("property_zip", "")
            line2 = ", ".join([p for p in [city, st] if p]).strip()
            if zp:
                line2 = f"{line2} {zp}".strip()
            project_address = "  ·  ".join([p for p in [line1, line2] if p]).strip() or "—"

    # Fetch customer contact (name + best phone) for personalization
    contact_name = ""
    contact_phone = ""
    customer_id = deal.get("customer_contact_id") or deal.get("contact_id")
    if customer_id:
        cust = await db.contacts.find_one({"id": customer_id}, {"_id": 0})
        if cust:
            contact_name = cust.get("contact_name", "") or ""
            contact_phone = (cust.get("mobile_phone") or cust.get("phone") or cust.get("work_phone") or "").strip()

    product_desc = deal.get("product_description") or f"{deal.get('proposed_roof_type','Silicone')} Roof System Over Existing {deal.get('current_roof_type','')}".strip()
    color = deal.get("warranty_color") or "white"

    data = {
        "contact_name": contact_name,
        "contact_phone": contact_phone,
        "project_address": project_address,
        "product_type": product_desc,
        "date": datetime.now(timezone.utc).strftime("%m/%d/%Y"),
        "opt_20": float(deal.get("proposal_option_1") or 0),
        "opt_15": float(deal.get("proposal_option_2") or 0),
        "opt_10": float(deal.get("proposal_option_3") or 0),
        "w20": float(deal.get("warranty_20yr_add") or 0),
        "w15": float(deal.get("warranty_15yr_add") or 0),
        "w10": float(deal.get("warranty_10yr_add") or 0),
        "total_sqft": float(deal.get("total_sqft") or 0),
        "color": color,
        "roof_type_label": (deal.get("proposed_roof_type") or "silicone").lower(),
    }

    # Fetch cover photo if set
    photo_bytes = None
    cover_id = deal.get("cover_photo_file_id")
    if cover_id:
        rec = await db.files.find_one({"id": cover_id, "is_deleted": False})
        if rec:
            try:
                photo_bytes, _ = get_object(rec["storage_path"])
            except Exception:
                photo_bytes = None

    pdf_bytes = build_silicone_spec(data, cover_photo_bytes=photo_bytes)
    filename = f"sealtech-scope-{(deal.get('title') or 'project')}.pdf".replace(" ", "_")
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


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


@api_router.get("/maintenance/export.{fmt}")
async def export_maintenance(fmt: str, current=Depends(get_current_user)):
    """Export the maintenance customer list to Excel or PDF."""
    rows = await list_maintenance(current)
    headers = ["Customer", "Phone", "Property", "Property Address", "Annual Rate", "Start Date", "Last Visit", "Next Due", "Status", "Visits"]
    data_rows = []
    for r in rows:
        data_rows.append([
            r.get("contact_name", ""),
            r.get("contact_phone", ""),
            r.get("property_name", ""),
            r.get("property_address", ""),
            float(r.get("maintenance_rate", 0) or 0),
            r.get("maintenance_start_date", ""),
            r.get("last_maintenance_date", ""),
            r.get("next_maintenance_date", ""),
            r.get("status", ""),
            r.get("visit_count", 0),
        ])
    if fmt == "xlsx":
        from openpyxl import Workbook
        from openpyxl.styles import Font, PatternFill, Alignment
        wb = Workbook()
        ws = wb.active
        ws.title = "Maintenance"
        ws.append(headers)
        for cell in ws[1]:
            cell.font = Font(bold=True, color="FFFFFF", size=11)
            cell.fill = PatternFill("solid", fgColor="1D4ED8")
            cell.alignment = Alignment(horizontal="left", vertical="center")
        for row in data_rows:
            ws.append(row)
        for col_idx, hdr in enumerate(headers, 1):
            max_len = len(str(hdr))
            for cell in ws.iter_cols(min_col=col_idx, max_col=col_idx, min_row=1, values_only=True):
                for v in cell:
                    max_len = max(max_len, min(len(str(v) if v is not None else ""), 40))
            ws.column_dimensions[ws.cell(row=1, column=col_idx).column_letter].width = max_len + 2
        ws.freeze_panes = "A2"
        buf = BytesIO()
        wb.save(buf)
        return Response(
            content=buf.getvalue(),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": 'attachment; filename="sealtech-maintenance.xlsx"'},
        )
    if fmt == "pdf":
        from reportlab.lib import colors as rl_colors
        from reportlab.lib.pagesizes import letter as rl_letter, landscape
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle as RLPS
        from reportlab.lib.units import inch as rl_inch
        from reportlab.platypus import SimpleDocTemplate, Table as RLTable, TableStyle as RLTableStyle, Paragraph as RLP, Spacer as RLSpacer
        buf = BytesIO()
        doc = SimpleDocTemplate(buf, pagesize=landscape(rl_letter), leftMargin=0.4 * rl_inch, rightMargin=0.4 * rl_inch, topMargin=0.5 * rl_inch, bottomMargin=0.5 * rl_inch)
        styles = getSampleStyleSheet()
        title_style = RLPS("title", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=18, textColor=rl_colors.HexColor("#0A0A0A"))
        eyebrow = RLPS("eyebrow", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=8, textColor=rl_colors.HexColor("#1D4ED8"), leading=10)
        body = RLPS("body", parent=styles["Normal"], fontName="Helvetica", fontSize=8, textColor=rl_colors.HexColor("#27272A"))
        story = [
            RLP("SEALTECH CRM EXPORT", eyebrow),
            RLP("Maintenance Customers", title_style),
            RLSpacer(1, 0.15 * rl_inch),
        ]
        table_data = [headers]
        for row in data_rows:
            display = []
            for i, v in enumerate(row):
                if i == 4:
                    display.append(RLP(f"${float(v):,.0f}" if v else "—", body))
                else:
                    display.append(RLP(str(v) if v not in (None, "") else "—", body))
            table_data.append(display)
        if len(table_data) == 1:
            story.append(RLP("No maintenance plans yet.", body))
        else:
            tbl = RLTable(table_data, repeatRows=1)
            tbl.setStyle(RLTableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), rl_colors.HexColor("#1D4ED8")),
                ("TEXTCOLOR", (0, 0), (-1, 0), rl_colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, 0), 8),
                ("BOTTOMPADDING", (0, 0), (-1, 0), 8),
                ("TOPPADDING", (0, 0), (-1, 0), 8),
                ("GRID", (0, 0), (-1, -1), 0.25, rl_colors.HexColor("#E4E4E7")),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [rl_colors.white, rl_colors.HexColor("#FAFAFA")]),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
            ]))
            story.append(tbl)
        doc.build(story)
        return Response(
            content=buf.getvalue(),
            media_type="application/pdf",
            headers={"Content-Disposition": 'attachment; filename="sealtech-maintenance.pdf"'},
        )
    raise HTTPException(status_code=400, detail="Unsupported format (use xlsx or pdf)")


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


# ----- Materials Catalog -----
@api_router.get("/materials")
async def list_materials(category: Optional[str] = None, current=Depends(get_current_user)):
    query = {"is_deleted": {"$ne": True}}
    if category and category != "All":
        query["category"] = category
    items = await db.materials.find(query, {"_id": 0}).sort("name", 1).to_list(5000)
    return items


@api_router.post("/materials", response_model=Material)
async def create_material(body: MaterialIn, current=Depends(get_current_user)):
    data = body.model_dump()
    if data.get("vendor_id") and not data.get("vendor_name"):
        v = await db.vendors.find_one({"id": data["vendor_id"]}, {"_id": 0})
        if v:
            data["vendor_name"] = v.get("name", "")
    data["id"] = str(uuid.uuid4())
    data["created_at"] = now_iso()
    data["updated_at"] = now_iso()
    data["is_deleted"] = False
    await db.materials.insert_one(data.copy())
    return strip_id(data)


@api_router.put("/materials/{material_id}", response_model=Material)
async def update_material(material_id: str, body: MaterialIn, current=Depends(get_current_user)):
    existing = await db.materials.find_one({"id": material_id, "is_deleted": {"$ne": True}}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Material not found")
    data = body.model_dump()
    if data.get("vendor_id") and not data.get("vendor_name"):
        v = await db.vendors.find_one({"id": data["vendor_id"]}, {"_id": 0})
        if v:
            data["vendor_name"] = v.get("name", "")
    data["id"] = existing["id"]
    data["created_at"] = existing.get("created_at")
    data["updated_at"] = now_iso()
    await db.materials.update_one({"id": material_id}, {"$set": data})
    return strip_id(data)


@api_router.delete("/materials/{material_id}")
async def delete_material(material_id: str, current=Depends(get_current_user)):
    if is_admin(current):
        await db.materials.delete_one({"id": material_id})
    else:
        await db.materials.update_one({"id": material_id}, {"$set": {"is_deleted": True, "deleted_at": now_iso(), "deleted_by": current["id"]}})
    return {"ok": True}


@api_router.post("/materials/bulk-import")
async def bulk_import_materials(file: UploadFile = File(...), current=Depends(get_current_user)):
    """Import materials from CSV or Excel. Required columns: name (rest optional)."""
    raw = await file.read()
    try:
        import pandas as pd
        from io import BytesIO as _BIO
        if (file.filename or "").lower().endswith(".csv"):
            df = pd.read_csv(_BIO(raw))
        else:
            df = pd.read_excel(_BIO(raw))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to read file: {e}")

    # Normalize column names (lowercase + strip)
    df.columns = [str(c).strip().lower().replace(" ", "_") for c in df.columns]
    if "name" not in df.columns:
        raise HTTPException(status_code=400, detail="CSV must include a 'name' column")

    # Match vendors by name (case-insensitive)
    vendors = await db.vendors.find({"is_deleted": {"$ne": True}}, {"_id": 0, "id": 1, "name": 1}).to_list(500)
    vendor_lookup = {(v.get("name") or "").strip().lower(): v["id"] for v in vendors}

    created = 0
    updated = 0
    skipped = 0
    for _, row in df.iterrows():
        name = str(row.get("name", "") or "").strip()
        if not name:
            skipped += 1
            continue
        sku = str(row.get("sku", "") or "").strip()
        category = str(row.get("category", "") or "Other").strip() or "Other"
        unit = str(row.get("unit", "") or "each").strip() or "each"
        try:
            price = float(row.get("default_price") or row.get("price") or 0)
        except (TypeError, ValueError):
            price = 0.0
        try:
            shipping_pct = float(row.get("shipping_pct") or row.get("shipping%") or 0)
        except (TypeError, ValueError):
            shipping_pct = 0.0
        try:
            markup_pct = float(row.get("markup_pct") or row.get("markup%") or 0)
        except (TypeError, ValueError):
            markup_pct = 0.0
        vendor_name = str(row.get("preferred_vendor", "") or row.get("vendor", "") or "").strip()
        vendor_id = vendor_lookup.get(vendor_name.lower()) if vendor_name else None
        notes = str(row.get("notes", "") or "").strip()

        # Find existing by SKU (preferred) or name
        existing = None
        if sku:
            existing = await db.materials.find_one({"sku": sku, "is_deleted": {"$ne": True}}, {"_id": 0})
        if not existing:
            existing = await db.materials.find_one({"name": name, "is_deleted": {"$ne": True}}, {"_id": 0})

        doc = {
            "sku": sku,
            "name": name,
            "category": category,
            "unit": unit,
            "default_price": price,
            "shipping_pct": shipping_pct,
            "markup_pct": markup_pct,
            "vendor_id": vendor_id,
            "vendor_name": vendor_name,
            "notes": notes,
            "updated_at": now_iso(),
        }
        if existing:
            await db.materials.update_one({"id": existing["id"]}, {"$set": doc})
            updated += 1
        else:
            doc["id"] = str(uuid.uuid4())
            doc["created_at"] = now_iso()
            doc["is_deleted"] = False
            await db.materials.insert_one(doc)
            created += 1
    return {"created": created, "updated": updated, "skipped": skipped}


@api_router.get("/materials/export.xlsx")
async def export_materials(current=Depends(get_current_user)):
    items = await db.materials.find({"is_deleted": {"$ne": True}}, {"_id": 0}).sort("name", 1).to_list(5000)
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment
    wb = Workbook()
    ws = wb.active
    ws.title = "Materials"
    headers = ["SKU", "Name", "Category", "Unit", "Default Price", "Shipping %", "Markup %", "Loaded Cost", "Preferred Vendor", "Notes", "Last Updated"]
    ws.append(headers)
    for cell in ws[1]:
        cell.font = Font(bold=True, color="FFFFFF", size=11)
        cell.fill = PatternFill("solid", fgColor="1D4ED8")
        cell.alignment = Alignment(horizontal="left")
    for m in items:
        price = float(m.get("default_price") or 0)
        ship_pct = float(m.get("shipping_pct") or 0)
        loaded = round(price * (1 + ship_pct / 100), 2)
        ws.append([m.get("sku", ""), m.get("name", ""), m.get("category", ""), m.get("unit", ""), price, ship_pct, float(m.get("markup_pct") or 0), loaded, m.get("vendor_name", ""), m.get("notes", ""), (m.get("updated_at") or "")[:10]])
    ws.freeze_panes = "A2"
    for i in range(1, 12):
        ws.column_dimensions[ws.cell(row=1, column=i).column_letter].width = 18
    buf = BytesIO()
    wb.save(buf)
    return Response(content=buf.getvalue(), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": 'attachment; filename="sealtech-materials.xlsx"'})


@api_router.get("/materials/template.xlsx")
async def materials_template(current=Depends(get_current_user)):
    """Empty CSV-ready template for users to fill out."""
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment
    wb = Workbook(); ws = wb.active; ws.title = "Materials"
    headers = ["sku", "name", "category", "unit", "default_price", "shipping_pct", "markup_pct", "preferred_vendor", "notes"]
    ws.append(headers)
    for cell in ws[1]:
        cell.font = Font(bold=True, color="FFFFFF", size=11)
        cell.fill = PatternFill("solid", fgColor="A0703A")
    ws.append(["EX-001", "Example Silicone 5gal", "Coating", "5-gal pail", 285.0, 8.0, 35.0, "ABC Supply", "Optional notes"])
    for i in range(1, 10):
        ws.column_dimensions[ws.cell(row=1, column=i).column_letter].width = 22
    buf = BytesIO()
    wb.save(buf)
    return Response(content=buf.getvalue(), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": 'attachment; filename="sealtech-materials-template.xlsx"'})


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

    # Maintenance KPIs
    today_iso = datetime.now(timezone.utc).date().isoformat()
    soon_iso = (datetime.now(timezone.utc) + timedelta(days=30)).date().isoformat()
    maintenance_count = 0
    maintenance_due_30d = 0
    maintenance_overdue = 0
    maintenance_annual_revenue = 0.0

    for d in deals:
        status_v = d.get("status", "Lead")
        chosen = float(d.get("chosen_amount", 0) or 0)
        # Pipeline value: use chosen_amount if set, otherwise the MID proposal option (typical buy point)
        pipeline_value = chosen if chosen > 0 else proposal_mid_amount(d)
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
            pipeline_revenue += pipeline_value

        # Maintenance roll-up
        if d.get("maintenance_plan"):
            maintenance_count += 1
            maintenance_annual_revenue += float(d.get("maintenance_rate", 0) or 0)
            nxt = d.get("next_maintenance_date") or ""
            if nxt:
                if nxt < today_iso:
                    maintenance_overdue += 1
                    maintenance_due_30d += 1
                elif nxt <= soon_iso:
                    maintenance_due_30d += 1

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
        "maintenance_count": maintenance_count,
        "maintenance_due_30d": maintenance_due_30d,
        "maintenance_overdue": maintenance_overdue,
        "maintenance_annual_revenue": round(maintenance_annual_revenue, 2),
        **(await _payables_summary(current)),
    }


async def _payables_summary(current) -> dict:
    """Sum unpaid bills, grouped by overdue / due-soon / total."""
    query = {"is_deleted": {"$ne": True}, "status": {"$in": ["Pending", "Approved"]}}
    if current.get("role") == "sales":
        query["created_by_user_id"] = current["id"]
    bills = await db.vendor_bills.find(query, {"_id": 0}).to_list(2000)
    today_iso = datetime.now(timezone.utc).date().isoformat()
    soon_iso = (datetime.now(timezone.utc) + timedelta(days=7)).date().isoformat()
    out_total = 0.0
    overdue_total = 0.0
    due_week_total = 0.0
    overdue_count = 0
    due_week_count = 0
    for b in bills:
        balance = float(b.get("total") or 0) - float(b.get("paid_amount") or 0)
        if balance <= 0.01:
            continue
        out_total += balance
        dd = (b.get("due_date") or "")[:10]
        if dd and dd < today_iso:
            overdue_total += balance
            overdue_count += 1
        elif dd and dd <= soon_iso:
            due_week_total += balance
            due_week_count += 1
    return {
        "payables_outstanding": round(out_total, 2),
        "payables_overdue": round(overdue_total, 2),
        "payables_due_this_week": round(due_week_total, 2),
        "payables_overdue_count": overdue_count,
        "payables_due_this_week_count": due_week_count,
    }


@api_router.get("/dashboard/revenue-by-type")
async def revenue_by_type(window: str = "ytd", current=Depends(get_current_user)):
    """Booked + Received revenue grouped by project_type.
    window = 'ytd' (current calendar year) or 'all' (all-time).
    Maintenance is a special bucket fed by maintenance_visits, NOT by project_type=Maintenance deals
    (those would also be included separately if user labels a one-off project as Maintenance type)."""
    if window not in ("ytd", "all"):
        window = "ytd"
    year_start_iso = datetime(now_utc().year, 1, 1, tzinfo=timezone.utc).date().isoformat()

    def in_window(date_str: str) -> bool:
        if window == "all":
            return True
        if not date_str:
            return False
        return date_str[:10] >= year_start_iso

    # Sales filter
    query = {"is_deleted": {"$ne": True}}
    if current.get("role") == "sales":
        query["$or"] = [{"assigned_to_user_id": current["id"]}, {"created_by_user_id": current["id"]}]
    deals = await db.deals.find(query, {"_id": 0}).to_list(5000)

    types = ["Repair", "Roof Restoration", "Roof Replacement", "Maintenance", "New Construction", "Other"]
    buckets = {t: {"booked": 0.0, "received": 0.0, "count": 0} for t in types}

    for d in deals:
        # Project type breakdown from Won deals
        if d.get("status") == "Won":
            # Use chosen_date if present, else created_at
            ref = (d.get("chosen_date") or d.get("created_at") or "")[:10]
            if in_window(ref):
                ptype = d.get("project_type") or "Other"
                if ptype not in buckets:
                    ptype = "Other"
                target = buckets[ptype]
                booked = float(d.get("chosen_amount", 0) or 0)
                received = sum(float(m.get("amount", 0) or 0) for m in (d.get("payment_milestones") or []) if m.get("status") == "Paid")
                target["booked"] += booked
                target["received"] += received
                target["count"] += 1

        # Maintenance visits feed the Maintenance bucket regardless of the project's own type
        for v in (d.get("maintenance_visits") or []):
            vd = (v.get("visit_date") or "")[:10]
            if not in_window(vd):
                continue
            amt = float(v.get("amount", 0) or 0)
            buckets["Maintenance"]["booked"] += amt
            buckets["Maintenance"]["received"] += amt  # actuals from logged visits
            buckets["Maintenance"]["count"] += 1

    rows = []
    for t in types:
        b = buckets[t]
        rows.append({
            "project_type": t,
            "booked": round(b["booked"], 2),
            "received": round(b["received"], 2),
            "count": b["count"],
        })

    totals = {
        "booked": round(sum(r["booked"] for r in rows), 2),
        "received": round(sum(r["received"] for r in rows), 2),
    }
    return {"window": window, "rows": rows, "totals": totals}


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
    await db.invoices.create_index("id", unique=True)
    await db.invoices.create_index("invoice_number", unique=True, sparse=True)
    await db.invoices.create_index("deal_id")
    await db.vendor_bills.create_index("id", unique=True)
    await db.vendor_bills.create_index("vendor_id")
    await db.vendor_bills.create_index("due_date")
    await db.materials.create_index("id", unique=True)
    await db.materials.create_index("sku")
    await db.materials.create_index("name")
    await db.settings.create_index("key", unique=True)

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
            "phone": "",
            "title": "Owner",
            "password_hash": hash_password(admin_password),
            "created_at": now_iso(),
        })
    else:
        # Make sure existing admin has role=admin (migration)
        await db.users.update_one({"id": existing["id"]}, {"$set": {"role": "admin"}})

    # Start the weekly payables-email scheduler
    _start_payables_scheduler()


# ----- Friday Payables Email Scheduler -----
_payables_scheduler = None


def _start_payables_scheduler():
    """Schedule the weekly payables email to admin every Friday 7:00 AM (server timezone = UTC)."""
    global _payables_scheduler
    try:
        from apscheduler.schedulers.asyncio import AsyncIOScheduler
        from apscheduler.triggers.cron import CronTrigger
    except ImportError:
        logger.warning("APScheduler not installed — Friday payables email disabled")
        return
    if _payables_scheduler is not None:
        return

    async def send_friday_report():
        try:
            admin_email = os.environ.get("PAYABLES_REPORT_EMAIL") or os.environ.get("GMAIL_FROM_EMAIL") or os.environ.get("ADMIN_EMAIL")
            if not admin_email:
                logger.warning("No PAYABLES_REPORT_EMAIL or GMAIL_FROM_EMAIL configured")
                return
            # Find the admin user to fake a "current" context
            admin = await db.users.find_one({"role": "admin"})
            if not admin:
                logger.warning("No admin user found for scheduled payables email")
                return
            from email_sender import send_email
            report = await payables_report(admin)
            if report["overdue_count"] == 0 and report["due_this_week_count"] == 0:
                logger.info("Friday payables: nothing due, skipping email")
                return
            send_email(
                to=admin_email,
                subject=f"SealTech Payables — Week of {report['today']} — {report['overdue_count']} overdue · {report['due_this_week_count']} due",
                body_text=_render_payables_email_text(report),
                body_html=_render_payables_email_html(report),
            )
            logger.info(f"Friday payables email sent to {admin_email}")
        except Exception as e:
            logger.error(f"Friday payables email failed: {type(e).__name__}: {e}")

    sched = AsyncIOScheduler(timezone="America/Denver")  # Aurora/Castle Rock, CO local time
    # Friday 7:00 AM Mountain Time
    sched.add_job(send_friday_report, CronTrigger(day_of_week="fri", hour=7, minute=0), id="payables_friday")
    sched.start()
    _payables_scheduler = sched
    logger.info("Payables scheduler started — Friday 7:00 AM America/Denver")


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

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)
