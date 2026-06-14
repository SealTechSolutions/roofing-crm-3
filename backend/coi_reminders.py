"""COI (Certificate of Insurance) annual reminder system.

Sends an annual email to every active Subcontractor asking them to issue a new
COI naming SealTech's required Additional Insured entities. Settings live in
the `coi_reminder_settings` collection (single doc, key="coi_reminder").

Schedule:
  - `next_send_date` = ISO date (YYYY-MM-DD). Background loop checks every hour.
  - When `today_local >= next_send_date` and we haven't already sent today,
    we send the batch and roll `next_send_date` forward 1 year.

Manual trigger:
  - `POST /api/coi-reminder/send-now` (admin-only) — runs the batch immediately
    without waiting for the schedule.

History: every send (auto or manual) writes a row to `coi_reminder_history`
with timestamps, recipient counts, and per-vendor delivery status.
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, date, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict

from email_sender import send_email, EmailNotConfigured

logger = logging.getLogger("coi_reminder")

SETTINGS_KEY = "coi_reminder"

DEFAULT_SETTINGS = {
    "key": SETTINGS_KEY,
    "enabled": True,
    "next_send_date": "2027-01-10",     # first run
    "frequency_months": 12,             # annual
    "subject": "ACTION NEEDED — Renewed Certificate of Insurance (COI) Request",
    "additional_insured_text": (
        "SealTech Building Solutions, LLC and Western States Contracting Services, Inc.\n"
        "2278 Manatt Ct., Unit C02\n"
        "Castle Rock, CO 80104"
    ),
    "body_intro": (
        "Hello,\n\n"
        "It is time for your annual Certificate of Insurance renewal on file with us. "
        "Please ask your insurance agent to issue an updated COI naming the following "
        "as Additional Insured:"
    ),
    "body_outro": (
        "Coverages should include General Liability, Automobile Liability, Workers' Compensation, "
        "and Umbrella where applicable.\n\n"
        "Please have your agent email the updated certificate to this address at your earliest "
        "convenience. If you have any questions, just reply to this message.\n\n"
        "Thank you,\n"
        "SealTech Building Solutions"
    ),
    "cc": "",                           # optional CC (e.g., your insurance broker)
    "last_sent_at": None,                # ISO datetime
    "last_sent_count": 0,
}


# ---------- Pydantic ----------
class CoiSettingsIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    enabled: bool = True
    next_send_date: str = "2027-01-10"
    frequency_months: int = 12
    subject: str = ""
    additional_insured_text: str = ""
    body_intro: str = ""
    body_outro: str = ""
    cc: str = ""


# ---------- DB helpers ----------
async def get_settings(db) -> dict:
    doc = await db.coi_reminder_settings.find_one({"key": SETTINGS_KEY}, {"_id": 0})
    if not doc:
        await db.coi_reminder_settings.insert_one(DEFAULT_SETTINGS.copy())
        doc = await db.coi_reminder_settings.find_one({"key": SETTINGS_KEY}, {"_id": 0})
    return doc


async def save_settings(db, patch: dict) -> dict:
    patch = {k: v for k, v in patch.items() if k in DEFAULT_SETTINGS and k not in ("key", "last_sent_at", "last_sent_count")}
    if patch:
        await db.coi_reminder_settings.update_one(
            {"key": SETTINGS_KEY}, {"$set": patch}, upsert=True,
        )
    return await get_settings(db)


# ---------- Email template ----------
def _build_email_body(vendor: dict, settings: dict) -> tuple[str, str]:
    """Return (plain_text, html) bodies personalized per-subcontractor."""
    name = (vendor.get("contact_name") or vendor.get("name") or "").strip() or "Team"
    company = (vendor.get("name") or "").strip()
    intro = settings.get("body_intro") or DEFAULT_SETTINGS["body_intro"]
    outro = settings.get("body_outro") or DEFAULT_SETTINGS["body_outro"]
    ai = settings.get("additional_insured_text") or DEFAULT_SETTINGS["additional_insured_text"]

    greeting = f"Hello {name},"
    company_line = f" (for {company})" if company else ""

    text = (
        f"{greeting}\n\n"
        f"{intro}{company_line}\n\n"
        f"--- ADDITIONAL INSURED ---\n"
        f"{ai}\n"
        f"--------------------------\n\n"
        f"{outro}"
    )

    ai_html = ai.replace("\n", "<br/>")
    intro_html = intro.replace("\n\n", "</p><p>").replace("\n", "<br/>")
    outro_html = outro.replace("\n\n", "</p><p>").replace("\n", "<br/>")
    html = f"""<!doctype html>
<html><body style="font-family: Arial, sans-serif; color:#222; max-width:640px; margin:0 auto; padding:24px;">
  <p>{greeting}</p>
  <p>{intro_html}{(" <em>(for " + company + ")</em>") if company else ""}</p>
  <table cellpadding="14" cellspacing="0" style="border:2px solid #1d4ed8; background:#eff6ff; border-radius:6px; margin:18px 0; width:100%;">
    <tr><td>
      <div style="font-size:11px; font-weight:bold; letter-spacing:0.1em; color:#1e40af; text-transform:uppercase;">Additional Insured</div>
      <div style="margin-top:8px; font-size:14px; line-height:1.55;">{ai_html}</div>
    </td></tr>
  </table>
  <p>{outro_html}</p>
</body></html>"""

    return text, html


# ---------- Send batch ----------
async def send_batch(db, *, manual: bool = False, triggered_by_user_id: Optional[str] = None) -> dict:
    """Send the COI reminder email to every active Subcontractor with a valid email.
    Returns a summary dict and writes a history row."""
    settings = await get_settings(db)
    if not settings.get("enabled") and not manual:
        return {"ok": False, "skipped": True, "reason": "disabled"}

    # Find every active subcontractor with an email
    cur = db.vendors.find({
        "kind": "Subcontractor",
        "is_deleted": {"$ne": True},
        "is_active": {"$ne": False},
    }, {"_id": 0})
    vendors = [v async for v in cur]

    subject = settings.get("subject") or DEFAULT_SETTINGS["subject"]
    cc = (settings.get("cc") or "").strip() or None

    results = []
    sent_count = 0
    skipped_count = 0
    failed_count = 0

    for v in vendors:
        email = (v.get("email") or "").strip()
        if not email:
            results.append({
                "vendor_id": v.get("id"),
                "vendor_name": v.get("name"),
                "email": "",
                "status": "skipped",
                "reason": "no email on file",
            })
            skipped_count += 1
            continue
        try:
            text, html = _build_email_body(v, settings)
            r = send_email(
                to=email,
                subject=subject,
                body_text=text,
                body_html=html,
                cc=cc,
            )
            results.append({
                "vendor_id": v.get("id"),
                "vendor_name": v.get("name"),
                "email": email,
                "status": "sent",
                "message_id": r.get("message_id"),
            })
            sent_count += 1
        except EmailNotConfigured:
            # Hard stop — no point trying the rest
            results.append({
                "vendor_id": v.get("id"),
                "vendor_name": v.get("name"),
                "email": email,
                "status": "failed",
                "reason": "Gmail SMTP not configured (set GMAIL_USERNAME + GMAIL_APP_PASSWORD)",
            })
            failed_count += 1
            break
        except Exception as e:
            results.append({
                "vendor_id": v.get("id"),
                "vendor_name": v.get("name"),
                "email": email,
                "status": "failed",
                "reason": str(e)[:300],
            })
            failed_count += 1

    now_iso = datetime.now(timezone.utc).isoformat()

    # History row
    await db.coi_reminder_history.insert_one({
        "id": str(uuid.uuid4()),
        "sent_at": now_iso,
        "trigger": "manual" if manual else "scheduled",
        "triggered_by_user_id": triggered_by_user_id,
        "sent_count": sent_count,
        "skipped_count": skipped_count,
        "failed_count": failed_count,
        "results": results,
    })

    # Roll the schedule forward and update last_sent stamps
    new_next = _next_send_date(
        settings.get("next_send_date") or DEFAULT_SETTINGS["next_send_date"],
        settings.get("frequency_months") or 12,
    )
    await db.coi_reminder_settings.update_one(
        {"key": SETTINGS_KEY},
        {"$set": {
            "last_sent_at": now_iso,
            "last_sent_count": sent_count,
            "next_send_date": new_next,
        }},
    )

    logger.info(
        f"COI reminder batch: sent={sent_count} skipped={skipped_count} "
        f"failed={failed_count} (manual={manual})"
    )

    return {
        "ok": True,
        "sent_count": sent_count,
        "skipped_count": skipped_count,
        "failed_count": failed_count,
        "next_send_date": new_next,
        "results": results,
    }


def _next_send_date(current_iso: str, frequency_months: int) -> str:
    """Advance an ISO date string by N months (approximated as 30*N days for simplicity
    + then snap to the same day-of-month if possible). For annual cadence the simple
    `year + 1` is exact, which is the only case we care about today."""
    try:
        d = date.fromisoformat(current_iso)
    except Exception:
        d = date.today()
    years, months = divmod(int(frequency_months or 12), 12)
    new_year = d.year + years
    new_month = d.month + months
    if new_month > 12:
        new_year += 1
        new_month -= 12
    # Clamp day for short months
    day = min(d.day, 28 if new_month == 2 else 30)
    return date(new_year, new_month, day).isoformat()


# ---------- Scheduler loop ----------
async def scheduler_loop(db):
    """Background task: checks once per hour whether it's time to send.
    Idempotent — uses `last_sent_at` date comparison to avoid re-sending same day."""
    while True:
        try:
            settings = await get_settings(db)
            if settings.get("enabled"):
                today = date.today()
                next_send = (settings.get("next_send_date") or "")
                last_sent_at = settings.get("last_sent_at") or ""
                last_sent_day = last_sent_at[:10] if last_sent_at else ""
                if next_send and today.isoformat() >= next_send and last_sent_day != today.isoformat():
                    logger.info(f"COI reminder due ({next_send}) — running scheduled batch")
                    await send_batch(db, manual=False)
        except Exception as e:
            logger.warning(f"COI scheduler tick failed (non-fatal): {e}")
        # Sleep 1 hour between ticks (3600s). Short enough to catch the window without DB churn.
        await asyncio.sleep(3600)


# ---------- Router ----------
def create_router(db, require_admin) -> APIRouter:
    router = APIRouter(prefix="/coi-reminder", tags=["COI Reminders"])

    @router.get("/settings")
    async def get_coi_settings(_=Depends(require_admin)):
        return await get_settings(db)

    @router.put("/settings")
    async def update_coi_settings(body: CoiSettingsIn, _=Depends(require_admin)):
        return await save_settings(db, body.model_dump())

    @router.post("/send-now")
    async def send_now(current=Depends(require_admin)):
        result = await send_batch(db, manual=True, triggered_by_user_id=current.get("id"))
        return result

    @router.get("/history")
    async def history(limit: int = 50, _=Depends(require_admin)):
        cur = db.coi_reminder_history.find({}, {"_id": 0}).sort("sent_at", -1).limit(limit)
        return [r async for r in cur]

    @router.get("/preview-recipients")
    async def preview_recipients(_=Depends(require_admin)):
        """Returns the list of subcontractors that would be emailed right now."""
        cur = db.vendors.find({
            "kind": "Subcontractor",
            "is_deleted": {"$ne": True},
            "is_active": {"$ne": False},
        }, {"_id": 0, "id": 1, "name": 1, "email": 1, "contact_name": 1})
        out = []
        async for v in cur:
            email = (v.get("email") or "").strip()
            out.append({
                "id": v.get("id"),
                "name": v.get("name"),
                "contact_name": v.get("contact_name"),
                "email": email,
                "will_send": bool(email),
            })
        return out

    return router
