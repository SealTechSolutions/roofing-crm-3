"""Extra spec-coverage tests for journal templates trash + CSV header synonyms + due_date default
+ csv_import flag in DB. Companion to test_journal_templates_and_csv.py.
"""
import os
import uuid
import requests

API_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://roofing-crm-3.preview.emergentagent.com").rstrip("/")
API = f"{API_URL}/api"
ADMIN = {"email": "admin@roofingcrm.com", "password": "admin123"}


def _h():
    r = requests.post(f"{API}/auth/login", json=ADMIN, timeout=15)
    r.raise_for_status()
    tok = r.json().get("access_token") or r.json().get("token")
    return {"Authorization": f"Bearer {tok}"}


def _eid(h):
    return requests.get(f"{API}/books/entities", headers=h, timeout=15).json()[0]["id"]


def _accts(h, eid):
    return requests.get(f"{API}/books/accounts?entity_id={eid}", headers=h, timeout=15).json()


def test_journal_template_trash_and_restore():
    h = _h()
    eid = _eid(h)
    accts = _accts(h, eid)
    a1 = next(a for a in accts if a["number"] == "3900")
    a2 = next(a for a in accts if a["number"] == "1000")
    name = f"TEST_TRASH_TPL_{uuid.uuid4().hex[:8]}"
    body = {
        "entity_id": eid, "name": name, "description": "trash test", "default_memo": "",
        "lines": [
            {"account_id": a1["id"], "debit": 100, "credit": 0, "memo": ""},
            {"account_id": a2["id"], "debit": 0, "credit": 100, "memo": ""},
        ],
    }
    r = requests.post(f"{API}/books/journal-templates", json=body, headers=h, timeout=15)
    assert r.status_code == 200, r.text
    tid = r.json()["id"]

    # Soft delete
    r2 = requests.delete(f"{API}/books/journal-templates/{tid}", headers=h, timeout=15)
    assert r2.status_code == 200

    # Should appear in trash
    rt = requests.get(f"{API}/trash/journal_templates", headers=h, timeout=15)
    assert rt.status_code == 200, rt.text
    trash_items = rt.json()
    assert any(t.get("id") == tid for t in trash_items), f"template {tid} not in trash list"

    # Restore
    rr = requests.post(f"{API}/trash/journal_templates/{tid}/restore", headers=h, timeout=15)
    assert rr.status_code == 200, rr.text

    # Now back in active list
    r3 = requests.get(f"{API}/books/journal-templates?entity_id={eid}", headers=h, timeout=15)
    assert any(t["id"] == tid for t in r3.json()), "restored template not in active list"

    # final cleanup
    requests.delete(f"{API}/books/journal-templates/{tid}", headers=h, timeout=15)


def test_csv_header_synonym_vendor_name_and_due_date_default():
    h = _h()
    eid = _eid(h)
    # 'vendor_name' synonym for 'vendor'; due_date omitted (synonym headers tested too: invoice_date)
    csv = (
        "vendor_name,bill_number,invoice_date,description,amount,expense_account\n"
        "DefinitelyMissingVendor_ZZZ,SYN-1,2026-04-15,Test,500.00,5000\n"
    )
    files = {"file": ("syn.csv", csv.encode(), "text/csv")}
    r = requests.post(f"{API}/vendor-bills/csv-preview", files=files, data={"entity_id": eid}, headers=h, timeout=20)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True, body
    row = body["preview"][0]
    assert row["bill_number"] == "SYN-1"
    assert row["bill_date"] == "2026-04-15"
    # Empty due_date defaults to bill_date
    assert row["due_date"] == "2026-04-15", f"due_date should default to bill_date, got {row['due_date']}"
    assert row["vendor_input"].lower().startswith("definitely"), "vendor synonym header should be picked up"


def test_csv_commit_flag_and_notes_in_db():
    h = _h()
    eid = _eid(h)
    vname = f"CSV_TEST_VENDOR_{uuid.uuid4().hex[:6]}"
    v = requests.post(f"{API}/vendors", json={"name": vname, "kind": "Vendor", "category": "Material Supplier"}, headers=h, timeout=15)
    v.raise_for_status()
    vid = v.json()["id"]
    try:
        csv = f"vendor,bill_number,amount,expense_account\n{vname},FLAG-1,777.77,5000\n"
        files = {"file": ("c.csv", csv.encode(), "text/csv")}
        rp = requests.post(f"{API}/vendor-bills/csv-preview", files=files, data={"entity_id": eid}, headers=h, timeout=20).json()
        assert rp["ok"] is True
        commit_body = {"entity_id": eid, "rows": [{
            "vendor_id": r["vendor_id"], "vendor_name": r["vendor_name"],
            "bill_number": r["bill_number"], "bill_date": r["bill_date"],
            "due_date": r["due_date"], "description": r.get("description", ""),
            "amount": r["amount"], "expense_account_id": r["expense_account_id"],
            "expense_account_number": r["expense_account_number"],
        } for r in rp["preview"] if r["valid"]]}
        rc = requests.post(f"{API}/vendor-bills/csv-commit", json=commit_body, headers=h, timeout=20)
        assert rc.status_code == 200, rc.text
        created = rc.json()["created"]
        assert len(created) == 1
        bill_id = created[0]["id"]

        # Fetch bill and verify notes via API; csv_import flag verified via DB (spec: "in DB")
        g = requests.get(f"{API}/vendor-bills/{bill_id}", headers=h, timeout=10)
        assert g.status_code == 200
        doc = g.json()
        assert "Imported from CSV bulk upload" in (doc.get("notes") or ""), f"notes missing: {doc.get('notes')}"
        # csv_import flag in DB
        import asyncio
        from motor.motor_asyncio import AsyncIOMotorClient
        async def _check():
            client = AsyncIOMotorClient(os.environ["MONGO_URL"])
            db_doc = await client[os.environ["DB_NAME"]].vendor_bills.find_one({"id": bill_id})
            client.close()
            return db_doc
        db_doc = asyncio.run(_check())
        assert db_doc.get("csv_import") is True, f"csv_import flag not persisted in DB: {db_doc}"
        # cleanup
        requests.delete(f"{API}/vendor-bills/{bill_id}", headers=h, timeout=10)
    finally:
        requests.delete(f"{API}/vendors/{vid}", headers=h, timeout=10)
