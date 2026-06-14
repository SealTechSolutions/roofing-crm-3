"""SealTech Commercial Roof Assessment Report — PDF generator (12-page layout).

Mirrors the source PDF the user shared. Pulls photos from object storage
(`project_photos.storage_path`) via `storage.get_object()` so any photos referenced
by `aerial_photo_id` or `finding_rX.photo_ids[]` are embedded inline.

Public API:
    await build_assessment_pdf(db, assessment_doc) -> bytes
"""
from __future__ import annotations

import io
import os
from datetime import datetime
from io import BytesIO
from typing import List

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    Image, KeepTogether, PageBreak, ListFlowable, ListItem,
)
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT

from storage import get_object

LOGO_PATH = os.path.join(os.path.dirname(__file__), "assets", "sealtech-logo.png")

# Brand palette
BLUE   = colors.HexColor("#1D4ED8")
BRONZE = colors.HexColor("#A0703A")
DARK   = colors.HexColor("#0A0A0A")
GRAY   = colors.HexColor("#52525B")
LIGHT  = colors.HexColor("#F4F4F5")
BORDER = colors.HexColor("#E4E4E7")
GREEN  = colors.HexColor("#16A34A")
AMBER  = colors.HexColor("#D97706")
RED    = colors.HexColor("#B91C1C")
SOFT_BLUE = colors.HexColor("#EFF6FF")
SOFT_BRONZE = colors.HexColor("#FBF7F0")
BOX_BORDER = colors.HexColor("#C7C7CC")  # Soft light grey for all section boxes (just visible)

PAGE_TAGLINE = "Extending Roof Life Through Restorative Solutions™"


# ---------- Styles ----------

def _styles():
    return {
        "eyebrow":   ParagraphStyle("eyebrow", fontName="Helvetica-Bold", fontSize=8, textColor=BRONZE, leading=10, spaceAfter=2),
        "title":     ParagraphStyle("title", fontName="Helvetica-Bold", fontSize=22, textColor=DARK, leading=26, alignment=TA_CENTER, spaceAfter=6),
        "subtitle":  ParagraphStyle("subtitle", fontName="Helvetica-Oblique", fontSize=11, textColor=GRAY, leading=14, alignment=TA_CENTER, spaceAfter=14),
        "h1":        ParagraphStyle("h1", fontName="Helvetica-Bold", fontSize=16, textColor=BLUE, leading=20, spaceBefore=6, spaceAfter=8),
        "h2":        ParagraphStyle("h2", fontName="Helvetica-Bold", fontSize=12, textColor=DARK, leading=15, spaceBefore=8, spaceAfter=4),
        "h3":        ParagraphStyle("h3", fontName="Helvetica-Bold", fontSize=10, textColor=BLUE, leading=12, spaceBefore=6, spaceAfter=2),
        "label":     ParagraphStyle("label", fontName="Helvetica-Bold", fontSize=8, textColor=GRAY, leading=10),
        "body":      ParagraphStyle("body", fontName="Helvetica", fontSize=10, textColor=DARK, leading=14, spaceAfter=3),
        "body_sm":   ParagraphStyle("body_sm", fontName="Helvetica", fontSize=9, textColor=DARK, leading=12),
        "muted":     ParagraphStyle("muted", fontName="Helvetica", fontSize=8, textColor=GRAY, leading=11),
        "score_num": ParagraphStyle("score_num", fontName="Helvetica-Bold", fontSize=18, textColor=BLUE, leading=20, alignment=TA_CENTER),
        "score_label": ParagraphStyle("score_label", fontName="Helvetica-Bold", fontSize=7, textColor=GRAY, leading=9, alignment=TA_CENTER),
        "bullet":    ParagraphStyle("bullet", fontName="Helvetica", fontSize=10, textColor=DARK, leading=14, leftIndent=14, bulletIndent=2),
        "conclusion": ParagraphStyle("conclusion", fontName="Helvetica-Oblique", fontSize=11, textColor=GRAY, leading=15, alignment=TA_CENTER, spaceBefore=12),
    }


# ---------- Page chrome ----------

def _make_footer(page_total: int):
    def _footer(canvas, doc):
        canvas.saveState()
        canvas.setStrokeColor(BORDER)
        canvas.setLineWidth(0.5)
        canvas.line(0.5 * inch, 0.55 * inch, 8.0 * inch, 0.55 * inch)
        # Tagline — centered, larger
        canvas.setFont("Helvetica-Oblique", 10)
        canvas.setFillColor(BRONZE)
        canvas.drawCentredString(letter[0] / 2.0, 0.36 * inch, PAGE_TAGLINE)
        # Page number — right side, unchanged
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(GRAY)
        canvas.drawRightString(8.0 * inch, 0.36 * inch, f"Page {doc.page} of {page_total}")
        canvas.restoreState()
    return _footer


# ---------- Helpers ----------

async def _load_photo(db, photo_id: str) -> bytes | None:
    """Pull a photo's bytes from object storage via project_photos doc."""
    if not photo_id:
        return None
    p = await db.project_photos.find_one({"id": photo_id, "is_deleted": {"$ne": True}}, {"_id": 0})
    if not p or not p.get("storage_path"):
        return None
    try:
        result = get_object(p["storage_path"])
        # storage.get_object() returns (bytes, content_type) tuple
        if isinstance(result, tuple):
            return result[0]
        return result
    except Exception:
        return None


def _photo_flowable(img_bytes: bytes | None, w: float, h: float, placeholder: str = "Image placeholder") -> object:
    """Return an Image flowable for embedded bytes, or a styled placeholder table."""
    if img_bytes:
        try:
            img = Image(BytesIO(img_bytes), width=w, height=h)
            img.hAlign = "CENTER"
            return img
        except Exception:
            pass
    # Placeholder cell
    s = _styles()
    cell = Paragraph(f'<font color="#A0A0A0"><i>{placeholder}</i></font>', s["muted"])
    t = Table([[cell]], colWidths=[w], rowHeights=[h])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), LIGHT),
        ("BOX", (0, 0), (-1, -1), 0.5, BORDER),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
    ]))
    return t


def _score_color(score: int) -> colors.Color:
    if score >= 80:
        return GREEN
    if score >= 60:
        return AMBER
    if score >= 1:
        return RED
    return GRAY


def _score_box(label: str, score_val, reasoning: str) -> Table:
    """A score card: number on top, label below, reasoning text on the right."""
    s = _styles()
    try:
        score = int(score_val or 0)
    except Exception:
        score = 0
    # Reduced from 24pt to 18pt per request to lighten the visual weight
    score_para = Paragraph(
        f'<font color="{_score_color(score).hexval()}"><b>{score}</b></font>'
        f'<font color="#A0A0A0"><b>/100</b></font>',
        ParagraphStyle("sn", fontName="Helvetica-Bold", fontSize=18, leading=22, alignment=TA_CENTER, textColor=DARK),
    )
    label_para = Paragraph(label.upper(), s["score_label"])
    score_cell = Table([[score_para], [label_para]], colWidths=[1.0 * inch])
    score_cell.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), SOFT_BLUE),
        ("BOX", (0, 0), (-1, -1), 0.5, BORDER),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    reasoning_para = Paragraph(reasoning or "<i><font color='#A0A0A0'>Not yet documented.</font></i>", s["body_sm"])
    outer = Table([[score_cell, reasoning_para]], colWidths=[1.1 * inch, 5.9 * inch])
    outer.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (1, 0), (1, 0), 12),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
    ]))
    return outer


def _bullet_list(items: List[str], style_key: str = "bullet", empty_text: str = "(none specified)") -> object:
    s = _styles()
    items = [str(i).strip() for i in (items or []) if str(i).strip()]
    if not items:
        return Paragraph(f"<i><font color='#A0A0A0'>{empty_text}</font></i>", s["body_sm"])
    return ListFlowable(
        [ListItem(Paragraph(i, s[style_key]), leftIndent=12, value="bulletchar") for i in items],
        bulletType="bullet",
        start="•",
        leftIndent=14,
    )


def _section_header(title: str, story: list, s: dict):
    """Section heading with a bronze underline bar."""
    story.append(Spacer(1, 6))
    bar = Table([[Paragraph(title.upper(), s["h1"])]], colWidths=[7.3 * inch])
    bar.setStyle(TableStyle([
        ("LINEBELOW", (0, 0), (-1, -1), 2, BRONZE),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
    ]))
    story.append(bar)
    story.append(Spacer(1, 4))


def _check(yes: bool) -> str:
    return '<font color="#16A34A"><b>☑</b></font>' if yes else '<font color="#A0A0A0">☐</font>'


def _text_box(text: str, num_rows: int = 8, row_height: float = 0.22 * inch, width: float = 7.3 * inch,
              placeholder: str = "—") -> Table:
    """Fixed-height bordered container that always reserves `num_rows` of line space —
    keeps the page layout stable regardless of how much text the user types.
    The content is rendered as a single paragraph inside the box (it wraps naturally),
    but the BOX itself never shrinks below num_rows × row_height."""
    s = _styles()
    content = text or f"<i><font color='#A0A0A0'>{placeholder}</font></i>"
    # Make body style with a slightly tighter leading
    para_style = ParagraphStyle(
        "boxed_body", parent=s["body"],
        fontSize=10, leading=row_height * 72 / inch,  # leading in pt
        textColor=DARK,
    )
    p = Paragraph(content, para_style)
    box = Table([[p]], colWidths=[width], rowHeights=[num_rows * row_height])
    box.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BACKGROUND", (0, 0), (-1, -1), colors.white),
        ("BOX", (0, 0), (-1, -1), 0.75, BOX_BORDER),  # Light grey — just visible
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    return box


def _finding_box(items: list, num_slots: int = 3, row_height: float = 0.32 * inch,
                 width: float = 7.3 * inch) -> Table:
    """Fixed-slot box that always shows N labeled rows ('Finding #1:', 'Finding #2:', ...).
    If the user has provided fewer items, the empty slots render as bronze labels with a
    thin baseline so the report layout never shifts."""
    s = _styles()
    items = [str(i).strip() for i in (items or []) if str(i).strip()]
    rows = []
    for i in range(num_slots):
        label = f"Finding #{i + 1}:"
        value = items[i] if i < len(items) else ""
        if value:
            row_html = (
                f'<font color="#A0703A"><b>{label}</b></font> '
                f'<font color="#0A0A0A">{value}</font>'
            )
        else:
            row_html = (
                f'<font color="#A0703A"><b>{label}</b></font> '
                f'<font color="#D4D4D8">_________________________________________________</font>'
            )
        rows.append([Paragraph(row_html, s["body_sm"])])

    box = Table(rows, colWidths=[width], rowHeights=[row_height] * num_slots)
    box.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BACKGROUND", (0, 0), (-1, -1), colors.white),
        ("BOX", (0, 0), (-1, -1), 0.75, BOX_BORDER),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, BOX_BORDER),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return box


def _fmt_date(d: str) -> str:
    if not d:
        return ""
    try:
        return datetime.strptime(d[:10], "%Y-%m-%d").strftime("%B %d, %Y")
    except (ValueError, TypeError):
        return d


# ---------- Main entry ----------

async def build_assessment_pdf(db, a: dict) -> bytes:
    s = _styles()
    buf = BytesIO()
    pdf = SimpleDocTemplate(
        buf, pagesize=letter,
        leftMargin=0.6 * inch, rightMargin=0.6 * inch,
        topMargin=0.5 * inch, bottomMargin=0.75 * inch,
        title=f"Roof Assessment Report — {a.get('property_name') or a.get('property_address') or ''}",
    )
    story: list = []

    # ============================================================
    # PAGE 1 — Cover
    # ============================================================
    if os.path.exists(LOGO_PATH):
        try:
            # 2× the previous size: 5.2" × 1.6"
            logo = Image(LOGO_PATH, width=5.2 * inch, height=1.6 * inch)
            logo.hAlign = "CENTER"
            story.append(logo)
        except Exception:
            pass
    story.append(Spacer(1, 24))
    story.append(Paragraph("COMMERCIAL ROOF ASSESSMENT REPORT", s["title"]))
    story.append(Paragraph("Roof Consulting &amp; Asset Management", s["subtitle"]))
    story.append(Spacer(1, 40))

    cover_rows = [
        ["Prepared For",  a.get("prepared_for", "")],
        ["Contact Name",  a.get("contact_name", "")],
        ["Property",      f"{a.get('property_name', '')}<br/>{a.get('property_address', '')}".strip("<br/>")],
        ["Prepared By",   a.get("prepared_by", "")],
        ["Date",          _fmt_date(a.get("assessment_date", ""))],
    ]
    cover_data = [[
        Paragraph(f'<b><font color="#A0703A">{k.upper()}</font></b>', s["label"]),
        Paragraph(v or '<font color="#A0A0A0"><i>—</i></font>', s["body"]),
    ] for k, v in cover_rows]
    cover_t = Table(cover_data, colWidths=[1.5 * inch, 5.0 * inch])
    cover_t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BACKGROUND", (0, 0), (0, -1), SOFT_BRONZE),
        ("BOX", (0, 0), (-1, -1), 0.5, BORDER),
        ("INNERGRID", (0, 0), (-1, -1), 0.25, BORDER),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ("LEFTPADDING", (0, 0), (-1, -1), 14),
        ("RIGHTPADDING", (0, 0), (-1, -1), 14),
    ]))
    story.append(cover_t)
    story.append(PageBreak())

    # ============================================================
    # PAGE 2 — Executive Summary
    # ============================================================
    _section_header("Executive Summary", story, s)
    story.append(Paragraph("<b>Purpose of Assessment</b>", s["h3"]))
    story.append(Paragraph(a.get("purpose") or
        "Provide an objective, third-party evaluation of the commercial roofing system's condition, performance, and "
        "potential for restoration or replacement to support informed capital planning.",
        s["body"]))
    story.append(Spacer(1, 6))
    story.append(Paragraph("<b>Executive Conclusion</b>", s["h3"]))
    story.append(_text_box(a.get("executive_conclusion") or "", num_rows=8))
    story.append(Spacer(1, 8))

    story.append(Paragraph("<b>Roof Asset Score™</b>", s["h3"]))
    score_blocks = [
        ("Condition Rating", a.get("condition_rating", {})),
        ("Remaining Service Life", a.get("remaining_service_life", {})),
        ("Restoration Suitability", a.get("restoration_suitability", {})),
        ("Capital Risk™", a.get("capital_risk", {})),
    ]
    for label, sc in score_blocks:
        story.append(_score_box(label, sc.get("score") if isinstance(sc, dict) else 0,
                                sc.get("reasoning") if isinstance(sc, dict) else ""))
        story.append(Spacer(1, 3))

    story.append(Spacer(1, 6))
    story.append(Paragraph("<b>Overall Recommendation</b>", s["h3"]))
    story.append(_text_box(a.get("overall_recommendation") or "", num_rows=8))
    story.append(PageBreak())

    # ============================================================
    # PAGE 3 — Roof Asset Dashboard™
    # ============================================================
    _section_header("Roof Asset Dashboard™", story, s)
    dash = [
        ("Roof Asset Score™",        a.get("roof_asset_score", {})),
        ("Remaining Service Life",   a.get("remaining_service_life", {})),
        ("Condition Rating",         a.get("condition_rating", {})),
        ("Maintenance Status",       a.get("maintenance_status", {})),
        ("Hail Resilience™",         a.get("hail_resilience", {})),
        ("Warranty Status",          a.get("warranty_status", {})),
        ("Capital Risk™",            a.get("capital_risk", {})),
        ("Restoration Suitability™", a.get("restoration_suitability", {})),
    ]
    # Two-column grid
    rows = []
    for i in range(0, len(dash), 2):
        left = dash[i]
        right = dash[i + 1] if i + 1 < len(dash) else ("", {})
        rows.append([
            Paragraph(left[0], s["h3"]),
            _score_pill(left[1]),
            Paragraph(right[0], s["h3"]) if right[0] else "",
            _score_pill(right[1]) if right[0] else "",
        ])
    dash_t = Table(rows, colWidths=[2.0 * inch, 1.5 * inch, 2.0 * inch, 1.5 * inch])
    dash_t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("BOX", (0, 0), (-1, -1), 0.5, BORDER),
        ("INNERGRID", (0, 0), (-1, -1), 0.25, BORDER),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
    ]))
    story.append(dash_t)

    # Executive Findings
    story.append(Spacer(1, 14))
    _section_header("Executive Findings", story, s)
    story.append(Paragraph("<b>Primary Concerns</b>", s["h3"]))
    story.append(_finding_box(a.get("primary_concerns", []), num_slots=3))
    story.append(Spacer(1, 8))
    story.append(Paragraph("<b>Positive Findings</b>", s["h3"]))
    story.append(_finding_box(a.get("positive_findings", []), num_slots=3))
    story.append(PageBreak())

    # ============================================================
    # PAGE 4 — Recommended Strategy + Capital Planning Impact + Immediate Action Items
    # ============================================================
    _section_header("Recommended Strategy", story, s)
    story.append(_text_box(a.get("recommended_strategy") or "", num_rows=7))
    story.append(Spacer(1, 12))
    story.append(Paragraph("<b>Capital Planning Impact</b>", s["h3"]))
    story.append(_text_box(a.get("capital_planning_impact") or "", num_rows=7))
    story.append(Spacer(1, 12))
    story.append(Paragraph("<b>Immediate Action Items</b>", s["h3"]))
    story.append(_finding_box(a.get("immediate_action_items", []), num_slots=3))
    story.append(PageBreak())

    # ============================================================
    # PAGE 5 — Assessment Methodology + Property Information + Assessment Scope
    # ============================================================
    _section_header("Assessment Methodology", story, s)
    methodology_default = (
        "This assessment was performed by a SealTech-certified roof consultant using a combination of visual inspection, "
        "measurement, and documentation review. Findings reflect conditions observed at the time of assessment and are "
        "intended to support informed capital-planning decisions."
    )
    story.append(Paragraph(a.get("methodology_notes") or methodology_default, s["body_sm"]))
    story.append(Spacer(1, 10))

    _section_header("Property Information", story, s)
    prop_rows = [
        ("Property Name",       a.get("property_name", "")),
        ("Address",             a.get("property_address", "")),
        ("Building Type",       a.get("building_type", "")),
        ("Year Constructed",    str(a.get("year_built") or "—")),
        ("Occupancy Type",      a.get("occupancy_type", "")),
        ("Assessment Date",     _fmt_date(a.get("assessment_date", ""))),
        ("Roof Type",           a.get("roof_type", "")),
        ("Manufacturer",        a.get("manufacturer", "")),
        ("Installation Date",   _fmt_date(a.get("installation_date", ""))),
        ("Estimated Roof Age",  f"{a.get('roof_age_years')} years" if a.get("roof_age_years") else "—"),
        ("Warranty Status",     a.get("warranty_status_text", "")),
        ("Approximate Roof Area", f"{a.get('square_footage') or 0:,.0f} sq ft" if a.get("square_footage") else "—"),
        ("Repair History",      a.get("repair_history", "")),
        ("Weather Conditions",  a.get("weather_conditions", "")),
    ]
    prop_data = [[
        Paragraph(f'<b><font color="#A0703A">{k.upper()}</font></b>', s["label"]),
        Paragraph(v or "—", s["body_sm"]),
    ] for k, v in prop_rows]
    prop_t = Table(prop_data, colWidths=[1.6 * inch, 5.7 * inch])
    prop_t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOX", (0, 0), (-1, -1), 0.75, BOX_BORDER),
        ("INNERGRID", (0, 0), (-1, -1), 0.25, BOX_BORDER),
        ("BACKGROUND", (0, 0), (0, -1), SOFT_BRONZE),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
    ]))
    story.append(prop_t)

    story.append(Spacer(1, 10))
    _section_header("Assessment Scope Included", story, s)
    scope_items = [
        ("Visual Assessment", a.get("scope_visual_assessment")),
        ("Infrared Survey", a.get("scope_infrared_survey")),
        ("Moisture Survey", a.get("scope_moisture_survey")),
        ("Core Samples", a.get("scope_core_samples")),
        ("Drone Imaging", a.get("scope_drone_imaging")),
        ("Membrane Testing", a.get("scope_membrane_testing")),
        ("Drainage Evaluation", a.get("scope_drainage_evaluation")),
        ("Documentation Review", a.get("scope_documentation_review")),
    ]
    scope_rows = []
    for i in range(0, len(scope_items), 2):
        left = scope_items[i]
        right = scope_items[i + 1] if i + 1 < len(scope_items) else ("", False)
        scope_rows.append([
            Paragraph(f'{_check(bool(left[1]))} &nbsp; {left[0]}', s["body_sm"]),
            Paragraph(f'{_check(bool(right[1]))} &nbsp; {right[0]}' if right[0] else "", s["body_sm"]),
        ])
    scope_t = Table(scope_rows, colWidths=[3.5 * inch, 3.5 * inch])
    scope_t.setStyle(TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 8), ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]))
    story.append(scope_t)
    story.append(PageBreak())

    # ============================================================
    # PAGE 5 — Aerial Image (top half) + R-1 finding (bottom half)
    # ============================================================
    _section_header("Aerial Image of Roof", story, s)
    aerial_bytes = await _load_photo(db, a.get("aerial_photo_id"))
    story.append(_photo_flowable(aerial_bytes, w=7.3 * inch, h=3.3 * inch, placeholder="Aerial roof image — upload in editor"))
    story.append(Spacer(1, 12))
    _section_header("Asset Condition Findings", story, s)
    await _render_finding(db, story, s, idx=1, finding=a.get("finding_r1") or {})
    story.append(PageBreak())

    # ============================================================
    # PAGE 6 — R-2 + R-3
    # ============================================================
    await _render_finding(db, story, s, idx=2, finding=a.get("finding_r2") or {})
    story.append(Spacer(1, 14))
    await _render_finding(db, story, s, idx=3, finding=a.get("finding_r3") or {})
    story.append(PageBreak())

    # ============================================================
    # PAGE 7 — R-4 + R-5
    # ============================================================
    await _render_finding(db, story, s, idx=4, finding=a.get("finding_r4") or {})
    story.append(Spacer(1, 14))
    await _render_finding(db, story, s, idx=5, finding=a.get("finding_r5") or {})
    story.append(PageBreak())

    # ============================================================
    # PAGE 9 — Roof Score Analysis
    # ============================================================
    _section_header("Roof Score Analysis", story, s)
    overall = a.get("roof_asset_score", {})
    overall_val = int(overall.get("score") or 0) if isinstance(overall, dict) else 0
    story.append(_score_box("Overall Roof Asset Score™", overall_val,
                            overall.get("reasoning", "") if isinstance(overall, dict) else ""))

    story.append(Spacer(1, 8))
    interp_data = [
        ["SCORE", "INTERPRETATION"],
        ["90 – 100", "Excellent — roof in like-new condition, minimal capital risk."],
        ["80 – 89",  "Good — minor maintenance items; restoration highly suitable."],
        ["70 – 79",  "Fair — moderate findings; restoration suitable with proactive plan."],
        ["60 – 69",  "Marginal — significant repair/restoration needed; replacement on horizon."],
        ["Below 60", "Poor — replacement recommended; restoration unlikely to extend life cost-effectively."],
    ]
    interp_t = Table(interp_data, colWidths=[1.4 * inch, 5.6 * inch])
    interp_t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), BLUE),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("BOX", (0, 0), (-1, -1), 0.5, BORDER),
        ("INNERGRID", (0, 0), (-1, -1), 0.25, BORDER),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    story.append(interp_t)

    story.append(Spacer(1, 10))
    story.append(Paragraph("<b>Score Drivers</b>", s["h3"]))
    drivers_t = Table([
        [Paragraph('<font color="#16A34A"><b>POSITIVE FACTORS</b></font>', s["label"]),
         Paragraph('<font color="#B91C1C"><b>NEGATIVE FACTORS</b></font>', s["label"])],
        [_bullet_list(a.get("positive_factors", []), empty_text="(none)"),
         _bullet_list(a.get("negative_factors", []), empty_text="(none)")],
    ], colWidths=[3.5 * inch, 3.5 * inch])
    drivers_t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOX", (0, 0), (-1, -1), 0.5, BORDER),
        ("INNERGRID", (0, 0), (-1, -1), 0.25, BORDER),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
    ]))
    story.append(drivers_t)

    story.append(Spacer(1, 10))
    story.append(Paragraph("<b>Restoration Suitability™ Analysis</b>", s["h3"]))
    rating = a.get("restoration_suitability_rating") or "Moderate"
    rating_color = {"High": GREEN, "Moderate": AMBER, "Low": RED}.get(rating, GRAY)
    story.append(Paragraph(
        f'Rating: <font color="{rating_color.hexval()}"><b>{rating.upper()}</b></font>',
        s["body"],
    ))
    story.append(Paragraph(a.get("restoration_analysis") or "<i><font color='#A0A0A0'>—</font></i>", s["body_sm"]))

    story.append(Spacer(1, 8))
    story.append(Paragraph("<b>Factors Supporting Restoration</b>", s["h3"]))
    factor_items = [
        ("Membrane Largely Intact", a.get("factor_membrane_intact")),
        ("Minimal Water Intrusion", a.get("factor_minimal_water_intrusion")),
        ("Drainage Still Functional", a.get("factor_drainage_functional")),
        ("Structural Integrity Sound", a.get("factor_structural_integrity")),
        ("Compatible Substrate", a.get("factor_compatible_substrate")),
        ("Recent Inspection Available", a.get("factor_recent_inspection")),
    ]
    factor_rows = []
    for i in range(0, len(factor_items), 2):
        left = factor_items[i]
        right = factor_items[i + 1] if i + 1 < len(factor_items) else ("", False)
        factor_rows.append([
            Paragraph(f'{_check(bool(left[1]))} &nbsp; {left[0]}', s["body_sm"]),
            Paragraph(f'{_check(bool(right[1]))} &nbsp; {right[0]}' if right[0] else "", s["body_sm"]),
        ])
    f_t = Table(factor_rows, colWidths=[3.5 * inch, 3.5 * inch])
    f_t.setStyle(TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 8), ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3)]))
    story.append(f_t)
    story.append(PageBreak())

    # ============================================================
    # PAGE 10 — Repair vs Restoration vs Replacement
    # ============================================================
    _section_header("Repair vs. Restoration vs. Replacement Analysis", story, s)
    repair = a.get("option_repair") or {}
    restore = a.get("option_restoration") or {}
    replace = a.get("option_replacement") or {}
    comp = [
        ["OPTION", "COST", "LIFE EXTENSION", "DISRUPTION"],
        ["Repair",      repair.get("cost", ""), repair.get("life_extension", ""), repair.get("disruption", "")],
        ["Restoration", restore.get("cost", ""), restore.get("life_extension", ""), restore.get("disruption", "")],
        ["Replacement", replace.get("cost", ""), replace.get("life_extension", ""), replace.get("disruption", "")],
    ]
    comp_t = Table(comp, colWidths=[1.6 * inch, 1.8 * inch, 1.8 * inch, 1.8 * inch])
    comp_t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), BLUE),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("BOX", (0, 0), (-1, -1), 0.5, BORDER),
        ("INNERGRID", (0, 0), (-1, -1), 0.25, BORDER),
        ("ALIGN", (1, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("FONTNAME", (0, 1), (0, -1), "Helvetica-Bold"),
    ]))
    story.append(comp_t)

    for label, opt in [("Option 1 — Continue Repairs and Maintenance", repair),
                       ("Option 2 — Restoration", restore),
                       ("Option 3 — Replacement", replace)]:
        story.append(Spacer(1, 8))
        story.append(Paragraph(f"<b>{label}</b>", s["h3"]))
        adv_t = Table([
            [Paragraph('<font color="#16A34A"><b>ADVANTAGES</b></font>', s["label"]),
             Paragraph('<font color="#B91C1C"><b>DISADVANTAGES</b></font>', s["label"]),
             Paragraph('<font color="#D97706"><b>LIMITATIONS</b></font>', s["label"])],
            [_bullet_list(opt.get("advantages", []), empty_text="(none)"),
             _bullet_list(opt.get("disadvantages", []), empty_text="(none)"),
             _bullet_list(opt.get("limitations", []), empty_text="(none)")],
        ], colWidths=[2.33 * inch, 2.33 * inch, 2.34 * inch])
        adv_t.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("BOX", (0, 0), (-1, -1), 0.5, BORDER),
            ("INNERGRID", (0, 0), (-1, -1), 0.25, BORDER),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ]))
        story.append(adv_t)
    story.append(PageBreak())

    # ============================================================
    # PAGE 11 — Capital Planning Forecast + Recommended Plan
    # ============================================================
    _section_header("Capital Planning Forecast", story, s)
    forecast_rows = [
        ["1-YEAR OUTLOOK",  a.get("forecast_1yr", "")],
        ["3-YEAR OUTLOOK",  a.get("forecast_3yr", "")],
        ["5-YEAR OUTLOOK",  a.get("forecast_5yr", "")],
        ["10-YEAR OUTLOOK", a.get("forecast_10yr", "")],
    ]
    f_data = [[
        Paragraph(f'<b><font color="#1D4ED8">{k}</font></b>', s["label"]),
        Paragraph(v or "<i><font color='#A0A0A0'>—</font></i>", s["body_sm"]),
    ] for k, v in forecast_rows]
    f_t = Table(f_data, colWidths=[1.5 * inch, 5.5 * inch])
    f_t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BACKGROUND", (0, 0), (0, -1), SOFT_BLUE),
        ("BOX", (0, 0), (-1, -1), 0.5, BORDER),
        ("INNERGRID", (0, 0), (-1, -1), 0.25, BORDER),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
    ]))
    story.append(f_t)

    story.append(Spacer(1, 12))
    _section_header("Recommended Roof Asset Plan™", story, s)
    priority = a.get("budget_priority") or "Moderate"
    priority_color = {"Low": GREEN, "Moderate": AMBER, "High": RED, "Immediate": RED}.get(priority, GRAY)
    story.append(Paragraph(
        f'<b>Estimated Budget Priority:</b> <font color="{priority_color.hexval()}"><b>{priority.upper()}</b></font>',
        s["body"],
    ))
    story.append(Spacer(1, 6))
    story.append(Paragraph("<b>Immediate Actions (0–12 Months)</b>", s["h3"]))
    story.append(_bullet_list(a.get("immediate_actions", []), empty_text="None planned."))
    story.append(Spacer(1, 4))
    story.append(Paragraph("<b>Near-Term Actions (1–3 Years)</b>", s["h3"]))
    story.append(_bullet_list(a.get("near_term_actions", []), empty_text="None planned."))
    story.append(Spacer(1, 4))
    story.append(Paragraph("<b>Long-Term Actions (3–10 Years)</b>", s["h3"]))
    story.append(_bullet_list(a.get("long_term_actions", []), empty_text="None planned."))
    story.append(PageBreak())

    # ============================================================
    # PAGE 12 — SealTech Recommendation + Expected Outcome + Conclusion
    # ============================================================
    _section_header("SealTech Recommendation", story, s)
    rec_items = [
        ("Restoration Program", a.get("rec_restoration_program")),
        ("Repair &amp; Monitor", a.get("rec_repair_and_monitor")),
        ("Partial Replacement", a.get("rec_partial_replacement")),
        ("Full Replacement", a.get("rec_full_replacement")),
        ("Maintenance Program", a.get("rec_maintenance_program")),
        ("Drainage Improvements", a.get("rec_drainage_improvements")),
    ]
    rec_rows = []
    for i in range(0, len(rec_items), 2):
        left = rec_items[i]
        right = rec_items[i + 1] if i + 1 < len(rec_items) else ("", False)
        rec_rows.append([
            Paragraph(f'{_check(bool(left[1]))} &nbsp; <b>{left[0]}</b>', s["body_sm"]),
            Paragraph(f'{_check(bool(right[1]))} &nbsp; <b>{right[0]}</b>' if right[0] else "", s["body_sm"]),
        ])
    rec_t = Table(rec_rows, colWidths=[3.5 * inch, 3.5 * inch])
    rec_t.setStyle(TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 8), ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]))
    story.append(rec_t)

    story.append(Spacer(1, 8))
    story.append(Paragraph("<b>Supporting Comments</b>", s["h3"]))
    story.append(Paragraph(a.get("supporting_comments") or "<i><font color='#A0A0A0'>—</font></i>", s["body_sm"]))

    story.append(Spacer(1, 14))
    _section_header("Expected Outcome", story, s)
    outcomes = a.get("expected_outcomes") or []
    outcome_rows = []
    for i in range(0, len(outcomes), 2):
        left = outcomes[i]
        right = outcomes[i + 1] if i + 1 < len(outcomes) else ""
        outcome_rows.append([
            Paragraph(f"✓  {left}", s["body_sm"]),
            Paragraph(f"✓  {right}" if right else "", s["body_sm"]),
        ])
    o_t = Table(outcome_rows, colWidths=[3.5 * inch, 3.5 * inch])
    o_t.setStyle(TableStyle([
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("TEXTCOLOR", (0, 0), (-1, -1), GREEN),
    ]))
    story.append(o_t)

    story.append(Spacer(1, 14))
    _section_header("Conclusion", story, s)
    story.append(Paragraph(a.get("conclusion") or
        "This report provides an objective evaluation to support informed decisions about the roofing asset. "
        "SealTech is available to walk through findings, refine the recommended plan, and assist with execution.",
        s["body"],
    ))

    # ---- Build PDF (two-pass for page count footer) ----
    # First pass: count pages
    pdf.build(list(story), onFirstPage=_make_footer(99), onLaterPages=_make_footer(99))
    page_total = pdf.page
    # Second pass with accurate page total
    buf2 = BytesIO()
    pdf2 = SimpleDocTemplate(
        buf2, pagesize=letter,
        leftMargin=0.6 * inch, rightMargin=0.6 * inch,
        topMargin=0.5 * inch, bottomMargin=0.75 * inch,
        title=f"Roof Assessment Report — {a.get('property_name') or a.get('property_address') or ''}",
    )
    pdf2.build(list(story), onFirstPage=_make_footer(page_total), onLaterPages=_make_footer(page_total))
    return buf2.getvalue()


def _score_pill(sc: dict) -> Paragraph:
    """Compact score rendering used inside the dashboard grid (8 metrics, 2-column)."""
    if not isinstance(sc, dict):
        sc = {}
    score = int(sc.get("score") or 0)
    color = _score_color(score).hexval()
    # Reduced from 14pt to 12pt per request
    return Paragraph(
        f'<font color="{color}" size="12"><b>{score}</b></font>'
        f'<font color="#A0A0A0" size="8"><b>/100</b></font>',
        ParagraphStyle("sp", fontName="Helvetica-Bold", fontSize=12, leading=15, alignment=TA_LEFT),
    )


async def _render_finding(db, story: list, s: dict, idx: int, finding: dict):
    """Render one R-N finding block matching the original layout:
       - Header with code + component name + severity badge
       - 4-row info table (Observations / Severity / Risk / Recommendation)
       - 2 photo slots side-by-side below
    Designed to fit 1× on page 5 (with aerial) and 2× per page on pages 6-7.
    """
    component = finding.get("component", f"Component {idx}")
    severity = finding.get("severity", "")
    severity_color = {"Critical": RED, "High": RED, "Moderate": AMBER, "Low": GREEN}.get(severity, GRAY).hexval()

    story.append(Paragraph(
        f'<font color="#A0703A"><b>R-{idx}</b></font>  &nbsp; <b>{component}</b> '
        f'&nbsp;&nbsp; <font color="{severity_color}"><b>[{severity or "—"}]</b></font>',
        s["h2"],
    ))

    body_rows = [
        ["OBSERVATIONS",   finding.get("observations") or "—"],
        ["SEVERITY",       finding.get("severity") or "—"],
        ["RISK",           finding.get("risk") or "—"],
        ["RECOMMENDATION", finding.get("recommendation") or "—"],
    ]
    body_data = [[
        Paragraph(f'<font color="#A0703A"><b>{k}</b></font>', s["label"]),
        Paragraph(v, s["body_sm"]),
    ] for k, v in body_rows]
    body_t = Table(body_data, colWidths=[1.3 * inch, 6.0 * inch])
    body_t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BACKGROUND", (0, 0), (0, -1), SOFT_BRONZE),
        ("BOX", (0, 0), (-1, -1), 0.75, BOX_BORDER),
        ("INNERGRID", (0, 0), (-1, -1), 0.25, BOX_BORDER),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
    ]))
    story.append(body_t)
    story.append(Spacer(1, 4))

    # 2 photo slots side-by-side (matches original layout)
    photo_ids = (finding.get("photo_ids") or [])[:2]
    photos = []
    for pid in photo_ids:
        img_bytes = await _load_photo(db, pid)
        photos.append(_photo_flowable(img_bytes, w=3.55 * inch, h=1.9 * inch, placeholder="Photo placeholder"))
    while len(photos) < 2:
        photos.append(_photo_flowable(None, w=3.55 * inch, h=1.9 * inch, placeholder="Photo placeholder"))
    ph_t = Table([photos], colWidths=[3.65 * inch, 3.65 * inch], rowHeights=[1.95 * inch])
    ph_t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
    ]))
    story.append(ph_t)
