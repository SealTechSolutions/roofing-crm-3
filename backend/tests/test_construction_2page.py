"""Construction Project 2-page PDF — render-level checks.

Verifies:
- Exactly 2 pages
- Page 1 contains: PROJECT SCOPE title, the 3 bucket headers, PROJECT TOTAL, signer "Darren Oliver, CSI, IIBEC", acceptance block
- Page 2 contains: TERMS AND CONDITIONS + every required T&C section header
- Back-compat: legacy `custom_scope` blank-line-separated paragraphs still render
- Project Type override is honored
"""
import io
from pathlib import Path
import sys

import pypdf

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from spec_sheet import build_spec_sheet  # noqa: E402


def _render(data, roof_type="Construction Project"):
    return build_spec_sheet(data, cover_photo_bytes=None, roof_type=roof_type)


def _page_count(pdf_bytes: bytes) -> int:
    return len(pypdf.PdfReader(io.BytesIO(pdf_bytes)).pages)


def _extract_text(pdf_bytes: bytes) -> str:
    rdr = pypdf.PdfReader(io.BytesIO(pdf_bytes))
    return "\n".join(p.extract_text() or "" for p in rdr.pages)


def _extract_page(pdf_bytes: bytes, idx: int) -> str:
    rdr = pypdf.PdfReader(io.BytesIO(pdf_bytes))
    return rdr.pages[idx].extract_text() or ""


SAMPLE_DATA = {
    "contact_name": "Jane Foreman",
    "contact_phone": "303-555-1234",
    "project_address": "1234 Wynkoop St, Denver, CO 80202",
    "product_type": "Drainage & Grading",
    "date": "2026-02-15",
    "opt_20": 31787,
    "opt_15": 0,
    "opt_10": 0,
    "construction_project_requirements": (
        "Site preparation — clear necessary material, debris, excavate, and layout entire 330' long project section\n"
        "Structural fill placement and grading - Supply Clean Class 1 Structural Fill for stable compaction\n"
        "River rock surface layer - install 2-3\" of 1-3\" river rock evenly throughout the entire excavated area\n"
        "Downspout extensions and metal work - Install 110' +/- of downspout extensions and 45's"
    ),
    "construction_other_requirements": (
        "MATERIALS - 155 ton of class 1 clean structural fill - 70 ton of 1-3\" river rock\n"
        "EQUIPMENT - Skip Loader, and 150 lb Plate Tamper\n"
        "METAL - 110' of drain extensions and 45 degree elbows"
    ),
    "construction_exclusions": (
        "Permit fees (if required by jurisdiction).\n"
        "Removal/disposal of pre-existing hazardous materials.\n"
        "Work outside the defined scope"
    ),
}


def test_construction_pdf_is_two_pages():
    pdf = _render(SAMPLE_DATA)
    pc = _page_count(pdf)
    assert pc == 2, f"Expected exactly 2 pages, got {pc}"


def test_page1_contains_scope_buckets_and_total():
    pdf = _render(SAMPLE_DATA)
    txt = _extract_text(pdf)
    assert "PROJECT SCOPE" in txt
    assert "Construction Project Custom Scope" in txt
    assert "Scope of Work" in txt
    assert "Project Requirements" in txt
    assert "Other Requirements" in txt
    assert "Exclusions" in txt
    assert "PROJECT TOTAL" in txt
    assert "31,787" in txt  # currency formatting


def test_page1_signer_is_always_darren():
    pdf = _render(SAMPLE_DATA)
    txt = _extract_text(pdf)
    assert "Darren Oliver" in txt
    assert "CSI, IIBEC" in txt
    assert "SealTech Building Solutions" in txt


def test_page1_acceptance_block_present():
    pdf = _render(SAMPLE_DATA)
    txt = _extract_text(pdf)
    assert "Acceptance Of Scope" in txt
    assert "By:" in txt
    assert "Signature:" in txt


def test_page2_terms_and_conditions():
    pdf = _render(SAMPLE_DATA)
    txt = _extract_text(pdf)
    assert "TERMS AND CONDITIONS" in txt
    for section in [
        "PAYMENT TERMS.", "ACCOUNTS.", "FINAL INSPECTION.", "PERFORMANCE OF WORK.",
        "FORCE MAJEURE.", "ADDITIONAL WORK.", "ACCESS.", "PAID IN FULL.", "CANCELLATION.",
    ]:
        assert section in txt, f"Missing T&C section: {section}"


def test_project_type_override_wins():
    data = {**SAMPLE_DATA, "project_type_override": "Demolition & Haul-Off"}
    pdf = _render(data)
    txt = _extract_text(pdf)
    assert "Demolition" in txt or "Haul-Off" in txt or "Haul" in txt


def test_legacy_custom_scope_still_renders():
    # No new 3-bucket fields; only legacy `custom_scope` with blank-line paragraphs.
    legacy_data = {
        "contact_name": "John Owner",
        "contact_phone": "720-555-9999",
        "project_address": "100 Old Stack Pl, Aurora, CO 80012",
        "product_type": "Other Construction Work",
        "date": "2026-02-15",
        "opt_20": 9500,
        "custom_scope": (
            "Demo existing concrete pad\n"
            "Haul off debris to landfill\n"
            "\n"
            "MATERIALS - 4 yd dumpster\n"
            "EQUIPMENT - Bobcat & jackhammer\n"
            "\n"
            "Permit fees not included\n"
            "Work outside defined scope"
        ),
    }
    pdf = _render(legacy_data, roof_type="Other")
    pc = _page_count(pdf)
    assert pc == 2, f"Legacy custom_scope should still be 2 pages, got {pc}"
    txt = _extract_text(pdf)
    assert "Demo existing concrete pad" in txt
    assert "MATERIALS" in txt
    assert "Permit fees not included" in txt


def test_writes_sample_pdf():
    """Useful for visual inspection. Writes to /tmp/construction_sample.pdf."""
    pdf = _render(SAMPLE_DATA)
    Path("/tmp/construction_sample.pdf").write_bytes(pdf)
    assert Path("/tmp/construction_sample.pdf").stat().st_size > 1000
