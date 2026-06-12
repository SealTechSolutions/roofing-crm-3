"""Silicone Roof Scope spec sheet generator (SealTech-branded)."""
import os
from io import BytesIO
from datetime import datetime
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, Image
from reportlab.platypus.flowables import KeepTogether

LOGO_PATH = os.path.join(os.path.dirname(__file__), "assets", "sealtech-logo.png")


BLUE = colors.HexColor("#1D4ED8")
ORANGE = colors.HexColor("#EA580C")
DARK = colors.HexColor("#0A0A0A")
GRAY = colors.HexColor("#52525B")
LIGHT = colors.HexColor("#F4F4F5")
BORDER = colors.HexColor("#E4E4E7")


def _styles():
    return {
        "title": ParagraphStyle("title", fontName="Helvetica-Bold", fontSize=20, textColor=DARK, leading=24, spaceAfter=4),
        "eyebrow": ParagraphStyle("eyebrow", fontName="Helvetica-Bold", fontSize=8, textColor=ORANGE, leading=10, spaceAfter=2),
        "h2": ParagraphStyle("h2", fontName="Helvetica-Bold", fontSize=12, textColor=BLUE, leading=15, spaceBefore=10, spaceAfter=4),
        "body": ParagraphStyle("body", fontName="Helvetica", fontSize=9, textColor=DARK, leading=12),
        "small": ParagraphStyle("small", fontName="Helvetica", fontSize=8, textColor=GRAY, leading=10),
        "bold": ParagraphStyle("bold", fontName="Helvetica-Bold", fontSize=9, textColor=DARK, leading=12),
        "tc": ParagraphStyle("tc", fontName="Helvetica", fontSize=11, textColor=DARK, leading=14, spaceAfter=8),
        "tc_h": ParagraphStyle("tch", fontName="Helvetica-Bold", fontSize=11, textColor=DARK, leading=14, spaceBefore=4),
        "tc_intro": ParagraphStyle("tc_intro", fontName="Helvetica-Bold", fontSize=10, textColor=DARK, leading=13, spaceAfter=8),
    }


def _currency(v):
    try:
        return "${:,.0f}".format(float(v or 0))
    except Exception:
        return "$0"


SCOPE_INSPECTION = [
    "Inspect the roof for existing leaks, deterioration, and overall substrate condition.",
    "Identify and document any membrane separations, blisters, ponding, and seam failures.",
    "Cut, patch, and repair damaged areas of the existing single-ply membrane as required.",
    "Re-seal seams, flashings, and penetrations to provide a sound substrate.",
    "Verify drains, scuppers, and edge metal are functional and watertight.",
]

SCOPE_COATING = [
    "Power-wash the entire roof surface to remove all dirt, oxidation, and loose debris.",
    "Allow substrate to fully dry before application.",
    "Apply manufacturer-approved primer where required.",
    "Apply base coat of silicone roof coating to manufacturer's specified mil thickness.",
    "Reinforce all seams, fasteners, and penetrations with polyester fabric set in silicone.",
    "Apply top coat of silicone with embedded protective granules over walls and field as specified.",
    "Final walk-through and quality inspection with the owner or owner's representative.",
]

EXCLUSIONS = [
    "Permit fees (if required by jurisdiction).",
    "Heavy equipment (not foreseen for this project).",
    "Structural deck repairs beyond minor patching.",
    "Removal/disposal of pre-existing hazardous materials.",
    "Work outside the defined scope or roof area.",
]

TERMS = [
    ("PAYMENT TERMS.", "Proposals are valid for thirty (30) days from the date issued. Fifty percent (50%) of the total contract amount is due upon acceptance to order materials and prior to scheduling of the work, unless otherwise specified in the milestone schedule. The remaining balance is due at mid-project and/or upon substantial completion per the agreed milestone schedule."),
    ("ACCOUNTS.", "Invoices past due by thirty (30) days will accrue interest at one and one-half percent (1.5%) per month, or the maximum rate permitted by law. The Owner shall be responsible for all reasonable collection costs, including attorneys' fees."),
    ("FINAL INSPECTION.", "If a final inspection is required, a five percent (5%) retainage may be withheld until punch list items are completed to mutual satisfaction. Inspection requests must be submitted in writing within ten (10) days of substantial completion."),
    ("PERFORMANCE OF WORK.", "All work shall be performed in a workmanlike manner using materials specified herein or equivalent. SealTech Building Solutions warrants its workmanship for the period stated in the selected warranty tier. Manufacturer warranties are separate and provided by the product manufacturer."),
    ("FORCE MAJEURE.", "SealTech Building Solutions shall not be liable for any delay or failure in performance caused by events beyond its reasonable control, including but not limited to weather, labor disputes, material shortages, or governmental actions."),
    ("ADDITIONAL WORK.", "Any work outside the scope described in this proposal shall be authorized in writing by the Owner and billed at the prevailing time-and-material rates. Verbal change orders are not binding."),
    ("ACCESS.", "Owner shall provide safe, unobstructed access to the work area, including roof access, electrical hookups, and water as needed. Owner is responsible for moving any personal property from the work area."),
    ("PAID IN FULL.", "Title to all materials installed remains with SealTech Building Solutions until the contract is paid in full. Owner grants SealTech the right to file appropriate lien notices as permitted by law."),
    ("CANCELLATION.", "Cancellation more than seventy-two (72) hours after acceptance but prior to commencement of work shall incur a cancellation fee equal to twenty-five percent (25%) of the total proposal amount."),
]


def _footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(BORDER)
    canvas.setLineWidth(0.5)
    canvas.line(0.5 * inch, 0.6 * inch, 8.0 * inch, 0.6 * inch)
    canvas.setFont("Helvetica", 7)
    canvas.setFillColor(GRAY)
    canvas.drawString(0.5 * inch, 0.45 * inch, "SealTech Building Solutions  ·  www.sealtechbuildingsolutions.com  ·  info@sealtechbuildingsolutions.com")
    canvas.drawRightString(8.0 * inch, 0.45 * inch, f"{doc.page} | Page")
    canvas.restoreState()


def _header_block(s, doc):
    elems = []
    # Logo at top-left, 50% larger
    if os.path.exists(LOGO_PATH):
        try:
            logo = Image(LOGO_PATH, width=3.3 * inch, height=1.275 * inch, kind="proportional")
            logo.hAlign = "LEFT"
            elems.append(logo)
        except Exception:
            elems.append(Paragraph("SEALTECH  ·  BUILDING SOLUTIONS", s["eyebrow"]))
    else:
        elems.append(Paragraph("SEALTECH  ·  BUILDING SOLUTIONS", s["eyebrow"]))

    # Centered title — sits midway between logo and PROJECT ADDRESS
    elems.append(Spacer(1, 0.05 * inch))
    title_centered = ParagraphStyle(
        "title_centered", parent=s["title"], alignment=1,  # 1 = CENTER
        fontSize=22, leading=26, spaceAfter=6,
    )
    elems.append(Paragraph("RESTORATION ROOF SCOPE", title_centered))
    elems.append(Spacer(1, 0.35 * inch))

    info_rows = [
        ["PROJECT ADDRESS", doc.get("project_address", "—")],
        ["PRODUCT TYPE", doc.get("product_type", "—")],
        ["DATE", doc.get("date", "—")],
    ]
    t = Table(info_rows, colWidths=[1.5 * inch, 6.0 * inch])
    t.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("TEXTCOLOR", (0, 0), (0, -1), BLUE),
        ("TEXTCOLOR", (1, 0), (1, -1), DARK),
        ("LINEBELOW", (0, 0), (-1, -1), 0.25, BORDER),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
    ]))
    elems.append(t)
    elems.append(Spacer(1, 0.15 * inch))
    return elems


def _pricing_table(s, doc):
    elems = []
    elems.append(Paragraph(doc.get("product_type", "Roof System Investment"), s["h2"]))
    base = [
        ["Warranty Tier", "Base Investment"],
        ["20-Year Workmanship", _currency(doc.get("opt_20"))],
        ["15-Year Workmanship", _currency(doc.get("opt_15"))],
        ["10-Year Workmanship", _currency(doc.get("opt_10"))],
    ]
    t = Table(base, colWidths=[4.5 * inch, 3.0 * inch])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), BLUE),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("GRID", (0, 0), (-1, -1), 0.25, BORDER),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    elems.append(t)
    elems.append(Spacer(1, 0.12 * inch))

    elems.append(Paragraph("[OPTIONAL] Manufacturer Warranty (Everest Systems Labor &amp; Material)", s["h2"]))
    opt = [
        ["Warranty Tier", "Add-On Cost"],
        ["20-Year Labor & Material", _currency(doc.get("w20"))],
        ["15-Year Labor & Material", _currency(doc.get("w15"))],
        ["10-Year Labor & Material", _currency(doc.get("w10"))],
    ]
    t2 = Table(opt, colWidths=[4.5 * inch, 3.0 * inch])
    t2.setStyle(t._style if hasattr(t, "_style") else TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), BLUE), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"), ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 9), ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("GRID", (0, 0), (-1, -1), 0.25, BORDER),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]),
        ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    elems.append(t2)
    elems.append(Spacer(1, 0.12 * inch))

    # Totals
    elems.append(Paragraph("Total Investment with Optional Manufacturer Warranty", s["h2"]))
    tot = [
        ["Including 20-Year Warranty", _currency((doc.get("opt_20") or 0) + (doc.get("w20") or 0))],
        ["Including 15-Year Warranty", _currency((doc.get("opt_15") or 0) + (doc.get("w15") or 0))],
        ["Including 10-Year Warranty", _currency((doc.get("opt_10") or 0) + (doc.get("w10") or 0))],
    ]
    t3 = Table(tot, colWidths=[4.5 * inch, 3.0 * inch])
    t3.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("TEXTCOLOR", (1, 0), (1, -1), BLUE),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("GRID", (0, 0), (-1, -1), 0.5, DARK),
        ("BACKGROUND", (0, 0), (-1, -1), LIGHT),
        ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    elems.append(t3)
    return elems


def _scope_block(s, title, items):
    elems = [Paragraph(title, s["h2"])]
    bullets = "<br/>".join([f"•&nbsp;&nbsp;{i}" for i in items])
    elems.append(Paragraph(bullets, s["body"]))
    return elems


def build_silicone_spec(data: dict, cover_photo_bytes: bytes = None) -> bytes:
    buf = BytesIO()
    pdf = SimpleDocTemplate(buf, pagesize=letter,
                            leftMargin=0.5 * inch, rightMargin=0.5 * inch,
                            topMargin=0.6 * inch, bottomMargin=0.8 * inch,
                            title="Restoration Roof Scope")
    s = _styles()
    story = []

    # ---- Page 1: Header + Pricing + Scope ----
    story.extend(_header_block(s, data))
    story.extend(_pricing_table(s, data))
    story.append(PageBreak())

    # ---- Page 2: Scope of Work + Inclusions + Photo + Exclusions ----
    story.extend(_scope_block(s, "Inspection and Repairs", SCOPE_INSPECTION))
    story.append(Spacer(1, 0.1 * inch))
    story.extend(_scope_block(s, "Substrate Preparation and Coating", SCOPE_COATING))
    story.append(Spacer(1, 0.15 * inch))

    story.append(Paragraph("Inclusions", s["h2"]))
    total_sqft = data.get("total_sqft", 0) or 0
    sq = int(round(total_sqft / 100))
    color = data.get("color", "white")
    inc_text = f"Approximately {total_sqft:,.0f} SF ({sq} SQ) {color} {data.get('roof_type_label','silicone')} coating, including walls."
    story.append(Paragraph(inc_text, s["body"]))
    story.append(Spacer(1, 0.12 * inch))

    # Cover photo
    if cover_photo_bytes:
        try:
            img = Image(BytesIO(cover_photo_bytes), width=7.0 * inch, height=3.2 * inch, kind="proportional")
            story.append(img)
        except Exception:
            story.append(Paragraph("<i>Cover photo could not be embedded.</i>", s["small"]))
    else:
        ph = Table([[" "]], colWidths=[7.0 * inch], rowHeights=[2.0 * inch])
        ph.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.5, BORDER), ("BACKGROUND", (0, 0), (-1, -1), LIGHT)]))
        story.append(ph)
        story.append(Paragraph("Cover photo placeholder — upload a Photo to this project and mark it as Cover.", s["small"]))
    story.append(Spacer(1, 0.15 * inch))

    story.append(Paragraph("Exclusions", s["h2"]))
    excl = "<br/>".join([f"•&nbsp;&nbsp;{e}" for e in EXCLUSIONS])
    story.append(Paragraph(excl, s["body"]))
    story.append(Spacer(1, 0.2 * inch))

    story.append(Paragraph(
        "We appreciate your consideration of SealTech Building Solutions for your roofing investment. "
        "We are committed to delivering exceptional craftsmanship, transparency, and lasting value on every project we undertake.",
        s["body"],
    ))
    story.append(Spacer(1, 0.18 * inch))

    sig = Table([
        [Paragraph("<b>Darren Oliver, CSI, IIBEC</b><br/>GM, SealTech Building Solutions", s["body"]), ""],
    ], colWidths=[3.5 * inch, 4.0 * inch])
    story.append(sig)
    story.append(Spacer(1, 0.15 * inch))

    story.append(Paragraph("Acceptance Of Scope", s["h2"]))
    story.append(Paragraph(
        "The investment, specifications, and conditions stated above are satisfactory and are hereby accepted. "
        "SealTech Building Solutions is authorized to perform the work as specified. Payment will be made as outlined in the milestone schedule and Terms &amp; Conditions. "
        "&quot;Owner&quot; refers to the legal owner of the property or their duly authorized representative.",
        s["body"],
    ))
    story.append(Spacer(1, 0.15 * inch))

    accept_rows = [
        ["By:", "________________________________", "Title:", "________________________________"],
        ["", "", "", ""],
        ["Signature:", "________________________________", "Date:", "________________________________"],
    ]
    at = Table(accept_rows, colWidths=[0.7 * inch, 3.0 * inch, 0.6 * inch, 3.0 * inch])
    at.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("TEXTCOLOR", (0, 0), (-1, -1), DARK),
    ]))
    story.append(at)
    story.append(PageBreak())

    # ---- Page 3: Terms & Conditions ----
    story.append(Paragraph("TERMS AND CONDITIONS", s["title"]))
    story.append(Paragraph(
        "The following terms and conditions are an integral part of this proposal and form a binding agreement upon acceptance. "
        "No representations or reliance on any statements not contained herein shall be binding upon SealTech Building Solutions.",
        s["tc_intro"],
    ))
    story.append(Spacer(1, 0.1 * inch))
    for head, body in TERMS:
        story.append(KeepTogether([
            Paragraph(head, s["tc_h"]),
            Paragraph(body, s["tc"]),
        ]))

    pdf.build(story, onFirstPage=_footer, onLaterPages=_footer)
    return buf.getvalue()
