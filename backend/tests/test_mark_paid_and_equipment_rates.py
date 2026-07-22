"""Regression tests for:

  • POST /api/invoices/{id}/mark-paid — one-click "Mark Paid" flow
  • GET/PUT /api/settings/equipment-rates — editable equipment rental rates
"""
import os
import uuid

import requests

API = (os.environ.get("REACT_APP_BACKEND_URL") or "http://localhost:8001").rstrip("/")
ADMIN_EMAIL = "darren@sealtechsolutions.co"
ADMIN_PASSWORD = "admin123"


def _login():
    r = requests.post(
        f"{API}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=10,
    )
    r.raise_for_status()
    return r.json()["access_token"]


def _make_deal_with_deposit(token, contract=8000.0, pct=50.0):
    h = {"Authorization": f"Bearer {token}"}
    deal = requests.post(
        f"{API}/api/deals",
        json={
            "title": f"_MARKPAID_TEST_{uuid.uuid4().hex[:6]}",
            "deal_type": "Scope",
            "status": "Won",
            "chosen_amount": contract,
        },
        headers=h, timeout=10,
    ).json()
    inv = requests.post(
        f"{API}/api/deals/{deal['id']}/deposit-invoice?percentage={pct}",
        headers=h, timeout=10,
    ).json()
    return deal, inv, h


def _delete_deal(h, deal_id):
    requests.delete(f"{API}/api/deals/{deal_id}", headers=h, timeout=10)


# ── mark-paid ────────────────────────────────────────────────────────────────

def test_mark_paid_flips_status_and_sets_amount():
    token = _login()
    deal, inv, h = _make_deal_with_deposit(token, contract=8000.0)
    try:
        r = requests.post(
            f"{API}/api/invoices/{inv['id']}/mark-paid",
            json={}, headers=h, timeout=10,
        )
        assert r.status_code == 200, r.text
        out = r.json()
        assert out["status"] == "Paid"
        assert out["amount_paid"] == out["total"]
        assert out["payment_date"], "payment_date should be set to today"
    finally:
        _delete_deal(h, deal["id"])


def test_mark_paid_idempotent():
    token = _login()
    deal, inv, h = _make_deal_with_deposit(token, contract=8000.0)
    try:
        # First call
        r1 = requests.post(f"{API}/api/invoices/{inv['id']}/mark-paid", json={}, headers=h, timeout=10)
        assert r1.status_code == 200
        first_paid_date = r1.json()["payment_date"]
        # Second call — should be a no-op returning the same state
        r2 = requests.post(f"{API}/api/invoices/{inv['id']}/mark-paid", json={}, headers=h, timeout=10)
        assert r2.status_code == 200
        assert r2.json()["status"] == "Paid"
        assert r2.json()["amount_paid"] == r1.json()["amount_paid"]
        # payment_date shouldn't change on the re-call
        assert r2.json()["payment_date"] == first_paid_date
    finally:
        _delete_deal(h, deal["id"])


def test_mark_paid_honors_custom_payment_date():
    token = _login()
    deal, inv, h = _make_deal_with_deposit(token, contract=6000.0)
    try:
        r = requests.post(
            f"{API}/api/invoices/{inv['id']}/mark-paid",
            json={"payment_date": "2026-01-15"},
            headers=h, timeout=10,
        )
        assert r.status_code == 200
        assert r.json()["payment_date"] == "2026-01-15"
    finally:
        _delete_deal(h, deal["id"])


def test_mark_paid_404_on_unknown_invoice():
    token = _login()
    h = {"Authorization": f"Bearer {token}"}
    r = requests.post(
        f"{API}/api/invoices/no-such-invoice/mark-paid",
        json={}, headers=h, timeout=10,
    )
    assert r.status_code == 404


# ── equipment-rates ──────────────────────────────────────────────────────────

def test_equipment_rates_get_returns_defaults():
    token = _login()
    h = {"Authorization": f"Bearer {token}"}
    r = requests.get(f"{API}/api/settings/equipment-rates", headers=h, timeout=10)
    assert r.status_code == 200
    out = r.json()
    assert "rates" in out
    # Default table should include the six seeded types at minimum.
    for t in ("Storage Container", "Porta-Potty", "Forklift", "Manlift", "Dumpster", "Scaffolding"):
        assert t in out["rates"], f"missing default: {t}"


def test_equipment_rates_put_persists_and_merges():
    token = _login()
    h = {"Authorization": f"Bearer {token}"}
    body = {
        "rates": {
            "Storage Container": 300.0,
            "Boom Lift":         950.0,  # new custom type
        }
    }
    r = requests.put(f"{API}/api/settings/equipment-rates", json=body, headers=h, timeout=10)
    assert r.status_code == 200, r.text
    saved = r.json()["rates"]
    assert saved["Storage Container"] == 300.0
    assert saved["Boom Lift"] == 950.0
    # Defaults not in the payload should remain visible via merge.
    assert saved["Forklift"] > 0


def test_equipment_rates_put_rejects_negative():
    token = _login()
    h = {"Authorization": f"Bearer {token}"}
    body = {"rates": {"Trash Compactor": -50.0}}
    r = requests.put(f"{API}/api/settings/equipment-rates", json=body, headers=h, timeout=10)
    assert r.status_code == 400, r.text


def test_equipment_rates_put_rejects_bad_shape():
    token = _login()
    h = {"Authorization": f"Bearer {token}"}
    r = requests.put(f"{API}/api/settings/equipment-rates", json={"rates": "not-a-dict"}, headers=h, timeout=10)
    assert r.status_code == 400
    r = requests.put(f"{API}/api/settings/equipment-rates", json={"rates": {}}, headers=h, timeout=10)
    assert r.status_code == 400
