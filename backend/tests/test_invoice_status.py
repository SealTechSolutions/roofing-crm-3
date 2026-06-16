"""Regression tests for invoice status auto-flip rules.

Verifies that PUT /api/invoices/{id} correctly transitions a Draft invoice to
'Partial' or 'Paid' when payment is recorded via the standard editor — this
was a real bug surfaced in iteration_19 where the editor's PUT left a
fully-paid invoice stuck at status='Draft'.
"""
import os
import pathlib
import requests


def _load_base_url():
    env = os.environ.get("REACT_APP_BACKEND_URL")
    if env:
        return env.rstrip("/")
    fpath = pathlib.Path("/app/frontend/.env")
    if fpath.exists():
        for line in fpath.read_text().splitlines():
            if line.startswith("REACT_APP_BACKEND_URL="):
                return line.split("=", 1)[1].strip().rstrip("/")
    raise RuntimeError("REACT_APP_BACKEND_URL not set")


BASE_URL = _load_base_url()


def _auth():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": "admin@roofingcrm.com", "password": "admin123"},
        timeout=30,
    )
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _make_draft(headers, total=1000.0):
    r = requests.post(
        f"{BASE_URL}/api/invoices",
        headers=headers,
        json={
            "invoice_type": "Project Amount",
            "status": "Draft",
            "line_items": [
                {"description": "Test", "quantity": 1, "unit_price": total, "amount": total}
            ],
        },
        timeout=30,
    )
    r.raise_for_status()
    return r.json()["id"]


def _put(headers, iid, patch):
    base = requests.get(f"{BASE_URL}/api/invoices/{iid}", headers=headers, timeout=30).json()
    base.update(patch)
    # The PUT model accepts the InvoiceIn shape (drop server-managed fields)
    for k in ("id", "invoice_number", "created_at", "subtotal", "total", "balance_due"):
        base.pop(k, None)
    r = requests.put(f"{BASE_URL}/api/invoices/{iid}", headers=headers, json=base, timeout=30)
    r.raise_for_status()
    return r.json()


def test_draft_flips_to_paid_when_amount_paid_equals_total():
    h = _auth()
    iid = _make_draft(h, total=500.0)
    try:
        result = _put(h, iid, {"amount_paid": 500.0, "payment_date": "2026-02-12"})
        assert result["status"] == "Paid", f"expected Paid but got {result['status']}"
        assert result["balance_due"] == 0
    finally:
        requests.delete(f"{BASE_URL}/api/invoices/{iid}", headers=h, timeout=30)


def test_draft_flips_to_partial_when_amount_paid_less_than_total():
    h = _auth()
    iid = _make_draft(h, total=1000.0)
    try:
        result = _put(h, iid, {"amount_paid": 250.0, "payment_date": "2026-02-12"})
        assert result["status"] == "Partial", f"expected Partial but got {result['status']}"
        assert result["balance_due"] == 750.0
    finally:
        requests.delete(f"{BASE_URL}/api/invoices/{iid}", headers=h, timeout=30)


def test_draft_with_zero_payment_stays_draft():
    """No payment recorded = stay Draft, never auto-promote."""
    h = _auth()
    iid = _make_draft(h, total=1000.0)
    try:
        # Touch with no payment change
        result = _put(h, iid, {"amount_paid": 0})
        assert result["status"] == "Draft", f"expected Draft but got {result['status']}"
    finally:
        requests.delete(f"{BASE_URL}/api/invoices/{iid}", headers=h, timeout=30)


def test_void_invoice_does_not_auto_change_status():
    h = _auth()
    iid = _make_draft(h, total=1000.0)
    try:
        result = _put(h, iid, {"status": "Void", "amount_paid": 1000})
        assert result["status"] == "Void"
    finally:
        requests.delete(f"{BASE_URL}/api/invoices/{iid}", headers=h, timeout=30)
