"""Tests for the Roof Asset Dashboard band system.

Validates:
  - assessment_bands module dispatch + thresholds
  - GET /api/assessments and /api/assessments/{id} include `bands` with the 8 keys
  - PDF generation does not crash with LayoutError and returns valid PDF bytes
  - Brand color #1D4ED8 is NOT used in printable backend files (except server.py:5006 calendar)
"""
import os
import re
import pathlib
import pytest
import requests

from assessment_bands import (
    band_for,
    all_bands,
    band_condition,
    band_remaining_service_life,
    band_capital_risk,
    band_warranty_status,
    band_restoration_suitability,
)

def _load_base_url():
    env = os.environ.get("REACT_APP_BACKEND_URL")
    if env:
        return env.rstrip("/")
    # fall back to frontend .env file (test runner doesn't auto-load it)
    fpath = pathlib.Path("/app/frontend/.env")
    if fpath.exists():
        for line in fpath.read_text().splitlines():
            if line.startswith("REACT_APP_BACKEND_URL="):
                return line.split("=", 1)[1].strip().rstrip("/")
    raise RuntimeError("REACT_APP_BACKEND_URL not set")


BASE_URL = _load_base_url()
SEED_ASSESSMENT_ID = "f96cf959-4e6b-4073-a21d-cb46ac71ad95"

EIGHT_KEYS = {
    "roof_asset_score",
    "condition_rating",
    "remaining_service_life",
    "restoration_suitability",
    "maintenance_status",
    "hail_resilience",
    "warranty_status",
    "capital_risk",
}


# ---------------- Unit tests on band module ----------------
class TestBandModule:
    def test_condition_good(self):
        b = band_condition(85)
        assert b["label"] == "Good"
        assert b["sublabel"] == "85/100"

    def test_condition_at_risk(self):
        b = band_condition(45)
        assert b["label"] == "At Risk"
        assert b["color"] == "#EA580C"

    def test_condition_excellent(self):
        assert band_condition(90)["label"] == "Excellent"

    def test_condition_critical(self):
        assert band_condition(20)["label"] == "Critical"

    def test_rsl_7_years(self):
        b = band_remaining_service_life(7)
        assert b["label"] == "7 Years"
        assert b["sublabel"] == "Remaining"

    def test_rsl_singular_year(self):
        assert band_remaining_service_life(1)["label"] == "1 Year"

    def test_capital_risk_high_red(self):
        b = band_capital_risk(85)
        assert b["label"] == "High"
        assert b["color"] == "#B91C1C"

    def test_capital_risk_low_green(self):
        b = band_capital_risk(10)
        assert b["label"] == "Low"
        assert b["color"] == "#16A34A"

    def test_warranty_zero_unknown(self):
        b = band_warranty_status(0)
        assert b["label"] == "—"
        assert b["sublabel"] == "Not Scored"

    def test_restoration_75_high(self):
        b = band_restoration_suitability(75)
        assert b["label"] == "High"

    def test_band_for_unknown_metric(self):
        b = band_for("not_a_metric", 50)
        assert b["label"] == "—"

    def test_all_bands_returns_eight(self):
        doc = {
            "condition_rating": {"score": 85},
            "remaining_service_life": {"score": 7},
            "capital_risk": {"score": 85},
        }
        out = all_bands(doc)
        assert set(out.keys()) == EIGHT_KEYS
        assert out["condition_rating"]["label"] == "Good"


# ---------------- API tests ----------------
@pytest.fixture(scope="session")
def auth_token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": "admin@roofingcrm.com", "password": "admin123"},
        timeout=15,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def auth_headers(auth_token):
    return {"Authorization": f"Bearer {auth_token}"}


class TestAssessmentsBandsAPI:
    def test_list_includes_bands(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/assessments", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        rows = r.json()
        assert isinstance(rows, list)
        assert len(rows) > 0
        for row in rows:
            assert "bands" in row, f"row {row.get('id')} missing bands"
            assert set(row["bands"].keys()) == EIGHT_KEYS
            for k, b in row["bands"].items():
                assert "label" in b and "color" in b and "sublabel" in b, f"{k} band malformed"

    def test_detail_includes_bands(self, auth_headers):
        r = requests.get(
            f"{BASE_URL}/api/assessments/{SEED_ASSESSMENT_ID}",
            headers=auth_headers,
            timeout=15,
        )
        assert r.status_code == 200
        doc = r.json()
        assert "bands" in doc
        assert set(doc["bands"].keys()) == EIGHT_KEYS

    def test_seed_assessment_band_values(self, auth_headers):
        """Seed has condition=50, RSL=25, restoration=100, capital_risk=10, hail=10, maintenance=20, warranty=0."""
        r = requests.get(
            f"{BASE_URL}/api/assessments/{SEED_ASSESSMENT_ID}",
            headers=auth_headers,
            timeout=15,
        )
        bands = r.json()["bands"]
        # condition 50 -> At Risk (>=40, <60)
        assert bands["condition_rating"]["label"] == "At Risk"
        # RSL 25 -> "25 Years" / "Remaining"
        assert bands["remaining_service_life"]["label"] == "25 Years"
        assert bands["remaining_service_life"]["sublabel"] == "Remaining"
        # restoration 100 -> High
        assert bands["restoration_suitability"]["label"] == "High"
        # capital_risk 10 -> Low (inverted, green)
        assert bands["capital_risk"]["label"] == "Low"
        assert bands["capital_risk"]["color"] == "#16A34A"
        # hail 10 -> Low (red, generic high/mod/low)
        assert bands["hail_resilience"]["label"] == "Low"
        # maintenance 20 -> Poor
        assert bands["maintenance_status"]["label"] == "Poor"
        # warranty 0 -> unknown
        assert bands["warranty_status"]["label"] == "—"


class TestAssessmentPDF:
    def test_pdf_renders_for_seed(self, auth_headers):
        """PDF must return 200 + start with %PDF and NOT crash with LayoutError."""
        url = f"{BASE_URL}/api/assessments/{SEED_ASSESSMENT_ID}/pdf"
        r = requests.get(url, headers=auth_headers, timeout=60)
        assert r.status_code == 200, f"PDF endpoint failed: {r.status_code} {r.text[:300]}"
        assert r.content[:4] == b"%PDF", "Response is not a valid PDF"
        assert len(r.content) > 5000, f"PDF suspiciously small: {len(r.content)} bytes"


# ---------------- Brand color sanity ----------------
class TestBrandColor:
    PRINTABLE_FILES = [
        "/app/backend/assessment_pdf.py",
        "/app/backend/invoice_pdf.py",
        "/app/backend/statement_pdf.py",
        "/app/backend/purchase_order_pdf.py",
        "/app/backend/spec_sheet.py",
        "/app/backend/period_close_pdf.py",
        "/app/backend/exports.py",
        "/app/backend/coi_reminders.py",
    ]

    def test_printable_files_no_old_brand(self):
        offenders = []
        for path in self.PRINTABLE_FILES:
            p = pathlib.Path(path)
            if not p.exists():
                continue
            text = p.read_text()
            if "1D4ED8" in text or "1d4ed8" in text:
                offenders.append(path)
        assert not offenders, f"Old brand color #1D4ED8 still present in: {offenders}"

    def test_printable_files_use_new_brand(self):
        # At least one of the canonical PDF files must use #062B67.
        good = []
        for path in ["/app/backend/assessment_pdf.py", "/app/backend/invoice_pdf.py", "/app/backend/statement_pdf.py"]:
            p = pathlib.Path(path)
            if p.exists() and "062B67" in p.read_text():
                good.append(path)
        assert good, "Expected #062B67 to appear in at least one printable PDF file"

    def test_server_py_calendar_blue_preserved(self):
        """server.py must still contain ONE occurrence of #1D4ED8 (calendar event color)."""
        text = pathlib.Path("/app/backend/server.py").read_text()
        # Case-insensitive count
        count = len(re.findall(r"#1[dD]4[eE][dD]8", text))
        assert count == 1, f"Expected exactly 1 occurrence of #1D4ED8 in server.py, got {count}"
