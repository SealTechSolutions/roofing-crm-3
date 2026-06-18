"""Regression tests for the public proposal-signing rules.

Key invariants:
  • Signing only PROMOTES pre-Won statuses (Lead / Past Lead / Assessment /
    Scope Sent) up to "Won". A deal already past Won (In Progress, Closed,
    etc.) keeps its current status — signing must never roll a live project
    backwards.
  • Deposit auto-invoice fires only on the first promotion to Won, not on
    re-signings of an already-advanced deal.
  • The signature, signer name/email/IP, and status_history entry are
    recorded in ALL cases (legal hold).
"""
import os
import secrets
import uuid
from datetime import datetime, timezone

import pytest
import requests
from pymongo import MongoClient

API = (os.environ.get("REACT_APP_BACKEND_URL") or "http://localhost:8001").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME")
ADMIN_EMAIL = "darren@sealtechsolutions.co"
ADMIN_PASSWORD = "admin123"


@pytest.fixture(scope="module")
def db():
    cli = MongoClient(MONGO_URL)
    return cli[DB_NAME]


def _login():
    r = requests.post(f"{API}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
                      timeout=10)
    r.raise_for_status()
    return r.json()["access_token"]


def _make_deal(token: str, status: str = "Lead", chosen_amount: float = 4000.0) -> dict:
    h = {"Authorization": f"Bearer {token}"}
    body = {
        "title": f"_SIGN_TEST_{uuid.uuid4().hex[:6]}",
        "deal_type": "Scope",
        "status": status,
        "chosen_amount": chosen_amount,
    }
    r = requests.post(f"{API}/api/deals", json=body, headers=h, timeout=10)
    r.raise_for_status()
    return r.json()


def _share_token(db, deal_id: str) -> str:
    """Mint a proposal_sign_token directly in Mongo since there's no public
    API to do it — the real app mints it via the scope-email send flow."""
    tok = secrets.token_urlsafe(24)
    db.deals.update_one({"id": deal_id}, {"$set": {"proposal_sign_token": tok}})
    return tok


def _public_sign(share_token: str, **kwargs):
    body = {
        "signer_name": kwargs.get("signer_name", "Test Signer"),
        "signer_email": kwargs.get("signer_email", "test@example.com"),
        "accepted": True,
    }
    body.update({k: v for k, v in kwargs.items() if k not in ("signer_name", "signer_email")})
    return requests.post(f"{API}/api/public/proposal/{share_token}/sign", json=body, timeout=10)


def _delete_deal(token: str, deal_id: str):
    requests.delete(f"{API}/api/deals/{deal_id}",
                    headers={"Authorization": f"Bearer {token}"}, timeout=10)


def test_lead_signing_promotes_to_won(db):
    tk = _login()
    deal = _make_deal(tk, status="Lead", chosen_amount=10000)
    try:
        share = _share_token(db, deal["id"])
        r = _public_sign(share, signer_name="Acme Customer", signer_email="acme@example.com")
        assert r.status_code == 200, r.text
        out = r.json()
        assert out["status"] == "Won", f"expected promotion to Won, got {out['status']}"
        assert out.get("deposit_invoice_id"), "expected auto-deposit invoice on first sign of a Lead"
    finally:
        _delete_deal(tk, deal["id"])


def test_in_progress_deal_signing_does_not_rollback(db):
    tk = _login()
    deal = _make_deal(tk, status="In Progress", chosen_amount=10000)
    try:
        share = _share_token(db, deal["id"])
        r = _public_sign(share, signer_name="Late Signer", signer_email="late@example.com")
        assert r.status_code == 200, r.text
        out = r.json()
        assert out["status"] == "In Progress", (
            f"signing must not roll back live project — got '{out['status']}'"
        )
        assert not out.get("deposit_invoice_id"), (
            "deposit auto-invoice must NOT fire on a re-sign of an already-advanced deal"
        )
        h = {"Authorization": f"Bearer {tk}"}
        rd = requests.get(f"{API}/api/deals/{deal['id']}", headers=h, timeout=10)
        rd.raise_for_status()
        d = rd.json()
        assert d.get("scope_signed_at"), "scope_signed_at must be stamped"
        assert d.get("scope_signed_by_name") == "Late Signer"
        last = (d.get("status_history") or [])[-1]
        assert last.get("label") == "Proposal accepted (public sign-off)"
        assert last.get("from") == "In Progress"
        assert last.get("to") == "In Progress"
    finally:
        _delete_deal(tk, deal["id"])


def test_closed_deal_signing_does_not_rollback(db):
    tk = _login()
    deal = _make_deal(tk, status="Closed", chosen_amount=10000)
    try:
        share = _share_token(db, deal["id"])
        r = _public_sign(share, signer_name="Re-Signer", signer_email="resign@example.com")
        assert r.status_code == 200, r.text
        out = r.json()
        assert out["status"] == "Closed", f"signing must not roll Closed back — got '{out['status']}'"
        assert not out.get("deposit_invoice_id")
    finally:
        _delete_deal(tk, deal["id"])


def test_scope_sent_promotes_to_won(db):
    tk = _login()
    deal = _make_deal(tk, status="Scope Sent", chosen_amount=10000)
    try:
        share = _share_token(db, deal["id"])
        r = _public_sign(share, signer_name="Promoter", signer_email="prom@example.com")
        assert r.status_code == 200, r.text
        out = r.json()
        assert out["status"] == "Won"
    finally:
        _delete_deal(tk, deal["id"])
