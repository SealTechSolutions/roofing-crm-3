"""Backend tests for Project Calendar feature.

Covers:
- GET /api/calendar window filtering + event shape
- PUT /api/deals/{id}/schedule full + partial body
- POST /api/deals + GET /api/deals round-trip of new schedule fields
"""
import os
import time
import pytest
import requests

def _load_frontend_env():
    env_path = "/app/frontend/.env"
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL"):
                    return line.split("=", 1)[1].strip()
    return None

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or _load_frontend_env() or "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL not set"
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@roofingcrm.com"
ADMIN_PASSWORD = "admin123"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def auth(token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def seed_deal(auth):
    """Create a TEST_ deal with calendar date fields populated."""
    payload = {
        "title": f"TEST_Calendar Deal {int(time.time())}",
        "deal_type": "replacement",
        "stage": "scheduled",
        "scheduled_start_date": "2026-07-06",
        "scheduled_end_date": "2026-07-10",
        "material_order_date": "2026-07-02",
    }
    r = auth.post(f"{API}/deals", json=payload, timeout=30)
    assert r.status_code in (200, 201), f"create deal failed: {r.status_code} {r.text}"
    d = r.json()
    assert d.get("scheduled_start_date") == "2026-07-06"
    assert d.get("scheduled_end_date") == "2026-07-10"
    assert d.get("material_order_date") == "2026-07-02"
    deal_id = d["id"]
    yield deal_id
    # Cleanup
    auth.delete(f"{API}/deals/{deal_id}", timeout=15)


# --------------------------- model round-trip ---------------------------

class TestDealScheduleFields:
    def test_post_and_get_roundtrip(self, auth, seed_deal):
        r = auth.get(f"{API}/deals/{seed_deal}", timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["scheduled_start_date"] == "2026-07-06"
        assert d["scheduled_end_date"] == "2026-07-10"
        assert d["material_order_date"] == "2026-07-02"


# --------------------------- PUT /deals/{id}/schedule ---------------------------

class TestScheduleEndpoint:
    def test_full_body_update(self, auth, seed_deal):
        body = {
            "scheduled_start_date": "2026-07-13",
            "scheduled_end_date": "2026-07-17",
            "material_order_date": "2026-07-09",
        }
        r = auth.put(f"{API}/deals/{seed_deal}/schedule", json=body, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["scheduled_start_date"] == "2026-07-13"
        assert d["scheduled_end_date"] == "2026-07-17"
        assert d["material_order_date"] == "2026-07-09"
        # verify persisted via GET
        g = auth.get(f"{API}/deals/{seed_deal}", timeout=30).json()
        assert g["scheduled_start_date"] == "2026-07-13"

    def test_partial_body_only_material(self, auth, seed_deal):
        # First baseline so we know prior values
        baseline = auth.get(f"{API}/deals/{seed_deal}", timeout=30).json()
        start_before = baseline["scheduled_start_date"]
        end_before = baseline["scheduled_end_date"]

        r = auth.put(
            f"{API}/deals/{seed_deal}/schedule",
            json={"material_order_date": "2026-07-04"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["material_order_date"] == "2026-07-04"
        # Other fields must remain unchanged
        assert d["scheduled_start_date"] == start_before
        assert d["scheduled_end_date"] == end_before

    def test_partial_body_only_dates(self, auth, seed_deal):
        baseline = auth.get(f"{API}/deals/{seed_deal}", timeout=30).json()
        mo_before = baseline["material_order_date"]

        r = auth.put(
            f"{API}/deals/{seed_deal}/schedule",
            json={"scheduled_start_date": "2026-07-20", "scheduled_end_date": "2026-07-24"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["scheduled_start_date"] == "2026-07-20"
        assert d["scheduled_end_date"] == "2026-07-24"
        assert d["material_order_date"] == mo_before

    def test_schedule_unknown_deal_returns_404(self, auth):
        r = auth.put(
            f"{API}/deals/nonexistent-deal-id-xyz/schedule",
            json={"scheduled_start_date": "2026-07-01"},
            timeout=30,
        )
        assert r.status_code == 404


# --------------------------- GET /calendar ---------------------------

class TestCalendarFeed:
    def test_window_returns_events_list(self, auth, seed_deal):
        # First reset seed_deal back to a known July 2026 window for this test
        auth.put(
            f"{API}/deals/{seed_deal}/schedule",
            json={
                "scheduled_start_date": "2026-07-06",
                "scheduled_end_date": "2026-07-10",
                "material_order_date": "2026-07-02",
            },
            timeout=30,
        )
        r = auth.get(f"{API}/calendar", params={"start": "2026-07-01", "end": "2026-07-31"}, timeout=30)
        assert r.status_code == 200, r.text
        events = r.json()
        # endpoint may return list or {events: [...]}
        if isinstance(events, dict):
            events = events.get("events") or events.get("items") or []
        assert isinstance(events, list)
        # Find our project + material_order events for seed_deal
        project_evt = next((e for e in events if e.get("kind") == "project" and e.get("deal_id") == seed_deal), None)
        material_evt = next((e for e in events if e.get("kind") == "material_order" and e.get("deal_id") == seed_deal), None)
        assert project_evt is not None, f"no project event for seed_deal in {len(events)} events"
        assert material_evt is not None, "no material_order event for seed_deal"
        # Required fields on project event
        for k in ("id", "kind", "title", "start", "end", "color"):
            assert k in project_evt, f"missing field {k} on project event"
        assert project_evt["start"] == "2026-07-06"
        assert project_evt["end"] == "2026-07-10"
        assert project_evt["color"].lower().startswith("#")
        assert material_evt["start"] == "2026-07-02"

    def test_window_filter_excludes_out_of_range(self, auth, seed_deal):
        # Look at a window outside the seed_deal (March 2026) — should not contain our events
        r = auth.get(f"{API}/calendar", params={"start": "2026-03-01", "end": "2026-03-31"}, timeout=30)
        assert r.status_code == 200
        events = r.json()
        if isinstance(events, dict):
            events = events.get("events") or events.get("items") or []
        for e in events:
            if e.get("deal_id") == seed_deal and e.get("kind") in ("project", "material_order"):
                pytest.fail(f"seed_deal event leaked into March window: {e}")

    def test_event_kinds_are_valid(self, auth):
        # Wide window — ensure every event's kind is in the allowed set
        r = auth.get(f"{API}/calendar", params={"start": "2026-01-01", "end": "2026-12-31"}, timeout=30)
        assert r.status_code == 200
        events = r.json()
        if isinstance(events, dict):
            events = events.get("events") or events.get("items") or []
        allowed = {"project", "material_order", "maintenance", "coi_expiry", "invoice_due"}
        for e in events:
            assert e.get("kind") in allowed, f"unexpected kind={e.get('kind')} in event {e}"

    def test_missing_query_params_returns_422(self, auth):
        r = auth.get(f"{API}/calendar", timeout=30)
        assert r.status_code in (400, 422)

    def test_unauth_returns_401(self):
        r = requests.get(f"{API}/calendar", params={"start": "2026-07-01", "end": "2026-07-31"}, timeout=30)
        assert r.status_code in (401, 403)
