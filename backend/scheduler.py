"""In-process scheduler for periodic CRM jobs.

Uses APScheduler's `AsyncIOScheduler` so jobs run inside the FastAPI event loop
— no separate worker container required. The user explicitly asked for an
"in-process cron" alternative; this is it.

Two scheduled jobs are registered today:

  1. `mark_lead_to_sent` — daily at 02:30 UTC. Any deal whose status is still
     "Lead" while `last_scope_sent_at` is older than 24 hours is promoted to
     "Sent". The scope has demonstrably gone out the door; we just align the
     deal status with reality and write a status_history entry.

  2. `weekly_stale_digest` — every Monday at 14:00 UTC (08:00 America/Denver,
     start of the work week for the SealTech team). Calls the same digest
     engine the admin's "Send Digest" button uses, with `cc_admin=False` so
     owners get a fresh-on-Monday email without a CC.

Both jobs can be triggered on-demand via the admin endpoint
`POST /api/scheduler/jobs/{job_id}/run` (see server.py).
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable, Dict, Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

logger = logging.getLogger(__name__)

_scheduler: Optional[AsyncIOScheduler] = None
# Registry of job_id -> coroutine fn for ad-hoc triggering from the API
_jobs: Dict[str, Callable[[], Awaitable[Dict[str, Any]]]] = {}


def get_scheduler() -> Optional[AsyncIOScheduler]:
    return _scheduler


def list_jobs() -> list[dict]:
    """List registered jobs + their next scheduled run for the admin dashboard."""
    if not _scheduler:
        return []
    out = []
    for job in _scheduler.get_jobs():
        out.append({
            "id": job.id,
            "name": job.name,
            "next_run_at": job.next_run_time.isoformat() if job.next_run_time else None,
            "trigger": str(job.trigger),
        })
    return out


async def run_job_now(job_id: str) -> Dict[str, Any]:
    """Trigger a registered job out of band. Returns the job's own return value."""
    fn = _jobs.get(job_id)
    if not fn:
        raise KeyError(f"Unknown scheduler job: {job_id}")
    return await fn()


# ---------------------------------------------------------------------------
# Job 1 — Auto-flip Lead → Sent 24 hours after the scope is emailed
# ---------------------------------------------------------------------------

async def _auto_flip_lead_to_sent(db) -> Dict[str, Any]:
    """Promote any deal whose last_scope_sent_at is older than 24h from Lead
    to Sent. The dot on the pipeline turns green the moment the email goes
    out, but the column-level status stays Lead until someone manually flips
    it — this closes that gap for any deal where the rep forgot.
    """
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=24)
    cutoff_iso = cutoff.isoformat()
    query = {
        "is_deleted": {"$ne": True},
        "status": "Lead",
        "last_scope_sent_at": {"$ne": "", "$ne": None, "$lt": cutoff_iso},
    }
    # Mongo can't $ne to two values in one selector; do it as a separate filter.
    candidates = await db.deals.find(
        {
            "is_deleted": {"$ne": True},
            "status": "Lead",
            "last_scope_sent_at": {"$lt": cutoff_iso},
        },
        {"_id": 0, "id": 1, "title": 1, "last_scope_sent_at": 1},
    ).to_list(5000)
    candidates = [c for c in candidates if c.get("last_scope_sent_at")]

    flipped = []
    for d in candidates:
        history_entry = {
            "at": now.isoformat(),
            "from": "Lead",
            "to": "Sent",
            "user_id": "system",
            "user_name": "auto-flip",
            "label": "Auto-promoted Lead → Sent (scope emailed 24h+ ago)",
        }
        await db.deals.update_one(
            {"id": d["id"], "status": "Lead"},  # double-check status hasn't changed
            {
                "$set": {"status": "Sent", "updated_at": now.isoformat()},
                "$push": {"status_history": history_entry},
            },
        )
        flipped.append(d["id"])
    logger.info(f"[scheduler] auto-flip Lead→Sent: {len(flipped)} deal(s) promoted")
    return {"job": "mark_lead_to_sent", "checked": len(candidates), "flipped": len(flipped), "deal_ids": flipped}


# ---------------------------------------------------------------------------
# Job 2 — Monday morning Stale-Deals digest
# ---------------------------------------------------------------------------

async def _weekly_stale_digest(stale_engine, send_one_digest) -> Dict[str, Any]:
    """Build the per-owner digest set and email each owner.
    `stale_engine` and `send_one_digest` are injected callables wired in
    server.py so we don't reimport server.py here (would cause a circular
    import) and the unit-test path can stub them easily.
    """
    days = 14
    won_grace_days = 30
    rows = await stale_engine(days=days, won_grace_days=won_grace_days)
    by_owner: Dict[str, list] = {}
    for r in rows:
        owner_id = r.get("owner_user_id") or ""
        if owner_id:
            by_owner.setdefault(owner_id, []).append(r)

    sent = 0
    skipped = 0
    for owner_id, deals_for_owner in by_owner.items():
        try:
            ok = await send_one_digest(owner_id, deals_for_owner, days, won_grace_days)
            if ok:
                sent += 1
            else:
                skipped += 1
        except Exception as e:
            skipped += 1
            logger.warning(f"[scheduler] digest send failed for owner={owner_id}: {e}")
    logger.info(f"[scheduler] weekly digest: sent={sent} skipped={skipped} owners_total={len(by_owner)}")
    return {"job": "weekly_stale_digest", "owners_eligible": len(by_owner), "sent": sent, "skipped": skipped}


# ---------------------------------------------------------------------------
# Job 3 — Daily Status Report email (7:00 AM Mountain Time, Mon–Fri)
# ---------------------------------------------------------------------------

async def _daily_status_email(db) -> Dict[str, Any]:
    """Build the Daily Status PDF and email it to admin + every deal owner.

    Data gathering + render are delegated to the same engine used by the
    on-demand `/api/reports/daily-status.pdf` endpoint, so the cron and the
    button output identical reports.
    """
    from email_sender import send_email
    import daily_status_pdf as _dsp
    try:
        from server import collect_daily_status_data  # type: ignore
    except Exception as e:
        logger.warning(f"[scheduler] daily_status_email collector import failed: {e}")
        return {"job": "daily_status_email", "sent": 0, "error": "collector_unavailable"}

    payload = await collect_daily_status_data(db)
    try:
        pdf_bytes = _dsp.build_daily_status_pdf(**payload)
    except Exception as e:
        logger.warning(f"[scheduler] daily_status_email build failed: {e}")
        return {"job": "daily_status_email", "sent": 0, "error": f"render_failed:{e}"}

    recipients = await _resolve_daily_status_recipients(db)
    if not recipients:
        return {"job": "daily_status_email", "sent": 0, "skipped": "no_recipients"}

    today_label = datetime.now(timezone.utc).strftime("%A, %B %d, %Y")
    subject = f"Daily Status — {today_label}"
    body_text = (
        "Good morning,\n\n"
        "Attached is today's Daily Status — every active deal, where it is in the\n"
        "process, what's next, and who owns it.\n\n"
        "— SealTech CRM"
    )
    sent = 0
    failed = 0
    for to in recipients:
        try:
            send_email(
                to=to,
                subject=subject,
                body_text=body_text,
                attachments=[{
                    "filename": f"daily-status-{datetime.now(timezone.utc).date().isoformat()}.pdf",
                    "content": pdf_bytes,
                    "mime_type": "application/pdf",
                }],
            )
            sent += 1
        except Exception as e:
            logger.warning(f"[scheduler] daily_status_email send to {to} failed: {e}")
            failed += 1
    logger.info(f"[scheduler] daily_status_email: sent={sent} failed={failed} recipients={len(recipients)}")
    return {"job": "daily_status_email", "sent": sent, "failed": failed, "recipients": recipients}


async def _resolve_daily_status_recipients(db) -> list[str]:
    """Admin + every user owning ≥1 active (non-Lost / non-Past-Lead) deal."""
    out: list[str] = []
    seen: set[str] = set()
    admins = await db.users.find(
        {"role": "admin", "is_active": {"$ne": False}, "is_deleted": {"$ne": True}},
        {"_id": 0, "email": 1},
    ).to_list(20)
    for a in admins:
        e = (a.get("email") or "").strip()
        if e and e.lower() not in seen:
            out.append(e)
            seen.add(e.lower())
    deals = await db.deals.find(
        {"is_deleted": {"$ne": True}, "status": {"$nin": ["Lost", "Past Lead"]}},
        {"_id": 0, "assigned_to_user_id": 1, "created_by_user_id": 1},
    ).to_list(5000)
    owner_ids = {d.get("assigned_to_user_id") or d.get("created_by_user_id") for d in deals}
    owner_ids.discard(None)
    owner_ids.discard("")
    if owner_ids:
        users = await db.users.find(
            {
                "id": {"$in": list(owner_ids)},
                "is_active": {"$ne": False},
                "is_deleted": {"$ne": True},
            },
            {"_id": 0, "email": 1},
        ).to_list(len(owner_ids))
        for u in users:
            e = (u.get("email") or "").strip()
            if e and e.lower() not in seen:
                out.append(e)
                seen.add(e.lower())
    return out


# ---------------------------------------------------------------------------
# Bootstrapping — called from server.py on FastAPI startup
# ---------------------------------------------------------------------------

# Built-in defaults for each job. Overridable via the `scheduler_settings`
# Mongo collection (one doc per job_id). All times are UTC.
JOB_DEFAULTS = {
    "mark_lead_to_sent": {
        "supports_day_of_week": False,  # daily job
        "hour": 2,
        "minute": 30,
        "day_of_week": "*",
        "name": "Auto-flip Lead → Sent (24h after scope emailed)",
        "misfire_grace_time": 3600,
    },
    "weekly_stale_digest": {
        "supports_day_of_week": True,
        "hour": 14,  # 08:00 America/Denver
        "minute": 0,
        "day_of_week": "mon",
        "name": "Weekly Stale-Deals Digest",
        "misfire_grace_time": 3 * 3600,
    },
    "daily_status_email": {
        # 7:00 AM Mountain Time. MDT (Mar–Nov) = UTC-6 → 13:00 UTC.
        # MST (Nov–Mar) = UTC-7 → 14:00 UTC. We default to 13:00 UTC so the
        # report lands no later than 7am MDT during the bulk of the year; the
        # admin can shift via PUT /api/scheduler/jobs/daily_status_email/schedule
        # for Standard Time if desired.
        "supports_day_of_week": True,
        "hour": 13,
        "minute": 0,
        "day_of_week": "mon,tue,wed,thu,fri",
        "name": "Daily Status Report (7am MT, Mon–Fri)",
        "misfire_grace_time": 2 * 3600,
    },
}


async def _resolve_trigger_config(db, job_id: str) -> dict:
    """Look up persisted overrides in `scheduler_settings`; fall back to defaults."""
    base = dict(JOB_DEFAULTS.get(job_id, {}))
    if not base:
        raise KeyError(f"Unknown job: {job_id}")
    override = await db.scheduler_settings.find_one({"job_id": job_id}, {"_id": 0})
    if override:
        for k in ("hour", "minute", "day_of_week"):
            if override.get(k) is not None:
                base[k] = override[k]
    return base


def _make_trigger(cfg: dict) -> CronTrigger:
    """Build a CronTrigger from a resolved config dict."""
    kwargs = {"hour": int(cfg["hour"]), "minute": int(cfg["minute"]), "timezone": timezone.utc}
    if cfg.get("supports_day_of_week") and cfg.get("day_of_week"):
        kwargs["day_of_week"] = cfg["day_of_week"]
    return CronTrigger(**kwargs)


async def start(db, stale_engine, send_one_digest) -> AsyncIOScheduler | None:
    """Initialize + start the scheduler. Idempotent. Must be awaited so we can
    load persisted trigger overrides from Mongo before registering jobs."""
    global _scheduler, _jobs
    if _scheduler is not None:
        return _scheduler

    if os.environ.get("DISABLE_SCHEDULER", "").lower() in ("1", "true", "yes"):
        logger.info("[scheduler] DISABLE_SCHEDULER set; not starting jobs")
        return None

    _jobs = {
        "mark_lead_to_sent": lambda: _auto_flip_lead_to_sent(db),
        "weekly_stale_digest": lambda: _weekly_stale_digest(stale_engine, send_one_digest),
        "daily_status_email": lambda: _daily_status_email(db),
    }

    sched = AsyncIOScheduler(timezone=timezone.utc)
    for job_id, fn in _jobs.items():
        cfg = await _resolve_trigger_config(db, job_id)
        sched.add_job(
            fn,
            _make_trigger(cfg),
            id=job_id,
            name=cfg["name"],
            replace_existing=True,
            misfire_grace_time=cfg["misfire_grace_time"],
        )
    sched.start()
    _scheduler = sched
    logger.info(
        "[scheduler] started; jobs=%s",
        ", ".join(j.id for j in sched.get_jobs()),
    )
    return sched


async def reschedule_job(db, job_id: str, hour: int, minute: int, day_of_week: str | None = None) -> dict:
    """Persist new trigger settings to Mongo AND re-register the job's trigger
    on the live scheduler. Returns the resolved config."""
    if job_id not in JOB_DEFAULTS:
        raise KeyError(f"Unknown job: {job_id}")
    supports_dow = JOB_DEFAULTS[job_id]["supports_day_of_week"]
    h = int(hour)
    m = int(minute)
    if not (0 <= h <= 23):
        raise ValueError("hour must be 0..23")
    if not (0 <= m <= 59):
        raise ValueError("minute must be 0..59")
    set_doc: dict = {"job_id": job_id, "hour": h, "minute": m, "updated_at": datetime.now(timezone.utc).isoformat()}
    if supports_dow:
        # Accept comma-separated days like "mon,fri" or "*" for every day.
        dow = (day_of_week or "mon").strip().lower() if day_of_week is not None else None
        if dow is None:
            dow = JOB_DEFAULTS[job_id]["day_of_week"]
        set_doc["day_of_week"] = dow
    await db.scheduler_settings.update_one(
        {"job_id": job_id},
        {"$set": set_doc},
        upsert=True,
    )
    cfg = await _resolve_trigger_config(db, job_id)
    if _scheduler is not None:
        _scheduler.reschedule_job(job_id, trigger=_make_trigger(cfg))
    return cfg


def shutdown() -> None:
    global _scheduler
    if _scheduler is not None:
        try:
            _scheduler.shutdown(wait=False)
        except Exception:
            pass
        _scheduler = None
