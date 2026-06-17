"""Regression tests for the in-app Scope Editor + the sent-PDF snapshot link.

Covers:
  1. GET /api/deals/{id}/scope-bullets returns defaults from the spec_sheet
     template + an empty overrides set on a fresh deal.
  2. PUT /api/deals/{id}/scope-bullets persists overrides; the next PDF
     rendered for that deal reflects the new bullets.
  3. Empty/whitespace overrides revert the field back to template defaults.
  4. /spec-sheet/email persists a snapshot PDF in /files and surfaces it on
     /activity → "Open the PDF that went out" can re-download it later.
"""
import os
import pathlib
import requests
from io import BytesIO
from pypdf import PdfReader


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
    return {"Authorization": f"Bearer {r.json()['access_token']}"}, r.json()["access_token"]


def test_scope_bullets_get_returns_template_defaults():
    h, _ = _auth()
    create = requests.post(
        f"{BASE_URL}/api/deals",
        headers=h,
        json={"title": "Scope-editor probe", "deal_type": "Scope", "proposed_roof_type": "TPO Over-Lay"},
        timeout=30,
    )
    deal_id = create.json()["id"]
    try:
        r = requests.get(f"{BASE_URL}/api/deals/{deal_id}/scope-bullets", headers=h, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["roof_type"] == "TPO Over-Lay"
        assert d["template_title"]  # non-empty
        assert d["defaults"]["scope_1"], "template must have default bullets"
        assert d["overridden_keys"] == []  # fresh deal
        # effective == defaults when no overrides
        assert d["effective"]["scope_1"] == d["defaults"]["scope_1"]
    finally:
        requests.delete(f"{BASE_URL}/api/deals/{deal_id}", headers=h, timeout=30)


def test_scope_bullets_override_changes_pdf():
    h, _ = _auth()
    create = requests.post(
        f"{BASE_URL}/api/deals",
        headers=h,
        json={"title": "Override-affects-PDF probe", "deal_type": "Scope", "proposed_roof_type": "TPO Over-Lay"},
        timeout=30,
    )
    deal_id = create.json()["id"]
    try:
        # Apply overrides
        payload = {
            "scope_1_title": "TEST-OVERRIDE Inspection",
            "scope_1": ["TEST-OVERRIDE bullet alpha", "TEST-OVERRIDE bullet beta"],
        }
        r = requests.put(f"{BASE_URL}/api/deals/{deal_id}/scope-bullets", headers=h, json=payload, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "scope_1" in body["overridden_keys"]
        assert "scope_1_title" in body["overridden_keys"]
        assert body["effective"]["scope_1"] == payload["scope_1"]

        # Render the spec-sheet PDF and confirm the override text is inside
        r = requests.get(f"{BASE_URL}/api/deals/{deal_id}/spec-sheet.pdf", headers=h, timeout=60)
        assert r.status_code == 200
        text = "".join(p.extract_text() or "" for p in PdfReader(BytesIO(r.content)).pages)
        assert "TEST-OVERRIDE bullet alpha" in text
        assert "TEST-OVERRIDE Inspection" in text
    finally:
        requests.delete(f"{BASE_URL}/api/deals/{deal_id}", headers=h, timeout=30)


def test_scope_bullets_empty_overrides_revert_to_defaults():
    h, _ = _auth()
    create = requests.post(
        f"{BASE_URL}/api/deals",
        headers=h,
        json={"title": "Override-revert probe", "deal_type": "Scope", "proposed_roof_type": "TPO Over-Lay"},
        timeout=30,
    )
    deal_id = create.json()["id"]
    try:
        # Apply, then clear
        requests.put(
            f"{BASE_URL}/api/deals/{deal_id}/scope-bullets",
            headers=h,
            json={"scope_1": ["temporary"]},
            timeout=30,
        )
        cleared = requests.put(
            f"{BASE_URL}/api/deals/{deal_id}/scope-bullets",
            headers=h,
            json={},
            timeout=30,
        ).json()
        assert cleared["overridden_keys"] == []
        # And an empty list also reverts (sanity check)
        cleared_empty = requests.put(
            f"{BASE_URL}/api/deals/{deal_id}/scope-bullets",
            headers=h,
            json={"scope_1": [], "scope_1_title": "   "},
            timeout=30,
        ).json()
        assert cleared_empty["overridden_keys"] == []
    finally:
        requests.delete(f"{BASE_URL}/api/deals/{deal_id}", headers=h, timeout=30)


def test_spec_sheet_email_snapshots_pdf_and_activity_links_to_it():
    """The PDF that went out must be stored in /files and surfaced on /activity."""
    h, token = _auth()
    # Re-use the seeded "2278 Mannatt Ct _ 2" deal so the PDF render has a real
    # contact + property. Skip if the seed isn't present.
    deals = requests.get(f"{BASE_URL}/api/deals", headers=h, timeout=30).json()
    target = next((d for d in deals if (d.get("title") or "").strip() == "2278 Mannatt Ct _ 2"), None)
    if not target:
        import pytest
        pytest.skip("Seed deal '2278 Mannatt Ct _ 2' not present in this env")
    deal_id = target["id"]

    r = requests.post(
        f"{BASE_URL}/api/deals/{deal_id}/spec-sheet/email",
        headers=h,
        json={
            "to_email": "admin@roofingcrm.com",
            "cc_email": "",
            "message": "Snapshot-link regression test",
            "library_file_ids": [],
        },
        timeout=90,
    )
    if r.status_code == 500 and "Gmail" in r.text:
        import pytest
        pytest.skip("Gmail not configured in this env; cannot exercise live send.")
    assert r.status_code == 200, r.text

    acts = requests.get(f"{BASE_URL}/api/deals/{deal_id}/activity", headers=h, timeout=30).json()
    scope_items = [it for it in (acts.get("items") or []) if "Scope emailed" in (it.get("title") or "")]
    assert scope_items
    top = scope_items[0]
    pdf_file_id = top.get("pdf_file_id")
    assert pdf_file_id, "the most recent send must surface a pdf_file_id on /activity"

    # Download the snapshot using ?token= (browser pattern) and confirm it's a real PDF
    dl = requests.get(
        f"{BASE_URL}/api/files/{pdf_file_id}/download",
        params={"token": token},
        timeout=60,
    )
    assert dl.status_code == 200, dl.text
    assert dl.content[:4] == b"%PDF"
    # And the file record is marked as a sent-snapshot in DB shape (best-effort:
    # there's no list endpoint, so just confirm the file is downloadable)
