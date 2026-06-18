"""Google Calendar integration for SealTech CRM.

Single-user OAuth (each CRM user can connect their own Google account, but we
ship for the single owner today). Tokens are stored on the User record so they
survive logout / re-login.

Event-to-calendar routing (configured per-user via GoogleCalendarSettings):
    assessment_calendar_id  → Scheduled assessments + lead/quoted/negotiating
                              follow-up dates + general tasks
    project_calendar_id     → Project bars (won deals with scheduled_start) +
                              material order dates
    maintenance_calendar_id → Maintenance visits + tentative next-due dates

The hooks (push_deal, push_assessment, push_maintenance, push_task) are designed
to be idempotent: they UPSERT by storing the Google event_id on the source row
(`google_event_id` field). Deletes are cascaded if the source record is hard-
deleted.
"""
from __future__ import annotations

import os
import secrets
from datetime import datetime, timezone, timedelta
from typing import Optional, List

import requests
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, ConfigDict
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request as GoogleRequest
from googleapiclient.discovery import build

CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID")
CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET")
REDIRECT_URI = os.environ.get("GOOGLE_OAUTH_REDIRECT_URI")
SCOPES = ["https://www.googleapis.com/auth/calendar", "openid", "email", "profile"]
TOKEN_URL = "https://oauth2.googleapis.com/token"
AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"

# Frontend redirect target after callback (relative path on the same host)
POST_AUTH_REDIRECT = "/settings/integrations?google=connected"
POST_AUTH_REDIRECT_ERR = "/settings/integrations?google=error"


# -------- Pydantic models --------
class GoogleCalendarSettings(BaseModel):
    model_config = ConfigDict(extra="ignore")
    enabled: bool = True
    assessment_calendar_id: Optional[str] = None
    scope_calendar_id: Optional[str] = None
    finance_calendar_id: Optional[str] = None
    project_calendar_id: Optional[str] = None
    maintenance_calendar_id: Optional[str] = None


# -------- Token / creds helpers --------
async def _save_state(db, state: str, user_id: str):
    await db.oauth_states.update_one(
        {"state": state},
        {"$set": {"state": state, "user_id": user_id, "created_at": datetime.now(timezone.utc)}},
        upsert=True,
    )


async def _consume_state(db, state: str) -> Optional[str]:
    doc = await db.oauth_states.find_one({"state": state})
    if not doc:
        return None
    await db.oauth_states.delete_one({"state": state})
    return doc.get("user_id")


async def _get_creds(db, user_id: str) -> Optional[Credentials]:
    """Returns refreshed Credentials for a user, or None if they haven't connected."""
    user = await db.users.find_one({"id": user_id})
    tokens = (user or {}).get("google_tokens") or {}
    if not tokens.get("refresh_token"):
        return None
    creds = Credentials(
        token=tokens.get("access_token"),
        refresh_token=tokens.get("refresh_token"),
        token_uri=TOKEN_URL,
        client_id=CLIENT_ID,
        client_secret=CLIENT_SECRET,
        scopes=SCOPES,
    )
    try:
        if not creds.valid or creds.expired:
            creds.refresh(GoogleRequest())
            await db.users.update_one(
                {"id": user_id},
                {"$set": {"google_tokens.access_token": creds.token}},
            )
    except Exception:
        return None
    return creds


def _svc(creds: Credentials):
    return build("calendar", "v3", credentials=creds, cache_discovery=False)


# -------- Settings helpers --------
async def get_settings(db, user_id: str) -> GoogleCalendarSettings:
    user = await db.users.find_one({"id": user_id})
    raw = (user or {}).get("google_cal_settings") or {}
    return GoogleCalendarSettings(**raw)


async def update_settings(db, user_id: str, patch: dict) -> GoogleCalendarSettings:
    current = await get_settings(db, user_id)
    merged = {**current.model_dump(), **{k: v for k, v in patch.items() if v is not None}}
    await db.users.update_one({"id": user_id}, {"$set": {"google_cal_settings": merged}})
    return GoogleCalendarSettings(**merged)


# -------- Event push primitives --------
def _build_event(*, title: str, description: str, start: str, end: Optional[str] = None,
                 all_day: bool = True, source_url: Optional[str] = None,
                 timezone_str: str = "UTC") -> dict:
    desc = description or ""
    if source_url:
        desc = f"{desc}\n\nView in SealTech CRM: {source_url}".strip()
    body = {"summary": title, "description": desc}
    if all_day:
        body["start"] = {"date": start}
        body["end"] = {"date": end or start}
    else:
        body["start"] = {"dateTime": start, "timeZone": timezone_str}
        body["end"] = {"dateTime": end or start, "timeZone": timezone_str}
    return body


async def upsert_event(db, user_id: str, calendar_id: str, event_id: Optional[str], body: dict) -> Optional[str]:
    """Returns the Google event_id (new or existing) or None if push failed silently."""
    creds = await _get_creds(db, user_id)
    if not creds or not calendar_id:
        return None
    service = _svc(creds)
    try:
        if event_id:
            # Try update first; if 404, fall through to insert
            try:
                ev = service.events().update(calendarId=calendar_id, eventId=event_id, body=body).execute()
                return ev.get("id")
            except Exception:
                event_id = None
        ev = service.events().insert(calendarId=calendar_id, body=body).execute()
        return ev.get("id")
    except Exception:
        return None


async def delete_event(db, user_id: str, calendar_id: str, event_id: str) -> bool:
    creds = await _get_creds(db, user_id)
    if not creds or not calendar_id or not event_id:
        return False
    try:
        _svc(creds).events().delete(calendarId=calendar_id, eventId=event_id).execute()
        return True
    except Exception:
        return False


# -------- Domain push hooks (called from other routers) --------
async def push_deal(db, user_id: str, deal: dict, public_base_url: str = "") -> None:
    """Push the project bar for a Won deal with scheduled dates."""
    settings = await get_settings(db, user_id)
    if not settings.enabled:
        return

    status = (deal.get("status") or "").lower()
    s = deal.get("scheduled_start_date") or ""
    e = deal.get("scheduled_end_date") or s
    target_cal = None
    title = deal.get("title") or "Project"
    description = (deal.get("notes") or "")[:1024]
    source_url = f"{public_base_url}/deals/{deal['id']}" if public_base_url else None
    event_id = deal.get("google_event_id")

    # Decide which calendar — project bar goes to Projects calendar when scheduled,
    # otherwise a sales-touchpoint reminder goes to the main calendar.
    if s and status in {"won", "in progress", "complete"}:
        target_cal = settings.project_calendar_id
        title = f"🛠 {title}"
        # End date is exclusive in Google all-day events — add 1 day so the bar
        # visually covers the inclusive end date the user set in the CRM.
        try:
            adj_end = (datetime.strptime(e or s, "%Y-%m-%d") + timedelta(days=1)).strftime("%Y-%m-%d")
        except Exception:
            adj_end = e or s
        body = _build_event(title=title, description=description, start=s, end=adj_end, all_day=True, source_url=source_url)
    else:
        followup = deal.get("next_followup_date") or ""
        if not followup or status not in {"lead", "quoted", "negotiating"}:
            # Nothing to sync. If a previous event exists, drop it.
            if event_id:
                # We may not know which calendar it lives in; try all.
                for cal in (settings.project_calendar_id, settings.assessment_calendar_id):
                    if cal:
                        await delete_event(db, user_id, cal, event_id)
                await db.deals.update_one({"id": deal["id"]}, {"$set": {"google_event_id": None}})
            return
        target_cal = settings.assessment_calendar_id
        title = f"☎ {title} — follow-up"
        body = _build_event(title=title, description=description, start=followup, all_day=True, source_url=source_url)

    if not target_cal:
        return
    new_id = await upsert_event(db, user_id, target_cal, event_id, body)
    if new_id and new_id != event_id:
        await db.deals.update_one({"id": deal["id"]}, {"$set": {"google_event_id": new_id, "google_calendar_id": target_cal}})


async def push_assessment(db, user_id: str, assessment: dict, public_base_url: str = "") -> None:
    settings = await get_settings(db, user_id)
    if not settings.enabled or not settings.assessment_calendar_id:
        return
    date = assessment.get("assessment_date") or ""
    if not date:
        return
    title = f"🔍 Assessment — {assessment.get('property_address') or assessment.get('property_name') or 'Site'}"
    description = (assessment.get("purpose") or "")[:1024]
    source_url = f"{public_base_url}/assessments/{assessment['id']}" if public_base_url else None
    event_id = assessment.get("google_event_id")
    body = _build_event(title=title, description=description, start=date, all_day=True, source_url=source_url)
    new_id = await upsert_event(db, user_id, settings.assessment_calendar_id, event_id, body)
    if new_id and new_id != event_id:
        await db.assessments.update_one({"id": assessment["id"]}, {"$set": {"google_event_id": new_id, "google_calendar_id": settings.assessment_calendar_id}})


async def push_maintenance_visit(db, user_id: str, deal_id: str, visit: dict, deal_title: str, public_base_url: str = "") -> None:
    settings = await get_settings(db, user_id)
    if not settings.enabled or not settings.maintenance_calendar_id:
        return
    date = visit.get("visit_date") or ""
    if not date:
        return
    title = f"🟢 Maintenance — {deal_title}"
    description = (visit.get("notes") or "")[:1024]
    source_url = f"{public_base_url}/deals/{deal_id}" if public_base_url else None
    event_id = visit.get("google_event_id")
    body = _build_event(title=title, description=description, start=date, all_day=True, source_url=source_url)
    new_id = await upsert_event(db, user_id, settings.maintenance_calendar_id, event_id, body)
    if new_id and new_id != event_id:
        # Update only this visit's entry inside the visits array
        await db.deals.update_one(
            {"id": deal_id, "maintenance_visits.id": visit["id"]},
            {"$set": {"maintenance_visits.$.google_event_id": new_id, "maintenance_visits.$.google_calendar_id": settings.maintenance_calendar_id}},
        )


async def push_task(db, user_id: str, task: dict, public_base_url: str = "") -> None:
    settings = await get_settings(db, user_id)
    if not settings.enabled or not settings.assessment_calendar_id:
        return
    due_date = task.get("due_date") or ""
    if not due_date or task.get("done"):
        # Remove existing event if completed
        if task.get("google_event_id"):
            await delete_event(db, user_id, settings.assessment_calendar_id, task["google_event_id"])
            await db.tasks.update_one({"id": task["id"]}, {"$set": {"google_event_id": None}})
        return
    title = f"✓ {task.get('title') or 'Task'}"
    description = (task.get("notes") or "")[:1024]
    source_url = f"{public_base_url}/tasks" if public_base_url else None
    due_time = task.get("due_time") or ""
    body = _build_event(
        title=title,
        description=description,
        start=f"{due_date}T{due_time}:00" if due_time else due_date,
        end=f"{due_date}T{due_time}:00" if due_time else due_date,
        all_day=not bool(due_time),
        timezone_str=task.get("timezone") or "America/Denver",
        source_url=source_url,
    )
    new_id = await upsert_event(db, user_id, settings.assessment_calendar_id, task.get("google_event_id"), body)
    if new_id:
        await db.tasks.update_one({"id": task["id"]}, {"$set": {"google_event_id": new_id, "google_calendar_id": settings.assessment_calendar_id}})


# -------- Router --------
def make_google_calendar_router(db, get_current_user, public_base_url: str = ""):
    router = APIRouter(prefix="/integrations/google", tags=["Google Calendar"])

    @router.get("/status")
    async def status(current=Depends(get_current_user)):
        user = await db.users.find_one({"id": current["id"]}, {"_id": 0, "google_tokens": 1, "google_cal_settings": 1, "google_email": 1})
        connected = bool((user or {}).get("google_tokens", {}).get("refresh_token"))
        s = GoogleCalendarSettings(**((user or {}).get("google_cal_settings") or {}))
        return {
            "connected": connected,
            "google_email": (user or {}).get("google_email") or "",
            "settings": s.model_dump(),
        }

    @router.post("/connect")
    async def connect(current=Depends(get_current_user)):
        if not (CLIENT_ID and CLIENT_SECRET and REDIRECT_URI):
            raise HTTPException(status_code=500, detail="Google OAuth not configured on server")
        state = secrets.token_urlsafe(32)
        await _save_state(db, state, current["id"])
        from urllib.parse import urlencode
        params = {
            "client_id": CLIENT_ID,
            "redirect_uri": REDIRECT_URI,
            "response_type": "code",
            "scope": " ".join(SCOPES),
            "access_type": "offline",
            "prompt": "consent",
            "state": state,
            "include_granted_scopes": "true",
        }
        return {"authorization_url": f"{AUTH_URL}?{urlencode(params)}"}

    @router.post("/disconnect")
    async def disconnect(current=Depends(get_current_user)):
        await db.users.update_one(
            {"id": current["id"]},
            {"$unset": {"google_tokens": "", "google_email": "", "google_cal_settings": ""}},
        )
        return {"disconnected": True}

    @router.get("/calendars")
    async def list_calendars(current=Depends(get_current_user)):
        creds = await _get_creds(db, current["id"])
        if not creds:
            raise HTTPException(status_code=400, detail="Google account not connected")
        try:
            cals = _svc(creds).calendarList().list(maxResults=100).execute().get("items", [])
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to list calendars: {e}")
        # Slim down + suggest auto-mapping
        out = []
        for c in cals:
            out.append({
                "id": c.get("id"),
                "summary": c.get("summary") or "",
                "primary": bool(c.get("primary")),
                "accessRole": c.get("accessRole"),
                "backgroundColor": c.get("backgroundColor"),
            })
        # Auto-suggest IDs
        primary_id = next((c["id"] for c in out if c["primary"]), None)
        projects_id = next((c["id"] for c in out if (c["summary"] or "").strip().lower() == "projects"), None)
        maintenance_id = next((c["id"] for c in out if (c["summary"] or "").strip().lower() == "maintenance"), None)
        return {"calendars": out, "suggestion": {
            "assessment_calendar_id": primary_id,
            "project_calendar_id": projects_id,
            "maintenance_calendar_id": maintenance_id,
        }}

    @router.put("/settings")
    async def put_settings(patch: GoogleCalendarSettings, current=Depends(get_current_user)):
        s = await update_settings(db, current["id"], patch.model_dump(exclude_unset=True))
        return s

    @router.post("/sync")
    async def sync_now(current=Depends(get_current_user)):
        """Bulk re-push all current open Deals, Assessments, Maintenance visits, and Tasks."""
        settings = await get_settings(db, current["id"])
        if not settings.enabled:
            raise HTTPException(status_code=400, detail="Sync is disabled in settings")
        counts = {"deals": 0, "assessments": 0, "maintenance": 0, "tasks": 0}

        async for d in db.deals.find({"is_deleted": {"$ne": True}}):
            await push_deal(db, current["id"], d, public_base_url)
            counts["deals"] += 1
        async for a in db.assessments.find({"is_deleted": {"$ne": True}}):
            await push_assessment(db, current["id"], a, public_base_url)
            counts["assessments"] += 1
        async for d in db.deals.find({"is_deleted": {"$ne": True}, "maintenance_visits": {"$exists": True, "$ne": []}}):
            for v in (d.get("maintenance_visits") or []):
                await push_maintenance_visit(db, current["id"], d["id"], v, d.get("title") or "Project", public_base_url)
                counts["maintenance"] += 1
        async for t in db.tasks.find({"is_deleted": {"$ne": True}, "done": {"$ne": True}}):
            await push_task(db, current["id"], t, public_base_url)
            counts["tasks"] += 1
        return {"synced": counts}

    return router


# -------- OAuth callback (mounted outside the auth-required router) --------
def make_google_oauth_callback_router(db):
    router = APIRouter(prefix="/oauth/calendar", tags=["Google Calendar OAuth"])

    @router.get("/callback")
    async def callback(code: Optional[str] = Query(None), state: Optional[str] = Query(None), error: Optional[str] = Query(None)):
        if error or not code or not state:
            return RedirectResponse(url=POST_AUTH_REDIRECT_ERR + f"&reason={error or 'missing-params'}")
        user_id = await _consume_state(db, state)
        if not user_id:
            return RedirectResponse(url=POST_AUTH_REDIRECT_ERR + "&reason=bad-state")
        try:
            token_resp = requests.post(TOKEN_URL, data={
                "code": code,
                "client_id": CLIENT_ID,
                "client_secret": CLIENT_SECRET,
                "redirect_uri": REDIRECT_URI,
                "grant_type": "authorization_code",
            }).json()
            if "error" in token_resp:
                return RedirectResponse(url=POST_AUTH_REDIRECT_ERR + f"&reason={token_resp.get('error')}")
            access_token = token_resp.get("access_token")
            # Pull user email to display in settings UI
            userinfo = requests.get(
                "https://www.googleapis.com/oauth2/v2/userinfo",
                headers={"Authorization": f"Bearer {access_token}"},
                timeout=10,
            ).json()
            patch = {
                "google_tokens": {
                    "access_token": access_token,
                    "refresh_token": token_resp.get("refresh_token"),
                    "expires_in": token_resp.get("expires_in"),
                    "scope": token_resp.get("scope"),
                    "token_type": token_resp.get("token_type"),
                    "obtained_at": datetime.now(timezone.utc).isoformat(),
                },
                "google_email": userinfo.get("email") or "",
            }
            await db.users.update_one({"id": user_id}, {"$set": patch})
            return RedirectResponse(url=POST_AUTH_REDIRECT)
        except Exception as e:
            return RedirectResponse(url=POST_AUTH_REDIRECT_ERR + f"&reason=exception")

    return router
