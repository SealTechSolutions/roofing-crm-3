"""Iteration 21 regression — /field refactor (project-list + camera) backend coverage.

Validates:
- POST /api/auth/login → JWT
- GET /api/deals (filter helper for non-closed deals)
- POST /api/projects/{deal_id}/photos accepts JPEG → 200
- GET  /api/projects/{deal_id}/photos lists the new photo
- POST /api/auth/magic-link issues a fresh token
- POST /api/auth/magic-link/consume returns access_token+user on 1st call,
  401 on a second call (single-use enforced)
"""
import io
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL")
if not BASE_URL:
    # fall back to the frontend .env value
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip()
                break
BASE_URL = BASE_URL.rstrip("/")

ADMIN_EMAIL = "admin@roofingcrm.com"
ADMIN_PASSWORD = "admin123"

CLOSED_STATUSES = {"Closed", "Lost", "Past Lead"}

JPEG_BYTES = (
    b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
    b"\xff\xdb\x00C\x00" + bytes([8] * 64) +
    b"\xff\xc0\x00\x0b\x08\x00\x01\x00\x01\x01\x01\x11\x00"
    b"\xff\xc4\x00\x14\x00\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00"
    b"\xff\xc4\x00\x14\x10\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00"
    b"\xff\xda\x00\x08\x01\x01\x00\x00?\x00\xd2\xcf \xff\xd9"
)


@pytest.fixture(scope="module")
def token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert "access_token" in data
    return data["access_token"]


@pytest.fixture
def headers(token):
    return {"Authorization": f"Bearer {token}"}


# ---------- Deals filter ----------
def test_deals_filter_for_field_list(headers):
    r = requests.get(f"{BASE_URL}/api/deals?limit=1000", headers=headers, timeout=15)
    assert r.status_code == 200, r.text
    deals = r.json()
    assert isinstance(deals, list)
    open_deals = [d for d in deals if d.get("status") not in CLOSED_STATUSES]
    # we just need at least one open deal to drive the field tests
    assert len(open_deals) >= 1, f"need >=1 non-closed deal — got {len(open_deals)}"
    # confirm no closed leak through
    for d in open_deals:
        assert d.get("status") not in CLOSED_STATUSES


@pytest.fixture(scope="module")
def open_deal_id(token):
    r = requests.get(
        f"{BASE_URL}/api/deals?limit=1000",
        headers={"Authorization": f"Bearer {token}"},
        timeout=15,
    )
    assert r.status_code == 200
    deals = r.json()
    open_deals = [d for d in deals if d.get("status") not in CLOSED_STATUSES]
    assert open_deals, "no open deals available"
    return open_deals[0]["id"]


# ---------- Photo upload + list ----------
def test_upload_and_list_photo(headers, open_deal_id):
    files = {"file": ("TEST_field_v2.jpg", io.BytesIO(JPEG_BYTES), "image/jpeg")}
    r = requests.post(
        f"{BASE_URL}/api/projects/{open_deal_id}/photos",
        headers=headers,
        files=files,
        timeout=30,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["deal_id"] == open_deal_id
    assert body["content_type"].startswith("image/")
    assert "_id" not in body
    photo_id = body["id"]

    # list
    r2 = requests.get(
        f"{BASE_URL}/api/projects/{open_deal_id}/photos",
        headers=headers,
        timeout=15,
    )
    assert r2.status_code == 200
    rows = r2.json()
    assert any(p.get("id") == photo_id for p in rows), "uploaded photo missing from list"

    # cleanup
    requests.delete(
        f"{BASE_URL}/api/projects/{open_deal_id}/photos/{photo_id}",
        headers=headers,
        timeout=15,
    )


def test_upload_rejected_without_auth(open_deal_id):
    files = {"file": ("noauth.jpg", io.BytesIO(JPEG_BYTES), "image/jpeg")}
    r = requests.post(
        f"{BASE_URL}/api/projects/{open_deal_id}/photos",
        files=files,
        timeout=15,
    )
    assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}"


# ---------- Magic link ----------
def test_magic_link_issue_and_single_use_consume(headers):
    # Issue
    r = requests.post(f"{BASE_URL}/api/auth/magic-link", headers=headers, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    token = body.get("token")
    assert isinstance(token, str) and len(token) > 10
    assert body.get("expires_in") == 300

    # First consume → 200 with access_token + user
    r1 = requests.post(
        f"{BASE_URL}/api/auth/magic-link/consume", json={"token": token}, timeout=15
    )
    assert r1.status_code == 200, r1.text
    d1 = r1.json()
    assert d1.get("access_token") and isinstance(d1["access_token"], str)
    assert d1.get("user") and d1["user"].get("email") == ADMIN_EMAIL

    # Second consume → 401 (single-use)
    r2 = requests.post(
        f"{BASE_URL}/api/auth/magic-link/consume", json={"token": token}, timeout=15
    )
    assert r2.status_code == 401, r2.text


def test_magic_link_consume_invalid_token():
    r = requests.post(
        f"{BASE_URL}/api/auth/magic-link/consume",
        json={"token": "totally-bogus-token-xyz"},
        timeout=15,
    )
    assert r.status_code == 401
