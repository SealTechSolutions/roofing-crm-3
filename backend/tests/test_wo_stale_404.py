"""
Backend assertion for the Work Order stale-deal 404 path.
Linked to iter33 review request: confirm that POST/GET
/api/deals/{stale_id}/work-order/{send,draft} returns HTTP 404
with JSON body {"detail": "Deal not found"} so the frontend
can present the improved toast.
"""
import os
import pytest
import requests
from pathlib import Path


def _load_frontend_env():
    env_path = Path("/app/frontend/.env")
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if line.startswith("REACT_APP_BACKEND_URL="):
                return line.split("=", 1)[1].strip()
    return None


BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or _load_frontend_env() or "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL not set"
STALE_DEAL_ID = "350cedf9-2a23-486c-844f-5f2b3aac1dc3"  # confirmed not in DB
SAFE_TEST_DEAL_ID = "640a9104-0bd5-44dd-9f13-51e4b8cd2e4e"  # TEST_Lead Deal


@pytest.fixture(scope="module")
def token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": "darren@sealtechsolutions.co", "password": "admin123"},
        timeout=15,
    )
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    tok = r.json().get("access_token")
    assert tok, "No access_token in login response"
    return tok


@pytest.fixture(scope="module")
def headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# --- 404 path on stale deal_id ---------------------------------------------

def test_send_to_stale_deal_returns_404_with_detail(headers):
    r = requests.post(
        f"{BASE_URL}/api/deals/{STALE_DEAL_ID}/work-order/send",
        headers=headers,
        json={"sub_email": "test@example.com"},
        timeout=20,
    )
    assert r.status_code == 404, f"Expected 404, got {r.status_code}: {r.text}"
    body = r.json()
    assert body.get("detail") == "Deal not found", f"Unexpected body: {body}"


def test_draft_for_stale_deal_returns_404_with_detail(headers):
    r = requests.get(
        f"{BASE_URL}/api/deals/{STALE_DEAL_ID}/work-order/draft",
        headers=headers,
        timeout=15,
    )
    assert r.status_code == 404, f"Expected 404, got {r.status_code}: {r.text}"
    assert r.json().get("detail") == "Deal not found"


# --- Happy path: real test deal still works --------------------------------

def test_draft_for_real_test_deal_returns_200(headers):
    r = requests.get(
        f"{BASE_URL}/api/deals/{SAFE_TEST_DEAL_ID}/work-order/draft",
        headers=headers,
        timeout=20,
    )
    assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
    data = r.json()
    # draft object must be present
    assert "draft" in data or "existing" in data, f"Missing draft/existing keys: {data}"
