"""Regression tests for the 'Scope Sent' pipeline-stamp side-effect.

When POST /api/deals/{deal_id}/spec-sheet/email succeeds, the deal must be
stamped with `last_scope_sent_at`, `last_scope_sent_to`, an incremented
`scope_send_count`, AND a status_history entry — these drive the
"Scope Sent" dot in the Deal Detail pipeline and the Next-Step card.

The bug surfaced as: user emailed the scope, the email arrived, but the
pipeline dot stayed gray (no derivation field was being written, and the
Pydantic response model was also stripping the fields off `GET /deals/{id}`).
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


def test_deal_model_exposes_scope_sent_fields():
    """The Deal Pydantic model must serialize the scope-sent fields back to
    the frontend — otherwise the pipeline derivation has nothing to read."""
    h = _auth()
    # Create a fresh deal and verify the new fields are present (with defaults)
    create = requests.post(
        f"{BASE_URL}/api/deals",
        headers=h,
        json={"title": "Pipeline serialization probe", "deal_type": "Scope"},
        timeout=30,
    )
    assert create.status_code in (200, 201), create.text
    deal_id = create.json()["id"]
    try:
        r = requests.get(f"{BASE_URL}/api/deals/{deal_id}", headers=h, timeout=30)
        assert r.status_code == 200
        d = r.json()
        # All four bookkeeping fields must be exposed by the response model
        assert "last_scope_sent_at" in d
        assert "last_scope_sent_to" in d
        assert "scope_send_count" in d
        assert "status_history" in d
        # Defaults
        assert d["last_scope_sent_at"] == ""
        assert d["scope_send_count"] == 0
        assert isinstance(d["status_history"], list)
    finally:
        requests.delete(f"{BASE_URL}/api/deals/{deal_id}", headers=h, timeout=30)


def test_spec_sheet_email_stamps_scope_sent_fields():
    """End-to-end: emailing the scope must stamp last_scope_sent_at on the deal."""
    h = _auth()
    # Re-use the seeded "2278 Mannatt Ct _ 2" deal so we have a real contact + property
    # to render the PDF against. If it doesn't exist (clean DB), skip.
    deals = requests.get(f"{BASE_URL}/api/deals", headers=h, timeout=30).json()
    target = next(
        (d for d in deals if (d.get("title") or "").strip() == "2278 Mannatt Ct _ 2"),
        None,
    )
    if not target:
        import pytest
        pytest.skip("Seed deal '2278 Mannatt Ct _ 2' not present in this env")
    deal_id = target["id"]
    before_count = int(target.get("scope_send_count") or 0)

    # Send the scope to the admin's own address so we don't email a real customer
    r = requests.post(
        f"{BASE_URL}/api/deals/{deal_id}/spec-sheet/email",
        headers=h,
        json={
            "to_email": "admin@roofingcrm.com",
            "cc_email": "",
            "message": "Regression test — verifying pipeline stamp.",
            "library_file_ids": [],
        },
        timeout=90,
    )
    if r.status_code == 500 and "Gmail" in r.text:
        import pytest
        pytest.skip("Gmail not configured in this env; cannot exercise live send.")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert body.get("last_scope_sent_at"), "endpoint must return the stamp in the response"

    # Re-fetch the deal and verify the stamp persisted + is exposed
    after = requests.get(f"{BASE_URL}/api/deals/{deal_id}", headers=h, timeout=30).json()
    assert after["last_scope_sent_at"], "last_scope_sent_at must be on the GET response"
    assert after["last_scope_sent_at"] == body["last_scope_sent_at"]
    assert after["last_scope_sent_to"] == "admin@roofingcrm.com"
    assert int(after["scope_send_count"]) == before_count + 1
    # The status_history must have grown by one with a "Scope emailed" entry
    hist = after.get("status_history") or []
    assert hist, "status_history must contain at least one entry"
    last = hist[-1]
    assert last.get("label") in {"Scope emailed", "Assessment emailed"}
    assert last.get("to") == "admin@roofingcrm.com"

    # And the /activity feed must surface it as a "Scope emailed (send #N)"
    # item with the recipient + sender visible.
    acts = requests.get(f"{BASE_URL}/api/deals/{deal_id}/activity", headers=h, timeout=30).json()
    scope_items = [
        it for it in (acts.get("items") or [])
        if "Scope emailed" in (it.get("title") or "")
    ]
    assert scope_items, "Activity timeline must include a 'Scope emailed' item"
    top = scope_items[0]
    assert "send #" in top["title"], f"title must include running count, got {top['title']!r}"
    assert "admin@roofingcrm.com" in (top.get("subtitle") or "")
