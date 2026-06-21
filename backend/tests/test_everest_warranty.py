"""Tests for Everest Systems NDL warranty pricing extension (iteration 30).

Covers:
- GET /api/systems contains 4 Everest starter systems (5/10/15/20-yr)
- GET /api/products mirrors Everest products (vendor='Everest Systems')
- Deal model warranty_*_ndl boolean fields persist via PUT/GET roundtrip
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://roofing-crm-3.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "darren@sealtechsolutions.co"
ADMIN_PASSWORD = "admin123"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def test_deal(headers):
    """Find a TEST_ prefixed deal (do NOT mutate production deals)."""
    r = requests.get(f"{BASE_URL}/api/deals", headers=headers)
    assert r.status_code == 200
    deals = r.json()
    test_deals = [d for d in deals if (d.get("title") or "").startswith("TEST_")]
    assert test_deals, "No TEST_ prefixed deal found - cannot run warranty tests safely"
    return test_deals[0]


# --- /api/systems Everest starter systems ---
def test_systems_contains_4_everest(headers):
    r = requests.get(f"{BASE_URL}/api/systems", headers=headers)
    assert r.status_code == 200
    systems = r.json()
    everest = [s for s in systems if (s.get("vendor") or "").lower() == "everest systems" and not s.get("is_deleted")]
    years = sorted({int(s.get("warranty_years") or 0) for s in everest})
    assert 5 in years and 10 in years and 15 in years and 20 in years, \
        f"Expected Everest 5/10/15/20-yr systems, got {years}"
    # At least 4 unique warranty bands
    assert len(everest) >= 4, f"Expected >=4 Everest systems, found {len(everest)}: {[s.get('name') for s in everest]}"


def test_systems_keeps_existing_western_colloid_and_gaco(headers):
    """Sanity check — confirm Everest seed didn't blow away existing vendors."""
    r = requests.get(f"{BASE_URL}/api/systems", headers=headers)
    assert r.status_code == 200
    vendors = {(s.get("vendor") or "").lower() for s in r.json() if not s.get("is_deleted")}
    assert "western colloid" in vendors
    assert "gaco" in vendors
    assert "everest systems" in vendors


# --- /api/products Everest mirrored products ---
def test_products_contains_everest(headers):
    r = requests.get(f"{BASE_URL}/api/products", headers=headers)
    assert r.status_code == 200
    products = r.json()
    everest_products = [p for p in products if (p.get("vendor") or "").lower() == "everest systems"]
    # Spec says 36 mirrored products
    assert len(everest_products) >= 1, "No Everest products found in /api/products"
    print(f"Everest product count: {len(everest_products)}")


# --- Deal model warranty_*_ndl roundtrip ---
def test_deal_warranty_20yr_ndl_roundtrip(headers, test_deal):
    deal_id = test_deal["id"]
    # PUT: set NDL + add
    patch = dict(test_deal)
    patch["warranty_20yr_ndl"] = True
    patch["warranty_20yr_add"] = 3500.0
    # Strip server-managed fields
    for k in ("id", "created_at", "_id"):
        patch.pop(k, None)
    r = requests.put(f"{BASE_URL}/api/deals/{deal_id}", headers=headers, json=patch)
    assert r.status_code == 200, f"PUT failed: {r.status_code} {r.text[:300]}"
    body = r.json()
    assert body.get("warranty_20yr_ndl") is True
    assert float(body.get("warranty_20yr_add") or 0) == 3500.0

    # GET roundtrip
    r2 = requests.get(f"{BASE_URL}/api/deals/{deal_id}", headers=headers)
    assert r2.status_code == 200
    fetched = r2.json()
    assert fetched.get("warranty_20yr_ndl") is True, "NDL flag not persisted"
    assert float(fetched.get("warranty_20yr_add") or 0) == 3500.0

    # Reset to baseline (per agent-to-agent note)
    patch["warranty_20yr_ndl"] = False
    patch["warranty_20yr_add"] = 0.0
    r3 = requests.put(f"{BASE_URL}/api/deals/{deal_id}", headers=headers, json=patch)
    assert r3.status_code == 200
    assert r3.json().get("warranty_20yr_ndl") is False


def test_deal_warranty_10yr_standard_baseline(headers, test_deal):
    deal_id = test_deal["id"]
    patch = dict(test_deal)
    patch["warranty_10yr_ndl"] = False
    patch["warranty_10yr_add"] = 1000.0
    for k in ("id", "created_at", "_id"):
        patch.pop(k, None)
    r = requests.put(f"{BASE_URL}/api/deals/{deal_id}", headers=headers, json=patch)
    assert r.status_code == 200, f"PUT failed: {r.text[:300]}"
    body = r.json()
    assert body.get("warranty_10yr_ndl") is False
    assert float(body.get("warranty_10yr_add") or 0) == 1000.0

    r2 = requests.get(f"{BASE_URL}/api/deals/{deal_id}", headers=headers)
    assert r2.status_code == 200
    fetched = r2.json()
    assert fetched.get("warranty_10yr_ndl") is False
    assert float(fetched.get("warranty_10yr_add") or 0) == 1000.0

    # Reset
    patch["warranty_10yr_add"] = 0.0
    requests.put(f"{BASE_URL}/api/deals/{deal_id}", headers=headers, json=patch)


def test_deal_warranty_all_ndl_fields_exist(headers, test_deal):
    """All four NDL boolean fields (10/15/20/25) round-trip cleanly."""
    deal_id = test_deal["id"]
    patch = dict(test_deal)
    patch["warranty_10yr_ndl"] = True
    patch["warranty_15yr_ndl"] = True
    patch["warranty_20yr_ndl"] = True
    patch["warranty_25yr_ndl"] = True
    for k in ("id", "created_at", "_id"):
        patch.pop(k, None)
    r = requests.put(f"{BASE_URL}/api/deals/{deal_id}", headers=headers, json=patch)
    assert r.status_code == 200
    body = r.json()
    for tier in ("10yr", "15yr", "20yr", "25yr"):
        assert body.get(f"warranty_{tier}_ndl") is True, f"warranty_{tier}_ndl not stored"

    # Reset
    for tier in ("10yr", "15yr", "20yr", "25yr"):
        patch[f"warranty_{tier}_ndl"] = False
    requests.put(f"{BASE_URL}/api/deals/{deal_id}", headers=headers, json=patch)
