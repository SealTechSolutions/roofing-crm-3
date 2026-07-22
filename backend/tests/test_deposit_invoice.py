"""Regression test for the manual Deposit-Invoice auto-generation endpoint.

Verifies:
  • POST /api/deals/{id}/deposit-invoice drafts a 50% Deposit by default.
  • Custom percentage works and is honored.
  • Idempotent — a second call returns the existing Deposit invoice.
  • Rejects deals with contract_total == 0.
  • Rejects invalid percentages.
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


def _make_deal(token: str, chosen_amount: float = 20000.0) -> str:
    h = {"Authorization": f"Bearer {token}"}
    body = {
        "title": f"_DEPOSIT_INV_TEST_{uuid.uuid4().hex[:6]}",
        "deal_type": "Scope",
        "status": "Won",
        "chosen_amount": chosen_amount,
    }
    r = requests.post(f"{API}/api/deals", json=body, headers=h, timeout=10)
    r.raise_for_status()
    return r.json()["id"]


def _delete_deal(token: str, deal_id: str):
    requests.delete(
        f"{API}/api/deals/{deal_id}",
        headers={"Authorization": f"Bearer {token}"},
        timeout=10,
    )


def test_deposit_invoice_default_50_percent():
    token = _login()
    h = {"Authorization": f"Bearer {token}"}
    deal_id = _make_deal(token, 20000.0)
    try:
        r = requests.post(
            f"{API}/api/deals/{deal_id}/deposit-invoice",
            headers=h, timeout=10,
        )
        assert r.status_code == 200, r.text
        inv = r.json()
        assert inv["invoice_type"] == "Deposit"
        assert inv["status"] == "Draft"
        assert inv["deal_id"] == deal_id
        # 50% of 20000 = 10000, but total may include tax/etc; check line item amount
        assert inv["line_items"][0]["amount"] == 10000.0
    finally:
        _delete_deal(token, deal_id)


def test_deposit_invoice_custom_percentage():
    token = _login()
    h = {"Authorization": f"Bearer {token}"}
    deal_id = _make_deal(token, 10000.0)
    try:
        r = requests.post(
            f"{API}/api/deals/{deal_id}/deposit-invoice?percentage=25",
            headers=h, timeout=10,
        )
        assert r.status_code == 200, r.text
        inv = r.json()
        assert inv["line_items"][0]["amount"] == 2500.0
    finally:
        _delete_deal(token, deal_id)


def test_deposit_invoice_idempotent():
    """Second POST returns the same invoice (does not double-up)."""
    token = _login()
    h = {"Authorization": f"Bearer {token}"}
    deal_id = _make_deal(token, 15000.0)
    try:
        r1 = requests.post(
            f"{API}/api/deals/{deal_id}/deposit-invoice",
            headers=h, timeout=10,
        )
        assert r1.status_code == 200
        first_id = r1.json()["id"]
        r2 = requests.post(
            f"{API}/api/deals/{deal_id}/deposit-invoice",
            headers=h, timeout=10,
        )
        assert r2.status_code == 200
        assert r2.json()["id"] == first_id
    finally:
        _delete_deal(token, deal_id)


def test_deposit_invoice_rejects_zero_contract():
    token = _login()
    h = {"Authorization": f"Bearer {token}"}
    deal_id = _make_deal(token, 0.0)
    try:
        r = requests.post(
            f"{API}/api/deals/{deal_id}/deposit-invoice",
            headers=h, timeout=10,
        )
        assert r.status_code == 400, r.text
    finally:
        _delete_deal(token, deal_id)


def test_deposit_invoice_rejects_bad_percentage():
    token = _login()
    h = {"Authorization": f"Bearer {token}"}
    deal_id = _make_deal(token, 20000.0)
    try:
        for bad in ("0", "-5", "150"):
            r = requests.post(
                f"{API}/api/deals/{deal_id}/deposit-invoice?percentage={bad}",
                headers=h, timeout=10,
            )
            assert r.status_code == 400, f"bad={bad} {r.text}"
    finally:
        _delete_deal(token, deal_id)
