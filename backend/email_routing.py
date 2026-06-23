"""Per-category email routing — "Send As" alias selection by action.

Darren keeps role mailboxes in Google Workspace to keep his selling inbox
clean. Each kind of CRM email is sent FROM the matching role address:

    assessments  → assessments@sealtechsolutions.co   (assessment scheduling, reports)
    scope        → scope@sealtechsolutions.co         (proposals, scope emails, sales follow-ups)
    finance      → finance@sealtechsolutions.co       (invoices, statements, late notices, payables)
    projects     → projects@sealtechsolutions.co      (POs, work orders, project comms, COI requests)
    maintenance  → maintenance@sealtechsolutions.co   (maintenance visit reminders)
    repairs      → repairs@sealtechsolutions.co       (reserved — repair requests / new-website inbound; not yet routed)

All six aliases are configured as Gmail "Send As" on darren@ so SMTP login
stays on the primary account. We just set the From header to the role
address; Gmail accepts it because the alias is verified upstream.

The mapping is editable from /settings/integrations (admin only).
"""
from __future__ import annotations

import os
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, EmailStr


CATEGORIES = ("assessments", "scope", "finance", "projects", "maintenance", "repairs")
SETTINGS_DOC_ID = "email_routing"


def _env_default(cat: str) -> str:
    """Pull a sensible default per category from env so a fresh install
    still works before the admin opens Settings."""
    # If the operator pre-populated GMAIL_FROM_ALIASES, scan it for an alias
    # matching the category name as the user-part. Otherwise fall back to
    # the primary sender so emails still go out.
    primary = (os.environ.get("GMAIL_FROM_EMAIL") or "").strip()
    aliases = [a.strip() for a in (os.environ.get("GMAIL_FROM_ALIASES") or "").split(",") if a.strip()]
    for a in aliases:
        local = a.split("@", 1)[0].lower()
        if local == cat:
            return a
    return primary


class EmailRoutingSettings(BaseModel):
    model_config = ConfigDict(extra="ignore")
    assessments: str = ""
    scope: str = ""
    finance: str = ""
    projects: str = ""
    maintenance: str = ""
    repairs: str = ""

    def resolved(self) -> dict:
        """Return the doc with empty values filled from env defaults."""
        out = self.model_dump()
        for cat in CATEGORIES:
            if not out.get(cat):
                out[cat] = _env_default(cat)
        return out


class EmailRoutingIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    assessments: Optional[EmailStr] = None
    scope: Optional[EmailStr] = None
    finance: Optional[EmailStr] = None
    projects: Optional[EmailStr] = None
    maintenance: Optional[EmailStr] = None
    repairs: Optional[EmailStr] = None


async def get_settings(db) -> EmailRoutingSettings:
    doc = await db.app_settings.find_one({"_id": SETTINGS_DOC_ID}) or {}
    doc.pop("_id", None)
    return EmailRoutingSettings(**doc)


async def get_from_for_category(db, category: str) -> str:
    """Resolve the From address for a category. Falls back to GMAIL_FROM_EMAIL
    if the category isn't recognized or isn't configured."""
    if category not in CATEGORIES:
        return os.environ.get("GMAIL_FROM_EMAIL", "")
    s = await get_settings(db)
    resolved = s.resolved()
    return resolved.get(category) or os.environ.get("GMAIL_FROM_EMAIL", "")


def make_router(db, get_current_user):
    router = APIRouter(prefix="/settings/email-routing", tags=["Email Routing"])

    async def _admin(current=Depends(get_current_user)):
        if current.get("role") != "admin":
            raise HTTPException(403, "Admin only")
        return current

    @router.get("")
    async def read(_=Depends(_admin)):
        s = await get_settings(db)
        return {
            "saved": s.model_dump(),       # the actual stored values (may be blank)
            "resolved": s.resolved(),      # what will actually be used (with env fallback)
            "categories": list(CATEGORIES),
            "allowed_aliases": [a.strip() for a in (os.environ.get("GMAIL_FROM_ALIASES") or "").split(",") if a.strip()],
        }

    @router.put("")
    async def update(body: EmailRoutingIn, _=Depends(_admin)):
        # Whitelist check — every From must be in GMAIL_FROM_ALIASES so the
        # Gmail "Send As" relay accepts it. (Setting an unverified alias would
        # silently rewrite to the primary anyway.)
        allowed = {a.strip().lower() for a in (os.environ.get("GMAIL_FROM_ALIASES") or "").split(",") if a.strip()}
        for cat in CATEGORIES:
            v = getattr(body, cat)
            if v and allowed and v.lower() not in allowed:
                raise HTTPException(
                    400,
                    f"{cat}: '{v}' is not in GMAIL_FROM_ALIASES whitelist. "
                    f"Verify it as a 'Send As' alias on the primary Gmail account first.",
                )
        patch = {cat: (getattr(body, cat) or "") for cat in CATEGORIES}
        await db.app_settings.update_one(
            {"_id": SETTINGS_DOC_ID},
            {"$set": patch},
            upsert=True,
        )
        s = await get_settings(db)
        return {"saved": s.model_dump(), "resolved": s.resolved()}

    return router
