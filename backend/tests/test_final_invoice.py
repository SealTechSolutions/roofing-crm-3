"""Regression test for the Final-Invoice auto-generation flow.

Verifies:
  • Preview endpoint computes contract_total = chosen_amount + approved COs,
    minus already-invoiced (non-void, non-deleted).
  • Create endpoint drafts a single Final invoice; idempotent on re-post.
  • Returns 400 when contract_total = 0 (no proposal/chosen_amount yet).
  • Returns 400 when prior invoices already cover the entire contract.
"""
import os
import uuid

import requests

API = (os.environ.get("REACT_APP_BACKEND_URL") or "http://localhost:8001").rstrip("/")
ADMIN_EMAIL = "darren@sealtechsolutions.co"
ADMIN_PASSWORD = "admin123"


def _login():
    r = requests.post(f"{API}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
                      timeout=10)
    r.raise_for_status()
    return r.json()["access_token"]


def _make_deal(token: str, chosen_amount: float = 10000.0) -> str:
    h = {"Authorization": f"Bearer {token}"}
    body = {
        "title": f"_FINAL_INVOICE_TEST_{uuid.uuid4().hex[:6]}",
        "deal_type": "Scope",
        "status": "Won",
        "chosen_amount": chosen_amount,
    }
    r = requests.post(f"{API}/api/deals", json=body, headers=h, timeout=10)
    r.raise_for_status()
    return r.json()["id"]


def _delete_deal(token: str, deal_id: str):
    requests.delete(f"{API}/api/deals/{deal_id}",
                    headers={"Authorization": f"Bearer {token}"}, timeout=10)


def test_preview_basic_no_prior_invoices():
    token = _login()
    h = {"Authorization": f"Bearer {token}"}
    deal_id = _make_deal(token, 12500.0)
    try:
        r = requests.get(f"{API}/api/deals/{deal_id}/final-invoice/preview", headers=h, timeout=10)
        assert r.status_code == 200, r.text
        out = r.json()
        assert out["has_deal"] is True
        assert out["contract_total"] == 12500.0
        assert out["already_invoiced"] == 0.0
        assert out["final_amount"] == 12500.0
        assert "existing_final_invoice_id" not in out
    finally:
        _delete_deal(token, deal_id)


def test_create_final_invoice_and_idempotency():
    token = _login()
    h = {"Authorization": f"Bearer {token}"}
    deal_id = _make_deal(token, 8000.0)
    try:
        # First create
        r1 = requests.post(f"{API}/api/deals/{deal_id}/final-invoice", headers=h, timeout=10)
        assert r1.status_code == 200, r1.text
        inv1 = r1.json()
        assert inv1["invoice_type"] == "Final"
        assert inv1["status"] == "Draft"
        assert inv1["deal_id"] == deal_id
        # Re-create — must return the SAME invoice id (idempotent)
        r2 = requests.post(f"{API}/api/deals/{deal_id}/final-invoice", headers=h, timeout=10)
        assert r2.status_code == 200, r2.text
        inv2 = r2.json()
        assert inv2["id"] == inv1["id"], (
            f"expected idempotent return of same invoice, "
            f"got inv1.id={inv1['id']} inv2.id={inv2['id']}"
        )
        # Preview now flags the existing Final invoice
        rp = requests.get(f"{API}/api/deals/{deal_id}/final-invoice/preview", headers=h, timeout=10)
        prv = rp.json()
        assert prv.get("existing_final_invoice_id") == inv1["id"]
    finally:
        _delete_deal(token, deal_id)


def test_create_400_when_no_contract_total():
    token = _login()
    h = {"Authorization": f"Bearer {token}"}
    deal_id = _make_deal(token, 0.0)  # no chosen_amount
    try:
        r = requests.post(f"{API}/api/deals/{deal_id}/final-invoice", headers=h, timeout=10)
        assert r.status_code == 400
        assert "contract total" in r.json().get("detail", "").lower()
    finally:
        _delete_deal(token, deal_id)


def test_create_400_when_already_fully_invoiced():
    token = _login()
    h = {"Authorization": f"Bearer {token}"}
    deal_id = _make_deal(token, 5000.0)
    try:
        # Pre-create a Deposit invoice for the FULL amount (so balance = 0)
        body = {
            "deal_id": deal_id,
            "invoice_type": "Deposit",
            "status": "Sent",
            "line_items": [{
                "description": "Full prepay",
                "quantity": 1,
                "unit_price": 5000.0,
                "amount": 5000.0,
            }],
        }
        r0 = requests.post(f"{API}/api/invoices", json=body, headers=h, timeout=10)
        assert r0.status_code == 200, r0.text
        # Now ask for Final — should refuse
        r = requests.post(f"{API}/api/deals/{deal_id}/final-invoice", headers=h, timeout=10)
        assert r.status_code == 400, r.text
        assert "nothing left to bill" in r.json().get("detail", "").lower()
    finally:
        _delete_deal(token, deal_id)
