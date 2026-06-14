"""Admin Trash — view, restore, or permanently delete soft-deleted records.

Every "Delete" button in the CRM sets `is_deleted: true` instead of hard-deleting.
This module is the admin-only counterpart that lets you:
  - See everything currently in the trash, grouped by resource type
  - Restore an item (un-soft-delete)
  - Permanently purge an item (real Mongo delete + Object Storage cleanup for files)
  - Empty a whole bucket at once

Object Storage cleanup is best-effort — if Emergent storage 404s the file
(already gone), we proceed with the Mongo delete.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException

from storage import delete_object

logger = logging.getLogger("trash")

# Maps a friendly resource name -> (collection, display label, label field, storage_path_field)
# storage_path_field is set only for resources whose deletion should also wipe the underlying
# blob from Emergent Object Storage.
RESOURCE_MAP: dict[str, dict] = {
    "library_files":   {"coll": "library_files",   "label": "Document",       "label_field": "display_name",      "storage": "storage_path"},
    "project_photos":  {"coll": "project_photos",  "label": "Photo",          "label_field": "display_name",      "storage": "storage_path"},
    "contacts":        {"coll": "contacts",        "label": "Contact",        "label_field": "name",              "storage": None},
    "properties":      {"coll": "properties",      "label": "Property",       "label_field": "name",              "storage": None},
    "deals":           {"coll": "deals",           "label": "Project",        "label_field": "title",             "storage": None},
    "invoices":        {"coll": "invoices",        "label": "Invoice",        "label_field": "invoice_number",    "storage": None},
    "vendor_bills":    {"coll": "vendor_bills",    "label": "Vendor Bill",    "label_field": "bill_number",       "storage": None},
    "vendors":         {"coll": "vendors",         "label": "Vendor/Sub",     "label_field": "name",              "storage": None},
    "materials":       {"coll": "materials",       "label": "Material",       "label_field": "name",              "storage": None},
    "journal_templates": {"coll": "journal_templates", "label": "Journal Template", "label_field": "name",          "storage": None},
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _validate(resource: str) -> dict:
    if resource not in RESOURCE_MAP:
        raise HTTPException(status_code=400, detail=f"Unknown trash resource '{resource}'. Allowed: {list(RESOURCE_MAP.keys())}")
    return RESOURCE_MAP[resource]


def create_router(db, require_admin) -> APIRouter:
    router = APIRouter(prefix="/trash", tags=["Trash"])

    @router.get("/counts")
    async def trash_counts(_=Depends(require_admin)):
        """Returns the count of soft-deleted items per resource type. Powers the tab badges."""
        out = []
        total = 0
        for key, cfg in RESOURCE_MAP.items():
            n = await db[cfg["coll"]].count_documents({"is_deleted": True})
            out.append({"resource": key, "label": cfg["label"], "count": n})
            total += n
        return {"buckets": out, "total": total}

    @router.get("/{resource}")
    async def list_trash(resource: str, _=Depends(require_admin)):
        cfg = _validate(resource)
        cur = db[cfg["coll"]].find(
            {"is_deleted": True},
            {"_id": 0},
        ).sort("deleted_at", -1).limit(500)
        rows = []
        async for d in cur:
            rows.append({
                "id": d.get("id"),
                "label": d.get(cfg["label_field"]) or "(unnamed)",
                "deleted_at": d.get("deleted_at"),
                "deleted_by": d.get("deleted_by"),
                "created_at": d.get("created_at"),
                "size": d.get("size"),
                "storage_path": d.get(cfg["storage"]) if cfg["storage"] else None,
                # Extra context fields useful in the trash table
                "extra": {
                    k: d.get(k) for k in (
                        "album_name", "tag", "content_type", "category",
                        "kind", "deal_id", "vendor_name", "bill_to_company", "total"
                    ) if d.get(k) is not None
                },
            })
        return rows

    @router.post("/{resource}/{item_id}/restore")
    async def restore(resource: str, item_id: str, current=Depends(require_admin)):
        cfg = _validate(resource)
        existing = await db[cfg["coll"]].find_one({"id": item_id, "is_deleted": True}, {"_id": 0})
        if not existing:
            raise HTTPException(status_code=404, detail=f"{cfg['label']} not found in trash")
        await db[cfg["coll"]].update_one(
            {"id": item_id},
            {"$set": {
                "is_deleted": False,
                "restored_at": _now_iso(),
                "restored_by": current["id"],
            }, "$unset": {"deleted_at": "", "deleted_by": ""}},
        )
        return {"ok": True, "restored": item_id}

    @router.delete("/{resource}/{item_id}/purge")
    async def purge(resource: str, item_id: str, current=Depends(require_admin)):
        cfg = _validate(resource)
        existing = await db[cfg["coll"]].find_one({"id": item_id, "is_deleted": True}, {"_id": 0})
        if not existing:
            raise HTTPException(status_code=404, detail=f"{cfg['label']} not found in trash (only soft-deleted items can be purged)")

        storage_cleanup_status = "n/a"
        if cfg["storage"]:
            sp = existing.get(cfg["storage"])
            if sp:
                try:
                    found = delete_object(sp)
                    storage_cleanup_status = "deleted" if found else "already gone"
                except Exception as e:
                    logger.warning(f"Object storage delete failed for {sp}: {e}")
                    storage_cleanup_status = f"failed: {e}"
                    # Don't block the Mongo delete on storage failures — log and continue

        await db[cfg["coll"]].delete_one({"id": item_id})

        # Audit row for post-mortem traceability
        await db.trash_purge_log.insert_one({
            "resource": resource,
            "item_id": item_id,
            "label": existing.get(cfg["label_field"]),
            "purged_at": _now_iso(),
            "purged_by": current["id"],
            "purger_name": current.get("name", ""),
            "storage_cleanup": storage_cleanup_status,
        })
        return {"ok": True, "purged": item_id, "storage_cleanup": storage_cleanup_status}

    @router.post("/{resource}/empty")
    async def empty_bucket(
        resource: str,
        body: dict = Body(default={}),
        current=Depends(require_admin),
    ):
        """Bulk purge every soft-deleted item in a resource bucket. Requires
        a confirmation token in the body: {"confirm": "EMPTY"} ."""
        cfg = _validate(resource)
        if (body or {}).get("confirm") != "EMPTY":
            raise HTTPException(status_code=400, detail='Confirmation required — body must include {"confirm": "EMPTY"}')

        cur = db[cfg["coll"]].find({"is_deleted": True}, {"_id": 0})
        purged, storage_ok, storage_failed = 0, 0, 0
        ids = []
        async for d in cur:
            ids.append(d.get("id"))
            if cfg["storage"]:
                sp = d.get(cfg["storage"])
                if sp:
                    try:
                        delete_object(sp)
                        storage_ok += 1
                    except Exception as e:
                        logger.warning(f"Empty-trash storage delete failed for {sp}: {e}")
                        storage_failed += 1
        if ids:
            res = await db[cfg["coll"]].delete_many({"id": {"$in": ids}, "is_deleted": True})
            purged = res.deleted_count
            await db.trash_purge_log.insert_one({
                "resource": resource,
                "bulk": True,
                "purged_count": purged,
                "storage_ok": storage_ok,
                "storage_failed": storage_failed,
                "purged_at": _now_iso(),
                "purged_by": current["id"],
                "purger_name": current.get("name", ""),
            })
        return {"ok": True, "purged": purged, "storage_ok": storage_ok, "storage_failed": storage_failed}

    @router.get("/audit/purge-log")
    async def purge_log(limit: int = 100, _=Depends(require_admin)):
        cur = db.trash_purge_log.find({}, {"_id": 0}).sort("purged_at", -1).limit(int(limit))
        return [r async for r in cur]

    return router
