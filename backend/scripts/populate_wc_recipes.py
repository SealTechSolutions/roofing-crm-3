"""Auto-populate system_recipes for each Western Colloid system using its
`coverage_template` blob (set by import_western_colloid.py).

Maps each abstract category to a canonical Western Colloid SKU and writes
recipe rows so the Material Calculator can produce a Bill of Materials.

Mapping (default 5 gal pails for liquids, fabric rolls for fabric):
  - emulsion              -> 298 Asphalt Emulsion Non-Fibered (5 gal Pail)
  - acrylic               -> 720 ARC ElastaHyde White Acrylic (5 gal Pail)
  - fabric_soft_rolls     -> WCP-SS 40" Standard Soft Fabric Roll
  - fabric_firm_rolls     -> WCP-SF 40" Standard Firm Fabric Roll
"""
import asyncio, os, uuid
from datetime import datetime, timezone
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv("/app/backend/.env")
NOW = datetime.now(timezone.utc).isoformat()


async def find_product(db, sku: str, name_contains: str):
    """Find a Western Colloid product by SKU exact + name fragment."""
    return await db.product_catalog.find_one({
        "vendor": "Western Colloid",
        "sku": sku,
        "name": {"$regex": name_contains, "$options": "i"},
        "is_deleted": {"$ne": True},
    }, {"_id": 0, "id": 1, "name": 1})


async def main():
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]

    # Resolve canonical product IDs (one-time lookups).
    emulsion  = await find_product(db, "298", "5 gal Pail")
    acrylic   = await find_product(db, "720 ARC", "5 gal Pail")
    fab_soft  = await find_product(db, 'WCP-SS 40"', "Fabric Roll")
    fab_firm  = await find_product(db, 'WCP-SF 40"', "Fabric Roll")

    for label, p in [("emulsion", emulsion), ("acrylic", acrylic),
                     ("fab_soft", fab_soft), ("fab_firm", fab_firm)]:
        if not p:
            raise RuntimeError(f"Missing canonical product for {label}")
        print(f"  ✓ {label:10}  ->  {p['name']}")

    systems = await db.roofing_systems.find({
        "vendor": "Western Colloid",
        "is_deleted": {"$ne": True},
        "coverage_template": {"$exists": True},
    }, {"_id": 0, "id": 1, "name": 1, "coverage_template": 1}).to_list(50)
    print(f"\nFound {len(systems)} Western Colloid systems with coverage templates.")

    inserted = 0
    for sys in systems:
        # Skip systems that already have a recipe (don't overwrite manual edits)
        existing = await db.system_recipes.count_documents({"system_id": sys["id"]})
        if existing:
            print(f"  - skip (recipe exists)   {sys['name']}")
            continue

        ct = sys["coverage_template"]
        items = []
        # Emulsion
        if (ct.get("emulsion_gal_per_100sf") or 0) > 0:
            items.append({
                "product_id": emulsion["id"],
                "coverage_rate": float(ct["emulsion_gal_per_100sf"]),
                "coverage_basis": "per_100sf",
                "optional": False, "default_included": True,
                "sort_order": 0, "notes": "Base emulsion coat",
            })
        # Acrylic
        if (ct.get("acrylic_gal_per_100sf") or 0) > 0:
            items.append({
                "product_id": acrylic["id"],
                "coverage_rate": float(ct["acrylic_gal_per_100sf"]),
                "coverage_basis": "per_100sf",
                "optional": False, "default_included": True,
                "sort_order": 1, "notes": "Top-coat acrylic",
            })
        # Fabric soft (CSV value = linear feet of 40" fabric per 100sf of roof;
        # a standard 40" x 330' roll = 330 lf, so rolls_per_100sf = lf / 330).
        if (ct.get("fabric_soft_rolls_per_100sf") or 0) > 0:
            items.append({
                "product_id": fab_soft["id"],
                "coverage_rate": round(float(ct["fabric_soft_rolls_per_100sf"]) / 330.0, 5),
                "coverage_basis": "per_100sf",
                "optional": False, "default_included": True,
                "sort_order": 2,
                "notes": f"~{ct['fabric_soft_rolls_per_100sf']} lf of 40\" fabric per 100sf (1 roll = 330 lf)",
            })
        # Fabric firm
        if (ct.get("fabric_firm_rolls_per_100sf") or 0) > 0:
            items.append({
                "product_id": fab_firm["id"],
                "coverage_rate": round(float(ct["fabric_firm_rolls_per_100sf"]) / 330.0, 5),
                "coverage_basis": "per_100sf",
                "optional": False, "default_included": True,
                "sort_order": 3,
                "notes": f"~{ct['fabric_firm_rolls_per_100sf']} lf of 40\" fabric per 100sf (1 roll = 330 lf)",
            })

        docs = [{
            "id": str(uuid.uuid4()),
            "system_id": sys["id"],
            **it, "updated_at": NOW,
        } for it in items]
        if docs:
            await db.system_recipes.insert_many(docs)
            inserted += len(docs)
            print(f"  + {len(docs)} items        {sys['name']}")

    print(f"\nTotal recipe rows inserted: {inserted}")


asyncio.run(main())
