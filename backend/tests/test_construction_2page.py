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


def test_legacy_custom_scope_dumps_all_to_project_requirements():
    """Critical: legacy `custom_scope` with blank lines between paragraphs must NOT
    be auto-distributed across Project Requirements / Other / Exclusions buckets.
    All legacy text goes into Project Requirements; Exclusions falls back to defaults.
    """
    data = {
        "contact_name": "Test Owner",
        "contact_phone": "303-555-1111",
        "project_address": "1 Test Way",
        "product_type": "Drainage & Grading",
        "date": "2026-02-15",
        "opt_20": 1000,
        "custom_scope": (
            "Site preparation - clear material and debris\n"
            "\n"
            "Structural fill placement and grading - supply Class 1 fill\n"
            "\n"
            "River rock surface layer"
        ),
    }
    pdf = _render(data)
    p1 = _extract_page(pdf, 0)
    # All three bullets must land under Project Requirements — never under Other Requirements or Exclusions
    # We can't easily probe column position, but we CAN assert:
    #   - the bullets appear AFTER "Project Requirements" header
    #   - Exclusions section has the *default* boilerplate (Permit fees / hazardous materials / Work outside scope)
    pr_idx = p1.find("Project Requirements")
    excl_idx = p1.find("Exclusions")
    assert pr_idx != -1
    assert excl_idx != -1
    # Each legacy bullet appears between Project Requirements and Exclusions (i.e. NOT in Exclusions)
    for bullet in ["Site preparation", "Structural fill placement", "River rock surface layer"]:
        pos = p1.find(bullet)
        assert pos != -1, f"Missing bullet: {bullet}"
        assert pr_idx < pos < excl_idx, f"Bullet '{bullet}' leaked out of Project Requirements section"
    # Defaults populated under Exclusions
    assert "Permit fees" in p1
    assert "hazardous materials" in p1


def test_explicit_exclusions_override_defaults():
    data = {
        **SAMPLE_DATA,
        "construction_exclusions": "Customer is responsible for site dewatering.\nNo concrete cutting included.",
    }
    pdf = _render(data)
    p1 = _extract_page(pdf, 0)
    assert "Customer is responsible for site dewatering" in p1
    assert "concrete cutting" in p1
    # Default boilerplate must NOT appear when caller provides their own
    assert "Permit fees" not in p1


def test_writes_sample_pdf():
    """Useful for visual inspection. Writes to /tmp/construction_sample.pdf."""
    pdf = _render(SAMPLE_DATA)
    Path("/tmp/construction_sample.pdf").write_bytes(pdf)
    assert Path("/tmp/construction_sample.pdf").stat().st_size > 1000
