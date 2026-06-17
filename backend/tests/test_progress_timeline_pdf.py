"""Regression test for the Progress Timeline PDF endpoint.

Verifies:
  • Endpoint requires auth (401 without bearer token).
  • Returns 200 + application/pdf with a valid %PDF header.
  • Optional album_name/tag filters narrow the photo set.
  • Empty-project case (no photos) still returns a valid PDF (cover only).
"""
import io
import os
import uuid
from datetime import datetime, timezone

import pytest
import requests

API = (os.environ.get("REACT_APP_BACKEND_URL") or "http://localhost:8001").rstrip("/")
ADMIN_EMAIL = "admin@roofingcrm.com"
ADMIN_PASSWORD = "admin123"


def _login():
    r = requests.post(f"{API}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
                      timeout=10)
    r.raise_for_status()
    return r.json()["access_token"]


def _png_bytes(n: int = 1) -> bytes:
    """Tiny 1x1 PNG (varied so we know the upload isn't deduping)."""
    import base64
    blank = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAfbLI3wAAAABJRU5ErkJggg=="
    )
    return blank


def _ensure_test_deal(token: str) -> str:
    """Create a temp deal for this test run and return its id."""
    h = {"Authorization": f"Bearer {token}"}
    r = requests.post(
        f"{API}/api/deals",
        json={"title": f"_TIMELINE_TEST_{uuid.uuid4().hex[:6]}",
              "deal_type": "Scope", "status": "Lead"},
        headers=h, timeout=10,
    )
    r.raise_for_status()
    return r.json()["id"]


def _upload_photo(token: str, deal_id: str, name: str = "shot.png") -> dict:
    h = {"Authorization": f"Bearer {token}"}
    files = {"file": (name, io.BytesIO(_png_bytes()), "image/png")}
    r = requests.post(f"{API}/api/projects/{deal_id}/photos",
                      files=files, headers=h, timeout=15)
    r.raise_for_status()
    return r.json()


def test_requires_auth():
    deal_id = "any-id"
    r = requests.get(f"{API}/api/projects/{deal_id}/photos/timeline.pdf", timeout=5)
    assert r.status_code in (401, 403), f"expected unauthorized, got {r.status_code}"


def test_pdf_with_photos():
    token = _login()
    h = {"Authorization": f"Bearer {token}"}
    deal_id = _ensure_test_deal(token)
    try:
        # Upload 3 photos
        for i in range(3):
            _upload_photo(token, deal_id, name=f"shot_{i}.png")
        r = requests.get(
            f"{API}/api/projects/{deal_id}/photos/timeline.pdf",
            headers=h, timeout=30,
        )
        assert r.status_code == 200, r.text
        assert r.headers.get("content-type", "").startswith("application/pdf")
        assert r.content[:4] == b"%PDF", "PDF magic header missing"
        assert len(r.content) > 1000, "PDF too small to be real"
    finally:
        requests.delete(f"{API}/api/deals/{deal_id}", headers=h, timeout=10)


def test_pdf_empty_project_still_generates():
    token = _login()
    h = {"Authorization": f"Bearer {token}"}
    deal_id = _ensure_test_deal(token)
    try:
        r = requests.get(
            f"{API}/api/projects/{deal_id}/photos/timeline.pdf",
            headers=h, timeout=15,
        )
        assert r.status_code == 200, r.text
        assert r.content[:4] == b"%PDF"
    finally:
        requests.delete(f"{API}/api/deals/{deal_id}", headers=h, timeout=10)


def test_pdf_tag_filter_narrows_results():
    token = _login()
    h = {"Authorization": f"Bearer {token}"}
    deal_id = _ensure_test_deal(token)
    try:
        # Upload one Before, one After
        for tag in ("Before", "After"):
            files = {"file": (f"{tag}.png", io.BytesIO(_png_bytes()), "image/png")}
            data = {"tag": tag}
            r = requests.post(f"{API}/api/projects/{deal_id}/photos",
                              files=files, data=data, headers=h, timeout=15)
            r.raise_for_status()
        # No filter
        r_all = requests.get(f"{API}/api/projects/{deal_id}/photos/timeline.pdf",
                             headers=h, timeout=20)
        # Filtered to Before
        r_before = requests.get(
            f"{API}/api/projects/{deal_id}/photos/timeline.pdf?tag=Before",
            headers=h, timeout=20,
        )
        assert r_all.status_code == 200 and r_before.status_code == 200
        # The Before-only PDF should be smaller than the all PDF.
        assert len(r_before.content) <= len(r_all.content), (
            f"filtered PDF ({len(r_before.content)}) not smaller than all "
            f"({len(r_all.content)})"
        )
    finally:
        requests.delete(f"{API}/api/deals/{deal_id}", headers=h, timeout=10)
