"""Ad-hoc Deal Events — appointments, roof walks, meetings tied to a specific
Deal.

Unlike `tasks` (a generic to-do) and unlike the derived calendar events
(material order date, scheduled project span, maintenance visits) which are
inferred from existing Deal fields, this module stores user-entered
appointments directly on the Deal so the rep can book a "Roof Walk @ 11 AM"
straight from the Deal page without leaving for the global Calendar.

Each event:
    - is owned by the user who created it,
    - can optionally sync to Google Calendar (assessment_calendar_id by default),
    - shows up in the unified /api/calendar feed (kind="appointment"),
    - shows up on the Dashboard "Today" widget,
    - triggers an email reminder 1 hour before its start time.

Event types match the user's request: Roof Walk, Presentation, Meeting,
Job Start, Other.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field


EVENT_TYPES = ("Roof Walk", "Presentation", "Meeting", "Job Start", "Other")
EVENT_TYPE_EMOJI = {
    "Roof Walk": "🪜",
    "Presentation": "📊",
    "Meeting": "🤝",
    "Job Start": "🚧",
    "Other": "📅",
}


class DealEventIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    title: str
    event_type: str = "Other"
    date: str  # YYYY-MM-DD
    start_time: str = ""  # HH:MM (24h), optional → all-day
    end_time: str = ""  # HH:MM (24h), optional
    location: str = ""
    notes: str = ""
    sync_to_google: bool = True
    reminder_enabled: bool = True  # email + dashboard "Today" widget
    invitees: List[str] = Field(default_factory=list)  # extra email addresses for reminder


class DealEvent(DealEventIn):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    deal_id: str
    created_by_user_id: str = ""
    created_at: str = ""
    updated_at: str = ""
    is_deleted: bool = False
    google_event_id: Optional[str] = None
    google_calendar_id: Optional[str] = None
    reminder_sent_at: Optional[str] = None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def push_event_to_gcal(db, user_id: str, event: dict, public_base_url: str = "") -> None:
    """Sync a single ad-hoc deal event to Google Calendar. Safe no-op if the
    user has not connected Google or `sync_to_google` is False."""
    if not event.get("sync_to_google"):
        return
    try:
        import google_calendar as gcal
    except Exception:
        return
    settings = await gcal.get_settings(db, user_id)
    if not settings.enabled:
        return
    target_cal = settings.assessment_calendar_id or settings.project_calendar_id
    if not target_cal:
        return

    emoji = EVENT_TYPE_EMOJI.get(event.get("event_type") or "Other", "📅")
    title = f"{emoji} {event.get('title') or event.get('event_type') or 'Appointment'}"
    description_parts = []
    if event.get("location"):
        description_parts.append(f"📍 {event['location']}")
    if event.get("notes"):
        description_parts.append(event["notes"])
    description = "\n\n".join(description_parts)
    source_url = f"{public_base_url}/deals/{event['deal_id']}" if public_base_url else None

    start_time = (event.get("start_time") or "").strip()
    end_time = (event.get("end_time") or "").strip()
    date = event["date"]

    if start_time:
        start = f"{date}T{start_time}:00"
        end = f"{date}T{end_time or start_time}:00"
        body = gcal._build_event(
            title=title,
            description=description,
            start=start,
            end=end,
            all_day=False,
            timezone_str="America/Denver",
            source_url=source_url,
        )
    else:
        body = gcal._build_event(
            title=title,
            description=description,
            start=date,
            all_day=True,
            source_url=source_url,
        )

    new_id = await gcal.upsert_event(db, user_id, target_cal, event.get("google_event_id"), body)
    if new_id and new_id != event.get("google_event_id"):
        await db.deal_events.update_one(
            {"id": event["id"]},
            {"$set": {"google_event_id": new_id, "google_calendar_id": target_cal}},
        )


async def delete_event_from_gcal(db, user_id: str, event: dict) -> None:
    if not event.get("google_event_id") or not event.get("google_calendar_id"):
        return
    try:
        import google_calendar as gcal
    except Exception:
        return
    await gcal.delete_event(db, user_id, event["google_calendar_id"], event["google_event_id"])


def make_router(db, get_current_user, public_base_url: str = ""):
    router = APIRouter(prefix="/deals/{deal_id}/events", tags=["Deal Events"])

    async def _assert_deal(deal_id: str):
        d = await db.deals.find_one({"id": deal_id, "is_deleted": {"$ne": True}}, {"_id": 0, "id": 1, "title": 1})
        if not d:
            raise HTTPException(status_code=404, detail="Deal not found")
        return d

    @router.get("")
    async def list_events(deal_id: str, current=Depends(get_current_user), include_past: bool = True):
        await _assert_deal(deal_id)
        q = {"deal_id": deal_id, "is_deleted": {"$ne": True}}
        if not include_past:
            today = datetime.now(timezone.utc).date().isoformat()
            q["date"] = {"$gte": today}
        cur = db.deal_events.find(q, {"_id": 0}).sort([("date", 1), ("start_time", 1)])
        return await cur.to_list(500)

    @router.post("", response_model=DealEvent)
    async def create_event(deal_id: str, body: DealEventIn, current=Depends(get_current_user)):
        deal = await _assert_deal(deal_id)
        if body.event_type not in EVENT_TYPES:
            raise HTTPException(status_code=400, detail=f"event_type must be one of {EVENT_TYPES}")
        doc = DealEvent(**body.model_dump(), deal_id=deal_id).model_dump()
        doc["created_by_user_id"] = current["id"]
        doc["created_at"] = _now_iso()
        doc["updated_at"] = _now_iso()
        await db.deal_events.insert_one(doc.copy())
        try:
            await push_event_to_gcal(db, current["id"], {**doc, "deal_title": deal.get("title")}, public_base_url)
        except Exception:
            pass
        out = await db.deal_events.find_one({"id": doc["id"]}, {"_id": 0})
        return out

    @router.put("/{event_id}", response_model=DealEvent)
    async def update_event(deal_id: str, event_id: str, body: DealEventIn, current=Depends(get_current_user)):
        existing = await db.deal_events.find_one({"id": event_id, "deal_id": deal_id})
        if not existing or existing.get("is_deleted"):
            raise HTTPException(status_code=404, detail="Event not found")
        if body.event_type not in EVENT_TYPES:
            raise HTTPException(status_code=400, detail=f"event_type must be one of {EVENT_TYPES}")
        patch = body.model_dump()
        patch["updated_at"] = _now_iso()
        # Reset reminder if date/time changed so we don't double-send.
        if patch.get("date") != existing.get("date") or patch.get("start_time") != existing.get("start_time"):
            patch["reminder_sent_at"] = None
        await db.deal_events.update_one({"id": event_id}, {"$set": patch})
        merged = await db.deal_events.find_one({"id": event_id}, {"_id": 0})
        try:
            await push_event_to_gcal(db, current["id"], merged, public_base_url)
        except Exception:
            pass
        return merged

    @router.delete("/{event_id}")
    async def delete_event(deal_id: str, event_id: str, current=Depends(get_current_user)):
        existing = await db.deal_events.find_one({"id": event_id, "deal_id": deal_id})
        if not existing:
            raise HTTPException(status_code=404, detail="Event not found")
        try:
            await delete_event_from_gcal(db, current["id"], existing)
        except Exception:
            pass
        await db.deal_events.update_one({"id": event_id}, {"$set": {"is_deleted": True, "updated_at": _now_iso()}})
        return {"deleted": True}

    return router


# ---------------------------------------------------------------------------
# Reminder scheduler — runs every 5 minutes; emails the owner 60 minutes (±5)
# before the event start time. Idempotent via `reminder_sent_at`.
# ---------------------------------------------------------------------------

async def send_due_reminders(db) -> dict:
    """Find events starting in the next ~60 minutes that haven't had a reminder
    sent yet, and email the owner + invitees. Returns counts for logging."""
    try:
        from email_sender import send_email
    except Exception:
        return {"sent": 0, "skipped": 0, "error": "email_sender not available"}

    now = datetime.now(timezone.utc)
    today_iso = now.date().isoformat()
    # Window: events today that have a start_time and that have not been
    # notified yet. We compute the absolute trigger window in Python because
    # the times are stored as local "HH:MM" strings under the user's tz.
    cursor = db.deal_events.find(
        {
            "is_deleted": {"$ne": True},
            "reminder_enabled": True,
            "reminder_sent_at": None,
            "date": today_iso,
            "start_time": {"$ne": ""},
        },
        {"_id": 0},
    )
    events = await cursor.to_list(500)

    sent_count = 0
    skipped = 0
    for ev in events:
        try:
            # Parse the event start as America/Denver local time → UTC.
            from zoneinfo import ZoneInfo  # py3.9+
            tz = ZoneInfo("America/Denver")
            hh, mm = ev["start_time"].split(":")
            local_dt = datetime.fromisoformat(f"{ev['date']}T{int(hh):02d}:{int(mm):02d}:00").replace(tzinfo=tz)
            utc_dt = local_dt.astimezone(timezone.utc)
            minutes_until = (utc_dt - now).total_seconds() / 60.0
        except Exception:
            skipped += 1
            continue

        # Fire reminder when between 55 and 65 minutes out (5-min cron grace).
        if not (55 <= minutes_until <= 65):
            continue

        # Get owner email + deal title for the message
        owner = await db.users.find_one({"id": ev.get("created_by_user_id")}, {"_id": 0, "email": 1, "name": 1})
        deal = await db.deals.find_one({"id": ev["deal_id"]}, {"_id": 0, "title": 1})
        if not owner or not owner.get("email"):
            skipped += 1
            continue

        recipients = [owner["email"]] + [e.strip() for e in (ev.get("invitees") or []) if e.strip()]
        emoji = EVENT_TYPE_EMOJI.get(ev.get("event_type") or "Other", "📅")
        subject = f"{emoji} Reminder in 1 hour: {ev.get('title') or ev.get('event_type')} — {deal.get('title') if deal else ''}"
        body_lines = [
            "You have an appointment in about 1 hour.",
            "",
            f"What:    {ev.get('event_type')} — {ev.get('title') or ''}",
            f"When:    {ev['date']} at {ev['start_time']} (Mountain Time)",
        ]
        if ev.get("location"):
            body_lines.append(f"Where:   {ev['location']}")
        if deal:
            body_lines.append(f"Project: {deal.get('title')}")
        if ev.get("notes"):
            body_lines.extend(["", "Notes:", ev["notes"]])
        body_text = "\n".join(body_lines)
        ok = True
        for to in recipients:
            try:
                send_email(to=to, subject=subject, body_text=body_text)
            except Exception:
                ok = False
        if ok:
            await db.deal_events.update_one(
                {"id": ev["id"]},
                {"$set": {"reminder_sent_at": now.isoformat()}},
            )
            sent_count += 1
        else:
            skipped += 1

    return {"sent": sent_count, "skipped": skipped, "checked": len(events)}
