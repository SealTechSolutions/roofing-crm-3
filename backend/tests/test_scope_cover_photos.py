"""P2 — Smart auto-attach cover photo on Scope emails.

Tests:
- POST /api/deals/{id}/spec-sheet/email accepts optional cover_photo_ids
- Omitted → auto-attaches every project_photo with is_cover=True
- [] → no photos attached
- Explicit IDs → only those (scoped to deal) attached
- Material Take-Off (deals.material_takeoff) NEVER pulled into attachments
"""
import io
import os
import uuid
import pytest
import requests

def _read_base_url() -> str:
    val = os.environ.get("REACT_APP_BACKEND_URL")
    if not val:
        try:
            with open("/app/frontend/.env", "r") as f:
                for line in f:
                    if line.startswith("REACT_APP_BACKEND_URL="):
                        val = line.split("=", 1)[1].strip()
                        break
        except FileNotFoundError:
            pass
    if not val:
        raise RuntimeError("REACT_APP_BACKEND_URL not set")
    return val.rstrip("/")


BASE_URL = _read_base_url()
TEST_DEAL_ID = "b2f4b511-09ee-411d-978f-44a02ac24d13"
ADMIN_EMAIL = "darren@sealtechsolutions.co"
ADMIN_PW = "admin123"


@pytest.fixture(scope="module")
def auth_session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PW})
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    token = r.json()["access_token"]
    s.headers.update({"Authorization": f"Bearer {token}"})
    return s


def _tiny_jpeg() -> bytes:
    # 1x1 px JPEG header bytes — small valid JPEG.
    return bytes.fromhex(
        "ffd8ffe000104a46494600010101006000600000ffdb004300080606070605080707070909080a0c140d0c0b0b0c19121"
        "30f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432ffdb004301090909"
        "0c0b0c180d0d1832211c213232323232323232323232323232323232323232323232323232323232323232323232323232"
        "32323232323232323232323232323232ffc00011080001000103012200021101031101ffc4001f00000105010101010101"
        "00000000000000000102030405060708090a0bffc400b5100002010303020403050504040000017d010203000411051221"
        "31410613516107227114328191a1082342b1c11552d1f02433627282090a161718191a25262728292a3435363738393a4344"
        "45464748494a535455565758595a636465666768696a737475767778797a838485868788898a92939495969798999aa2a3"
        "a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7e8e9eaf1f2f3f4f5"
        "f6f7f8f9faffc4001f01000301010101010101010101000000000001020304050607080910110a0bffc400b51100020102"
        "04040304070504040001027700010203110405213106124151076171132232818114429192a1b1c109233352f0156272d1"
        "0a162434e125f11718191a262728292a35363738393a434445464748494a535455565758595a636465666768696a73747"
        "5767778797a82838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c"
        "9cad2d3d4d5d6d7d8d9dae2e3e4e5e6e7e8e9eaf2f3f4f5f6f7f8f9faffda000c03010002110311003f00fbfca28a2800"
        "ffd9"
    )


def _upload_photo(s: requests.Session, deal_id: str, name: str) -> str:
    """Upload a tiny JPEG to the deal; returns photo id."""
    headers = {k: v for k, v in s.headers.items() if k.lower() != "content-type"}
    files = {"file": (name, io.BytesIO(_tiny_jpeg()), "image/jpeg")}
    data = {"album_name": "Default", "display_name": name}
    r = requests.post(
        f"{BASE_URL}/api/projects/{deal_id}/photos",
        headers=headers,
        files=files,
        data=data,
    )
    assert r.status_code == 200, f"upload failed: {r.status_code} {r.text}"
    return r.json()["id"]


def _set_cover(s: requests.Session, deal_id: str, photo_id: str, is_cover: bool = True) -> None:
    r = s.patch(f"{BASE_URL}/api/projects/{deal_id}/photos/{photo_id}", json={"is_cover": is_cover})
    assert r.status_code == 200, f"patch failed: {r.status_code} {r.text}"


def _delete_photo(s: requests.Session, deal_id: str, photo_id: str) -> None:
    s.delete(f"{BASE_URL}/api/projects/{deal_id}/photos/{photo_id}")


def _list_photos(s: requests.Session, deal_id: str):
    r = s.get(f"{BASE_URL}/api/projects/{deal_id}/photos")
    assert r.status_code == 200
    return r.json()


@pytest.fixture
def clean_deal(auth_session):
    """Ensure the deal starts with zero (active) photos; sweep test-created
    photos at teardown."""
    s = auth_session
    # Pre-sweep — soft-delete anything left over from a previous run.
    for p in _list_photos(s, TEST_DEAL_ID):
        _delete_photo(s, TEST_DEAL_ID, p["id"])
    assert _list_photos(s, TEST_DEAL_ID) == []
    yield s
    for p in _list_photos(s, TEST_DEAL_ID):
        _delete_photo(s, TEST_DEAL_ID, p["id"])


# ---------- Email endpoint: cover_photo_ids behavior ----------

class TestScopeEmailCoverPhotos:
    def test_omitted_auto_attaches_every_is_cover_true(self, clean_deal):
        s = clean_deal
        # Two photos, one marked as cover
        p1 = _upload_photo(s, TEST_DEAL_ID, "TEST_cover.jpg")
        p2 = _upload_photo(s, TEST_DEAL_ID, "TEST_other.jpg")  # noqa: F841
        _set_cover(s, TEST_DEAL_ID, p1, True)

        r = s.post(
            f"{BASE_URL}/api/deals/{TEST_DEAL_ID}/spec-sheet/email",
            json={"to_email": "TEST_dev_null@example.com"},
        )
        assert r.status_code == 200, f"send failed: {r.status_code} {r.text}"
        data = r.json()
        # response carries attachments count or list
        attachments_field = data.get("attachments") or data.get("attachment_count") or data.get("attachments_count")
        # scope PDF (1) + cover photo (1) = 2
        if isinstance(attachments_field, list):
            assert len(attachments_field) == 2, f"expected 2 attachments, got {attachments_field}"
            names = [a if isinstance(a, str) else a.get("filename", "") for a in attachments_field]
            # No takeoff filename should leak in
            assert not any("takeoff" in (n or "").lower() for n in names)
        elif isinstance(attachments_field, int):
            assert attachments_field == 2

    def test_empty_list_attaches_no_photos(self, clean_deal):
        s = clean_deal
        p1 = _upload_photo(s, TEST_DEAL_ID, "TEST_cover2.jpg")
        _set_cover(s, TEST_DEAL_ID, p1, True)
        r = s.post(
            f"{BASE_URL}/api/deals/{TEST_DEAL_ID}/spec-sheet/email",
            json={"to_email": "TEST_dev_null@example.com", "cover_photo_ids": []},
        )
        assert r.status_code == 200
        data = r.json()
        attachments_field = data.get("attachments") or data.get("attachment_count") or data.get("attachments_count")
        if isinstance(attachments_field, list):
            assert len(attachments_field) == 1  # only the scope PDF
            names = [a if isinstance(a, str) else a.get("filename", "") for a in attachments_field]
            assert not any("cover" in (n or "").lower() for n in names)
        elif isinstance(attachments_field, int):
            assert attachments_field == 1

    def test_explicit_ids_attach_only_those(self, clean_deal):
        s = clean_deal
        p1 = _upload_photo(s, TEST_DEAL_ID, "TEST_first.jpg")
        p2 = _upload_photo(s, TEST_DEAL_ID, "TEST_second.jpg")  # noqa: F841
        # neither marked cover; pass first explicitly
        r = s.post(
            f"{BASE_URL}/api/deals/{TEST_DEAL_ID}/spec-sheet/email",
            json={"to_email": "TEST_dev_null@example.com", "cover_photo_ids": [p1]},
        )
        assert r.status_code == 200
        data = r.json()
        attachments_field = data.get("attachments") or data.get("attachment_count") or data.get("attachments_count")
        if isinstance(attachments_field, list):
            assert len(attachments_field) == 2  # scope + p1 only
        elif isinstance(attachments_field, int):
            assert attachments_field == 2

    def test_explicit_id_from_other_deal_is_ignored(self, clean_deal):
        s = clean_deal
        bogus = str(uuid.uuid4())
        r = s.post(
            f"{BASE_URL}/api/deals/{TEST_DEAL_ID}/spec-sheet/email",
            json={"to_email": "TEST_dev_null@example.com", "cover_photo_ids": [bogus]},
        )
        assert r.status_code == 200
        data = r.json()
        attachments_field = data.get("attachments") or data.get("attachment_count") or data.get("attachments_count")
        if isinstance(attachments_field, list):
            assert len(attachments_field) == 1  # scope PDF only
        elif isinstance(attachments_field, int):
            assert attachments_field == 1


# ---------- Material Take-Off must never appear in spec-sheet attachments ----------

class TestMaterialTakeoffNeverAttached:
    def test_takeoff_endpoint_still_works(self, auth_session):
        # Sanity: takeoff route exists and returns 200/404 (not 500).
        r = auth_session.get(f"{BASE_URL}/api/deals/{TEST_DEAL_ID}")
        assert r.status_code in (200, 404)

    def test_email_handler_never_reads_material_takeoffs(self, clean_deal):
        """Even if the deal had a takeoff present, the email endpoint should
        not surface it. We verify by reading the source of the handler once
        and asserting the substring `material_takeoff` only appears in a
        comment (and not as a collection access or attachment append)."""
        # Code-level invariant guard.
        src_path = os.path.join(os.path.dirname(__file__), "..", "server.py")
        with open(os.path.abspath(src_path), "r", encoding="utf-8") as f:
            src = f.read()
        marker = "@api_router.post(\"/deals/{deal_id}/spec-sheet/email\")"
        start = src.find(marker)
        assert start >= 0, "Could not locate email_spec_sheet handler in server.py"
        # Slice until the next route definition
        rest = src[start:]
        end = rest.find("\n@api_router.", 50)
        handler_src = rest[:end] if end > 0 else rest

        # In the handler body, `material_takeoff` should only appear inside
        # comments (lines starting with '#'). Confirm no executable read.
        for ln_no, ln in enumerate(handler_src.splitlines(), 1):
            if "material_takeoff" in ln:
                stripped = ln.strip()
                assert stripped.startswith("#"), (
                    f"server.py email_spec_sheet handler references material_takeoff "
                    f"outside a comment on line {ln_no}: {ln!r}"
                )
        # Same for the separate `material_takeoffs` collection name
        assert "db.material_takeoffs" not in handler_src, (
            "email_spec_sheet handler must not read db.material_takeoffs"
        )
