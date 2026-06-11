"""Roofing CRM Backend API tests."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://roofing-crm-3.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@roofingcrm.com"
ADMIN_PASSWORD = "admin123"


# ---------- Fixtures ----------
@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    data = r.json()
    assert "access_token" in data
    assert data["user"]["email"] == ADMIN_EMAIL
    return data["access_token"]


@pytest.fixture(scope="session")
def auth_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


# ---------- Auth tests ----------
class TestAuth:
    def test_login_success(self):
        r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert "access_token" in d and d["token_type"] == "bearer"
        assert d["user"]["email"] == ADMIN_EMAIL

    def test_login_invalid(self):
        r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": "wrong"}, timeout=15)
        assert r.status_code == 401

    def test_register_and_login(self):
        email = f"TEST_user_{uuid.uuid4().hex[:8]}@example.com"
        r = requests.post(f"{API}/auth/register", json={"email": email, "password": "pass1234", "name": "Test User"}, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "access_token" in d
        assert d["user"]["email"] == email.lower()
        # duplicate
        r2 = requests.post(f"{API}/auth/register", json={"email": email, "password": "pass1234", "name": "Test User"}, timeout=15)
        assert r2.status_code == 400

    def test_me_requires_auth(self):
        r = requests.get(f"{API}/auth/me", timeout=15)
        assert r.status_code == 401

    def test_me_with_token(self, auth_headers):
        r = requests.get(f"{API}/auth/me", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["email"] == ADMIN_EMAIL


# ---------- Protected endpoints auth check ----------
class TestProtected:
    @pytest.mark.parametrize("path", ["/contacts", "/properties", "/deals", "/dashboard/summary", "/options"])
    def test_unauthorized(self, path):
        r = requests.get(f"{API}{path}", timeout=15)
        assert r.status_code == 401, f"{path} expected 401 got {r.status_code}"

    @pytest.mark.parametrize("path", ["/contacts", "/properties", "/deals", "/dashboard/summary", "/options"])
    def test_authorized(self, path, auth_headers):
        r = requests.get(f"{API}{path}", headers=auth_headers, timeout=15)
        assert r.status_code == 200, f"{path} expected 200 got {r.status_code}: {r.text}"


# ---------- Options ----------
class TestOptions:
    def test_options_counts(self, auth_headers):
        r = requests.get(f"{API}/options", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert len(d["lead_sources"]) == 7
        assert len(d["project_types"]) == 5
        assert len(d["roof_types"]) == 8
        assert len(d["deal_statuses"]) == 4


# ---------- Contacts CRUD ----------
class TestContacts:
    def test_create_billing_same(self, auth_headers):
        payload = {
            "contact_name": "TEST_John",
            "company_name": "Acme",
            "phone": "555-0001",
            "email": "john@acme.com",
            "address": "123 Main St",
            "billing_same_as_address": True,
            "billing_address": "ignored",
        }
        r = requests.post(f"{API}/contacts", headers=auth_headers, json=payload, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["billing_address"] == "123 Main St"
        cid = d["id"]
        # Persistence
        g = requests.get(f"{API}/contacts/{cid}", headers=auth_headers, timeout=15)
        assert g.status_code == 200
        assert g.json()["billing_address"] == "123 Main St"
        # Update with custom billing
        upd = {**payload, "billing_same_as_address": False, "billing_address": "PO Box 1"}
        r2 = requests.put(f"{API}/contacts/{cid}", headers=auth_headers, json=upd, timeout=15)
        assert r2.status_code == 200
        assert r2.json()["billing_address"] == "PO Box 1"
        # Delete
        r3 = requests.delete(f"{API}/contacts/{cid}", headers=auth_headers, timeout=15)
        assert r3.status_code == 200
        g2 = requests.get(f"{API}/contacts/{cid}", headers=auth_headers, timeout=15)
        assert g2.status_code == 404

    def test_list(self, auth_headers):
        r = requests.get(f"{API}/contacts", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# ---------- Properties CRUD ----------
class TestProperties:
    def test_crud_with_contact_link(self, auth_headers):
        # create contact
        c = requests.post(f"{API}/contacts", headers=auth_headers, json={"contact_name": "TEST_Owner"}, timeout=15).json()
        payload = {
            "property_name": "TEST_Warehouse A",
            "property_address": "1 Industrial Way",
            "property_contact_id": c["id"],
            "property_contact_name": "Owner Person",
            "property_contact_phone": "555-9000",
            "notes": "Flat roof",
        }
        r = requests.post(f"{API}/properties", headers=auth_headers, json=payload, timeout=15)
        assert r.status_code == 200, r.text
        p = r.json()
        assert p["property_contact_id"] == c["id"]
        pid = p["id"]
        # Update
        r2 = requests.put(f"{API}/properties/{pid}", headers=auth_headers, json={**payload, "property_name": "TEST_Updated"}, timeout=15)
        assert r2.status_code == 200
        assert r2.json()["property_name"] == "TEST_Updated"
        # List
        lst = requests.get(f"{API}/properties", headers=auth_headers, timeout=15)
        assert lst.status_code == 200
        assert any(x["id"] == pid for x in lst.json())
        # Delete
        d = requests.delete(f"{API}/properties/{pid}", headers=auth_headers, timeout=15)
        assert d.status_code == 200
        requests.delete(f"{API}/contacts/{c['id']}", headers=auth_headers, timeout=15)


# ---------- Deals + Dashboard ----------
class TestDealsAndDashboard:
    def test_deal_crud_and_dashboard(self, auth_headers):
        # snapshot dashboard
        d0 = requests.get(f"{API}/dashboard/summary", headers=auth_headers, timeout=15).json()

        won_payload = {
            "title": "TEST_Won Deal",
            "lead_source": "Referral",
            "project_type": "Re-roof",
            "current_roof_type": "TPO",
            "proposed_roof_type": "PVC",
            "proposal_option_1": 10000,
            "proposal_option_2": 12000,
            "proposal_option_3": 15000,
            "chosen_amount": 12000,
            "status": "Won",
            "materials_cost": 3000,
            "labor_cost": 2000,
            "subcontractor_cost": 1000,
            "other_expenses": 500,
        }
        lead_payload = {**won_payload, "title": "TEST_Lead Deal", "status": "Lead", "chosen_amount": 8000}

        r1 = requests.post(f"{API}/deals", headers=auth_headers, json=won_payload, timeout=15)
        assert r1.status_code == 200, r1.text
        won_id = r1.json()["id"]
        r2 = requests.post(f"{API}/deals", headers=auth_headers, json=lead_payload, timeout=15)
        assert r2.status_code == 200
        lead_id = r2.json()["id"]

        # Update
        upd = requests.put(f"{API}/deals/{lead_id}", headers=auth_headers, json={**lead_payload, "chosen_amount": 9000}, timeout=15)
        assert upd.status_code == 200
        assert upd.json()["chosen_amount"] == 9000

        d1 = requests.get(f"{API}/dashboard/summary", headers=auth_headers, timeout=15).json()
        assert d1["deals_count"] == d0["deals_count"] + 2
        assert d1["won_deals"] == d0["won_deals"] + 1
        assert d1["open_leads"] == d0["open_leads"] + 1
        # Won revenue includes 12000
        assert d1["won_revenue"] >= d0["won_revenue"] + 12000 - 0.01
        # Pipeline includes updated 9000
        assert d1["pipeline_revenue"] >= d0["pipeline_revenue"] + 9000 - 0.01
        # Total costs increased by 6500
        assert d1["total_costs"] >= d0["total_costs"] + 6500 - 0.01

        # Cleanup
        requests.delete(f"{API}/deals/{won_id}", headers=auth_headers, timeout=15)
        requests.delete(f"{API}/deals/{lead_id}", headers=auth_headers, timeout=15)
