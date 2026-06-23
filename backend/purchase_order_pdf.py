"""SealTech-branded Purchase Order / Material Take-Off PDF generator.

No prices are shown — this is a fulfillment request to the supplier.
"""
import os
from io import BytesIO
from datetime import datetime, timezone
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image

LOGO_PATH = os.path.join(os.path.dirname(__file__), "assets", "sealtech-logo.png")

BLUE = colors.HexColor("#062B67")
BRONZE = colors.HexColor("#A0703A")
DARK = colors.HexColor("#0A0A0A")
GRAY = colors.HexColor("#52525B")
LIGHT = colors.HexColor("#F4F4F5")
BORDER = colors.HexColor("#E4E4E7")


def _styles():
    return {
        "eyebrow": ParagraphStyle("eyebrow", fontName="Helvetica-Bold", fontSize=8, textColor=BRONZE, leading=10, spaceAfter=2),
        "h1": ParagraphStyle("h1", fontName="Helvetica-Bold", fontSize=24, textColor=DARK, leading=28, spaceAfter=2),
        "h2": ParagraphStyle("h2", fontName="Helvetica-Bold", fontSize=11, textColor=BLUE, leading=14, spaceBefore=6, spaceAfter=4),
        "label": ParagraphStyle("label", fontName="Helvetica-Bold", fontSize=8, textColor=BLUE, leading=10),
        "body": ParagraphStyle("body", fontName="Helvetica", fontSize=10, textColor=DARK, leading=13),
        "body_sm": ParagraphStyle("body_sm", fontName="Helvetica", fontSize=9, textColor=DARK, leading=12),
        "muted": ParagraphStyle("muted", fontName="Helvetica", fontSize=8, textColor=GRAY, leading=10),
        "po_num": ParagraphStyle("po_num", fontName="Helvetica-Bold", fontSize=14, textColor=BLUE, leading=18, alignment=2),
    }


def _footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(BORDER)
    canvas.setLineWidth(0.5)
    canvas.line(0.5 * inch, 0.6 * inch, 8.0 * inch, 0.6 * inch)
    canvas.setFont("Helvetica", 7)
    canvas.setFillColor(GRAY)
    canvas.drawString(0.5 * inch, 0.45 * inch, "SealTech Building Solutions  -  720-715-9955  -  projects@sealtechsolutions.co")
    canvas.drawRightString(8.0 * inch, 0.45 * inch, f"{doc.page} | Page")
    canvas.restoreState()


def _format_project_address(project_address: dict) -> str:
    """Format property address dict into a 2-line string."""
    if not project_address:
        return ""
    addr = (project_address.get("address") or "").strip()
    line2 = (project_address.get("address_line2") or "").strip()
    city = (project_address.get("city") or "").strip()
    state = (project_address.get("state") or "").strip()
    zipc = (project_address.get("zip") or "").strip()
    street = " ".join([p for p in [addr, line2] if p])
    tail = ", ".join([p for p in [city, state] if p])
    if zipc:
        tail = f"{tail} {zipc}".strip()
    return "<br/>".join([p for p in [street, tail] if p])


def build_purchase_order_pdf(po: dict) -> bytes:
    """Build a Purchase Order / Material Take-Off PDF.

    Expected `po` dict shape::

        {
          "po_number": "46 Main St_Denver",           # = project name, also PO#
          "project_name": "46 Main St_Denver",        # same as po_number per user convention
          "po_date": "2026-02-12",
          "ship_to": {"address": "46 Main St", "city": "Denver", "state": "CO", "zip": "80216"},
          "vendor": {
              "name": "Everest Systems",
              "contact_name": "John Doe",
              "phone": "...",
              "email": "...",
              "address": "...", "city": "...", "state": "...", "zip": "..."
          },
          "requested_by": {"name": "Darren Oliver", "phone": "720-715-9955", "email": "..."},
          "notes": "Please confirm delivery date.",
          "lines": [
              {"sku": "525", "name": "Silkoxy H3 — 55 Gal Drum", "size": "55 Gal",
               "unit": "55 Gal Drum", "quantity": 2, "notes": "white"},
              ...
          ],
        }
    """
    s = _styles()
    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=letter,
        leftMargin=0.5 * inch, rightMargin=0.5 * inch,
        topMargin=0.5 * inch, bottomMargin=0.8 * inch,
        title=f"PO {po.get('po_number', '')}",
    )
    story = []

    # ------ Header: logo (left) | "PURCHASE ORDER" + PO # (right) ------
    if os.path.exists(LOGO_PATH):
        try:
            logo = Image(LOGO_PATH, width=2.6 * inch, height=1.0 * inch, kind="proportional")
            logo.hAlign = "LEFT"
        except Exception:
            logo = Paragraph("SEALTECH  ·  BUILDING SOLUTIONS", s["eyebrow"])
    else:
        logo = Paragraph("SEALTECH  ·  BUILDING SOLUTIONS", s["eyebrow"])

    title_block = [
        Paragraph("PURCHASE ORDER", s["h1"]),
        Paragraph("MATERIAL TAKE-OFF", s["eyebrow"]),
        Spacer(1, 0.08 * inch),
        Paragraph(f"<b>PO #</b>&nbsp;&nbsp;{po.get('po_number', '—')}", s["po_num"]),
        Paragraph(f"<b>Date</b>&nbsp;&nbsp;{po.get('po_date', '')}", ParagraphStyle('po_date', parent=s['body'], alignment=2)),
    ]
    header = Table([[logo, title_block]], colWidths=[3.5 * inch, 4.0 * inch])
    header.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    story.append(header)
    story.append(Spacer(1, 0.18 * inch))

    # ------ Vendor + Ship-To panels ------
    vendor = po.get("vendor") or {}
    vendor_lines = [f"<b>{vendor.get('name', 'Vendor')}</b>"]
    if vendor.get("contact_name"):
        vendor_lines.append(vendor["contact_name"])
    addr = " ".join([p for p in [vendor.get("address", ""), vendor.get("address_line2", "")] if p]).strip()
    tail = ", ".join([p for p in [vendor.get("city", ""), vendor.get("state", "")] if p])
    if vendor.get("zip"):
        tail = f"{tail} {vendor.get('zip')}".strip()
    if addr:
        vendor_lines.append(addr)
    if tail:
        vendor_lines.append(tail)
    if vendor.get("phone"):
        vendor_lines.append(f"P: {vendor['phone']}")
    if vendor.get("email"):
        vendor_lines.append(vendor["email"])
    vendor_block = "<br/>".join(vendor_lines)

    ship_to_addr = _format_project_address(po.get("ship_to") or {})
    project_name = po.get("project_name") or po.get("po_number") or ""
    ship_block_lines = [f"<b>{project_name}</b>"] if project_name else []
    if ship_to_addr:
        ship_block_lines.append(ship_to_addr)
    ship_block = "<br/>".join(ship_block_lines) or "—"

    rb = po.get("requested_by") or {}
    requested_lines = []
    if rb.get("name"):
        requested_lines.append(f"<b>{rb['name']}</b>")
    if rb.get("title"):
        requested_lines.append(rb["title"])
    if rb.get("phone"):
        requested_lines.append(f"P: {rb['phone']}")
    if rb.get("email"):
        requested_lines.append(rb["email"])
    requested_block = "<br/>".join(requested_lines) or "—"

    panel = Table(
        [
            [Paragraph("VENDOR", s["label"]), Paragraph("SHIP TO", s["label"]), Paragraph("REQUESTED BY", s["label"])],
            [Paragraph(vendor_block, s["body"]), Paragraph(ship_block, s["body"]), Paragraph(requested_block, s["body"])],
        ],
        colWidths=[2.5 * inch, 2.5 * inch, 2.5 * inch],
    )
    panel.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BACKGROUND", (0, 0), (-1, 0), LIGHT),
        ("LINEBELOW", (0, 0), (-1, 0), 0.5, BORDER),
        ("BOX", (0, 0), (-1, -1), 0.5, BORDER),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LINEAFTER", (0, 0), (-2, -1), 0.5, BORDER),
    ]))
    story.append(panel)
    story.append(Spacer(1, 0.2 * inch))

    # ------ Line items table — NO prices ------
    story.append(Paragraph("Materials Requested", s["h2"]))
    rows = [["Qty", "Unit / Size", "SKU", "Product", "Notes"]]
    for line in (po.get("lines") or []):
        qty = line.get("quantity", 0)
        unit = line.get("unit") or line.get("size") or ""
        sku = line.get("sku") or "—"
        name = line.get("name") or ""
        notes = line.get("notes") or ""
        rows.append([
            str(int(qty) if float(qty) == int(qty) else qty),
            unit,
            sku,
            Paragraph(name, s["body_sm"]),
            Paragraph(notes, s["muted"]),
        ])

    table = Table(rows, colWidths=[0.6 * inch, 1.4 * inch, 1.0 * inch, 2.9 * inch, 1.6 * inch], repeatRows=1)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), BLUE),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 9),
        ("ALIGN", (0, 0), (0, -1), "CENTER"),
        ("FONTSIZE", (0, 1), (-1, -1), 9),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]),
        ("GRID", (0, 0), (-1, -1), 0.25, BORDER),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(table)
    story.append(Spacer(1, 0.18 * inch))

    # Total quantity line — no dollars
    total_qty = sum(float(line.get("quantity", 0) or 0) for line in (po.get("lines") or []))
    qty_lines = len(po.get("lines") or [])
    summary = Table([
        [Paragraph(f"<b>{qty_lines}</b> line item{'s' if qty_lines != 1 else ''}  ·  <b>{int(total_qty) if total_qty == int(total_qty) else total_qty}</b> total units", s["body"])],
    ], colWidths=[7.5 * inch])
    summary.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), LIGHT),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("BOX", (0, 0), (-1, -1), 0.5, BORDER),
    ]))
    story.append(summary)
    story.append(Spacer(1, 0.18 * inch))

    # Notes
    notes = (po.get("notes") or "").strip()
    if notes:
        story.append(Paragraph("Notes", s["h2"]))
        story.append(Paragraph(notes.replace("\n", "<br/>"), s["body"]))
        story.append(Spacer(1, 0.18 * inch))

    # Pricing language — explicit "pricing to be confirmed on invoice"
    story.append(Paragraph(
        "<i>Pricing to be confirmed on your invoice. Please call <b>Darren Oliver at 720-715-9955</b> with any "
        "questions or to confirm volume pricing.</i>",
        s["muted"],
    ))

    doc.build(story, onFirstPage=_footer, onLaterPages=_footer)
    return buf.getvalue()
