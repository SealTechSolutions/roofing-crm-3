"""Backend tests for P4 GPS+Foreman Stamp feature.

Verifies that /api/projects/{deal_id}/photos accepts and persists the
new gps_lat/gps_lng/gps_accuracy/captured_at/stamped form fields, and
preserves the prior behaviour (tag validation, list/patch/delete/download,
timeline.pdf).
"""
import io
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
DEAL_ID = "b2f4b511-09ee-411d-978f-44a02ac24d13"
ADMIN_EMAIL = "darren@sealtechsolutions.co"
ADMIN_PASSWORD = "admin123"


def _tiny_jpeg() -> bytes:
    """Valid 640x480 JPEG generated via PIL (so PDF renderer can decode it)."""
    from PIL import Image
    img = Image.new("RGB", (640, 480), color=(120, 140, 160))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=85)
    return buf.getvalue()


@pytest.fixture(scope="module")
def auth_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": ADMIN_EMAIL, "password": ADMIN_PASSWORD,
    }, timeout=15)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    tok = r.json().get("access_token") or r.json().get("token")
    assert tok, f"no token in: {r.json()}"
    return tok


@pytest.fixture(scope="module")
def auth_headers(auth_token):
    return {"Authorization": f"Bearer {auth_token}"}


# --- created photo IDs to clean up at end ---
_created_ids = []


@pytest.fixture(scope="module", autouse=True)
def cleanup(auth_headers):
    yield
    for pid in _created_ids:
        try:
            requests.delete(
                f"{BASE_URL}/api/projects/{DEAL_ID}/photos/{pid}",
                headers=auth_headers, timeout=10,
            )
        except Exception:
            pass


# --- Tests ---

class TestPhotoUploadWithGPS:
    """POST /api/projects/{deal_id}/photos with GPS metadata"""

    def test_upload_with_full_gps_metadata(self, auth_headers):
        files = {"file": ("TEST_stamp.jpg", io.BytesIO(_tiny_jpeg()), "image/jpeg")}
        data = {
            "album_name": "Default",
            "tag": "During",
            "display_name": "TEST_stamp_with_gps",
            "gps_lat": "39.5807",
            "gps_lng": "-104.8772",
            "gps_accuracy": "12.5",
            "captured_at": "2026-01-15T10:30:00Z",
            "stamped": "true",
        }
        r = requests.post(
            f"{BASE_URL}/api/projects/{DEAL_ID}/photos",
            headers=auth_headers, files=files, data=data, timeout=20,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        body = r.json()
        assert body["gps_lat"] == 39.5807
        assert body["gps_lng"] == -104.8772
        assert body["gps_accuracy"] == 12.5
        assert body["captured_at"] == "2026-01-15T10:30:00Z"
        assert body["stamped"] is True
        assert "id" in body
        _created_ids.append(body["id"])

        # Verify persisted via GET list
        gr = requests.get(
            f"{BASE_URL}/api/projects/{DEAL_ID}/photos",
            headers=auth_headers, timeout=15,
        )
        assert gr.status_code == 200
        rows = gr.json()
        fetched = next((p for p in rows if p["id"] == body["id"]), None)
        assert fetched is not None
        assert fetched["gps_lat"] == 39.5807
        assert fetched["gps_lng"] == -104.8772
        assert fetched["gps_accuracy"] == 12.5
        assert fetched["captured_at"] == "2026-01-15T10:30:00Z"
        assert fetched["stamped"] is True

    def test_upload_without_gps_backwards_compat(self, auth_headers):
        files = {"file": ("TEST_nogps.jpg", io.BytesIO(_tiny_jpeg()), "image/jpeg")}
        data = {"album_name": "Default", "display_name": "TEST_nogps"}
        r = requests.post(
            f"{BASE_URL}/api/projects/{DEAL_ID}/photos",
            headers=auth_headers, files=files, data=data, timeout=20,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        body = r.json()
        assert body["gps_lat"] is None
        assert body["gps_lng"] is None
        assert body["gps_accuracy"] is None
        assert body["stamped"] is False
        # captured_at must auto-populate to a non-empty ISO timestamp
        assert isinstance(body["captured_at"], str) and len(body["captured_at"]) >= 10
        _created_ids.append(body["id"])

    def test_upload_invalid_tag_rejected(self, auth_headers):
        files = {"file": ("TEST_badtag.jpg", io.BytesIO(_tiny_jpeg()), "image/jpeg")}
        data = {"tag": "Invalid"}
        r = requests.post(
            f"{BASE_URL}/api/projects/{DEAL_ID}/photos",
            headers=auth_headers, files=files, data=data, timeout=15,
        )
        assert r.status_code == 400
        assert "Invalid tag" in r.text


class TestExistingEndpointsUnchanged:
    """Make sure prior photo CRUD still works."""

    def test_patch_and_delete_photo(self, auth_headers):
        # Create
        files = {"file": ("TEST_crud.jpg", io.BytesIO(_tiny_jpeg()), "image/jpeg")}
        cr = requests.post(
            f"{BASE_URL}/api/projects/{DEAL_ID}/photos",
            headers=auth_headers, files=files, data={"display_name": "TEST_crud"}, timeout=15,
        )
        assert cr.status_code == 200
        pid = cr.json()["id"]

        # Patch
        pr = requests.patch(
            f"{BASE_URL}/api/projects/{DEAL_ID}/photos/{pid}",
            headers=auth_headers, json={"tag": "After", "display_name": "TEST_crud_v2"},
            timeout=15,
        )
        assert pr.status_code == 200
        assert pr.json()["tag"] == "After"
        assert pr.json()["display_name"] == "TEST_crud_v2"

        # Download
        dr = requests.get(
            f"{BASE_URL}/api/projects/{DEAL_ID}/photos/{pid}/download",
            headers=auth_headers, timeout=15,
        )
        assert dr.status_code == 200
        assert dr.headers.get("content-type", "").startswith("image/")

        # Delete
        rr = requests.delete(
            f"{BASE_URL}/api/projects/{DEAL_ID}/photos/{pid}",
            headers=auth_headers, timeout=15,
        )
        assert rr.status_code == 200

        # Confirm filtered out
        lr = requests.get(
            f"{BASE_URL}/api/projects/{DEAL_ID}/photos",
            headers=auth_headers, timeout=15,
        )
        assert lr.status_code == 200
        assert all(p["id"] != pid for p in lr.json())

    def test_timeline_pdf_still_works(self, auth_headers):
        r = requests.get(
            f"{BASE_URL}/api/projects/{DEAL_ID}/photos/timeline.pdf",
            headers=auth_headers, timeout=30,
        )
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("application/pdf")
        assert r.content[:4] == b"%PDF"
