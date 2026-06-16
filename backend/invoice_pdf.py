"""SealTech-branded Invoice PDF generator."""
import os
from io import BytesIO
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image, KeepTogether

LOGO_PATH = os.path.join(os.path.dirname(__file__), "assets", "sealtech-logo.png")

BLUE = colors.HexColor("#062B67")
BRONZE = colors.HexColor("#A0703A")
DARK = colors.HexColor("#0A0A0A")
GRAY = colors.HexColor("#52525B")
LIGHT = colors.HexColor("#F4F4F5")
BORDER = colors.HexColor("#E4E4E7")

REMIT_BLOCK = (
    "<b>Make checks payable to:</b> SealTech Building Solutions<br/>"
    "<b>Mail to:</b> 2278 Mannatt Ct, Castle Rock, CO 80104<br/>"
    "<b>ACH / Online Pay:</b> Contact SealTech for details"
)


def _currency(v):
    try:
        return "${:,.2f}".format(float(v or 0))
    except Exception:
        return "$0.00"


def _styles():
    return {
        "eyebrow": ParagraphStyle("eyebrow", fontName="Helvetica-Bold", fontSize=8, textColor=BRONZE, leading=10, spaceAfter=2),
        "h1": ParagraphStyle("h1", fontName="Helvetica-Bold", fontSize=28, textColor=DARK, leading=32, spaceAfter=4),
        "h2": ParagraphStyle("h2", fontName="Helvetica-Bold", fontSize=11, textColor=BLUE, leading=14, spaceBefore=8, spaceAfter=4),
        "label": ParagraphStyle("label", fontName="Helvetica-Bold", fontSize=8, textColor=BLUE, leading=10, letterSpacing=1),
        "body": ParagraphStyle("body", fontName="Helvetica", fontSize=10, textColor=DARK, leading=13),
        "body_sm": ParagraphStyle("body_sm", fontName="Helvetica", fontSize=9, textColor=DARK, leading=12),
        "muted": ParagraphStyle("muted", fontName="Helvetica", fontSize=8, textColor=GRAY, leading=10),
        "big_num": ParagraphStyle("big_num", fontName="Helvetica-Bold", fontSize=22, textColor=BLUE, leading=26, alignment=2),
    }


def _footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(BORDER)
    canvas.setLineWidth(0.5)
    canvas.line(0.5 * inch, 0.6 * inch, 8.0 * inch, 0.6 * inch)
    canvas.setFont("Helvetica", 7)
    canvas.setFillColor(GRAY)
    canvas.drawString(0.5 * inch, 0.45 * inch, "SealTech Building Solutions  -  720-715-9955  -  info@sealtechbuildingsolutions.com  -  www.sealtechbuildingsolutions.com")
    canvas.drawRightString(8.0 * inch, 0.45 * inch, f"{doc.page} | Page")
    canvas.restoreState()


def build_invoice_pdf(inv: dict, late_fee_rate_pct: float = 1.5) -> bytes:
    buf = BytesIO()
    pdf = SimpleDocTemplate(
        buf, pagesize=letter,
        leftMargin=0.5 * inch, rightMargin=0.5 * inch,
        topMargin=0.5 * inch, bottomMargin=0.8 * inch,
        title=f"Invoice {inv.get('invoice_number', '')}",
    )
    s = _styles()
    story = []
    rate_pct_str = (f"{late_fee_rate_pct:.2f}").rstrip("0").rstrip(".")

    # Header: logo on left, INVOICE + number on right
    header_left = []
    if os.path.exists(LOGO_PATH):
        try:
            logo = Image(LOGO_PATH, width=2.4 * inch, height=0.92 * inch, kind="proportional")
            logo.hAlign = "LEFT"
            header_left.append(logo)
        except Exception:
            header_left.append(Paragraph("SEALTECH  ·  BUILDING SOLUTIONS", s["eyebrow"]))
    else:
        header_left.append(Paragraph("SEALTECH  ·  BUILDING SOLUTIONS", s["eyebrow"]))

    title_label = "INVOICE"
    if inv.get("invoice_type"):
        title_label = f"{inv['invoice_type'].upper()} INVOICE"
    header_right = [
        Paragraph(title_label, s["h1"]),
        Paragraph(f"<font color='#52525B'>{inv.get('invoice_number', '—')}</font>", s["body"]),
    ]

    hdr = Table([[header_left, header_right]], colWidths=[4.0 * inch, 3.5 * inch])
    hdr.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ALIGN", (1, 0), (1, 0), "RIGHT"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    story.append(hdr)
    story.append(Spacer(1, 0.25 * inch))

    # Meta strip: invoice date / due date / terms / status
    status_color = {
        "Draft": GRAY,
        "Sent": BLUE,
        "Paid": colors.HexColor("#047857"),
        "Partial": BRONZE,
        "Overdue": colors.HexColor("#B91C1C"),
        "Void": GRAY,
    }.get(inv.get("status", "Draft"), GRAY)

    meta = [
        [
            Paragraph("INVOICE DATE", s["label"]),
            Paragraph("DUE DATE", s["label"]),
            Paragraph("TERMS", s["label"]),
            Paragraph("STATUS", s["label"]),
        ],
        [
            Paragraph(inv.get("invoice_date", "—") or "—", s["body"]),
            Paragraph(inv.get("due_date", "—") or "—", s["body"]),
            Paragraph(inv.get("terms", "Due Upon Receipt") or "Due Upon Receipt", s["body"]),
            Paragraph(f"<font color='{status_color.hexval()}'><b>{inv.get('status', 'Draft').upper()}</b></font>", s["body"]),
        ],
    ]
    mt = Table(meta, colWidths=[1.6 * inch, 1.6 * inch, 2.6 * inch, 1.7 * inch])
    mt.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), LIGHT),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("LINEABOVE", (0, 0), (-1, 0), 0.5, BORDER),
        ("LINEBELOW", (0, 1), (-1, 1), 0.5, BORDER),
    ]))
    story.append(mt)
    story.append(Spacer(1, 0.2 * inch))

    # Bill To + From blocks side by side
    bill_to_lines = []
    if inv.get("bill_to_company"):
        bill_to_lines.append(f"<b>{inv['bill_to_company']}</b>")
    if inv.get("bill_to_name"):
        bill_to_lines.append(inv["bill_to_name"])
    addr_line = " ".join([p for p in [inv.get("bill_to_address", ""), inv.get("bill_to_address_line2", "")] if p]).strip()
    if addr_line:
        bill_to_lines.append(addr_line)
    city_state = ", ".join([p for p in [inv.get("bill_to_city", ""), inv.get("bill_to_state", "")] if p])
    if inv.get("bill_to_zip"):
        city_state = f"{city_state} {inv['bill_to_zip']}".strip()
    if city_state:
        bill_to_lines.append(city_state)
    if inv.get("bill_to_email"):
        bill_to_lines.append(f"<font color='#52525B'>{inv['bill_to_email']}</font>")
    bill_to_html = "<br/>".join(bill_to_lines) if bill_to_lines else "—"

    from_html = (
        "<b>SealTech Building Solutions</b><br/>"
        "2278 Mannatt Ct<br/>"
        "Castle Rock, CO 80104<br/>"
        "<font color='#52525B'>720-715-9955  ·  info@sealtechbuildingsolutions.com</font>"
    )

    addr_table = Table([
        [Paragraph("BILL TO", s["label"]), Paragraph("FROM", s["label"])],
        [Paragraph(bill_to_html, s["body"]), Paragraph(from_html, s["body"])],
    ], colWidths=[3.75 * inch, 3.75 * inch])
    addr_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 6),
        ("TOPPADDING", (0, 1), (-1, 1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    story.append(addr_table)
    story.append(Spacer(1, 0.2 * inch))

    # Project info block
    if inv.get("project_title") or inv.get("project_address") or float(inv.get("project_total") or 0) > 0:
        proj_rows = []
        if inv.get("project_title"):
            proj_rows.append(["PROJECT", inv["project_title"]])
        if inv.get("project_address"):
            proj_rows.append(["LOCATION", inv["project_address"]])
        if float(inv.get("project_total") or 0) > 0:
            proj_rows.append(["PROJECT TOTAL", _currency(inv["project_total"])])
        if proj_rows:
            pt = Table(proj_rows, colWidths=[1.2 * inch, 6.3 * inch])
            pt.setStyle(TableStyle([
                ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("TEXTCOLOR", (0, 0), (0, -1), BLUE),
                ("TEXTCOLOR", (1, 0), (1, -1), DARK),
                ("LINEBELOW", (0, 0), (-1, -1), 0.25, BORDER),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
            ]))
            story.append(pt)
            story.append(Spacer(1, 0.15 * inch))

    # Line items
    li_header = ["Description", "Qty", "Unit Price", "Amount"]
    li_rows = [li_header]
    for it in (inv.get("line_items") or []):
        li_rows.append([
            Paragraph(it.get("description", "—") or "—", s["body_sm"]),
            f"{float(it.get('quantity') or 0):g}",
            _currency(it.get("unit_price")),
            _currency(it.get("amount")),
        ])
    if len(li_rows) == 1:
        li_rows.append([Paragraph("<i>No line items yet.</i>", s["muted"]), "", "", ""])

    lt = Table(li_rows, colWidths=[4.6 * inch, 0.7 * inch, 1.1 * inch, 1.1 * inch], repeatRows=1)
    lt.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), BLUE),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 9),
        ("FONTSIZE", (0, 1), (-1, -1), 9),
        ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
        ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
        ("GRID", (0, 0), (-1, -1), 0.25, BORDER),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    story.append(lt)
    story.append(Spacer(1, 0.1 * inch))

    # Totals block (right-aligned)
    paid = float(inv.get("amount_paid") or 0)
    balance = float(inv.get("balance_due") or 0)
    totals = [
        ["Subtotal", _currency(inv.get("subtotal"))],
        ["Total", _currency(inv.get("total"))],
    ]
    if paid > 0:
        totals.append(["Amount Paid", "-" + _currency(paid)])
    totals.append(["Balance Due", _currency(balance)])
    tt = Table(totals, colWidths=[4.4 * inch, 3.1 * inch])
    tt.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("ALIGN", (0, 0), (-1, -1), "RIGHT"),
        ("FONTNAME", (0, 0), (-1, -2), "Helvetica"),
        ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, -1), (-1, -1), 13),
        ("TEXTCOLOR", (0, -1), (-1, -1), BLUE),
        ("LINEABOVE", (0, -1), (-1, -1), 1.5, BLUE),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(tt)
    story.append(Spacer(1, 0.25 * inch))

    # Notes
    if inv.get("notes"):
        story.append(KeepTogether([
            Paragraph("NOTES", s["label"]),
            Paragraph(inv["notes"].replace("\n", "<br/>"), s["body_sm"]),
            Spacer(1, 0.15 * inch),
        ]))

    # Remit / Payment instructions
    story.append(KeepTogether([
        Paragraph("REMITTANCE INSTRUCTIONS", s["label"]),
        Paragraph(REMIT_BLOCK, s["body_sm"]),
        Spacer(1, 0.08 * inch),
        Paragraph(
            '<font color="#B45309"><b>LATE FEE POLICY:</b></font> '
            f'<font color="#52525B">A late fee of <b>{rate_pct_str}% per month</b> is applied to any balance more than '
            "30 days past due. Fees compound monthly and are reflected on each Statement of Account.</font>",
            s["body_sm"],
        ),
    ]))

    pdf.build(story, onFirstPage=_footer, onLaterPages=_footer)
    return buf.getvalue()
