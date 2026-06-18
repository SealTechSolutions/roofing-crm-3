"""Backend tests for per-category email routing + extended calendar mapping.

Covers:
- /api/settings/email-routing GET/PUT (admin only)
- email_routing.get_from_for_category fallback to env aliases
- email_sender.send_for_category resolves correct From header
- GoogleCalendarSettings now exposes scope/finance calendar ids; PUT/GET work
- deal_events.push_event_to_gcal calendar picker by event_type
- deal_events.send_due_reminders category picker by event_type
"""
import os
import sys
import asyncio
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://roofing-crm-3.preview.emergentagent.com").rstrip("/")
ADMIN = {"email": "darren@sealtechsolutions.co", "password": "admin123"}

sys.path.insert(0, "/app/backend")

# Load backend .env so MONGO_URL etc. are available for in-process tests
try:
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
except Exception:
    pass


# ---------- Fixtures ----------
@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json=ADMIN, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


# ---------- /api/settings/email-routing ----------
class TestEmailRoutingAPI:
    def test_get_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/settings/email-routing", timeout=15)
        assert r.status_code in (401, 403)

    def test_get_non_admin_forbidden(self):
        # Create a non-admin user, then try
        import uuid
        email = f"TEST_router_{uuid.uuid4().hex[:8]}@test.com"
        rr = requests.post(f"{BASE_URL}/api/auth/register",
                           json={"email": email, "password": "pass1234", "name": "T"}, timeout=15)
        if rr.status_code != 200:
            pytest.skip(f"register failed: {rr.status_code}")
        tok = rr.json()["access_token"]
        r = requests.get(f"{BASE_URL}/api/settings/email-routing",
                         headers={"Authorization": f"Bearer {tok}"}, timeout=15)
        assert r.status_code == 403

    def test_get_returns_expected_shape(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/settings/email-routing", headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        for k in ("saved", "resolved", "categories", "allowed_aliases"):
            assert k in data, f"missing {k}"
        assert data["categories"] == ["assessments", "scope", "finance", "projects", "maintenance"]
        # All 5 role aliases + darren should be in allowed_aliases (env-driven)
        aliases_lower = {a.lower() for a in data["allowed_aliases"]}
        for cat in ("assessments", "scope", "finance", "projects", "maintenance"):
            assert f"{cat}@sealtechsolutions.co" in aliases_lower, f"missing alias for {cat}"
        assert "darren@sealtechsolutions.co" in aliases_lower

    def test_put_saves_and_persists(self, admin_headers):
        payload = {
            "assessments": "assessments@sealtechsolutions.co",
            "scope": "scope@sealtechsolutions.co",
            "finance": "finance@sealtechsolutions.co",
            "projects": "projects@sealtechsolutions.co",
            "maintenance": "maintenance@sealtechsolutions.co",
        }
        r = requests.put(f"{BASE_URL}/api/settings/email-routing",
                         headers=admin_headers, json=payload, timeout=15)
        assert r.status_code == 200, r.text
        saved = r.json()["saved"]
        for k, v in payload.items():
            assert saved[k] == v
        # GET should reflect
        r2 = requests.get(f"{BASE_URL}/api/settings/email-routing", headers=admin_headers, timeout=15)
        saved2 = r2.json()["saved"]
        for k, v in payload.items():
            assert saved2[k] == v

    def test_put_rejects_non_whitelisted_alias(self, admin_headers):
        r = requests.put(
            f"{BASE_URL}/api/settings/email-routing",
            headers=admin_headers,
            json={"finance": "evil@hacker.com"},
            timeout=15,
        )
        assert r.status_code == 400
        body = r.text
        assert "whitelist" in body.lower() or "GMAIL_FROM_ALIASES" in body or "alias" in body.lower()


# ---------- email_routing.get_from_for_category ----------
class TestRoutingHelpers:
    def test_get_from_for_category_returns_saved(self):
        async def go():
            from motor.motor_asyncio import AsyncIOMotorClient
            import email_routing as er
            client = AsyncIOMotorClient(os.environ["MONGO_URL"])
            db = client[os.environ["DB_NAME"]]
            v = await er.get_from_for_category(db, "scope")
            assert v == "scope@sealtechsolutions.co"
            v2 = await er.get_from_for_category(db, "finance")
            assert v2 == "finance@sealtechsolutions.co"

        asyncio.get_event_loop().run_until_complete(go())

    def test_get_from_for_category_env_fallback(self):
        """If a category has no saved value, falls back to matching env alias."""
        async def go():
            from motor.motor_asyncio import AsyncIOMotorClient
            import email_routing as er
            client = AsyncIOMotorClient(os.environ["MONGO_URL"])
            db = client[os.environ["DB_NAME"]]
            # Temporarily clear maintenance to verify env fallback
            await db.app_settings.update_one(
                {"_id": er.SETTINGS_DOC_ID},
                {"$set": {"maintenance": ""}},
                upsert=True,
            )
            v = await er.get_from_for_category(db, "maintenance")
            assert v == "maintenance@sealtechsolutions.co"
            # Restore
            await db.app_settings.update_one(
                {"_id": er.SETTINGS_DOC_ID},
                {"$set": {"maintenance": "maintenance@sealtechsolutions.co"}},
            )

        asyncio.get_event_loop().run_until_complete(go())


# ---------- email_sender.send_for_category sets correct From ----------
class TestSendForCategory:
    def test_send_for_category_resolves_from(self, monkeypatch):
        """Mock SMTP to capture the MIME message and verify From header."""
        async def go():
            from motor.motor_asyncio import AsyncIOMotorClient
            import email_sender

            captured = {}

            class FakeSMTP:
                def __init__(self, *a, **k): pass
                def __enter__(self): return self
                def __exit__(self, *a): pass
                def ehlo(self): pass
                def starttls(self, context=None): pass
                def login(self, *a, **k): pass
                def send_message(self, msg, from_addr=None, to_addrs=None):
                    captured["from_header"] = msg["From"]
                    captured["from_addr"] = from_addr
                    captured["message_id"] = msg["Message-ID"]

            monkeypatch.setattr(email_sender.smtplib, "SMTP", FakeSMTP)

            client = AsyncIOMotorClient(os.environ["MONGO_URL"])
            db = client[os.environ["DB_NAME"]]

            await email_sender.send_for_category(
                db, "scope",
                to="recipient@example.com",
                subject="Test scope",
                body_text="hi",
            )
            # From header should be scope@... (may be wrapped with display name)
            assert "scope@sealtechsolutions.co" in captured["from_header"]
            assert captured["from_addr"] == "scope@sealtechsolutions.co"
            assert "@sealtechsolutions.co" in captured["message_id"]

            await email_sender.send_for_category(
                db, "finance",
                to="recipient@example.com",
                subject="Test finance",
                body_text="hi",
            )
            assert "finance@sealtechsolutions.co" in captured["from_header"]

        asyncio.get_event_loop().run_until_complete(go())


# ---------- Google calendar settings expanded ----------
class TestGoogleCalendarSettings:
    def test_get_and_put_extended_fields(self, admin_headers):
        # GET status to read current settings
        r = requests.get(f"{BASE_URL}/api/integrations/google/status", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        settings = r.json()["settings"]
        # 5 calendar fields should be in the model
        for f in ("assessment_calendar_id", "scope_calendar_id", "finance_calendar_id",
                  "project_calendar_id", "maintenance_calendar_id"):
            assert f in settings, f"missing field {f}"

        # PUT scope + finance ids
        patch = {
            "scope_calendar_id": "scope_test_cal@group.calendar.google.com",
            "finance_calendar_id": "finance_test_cal@group.calendar.google.com",
        }
        r2 = requests.put(f"{BASE_URL}/api/integrations/google/settings",
                          headers=admin_headers, json=patch, timeout=15)
        assert r2.status_code == 200, r2.text
        data = r2.json()
        assert data["scope_calendar_id"] == patch["scope_calendar_id"]
        assert data["finance_calendar_id"] == patch["finance_calendar_id"]

        # GET reflects
        r3 = requests.get(f"{BASE_URL}/api/integrations/google/status", headers=admin_headers, timeout=15)
        s3 = r3.json()["settings"]
        assert s3["scope_calendar_id"] == patch["scope_calendar_id"]
        assert s3["finance_calendar_id"] == patch["finance_calendar_id"]


# ---------- deal_events push_event_to_gcal picks the right calendar ----------
class TestDealEventCalendarRouting:
    def test_push_event_picks_calendar_by_type(self):
        async def go():
            import deal_events
            import google_calendar as gcal

            calls = []

            class FakeSettings:
                enabled = True
                assessment_calendar_id = "ASSESS"
                scope_calendar_id = "SCOPE"
                finance_calendar_id = "FINANCE"
                project_calendar_id = "PROJECT"
                maintenance_calendar_id = "MAINT"

            async def fake_get_settings(_db, _uid):
                return FakeSettings()

            async def fake_upsert(_db, _uid, cal, _eid, _body):
                calls.append(cal)
                return "new_event_id"

            gcal.get_settings = fake_get_settings  # type: ignore
            gcal.upsert_event = fake_upsert  # type: ignore

            base = {"id": "e1", "deal_id": "d1", "date": "2026-01-30", "sync_to_google": True}

            class FakeColl:
                async def update_one(self, *a, **k): return None

            class FakeDB:
                deal_events = FakeColl()

            fake_db = FakeDB()

            for et, expected in [
                ("Roof Walk", "ASSESS"),
                ("Presentation", "SCOPE"),
                ("Meeting", "SCOPE"),
                ("Job Start", "PROJECT"),
                ("Other", "ASSESS"),
            ]:
                calls.clear()
                await deal_events.push_event_to_gcal(
                    db=fake_db,
                    user_id="u1",
                    event={**base, "event_type": et, "title": "x"},
                )
                assert calls and calls[0] == expected, f"{et}: expected {expected}, got {calls}"

        asyncio.get_event_loop().run_until_complete(go())


# ---------- deal_events.send_due_reminders category picker ----------
class TestDueReminderCategory:
    def test_reminder_category_mapping(self):
        """Inspect the category map embedded in the function via source."""
        import inspect
        from deal_events import send_due_reminders
        src = inspect.getsource(send_due_reminders)
        # Validate the mapping is present and correct
        assert '"Job Start":    "projects"' in src or '"Job Start": "projects"' in src
        assert '"Presentation": "scope"' in src
        assert '"Meeting":      "scope"' in src or '"Meeting": "scope"' in src
        assert '"Roof Walk":    "assessments"' in src or '"Roof Walk": "assessments"' in src
        assert '"Other":        "projects"' in src or '"Other": "projects"' in src


# ---------- Code inspection: send sites use categories ----------
class TestSendSiteCategoryRouting:
    """Verify each prior send_email call site is now category-routed."""
    def test_call_sites_use_categories(self):
        with open("/app/backend/server.py") as f:
            src = f.read()
        # scope email
        assert 'get_from_for_category(db, "projects")' in src  # PO route uses projects
        assert 'get_from_for_category(db, "finance")' in src   # invoice/statement
        # send_for_category usages (COI, daily-status, stale-deal digest, etc.)
        assert "send_for_category" in src
        # Count multiple usages
        assert src.count("send_for_category") >= 4

    def test_assessment_and_coi_modules_use_category(self):
        for path, expected in [
            ("/app/backend/assessment.py", '"assessments"'),
            ("/app/backend/coi_reminders.py", '"projects"'),
            ("/app/backend/scheduler.py", '"projects"'),  # daily-status cron
        ]:
            with open(path) as f:
                s = f.read()
            assert "send_for_category" in s, f"{path} missing send_for_category"
            assert expected in s, f"{path} missing category {expected}"
        # stale-deal digest in server.py uses 'scope'
        with open("/app/backend/server.py") as f:
            srv = f.read()
        assert 'send_for_category(\n                db, "scope"' in srv or 'db, "scope"' in srv
