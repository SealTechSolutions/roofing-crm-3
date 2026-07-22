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
from PIL import Image, ExifTags

from storage import put_object, get_object, APP_NAME
from progress_timeline_pdf import build_progress_timeline_pdf
from maintenance_report_pdf import build_maintenance_report_pdf

# EXIF tag ids we care about. Pillow exposes ExifTags.TAGS as {id: name} so we
# invert to grab the IDs once at import.
_EXIF_TAG_IDS = {name: tag_id for tag_id, name in ExifTags.TAGS.items()}
_EXIF_DATETIME_TAGS = (
    _EXIF_TAG_IDS.get("DateTimeOriginal"),     # the actual shutter timestamp
    _EXIF_TAG_IDS.get("DateTimeDigitized"),    # fallback if Original is missing
    _EXIF_TAG_IDS.get("DateTime"),             # last-resort: file's metadata stamp
)


def _exif_captured_at(image_bytes: bytes) -> Optional[str]:
    """Read EXIF and return the photo's true capture timestamp as ISO 8601.

    Returns None if the file has no EXIF or no parseable date. The EXIF spec
    formats dates as "YYYY:MM:DD HH:MM:SS" (colon-separated date), so we have
    to swap the first two colons to dashes before passing to fromisoformat.
    Used by the upload endpoint so emailed/forwarded photos sort to their
    real shutter date instead of the upload date.
    """
    try:
        with Image.open(io.BytesIO(image_bytes)) as im:
            exif = im.getexif() if hasattr(im, "getexif") else None
            if not exif:
                return None
            for tag_id in _EXIF_DATETIME_TAGS:
                if not tag_id:
                    continue
                raw = exif.get(tag_id)
                if not raw:
                    continue
                # Normalize "YYYY:MM:DD HH:MM:SS" → "YYYY-MM-DDTHH:MM:SS"
                s = str(raw).strip()
                if len(s) < 19:
                    continue
                normalized = s[:4] + "-" + s[5:7] + "-" + s[8:10] + "T" + s[11:19]
                try:
                    dt = datetime.fromisoformat(normalized)
                    # EXIF datetimes are local-time without zone info. Treat as UTC
                    # rather than guessing the device's timezone — keeps the value
                    # JSON-roundtrippable and sortable.
                    return dt.replace(tzinfo=timezone.utc).isoformat()
                except Exception:
                    continue
    except Exception:
        return None
    return None

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


def _ext_from_ct(content_type: str) -> str:
    """Best-effort file extension from a browser-supplied Content-Type.
    Whisper's SDK sniffs format from the filename extension, so when we
    only have a raw BytesIO in-memory blob we set `.name` to something
    ending in a supported extension (webm/m4a/mp3/wav/ogg)."""
    ct = (content_type or "").split(";", 1)[0].strip().lower()
    return {
        "audio/webm": "webm",
        "audio/ogg": "ogg",
        "audio/mp4": "m4a",
        "audio/x-m4a": "m4a",
        "audio/m4a": "m4a",
        "audio/mpeg": "mp3",
        "audio/mp3": "mp3",
        "audio/wav": "wav",
        "audio/x-wav": "wav",
        "audio/wave": "wav",
        "video/mp4": "m4a",   # iOS occasionally mislabels AAC-in-MP4 audio as video
        "video/webm": "webm",
    }.get(ct, "webm")


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

        # If the client didn't pass an explicit capture timestamp, try to pull
        # it from the JPEG's EXIF metadata. This makes the timeline correct
        # for photos forwarded from a foreman's email days after they were
        # actually taken — every iPhone/Android camera writes DateTimeOriginal.
        resolved_captured_at = (captured_at or "").strip()
        if not resolved_captured_at:
            exif_ts = _exif_captured_at(data)
            if exif_ts:
                resolved_captured_at = exif_ts
        if not resolved_captured_at:
            resolved_captured_at = _now_iso()

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
            "captured_at": resolved_captured_at,
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

    # ---------- Voice → text caption (Whisper) ----------
    @router.post("/photos/transcribe")
    async def transcribe_voice_caption(
        deal_id: str,
        file: UploadFile = File(...),
        _=Depends(get_current_user),
    ):
        """Transcribe a short audio clip into text for use as a photo caption.

        Field workers hit the mic button on a photo, dictate a note like
        "membrane blistering by the roof drain, needs immediate patch",
        we send the ~5–30 second recording (browser MediaRecorder → webm/opus,
        or iOS Capacitor → m4a) to OpenAI Whisper via the Emergent
        Universal Key. Both formats are natively supported by whisper-1.

        Frontend then places the returned text in the description input so
        the rep can edit/save. Non-destructive: we never auto-save.
        """
        # Import lazily so the module loads even in environments where the
        # emergentintegrations package isn't installed yet.
        from emergentintegrations.llm.openai import OpenAISpeechToText
        key = os.environ.get("EMERGENT_LLM_KEY")
        if not key:
            raise HTTPException(status_code=500, detail="Voice captions not configured (missing EMERGENT_LLM_KEY)")

        ct = (file.content_type or "").lower()
        if not (ct.startswith("audio/") or ct in {"video/mp4", "video/webm"}):
            # iOS voice memos sometimes report "audio/mp4" or "audio/x-m4a";
            # browsers report "audio/webm;codecs=opus". Anything else likely
            # means the mic wasn't captured properly.
            raise HTTPException(status_code=400, detail=f"Only audio files allowed. Got: {ct}")

        data = await file.read()
        # Whisper API caps at 25MB; a 30-sec voice memo is ~500KB so we
        # only reject truly aberrant uploads (accidental video, etc.).
        if len(data) > 25 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="Audio too large (max 25 MB)")
        if len(data) < 500:
            # Under half a KB is almost certainly an empty recording from
            # a "tap-then-release-too-fast" mic press.
            raise HTTPException(status_code=400, detail="Recording too short — please record at least 1 second.")

        try:
            stt = OpenAISpeechToText(api_key=key)
            # Whisper accepts a file-like object with a `.name` attribute
            # (used to sniff the format). BytesIO alone would fail if the
            # SDK can't infer format, so we wrap and set `.name` explicitly.
            bio = io.BytesIO(data)
            bio.name = file.filename or f"voice-caption.{_ext_from_ct(ct)}"
            response = await stt.transcribe(
                file=bio,
                model="whisper-1",
                response_format="json",
                language="en",  # Field team is English-only; pinning gives ~15% accuracy boost.
                prompt=(
                    "Roofing inspection notes. Common terms: membrane, "
                    "blistering, ponding, flashing, seam, coating, silicone, "
                    "acrylic, primer, granule loss, alligatoring, EPDM, TPO, "
                    "PVC, mod-bit, BUR, drain, scupper, parapet, penetration."
                ),
                temperature=0.0,
            )
            text = getattr(response, "text", None) or ""
            return {"text": text.strip()}
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Whisper transcription failed: {e}")

    # ---------- Before / After photo pairing ----------
    @router.put("/photos/{photo_id}/pair")
    async def pair_photos(
        deal_id: str,
        photo_id: str,
        body: dict = Body(...),
        _=Depends(get_current_user),
    ):
        """Link two photos as a before/after pair.

        Body: {"paired_photo_id": "<other-photo-id>", "role": "before" | "after"}

        Roles are complementary — the caller declares this photo's role,
        and we write the opposite role on the partner. Enforcing this
        server-side means the UI can never end up with two "before"s or
        an "after" pointing at a "before" that doesn't point back.

        Un-pair by sending {"paired_photo_id": null}.
        """
        partner_id = body.get("paired_photo_id")
        role = (body.get("role") or "").lower()

        me = await db.project_photos.find_one({"id": photo_id, "deal_id": deal_id, "is_deleted": {"$ne": True}}, {"_id": 0})
        if not me:
            raise HTTPException(status_code=404, detail="Photo not found")

        # Un-pair path
        if not partner_id:
            # If we're already in a pair, clear the reverse link too so the
            # partner doesn't dangle pointing at us.
            existing_partner_id = me.get("paired_photo_id")
            if existing_partner_id:
                await db.project_photos.update_one(
                    {"id": existing_partner_id, "deal_id": deal_id},
                    {"$unset": {"paired_photo_id": "", "pair_role": ""}, "$set": {"updated_at": _now_iso()}},
                )
            await db.project_photos.update_one(
                {"id": photo_id, "deal_id": deal_id},
                {"$unset": {"paired_photo_id": "", "pair_role": ""}, "$set": {"updated_at": _now_iso()}},
            )
            return {"ok": True, "unpaired": True}

        if partner_id == photo_id:
            raise HTTPException(status_code=400, detail="Cannot pair a photo with itself.")
        if role not in {"before", "after"}:
            raise HTTPException(status_code=400, detail="role must be 'before' or 'after'")

        partner = await db.project_photos.find_one(
            {"id": partner_id, "deal_id": deal_id, "is_deleted": {"$ne": True}},
            {"_id": 0},
        )
        if not partner:
            raise HTTPException(status_code=404, detail="Partner photo not found on this deal")

        partner_role = "after" if role == "before" else "before"
        # Clean up any *previous* partners on either side so we don't leave
        # orphan back-references pointing at now-repaired photos.
        for old_id in {me.get("paired_photo_id"), partner.get("paired_photo_id")} - {None, photo_id, partner_id}:
            await db.project_photos.update_one(
                {"id": old_id, "deal_id": deal_id},
                {"$unset": {"paired_photo_id": "", "pair_role": ""}, "$set": {"updated_at": _now_iso()}},
            )

        await db.project_photos.update_one(
            {"id": photo_id, "deal_id": deal_id},
            {"$set": {"paired_photo_id": partner_id, "pair_role": role, "updated_at": _now_iso()}},
        )
        await db.project_photos.update_one(
            {"id": partner_id, "deal_id": deal_id},
            {"$set": {"paired_photo_id": photo_id, "pair_role": partner_role, "updated_at": _now_iso()}},
        )
        return {"ok": True, "photo_id": photo_id, "paired_photo_id": partner_id, "role": role, "partner_role": partner_role}

    @router.get("/photos/pairs")
    async def list_pairs(deal_id: str, _=Depends(get_current_user)):
        """Return all paired photos on this deal, grouped as `{before, after}`
        objects. Each pair is only surfaced once (we sort by role so the
        `before` half is always the anchor)."""
        rows = await db.project_photos.find(
            {"deal_id": deal_id, "is_deleted": {"$ne": True}, "paired_photo_id": {"$exists": True, "$ne": None}},
            {"_id": 0},
        ).to_list(2000)
        # Index by id and only emit each pair once (from the "before" side).
        by_id = {r["id"]: r for r in rows}
        pairs = []
        seen = set()
        for r in rows:
            if r["id"] in seen:
                continue
            if r.get("pair_role") != "before":
                continue
            partner = by_id.get(r.get("paired_photo_id"))
            if not partner:
                # Partner is deleted or unpaired asymmetrically — skip and
                # the client will treat this as a broken pair.
                continue
            pairs.append({"before": r, "after": partner})
            seen.add(r["id"])
            seen.add(partner["id"])
        return pairs

    @router.delete("/photos/{photo_id}")
    async def delete_photo(deal_id: str, photo_id: str, current=Depends(get_current_user)):
        # If the deleted photo was half of a before/after pair, break the
        # partner's back-reference so it doesn't dangle on an is_deleted photo.
        me = await db.project_photos.find_one({"id": photo_id, "deal_id": deal_id}, {"_id": 0, "paired_photo_id": 1})
        partner_id = me.get("paired_photo_id") if me else None
        if partner_id:
            await db.project_photos.update_one(
                {"id": partner_id, "deal_id": deal_id},
                {"$unset": {"paired_photo_id": "", "pair_role": ""}, "$set": {"updated_at": _now_iso()}},
            )
        await db.project_photos.update_one(
            {"id": photo_id, "deal_id": deal_id},
            {"$set": {"is_deleted": True, "deleted_at": _now_iso(), "deleted_by": current["id"]},
             "$unset": {"paired_photo_id": "", "pair_role": ""}},
        )
        return {"ok": True}

    # ---------- Bulk operations ----------
    # Atomic, one-round-trip bulk update for selected photos. The frontend
    # used to fire N parallel PATCH requests for tag/album moves which (a)
    # caused partial-success states on flaky LTE and (b) made it possible for
    # a CRUD test to leave half a gallery in an inconsistent state. This
    # endpoint runs one update_many on a deal-scoped id filter so either all
    # selected photos move or none do.
    @router.patch("/photos-bulk")
    async def bulk_update_photos(
        deal_id: str,
        body: dict = Body(...),
        _=Depends(get_current_user),
    ):
        await _ensure_deal(deal_id)
        ids = body.get("ids") or []
        if not isinstance(ids, list) or not ids:
            raise HTTPException(status_code=400, detail="ids[] is required")
        if len(ids) > 500:
            raise HTTPException(status_code=400, detail="Cannot update more than 500 photos at once")
        patch: dict = {}
        if "tag" in body:
            tag = (body.get("tag") or "").strip()
            if tag and tag not in PRESET_TAGS:
                raise HTTPException(status_code=400, detail=f"Invalid tag. Allowed: {', '.join(PRESET_TAGS)}")
            patch["tag"] = tag
        if "album_name" in body:
            patch["album_name"] = (body.get("album_name") or "Default").strip() or "Default"
        if "captured_at" in body:
            raw = (body.get("captured_at") or "").strip()
            if raw:
                # Accept "YYYY-MM-DD" (date-picker output) and normalize to noon
                # UTC so re-dated photos cluster cleanly under the right day
                # header without colliding with each other on minute precision.
                try:
                    if len(raw) == 10 and raw[4] == "-" and raw[7] == "-":
                        dt = datetime.fromisoformat(raw + "T12:00:00").replace(tzinfo=timezone.utc)
                    else:
                        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
                        if dt.tzinfo is None:
                            dt = dt.replace(tzinfo=timezone.utc)
                    patch["captured_at"] = dt.isoformat()
                except Exception:
                    raise HTTPException(status_code=400, detail=f"Invalid captured_at: {raw!r}")
            else:
                patch["captured_at"] = _now_iso()
        if not patch:
            raise HTTPException(status_code=400, detail="No supported fields to update (tag, album_name, captured_at)")
        patch["updated_at"] = _now_iso()
        result = await db.project_photos.update_many(
            {"deal_id": deal_id, "id": {"$in": ids}, "is_deleted": {"$ne": True}},
            {"$set": patch},
        )
        return {"matched": result.matched_count, "modified": result.modified_count, "applied": patch}

    @router.post("/photos-bulk-delete")
    async def bulk_delete_photos(
        deal_id: str,
        body: dict = Body(...),
        current=Depends(get_current_user),
    ):
        await _ensure_deal(deal_id)
        ids = body.get("ids") or []
        if not isinstance(ids, list) or not ids:
            raise HTTPException(status_code=400, detail="ids[] is required")
        if len(ids) > 500:
            raise HTTPException(status_code=400, detail="Cannot delete more than 500 photos at once")
        result = await db.project_photos.update_many(
            {"deal_id": deal_id, "id": {"$in": ids}, "is_deleted": {"$ne": True}},
            {"$set": {"is_deleted": True, "deleted_at": _now_iso(), "deleted_by": current["id"]}},
        )
        return {"matched": result.matched_count, "deleted": result.modified_count}

    @router.get("/photos/{photo_id}/download")
    async def download_photo(
        deal_id: str,
        photo_id: str,
        original: bool = False,
        thumb: bool = False,
        max_size: int = 0,
        _=Depends(get_current_user),
    ):
        """Download a photo.

        Query params:
        - `original=true`  Force the raw source (used by the annotator so the
                           user always draws over the pristine base image).
        - `thumb=true`     Return a 600px JPEG thumbnail (~50 KB) instead of
                           the full-resolution original. Used by the photo
                           grid to keep list views snappy on mobile networks.
                           Preserves aspect ratio. Cached in-browser via
                           long-lived Cache-Control headers.
        - `max_size=N`     Custom max dimension in pixels (only when thumb=true).

        If a photo has an annotated version and `original=false` (the default),
        we serve the flattened annotated PNG instead of the raw camera roll.
        """
        rec = await db.project_photos.find_one(
            {"id": photo_id, "deal_id": deal_id, "is_deleted": {"$ne": True}},
            {"_id": 0},
        )
        if not rec:
            raise HTTPException(status_code=404, detail="Photo not found")
        annotated_path = rec.get("annotated_storage_path")
        use_annotated = bool(annotated_path) and not original
        path = annotated_path if use_annotated else rec["storage_path"]
        try:
            content, _ct = get_object(path)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Storage fetch failed: {e}")

        filename = rec.get("original_filename") or f'{rec["id"]}.jpg'
        media_type = "image/png" if use_annotated else rec.get("content_type", "image/jpeg")

        # Thumbnail path: downscale on-the-fly with Pillow. We use JPEG output
        # regardless of source format (annotated PNGs get flattened to JPEG
        # here — good enough for a 600px preview and 5-10x smaller). Result is
        # cached by the browser for 7 days via Cache-Control so scrolling back
        # over the same photos is instant.
        if thumb:
            try:
                from PIL import Image as PILImage
                target = max_size if max_size and max_size > 0 else 600
                # Cap thumbnails at 1600px to prevent abuse — anything larger
                # is really a "full-size" load and should use the raw endpoint.
                target = max(120, min(target, 1600))
                with PILImage.open(io.BytesIO(content)) as img:
                    img = img.convert("RGB")
                    img.thumbnail((target, target), PILImage.LANCZOS)
                    out = io.BytesIO()
                    img.save(out, format="JPEG", quality=78, optimize=True, progressive=True)
                    content = out.getvalue()
                media_type = "image/jpeg"
                filename = filename.rsplit(".", 1)[0] + "-thumb.jpg"
            except Exception as e:
                # If thumbnailing fails (e.g. weird HEIC in the wild), fall
                # back to serving the original rather than 500ing.
                logger = __import__("logging").getLogger(__name__)
                logger.warning(f"thumbnail failed for photo={photo_id}: {e}")

        elif use_annotated:
            base = filename.rsplit(".", 1)[0]
            filename = f"{base}-annotated.png"

        # Cache-Control: photos are immutable (rebuilt path changes if the
        # user rotates/replaces), so browsers can cache aggressively.
        # `private` because these are user-scoped protected assets.
        # Include annotated_at + thumb params in ETag so annotator edits
        # trigger a fresh fetch.
        annotated_at = str(rec.get("annotated_at", ""))
        etag = f'W/"{photo_id}-{annotated_at}-{"t" if thumb else "f"}-{max_size or 0}"'
        headers = {
            "Content-Disposition": f'inline; filename="{filename}"',
            "Cache-Control": "private, max-age=604800, immutable",  # 7 days
            "ETag": etag,
        }
        return StreamingResponse(
            io.BytesIO(content),
            media_type=media_type,
            headers=headers,
        )

    # ---------- Annotations (CompanyCam parity: draw on photos) ----------
    @router.put("/photos/{photo_id}/annotations")
    async def save_annotations(
        deal_id: str,
        photo_id: str,
        file: UploadFile = File(...),              # flattened PNG from <canvas>.toBlob
        layers: str = Form("[]"),                   # JSON array of shape objects (arrows, circles, freehand paths, text)
        current=Depends(get_current_user),
    ):
        """Persist an annotated (marked-up) version of a photo.

        Frontend flattens the source image + drawn overlay into a single PNG
        on <canvas> and uploads that blob here alongside the raw `layers`
        JSON. We keep both so a user can:
          1) Re-open the annotator later and edit individual shapes (uses
             `layers` to re-hydrate the drawing state), and
          2) Immediately see/share/download the flattened result via the
             regular /download endpoint (which auto-prefers the annotated
             copy over the original).
        """
        rec = await db.project_photos.find_one(
            {"id": photo_id, "deal_id": deal_id, "is_deleted": {"$ne": True}},
            {"_id": 0},
        )
        if not rec:
            raise HTTPException(status_code=404, detail="Photo not found")

        data = await file.read()
        if len(data) > MAX_BYTES:
            raise HTTPException(status_code=413, detail=f"Annotated image too large (max {MAX_BYTES // (1024 * 1024)} MB)")
        if not data:
            raise HTTPException(status_code=400, detail="Empty annotated image")

        # Parse layers JSON — permissive: bad JSON just stores empty array.
        # We never trust the client's shape schema server-side; the JSON is
        # opaque to the API and only re-hydrated by the annotator UI.
        import json as _json
        try:
            layers_data = _json.loads(layers) if layers else []
            if not isinstance(layers_data, list):
                layers_data = []
        except Exception:
            layers_data = []

        annotated_path = f"{APP_NAME}/project_photos/{deal_id}/{photo_id}-annotated.png"
        try:
            put_object(annotated_path, data, "image/png")
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Storage save failed: {e}")

        patch = {
            "annotated_storage_path": annotated_path,
            "annotations": layers_data,
            "annotated_at": _now_iso(),
            "annotated_by": current["id"],
            "annotator_name": current.get("name", ""),
            "annotated_size": len(data),
            "updated_at": _now_iso(),
        }
        await db.project_photos.update_one(
            {"id": photo_id, "deal_id": deal_id},
            {"$set": patch},
        )
        return {"ok": True, **patch}

    @router.delete("/photos/{photo_id}/annotations")
    async def clear_annotations(deal_id: str, photo_id: str, _=Depends(get_current_user)):
        """Remove the annotated overlay and revert to the raw source photo."""
        rec = await db.project_photos.find_one(
            {"id": photo_id, "deal_id": deal_id, "is_deleted": {"$ne": True}},
            {"_id": 0},
        )
        if not rec:
            raise HTTPException(status_code=404, detail="Photo not found")
        annotated_path = rec.get("annotated_storage_path")
        await db.project_photos.update_one(
            {"id": photo_id, "deal_id": deal_id},
            {"$unset": {
                "annotated_storage_path": "",
                "annotations": "",
                "annotated_at": "",
                "annotated_by": "",
                "annotator_name": "",
                "annotated_size": "",
            }, "$set": {"updated_at": _now_iso()}},
        )
        # Best-effort cleanup of the stored PNG — swallow storage errors so
        # the DB unset always succeeds (worst case: an orphan blob).
        if annotated_path:
            try:
                from storage import delete_object
                delete_object(annotated_path)
            except Exception:
                pass
        return {"ok": True}

    # ---------- Maintenance / Condition Report PDF ----------
    @router.get("/photos/maintenance-report.pdf")
    async def maintenance_report_pdf(
        deal_id: str,
        current=Depends(get_current_user),
    ):
        """Client-ready roof condition report PDF.

        Compiles every non-deleted photo on the project, grouped by tag in
        priority order (Damage Documentation → Detail Shots → Before →
        During → After → Drone → Untagged). Photos with an
        `annotated_storage_path` render as their inspector-annotated
        version (arrows/circles/text markup burned in) so the report
        surfaces the highlighted areas of concern to the customer.
        """
        deal = await _ensure_deal(deal_id)
        photos = await db.project_photos.find(
            {"deal_id": deal_id, "is_deleted": {"$ne": True}},
            {"_id": 0},
        ).sort("captured_at", 1).to_list(2000)
        property_doc = None
        if deal.get("property_id"):
            property_doc = await db.properties.find_one({"id": deal["property_id"]}, {"_id": 0})
        try:
            pdf_bytes = build_maintenance_report_pdf(
                deal, photos,
                property_doc=property_doc,
                inspector_name=current.get("name", "") or "",
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"PDF generation failed: {e}")
        safe_title = "".join(c if c.isalnum() or c in "-_ " else "_" for c in (deal.get("title") or "Project"))
        filename = f"{safe_title} - Roof Condition Report.pdf"
        return StreamingResponse(
            io.BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
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
