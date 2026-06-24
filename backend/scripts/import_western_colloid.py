"""One-shot import of Western Colloid product catalog + systems.

Source CSV has each product row carrying up to 5 package-size prices
(Fabric Roll / Tote 275gal / Drum 55gal / Pail 5gal / Pail 3.5gal). We
explode each non-empty price into its own product_catalog row so the
Material Calculator can round to whole containers later.

The right side of the same sheet encodes 9 Western Colloid systems with
coverage rates (gal per 100 sf) for 4 categories: Emulsion, Acrylic,
Fabric Soft, Fabric Firm. We create the systems and stamp a JSON blob of
those coverage rates on each system's `coverage_template` field so the
recipe editor can prefill correctly when Darren maps category-to-product.
"""
import asyncio, os, uuid
from datetime import datetime, timezone
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv("/app/backend/.env")
NOW = datetime.now(timezone.utc).isoformat()

# (Vendor Number, Product Name, fabric_roll, tote_275, drum_55, pail_5, pail_3p5)
RAW_PRODUCTS = [
    ("298",         "Asphalt Emulsion Non-Fibered",                                            None, 1400.0, 375.0,  45.0,  None),
    ("720 ARC",     "ElastaHyde White Elastomeric Acrylic Roof Coating",                       None, 6500.0, 1300.0, 135.0, None),
    ("790 AFC",     "White Elastomeric Acrylic Foam, EPDM & Roof Coating",                     None, 7500.0, 1600.0, 149.0, None),
    ("720 ARC QS",  "ElastaHyde Quick Set — Wet/Cold Weather Formulation",                     None, 7500.0, 1600.0, 149.0, None),
    ("790 AFC QS",  "ElastaHyde 790 Quick Set — Wet/Cold Weather Formulation",                 None, 8500.0, 1700.0, 165.0, None),
    ("800 W",       "Elastic Cement White Flashing Compound (Water-Based)",                    None, None,   None,   None,  110.0),
    ("801 B",       "Elastic Cement Black Flashing Compound (Water-Based)",                    None, None,   None,   None,  110.0),
    ("800 Spray",   "Elastic Cement White Flashing Spray Compound (Water-Based)",              None, None,   1500.0, None,  None),
    ("8000",        "All-Weather Elastic Cement White Wet/Dry Flashing Compound (Solvent)",    None, 1500.0, None,   170.0, None),
    ("850 SWS Grey",      "Seamless Walkway System Coating — Grey (Water-Based)",              None, None,   None,   150.0, None),
    ("850 SWS Yellow",    "Seamless Walkway System Coating — Burnt Yellow (Water-Based)",      None, None,   None,   150.0, None),
    ("930",         "TPO Primer — Improves Adhesion to Existing TPO Membranes",                None, None,   1875.0, 190.0, None),
    ("9000",        "Roof Wash & Prep Concentrate",                                             None, None,   None,   75.0,  None),
    ("WCP-SF 40\"", "Standard Firm Fabric 40\" x 330'",                                        110.0, None,  None,   None,  None),
    ("WCP-SS 40\"", "Standard Soft Fabric 40\" x 330'",                                        135.0, None,  None,   None,  None),
    ("4\" x 300'",  "Standard Soft Fabric 4\" x 300'",                                          30.0, None,  None,   None,  None),
    ("6\" x 300'",  "Standard Soft Fabric 6\" x 300'",                                          39.0, None,  None,   None,  None),
    ("12\" x 300'", "Standard Soft Fabric 12\" x 300'",                                         75.0, None,  None,   None,  None),
    ("20\" x 300'", "Standard Soft Fabric 20\" x 300'",                                        105.0, None,  None,   None,  None),
]

# Each tuple: package label, unit, package_size (units per container)
PACKAGES = [
    ("Fabric Roll",  "roll", 1),
    ("275 gal Tote", "gal",  275),
    ("55 gal Drum",  "gal",  55),
    ("5 gal Pail",   "gal",  5),
    ("3.5 gal Pail", "gal",  3.5),
]

# 9 Western Colloid systems with coverage in gallons per 100 sf for 4 categories.
# (system name, system_type, warranty_years, emulsion, acrylic, fabric_soft, fabric_firm)
RAW_SYSTEMS = [
    ("15-Year Gravel System (E/A)",          "FARM",        15, 26, 9,  3, 0),
    ("20-Year Gravel System (E/A)",          "FARM",        20, 32, 6,  3, 0),
    ("25-Year Membrane System (E/A)",        "FARM",        25, 6,  9,  0, 3),
    ("20-Year Membrane System (E/A)",        "FARM",        20, 12, 6,  0, 3),
    ("20-Year All-Acrylic Membrane (AA)",    "All-Acrylic", 20, 0,  9,  0, 2),
    ("15-Year Membrane System (E/A)",        "FARM",        15, 6,  6,  0, 2),
    ("10-Year Membrane System (E/A)",        "FARM",        10, 10, 3,  0, 2),
    ("10-Year All-Acrylic Membrane (AA)",    "All-Acrylic", 10, 0,  6,  0, 1),
    ("10-Year Metal Roof System (AA)",       "All-Acrylic", 10, 0,  3,  0, 0),
]

async def main():
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]

    # ----- Products -----
    inserted_products = 0
    for sku, name, fabric, tote, drum, pail5, pail3p5 in RAW_PRODUCTS:
        prices = [
            (PACKAGES[0], fabric),
            (PACKAGES[1], tote),
            (PACKAGES[2], drum),
            (PACKAGES[3], pail5),
            (PACKAGES[4], pail3p5),
        ]
        for (label, unit, pkg_size), price in prices:
            if price is None:
                continue
            full_name = f"{name} — {label}"
            # Skip if already imported
            if await db.product_catalog.find_one({"name": full_name, "vendor": "Western Colloid", "is_deleted": {"$ne": True}}):
                continue
            await db.product_catalog.insert_one({
                "id": str(uuid.uuid4()),
                "name": full_name,
                "sku": sku,
                "vendor": "Western Colloid",
                "category": "FARM",
                "unit": unit,
                "package_size": pkg_size,
                "unit_price": round(price / pkg_size, 2) if pkg_size > 0 else price,
                "notes": f"Container price: ${price:,.2f}",
                "is_deleted": False,
                "created_at": NOW,
                "updated_at": NOW,
            })
            inserted_products += 1
    print(f"Products inserted: {inserted_products}")

    # ----- Systems with coverage template -----
    inserted_systems = 0
    for sys_name, sys_type, warranty, emulsion, acrylic, fab_soft, fab_firm in RAW_SYSTEMS:
        if await db.roofing_systems.find_one({"name": sys_name, "vendor": "Western Colloid", "is_deleted": {"$ne": True}}):
            continue
        await db.roofing_systems.insert_one({
            "id": str(uuid.uuid4()),
            "name": sys_name,
            "vendor": "Western Colloid",
            "system_type": sys_type,
            "category": sys_type,
            "warranty_years": warranty,
            "description": f"Western Colloid {sys_type} system, {warranty}-yr warranty",
            "notes": "",
            "coverage_template": {
                "emulsion_gal_per_100sf":     emulsion,
                "acrylic_gal_per_100sf":      acrylic,
                "fabric_soft_rolls_per_100sf": fab_soft,
                "fabric_firm_rolls_per_100sf": fab_firm,
            },
            "is_deleted": False,
            "created_at": NOW,
            "updated_at": NOW,
        })
        inserted_systems += 1
    print(f"Systems inserted: {inserted_systems}")

asyncio.run(main())
