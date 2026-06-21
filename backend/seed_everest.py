"""Idempotent seeding helper — Everest Systems + SESCO granules.

Run with:  python3 /app/backend/seed_everest.py

What it does:
1. Mirrors every non-deleted material in the `materials` collection whose
   vendor_name == "Everest Systems" into the `product_catalog` collection
   (using the material's id so cross-references stay stable). Skips rows
   already present.
2. Seeds SESCO granules (5 colours) directly into `product_catalog` using
   the published LESS-THAN-HALF-TRUCKLOAD price.
3. Creates four starter Everest systems in `roofing_systems` covering the
   5 / 10 / 15 / 20-year warranty bands (Silkoxy silicone tier).
4. Writes the base-coat recipe for each starter system — Silkoxy EZ at the
   vendor-published GPS rate, mapped to per_100sf coverage:
       5-yr : 1.5 GPS, single pass
      10-yr : 2.0 GPS, single pass
      15-yr : 2.5 GPS, two passes (1.25 + 1.25)
      20-yr : 3.0 GPS, two passes (1.5 + 1.5)
   Recipe rows are skipped if a row already exists for the same system_id +
   product_id combo so re-runs don't duplicate.
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


EVEREST = "Everest Systems"
SESCO   = "SESCO"

# (warranty_years, name, system_type)
STARTER_SYSTEMS = [
    (5,  "5-Year Silkoxy Silicone System",  "Silicone"),
    (10, "10-Year Silkoxy Silicone System", "Silicone"),
    (15, "15-Year Silkoxy Silicone System", "Silicone"),
    (20, "20-Year Silkoxy Silicone System", "Silicone"),
]

# Silkoxy EZ base-coat recipe per warranty band. Each tuple = (gps, passes,
# note). 1 GPS = 1 gallon per 100 sf, mapped via coverage_basis="per_100sf".
RECIPE_BY_BAND = {
    5:  (1.5, 1, "Single coat at 1.5 GPS"),
    10: (2.0, 1, "Single coat at 2.0 GPS"),
    15: (2.5, 2, "Two coats — 1.25 + 1.25 GPS"),
    20: (3.0, 2, "Two coats — 1.5 + 1.5 GPS"),
}

# SESCO granules — LTL "LESS THAN HALF A TRUCKLOAD" price per bag, sold by the
# pallet (Sealtech only orders full pallets, not loose bags). Stored in
# product_catalog with package_size=1 + unit_price=price-per-pallet so the
# calculator's container-packing math treats 1 qty = 1 pallet.
# Source: SESCO PRICE LIST Jan 2026.
SESCO_GRANULES = [
    # (name, bag_lb, bags_per_pallet, price_per_bag)
    ("BUFF Granules — 50 lb bags / pallet",        50,  56, 8.00),
    ("BROWN Granules — 100 lb bags / pallet",      100, 30, 10.50),
    ("RAINBOW Granules — 100 lb bags / pallet",    100, 30, 13.75),
    ("6/10 WHITE Granules — 50 lb bags / pallet",  50,  56, 11.25),
    ("SNOW WHITE Granules — 50 lb bags / pallet",  50,  63, 11.25),
]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _derive_sku(name: str) -> str:
    """Derive a stable Everest SKU from a product name.
    Group siblings by the part before the ' — ' separator (which is the size).
    Falls back to the full name when no separator is present.
        'Silkoxy EZ — 5 Gal Pail'        -> 'Silkoxy EZ'
        'Silkoxy EZ — 55 Gal Drum'       -> 'Silkoxy EZ'
        'EcoLevel — 2.5 Gallon Kit'      -> 'EcoLevel'
        'EverStitch 272 — 4" x 300\''    -> 'EverStitch 272'
        'Silkoxy Ever-Tread Walk Pad'    -> 'Silkoxy Ever-Tread Walk Pad'
    """
    return (name or "").split(" — ")[0].strip()


def _parse_package_size(unit: str, name: str) -> tuple[float, str]:
    """Derive (package_size, normalised_unit) from a free-form unit/name.
    Everest materials are stored with unit strings like "5 Gal Pail" or
    "55 Gal Drum" instead of a numeric package size, so we recover it here.
    """
    import re
    s = f"{unit} {name}".lower()
    m = re.search(r"(\d+(?:\.\d+)?)\s*gal", s)
    if m:
        return float(m.group(1)), "gal"
    if "tote" in s: return 275.0, "gal"
    if "drum" in s: return 55.0,  "gal"
    if "pail" in s: return 5.0,   "gal"
    if "roll" in s: return 1.0,   "roll"
    if "bag"  in s: return 1.0,   "bag"
    if "kit"  in s: return 1.0,   "kit"
    return 1.0, (unit or "ea")


def main() -> None:
    load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
    client = MongoClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]

    # 1. Mirror Everest materials -> product_catalog
    materials = list(db.materials.find({
        "vendor_name": EVEREST, "is_deleted": {"$ne": True},
    }))
    mirrored = 0
    fixed_pkg = 0
    fixed_sku = 0
    for m in materials:
        pkg_size, norm_unit = _parse_package_size(m.get("unit") or "", m.get("name") or "")
        derived_sku = _derive_sku(m.get("name") or "")
        already = db.product_catalog.find_one({
            "$or": [
                {"id": m.get("id")},
                {"name": m.get("name"), "vendor": EVEREST},
            ],
            "is_deleted": {"$ne": True},
        })
        if already:
            patch = {}
            # Heal historical rows that were mirrored with package_size=1.0 —
            # back-fill the correct gallons-per-container from the name.
            if float(already.get("package_size") or 0) <= 1.0 and pkg_size > 1.0:
                patch.update(package_size=pkg_size, unit=norm_unit)
                fixed_pkg += 1
            # Heal historical empty SKUs so the calculator can group sibling
            # container sizes (5-gal pail + 55-gal drum) without sweeping in
            # unrelated products (EcoLevel, Walk Pad, etc.) as fake siblings.
            if not (already.get("sku") or "").strip() and derived_sku:
                patch["sku"] = derived_sku
                fixed_sku += 1
            if patch:
                patch["updated_at"] = _now()
                db.product_catalog.update_one({"id": already["id"]}, {"$set": patch})
            continue
        db.product_catalog.insert_one({
            "id": m.get("id") or str(uuid.uuid4()),
            "name": m.get("name", ""),
            "sku": derived_sku,
            "vendor": EVEREST,
            "category": "Silicone",
            "unit": norm_unit,
            "package_size": pkg_size,
            "unit_price": float(m.get("default_price") or 0),
            "notes": m.get("notes", ""),
            "is_deleted": False,
            "created_at": _now(),
            "created_by": "seed-everest",
            "updated_at": _now(),
        })
        mirrored += 1

    # 2. SESCO granules — Sealtech buys these by the PALLET (not loose bags).
    #    Stored with package_size=1 and unit_price = bags_per_pallet × price-
    #    per-bag so qty=1 in the calculator means one pallet.
    granule_added = 0
    granule_healed = 0
    for name, bag_lb, bags_per_pallet, price_per_bag in SESCO_GRANULES:
        pallet_price = round(bags_per_pallet * price_per_bag, 2)
        notes = (
            f"{bag_lb} lb × {bags_per_pallet} bags = 1 pallet. "
            f"LTL price ${price_per_bag:.2f}/bag → ${pallet_price:.2f}/pallet. "
            "Flat $2,000 freight per order applied separately."
        )
        # Match heal-or-insert against any prior row sharing the colour family
        # (so renames from "BUFF Granules — 50 lb bag" → "… / pallet" don't
        # create duplicates).
        colour_token = name.split(" Granules")[0]
        existing = db.product_catalog.find_one({
            "vendor": SESCO,
            "name": {"$regex": rf"^{colour_token} Granules", "$options": "i"},
            "is_deleted": {"$ne": True},
        })
        if existing:
            db.product_catalog.update_one(
                {"id": existing["id"]},
                {"$set": {
                    "name": name,
                    "unit": "pallet",
                    "package_size": 1.0,
                    "unit_price": pallet_price,
                    "notes": notes,
                    "updated_at": _now(),
                }},
            )
            granule_healed += 1
            continue
        db.product_catalog.insert_one({
            "id": str(uuid.uuid4()),
            "name": name,
            "sku": "",
            "vendor": SESCO,
            "category": "Granules",
            "unit": "pallet",
            "package_size": 1.0,
            "unit_price": pallet_price,
            "notes": notes,
            "is_deleted": False,
            "created_at": _now(),
            "created_by": "seed-everest",
            "updated_at": _now(),
        })
        granule_added += 1

    # 3. Starter Everest systems (and capture ids for the recipe pass)
    system_ids_by_band: dict[int, str] = {}
    created_systems = 0
    for years, name, system_type in STARTER_SYSTEMS:
        existing = db.roofing_systems.find_one({
            "vendor": EVEREST, "warranty_years": years,
            "is_deleted": {"$ne": True},
        })
        if existing:
            system_ids_by_band[years] = existing["id"]
            continue
        sid = str(uuid.uuid4())
        db.roofing_systems.insert_one({
            "id": sid,
            "name": name,
            "vendor": EVEREST,
            "system_type": system_type,
            "category": system_type,
            "warranty_years": years,
            "description": (
                "Starter Everest system. Base coat = Silkoxy EZ at the band's "
                "GPS rate. Warranty pricing auto-applies in the calculator "
                "($1,000 Standard / $3,000 + per-SF for NDL)."
            ),
            "notes": "",
            "is_deleted": False,
            "created_at": _now(),
            "created_by": "seed-everest",
            "updated_at": _now(),
        })
        system_ids_by_band[years] = sid
        created_systems += 1

    # 4. Recipe rows — Silkoxy EZ base coat at the published GPS.
    #    We reference any Silkoxy EZ container so the calculator's container-
    #    packing logic can choose between pail / drum / tote per the rep's
    #    "allowed sizes" toggles. Pick the 5-Gal Pail row as the anchor.
    silkoxy_ez_pail = db.product_catalog.find_one({
        "vendor": EVEREST,
        "name": {"$regex": r"^Silkoxy EZ — 5 Gal Pail", "$options": "i"},
        "is_deleted": {"$ne": True},
    })
    recipes_added = 0
    if silkoxy_ez_pail:
        anchor_product_id = silkoxy_ez_pail["id"]
        for band, sid in system_ids_by_band.items():
            gps, passes, note = RECIPE_BY_BAND[band]
            already = db.system_recipes.find_one({
                "system_id": sid, "product_id": anchor_product_id,
            })
            if already:
                continue
            db.system_recipes.insert_one({
                "id": str(uuid.uuid4()),
                "system_id": sid,
                "product_id": anchor_product_id,
                "coverage_basis": "per_100sf",
                "coverage_rate": gps,
                "is_optional": False,
                "layers": passes,
                "sort_order": 10,
                "notes": note,
                "created_at": _now(),
                "updated_at": _now(),
            })
            recipes_added += 1

    print(
        f"Everest seed complete — mirrored {mirrored} product(s), "
        f"healed {fixed_pkg} package-size(s), {fixed_sku} sku(s), "
        f"+{granule_added} / ~{granule_healed} SESCO granule(s), "
        f"+{created_systems} system(s), "
        f"+{recipes_added} recipe row(s)."
    )


if __name__ == "__main__":
    main()
