"""Period-Close PDF snapshots — simple, clean P&L + Balance Sheet renders via ReportLab.

Returns a list of {kind, display_name, description, filename, bytes} ready to drop into the Library.
"""
from io import BytesIO
from typing import List

from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle


_BLUE = colors.HexColor("#1d4ed8")
_INK = colors.HexColor("#0c0a09")
_MUTED = colors.HexColor("#71717a")
_LIGHT = colors.HexColor("#f4f4f5")
_EMERALD = colors.HexColor("#047857")
_ROSE = colors.HexColor("#be123c")


def _money(n: float) -> str:
    n = float(n or 0)
    if n < 0:
        return f"-${abs(n):,.0f}"
    return f"${n:,.0f}"


def _styles():
    base = getSampleStyleSheet()
    return {
        "h1": ParagraphStyle("h1", parent=base["Heading1"], fontName="Helvetica-Bold", fontSize=18, leading=22, textColor=_INK, spaceAfter=2),
        "h2": ParagraphStyle("h2", parent=base["Heading2"], fontName="Helvetica-Bold", fontSize=11, leading=14, textColor=_BLUE, spaceBefore=10, spaceAfter=4),
        "sub": ParagraphStyle("sub", parent=base["Normal"], fontName="Helvetica", fontSize=9, leading=11, textColor=_MUTED, spaceAfter=12),
        "body": ParagraphStyle("body", parent=base["Normal"], fontName="Helvetica", fontSize=9, leading=12, textColor=_INK),
        "footer": ParagraphStyle("footer", parent=base["Normal"], fontName="Helvetica", fontSize=7.5, leading=10, textColor=_MUTED, alignment=1),
    }


def _section_table(rows, total_label, total_amount, hide_total=False):
    """Render an accounts section as a Table."""
    data = []
    for r in rows:
        data.append([
            f"{r.get('account_number','')}  {r.get('account_name','')}",
            _money(r.get("balance", 0)),
        ])
    if not hide_total:
        data.append([total_label, _money(total_amount)])
    if not data:
        data = [["—", ""]]
    t = Table(data, colWidths=[5.0 * inch, 1.2 * inch])
    style = [
        ("FONT", (0, 0), (-1, -1), "Helvetica", 9),
        ("TEXTCOLOR", (0, 0), (-1, -1), _INK),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("ROWBACKGROUNDS", (0, 0), (-1, -2 if not hide_total else -1), [colors.white, _LIGHT]),
        ("LINEBELOW", (0, 0), (-1, -2 if not hide_total else -1), 0.25, colors.HexColor("#e4e4e7")),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]
    if not hide_total:
        style += [
            ("FONT", (0, -1), (-1, -1), "Helvetica-Bold", 9.5),
            ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#e4e4e7")),
            ("TEXTCOLOR", (0, -1), (-1, -1), _BLUE),
            ("LINEABOVE", (0, -1), (-1, -1), 0.6, _BLUE),
        ]
    t.setStyle(TableStyle(style))
    return t


def _summary_row(label, amount, *, tone=None, big=False):
    color = _INK
    bg = _LIGHT
    if tone == "blue":
        color = _BLUE; bg = colors.HexColor("#eff6ff")
    elif tone == "emerald":
        color = _EMERALD; bg = colors.HexColor("#ecfdf5")
    elif tone == "rose":
        color = _ROSE; bg = colors.HexColor("#fff1f2")
    size = 12 if big else 10
    t = Table([[label, _money(amount)]], colWidths=[5.0 * inch, 1.2 * inch])
    t.setStyle(TableStyle([
        ("FONT", (0, 0), (0, 0), "Helvetica-Bold", size),
        ("FONT", (1, 0), (1, 0), "Helvetica-Bold", size),
        ("TEXTCOLOR", (0, 0), (-1, -1), color),
        ("BACKGROUND", (0, 0), (-1, -1), bg),
        ("ALIGN", (1, 0), (1, 0), "RIGHT"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 8 if big else 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8 if big else 6),
        ("LINEABOVE", (0, 0), (-1, -1), 1.2, color),
    ]))
    return t


def _build_pl_pdf(entity: dict, period: str, pl: dict) -> bytes:
    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=letter,
        leftMargin=0.7 * inch, rightMargin=0.7 * inch, topMargin=0.7 * inch, bottomMargin=0.7 * inch,
        title=f"P&L — {entity.get('name','')} {period}",
    )
    s = _styles()
    flow = []
    flow.append(Paragraph(f"Profit &amp; Loss", s["h1"]))
    flow.append(Paragraph(
        f"<b>{entity.get('name','')}</b> · {entity.get('entity_type','')} · Period {period} ({pl.get('date_from','')} → {pl.get('date_to','')})",
        s["sub"],
    ))

    totals = pl["totals"]
    sections = pl["sections"]
    if sections.get("Revenue"):
        flow.append(Paragraph("Revenue", s["h2"]))
        flow.append(_section_table(sections["Revenue"], "Total Revenue", totals["revenue"]))
    if sections.get("COGS"):
        flow.append(Paragraph("Cost of Goods Sold", s["h2"]))
        flow.append(_section_table(sections["COGS"], "Total COGS", totals["cogs"]))
    flow.append(Spacer(1, 4))
    flow.append(_summary_row(f"Gross Profit  ·  Margin {totals['gross_margin_pct']}%", totals["gross_profit"], tone="emerald"))
    if sections.get("Expense"):
        flow.append(Paragraph("Operating Expense", s["h2"]))
        flow.append(_section_table(sections["Expense"], "Total Operating Expense", totals["operating_expense"]))
    if sections.get("Other"):
        flow.append(Paragraph("Other Income / Expense", s["h2"]))
        flow.append(_section_table(sections["Other"], "Total Other", totals["other_income_expense"]))
    flow.append(Spacer(1, 6))
    flow.append(_summary_row(f"NET INCOME  ·  Margin {totals['net_margin_pct']}%", totals["net_income"], tone="blue", big=True))
    flow.append(Spacer(1, 18))
    flow.append(Paragraph(
        "Generated by SealTech Books at month-end close. Snapshot is read-only — to restate, re-open the period from Books → Period Close.",
        s["footer"],
    ))
    doc.build(flow)
    return buf.getvalue()


def _build_bs_pdf(entity: dict, period: str, bs: dict) -> bytes:
    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=letter,
        leftMargin=0.7 * inch, rightMargin=0.7 * inch, topMargin=0.7 * inch, bottomMargin=0.7 * inch,
        title=f"Balance Sheet — {entity.get('name','')} {period}",
    )
    s = _styles()
    flow = []
    flow.append(Paragraph("Balance Sheet", s["h1"]))
    flow.append(Paragraph(
        f"<b>{entity.get('name','')}</b> · {entity.get('entity_type','')} · As of {bs.get('as_of','')}",
        s["sub"],
    ))
    totals = bs["totals"]
    sections = bs["sections"]
    flow.append(Paragraph("Assets", s["h2"]))
    flow.append(_section_table(sections.get("Asset", []), "Total Assets", totals["assets"], hide_total=True))
    flow.append(_summary_row("Total Assets", totals["assets"], tone="blue", big=True))

    flow.append(Paragraph("Liabilities", s["h2"]))
    flow.append(_section_table(sections.get("Liability", []), "Total Liabilities", totals["liabilities"], hide_total=True))

    flow.append(Paragraph("Equity", s["h2"]))
    flow.append(_section_table(sections.get("Equity", []), "Total Equity", totals["equity_accounts"], hide_total=True))
    flow.append(_summary_row("Current-period earnings", bs.get("current_earnings", 0), tone=None))
    flow.append(_summary_row("Total Equity", totals["equity_total"], tone="emerald"))

    flow.append(Spacer(1, 6))
    flow.append(_summary_row("Total Liabilities + Equity", totals["liab_plus_equity"], tone="blue", big=True))

    if not totals.get("balanced"):
        flow.append(Spacer(1, 6))
        flow.append(_summary_row(f"⚠ OUT OF BALANCE by {_money(totals['out_of_balance'])}", totals["out_of_balance"], tone="rose"))

    flow.append(Spacer(1, 18))
    flow.append(Paragraph(
        "Snapshot generated during month-end close. Stored read-only in Books → Period Close Snapshots.",
        s["footer"],
    ))
    doc.build(flow)
    return buf.getvalue()


def build_period_close_pdfs(*, entity: dict, period: str, pl: dict, bs: dict) -> List[dict]:
    """Return a list of file payloads ready for upload to the Library."""
    ent_name = entity.get("name", "Entity")
    out = []
    pl_bytes = _build_pl_pdf(entity, period, pl)
    out.append({
        "kind": "PnL",
        "display_name": f"P&L · {ent_name} · {period}",
        "description": f"Profit & Loss snapshot for {ent_name} covering {period} — auto-generated at month-end close.",
        "filename": f"PnL_{ent_name.replace(' ', '_')}_{period}.pdf",
        "bytes": pl_bytes,
    })
    bs_bytes = _build_bs_pdf(entity, period, bs)
    out.append({
        "kind": "BS",
        "display_name": f"Balance Sheet · {ent_name} · {period}",
        "description": f"Balance Sheet as of {period}-end for {ent_name} — auto-generated at month-end close.",
        "filename": f"BalanceSheet_{ent_name.replace(' ', '_')}_{period}.pdf",
        "bytes": bs_bytes,
    })
    return out
