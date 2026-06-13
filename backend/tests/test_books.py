"""Backend tests for SealTech Books Phase 1 — Entities + Chart of Accounts."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
if not BASE_URL:
    # fallback: load from frontend .env
    from pathlib import Path
    fe_env = Path('/app/frontend/.env').read_text()
    for ln in fe_env.splitlines():
        if ln.startswith('REACT_APP_BACKEND_URL='):
            BASE_URL = ln.split('=', 1)[1].strip().rstrip('/')
            break

ADMIN_EMAIL = "admin@roofingcrm.com"
ADMIN_PASSWORD = "admin123"

DEFAULT_ENTITY_NAMES = {
    "SealTech Holdings",
    "Western States Contracting Services",
    "SLO & Steady, LLC",
    "Darren Oliver, LLC",
}


@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=10)
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def client(admin_token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {admin_token}",
                      "Content-Type": "application/json"})
    return s


# ----- Entities -----
class TestEntities:
    def test_list_entities_seeded(self, client):
        r = client.get(f"{BASE_URL}/api/books/entities", timeout=10)
        assert r.status_code == 200
        ents = r.json()
        assert isinstance(ents, list)
        names = {e["name"] for e in ents}
        assert DEFAULT_ENTITY_NAMES.issubset(names), f"Missing default entities. Got: {names}"
        # No _id leak
        for e in ents:
            assert "_id" not in e
            assert "id" in e

    def test_parent_entity_flag(self, client):
        r = client.get(f"{BASE_URL}/api/books/entities", timeout=10)
        ents = r.json()
        parents = [e for e in ents if e.get("is_parent")]
        assert any(e["name"] == "SealTech Holdings" for e in parents)

    def test_create_entity_duplicate_guard(self, client):
        r = client.post(f"{BASE_URL}/api/books/entities",
                        json={"name": "SealTech Holdings"}, timeout=10)
        assert r.status_code == 400
        assert "already exists" in r.json().get("detail", "").lower()

    def test_create_and_seed_coa_for_new_entity(self, client):
        unique_name = f"TEST_QA_Entity_{uuid.uuid4().hex[:8]}"
        r = client.post(f"{BASE_URL}/api/books/entities",
                        json={"name": unique_name, "legal_name": f"{unique_name}, LLC",
                              "entity_type": "LLC", "role": "QA"}, timeout=10)
        assert r.status_code == 200, r.text
        created = r.json()
        assert created["name"] == unique_name
        assert "_id" not in created
        ent_id = created["id"]

        # Verify 44 default accounts seeded
        r2 = client.get(f"{BASE_URL}/api/books/accounts",
                        params={"entity_id": ent_id}, timeout=10)
        assert r2.status_code == 200
        accts = r2.json()
        assert len(accts) == 44, f"Expected 44 seeded accounts, got {len(accts)}"

        # Update entity
        r3 = client.put(f"{BASE_URL}/api/books/entities/{ent_id}",
                        json={"name": unique_name, "legal_name": "Updated Legal",
                              "tax_id": "12-3456789", "address": "1 Main St"}, timeout=10)
        assert r3.status_code == 200
        assert r3.json()["legal_name"] == "Updated Legal"

        # Cleanup — soft deactivate
        rd = client.delete(f"{BASE_URL}/api/books/entities/{ent_id}", timeout=10)
        assert rd.status_code == 200

    def test_cannot_delete_parent(self, client):
        r = client.get(f"{BASE_URL}/api/books/entities", timeout=10)
        parent = next(e for e in r.json() if e.get("is_parent"))
        rd = client.delete(f"{BASE_URL}/api/books/entities/{parent['id']}", timeout=10)
        assert rd.status_code == 400


# ----- Accounts -----
@pytest.fixture(scope="class")
def parent_entity_id(client):
    r = client.get(f"{BASE_URL}/api/books/entities", timeout=10)
    for e in r.json():
        if e["name"] == "SealTech Holdings":
            return e["id"]
    pytest.skip("Parent entity not found")


class TestAccounts:
    def test_44_accounts_per_default_entity(self, client):
        r = client.get(f"{BASE_URL}/api/books/entities", timeout=10)
        for e in r.json():
            if e["name"] not in DEFAULT_ENTITY_NAMES:
                continue
            r2 = client.get(f"{BASE_URL}/api/books/accounts",
                            params={"entity_id": e["id"]}, timeout=10)
            assert r2.status_code == 200
            accts = r2.json()
            assert len(accts) == 44, f"Entity {e['name']} has {len(accts)} accts, expected 44"
            # No _id leak
            for a in accts:
                assert "_id" not in a
            # Check SYSTEM and CONTRA flags present
            assert any(a.get("system") for a in accts), f"No system accounts on {e['name']}"
            assert any(a.get("is_contra") for a in accts), f"No contra accounts on {e['name']}"

    def test_account_types_endpoint(self, client):
        r = client.get(f"{BASE_URL}/api/books/account-types", timeout=10)
        assert r.status_code == 200
        types = r.json()["types"]
        assert set(types) == {"Asset", "Liability", "Equity", "Revenue", "COGS", "Expense", "Other"}

    def test_create_account_and_verify_persistence(self, client, parent_entity_id):
        num = f"99{uuid.uuid4().hex[:2]}"
        payload = {"entity_id": parent_entity_id, "number": num,
                   "name": "TEST_QA_Account", "type": "Expense", "category": "QA"}
        r = client.post(f"{BASE_URL}/api/books/accounts", json=payload, timeout=10)
        assert r.status_code == 200, r.text
        created = r.json()
        assert created["number"] == num
        assert created.get("system") is False
        assert "_id" not in created
        acct_id = created["id"]

        # Verify via list
        r2 = client.get(f"{BASE_URL}/api/books/accounts",
                        params={"entity_id": parent_entity_id}, timeout=10)
        assert any(a["id"] == acct_id for a in r2.json())

        # Duplicate guard
        r3 = client.post(f"{BASE_URL}/api/books/accounts", json=payload, timeout=10)
        assert r3.status_code == 400
        assert "already exists" in r3.json().get("detail", "").lower()

        # Update non-system account
        upd = {**payload, "name": "TEST_QA_Account_Updated", "category": "QA2"}
        r4 = client.put(f"{BASE_URL}/api/books/accounts/{acct_id}", json=upd, timeout=10)
        assert r4.status_code == 200
        assert r4.json()["name"] == "TEST_QA_Account_Updated"

        # Delete (soft)
        r5 = client.delete(f"{BASE_URL}/api/books/accounts/{acct_id}", timeout=10)
        assert r5.status_code == 200
        r6 = client.get(f"{BASE_URL}/api/books/accounts",
                        params={"entity_id": parent_entity_id}, timeout=10)
        assert not any(a["id"] == acct_id for a in r6.json())

    def test_system_account_cannot_be_deleted(self, client, parent_entity_id):
        r = client.get(f"{BASE_URL}/api/books/accounts",
                       params={"entity_id": parent_entity_id}, timeout=10)
        sys_acct = next(a for a in r.json() if a.get("system"))
        rd = client.delete(f"{BASE_URL}/api/books/accounts/{sys_acct['id']}", timeout=10)
        assert rd.status_code == 400
        assert "system" in rd.json().get("detail", "").lower()

    def test_system_account_locked_fields_on_update(self, client, parent_entity_id):
        r = client.get(f"{BASE_URL}/api/books/accounts",
                       params={"entity_id": parent_entity_id}, timeout=10)
        sys_acct = next(a for a in r.json() if a.get("system") and a["number"] == "1100")
        # Try to change number+type — server should ignore those but accept name+category
        upd = {"entity_id": parent_entity_id, "number": "9999", "name": "AR Renamed",
               "type": "Expense", "category": "Renamed"}
        r2 = client.put(f"{BASE_URL}/api/books/accounts/{sys_acct['id']}", json=upd, timeout=10)
        assert r2.status_code == 200
        result = r2.json()
        assert result["number"] == "1100", "number should be locked"
        assert result["type"] == "Asset", "type should be locked"
        assert result["name"] == "AR Renamed"
        assert result["category"] == "Renamed"

        # Restore
        client.put(f"{BASE_URL}/api/books/accounts/{sys_acct['id']}",
                   json={"entity_id": parent_entity_id, "number": "1100",
                         "name": "Accounts Receivable", "type": "Asset", "category": "AR"}, timeout=10)

    def test_unauthenticated_blocked(self):
        r = requests.get(f"{BASE_URL}/api/books/entities", timeout=10)
        assert r.status_code == 401
