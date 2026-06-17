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
# Bootstrapping — called from server.py on FastAPI startup
# ---------------------------------------------------------------------------

def start(db, stale_engine, send_one_digest) -> AsyncIOScheduler:
    """Initialize + start the scheduler. Idempotent."""
    global _scheduler, _jobs
    if _scheduler is not None:
        return _scheduler

    if os.environ.get("DISABLE_SCHEDULER", "").lower() in ("1", "true", "yes"):
        logger.info("[scheduler] DISABLE_SCHEDULER set; not starting jobs")
        return None

    _jobs = {
        "mark_lead_to_sent": lambda: _auto_flip_lead_to_sent(db),
        "weekly_stale_digest": lambda: _weekly_stale_digest(stale_engine, send_one_digest),
    }

    sched = AsyncIOScheduler(timezone=timezone.utc)
    # Daily Lead → Sent flip at 02:30 UTC (well after midnight in every US TZ).
    sched.add_job(
        _jobs["mark_lead_to_sent"],
        CronTrigger(hour=2, minute=30, timezone=timezone.utc),
        id="mark_lead_to_sent",
        name="Auto-flip Lead → Sent (24h after scope emailed)",
        replace_existing=True,
        misfire_grace_time=3600,  # if the pod was restarting, still run within an hour
    )
    # Monday 14:00 UTC == 08:00 America/Denver (Mountain Standard Time).
    # Daylight Saving lands on the +1 hour automatically since we anchor in UTC.
    sched.add_job(
        _jobs["weekly_stale_digest"],
        CronTrigger(day_of_week="mon", hour=14, minute=0, timezone=timezone.utc),
        id="weekly_stale_digest",
        name="Weekly Stale-Deals Digest (Mon 08:00 MT)",
        replace_existing=True,
        misfire_grace_time=3 * 3600,
    )
    sched.start()
    _scheduler = sched
    logger.info(
        "[scheduler] started; jobs=%s",
        ", ".join(j.id for j in sched.get_jobs()),
    )
    return sched


def shutdown() -> None:
    global _scheduler
    if _scheduler is not None:
        try:
            _scheduler.shutdown(wait=False)
        except Exception:
            pass
        _scheduler = None
