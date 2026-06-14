"""End-to-end pytest covering:
  • Cash Flow Statement endpoint shape, math invariants, reconciliation
  • Per-entity late_fee_rate_pct (GET/PUT persistence, default 1.5)
  • Per-contact late_fee_rate_pct override + statement-summary resolution
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@roofingcrm.com"
ADMIN_PW = "admin123"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PW}, timeout=20)
    assert r.status_code == 200, f"login failed {r.status_code}: {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def auth(token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def entity_id(auth):
    r = auth.get(f"{API}/books/entities", timeout=20)
    assert r.status_code == 200, r.text
    ents = r.json()
    assert ents, "Expected at least one seeded entity"
    # Prefer SealTech Holdings if present
    for e in ents:
        if "SealTech" in (e.get("name") or ""):
            return e["id"]
    return ents[0]["id"]


# ---------- Cash Flow ----------

class TestCashFlow:
    def test_endpoint_shape_and_reconciliation(self, auth, entity_id):
        r = auth.get(
            f"{API}/books/reports/cash-flow",
            params={"entity_id": entity_id, "date_from": "2025-01-01", "date_to": "2026-12-31"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        # Top-level fields
        for k in ("entity_id", "date_from", "date_to", "operating", "investing", "financing", "totals"):
            assert k in d, f"missing top-level key {k}"
        # Operating section
        op = d["operating"]
        for k in ("net_income", "depreciation", "working_capital_items", "working_capital_total", "total"):
            assert k in op, f"operating missing {k}"
        assert isinstance(op["working_capital_items"], list)
        # Investing/Financing
        for sec in ("investing", "financing"):
            assert "items" in d[sec] and "total" in d[sec]
            assert isinstance(d[sec]["items"], list)
        # Totals
        t = d["totals"]
        for k in ("net_change_in_cash", "beginning_cash", "ending_cash", "actual_cash_change", "reconciliation_diff", "reconciled"):
            assert k in t, f"totals missing {k}"
        # Invariants
        op_calc = float(op["net_income"]) + float(op["depreciation"]) + float(op["working_capital_total"])
        assert abs(op_calc - float(op["total"])) < 0.01, f"operating total mismatch {op_calc} vs {op['total']}"
        net_change_calc = float(op["total"]) + float(d["investing"]["total"]) + float(d["financing"]["total"])
        assert abs(net_change_calc - float(t["net_change_in_cash"])) < 0.01
        delta_calc = float(t["ending_cash"]) - float(t["beginning_cash"])
        assert abs(delta_calc - float(t["actual_cash_change"])) < 0.01, f"end-begin={delta_calc} actual={t['actual_cash_change']}"
        # Reconciliation should be True (or diff ~ 0)
        assert t["reconciled"] is True or abs(float(t["reconciliation_diff"])) < 0.01, \
            f"Not reconciled: diff={t['reconciliation_diff']}, reconciled={t['reconciled']}"


# ---------- Entity late_fee_rate_pct ----------

class TestEntityLateFee:
    def test_entities_have_field_default(self, auth):
        r = auth.get(f"{API}/books/entities", timeout=20)
        assert r.status_code == 200
        ents = r.json()
        assert ents
        for e in ents:
            assert "late_fee_rate_pct" in e, f"Entity {e.get('id')} missing late_fee_rate_pct"
            # default seeded value should be 1.5
            assert float(e["late_fee_rate_pct"]) == 1.5

    def test_put_updates_and_persists(self, auth, entity_id):
        # GET current entity
        r = auth.get(f"{API}/books/entities", timeout=20)
        ent = next(e for e in r.json() if e["id"] == entity_id)
        original_rate = ent.get("late_fee_rate_pct", 1.5)
        # Build minimal payload — mirror what frontend sends
        payload = {k: ent[k] for k in ("name", "legal_name", "ein", "address", "city", "state", "zip", "phone", "email", "logo_url", "default_currency") if k in ent}
        payload["late_fee_rate_pct"] = 2.5
        r2 = auth.put(f"{API}/books/entities/{entity_id}", json=payload, timeout=20)
        assert r2.status_code == 200, f"PUT failed: {r2.status_code} {r2.text}"
        # Verify GET reflects the change
        r3 = auth.get(f"{API}/books/entities", timeout=20)
        new_ent = next(e for e in r3.json() if e["id"] == entity_id)
        assert float(new_ent["late_fee_rate_pct"]) == 2.5
        # Cleanup — reset to original (typically 1.5)
        payload["late_fee_rate_pct"] = float(original_rate)
        r4 = auth.put(f"{API}/books/entities/{entity_id}", json=payload, timeout=20)
        assert r4.status_code == 200


# ---------- Contact late_fee_rate_pct override + statement summary ----------

class TestContactLateFeeOverride:
    contact_with_override = None
    contact_no_override = None

    def test_create_contact_with_override(self, auth):
        payload = {
            "contact_name": "TEST LateFee Override",
            "company_name": "TEST_LateFeeOverrideCo",
            "email": "test_latefee_override@example.com",
            "late_fee_rate_pct": 1.0,
        }
        r = auth.post(f"{API}/contacts", json=payload, timeout=20)
        assert r.status_code in (200, 201), r.text
        c = r.json()
        assert c.get("late_fee_rate_pct") == 1.0
        TestContactLateFeeOverride.contact_with_override = c["id"]
        # GET to verify persistence
        r2 = auth.get(f"{API}/contacts/{c['id']}", timeout=20)
        assert r2.status_code == 200
        assert r2.json().get("late_fee_rate_pct") == 1.0

    def test_create_contact_no_override(self, auth):
        payload = {
            "contact_name": "TEST LateFee NoOverride",
            "company_name": "TEST_LateFeeNoOverrideCo",
            "email": "test_latefee_no_override@example.com",
        }
        r = auth.post(f"{API}/contacts", json=payload, timeout=20)
        assert r.status_code in (200, 201), r.text
        c = r.json()
        # Should be null/missing
        assert c.get("late_fee_rate_pct") in (None,)
        TestContactLateFeeOverride.contact_no_override = c["id"]

    def test_statement_summary_uses_override(self, auth):
        cid = TestContactLateFeeOverride.contact_with_override
        assert cid
        r = auth.get(f"{API}/contacts/{cid}/statement-summary", timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "late_fee_rate_pct" in d
        assert float(d["late_fee_rate_pct"]) == 1.0

    def test_statement_summary_falls_back_to_entity(self, auth):
        cid = TestContactLateFeeOverride.contact_no_override
        assert cid
        r = auth.get(f"{API}/contacts/{cid}/statement-summary", timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "late_fee_rate_pct" in d
        assert float(d["late_fee_rate_pct"]) == 1.5

    def test_cleanup_contacts(self, auth):
        for cid in (TestContactLateFeeOverride.contact_with_override, TestContactLateFeeOverride.contact_no_override):
            if cid:
                auth.delete(f"{API}/contacts/{cid}", timeout=20)
