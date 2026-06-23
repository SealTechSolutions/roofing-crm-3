"""
Iteration 35: Public Work Order Sign page backend tests.

Validates that the public anonymous endpoints used by /work-order/sign/:token
in the frontend return the expected payloads. Uses Darren's real production
token in READ-ONLY mode — we never POST /sign because that would consume the
signature on a live deal.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
PUBLIC_TOKEN = "070FFFHvx78zluNbD3jN6l18KeX3igpI"  # 3401 S Dexter, real, READ-ONLY


@pytest.fixture
def anon_client():
    s = requests.Session()
    # Explicitly no Authorization header — public endpoint
    return s


class TestPublicWorkOrderGet:
    """GET /api/work-order/{token} — anonymous JSON payload for the sign page."""

    def test_get_work_order_anonymous_returns_200(self, anon_client):
        r = anon_client.get(f"{BASE_URL}/api/work-order/{PUBLIC_TOKEN}", timeout=30)
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text[:300]}"

    def test_get_work_order_has_required_shape(self, anon_client):
        r = anon_client.get(f"{BASE_URL}/api/work-order/{PUBLIC_TOKEN}", timeout=30)
        assert r.status_code == 200
        j = r.json()
        # Required keys for the sign page to render
        assert "id" in j, f"missing 'id' in response: keys={list(j.keys())}"
        assert "fields" in j, f"missing 'fields' in response: keys={list(j.keys())}"
        assert "already_signed" in j, f"missing 'already_signed': keys={list(j.keys())}"
        assert j["already_signed"] is False, (
            f"Token has already been signed (already_signed={j['already_signed']}). "
            "The fix can no longer be re-verified with this token; ask main agent for a fresh one."
        )

    def test_get_work_order_project_name_matches_dexter(self, anon_client):
        r = anon_client.get(f"{BASE_URL}/api/work-order/{PUBLIC_TOKEN}", timeout=30)
        assert r.status_code == 200
        fields = r.json().get("fields", {})
        assert fields.get("project_name") == "3401 S. Dexter Street_Res", (
            f"Expected project_name='3401 S. Dexter Street_Res', got "
            f"{fields.get('project_name')!r}"
        )

    def test_get_work_order_has_summary_fields(self, anon_client):
        """The summary card on the sign page reads project_address, sub_company,
        and total — make sure those keys are present and total is numeric."""
        r = anon_client.get(f"{BASE_URL}/api/work-order/{PUBLIC_TOKEN}", timeout=30)
        assert r.status_code == 200
        fields = r.json().get("fields", {})
        for key in ("project_address", "sub_company", "total"):
            assert key in fields, f"missing fields.{key}; keys={list(fields.keys())}"
        # total should be numeric or numeric-parseable
        total = fields["total"]
        try:
            float(total)
        except (TypeError, ValueError):
            pytest.fail(f"fields.total is not numeric-parseable: {total!r}")


class TestPublicWorkOrderPdf:
    """GET /api/work-order/{token}/pdf — anonymous PDF download."""

    def test_get_pdf_anonymous_returns_200(self, anon_client):
        r = anon_client.get(f"{BASE_URL}/api/work-order/{PUBLIC_TOKEN}/pdf", timeout=60)
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text[:300]}"

    def test_get_pdf_content_type_is_pdf(self, anon_client):
        r = anon_client.get(f"{BASE_URL}/api/work-order/{PUBLIC_TOKEN}/pdf", timeout=60)
        assert r.status_code == 200
        ctype = r.headers.get("content-type", "")
        assert "application/pdf" in ctype.lower(), (
            f"Expected content-type=application/pdf, got {ctype!r}"
        )

    def test_get_pdf_body_starts_with_pdf_magic(self, anon_client):
        r = anon_client.get(f"{BASE_URL}/api/work-order/{PUBLIC_TOKEN}/pdf", timeout=60)
        assert r.status_code == 200
        assert r.content[:4] == b"%PDF", (
            f"PDF body does not start with %PDF magic; first 20 bytes: {r.content[:20]!r}"
        )
        assert len(r.content) > 1000, f"PDF suspiciously small: {len(r.content)} bytes"


class TestUnknownTokenHandled:
    """Sanity: a bogus token must not 500 — the sign page relies on a non-200
    to show 'Work order not found'."""

    def test_unknown_token_returns_4xx(self, anon_client):
        r = anon_client.get(f"{BASE_URL}/api/work-order/this-token-does-not-exist-xyz", timeout=30)
        assert 400 <= r.status_code < 500, (
            f"Unknown token should return 4xx, got {r.status_code}"
        )
