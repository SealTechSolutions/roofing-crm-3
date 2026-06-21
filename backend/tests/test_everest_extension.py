"""Tests for Everest Systems extension — iteration 31.

Verifies the new NDL formula ($3,000 inspection + per-SF rate), Silkoxy EZ
starter recipes (5/10/15/20-yr), SESCO granules (5 colours), and product
catalog package_size heal.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
ADMIN_EMAIL = "darren@sealtechsolutions.co"
ADMIN_PASSWORD = "admin123"


@pytest.fixture(scope="module")
def headers():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, f"Login failed: {r.text}"
    return {"Authorization": f"Bearer {r.json()['access_token']}",
            "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def products(headers):
    r = requests.get(f"{BASE_URL}/api/products", headers=headers)
    assert r.status_code == 200
    return r.json()


@pytest.fixture(scope="module")
def systems(headers):
    r = requests.get(f"{BASE_URL}/api/systems", headers=headers)
    assert r.status_code == 200
    return r.json()


# ---------------- Products counts + heal ----------------

def test_products_36_everest(products):
    ev = [p for p in products if (p.get("vendor") or "").lower() == "everest systems"
          and not p.get("is_deleted")]
    assert len(ev) >= 36, f"Expected >= 36 Everest products, got {len(ev)}"


def test_products_5_sesco_granules(products):
    sesco = [p for p in products if (p.get("vendor") or "").upper() == "SESCO"
             and not p.get("is_deleted")]
    names_upper = " ".join((p.get("name") or "").upper() for p in sesco)
    assert len(sesco) >= 5, f"Expected >=5 SESCO products, got {len(sesco)}: {[p.get('name') for p in sesco]}"
    for needle in ("BUFF", "BROWN", "RAINBOW", "6/10 WHITE", "SNOW WHITE"):
        assert needle in names_upper, f"Missing SESCO colour: {needle}"


def test_products_existing_western_colloid_preserved(products):
    wc = [p for p in products if (p.get("vendor") or "").lower() == "western colloid"]
    assert len(wc) >= 1, "Western Colloid products gone after Everest seed!"


def test_silkoxy_ez_5gal_pail_package_size(products):
    pail = next((p for p in products
                 if (p.get("vendor") or "").lower() == "everest systems"
                 and "silkoxy ez" in (p.get("name") or "").lower()
                 and "5 gal pail" in (p.get("name") or "").lower()), None)
    assert pail is not None, "Silkoxy EZ 5 Gal Pail not found"
    assert float(pail.get("package_size") or 0) == 5.0, \
        f"package_size should be 5.0, got {pail.get('package_size')}"


def test_silkoxy_ez_55gal_drum_package_size(products):
    drum = next((p for p in products
                 if (p.get("vendor") or "").lower() == "everest systems"
                 and "silkoxy ez" in (p.get("name") or "").lower()
                 and "55 gal drum" in (p.get("name") or "").lower()), None)
    assert drum is not None, "Silkoxy EZ 55 Gal Drum not found"
    assert float(drum.get("package_size") or 0) == 55.0


def test_ecolevel_kit_package_sizes(products):
    kits = [p for p in products
            if (p.get("vendor") or "").lower() == "everest systems"
            and "ecolevel" in (p.get("name") or "").lower()]
    assert len(kits) >= 2, f"Need both EcoLevel kits, got {[k.get('name') for k in kits]}"
    by_name = {p["name"]: float(p.get("package_size") or 0) for p in kits}
    twohalf = next((v for k, v in by_name.items() if "2.5" in k), None)
    four = next((v for k, v in by_name.items() if "4 gallon" in k.lower()), None)
    assert twohalf == 2.5, f"EcoLevel 2.5 kit package_size: {twohalf}"
    assert four == 4.0, f"EcoLevel 4 kit package_size: {four}"


def test_roll_products_have_unit_roll(products):
    rolls = [p for p in products
             if (p.get("vendor") or "").lower() == "everest systems"
             and "roll" in ((p.get("unit") or "") + " " + (p.get("name") or "")).lower()
             and ("everstitch" in (p.get("name") or "").lower()
                  or "walk pad" in (p.get("name") or "").lower()
                  or "ever-tread" in (p.get("name") or "").lower())]
    assert rolls, "No roll-style Everest products found"
    for p in rolls:
        assert float(p.get("package_size") or 0) == 1.0, \
            f"{p['name']}: package_size should be 1.0, got {p.get('package_size')}"
        assert (p.get("unit") or "").lower() == "roll", \
            f"{p['name']}: unit should be 'roll', got {p.get('unit')}"


# ---------------- Systems + recipes ----------------

EXPECTED_RECIPE = {5: (1.5, 1), 10: (2.0, 1), 15: (2.5, 2), 20: (3.0, 2)}


@pytest.mark.parametrize("years", [5, 10, 15, 20])
def test_everest_starter_recipe(headers, systems, products, years):
    sys = next((s for s in systems
                if (s.get("vendor") or "").lower() == "everest systems"
                and int(s.get("warranty_years") or 0) == years
                and not s.get("is_deleted")), None)
    assert sys is not None, f"No Everest {years}-yr system"

    r = requests.get(f"{BASE_URL}/api/systems/{sys['id']}/recipe", headers=headers)
    assert r.status_code == 200, r.text
    rows = r.json()
    assert len(rows) >= 1, f"{years}-yr recipe is empty"
    row = rows[0]
    expected_rate, expected_layers = EXPECTED_RECIPE[years]
    assert row.get("coverage_basis") == "per_100sf", \
        f"{years}-yr coverage_basis={row.get('coverage_basis')}"
    assert float(row.get("coverage_rate") or 0) == expected_rate, \
        f"{years}-yr coverage_rate={row.get('coverage_rate')} (want {expected_rate})"
    assert int(row.get("layers") or 1) == expected_layers, \
        f"{years}-yr layers={row.get('layers')} (want {expected_layers})"

    # Anchor product must be Silkoxy EZ 5 Gal Pail
    pid = row.get("product_id")
    prod = next((p for p in products if p.get("id") == pid), None)
    assert prod is not None, f"recipe references unknown product {pid}"
    nm = (prod.get("name") or "").lower()
    assert "silkoxy ez" in nm and "5 gal pail" in nm, \
        f"{years}-yr anchor product: {prod.get('name')}"
