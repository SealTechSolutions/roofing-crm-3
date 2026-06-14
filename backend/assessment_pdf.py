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
        canvas.setFont("Helvetica-Oblique", 8)
        canvas.setFillColor(BRONZE)
        canvas.drawString(0.5 * inch, 0.38 * inch, PAGE_TAGLINE)
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(GRAY)
        canvas.drawRightString(8.0 * inch, 0.38 * inch, f"Page {doc.page} of {page_total}")
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
        return get_object(p["storage_path"])
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
    """A score card: big number on top, label below, reasoning text on the right."""
    s = _styles()
    try:
        score = int(score_val or 0)
    except Exception:
        score = 0
    score_para = Paragraph(
        f'<font color="{_score_color(score).hexval()}"><b>{score}</b></font>'
        f'<font color="#A0A0A0"><b>/100</b></font>',
        ParagraphStyle("sn", fontName="Helvetica-Bold", fontSize=24, leading=28, alignment=TA_CENTER, textColor=DARK),
    )
    label_para = Paragraph(label.upper(), s["score_label"])
    score_cell = Table([[score_para], [label_para]], colWidths=[1.2 * inch])
    score_cell.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), SOFT_BLUE),
        ("BOX", (0, 0), (-1, -1), 0.5, BORDER),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    reasoning_para = Paragraph(reasoning or "<i><font color='#A0A0A0'>Not yet documented.</font></i>", s["body_sm"])
    outer = Table([[score_cell, reasoning_para]], colWidths=[1.3 * inch, 5.8 * inch])
    outer.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (1, 0), (1, 0), 12),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
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
    bar = Table([[Paragraph(title.upper(), s["h1"])]], colWidths=[7.0 * inch])
    bar.setStyle(TableStyle([
        ("LINEBELOW", (0, 0), (-1, -1), 2, BRONZE),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
    ]))
    story.append(bar)
    story.append(Spacer(1, 4))


def _check(yes: bool) -> str:
    return '<font color="#16A34A"><b>☑</b></font>' if yes else '<font color="#A0A0A0">☐</font>'


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
            logo = Image(LOGO_PATH, width=2.6 * inch, height=0.8 * inch)
            logo.hAlign = "CENTER"
            story.append(logo)
        except Exception:
            pass
    story.append(Spacer(1, 16))
    story.append(Paragraph("COMMERCIAL ROOF ASSESSMENT REPORT", s["title"]))
    story.append(Paragraph("Independent Roof Consulting &amp; Asset Management", s["subtitle"]))
    story.append(Spacer(1, 40))

    cover_rows = [
        ["Prepared For", a.get("prepared_for", "")],
        ["Property",     f"{a.get('property_name', '')}<br/>{a.get('property_address', '')}".strip("<br/>")],
        ["Prepared By",  a.get("prepared_by", "")],
        ["Date",         _fmt_date(a.get("assessment_date", ""))],
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
    story.append(Paragraph(a.get("executive_conclusion") or "<i><font color='#A0A0A0'>Conclusion not yet documented.</font></i>", s["body"]))
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
        story.append(Spacer(1, 4))

    story.append(Spacer(1, 6))
    story.append(Paragraph("<b>Overall Recommendation</b>", s["h3"]))
    story.append(Paragraph(a.get("overall_recommendation") or "<i><font color='#A0A0A0'>Pending.</font></i>", s["body"]))
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
    story.append(_bullet_list(a.get("primary_concerns", []), empty_text="No concerns documented."))
    story.append(Spacer(1, 6))
    story.append(Paragraph("<b>Positive Findings</b>", s["h3"]))
    story.append(_bullet_list(a.get("positive_findings", []), empty_text="No positive findings documented."))
    story.append(PageBreak())

    # ============================================================
    # PAGE 4 — Strategy + Property Info + Scope
    # ============================================================
    _section_header("Recommended Strategy", story, s)
    story.append(Paragraph(a.get("recommended_strategy") or "<i><font color='#A0A0A0'>Strategy not yet documented.</font></i>", s["body"]))
    story.append(Spacer(1, 8))
    story.append(Paragraph("<b>Capital Planning Impact</b>", s["h3"]))
    story.append(Paragraph(a.get("capital_planning_impact") or "<i><font color='#A0A0A0'>—</font></i>", s["body"]))
    story.append(Spacer(1, 8))
    story.append(Paragraph("<b>Immediate Action Items</b>", s["h3"]))
    story.append(_bullet_list(a.get("immediate_action_items", []), empty_text="No immediate actions."))

    story.append(Spacer(1, 12))
    _section_header("Property Information", story, s)
    prop_rows = [
        ("Property Name", a.get("property_name", "")),
        ("Address", a.get("property_address", "")),
        ("Building Type", a.get("building_type", "")),
        ("Square Footage", f"{a.get('square_footage') or '—':,.0f} sq ft" if a.get("square_footage") else "—"),
        ("Year Built", str(a.get("year_built") or "—")),
        ("Roof Type", a.get("roof_type", "")),
        ("Roof Age", f"{a.get('roof_age_years')} years" if a.get("roof_age_years") else "—"),
        ("Last Inspection", _fmt_date(a.get("last_inspection_date", ""))),
    ]
    prop_data = [[
        Paragraph(f'<b><font color="#A0703A">{k.upper()}</font></b>', s["label"]),
        Paragraph(v or "—", s["body_sm"]),
    ] for k, v in prop_rows]
    prop_t = Table(prop_data, colWidths=[1.5 * inch, 5.5 * inch])
    prop_t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOX", (0, 0), (-1, -1), 0.5, BORDER),
        ("INNERGRID", (0, 0), (-1, -1), 0.25, BORDER),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
    ]))
    story.append(prop_t)

    story.append(Spacer(1, 12))
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
    # PAGE 5 — Aerial Image of Roof
    # ============================================================
    _section_header("Aerial Image of Roof", story, s)
    aerial_bytes = await _load_photo(db, a.get("aerial_photo_id"))
    story.append(Spacer(1, 6))
    story.append(_photo_flowable(aerial_bytes, w=7.0 * inch, h=5.2 * inch, placeholder="Aerial roof image — upload in editor"))
    story.append(PageBreak())

    # ============================================================
    # PAGES 6-8 — Asset Condition Findings (R-1..R-5)
    # ============================================================
    _section_header("Asset Condition Findings", story, s)
    for idx, key in enumerate(["finding_r1", "finding_r2", "finding_r3", "finding_r4", "finding_r5"], start=1):
        f = a.get(key) or {}
        await _render_finding(db, story, s, idx=idx, finding=f)
        if idx < 5:
            story.append(Spacer(1, 10))
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
    """Compact score rendering used inside the dashboard grid."""
    if not isinstance(sc, dict):
        sc = {}
    score = int(sc.get("score") or 0)
    color = _score_color(score).hexval()
    return Paragraph(
        f'<font color="{color}" size="14"><b>{score}</b></font>'
        f'<font color="#A0A0A0" size="9"><b>/100</b></font>',
        ParagraphStyle("sp", fontName="Helvetica-Bold", fontSize=14, leading=18, alignment=TA_LEFT),
    )


async def _render_finding(db, story: list, s: dict, idx: int, finding: dict):
    """Render one R-N finding block with header, table of metadata, and photo strip."""
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
        ["RISK",           finding.get("risk") or "—"],
        ["RECOMMENDATION", finding.get("recommendation") or "—"],
    ]
    body_data = [[
        Paragraph(f'<font color="#A0703A"><b>{k}</b></font>', s["label"]),
        Paragraph(v, s["body_sm"]),
    ] for k, v in body_rows]
    body_t = Table(body_data, colWidths=[1.4 * inch, 5.6 * inch])
    body_t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BACKGROUND", (0, 0), (0, -1), SOFT_BRONZE),
        ("BOX", (0, 0), (-1, -1), 0.5, BORDER),
        ("INNERGRID", (0, 0), (-1, -1), 0.25, BORDER),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
    ]))
    story.append(body_t)

    # Photo strip (up to 4 photos per finding, 2x2 grid if multiple)
    photo_ids = finding.get("photo_ids") or []
    if photo_ids:
        photos = []
        for pid in photo_ids[:4]:
            img_bytes = await _load_photo(db, pid)
            photos.append(_photo_flowable(img_bytes, w=3.2 * inch, h=2.0 * inch, placeholder="Photo unavailable"))
        # Pair into rows of 2
        rows = []
        for i in range(0, len(photos), 2):
            row = [photos[i], photos[i + 1] if i + 1 < len(photos) else ""]
            rows.append(row)
        ph_t = Table(rows, colWidths=[3.3 * inch, 3.3 * inch])
        ph_t.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 4),
            ("RIGHTPADDING", (0, 0), (-1, -1), 4),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ]))
        story.append(Spacer(1, 6))
        story.append(ph_t)
