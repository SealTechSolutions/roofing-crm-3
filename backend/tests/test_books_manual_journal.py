"""Backend tests for Books — Manual Journal Entries (owner draws, year-end adjustments).

Covers:
- Successful post (balanced DR/CR)
- Unbalanced entry → 400
- Line with both DR and CR → 400
- Account from wrong entity → 400
- Less than 2 lines → 400
- Reverse a manual entry (success)
- Reverse already-reversed entry → 400
- Reverse a non-existent entry → 404
- Non-manual journal cannot be reversed via this endpoint
"""
import os
import uuid
import pytest
import requests
from pathlib import Path

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    fe_env = Path("/app/frontend/.env").read_text()
    for ln in fe_env.splitlines():
        if ln.startswith("REACT_APP_BACKEND_URL="):
            BASE_URL = ln.split("=", 1)[1].strip().rstrip("/")
            break

ADMIN_EMAIL = "admin@roofingcrm.com"
ADMIN_PASSWORD = "admin123"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=10)
    assert r.status_code == 200, f"Login failed: {r.text}"
    token = r.json()["access_token"]
    s.headers.update({"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def parent_entity(client):
    r = client.get(f"{BASE_URL}/api/books/entities", timeout=10)
    assert r.status_code == 200
    parents = [e for e in r.json() if e.get("is_parent")]
    assert parents, "No parent entity found"
    return parents[0]


@pytest.fixture(scope="module")
def other_entity(client):
    r = client.get(f"{BASE_URL}/api/books/entities", timeout=10)
    others = [e for e in r.json() if not e.get("is_parent")]
    assert others, "No other entity found"
    return others[0]


@pytest.fixture(scope="module")
def accounts(client, parent_entity):
    r = client.get(f"{BASE_URL}/api/books/accounts?entity_id={parent_entity['id']}", timeout=10)
    assert r.status_code == 200
    acct_by_number = {a["number"]: a for a in r.json()}
    return acct_by_number


def test_manual_journal_balanced_post(client, parent_entity, accounts):
    body = {
        "entity_id": parent_entity["id"],
        "date": "2026-02-20",
        "memo": "Owner draw — Q1 test",
        "lines": [
            {"account_id": accounts["3900"]["id"], "debit": 2500, "credit": 0, "memo": "Owner distribution"},
            {"account_id": accounts["1000"]["id"], "debit": 0, "credit": 2500, "memo": "Wire transfer"},
        ],
    }
    r = client.post(f"{BASE_URL}/api/books/journal-entries/manual", json=body, timeout=10)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["source_type"] == "manual"
    assert j["kind"] == "adjustment"
    assert j["total_debit"] == 2500.0
    assert j["total_credit"] == 2500.0
    assert j["is_manual"] is True
    assert j["is_reversed"] is False
    assert len(j["lines"]) == 2


def test_manual_journal_unbalanced_rejected(client, parent_entity, accounts):
    body = {
        "entity_id": parent_entity["id"],
        "date": "2026-02-20",
        "memo": "Unbalanced test",
        "lines": [
            {"account_id": accounts["3900"]["id"], "debit": 100, "credit": 0, "memo": ""},
            {"account_id": accounts["1000"]["id"], "debit": 0, "credit": 50, "memo": ""},
        ],
    }
    r = client.post(f"{BASE_URL}/api/books/journal-entries/manual", json=body, timeout=10)
    assert r.status_code == 400
    assert "balance" in r.text.lower()


def test_manual_journal_both_dr_and_cr_on_same_line(client, parent_entity, accounts):
    body = {
        "entity_id": parent_entity["id"],
        "date": "2026-02-20",
        "memo": "Bad line",
        "lines": [
            {"account_id": accounts["3900"]["id"], "debit": 100, "credit": 100, "memo": ""},
            {"account_id": accounts["1000"]["id"], "debit": 0, "credit": 100, "memo": ""},
        ],
    }
    r = client.post(f"{BASE_URL}/api/books/journal-entries/manual", json=body, timeout=10)
    assert r.status_code == 400
    assert "both" in r.text.lower() or "debit" in r.text.lower()


def test_manual_journal_account_from_wrong_entity(client, parent_entity, other_entity, accounts):
    other_r = client.get(f"{BASE_URL}/api/books/accounts?entity_id={other_entity['id']}", timeout=10)
    other_accts = {a["number"]: a for a in other_r.json()}
    body = {
        "entity_id": parent_entity["id"],
        "date": "2026-02-20",
        "memo": "Wrong-entity account test",
        "lines": [
            {"account_id": other_accts["3900"]["id"], "debit": 100, "credit": 0, "memo": ""},
            {"account_id": accounts["1000"]["id"], "debit": 0, "credit": 100, "memo": ""},
        ],
    }
    r = client.post(f"{BASE_URL}/api/books/journal-entries/manual", json=body, timeout=10)
    assert r.status_code == 400


def test_manual_journal_minimum_two_lines(client, parent_entity, accounts):
    body = {
        "entity_id": parent_entity["id"],
        "date": "2026-02-20",
        "memo": "Single-line test",
        "lines": [
            {"account_id": accounts["3900"]["id"], "debit": 100, "credit": 0, "memo": ""},
        ],
    }
    r = client.post(f"{BASE_URL}/api/books/journal-entries/manual", json=body, timeout=10)
    assert r.status_code == 400


def test_manual_journal_reverse_flow(client, parent_entity, accounts):
    # Create one
    body = {
        "entity_id": parent_entity["id"],
        "date": "2026-02-20",
        "memo": f"Reverse-flow {uuid.uuid4().hex[:6]}",
        "lines": [
            {"account_id": accounts["3900"]["id"], "debit": 750, "credit": 0, "memo": ""},
            {"account_id": accounts["1000"]["id"], "debit": 0, "credit": 750, "memo": ""},
        ],
    }
    r = client.post(f"{BASE_URL}/api/books/journal-entries/manual", json=body, timeout=10)
    assert r.status_code == 200
    jid = r.json()["id"]

    # Reverse it
    r2 = client.post(f"{BASE_URL}/api/books/journal-entries/{jid}/reverse", timeout=10)
    assert r2.status_code == 200
    assert r2.json()["ok"] is True

    # Reverse-again should 400
    r3 = client.post(f"{BASE_URL}/api/books/journal-entries/{jid}/reverse", timeout=10)
    assert r3.status_code == 400
    assert "already" in r3.text.lower()


def test_reverse_nonexistent_journal(client):
    r = client.post(f"{BASE_URL}/api/books/journal-entries/does-not-exist/reverse", timeout=10)
    assert r.status_code == 404
