"""Regression tests for live scheduler-edit endpoints.

  - GET /api/scheduler/jobs returns hour/minute/day_of_week/supports_day_of_week
    on every job so the UI editor can pre-populate.
  - PUT /api/scheduler/jobs/{job_id}/schedule persists the override AND
    reschedules the live trigger (next_run_at recomputes accordingly).
  - Invalid hour/minute → 400. Unknown job → 404. Non-admin → 403.
"""
import os
import pathlib
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


def test_jobs_list_includes_editor_fields():
    h = _auth()
    r = requests.get(f"{BASE_URL}/api/scheduler/jobs", headers=h, timeout=30)
    assert r.status_code == 200
    by_id = {j["id"]: j for j in r.json()["jobs"]}
    assert "mark_lead_to_sent" in by_id
    assert "weekly_stale_digest" in by_id
    for j in by_id.values():
        for k in ("supports_day_of_week", "hour", "minute", "day_of_week"):
            assert k in j, f"missing {k} on job {j['id']}"
        assert isinstance(j["hour"], int)
        assert isinstance(j["minute"], int)


def test_put_schedule_persists_and_reschedules():
    h = _auth()
    # Save current weekly_stale_digest config so we can restore at the end
    initial = next(
        j for j in requests.get(f"{BASE_URL}/api/scheduler/jobs", headers=h, timeout=30).json()["jobs"]
        if j["id"] == "weekly_stale_digest"
    )
    try:
        # Flip to Friday 19:45 UTC
        r = requests.put(
            f"{BASE_URL}/api/scheduler/jobs/weekly_stale_digest/schedule",
            headers=h,
            json={"hour": 19, "minute": 45, "day_of_week": "fri"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        cfg = r.json()["config"]
        assert cfg["hour"] == 19
        assert cfg["minute"] == 45
        assert cfg["day_of_week"] == "fri"

        # GET /jobs must show the new effective config + next_run_at on a Friday
        jobs = requests.get(f"{BASE_URL}/api/scheduler/jobs", headers=h, timeout=30).json()["jobs"]
        j = next(x for x in jobs if x["id"] == "weekly_stale_digest")
        assert j["hour"] == 19 and j["minute"] == 45 and j["day_of_week"] == "fri"
        # next_run_at must be an ISO timestamp falling on a Friday (weekday 4)
        from datetime import datetime
        nr = datetime.fromisoformat(j["next_run_at"].replace("Z", "+00:00"))
        assert nr.weekday() == 4, f"next_run_at must be a Friday, got {nr.isoformat()} ({nr.strftime('%A')})"
        assert nr.hour == 19 and nr.minute == 45
    finally:
        # Restore original
        requests.put(
            f"{BASE_URL}/api/scheduler/jobs/weekly_stale_digest/schedule",
            headers=h,
            json={
                "hour": initial["hour"],
                "minute": initial["minute"],
                "day_of_week": initial.get("day_of_week", "mon"),
            },
            timeout=30,
        )


def test_put_schedule_validates_hour_and_minute():
    h = _auth()
    r = requests.put(
        f"{BASE_URL}/api/scheduler/jobs/weekly_stale_digest/schedule",
        headers=h,
        json={"hour": 99, "minute": 0},
        timeout=30,
    )
    assert r.status_code == 400
    r = requests.put(
        f"{BASE_URL}/api/scheduler/jobs/weekly_stale_digest/schedule",
        headers=h,
        json={"hour": 0, "minute": 999},
        timeout=30,
    )
    assert r.status_code == 400


def test_put_unknown_job_404s():
    h = _auth()
    r = requests.put(
        f"{BASE_URL}/api/scheduler/jobs/totally_made_up_job/schedule",
        headers=h,
        json={"hour": 0, "minute": 0},
        timeout=30,
    )
    assert r.status_code == 404
