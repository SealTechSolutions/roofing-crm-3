"""Phase 5 — Period Close workflow tests.

Tests cover preview (no writes), run (idempotent + depreciation + lock + PDFs),
period-lock enforcement on invoices, reopen, admin-only auth.
"""
import os
import uuid
import pytest
import requests
from pathlib import Path

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
if not BASE_URL:
    for ln in Path('/app/frontend/.env').read_text().splitlines():
        if ln.startswith('REACT_APP_BACKEND_URL='):
            BASE_URL = ln.split('=', 1)[1].strip().rstrip('/')
            break

ADMIN_EMAIL = "admin@roofingcrm.com"
ADMIN_PASSWORD = "admin123"
TEST_PERIOD = "2026-05"
TEST_PERIOD_NEXT = "2026-06"
PERIOD_END = "2026-05-31"


@pytest.fixture(scope="module")
def client():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, r.text
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {r.json()['access_token']}",
                      "Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def parent_entity(client):
    r = client.get(f"{BASE_URL}/api/books/entities", timeout=10)
    assert r.status_code == 200
    parent = next((e for e in r.json() if e.get("is_parent")), None)
    if not parent:
        pytest.skip("No parent entity")
    return parent


@pytest.fixture(scope="module", autouse=True)
def cleanup_before_after(client, parent_entity):
    """Reset state: reopen any existing close for parent/2026-05 and clear lock_through."""
    # Best-effort cleanup of any prior close
    eid = parent_entity["id"]
    try:
        client.post(f"{BASE_URL}/api/books/period-close/reopen",
                    params={"entity_id": eid, "period": TEST_PERIOD}, timeout=10)
    except Exception:
        pass
    yield
    # Final cleanup: reopen so subsequent test runs start clean
    try:
        client.post(f"{BASE_URL}/api/books/period-close/reopen",
                    params={"entity_id": eid, "period": TEST_PERIOD}, timeout=10)
    except Exception:
        pass


# -------- COA Seed Verification ----------

class TestCOASeed:
    def test_6600_depreciation_expense_exists(self, client, parent_entity):
        r = client.get(f"{BASE_URL}/api/books/accounts",
                       params={"entity_id": parent_entity["id"]}, timeout=10)
        assert r.status_code == 200
        accts = r.json()
        depr = next((a for a in accts if a["number"] == "6600"), None)
        assert depr is not None, "Account 6600 Depreciation Expense missing"
        assert depr["type"] == "Expense"
        assert depr.get("system") is True

    def test_1510_accum_depreciation_exists(self, client, parent_entity):
        r = client.get(f"{BASE_URL}/api/books/accounts",
                       params={"entity_id": parent_entity["id"]}, timeout=10)
        accts = r.json()
        acc = next((a for a in accts if a["number"] == "1510"), None)
        assert acc is not None
        assert acc["type"] == "Asset"
        assert acc.get("is_contra") is True


# -------- Entity monthly_depreciation field ----------

class TestEntityMonthlyDepr:
    def test_put_entity_persists_monthly_depr_and_preserves_lock(self, client, parent_entity):
        eid = parent_entity["id"]
        # Set monthly_depreciation = 1500
        body = {**parent_entity, "monthly_depreciation": 1500.0,
                "lock_through": "1999-01-01"}  # attempt to override lock — should be ignored
        # Strip read-only fields
        for k in ("id", "_id", "created_at", "is_active"):
            body.pop(k, None)
        r = client.put(f"{BASE_URL}/api/books/entities/{eid}", json=body, timeout=10)
        assert r.status_code == 200, r.text
        updated = r.json()
        assert updated["monthly_depreciation"] == 1500.0
        # lock_through must NOT have been set to 1999-01-01 — it's system-managed
        assert updated.get("lock_through", "") != "1999-01-01", \
            f"PUT must not override lock_through, got {updated.get('lock_through')}"


# -------- Preview ----------

class TestPreview:
    def test_preview_no_writes(self, client, parent_entity):
        eid = parent_entity["id"]
        # Snapshot journal_entries & period_closes counts before
        je_before = client.get(f"{BASE_URL}/api/books/journal-entries",
                               params={"entity_id": eid, "limit": 500}).json()
        pc_before = client.get(f"{BASE_URL}/api/books/period-close/list",
                               params={"entity_id": eid}).json()
        r = client.get(f"{BASE_URL}/api/books/period-close/preview",
                       params={"entity_id": eid, "period": TEST_PERIOD}, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        # Shape
        for k in ("entity_id", "period", "period_start", "period_end",
                  "already_closed", "current_lock_through", "actions", "snapshot_totals"):
            assert k in d, f"missing key {k}"
        assert d["period_end"] == PERIOD_END
        assert d["period_start"] == "2026-05-01"
        actions = d["actions"]
        assert "late_fee_accrual" in actions
        assert "depreciation" in actions
        assert actions["depreciation"]["amount"] == 1500.0
        assert actions["depreciation"]["will_post"] is True
        assert actions["lock_through_after"] == PERIOD_END
        assert isinstance(actions["pdf_snapshots"], list) and len(actions["pdf_snapshots"]) == 2
        # No writes
        je_after = client.get(f"{BASE_URL}/api/books/journal-entries",
                              params={"entity_id": eid, "limit": 500}).json()
        pc_after = client.get(f"{BASE_URL}/api/books/period-close/list",
                              params={"entity_id": eid}).json()
        assert len(je_after) == len(je_before), "Preview wrote journal entries!"
        assert len(pc_after) == len(pc_before), "Preview wrote period_closes!"


# -------- Run (happy path + idempotency) ----------

class TestRunClose:
    def test_run_happy_path(self, client, parent_entity):
        eid = parent_entity["id"]
        r = client.post(f"{BASE_URL}/api/books/period-close/run",
                        params={"entity_id": eid, "period": TEST_PERIOD}, timeout=30)
        assert r.status_code == 200, r.text
        rec = r.json()
        assert rec["entity_id"] == eid
        assert rec["period"] == TEST_PERIOD
        assert rec["period_end"] == PERIOD_END
        assert rec["is_reopened"] is False
        assert rec["depreciation_posted"] == 1500.0
        assert rec.get("depreciation_journal_id"), "No depreciation journal id"
        assert isinstance(rec["pdf_document_ids"], list)
        assert len(rec["pdf_document_ids"]) == 2, f"Expected 2 PDFs, got {len(rec['pdf_document_ids'])}"
        # Verify lock applied on entity
        ent = client.get(f"{BASE_URL}/api/books/entities/{eid}").json()
        assert ent.get("lock_through") == PERIOD_END
        # Verify depreciation journal exists with right amounts
        jes = client.get(f"{BASE_URL}/api/books/journal-entries",
                         params={"entity_id": eid, "source_id": eid, "limit": 50}).json()
        depr_je = next((j for j in jes if j.get("kind") == f"depreciation:{TEST_PERIOD}"), None)
        assert depr_je is not None, "Depreciation journal not posted"
        assert depr_je["date"] == PERIOD_END
        # Verify DR 6600 / CR 1510
        d6600 = next((ln for ln in depr_je["lines"] if ln["account_number"] == "6600"), None)
        c1510 = next((ln for ln in depr_je["lines"] if ln["account_number"] == "1510"), None)
        assert d6600 and d6600["debit"] == 1500.0
        assert c1510 and c1510["credit"] == 1500.0

    def test_run_idempotent(self, client, parent_entity):
        eid = parent_entity["id"]
        r = client.post(f"{BASE_URL}/api/books/period-close/run",
                        params={"entity_id": eid, "period": TEST_PERIOD}, timeout=20)
        assert r.status_code == 200
        rec = r.json()
        assert rec.get("rerun") is True, "Second run must return rerun=true"
        # No new depreciation journal (still one)
        jes = client.get(f"{BASE_URL}/api/books/journal-entries",
                         params={"entity_id": eid, "source_id": eid,
                                 "include_reversed": True, "limit": 50}).json()
        depr_jes = [j for j in jes if j.get("kind") == f"depreciation:{TEST_PERIOD}"]
        assert len(depr_jes) == 1, f"Idempotent post failed: {len(depr_jes)} depr journals"


# -------- Period Lock Enforcement ----------

class TestPeriodLock:
    invoice_in_locked_id = None
    invoice_after_lock_id = None

    def test_invoice_in_locked_period_no_journal(self, client, parent_entity):
        """Invoice dated 2026-05-15 → CRM creates it but post_journal refuses silently."""
        eid = parent_entity["id"]
        # Find a contact + property to attach (minimum)
        contacts = client.get(f"{BASE_URL}/api/contacts", timeout=10).json()
        if not contacts:
            pytest.skip("No contact available for invoice creation")
        body = {
            "entity_id": eid,
            "invoice_date": "2026-05-15",
            "due_date": "2026-06-15",
            "bill_to_name": "TEST_LockedPeriod",
            "bill_to_company": "TEST_LockedPeriod Co",
            "status": "Sent",
            "line_items": [{"description": "Lock test", "quantity": 1, "unit_price": 1000.0}],
            "subtotal": 1000.0, "total": 1000.0,
        }
        r = client.post(f"{BASE_URL}/api/invoices", json=body, timeout=15)
        if r.status_code not in (200, 201):
            pytest.skip(f"Invoice create failed: {r.status_code} {r.text[:200]}")
        inv = r.json()
        TestPeriodLock.invoice_in_locked_id = inv["id"]
        # Verify no journal entries for this invoice
        jes = client.get(f"{BASE_URL}/api/books/journal-entries",
                         params={"source_id": inv["id"]}, timeout=10).json()
        # Filter to issue kind specifically (could have late_fee etc.)
        issue_jes = [j for j in jes if j.get("kind") == "issue"]
        assert len(issue_jes) == 0, \
            f"Expected no journal for invoice in locked period, got {len(issue_jes)}"

    def test_invoice_after_lock_period_posts(self, client, parent_entity):
        """Invoice dated 2026-06-15 → posts normally."""
        eid = parent_entity["id"]
        body = {
            "entity_id": eid,
            "invoice_date": "2026-06-15",
            "due_date": "2026-07-15",
            "bill_to_name": "TEST_AfterLock",
            "bill_to_company": "TEST_AfterLock Co",
            "status": "Sent",
            "line_items": [{"description": "After lock", "quantity": 1, "unit_price": 2000.0}],
            "subtotal": 2000.0, "total": 2000.0,
        }
        r = client.post(f"{BASE_URL}/api/invoices", json=body, timeout=15)
        if r.status_code not in (200, 201):
            pytest.skip(f"Invoice create failed: {r.status_code}")
        inv = r.json()
        TestPeriodLock.invoice_after_lock_id = inv["id"]
        jes = client.get(f"{BASE_URL}/api/books/journal-entries",
                         params={"source_id": inv["id"]}, timeout=10).json()
        issue_jes = [j for j in jes if j.get("kind") == "issue"]
        assert len(issue_jes) == 1, f"Expected 1 issue journal, got {len(issue_jes)}"
        assert issue_jes[0]["date"] == "2026-06-15"

    def test_zz_cleanup(self, client):
        """Cleanup created invoices."""
        for inv_id in (TestPeriodLock.invoice_in_locked_id, TestPeriodLock.invoice_after_lock_id):
            if inv_id:
                try:
                    client.delete(f"{BASE_URL}/api/invoices/{inv_id}", timeout=10)
                except Exception:
                    pass


# -------- Reopen ----------

class TestReopen:
    def test_reopen_clears_lock(self, client, parent_entity):
        eid = parent_entity["id"]
        r = client.post(f"{BASE_URL}/api/books/period-close/reopen",
                        params={"entity_id": eid, "period": TEST_PERIOD}, timeout=15)
        assert r.status_code == 200, r.text
        rec = r.json()
        assert rec.get("is_reopened") is True
        # new_lock_through should be "" (no other closes)
        assert rec.get("new_lock_through", "") == ""
        # Verify entity lock_through cleared
        ent = client.get(f"{BASE_URL}/api/books/entities/{eid}").json()
        assert ent.get("lock_through", "") == ""


# -------- List ----------

class TestList:
    def test_list_includes_record(self, client, parent_entity):
        r = client.get(f"{BASE_URL}/api/books/period-close/list",
                       params={"entity_id": parent_entity["id"]}, timeout=10)
        assert r.status_code == 200
        out = r.json()
        assert isinstance(out, list)
        found = next((x for x in out if x["period"] == TEST_PERIOD), None)
        assert found is not None
        # Sorted desc by period
        periods = [x["period"] for x in out]
        assert periods == sorted(periods, reverse=True)


# -------- Admin-only ----------

class TestAdminOnly:
    def test_non_admin_run_forbidden(self, client, parent_entity):
        # Create a non-admin user via admin POST /api/users
        sales_email = f"TEST_sales_{uuid.uuid4().hex[:6]}@test.com"
        sales_pw = "test12345"
        reg = client.post(f"{BASE_URL}/api/users",
                          json={"email": sales_email, "password": sales_pw,
                                "name": "TEST Sales", "role": "sales"}, timeout=10)
        if reg.status_code not in (200, 201):
            pytest.skip(f"Admin user-create unavailable: {reg.status_code} {reg.text[:200]}")
        reg_body = reg.json()
        created_uid = (reg_body.get("user") or reg_body).get("id")
        # /api/users returns a server-generated password — use it for login
        sales_pw = reg_body.get("generated_password") or sales_pw
        # Login as the new (non-admin) user
        log = requests.post(f"{BASE_URL}/api/auth/login",
                            json={"email": sales_email, "password": sales_pw}, timeout=10)
        if log.status_code != 200:
            pytest.skip("Login as non-admin failed")
        token = log.json()["access_token"]
        s = requests.Session()
        s.headers.update({"Authorization": f"Bearer {token}",
                          "Content-Type": "application/json"})
        r = s.post(f"{BASE_URL}/api/books/period-close/run",
                   params={"entity_id": parent_entity["id"], "period": "2026-04"}, timeout=10)
        r2 = s.post(f"{BASE_URL}/api/books/period-close/reopen",
                    params={"entity_id": parent_entity["id"], "period": "2026-04"}, timeout=10)
        # cleanup created user (after both calls)
        try:
            if created_uid:
                client.delete(f"{BASE_URL}/api/users/{created_uid}", timeout=10)
        except Exception:
            pass
        assert r.status_code == 403, f"Expected 403 on run, got {r.status_code}"
        assert r2.status_code == 403, f"Expected 403 on reopen, got {r2.status_code}"
