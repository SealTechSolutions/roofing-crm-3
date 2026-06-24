"""Iter 39 - Metal Roof Restoration spec-sheet regression.

Confirms:
  1. Page 1 of the Metal scope now ships a cover-photo placeholder + Inclusions block.
  2. Inclusions bullets are Darren's verbatim copy with SF/SQ/color interpolation.
  3. Page 2 uses the new 'Inspection and Repairs' + 'Surface Prep and Roof System' copy.
  4. FARM regression: Inclusions block still renders with the generic 3-bullet wording.
  5. Color substitution: 'dark bronze' interpolates literally (not hard-coded 'white').
"""
import os
import sys
import pytest
from io import BytesIO

# Allow imports from /app/backend
sys.path.insert(0, "/app/backend")

from spec_sheet import build_spec_sheet  # noqa: E402
from pdfminer.high_level import extract_text  # noqa: E402


def _extract_pages(pdf_bytes: bytes) -> list[str]:
    """Return a list of page texts from the rendered PDF."""
    from pdfminer.high_level import extract_text_to_fp
    from pdfminer.layout import LAParams
    out = BytesIO()
    extract_text_to_fp(BytesIO(pdf_bytes), out, laparams=LAParams(), output_type="text")
    full = out.getvalue().decode("utf-8", errors="ignore")
    # pdfminer uses form-feed \f between pages
    return full.split("\f")


# ---------------- Metal Roof Restoration ----------------

METAL_DATA_BASE = {
    "project_address": "TEST 1234 St",
    "color": "white",
    "total_sqft": 696,
    "warranty_years": 10,
    "roof_type_label": "Metal Roof Restoration",
    "proposal_options": {"A": {"warranty": "10-Year", "price": 4500.00}},
}


@pytest.fixture(scope="module")
def metal_pdf_bytes():
    return build_spec_sheet(dict(METAL_DATA_BASE), cover_photo_bytes=None, roof_type="metal")


def test_metal_pdf_basic(metal_pdf_bytes):
    """PDF renders, starts with %PDF, and has reasonable size."""
    assert isinstance(metal_pdf_bytes, bytes)
    assert metal_pdf_bytes[:4] == b"%PDF", f"Expected %PDF header, got {metal_pdf_bytes[:8]!r}"
    assert len(metal_pdf_bytes) > 100_000, f"PDF too small: {len(metal_pdf_bytes)} bytes"


def test_metal_page1_has_cover_and_inclusions(metal_pdf_bytes):
    """Page 1 should now contain the cover-photo placeholder + Inclusions block."""
    pages = _extract_pages(metal_pdf_bytes)
    assert len(pages) >= 2, f"Expected >=2 pages, got {len(pages)}"
    page1 = pages[0]
    assert "Cover photo placeholder" in page1, "Cover-photo placeholder missing from Page 1"
    assert "Inclusions" in page1, "Inclusions header missing from Page 1"
    # Darren's verbatim Inclusions copy + SF/SQ interpolation (696 -> 7 squares)
    assert "Install approximately 696 square feet (7 roofing squares) of white elastomeric roof coating system over the existing" in page1.replace("\n", " ")
    assert "Furnish all labor, materials, equipment, supervision, safety measures" in page1.replace("\n", " ")
    # "Provide the standard manufacturer" — apostrophe might get encoded; check prefix only
    assert "Provide the standard manufacturer" in page1.replace("\n", " ")


def test_metal_page2_has_new_headers_and_bullets(metal_pdf_bytes):
    pages = _extract_pages(metal_pdf_bytes)
    page2 = pages[1].replace("\n", " ")

    # Section headers
    assert "Inspection and Repairs" in page2, "Page 2 missing 'Inspection and Repairs' header"
    assert "Surface Prep and Roof System" in page2, "Page 2 missing 'Surface Prep and Roof System' header"
    # Sanity: must NOT use old 'Coating System' phrasing as a section header
    # (it could still appear inside bullet text, so only assert it's not as section header)
    # Skip this — just confirm the correct header is present.

    expected_substrings = [
        "Inspect all seams, fasteners, ridge caps",
        "Identify and document areas exhibiting rust",
        "Replace loose, failed, or backed-out fasteners with oversized fasteners equipped with neoprene sealing washers",
        "Repair or replace rusted, damaged, or perforated metal panels with matching gauge and profile",
        "Re-secure loose ridge caps, gable trim, eave metal, and gutter edge",
        "Pressure wash the entire roof surface to remove dirt, oxidation, chalking",
        "Prime all rusted areas with a rust-inhibitive metal primer",
        "Seal and reinforce all exposed fastener heads",
        "Apply a base coat of the selected acrylic or silicone elastomeric coating",
        "Apply a finish coat of the same selected acrylic or silicone elastomeric coating",
        "Perform a final quality-control inspection and project walkthrough",
    ]
    missing = [s for s in expected_substrings if s not in page2]
    assert not missing, f"Page 2 missing expected substrings: {missing}"


def test_metal_color_substitution():
    """color='dark bronze' must interpolate into the first Inclusions bullet."""
    data = dict(METAL_DATA_BASE, color="dark bronze")
    pdf_bytes = build_spec_sheet(data, cover_photo_bytes=None, roof_type="metal")
    page1 = _extract_pages(pdf_bytes)[0].replace("\n", " ")
    assert "of dark bronze elastomeric roof coating system" in page1, \
        "Color literal failed to substitute — Inclusions bullet should say 'dark bronze', not default 'white'"
    assert "of white elastomeric roof coating system" not in page1, \
        "Default 'white' leaked in despite color override"


# ---------------- FARM regression ----------------

def test_farm_page1_still_has_inclusions_and_generic_copy():
    """FARM/Silicone must still use the generic 3-bullet Inclusions (not Darren's metal-specific copy)."""
    data = {
        "project_address": "TEST FARM 5678 Ave",
        "color": "white",
        "total_sqft": 1200,
        "warranty_years": 20,
        "roof_type_label": "FARM (fluid applied reinforced membrane)",
        "proposal_options": {"A": {"warranty": "20-Year", "price": 18500.00}},
    }
    pdf_bytes = build_spec_sheet(data, cover_photo_bytes=None, roof_type="farm")
    assert pdf_bytes[:4] == b"%PDF"
    pages = _extract_pages(pdf_bytes)
    page1 = pages[0].replace("\n", " ")

    # Cover placeholder + Inclusions still present
    assert "Cover photo placeholder" in page1, "FARM Page 1 lost cover-photo placeholder"
    assert "Inclusions" in page1, "FARM Page 1 lost Inclusions header"

    # Generic 3-bullet wording: "Install approximately X SF (Y SQ) of a {color} {label} {system_word}"
    assert "Install approximately 1,200 SF (12 SQ) of a white FARM" in page1, \
        "FARM generic Inclusions copy missing — metal branch may have leaked over"
    assert "Provide all labor, materials, equipment, supervision, and insurance required for installation." in page1
    assert "Include the standard warranty corresponding to the selected system warranty term." in page1

    # Metal-specific copy MUST NOT appear on FARM scope
    assert "elastomeric roof coating system over the existing metal roof" not in page1, \
        "Metal-specific copy leaked into FARM Inclusions block"
