"""Regression test for the Work Order send-to-sub email flow.

User Darren reported that Work Order send did not actually dispatch email
because work_orders._send_email() used non-existent SMTP_* env vars instead
of GMAIL_USERNAME/GMAIL_APP_PASSWORD. Fix: _send_email now wraps
email_sender.send_email().

This test only touches the TEST_Lead Deal — never real customer deals.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL")
if not BASE_URL:
    # Frontend env file
    fe_env = "/app/frontend/.env"
    if os.path.exists(fe_env):
        with open(fe_env) as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL"):
                    BASE_URL = line.split("=", 1)[1].strip()
                    break
BASE_URL = (BASE_URL or "").rstrip("/")

TEST_DEAL_ID = "640a9104-0bd5-44dd-9f13-51e4b8cd2e4e"
SUB_EMAIL = "darren@darrenoliverllc.com"
ADMIN_EMAIL = "darren@sealtechsolutions.co"
ADMIN_PASSWORD = "admin123"


# ---- Fixtures ----
@pytest.fixture(scope="module")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    # Login (cookie-based or token; try cookie first via /api/auth/login)
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
               timeout=30)
    assert r.status_code == 200, f"Login failed {r.status_code}: {r.text[:300]}"
    data = r.json()
    token = data.get("access_token") or data.get("token")
    if token:
        s.headers.update({"Authorization": f"Bearer {token}"})
    return s


# ---- Test 1: draft endpoint ----
def test_work_order_draft_returns_200(api_client):
    r = api_client.get(f"{BASE_URL}/api/deals/{TEST_DEAL_ID}/work-order/draft", timeout=30)
    assert r.status_code == 200, f"draft failed: {r.status_code} {r.text[:300]}"
    j = r.json()
    assert "draft" in j and isinstance(j["draft"], dict), f"missing draft: {j}"


# ---- Test 2: send returns email_sent=true ----
@pytest.fixture(scope="module")
def send_payload():
    return {
        "sub_email": SUB_EMAIL,
        "project_name": "TEST_Lead Deal",
        "project_address": "TEST addr",
        "contractor": "Darren Oliver",
        "sub_company": "Darren Oliver LLC",
        "sub_contact": "Darren",
        "wo_date": "06/23/2026",
        "work_date": "06/23/2026",
        "description": "<b>Inspection and Prep</b><br/>• test bullet\n\nManufacturer Spec: 1 layer emulsion - 6 gps",
        "total": 4000,
        "library_file_ids": [],
    }


def test_work_order_send_dispatches_email(api_client, send_payload):
    r = api_client.post(
        f"{BASE_URL}/api/deals/{TEST_DEAL_ID}/work-order/send",
        json=send_payload, timeout=90,
    )
    assert r.status_code == 200, f"send failed: {r.status_code} {r.text[:500]}"
    j = r.json()
    assert j.get("ok") is True, f"ok!=True: {j}"
    # Critical assertion — the bug fix
    assert j.get("email_sent") is True, f"email_sent should be True after Gmail fix; got: {j}"
    assert j.get("spec_attached") is True, f"spec_attached should be True; got: {j}"


# ---- Test 3: preview PDF newline handling ----
def test_work_order_preview_returns_valid_pdf_with_newlines(api_client):
    body = {
        "project_name": "TEST_Lead Deal",
        "project_address": "TEST addr",
        "contractor": "Darren Oliver",
        "sub_company": "Darren Oliver LLC",
        "sub_contact": "Darren",
        "wo_date": "06/23/2026",
        "work_date": "06/23/2026",
        "description": "First block of text.\n\nSecond block of text after blank line.",
        "total": 4000,
    }
    r = api_client.post(
        f"{BASE_URL}/api/deals/{TEST_DEAL_ID}/work-order/preview",
        json=body, timeout=60,
    )
    assert r.status_code == 200, f"preview failed: {r.status_code} {r.text[:300]}"
    ct = r.headers.get("content-type", "")
    assert "application/pdf" in ct, f"unexpected content-type: {ct}"
    assert r.content[:4] == b"%PDF", f"not a valid PDF: first bytes={r.content[:10]!r}"


# ---- Test 4: library file attachments ----
def test_work_order_send_with_library_files(api_client, send_payload):
    # Fetch library files in Western Colloid / Specifications
    r = api_client.get(
        f"{BASE_URL}/api/library/files",
        params={"category": "Western Colloid", "subcategory": "Specifications"},
        timeout=30,
    )
    assert r.status_code == 200, f"library list failed: {r.status_code} {r.text[:300]}"
    files = r.json()
    # Could be list or dict with "files" key
    if isinstance(files, dict):
        files = files.get("files") or files.get("items") or []
    assert isinstance(files, list), f"unexpected library response shape: {type(files)}"
    assert len(files) >= 2, f"need >=2 library files in WC/Specifications, got {len(files)}"
    ids = [f["id"] for f in files[:2]]

    payload = dict(send_payload)
    payload["library_file_ids"] = ids
    r = api_client.post(
        f"{BASE_URL}/api/deals/{TEST_DEAL_ID}/work-order/send",
        json=payload, timeout=120,
    )
    assert r.status_code == 200, f"send w/ lib failed: {r.status_code} {r.text[:500]}"
    j = r.json()
    assert j.get("email_sent") is True, f"email_sent should be True; got: {j}"
    assert j.get("library_files_attached") == 2, \
        f"library_files_attached should be 2; got: {j}"
