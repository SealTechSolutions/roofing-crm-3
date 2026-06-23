"""
Iter 37: Verify the Calculator pulls total_sqft (parapet-inclusive) instead of property_sqft.
Backend-side verification: confirm the deal record for 3629 Crosshaven Ct has
total_sqft=7050 (= property_sqft 6500 + perimeter_lnft 550 * avg_parapet_height 1.0).
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
ADMIN_EMAIL = "darren@sealtechsolutions.co"
ADMIN_PASS = "admin123"
CROSSHAVEN_DEAL_ID = "eef534dd-869c-48e5-b5f8-24c190255b8d"
SANDBOX_DEAL_ID = "640a9104-0bd5-44dd-9f13-51e4b8cd2e4e"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASS})
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    return r.json().get("access_token") or r.json().get("token")


@pytest.fixture(scope="module")
def auth_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


# Calculator parapet sqft bug: deal must have total_sqft computed
def test_crosshaven_deal_has_total_sqft_7050(auth_headers):
    r = requests.get(f"{BASE_URL}/api/deals/{CROSSHAVEN_DEAL_ID}", headers=auth_headers)
    assert r.status_code == 200, f"GET deal failed: {r.status_code} {r.text}"
    data = r.json()
    assert data.get("property_sqft") == 6500.0, f"property_sqft={data.get('property_sqft')}"
    assert data.get("perimeter_lnft") == 550.0, f"perimeter_lnft={data.get('perimeter_lnft')}"
    assert data.get("avg_parapet_height") == 1.0, f"avg_parapet_height={data.get('avg_parapet_height')}"
    assert data.get("total_sqft") == 7050.0, f"total_sqft={data.get('total_sqft')} (expected 7050.0)"
    assert data.get("title") and "Crosshaven" in data.get("title"), f"title={data.get('title')}"


# Regression: sandbox deal still loads OK (whatever its sqft is)
def test_sandbox_deal_loads(auth_headers):
    r = requests.get(f"{BASE_URL}/api/deals/{SANDBOX_DEAL_ID}", headers=auth_headers)
    assert r.status_code == 200, f"GET sandbox deal failed: {r.status_code} {r.text}"
    data = r.json()
    # total_sqft must exist as a numeric field (could be 0 or computed)
    assert "total_sqft" in data, "total_sqft field missing from deal payload"
    print(f"Sandbox deal: total_sqft={data.get('total_sqft')}, "
          f"property_sqft={data.get('property_sqft')}, "
          f"perimeter_lnft={data.get('perimeter_lnft')}, "
          f"avg_parapet_height={data.get('avg_parapet_height')}, "
          f"title={data.get('title')}")
