"""Regression tests for the public proposal-signing flow.

Verifies the full Lead → Won close-the-loop pipeline:
  1. POSTing to /spec-sheet/email mints a proposal_sign_token on the deal.
  2. The public viewer endpoint requires no auth and returns the scope.
  3. POST /api/public/proposal/{token}/sign with `accepted=true` flips the
     deal status to Won, stamps audit fields, appends status_history.
  4. Re-signing the same token is idempotent.
  5. Required-field validation (signer_name, accepted).
  6. Unknown tokens 404 (no information leak).
"""
import os
import pathlib
import base64
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


def _mint_token_via_email_send(h, deal_id):
    """Use the real /spec-sheet/email path so the token-mint side-effect runs.
    Skip the test if Gmail isn't configured in this env."""
    r = requests.post(
        f"{BASE_URL}/api/deals/{deal_id}/spec-sheet/email",
        headers=h,
        json={
            "to_email": "admin@roofingcrm.com",
            "cc_email": "",
            "message": "regression test",
            "library_file_ids": [],
        },
        timeout=90,
    )
    if r.status_code == 500 and "Gmail" in r.text:
        import pytest
        pytest.skip("Gmail not configured; cannot mint via email send.")
    assert r.status_code == 200, r.text
    deal = requests.get(f"{BASE_URL}/api/deals/{deal_id}", headers=h, timeout=30).json()
    return deal.get("proposal_sign_token", "")


def test_email_send_mints_proposal_token():
    h = _auth()
    create = requests.post(
        f"{BASE_URL}/api/deals",
        headers=h,
        json={"title": "Sign-off-mint probe", "deal_type": "Scope", "proposed_roof_type": "TPO Over-Lay"},
        timeout=30,
    )
    deal_id = create.json()["id"]
    try:
        token = _mint_token_via_email_send(h, deal_id)
        assert token, "token must be persisted on the deal after a successful email send"
        # Re-sending re-uses the same token (idempotent mint)
        token2 = _mint_token_via_email_send(h, deal_id)
        assert token == token2
    finally:
        requests.delete(f"{BASE_URL}/api/deals/{deal_id}", headers=h, timeout=30)


def test_public_proposal_view_requires_no_auth():
    h = _auth()
    create = requests.post(
        f"{BASE_URL}/api/deals",
        headers=h,
        json={"title": "Public-view probe", "deal_type": "Scope", "proposed_roof_type": "TPO Over-Lay"},
        timeout=30,
    )
    deal_id = create.json()["id"]
    try:
        token = _mint_token_via_email_send(h, deal_id)
        # NO auth header here
        r = requests.get(f"{BASE_URL}/api/public/proposal/{token}", timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["project_title"] == "Public-view probe"
        assert d["proposed_roof_type"] == "TPO Over-Lay"
        assert d["signed"]["is_signed"] is False
        assert d["scope"]["scope_1"], "scope bullets must populate from template"
    finally:
        requests.delete(f"{BASE_URL}/api/deals/{deal_id}", headers=h, timeout=30)


def test_public_sign_flips_deal_to_won_and_appends_audit():
    h = _auth()
    create = requests.post(
        f"{BASE_URL}/api/deals",
        headers=h,
        json={"title": "Sign-flips-to-Won probe", "status": "Lead", "deal_type": "Scope", "proposed_roof_type": "TPO Over-Lay"},
        timeout=30,
    )
    deal_id = create.json()["id"]
    try:
        token = _mint_token_via_email_send(h, deal_id)
        # Tiny base64 PNG signature
        png = base64.b64encode(bytes.fromhex(
            "89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C489"
            "0000000A49444154789C6300010000000500010D0A2DB40000000049454E44AE426082"
        )).decode()
        r = requests.post(
            f"{BASE_URL}/api/public/proposal/{token}/sign",
            json={
                "signer_name": "Acme Property Owner",
                "signer_email": "owner@acme.test",
                "accepted": True,
                "signature_data_url": f"data:image/png;base64,{png}",
            },
            timeout=30,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True
        assert body["already_signed"] is False
        assert body["status"] == "Won"
        assert body["signed_by_name"] == "Acme Property Owner"

        # Verify side-effects on the deal
        after = requests.get(f"{BASE_URL}/api/deals/{deal_id}", headers=h, timeout=30).json()
        assert after["status"] == "Won"
        assert after["scope_signed_at"]
        assert after["scope_signed_by_name"] == "Acme Property Owner"
        assert after["scope_signed_by_email"] == "owner@acme.test"
        assert after["scope_signature_file_id"], "signature image must be persisted"
        # status_history must include the public-sign entry
        hist = after.get("status_history") or []
        public = next((h_ for h_ in hist if h_.get("user_id") == "public-sign"), None)
        assert public, "status_history must include the public-sign audit row"
        assert public["from"] == "Lead"
        assert public["to"] == "Won"
    finally:
        requests.delete(f"{BASE_URL}/api/deals/{deal_id}", headers=h, timeout=30)


def test_public_sign_is_idempotent():
    h = _auth()
    create = requests.post(
        f"{BASE_URL}/api/deals",
        headers=h,
        json={"title": "Idempotent-sign probe", "status": "Lead", "deal_type": "Scope"},
        timeout=30,
    )
    deal_id = create.json()["id"]
    try:
        token = _mint_token_via_email_send(h, deal_id)
        first = requests.post(
            f"{BASE_URL}/api/public/proposal/{token}/sign",
            json={"signer_name": "First Signer", "accepted": True},
            timeout=30,
        ).json()
        second = requests.post(
            f"{BASE_URL}/api/public/proposal/{token}/sign",
            json={"signer_name": "Someone Else", "accepted": True},
            timeout=30,
        ).json()
        # Second call must NOT overwrite the original
        assert second["already_signed"] is True
        assert second["signed_by_name"] == "First Signer"
        assert second["signed_at"] == first["signed_at"]
    finally:
        requests.delete(f"{BASE_URL}/api/deals/{deal_id}", headers=h, timeout=30)


def test_public_sign_requires_name_and_acceptance():
    h = _auth()
    create = requests.post(
        f"{BASE_URL}/api/deals",
        headers=h,
        json={"title": "Sign-validation probe", "deal_type": "Scope"},
        timeout=30,
    )
    deal_id = create.json()["id"]
    try:
        token = _mint_token_via_email_send(h, deal_id)
        # Missing acceptance
        r = requests.post(
            f"{BASE_URL}/api/public/proposal/{token}/sign",
            json={"signer_name": "X", "accepted": False},
            timeout=30,
        )
        assert r.status_code == 400
        # Missing name
        r = requests.post(
            f"{BASE_URL}/api/public/proposal/{token}/sign",
            json={"signer_name": "  ", "accepted": True},
            timeout=30,
        )
        assert r.status_code == 400
    finally:
        requests.delete(f"{BASE_URL}/api/deals/{deal_id}", headers=h, timeout=30)


def test_unknown_token_404s():
    """No information leak: unknown / revoked tokens must return 404."""
    r = requests.get(f"{BASE_URL}/api/public/proposal/this-is-not-a-real-token", timeout=15)
    assert r.status_code == 404
    r = requests.post(
        f"{BASE_URL}/api/public/proposal/this-is-not-a-real-token/sign",
        json={"signer_name": "X", "accepted": True},
        timeout=15,
    )
    assert r.status_code == 404


def test_sign_auto_creates_draft_deposit_invoice():
    """A signed proposal must auto-spawn a Draft 50% deposit invoice and
    return its id+number in the sign response. Re-signing must NOT create a
    duplicate invoice."""
    h = _auth()
    create = requests.post(
        f"{BASE_URL}/api/deals",
        headers=h,
        json={
            "title": "Auto-deposit invoice probe",
            "status": "Lead",
            "deal_type": "Scope",
            "chosen_amount": 50000.0,
        },
        timeout=30,
    )
    deal_id = create.json()["id"]
    try:
        token = _mint_token_via_email_send(h, deal_id)
        r = requests.post(
            f"{BASE_URL}/api/public/proposal/{token}/sign",
            json={"signer_name": "Auto-deposit Customer", "accepted": True},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["deposit_invoice_id"], "sign response must include deposit_invoice_id"
        assert body["deposit_invoice_number"], "sign response must include deposit_invoice_number"

        # GET that invoice and verify the shape
        invs = requests.get(
            f"{BASE_URL}/api/invoices?deal_id={deal_id}", headers=h, timeout=30
        ).json()
        assert len(invs) == 1, f"exactly one invoice expected, got {len(invs)}"
        inv = invs[0]
        assert inv["invoice_type"] == "Deposit"
        assert inv["status"] == "Draft"
        assert inv["source_type"] == "proposal_signing"
        assert inv["total"] == 25000.0
        assert inv["line_items"][0]["description"].endswith("50% Deposit (signed by customer)")

        # Re-sign — must NOT spawn a second invoice
        requests.post(
            f"{BASE_URL}/api/public/proposal/{token}/sign",
            json={"signer_name": "Again", "accepted": True},
            timeout=30,
        )
        invs2 = requests.get(
            f"{BASE_URL}/api/invoices?deal_id={deal_id}", headers=h, timeout=30
        ).json()
        assert len(invs2) == 1, "re-signing must remain idempotent"
    finally:
        # Cleanup deal + the auto-created invoice
        requests.delete(f"{BASE_URL}/api/deals/{deal_id}", headers=h, timeout=30)


def test_sign_does_not_create_invoice_when_no_amount():
    """A deal with chosen_amount = 0 and no proposal options must not get a
    bogus zero-dollar invoice on sign."""
    h = _auth()
    create = requests.post(
        f"{BASE_URL}/api/deals",
        headers=h,
        json={"title": "No-amount no-invoice probe", "deal_type": "Scope", "chosen_amount": 0},
        timeout=30,
    )
    deal_id = create.json()["id"]
    try:
        token = _mint_token_via_email_send(h, deal_id)
        body = requests.post(
            f"{BASE_URL}/api/public/proposal/{token}/sign",
            json={"signer_name": "Zero Amount", "accepted": True},
            timeout=30,
        ).json()
        assert body["status"] == "Won"
        assert body["deposit_invoice_id"] == ""
        # And no invoice should have been spawned
        invs = requests.get(
            f"{BASE_URL}/api/invoices?deal_id={deal_id}", headers=h, timeout=30
        ).json()
        assert invs == []
    finally:
        requests.delete(f"{BASE_URL}/api/deals/{deal_id}", headers=h, timeout=30)


def test_sign_respects_custom_deposit_pct():
    """Passing `deposit_pct: 25` in the sign body uses that percentage."""
    h = _auth()
    create = requests.post(
        f"{BASE_URL}/api/deals",
        headers=h,
        json={"title": "Custom-pct deposit probe", "deal_type": "Scope", "chosen_amount": 80000.0},
        timeout=30,
    )
    deal_id = create.json()["id"]
    try:
        token = _mint_token_via_email_send(h, deal_id)
        body = requests.post(
            f"{BASE_URL}/api/public/proposal/{token}/sign",
            json={"signer_name": "Custom Pct", "accepted": True, "deposit_pct": 25},
            timeout=30,
        ).json()
        assert body["deposit_invoice_id"]
        invs = requests.get(
            f"{BASE_URL}/api/invoices?deal_id={deal_id}", headers=h, timeout=30
        ).json()
        assert invs[0]["total"] == 20000.0, invs[0]
    finally:
        requests.delete(f"{BASE_URL}/api/deals/{deal_id}", headers=h, timeout=30)
