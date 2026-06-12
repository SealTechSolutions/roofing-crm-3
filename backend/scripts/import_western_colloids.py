"""One-time bulk import of Western Colloids materials for National Waterproofing and Supply.

Run from /app/backend:
    python scripts/import_western_colloids.py
"""
import asyncio
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

VENDOR_NAME = "National Waterproofing and Supply"
CATEGORY = "Coatings & Roofing Products"
DEFAULT_SHIPPING_PCT = 10.0
DEFAULT_MARKUP_PCT = 30.0

# Extracted from "Western Colloids Pricing 2023 - Darren Oliver.pdf"
ITEMS = [
    {"sku": "298", "name": "ASPHALT EMULSION (Non Fibered)", "unit": "Pail", "size": None, "vendor_cost": 38.50, "notes": "Non Fibered"},
    {"sku": "298", "name": "ASPHALT EMULSION (Non Fibered)", "unit": "55 Gal Drum", "size": "55 Gal", "vendor_cost": 324.50, "notes": "Non Fibered"},
    {"sku": "298", "name": "ASPHALT EMULSION (Non Fibered)", "unit": "Tote", "size": "275 Gal", "vendor_cost": 1320.00, "notes": "Non Fibered"},
    {"sku": "289E", "name": "ELASTOMERIC ASPHALT EMULSION", "unit": "Pail", "size": "5 Gal", "vendor_cost": 57.55, "notes": ""},
    {"sku": "289E", "name": "ELASTOMERIC ASPHALT EMULSION", "unit": "55 Gal Drum", "size": "55 Gal", "vendor_cost": 535.81, "notes": ""},
    {"sku": "289E", "name": "ELASTOMERIC ASPHALT EMULSION", "unit": "Tote", "size": "275 Gal", "vendor_cost": 2548.21, "notes": ""},
    {"sku": "525", "name": "SILVERWHITE ALUMINUM SUPERBRIGHT COATING", "unit": "5 Gal Pail", "size": "5 Gal", "vendor_cost": 98.98, "notes": "Water Based"},
    {"sku": "525", "name": "SILVERWHITE ALUMINUM SUPERBRIGHT COATING", "unit": "55 Gal Drum", "size": "55 Gal", "vendor_cost": 1020.25, "notes": "Water Based"},
    {"sku": "525", "name": "SILVERWHITE ALUMINUM SUPERBRIGHT COATING", "unit": "Tote", "size": "275 Gal", "vendor_cost": 4904.35, "notes": "Water Based"},
    {"sku": "530", "name": "SILVERWHITE ALUMINUM SUPERBRIGHT COATING (Roller Grade)", "unit": "5 Gal Pail", "size": "5 Gal", "vendor_cost": 105.40, "notes": "Water Based (ROLLER GRADE)"},
    {"sku": "720 ARC", "name": "ELASTAHYDE WHITE ELASTOMERIC ACRYLIC ROOF COATING", "unit": "Pail", "size": "5 Gal", "vendor_cost": 123.05, "notes": ""},
    {"sku": "720 ARC", "name": "ELASTAHYDE WHITE ELASTOMERIC ACRYLIC ROOF COATING", "unit": "55 Gal Drum", "size": "55 Gal", "vendor_cost": 1205.00, "notes": ""},
    {"sku": "720 ARC", "name": "ELASTAHYDE WHITE ELASTOMERIC ACRYLIC ROOF COATING", "unit": "Tote", "size": "275 Gal", "vendor_cost": 5955.00, "notes": ""},
    {"sku": "790 AFC", "name": "ELASTAHYDE WHITE ELASTOMERIC ACRYLIC FOAM, EPDM & ROOF COATING", "unit": "Pail", "size": "5 Gal", "vendor_cost": 137.50, "notes": ""},
    {"sku": "790 AFC", "name": "ELASTAHYDE WHITE ELASTOMERIC ACRYLIC FOAM, EPDM & ROOF COATING", "unit": "55 Gal Drum", "size": "55 Gal", "vendor_cost": 1451.73, "notes": ""},
    {"sku": "790 AFC", "name": "ELASTAHYDE WHITE ELASTOMERIC ACRYLIC FOAM, EPDM & ROOF COATING", "unit": "Tote", "size": "275 Gal", "vendor_cost": 7062.00, "notes": ""},
    {"sku": "720 ARC QS", "name": "ELASTAHYDE QUICK SET (Wet/Cold Weather)", "unit": "Pail", "size": "5 Gal", "vendor_cost": 137.50, "notes": "Quick Set formulation for wet or cold weather"},
    {"sku": "720 ARC QS", "name": "ELASTAHYDE QUICK SET (Wet/Cold Weather)", "unit": "55 Gal Drum", "size": "55 Gal", "vendor_cost": 1451.73, "notes": "Quick Set formulation for wet or cold weather"},
    {"sku": "720 ARC QS", "name": "ELASTAHYDE QUICK SET (Wet/Cold Weather)", "unit": "Tote", "size": "275 Gal", "vendor_cost": 7062.00, "notes": "Quick Set formulation for wet or cold weather"},
    {"sku": "790 AFC QS", "name": "ELASTAHYDE 790 QUICK SET (Wet/Cold Weather)", "unit": "Pail", "size": "5 Gal", "vendor_cost": 151.68, "notes": "Quick Set formulation for wet or cold weather"},
    {"sku": "790 AFC QS", "name": "ELASTAHYDE 790 QUICK SET (Wet/Cold Weather)", "unit": "55 Gal Drum", "size": "55 Gal", "vendor_cost": 1608.75, "notes": "Quick Set formulation for wet or cold weather"},
    {"sku": "790 AFC QS", "name": "ELASTAHYDE 790 QUICK SET (Wet/Cold Weather)", "unit": "Tote", "size": "275 Gal", "vendor_cost": 7846.85, "notes": "Quick Set formulation for wet or cold weather"},
    {"sku": "700 EC", "name": "WESTERNWHITE ECONOMICAL ACRYLIC COATING", "unit": "Pail", "size": "5 Gal", "vendor_cost": 100.05, "notes": "Not used for system specifications"},
    {"sku": "700 EC", "name": "WESTERNWHITE ECONOMICAL ACRYLIC COATING", "unit": "55 Gal Drum", "size": "55 Gal", "vendor_cost": 1059.30, "notes": "Not used for system specifications"},
    {"sku": "700 EC", "name": "WESTERNWHITE ECONOMICAL ACRYLIC COATING", "unit": "Tote", "size": "275 Gal", "vendor_cost": 5002.25, "notes": "Not used for system specifications"},
    {"sku": "800 W", "name": "ELASTIC CEMENT WHITE FLASHING COMPOUND", "unit": "Pail", "size": "5 Gal", "vendor_cost": 101.65, "notes": "Water Based"},
    {"sku": "801 B", "name": "ELASTIC CEMENT BLACK FLASHING COMPOUND", "unit": "Pail", "size": "5 Gal", "vendor_cost": 101.65, "notes": "Water Based"},
    {"sku": "8000", "name": "ALL WEATHER ELASTIC CEMENT WHITE (Wet or Dry Flashing)", "unit": "Pail", "size": "5 Gal", "vendor_cost": 155.00, "notes": "Solvent Based"},
    {"sku": "850 SWS", "name": "SEAMLESS WALKWAY SYSTEM COATING", "unit": "Pail", "size": "5 Gal", "vendor_cost": 135.63, "notes": "Textured roof walkway protective coating, water based"},
    {"sku": "901", "name": "CLEAR ROCK BINDER (Clear Acrylic Binder for Loose Gravel)", "unit": "Pail", "size": "5 Gal", "vendor_cost": 126.80, "notes": ""},
    {"sku": "901", "name": "CLEAR ROCK BINDER (Clear Acrylic Binder for Loose Gravel)", "unit": "Tote", "size": "275 Gal", "vendor_cost": 1334.02, "notes": ""},
    {"sku": "925", "name": "CLEAR SKYLIGHT COATING (Acrylic for Aged Fiberglass Skylights)", "unit": "Pail", "size": "5 Gal", "vendor_cost": 160.50, "notes": ""},
    {"sku": "925", "name": "CLEAR SKYLIGHT COATING (Acrylic for Aged Fiberglass Skylights)", "unit": "55 Gal Drum", "size": "55 Gal", "vendor_cost": 1686.86, "notes": ""},
    {"sku": "930", "name": "TPO PRIMER (Improves adhesion to existing TPO membranes)", "unit": "Pail", "size": "5 Gal", "vendor_cost": 170.00, "notes": ""},
    {"sku": "930", "name": "TPO PRIMER (Improves adhesion to existing TPO membranes)", "unit": "55 Gal Drum", "size": "55 Gal", "vendor_cost": 1760.00, "notes": ""},
    {"sku": "950", "name": "PRIMER / SEALER - STAIN BLOCKER (Clear, Prevents Staining)", "unit": "Pail", "size": "5 Gal", "vendor_cost": 149.80, "notes": ""},
    {"sku": "950", "name": "PRIMER / SEALER - STAIN BLOCKER (Clear, Prevents Staining)", "unit": "55 Gal Drum", "size": "55 Gal", "vendor_cost": 1569.43, "notes": ""},
    {"sku": "970", "name": '"A2A" ACRYLIC TO ASPHALT BONDING PRIMER', "unit": "Pail", "size": "5 Gal", "vendor_cost": 157.03, "notes": "Improves adhesion to asphalt and in ponding conditions"},
    {"sku": "970", "name": '"A2A" ACRYLIC TO ASPHALT BONDING PRIMER', "unit": "5 Gal Pail", "size": "5 Gal", "vendor_cost": 146.33, "notes": "Improves adhesion to asphalt and in ponding conditions"},
    {"sku": "900", "name": "METAL / STEEL / KYNAR ACRYLIC BONDING PRIMER", "unit": "Pail", "size": "5 Gal", "vendor_cost": 210.53, "notes": "Improves adhesion to new, raw & Kynar metal & other surfaces"},
    {"sku": "900", "name": "METAL / STEEL / KYNAR ACRYLIC BONDING PRIMER", "unit": "55 Gal Drum", "size": "55 Gal", "vendor_cost": 2197.25, "notes": "Improves adhesion to new, raw & Kynar metal & other surfaces"},
    {"sku": "900R", "name": "RUST INHIBITING ACRYLIC PRIMER", "unit": "Pail", "size": "5 Gal", "vendor_cost": 246.10, "notes": "Rust inhibiting primer for lightly rusted metal roofs"},
    {"sku": "9000", "name": "ROOF WASH & PREP CONCENTRATE", "unit": "Pail", "size": "5 Gal", "vendor_cost": 65.00, "notes": "Lifts oxidation, dirt, grease & contaminates from roofs"},
    {"sku": "WCP-SF", "name": "WESTERN COLLOIDS POLYESTER - STANDARD FIRM", "unit": "Each", "size": None, "vendor_cost": 98.50, "notes": "Standard firm polyester"},
    {"sku": "WCP-SS", "name": "WESTERN COLLOIDS POLYESTER - STANDARD SOFT", "unit": "Each", "size": None, "vendor_cost": 124.00, "notes": "Standard soft polyester"},
    {"sku": "SB-04", "name": "STITCHBONDED POLYESTER (Soft Finish) 4\" x 300'", "unit": "Roll", "size": "4\" x 300'", "vendor_cost": 26.75, "notes": "Soft finish"},
    {"sku": "SB-06", "name": "STITCHBONDED POLYESTER (Soft Finish) 6\" x 300'", "unit": "Roll", "size": "6\" x 300'", "vendor_cost": 33.50, "notes": "Soft finish"},
    {"sku": "SB-12", "name": "STITCHBONDED POLYESTER (Soft Finish) 12\" x 300'", "unit": "Roll", "size": "12\" x 300'", "vendor_cost": 62.10, "notes": "Soft finish"},
    {"sku": "SB-20", "name": "STITCHBONDED POLYESTER (Soft Finish) 20\" x 300'", "unit": "Roll", "size": "20\" x 300'", "vendor_cost": 94.65, "notes": "Soft finish"},
]


def now_iso():
    return datetime.now(timezone.utc).isoformat()


async def main():
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]

    # 1. Ensure vendor exists
    vendor = await db.vendors.find_one(
        {"name": VENDOR_NAME, "is_deleted": {"$ne": True}}, {"_id": 0}
    )
    if not vendor:
        vendor_id = str(uuid.uuid4())
        vendor_doc = {
            "id": vendor_id,
            "name": VENDOR_NAME,
            "kind": "Vendor",
            "category": "Material Supplier",
            "contact_name": "",
            "contact_title": "",
            "website": "",
            "phone": "",
            "work_phone": "",
            "mobile_phone": "",
            "fax": "",
            "email": "",
            "tin_ein": "",
            "address": "",
            "address_line2": "",
            "city": "",
            "state": "",
            "zip_code": "",
            "notes": "Western Colloids product distributor.",
            "created_at": now_iso(),
            "is_deleted": False,
        }
        await db.vendors.insert_one(vendor_doc)
        print(f"[+] Created vendor: {VENDOR_NAME} (id={vendor_id})")
    else:
        vendor_id = vendor["id"]
        print(f"[=] Vendor already exists: {VENDOR_NAME} (id={vendor_id})")

    created = 0
    updated = 0
    skipped = 0

    for item in ITEMS:
        sku = (item.get("sku") or "").strip()
        name = (item.get("name") or "").strip()
        unit = (item.get("unit") or "Each").strip()
        size = item.get("size")
        vendor_cost = item.get("vendor_cost")
        notes = (item.get("notes") or "").strip()

        if not name or vendor_cost is None:
            skipped += 1
            continue

        # Compose a display name that distinguishes size variants of the same SKU
        size_suffix = f" — {size}" if size else (f" — {unit}" if unit and unit not in name else "")
        display_name = f"{name}{size_suffix}".strip()

        # Find existing by sku+unit+size (unique key) to make idempotent
        query = {"sku": sku, "unit": unit, "is_deleted": {"$ne": True}}
        if size:
            query["notes"] = {"$regex": ""}  # not used; we'll match on display name instead
        existing = await db.materials.find_one({"sku": sku, "name": display_name, "is_deleted": {"$ne": True}}, {"_id": 0})

        doc = {
            "sku": sku,
            "name": display_name,
            "category": CATEGORY,
            "unit": unit,
            "default_price": round(float(vendor_cost), 2),
            "shipping_pct": DEFAULT_SHIPPING_PCT,
            "markup_pct": DEFAULT_MARKUP_PCT,
            "vendor_id": vendor_id,
            "vendor_name": VENDOR_NAME,
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

    print(f"[+] Materials import complete: created={created}, updated={updated}, skipped={skipped}")
    client.close()


if __name__ == "__main__":
    asyncio.run(main())
