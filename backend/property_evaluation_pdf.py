"""SealTech Property Evaluation — non-fee-based 6-page courtesy PDF.

A slimmed-down sibling of the 12-page Commercial Roof Assessment Report, built
from the SAME `assessment` document so the user enters property data exactly
once. Designed for small projects where a full paid assessment would be
overkill: the inspector still walks the roof and captures up to 3 findings,
and the customer gets a credible-looking report that points them at the right
restoration / repair / replacement path.

Page layout (6 pages) — updated 2026-02-19 per Darren's review:
    1. Cover — branded as "Property Evaluation"
    2. Purpose of Evaluation — single long paragraph defining the engagement
    3. Aerial Image + Finding R-1 (severity hidden, larger photos)
    4. Findings R-2 + R-3 (severity hidden, larger photos)
    5. Roof Score Analysis + Overall Recommendation (Score Drivers removed)
    6. SealTech Recommendation (7-line salesperson text box) +
       Expected Outcomes (single column of 6 benefits) + Conclusion

Public API:
    await build_property_evaluation_pdf(db, assessment_doc) -> bytes

This module is intentionally additive — it imports helpers from
`assessment_pdf` rather than duplicating layout primitives, so any future
brand-palette or footer change in the main report propagates here for free.
"""
from __future__ import annotations

import os
from io import BytesIO

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    Image, PageBreak,
)
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from PIL import Image as PILImage

# Reuse every helper / style / palette token from the full-assessment generator
# so the two PDFs stay visually consistent without any copy-paste drift.
from assessment_pdf import (
    LOGO_PATH,
    BLUE, BRONZE, DARK, GRAY, BORDER, GREEN,
    SOFT_BRONZE, BOX_BORDER,
    _styles, _make_footer,
    _load_photo, _photo_flowable,
    _score_box, _section_header, _check, _esc,
    _text_box, _fmt_date,
    _render_finding,
)


def _fit_box(img_bytes: bytes | None, max_w: float, max_h: float) -> tuple[float, float]:
    """Return (width, height) for the image that fits inside (max_w, max_h)
    while preserving its natural aspect ratio. Falls back to a 4:3 landscape
    box if the bytes can't be decoded (placeholder path will run anyway)."""
    if not img_bytes:
        return max_w, max_h
    try:
        with PILImage.open(BytesIO(img_bytes)) as im:
            iw, ih = im.size
        if iw <= 0 or ih <= 0:
            return max_w, max_h
        scale = min(max_w / iw, max_h / ih)
        return iw * scale, ih * scale
    except Exception:
        return max_w, max_h


# Color stops for the 5-band score gauge — match the interpretation table
# used elsewhere in the doc so readers visually anchor "amber = marginal".
SCORE_BANDS = [
    (0,  60,  "POOR",     "<60",    "#B91C1C", "Immediate restoration and possible replacement needed."),
    (60, 70,  "MARGINAL", "60–69",  "#EA580C", "Significant repair or restoration needed."),
    (70, 80,  "FAIR",     "70–79",  "#CA8A04", "Moderate findings. Restoration suitable with a proactive plan."),
    (80, 90,  "GOOD",     "80–89",  "#65A30D", "Minor maintenance items. Restoration highly suitable."),
    (90, 101, "EXCELLENT","90–100", "#15803D", "Roof in like-new condition. Minimal capital risk."),
]


def _band_for_score(score_val: int) -> tuple[int, str, str, str, str]:
    """Return (idx, label, range_text, hex_color, description) for the given score."""
    for i, (lo, hi, label, rng, hexc, desc) in enumerate(SCORE_BANDS):
        if lo <= score_val < hi:
            return i, label, rng, hexc, desc
    # Above-100 edge case — clamp to Excellent
    last = SCORE_BANDS[-1]
    return len(SCORE_BANDS) - 1, last[2], last[3], last[4], last[5]


def _eval_score_card(s: dict, score_val: int, reasoning: str) -> Table:
    """The Evaluation's signature score card — replaces the assessment's blue
    side-panel layout with a more visual presentation that fits a one-page
    sales doc. Layout (left → right inside one bordered card):

        ┌────────────────────────────────────────────────────────────┐
        │ OVERALL ROOF ASSET SCORE™                                  │
        │ ┌────────┐  ┌──────┬──────┬──────┬──────┬──────┐           │
        │ │  50   │  │      │  ▼   │      │      │      │ (arrow)   │
        │ │ /100  │  ├──────┼──────┼──────┼──────┼──────┤           │
        │ │MARGIN.│  │ POOR │MARG. │ FAIR │ GOOD │ EXC. │ (bands)   │
        │ └────────┘  │  <60 │60-69 │70-79 │80-89 │90-100│           │
        │             └──────┴──────┴──────┴──────┴──────┘           │
        │                                                            │
        │ Significant repair or restoration needed.                  │
        │                                                            │
        │ REASONING — Not yet documented.                            │
        └────────────────────────────────────────────────────────────┘
    """
    cat_idx, cat_label, cat_range, cat_hex, cat_desc = _band_for_score(score_val or 0)
    cat_color = colors.HexColor(cat_hex)

    # --- Left block: big score number + category pill ---
    score_para = Paragraph(
        f'<font color="{cat_hex}" size="44"><b>{score_val or 0}</b></font>'
        f'<font color="#9CA3AF" size="18">&nbsp;/100</font>',
        ParagraphStyle("score_num", alignment=TA_CENTER, fontSize=44, leading=48),
    )
    cat_pill = Paragraph(
        f'<font color="white" size="9"><b>{cat_label}</b></font>',
        ParagraphStyle("cat_pill", alignment=TA_CENTER, fontSize=9, leading=12),
    )
    pill_tbl = Table([[cat_pill]], colWidths=[1.6 * inch], rowHeights=[0.28 * inch])
    pill_tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), cat_color),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
    ]))
    left_block = Table(
        [[score_para], [pill_tbl]],
        colWidths=[1.9 * inch],
    )
    left_block.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (0, 0), 2),
        ("TOPPADDING", (0, 1), (0, 1), 4),
    ]))

    # --- Right block: 5-band gauge with arrow marker over active band ---
    arrow_cells = [""] * 5
    arrow_cells[cat_idx] = Paragraph(
        f'<font color="{cat_hex}" size="16"><b>&#9660;</b></font>',
        ParagraphStyle("arrow", alignment=TA_CENTER, fontSize=16, leading=16),
    )
    band_label_cells = [
        Paragraph(
            f'<font color="white" size="7.5"><b>{lbl}</b></font><br/>'
            f'<font color="white" size="6.5">{rng}</font>',
            ParagraphStyle(f"band{i}", alignment=TA_CENTER, fontSize=7, leading=10),
        )
        for i, (_, _, lbl, rng, _, _) in enumerate(SCORE_BANDS)
    ]
    band_w = (CONTENT_W - 1.9 * inch - 0.4 * inch) / 5
    gauge = Table(
        [arrow_cells, band_label_cells],
        colWidths=[band_w] * 5,
        rowHeights=[0.32 * inch, 0.5 * inch],
    )
    gauge_style = TableStyle([
        ("VALIGN", (0, 0), (-1, 0), "BOTTOM"),
        ("VALIGN", (0, 1), (-1, 1), "MIDDLE"),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 0),
        ("TOPPADDING", (0, 1), (-1, 1), 4),
        ("BOTTOMPADDING", (0, 1), (-1, 1), 4),
    ])
    for i, (_, _, _, _, hexc, _) in enumerate(SCORE_BANDS):
        gauge_style.add("BACKGROUND", (i, 1), (i, 1), colors.HexColor(hexc))
    gauge.setStyle(gauge_style)

    # --- Stack header + (left | gauge) + category description + reasoning ---
    header_para = Paragraph(
        '<font color="#A0703A" size="9"><b>OVERALL ROOF ASSET SCORE&trade;</b></font>',
        ParagraphStyle("card_title", alignment=TA_LEFT, fontSize=9, leading=12),
    )
    score_row = Table([[left_block, gauge]], colWidths=[1.9 * inch, CONTENT_W - 1.9 * inch - 0.6 * inch])
    score_row.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))

    desc_para = Paragraph(
        f'<font color="{cat_hex}" size="10"><b>{cat_label}</b></font>'
        f'&nbsp;&nbsp;<font color="#52525B" size="9">{cat_desc}</font>',
        ParagraphStyle("cat_desc", alignment=TA_LEFT, fontSize=9, leading=12),
    )

    reason_text = _esc(reasoning) or '<i>Not yet documented.</i>'
    reason_para = Paragraph(
        f'<font color="#A0703A" size="8"><b>REASONING</b></font>'
        f'&nbsp;&nbsp;<font color="#3F3F46" size="9">{reason_text}</font>',
        ParagraphStyle("reason", alignment=TA_LEFT, fontSize=9, leading=12),
    )

    # Outer card binds everything in a single bordered container so the
    # whole score "widget" reads as one element.
    card = Table(
        [[header_para], [score_row], [desc_para], [reason_para]],
        colWidths=[CONTENT_W - 0.3 * inch],
    )
    card.hAlign = "LEFT"
    card.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.6, BORDER),
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#FAFAFA")),
        ("LEFTPADDING", (0, 0), (-1, -1), 14),
        ("RIGHTPADDING", (0, 0), (-1, -1), 14),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        # Subtle top border in bronze to brand the card
        ("LINEABOVE", (0, 0), (-1, 0), 2.0, BRONZE),
    ]))
    return card


# Content width = letter width 8.5" minus 0.6" margins on each side = 7.3"
CONTENT_W = 7.3 * inch

# Long-form copy that the salesperson asked us to lock in as the Evaluation
# default. Stored as module-level constants so they're easy to tweak without
# threading editor logic.
PURPOSE_OF_EVALUATION_PARTS = [
    (
        "The purpose of this Roof Evaluation is to conduct a evaluation of the existing "
        "roofing system to determine its current condition, remaining service life, and "
        "suitability for continued performance. Through an inspection, documentation of "
        "deficiencies, and analysis of key performance factors&mdash;including membrane "
        "integrity, insulation performance, drainage characteristics, flashing details, "
        "and structural support&mdash;this evaluation identifies the most appropriate "
        "course of action among targeted repairs, full restoration, or complete "
        "replacement."
    ),
    (
        "The objective is to provide data-driven recommendations that maximize asset "
        "longevity, minimize long-term costs, ensure compliance with applicable codes "
        "and standards, and support informed decision-making aligned with the property "
        "owner&rsquo;s operational and budgetary requirements. This process follows a "
        "structured methodology that prioritizes sustainable solutions, such as "
        "fluid-applied reinforced membrane systems, to extend roof service life while "
        "mitigating risks associated with water intrusion, energy inefficiency, and "
        "premature failure."
    ),
]

EXPECTED_OUTCOMES = [
    "Extended Service Life of Roof",
    "Superior Waterproofing and Leak Prevention",
    "Enhanced Durability and Impact Resistance (Potential 2&quot; Hail Rider on warranty)",
    "New Warranty that is Renewable and Transferrable",
    "Improved Energy Efficiency",
    "Reduced Future Maintenance Requirements",
]

CONCLUSION_PARAGRAPHS = [
    "Commercial roofing systems represent significant financial and operational "
    "assets. The primary objective of this evaluation extends beyond the "
    "identification of current deficiencies to deliver an understanding of the "
    "roof&rsquo;s present condition, intrinsic value, remaining service life, "
    "potential risks, and long-term performance capabilities. By providing "
    "objective, data-driven insights, this evaluation equips property owners and "
    "others responsible with the critical information necessary to make strategic, "
    "cost-effective decisions regarding repair, restoration, or replacement.",

    "SealTech Solutions stands ready to support your asset management objectives. "
    "We would be pleased to conduct a full Commercial Roof Assessment Report&trade; "
    "at your convenience, offering detailed scoring, lifecycle analysis, and "
    "tailored recommendations&mdash;including the proven benefits of fluid-applied "
    "reinforced membrane restoration&mdash;for your specific property.",

    "Please contact us to schedule the next step toward preserving and optimizing "
    "your roofing investment.",
]


async def build_property_evaluation_pdf(db, a: dict) -> bytes:
    """Render the 6-page Property Evaluation PDF for assessment doc `a`."""
    s = _styles()
    buf = BytesIO()
    pdf = SimpleDocTemplate(
        buf, pagesize=letter,
        leftMargin=0.6 * inch, rightMargin=0.6 * inch,
        topMargin=0.5 * inch, bottomMargin=0.75 * inch,
        title=f"Property Evaluation — {a.get('property_name') or a.get('property_address') or ''}",
    )
    story: list = []

    # =====================================================================
    # PAGE 1 — Cover (unchanged per spec)
    # =====================================================================
    if os.path.exists(LOGO_PATH):
        try:
            logo = Image(LOGO_PATH, width=5.2 * inch, height=1.6 * inch)
            logo.hAlign = "CENTER"
            story.append(logo)
        except Exception:
            pass
    story.append(Spacer(1, 24))
    story.append(Paragraph("PROPERTY EVALUATION", s["title"]))
    story.append(Paragraph("Non-Fee-Based Courtesy Evaluation", s["subtitle"]))
    story.append(Spacer(1, 28))

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

    # Restoration-eligibility stamp on the cover.
    insulation_sat = bool(a.get("insulation_saturated"))
    deck_damaged = bool(a.get("structural_deck_damaged"))
    if insulation_sat or deck_damaged:
        stamp_color = colors.HexColor("#B91C1C")
        stamp_label = "REPLACEMENT REQUIRED"
        stamp_sub = []
        if insulation_sat:
            stamp_sub.append("Insulation Saturated")
        if deck_damaged:
            stamp_sub.append("Structural Deck Damaged")
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
    ]], colWidths=[CONTENT_W], rowHeights=[0.7 * inch])
    stamp_tbl.setStyle(TableStyle([
        ("BACKGROUND",   (0, 0), (-1, -1), colors.HexColor("#FAFAFA")),
        ("BOX",          (0, 0), (-1, -1), 1.2, stamp_color),
        ("VALIGN",       (0, 0), (-1, -1), "MIDDLE"),
    ]))
    story.append(stamp_tbl)

    story.append(Spacer(1, 18))
    disclaimer_style = ParagraphStyle(
        "eval_disclaimer", parent=s["body_sm"], fontName="Helvetica-Oblique",
        fontSize=8, leading=11, textColor=GRAY, alignment=TA_CENTER,
        backColor=colors.HexColor("#FBF7F0"), borderColor=BORDER,
        borderWidth=0.5, borderPadding=8,
    )
    story.append(Paragraph(
        "This Property Evaluation is provided at no charge as a courtesy. "
        "It reflects observations from a visual roof inspection and is not a substitute "
        "for SealTech&rsquo;s full Commercial Roof Assessment Report&trade;, which is "
        "available upon request and includes the complete Roof Asset Dashboard&trade;, "
        "Capital Planning Forecast, and detailed methodology.",
        disclaimer_style,
    ))
    story.append(PageBreak())

    # =====================================================================
    # PAGE 2 — Purpose of Evaluation + Property Image
    # =====================================================================
    _section_header("Purpose of Evaluation", story, s)
    purpose_style = ParagraphStyle(
        "eval_purpose", parent=s["body"], fontName="Helvetica",
        fontSize=10.5, leading=16, textColor=DARK, alignment=TA_LEFT,
        spaceAfter=10,
    )
    for para in PURPOSE_OF_EVALUATION_PARTS:
        story.append(Paragraph(para, purpose_style))
    story.append(Spacer(1, 14))

    # Property image (starred cover photo on the linked deal). Pulled here on
    # page 2 so it lives directly under the purpose paragraph and the rest of
    # page 3 can be devoted entirely to R-1. Sized to preserve the photo's
    # natural aspect ratio inside a 7.3" × 4.5" max box so it doesn't get
    # stretched into an unnatural landscape strip.
    _section_header("Property Image", story, s)
    property_bytes: bytes | None = None
    deal_id = a.get("deal_id")
    if deal_id:
        cover_doc = await db.project_photos.find_one(
            {"deal_id": deal_id, "is_cover": True, "is_deleted": {"$ne": True}},
            {"_id": 0, "id": 1, "storage_path": 1},
        )
        if cover_doc and cover_doc.get("id"):
            property_bytes = await _load_photo(db, cover_doc["id"])
    if not property_bytes:
        property_bytes = await _load_photo(db, a.get("aerial_photo_id"))
    fit_w, fit_h = _fit_box(property_bytes, max_w=CONTENT_W, max_h=4.5 * inch)
    story.append(_photo_flowable(
        property_bytes, w=fit_w, h=fit_h,
        placeholder="Property image — star a photo in this deal's gallery to use it here",
        h_align="CENTER",
    ))
    story.append(PageBreak())

    # =====================================================================
    # PAGE 3 — Findings R-1 + R-2  (Roof Membrane + Roof Penetrations)
    # PAGE 4 — Findings R-3 + R-4  (Drainage System + Rooftop Equipment)
    #
    # The Evaluation deliberately skips the assessment's "Flashings"
    # (finding_r2) slot per Darren — flashings and penetrations are treated
    # as the same component on small-project evaluations. Source mapping:
    #   Evaluation R-1 ← assessment finding_r1  (Roof Membrane)
    #   Evaluation R-2 ← assessment finding_r3  (Roof Penetrations)
    #   Evaluation R-3 ← assessment finding_r4  (Drainage System)
    #   Evaluation R-4 ← assessment finding_r5  (Rooftop Equipment)
    # =====================================================================
    eval_findings = [
        (1, a.get("finding_r1") or {}),
        (2, a.get("finding_r3") or {}),
        (3, a.get("finding_r4") or {}),
        (4, a.get("finding_r5") or {}),
    ]

    _section_header("Asset Condition Findings", story, s)
    for idx, fnd in eval_findings[:2]:
        if not (fnd.get("component") or fnd.get("observations") or fnd.get("photo_ids")):
            continue
        # 2.5" photos fit two findings cleanly per page after removing the
        # SEVERITY row from the body table.
        await _render_finding(db, story, s, idx=idx, finding=fnd, photo_size=2.5 * inch, show_severity=False)
        story.append(Spacer(1, 18))
    story.append(PageBreak())

    _section_header("Asset Condition Findings (continued)", story, s)
    rendered = 0
    for idx, fnd in eval_findings[2:]:
        if not (fnd.get("component") or fnd.get("observations") or fnd.get("photo_ids")):
            continue
        await _render_finding(db, story, s, idx=idx, finding=fnd, photo_size=2.5 * inch, show_severity=False)
        story.append(Spacer(1, 18))
        rendered += 1
    if rendered == 0:
        story.append(Paragraph(
            "<i>No additional findings recorded.</i>",
            s["muted"],
        ))
    story.append(PageBreak())

    # =====================================================================
    # PAGE 5 — Roof Score Analysis + Overall Recommendation
    # =====================================================================
    _section_header("Roof Score Analysis", story, s)
    overall = a.get("roof_asset_score", {})
    overall_val = int(overall.get("score") or 0) if isinstance(overall, dict) else 0
    overall_reasoning = overall.get("reasoning", "") if isinstance(overall, dict) else ""
    story.append(_eval_score_card(s, overall_val, overall_reasoning))

    story.append(Spacer(1, 8))
    interp_data = [
        ["SCORE", "INTERPRETATION"],
        ["90 – 100", "Excellent — roof in like-new condition, minimal capital risk."],
        ["80 – 89",  "Good — minor maintenance items; restoration highly suitable."],
        ["70 – 79",  "Fair — moderate findings; restoration suitable with a proactive plan."],
        ["60 – 69",  "Marginal — significant repair / restoration needed."],
        ["Below 60", "Poor — immediate restoration and possible replacement needed."],
    ]
    # Column widths add to 7.3" so the table edges sit flush with the score
    # box above and the recommendation box below — same content-frame width
    # the section headers use.
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

    story.append(Spacer(1, 8))
    # Restoration-First Note — wrapped in a single-cell 7.3" table so the
    # blue tinted background and border align EXACTLY with the score box,
    # interp table, and section headers above and below it. Wrapping the
    # Paragraph in a width-locked table prevents the subtle "drifts left"
    # rendering that ReportLab's Paragraph backColor produces when the frame
    # width changes between flowables.
    note_para_style = ParagraphStyle(
        "restore_note", parent=s["body_sm"], fontName="Helvetica",
        fontSize=9, leading=12, textColor=colors.HexColor("#1E3A8A"), alignment=TA_LEFT,
    )
    note_para = Paragraph(
        "<b>Restoration-First Note:</b> Virtually every low-slope roof system can be restored, "
        "including those scoring below 60. Roof replacement is only required when (a) the roof "
        "<b>insulation is saturated</b> beyond cost-effective drying / replacement, or (b) the "
        "<b>structural deck is damaged</b>. In all other cases, restoration is the recommended path "
        "\u2014 extending service life, preserving capital, and avoiding the disruption and landfill "
        "impact of a tear-off.",
        note_para_style,
    )
    note_t = Table([[note_para]], colWidths=[CONTENT_W])
    note_t.hAlign = "LEFT"
    note_t.setStyle(TableStyle([
        ("BACKGROUND",   (0, 0), (-1, -1), colors.HexColor("#EFF6FF")),
        ("BOX",          (0, 0), (-1, -1), 0.6, BLUE),
        ("LEFTPADDING",  (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING",   (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING",(0, 0), (-1, -1), 8),
    ]))
    story.append(note_t)

    story.append(Spacer(1, 12))
    _section_header("Overall Recommendation", story, s)
    story.append(_text_box(a.get("overall_recommendation") or "", num_rows=5))
    story.append(PageBreak())

    # =====================================================================
    # PAGE 6 — SealTech Recommendation (blank for sales) + Expected Outcomes + Conclusion
    # =====================================================================
    _section_header("SealTech Recommendation", story, s)
    # 7-line blank text box for the salesperson to fill in by hand or in a
    # subsequent edit pass. Row height tuned so the box looks like a real
    # write-on field and matches the visual weight of the rest of the doc.
    story.append(_text_box("", num_rows=7, row_height=0.30 * inch))

    story.append(Spacer(1, 12))
    _section_header("Expected Outcome", story, s)
    # Single-column bullets per Darren's spec. Each bullet sits in its own
    # row of a 1-col 7.3" table so the green checkmarks align cleanly with
    # the section header underline above.
    outcome_rows = [[
        Paragraph(
            f'<font color="{GREEN.hexval()}"><b>&#10003;</b></font>'
            f'&nbsp;&nbsp;<font color="#404040">{item}</font>',
            s["body"],
        ),
    ] for item in EXPECTED_OUTCOMES]
    outcome_t = Table(outcome_rows, colWidths=[CONTENT_W])
    outcome_t.hAlign = "LEFT"
    outcome_t.setStyle(TableStyle([
        ("LEFTPADDING",  (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING",   (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING",(0, 0), (-1, -1), 3),
    ]))
    story.append(outcome_t)

    story.append(Spacer(1, 12))
    _section_header("Conclusion", story, s)
    for para in CONCLUSION_PARAGRAPHS:
        story.append(Paragraph(para, s["body"]))
        story.append(Spacer(1, 6))

    # ---- Build PDF (two-pass for footer page count) ----
    pdf.build(list(story), onFirstPage=_make_footer(99), onLaterPages=_make_footer(99))
    page_total = pdf.page
    buf2 = BytesIO()
    pdf2 = SimpleDocTemplate(
        buf2, pagesize=letter,
        leftMargin=0.6 * inch, rightMargin=0.6 * inch,
        topMargin=0.5 * inch, bottomMargin=0.75 * inch,
        title=f"Property Evaluation — {a.get('property_name') or a.get('property_address') or ''}",
    )
    pdf2.build(list(story), onFirstPage=_make_footer(page_total), onLaterPages=_make_footer(page_total))
    return buf2.getvalue()
