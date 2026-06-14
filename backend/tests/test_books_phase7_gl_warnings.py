"""Phase 7 tests — gl_warnings surfaced on invoice/bill POST+PUT when period is locked.

Coverage:
- Invoice POST in locked period -> gl_warnings has type=period_locked side=issuer kind=issue
- Invoice POST in open period -> NO gl_warnings (None / absent)
- Invoice POST with payment in locked period -> TWO warnings (issue + payment)
- Invoice PUT updating only amount_paid in locked period -> TWO warnings
- Inter-Co invoice (open entity, locked counter) -> warning side=counter kind=issue_mirror; issuer journal still posts
- VendorBill POST locked -> kind=bill_received + bill_payment when paid_amount>0
- VendorBill PUT only updating paid_amount -> issuer bill_received + bill_payment
- VendorBill IC mirror -> kind=bill_received_mirror
- status='Draft' / 'Void' -> NEVER yields gl_warnings even when locked
- Cleanup: invoices/bills deleted; period reopened
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

LOCK_PERIOD = "2026-05"          # closes the entity through 2026-05-31
LOCK_THROUGH = "2026-05-31"
LOCKED_DATE = "2026-05-15"       # falls in the locked window
OPEN_DATE = "2026-07-15"         # safely outside locked window


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
    if not parent or len(others) < 1:
        pytest.skip("Need parent + 1 sub-entity")
    return parent, others[0]


@pytest.fixture(scope="session")
def created():
    return {"invoices": [], "bills": [], "locked_parent": False}


@pytest.fixture(scope="session", autouse=True)
def lock_parent_period(client, entities, created):
    """Close 2026-05 on parent entity. Reopen at the end."""
    parent, _ = entities
    # Run close
    r = client.post(
        f"{BASE_URL}/api/books/period-close/run",
        params={"entity_id": parent["id"], "period": LOCK_PERIOD},
        timeout=20,
    )
    # If already closed, server may 4xx; check entity.lock_through directly
    re = client.get(f"{BASE_URL}/api/books/entities", timeout=10).json()
    parent_now = next((e for e in re if e["id"] == parent["id"]), {})
    lt = parent_now.get("lock_through") or ""
    if lt < LOCK_THROUGH:
        pytest.skip(f"Could not lock parent period. lock_through={lt!r}, run-status={r.status_code} body={r.text[:200]}")
    created["locked_parent"] = True
    yield
    # teardown — reopen
    client.post(
        f"{BASE_URL}/api/books/period-close/reopen",
        params={"entity_id": parent["id"], "period": LOCK_PERIOD},
        timeout=20,
    )


# =================== INVOICE ===================

def _mk_invoice(entity_id, **overrides):
    body = {
        "entity_id": entity_id,
        "invoice_number": f"TEST-PL-{uuid.uuid4().hex[:6]}",
        "invoice_date": LOCKED_DATE,
        "line_items": [{"description": "TEST line", "quantity": 1, "unit_price": 1000}],
        "description": "TEST gl_warnings",
        "status": "Issued",
    }
    body.update(overrides)
    return body


class TestInvoiceWarnings:
    def test_invoice_locked_returns_issue_warning(self, client, entities, created):
        parent, _ = entities
        r = client.post(f"{BASE_URL}/api/invoices", json=_mk_invoice(parent["id"]), timeout=15)
        assert r.status_code in (200, 201), r.text
        data = r.json()
        created["invoices"].append(data["id"])
        gw = data.get("gl_warnings")
        assert isinstance(gw, list) and len(gw) >= 1, f"expected gl_warnings list, got {gw!r}"
        w = gw[0]
        assert w["type"] == "period_locked"
        assert w["side"] == "issuer"
        assert w["kind"] == "issue"
        assert w["entity_id"] == parent["id"]
        assert w["posting_date"] == LOCKED_DATE
        assert w["lock_through"] == LOCK_THROUGH
        assert "deferred" in w["message"].lower()
        # CRM still inserted
        rr = client.get(f"{BASE_URL}/api/invoices/{data['id']}", timeout=10)
        assert rr.status_code == 200

    def test_invoice_open_period_no_warning(self, client, entities, created):
        parent, _ = entities
        r = client.post(
            f"{BASE_URL}/api/invoices",
            json=_mk_invoice(parent["id"], invoice_date=OPEN_DATE),
            timeout=15,
        )
        assert r.status_code in (200, 201), r.text
        data = r.json()
        created["invoices"].append(data["id"])
        gw = data.get("gl_warnings")
        assert gw in (None, [], ()), f"expected no warnings, got {gw!r}"

    def test_invoice_locked_with_payment_two_warnings(self, client, entities, created):
        parent, _ = entities
        body = _mk_invoice(
            parent["id"],
            amount_paid=500.0,
            payment_date=LOCKED_DATE,
        )
        r = client.post(f"{BASE_URL}/api/invoices", json=body, timeout=15)
        assert r.status_code in (200, 201), r.text
        data = r.json()
        created["invoices"].append(data["id"])
        gw = data.get("gl_warnings") or []
        kinds = sorted(w["kind"] for w in gw)
        assert kinds == ["issue", "payment"], f"got kinds={kinds}, warnings={gw}"
        for w in gw:
            assert w["type"] == "period_locked"
            assert w["side"] == "issuer"

    def test_invoice_put_amount_paid_returns_warnings(self, client, entities, created):
        """PUT updating only amount_paid on a locked invoice still returns both warnings."""
        parent, _ = entities
        # Re-use an already-locked invoice (with amount_paid initially 0)
        inv_id = created["invoices"][0]
        cur = client.get(f"{BASE_URL}/api/invoices/{inv_id}", timeout=10).json()
        upd = {k: cur[k] for k in cur if k not in ("id", "created_at", "updated_at", "gl_warnings")}
        upd["amount_paid"] = 250.0
        upd["payment_date"] = LOCKED_DATE
        r = client.put(f"{BASE_URL}/api/invoices/{inv_id}", json=upd, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        gw = data.get("gl_warnings") or []
        kinds = sorted(w["kind"] for w in gw)
        assert kinds == ["issue", "payment"], f"got kinds={kinds}, warnings={gw}"

    def test_invoice_ic_open_issuer_locked_counter(self, client, entities, created):
        """Issuer entity is OPEN (sub1), counter is locked (parent). Expect 1 warning side=counter kind=issue_mirror."""
        parent, sub1 = entities
        body = _mk_invoice(
            sub1["id"],
            counter_entity_id=parent["id"],
            invoice_date=LOCKED_DATE,
            invoice_number=f"TEST-IC-{uuid.uuid4().hex[:6]}",
        )
        r = client.post(f"{BASE_URL}/api/invoices", json=body, timeout=15)
        assert r.status_code in (200, 201), r.text
        data = r.json()
        created["invoices"].append(data["id"])
        gw = data.get("gl_warnings") or []
        # Should have exactly one warning: counter mirror
        counter_w = [w for w in gw if w.get("side") == "counter"]
        assert len(counter_w) == 1, f"expected 1 counter warning, got {gw}"
        w = counter_w[0]
        assert w["kind"] == "issue_mirror"
        assert w["entity_id"] == parent["id"]
        assert w["lock_through"] == LOCK_THROUGH
        # Issuer side should NOT warn (sub1 is open)
        issuer_w = [x for x in gw if x.get("side") == "issuer"]
        assert issuer_w == [], f"issuer should have no warnings, got {issuer_w}"

    def test_draft_status_never_warns_even_when_locked(self, client, entities, created):
        parent, _ = entities
        body = _mk_invoice(parent["id"], status="Draft")
        r = client.post(f"{BASE_URL}/api/invoices", json=body, timeout=15)
        assert r.status_code in (200, 201), r.text
        data = r.json()
        created["invoices"].append(data["id"])
        gw = data.get("gl_warnings")
        assert gw in (None, [], ()), f"Draft must not yield gl_warnings, got {gw!r}"

    def test_void_status_never_warns_even_when_locked(self, client, entities, created):
        parent, _ = entities
        body = _mk_invoice(parent["id"], status="Void")
        r = client.post(f"{BASE_URL}/api/invoices", json=body, timeout=15)
        assert r.status_code in (200, 201), r.text
        data = r.json()
        created["invoices"].append(data["id"])
        gw = data.get("gl_warnings")
        assert gw in (None, [], ()), f"Void must not yield gl_warnings, got {gw!r}"


# =================== VENDOR BILL ===================

def _mk_bill(entity_id, **overrides):
    body = {
        "entity_id": entity_id,
        "vendor_name": "TEST Vendor PL",
        "bill_number": f"TBILL-{uuid.uuid4().hex[:6]}",
        "bill_date": LOCKED_DATE,
        "received_date": LOCKED_DATE,
        "subtotal": 800.0,
        "total": 800.0,
        "status": "Received",
        "lines": [{"description": "TEST line", "quantity": 1, "unit_price": 800, "amount": 800}],
    }
    body.update(overrides)
    return body


class TestBillWarnings:
    def test_bill_locked_returns_received_warning(self, client, entities, created):
        parent, _ = entities
        r = client.post(f"{BASE_URL}/api/vendor-bills", json=_mk_bill(parent["id"]), timeout=15)
        assert r.status_code in (200, 201), r.text
        data = r.json()
        created["bills"].append(data["id"])
        gw = data.get("gl_warnings") or []
        assert len(gw) >= 1, f"expected warning, got {gw}"
        w = gw[0]
        assert w["type"] == "period_locked"
        assert w["side"] == "buyer"
        assert w["kind"] == "bill_received"
        assert w["entity_id"] == parent["id"]
        assert w["lock_through"] == LOCK_THROUGH

    def test_bill_open_no_warning(self, client, entities, created):
        parent, _ = entities
        r = client.post(
            f"{BASE_URL}/api/vendor-bills",
            json=_mk_bill(parent["id"], bill_date=OPEN_DATE, received_date=OPEN_DATE),
            timeout=15,
        )
        assert r.status_code in (200, 201), r.text
        data = r.json()
        created["bills"].append(data["id"])
        gw = data.get("gl_warnings")
        assert gw in (None, [], ()), f"open bill should have no warnings, got {gw!r}"

    def test_bill_locked_with_payment_two_warnings(self, client, entities, created):
        parent, _ = entities
        body = _mk_bill(parent["id"], paid_amount=200.0, paid_date=LOCKED_DATE)
        r = client.post(f"{BASE_URL}/api/vendor-bills", json=body, timeout=15)
        assert r.status_code in (200, 201), r.text
        data = r.json()
        created["bills"].append(data["id"])
        gw = data.get("gl_warnings") or []
        kinds = sorted(w["kind"] for w in gw)
        assert kinds == ["bill_payment", "bill_received"], f"got kinds={kinds}"

    def test_bill_put_paid_amount_returns_warnings(self, client, entities, created):
        parent, _ = entities
        bill_id = created["bills"][0]
        cur = client.get(f"{BASE_URL}/api/vendor-bills/{bill_id}", timeout=10).json()
        upd = {k: cur[k] for k in cur if k not in ("id", "created_at", "updated_at", "gl_warnings")}
        upd["paid_amount"] = 100.0
        upd["paid_date"] = LOCKED_DATE
        r = client.put(f"{BASE_URL}/api/vendor-bills/{bill_id}", json=upd, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        gw = data.get("gl_warnings") or []
        kinds = sorted(w["kind"] for w in gw)
        assert kinds == ["bill_payment", "bill_received"], f"got kinds={kinds}, gw={gw}"

    def test_bill_ic_open_buyer_locked_counter(self, client, entities, created):
        parent, sub1 = entities
        body = _mk_bill(
            sub1["id"],
            counter_entity_id=parent["id"],
            bill_date=LOCKED_DATE,
            received_date=LOCKED_DATE,
            bill_number=f"TBILL-IC-{uuid.uuid4().hex[:6]}",
        )
        r = client.post(f"{BASE_URL}/api/vendor-bills", json=body, timeout=15)
        assert r.status_code in (200, 201), r.text
        data = r.json()
        created["bills"].append(data["id"])
        gw = data.get("gl_warnings") or []
        counter_w = [w for w in gw if w.get("side") == "counter"]
        assert len(counter_w) == 1, f"expected 1 counter warning, got {gw}"
        assert counter_w[0]["kind"] == "bill_received_mirror"
        assert counter_w[0]["entity_id"] == parent["id"]
        # buyer side should not warn (sub1 open)
        buyer_w = [x for x in gw if x.get("side") == "buyer"]
        assert buyer_w == [], f"buyer should have no warnings, got {buyer_w}"

    def test_bill_draft_no_warning(self, client, entities, created):
        parent, _ = entities
        body = _mk_bill(parent["id"], status="Draft")
        r = client.post(f"{BASE_URL}/api/vendor-bills", json=body, timeout=15)
        assert r.status_code in (200, 201), r.text
        data = r.json()
        created["bills"].append(data["id"])
        gw = data.get("gl_warnings")
        assert gw in (None, [], ()), f"Draft bill must not yield gl_warnings, got {gw!r}"


# =================== REGRESSION ===================

class TestReopenClearsWarning:
    """After reopening the period, posting the same date no longer warns."""
    def test_reopen_then_no_warning(self, client, entities, created):
        parent, _ = entities
        # Reopen the locked period
        rr = client.post(
            f"{BASE_URL}/api/books/period-close/reopen",
            params={"entity_id": parent["id"], "period": LOCK_PERIOD},
            timeout=15,
        )
        assert rr.status_code in (200, 201, 204), rr.text
        # Now create invoice on locked date — should have no warnings
        r = client.post(f"{BASE_URL}/api/invoices", json=_mk_invoice(parent["id"]), timeout=15)
        assert r.status_code in (200, 201), r.text
        data = r.json()
        created["invoices"].append(data["id"])
        gw = data.get("gl_warnings")
        assert gw in (None, [], ()), f"after reopen, no warnings expected, got {gw!r}"
        # Re-lock for any remaining tests (none in this class run after) — skipped
        # Setting created["locked_parent"]=False so teardown doesn't re-reopen
        created["locked_parent"] = False


# =================== CLEANUP ===================

class TestZCleanup:
    def test_cleanup_invoices_and_bills(self, client, created):
        for inv_id in created["invoices"]:
            try:
                client.delete(f"{BASE_URL}/api/invoices/{inv_id}", timeout=10)
            except Exception:
                pass
        for bill_id in created["bills"]:
            try:
                client.delete(f"{BASE_URL}/api/vendor-bills/{bill_id}", timeout=10)
            except Exception:
                pass
