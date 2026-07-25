"""Commission statement PDF — SealTech-branded, one-page itemized layout.

Renders the accruals bundled into a statement so the rep can review + sign.
Mirrors the look of the customer scope PDF (bronze accent line, blue table
header, footer with page number).

Called from `commissions.py::download_statement_pdf` and included as an
attachment when the admin mails the statement to the rep.
"""
from __future__ import annotations

import io
from datetime import datetime
from typing import Optional

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image,
)

BLUE = colors.HexColor("#1E40AF")
BRONZE = colors.HexColor("#A0703A")
DARK = colors.HexColor("#1F2937")
BORDER = colors.HexColor("#D4D4D8")
LIGHT = colors.HexColor("#FAFAFA")


def _currency(v) -> str:
    try:
        return f"${float(v or 0):,.2f}"
    except (TypeError, ValueError):
        return "$0.00"


def _fmt_date(iso: Optional[str]) -> str:
    if not iso:
        return ""
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).strftime("%b %-d, %Y")
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
        "sig":   ParagraphStyle("sig", fontName="Helvetica", fontSize=9, leading=13, textColor=DARK),
    }


def build_statement_pdf(statement: dict, rep: dict, accruals: list[dict],
                        deals_by_id: dict, invoices_by_id: dict,
                        signed_signature: Optional[dict] = None) -> bytes:
    """Render a single commission statement to PDF bytes.

    Parameters
    ----------
    statement : dict         — the `commission_statements` doc
    rep : dict                — the `users` doc for the rep
    accruals : list[dict]     — pre-fetched accrual docs bundled in this statement
    deals_by_id : dict        — {deal_id → deal doc} lookup for the "Deal" column
    invoices_by_id : dict     — {invoice_id → invoice doc} lookup for the "Invoice #" column
    signed_signature : dict?  — {text, font} or {image_bytes, content_type};
                                stamped into the sign block when present
    """
    s = _styles()
    buf = io.BytesIO()
    pdf = SimpleDocTemplate(
        buf, pagesize=letter,
        leftMargin=0.5 * inch, rightMargin=0.5 * inch,
        topMargin=0.5 * inch, bottomMargin=0.6 * inch,
        title=f"Commission Statement — {rep.get('name') or rep.get('email') or ''}",
    )
    story = []

    # --- Header ------------------------------------------------------------
    story.append(Paragraph("Commission Statement", s["title"]))
    story.append(Spacer(1, 0.02 * inch))
    story.append(Paragraph(
        f'<font color="#A0703A"><b>SealTech Building Solutions</b></font>'
        f' &nbsp;·&nbsp; Extending Roof Life Through Restorative Solutions&trade;',
        s["small"],
    ))
    story.append(Spacer(1, 0.10 * inch))

    # --- Rep + period card -------------------------------------------------
    period = f'{_fmt_date(statement.get("period_start"))} &mdash; {_fmt_date(statement.get("period_end"))}'
    rep_name = rep.get("name") or rep.get("email") or "—"
    rep_email = rep.get("email") or ""
    payroll = statement.get("payroll_type") or "1099"
    generated = _fmt_date(statement.get("generated_at"))
    kv_rows = [
        [Paragraph("Prepared For", s["kv_b"]), Paragraph(rep_name, s["kv"]),
         Paragraph("Statement Period", s["kv_b"]), Paragraph(period, s["kv"])],
        [Paragraph("Email", s["kv_b"]), Paragraph(rep_email, s["kv"]),
         Paragraph("Generated", s["kv_b"]), Paragraph(generated, s["kv"])],
        [Paragraph("Statement #", s["kv_b"]), Paragraph((statement.get("id") or "")[:8].upper(), s["kv"]),
         Paragraph("Payroll Type", s["kv_b"]), Paragraph(payroll, s["kv"])],
    ]
    kv = Table(kv_rows, colWidths=[1.1 * inch, 2.6 * inch, 1.3 * inch, 2.5 * inch])
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

    # --- Accruals table ----------------------------------------------------
    story.append(Paragraph("Earnings Detail", ParagraphStyle(
        "eh", parent=s["title"], fontSize=12, leading=15, textColor=BRONZE, spaceAfter=4,
    )))

    def _accrual_row(a):
        deal = deals_by_id.get(a.get("deal_id")) or {}
        inv = invoices_by_id.get(a.get("invoice_id")) or {}
        deal_title = deal.get("title") or (a.get("deal_id") or "")[:8]
        inv_num = inv.get("invoice_number") or (a.get("invoice_id") or "")[:8]
        kind = (a.get("kind") or "").replace("_", " ").title()
        return [
            _fmt_date(a.get("accrued_at")),
            deal_title[:32],
            inv_num,
            kind,
            _currency(a.get("payment_amount_collected")),
            _currency(a.get("profit_share")),
            f'{a.get("rate_pct_at_time") or 0:.1f}%',
            _currency(a.get("commission_amount")),
        ]

    header = ["Date", "Deal", "Invoice #", "Type", "Payment", "Profit Share", "Rate", "Commission"]
    rows = [header] + [_accrual_row(a) for a in accruals]
    if not accruals:
        rows.append(["—", "No commission earned in this period.", "", "", "", "", "", "$0.00"])
    tbl = Table(rows, colWidths=[
        0.75 * inch,  # Date
        2.10 * inch,  # Deal
        0.85 * inch,  # Invoice
        0.75 * inch,  # Type
        0.80 * inch,  # Payment
        0.85 * inch,  # Profit share
        0.45 * inch,  # Rate
        0.95 * inch,  # Commission
    ])
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), BLUE),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("ALIGN", (4, 0), (-1, -1), "RIGHT"),
        ("ALIGN", (6, 0), (6, -1), "RIGHT"),
        ("GRID", (0, 0), (-1, -1), 0.25, BORDER),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(tbl)
    story.append(Spacer(1, 0.06 * inch))

    # --- Total -------------------------------------------------------------
    total_row = Table(
        [[Paragraph("Total Commission Earned", s["kv_b"]),
          Paragraph(_currency(statement.get("total")), ParagraphStyle(
              "tot", fontName="Helvetica-Bold", fontSize=13, alignment=TA_RIGHT, textColor=BRONZE,
          ))]],
        colWidths=[5.5 * inch, 2.0 * inch],
    )
    total_row.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.75, BRONZE),
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#FDF6EC")),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    story.append(total_row)
    story.append(Spacer(1, 0.20 * inch))

    # --- Sign block --------------------------------------------------------
    story.append(Paragraph("Acknowledgment &amp; Signature", ParagraphStyle(
        "sh", parent=s["title"], fontSize=11, leading=14, textColor=BRONZE, spaceAfter=2,
    )))
    story.append(Paragraph(
        "By signing below, I confirm the earnings above are accurate for the "
        "period shown and authorize SealTech Building Solutions to release "
        "payment via the payroll or payables method associated with my "
        "account. Discrepancies must be raised in writing within 5 business "
        "days of receiving this statement.",
        s["small"],
    ))
    story.append(Spacer(1, 0.10 * inch))

    # Signature cell — stamped if present, else the "sign this" prompt
    if signed_signature:
        sig_flowables = []
        if signed_signature.get("image_bytes"):
            try:
                sig_flowables.append(Image(
                    io.BytesIO(signed_signature["image_bytes"]),
                    width=2.8 * inch, height=0.9 * inch, kind="proportional",
                ))
            except Exception:
                pass
        elif signed_signature.get("text"):
            # Typed signature — use a cursive font if the browser passed one
            font = signed_signature.get("font") or "Helvetica"
            sig_flowables.append(Paragraph(
                f'<font name="{font}" size="20">{signed_signature["text"]}</font>',
                ParagraphStyle("typed_sig", fontSize=20, leading=24, textColor=DARK),
            ))
        sig_flowables.append(Paragraph(
            f'Signed electronically  ·  {_fmt_date(signed_signature.get("signed_at"))}',
            s["small"],
        ))
        sig_cell = sig_flowables
    else:
        sig_cell = [Paragraph("<i>Signature pending — please open the sign link.</i>", s["small"])]

    sign_row = Table(
        [[sig_cell, Paragraph(f"<b>{rep_name}</b><br/>{rep_email}", s["sig"])]],
        colWidths=[4.0 * inch, 3.5 * inch],
    )
    sign_row.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.5, BORDER),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ("LINEBEFORE", (1, 0), (1, 0), 0.25, BORDER),
    ]))
    story.append(sign_row)

    pdf.build(story)
    return buf.getvalue()
