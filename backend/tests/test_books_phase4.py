"""Phase 4 tests — P&L, Balance Sheet, Late-Fee Accrual.

Validates new report endpoints + the late-fee accrual idempotency/skip rules.
"""
import os
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
def parent_entity(client):
    r = client.get(f"{BASE_URL}/api/books/entities", timeout=10)
    assert r.status_code == 200
    for e in r.json():
        if e.get("is_parent"):
            return e
    pytest.skip("No parent entity")


# ---------- P&L Report ----------
class TestProfitLossReport:
    def test_pl_shape(self, client, parent_entity):
        r = client.get(f"{BASE_URL}/api/books/reports/profit-loss",
                       params={"entity_id": parent_entity["id"],
                               "date_from": "2026-01-01", "date_to": "2026-12-31"},
                       timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert "sections" in data
        for k in ("Revenue", "COGS", "Expense", "Other"):
            assert k in data["sections"]
            assert isinstance(data["sections"][k], list)
        assert "totals" in data
        for k in ("revenue", "cogs", "gross_profit", "gross_margin_pct",
                  "operating_expense", "other_income_expense",
                  "net_income", "net_margin_pct"):
            assert k in data["totals"]

    def test_pl_math_with_invoice_and_bill(self, client, parent_entity):
        # Create an invoice ($10k revenue) and bill ($4k COGS) in 2026 window
        inv = client.post(f"{BASE_URL}/api/invoices", json={
            "entity_id": parent_entity["id"], "status": "Sent",
            "bill_to_name": "TEST_QA P&L Math",
            "invoice_date": "2026-06-15",
            "line_items": [{"description": "x", "quantity": 1,
                            "unit_price": 10000, "amount": 10000}],
        }, timeout=15).json()

        # Find a vendor (or skip if vendor endpoint requires more setup)
        vendors_r = client.get(f"{BASE_URL}/api/vendors", timeout=10)
        if vendors_r.status_code != 200 or not vendors_r.json():
            # Create a vendor
            v = client.post(f"{BASE_URL}/api/vendors", json={
                "name": "TEST_QA Vendor", "kind": "supplier"
            }, timeout=10)
            if v.status_code not in (200, 201):
                pytest.skip(f"Cannot create vendor: {v.status_code} {v.text[:100]}")
            vendor = v.json()
        else:
            vendor = vendors_r.json()[0]

        bill = client.post(f"{BASE_URL}/api/vendor-bills", json={
            "entity_id": parent_entity["id"], "status": "Open",
            "vendor_id": vendor["id"], "vendor_name": vendor.get("name", ""),
            "bill_date": "2026-06-15",
            "line_items": [{"description": "mat", "quantity": 1,
                            "unit_price": 4000, "amount": 4000}],
        }, timeout=15)
        bill_data = bill.json() if bill.status_code in (200, 201) else None

        try:
            time.sleep(0.5)
            r = client.get(f"{BASE_URL}/api/books/reports/profit-loss",
                           params={"entity_id": parent_entity["id"],
                                   "date_from": "2026-06-01",
                                   "date_to": "2026-06-30"}, timeout=15)
            assert r.status_code == 200
            data = r.json()
            totals = data["totals"]
            # Revenue should include our 10000
            assert totals["revenue"] >= 10000, f"Got revenue={totals['revenue']}"
            if bill_data:
                assert totals["cogs"] >= 4000, f"Got cogs={totals['cogs']}"
                assert totals["gross_profit"] == round(totals["revenue"] - totals["cogs"], 2)
            assert totals["net_income"] == round(
                totals["gross_profit"] - totals["operating_expense"] + totals["other_income_expense"], 2
            )
        finally:
            client.delete(f"{BASE_URL}/api/invoices/{inv['id']}", timeout=10)
            if bill_data:
                client.delete(f"{BASE_URL}/api/vendor-bills/{bill_data['id']}", timeout=10)

    def test_pl_row_has_balance_field(self, client, parent_entity):
        r = client.get(f"{BASE_URL}/api/books/reports/profit-loss",
                       params={"entity_id": parent_entity["id"],
                               "date_from": "2020-01-01", "date_to": "2030-12-31"},
                       timeout=15)
        data = r.json()
        for sec_name, sec in data["sections"].items():
            for row in sec:
                for k in ("account_id", "account_number", "account_name",
                          "account_type", "debit", "credit", "balance"):
                    assert k in row, f"Missing {k} in {sec_name} row: {row}"


# ---------- Balance Sheet Report ----------
class TestBalanceSheetReport:
    def test_bs_shape(self, client, parent_entity):
        r = client.get(f"{BASE_URL}/api/books/reports/balance-sheet",
                       params={"entity_id": parent_entity["id"],
                               "as_of": "2026-12-31"}, timeout=15)
        assert r.status_code == 200
        data = r.json()
        for k in ("Asset", "Liability", "Equity"):
            assert k in data["sections"]
        assert "current_earnings" in data
        assert "totals" in data
        for k in ("assets", "liabilities", "equity_accounts", "equity_total",
                  "liab_plus_equity", "out_of_balance", "balanced"):
            assert k in data["totals"]

    def test_bs_balanced(self, client, parent_entity):
        r = client.get(f"{BASE_URL}/api/books/reports/balance-sheet",
                       params={"entity_id": parent_entity["id"],
                               "as_of": "2030-12-31"}, timeout=15)
        data = r.json()
        # Assets should equal Liabilities + Equity (within 0.01)
        assert data["totals"]["balanced"] is True, \
            f"BS not balanced: assets={data['totals']['assets']} L+E={data['totals']['liab_plus_equity']}"

    def test_bs_natural_balance_signs(self, client, parent_entity):
        # Create an invoice → should bump Assets (AR) and trigger Revenue (which flows to current_earnings)
        inv = client.post(f"{BASE_URL}/api/invoices", json={
            "entity_id": parent_entity["id"], "status": "Sent",
            "bill_to_name": "TEST_QA BS",
            "invoice_date": "2026-07-15",
            "line_items": [{"description": "x", "quantity": 1,
                            "unit_price": 5000, "amount": 5000}],
        }, timeout=15).json()
        try:
            time.sleep(0.3)
            r = client.get(f"{BASE_URL}/api/books/reports/balance-sheet",
                           params={"entity_id": parent_entity["id"],
                                   "as_of": "2026-12-31"}, timeout=15)
            data = r.json()
            # AR row should exist with positive balance (debit-positive)
            ar = next((a for a in data["sections"]["Asset"]
                       if a["account_number"] == "1100"), None)
            assert ar is not None and ar["balance"] > 0, f"AR balance not positive: {ar}"
            assert data["current_earnings"] != 0, "Current earnings should reflect the invoice"
            assert data["totals"]["balanced"] is True
        finally:
            client.delete(f"{BASE_URL}/api/invoices/{inv['id']}", timeout=10)


# ---------- Journal Entries Drill-down ----------
class TestJournalDrilldown:
    def test_filter_by_account_id(self, client, parent_entity):
        # Get an AR account id
        accts = client.get(f"{BASE_URL}/api/books/accounts",
                           params={"entity_id": parent_entity["id"]}, timeout=10).json()
        ar = next((a for a in accts if a["number"] == "1100"), None)
        assert ar is not None
        r = client.get(f"{BASE_URL}/api/books/journal-entries",
                       params={"entity_id": parent_entity["id"],
                               "account_id": ar["id"], "limit": 500}, timeout=10)
        assert r.status_code == 200
        for row in r.json():
            account_ids = [ln["account_id"] for ln in row["lines"]]
            assert ar["id"] in account_ids

    def test_filter_by_account_number(self, client, parent_entity):
        r = client.get(f"{BASE_URL}/api/books/journal-entries",
                       params={"entity_id": parent_entity["id"],
                               "account_number": "4010", "limit": 500}, timeout=10)
        assert r.status_code == 200
        for row in r.json():
            nums = [ln["account_number"] for ln in row["lines"]]
            assert "4010" in nums

    def test_filter_by_date_range(self, client, parent_entity):
        r = client.get(f"{BASE_URL}/api/books/journal-entries",
                       params={"entity_id": parent_entity["id"],
                               "date_from": "2026-01-01",
                               "date_to": "2026-12-31", "limit": 500}, timeout=10)
        assert r.status_code == 200
        for row in r.json():
            assert "2026-01-01" <= row["date"] <= "2026-12-31"


# ---------- Late-Fee Accrual ----------
class TestLateFeeAccrual:
    def _make_overdue_invoice(self, client, entity_id, total=10000,
                              invoice_date="2026-03-01", due_date="2026-04-01"):
        body = {
            "entity_id": entity_id, "status": "Sent",
            "bill_to_name": "TEST_QA LateFee",
            "invoice_date": invoice_date,
            "due_date": due_date,
            "line_items": [{"description": "x", "quantity": 1,
                            "unit_price": total, "amount": total}],
        }
        return client.post(f"{BASE_URL}/api/invoices", json=body, timeout=15).json()

    def test_late_fee_happy_path(self, client, parent_entity):
        inv = self._make_overdue_invoice(client, parent_entity["id"])
        try:
            r = client.post(f"{BASE_URL}/api/books/late-fees/accrue",
                            params={"as_of": "2026-06-15",
                                    "entity_id": parent_entity["id"]}, timeout=20)
            assert r.status_code == 200, r.text
            data = r.json()
            assert data["invoices_accrued"] >= 1
            assert data["total_late_fees"] >= 150.0
            assert data["period"] == "2026-06"

            # Verify journal exists
            jr = client.get(f"{BASE_URL}/api/books/journal-entries",
                            params={"entity_id": parent_entity["id"],
                                    "source_id": inv["id"], "limit": 50}, timeout=10).json()
            lf = [j for j in jr if j["kind"] == "late_fee:2026-06"]
            assert len(lf) == 1, f"Expected 1 late fee journal, got {len(lf)}: {[j['kind'] for j in jr]}"
            j = lf[0]
            assert j["total_debit"] == 150.0
            assert j["total_credit"] == 150.0
            # Lines DR 1100, CR 4200
            line_by_num = {ln["account_number"]: ln for ln in j["lines"]}
            assert line_by_num["1100"]["debit"] == 150.0
            assert line_by_num["4200"]["credit"] == 150.0
        finally:
            client.delete(f"{BASE_URL}/api/invoices/{inv['id']}", timeout=10)

    def test_late_fee_idempotent(self, client, parent_entity):
        inv = self._make_overdue_invoice(client, parent_entity["id"])
        try:
            client.post(f"{BASE_URL}/api/books/late-fees/accrue",
                        params={"as_of": "2026-06-15",
                                "entity_id": parent_entity["id"]}, timeout=20)
            r2 = client.post(f"{BASE_URL}/api/books/late-fees/accrue",
                             params={"as_of": "2026-06-15",
                                     "entity_id": parent_entity["id"]}, timeout=20)
            assert r2.status_code == 200
            # Even after re-run, only 1 late_fee:2026-06 journal exists for this invoice
            jr = client.get(f"{BASE_URL}/api/books/journal-entries",
                            params={"entity_id": parent_entity["id"],
                                    "source_id": inv["id"], "limit": 50}, timeout=10).json()
            lf = [j for j in jr if j["kind"] == "late_fee:2026-06"]
            assert len(lf) == 1
            assert lf[0]["total_debit"] == 150.0
        finally:
            client.delete(f"{BASE_URL}/api/invoices/{inv['id']}", timeout=10)

    def test_late_fee_grace_period_skip(self, client, parent_entity):
        # Due 2026-06-01, as_of 2026-06-15 → 14 days overdue → skipped
        inv = client.post(f"{BASE_URL}/api/invoices", json={
            "entity_id": parent_entity["id"], "status": "Sent",
            "bill_to_name": "TEST_QA Grace",
            "invoice_date": "2026-05-15",
            "due_date": "2026-06-01",
            "line_items": [{"description": "x", "quantity": 1,
                            "unit_price": 1000, "amount": 1000}],
        }, timeout=15).json()
        try:
            r = client.post(f"{BASE_URL}/api/books/late-fees/accrue",
                            params={"as_of": "2026-06-15",
                                    "entity_id": parent_entity["id"]}, timeout=20)
            assert r.status_code == 200
            jr = client.get(f"{BASE_URL}/api/books/journal-entries",
                            params={"entity_id": parent_entity["id"],
                                    "source_id": inv["id"], "limit": 50}, timeout=10).json()
            lf = [j for j in jr if j["kind"].startswith("late_fee:")]
            assert len(lf) == 0, "Grace period invoice should not have late fee"
        finally:
            client.delete(f"{BASE_URL}/api/invoices/{inv['id']}", timeout=10)

    def test_late_fee_admin_only(self, parent_entity):
        # Without auth → 401 or 403
        r = requests.post(f"{BASE_URL}/api/books/late-fees/accrue",
                          params={"as_of": "2026-06-15"}, timeout=10)
        assert r.status_code in (401, 403), f"Expected 401/403, got {r.status_code}"
