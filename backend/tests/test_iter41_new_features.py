"""Iter 41 — Backend tests for 4 new features:
1) GET /api/deals/photo-counts — map of {deal_id: count}
2) GET /api/search?q= — global omnibar search
3) POST /api/projects/{deal_id}/photos/auto-tag — Claude Vision auto-tag
4) POST /api/projects/{deal_id}/photo-shares — multi-tag support + public share

DOES NOT mutate real user data — auto-tag reverts on 2 photos, shares are revoked.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://roofing-crm-3.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "darren@sealtechsolutions.co"
ADMIN_PASSWORD = "admin123"
REAL_DEAL_ID = "b2f4b511-09ee-411d-978f-44a02ac24d13"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def headers(token):
    return {"Authorization": f"Bearer {token}"}


# ============ Feature 1: photo-counts ============
class TestPhotoCounts:
    def test_photo_counts_map_returned(self, headers):
        r = requests.get(f"{BASE_URL}/api/deals/photo-counts", headers=headers, timeout=30)
        assert r.status_code == 200, f"photo-counts failed: {r.text}"
        data = r.json()
        assert isinstance(data, dict), "photo-counts should return a dict"
        # values must be ints
        for k, v in data.items():
            assert isinstance(k, str)
            assert isinstance(v, int)

    def test_real_deal_has_38_photos(self, headers):
        r = requests.get(f"{BASE_URL}/api/deals/photo-counts", headers=headers, timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert REAL_DEAL_ID in data, f"Real deal {REAL_DEAL_ID} missing from photo-counts response"
        count = data[REAL_DEAL_ID]
        assert count == 38, f"Expected 38 photos on real deal, got {count}"


# ============ Feature 2: /api/search ============
class TestGlobalSearch:
    def test_search_roof_returns_deals(self, headers):
        r = requests.get(f"{BASE_URL}/api/search", headers=headers, params={"q": "roof"}, timeout=30)
        assert r.status_code == 200
        data = r.json()
        for key in ("deals", "contacts", "properties", "invoices", "vendors"):
            assert key in data, f"Missing group '{key}' in search response"
            assert isinstance(data[key], list)
        assert len(data["deals"]) >= 1, f"Expected >=1 deal for q='roof', got {len(data['deals'])}"

    def test_search_darren_returns_contacts(self, headers):
        r = requests.get(f"{BASE_URL}/api/search", headers=headers, params={"q": "darren"}, timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert len(data["contacts"]) >= 1, f"Expected >=1 contact for q='darren', got {len(data['contacts'])}"

    def test_search_no_match_returns_empty(self, headers):
        r = requests.get(f"{BASE_URL}/api/search", headers=headers, params={"q": "xxxxxnope"}, timeout=30)
        assert r.status_code == 200
        data = r.json()
        for key in ("deals", "contacts", "properties", "invoices", "vendors"):
            assert data[key] == [], f"Expected empty {key} for nonsense query, got {data[key]}"

    def test_search_too_short_returns_empty(self, headers):
        r = requests.get(f"{BASE_URL}/api/search", headers=headers, params={"q": "a"}, timeout=30)
        assert r.status_code == 200
        data = r.json()
        for key in ("deals", "contacts", "properties", "invoices", "vendors"):
            assert data[key] == [], f"Expected empty {key} for too-short query, got {data[key]}"


# ============ Feature 3: AI Auto-Tag ============
class TestAutoTag:
    def test_auto_tag_two_photos_and_revert(self, headers):
        # Get photos on real deal, pick index 12 and 13
        r = requests.get(f"{BASE_URL}/api/projects/{REAL_DEAL_ID}/photos", headers=headers, timeout=30)
        assert r.status_code == 200, f"Could not fetch photos: {r.text}"
        photos = r.json()
        assert len(photos) >= 14, f"Need >=14 photos, got {len(photos)}"

        target_photos = [photos[12], photos[13]]
        target_ids = [p["id"] for p in target_photos]
        # Snapshot original tags for revert
        original_tags = {p["id"]: (p.get("tag") or "") for p in target_photos}

        try:
            # Fire auto-tag
            payload = {"only_untagged": False, "photo_ids": target_ids, "max_photos": 10}
            r = requests.post(
                f"{BASE_URL}/api/projects/{REAL_DEAL_ID}/photos/auto-tag",
                headers=headers,
                json=payload,
                timeout=180,  # Claude Vision can be slow
            )
            assert r.status_code == 200, f"auto-tag failed: {r.status_code} {r.text}"
            data = r.json()
            assert data["processed"] == 2, f"Expected processed=2, got {data['processed']}"
            assert (data["tagged"] + data["skipped"]) == 2
            # At least one of tagged/skipped >0 (test spec)
            assert (data["tagged"] > 0 or data["skipped"] > 0), "Expected tagged or skipped > 0"
            assert isinstance(data.get("results"), list)
            assert len(data["results"]) == 2
        finally:
            # ALWAYS revert (empty tag) so we don't leave test tags on real photos
            for pid, orig in original_tags.items():
                revert = requests.patch(
                    f"{BASE_URL}/api/projects/{REAL_DEAL_ID}/photos/{pid}",
                    headers=headers,
                    json={"tag": orig},
                    timeout=30,
                )
                # Non-fatal if this fails, just log
                if revert.status_code != 200:
                    print(f"WARN: revert of photo {pid} tag={orig!r} failed: {revert.status_code} {revert.text}")


# ============ Feature 4: Multi-tag Photo Shares ============
class TestPhotoSharesMultiTag:
    def test_create_multi_tag_share_and_public_returns_tags(self, headers):
        # Create the multi-tag share
        payload = {"tags": ["Damage Documentation", "After"], "download_enabled": True, "expires_in_days": 1}
        r = requests.post(
            f"{BASE_URL}/api/projects/{REAL_DEAL_ID}/photo-shares",
            headers=headers,
            json=payload,
            timeout=30,
        )
        assert r.status_code == 200, f"create share failed: {r.status_code} {r.text}"
        share = r.json()
        assert "token" in share
        assert share.get("tags") is not None
        assert set(share["tags"]) == {"Damage Documentation", "After"}
        token = share["token"]

        try:
            # Verify public endpoint (no auth) returns tags array
            r = requests.get(f"{BASE_URL}/api/public/photo-share/{token}", timeout=30)
            assert r.status_code == 200, f"public share fetch failed: {r.text}"
            pub = r.json()
            assert pub.get("tags") is not None
            assert set(pub["tags"]) == {"Damage Documentation", "After"}
            assert isinstance(pub.get("photos"), list)
        finally:
            # Revoke
            requests.delete(
                f"{BASE_URL}/api/projects/{REAL_DEAL_ID}/photo-shares/{token}",
                headers=headers,
                timeout=30,
            )

    def test_create_legacy_single_tag_share(self, headers):
        # Legacy single-tag path
        payload = {"tag": "Before", "download_enabled": True, "expires_in_days": 1}
        r = requests.post(
            f"{BASE_URL}/api/projects/{REAL_DEAL_ID}/photo-shares",
            headers=headers,
            json=payload,
            timeout=30,
        )
        assert r.status_code == 200, f"legacy tag share failed: {r.status_code} {r.text}"
        share = r.json()
        token = share["token"]
        # tag field could be echoed either directly or via tags[0]
        tag_ok = share.get("tag") == "Before" or (share.get("tags") == ["Before"])
        assert tag_ok, f"Expected legacy tag 'Before' in response, got {share}"

        try:
            r = requests.get(f"{BASE_URL}/api/public/photo-share/{token}", timeout=30)
            assert r.status_code == 200
            pub = r.json()
            # public endpoint should surface either tag or tags
            has_before = pub.get("tag") == "Before" or (pub.get("tags") and "Before" in pub["tags"])
            assert has_before, f"Public share missing 'Before' tag: {pub}"
        finally:
            requests.delete(
                f"{BASE_URL}/api/projects/{REAL_DEAL_ID}/photo-shares/{token}",
                headers=headers,
                timeout=30,
            )
