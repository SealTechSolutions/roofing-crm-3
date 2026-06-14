"""Backend tests for Recurring Journal Templates + Bulk CSV vendor-bill import.

Run with:
  cd /app/backend && python -m pytest tests/test_journal_templates_and_csv.py -v

These exercise the full HTTP surface area through `requests` against the live preview
URL — same path tests have used historically.
"""
import io
import os
import sys
import time
import uuid

import requests

API_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://roofing-crm-3.preview.emergentagent.com").rstrip("/")
API = f"{API_URL}/api"
ADMIN = {"email": "admin@roofingcrm.com", "password": "admin123"}


def _login() -> dict:
    r = requests.post(f"{API}/auth/login", json=ADMIN, timeout=15)
    r.raise_for_status()
    tok = r.json().get("access_token") or r.json().get("token")
    return {"Authorization": f"Bearer {tok}"}


def _entity_id(headers) -> str:
    r = requests.get(f"{API}/books/entities", headers=headers, timeout=15)
    r.raise_for_status()
    return r.json()[0]["id"]


def _accounts(headers, entity_id) -> list:
    r = requests.get(f"{API}/books/accounts?entity_id={entity_id}", headers=headers, timeout=15)
    r.raise_for_status()
    return r.json()


# ---------- Journal Templates ----------

def test_template_crud_lifecycle():
    h = _login()
    eid = _entity_id(h)
    accts = _accounts(h, eid)
    a_dist = next(a for a in accts if a["number"] == "3900")
    a_bank = next(a for a in accts if a["number"] == "1000")

    name = f"TEST_TPL_{uuid.uuid4().hex[:8]}"
    body = {
        "entity_id": eid,
        "name": name,
        "description": "Q-end owner draw",
        "default_memo": "Owner draw — quarter end",
        "lines": [
            {"account_id": a_dist["id"], "debit": 5000, "credit": 0, "memo": "Distribution"},
            {"account_id": a_bank["id"], "debit": 0, "credit": 5000, "memo": "From operating"},
        ],
    }
    r = requests.post(f"{API}/books/journal-templates", json=body, headers=h, timeout=15)
    assert r.status_code == 200, r.text
    tpl = r.json()
    tid = tpl["id"]
    assert tpl["name"] == name
    assert len(tpl["lines"]) == 2
    assert tpl["lines"][0]["account_number"] == "3900"  # snapshot taken
    assert tpl["lines"][0]["account_name"] == a_dist["name"]
    assert tpl["use_count"] == 0

    # Duplicate name should 400
    r2 = requests.post(f"{API}/books/journal-templates", json=body, headers=h, timeout=15)
    assert r2.status_code == 400

    # List
    r3 = requests.get(f"{API}/books/journal-templates?entity_id={eid}", headers=h, timeout=15)
    assert r3.status_code == 200
    assert any(t["id"] == tid for t in r3.json())

    # Mark used
    r4 = requests.post(f"{API}/books/journal-templates/{tid}/use", headers=h, timeout=15)
    assert r4.status_code == 200

    # Rename
    body2 = {**body, "name": name + "_renamed"}
    r5 = requests.put(f"{API}/books/journal-templates/{tid}", json=body2, headers=h, timeout=15)
    assert r5.status_code == 200
    assert r5.json()["name"] == name + "_renamed"
    assert r5.json()["use_count"] >= 1

    # Delete (soft)
    r6 = requests.delete(f"{API}/books/journal-templates/{tid}", headers=h, timeout=15)
    assert r6.status_code == 200

    # No longer in active list
    r7 = requests.get(f"{API}/books/journal-templates?entity_id={eid}", headers=h, timeout=15)
    assert all(t["id"] != tid for t in r7.json())


def test_template_validation():
    h = _login()
    eid = _entity_id(h)

    # Missing lines
    r = requests.post(f"{API}/books/journal-templates", json={"entity_id": eid, "name": "Empty Tpl", "lines": []}, headers=h, timeout=15)
    assert r.status_code == 400

    # Bad account
    r2 = requests.post(f"{API}/books/journal-templates", json={
        "entity_id": eid, "name": "Bad Acct Tpl",
        "lines": [{"account_id": "does-not-exist", "debit": 100, "credit": 0}, {"account_id": "also-fake", "debit": 0, "credit": 100}],
    }, headers=h, timeout=15)
    assert r2.status_code == 400


# ---------- Bulk CSV import ----------

def _csv_bytes(s: str) -> bytes:
    return s.encode("utf-8")


def test_csv_preview_header_error():
    h = _login()
    eid = _entity_id(h)
    csv_data = "foo,bar\n1,2\n"
    files = {"file": ("bad.csv", _csv_bytes(csv_data), "text/csv")}
    data = {"entity_id": eid}
    r = requests.post(f"{API}/vendor-bills/csv-preview", files=files, data=data, headers=h, timeout=20)
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is False
    assert "missing" in body["header_error"].lower()


def test_csv_preview_parses_amounts_dates_and_flags_missing_vendor():
    h = _login()
    eid = _entity_id(h)
    csv = (
        "vendor,bill_number,bill_date,due_date,description,amount,expense_account\n"
        "DefinitelyMissingVendor_ZZZ,X-1,2026-02-01,2026-03-01,Materials,1500.00,5000\n"
        "DefinitelyMissingVendor_ZZZ,X-2,02/02/2026,03/02/2026,Coatings,\"$2,400.50\",\n"
        "DefinitelyMissingVendor_ZZZ,X-3,2026-02-03,2026-03-03,Bad amount,not-a-number,5000\n"
        "DefinitelyMissingVendor_ZZZ,X-4,2026-02-04,2026-03-04,Negative,(100.00),5000\n"
    )
    files = {"file": ("bills.csv", _csv_bytes(csv), "text/csv")}
    r = requests.post(f"{API}/vendor-bills/csv-preview", files=files, data={"entity_id": eid}, headers=h, timeout=20)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert body["summary"]["total_rows"] == 4

    rows = {r["bill_number"]: r for r in body["preview"]}
    assert rows["X-1"]["amount"] == 1500.0
    assert rows["X-1"]["bill_date"] == "2026-02-01"
    assert rows["X-1"]["expense_account_number"] == "5000"
    assert rows["X-1"]["expense_account_source"] == "csv-number"
    # Should be flagged because vendor not found
    assert rows["X-1"]["valid"] is False
    assert any("not found" in e.lower() for e in rows["X-1"]["errors"])

    assert rows["X-2"]["amount"] == 2400.50  # currency parsing
    assert rows["X-2"]["bill_date"] == "2026-02-02"  # US-format date parsing
    # No expense account → vendor-default fallback
    assert rows["X-2"]["expense_account_source"] == "vendor-default"

    assert rows["X-3"]["valid"] is False
    assert any("amount" in e.lower() for e in rows["X-3"]["errors"])

    assert rows["X-4"]["amount"] == -100.0
    assert rows["X-4"]["valid"] is False  # negative amount


def test_csv_full_roundtrip_commit_creates_bills():
    h = _login()
    eid = _entity_id(h)
    # Create a real vendor to match against
    vname = f"CSV_TEST_VENDOR_{uuid.uuid4().hex[:6]}"
    v = requests.post(f"{API}/vendors", json={"name": vname, "kind": "Vendor", "category": "Material Supplier"}, headers=h, timeout=15)
    v.raise_for_status()
    vid = v.json()["id"]

    try:
        csv = (
            "vendor,bill_number,amount,expense_account\n"
            f"{vname},CSV-A,1234.56,5000\n"
            f"{vname},CSV-B,2400.00,\n"  # falls back to vendor default 5000
        )
        files = {"file": ("bills.csv", _csv_bytes(csv), "text/csv")}
        rp = requests.post(f"{API}/vendor-bills/csv-preview", files=files, data={"entity_id": eid}, headers=h, timeout=20)
        rp.raise_for_status()
        prev = rp.json()
        assert prev["summary"]["valid_rows"] == 2

        commit_body = {
            "entity_id": eid,
            "rows": [
                {
                    "vendor_id": r["vendor_id"], "vendor_name": r["vendor_name"],
                    "bill_number": r["bill_number"], "bill_date": r["bill_date"],
                    "due_date": r["due_date"], "description": r["description"],
                    "amount": r["amount"],
                    "expense_account_id": r["expense_account_id"],
                    "expense_account_number": r["expense_account_number"],
                }
                for r in prev["preview"] if r["valid"]
            ],
        }
        rc = requests.post(f"{API}/vendor-bills/csv-commit", json=commit_body, headers=h, timeout=20)
        assert rc.status_code == 200, rc.text
        res = rc.json()
        assert res["created_count"] == 2
        assert res["skipped_count"] == 0

        # Verify bills exist
        for b in res["created"]:
            g = requests.get(f"{API}/vendor-bills/{b['id']}", headers=h, timeout=10)
            assert g.status_code == 200
            doc = g.json()
            assert doc["vendor_id"] == vid
            assert doc["status"] == "Pending"
            assert abs(doc["total"] - b["amount"]) < 0.01

        # Cleanup created bills
        for b in res["created"]:
            requests.delete(f"{API}/vendor-bills/{b['id']}", headers=h, timeout=10)
    finally:
        requests.delete(f"{API}/vendors/{vid}", headers=h, timeout=10)


def test_csv_commit_skips_invalid_rows():
    h = _login()
    eid = _entity_id(h)
    body = {"entity_id": eid, "rows": [
        {"vendor_id": None, "vendor_name": "missing", "amount": 100, "expense_account_id": None, "expense_account_number": "5000"},
        {"vendor_id": "ghost", "vendor_name": "valid-looking but no acct", "amount": 0, "expense_account_id": None, "expense_account_number": ""},
    ]}
    r = requests.post(f"{API}/vendor-bills/csv-commit", json=body, headers=h, timeout=15)
    assert r.status_code == 200
    res = r.json()
    assert res["created_count"] == 0
    assert res["skipped_count"] == 2
    assert all("reason" in s for s in res["skipped"])
