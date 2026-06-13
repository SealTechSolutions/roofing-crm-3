"""Phase 3 tests — Journal Activity feed regression.

Validates /api/books/journal-entries endpoint behavior + entity-scoped filtering,
include_reversed flag, and end-to-end GL hook integration."""
import os
import uuid
import time
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
if not BASE_URL:
    from pathlib import Path
    for ln in Path('/app/frontend/.env').read_text().splitlines():
        if ln.startswith('REACT_APP_BACKEND_URL='):
            BASE_URL = ln.split('=', 1)[1].strip().rstrip('/')
            break

ADMIN_EMAIL = "admin@roofingcrm.com"
ADMIN_PASSWORD = "admin123"


@pytest.fixture(scope="session")
def client():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=10)
    assert r.status_code == 200, r.text
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {r.json()['access_token']}",
                      "Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def entities(client):
    r = client.get(f"{BASE_URL}/api/books/entities", timeout=10)
    assert r.status_code == 200
    data = r.json()
    assert len(data) >= 2
    return data


@pytest.fixture(scope="session")
def parent_entity(entities):
    for e in entities:
        if e.get("is_parent"):
            return e
    pytest.skip("No parent entity")


# Endpoint shape
class TestJournalEntriesEndpoint:
    def test_endpoint_returns_list(self, client, parent_entity):
        r = client.get(f"{BASE_URL}/api/books/journal-entries",
                       params={"entity_id": parent_entity["id"], "limit": 200}, timeout=10)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)

    def test_each_row_has_required_fields(self, client, parent_entity):
        # Create one invoice to ensure at least one row
        inv_body = {
            "entity_id": parent_entity["id"],
            "status": "Sent",
            "bill_to_name": "TEST_QA Phase3 Feed",
            "line_items": [{"description": "Feed test", "quantity": 1,
                            "unit_price": 1500, "amount": 1500}],
        }
        inv = client.post(f"{BASE_URL}/api/invoices", json=inv_body, timeout=15).json()
        try:
            r = client.get(f"{BASE_URL}/api/books/journal-entries",
                           params={"entity_id": parent_entity["id"], "limit": 200}, timeout=10)
            rows = r.json()
            mine = [x for x in rows if x.get("source_id") == inv["id"]]
            assert mine, "Issue journal not posted within request cycle"
            j = mine[0]
            for k in ("id", "entity_id", "date", "memo", "kind",
                      "lines", "total_debit", "total_credit",
                      "source_type", "source_id"):
                assert k in j, f"missing key {k}"
            assert j["kind"] == "issue"
            assert j["source_type"] == "invoice"
            assert isinstance(j["lines"], list) and len(j["lines"]) >= 2
            for ln in j["lines"]:
                assert "account_number" in ln and "account_name" in ln
                assert "debit" in ln and "credit" in ln
            assert "_id" not in j, "Mongo _id leaked"
        finally:
            client.delete(f"{BASE_URL}/api/invoices/{inv['id']}", timeout=10)

    def test_entity_scoping(self, client, entities, parent_entity):
        # Different entity should not include parent's rows
        others = [e for e in entities if not e.get("is_parent") and e.get("is_active", True)]
        if not others:
            pytest.skip("Need a non-parent entity")
        other = others[0]
        r = client.get(f"{BASE_URL}/api/books/journal-entries",
                       params={"entity_id": other["id"], "limit": 200}, timeout=10)
        assert r.status_code == 200
        for row in r.json():
            assert row["entity_id"] == other["id"], f"Row leaked from other entity: {row}"

    def test_include_reversed_flag(self, client, parent_entity):
        # Create + delete an invoice → creates a reversed journal
        inv_body = {
            "entity_id": parent_entity["id"],
            "status": "Sent",
            "bill_to_name": "TEST_QA Reversed",
            "line_items": [{"description": "Reverse me", "quantity": 1,
                            "unit_price": 777, "amount": 777}],
        }
        inv = client.post(f"{BASE_URL}/api/invoices", json=inv_body, timeout=15).json()
        client.delete(f"{BASE_URL}/api/invoices/{inv['id']}", timeout=10)

        # Default = excluded
        r_default = client.get(f"{BASE_URL}/api/books/journal-entries",
                               params={"entity_id": parent_entity["id"], "limit": 500},
                               timeout=10).json()
        active_ids = {x["source_id"] for x in r_default}
        assert inv["id"] not in active_ids

        # include_reversed=true → shows up
        r_all = client.get(f"{BASE_URL}/api/books/journal-entries",
                           params={"entity_id": parent_entity["id"],
                                   "limit": 500, "include_reversed": "true"},
                           timeout=10).json()
        rev = [x for x in r_all if x["source_id"] == inv["id"]]
        assert rev, "Reversed journals not returned with include_reversed=true"
        assert all(x.get("is_reversed") is True for x in rev)

    def test_sorted_by_date_desc(self, client, parent_entity):
        r = client.get(f"{BASE_URL}/api/books/journal-entries",
                       params={"entity_id": parent_entity["id"], "limit": 50}, timeout=10)
        rows = r.json()
        if len(rows) < 2:
            pytest.skip("Not enough rows to verify sort")
        dates = [x["date"] for x in rows]
        assert dates == sorted(dates, reverse=True), "Should be date desc"

    def test_e2e_invoice_creates_then_disappears_after_delete(self, client, parent_entity):
        inv_body = {
            "entity_id": parent_entity["id"],
            "status": "Sent",
            "bill_to_name": "TEST_QA E2E",
            "line_items": [{"description": "x", "quantity": 1, "unit_price": 999, "amount": 999}],
        }
        inv = client.post(f"{BASE_URL}/api/invoices", json=inv_body, timeout=15).json()
        time.sleep(0.5)
        active = client.get(f"{BASE_URL}/api/books/journal-entries",
                            params={"entity_id": parent_entity["id"], "limit": 500},
                            timeout=10).json()
        assert any(x["source_id"] == inv["id"] for x in active)

        client.delete(f"{BASE_URL}/api/invoices/{inv['id']}", timeout=10)
        active2 = client.get(f"{BASE_URL}/api/books/journal-entries",
                             params={"entity_id": parent_entity["id"], "limit": 500},
                             timeout=10).json()
        assert not any(x["source_id"] == inv["id"] for x in active2), \
            "Deleted invoice's journal should be hidden from default feed"
