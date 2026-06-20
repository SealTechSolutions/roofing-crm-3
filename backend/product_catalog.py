"""Product Catalog + Roofing System Recipes — backend router.

Three collections power the Material Calculator:
  - product_catalog        : master price list (one row per SKU)
  - roofing_systems        : the 18 named systems (FARM / Silicone / TPO / etc.)
  - system_recipes         : which products + coverage rates make up each system
  - calculator_settings    : singleton for markup% + handling% (admin-tunable)

Endpoints (all prefixed with /api by server.py's include_router):
  GET    /products
  POST   /products
  PATCH  /products/{id}
  DELETE /products/{id}
  POST   /products/import-csv        — bulk upsert from pasted CSV
  GET    /systems
  POST   /systems
  PATCH  /systems/{id}
  DELETE /systems/{id}
  GET    /systems/{id}/recipe        — recipe rows for one system
  PUT    /systems/{id}/recipe        — overwrite entire recipe (atomic)
  GET    /calculator/settings
  PUT    /calculator/settings
"""
from __future__ import annotations

import csv
import io
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Body


CATEGORIES = ["FARM", "Silicone", "TPO", "EPDM", "ModBit", "PVC", "Other"]
UNITS = ["gal", "pail", "roll", "sf", "lf", "ea", "bag", "tube", "box"]
COVERAGE_BASIS = ["per_100sf", "per_sf", "per_lf", "per_each_optional"]

DEFAULT_SETTINGS = {
    "markup_pct": 15.0,        # 15% job-cost markup on raw material
    "handling_pct": 10.0,      # 10% handling fee applied to the marked-up total
    "handling_basis": "marked_up",  # "marked_up" or "raw"
    "waste_pct": 0.0,          # optional waste factor added to qty
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def create_router(db, get_current_user):
    # No prefix here — server.py's api_router already adds "/api".
    router = APIRouter(tags=["product-catalog"])

    # ─────────────────────────────────────────── PRODUCTS ────────────────
    @router.get("/products")
    async def list_products(_=Depends(get_current_user)):
        rows = await db.product_catalog.find(
            {"is_deleted": {"$ne": True}},
            {"_id": 0},
        ).sort("name", 1).to_list(2000)
        return rows

    @router.post("/products")
    async def create_product(body: dict = Body(...), current=Depends(get_current_user)):
        name = (body.get("name") or "").strip()
        if not name:
            raise HTTPException(400, "Product name is required")
        unit_price = float(body.get("unit_price") or 0)
        if unit_price < 0:
            raise HTTPException(400, "Unit price cannot be negative")
        doc = {
            "id": str(uuid.uuid4()),
            "name": name,
            "sku": (body.get("sku") or "").strip(),
            "vendor": (body.get("vendor") or "").strip(),
            "category": (body.get("category") or "").strip(),
            "unit": (body.get("unit") or "gal").strip(),
            "package_size": float(body.get("package_size") or 1),
            "unit_price": unit_price,
            "notes": (body.get("notes") or "").strip(),
            "is_deleted": False,
            "created_at": _now(),
            "created_by": current.get("id"),
            "updated_at": _now(),
        }
        await db.product_catalog.insert_one(doc.copy())
        doc.pop("_id", None)
        return doc

    @router.patch("/products/{product_id}")
    async def update_product(product_id: str, body: dict = Body(...), _=Depends(get_current_user)):
        allowed = {"name", "sku", "vendor", "category", "unit",
                   "package_size", "unit_price", "notes"}
        patch = {k: body[k] for k in body if k in allowed}
        if "unit_price" in patch:
            patch["unit_price"] = float(patch["unit_price"] or 0)
        if "package_size" in patch:
            patch["package_size"] = float(patch["package_size"] or 1)
        patch["updated_at"] = _now()
        result = await db.product_catalog.update_one(
            {"id": product_id, "is_deleted": {"$ne": True}},
            {"$set": patch},
        )
        if not result.matched_count:
            raise HTTPException(404, "Product not found")
        return {"ok": True}

    @router.delete("/products/{product_id}")
    async def delete_product(product_id: str, current=Depends(get_current_user)):
        await db.product_catalog.update_one(
            {"id": product_id},
            {"$set": {"is_deleted": True, "deleted_at": _now(),
                      "deleted_by": current.get("id")}},
        )
        return {"ok": True}

    @router.post("/products/import-csv")
    async def import_csv(body: dict = Body(...), current=Depends(get_current_user)):
        """Bulk import / update products from CSV text.

        Expected header row (case-insensitive, any order):
            name, sku, vendor, category, unit, package_size, unit_price, notes

        Existing rows are upserted by (name, vendor) match so re-uploads
        update prices instead of creating duplicates.
        """
        csv_text = body.get("csv") or ""
        if not csv_text.strip():
            raise HTTPException(400, "Empty CSV")
        reader = csv.DictReader(io.StringIO(csv_text))
        # Normalise header keys to lower-case for forgiving column matching
        if reader.fieldnames is None:
            raise HTTPException(400, "Malformed CSV — could not read header row")
        normaliser = {f: f.strip().lower().replace(" ", "_") for f in reader.fieldnames}
        inserted = updated = 0
        errors: list[dict] = []
        for line_no, raw_row in enumerate(reader, start=2):
            row = {normaliser[k]: (v or "").strip() for k, v in raw_row.items()}
            name = row.get("name", "")
            if not name:
                errors.append({"line": line_no, "error": "missing name"})
                continue
            try:
                unit_price = float(row.get("unit_price") or 0)
                package_size = float(row.get("package_size") or 1)
            except ValueError:
                errors.append({"line": line_no, "error": "non-numeric price or package size"})
                continue
            vendor = row.get("vendor", "")
            existing = await db.product_catalog.find_one(
                {"name": name, "vendor": vendor, "is_deleted": {"$ne": True}},
                {"_id": 0, "id": 1},
            )
            if existing:
                await db.product_catalog.update_one(
                    {"id": existing["id"]},
                    {"$set": {
                        "sku": row.get("sku", ""),
                        "category": row.get("category", ""),
                        "unit": row.get("unit", "gal") or "gal",
                        "package_size": package_size,
                        "unit_price": unit_price,
                        "notes": row.get("notes", ""),
                        "updated_at": _now(),
                    }},
                )
                updated += 1
            else:
                await db.product_catalog.insert_one({
                    "id": str(uuid.uuid4()),
                    "name": name, "sku": row.get("sku", ""),
                    "vendor": vendor, "category": row.get("category", ""),
                    "unit": row.get("unit", "gal") or "gal",
                    "package_size": package_size, "unit_price": unit_price,
                    "notes": row.get("notes", ""),
                    "is_deleted": False, "created_at": _now(),
                    "created_by": current.get("id"), "updated_at": _now(),
                })
                inserted += 1
        return {"inserted": inserted, "updated": updated, "errors": errors}

    # ─────────────────────────────────────────── SYSTEMS ─────────────────
    @router.get("/systems")
    async def list_systems(_=Depends(get_current_user)):
        rows = await db.roofing_systems.find(
            {"is_deleted": {"$ne": True}},
            {"_id": 0},
        ).sort([("category", 1), ("name", 1)]).to_list(200)
        return rows

    @router.post("/systems")
    async def create_system(body: dict = Body(...), current=Depends(get_current_user)):
        name = (body.get("name") or "").strip()
        if not name:
            raise HTTPException(400, "System name is required")
        doc = {
            "id": str(uuid.uuid4()),
            "name": name,
            "category": (body.get("category") or "Other").strip(),
            "description": (body.get("description") or "").strip(),
            "notes": (body.get("notes") or "").strip(),
            "is_deleted": False,
            "created_at": _now(),
            "created_by": current.get("id"),
            "updated_at": _now(),
        }
        await db.roofing_systems.insert_one(doc.copy())
        doc.pop("_id", None)
        return doc

    @router.patch("/systems/{system_id}")
    async def update_system(system_id: str, body: dict = Body(...), _=Depends(get_current_user)):
        allowed = {"name", "category", "description", "notes"}
        patch = {k: body[k] for k in body if k in allowed}
        patch["updated_at"] = _now()
        result = await db.roofing_systems.update_one(
            {"id": system_id, "is_deleted": {"$ne": True}},
            {"$set": patch},
        )
        if not result.matched_count:
            raise HTTPException(404, "System not found")
        return {"ok": True}

    @router.delete("/systems/{system_id}")
    async def delete_system(system_id: str, current=Depends(get_current_user)):
        await db.roofing_systems.update_one(
            {"id": system_id},
            {"$set": {"is_deleted": True, "deleted_at": _now(),
                      "deleted_by": current.get("id")}},
        )
        # Also remove this system's recipe rows so we don't accumulate orphans
        await db.system_recipes.delete_many({"system_id": system_id})
        return {"ok": True}

    # ─────────────────────────────────────────── RECIPES ─────────────────
    @router.get("/systems/{system_id}/recipe")
    async def get_recipe(system_id: str, _=Depends(get_current_user)):
        rows = await db.system_recipes.find(
            {"system_id": system_id},
            {"_id": 0},
        ).sort("sort_order", 1).to_list(500)
        return rows

    @router.put("/systems/{system_id}/recipe")
    async def replace_recipe(system_id: str, body: dict = Body(...), _=Depends(get_current_user)):
        """Atomically overwrite a system's entire recipe.

        Frontend sends `{"items": [{product_id, coverage_rate, coverage_basis,
        optional, default_included, sort_order, notes}, ...]}` and we replace
        all rows for this system in one transaction-ish operation.
        """
        items = body.get("items") or []
        if not isinstance(items, list):
            raise HTTPException(400, "items[] required")
        system = await db.roofing_systems.find_one(
            {"id": system_id, "is_deleted": {"$ne": True}},
            {"_id": 0, "id": 1},
        )
        if not system:
            raise HTTPException(404, "System not found")
        await db.system_recipes.delete_many({"system_id": system_id})
        if not items:
            return {"replaced": 0}
        docs = []
        for i, it in enumerate(items):
            pid = (it.get("product_id") or "").strip()
            if not pid:
                continue
            docs.append({
                "id": str(uuid.uuid4()),
                "system_id": system_id,
                "product_id": pid,
                "coverage_rate": float(it.get("coverage_rate") or 0),
                "coverage_basis": (it.get("coverage_basis") or "per_100sf").strip(),
                "optional": bool(it.get("optional", False)),
                "default_included": bool(it.get("default_included", True)),
                "sort_order": int(it.get("sort_order", i)),
                "notes": (it.get("notes") or "").strip(),
                "updated_at": _now(),
            })
        if docs:
            await db.system_recipes.insert_many(docs)
        return {"replaced": len(docs)}

    # ─────────────────────────────────── CALCULATOR SETTINGS ──────────────
    @router.get("/calculator/settings")
    async def get_settings(_=Depends(get_current_user)):
        doc = await db.calculator_settings.find_one(
            {"_id": "singleton"},
            {"_id": 0},
        )
        return doc or DEFAULT_SETTINGS.copy()

    @router.put("/calculator/settings")
    async def update_settings(body: dict = Body(...), _=Depends(get_current_user)):
        patch = {}
        for k in ("markup_pct", "handling_pct", "waste_pct"):
            if k in body:
                v = float(body[k] or 0)
                if v < 0 or v > 100:
                    raise HTTPException(400, f"{k} must be between 0 and 100")
                patch[k] = v
        if "handling_basis" in body:
            basis = (body["handling_basis"] or "").strip()
            if basis not in ("marked_up", "raw"):
                raise HTTPException(400, "handling_basis must be 'marked_up' or 'raw'")
            patch["handling_basis"] = basis
        if not patch:
            raise HTTPException(400, "No fields to update")
        patch["updated_at"] = _now()
        await db.calculator_settings.update_one(
            {"_id": "singleton"},
            {"$set": patch},
            upsert=True,
        )
        doc = await db.calculator_settings.find_one({"_id": "singleton"}, {"_id": 0})
        return doc

    return router
