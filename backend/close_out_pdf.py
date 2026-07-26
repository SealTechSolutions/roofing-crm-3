"""Project Close-Out Summary PDF.

Generated when a rep finalizes a deal's 20-item close-out checklist. Bundled
into the deal's document library so the project has a permanent artifact of:
  1. Which of the 16 required + 4 optional items were completed (with dates,
     notes, and who checked them off)
  2. A final P&L snapshot at close (revenue / cost / margin / variance vs
     the estimate the deal was priced against)
  3. Any file attachments that were dropped onto checklist items

Called from `server.py::finalize_close_out`. Follows the same visual language
as `commission_statement_pdf.py` (SealTech blue + bronze accents).
"""
from __future__ import annotations

import io
from datetime import datetime
from typing import Optional

from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak,
)

BLUE = colors.HexColor("#1E40AF")
BRONZE = colors.HexColor("#A0703A")
DARK = colors.HexColor("#1F2937")
BORDER = colors.HexColor("#D4D4D8")
LIGHT = colors.HexColor("#FAFAFA")
EMERALD = colors.HexColor("#047857")
RED = colors.HexColor("#B91C1C")
AMBER = colors.HexColor("#B45309")


def _currency(v) -> str:
    try:
        return f"${float(v or 0):,.2f}"
    except (TypeError, ValueError):
        return "$0.00"


def _fmt_date(iso: Optional[str]) -> str:
    if not iso:
        return "—"
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).strftime("%b %d, %Y")
    except Exception:
        return (iso or "")[:10]


def _styles():
    return {
        "title": ParagraphStyle("t", fontName="Helvetica-Bold", fontSize=20, leading=24, textColor=DARK),
        "sub":   ParagraphStyle("s", fontName="Helvetica", fontSize=10, leading=13, textColor=DARK),
        "kv":    ParagraphStyle("kv", fontName="Helvetica", fontSize=9, leading=12, textColor=DARK),
        "kv_b":  ParagraphStyle("kvb", fontName="Helvetica-Bold", fontSize=9, leading=12, textColor=DARK),
        "body":  ParagraphStyle("b", fontName="Helvetica", fontSize=9, leading=12, textColor=DARK),
        "small": ParagraphStyle("sm", fontName="Helvetica", fontSize=8, leading=10, textColor=colors.HexColor("#52525B")),
        "sh":    ParagraphStyle("sh", fontName="Helvetica-Bold", fontSize=12, leading=15, textColor=BRONZE, spaceAfter=4),
    }


def build_close_out_pdf(
    deal: dict,
    items_config: list[dict],
    pnl_summary: dict,
    closed_by_name: str = "",
    contact_name: str = "",
) -> bytes:
    """Render the close-out summary PDF.

    Parameters
    ----------
    deal : dict            — the deal doc after finalize (has `closed_out_at`,
                             `close_out_checklist`)
    items_config : list    — the canonical CLOSE_OUT_ITEMS list projected as
                             {key, section, label, required}
    pnl_summary : dict     — {revenue, estimated_cost, actual_cost, gross_profit,
                              gross_margin_pct, variance_pct}
    closed_by_name : str   — display name of the user who clicked Finalize
    contact_name : str     — customer contact name for the "Prepared For" box
    """
    s = _styles()
    buf = io.BytesIO()
    pdf = SimpleDocTemplate(
        buf, pagesize=letter,
        leftMargin=0.5 * inch, rightMargin=0.5 * inch,
        topMargin=0.5 * inch, bottomMargin=0.6 * inch,
        title=f"Close-Out Summary — {deal.get('title') or 'Deal'}",
    )
    story = []

    # --- Header ------------------------------------------------------------
    story.append(Paragraph("Project Close-Out Summary", s["title"]))
    story.append(Spacer(1, 0.02 * inch))
    story.append(Paragraph(
        f'<font color="#A0703A"><b>SealTech Building Solutions</b></font>'
        f' &nbsp;·&nbsp; Extending Roof Life Through Restorative Solutions&trade;',
        s["small"],
    ))
    story.append(Spacer(1, 0.10 * inch))

    # --- Project card ------------------------------------------------------
    addr = deal.get("property_address") or ""
    city = deal.get("property_city") or ""
    full_addr = f"{addr}, {city}" if city else addr
    kv_rows = [
        [Paragraph("Project", s["kv_b"]), Paragraph(deal.get("title") or "—", s["kv"]),
         Paragraph("Customer", s["kv_b"]), Paragraph(contact_name or "—", s["kv"])],
        [Paragraph("Address", s["kv_b"]), Paragraph(full_addr or "—", s["kv"]),
         Paragraph("Contract", s["kv_b"]), Paragraph(_currency(deal.get("chosen_amount")), s["kv"])],
        [Paragraph("Closed On", s["kv_b"]), Paragraph(_fmt_date(deal.get("closed_out_at")), s["kv"]),
         Paragraph("Closed By", s["kv_b"]), Paragraph(closed_by_name or "—", s["kv"])],
    ]
    kv = Table(kv_rows, colWidths=[0.9 * inch, 3.0 * inch, 0.9 * inch, 2.7 * inch])
    kv.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BACKGROUND", (0, 0), (-1, -1), LIGHT),
        ("BOX", (0, 0), (-1, -1), 0.5, BORDER),
        ("INNERGRID", (0, 0), (-1, -1), 0.25, BORDER),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    story.append(kv)
    story.append(Spacer(1, 0.14 * inch))

    # --- Final P&L snapshot ------------------------------------------------
    story.append(Paragraph("Final P&amp;L Snapshot", s["sh"]))
    revenue = float(pnl_summary.get("revenue") or 0)
    est_cost = float(pnl_summary.get("estimated_cost") or 0)
    act_cost = float(pnl_summary.get("actual_cost") or 0)
    profit = float(pnl_summary.get("gross_profit") or 0)
    margin = float(pnl_summary.get("gross_margin_pct") or 0)
    variance = float(pnl_summary.get("variance_pct") or 0)
    profit_color = EMERALD if profit >= 0 else RED
    variance_color = EMERALD if abs(variance) <= 5 else (AMBER if abs(variance) <= 15 else RED)

    pnl_rows = [
        ["Contract Revenue", _currency(revenue)],
        ["Estimated Cost",   _currency(est_cost)],
        ["Actual Cost (vendor bills)", _currency(act_cost)],
        ["Gross Profit",     _currency(profit)],
        ["Gross Margin",     f"{margin:.1f}%"],
        ["Est → Actual Variance", f"{variance:+.1f}%"],
    ]
    pnl_tbl = Table(pnl_rows, colWidths=[3.5 * inch, 4.0 * inch])
    pnl_tbl.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("FONTNAME", (1, 0), (1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("TEXTCOLOR", (1, 3), (1, 3), profit_color),
        ("TEXTCOLOR", (1, 5), (1, 5), variance_color),
        ("BOX", (0, 0), (-1, -1), 0.5, BORDER),
        ("INNERGRID", (0, 0), (-1, -1), 0.25, BORDER),
        ("BACKGROUND", (0, 0), (-1, -1), LIGHT),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    story.append(pnl_tbl)
    story.append(Spacer(1, 0.18 * inch))

    # --- Checklist detail --------------------------------------------------
    story.append(Paragraph("Close-Out Checklist Detail", s["sh"]))
    checklist = deal.get("close_out_checklist") or {}

    header = ["#", "Item", "Status", "Date", "Note"]
    rows = [header]
    for i, it in enumerate(items_config, start=1):
        state = checklist.get(it["key"]) or {}
        done = bool(state.get("done"))
        req = bool(it.get("required"))
        label = it["label"] + (" *" if req else " (opt)")
        if done:
            status = "Complete"
        elif req:
            status = "MISSED"
        else:
            status = "Skipped"
        note = (state.get("note") or "")[:60]
        rows.append([
            str(i), label[:56], status, _fmt_date(state.get("date")), note,
        ])

    tbl = Table(rows, colWidths=[0.30 * inch, 3.60 * inch, 0.85 * inch, 0.90 * inch, 1.85 * inch])
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), BLUE),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("GRID", (0, 0), (-1, -1), 0.25, BORDER),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]
    # Color the status column per row
    for idx, it in enumerate(items_config, start=1):
        state = checklist.get(it["key"]) or {}
        done = bool(state.get("done"))
        req = bool(it.get("required"))
        if done:
            style.append(("TEXTCOLOR", (2, idx), (2, idx), EMERALD))
        elif req:
            style.append(("TEXTCOLOR", (2, idx), (2, idx), RED))
            style.append(("FONTNAME", (2, idx), (2, idx), "Helvetica-Bold"))
        else:
            style.append(("TEXTCOLOR", (2, idx), (2, idx), colors.HexColor("#71717A")))
    tbl.setStyle(TableStyle(style))
    story.append(tbl)
    story.append(Spacer(1, 0.15 * inch))

    # --- Footer ------------------------------------------------------------
    story.append(Paragraph(
        "This document is auto-generated as part of the SealTech project close-out "
        "workflow. Retain with the project file for warranty and audit purposes.",
        s["small"],
    ))

    pdf.build(story)
    return buf.getvalue()
