"""Idempotent seeding helper — adds Everest Systems to product_catalog +
roofing_systems so the Material Calculator can quote Everest jobs.

Run with:  python3 /app/backend/seed_everest.py

What it does:
1. Mirrors every non-deleted material in the `materials` collection whose
   vendor_name == "Everest Systems" into the `product_catalog` collection
   (using the material's id so cross-references stay stable). Skips rows
   already present.
2. Creates four starter Everest systems in `roofing_systems` covering the
   5 / 10 / 15 / 20-year warranty bands (Silkoxy silicone tier). Recipe
   contents are left empty — the rep fine-tunes coverage rates per system
   inside /catalog. Skips bands that already have an Everest system.
"""
from __future__ import annotations

import os
import sys
import uuid
from datetime import datetime, timezone

# Make sibling modules importable when running this file directly
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv
from pymongo import MongoClient


VENDOR = "Everest Systems"
DEFAULT_CATEGORY = "Silicone"  # all starter Everest systems use this category

# (warranty_years, name, system_type)
STARTER_SYSTEMS = [
    (5,  "5-Year Silkoxy Silicone System",  "Silicone"),
    (10, "10-Year Silkoxy Silicone System", "Silicone"),
    (15, "15-Year Silkoxy Silicone System", "Silicone"),
    (20, "20-Year Silkoxy Silicone System", "Silicone"),
]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def main() -> None:
    load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
    client = MongoClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]

    # 1. Mirror Everest materials -> product_catalog (so they can be picked in
    #    a system recipe). Idempotent on (id) and (name, vendor).
    materials = list(db.materials.find({
        "vendor_name": VENDOR, "is_deleted": {"$ne": True},
    }))
    mirrored = 0
    for m in materials:
        # Skip if a product_catalog row already exists with the same id OR the
        # same (name, vendor) pair (handles re-runs after either flow).
        already = db.product_catalog.find_one({
            "$or": [
                {"id": m.get("id")},
                {"name": m.get("name"), "vendor": VENDOR},
            ],
            "is_deleted": {"$ne": True},
        })
        if already:
            continue
        db.product_catalog.insert_one({
            "id": m.get("id") or str(uuid.uuid4()),
            "name": m.get("name", ""),
            "sku": m.get("sku", ""),
            "vendor": VENDOR,
            "category": "Silicone",  # all known Everest products today are silicone
            "unit": m.get("unit", "gal"),
            "package_size": 1.0,  # rep can edit in /catalog if needed
            "unit_price": float(m.get("default_price") or 0),
            "notes": m.get("notes", ""),
            "is_deleted": False,
            "created_at": _now(),
            "created_by": "seed-everest",
            "updated_at": _now(),
        })
        mirrored += 1

    # 2. Create starter systems for each warranty band that doesn't exist yet.
    created = 0
    for years, name, system_type in STARTER_SYSTEMS:
        exists = db.roofing_systems.find_one({
            "vendor": VENDOR,
            "warranty_years": years,
            "is_deleted": {"$ne": True},
        })
        if exists:
            continue
        db.roofing_systems.insert_one({
            "id": str(uuid.uuid4()),
            "name": name,
            "vendor": VENDOR,
            "system_type": system_type,
            "category": system_type,
            "warranty_years": years,
            "description": (
                "Starter system — adjust products + coverage rates in "
                "/catalog. Warranty pricing auto-applies ($1,000 Standard / "
                "$3,500 NDL) based on the NDL toggle in the calculator."
            ),
            "notes": "",
            "is_deleted": False,
            "created_at": _now(),
            "created_by": "seed-everest",
            "updated_at": _now(),
        })
        created += 1

    print(
        f"Everest seed complete — mirrored {mirrored} product(s), "
        f"created {created} system(s)."
    )


if __name__ == "__main__":
    main()
