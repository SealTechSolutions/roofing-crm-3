"""Phase 6 tests — Inter-Company auto-mirroring + Bank Reconciliation.

Covers:
- IC invoice/bill posting (issuer + mirror) with new 1900/4900/2900/6700 accounts
- IC payment mirrors
- IC report endpoint (balanced pairs)
- IC re-PUT/idempotency (journal counts don't grow)
- IC change/delete reversal
- Bank Rec endpoints (accounts, lines, save open, save locked, reopen, delete)
- Admin-only enforcement
- Regression: non-IC invoice/bill still routes 1100/4xxx and 5000-or-5010/2000
"""
import os
import uuid
import pytest
import requests
from pathlib import Path
from pymongo import MongoClient

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
if not BASE_URL:
    for ln in Path('/app/frontend/.env').read_text().splitlines():
        if ln.startswith('REACT_APP_BACKEND_URL='):
            BASE_URL = ln.split('=', 1)[1].strip().rstrip('/')
            break

ADMIN_EMAIL = "admin@roofingcrm.com"
ADMIN_PASSWORD = "admin123"

# Direct DB inspect (for journal asserts)
MONGO_URL = "mongodb://localhost:27017"
DB_NAME = None
for ln in Path('/app/backend/.env').read_text().splitlines():
    if ln.startswith('MONGO_URL='):
        MONGO_URL = ln.split('=', 1)[1].strip().strip('"').strip("'")
    elif ln.startswith('DB_NAME='):
        DB_NAME = ln.split('=', 1)[1].strip().strip('"').strip("'")


@pytest.fixture(scope="session")
def mongo():
    cli = MongoClient(MONGO_URL)
    return cli[DB_NAME]


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
    ents = r.json()
    parent = next((e for e in ents if e.get("is_parent")), None)
    others = [e for e in ents if not e.get("is_parent") and e.get("is_active")]
    if not parent or len(others) < 2:
        pytest.skip("Need parent + 2 sub-entities")
    return parent, others[0], others[1]


@pytest.fixture(scope="session")
def created_ids():
    return {"invoices": [], "bills": [], "users": [], "recs": []}


def _journals_for_source(mongo, source_id, source_type=None):
    q = {"source_id": source_id}
    if source_type:
        q["source_type"] = source_type
    return list(mongo.journal_entries.find(q, {"_id": 0}))


# =============== IC INVOICE ===============

class TestICInvoice:
    def test_create_ic_invoice_posts_dual_journals(self, client, entities, created_ids, mongo):
        parent, sub1, _ = entities
        body = {
            "entity_id": parent["id"],
            "counter_entity_id": sub1["id"],
            "invoice_number": f"TEST-IC-{uuid.uuid4().hex[:6]}",
            "invoice_date": "2026-06-15",
            "line_items": [{"description": "TEST IC svc", "quantity": 1, "unit_price": 5000}],
            "description": "TEST IC invoice parent->sub1",
            "status": "Issued",
        }
        r = client.post(f"{BASE_URL}/api/invoices", json=body, timeout=15)
        assert r.status_code in (200, 201), r.text
        inv = r.json()
        inv_id = inv["id"]
        created_ids["invoices"].append(inv_id)

        # Issuer journal
        issuer = mongo.journal_entries.find_one({"source_id": inv_id, "source_type": "invoice", "is_reversed": {"$ne": True}})
        assert issuer is not None, "issuer journal missing"
        assert issuer["entity_id"] == parent["id"]
        assert issuer.get("is_inter_company") is True
        assert issuer.get("counter_entity_id") == sub1["id"]
        nums = sorted(l["account_number"] for l in issuer["lines"])
        assert nums == ["1900", "4900"], f"issuer accounts: {nums}"
        # DR 1900, CR 4900
        for l in issuer["lines"]:
            if l["account_number"] == "1900":
                assert l["debit"] == 5000 and l["credit"] == 0
            else:
                assert l["credit"] == 5000 and l["debit"] == 0

        # Mirror journal
        mirror = mongo.journal_entries.find_one({"source_id": inv_id, "source_type": "invoice_ic_mirror", "is_reversed": {"$ne": True}})
        assert mirror is not None, "mirror journal missing"
        assert mirror["entity_id"] == sub1["id"]
        assert mirror.get("is_ic_mirror") is True
        assert mirror.get("is_inter_company") is True
        assert mirror.get("counter_entity_id") == parent["id"]
        nums = sorted(l["account_number"] for l in mirror["lines"])
        assert nums == ["2900", "6700"], f"mirror accounts: {nums}"

    def test_re_put_invoice_does_not_duplicate(self, client, entities, created_ids, mongo):
        parent, sub1, _ = entities
        inv_id = created_ids["invoices"][0]
        # Re-PUT same data
        r = client.get(f"{BASE_URL}/api/invoices/{inv_id}", timeout=10)
        assert r.status_code == 200
        cur = r.json()
        upd = {k: cur[k] for k in cur if k not in ("id", "created_at", "updated_at")}
        upd["description"] = "TEST IC invoice updated"
        r = client.put(f"{BASE_URL}/api/invoices/{inv_id}", json=upd, timeout=15)
        assert r.status_code == 200, r.text
        # Count active journals
        active = list(mongo.journal_entries.find({"source_id": inv_id, "is_reversed": {"$ne": True}}))
        types = sorted(j["source_type"] for j in active)
        assert types == ["invoice", "invoice_ic_mirror"], f"got types {types}, count={len(active)}"

    def test_ic_invoice_payment_dual_journals(self, client, entities, created_ids, mongo):
        parent, sub1, _ = entities
        inv_id = created_ids["invoices"][0]
        # Pay $2000
        r = client.get(f"{BASE_URL}/api/invoices/{inv_id}", timeout=10)
        cur = r.json()
        upd = {k: cur[k] for k in cur if k not in ("id", "created_at", "updated_at")}
        upd["amount_paid"] = 2000.0
        upd["payment_date"] = "2026-06-20"
        r = client.put(f"{BASE_URL}/api/invoices/{inv_id}", json=upd, timeout=15)
        assert r.status_code == 200, r.text

        # Issuer payment: DR 1000 / CR 1900
        pay = mongo.journal_entries.find_one({"source_id": inv_id, "source_type": "invoice", "kind": "payment", "is_reversed": {"$ne": True}})
        assert pay is not None
        nums = sorted(l["account_number"] for l in pay["lines"])
        assert nums == ["1000", "1900"], f"issuer pay accounts: {nums}"

        # Mirror payment kind='payment_mirror': DR 2900 / CR 1000
        mpay = mongo.journal_entries.find_one({"source_id": inv_id, "source_type": "invoice_ic_mirror", "kind": "payment_mirror", "is_reversed": {"$ne": True}})
        assert mpay is not None
        nums = sorted(l["account_number"] for l in mpay["lines"])
        assert nums == ["1000", "2900"], f"mirror pay accounts: {nums}"
        assert mpay["entity_id"] == sub1["id"]

    def test_ic_invoice_change_counter_reverses_old_mirror(self, client, entities, created_ids, mongo):
        parent, sub1, sub2 = entities
        # Create a fresh IC invoice to test change (don't reuse payment-laden one)
        body = {
            "entity_id": parent["id"],
            "counter_entity_id": sub1["id"],
            "invoice_number": f"TEST-ICCHG-{uuid.uuid4().hex[:6]}",
            "invoice_date": "2026-06-16",
            "line_items": [{"description": "TEST IC chg", "quantity": 1, "unit_price": 1000}],
            "description": "TEST IC change",
            "status": "Issued",
        }
        r = client.post(f"{BASE_URL}/api/invoices", json=body, timeout=15)
        assert r.status_code in (200, 201)
        inv_id = r.json()["id"]
        created_ids["invoices"].append(inv_id)

        # change counter to sub2
        cur = client.get(f"{BASE_URL}/api/invoices/{inv_id}", timeout=10).json()
        upd = {k: cur[k] for k in cur if k not in ("id", "created_at", "updated_at")}
        upd["counter_entity_id"] = sub2["id"]
        r = client.put(f"{BASE_URL}/api/invoices/{inv_id}", json=upd, timeout=15)
        assert r.status_code == 200, r.text

        # Old mirror on sub1 reversed
        mirrors = list(mongo.journal_entries.find({"source_id": inv_id, "source_type": "invoice_ic_mirror"}))
        sub1_mirror = [m for m in mirrors if m["entity_id"] == sub1["id"]]
        sub2_mirror = [m for m in mirrors if m["entity_id"] == sub2["id"]]
        assert all(m.get("is_reversed") for m in sub1_mirror), "old sub1 mirror should be reversed"
        active_sub2 = [m for m in sub2_mirror if not m.get("is_reversed")]
        assert len(active_sub2) >= 1, "new sub2 mirror missing"

    def test_ic_invoice_delete_reverses_both(self, client, entities, created_ids, mongo):
        # Delete the change-test invoice
        inv_id = created_ids["invoices"][-1]
        r = client.delete(f"{BASE_URL}/api/invoices/{inv_id}", timeout=10)
        assert r.status_code in (200, 204), r.text
        # All journals for both source_types must be is_reversed=true
        journals = list(mongo.journal_entries.find({"source_id": inv_id}))
        active = [j for j in journals if not j.get("is_reversed")]
        assert active == [], f"expected all reversed, got active: {[(j['source_type'], j.get('kind')) for j in active]}"
        created_ids["invoices"].remove(inv_id)


# =============== IC VENDOR BILL ===============

class TestICVendorBill:
    def test_create_ic_bill_posts_dual_journals(self, client, entities, created_ids, mongo):
        parent, sub1, _ = entities
        # buyer=sub1, seller(counter)=parent
        body = {
            "entity_id": sub1["id"],
            "counter_entity_id": parent["id"],
            "vendor_name": "TEST IC Bill Vendor",
            "bill_number": f"TEST-ICB-{uuid.uuid4().hex[:6]}",
            "bill_date": "2026-06-15",
            "total": 1500.0,
            "subtotal": 1500.0,
            "notes": "TEST IC bill sub1<-parent",
            "status": "Approved",
        }
        r = client.post(f"{BASE_URL}/api/vendor-bills", json=body, timeout=15)
        assert r.status_code in (200, 201), r.text
        bid = r.json()["id"]
        created_ids["bills"].append(bid)

        buyer_j = mongo.journal_entries.find_one({"source_id": bid, "source_type": "vendor_bill", "is_reversed": {"$ne": True}})
        assert buyer_j is not None
        assert buyer_j["entity_id"] == sub1["id"]
        assert buyer_j.get("is_inter_company") is True
        nums = sorted(l["account_number"] for l in buyer_j["lines"])
        assert nums == ["2900", "6700"], f"buyer accounts: {nums}"

        seller_j = mongo.journal_entries.find_one({"source_id": bid, "source_type": "vendor_bill_ic_mirror", "is_reversed": {"$ne": True}})
        assert seller_j is not None
        assert seller_j["entity_id"] == parent["id"]
        assert seller_j.get("is_ic_mirror") is True
        nums = sorted(l["account_number"] for l in seller_j["lines"])
        assert nums == ["1900", "4900"], f"seller accounts: {nums}"

    def test_ic_bill_payment_dual_journals(self, client, entities, created_ids, mongo):
        parent, sub1, _ = entities
        bid = created_ids["bills"][0]
        cur = client.get(f"{BASE_URL}/api/vendor-bills/{bid}", timeout=10).json()
        upd = {k: cur[k] for k in cur if k not in ("id", "created_at", "updated_at")}
        upd["paid_amount"] = 500.0
        upd["paid_date"] = "2026-06-20"
        r = client.put(f"{BASE_URL}/api/vendor-bills/{bid}", json=upd, timeout=15)
        assert r.status_code == 200, r.text

        # Buyer pay: DR 2900 / CR 1000
        bpay = mongo.journal_entries.find_one({"source_id": bid, "source_type": "vendor_bill", "kind": "bill_payment", "is_reversed": {"$ne": True}})
        assert bpay is not None
        nums = sorted(l["account_number"] for l in bpay["lines"])
        assert nums == ["1000", "2900"], f"buyer pay accounts: {nums}"

        # Seller mirror pay: DR 1000 / CR 1900
        spay = mongo.journal_entries.find_one({"source_id": bid, "source_type": "vendor_bill_ic_mirror", "kind": "bill_payment_mirror", "is_reversed": {"$ne": True}})
        assert spay is not None
        nums = sorted(l["account_number"] for l in spay["lines"])
        assert nums == ["1000", "1900"], f"seller pay accounts: {nums}"


# =============== IC REPORT ===============

class TestICReport:
    def test_ic_report_pairs_balanced(self, client, entities, created_ids):
        parent, sub1, _ = entities
        r = client.get(f"{BASE_URL}/api/books/reports/inter-company", timeout=10)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "rows" in data
        assert "all_balanced" in data
        # Find pair parent <-> sub1
        pair = None
        for row in data["rows"]:
            ids = {row["entity_a_id"], row["entity_b_id"]}
            if ids == {parent["id"], sub1["id"]}:
                pair = row
                break
        assert pair is not None, f"parent<->sub1 pair missing. rows: {data['rows']}"
        # Diff should be 0
        assert abs(pair["diff_recv_vs_payable"]) < 0.01
        assert abs(pair["diff_payable_vs_recv"]) < 0.01
        assert pair["balanced"] is True


# =============== NON-IC REGRESSION ===============

class TestNonICRegression:
    def test_non_ic_invoice_routes_1100_4xxx(self, client, entities, created_ids, mongo):
        parent, _, _ = entities
        body = {
            "entity_id": parent["id"],
            "invoice_number": f"TEST-NONIC-{uuid.uuid4().hex[:6]}",
            "invoice_date": "2026-06-15",
            "line_items": [{"description": "TEST non-IC svc", "quantity": 1, "unit_price": 800}],
            "description": "TEST non-IC invoice",
            "status": "Issued",
        }
        r = client.post(f"{BASE_URL}/api/invoices", json=body, timeout=15)
        assert r.status_code in (200, 201), r.text
        inv_id = r.json()["id"]
        created_ids["invoices"].append(inv_id)
        j = mongo.journal_entries.find_one({"source_id": inv_id, "source_type": "invoice", "is_reversed": {"$ne": True}})
        assert j is not None
        nums = sorted(l["account_number"] for l in j["lines"])
        # 1100 AR DR / 4xxx revenue CR
        assert "1100" in nums and any(n.startswith("4") and n != "4900" for n in nums), f"non-IC accounts: {nums}"
        assert j.get("is_inter_company") is not True

    def test_non_ic_bill_routes_5000_or_5010_2000(self, client, entities, created_ids, mongo):
        parent, _, _ = entities
        body = {
            "entity_id": parent["id"],
            "vendor_name": "TEST Non-IC Vendor",
            "bill_number": f"TEST-NONIC-B-{uuid.uuid4().hex[:6]}",
            "bill_date": "2026-06-15",
            "total": 600.0,
            "subtotal": 600.0,
            "status": "Approved",
        }
        r = client.post(f"{BASE_URL}/api/vendor-bills", json=body, timeout=15)
        assert r.status_code in (200, 201), r.text
        bid = r.json()["id"]
        created_ids["bills"].append(bid)
        j = mongo.journal_entries.find_one({"source_id": bid, "source_type": "vendor_bill", "is_reversed": {"$ne": True}})
        assert j is not None
        nums = sorted(l["account_number"] for l in j["lines"])
        assert "2000" in nums
        assert ("5000" in nums) or ("5010" in nums), f"non-IC bill accounts: {nums}"


# =============== BANK REC ===============

class TestBankRec:
    def test_bank_rec_accounts_list(self, client, entities):
        parent, _, _ = entities
        r = client.get(f"{BASE_URL}/api/books/bank-rec/accounts", params={"entity_id": parent["id"]}, timeout=10)
        assert r.status_code == 200, r.text
        accs = r.json()
        assert isinstance(accs, list)
        assert len(accs) >= 1
        for a in accs:
            assert a["category"] == "Bank"
            assert a["is_active"] is True
        # sorted by number ascending
        nums = [a["number"] for a in accs]
        assert nums == sorted(nums)

    def test_bank_rec_lines(self, client, entities):
        parent, _, _ = entities
        accs = client.get(f"{BASE_URL}/api/books/bank-rec/accounts", params={"entity_id": parent["id"]}, timeout=10).json()
        bank_acct = accs[0]
        r = client.get(f"{BASE_URL}/api/books/bank-rec/lines",
                       params={"entity_id": parent["id"], "account_id": bank_acct["id"], "date_to": "2026-12-31"}, timeout=10)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "rows" in data and "gl_balance" in data and "cleared_balance" in data and "uncleared_balance" in data
        for row in data["rows"]:
            assert "journal_id" in row and "cleared" in row
            assert "debit" in row and "credit" in row

    def test_bank_rec_save_open_no_clearings(self, client, entities, created_ids, mongo):
        parent, _, _ = entities
        accs = client.get(f"{BASE_URL}/api/books/bank-rec/accounts", params={"entity_id": parent["id"]}, timeout=10).json()
        bank_acct = accs[0]
        lines = client.get(f"{BASE_URL}/api/books/bank-rec/lines",
                           params={"entity_id": parent["id"], "account_id": bank_acct["id"], "date_to": "2026-12-31"}, timeout=10).json()
        # Pick 1 journal id (if any)
        jids = [r["journal_id"] for r in lines["rows"][:1]]
        body = {
            "entity_id": parent["id"],
            "account_id": bank_acct["id"],
            "statement_date": "2026-06-30",
            "statement_balance": 100.0,
            "cleared_journal_ids": jids,
            "status": "open",
        }
        r = client.post(f"{BASE_URL}/api/books/bank-rec/save", json=body, timeout=15)
        assert r.status_code == 200, r.text
        rec = r.json()
        assert rec["status"] == "open"
        assert "id" in rec
        created_ids["recs"].append(rec["id"])

        # No bank_clearings written for status=open
        if jids:
            clearings = list(mongo.bank_clearings.find({"reconciliation_id": rec["id"]}))
            assert clearings == [], f"open status should not write clearings, got {len(clearings)}"

    def test_bank_rec_save_locked_writes_clearings(self, client, entities, created_ids, mongo):
        parent, _, _ = entities
        accs = client.get(f"{BASE_URL}/api/books/bank-rec/accounts", params={"entity_id": parent["id"]}, timeout=10).json()
        bank_acct = accs[0]
        lines = client.get(f"{BASE_URL}/api/books/bank-rec/lines",
                           params={"entity_id": parent["id"], "account_id": bank_acct["id"], "date_to": "2026-12-31"}, timeout=10).json()
        jids = [r["journal_id"] for r in lines["rows"][:2]]
        # Use exact reconciled_balance as statement_balance for difference=0
        # First save open to get cleared_total
        body_open = {
            "entity_id": parent["id"],
            "account_id": bank_acct["id"],
            "statement_date": "2026-07-31",
            "statement_balance": 0,
            "cleared_journal_ids": jids,
            "status": "open",
        }
        r = client.post(f"{BASE_URL}/api/books/bank-rec/save", json=body_open, timeout=15)
        assert r.status_code == 200
        rec_open = r.json()
        created_ids["recs"].append(rec_open["id"])
        target = rec_open["reconciled_balance"]

        # Now lock with matching balance
        body_lock = dict(body_open)
        body_lock["id"] = rec_open["id"]
        body_lock["statement_balance"] = target
        body_lock["status"] = "locked"
        r = client.post(f"{BASE_URL}/api/books/bank-rec/save", json=body_lock, timeout=15)
        assert r.status_code == 200, r.text
        rec = r.json()
        assert rec["status"] == "locked"
        assert rec.get("balanced") is True

        # Clearings exist
        if jids:
            for jid in jids:
                c = mongo.bank_clearings.find_one({"journal_entry_id": jid, "account_id": bank_acct["id"]})
                assert c is not None, f"clearing missing for {jid}"

        # Lines endpoint now shows cleared=true
        lines = client.get(f"{BASE_URL}/api/books/bank-rec/lines",
                           params={"entity_id": parent["id"], "account_id": bank_acct["id"], "date_to": "2026-12-31"}, timeout=10).json()
        for r in lines["rows"]:
            if r["journal_id"] in jids:
                assert r["cleared"] is True

    def test_bank_rec_reopen_clears_markers(self, client, created_ids, mongo, entities):
        parent, _, _ = entities
        # Use the locked one (last)
        locked_rec_id = created_ids["recs"][-1]
        r = client.post(f"{BASE_URL}/api/books/bank-rec/{locked_rec_id}/reopen", timeout=10)
        assert r.status_code == 200, r.text
        assert r.json().get("status") == "open"
        # Clearings deleted
        cnt = mongo.bank_clearings.count_documents({"reconciliation_id": locked_rec_id})
        assert cnt == 0

    def test_bank_rec_delete_open(self, client, created_ids, mongo):
        # delete first open rec
        rec_id = created_ids["recs"][0]
        r = client.delete(f"{BASE_URL}/api/books/bank-rec/{rec_id}", timeout=10)
        assert r.status_code == 200, r.text
        assert mongo.bank_reconciliations.find_one({"id": rec_id}) is None
        created_ids["recs"].remove(rec_id)

    def test_bank_rec_delete_locked_refused(self, client, entities, created_ids, mongo):
        # Re-lock the reopened rec, then try to delete -> 400/refuse
        rec_id = created_ids["recs"][-1] if created_ids["recs"] else None
        if not rec_id:
            pytest.skip("no rec to test")
        cur = client.get(f"{BASE_URL}/api/books/bank-rec/{rec_id}", timeout=10).json()
        body_lock = {
            "id": rec_id,
            "entity_id": cur["entity_id"],
            "account_id": cur["account_id"],
            "statement_date": cur["statement_date"],
            "statement_balance": cur["reconciled_balance"],
            "cleared_journal_ids": cur.get("cleared_journal_ids", []),
            "status": "locked",
        }
        r = client.post(f"{BASE_URL}/api/books/bank-rec/save", json=body_lock, timeout=15)
        assert r.status_code == 200 and r.json()["status"] == "locked"
        # Try delete
        r = client.delete(f"{BASE_URL}/api/books/bank-rec/{rec_id}", timeout=10)
        # Accept either error JSON or 400; book code returns dict with error
        assert r.status_code in (200, 400)
        body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
        # Expect failure indicator
        assert ("error" in body) or r.status_code == 400, f"locked delete should be refused, got {r.status_code} {body}"
        # Cleanup: reopen and delete
        client.post(f"{BASE_URL}/api/books/bank-rec/{rec_id}/reopen", timeout=10)
        client.delete(f"{BASE_URL}/api/books/bank-rec/{rec_id}", timeout=10)
        if rec_id in created_ids["recs"]:
            created_ids["recs"].remove(rec_id)


# =============== ADMIN-ONLY ===============

class TestAdminOnly:
    @pytest.fixture(scope="class")
    def sales_client(self, client, created_ids):
        # Create a sales user (POST /api/users returns generated_password)
        email = f"TEST_sales_{uuid.uuid4().hex[:8]}@example.com"
        r = client.post(f"{BASE_URL}/api/users", json={
            "email": email, "name": "TEST Sales", "role": "sales"
        }, timeout=10)
        if r.status_code not in (200, 201):
            pytest.skip(f"could not create sales user: {r.text}")
        body = r.json()
        pwd = body.get("generated_password")
        uid = (body.get("user") or {}).get("id") or body.get("id")
        created_ids["users"].append(uid)
        if not pwd:
            pytest.skip("no generated_password returned")
        # login
        lr = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pwd}, timeout=10)
        assert lr.status_code == 200, lr.text
        s = requests.Session()
        s.headers.update({"Authorization": f"Bearer {lr.json()['access_token']}", "Content-Type": "application/json"})
        return s

    def test_non_admin_get_allowed(self, sales_client, entities):
        parent, _, _ = entities
        r = sales_client.get(f"{BASE_URL}/api/books/bank-rec/accounts", params={"entity_id": parent["id"]}, timeout=10)
        assert r.status_code == 200, r.text

    def test_non_admin_save_403(self, sales_client, entities):
        parent, _, _ = entities
        body = {"entity_id": parent["id"], "account_id": "x", "statement_date": "2026-06-30",
                "statement_balance": 0, "cleared_journal_ids": [], "status": "open"}
        r = sales_client.post(f"{BASE_URL}/api/books/bank-rec/save", json=body, timeout=10)
        assert r.status_code == 403


# =============== CLEANUP ===============

class TestCleanup:
    def test_cleanup(self, client, created_ids):
        for inv_id in list(created_ids["invoices"]):
            client.delete(f"{BASE_URL}/api/invoices/{inv_id}", timeout=10)
        for bid in list(created_ids["bills"]):
            client.delete(f"{BASE_URL}/api/vendor-bills/{bid}", timeout=10)
        for rec_id in list(created_ids["recs"]):
            client.delete(f"{BASE_URL}/api/books/bank-rec/{rec_id}", timeout=10)
        for uid in list(created_ids["users"]):
            if uid:
                client.delete(f"{BASE_URL}/api/users/{uid}", timeout=10)
