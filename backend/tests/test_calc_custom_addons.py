"""
Iter 38: Calculator Custom Add-Ons persistence + spec-sheet rendering tests.

Covers:
  1. PUT /api/deals/{id} round-trips `calc_custom_addons` field (Pydantic
     not stripping — the original failure mode).
  2. GET /api/deals/{id}/spec-sheet.pdf renders each {label, cost} as an
     Inclusions bullet on page 1.
  3. Empty list → no bullet, no crash.
  4. Rows with blank label OR cost==0 are silently filtered out.

Cleanup at end: clears calc_custom_addons on the sandbox deal.
"""

import io
import os
import re
import requests
import pytest
from pdfminer.high_level import extract_text


BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
DEAL_ID = "640a9104-0bd5-44dd-9f13-51e4b8cd2e4e"  # TEST_Lead Deal (sandbox)
ADMIN_EMAIL = "darren@sealtechsolutions.co"
ADMIN_PASSWORD = "admin123"

STRIP_KEYS = [
    "id", "created_at", "updated_at", "created_by",
    "materials_cost", "labor_cost", "subcontractor_cost", "other_expenses_total",
    "total_costs", "profit", "margin_pct", "is_deleted", "deleted_at", "deleted_by",
    "assigned_user_name", "primary_contact_name", "property_name",
]


@pytest.fixture(scope="module")
def token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    tok = r.json().get("access_token") or r.json().get("token")
    assert tok, f"no token: {r.json()}"
    return tok


@pytest.fixture(scope="module")
def auth_headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _get_deal(headers):
    r = requests.get(f"{BASE_URL}/api/deals/{DEAL_ID}", headers=headers, timeout=15)
    assert r.status_code == 200, f"get deal failed: {r.status_code} {r.text}"
    return r.json()


def _put_deal_with_addons(headers, addons):
    """PUT the deal, preserving all current fields, replacing only calc_custom_addons."""
    deal = _get_deal(headers)
    body = {k: v for k, v in deal.items() if k not in STRIP_KEYS}
    body["calc_custom_addons"] = addons
    r = requests.put(
        f"{BASE_URL}/api/deals/{DEAL_ID}",
        headers=headers,
        json=body,
        timeout=20,
    )
    assert r.status_code == 200, f"PUT failed: {r.status_code} {r.text}"
    return r.json()


def _fetch_spec_pdf_text(headers):
    r = requests.get(
        f"{BASE_URL}/api/deals/{DEAL_ID}/spec-sheet.pdf",
        headers=headers,
        timeout=30,
    )
    assert r.status_code == 200, f"spec PDF failed: {r.status_code} {r.text[:300]}"
    assert "application/pdf" in r.headers.get("content-type", "").lower(), (
        f"unexpected content-type: {r.headers.get('content-type')}"
    )
    text = extract_text(io.BytesIO(r.content))
    return text, r.content


# ---------------------------------------------------------------------------
# Test 1 — Pydantic round-trip
# ---------------------------------------------------------------------------
def test_put_deal_persists_calc_custom_addons(auth_headers):
    addons = [
        {"label": "Metal Flashing", "cost": 650},
        {"label": "Skylight curb", "cost": 425},
    ]
    put_response = _put_deal_with_addons(auth_headers, addons)
    assert "calc_custom_addons" in put_response, "field stripped from PUT response"
    assert put_response["calc_custom_addons"] == [
        {"label": "Metal Flashing", "cost": 650},
        {"label": "Skylight curb", "cost": 425},
    ], f"PUT echoed wrong value: {put_response['calc_custom_addons']}"

    # Re-fetch to confirm persistence
    fresh = _get_deal(auth_headers)
    assert fresh.get("calc_custom_addons") == [
        {"label": "Metal Flashing", "cost": 650},
        {"label": "Skylight curb", "cost": 425},
    ], f"GET returned wrong value: {fresh.get('calc_custom_addons')}"


# ---------------------------------------------------------------------------
# Test 2 — spec PDF renders bullets
# ---------------------------------------------------------------------------
def test_spec_sheet_pdf_renders_custom_addons(auth_headers):
    _put_deal_with_addons(auth_headers, [
        {"label": "Metal Flashing", "cost": 650},
        {"label": "Skylight curb", "cost": 425},
    ])
    text, _ = _fetch_spec_pdf_text(auth_headers)

    assert "Inclusions" in text, "Inclusions section missing"
    assert "Metal Flashing" in text, f"Metal Flashing bullet missing. Text excerpt: {text[:2000]}"
    assert "Skylight curb" in text, f"Skylight curb bullet missing. Text excerpt: {text[:2000]}"
    # Cost rendering — accept variants like $650.00 / $ 650.00 / 650.00 incl spacing
    assert re.search(r"650(?:\.00)?", text), "650 amount missing"
    assert re.search(r"425(?:\.00)?", text), "425 amount missing"


# ---------------------------------------------------------------------------
# Test 3 — empty list is safe
# ---------------------------------------------------------------------------
def test_empty_addons_list_renders_default_inclusions(auth_headers):
    _put_deal_with_addons(auth_headers, [])
    text, _ = _fetch_spec_pdf_text(auth_headers)

    assert "Inclusions" in text
    assert "Metal Flashing" not in text, "stale Metal Flashing bullet leaked"
    assert "Skylight curb" not in text, "stale Skylight curb bullet leaked"
    # Default 3 inclusion bullets should remain
    assert "Provide all labor" in text
    assert "warranty" in text.lower()


# ---------------------------------------------------------------------------
# Test 4 — filter invalid rows
# ---------------------------------------------------------------------------
def test_invalid_addon_rows_are_filtered(auth_headers):
    _put_deal_with_addons(auth_headers, [
        {"label": "", "cost": 500},          # blank label -> skip
        {"label": "Has Label", "cost": 0},   # zero cost   -> skip
        {"label": "Real Item", "cost": 100}, # valid       -> render
    ])
    text, _ = _fetch_spec_pdf_text(auth_headers)

    assert "Real Item" in text, "Real Item bullet missing"
    assert "Has Label" not in text, "zero-cost bullet leaked to PDF"
    # Bullet for the blank-label row would have form ' — $500.00 included.'
    # We assert the 500 cost is NOT printed in an inclusions context.
    assert "$500.00 included" not in text, "blank-label bullet leaked to PDF"


# ---------------------------------------------------------------------------
# Cleanup — wipe addons so next user sees a clean sandbox
# ---------------------------------------------------------------------------
def test_zzz_cleanup_clear_addons(auth_headers):
    _put_deal_with_addons(auth_headers, [])
    fresh = _get_deal(auth_headers)
    assert fresh.get("calc_custom_addons") in ([], None)
