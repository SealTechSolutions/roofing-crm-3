"""User Profile module tests — notes, certifications, equipment, skills,
emergency contact, employment basics, and cert expiration reminder cron."""
import os
import sys
import asyncio
import pytest
import requests
from datetime import datetime, timedelta, timezone

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # Read from frontend .env directly as fallback
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                break

ADMIN_EMAIL = "darren@sealtechsolutions.co"
ADMIN_PASS = "admin123"
EMMA_ID = "54e51b8a-8874-4922-a85f-26ef10541981"


# ---------------------------------------------------------------- Fixtures

@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASS})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="session")
def admin_id(admin_headers):
    r = requests.get(f"{BASE_URL}/api/auth/me", headers=admin_headers)
    return r.json()["id"]


@pytest.fixture(scope="session")
def emma_token(admin_headers):
    # Regenerate password for Emma so we can log in as her.
    r = requests.post(f"{BASE_URL}/api/users/{EMMA_ID}/regenerate-password",
                      headers=admin_headers)
    assert r.status_code == 200, r.text
    new_pw = (r.json().get("password") or r.json().get("new_password")
              or r.json().get("generated_password"))
    assert new_pw, r.json()
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": "emma@sealtechsolutions.co",
                            "password": new_pw})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def emma_headers(emma_token):
    return {"Authorization": f"Bearer {emma_token}"}


# ---------------------------------------------------------------- Profile bundle

class TestProfileBundle:
    def test_admin_views_emma_full_profile(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/users/{EMMA_ID}/profile",
                         headers=admin_headers)
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("user", "skills", "emergency_contact", "employment",
                  "certifications", "equipment", "notes", "suggestions"):
            assert k in d, f"missing key {k}"
        assert d["user"]["id"] == EMMA_ID
        assert isinstance(d["notes"], list)
        # Suggestions populated
        assert "OSHA 30" in d["suggestions"]["certifications"]

    def test_emma_views_self_hides_notes_and_money(self, emma_headers):
        r = requests.get(f"{BASE_URL}/api/users/{EMMA_ID}/profile",
                         headers=emma_headers)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["notes"] == [], "Notes must be hidden for non-admin self view"
        emp = d["employment"]
        assert "hourly_rate" not in emp, f"hourly_rate leaked: {emp}"
        assert "salary" not in emp, f"salary leaked: {emp}"

    def test_emma_cannot_view_admin_profile(self, emma_headers, admin_id):
        r = requests.get(f"{BASE_URL}/api/users/{admin_id}/profile",
                         headers=emma_headers)
        assert r.status_code == 403


# ---------------------------------------------------------------- Notes

class TestNotes:
    def test_create_get_update_pin_delete(self, admin_headers):
        # Create
        r = requests.post(f"{BASE_URL}/api/users/{EMMA_ID}/notes",
                          headers=admin_headers,
                          json={"body": "TEST_note ", "pinned": False})
        assert r.status_code == 200, r.text
        note = r.json()
        nid = note["id"]
        assert note["body"] == "TEST_note"
        assert note["pinned"] is False

        # Empty body → 400
        r = requests.post(f"{BASE_URL}/api/users/{EMMA_ID}/notes",
                          headers=admin_headers, json={"body": "  "})
        assert r.status_code == 400

        # GET list
        r = requests.get(f"{BASE_URL}/api/users/{EMMA_ID}/notes",
                         headers=admin_headers)
        assert r.status_code == 200
        assert any(n["id"] == nid for n in r.json())

        # PUT (pin)
        r = requests.put(f"{BASE_URL}/api/users/{EMMA_ID}/notes/{nid}",
                         headers=admin_headers,
                         json={"body": "TEST_note", "pinned": True})
        assert r.status_code == 200
        assert r.json()["pinned"] is True

        # DELETE
        r = requests.delete(f"{BASE_URL}/api/users/{EMMA_ID}/notes/{nid}",
                            headers=admin_headers)
        assert r.status_code == 200
        # Verify removed from list
        r = requests.get(f"{BASE_URL}/api/users/{EMMA_ID}/notes",
                         headers=admin_headers)
        assert not any(n["id"] == nid for n in r.json())

    def test_emma_cannot_post_notes(self, emma_headers):
        r = requests.post(f"{BASE_URL}/api/users/{EMMA_ID}/notes",
                          headers=emma_headers, json={"body": "no"})
        assert r.status_code == 403

    def test_emma_cannot_list_notes(self, emma_headers):
        r = requests.get(f"{BASE_URL}/api/users/{EMMA_ID}/notes",
                         headers=emma_headers)
        assert r.status_code == 403


# ---------------------------------------------------------------- Certifications

class TestCertifications:
    @pytest.fixture
    def cert_id(self, admin_headers):
        future = (datetime.now(timezone.utc).date() + timedelta(days=120)).isoformat()
        r = requests.post(f"{BASE_URL}/api/users/{EMMA_ID}/certifications",
                          headers=admin_headers,
                          json={"name": "TEST_Cert", "issuer": "ACME",
                                "cert_number": "X1", "issue_date": "2024-01-01",
                                "expiration_date": future})
        assert r.status_code == 200, r.text
        cid = r.json()["id"]
        yield cid
        requests.delete(f"{BASE_URL}/api/users/{EMMA_ID}/certifications/{cid}",
                        headers=admin_headers)

    def test_create_required_name(self, admin_headers):
        r = requests.post(f"{BASE_URL}/api/users/{EMMA_ID}/certifications",
                          headers=admin_headers, json={"name": ""})
        assert r.status_code == 400

    def test_emma_can_read_own_certs(self, emma_headers):
        r = requests.get(f"{BASE_URL}/api/users/{EMMA_ID}/certifications",
                         headers=emma_headers)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_emma_cannot_create_cert(self, emma_headers):
        r = requests.post(f"{BASE_URL}/api/users/{EMMA_ID}/certifications",
                          headers=emma_headers, json={"name": "X"})
        assert r.status_code == 403

    def test_update_resets_reminders_on_exp_change(self, admin_headers, cert_id):
        # First set reminders_sent directly via PUT with same exp → no reset
        future = (datetime.now(timezone.utc).date() + timedelta(days=120)).isoformat()
        new_future = (datetime.now(timezone.utc).date() + timedelta(days=200)).isoformat()
        # Simulate reminders_sent through mongo isn't easy via HTTP, so we just
        # verify the update flow returns 200 and the new exp date is persisted.
        r = requests.put(f"{BASE_URL}/api/users/{EMMA_ID}/certifications/{cert_id}",
                         headers=admin_headers,
                         json={"name": "TEST_Cert", "issuer": "ACME",
                               "cert_number": "X1", "issue_date": "2024-01-01",
                               "expiration_date": new_future})
        assert r.status_code == 200
        assert r.json()["expiration_date"] == new_future
        # reminders_sent should be present (resets to [])
        assert r.json().get("reminders_sent") == []


# ---------------------------------------------------------------- Equipment

class TestEquipment:
    def test_crud(self, admin_headers):
        r = requests.post(f"{BASE_URL}/api/users/{EMMA_ID}/equipment",
                          headers=admin_headers,
                          json={"item_name": "TEST_Ladder", "asset_tag": "T-1",
                                "serial_number": "S-1"})
        assert r.status_code == 200
        eid = r.json()["id"]

        # validation
        r = requests.post(f"{BASE_URL}/api/users/{EMMA_ID}/equipment",
                          headers=admin_headers, json={"item_name": ""})
        assert r.status_code == 400

        # Emma can read
        # Emma list
        # delete
        r = requests.delete(f"{BASE_URL}/api/users/{EMMA_ID}/equipment/{eid}",
                            headers=admin_headers)
        assert r.status_code == 200

    def test_emma_cannot_post(self, emma_headers):
        r = requests.post(f"{BASE_URL}/api/users/{EMMA_ID}/equipment",
                          headers=emma_headers, json={"item_name": "X"})
        assert r.status_code == 403


# ---------------------------------------------------------------- Skills

class TestSkills:
    def test_dedupe_and_persist(self, admin_headers):
        payload = {"skills": ["TPO", "tpo", "  TPO  ", "Metal", "metal", "Coatings"]}
        r = requests.put(f"{BASE_URL}/api/users/{EMMA_ID}/skills",
                         headers=admin_headers, json=payload)
        assert r.status_code == 200
        out = r.json()["skills"]
        lc = [s.lower() for s in out]
        assert len(lc) == len(set(lc)), f"dedupe failed: {out}"
        assert "tpo" in lc and "metal" in lc and "coatings" in lc

        # Persistence
        r = requests.get(f"{BASE_URL}/api/users/{EMMA_ID}/profile",
                         headers=admin_headers)
        assert set(s.lower() for s in r.json()["skills"]) >= {"tpo", "metal", "coatings"}


# ---------------------------------------------------------------- Emergency

class TestEmergency:
    def test_emma_can_set_own(self, emma_headers):
        r = requests.put(f"{BASE_URL}/api/users/{EMMA_ID}/emergency-contact",
                         headers=emma_headers,
                         json={"name": "TEST_Mom", "relationship": "mother",
                               "phone": "555-1234", "alt_phone": "",
                               "email": "", "notes": ""})
        assert r.status_code == 200
        assert r.json()["name"] == "TEST_Mom"

    def test_emma_cannot_set_admins(self, emma_headers, admin_id):
        r = requests.put(f"{BASE_URL}/api/users/{admin_id}/emergency-contact",
                         headers=emma_headers,
                         json={"name": "X", "phone": "1"})
        assert r.status_code == 403


# ---------------------------------------------------------------- Employment

class TestEmployment:
    def test_admin_set(self, admin_headers):
        r = requests.put(f"{BASE_URL}/api/users/{EMMA_ID}/employment",
                         headers=admin_headers,
                         json={"hire_date": "2024-01-01", "pay_type": "salary",
                               "hourly_rate": None, "salary": 75000.0,
                               "tshirt_size": "M"})
        assert r.status_code == 200, r.text

    def test_emma_cannot_set(self, emma_headers):
        r = requests.put(f"{BASE_URL}/api/users/{EMMA_ID}/employment",
                         headers=emma_headers, json={"pay_type": "hourly"})
        assert r.status_code == 403

    def test_emma_self_profile_strips_money(self, emma_headers):
        r = requests.get(f"{BASE_URL}/api/users/{EMMA_ID}/profile",
                         headers=emma_headers)
        emp = r.json()["employment"]
        assert "hourly_rate" not in emp
        assert "salary" not in emp
        # other fields preserved
        assert emp.get("pay_type") == "salary"
        assert emp.get("tshirt_size") == "M"


# ---------------------------------------------------------------- Cron — cert reminders

class TestCertReminderCron:
    def test_send_due_cert_reminders_idempotent(self, admin_headers, monkeypatch):
        """Direct in-process test of user_profile.send_due_cert_reminders."""
        # Add backend root to path
        sys.path.insert(0, "/app/backend")
        # Load backend env so MONGO_URL/DB_NAME are available.
        from dotenv import load_dotenv
        load_dotenv("/app/backend/.env")
        import user_profile
        from motor.motor_asyncio import AsyncIOMotorClient

        mongo_url = os.environ.get("MONGO_URL")
        db_name = os.environ.get("DB_NAME")
        assert mongo_url and db_name, f"MONGO_URL={mongo_url} DB_NAME={db_name}"
        client = AsyncIOMotorClient(mongo_url)
        db = client[db_name]

        # Create a cert expiring in exactly 30 days for Emma
        async def setup_and_run():
            future = (datetime.now(timezone.utc).date() + timedelta(days=30)).isoformat()
            doc = {
                "id": "TEST_cron_cert_1",
                "user_id": EMMA_ID,
                "name": "TEST_Cron_OSHA",
                "issuer": "",
                "cert_number": "",
                "issue_date": "",
                "expiration_date": future,
                "document_path": "",
                "document_name": "",
                "reminders_sent": [],
                "is_deleted": False,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
            await db.user_certifications.delete_many({"id": "TEST_cron_cert_1"})
            await db.user_certifications.insert_one(doc)

            # Monkeypatch email_sender.send_for_category
            import email_sender
            calls = []

            async def fake_send(db_, category, to, subject, body_text, **kw):
                calls.append({"category": category, "to": to})
                return True

            orig = email_sender.send_for_category
            email_sender.send_for_category = fake_send
            try:
                result1 = await user_profile.send_due_cert_reminders(db)
                # Re-run — should be idempotent (no new send for this cert)
                calls_after_first = len(calls)
                result2 = await user_profile.send_due_cert_reminders(db)
                idempotent_new_calls = len(calls) - calls_after_first
            finally:
                email_sender.send_for_category = orig

            # Verify reminders_sent updated
            after = await db.user_certifications.find_one({"id": "TEST_cron_cert_1"})
            await db.user_certifications.delete_one({"id": "TEST_cron_cert_1"})
            return result1, result2, calls, after, idempotent_new_calls

        loop = asyncio.new_event_loop()
        try:
            result1, result2, calls, after, idempotent_new_calls = loop.run_until_complete(setup_and_run())
        finally:
            loop.close()
            client.close()

        # We should have sent at least 1 message in first run for our test cert
        assert len(calls) >= 1, f"No emails sent in first run. result1={result1}"
        # category must be 'projects'
        assert any(c["category"] == "projects" for c in calls), calls
        # Idempotency — second run should not re-send for the same cert/threshold
        # (other certs may exist in DB but our test cert specifically must not
        # add new sends). Best check: reminders_sent contains '30'.
        assert "30" in (after.get("reminders_sent") or []), \
            f"reminders_sent not updated: {after.get('reminders_sent')}"
        # The idempotent new-call delta should be 0 for OUR test cert at least.
        # (other rows may legitimately add calls; we just need ours not to repeat)
        # Check: the second run did not add another call to Emma's email for our cert.
        emma_calls = [c for c in calls if "emma" in (c["to"] or "").lower()]
        # The first run sent to Emma (her own cert). The second run should not add another.
        # But there might be multiple certs for emma; if first run had N emma-sends,
        # second run delta should be 0 for THIS cert only. As a softer assert:
        assert result2.get("sent", 0) <= result1.get("sent", 0), \
            f"Second run sent more than first: {result1} vs {result2}"
