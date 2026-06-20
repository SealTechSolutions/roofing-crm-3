"""SealTech Property Evaluation — non-fee-based 6-page courtesy PDF.

A slimmed-down sibling of the 12-page Commercial Roof Assessment Report, built
from the SAME `assessment` document so the user enters property data exactly
once. Designed for small projects where a full paid assessment would be
overkill: the inspector still walks the roof and captures up to 3 findings,
and the customer gets a credible-looking report that points them at the right
restoration / repair / replacement path.

Page layout (6 pages):
    1. Cover — branded as "Property Evaluation" with the non-fee-based stamp
    2. Executive Summary — purpose, executive conclusion, 4 score boxes, overall recommendation
    3. Aerial Image + up to 3 Findings (R-1..R-3)
    4. Roof Score Analysis — overall score box + interpretation table + restoration note + factors
    5. Repair vs Restoration vs Replacement comparison
    6. SealTech Recommendation + Expected Outcome + Conclusion (signature page)

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
    Image, KeepTogether, PageBreak,
)
from reportlab.lib.enums import TA_CENTER, TA_LEFT

# Reuse every helper / style / palette token from the full-assessment generator
# so the two PDFs stay visually consistent without any copy-paste drift.
from assessment_pdf import (
    LOGO_PATH,
    BLUE, BRONZE, DARK, GRAY, BORDER, GREEN, AMBER, RED,
    SOFT_BRONZE, BOX_BORDER,
    _styles, _make_footer,
    _load_photo, _photo_flowable,
    _score_box, _section_header, _check, _esc,
    _text_box, _finding_box, _fmt_date,
    _render_finding,
)


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
    # PAGE 1 — Cover
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

    # Same restoration-eligibility stamp as the full report — it's the most
    # important up-front signal for the customer regardless of report tier.
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

    # Cover disclaimer — makes the courtesy nature of the doc unambiguous so
    # there's no confusion vs the full paid Commercial Roof Assessment Report.
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
    # PAGE 2 — Executive Summary
    # =====================================================================
    _section_header("Executive Summary", story, s)
    story.append(Paragraph("<b>Purpose of Evaluation</b>", s["h3"]))
    story.append(Paragraph(_esc(a.get("purpose")) or
        "The purpose of this Property Evaluation is to provide an objective high-level review of "
        "the current condition, observed deficiencies, and recommended next steps for the roofing "
        "asset. Restoration is the primary recommendation pathway; replacement is reserved for the "
        "limited cases where the insulation is saturated or the structural deck is damaged.",
        s["body"]))
    story.append(Spacer(1, 6))

    story.append(Paragraph("<b>Executive Conclusion</b>", s["h3"]))
    story.append(_text_box(a.get("executive_conclusion") or "", num_rows=6))
    story.append(Spacer(1, 8))

    story.append(Paragraph("<b>Roof Asset Score&trade;</b>", s["h3"]))
    score_blocks = [
        ("Condition Rating", a.get("condition_rating", {})),
        ("Remaining Service Life", a.get("remaining_service_life", {})),
        ("Restoration Suitability", a.get("restoration_suitability", {})),
        ("Capital Risk&trade;", a.get("capital_risk", {})),
    ]
    for label, sc in score_blocks:
        story.append(_score_box(
            label,
            sc.get("score") if isinstance(sc, dict) else 0,
            sc.get("reasoning") if isinstance(sc, dict) else "",
        ))
        story.append(Spacer(1, 10))

    story.append(Spacer(1, 4))
    story.append(Paragraph("<b>Overall Recommendation</b>", s["h3"]))
    story.append(_text_box(a.get("overall_recommendation") or "", num_rows=5))
    story.append(PageBreak())

    # =====================================================================
    # PAGE 3 — Aerial Image + up to 3 Findings (R-1, R-2, R-3)
    # =====================================================================
    _section_header("Aerial Image of Roof", story, s)
    aerial_bytes = await _load_photo(db, a.get("aerial_photo_id"))
    story.append(_photo_flowable(
        aerial_bytes, w=7.3 * inch, h=2.7 * inch,
        placeholder="Aerial roof image — upload in editor", h_align="LEFT",
    ))
    story.append(Spacer(1, 10))

    _section_header("Asset Condition Findings", story, s)
    # Small jobs cap at 3 findings — render only the ones that have a
    # component name. This keeps the doc tight even when the inspector left
    # R-2/R-3 empty.
    findings = [
        a.get("finding_r1") or {},
        a.get("finding_r2") or {},
        a.get("finding_r3") or {},
    ]
    rendered = 0
    for idx, fnd in enumerate(findings, start=1):
        if not (fnd.get("component") or fnd.get("observations") or fnd.get("photo_ids")):
            continue
        # Tighter photo squares (2.1") so 3 findings fit comfortably on one
        # page including the aerial image above. The full report uses 2.7".
        await _render_finding(db, story, s, idx=idx, finding=fnd, photo_size=2.1 * inch)
        story.append(Spacer(1, 8))
        rendered += 1
    if rendered == 0:
        story.append(Paragraph(
            "<i>No findings recorded for this property at the time of evaluation.</i>",
            s["muted"],
        ))
    story.append(PageBreak())

    # =====================================================================
    # PAGE 4 — Roof Score Analysis
    # =====================================================================
    _section_header("Roof Score Analysis", story, s)
    overall = a.get("roof_asset_score", {})
    overall_val = int(overall.get("score") or 0) if isinstance(overall, dict) else 0
    story.append(_score_box(
        "Overall Roof Asset Score&trade;",
        overall_val,
        overall.get("reasoning", "") if isinstance(overall, dict) else "",
    ))

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

    story.append(Spacer(1, 8))
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
    # Tighter row count (2 slots vs 3) keeps Page 4 to one page for the Eval.
    story.append(_finding_box(a.get("positive_factors", []), num_slots=2, row_height=0.26 * inch))
    story.append(Spacer(1, 6))
    story.append(Paragraph('<font color="#B91C1C"><b>NEGATIVE FACTORS</b></font>', s["label"]))
    story.append(Spacer(1, 2))
    story.append(_finding_box(a.get("negative_factors", []), num_slots=2, row_height=0.26 * inch))

    story.append(PageBreak())

    # =====================================================================
    # PAGE 5 — Repair vs Restoration vs Replacement
    # =====================================================================
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
            _text_box(" • ".join(opt.get("advantages") or []), num_rows=2, row_height=0.24 * inch),
            Spacer(1, 2),
            Paragraph('<font color="#B91C1C"><b>DISADVANTAGES</b></font>', s["label"]),
            Spacer(1, 2),
            _text_box(" • ".join(opt.get("disadvantages") or []), num_rows=2, row_height=0.24 * inch),
        ]
        story.append(KeepTogether(block))
    story.append(PageBreak())

    # =====================================================================
    # PAGE 6 — SealTech Recommendation + Expected Outcome + Conclusion
    # =====================================================================
    _section_header("SealTech Recommendation", story, s)
    rec_items = [
        ("Restoration Program",    a.get("rec_restoration_program"),    a.get("rec_restoration_program_comment", "")),
        ("Repair &amp; Monitor",   a.get("rec_repair_and_monitor"),     a.get("rec_repair_and_monitor_comment", "")),
        ("Partial Replacement",    a.get("rec_partial_replacement"),    a.get("rec_partial_replacement_comment", "")),
        ("Full Replacement",       a.get("rec_full_replacement"),       a.get("rec_full_replacement_comment", "")),
        ("Maintenance Program",    a.get("rec_maintenance_program"),    a.get("rec_maintenance_program_comment", "")),
        ("Drainage Improvements",  a.get("rec_drainage_improvements"),  a.get("rec_drainage_improvements_comment", "")),
    ]
    rec_rows = []
    for label_text, checked, comment in rec_items:
        check_cell = Paragraph(f'{_check(bool(checked))} &nbsp; <b>{label_text}</b>', s["body_sm"])
        comment_box = _text_box(comment or "", num_rows=1, row_height=0.30 * inch, width=5.2 * inch, placeholder="Comments")
        rec_rows.append([check_cell, comment_box])
    rec_t = Table(rec_rows, colWidths=[2.1 * inch, 5.2 * inch])
    rec_t.hAlign = "LEFT"
    rec_t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (0, -1), 8),
        ("LEFTPADDING", (1, 0), (1, -1), 0),
        ("RIGHTPADDING", (1, 0), (1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    story.append(rec_t)

    story.append(Spacer(1, 10))
    _section_header("Expected Outcome", story, s)
    outcomes = a.get("expected_outcomes") or []
    if outcomes:
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
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ("TEXTCOLOR", (0, 0), (-1, -1), GREEN),
        ]))
        story.append(o_t)
    else:
        story.append(Paragraph("<i>No expected outcomes recorded.</i>", s["muted"]))

    story.append(Spacer(1, 12))
    _section_header("Conclusion", story, s)
    story.append(Paragraph("Commercial roofs are valuable assets.", s["body"]))
    story.append(Spacer(1, 4))
    story.append(Paragraph(
        "The objective of this evaluation is not simply identifying deficiencies. The objective is to understand "
        "the condition, value, remaining service life, future risks, and long-term potential of the roofing asset.",
        s["body"],
    ))
    story.append(Spacer(1, 4))
    story.append(Paragraph(
        "The most informed roofing decisions begin with objective information. SealTech is happy to follow up "
        "this courtesy evaluation with a full Commercial Roof Assessment Report&trade; whenever a deeper "
        "review would be useful.",
        s["body"],
    ))

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
