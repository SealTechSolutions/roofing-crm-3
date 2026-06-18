"""Project Photos — per-project photo galleries with optional public sharing.

Storage:
- `project_photos`: one doc per photo (id, deal_id, album_name, tag, storage_path, ...)
- `photo_shares`: public share tokens (token, deal_id, filters, expires_at, view_count, download_enabled)

Endpoints:
  /api/projects/{deal_id}/photos               — list, upload
  /api/projects/{deal_id}/photos/{photo_id}    — get, update (album/tag/name), delete
  /api/projects/{deal_id}/photos/{photo_id}/download
  /api/projects/{deal_id}/photo-shares         — create share token
  /api/projects/{deal_id}/photo-shares/list    — list active shares
  /api/projects/{deal_id}/photo-shares/{token} — revoke (delete) a share
  /api/public/photo-share/{token}              — list photos (no auth, public)
  /api/public/photo-share/{token}/file/{photo_id}  — stream/download photo (no auth)
"""
from __future__ import annotations

import io
import os
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Body
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict

from storage import put_object, get_object, APP_NAME
from progress_timeline_pdf import build_progress_timeline_pdf

ALLOWED_CONTENT_TYPES = {
    "image/jpeg", "image/jpg", "image/png", "image/webp",
    "image/heic", "image/heif", "image/gif",
}
PRESET_TAGS = [
    "Before", "During", "After", "Drone",
    "Detail Shots", "Damage Documentation",
]
MAX_BYTES = 25 * 1024 * 1024  # 25 MB per photo


# ---------- Pydantic ----------
class PhotoUpdate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    album_name: Optional[str] = None
    tag: Optional[str] = None
    display_name: Optional[str] = None
    description: Optional[str] = None
    is_cover: Optional[bool] = None


class ShareCreate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    album_name: Optional[str] = None              # filter the share to one album (None = all)
    tag: Optional[str] = None                     # filter the share to one tag
    download_enabled: bool = True
    expires_in_days: Optional[int] = 90           # None or 0 → no expiry


# ---------- Helpers ----------
def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ext_for(filename: str) -> str:
    return (filename.rsplit(".", 1)[-1] if "." in filename else "jpg").lower()


def _make_share_url(req_base: str, token: str) -> str:
    base = (req_base or "").rstrip("/")
    return f"{base}/share/photos/{token}" if base else f"/share/photos/{token}"


# ---------- Router ----------
def create_router(db, get_current_user) -> APIRouter:
    router = APIRouter(prefix="/projects/{deal_id}", tags=["Project Photos"])

    async def _ensure_deal(deal_id: str) -> dict:
        deal = await db.deals.find_one({"id": deal_id, "is_deleted": {"$ne": True}}, {"_id": 0})
        if not deal:
            raise HTTPException(status_code=404, detail="Project not found")
        return deal

    # ---------- Photo CRUD ----------
    @router.get("/photos")
    async def list_photos(
        deal_id: str,
        album_name: Optional[str] = None,
        tag: Optional[str] = None,
        _=Depends(get_current_user),
    ):
        await _ensure_deal(deal_id)
        q = {"deal_id": deal_id, "is_deleted": {"$ne": True}}
        if album_name:
            q["album_name"] = album_name
        if tag:
            q["tag"] = tag
        rows = await db.project_photos.find(q, {"_id": 0}).sort("created_at", -1).to_list(2000)
        return rows

    @router.post("/photos")
    async def upload_photo(
        deal_id: str,
        file: UploadFile = File(...),
        album_name: str = Form("Default"),
        tag: str = Form(""),
        display_name: str = Form(""),
        description: str = Form(""),
        gps_lat: Optional[float] = Form(None),
        gps_lng: Optional[float] = Form(None),
        gps_accuracy: Optional[float] = Form(None),
        captured_at: str = Form(""),
        stamped: bool = Form(False),
        current=Depends(get_current_user),
    ):
        await _ensure_deal(deal_id)
        ct = (file.content_type or "").lower()
        if ct not in ALLOWED_CONTENT_TYPES and not ct.startswith("image/"):
            raise HTTPException(status_code=400, detail=f"Only image files allowed. Got: {ct}")
        if tag and tag not in PRESET_TAGS:
            raise HTTPException(status_code=400, detail=f"Invalid tag. Allowed: {', '.join(PRESET_TAGS)}")

        data = await file.read()
        if len(data) > MAX_BYTES:
            raise HTTPException(status_code=413, detail=f"Image too large (max {MAX_BYTES // (1024 * 1024)} MB)")

        photo_id = str(uuid.uuid4())
        ext = _ext_for(file.filename or "photo.jpg")
        storage_path = f"{APP_NAME}/project_photos/{deal_id}/{photo_id}.{ext}"

        try:
            result = put_object(storage_path, data, ct or "image/jpeg")
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Upload failed: {e}")

        doc = {
            "id": photo_id,
            "deal_id": deal_id,
            "album_name": (album_name or "Default").strip() or "Default",
            "tag": tag.strip(),
            "display_name": (display_name.strip() or file.filename or "Photo"),
            "description": description.strip(),
            "storage_path": result["path"],
            "original_filename": file.filename,
            "content_type": ct or "image/jpeg",
            "size": len(data),
            "is_deleted": False,
            "is_cover": False,
            "uploaded_by": current["id"],
            "uploader_name": current.get("name", ""),
            "created_at": _now_iso(),
            # Proof-of-presence metadata (also burned into the JPEG as a stamp
            # when `stamped=True`). Lets us sort/map photos by site visit
            # later without re-running OCR on the burned-in text.
            "gps_lat": gps_lat,
            "gps_lng": gps_lng,
            "gps_accuracy": gps_accuracy,
            "captured_at": captured_at or _now_iso(),
            "stamped": bool(stamped),
        }
        await db.project_photos.insert_one(doc.copy())
        doc.pop("_id", None)
        return doc

    @router.patch("/photos/{photo_id}")
    async def update_photo(deal_id: str, photo_id: str, body: PhotoUpdate, _=Depends(get_current_user)):
        existing = await db.project_photos.find_one({"id": photo_id, "deal_id": deal_id, "is_deleted": {"$ne": True}}, {"_id": 0})
        if not existing:
            raise HTTPException(status_code=404, detail="Photo not found")
        patch = body.model_dump(exclude_unset=True)
        if "tag" in patch and patch["tag"] and patch["tag"] not in PRESET_TAGS:
            raise HTTPException(status_code=400, detail=f"Invalid tag. Allowed: {', '.join(PRESET_TAGS)}")
        # If toggling is_cover=True → unset cover on all other photos for the same deal
        if patch.get("is_cover") is True:
            await db.project_photos.update_many(
                {"deal_id": deal_id, "id": {"$ne": photo_id}},
                {"$set": {"is_cover": False}},
            )
        patch["updated_at"] = _now_iso()
        await db.project_photos.update_one({"id": photo_id, "deal_id": deal_id}, {"$set": patch})
        return await db.project_photos.find_one({"id": photo_id, "deal_id": deal_id}, {"_id": 0})

    @router.delete("/photos/{photo_id}")
    async def delete_photo(deal_id: str, photo_id: str, current=Depends(get_current_user)):
        await db.project_photos.update_one(
            {"id": photo_id, "deal_id": deal_id},
            {"$set": {"is_deleted": True, "deleted_at": _now_iso(), "deleted_by": current["id"]}},
        )
        return {"ok": True}

    @router.get("/photos/{photo_id}/download")
    async def download_photo(deal_id: str, photo_id: str, _=Depends(get_current_user)):
        rec = await db.project_photos.find_one(
            {"id": photo_id, "deal_id": deal_id, "is_deleted": {"$ne": True}},
            {"_id": 0},
        )
        if not rec:
            raise HTTPException(status_code=404, detail="Photo not found")
        try:
            content, _ct = get_object(rec["storage_path"])
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Storage fetch failed: {e}")
        filename = rec.get("original_filename") or f'{rec["id"]}.jpg'
        return StreamingResponse(
            io.BytesIO(content),
            media_type=rec.get("content_type", "image/jpeg"),
            headers={"Content-Disposition": f'inline; filename="{filename}"'},
        )

    # ---------- Progress Timeline PDF ----------
    @router.get("/photos/timeline.pdf")
    async def timeline_pdf(
        deal_id: str,
        album_name: Optional[str] = None,
        tag: Optional[str] = None,
        _=Depends(get_current_user),
    ):
        """Streaming PDF: cover page + per-date photo grid, ordered oldest-first.

        Optional `album_name` / `tag` query params filter the photo set so the
        user can export e.g. only "After" shots or only the "Drone" album.
        """
        deal = await _ensure_deal(deal_id)
        q = {"deal_id": deal_id, "is_deleted": {"$ne": True}}
        if album_name:
            q["album_name"] = album_name
        if tag:
            q["tag"] = tag
        photos = await db.project_photos.find(q, {"_id": 0}).sort("created_at", 1).to_list(2000)
        # Fetch the linked property for the cover-page address (best-effort).
        property_doc = None
        if deal.get("property_id"):
            property_doc = await db.properties.find_one({"id": deal["property_id"]}, {"_id": 0})
        try:
            pdf_bytes = build_progress_timeline_pdf(deal, photos, property_doc=property_doc)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"PDF generation failed: {e}")
        safe_title = "".join(c if c.isalnum() or c in "-_ " else "_" for c in (deal.get("title") or "Project"))
        filename = f"{safe_title} - Progress Timeline.pdf"
        return StreamingResponse(
            io.BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    # ---------- Public shares ----------
    @router.post("/photo-shares")
    async def create_share(deal_id: str, body: ShareCreate, current=Depends(get_current_user)):
        await _ensure_deal(deal_id)
        token = uuid.uuid4().hex[:24]
        expires_at = None
        if body.expires_in_days and body.expires_in_days > 0:
            expires_at = (datetime.now(timezone.utc) + timedelta(days=int(body.expires_in_days))).isoformat()
        doc = {
            "token": token,
            "deal_id": deal_id,
            "album_name": (body.album_name or "").strip() or None,
            "tag": (body.tag or "").strip() or None,
            "download_enabled": bool(body.download_enabled),
            "created_at": _now_iso(),
            "created_by": current["id"],
            "creator_name": current.get("name", ""),
            "expires_at": expires_at,
            "is_revoked": False,
            "view_count": 0,
        }
        await db.photo_shares.insert_one(doc.copy())
        doc.pop("_id", None)
        return doc

    @router.get("/photo-shares/list")
    async def list_shares(deal_id: str, _=Depends(get_current_user)):
        rows = await db.photo_shares.find(
            {"deal_id": deal_id, "is_revoked": {"$ne": True}},
            {"_id": 0},
        ).sort("created_at", -1).to_list(200)
        return rows

    @router.delete("/photo-shares/{token}")
    async def revoke_share(deal_id: str, token: str, _=Depends(get_current_user)):
        await db.photo_shares.update_one(
            {"token": token, "deal_id": deal_id},
            {"$set": {"is_revoked": True, "revoked_at": _now_iso()}},
        )
        return {"ok": True}

    return router


def create_public_router(db) -> APIRouter:
    """Unauthenticated photo-share endpoints. Anyone with the token sees the photos."""
    router = APIRouter(prefix="/public/photo-share", tags=["Public Photo Share"])

    async def _resolve_share(token: str) -> dict:
        share = await db.photo_shares.find_one({"token": token, "is_revoked": {"$ne": True}}, {"_id": 0})
        if not share:
            raise HTTPException(status_code=404, detail="Share link not found or revoked")
        exp = share.get("expires_at")
        if exp and exp < _now_iso():
            raise HTTPException(status_code=410, detail="This share link has expired")
        return share

    @router.get("/{token}")
    async def public_list(token: str):
        share = await _resolve_share(token)
        # Filter photos per the share's album_name + tag filters
        q = {"deal_id": share["deal_id"], "is_deleted": {"$ne": True}}
        if share.get("album_name"):
            q["album_name"] = share["album_name"]
        if share.get("tag"):
            q["tag"] = share["tag"]
        photos = await db.project_photos.find(q, {"_id": 0, "storage_path": 0, "uploaded_by": 0}).sort("created_at", -1).to_list(2000)
        # Fetch deal title for the gallery header
        deal = await db.deals.find_one({"id": share["deal_id"]}, {"_id": 0, "title": 1})
        # Increment view counter
        await db.photo_shares.update_one({"token": token}, {"$inc": {"view_count": 1}, "$set": {"last_viewed_at": _now_iso()}})
        return {
            "project_title": (deal or {}).get("title") or "Photo Gallery",
            "download_enabled": bool(share.get("download_enabled")),
            "album_name": share.get("album_name"),
            "tag": share.get("tag"),
            "photos": photos,
        }

    @router.get("/{token}/file/{photo_id}")
    async def public_file(token: str, photo_id: str):
        share = await _resolve_share(token)
        q = {"id": photo_id, "deal_id": share["deal_id"], "is_deleted": {"$ne": True}}
        if share.get("album_name"):
            q["album_name"] = share["album_name"]
        if share.get("tag"):
            q["tag"] = share["tag"]
        rec = await db.project_photos.find_one(q, {"_id": 0})
        if not rec:
            raise HTTPException(status_code=404, detail="Photo not found in this share")
        try:
            content, _ct = get_object(rec["storage_path"])
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Storage fetch failed: {e}")
        filename = rec.get("original_filename") or f'{rec["id"]}.jpg'
        disposition = "attachment" if share.get("download_enabled") else "inline"
        return StreamingResponse(
            io.BytesIO(content),
            media_type=rec.get("content_type", "image/jpeg"),
            headers={"Content-Disposition": f'{disposition}; filename="{filename}"'},
        )

    return router
