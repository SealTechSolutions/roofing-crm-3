"""One-time bulk import of Everest Systems materials (filtered subset).

Only imports: Silkoxy, Everprime, AF Cleaner, EcoLevel, EverStitch.
"""
import asyncio
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

VENDOR_NAME = "Everest Systems"
CATEGORY = "Coatings & Roofing Products"
DEFAULT_SHIPPING_PCT = 10.0
DEFAULT_MARKUP_PCT = 30.0

# Filtered to only: Silkoxy*, Everprime*, AF Cleaner*, EcoLevel*, EverStitch*
ITEMS = [
    # ----- Silkoxy -----
    {"name": "Silkoxy H3 — 5 Gal Pail", "unit": "5 Gal Pail", "size": "5 Gal", "vendor_cost": 48.30, "notes": "High Solids, No Mix, High Viscosity Silicone Elastomeric Coating"},
    {"name": "Silkoxy H3 — 55 Gal Drum", "unit": "55 Gal Drum", "size": "55 Gal", "vendor_cost": 46.00, "notes": "High Solids, No Mix, High Viscosity Silicone Elastomeric Coating (per gallon)"},
    {"name": "Silkoxy H3 — Tote", "unit": "Tote", "size": "275 Gal", "vendor_cost": 45.43, "notes": "High Solids, No Mix, High Viscosity Silicone Elastomeric Coating (per gallon)"},

    {"name": "Silkoxy EZ — 5 Gal Pail", "unit": "5 Gal Pail", "size": "5 Gal", "vendor_cost": 48.30, "notes": "High Solids, No Mix, Low Viscosity Silicone Elastomeric Coating"},
    {"name": "Silkoxy EZ — 55 Gal Drum", "unit": "55 Gal Drum", "size": "55 Gal", "vendor_cost": 46.00, "notes": "High Solids, No Mix, Low Viscosity Silicone Elastomeric Coating (per gallon)"},
    {"name": "Silkoxy EZ — Tote", "unit": "Tote", "size": "275 Gal", "vendor_cost": 45.43, "notes": "High Solids, No Mix, Low Viscosity Silicone Elastomeric Coating (per gallon)"},

    {"name": "Silkoxy F1 — 5 Gal Pail", "unit": "5 Gal Pail", "size": "5 Gal", "vendor_cost": 39.68, "notes": "High solids self-leveling silicone. For use with Everprime Bleed Block SS, Silkoxy EZ or H3"},
    {"name": "Silkoxy F1 — 55 Gal Drum", "unit": "55 Gal Drum", "size": "55 Gal", "vendor_cost": 37.38, "notes": "High solids self-leveling silicone (per gallon)"},
    {"name": "Silkoxy F1 — Tote", "unit": "Tote", "size": "275 Gal", "vendor_cost": 36.80, "notes": "High solids self-leveling silicone (per gallon)"},

    {"name": "Silkoxy Ever-Tread Walk Pad", "unit": "Roll", "size": "3.2 ft x 164 ft", "vendor_cost": 1035.00, "notes": "Fully cured silicone, fiberglass reinforced walk pad"},

    # ----- Everprime -----
    {"name": "Everprime Metal — 5 Gal Pail", "unit": "5 Gal Pail", "size": "5 Gal", "vendor_cost": 38.24, "notes": "Rust inhibitive primer for metal surfaces. Severely rusted roofs require 2 coats."},
    {"name": "Everprime Metal — 55 Gal Drum", "unit": "55 Gal Drum", "size": "55 Gal", "vendor_cost": 36.25, "notes": "Rust inhibitive primer for metal surfaces (per gallon)"},

    {"name": "Everprime Epoxy — 5 Gal Pail", "unit": "5 Gal Pail", "size": "5 Gal", "vendor_cost": 59.11, "notes": "All purpose epoxy primer (Parts A & B). Use on metal, single-ply, SPF, masonry, wood."},
    {"name": "Everprime Epoxy — 55 Gal Drum", "unit": "55 Gal Drum", "size": "55 Gal", "vendor_cost": 57.12, "notes": "All purpose epoxy primer (Parts A & B) (per gallon)"},

    {"name": "Everprime Bleed Block — 5 Gal Pail", "unit": "5 Gal Pail", "size": "5 Gal", "vendor_cost": 26.62, "notes": "Primer for mod bit, smooth surface BUR, and for when topcoat is silicone."},
    {"name": "Everprime Bleed Block — 55 Gal Drum", "unit": "55 Gal Drum", "size": "55 Gal", "vendor_cost": 24.63, "notes": "Primer for mod bit, smooth BUR (per gallon)"},
    {"name": "Everprime Bleed Block — Tote", "unit": "Tote", "size": "275 Gal", "vendor_cost": 24.05, "notes": "Primer for mod bit, smooth BUR (per gallon)"},

    {"name": "Everprime Bleed Block SS — 5 Gal Pail", "unit": "5 Gal Pail", "size": "5 Gal", "vendor_cost": 29.35, "notes": "Acrylic coating for improved adhesion, bleed blocking on smooth BUR. May be used as a base coat with fabric."},
    {"name": "Everprime Bleed Block SS — 55 Gal Drum", "unit": "55 Gal Drum", "size": "55 Gal", "vendor_cost": 27.36, "notes": "Bleed Block SS (per gallon)"},
    {"name": "Everprime Bleed Block SS — Tote", "unit": "Tote", "size": "275 Gal", "vendor_cost": 26.78, "notes": "Bleed Block SS (per gallon)"},

    {"name": "Everprime CS — 5 Gal Pail", "unit": "5 Gal Pail", "size": "5 Gal", "vendor_cost": 36.19, "notes": "Penetrating clear sealer for masonry surfaces including concrete."},
    {"name": "Everprime CS — 55 Gal Drum", "unit": "55 Gal Drum", "size": "55 Gal", "vendor_cost": 34.20, "notes": "Penetrating clear sealer (per gallon)"},
    {"name": "Everprime CS — Tote", "unit": "Tote", "size": "275 Gal", "vendor_cost": 33.63, "notes": "Penetrating clear sealer (per gallon)"},

    {"name": "Everprime GP — 5 Gal Pail", "unit": "5 Gal Pail", "size": "5 Gal", "vendor_cost": 25.93, "notes": "All purpose black primer; adhesion to most substrates including foam. Can be used before SPF."},
    {"name": "Everprime GP — 55 Gal Drum", "unit": "55 Gal Drum", "size": "55 Gal", "vendor_cost": 23.94, "notes": "All purpose black primer (per gallon)"},
    {"name": "Everprime GP — Tote", "unit": "Tote", "size": "275 Gal", "vendor_cost": 23.36, "notes": "All purpose black primer (per gallon)"},

    {"name": "Everprime SP — 5 Gal Pail", "unit": "5 Gal Pail", "size": "5 Gal", "vendor_cost": 34.89, "notes": "Primer for aged PVC, TPO, or Hypalon. Can be used for chalky surfaces."},
    {"name": "Everprime SP — Tote", "unit": "Tote", "size": "275 Gal", "vendor_cost": 34.32, "notes": "Primer for aged PVC/TPO/Hypalon (per gallon)"},

    # ----- AF Cleaner -----
    {"name": "AF Cleaner Concentrate — 5 Gal Pail", "unit": "5 Gal Pail", "size": "5 Gal", "vendor_cost": 51.75, "notes": "Biodegradable concentrated general purpose roof cleaner. Dilute 10:1 with water."},
    {"name": "AF Cleaner Concentrate — 55 Gal Drum", "unit": "55 Gal Drum", "size": "55 Gal", "vendor_cost": 49.45, "notes": "Biodegradable concentrated roof cleaner (per gallon). Dilute 10:1."},

    # ----- EcoLevel -----
    {"name": "EcoLevel — 4 Gallon Kit", "unit": "Kit", "size": "4 Gal", "vendor_cost": 201.25, "notes": "Two part self-leveling filler. Must be top-coated. Not UV stable."},
    {"name": "EcoLevel — 2.5 Gallon Kit", "unit": "Kit", "size": "2.5 Gal", "vendor_cost": 120.75, "notes": "Two part self-leveling filler. Must be top-coated. Not UV stable."},

    # ----- EverStitch 272 -----
    {"name": "EverStitch 272 — 4\" x 300'", "unit": "Roll", "size": "4\" x 300'", "vendor_cost": 24.15, "notes": "Non-woven stitched, heat set polyester fabric for seam details and low area reinforcement."},
    {"name": "EverStitch 272 — 6\" x 300'", "unit": "Roll", "size": "6\" x 300'", "vendor_cost": 36.80, "notes": "Non-woven stitched polyester fabric."},
    {"name": "EverStitch 272 — 12\" x 300'", "unit": "Roll", "size": "12\" x 300'", "vendor_cost": 69.00, "notes": "Non-woven stitched polyester fabric."},
    {"name": "EverStitch 272 — 20\" x 300'", "unit": "Roll", "size": "20\" x 300'", "vendor_cost": 109.25, "notes": "Non-woven stitched polyester fabric."},
    {"name": "EverStitch 272 — 40\" x 324'", "unit": "Roll", "size": "40\" x 324'", "vendor_cost": 172.50, "notes": "Non-woven stitched polyester fabric. Special sizes require special order."},
    {"name": "EverStitch 272 — 39\" x 300'", "unit": "Roll", "size": "39\" x 300'", "vendor_cost": 276.00, "notes": "Non-woven stitched polyester fabric. Special sizes require special order."},
]


def now_iso():
    return datetime.now(timezone.utc).isoformat()


async def main():
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]

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
            "website": "https://everestsystemsus.com",
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
            "notes": "Manufacturer of Silkoxy silicones, Everprime primers, AF Cleaner, EcoLevel and EverStitch fabrics.",
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
    for item in ITEMS:
        name = item["name"]
        existing = await db.materials.find_one(
            {"name": name, "is_deleted": {"$ne": True}}, {"_id": 0}
        )
        doc = {
            "sku": "",
            "name": name,
            "category": CATEGORY,
            "unit": item["unit"],
            "default_price": round(float(item["vendor_cost"]), 2),
            "shipping_pct": DEFAULT_SHIPPING_PCT,
            "markup_pct": DEFAULT_MARKUP_PCT,
            "vendor_id": vendor_id,
            "vendor_name": VENDOR_NAME,
            "notes": item.get("notes", ""),
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

    print(f"[+] Everest import complete: created={created}, updated={updated}, total={len(ITEMS)}")
    client.close()


if __name__ == "__main__":
    asyncio.run(main())
