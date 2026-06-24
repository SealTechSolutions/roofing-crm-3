"""Iter 39 — End-to-end Metal spec-sheet test against the live API.

Logs in as Darren, flips TEST_Lead Deal to 'Metal Roof Restoration', fetches
the spec-sheet PDF, asserts content-type + bytes + pdfminer substrings, then
restores the deal's original proposed_roof_type at teardown.
"""
import os
import sys
import pytest
import requests
from io import BytesIO

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://roofing-crm-3.preview.emergentagent.com").rstrip("/")
DEAL_ID = "640a9104-0bd5-44dd-9f13-51e4b8cd2e4e"
ADMIN_EMAIL = "darren@sealtechsolutions.co"
ADMIN_PASSWORD = "admin123"


def _extract_pages(pdf_bytes: bytes) -> list[str]:
    from pdfminer.high_level import extract_text_to_fp
    from pdfminer.layout import LAParams
    out = BytesIO()
    extract_text_to_fp(BytesIO(pdf_bytes), out, laparams=LAParams(), output_type="text")
    return out.getvalue().decode("utf-8", errors="ignore").split("\f")


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    tok = r.json().get("access_token") or r.json().get("token")
    if tok:
        s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


@pytest.fixture(scope="module")
def deal_metal_setup(session):
    """Save original proposed_roof_type, set to Metal Roof Restoration, restore on teardown."""
    gd = session.get(f"{BASE_URL}/api/deals/{DEAL_ID}")
    assert gd.status_code == 200, f"GET deal failed: {gd.status_code}"
    deal = gd.json()
    original = deal.get("proposed_roof_type")

    # Update to metal — PUT requires full body; merge over existing deal payload.
    # Strip server-managed fields that the writable model rejects.
    payload = {k: v for k, v in deal.items() if k not in (
        "id", "created_at", "updated_at", "deal_number", "events", "scope_send_log"
    )}
    payload["proposed_roof_type"] = "Metal"
    up = session.put(f"{BASE_URL}/api/deals/{DEAL_ID}", json=payload)
    assert up.status_code in (200, 201), f"PUT deal failed: {up.status_code} {up.text[:300]}"

    # Verify
    verify = session.get(f"{BASE_URL}/api/deals/{DEAL_ID}").json()
    assert verify["proposed_roof_type"] == "Metal", \
        f"proposed_roof_type didn't update: {verify['proposed_roof_type']}"

    yield deal

    # Cleanup: restore original
    payload2 = {k: v for k, v in deal.items() if k not in (
        "id", "created_at", "updated_at", "deal_number", "events", "scope_send_log"
    )}
    payload2["proposed_roof_type"] = original
    session.put(f"{BASE_URL}/api/deals/{DEAL_ID}", json=payload2)
    after = session.get(f"{BASE_URL}/api/deals/{DEAL_ID}").json()
    assert after["proposed_roof_type"] == original, \
        f"Cleanup failed — proposed_roof_type is {after['proposed_roof_type']}, expected {original}"


def test_spec_sheet_endpoint_metal(session, deal_metal_setup):
    """GET /api/deals/{id}/spec-sheet.pdf must return 200 + application/pdf + %PDF."""
    r = session.get(f"{BASE_URL}/api/deals/{DEAL_ID}/spec-sheet.pdf")
    assert r.status_code == 200, f"Status {r.status_code}, body={r.text[:200]}"
    assert "application/pdf" in r.headers.get("content-type", "").lower(), \
        f"Content-type wrong: {r.headers.get('content-type')}"
    assert r.content[:4] == b"%PDF", f"Bad header: {r.content[:8]!r}"
    assert len(r.content) > 50_000, f"PDF too small: {len(r.content)} bytes"


def test_spec_sheet_pdf_metal_content(session, deal_metal_setup):
    """pdfminer text extraction must contain Darren's verbatim copy + headers.

    NOTE on layout: when the deal has no total_sqft + no cover photo, the long
    Inclusions bullets can overflow from PDF page 1 onto page 2, pushing the
    scope_1/scope_2 sections to page 3. The CONTENT is what's being validated
    here (substrings must exist somewhere in the rendered doc), not the page
    they land on. Layout flow is tracked separately as a design issue.
    """
    r = session.get(f"{BASE_URL}/api/deals/{DEAL_ID}/spec-sheet.pdf")
    assert r.status_code == 200
    pages = _extract_pages(r.content)
    assert len(pages) >= 2, f"Expected >=2 pages, got {len(pages)}"

    full = " ".join(p.replace("\n", " ") for p in pages)

    # ---- Page 1 (header + cover + Inclusions section) ----
    page1 = pages[0].replace("\n", " ")
    assert "METAL ROOF RESTORATION SCOPE" in page1, "Page 1 missing METAL title"
    assert "Cover photo placeholder" in page1, "Page 1 missing 'Cover photo placeholder'"
    assert "Inclusions" in page1, "Page 1 missing 'Inclusions' header"

    # Darren's verbatim Inclusions bullets (may overflow to page 2 — search full doc)
    assert "Furnish all labor, materials, equipment, supervision, safety measures" in full, \
        "Missing 'Furnish all labor...' Inclusions bullet"
    assert "Provide the standard manufacturer" in full, \
        "Missing 'Provide the standard manufacturer' Inclusions bullet"
    assert "elastomeric roof coating system over the existing" in full, \
        "Missing metal-specific Inclusions bullet body"

    # ---- Scope 1/Scope 2 (Page 2/3 depending on overflow) ----
    assert "Inspection and Repairs" in full, "Missing 'Inspection and Repairs' header"
    assert "Surface Prep and Roof System" in full, "Missing 'Surface Prep and Roof System' header"

    expected_substrings = [
        "Inspect all seams, fasteners, ridge caps",
        "Identify and document areas exhibiting rust",
        "Replace loose, failed, or backed-out fasteners with oversized fasteners equipped with neoprene sealing washers",
        "Repair or replace rusted, damaged, or perforated metal panels with matching gauge and profile",
        "Re-secure loose ridge caps, gable trim, eave metal, and gutter edge",
        "Pressure wash the entire roof surface to remove dirt, oxidation, chalking",
        "Prime all rusted areas with a rust-inhibitive metal primer",
        "Seal and reinforce all exposed fastener heads",
        "Apply a base coat of the selected acrylic or silicone elastomeric coating",
        "Apply a finish coat of the same selected acrylic or silicone elastomeric coating",
        "Perform a final quality-control inspection and project walkthrough",
    ]
    missing = [s for s in expected_substrings if s not in full]
    assert not missing, f"Missing expected substrings: {missing}"
