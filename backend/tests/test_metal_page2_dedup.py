"""Iter 40 — Metal Roof Restoration Page-2 duplicate Inclusions/cover-photo fix.

User Darren reported a SECOND duplicate Inclusions block + cover-photo placeholder
still rendering on Page 2 of the Metal scope PDF (with the OLD generic copy
"Approximately 696 SF (7 SQ) ...") even after iter 39 moved Inclusions to Page 1.

Root cause: spec_sheet.py page-2 Inclusions gate (line ~1665) and cover-photo
gate (line ~1678) only checked `tier_table` + `dynamic_scope`. METAL_TEMPLATE
now has `inclusions_template` (added iter 39) but neither gate checked for it.

Fix: widened both gates to ALSO skip when `inclusions_template` is set.

Tests cover:
  1. Metal Page 2 NO LONGER has duplicate "Approximately 696 SF (7 SQ)" copy,
     no "Cover photo placeholder", and no SECOND "Inclusions" header.
  2. Metal Page 1 still has the legitimate Inclusions header + Darren's bullets
     + the cover-photo placeholder (iter 39 intact).
  3. FARM regression: Page 2 still has no duplicate (tier_table gate intact).
  4. Tile/Shingle: Page 2 STILL renders the Inclusions header + generic copy +
     cover-photo block — these templates legitimately use the Page-2 block.
  5. Metal PDF page count is now 3 (was 4 in iter 39 because of the dupes).
"""
import sys
from io import BytesIO

import pytest

sys.path.insert(0, "/app/backend")

from spec_sheet import build_spec_sheet  # noqa: E402


def _extract_pages(pdf_bytes: bytes) -> list[str]:
    from pdfminer.high_level import extract_text_to_fp
    from pdfminer.layout import LAParams
    out = BytesIO()
    extract_text_to_fp(BytesIO(pdf_bytes), out, laparams=LAParams(), output_type="text")
    return out.getvalue().decode("utf-8", errors="ignore").split("\f")


METAL_DATA = {
    "project_address": "TEST 1234 St",
    "color": "white",
    "total_sqft": 696,
    "warranty_years": 10,
    "roof_type_label": "Metal Roof Restoration",
    "proposal_options": {"A": {"warranty": "10-Year", "price": 4500.00}},
}


# ---------------- METAL ----------------

@pytest.fixture(scope="module")
def metal_pages():
    pdf = build_spec_sheet(dict(METAL_DATA), cover_photo_bytes=None, roof_type="metal")
    assert pdf[:4] == b"%PDF"
    return _extract_pages(pdf)


def test_metal_pdf_is_three_pages(metal_pages):
    """With dupes removed, Metal PDF should fit in 3 pages (was 4 in iter 39)."""
    # Trailing empty page split is possible — count only non-empty pages.
    non_empty = [p for p in metal_pages if p.strip()]
    assert len(non_empty) == 3, (
        f"Expected 3 pages after dedup, got {len(non_empty)}. "
        f"Page lengths: {[len(p) for p in non_empty]}"
    )


def test_metal_page2_no_duplicate_inclusions(metal_pages):
    """THE critical assertion: Page 2 must not have the old generic Inclusions dupe."""
    page2 = metal_pages[1]
    page2_flat = page2.replace("\n", " ")

    # 1) Old generic "Approximately X SF (Y SQ)" line must be GONE from Page 2
    assert "Approximately 696 SF" not in page2_flat, (
        f"Page 2 still contains old generic Inclusions dupe. Excerpt:\n{page2_flat[:500]}"
    )
    assert "(7 SQ)" not in page2_flat, "Page 2 still contains '7 SQ' from old Inclusions dupe"

    # 2) Cover photo placeholder caption must be GONE from Page 2
    assert "Cover photo placeholder" not in page2_flat, (
        "Page 2 still contains 'Cover photo placeholder' — duplicate cover block not removed"
    )

    # 3) The SECOND "Inclusions" header must be gone
    inclusions_count = page2.count("Inclusions")
    assert inclusions_count == 0, (
        f"Page 2 should have 0 'Inclusions' headers but found {inclusions_count}"
    )

    # 4) Sanity — Page 2 should still have its legitimate scope content
    assert "Inspection and Repairs" in page2_flat, (
        "Page 2 lost its legitimate 'Inspection and Repairs' header"
    )
    assert "Surface Prep and Roof System" in page2_flat, (
        "Page 2 lost its legitimate 'Surface Prep and Roof System' header"
    )


def test_metal_page1_inclusions_intact(metal_pages):
    """Page 1 must still have the LEGITIMATE Inclusions block from iter 39."""
    page1 = metal_pages[0].replace("\n", " ")
    assert "Inclusions" in page1, "Page 1 lost its Inclusions header"
    assert "Install approximately 696 square feet (7 roofing squares)" in page1, \
        "Page 1 lost Darren's verbatim first Inclusions bullet"
    assert "Furnish all labor" in page1, "Page 1 lost 'Furnish all labor' bullet"
    assert "Provide the standard manufacturer" in page1, \
        "Page 1 lost 'Provide the standard manufacturer' bullet"
    assert "Cover photo placeholder" in page1, "Page 1 lost legitimate cover-photo placeholder"


# ---------------- FARM regression (tier_table — gate already correct) ----------------

def test_farm_page2_no_inclusions_duplicate():
    """FARM uses tier_table so Page 2 should never have had the dup. Verify still clean."""
    data = {
        "project_address": "TEST FARM 5678 Ave",
        "color": "white",
        "total_sqft": 10000,
        "warranty_years": 20,
        "roof_type_label": "FARM (fluid applied reinforced membrane)",
        "proposal_options": {"A": {"warranty": "20-Year", "price": 185000.00}},
    }
    pdf = build_spec_sheet(data, cover_photo_bytes=None, roof_type="farm")
    pages = _extract_pages(pdf)
    assert len(pages) >= 2

    # Find the page containing the tier-table / scope content (not Page 1 which has Inclusions)
    page2 = pages[1].replace("\n", " ")
    assert "Approximately 10,000 SF" not in page2, (
        "FARM Page 2 should not contain the old generic 'Approximately X SF' duplicate"
    )
    # FARM still uses generic Page-1 Inclusions, so the Page-1 wording should be there
    page1 = pages[0].replace("\n", " ")
    assert "Inclusions" in page1


# ---------------- Tile/Shingle (templates that LEGITIMATELY use Page-2 Inclusions) ----------------

@pytest.mark.parametrize("roof_type,label", [
    ("tile", "Tile"),
    ("shingle", "Shingle"),
])
def test_tile_shingle_page2_still_has_inclusions(roof_type, label):
    """Tile/Shingle templates have neither tier_table nor inclusions_template
    so the Page-2 Inclusions + cover-photo block must STILL render. This proves
    the gate-widening didn't accidentally strip it from templates that need it.
    """
    data = {
        "project_address": f"TEST {label} 9999 Rd",
        "color": "charcoal",
        "total_sqft": 2500,
        "warranty_years": 25,
        "roof_type_label": label,
        "proposal_options": {"A": {"warranty": "25-Year", "price": 28000.00}},
    }
    pdf = build_spec_sheet(data, cover_photo_bytes=None, roof_type=roof_type)
    assert pdf[:4] == b"%PDF"
    pages = _extract_pages(pdf)
    assert len(pages) >= 2, f"{label} PDF has only {len(pages)} pages"

    full = " ".join(p.replace("\n", " ") for p in pages)
    # The legitimate Page-2 Inclusions for tile/shingle uses the generic
    # "Approximately X SF (Y SQ) {color} {label} system, including walls and flashings." line
    assert "Approximately 2,500 SF (25 SQ)" in full, (
        f"{label} lost the legitimate Page-2 Inclusions generic line"
    )
    assert "Cover photo placeholder" in full, (
        f"{label} lost the legitimate Page-2 cover-photo placeholder"
    )
    assert "Inclusions" in full, f"{label} lost the Inclusions header"
