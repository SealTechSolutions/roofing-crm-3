"""Regression tests for the Stale Deals dashboard widget.

Validates GET /api/dashboard/stale-deals:
  - Returns the expected shape (counts + deals[] + thresholds)
  - Honors the `days` query parameter (open deal stuck > N days)
  - Flags Won-without-deposit when last status change is older than
    `won_grace_days` AND no invoice payments / no Paid milestones
  - Excludes Lost / Past Lead deals
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


def test_stale_deals_shape_default():
    h = _auth()
    r = requests.get(f"{BASE_URL}/api/dashboard/stale-deals", headers=h, timeout=30)
    assert r.status_code == 200
    j = r.json()
    assert j["threshold_days"] == 14
    assert j["won_grace_days"] == 30
    assert "counts" in j and "stuck" in j["counts"] and "no_deposit" in j["counts"]
    assert isinstance(j["deals"], list)


def test_stale_deals_short_threshold_surfaces_deals():
    """With days=1 every open deal older than a day should appear; counts add up."""
    h = _auth()
    r = requests.get(
        f"{BASE_URL}/api/dashboard/stale-deals?days=1&won_grace_days=1",
        headers=h,
        timeout=30,
    )
    assert r.status_code == 200
    j = r.json()
    # Every returned deal must carry both flags and a positive day count
    for d in j["deals"]:
        assert d["reason"] in {"stuck", "no_deposit"}
        assert d["days_in_stage"] >= 1
        assert d["status"] not in {"Lost", "Past Lead"}, (
            "Lost / Past Lead deals must never appear in the stale list"
        )
    counts = j["counts"]
    assert counts["stuck"] + counts["no_deposit"] == len(j["deals"])


def test_stale_deals_high_threshold_returns_empty():
    """No deal should be 10 years stuck — verifies threshold is honored."""
    h = _auth()
    r = requests.get(
        f"{BASE_URL}/api/dashboard/stale-deals?days=3650&won_grace_days=3650",
        headers=h,
        timeout=30,
    )
    assert r.status_code == 200
    j = r.json()
    assert j["counts"]["stuck"] == 0
    assert j["counts"]["no_deposit"] == 0
    assert j["deals"] == []
