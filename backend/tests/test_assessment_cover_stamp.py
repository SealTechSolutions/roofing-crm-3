"""Regression tests for the Assessment PDF cover-page restoration eligibility stamp.

Verifies that:
  - When `insulation_saturated` OR `structural_deck_damaged` is True, the cover
    stamp reads "REPLACEMENT REQUIRED" with disqualifier sublines.
  - Otherwise the cover stamp reads "RESTORATION PATH RECOMMENDED".
"""
import os
import pathlib
import requests
from pypdf import PdfReader
from io import BytesIO


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


def _cover_text(headers, aid):
    r = requests.get(f"{BASE_URL}/api/assessments/{aid}/pdf", headers=headers, timeout=60)
    r.raise_for_status()
    reader = PdfReader(BytesIO(r.content))
    return reader.pages[0].extract_text()


def test_cover_stamp_replacement_when_insulation_saturated():
    h = _auth()
    aid = requests.post(f"{BASE_URL}/api/assessments", headers=h, json={}, timeout=30).json()["id"]
    try:
        requests.put(
            f"{BASE_URL}/api/assessments/{aid}",
            headers=h,
            json={"insulation_saturated": True, "structural_deck_damaged": False},
            timeout=30,
        ).raise_for_status()
        text = _cover_text(h, aid)
        assert "REPLACEMENT REQUIRED" in text
        assert "RESTORATION PATH RECOMMENDED" not in text
        assert "Insulation Saturated" in text
    finally:
        requests.delete(f"{BASE_URL}/api/assessments/{aid}", headers=h, timeout=30)


def test_cover_stamp_replacement_when_deck_damaged():
    h = _auth()
    aid = requests.post(f"{BASE_URL}/api/assessments", headers=h, json={}, timeout=30).json()["id"]
    try:
        requests.put(
            f"{BASE_URL}/api/assessments/{aid}",
            headers=h,
            json={"insulation_saturated": False, "structural_deck_damaged": True},
            timeout=30,
        ).raise_for_status()
        text = _cover_text(h, aid)
        assert "REPLACEMENT REQUIRED" in text
        assert "Structural Deck Damaged" in text
    finally:
        requests.delete(f"{BASE_URL}/api/assessments/{aid}", headers=h, timeout=30)


def test_cover_stamp_restoration_path_when_clear():
    h = _auth()
    aid = requests.post(f"{BASE_URL}/api/assessments", headers=h, json={}, timeout=30).json()["id"]
    try:
        # Defaults are False on a fresh assessment, but be explicit
        requests.put(
            f"{BASE_URL}/api/assessments/{aid}",
            headers=h,
            json={"insulation_saturated": False, "structural_deck_damaged": False},
            timeout=30,
        ).raise_for_status()
        text = _cover_text(h, aid)
        assert "RESTORATION PATH RECOMMENDED" in text
        assert "REPLACEMENT REQUIRED" not in text
        assert "Insulation dry" in text
    finally:
        requests.delete(f"{BASE_URL}/api/assessments/{aid}", headers=h, timeout=30)
