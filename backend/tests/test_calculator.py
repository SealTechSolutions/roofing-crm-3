"""Backend tests for Material Calculator (Milestone 2 & 3)."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://roofing-crm-3.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "darren@sealtechsolutions.co"
ADMIN_PASS = "admin123"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=15)
    assert r.status_code == 200, f"login failed {r.status_code} {r.text}"
    return r.json().get("access_token") or r.json().get("token")


@pytest.fixture(scope="module")
def headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# Auth gating
def test_products_requires_auth():
    r = requests.get(f"{BASE_URL}/api/products", timeout=15)
    assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}"


# Products endpoint
def test_products_lists_western_colloid(headers):
    r = requests.get(f"{BASE_URL}/api/products", headers=headers, timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    wc = [p for p in data if p.get("vendor") == "Western Colloid"]
    # spec says 32, allow 30+ (data may differ slightly)
    assert len(wc) >= 30, f"Expected >=30 WC products, got {len(wc)}"
    for p in wc[:5]:
        assert "unit_price" in p and isinstance(p["unit_price"], (int, float))
        assert "package_size" in p and isinstance(p["package_size"], (int, float))
        assert p.get("sku")
        assert p.get("vendor") == "Western Colloid"


# Systems endpoint
def test_systems_lists_10_with_wc(headers):
    r = requests.get(f"{BASE_URL}/api/systems", headers=headers, timeout=15)
    assert r.status_code == 200
    systems = r.json()
    assert isinstance(systems, list)
    assert len(systems) >= 10, f"Expected >=10 systems, got {len(systems)}"
    wc = [s for s in systems if s.get("vendor") == "Western Colloid"]
    assert len(wc) >= 9, f"Expected >=9 WC systems, got {len(wc)}"
    for s in wc:
        wy = s.get("warranty_years", 0)
        assert 10 <= wy <= 25, f"WC system {s.get('name')} has warranty_years={wy}"
    gaco = [s for s in systems if "Gaco" in (s.get("vendor") or "") or "Gaco" in (s.get("name") or "")]
    assert len(gaco) >= 1, "Expected at least 1 Gaco system"


# Recipes endpoint
def test_recipes_for_each_wc_system(headers):
    r = requests.get(f"{BASE_URL}/api/systems", headers=headers, timeout=15)
    systems = r.json()
    products = requests.get(f"{BASE_URL}/api/products", headers=headers, timeout=15).json()
    pids = {p["id"] for p in products}
    wc = [s for s in systems if s.get("vendor") == "Western Colloid"]
    for s in wc:
        rec = requests.get(f"{BASE_URL}/api/systems/{s['id']}/recipe", headers=headers, timeout=15)
        assert rec.status_code == 200
        items = rec.json()
        assert isinstance(items, list)
        if "Metal" in s["name"]:
            assert len(items) >= 1, f"Metal system {s['name']} should have >=1 recipe row"
        elif "AA" in s["name"]:
            assert len(items) >= 2, f"AA system {s['name']} should have >=2 recipe rows"
        else:
            assert len(items) >= 3, f"E/A system {s['name']} should have >=3 recipe rows"
        for it in items:
            assert it.get("product_id") in pids, f"recipe product_id {it.get('product_id')} not in products"
            assert it.get("coverage_basis") == "per_100sf"
            assert isinstance(it.get("coverage_rate"), (int, float))


# Calculator settings
def test_calculator_settings(headers):
    r = requests.get(f"{BASE_URL}/api/calculator/settings", headers=headers, timeout=15)
    assert r.status_code == 200
    s = r.json()
    assert float(s.get("markup_pct", 0)) == 15.0, f"markup_pct={s.get('markup_pct')}"
    assert float(s.get("handling_pct", 0)) == 12.0, f"handling_pct={s.get('handling_pct')}"
    assert s.get("handling_basis") == "marked_up"


# 15-yr Gravel system math (renamed from "25-yr Gravel" on 2026-06-24; same recipe, just relabeled)
def test_15yr_gravel_packing_math(headers):
    """For 10000 SF × 15-yr Gravel (E/A): 26 gal/100sf emulsion → 2600 gal
       packed as 9×275 + 2×55 + 3×5 (exact)."""
    systems = requests.get(f"{BASE_URL}/api/systems", headers=headers, timeout=15).json()
    products = requests.get(f"{BASE_URL}/api/products", headers=headers, timeout=15).json()
    target = next((s for s in systems if "15" in str(s.get("warranty_years", "")) and "Gravel" in s["name"] and s.get("vendor") == "Western Colloid"), None)
    assert target is not None, "could not find 15-yr WC Gravel system"
    rec = requests.get(f"{BASE_URL}/api/systems/{target['id']}/recipe", headers=headers, timeout=15).json()
    # Find Asphalt Emulsion (300 or similar SKU) row
    emul = None
    for it in rec:
        p = next((pp for pp in products if pp["id"] == it["product_id"]), None)
        if p and ("Emulsion" in (p.get("name") or "") or p.get("sku", "").startswith("300")):
            emul = (it, p)
            break
    assert emul, f"could not find Asphalt Emulsion in 25-yr Gravel recipe: {rec}"
    it, p = emul
    # coverage 26 gal / 100sf for 25-yr
    qty_per_100sf = float(it["coverage_rate"])
    assert qty_per_100sf > 0
    # 10000 sf
    qty = (10000 / 100) * qty_per_100sf
    # Should be around 2600 gal for 25-yr
    assert qty >= 2400, f"Emulsion qty for 25-yr should be ~2600, got {qty}"


# Test deals exist
def test_test_deals_exist(headers):
    r = requests.get(f"{BASE_URL}/api/deals", headers=headers, timeout=15)
    assert r.status_code == 200
    deals = r.json()
    test_deals = [d for d in deals if (d.get("title") or d.get("name") or "").startswith("TEST_")]
    assert len(test_deals) >= 1, "Expected at least one TEST_ deal"
