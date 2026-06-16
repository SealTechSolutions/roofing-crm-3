"""Regression tests for the weekly Stale-Deals digest emailer.

Validates POST /api/dashboard/stale-deals/digest:
  - Admin-only access (sales / non-admin must get 403)
  - dry_run=true previews recipient list without sending
  - Per-owner grouping (each owner gets only their stale deals)
  - Shape: { dry_run, owners_eligible, sent, skipped, digests[] }
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


def _admin_auth():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": "admin@roofingcrm.com", "password": "admin123"},
        timeout=30,
    )
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_digest_dry_run_default_threshold():
    h = _admin_auth()
    r = requests.post(
        f"{BASE_URL}/api/dashboard/stale-deals/digest?dry_run=true",
        headers=h,
        timeout=30,
    )
    assert r.status_code == 200
    j = r.json()
    # Required shape
    for key in ("dry_run", "threshold_days", "won_grace_days", "owners_eligible", "sent", "skipped", "digests"):
        assert key in j, f"missing key {key}"
    assert j["dry_run"] is True
    assert j["sent"] == 0, "dry_run must not actually send"
    assert j["threshold_days"] == 14
    assert isinstance(j["digests"], list)


def test_digest_dry_run_short_threshold_groups_by_owner():
    h = _admin_auth()
    r = requests.post(
        f"{BASE_URL}/api/dashboard/stale-deals/digest?days=1&won_grace_days=1&dry_run=true",
        headers=h,
        timeout=30,
    )
    assert r.status_code == 200
    j = r.json()
    # Every digest entry must carry the per-owner counts + an email
    seen_owners = set()
    for d in j["digests"]:
        assert d["owner_email"]
        assert d["owner_user_id"]
        assert d["owner_user_id"] not in seen_owners, "owners must not be duplicated"
        seen_owners.add(d["owner_user_id"])
        assert (d["stuck_count"] + d["no_deposit_count"]) >= 1
        assert "Stale Deals Digest" in d["subject"]
        assert "sent" not in d, "dry_run rows must not carry a sent flag"
    assert j["owners_eligible"] == len(j["digests"])


def test_digest_high_threshold_empty():
    h = _admin_auth()
    r = requests.post(
        f"{BASE_URL}/api/dashboard/stale-deals/digest?days=3650&dry_run=true",
        headers=h,
        timeout=30,
    )
    assert r.status_code == 200
    j = r.json()
    assert j["owners_eligible"] == 0
    assert j["digests"] == []


def test_digest_blocks_non_admin():
    """Non-admin users must get 403 even on dry_run."""
    h = _admin_auth()
    # Create a sales-role user, log in, attempt digest
    email = "sales_digest_test@roofingcrm.com"
    # Remove any pre-existing user via admin endpoint (best-effort cleanup)
    try:
        users = requests.get(f"{BASE_URL}/api/users", headers=h, timeout=30).json()
        for u in users:
            if u.get("email") == email:
                requests.delete(f"{BASE_URL}/api/users/{u['id']}", headers=h, timeout=30)
    except Exception:
        pass
    create = requests.post(
        f"{BASE_URL}/api/users",
        headers=h,
        json={"email": email, "name": "Sales Tester", "role": "sales"},
        timeout=30,
    )
    if create.status_code not in (200, 201):
        # If the env doesn't allow user creation, we can't run this test — skip gracefully
        import pytest
        pytest.skip(f"Cannot create sales user for negative test: {create.status_code}")
    created = create.json()
    # /api/users returns { user: {...}, generated_password: "..." }
    password = created.get("generated_password") or created.get("password") or created.get("temp_password")
    user_id = (created.get("user") or {}).get("id") or created.get("id")
    assert password, "User-create endpoint must return a temp password we can log in with"
    try:
        login = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": email, "password": password},
            timeout=30,
        )
        assert login.status_code == 200, login.text
        sales_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
        r = requests.post(
            f"{BASE_URL}/api/dashboard/stale-deals/digest?dry_run=true",
            headers=sales_headers,
            timeout=30,
        )
        assert r.status_code == 403, f"sales role must be forbidden but got {r.status_code}"
    finally:
        if user_id:
            requests.delete(f"{BASE_URL}/api/users/{user_id}", headers=h, timeout=30)
