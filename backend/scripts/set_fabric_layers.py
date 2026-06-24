"""One-shot rewrite of all Western Colloid fabric recipe rows using the
verified layer formula:

    rolls per 100 sf  =  fabric_layers / 10

(One 40"×330' roll covers ~1,000 sf of roof — about 10 squares —
after standard 3"–4" overlap waste. Confirmed against Darren's
@ 42 sq sample: 1-layer=5 rolls, 2-layer=9, 3-layer=13.)
"""
import asyncio, os
from datetime import datetime, timezone
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv("/app/backend/.env")

# system_name -> (fabric_type, layer_count)
LAYER_MAP = {
    "15-Year Gravel System (E/A)":      ("soft", 3),  # confirmed by Darren (renamed from 25-Year Gravel)
    "20-Year Gravel System (E/A)":      ("soft", 3),  # confirmed by Darren
    "25-Year Membrane System (E/A)":    ("firm", 3),
    "20-Year Membrane System (E/A)":    ("firm", 3),  # math-verified (13 rolls @ 42 sq)
    "15-Year Membrane System (E/A)":    ("firm", 2),  # confirmed by Darren
    "10-Year Membrane System (E/A)":    ("firm", 1),  # math-verified (5 rolls @ 42 sq)
    "20-Year All-Acrylic Membrane (AA)":("firm", 2),
    "10-Year All-Acrylic Membrane (AA)":("firm", 1),
    "10-Year Metal Roof System (AA)":   ("firm", 0),  # no fabric
}


async def main():
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]
    now = datetime.now(timezone.utc).isoformat()

    fab_soft = await db.product_catalog.find_one({"vendor":"Western Colloid","sku":'WCP-SS 40"',"is_deleted":{"$ne":True}}, {"id":1})
    fab_firm = await db.product_catalog.find_one({"vendor":"Western Colloid","sku":'WCP-SF 40"',"is_deleted":{"$ne":True}}, {"id":1})
    print(f"Soft fabric product: {fab_soft['id'][:8]}…   Firm: {fab_firm['id'][:8]}…")

    for sys_name, (fab_type, layers) in LAYER_MAP.items():
        sys = await db.roofing_systems.find_one({"name": sys_name, "is_deleted": {"$ne": True}}, {"id": 1})
        if not sys:
            print(f"  NOT FOUND: {sys_name}")
            continue
        target_product_id = fab_soft["id"] if fab_type == "soft" else fab_firm["id"]

        # Remove ALL existing fabric recipe rows (both soft+firm) for this system
        await db.system_recipes.delete_many({
            "system_id": sys["id"],
            "product_id": {"$in": [fab_soft["id"], fab_firm["id"]]},
        })

        if layers == 0:
            print(f"  {sys_name:38} -> no fabric (0 layers)")
            continue

        rate = round(layers / 10.0, 4)   # rolls per 100 sf
        import uuid
        await db.system_recipes.insert_one({
            "id": str(uuid.uuid4()),
            "system_id": sys["id"],
            "product_id": target_product_id,
            "coverage_rate": rate,
            "coverage_basis": "per_100sf",
            "optional": False,
            "default_included": True,
            "sort_order": 5,
            "notes": f"{layers} layer{'s' if layers != 1 else ''} of 40\" {fab_type} fabric "
                     f"(~1,000 sf coverage per roll incl. overlap)",
            "updated_at": now,
        })
        print(f"  ✓ {sys_name:38}  ->  {layers} layer(s) {fab_type:4}  ({rate} rolls/100sf)")

    print("\nDone.")


asyncio.run(main())
