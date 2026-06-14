"""SealTech-branded Statement of Account PDF generator.

Renders a per-customer aging statement with:
  - Customer bill-to block
  - Aging buckets (Current / 1-30 / 31-60 / 61-90 / 90+)
  - Detail table of every open invoice with days past due
  - Grand total + remit-to block

Use:
    build_statement_pdf(customer, invoices, statement_date_iso) -> bytes
"""
import os
from datetime import datetime, date
from io import BytesIO
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image

LOGO_PATH = os.path.join(os.path.dirname(__file__), "assets", "sealtech-logo.png")

BLUE = colors.HexColor("#1D4ED8")
BRONZE = colors.HexColor("#A0703A")
DARK = colors.HexColor("#0A0A0A")
GRAY = colors.HexColor("#52525B")
LIGHT = colors.HexColor("#F4F4F5")
BORDER = colors.HexColor("#E4E4E7")
RED = colors.HexColor("#B91C1C")
AMBER = colors.HexColor("#B45309")
EMERALD = colors.HexColor("#047857")


def _currency(v):
    try:
        return "${:,.2f}".format(float(v or 0))
    except Exception:
        return "$0.00"


def _parse_iso(d: str):
    """Parse an ISO yyyy-mm-dd date; return None on failure."""
    if not d:
        return None
    try:
        return datetime.strptime(d[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def _styles():
    return {
        "eyebrow": ParagraphStyle("eyebrow", fontName="Helvetica-Bold", fontSize=8, textColor=BRONZE, leading=10, spaceAfter=2),
        "h1": ParagraphStyle("h1", fontName="Helvetica-Bold", fontSize=24, textColor=DARK, leading=28, spaceAfter=4),
        "h2": ParagraphStyle("h2", fontName="Helvetica-Bold", fontSize=10, textColor=BLUE, leading=13, spaceBefore=6, spaceAfter=3),
        "label": ParagraphStyle("label", fontName="Helvetica-Bold", fontSize=8, textColor=BLUE, leading=10),
        "body": ParagraphStyle("body", fontName="Helvetica", fontSize=10, textColor=DARK, leading=13),
        "body_sm": ParagraphStyle("body_sm", fontName="Helvetica", fontSize=9, textColor=DARK, leading=12),
        "muted": ParagraphStyle("muted", fontName="Helvetica", fontSize=8, textColor=GRAY, leading=10),
        "bucket_label": ParagraphStyle("bucket_label", fontName="Helvetica-Bold", fontSize=8, textColor=GRAY, leading=10, alignment=1),
        "bucket_value": ParagraphStyle("bucket_value", fontName="Helvetica-Bold", fontSize=13, textColor=DARK, leading=16, alignment=1),
        "bucket_value_warn": ParagraphStyle("bucket_value_warn", fontName="Helvetica-Bold", fontSize=13, textColor=AMBER, leading=16, alignment=1),
        "bucket_value_bad": ParagraphStyle("bucket_value_bad", fontName="Helvetica-Bold", fontSize=13, textColor=RED, leading=16, alignment=1),
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


def compute_aging(invoices: list, as_of: date, rate: float = 0.015) -> dict:
    """Bucket each open invoice's balance_due into aging windows, plus per-bucket late fees.
    Late fee policy: `rate` per month (compounding) on balances 30+ days past due. `rate` is a
    DECIMAL (e.g. 0.015 for 1.5%) — callers should pass the resolved per-customer/per-entity rate.
    Returns a dict with buckets, total balance, total late fees, and grand total.
    `as_of` is the statement date.
    """
    buckets = {"current": 0.0, "d_1_30": 0.0, "d_31_60": 0.0, "d_61_90": 0.0, "d_90_plus": 0.0}
    total = 0.0
    late_fees = 0.0
    for inv in invoices:
        bal = float(inv.get("balance_due") or 0)
        if bal <= 0.01:
            continue
        total += bal
        due = _parse_iso(inv.get("due_date") or "") or _parse_iso(inv.get("invoice_date") or "")
        if not due:
            buckets["current"] += bal
            continue
        days_past = (as_of - due).days
        if days_past <= 0:
            buckets["current"] += bal
        elif days_past <= 30:
            buckets["d_1_30"] += bal
        elif days_past <= 60:
            buckets["d_31_60"] += bal
        elif days_past <= 90:
            buckets["d_61_90"] += bal
        else:
            buckets["d_90_plus"] += bal
        # Late fee accrues once past 30 days; `rate` per (whole) month overdue
        if days_past >= 30:
            months = days_past // 30
            late_fees += round(bal * rate * months, 2)
    return {
        **buckets,
        "total": round(total, 2),
        "late_fees": round(late_fees, 2),
        "total_due_with_fees": round(total + late_fees, 2),
        "rate_pct": round(rate * 100.0, 4),
    }


def compute_invoice_late_fee(inv: dict, as_of: date, rate: float = 0.015) -> float:
    """Per-invoice late fee — same rule as compute_aging applies on this single row.
    `rate` is a DECIMAL (e.g. 0.015 for 1.5%)."""
    bal = float(inv.get("balance_due") or 0)
    if bal <= 0.01:
        return 0.0
    due = _parse_iso(inv.get("due_date") or "") or _parse_iso(inv.get("invoice_date") or "")
    if not due:
        return 0.0
    days_past = (as_of - due).days
    if days_past < 30:
        return 0.0
    months = days_past // 30
    return round(bal * rate * months, 2)


def build_statement_pdf(customer: dict, invoices: list, statement_date_iso: str, rate: float = 0.015) -> bytes:
    """customer: contact dict (uses billing_* or address_* fields).
    invoices: list of invoice dicts (already filtered to open balances for this customer).
    statement_date_iso: yyyy-mm-dd string for 'as of' date.
    rate: monthly late-fee rate as a DECIMAL (e.g. 0.015 == 1.5%). Caller resolves per
          customer/entity using gl.resolve_late_fee_rate.
    """
    buf = BytesIO()
    pdf = SimpleDocTemplate(
        buf, pagesize=letter,
        leftMargin=0.5 * inch, rightMargin=0.5 * inch,
        topMargin=0.5 * inch, bottomMargin=0.8 * inch,
        title=f"Statement of Account — {customer.get('company_name') or customer.get('contact_name') or 'Customer'}",
    )
    s = _styles()
    story = []
    as_of = _parse_iso(statement_date_iso) or date.today()
    as_of_pretty = as_of.strftime("%B %d, %Y")

    # ---- Header: logo left, "STATEMENT OF ACCOUNT" right ----
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

    header_right = [
        Paragraph("RECEIVABLES", s["eyebrow"]),
        Paragraph("STATEMENT OF ACCOUNT", s["h1"]),
        Paragraph(f"As of <b>{as_of_pretty}</b>", s["body_sm"]),
    ]
    head_table = Table([[header_left, header_right]], colWidths=[3.5 * inch, 4.0 * inch])
    head_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ALIGN", (1, 0), (1, 0), "RIGHT"),
    ]))
    story.append(head_table)
    story.append(Spacer(1, 0.2 * inch))

    # ---- Bill-To + Remit blocks side-by-side ----
    same = customer.get("billing_same_as_address", True)
    if same:
        addr_lines = [
            customer.get("address", ""),
            customer.get("address_line2", ""),
            ", ".join([p for p in [customer.get("city", ""), customer.get("state", "")] if p]) + (f"  {customer.get('zip_code', '')}" if customer.get("zip_code") else ""),
        ]
    else:
        addr_lines = [
            customer.get("billing_address", ""),
            customer.get("billing_address_line2", ""),
            ", ".join([p for p in [customer.get("billing_city", ""), customer.get("billing_state", "")] if p]) + (f"  {customer.get('billing_zip', '')}" if customer.get("billing_zip") else ""),
        ]
    addr_lines = [a for a in (line.strip() for line in addr_lines) if a]

    bill_to_lines = ["<b>BILL TO</b>"]
    if customer.get("company_name"):
        bill_to_lines.append(f"<b>{customer['company_name']}</b>")
    if customer.get("contact_name"):
        bill_to_lines.append(customer["contact_name"])
    bill_to_lines.extend(addr_lines)
    if customer.get("email"):
        bill_to_lines.append(f'<font color="#52525B">{customer["email"]}</font>')

    remit_lines = [
        "<b>REMIT TO</b>",
        "<b>SealTech Building Solutions</b>",
        "2278 Mannatt Ct",
        "Castle Rock, CO 80104",
        '<font color="#52525B">info@sealtechbuildingsolutions.com</font>',
        '<font color="#52525B">720-715-9955</font>',
    ]

    addr_block = Table(
        [[Paragraph("<br/>".join(bill_to_lines), s["body_sm"]),
          Paragraph("<br/>".join(remit_lines), s["body_sm"])]],
        colWidths=[3.75 * inch, 3.75 * inch],
    )
    addr_block.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BACKGROUND", (0, 0), (0, 0), LIGHT),
        ("BACKGROUND", (1, 0), (1, 0), LIGHT),
        ("BOX", (0, 0), (0, 0), 0.5, BORDER),
        ("BOX", (1, 0), (1, 0), 0.5, BORDER),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
    ]))
    story.append(addr_block)
    story.append(Spacer(1, 0.2 * inch))

    # ---- Aging summary cards ----
    aging = compute_aging(invoices, as_of, rate=rate)
    rate_pct_str = (f"{rate * 100:.2f}").rstrip("0").rstrip(".")
    bucket_defs = [
        ("Current", aging["current"], s["bucket_value"]),
        ("1-30 Days", aging["d_1_30"], s["bucket_value_warn"] if aging["d_1_30"] > 0.01 else s["bucket_value"]),
        ("31-60 Days", aging["d_31_60"], s["bucket_value_warn"] if aging["d_31_60"] > 0.01 else s["bucket_value"]),
        ("61-90 Days", aging["d_61_90"], s["bucket_value_bad"] if aging["d_61_90"] > 0.01 else s["bucket_value"]),
        ("Over 90 Days", aging["d_90_plus"], s["bucket_value_bad"] if aging["d_90_plus"] > 0.01 else s["bucket_value"]),
    ]
    bucket_rows = [
        [Paragraph(lbl.upper(), s["bucket_label"]) for lbl, _, _ in bucket_defs],
        [Paragraph(_currency(amt), st) for _, amt, st in bucket_defs],
    ]
    col_w = 7.5 * inch / 5
    aging_table = Table(bucket_rows, colWidths=[col_w] * 5, rowHeights=[0.3 * inch, 0.45 * inch])
    aging_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("BACKGROUND", (0, 0), (-1, 0), LIGHT),
        ("GRID", (0, 0), (-1, -1), 0.5, BORDER),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(Paragraph("AGING SUMMARY", s["label"]))
    story.append(Spacer(1, 0.05 * inch))
    story.append(aging_table)
    story.append(Spacer(1, 0.18 * inch))

    # ---- Invoice detail table ----
    # Sort by oldest due date first (so the most overdue invoices appear at the top)
    def _sort_key(inv):
        d = _parse_iso(inv.get("due_date") or "") or _parse_iso(inv.get("invoice_date") or "") or date.max
        return d

    rows_sorted = sorted(invoices, key=_sort_key)

    detail_header = [
        Paragraph("<b>Invoice #</b>", s["body_sm"]),
        Paragraph("<b>Invoice Date</b>", s["body_sm"]),
        Paragraph("<b>Due Date</b>", s["body_sm"]),
        Paragraph("<b>Project</b>", s["body_sm"]),
        Paragraph("<b>Total</b>", s["body_sm"]),
        Paragraph("<b>Paid</b>", s["body_sm"]),
        Paragraph("<b>Balance</b>", s["body_sm"]),
        Paragraph("<b>Days Past</b>", s["body_sm"]),
        Paragraph("<b>Late Fee</b>", s["body_sm"]),
    ]
    table_data = [detail_header]
    grand_balance = 0.0
    grand_late_fee = 0.0
    for inv in rows_sorted:
        bal = float(inv.get("balance_due") or 0)
        if bal <= 0.01:
            continue
        due = _parse_iso(inv.get("due_date") or "")
        days_past = (as_of - due).days if due else 0
        days_past_str = "—" if days_past <= 0 else str(days_past)
        days_style = s["body_sm"]
        if days_past > 60:
            days_past_str = f'<font color="#B91C1C"><b>{days_past_str}</b></font>'
        elif days_past > 0:
            days_past_str = f'<font color="#B45309"><b>{days_past_str}</b></font>'

        proj = inv.get("project_title") or "—"
        if len(proj) > 24:
            proj = proj[:22] + "…"

        late_fee = compute_invoice_late_fee(inv, as_of, rate=rate)
        grand_late_fee += late_fee
        late_fee_str = _currency(late_fee) if late_fee > 0 else "—"
        if late_fee > 0:
            late_fee_str = f'<font color="#B91C1C"><b>{late_fee_str}</b></font>'

        table_data.append([
            Paragraph(inv.get("invoice_number") or "—", s["body_sm"]),
            Paragraph(inv.get("invoice_date") or "—", s["body_sm"]),
            Paragraph(inv.get("due_date") or "—", s["body_sm"]),
            Paragraph(proj, s["body_sm"]),
            Paragraph(_currency(inv.get("total")), s["body_sm"]),
            Paragraph(_currency(inv.get("amount_paid")), s["body_sm"]),
            Paragraph(f"<b>{_currency(bal)}</b>", s["body_sm"]),
            Paragraph(days_past_str, days_style),
            Paragraph(late_fee_str, s["body_sm"]),
        ])
        grand_balance += bal

    if len(table_data) == 1:
        # No open invoices — friendly note
        story.append(Paragraph("INVOICE DETAIL", s["label"]))
        story.append(Spacer(1, 0.05 * inch))
        story.append(Paragraph(
            '<font color="#047857"><b>Account is current — no open invoices as of this statement date.</b></font>',
            s["body"],
        ))
    else:
        grand_total_with_fees = grand_balance + grand_late_fee
        # Total row(s): show balance, late fee subtotal (if any), and grand total
        if grand_late_fee > 0.01:
            # Subtotal row (just the balance)
            table_data.append([
                "", "", "", Paragraph("<b>Subtotal — Open Balance</b>", s["body_sm"]),
                "", "",
                Paragraph(f'<b>{_currency(grand_balance)}</b>', s["body_sm"]),
                "", "",
            ])
            # Late fee row
            table_data.append([
                "", "", "", Paragraph(f'<b>Late Fees ({rate_pct_str}% / month on 30+ days past due)</b>', s["body_sm"]),
                "", "", "", "",
                Paragraph(f'<b><font color="#B91C1C">{_currency(grand_late_fee)}</font></b>', s["body_sm"]),
            ])
            # Grand total row
            table_data.append([
                "", "", "", Paragraph("<b>TOTAL DUE (incl. Late Fees)</b>", s["body_sm"]),
                "", "",
                Paragraph(f'<b><font color="#1D4ED8">{_currency(grand_total_with_fees)}</font></b>', s["body"]),
                "", "",
            ])
            total_rows_count = 3
        else:
            table_data.append([
                "", "", "", Paragraph("<b>TOTAL BALANCE DUE</b>", s["body_sm"]),
                "", "",
                Paragraph(f'<b><font color="#1D4ED8">{_currency(grand_balance)}</font></b>', s["body"]),
                "", "",
            ])
            total_rows_count = 1
        detail_table = Table(
            table_data,
            colWidths=[0.85 * inch, 0.75 * inch, 0.75 * inch, 1.55 * inch, 0.75 * inch, 0.7 * inch, 0.85 * inch, 0.55 * inch, 0.75 * inch],
        )
        last_idx = len(table_data) - 1
        first_total_idx = last_idx - total_rows_count + 1
        detail_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), BLUE),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("ALIGN", (4, 0), (-1, -1), "RIGHT"),
            ("ALIGN", (7, 0), (7, -1), "CENTER"),
            ("GRID", (0, 0), (-1, -1), 0.25, BORDER),
            ("ROWBACKGROUNDS", (0, 1), (-1, first_total_idx - 1), [colors.white, LIGHT]),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            # Total-section styling
            ("BACKGROUND", (0, first_total_idx), (-1, -1), LIGHT),
            ("LINEABOVE", (0, first_total_idx), (-1, first_total_idx), 1.0, DARK),
            ("FONTNAME", (0, first_total_idx), (-1, -1), "Helvetica-Bold"),
            ("LINEABOVE", (0, last_idx), (-1, last_idx), 0.75, DARK),
        ]))
        story.append(Paragraph("INVOICE DETAIL", s["label"]))
        story.append(Spacer(1, 0.05 * inch))
        story.append(detail_table)

    story.append(Spacer(1, 0.2 * inch))

    # ---- Footer note ----
    final_due = grand_balance + grand_late_fee
    if grand_balance > 0.01:
        msg = (
            f'<b>Please remit payment of <font color="#1D4ED8">{_currency(final_due)}</font> at your earliest convenience.</b>  '
            "If you have questions about any line above, or if any of these invoices have already been paid, please reply to this email "
            "or call us at 720-715-9955 so we can reconcile your account."
        )
        story.append(Paragraph(msg, s["body_sm"]))
        story.append(Spacer(1, 0.08 * inch))
    story.append(Paragraph(
        f'<font color="#52525B"><b>Late Fee Policy:</b> A late fee of {rate_pct_str}% per month is applied to any balance more than 30 days past due. '
        "Fees compound monthly and are reflected on each Statement of Account.</font>",
        s["muted"],
    ))
    story.append(Spacer(1, 0.06 * inch))
    story.append(Paragraph(
        '<i>Thank you for your continued business with SealTech Building Solutions.</i>',
        s["body_sm"],
    ))

    pdf.build(story, onFirstPage=_footer, onLaterPages=_footer)
    return buf.getvalue()
