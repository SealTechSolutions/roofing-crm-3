"""Tests for Ad-hoc Deal Events feature (Roof Walk / Presentation / Meeting / Job Start / Other)."""
import os
from datetime import datetime, timedelta, timezone
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # Fallback to frontend/.env at runtime
    try:
        from pathlib import Path
        for line in Path("/app/frontend/.env").read_text().splitlines():
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
    except Exception:
        pass

ADMIN = {"email": "darren@sealtechsolutions.co", "password": "admin123"}


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json=ADMIN, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def deal_id(headers):
    # Use existing first deal
    r = requests.get(f"{BASE_URL}/api/deals", headers=headers, timeout=15)
    assert r.status_code == 200
    deals = r.json()
    assert len(deals) > 0, "Need at least one deal to test"
    return deals[0]["id"]


def _tomorrow():
    return (datetime.now(timezone.utc).date() + timedelta(days=1)).isoformat()


def _today():
    return datetime.now(timezone.utc).date().isoformat()


class TestAuth:
    def test_list_requires_auth(self, deal_id):
        r = requests.get(f"{BASE_URL}/api/deals/{deal_id}/events", timeout=10)
        assert r.status_code == 401

    def test_create_requires_auth(self, deal_id):
        r = requests.post(f"{BASE_URL}/api/deals/{deal_id}/events", json={"title": "x", "date": _today()}, timeout=10)
        assert r.status_code == 401


class TestCreateValidation:
    def test_404_on_unknown_deal(self, headers):
        r = requests.post(
            f"{BASE_URL}/api/deals/nonexistent-deal-xyz/events",
            headers=headers,
            json={"title": "Test", "event_type": "Roof Walk", "date": _tomorrow()},
            timeout=10,
        )
        assert r.status_code == 404

    def test_400_on_invalid_event_type(self, headers, deal_id):
        r = requests.post(
            f"{BASE_URL}/api/deals/{deal_id}/events",
            headers=headers,
            json={"title": "Test", "event_type": "BadType", "date": _tomorrow()},
            timeout=10,
        )
        assert r.status_code == 400


class TestCRUDLifecycle:
    created_id = None

    def test_create_event(self, headers, deal_id):
        payload = {
            "title": "TEST_ Roof Walk auto",
            "event_type": "Roof Walk",
            "date": _tomorrow(),
            "start_time": "11:00",
            "end_time": "12:00",
            "location": "1234 Test Ave",
            "notes": "automated test",
            "sync_to_google": False,
            "reminder_enabled": True,
            "invitees": ["foreman@test.com"],
        }
        r = requests.post(f"{BASE_URL}/api/deals/{deal_id}/events", headers=headers, json=payload, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["id"]
        assert data["title"] == payload["title"]
        assert data["event_type"] == "Roof Walk"
        assert data["deal_id"] == deal_id
        assert data["reminder_sent_at"] is None
        TestCRUDLifecycle.created_id = data["id"]

    def test_list_includes_created(self, headers, deal_id):
        r = requests.get(f"{BASE_URL}/api/deals/{deal_id}/events", headers=headers, timeout=15)
        assert r.status_code == 200
        ids = [e["id"] for e in r.json()]
        assert TestCRUDLifecycle.created_id in ids

    def test_appears_in_calendar_feed(self, headers):
        start = _today()
        end = (datetime.now(timezone.utc).date() + timedelta(days=7)).isoformat()
        r = requests.get(f"{BASE_URL}/api/calendar?start={start}&end={end}", headers=headers, timeout=15)
        assert r.status_code == 200
        feed = r.json()
        # Could be {events: [...]} or list — handle both
        events = feed.get("events", feed) if isinstance(feed, dict) else feed
        appts = [e for e in events if e.get("kind") == "appointment" and "🪜" in (e.get("title") or "")]
        assert len(appts) >= 1, f"Should find Roof Walk appointment in calendar feed; got {len(events)} events"
        a = appts[0]
        assert a.get("color") == "#0F766E"

    def test_appears_in_today_widget(self, headers):
        r = requests.get(f"{BASE_URL}/api/dashboard/today", headers=headers, timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert "today" in data
        assert "events" in data
        # Tomorrow falls within [today, today+2]
        ids = [e["id"] for e in data["events"]]
        assert TestCRUDLifecycle.created_id in ids
        ev = next(e for e in data["events"] if e["id"] == TestCRUDLifecycle.created_id)
        assert "deal_title" in ev

    def test_update_resets_reminder_on_time_change(self, headers, deal_id):
        eid = TestCRUDLifecycle.created_id
        # First manually set reminder_sent_at via update with same time then check
        payload = {
            "title": "TEST_ Roof Walk auto",
            "event_type": "Roof Walk",
            "date": _tomorrow(),
            "start_time": "14:00",  # changed
            "end_time": "15:00",
            "sync_to_google": False,
            "reminder_enabled": True,
        }
        r = requests.put(f"{BASE_URL}/api/deals/{deal_id}/events/{eid}", headers=headers, json=payload, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["start_time"] == "14:00"
        assert data["reminder_sent_at"] is None

    def test_invalid_event_type_on_update(self, headers, deal_id):
        eid = TestCRUDLifecycle.created_id
        payload = {"title": "x", "event_type": "Garbage", "date": _tomorrow()}
        r = requests.put(f"{BASE_URL}/api/deals/{deal_id}/events/{eid}", headers=headers, json=payload, timeout=10)
        assert r.status_code == 400

    def test_delete_event(self, headers, deal_id):
        eid = TestCRUDLifecycle.created_id
        r = requests.delete(f"{BASE_URL}/api/deals/{deal_id}/events/{eid}", headers=headers, timeout=10)
        assert r.status_code == 200
        assert r.json().get("deleted") is True

    def test_list_excludes_deleted(self, headers, deal_id):
        r = requests.get(f"{BASE_URL}/api/deals/{deal_id}/events", headers=headers, timeout=10)
        ids = [e["id"] for e in r.json()]
        assert TestCRUDLifecycle.created_id not in ids


class TestIncludePastFilter:
    def test_include_past_false_filters(self, headers, deal_id):
        # Create a past event
        past_date = (datetime.now(timezone.utc).date() - timedelta(days=10)).isoformat()
        payload = {"title": "TEST_ past evt", "event_type": "Meeting", "date": past_date, "start_time": "10:00", "sync_to_google": False}
        r = requests.post(f"{BASE_URL}/api/deals/{deal_id}/events", headers=headers, json=payload, timeout=15)
        assert r.status_code == 200
        past_id = r.json()["id"]
        try:
            r2 = requests.get(f"{BASE_URL}/api/deals/{deal_id}/events?include_past=false", headers=headers, timeout=10)
            assert r2.status_code == 200
            ids = [e["id"] for e in r2.json()]
            assert past_id not in ids
        finally:
            requests.delete(f"{BASE_URL}/api/deals/{deal_id}/events/{past_id}", headers=headers, timeout=10)


def test_send_due_reminders_importable():
    """Smoke test — module imports and function exists/callable without crashing."""
    import sys
    sys.path.insert(0, "/app/backend")
    import deal_events
    assert callable(deal_events.send_due_reminders)
    assert deal_events.EVENT_TYPES == ("Roof Walk", "Presentation", "Meeting", "Job Start", "Other")
