"""Tests for Construction Project / Other Construction Work custom-scope feature."""
import os
import io
import pytest
import requests
from urllib.parse import quote
from pypdf import PdfReader

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
ADMIN_EMAIL = "admin@roofingcrm.com"
ADMIN_PASSWORD = "admin123"


@pytest.fixture(scope="module")
def token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def headers(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def property_id(headers):
    r = requests.post(
        f"{BASE_URL}/api/properties",
        json={
            "property_name": "TEST_CustomScopeProp",
            "name": "TEST_CustomScopeProp",
            "address": "123 Construction Lane",
            "city": "Denver",
            "state": "CO",
            "zip_code": "80202",
            "total_sqft": 5000,
        },
        headers=headers,
        timeout=20,
    )
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


# ---------- 1. /api/options exposes new entries ----------
def test_options_lists_new_roof_types(headers):
    r = requests.get(f"{BASE_URL}/api/options", headers=headers, timeout=20)
    assert r.status_code == 200
    data = r.json()
    rt = data["roof_types"]
    crt = data["current_roof_types"]
    assert "Construction Project" in rt
    assert "Other" in rt
    # Spec: roof_types ENDS with 'Construction Project' then 'Other'
    assert rt[-2] == "Construction Project"
    assert rt[-1] == "Other"
    assert crt[-1] == "Other Construction Work"


# ---------- 2. /api/options/scope-preview ----------
def test_scope_preview_construction_project(headers):
    r = requests.get(
        f"{BASE_URL}/api/options/scope-preview?proposed={quote('Construction Project')}",
        headers=headers,
        timeout=20,
    )
    assert r.status_code == 200
    data = r.json()
    assert data["title"] == "PROJECT SCOPE"
    assert data["product_type"] == "Construction Project — Custom Scope"
    assert data["is_new_construction"] is False


def test_scope_preview_other(headers):
    r = requests.get(
        f"{BASE_URL}/api/options/scope-preview?proposed=Other",
        headers=headers,
        timeout=20,
    )
    assert r.status_code == 200
    data = r.json()
    assert data["title"] == "PROJECT SCOPE"
    assert data["product_type"] == "Construction Project — Custom Scope"


def test_scope_preview_with_existing_other_construction(headers):
    r = requests.get(
        f"{BASE_URL}/api/options/scope-preview"
        f"?proposed={quote('Construction Project')}"
        f"&current={quote('Other Construction Work')}",
        headers=headers,
        timeout=20,
    )
    assert r.status_code == 200
    data = r.json()
    assert data["title"] == "PROJECT SCOPE"
    # product_type may include an existing-type tag
    assert "Construction Project" in data["product_type"]
    assert "Custom Scope" in data["product_type"]


# ---------- 3. Deal CRUD with custom_scope ----------
def test_deal_custom_scope_roundtrip(headers, property_id):
    payload = {
        "title": "TEST_ConstructionDeal",
        "name": "TEST_ConstructionDeal",
        "property_id": property_id,
        "current_roof_type": "Other Construction Work",
        "proposed_roof_type": "Construction Project",
        "project_type": "Other",
        "custom_scope": "Pour new concrete slab.\nGrade subbase.\n\nInstall landscape borders.\nPlant trees.",
        "value": 50000,
    }
    r = requests.post(f"{BASE_URL}/api/deals", json=payload, headers=headers, timeout=20)
    assert r.status_code in (200, 201), r.text
    deal = r.json()
    deal_id = deal["id"]
    assert deal.get("custom_scope") == payload["custom_scope"]

    # GET round-trip
    r = requests.get(f"{BASE_URL}/api/deals/{deal_id}", headers=headers, timeout=20)
    assert r.status_code == 200
    fetched = r.json()
    assert fetched["custom_scope"] == payload["custom_scope"]
    assert fetched["proposed_roof_type"] == "Construction Project"
    assert fetched["current_roof_type"] == "Other Construction Work"

    # PUT update custom_scope (PUT requires full DealIn body)
    updated_scope = "Demolish existing patio.\n\nInstall new pavers.\nSeal joints."
    full_payload = {**payload, "custom_scope": updated_scope}
    r = requests.put(
        f"{BASE_URL}/api/deals/{deal_id}",
        json=full_payload,
        headers=headers,
        timeout=20,
    )
    assert r.status_code == 200, r.text
    assert r.json()["custom_scope"] == updated_scope

    r = requests.get(f"{BASE_URL}/api/deals/{deal_id}", headers=headers, timeout=20)
    assert r.json()["custom_scope"] == updated_scope

    return deal_id


# ---------- 4. PDF generation for Construction Project ----------
def _make_deal(headers, property_id, proposed, current="Other Construction Work", custom_scope=""):
    payload = {
        "title": f"TEST_PDFDeal_{proposed}_{custom_scope[:10]}",
        "name": f"TEST_PDFDeal_{proposed}_{custom_scope[:10]}",
        "property_id": property_id,
        "current_roof_type": current,
        "proposed_roof_type": proposed,
        "project_type": "Other",
        "custom_scope": custom_scope,
        "value": 25000,
    }
    r = requests.post(f"{BASE_URL}/api/deals", json=payload, headers=headers, timeout=20)
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


def _extract_pdf_text(pdf_bytes):
    reader = PdfReader(io.BytesIO(pdf_bytes))
    return [p.extract_text() or "" for p in reader.pages], len(reader.pages)


def test_pdf_construction_project(headers, property_id):
    scope = (
        "Excavate and pour new 4-inch reinforced concrete slab.\n"
        "Saw-cut control joints at 10-foot grid.\n\n"
        "Install metal flashing at building interface.\n"
        "Seal expansion joints with polyurethane sealant."
    )
    deal_id = _make_deal(headers, property_id, "Construction Project", custom_scope=scope)
    r = requests.get(f"{BASE_URL}/api/deals/{deal_id}/spec-sheet.pdf", headers=headers, timeout=30)
    assert r.status_code == 200, r.text[:300]
    assert r.headers.get("content-type", "").startswith("application/pdf")
    pages, count = _extract_pdf_text(r.content)
    assert count == 3, f"Expected 3 pages, got {count}"
    p1, p2, p3 = pages
    assert "PROJECT SCOPE" in p1
    assert "Construction Project" in p1 and "Custom Scope" in p1
    assert "Scope of Work" in p2
    assert "Project Requirements" in p2
    # bullets from scope text
    assert "Excavate" in p2
    assert "metal flashing" in p2.lower() or "Metal flashing" in p2
    # Terms on p3
    assert "TERMS" in p3.upper()


def test_pdf_other_proposed(headers, property_id):
    scope = "Landscape rework only.\nRemove old shrubs."
    deal_id = _make_deal(headers, property_id, "Other", custom_scope=scope)
    r = requests.get(f"{BASE_URL}/api/deals/{deal_id}/spec-sheet.pdf", headers=headers, timeout=30)
    assert r.status_code == 200
    pages, count = _extract_pdf_text(r.content)
    assert count == 3
    assert "PROJECT SCOPE" in pages[0]
    assert "Custom Scope" in pages[0]
    assert "Landscape" in pages[1]


def test_pdf_tpo_overlay_regression(headers, property_id):
    """A roofing deal with custom_scope set should STILL render the TPO scope, ignoring custom_scope."""
    deal_id = _make_deal(
        headers,
        property_id,
        "TPO Over-Lay",
        current="TPO",
        custom_scope="THIS SHOULD NOT APPEAR IN PDF",
    )
    r = requests.get(f"{BASE_URL}/api/deals/{deal_id}/spec-sheet.pdf", headers=headers, timeout=30)
    assert r.status_code == 200
    pages, count = _extract_pdf_text(r.content)
    assert count == 3
    full = "\n".join(pages)
    assert "TPO" in pages[0].upper()
    assert "PROJECT SCOPE" not in pages[0]
    assert "THIS SHOULD NOT APPEAR" not in full


# ---------- 5. _resolve_template short-circuit ----------
def test_resolve_template_short_circuits_construction():
    """Even if current=None (new construction), Construction Project/Other/etc must map to custom scope template."""
    from spec_sheet import _resolve_template, CUSTOM_SCOPE_TEMPLATE

    assert _resolve_template("Construction Project", "None (new construction)") is CUSTOM_SCOPE_TEMPLATE
    assert _resolve_template("Other", "None (new construction)") is CUSTOM_SCOPE_TEMPLATE
    # Note: current="Other Construction Work" is not treated as new construction, but template
    # should still resolve to custom when proposed is one of those.
    assert _resolve_template("Construction Project", "Other Construction Work") is CUSTOM_SCOPE_TEMPLATE
    # Sanity: TPO with new construction should NOT be custom
    assert _resolve_template("TPO", "None (new construction)") is not CUSTOM_SCOPE_TEMPLATE
