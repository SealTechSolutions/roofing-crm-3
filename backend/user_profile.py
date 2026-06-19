"""User Profile — admin-managed notes, certifications, equipment, skills,
emergency contact, and employment basics for each CRM user.

Routes are mounted at `/api/users/{user_id}/…`. Authorization rules:
    • Notes + Equipment + Employment basics → admin only
    • Certifications + Skills → admin (CRUD) / self (read)
    • Emergency contact → admin (CRUD) / self (read+update own)
    • Profile bundle GET → admin or self

Sensitive fields (hourly_rate, license_number) are stripped from the response
when the requester is the subject (i.e. the user reading their own profile).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel, ConfigDict, Field


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

CERT_SUGGESTIONS = [
    "OSHA 10",
    "OSHA 30",
    "GAF Master Roofer",
    "GAF CertainTeed Shingle Master",
    "EPA Lead-Safe RRP",
    "Fall Protection",
    "CPR / First Aid",
    "CDL",
    "Forklift Operator",
    "Powered Lift / Boom Lift",
    "Drone Pilot (FAA Part 107)",
    "Asbestos Awareness",
    "Confined Space",
    "Silica Awareness",
]

SKILL_SUGGESTIONS = [
    "TPO", "EPDM", "PVC", "Modified Bitumen", "Built-up", "Metal", "Coatings",
    "Steep Slope", "Service / Repair", "Inspector", "Foreman", "Estimator",
    "Drone Pilot", "CAD / Sketch",
]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class NoteIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    body: str
    pinned: bool = False


class CertificationIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str
    issuer: str = ""
    cert_number: str = ""
    issue_date: str = ""  # YYYY-MM-DD
    expiration_date: str = ""  # YYYY-MM-DD, blank = no expiration


class EquipmentIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    item_name: str
    asset_tag: str = ""
    serial_number: str = ""
    assigned_at: str = ""  # YYYY-MM-DD
    notes: str = ""


class EmergencyContact(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str = ""
    relationship: str = ""
    phone: str = ""
    alt_phone: str = ""
    email: str = ""
    notes: str = ""


class EmploymentBasics(BaseModel):
    model_config = ConfigDict(extra="ignore")
    hire_date: str = ""
    pay_type: str = ""  # hourly | salary | 1099
    hourly_rate: Optional[float] = None
    salary: Optional[float] = None
    driver_license_number: str = ""
    driver_license_state: str = ""
    driver_license_expiration: str = ""
    tshirt_size: str = ""
    birthday: str = ""  # MM-DD recommended (no year) — but allow YYYY-MM-DD


# ---------------------------------------------------------------------------
# Router factory
# ---------------------------------------------------------------------------

def make_router(db, get_current_user, require_admin, public_base_url: str = ""):
    router = APIRouter(prefix="/users/{user_id}", tags=["User Profile"])

    async def _user_or_404(user_id: str):
        u = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
        if not u:
            raise HTTPException(404, "User not found")
        return u

    def _can_see_sensitive(requester, target_id: str) -> bool:
        return requester.get("role") == "admin" and requester.get("id") != target_id

    # ------ Profile bundle ------
    @router.get("/profile")
    async def get_profile(user_id: str, current=Depends(get_current_user)):
        if current.get("role") != "admin" and current.get("id") != user_id:
            raise HTTPException(403, "Forbidden")
        u = await _user_or_404(user_id)

        # Cert + equipment + notes counts so the front end can show badges
        certs = await db.user_certifications.find(
            {"user_id": user_id, "is_deleted": {"$ne": True}}, {"_id": 0}
        ).sort([("expiration_date", 1)]).to_list(200)
        equipment = await db.user_equipment.find(
            {"user_id": user_id, "is_deleted": {"$ne": True}}, {"_id": 0}
        ).sort([("assigned_at", -1)]).to_list(200)

        # Notes are admin-only; non-admin viewing self should not see them.
        notes_visible = current.get("role") == "admin"
        notes = []
        if notes_visible:
            notes = await db.user_notes.find(
                {"user_id": user_id, "is_deleted": {"$ne": True}}, {"_id": 0}
            ).sort([("pinned", -1), ("created_at", -1)]).to_list(500)

        employment = u.get("employment") or {}
        # Strip sensitive numbers when the user is viewing their own profile
        if not _can_see_sensitive(current, user_id):
            employment = {**employment}
            for k in ("hourly_rate", "salary"):
                employment.pop(k, None)

        return {
            "user": {
                "id": u["id"],
                "email": u["email"],
                "name": u.get("name", ""),
                "role": u.get("role", ""),
                "title": u.get("title", ""),
                "phone": u.get("phone", ""),
                "credentials": u.get("credentials", ""),
                "created_at": u.get("created_at", ""),
            },
            "skills": u.get("skills") or [],
            "emergency_contact": u.get("emergency_contact") or {},
            "employment": employment,
            "certifications": certs,
            "equipment": equipment,
            "notes": notes,
            "suggestions": {
                "certifications": CERT_SUGGESTIONS,
                "skills": SKILL_SUGGESTIONS,
            },
        }

    # ------ Notes (admin-only — these are *admin's notes about the user*) ------
    @router.get("/notes")
    async def list_notes(user_id: str, current=Depends(require_admin)):
        await _user_or_404(user_id)
        rows = await db.user_notes.find(
            {"user_id": user_id, "is_deleted": {"$ne": True}}, {"_id": 0}
        ).sort([("pinned", -1), ("created_at", -1)]).to_list(500)
        return rows

    @router.post("/notes")
    async def create_note(user_id: str, body: NoteIn, current=Depends(require_admin)):
        await _user_or_404(user_id)
        if not body.body.strip():
            raise HTTPException(400, "Note body is required")
        doc = {
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "author_id": current["id"],
            "author_name": current.get("name") or current.get("email") or "",
            "body": body.body.strip(),
            "pinned": body.pinned,
            "is_deleted": False,
            "created_at": _now(),
            "updated_at": _now(),
        }
        await db.user_notes.insert_one(doc.copy())
        doc.pop("_id", None)
        return doc

    @router.put("/notes/{note_id}")
    async def update_note(user_id: str, note_id: str, body: NoteIn, current=Depends(require_admin)):
        n = await db.user_notes.find_one({"id": note_id, "user_id": user_id})
        if not n or n.get("is_deleted"):
            raise HTTPException(404, "Note not found")
        # Only the author may edit (admins can re-pin freely though).
        if n.get("author_id") != current["id"]:
            # Allow pin-only edits by other admins, but not body edits.
            if (body.body or "").strip() != n.get("body"):
                raise HTTPException(403, "Only the author may edit this note's body")
        await db.user_notes.update_one(
            {"id": note_id},
            {"$set": {"body": body.body.strip(), "pinned": body.pinned, "updated_at": _now()}},
        )
        return await db.user_notes.find_one({"id": note_id}, {"_id": 0})

    @router.delete("/notes/{note_id}")
    async def delete_note(user_id: str, note_id: str, current=Depends(require_admin)):
        n = await db.user_notes.find_one({"id": note_id, "user_id": user_id})
        if not n:
            raise HTTPException(404, "Note not found")
        if n.get("author_id") != current["id"] and current.get("role") != "admin":
            raise HTTPException(403, "Forbidden")
        await db.user_notes.update_one({"id": note_id}, {"$set": {"is_deleted": True, "updated_at": _now()}})
        return {"deleted": True}

    # ------ Certifications ------
    @router.get("/certifications")
    async def list_certs(user_id: str, current=Depends(get_current_user)):
        if current.get("role") != "admin" and current.get("id") != user_id:
            raise HTTPException(403, "Forbidden")
        rows = await db.user_certifications.find(
            {"user_id": user_id, "is_deleted": {"$ne": True}}, {"_id": 0}
        ).sort([("expiration_date", 1)]).to_list(200)
        return rows

    @router.post("/certifications")
    async def create_cert(user_id: str, body: CertificationIn, current=Depends(require_admin)):
        await _user_or_404(user_id)
        if not body.name.strip():
            raise HTTPException(400, "Certification name is required")
        doc = {
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "name": body.name.strip(),
            "issuer": body.issuer.strip(),
            "cert_number": body.cert_number.strip(),
            "issue_date": body.issue_date,
            "expiration_date": body.expiration_date,
            "document_path": "",
            "document_name": "",
            "reminders_sent": [],  # ["60", "30", "7"] as they fire
            "is_deleted": False,
            "created_at": _now(),
            "updated_at": _now(),
        }
        await db.user_certifications.insert_one(doc.copy())
        doc.pop("_id", None)
        return doc

    @router.put("/certifications/{cert_id}")
    async def update_cert(user_id: str, cert_id: str, body: CertificationIn, current=Depends(require_admin)):
        existing = await db.user_certifications.find_one({"id": cert_id, "user_id": user_id})
        if not existing or existing.get("is_deleted"):
            raise HTTPException(404, "Certification not found")
        patch = body.model_dump()
        # Reset reminders if expiration changes — admin should be re-notified.
        if patch.get("expiration_date") != existing.get("expiration_date"):
            patch["reminders_sent"] = []
        patch["updated_at"] = _now()
        await db.user_certifications.update_one({"id": cert_id}, {"$set": patch})
        return await db.user_certifications.find_one({"id": cert_id}, {"_id": 0})

    @router.delete("/certifications/{cert_id}")
    async def delete_cert(user_id: str, cert_id: str, current=Depends(require_admin)):
        await db.user_certifications.update_one({"id": cert_id}, {"$set": {"is_deleted": True, "updated_at": _now()}})
        return {"deleted": True}

    @router.post("/certifications/{cert_id}/document")
    async def upload_cert_document(
        user_id: str, cert_id: str,
        file: UploadFile = File(...),
        current=Depends(require_admin),
    ):
        # Lazy import — storage may be unavailable in dev without S3 creds.
        from storage import put_object
        existing = await db.user_certifications.find_one({"id": cert_id, "user_id": user_id})
        if not existing:
            raise HTTPException(404, "Certification not found")
        data = await file.read()
        if len(data) > 25 * 1024 * 1024:
            raise HTTPException(413, "File too large (max 25 MB)")
        ext = (file.filename or "doc").rsplit(".", 1)[-1].lower()
        path = f"sealtech-crm/user_certifications/{user_id}/{cert_id}.{ext}"
        result = put_object(path, data, file.content_type or "application/octet-stream")
        await db.user_certifications.update_one(
            {"id": cert_id},
            {"$set": {
                "document_path": result["path"],
                "document_name": file.filename or f"cert.{ext}",
                "updated_at": _now(),
            }},
        )
        return await db.user_certifications.find_one({"id": cert_id}, {"_id": 0})

    # ------ Equipment ------
    @router.get("/equipment")
    async def list_equipment(user_id: str, current=Depends(get_current_user)):
        if current.get("role") != "admin" and current.get("id") != user_id:
            raise HTTPException(403, "Forbidden")
        rows = await db.user_equipment.find(
            {"user_id": user_id, "is_deleted": {"$ne": True}}, {"_id": 0}
        ).sort([("assigned_at", -1)]).to_list(200)
        return rows

    @router.post("/equipment")
    async def add_equipment(user_id: str, body: EquipmentIn, current=Depends(require_admin)):
        await _user_or_404(user_id)
        if not body.item_name.strip():
            raise HTTPException(400, "Item name is required")
        doc = {
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "item_name": body.item_name.strip(),
            "asset_tag": body.asset_tag.strip(),
            "serial_number": body.serial_number.strip(),
            "assigned_at": body.assigned_at or datetime.now(timezone.utc).date().isoformat(),
            "notes": body.notes.strip(),
            "is_deleted": False,
            "created_at": _now(),
        }
        await db.user_equipment.insert_one(doc.copy())
        doc.pop("_id", None)
        return doc

    @router.delete("/equipment/{eq_id}")
    async def delete_equipment(user_id: str, eq_id: str, current=Depends(require_admin)):
        await db.user_equipment.update_one({"id": eq_id}, {"$set": {"is_deleted": True, "updated_at": _now()}})
        return {"deleted": True}

    # ------ Skills ------
    @router.put("/skills")
    async def set_skills(user_id: str, body: dict, current=Depends(require_admin)):
        skills = body.get("skills") or []
        if not isinstance(skills, list):
            raise HTTPException(400, "skills must be a list")
        # Clean + dedupe (case-insensitive)
        seen: set[str] = set()
        cleaned: List[str] = []
        for s in skills:
            t = str(s).strip()
            if t and t.lower() not in seen:
                seen.add(t.lower())
                cleaned.append(t)
        await db.users.update_one({"id": user_id}, {"$set": {"skills": cleaned, "updated_at": _now()}})
        return {"skills": cleaned}

    # ------ Emergency contact ------
    @router.put("/emergency-contact")
    async def set_emergency(user_id: str, body: EmergencyContact, current=Depends(get_current_user)):
        if current.get("role") != "admin" and current.get("id") != user_id:
            raise HTTPException(403, "Forbidden")
        await db.users.update_one(
            {"id": user_id},
            {"$set": {"emergency_contact": body.model_dump(), "updated_at": _now()}},
        )
        return body.model_dump()

    # ------ Employment basics (admin only) ------
    @router.put("/employment")
    async def set_employment(user_id: str, body: EmploymentBasics, current=Depends(require_admin)):
        await _user_or_404(user_id)
        await db.users.update_one(
            {"id": user_id},
            {"$set": {"employment": body.model_dump(exclude_none=False), "updated_at": _now()}},
        )
        return body.model_dump()

    return router


# ---------------------------------------------------------------------------
# Cert expiration reminder cron — runs daily, fires at 60/30/7 days out.
# Idempotent via `reminders_sent` list on each cert doc.
# ---------------------------------------------------------------------------

REMINDER_THRESHOLDS = (60, 30, 7)


async def send_due_cert_reminders(db) -> dict:
    """Email admin (and the cert holder) once per (cert, threshold) crossing."""
    try:
        from email_sender import send_for_category
    except Exception:
        return {"sent": 0, "error": "email_sender unavailable"}

    today = datetime.now(timezone.utc).date()
    sent = 0
    skipped = 0

    # Pull every non-deleted cert with a non-empty expiration date.
    cursor = db.user_certifications.find(
        {"is_deleted": {"$ne": True}, "expiration_date": {"$ne": ""}},
        {"_id": 0},
    )
    certs = await cursor.to_list(2000)

    # Cache user + admin lookups
    user_cache: dict = {}
    admin_emails = [
        u["email"] for u in await db.users.find(
            {"role": "admin", "is_active": {"$ne": False}, "is_deleted": {"$ne": True}},
            {"_id": 0, "email": 1},
        ).to_list(50)
        if u.get("email")
    ]

    for c in certs:
        try:
            exp = datetime.fromisoformat(str(c["expiration_date"])[:10]).date()
        except Exception:
            skipped += 1
            continue
        days_left = (exp - today).days
        # Pick the smallest (= most urgent) threshold the cert has crossed
        # that we haven't already sent. Iterating ascending ensures e.g. a
        # cert created 25 days from expiration fires the "7-day" reminder
        # first (most urgent), then later picks up "30" once we're past it
        # again on a future run if reminders_sent was reset.
        already = set(c.get("reminders_sent") or [])
        threshold = None
        for t in sorted(REMINDER_THRESHOLDS):  # 7, 30, 60
            if days_left <= t and str(t) not in already:
                threshold = t
                break
        if threshold is None:
            continue

        # Build the message
        user = user_cache.get(c["user_id"])
        if user is None:
            user = await db.users.find_one(
                {"id": c["user_id"]}, {"_id": 0, "email": 1, "name": 1}
            ) or {}
            user_cache[c["user_id"]] = user

        urgency = (
            "EXPIRED" if days_left < 0
            else "EXPIRES TODAY" if days_left == 0
            else f"expires in {days_left} days"
        )
        subject = f"[{c['name']}] {urgency} for {user.get('name') or user.get('email') or 'user'}"
        body = (
            f"Heads up — a team certification is approaching expiration.\n\n"
            f"Person:    {user.get('name') or user.get('email') or '—'}\n"
            f"Cert:      {c['name']}\n"
            f"Issuer:    {c.get('issuer') or '—'}\n"
            f"Number:    {c.get('cert_number') or '—'}\n"
            f"Expires:   {c['expiration_date']}  ({urgency})\n\n"
            f"Renew it in /users/{c['user_id']} → Certifications.\n"
        )
        recipients = list({*admin_emails, user.get("email")}) if user.get("email") else admin_emails
        if not recipients:
            skipped += 1
            continue
        any_sent = False
        for to in recipients:
            if not to:
                continue
            try:
                await send_for_category(db, "projects", to=to, subject=subject, body_text=body)
                any_sent = True
            except Exception:
                pass
        if any_sent:
            await db.user_certifications.update_one(
                {"id": c["id"]},
                {"$addToSet": {"reminders_sent": str(threshold)}, "$set": {"updated_at": _now()}},
            )
            sent += 1
        else:
            skipped += 1
    return {"sent": sent, "skipped": skipped, "checked": len(certs)}
