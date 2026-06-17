"""Backend tests for FieldCapture flow:
- POST /api/projects/{deal_id}/photos accepts file upload
- GET /api/projects/{deal_id}/photos returns uploaded photo
- GET /api/deals returns non-closed deals for picker
"""
import io
import os
import pytest
import requests
from PIL import Image

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://roofing-crm-3.preview.emergentagent.com").rstrip("/")
EMAIL = "admin@roofingcrm.com"
PASSWORD = "admin123"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


# ---------- Auth me ----------
def test_auth_me(auth_headers):
    r = requests.get(f"{BASE_URL}/api/auth/me", headers=auth_headers, timeout=20)
    assert r.status_code == 200
    body = r.json()
    assert body.get("email") == EMAIL


# ---------- Deals (non-closed filter) ----------
def test_deals_list(auth_headers):
    r = requests.get(f"{BASE_URL}/api/deals?limit=1000", headers=auth_headers, timeout=30)
    assert r.status_code == 200
    deals = r.json()
    assert isinstance(deals, list)
    # Build a quick stat
    closed = [d for d in deals if (d.get("status") or "") in ("Closed", "Lost", "Past Lead")]
    open_deals = [d for d in deals if (d.get("status") or "") not in ("Closed", "Lost", "Past Lead")]
    print(f"Total deals={len(deals)} open={len(open_deals)} closed_or_lost={len(closed)}")
    assert len(open_deals) >= 1, "Need at least one non-closed deal for FieldCapture picker"


@pytest.fixture(scope="module")
def open_deal_id(auth_headers):
    r = requests.get(f"{BASE_URL}/api/deals?limit=1000", headers=auth_headers, timeout=30)
    deals = r.json()
    for d in deals:
        if (d.get("status") or "") not in ("Closed", "Lost", "Past Lead"):
            return d["id"]
    pytest.skip("No open deal found")


# ---------- Photo upload ----------
def _make_jpeg_bytes():
    img = Image.new("RGB", (320, 240), (90, 130, 200))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=80)
    return buf.getvalue()


def test_upload_photo_and_verify_list(auth_headers, open_deal_id):
    # Upload
    files = {"file": ("TEST_field.jpg", _make_jpeg_bytes(), "image/jpeg")}
    up = requests.post(
        f"{BASE_URL}/api/projects/{open_deal_id}/photos",
        headers=auth_headers,
        files=files,
        timeout=60,
    )
    assert up.status_code == 200, f"upload failed: {up.status_code} {up.text[:300]}"
    created = up.json()
    assert created.get("id"), "missing id in upload response"
    assert created.get("deal_id") == open_deal_id
    assert created.get("content_type", "").startswith("image/")
    assert created.get("size", 0) > 0
    photo_id = created["id"]

    # Verify it appears in GET list
    lst = requests.get(
        f"{BASE_URL}/api/projects/{open_deal_id}/photos",
        headers=auth_headers,
        timeout=30,
    )
    assert lst.status_code == 200
    rows = lst.json()
    ids = [p["id"] for p in rows]
    assert photo_id in ids, "Uploaded photo not present in GET list"

    # Cleanup
    delr = requests.delete(
        f"{BASE_URL}/api/projects/{open_deal_id}/photos/{photo_id}",
        headers=auth_headers,
        timeout=30,
    )
    assert delr.status_code == 200


def test_upload_photo_unauth_rejected(open_deal_id):
    files = {"file": ("TEST_unauth.jpg", _make_jpeg_bytes(), "image/jpeg")}
    r = requests.post(
        f"{BASE_URL}/api/projects/{open_deal_id}/photos",
        files=files,
        timeout=30,
    )
    assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}"
