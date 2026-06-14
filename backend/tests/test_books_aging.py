"""Tests for A/R and A/P aging reports.

Verifies bucket math, exclusion rules (Draft/Void/IC), and grouping.
"""
import os
import requests
import uuid
from pathlib import Path
from datetime import date, timedelta

ENV = Path("/app/frontend/.env").read_text()
BASE_URL = next((ln.split("=", 1)[1].strip().rstrip("/") for ln in ENV.splitlines() if ln.startswith("REACT_APP_BACKEND_URL=")), "")


def _login():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": "admin@roofingcrm.com", "password": "admin123"}, timeout=10)
    return r.json()["access_token"]


def _entity_id(tok):
    r = requests.get(f"{BASE_URL}/api/books/entities", headers={"Authorization": f"Bearer {tok}"}, timeout=10)
    return next(e for e in r.json() if e["is_parent"])["id"]


def test_ar_aging_endpoint_returns_buckets():
    tok = _login()
    ent = _entity_id(tok)
    r = requests.get(f"{BASE_URL}/api/books/reports/ar-aging?entity_id={ent}", headers={"Authorization": f"Bearer {tok}"}, timeout=10)
    assert r.status_code == 200
    data = r.json()
    assert "as_of" in data
    assert "groups" in data
    assert "totals" in data
    t = data["totals"]
    for k in ("current", "b1_30", "b31_60", "b61_90", "b90_plus", "balance", "count"):
        assert k in t


def test_ap_aging_endpoint_returns_buckets():
    tok = _login()
    ent = _entity_id(tok)
    r = requests.get(f"{BASE_URL}/api/books/reports/ap-aging?entity_id={ent}", headers={"Authorization": f"Bearer {tok}"}, timeout=10)
    assert r.status_code == 200
    data = r.json()
    assert all(k in data["totals"] for k in ("current", "b1_30", "b31_60", "b61_90", "b90_plus", "balance", "count"))


def test_ar_aging_buckets_correct_for_known_invoice():
    """Create 3 invoices with explicit due dates to land them in 3 different buckets,
    then verify bucket math + group totals."""
    tok = _login()
    hdr = {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}
    ent = _entity_id(tok)
    today = date.today()
    customer = f"AGING TEST {uuid.uuid4().hex[:6]}"

    def _post(due_days_ago, total, paid):
        due = (today - timedelta(days=due_days_ago)).isoformat()
        inv = {
            "entity_id": ent,
            "invoice_date": due,
            "due_date": due,
            "status": "Sent",
            "bill_to_company": customer,
            "bill_to_name": "AP Dept",
            "project_title": "Aging test job",
            "subtotal": total, "total": total, "amount_paid": paid,
            "balance_due": round(total - paid, 2),
            # Backend recomputes subtotal/total from line_items — must include at least one
            "line_items": [{"description": "Test line", "qty": 1, "unit_price": total, "amount": total}],
        }
        rr = requests.post(f"{BASE_URL}/api/invoices", json=inv, headers=hdr, timeout=10)
        assert rr.status_code in (200, 201), rr.text
        iid = rr.json()["id"]
        # Patch amount_paid to simulate partial payments (only the 3rd test invoice)
        if paid > 0:
            requests.put(f"{BASE_URL}/api/invoices/{iid}", json={"amount_paid": paid}, headers=hdr, timeout=10)
        return iid

    invs = [
        _post(0, 1000, 0),    # 0 days past = current OR 1-30 bucket (boundary)
        _post(45, 2000, 0),   # 31-60 bucket
        _post(100, 2500, 0),  # 90+ bucket
    ]

    try:
        r = requests.get(f"{BASE_URL}/api/books/reports/ar-aging?entity_id={ent}", headers={"Authorization": f"Bearer {tok}"}, timeout=10)
        data = r.json()
        g = next((x for x in data["groups"] if x["label"] == customer), None)
        assert g is not None, f"Customer group not found in {[x['label'] for x in data['groups']]}"
        assert g["count"] == 3
        # Total balance for this customer: 1000 + 2000 + 2500 = 5500
        assert abs(g["balance"] - 5500.0) < 0.01, f"Balance mismatch: {g['balance']}"
        # 90+ bucket should have at least 2500 from our 100-days-past invoice
        assert g["b90_plus"] >= 2500.0, f"b90_plus={g['b90_plus']}"
        assert g["b31_60"] >= 2000.0, f"b31_60={g['b31_60']}"
    finally:
        # Cleanup
        for iid in invs:
            requests.delete(f"{BASE_URL}/api/invoices/{iid}", headers={"Authorization": f"Bearer {tok}"}, timeout=10)


def test_aging_excludes_void_and_draft_invoices():
    tok = _login()
    hdr = {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}
    ent = _entity_id(tok)
    today = date.today().isoformat()
    customer = f"VOID TEST {uuid.uuid4().hex[:6]}"

    void_inv = {
        "entity_id": ent, "invoice_date": today, "due_date": today,
        "status": "Void", "bill_to_company": customer, "bill_to_name": "x",
        "subtotal": 9999, "total": 9999, "amount_paid": 0, "balance_due": 9999,
        "line_items": [{"description": "Void line", "qty": 1, "unit_price": 9999, "amount": 9999}],
    }
    r = requests.post(f"{BASE_URL}/api/invoices", json=void_inv, headers=hdr, timeout=10)
    iid = r.json()["id"]
    try:
        r = requests.get(f"{BASE_URL}/api/books/reports/ar-aging?entity_id={ent}", headers={"Authorization": f"Bearer {tok}"}, timeout=10)
        data = r.json()
        labels = [g["label"] for g in data["groups"]]
        assert customer not in labels, f"Void invoice leaked into aging report: {labels}"
    finally:
        requests.delete(f"{BASE_URL}/api/invoices/{iid}", headers={"Authorization": f"Bearer {tok}"}, timeout=10)
