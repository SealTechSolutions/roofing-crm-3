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
    Image, KeepTogether, KeepInFrame, PageBreak, ListFlowable, ListItem,
)
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT

from storage import get_object
from assessment_bands import band_for, COLOR_GRAY

LOGO_PATH = os.path.join(os.path.dirname(__file__), "assets", "sealtech-logo.png")

# Brand palette
BLUE   = colors.HexColor("#062B67")
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
        "h3":        ParagraphStyle("h3", fontName="Helvetica-Bold", fontSize=12, textColor=BLUE, leading=14, spaceBefore=6, spaceAfter=2),
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


def _photo_flowable(img_bytes: bytes | None, w: float, h: float, placeholder: str = "Image placeholder",
                    h_align: str = "CENTER") -> object:
    """Return an Image flowable for embedded bytes, or a styled placeholder table.
    `h_align` controls horizontal alignment within its parent cell (LEFT / CENTER / RIGHT)."""
    if img_bytes:
        try:
            img = Image(BytesIO(img_bytes), width=w, height=h)
            img.hAlign = h_align
            return img
        except Exception:
            pass
    # Placeholder cell
    s = _styles()
    cell = Paragraph(f'<font color="#A0A0A0"><i>{placeholder}</i></font>', s["muted"])
    t = Table([[cell]], colWidths=[w], rowHeights=[h])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), LIGHT),
        ("BOX", (0, 0), (-1, -1), 0.5, BOX_BORDER),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
    ]))
    t.hAlign = h_align  # Placeholder Tables also respect hAlign as a flowable
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
    """A score card: number on top, label below, reasoning text on the right.
    Single-Table structure (no nesting) so the blue box left-edge sits flush with
    the text-box columns above/below it."""
    s = _styles()
    try:
        score = int(score_val or 0)
    except Exception:
        score = 0
    # Compact score number — lighter visual weight to balance with reasoning text
    score_para = Paragraph(
        f'<font color="{_score_color(score).hexval()}"><b>{score}</b></font>'
        f'<font color="#A0A0A0"><b>/100</b></font>',
        ParagraphStyle("sn", fontName="Helvetica-Bold", fontSize=13, leading=15, alignment=TA_CENTER, textColor=DARK),
    )
    label_para = Paragraph(label.upper(), s["score_label"])
    reasoning_para = Paragraph(_esc(reasoning) or "<i><font color='#A0A0A0'>Not yet documented.</font></i>", s["body_sm"])
    # 2 rows × 2 cols; reasoning spans both rows on the right.
    outer = Table([
        [score_para, reasoning_para],
        [label_para, ""],
    ], colWidths=[1.1 * inch, 6.2 * inch])
    outer.hAlign = "LEFT"
    outer.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, 1), SOFT_BLUE),
        ("BOX",        (0, 0), (0, 1), 0.5, BORDER),
        ("SPAN",       (1, 0), (1, 1)),
        ("VALIGN",     (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN",      (0, 0), (0, -1), "CENTER"),
        ("LEFTPADDING",  (0, 0), (0, -1), 2),
        ("RIGHTPADDING", (0, 0), (0, -1), 2),
        ("LEFTPADDING",  (1, 0), (1, 0), 12),
        ("TOPPADDING",   (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING",(0, 0), (-1, -1), 3),
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
    bar.hAlign = "LEFT"
    bar.setStyle(TableStyle([
        ("LINEBELOW", (0, 0), (-1, -1), 2, BRONZE),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
    ]))
    story.append(bar)
    story.append(Spacer(1, 4))


def _check(yes: bool) -> str:
    return '<font color="#16A34A"><b>☑</b></font>' if yes else '<font color="#A0A0A0">☐</font>'


def _esc(s) -> str:
    """Escape user text so ReportLab's mini-XML Paragraph parser doesn't choke on
    raw '<', '>', or '&'. Pass any user-provided string through this before
    embedding into a Paragraph."""
    if s is None:
        return ""
    return (str(s)
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;"))


def _text_box(text: str, num_rows: int = 8, row_height: float = 0.22 * inch, width: float = 7.3 * inch,
              placeholder: str = "—") -> Table:
    """Fixed-height bordered container. Always reserves exactly `num_rows × row_height`
    of vertical space. If the user types more text than fits, the Paragraph inside
    gets shrunk via KeepInFrame so the page layout never breaks.
    """
    s = _styles()
    content = _esc(text) if text else f"<i><font color='#A0A0A0'>{placeholder}</font></i>"
    # Make body style with a slightly tighter leading
    para_style = ParagraphStyle(
        "boxed_body", parent=s["body"],
        fontSize=10, leading=row_height * 72 / inch,  # leading in pt
        textColor=DARK,
    )
    p = Paragraph(content, para_style)
    fixed_h = num_rows * row_height
    box = Table([[p]], colWidths=[width], rowHeights=[fixed_h])
    box.hAlign = "LEFT"
    box.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BACKGROUND", (0, 0), (-1, -1), colors.white),
        ("BOX", (0, 0), (-1, -1), 0.75, BOX_BORDER),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    # Wrap so an over-long Paragraph is shrunk to fit the reserved height rather
    # than raising a LayoutError. Layout stays rock-stable across content lengths.
    return KeepInFrame(maxWidth=width, maxHeight=fixed_h, content=[box], mode="shrink")


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
                f'<font color="#0A0A0A">{_esc(value)}</font>'
            )
        else:
            row_html = (
                f'<font color="#A0703A"><b>{label}</b></font> '
                f'<font color="#D4D4D8">_________________________________________________</font>'
            )
        rows.append([Paragraph(row_html, s["body_sm"])])

    box = Table(rows, colWidths=[width], rowHeights=[row_height] * num_slots)
    box.hAlign = "LEFT"
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

    # Restoration eligibility stamp on the cover — driven by inspector's two
    # disqualifier checkboxes. Only Replacement when either is true.
    insulation_sat = bool(a.get("insulation_saturated"))
    deck_damaged = bool(a.get("structural_deck_damaged"))
    if insulation_sat or deck_damaged:
        stamp_color = colors.HexColor("#B91C1C")
        stamp_label = "REPLACEMENT REQUIRED"
        stamp_sub = []
        if insulation_sat: stamp_sub.append("Insulation Saturated")
        if deck_damaged: stamp_sub.append("Structural Deck Damaged")
        stamp_subline = " &nbsp;\u2022&nbsp; ".join(stamp_sub)
    else:
        stamp_color = colors.HexColor("#15803D")
        stamp_label = "RESTORATION PATH RECOMMENDED"
        stamp_subline = "Insulation dry &nbsp;\u2022&nbsp; Structural deck sound"

    story.append(Spacer(1, 12))
    stamp_tbl = Table([[
        Paragraph(
            f'<font color="{stamp_color.hexval()}" size="12"><b>{stamp_label}</b></font><br/>'
            f'<font color="#52525B" size="8">{stamp_subline}</font>',
            ParagraphStyle("stamp", fontName="Helvetica-Bold", fontSize=12, leading=16, alignment=TA_CENTER),
        )
    ]], colWidths=[7.3 * inch], rowHeights=[0.7 * inch])
    stamp_tbl.setStyle(TableStyle([
        ("BACKGROUND",   (0, 0), (-1, -1), colors.HexColor("#FAFAFA")),
        ("BOX",          (0, 0), (-1, -1), 1.2, stamp_color),
        ("VALIGN",       (0, 0), (-1, -1), "MIDDLE"),
    ]))
    story.append(stamp_tbl)

    story.append(PageBreak())

    # ============================================================
    # PAGE 2 — Executive Summary
    # ============================================================
    _section_header("Executive Summary", story, s)
    story.append(Paragraph("<b>Purpose of Assessment</b>", s["h3"]))
    story.append(Paragraph(_esc(a.get("purpose")) or
        "The purpose of this Commercial Roof Assessment Report&#8482; is to provide an objective evaluation of the "
        "current condition, performance, remaining service life, restoration potential, and future risk exposure of "
        "the roofing asset.",
        s["body"]))
    story.append(Spacer(1, 4))
    story.append(Paragraph(
        "This assessment is intended to support informed maintenance, restoration, and capital "
        "planning decisions. Restoration is our primary recommendation pathway; replacement is "
        "reserved for the limited cases where the insulation is saturated or the structural deck "
        "is damaged.",
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
        story.append(Spacer(1, 14))

    story.append(Spacer(1, 6))
    story.append(Paragraph("<b>Overall Recommendation</b>", s["h3"]))
    story.append(_text_box(a.get("overall_recommendation") or "", num_rows=8))
    story.append(PageBreak())

    # ============================================================
    # PAGE 3 — Roof Asset Dashboard™
    # ============================================================
    _section_header("Roof Asset Dashboard™", story, s)
    story.append(Paragraph(
        '<font color="#52525B" size="8"><i>Executive-friendly summary: categorical bands let stakeholders compare at a glance. Numeric scores remain below each tile for analytical reference.</i></font>',
        s["body_sm"],
    ))
    story.append(Spacer(1, 6))

    # Roof Asset Score™ is the headline composite — give it its own large tile spanning 4 columns
    composite_band = band_for("roof_asset_score", (a.get("roof_asset_score") or {}).get("score"))
    composite_color = colors.HexColor(composite_band["color"])
    composite_tile = Table([
        [Paragraph("ROOF ASSET SCORE™", ParagraphStyle("ck_eyebrow", fontName="Helvetica-Bold", fontSize=8, textColor=GRAY, leading=10, alignment=TA_CENTER))],
        [Paragraph(
            f'<font color="{composite_band["color"]}" size="32"><b>{composite_band["label"]}</b></font>'
            f'<font color="#A0A0A0" size="14"><b>/100</b></font>',
            ParagraphStyle("ck_n", fontName="Helvetica-Bold", fontSize=32, leading=36, alignment=TA_CENTER),
        )],
        [Paragraph(
            f'<font color="{composite_band["color"]}" size="11"><b>{composite_band["sublabel"]}</b></font>',
            ParagraphStyle("ck_s", fontName="Helvetica-Bold", fontSize=11, leading=14, alignment=TA_CENTER),
        )],
    ], colWidths=[7.3 * inch], rowHeights=[0.24 * inch, 0.55 * inch, 0.26 * inch])
    composite_tile.setStyle(TableStyle([
        ("BACKGROUND",   (0, 0), (-1, -1), _tint_bg(composite_band["color"])),
        ("BOX",          (0, 0), (-1, -1), 1.0, composite_color),
        ("VALIGN",       (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING",   (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING",(0, 0), (-1, -1), 3),
    ]))
    story.append(composite_tile)
    story.append(Spacer(1, 10))

    # 7 sub-metrics in a 4-col × 2-row grid (last row has 3 tiles + 1 empty cell)
    submetrics = [
        ("Condition Rating",          "condition_rating"),
        ("Remaining Service Life",    "remaining_service_life"),
        ("Restoration Suitability™",  "restoration_suitability"),
        ("Maintenance Status",        "maintenance_status"),
        ("Hail Resilience™",          "hail_resilience"),
        ("Warranty Status",           "warranty_status"),
        ("Capital Risk™",             "capital_risk"),
    ]
    tile_w = 1.75 * inch
    grid_rows = []
    for i in range(0, len(submetrics), 4):
        row_cells = []
        for j in range(4):
            if i + j < len(submetrics):
                lbl, key = submetrics[i + j]
                row_cells.append(_band_tile(lbl, key, a.get(key, {}), width=tile_w))
            else:
                # Empty filler cell
                row_cells.append("")
        grid_rows.append(row_cells)
    grid = Table(grid_rows, colWidths=[tile_w] * 4, hAlign="LEFT")
    grid.setStyle(TableStyle([
        ("VALIGN",       (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING",  (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING",   (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING",(0, 0), (-1, -1), 4),
    ]))
    story.append(grid)

    # Executive Findings (push to next page so the dashboard breathes)
    story.append(PageBreak())
    _section_header("Executive Findings", story, s)
    story.append(Paragraph("<b>Primary Concerns</b>", s["h3"]))
    story.append(_finding_box(a.get("primary_concerns", []), num_slots=3, row_height=0.26 * inch))
    story.append(Spacer(1, 6))
    story.append(Paragraph("<b>Positive Findings</b>", s["h3"]))
    story.append(_finding_box(a.get("positive_findings", []), num_slots=3, row_height=0.26 * inch))

    # ============================================================
    # PAGE 3 (continued) — Recommended Strategy + Capital Planning Impact + Immediate Action Items
    # (Previously on Page 4; compacted onto Page 3 per spec.)
    # ============================================================
    story.append(Spacer(1, 10))
    story.append(Paragraph("<b>Recommended Strategy</b>", s["h3"]))
    story.append(_text_box(a.get("recommended_strategy") or "", num_rows=4))
    story.append(Spacer(1, 8))
    story.append(Paragraph("<b>Capital Planning Impact</b>", s["h3"]))
    story.append(_text_box(a.get("capital_planning_impact") or "", num_rows=4))
    story.append(Spacer(1, 8))
    story.append(Paragraph("<b>Immediate Action Items</b>", s["h3"]))
    story.append(_text_box(" • ".join(a.get("immediate_action_items") or []), num_rows=4))
    story.append(PageBreak())

    # ============================================================
    # PAGE 5 — Assessment Methodology + Property Information + Assessment Scope
    # ============================================================
    _section_header("Assessment Methodology", story, s)
    methodology_default = (
        "This assessment was performed by a SealTech roof consultant using a combination of various methods, "
        "including but not limited to those below."
    )
    story.append(Paragraph(_esc(a.get("methodology_notes")) or methodology_default, s["body"]))
    story.append(Spacer(1, 6))

    # 2-column box of assessment focus areas (matches original Page 4 layout)
    method_items = [
        "Waterproofing Integrity",
        "Flashings & Penetrations",
        "Structural Indicators",
        "Maintenance History",
        "Surface Condition",
        "Drainage Performance",
        "Weather-Related Damage",
        "Future Risk Exposure",
    ]
    method_rows = []
    for i in range(0, len(method_items), 2):
        left = method_items[i]
        right = method_items[i + 1] if i + 1 < len(method_items) else ""
        method_rows.append([
            Paragraph(f'<font color="#A0703A">•</font> &nbsp; {left}', s["body_sm"]),
            Paragraph(f'<font color="#A0703A">•</font> &nbsp; {right}' if right else "", s["body_sm"]),
        ])
    method_t = Table(method_rows, colWidths=[3.65 * inch, 3.65 * inch])
    method_t.hAlign = "LEFT"
    method_t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOX", (0, 0), (-1, -1), 0.75, BOX_BORDER),
        ("BACKGROUND", (0, 0), (-1, -1), SOFT_BRONZE),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(method_t)
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
        Paragraph(_esc(v) or "—", s["body_sm"]),
    ] for k, v in prop_rows]
    prop_t = Table(prop_data, colWidths=[1.6 * inch, 5.7 * inch])
    prop_t.hAlign = "LEFT"
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
    scope_t = Table(scope_rows, colWidths=[3.65 * inch, 3.65 * inch])
    scope_t.hAlign = "LEFT"
    scope_t.setStyle(TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 8), ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]))
    story.append(scope_t)
    story.append(PageBreak())

    # ============================================================
    # PAGE 5 — Aerial Image (top half) + R-1 finding (bottom half)
    # ============================================================
    _section_header("Aerial Image of Roof", story, s)
    aerial_bytes = await _load_photo(db, a.get("aerial_photo_id"))
    story.append(_photo_flowable(aerial_bytes, w=7.3 * inch, h=3.3 * inch, placeholder="Aerial roof image — upload in editor", h_align="LEFT"))
    story.append(Spacer(1, 12))
    _section_header("Asset Condition Findings", story, s)
    await _render_finding(db, story, s, idx=1, finding=a.get("finding_r1") or {})
    story.append(PageBreak())

    # ============================================================
    # PAGE 6 — R-2 + R-3   (2 findings per page)
    # ============================================================
    await _render_finding(db, story, s, idx=2, finding=a.get("finding_r2") or {})
    story.append(Spacer(1, 10))
    await _render_finding(db, story, s, idx=3, finding=a.get("finding_r3") or {})
    story.append(PageBreak())

    # ============================================================
    # PAGE 7 — R-4 + R-5
    # ============================================================
    await _render_finding(db, story, s, idx=4, finding=a.get("finding_r4") or {})
    story.append(Spacer(1, 10))
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
        ["70 – 79",  "Fair — moderate findings; restoration suitable with a proactive plan."],
        ["60 – 69",  "Marginal — significant repair / restoration needed."],
        ["Below 60", "Poor — immediate restoration and possible replacement needed."],
    ]
    interp_t = Table(interp_data, colWidths=[1.4 * inch, 5.9 * inch])
    interp_t.hAlign = "LEFT"
    interp_t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), BLUE),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("BOX", (0, 0), (-1, -1), 0.75, BOX_BORDER),
        ("INNERGRID", (0, 0), (-1, -1), 0.25, BOX_BORDER),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    story.append(interp_t)

    # Restoration-first note — supports the SealTech business model where the
    # vast majority of low-scoring roofs remain candidates for restoration.
    story.append(Spacer(1, 6))
    note_style = ParagraphStyle(
        "restore_note", parent=s["body_sm"], fontName="Helvetica",
        fontSize=8, leading=11, textColor=colors.HexColor("#404040"),
        backColor=colors.HexColor("#EFF6FF"), borderColor=BLUE,
        borderWidth=0.5, borderPadding=6,
    )
    story.append(Paragraph(
        "<b>Restoration-First Note:</b> Virtually every low-slope roof system can be restored, "
        "including those scoring below 60. Roof replacement is only required when (a) the roof "
        "<b>insulation is saturated</b> beyond cost-effective drying / replacement, or (b) the "
        "<b>structural deck is damaged</b>. In all other cases, restoration is the recommended path "
        "\u2014 extending service life, preserving capital, and avoiding the disruption and landfill "
        "impact of a tear-off.",
        note_style,
    ))

    story.append(Spacer(1, 10))
    story.append(Paragraph("<b>Score Drivers</b>", s["h3"]))
    story.append(Paragraph('<font color="#16A34A"><b>POSITIVE FACTORS</b></font>', s["label"]))
    story.append(Spacer(1, 2))
    story.append(_finding_box(a.get("positive_factors", []), num_slots=3, row_height=0.28 * inch))
    story.append(Spacer(1, 8))
    story.append(Paragraph('<font color="#B91C1C"><b>NEGATIVE FACTORS</b></font>', s["label"]))
    story.append(Spacer(1, 2))
    story.append(_finding_box(a.get("negative_factors", []), num_slots=3, row_height=0.28 * inch))

    story.append(Spacer(1, 10))
    story.append(Paragraph("<b>Restoration Suitability™ Analysis</b>", s["h3"]))
    rating = a.get("restoration_suitability_rating") or "Moderate"
    rating_color = {"High": GREEN, "Moderate": AMBER, "Low": RED}.get(rating, GRAY)
    story.append(Paragraph(
        f'Rating: <font color="{rating_color.hexval()}"><b>{rating.upper()}</b></font>',
        s["body"],
    ))
    story.append(Spacer(1, 4))
    story.append(_text_box(a.get("restoration_analysis") or "", num_rows=6, row_height=0.23 * inch))

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
    f_t = Table(factor_rows, colWidths=[3.65 * inch, 3.65 * inch])
    f_t.hAlign = "LEFT"
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
    comp_t = Table(comp, colWidths=[1.6 * inch, 1.9 * inch, 1.9 * inch, 1.9 * inch])
    comp_t.hAlign = "LEFT"
    comp_t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), BLUE),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("BOX", (0, 0), (-1, -1), 0.75, BOX_BORDER),
        ("INNERGRID", (0, 0), (-1, -1), 0.25, BOX_BORDER),
        ("ALIGN", (1, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("FONTNAME", (0, 1), (0, -1), "Helvetica-Bold"),
    ]))
    story.append(comp_t)

    # Restoration eligibility note — clarifies the only conditions where
    # replacement is genuinely required vs. just a more expensive option.
    story.append(Spacer(1, 8))
    elig_style = ParagraphStyle(
        "elig", parent=s["body_sm"], fontName="Helvetica",
        fontSize=8, leading=11, textColor=colors.HexColor("#404040"),
        backColor=colors.HexColor("#F0FDF4"), borderColor=colors.HexColor("#16A34A"),
        borderWidth=0.5, borderPadding=6,
    )
    story.append(Paragraph(
        "<b>Restoration Eligibility:</b> Virtually every flat / low-slope roof system can be "
        "restored. Replacement is only required when (1) the <b>insulation is saturated</b> beyond "
        "cost-effective drying / replacement, or (2) the <b>structural deck is damaged</b>. Where "
        "neither condition is present, restoration delivers comparable life extension at a fraction "
        "of the cost and disruption of a full tear-off.",
        elig_style,
    ))

    for label, opt in [("Option 1 — Continue Repairs and Maintenance", repair),
                       ("Option 2 — Restoration", restore),
                       ("Option 3 — Replacement", replace)]:
        block = [
            Spacer(1, 4),
            Paragraph(f"<b>{label}</b>", s["h3"]),
            Paragraph('<font color="#16A34A"><b>ADVANTAGES</b></font>', s["label"]),
            Spacer(1, 2),
            _text_box(" • ".join(opt.get("advantages") or []), num_rows=2, row_height=0.26 * inch),
            Spacer(1, 2),
            Paragraph('<font color="#B91C1C"><b>DISADVANTAGES</b></font>', s["label"]),
            Spacer(1, 2),
            _text_box(" • ".join(opt.get("disadvantages") or []), num_rows=2, row_height=0.26 * inch),
            Spacer(1, 2),
            Paragraph('<font color="#D97706"><b>LIMITATIONS</b></font>', s["label"]),
            Spacer(1, 2),
            _text_box(" • ".join(opt.get("limitations") or []), num_rows=2, row_height=0.26 * inch),
        ]
        story.append(KeepTogether(block))
    story.append(PageBreak())

    # ============================================================
    # PAGE 11 — Capital Planning Forecast + Recommended Plan
    # ============================================================
    _section_header("Capital Planning Forecast", story, s)
    # Stack each outlook as h3 label + bordered text box (matches Recommended Strategy /
    # Capital Planning Impact pattern from Page 3). Sized to fill Page 10 along with
    # the Recommended Roof Asset Plan™ section below.
    forecast_rows = [
        ("1-Year Outlook",  a.get("forecast_1yr", "")),
        ("3-Year Outlook",  a.get("forecast_3yr", "")),
        ("5-Year Outlook",  a.get("forecast_5yr", "")),
        ("10-Year Outlook", a.get("forecast_10yr", "")),
    ]
    for k, v in forecast_rows:
        story.append(Paragraph(f"<b>{k}</b>", s["h3"]))
        story.append(_text_box(v or "", num_rows=3, row_height=0.26 * inch))
        story.append(Spacer(1, 2))

    story.append(Spacer(1, 12))
    _section_header("Recommended Roof Asset Plan™", story, s)
    priority = a.get("budget_priority") or "Moderate"
    priority_color = {"Low": GREEN, "Moderate": AMBER, "High": RED, "Immediate": RED}.get(priority, GRAY)
    story.append(Paragraph(
        f'<b>Estimated Budget Priority:</b> <font color="{priority_color.hexval()}"><b>{priority.upper()}</b></font>',
        s["body"],
    ))
    story.append(Spacer(1, 4))
    story.append(Paragraph("<b>Immediate Actions (0–12 Months)</b>", s["h3"]))
    story.append(_text_box(" • ".join(a.get("immediate_actions") or []), num_rows=3, row_height=0.26 * inch))
    story.append(Spacer(1, 2))
    story.append(Paragraph("<b>Near-Term Actions (1–3 Years)</b>", s["h3"]))
    story.append(_text_box(" • ".join(a.get("near_term_actions") or []), num_rows=3, row_height=0.26 * inch))
    story.append(Spacer(1, 2))
    story.append(Paragraph("<b>Long-Term Actions (3–10 Years)</b>", s["h3"]))
    story.append(_text_box(" • ".join(a.get("long_term_actions") or []), num_rows=3, row_height=0.26 * inch))
    story.append(PageBreak())

    # ============================================================
    # PAGE 12 — SealTech Recommendation + Expected Outcome + Conclusion
    # ============================================================
    _section_header("SealTech Recommendation", story, s)
    rec_items = [
        ("Restoration Program",    a.get("rec_restoration_program"),    a.get("rec_restoration_program_comment", "")),
        ("Repair &amp; Monitor",   a.get("rec_repair_and_monitor"),     a.get("rec_repair_and_monitor_comment", "")),
        ("Partial Replacement",    a.get("rec_partial_replacement"),    a.get("rec_partial_replacement_comment", "")),
        ("Full Replacement",       a.get("rec_full_replacement"),       a.get("rec_full_replacement_comment", "")),
        ("Maintenance Program",    a.get("rec_maintenance_program"),    a.get("rec_maintenance_program_comment", "")),
        ("Drainage Improvements",  a.get("rec_drainage_improvements"),  a.get("rec_drainage_improvements_comment", "")),
    ]
    # Build a stacked layout — checkbox + label on left, bordered comment box on right.
    rec_rows = []
    for label_text, checked, comment in rec_items:
        check_cell = Paragraph(f'{_check(bool(checked))} &nbsp; <b>{label_text}</b>', s["body_sm"])
        comment_box = _text_box(comment or "", num_rows=1, row_height=0.32 * inch, width=5.2 * inch, placeholder="Comments")
        rec_rows.append([check_cell, comment_box])
    rec_t = Table(rec_rows, colWidths=[2.1 * inch, 5.2 * inch])
    rec_t.hAlign = "LEFT"
    rec_t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (0, -1), 8),
        ("LEFTPADDING", (1, 0), (1, -1), 0),
        ("RIGHTPADDING", (1, 0), (1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(rec_t)

    story.append(Spacer(1, 8))
    story.append(Paragraph("<b>Supporting Comments</b>", s["h3"]))
    story.append(_text_box(a.get("supporting_comments") or "", num_rows=6, row_height=0.26 * inch))

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
    o_t = Table(outcome_rows, colWidths=[3.65 * inch, 3.65 * inch])
    o_t.hAlign = "LEFT"
    o_t.setStyle(TableStyle([
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("TEXTCOLOR", (0, 0), (-1, -1), GREEN),
    ]))
    story.append(o_t)

    story.append(Spacer(1, 14))
    _section_header("Conclusion", story, s)
    # Standard boilerplate (always rendered, no per-assessment override)
    story.append(Paragraph("Commercial roofs are valuable assets.", s["body"]))
    story.append(Spacer(1, 6))
    story.append(Paragraph(
        "The objective of this assessment is not simply identifying deficiencies. The objective is to understand "
        "the condition, value, remaining service life, future risks, and long-term potential of the roofing asset.",
        s["body"],
    ))
    story.append(Spacer(1, 6))
    story.append(Paragraph(
        "The most informed roofing decisions begin with objective information.",
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


def _band_tile(label: str, metric_key: str, sc: dict, width: float = 1.75 * inch, height: float = 1.05 * inch) -> Table:
    """Executive tile card for a single Roof Asset Dashboard™ metric.
    Layout (top → bottom):
        metric label  (eyebrow, 7pt, grey, uppercase)
        BAND HEADLINE (bold, 18pt, band color)
        sublabel      (8pt, grey: "82/100" or "Remaining" for RSL)
    Background is a tinted color matching the band, with a thin border.
    """
    if not isinstance(sc, dict):
        sc = {}
    band = band_for(metric_key, sc.get("score"))
    band_color = colors.HexColor(band["color"])
    # Soft tinted background — alpha is approximated by using a lighter shade
    tint = _tint_bg(band["color"])

    label_style = ParagraphStyle(
        "tile_label", fontName="Helvetica-Bold", fontSize=7, textColor=GRAY,
        leading=9, alignment=TA_CENTER, spaceAfter=0,
    )
    headline_style = ParagraphStyle(
        "tile_head", fontName="Helvetica-Bold", fontSize=16, textColor=band_color,
        leading=19, alignment=TA_CENTER, spaceAfter=0, spaceBefore=2,
    )
    sub_style = ParagraphStyle(
        "tile_sub", fontName="Helvetica-Bold", fontSize=8, textColor=GRAY,
        leading=10, alignment=TA_CENTER,
    )
    # Shorter headline font for "X Years Remaining" if too wide
    headline_text = band["label"]
    if len(headline_text) > 9 and metric_key != "remaining_service_life":
        headline_style = ParagraphStyle(
            "tile_head_sm", fontName="Helvetica-Bold", fontSize=13, textColor=band_color,
            leading=16, alignment=TA_CENTER, spaceBefore=2,
        )

    tile = Table([
        [Paragraph(label.upper(), label_style)],
        [Paragraph(headline_text, headline_style)],
        [Paragraph(band["sublabel"] or "", sub_style)],
    ], colWidths=[width], rowHeights=[0.22 * inch, 0.45 * inch, 0.22 * inch])
    tile.setStyle(TableStyle([
        ("BACKGROUND",   (0, 0), (-1, -1), tint),
        ("BOX",          (0, 0), (-1, -1), 0.75, band_color),
        ("LINEBELOW",    (0, 0), (-1, 0), 0.5, BORDER),
        ("VALIGN",       (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING",  (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING",   (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING",(0, 0), (-1, -1), 2),
    ]))
    return tile


def _tint_bg(hex_color: str) -> colors.Color:
    """Return a very light tint (~12% opacity over white) of a hex color."""
    h = hex_color.lstrip("#")
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    # 12% color blended with 88% white
    rr = int(0.12 * r + 0.88 * 255)
    gg = int(0.12 * g + 0.88 * 255)
    bb = int(0.12 * b + 0.88 * 255)
    return colors.Color(rr / 255.0, gg / 255.0, bb / 255.0)


async def _render_finding(db, story: list, s: dict, idx: int, finding: dict, photo_size: float = None, show_severity: bool = True):
    """Render one R-N finding block matching the original layout:
       - Header with code + component name + severity badge (badge hidden if show_severity=False)
       - 4-row info table (Observations / Severity / Risk / Recommendation;
         SEVERITY row dropped if show_severity=False)
       - 2 square photo slots side-by-side below
    `photo_size` controls the square photo edge length. Defaults to 2.7" — a safe
    size that handles longer text content without overflowing on dual-finding pages.
    `show_severity` is set False by the Property Evaluation PDF where customers
    don't need the inspector-facing risk classification.
    The full finding block is wrapped in KeepTogether so it never splits across pages.
    """
    if photo_size is None:
        photo_size = 2.7 * inch
    component = _esc(finding.get("component", f"Component {idx}"))

    block: list = []
    if show_severity:
        severity = _esc(finding.get("severity", ""))
        severity_color = {"Critical": RED, "High": RED, "Moderate": AMBER, "Low": GREEN}.get(severity, GRAY).hexval()
        block.append(Paragraph(
            f'<font color="#A0703A"><b>R-{idx}</b></font>  &nbsp; <b>{component}</b> '
            f'&nbsp;&nbsp; <font color="{severity_color}"><b>[{severity or "—"}]</b></font>',
            s["h2"],
        ))
    else:
        block.append(Paragraph(
            f'<font color="#A0703A"><b>R-{idx}</b></font>  &nbsp; <b>{component}</b>',
            s["h2"],
        ))

    body_rows = [["OBSERVATIONS", _esc(finding.get("observations")) or "—"]]
    if show_severity:
        body_rows.append(["SEVERITY", _esc(finding.get("severity")) or "—"])
    body_rows.append(["RISK", _esc(finding.get("risk")) or "—"])
    body_rows.append(["RECOMMENDATION", _esc(finding.get("recommendation")) or "—"])
    body_data = [[
        Paragraph(f'<font color="#A0703A"><b>{k}</b></font>', s["label"]),
        Paragraph(v, s["body_sm"]),
    ] for k, v in body_rows]
    body_t = Table(body_data, colWidths=[1.6 * inch, 5.7 * inch])
    body_t.hAlign = "LEFT"
    body_t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BACKGROUND", (0, 0), (0, -1), SOFT_BRONZE),
        ("BOX", (0, 0), (-1, -1), 0.75, BOX_BORDER),
        ("INNERGRID", (0, 0), (-1, -1), 0.25, BOX_BORDER),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
    ]))
    block.append(body_t)
    block.append(Spacer(1, 4))

    # 2 photo slots — square placeholders sized to fill remaining vertical space.
    # Left photo flush LEFT, right photo flush RIGHT (aligned with body_t right edge).
    photo_ids = (finding.get("photo_ids") or [])[:2]
    slots = [None, None]
    for i, pid in enumerate(photo_ids[:2]):
        slots[i] = await _load_photo(db, pid)
    gap = (7.3 * inch) - (2 * photo_size)
    left_photo = _photo_flowable(slots[0], w=photo_size, h=photo_size, placeholder="Photo placeholder", h_align="LEFT")
    right_photo = _photo_flowable(slots[1], w=photo_size, h=photo_size, placeholder="Photo placeholder", h_align="RIGHT")
    ph_t = Table([[left_photo, "", right_photo]],
                 colWidths=[photo_size, gap, photo_size],
                 rowHeights=[photo_size + 0.05 * inch])
    ph_t.hAlign = "LEFT"
    ph_t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
    ]))
    block.append(ph_t)
    # Keep the whole finding (heading + body table + photos) atomic so it never
    # splits mid-block and never overlaps the next finding's photo row.
    story.append(KeepTogether(block))
