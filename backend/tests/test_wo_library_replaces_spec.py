"""Regression tests for the fix where library file selections REPLACE the
auto-generated SealTech Spec Sheet attachment (instead of duplicating it).

User Darren reported confusion: when he selected a manufacturer spec from the
Library, the WO email still attached the auto SpecSheet AND the library file,
so subs saw two "spec" PDFs. The fix:
  * Library selection → auto spec sheet is suppressed (spec_attached=False)
  * No library selection → auto spec sheet is attached (spec_attached=True)
  * Library files attached with display_name (e.g. "15 YR Emulsion and Acrylic.pdf")
    rather than upload-time filename.

Touches only TEST_Lead Deal (640a9104…) — never real customer data.
"""
import os
import re
import time
import pytest
import requests

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or "").rstrip("/")
if not BASE_URL:
    fe_env = "/app/frontend/.env"
    if os.path.exists(fe_env):
        with open(fe_env) as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL"):
                    BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                    break

TEST_DEAL_ID = "640a9104-0bd5-44dd-9f13-51e4b8cd2e4e"
SUB_EMAIL = "darren@darrenoliverllc.com"
ADMIN_EMAIL = "darren@sealtechsolutions.co"
ADMIN_PASSWORD = "admin123"

LIB_15YR = "35cd3d7f-adb5-49d7-af39-76bd6ffa34e3"  # 15 YR Emulsion and Acrylic
LIB_10YR = "08e8bc7a-1e39-4055-9fb1-07f46472846d"  # 10 YR Emulsion and Acrylic

BACKEND_LOG = "/var/log/supervisor/backend.err.log"


# ---- Fixtures ----
@pytest.fixture(scope="module")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
               timeout=30)
    assert r.status_code == 200, f"Login failed {r.status_code}: {r.text[:300]}"
    data = r.json()
    token = data.get("access_token") or data.get("token")
    if token:
        s.headers.update({"Authorization": f"Bearer {token}"})
    return s


def _base_payload(lib_ids):
    return {
        "sub_email": SUB_EMAIL,
        "project_name": "TEST_Lead Deal",
        "project_address": "x",
        "sub_company": "y",
        "sub_contact": "z",
        "wo_date": "06/23/2026",
        "work_date": "06/23/2026",
        "description": "t",
        "total": 7000,
        "library_file_ids": lib_ids,
    }


def _post_send(api_client, lib_ids):
    r = api_client.post(
        f"{BASE_URL}/api/deals/{TEST_DEAL_ID}/work-order/send",
        json=_base_payload(lib_ids), timeout=120,
    )
    assert r.status_code == 200, f"send failed: {r.status_code} {r.text[:400]}"
    return r.json()


def _last_wo_log_line():
    """Grab the most recent '[WO send]' line from the backend log."""
    try:
        with open(BACKEND_LOG, "r") as f:
            lines = f.readlines()
    except FileNotFoundError:
        return ""
    hits = [ln for ln in lines if "[WO send]" in ln]
    return hits[-1] if hits else ""


# ---- Case A: single library file → auto spec suppressed ----
def test_caseA_single_library_file_replaces_auto_spec(api_client):
    j = _post_send(api_client, [LIB_15YR])
    assert j.get("email_sent") is True, f"email_sent should be True; got: {j}"
    assert j.get("library_files_attached") == 1, \
        f"library_files_attached should be 1; got: {j}"
    assert j.get("spec_attached") is False, \
        f"spec_attached MUST be False when library file selected; got: {j}"


# ---- Case B: no library file → fall back to auto spec ----
def test_caseB_no_library_falls_back_to_auto_spec(api_client):
    j = _post_send(api_client, [])
    assert j.get("email_sent") is True, f"email_sent should be True; got: {j}"
    assert j.get("library_files_attached") == 0, \
        f"library_files_attached should be 0; got: {j}"
    assert j.get("spec_attached") is True, \
        f"spec_attached should be True when no library selected; got: {j}"


# ---- Case C: two library files → both attached, auto spec still suppressed ----
def test_caseC_multiple_library_files(api_client):
    j = _post_send(api_client, [LIB_15YR, LIB_10YR])
    assert j.get("email_sent") is True, f"email_sent should be True; got: {j}"
    assert j.get("library_files_attached") == 2, \
        f"library_files_attached should be 2; got: {j}"
    assert j.get("spec_attached") is False, \
        f"spec_attached should be False with library files; got: {j}"


# ---- Filename assertion: friendly display_name used, cryptic SKU not used ----
def test_filename_uses_display_name_and_skips_spec_sheet(api_client):
    # Trigger Case A again so the most-recent log line is for our send.
    j = _post_send(api_client, [LIB_15YR])
    assert j.get("email_sent") is True
    # Backend logging is sync via logging.info; give it a moment to flush.
    time.sleep(1.0)
    line = _last_wo_log_line()
    assert line, "No '[WO send]' line found in backend log"
    # Friendly name present
    assert "15 YR Emulsion and Acrylic.pdf" in line, (
        f"Expected friendly display_name in attachments; log line: {line}"
    )
    # Cryptic upload-time filename NOT used
    assert "16-SMEA_2P_6xE_15yrEA.pdf" not in line, (
        f"Cryptic original_filename should not be attached; log line: {line}"
    )
    # Auto spec sheet was suppressed
    assert "SealTech-SpecSheet.pdf" not in line, (
        f"SealTech-SpecSheet.pdf should NOT be attached when library file is selected; "
        f"log line: {line}"
    )
    # And the WO PDF is still there
    assert "SealTech-WorkOrder.pdf" in line, (
        f"WorkOrder PDF should always be attached; log line: {line}"
    )
