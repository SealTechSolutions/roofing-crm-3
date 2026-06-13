"""Backend tests for SealTech Books Phase 2 — GL auto-journal hooks + KPI reports.

Covers:
- Invoice issue journal (DR 1100 AR / CR 4xxx Sales)
- Revenue routing by roof type / invoice type
- Idempotent payment posting (single journal updates on multiple PUTs)
- Payment reversal when amount_paid back to 0
- Vendor bill received (DR 5000 / CR 2000 — or DR 5010 for Subcontractor)
- Bill payment (DR 2000 / CR 1000)
- Reversal on delete (is_reversed=true)
- KPI reports per entity & /kpis/all
- Missing entity_id silently skips GL post
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
if not BASE_URL:
    from pathlib import Path
    fe_env = Path('/app/frontend/.env').read_text()
    for ln in fe_env.splitlines():
        if ln.startswith('REACT_APP_BACKEND_URL='):
            BASE_URL = ln.split('=', 1)[1].strip().rstrip('/')
            break

ADMIN_EMAIL = "admin@roofingcrm.com"
ADMIN_PASSWORD = "admin123"


@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=10)
    assert r.status_code == 200, f"Login failed: {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def client(admin_token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {admin_token}",
                      "Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def parent_entity(client):
    r = client.get(f"{BASE_URL}/api/books/entities", timeout=10)
    assert r.status_code == 200
    for e in r.json():
        if e.get("is_parent"):
            return e
    pytest.skip("No parent entity")


# Helpers
def _journals_for_source(client, source_id, include_reversed=False, entity_id=None):
    params = {"limit": 500}
    if include_reversed:
        params["include_reversed"] = "true"
    if entity_id:
        params["entity_id"] = entity_id
    r = client.get(f"{BASE_URL}/api/books/journal-entries", params=params, timeout=10)
    assert r.status_code == 200, r.text
    return [j for j in r.json() if j.get("source_id") == source_id]


def _make_invoice(client, entity_id, *, total=10000.0, status="Sent",
                  invoice_type="", deal_id=None, line_items=None):
    items = line_items or [{"description": "QA invoice line", "quantity": 1, "unit_price": total, "amount": total}]
    body = {
        "entity_id": entity_id,
        "status": status,
        "invoice_type": invoice_type,
        "bill_to_name": "TEST_QA Customer",
        "project_title": "TEST_QA Project",
        "line_items": items,
        "terms": "Due Upon Receipt",
    }
    if deal_id:
        body["deal_id"] = deal_id
    r = client.post(f"{BASE_URL}/api/invoices", json=body, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _put_invoice(client, inv, **overrides):
    body = {k: v for k, v in inv.items() if k in {
        "deal_id", "customer_contact_id", "invoice_type", "entity_id",
        "bill_to_company", "bill_to_name", "bill_to_address", "bill_to_address_line2",
        "bill_to_city", "bill_to_state", "bill_to_zip", "bill_to_email",
        "cc_email", "invoice_date", "due_date", "terms",
        "project_title", "project_address", "project_total", "notes",
        "line_items", "status", "amount_paid", "payment_date",
        "payment_method", "payment_reference", "source_type", "source_id",
    }}
    body.update(overrides)
    r = client.put(f"{BASE_URL}/api/invoices/{inv['id']}", json=body, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _make_vendor(client, kind="Vendor"):
    body = {"name": f"TEST_QA_Vendor_{uuid.uuid4().hex[:6]}", "kind": kind, "category": "Materials"}
    r = client.post(f"{BASE_URL}/api/vendors", json=body, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _make_bill(client, entity_id, vendor, *, total=5000.0, status="Pending"):
    body = {
        "entity_id": entity_id,
        "vendor_id": vendor["id"],
        "vendor_name": vendor["name"],
        "bill_number": f"TEST-{uuid.uuid4().hex[:6]}",
        "status": status,
        "total": total,
        "subtotal": total,
        "line_items": [{"description": "QA bill line", "quantity": 1, "unit_price": total, "amount": total}],
    }
    r = client.post(f"{BASE_URL}/api/vendor-bills", json=body, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _put_bill(client, bill, **overrides):
    body = {k: v for k, v in bill.items() if k in {
        "vendor_id", "vendor_name", "entity_id", "bill_number", "bill_date",
        "received_date", "due_date", "terms", "total", "subtotal", "tax",
        "shipping", "status", "notes", "attached_file_id", "parsed_by_ai",
        "line_items", "paid_amount", "paid_date", "paid_method", "paid_reference",
    }}
    body.update(overrides)
    r = client.put(f"{BASE_URL}/api/vendor-bills/{bill['id']}", json=body, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _make_deal(client, *, proposed_roof_type="TPO"):
    body = {
        "title": f"TEST_QA_Deal_{uuid.uuid4().hex[:6]}",
        "proposed_roof_type": proposed_roof_type,
        "project_type": "Re-Roof",
        "status": "Lead",
    }
    r = client.post(f"{BASE_URL}/api/deals", json=body, timeout=10)
    assert r.status_code == 200, r.text
    return r.json()


# --- Invoice GL tests ---
class TestInvoiceGL:
    def test_create_invoice_posts_issue_journal_default_reroof(self, client, parent_entity):
        inv = _make_invoice(client, parent_entity["id"], total=12000.0, status="Sent")
        try:
            journals = _journals_for_source(client, inv["id"])
            issue = [j for j in journals if j["kind"] == "issue"]
            assert len(issue) == 1, f"Expected 1 issue journal, got {len(issue)}: {journals}"
            j = issue[0]
            assert j["entity_id"] == parent_entity["id"]
            assert j["total_debit"] == pytest.approx(12000.0)
            assert j["total_credit"] == pytest.approx(12000.0)
            nums = {l["account_number"]: l for l in j["lines"]}
            assert "1100" in nums and nums["1100"]["debit"] == pytest.approx(12000.0)
            # Default revenue = 4010 (Re-Roof/Replacement) since no deal
            assert "4010" in nums and nums["4010"]["credit"] == pytest.approx(12000.0)
        finally:
            client.delete(f"{BASE_URL}/api/invoices/{inv['id']}", timeout=10)

    def test_revenue_routing_farm(self, client, parent_entity):
        deal = _make_deal(client, proposed_roof_type="FARM")
        inv = _make_invoice(client, parent_entity["id"], total=9000.0, status="Sent", deal_id=deal["id"])
        try:
            journals = _journals_for_source(client, inv["id"])
            issue = next(j for j in journals if j["kind"] == "issue")
            nums = {l["account_number"] for l in issue["lines"]}
            assert "4030" in nums, f"Expected FARM 4030, got {nums}"
        finally:
            client.delete(f"{BASE_URL}/api/invoices/{inv['id']}", timeout=10)
            client.delete(f"{BASE_URL}/api/deals/{deal['id']}", timeout=10)

    def test_revenue_routing_maintenance(self, client, parent_entity):
        inv = _make_invoice(client, parent_entity["id"], total=600.0,
                            status="Sent", invoice_type="Maintenance")
        try:
            journals = _journals_for_source(client, inv["id"])
            issue = next(j for j in journals if j["kind"] == "issue")
            nums = {l["account_number"] for l in issue["lines"]}
            assert "4100" in nums, f"Expected 4100 maintenance, got {nums}"
        finally:
            client.delete(f"{BASE_URL}/api/invoices/{inv['id']}", timeout=10)

    def test_idempotent_payment_posting(self, client, parent_entity):
        inv = _make_invoice(client, parent_entity["id"], total=10000.0, status="Sent")
        try:
            # First payment
            _put_invoice(client, inv, amount_paid=4000.0, status="Partial")
            j1 = [x for x in _journals_for_source(client, inv["id"]) if x["kind"] == "payment"]
            assert len(j1) == 1
            assert j1[0]["total_debit"] == pytest.approx(4000.0)
            # Bump payment — should still be ONE row, now 7000
            _put_invoice(client, inv, amount_paid=7000.0, status="Partial")
            j2 = [x for x in _journals_for_source(client, inv["id"]) if x["kind"] == "payment"]
            assert len(j2) == 1, f"Duplicate payment journals: {j2}"
            assert j2[0]["total_debit"] == pytest.approx(7000.0)
            assert j2[0]["id"] == j1[0]["id"], "posting_key must overwrite same row"
            # Verify line accounts: DR 1000 / CR 1100
            nums = {l["account_number"]: l for l in j2[0]["lines"]}
            assert nums["1000"]["debit"] == pytest.approx(7000.0)
            assert nums["1100"]["credit"] == pytest.approx(7000.0)
        finally:
            client.delete(f"{BASE_URL}/api/invoices/{inv['id']}", timeout=10)

    def test_payment_reversal_on_zero(self, client, parent_entity):
        inv = _make_invoice(client, parent_entity["id"], total=5000.0, status="Sent")
        try:
            _put_invoice(client, inv, amount_paid=2500.0, status="Partial")
            _put_invoice(client, inv, amount_paid=0.0, status="Sent")
            # Without include_reversed — payment should be hidden
            active = [x for x in _journals_for_source(client, inv["id"]) if x["kind"] == "payment"]
            assert len(active) == 0, f"Payment journal should be reversed: {active}"
            # With include_reversed=true — reversed entry visible
            all_rows = _journals_for_source(client, inv["id"], include_reversed=True)
            pay_all = [x for x in all_rows if x["kind"] == "payment"]
            assert len(pay_all) == 1
            assert pay_all[0]["is_reversed"] is True
        finally:
            client.delete(f"{BASE_URL}/api/invoices/{inv['id']}", timeout=10)

    def test_no_journal_when_entity_blank(self, client):
        body = {
            "entity_id": "",
            "status": "Sent",
            "bill_to_name": "TEST_QA No Entity",
            "line_items": [{"description": "x", "quantity": 1, "unit_price": 100, "amount": 100}],
        }
        r = client.post(f"{BASE_URL}/api/invoices", json=body, timeout=15)
        assert r.status_code == 200, r.text
        inv = r.json()
        try:
            journals = _journals_for_source(client, inv["id"], include_reversed=True)
            assert journals == [], f"Should not post journals for blank entity_id: {journals}"
        finally:
            client.delete(f"{BASE_URL}/api/invoices/{inv['id']}", timeout=10)

    def test_invoice_delete_reverses_all(self, client, parent_entity):
        inv = _make_invoice(client, parent_entity["id"], total=3000.0, status="Sent")
        _put_invoice(client, inv, amount_paid=1000.0, status="Partial")
        # Confirm 2 journals exist
        before = _journals_for_source(client, inv["id"])
        assert len(before) >= 2
        # Delete
        r = client.delete(f"{BASE_URL}/api/invoices/{inv['id']}", timeout=10)
        assert r.status_code == 200
        # All journals reversed
        active = _journals_for_source(client, inv["id"])
        assert active == []
        all_rows = _journals_for_source(client, inv["id"], include_reversed=True)
        assert len(all_rows) >= 2
        assert all(x["is_reversed"] for x in all_rows)


# --- Vendor Bill GL tests ---
class TestBillGL:
    def test_bill_received_materials_default(self, client, parent_entity):
        vendor = _make_vendor(client, kind="Vendor")
        bill = _make_bill(client, parent_entity["id"], vendor, total=4000.0, status="Pending")
        try:
            journals = _journals_for_source(client, bill["id"])
            issue = next(j for j in journals if j["kind"] == "bill_received")
            nums = {l["account_number"]: l for l in issue["lines"]}
            assert nums["5000"]["debit"] == pytest.approx(4000.0)
            assert nums["2000"]["credit"] == pytest.approx(4000.0)
            assert issue["total_debit"] == pytest.approx(4000.0)
            assert issue["total_credit"] == pytest.approx(4000.0)
        finally:
            client.delete(f"{BASE_URL}/api/vendor-bills/{bill['id']}", timeout=10)
            client.delete(f"{BASE_URL}/api/vendors/{vendor['id']}", timeout=10)

    def test_bill_received_subcontractor_uses_5010(self, client, parent_entity):
        vendor = _make_vendor(client, kind="Subcontractor")
        bill = _make_bill(client, parent_entity["id"], vendor, total=2500.0, status="Pending")
        try:
            journals = _journals_for_source(client, bill["id"])
            issue = next(j for j in journals if j["kind"] == "bill_received")
            nums = {l["account_number"] for l in issue["lines"]}
            assert "5010" in nums, f"Expected 5010 (Sub Labor), got {nums}"
            assert "5000" not in nums, "Should NOT post to 5000 for subcontractor"
        finally:
            client.delete(f"{BASE_URL}/api/vendor-bills/{bill['id']}", timeout=10)
            client.delete(f"{BASE_URL}/api/vendors/{vendor['id']}", timeout=10)

    def test_bill_payment_posts_journal(self, client, parent_entity):
        vendor = _make_vendor(client, kind="Vendor")
        bill = _make_bill(client, parent_entity["id"], vendor, total=2000.0, status="Pending")
        try:
            _put_bill(client, bill, paid_amount=1200.0, status="Pending")
            journals = _journals_for_source(client, bill["id"])
            pay = [j for j in journals if j["kind"] == "bill_payment"]
            assert len(pay) == 1
            nums = {l["account_number"]: l for l in pay[0]["lines"]}
            assert nums["2000"]["debit"] == pytest.approx(1200.0)
            assert nums["1000"]["credit"] == pytest.approx(1200.0)
        finally:
            client.delete(f"{BASE_URL}/api/vendor-bills/{bill['id']}", timeout=10)
            client.delete(f"{BASE_URL}/api/vendors/{vendor['id']}", timeout=10)

    def test_bill_delete_reverses_all(self, client, parent_entity):
        vendor = _make_vendor(client, kind="Vendor")
        bill = _make_bill(client, parent_entity["id"], vendor, total=1500.0, status="Pending")
        _put_bill(client, bill, paid_amount=500.0, status="Pending")
        r = client.delete(f"{BASE_URL}/api/vendor-bills/{bill['id']}", timeout=10)
        assert r.status_code == 200
        client.delete(f"{BASE_URL}/api/vendors/{vendor['id']}", timeout=10)
        active = _journals_for_source(client, bill["id"])
        assert active == []
        all_rows = _journals_for_source(client, bill["id"], include_reversed=True)
        assert all_rows and all(x["is_reversed"] for x in all_rows)


# --- KPI Report tests ---
class TestKPIReports:
    def test_kpis_endpoint_shape(self, client, parent_entity):
        r = client.get(f"{BASE_URL}/api/books/reports/kpis",
                       params={"entity_id": parent_entity["id"]}, timeout=10)
        assert r.status_code == 200
        kpi = r.json()
        for key in ("cash_on_hand", "open_ar", "open_ap", "mtd_revenue",
                    "ytd_revenue", "ytd_cogs", "ytd_gross_profit"):
            assert key in kpi, f"missing key {key}"
            assert isinstance(kpi[key], (int, float))

    def test_kpis_match_journal_sums(self, client, parent_entity):
        # Create an invoice + partial payment in a known amount; assert KPI shifts.
        ent = parent_entity["id"]
        before = client.get(f"{BASE_URL}/api/books/reports/kpis",
                            params={"entity_id": ent}, timeout=10).json()
        inv = _make_invoice(client, ent, total=8000.0, status="Sent")
        try:
            _put_invoice(client, inv, amount_paid=3000.0, status="Partial")
            after = client.get(f"{BASE_URL}/api/books/reports/kpis",
                               params={"entity_id": ent}, timeout=10).json()
            # AR delta = total - paid = 5000
            assert after["open_ar"] == pytest.approx(before["open_ar"] + 5000.0, abs=0.01)
            # Cash delta = +3000
            assert after["cash_on_hand"] == pytest.approx(before["cash_on_hand"] + 3000.0, abs=0.01)
            # MTD revenue + 8000 (issued this month)
            assert after["mtd_revenue"] == pytest.approx(before["mtd_revenue"] + 8000.0, abs=0.01)
        finally:
            client.delete(f"{BASE_URL}/api/invoices/{inv['id']}", timeout=10)

    def test_kpis_all_returns_active_entities(self, client):
        r = client.get(f"{BASE_URL}/api/books/reports/kpis/all", timeout=15)
        assert r.status_code == 200
        rows = r.json()
        assert isinstance(rows, list) and len(rows) >= 4
        for row in rows:
            assert "entity_id" in row
            assert "entity_name" in row
            assert "entity_role" in row
            assert "is_parent" in row
            assert "cash_on_hand" in row
            assert "open_ar" in row
            assert "open_ap" in row
            assert "mtd_revenue" in row
        # Exactly one parent
        parents = [r for r in rows if r["is_parent"]]
        assert len(parents) == 1
