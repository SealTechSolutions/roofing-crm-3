"""Iter 40 — Live E2E check of Page-2 dedup on the Metal scope.

Hits the deployed /api/deals/{id}/spec-sheet.pdf endpoint, flips the
TEST_Lead Deal to Metal, asserts Page 2 has no duplicate Inclusions/cover-photo
content, then restores the original proposed_roof_type at teardown.
"""
import os
import sys
from io import BytesIO

import pytest
import requests

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL", "https://roofing-crm-3.preview.emergentagent.com"
).rstrip("/")
DEAL_ID = "640a9104-0bd5-44dd-9f13-51e4b8cd2e4e"
ADMIN_EMAIL = "darren@sealtechsolutions.co"
ADMIN_PASSWORD = "admin123"


def _extract_pages(pdf_bytes: bytes) -> list[str]:
    from pdfminer.high_level import extract_text_to_fp
    from pdfminer.layout import LAParams
    out = BytesIO()
    extract_text_to_fp(BytesIO(pdf_bytes), out, laparams=LAParams(), output_type="text")
    return out.getvalue().decode("utf-8", errors="ignore").split("\f")


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text[:300]}"
    tok = r.json().get("access_token") or r.json().get("token")
    if tok:
        s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


@pytest.fixture(scope="module")
def deal_metal(session):
    gd = session.get(f"{BASE_URL}/api/deals/{DEAL_ID}")
    assert gd.status_code == 200
    deal = gd.json()
    original = deal.get("proposed_roof_type")

    payload = {k: v for k, v in deal.items() if k not in (
        "id", "created_at", "updated_at", "deal_number", "events", "scope_send_log"
    )}
    payload["proposed_roof_type"] = "Metal"
    up = session.put(f"{BASE_URL}/api/deals/{DEAL_ID}", json=payload)
    assert up.status_code in (200, 201), f"PUT failed: {up.status_code} {up.text[:300]}"

    yield deal

    payload2 = {k: v for k, v in deal.items() if k not in (
        "id", "created_at", "updated_at", "deal_number", "events", "scope_send_log"
    )}
    payload2["proposed_roof_type"] = original
    session.put(f"{BASE_URL}/api/deals/{DEAL_ID}", json=payload2)
    after = session.get(f"{BASE_URL}/api/deals/{DEAL_ID}").json()
    assert after["proposed_roof_type"] == original, (
        f"Cleanup failed — proposed_roof_type is {after['proposed_roof_type']}, expected {original}"
    )


def test_metal_live_page2_no_duplicate(session, deal_metal):
    r = session.get(f"{BASE_URL}/api/deals/{DEAL_ID}/spec-sheet.pdf")
    assert r.status_code == 200
    assert r.content[:4] == b"%PDF"
    pages = _extract_pages(r.content)
    assert len(pages) >= 2, f"Got only {len(pages)} pages"

    page2 = pages[1]
    page2_flat = page2.replace("\n", " ")

    # The duplicate signatures from user's screenshot
    assert "Approximately" not in page2_flat or "SF" not in page2_flat or "SQ" not in page2_flat, (
        f"Page 2 still contains old 'Approximately X SF (Y SQ)' duplicate. Excerpt:\n{page2_flat[:600]}"
    )
    # Cover photo placeholder text must not be on Page 2 (Page 1 still has it)
    assert "Cover photo placeholder" not in page2_flat, (
        "Page 2 still contains the 'Cover photo placeholder' caption — second cover block not removed"
    )
    # No second Inclusions header
    assert page2.count("Inclusions") == 0, (
        f"Page 2 should have 0 Inclusions headers but found {page2.count('Inclusions')}"
    )

    # Page 1 must still have the legitimate Inclusions
    page1 = pages[0].replace("\n", " ")
    assert "Inclusions" in page1, "Page 1 lost legitimate Inclusions header"
    assert "Cover photo placeholder" in page1, "Page 1 lost legitimate cover placeholder"


def test_metal_live_pdf_page_count_reduced(session, deal_metal):
    """With dupes removed, the live Metal PDF should be 3-4 pages.

    Note: the TEST_Lead Deal has total_sqft=0 which triggers the documented
    iter-39 overflow (long Inclusions bullets spill from Page 1 to Page 2),
    so 4 pages is acceptable in this specific live scenario. The unit test
    with total_sqft=696 already proves the canonical 3-page layout.

    What this test guarantees: no duplicate Inclusions/cover-photo content on
    any page (dedup is what we're verifying here, the count is sanity-only).
    """
    r = session.get(f"{BASE_URL}/api/deals/{DEAL_ID}/spec-sheet.pdf")
    assert r.status_code == 200
    pages = _extract_pages(r.content)
    non_empty = [p for p in pages if p.strip()]
    assert 3 <= len(non_empty) <= 4, (
        f"Expected 3-4 pages, got {len(non_empty)}. Lengths: {[len(p) for p in non_empty]}"
    )

    # Cross-page dedup: only ONE 'Inclusions' header across the whole doc
    full = "\n".join(pages)
    assert full.count("Inclusions") == 1, (
        f"Whole document should have exactly 1 'Inclusions' header, found {full.count('Inclusions')}"
    )
    # Cross-page dedup: only ONE 'Cover photo placeholder' caption
    assert full.count("Cover photo placeholder") == 1, (
        f"Whole document should have exactly 1 'Cover photo placeholder' caption, "
        f"found {full.count('Cover photo placeholder')}"
    )
