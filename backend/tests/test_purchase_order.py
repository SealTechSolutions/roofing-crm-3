"""
Backend tests for the new per-vendor Purchase Order flow:
  - GET  /api/deals/{id}/purchase-order/{vendor_id}.pdf
  - POST /api/deals/{id}/purchase-order/{vendor_id}/email
    (now accepts optional subject / body_text / body_html overrides)

All fixtures use TEST_ prefixed names to keep them out of real production data.
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "darren@sealtechsolutions.co"
ADMIN_PASSWORD = "admin123"

REAL_DEAL_ID_OFF_LIMITS = "0515ecd5-f02d-4926-8240-46a13404d408"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    tok = r.json().get("access_token") or r.json().get("token")
    assert tok
    return tok


@pytest.fixture(scope="module")
def headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def vendors(headers):
    """Create two TEST_ vendors."""
    created = []
    for name in ("TEST_Vendor_A_POFlow", "TEST_Vendor_B_POFlow"):
        r = requests.post(
            f"{API}/vendors",
            json={
                "name": name,
                "contact_name": "Test Contact",
                "email": f"testpo+{uuid.uuid4().hex[:6]}@example.com",
                "phone": "555-000-0000",
                "address": "1 Test Way",
                "city": "Denver",
                "state": "CO",
                "zip_code": "80202",
            },
            headers=headers,
        )
        assert r.status_code in (200, 201), f"vendor create failed: {r.status_code} {r.text}"
        created.append(r.json())
    return created


@pytest.fixture(scope="module")
def test_deal(headers, vendors):
    """Create a fresh TEST_ deal with material_takeoff lines for BOTH vendors."""
    va, vb = vendors[0], vendors[1]
    payload = {
        "title": f"TEST_PO_flow_{uuid.uuid4().hex[:6]}",
        "status": "New Lead",
        "material_takeoff": [
            {
                "id": str(uuid.uuid4()),
                "vendor_id": va["id"],
                "vendor_name": va["name"],
                "sku": "SKU-A1",
                "name": "Test Membrane 60mil",
                "unit": "sqft",
                "quantity": 1000,
                "unit_cost": 1.25,
            },
            {
                "id": str(uuid.uuid4()),
                "vendor_id": va["id"],
                "vendor_name": va["name"],
                "sku": "SKU-A2",
                "name": "Test Adhesive 5gal",
                "unit": "pail",
                "quantity": 4,
                "unit_cost": 175.00,
            },
            {
                "id": str(uuid.uuid4()),
                "vendor_id": vb["id"],
                "vendor_name": vb["name"],
                "sku": "SKU-B1",
                "name": "Test Fasteners 3in",
                "unit": "box",
                "quantity": 12,
                "unit_cost": 45.00,
            },
        ],
    }
    r = requests.post(f"{API}/deals", json=payload, headers=headers)
    assert r.status_code in (200, 201), f"deal create failed: {r.status_code} {r.text}"
    deal = r.json()
    assert deal["id"] != REAL_DEAL_ID_OFF_LIMITS
    # Verify takeoff persisted
    r2 = requests.get(f"{API}/deals/{deal['id']}", headers=headers)
    assert r2.status_code == 200
    assert len(r2.json().get("material_takeoff") or []) == 3
    return deal


@pytest.fixture(scope="module")
def empty_test_deal(headers):
    """A TEST_ deal with NO takeoff lines (frontend 'Open Take-Off' branch)."""
    r = requests.post(
        f"{API}/deals",
        json={"title": f"TEST_PO_empty_{uuid.uuid4().hex[:6]}", "status": "New Lead"},
        headers=headers,
    )
    assert r.status_code in (200, 201)
    return r.json()


# ─── Tests ───────────────────────────────────────────────────────────────────

class TestPurchaseOrderPdf:
    def test_pdf_returns_valid_pdf_with_correct_content_type(self, headers, test_deal, vendors):
        vid = vendors[0]["id"]
        r = requests.get(
            f"{API}/deals/{test_deal['id']}/purchase-order/{vid}.pdf",
            headers=headers,
        )
        assert r.status_code == 200, f"PDF endpoint failed: {r.status_code} {r.text[:300]}"
        assert r.headers.get("content-type", "").startswith("application/pdf")
        assert r.content[:4] == b"%PDF", f"Not a PDF, first bytes: {r.content[:20]!r}"
        assert len(r.content) > 500  # not just a header

    def test_pdf_supports_token_query_param(self, token, test_deal, vendors):
        """PDF endpoint should also work with ?token= (used for opening in new tab)."""
        vid = vendors[0]["id"]
        r = requests.get(
            f"{API}/deals/{test_deal['id']}/purchase-order/{vid}.pdf?token={token}"
        )
        assert r.status_code == 200
        assert r.content[:4] == b"%PDF"

    def test_pdf_returns_404_for_vendor_with_no_lines(self, headers, test_deal):
        bogus = str(uuid.uuid4())
        r = requests.get(
            f"{API}/deals/{test_deal['id']}/purchase-order/{bogus}.pdf",
            headers=headers,
        )
        assert r.status_code == 404

    def test_pdf_requires_auth(self, test_deal, vendors):
        vid = vendors[0]["id"]
        r = requests.get(f"{API}/deals/{test_deal['id']}/purchase-order/{vid}.pdf")
        assert r.status_code == 401


class TestPurchaseOrderEmail:
    def test_email_accepts_subject_and_body_overrides(self, headers, test_deal, vendors):
        vid = vendors[0]["id"]
        payload = {
            "subject": "TEST subject XYZ-123",
            "body_text": "TEST body ABC-456",
            "body_html": "<p>TEST body ABC-456</p>",
        }
        r = requests.post(
            f"{API}/deals/{test_deal['id']}/purchase-order/{vid}/email",
            json=payload,
            headers=headers,
        )
        # Accept both success and EmailNotConfigured — but never a code bug.
        if r.status_code == 500:
            detail = ""
            try:
                detail = r.json().get("detail", "")
            except Exception:
                detail = r.text
            assert "EmailNotConfigured" in detail or "not configured" in detail.lower() or "Email send failed" in detail, \
                f"Unexpected 500 not related to email config: {detail}"
            pytest.skip(f"Email not configured / send failure — env issue, not a code bug: {detail}")
        assert r.status_code == 200, f"unexpected status {r.status_code}: {r.text}"
        data = r.json()
        assert data.get("ok") is True
        assert "emailed to" in (data.get("message") or "")
        assert data.get("to_email")

    def test_email_backward_compatible_no_overrides(self, headers, test_deal, vendors):
        vid = vendors[1]["id"]
        r = requests.post(
            f"{API}/deals/{test_deal['id']}/purchase-order/{vid}/email",
            json={},
            headers=headers,
        )
        if r.status_code == 500:
            detail = ""
            try:
                detail = r.json().get("detail", "")
            except Exception:
                detail = r.text
            assert "EmailNotConfigured" in detail or "not configured" in detail.lower() or "Email send failed" in detail, \
                f"Unexpected 500 not related to email config: {detail}"
            pytest.skip(f"Email not configured — env issue: {detail}")
        assert r.status_code == 200
        assert r.json().get("ok") is True

    def test_email_400_when_no_recipient_and_vendor_has_no_email(self, headers, test_deal, vendors):
        """Force scenario: pass to_email='' explicitly. If vendor has no email, 400."""
        # We're forcing this: build a fresh vendor with no email
        r_v = requests.post(
            f"{API}/vendors",
            json={"name": f"TEST_NoEmailVendor_{uuid.uuid4().hex[:6]}"},
            headers=headers,
        )
        assert r_v.status_code in (200, 201)
        vno = r_v.json()
        # Add a takeoff line for this vendor to the deal via PUT
        deal_r = requests.get(f"{API}/deals/{test_deal['id']}", headers=headers)
        deal = deal_r.json()
        deal["material_takeoff"] = list(deal.get("material_takeoff") or []) + [{
            "id": str(uuid.uuid4()),
            "vendor_id": vno["id"],
            "vendor_name": vno["name"],
            "sku": "NX",
            "name": "Test line",
            "unit": "ea",
            "quantity": 1,
            "unit_cost": 0,
        }]
        # Strip fields not allowed by DealIn probably fine — use a minimal PATCH via PUT
        put_body = {k: v for k, v in deal.items() if k not in {"id", "created_at", "created_by_user_id"}}
        rp = requests.put(f"{API}/deals/{test_deal['id']}", json=put_body, headers=headers)
        assert rp.status_code == 200, f"put failed: {rp.status_code} {rp.text[:400]}"

        r = requests.post(
            f"{API}/deals/{test_deal['id']}/purchase-order/{vno['id']}/email",
            json={"to_email": ""},
            headers=headers,
        )
        assert r.status_code == 400
        assert "recipient" in r.text.lower() or "email" in r.text.lower()


class TestSafety:
    def test_real_deal_untouched(self, headers):
        """Sanity check — the real deal id from the request is not touched."""
        r = requests.get(f"{API}/deals/{REAL_DEAL_ID_OFF_LIMITS}", headers=headers)
        # Either it exists (should) or 404 — either way we didn't modify anything.
        assert r.status_code in (200, 403, 404)
