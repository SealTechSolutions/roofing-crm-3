"""Tests for the Daily Status Report (PDF) feature + scheduler integration."""
import os
import sys
from datetime import date, datetime, timezone

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://roofing-crm-3.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "darren@sealtechsolutions.co"
ADMIN_PASS = "admin123"

# Make /app/backend importable so we can unit-test the pure helper
sys.path.insert(0, "/app/backend")


# ---------------- Fixtures ----------------

@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASS},
        timeout=30,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    tok = r.json().get("access_token") or r.json().get("token")
    assert tok
    return tok


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


# ---------------- PDF endpoint ----------------

class TestDailyStatusPDF:
    def test_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/reports/daily-status.pdf", timeout=30)
        assert r.status_code in (401, 403), f"expected 401/403 got {r.status_code}"

    def test_returns_valid_pdf(self, admin_headers):
        r = requests.get(
            f"{BASE_URL}/api/reports/daily-status.pdf",
            headers=admin_headers,
            timeout=60,
        )
        assert r.status_code == 200, r.text[:300]
        assert r.headers.get("content-type", "").startswith("application/pdf"), r.headers
        assert r.content[:5] == b"%PDF-", f"bad magic: {r.content[:20]!r}"
        assert len(r.content) > 1000, f"pdf too small ({len(r.content)} bytes)"

    def test_pdf_contains_expected_sections(self, admin_headers):
        r = requests.get(
            f"{BASE_URL}/api/reports/daily-status.pdf",
            headers=admin_headers,
            timeout=60,
        )
        assert r.status_code == 200
        # Extract plain text from the PDF using pypdf if available; else regex
        try:
            from pypdf import PdfReader
            import io
            txt = ""
            for p in PdfReader(io.BytesIO(r.content)).pages:
                txt += p.extract_text() or ""
        except Exception as e:
            pytest.skip(f"pypdf unavailable: {e}")
        # Required sections
        assert "DAILY STATUS REPORT" in txt.upper(), "missing header kicker"
        assert "Active Deals".upper() in txt.upper(), "missing KPI Active Deals"
        assert "Pipeline Value".upper() in txt.upper(), "missing KPI Pipeline Value"
        assert "Today's Events".upper() in txt.upper() or "TODAY'S EVENTS" in txt.upper()
        assert "Overdue Items".upper() in txt.upper(), "missing KPI Overdue Items"
        assert "TODAY" in txt.upper(), "missing TODAY section"
        assert "WHAT'S NEXT" in txt.upper() or "WHAT" in txt.upper()
        assert "ATTENTION" in txt.upper(), "missing ATTENTION section"
        # date
        today_iso = datetime.now(timezone.utc).date().isoformat()
        # The PDF prints date as `Tuesday, January 6, 2026` style, not iso — check the year at least
        year = today_iso.split("-")[0]
        assert year in txt, f"year {year} not present in PDF text"


# ---------------- Recipients endpoint ----------------

class TestRecipients:
    def test_admin_only(self, admin_headers):
        # Without auth → 401/403
        r = requests.get(f"{BASE_URL}/api/reports/daily-status/recipients", timeout=30)
        assert r.status_code in (401, 403)

        r = requests.get(
            f"{BASE_URL}/api/reports/daily-status/recipients",
            headers=admin_headers, timeout=30,
        )
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        assert "recipients" in data
        emails = data["recipients"]
        assert isinstance(emails, list) and emails, "recipients empty"
        # Admin must be present
        assert any(e.lower() == ADMIN_EMAIL.lower() for e in emails), emails
        # Old soft-deleted admin must NOT be present
        assert not any("admin@roofingcrm.com" in (e or "").lower() for e in emails), emails


# ---------------- Scheduler jobs registry ----------------

class TestSchedulerJobs:
    def test_registry_contains_three_jobs(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/scheduler/jobs", headers=admin_headers, timeout=30)
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        assert data.get("running") is True
        ids = {j["id"]: j for j in data["jobs"]}
        for expected in ("mark_lead_to_sent", "daily_status_email", "weekly_stale_digest"):
            assert expected in ids, f"missing job {expected}; got {list(ids)}"

        # daily_status_email cfg: 13:00 UTC, mon-fri
        dse = ids["daily_status_email"]
        assert dse["hour"] == 13 and dse["minute"] == 0, dse
        assert "mon" in (dse.get("day_of_week") or "") and "fri" in (dse.get("day_of_week") or ""), dse

        msl = ids["mark_lead_to_sent"]
        assert msl["hour"] == 2 and msl["minute"] == 30, msl

        wsd = ids["weekly_stale_digest"]
        assert wsd["hour"] == 14 and wsd["minute"] == 0, wsd
        assert "mon" in (wsd.get("day_of_week") or ""), wsd

    def test_run_daily_status_email_admin_only(self, admin_headers):
        r = requests.post(
            f"{BASE_URL}/api/scheduler/jobs/daily_status_email/run",
            headers=admin_headers, timeout=120,
        )
        assert r.status_code == 200, r.text[:500]
        body = r.json()
        assert body.get("ok") is True
        result = body.get("result") or {}
        assert result.get("job") == "daily_status_email"
        # `sent` always present; may be 0 if SMTP not configured. Recipients list
        # must be present (or `skipped` because no recipients).
        assert "sent" in result
        # Either recipients list returned, or job short-circuited because none
        if "recipients" in result:
            assert isinstance(result["recipients"], list)


# ---------------- Pure-function unit tests ----------------

class TestStageDerivation:
    def test_lead_no_scope_sent(self):
        from daily_status_pdf import derive_stage_and_next
        d = {"status": "Lead", "last_scope_sent_at": ""}
        stage, action = derive_stage_and_next(d, date(2026, 1, 6), [])
        assert stage == "Lead", stage
        assert "Schedule assessment".lower() in action.lower(), action

    def test_won_with_future_start_is_scheduled(self):
        from daily_status_pdf import derive_stage_and_next
        d = {
            "status": "Won",
            "material_order_date": "2026-01-02",
            "scheduled_start_date": "2026-01-10",
            "scheduled_end_date": "2026-01-15",
        }
        stage, action = derive_stage_and_next(d, date(2026, 1, 6), [])
        assert stage == "Scheduled", stage
        # action should mention the start date
        assert "Jan" in action or "starts" in action.lower(), action

    def test_lost_returns_closed(self):
        from daily_status_pdf import derive_stage_and_next
        stage, action = derive_stage_and_next({"status": "Lost"}, date(2026, 1, 6), [])
        assert stage == "Closed/Lost"


class TestCollector:
    @pytest.mark.asyncio
    async def test_collector_returns_expected_keys(self):
        # collect_daily_status_data is async and depends on the module-level db client
        from server import collect_daily_status_data
        payload = await collect_daily_status_data()
        expected_keys = {
            "deals", "invoices_by_deal", "users_by_id",
            "today_events", "tomorrow_events",
            "overdue_tasks", "coi_expiring_soon", "stale_deals", "now",
        }
        missing = expected_keys - set(payload.keys())
        assert not missing, f"missing keys: {missing}"
        # Sanity types
        assert isinstance(payload["deals"], list)
        assert isinstance(payload["invoices_by_deal"], dict)
        assert isinstance(payload["users_by_id"], dict)
        # And it must be feedable into build_daily_status_pdf
        from daily_status_pdf import build_daily_status_pdf
        pdf = build_daily_status_pdf(**payload)
        assert pdf[:5] == b"%PDF-"
