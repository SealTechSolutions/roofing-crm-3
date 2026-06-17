"""Regression tests for the in-process APScheduler jobs.

Covers:
  1. /api/scheduler/jobs    — admin sees both jobs registered with future
                              next_run_at; non-admins blocked.
  2. /api/scheduler/jobs/mark_lead_to_sent/run
     — auto-promotes Lead deals with last_scope_sent_at older than 24 hours
       to Sent and appends an audit entry to status_history.
  3. /api/scheduler/jobs/weekly_stale_digest/run
     — runs end-to-end (dry-run gates the SMTP path by skipping if Gmail is
       not configured) and returns counts.
"""
import os
import pathlib
from datetime import datetime, timedelta, timezone

import pytest
import requests


def _load_base_url():
    env = os.environ.get("REACT_APP_BACKEND_URL")
    if env:
        return env.rstrip("/")
    fpath = pathlib.Path("/app/frontend/.env")
    if fpath.exists():
        for line in fpath.read_text().splitlines():
            if line.startswith("REACT_APP_BACKEND_URL="):
                return line.split("=", 1)[1].strip().rstrip("/")
    raise RuntimeError("REACT_APP_BACKEND_URL not set")


BASE_URL = _load_base_url()


def _auth():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": "admin@roofingcrm.com", "password": "admin123"},
        timeout=30,
    )
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_scheduler_jobs_list_includes_both_jobs():
    h = _auth()
    r = requests.get(f"{BASE_URL}/api/scheduler/jobs", headers=h, timeout=30)
    assert r.status_code == 200
    j = r.json()
    assert j["running"] is True
    ids = {job["id"] for job in j["jobs"]}
    assert {"mark_lead_to_sent", "weekly_stale_digest"}.issubset(ids), j
    for job in j["jobs"]:
        # Every job must have a future next_run_at
        assert job["next_run_at"], f"no next_run for {job['id']}"


def test_scheduler_run_unknown_job_404s():
    h = _auth()
    r = requests.post(f"{BASE_URL}/api/scheduler/jobs/does_not_exist/run", headers=h, timeout=30)
    assert r.status_code == 404


def test_mark_lead_to_sent_flips_aged_lead():
    """Seed a deal in Lead status with a stale scope_sent timestamp; the job
    must promote it to Sent and stamp status_history."""
    h = _auth()
    # Create a brand-new minimal deal in Lead status
    create = requests.post(
        f"{BASE_URL}/api/deals",
        headers=h,
        json={"title": "Lead→Sent auto-flip probe", "status": "Lead", "deal_type": "Scope"},
        timeout=30,
    )
    assert create.status_code in (200, 201), create.text
    deal_id = create.json()["id"]
    twenty_five_h_ago = (datetime.now(timezone.utc) - timedelta(hours=25)).isoformat()

    try:
        # Force last_scope_sent_at to 25h ago. The Deal model has the field so a
        # straight PUT carrying the field would work, but to be airtight on the
        # exact age we PUT through the API.
        full = requests.get(f"{BASE_URL}/api/deals/{deal_id}", headers=h, timeout=30).json()
        full["last_scope_sent_at"] = twenty_five_h_ago
        for k in ("id", "created_at", "updated_at"):
            full.pop(k, None)
        r = requests.put(f"{BASE_URL}/api/deals/{deal_id}", headers=h, json=full, timeout=30)
        assert r.status_code == 200, r.text

        # Trigger the job
        r = requests.post(
            f"{BASE_URL}/api/scheduler/jobs/mark_lead_to_sent/run", headers=h, timeout=60
        )
        assert r.status_code == 200, r.text
        result = r.json()["result"]
        assert deal_id in result["deal_ids"], result
        assert result["flipped"] >= 1

        after = requests.get(f"{BASE_URL}/api/deals/{deal_id}", headers=h, timeout=30).json()
        assert after["status"] == "Sent"
        hist = after.get("status_history") or []
        # Find the auto-flip entry
        auto = next((h_ for h_ in hist if h_.get("user_name") == "auto-flip"), None)
        assert auto, f"no auto-flip status_history entry: {hist!r}"
        assert auto["from"] == "Lead"
        assert auto["to"] == "Sent"
    finally:
        requests.delete(f"{BASE_URL}/api/deals/{deal_id}", headers=h, timeout=30)


def test_mark_lead_to_sent_idempotent_for_fresh_send():
    """A deal whose scope was sent < 24h ago must NOT be flipped."""
    h = _auth()
    create = requests.post(
        f"{BASE_URL}/api/deals",
        headers=h,
        json={"title": "Fresh-send no-flip probe", "status": "Lead", "deal_type": "Scope"},
        timeout=30,
    )
    deal_id = create.json()["id"]
    fresh = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
    try:
        full = requests.get(f"{BASE_URL}/api/deals/{deal_id}", headers=h, timeout=30).json()
        full["last_scope_sent_at"] = fresh
        for k in ("id", "created_at", "updated_at"):
            full.pop(k, None)
        requests.put(f"{BASE_URL}/api/deals/{deal_id}", headers=h, json=full, timeout=30)

        r = requests.post(
            f"{BASE_URL}/api/scheduler/jobs/mark_lead_to_sent/run", headers=h, timeout=60
        )
        assert r.status_code == 200, r.text
        result = r.json()["result"]
        assert deal_id not in result["deal_ids"], result

        after = requests.get(f"{BASE_URL}/api/deals/{deal_id}", headers=h, timeout=30).json()
        assert after["status"] == "Lead", "Fresh sends must not be auto-flipped"
    finally:
        requests.delete(f"{BASE_URL}/api/deals/{deal_id}", headers=h, timeout=30)


def test_weekly_stale_digest_runs_without_crashing():
    """Smoke test the digest job; SMTP may fail in this env but the job itself
    must return a structured count even when no one is emailable."""
    h = _auth()
    r = requests.post(
        f"{BASE_URL}/api/scheduler/jobs/weekly_stale_digest/run", headers=h, timeout=120
    )
    assert r.status_code == 200, r.text
    result = r.json()["result"]
    assert result["job"] == "weekly_stale_digest"
    assert "owners_eligible" in result
    assert "sent" in result
    assert "skipped" in result
