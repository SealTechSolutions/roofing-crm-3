"""SealTech Building Solutions — sales brochures.

Three brochures total (this file currently ships #1):
  1. FARM-only       — Fluid Applied Reinforced Membrane (Western Colloid).
  2. Silicone-only   — Everest Silkoxy systems (planned).
  3. FARM + Silicone — combined, FARM-led with 1-2 silicone pages (planned).

All brochures share the same brand styling (blue + bronze, matching the spec
sheet PDFs) and pull their photos from `/app/backend/brochure_assets/`. The
endpoints are mounted at `/api/brochures/{slug}.pdf` for one-click download
and email-attach from the CRM.
"""
from __future__ import annotations

import os
from io import BytesIO

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from reportlab.lib import colors
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import (
    BaseDocTemplate, Frame, PageTemplate, Paragraph, Spacer, Image, Table, TableStyle,
    PageBreak, KeepTogether,
)
from reportlab.lib.enums import TA_LEFT, TA_CENTER

# Brand palette (mirrors spec_sheet.py so brochures and proposals feel like one set)
BLUE = colors.HexColor("#062B67")
BRONZE = colors.HexColor("#A0703A")
LIGHT = colors.HexColor("#F4F4F5")
BORDER = colors.HexColor("#E4E4E7")
GRAY = colors.HexColor("#52525B")
DARK = colors.HexColor("#0A0A0A")
INK = colors.HexColor("#18181B")

ASSETS = os.path.join(os.path.dirname(__file__), "brochure_assets")
LOGO = os.path.join(os.path.dirname(__file__), "assets", "sealtech-logo.png")


# ---------------------- Brand contact bar (footer) ----------------------
PHONE = "720-715-9955"
EMAIL = "info@sealtechsolutions.co"
SITE = "sealtechsolutions.co"


def _styles():
    return {
        "h1":     ParagraphStyle("h1",     fontName="Helvetica-Bold", fontSize=26, leading=30, textColor=BLUE, spaceAfter=6),
        "h2":     ParagraphStyle("h2",     fontName="Helvetica-Bold", fontSize=16, leading=20, textColor=BLUE, spaceAfter=4),
        "h3":     ParagraphStyle("h3",     fontName="Helvetica-Bold", fontSize=12, leading=15, textColor=BRONZE, spaceAfter=2),
        "kicker": ParagraphStyle("kicker", fontName="Helvetica-Bold", fontSize=10, leading=12, textColor=BRONZE, spaceAfter=2),
        "body":   ParagraphStyle("body",   fontName="Helvetica",      fontSize=10, leading=14, textColor=INK, spaceAfter=4),
        "lead":   ParagraphStyle("lead",   fontName="Helvetica",      fontSize=11, leading=16, textColor=INK, spaceAfter=6),
        "bullet": ParagraphStyle("bullet", fontName="Helvetica",      fontSize=10, leading=14, textColor=INK, leftIndent=14, bulletIndent=2, spaceAfter=2),
        "small":  ParagraphStyle("small",  fontName="Helvetica",      fontSize=8,  leading=10, textColor=GRAY),
        "white":  ParagraphStyle("white",  fontName="Helvetica-Bold", fontSize=11, leading=14, textColor=colors.white, alignment=TA_CENTER),
        "tagline":ParagraphStyle("tag",    fontName="Helvetica-Bold", fontSize=14, leading=18, textColor=colors.white, alignment=TA_CENTER),
    }


def _draw_footer(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(BLUE)
    canvas.rect(0, 0, LETTER[0], 0.42 * inch, fill=1, stroke=0)
    canvas.setFillColor(colors.white)
    canvas.setFont("Helvetica-Bold", 9)
    canvas.drawString(0.5 * inch, 0.18 * inch, "SealTech Building Solutions")
    canvas.setFont("Helvetica", 9)
    canvas.drawCentredString(
        LETTER[0] / 2,
        0.18 * inch,
        f"{PHONE}  ·  {EMAIL}  ·  {SITE}",
    )
    canvas.drawRightString(LETTER[0] - 0.5 * inch, 0.18 * inch, f"{doc.page} | Page")
    canvas.restoreState()


def _image(path: str, w: float, h: float, kind: str = "proportional") -> Image:
    img = Image(path, width=w, height=h, kind=kind)
    img.hAlign = "CENTER"
    return img


def _bullet_block(items: list[str], s) -> Paragraph:
    body = "<br/>".join(f"•&nbsp;&nbsp;{b}" for b in items)
    return Paragraph(body, s["body"])


def _section_band(text: str, s, color=BLUE) -> Table:
    """Full-width colored banner (used as section headers, mirrors WSC's green bar)."""
    t = Table([[Paragraph(text, s["tagline"])]], colWidths=[7.5 * inch])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), color),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LEFTPADDING", (0, 0), (-1, -1), 16),
        ("RIGHTPADDING", (0, 0), (-1, -1), 16),
    ]))
    return t


# =====================================================================
# Brochure #1 — Fluid Applied Reinforced Membrane (FARM)
# =====================================================================
def build_farm_brochure() -> bytes:
    """SealTech-branded 6-page sales brochure for FARM roof systems."""
    s = _styles()
    buf = BytesIO()
    doc = BaseDocTemplate(
        buf, pagesize=LETTER,
        leftMargin=0.5 * inch, rightMargin=0.5 * inch,
        topMargin=0.45 * inch, bottomMargin=0.55 * inch,
        title="SealTech Building Solutions — Fluid Applied Reinforced Membrane",
        author="SealTech Building Solutions",
    )
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height,
                  leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    doc.addPageTemplates([PageTemplate(id="main", frames=[frame], onPage=_draw_footer)])

    story = []

    # ============ PAGE 1 — Cover ============
    # Top logo strip
    if os.path.exists(LOGO):
        story.append(_image(LOGO, 3.0 * inch, 1.0 * inch))
    story.append(Spacer(1, 0.05 * inch))

    # Hero aerial
    story.append(_image(os.path.join(ASSETS, "hero_aerial.jpg"), 7.5 * inch, 3.6 * inch))
    story.append(Spacer(1, 0.10 * inch))

    # Headline band
    story.append(_section_band("Renewable &amp; Sustainable Roof Systems", s, color=BLUE))
    story.append(Spacer(1, 0.10 * inch))

    # Sub-headline + before/after pair
    story.append(Paragraph(
        "<b>Colorado's Specialist in Custom Fluid Applied Reinforced Membrane Roof Systems</b>",
        s["h2"],
    ))
    story.append(Paragraph(
        "Tear-off-free. Seamless. Backed by a No-Dollar-Limit lifetime renewable warranty. "
        "We restore the roof you already have into a roof you'll never have to replace.",
        s["lead"],
    ))
    story.append(Spacer(1, 0.10 * inch))

    # CTA
    cta = Table(
        [[Paragraph(f"CALL US NOW — <b>{PHONE}</b>", s["tagline"])]],
        colWidths=[7.5 * inch],
    )
    cta.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), BRONZE),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
    ]))
    story.append(cta)
    story.append(PageBreak())

    # ============ PAGE 2 — What is a FARM? ============
    story.append(Paragraph("Fluid Applied Reinforced Membrane", s["h1"]))
    story.append(Paragraph(
        "Engineered on-site. Monolithic. Built to last the life of your building.",
        s["kicker"],
    ))
    story.append(Spacer(1, 0.08 * inch))

    left_col = [
        Paragraph("<b>What is a Fluid Applied Reinforced Membrane?</b>", s["h3"]),
        Paragraph(
            "A FARM system is <b>not a coating</b>. It is a 50-year-proven, custom-manufactured "
            "roof membrane built layer-by-layer on the roof itself. Because it's fluid-applied, "
            "it bonds 100% to the existing substrate — no adhesives, no mechanical fasteners.",
            s["body"],
        ),
        Paragraph(
            "Each system is built from multiple membrane applications of waterproof emulsion "
            "with high-strength stitchbonded polyester fabric, a premium acrylic mid-coat with a "
            "second fabric layer, and a highly reflective acrylic radiant top-coat. The result is "
            "a seamless, monolithic membrane that is roughly <b>three to four times stronger</b> "
            "than your current roof and approximately <b>160 mil thick</b>.",
            s["body"],
        ),
        Paragraph(
            "Once installed, every curb, penetration, parapet wall, and edge is fully encapsulated "
            "into one continuous roof surface — backed by a Lifetime NDL renewable warranty.",
            s["body"],
        ),
    ]
    right_col = [
        _image(os.path.join(ASSETS, "sub_roof_detail.jpg"), 3.3 * inch, 2.2 * inch),
        Spacer(1, 0.10 * inch),
        Paragraph("<b>The Benefits</b>", s["h3"]),
        _bullet_block([
            "Renewable, transferable LIFETIME NDL warranty — the roof never has to be replaced.",
            "<b>No roof tear-offs — ever.</b> Installs over asphalt, gravel, EPDM, TPO, PVC, modbit, metal, foam, even buildings with two existing roofs.",
            "True 100% seamless monolithic system. No seams = no leaks.",
            "Quick and easy to repair anywhere on the field.",
            "Acrylic radiant barrier is <b>FM 4470 severe-hail rated</b>.",
            "50 years of proven performance.",
            "<b>20–40% energy savings</b> from the high-reflectivity top-coat.",
            "Environmentally friendly — no tear-off waste to landfill.",
        ], s),
    ]
    body_table = Table([[left_col, right_col]], colWidths=[3.9 * inch, 3.6 * inch])
    body_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    story.append(body_table)
    story.append(PageBreak())

    # ============ PAGE 3 — Factory Membrane Limitations vs. FARM ============
    story.append(Paragraph("Factory Membrane Limitations", s["h1"]))
    story.append(Spacer(1, 0.06 * inch))

    left_col = [
        Paragraph(
            "Independent studies show that TPO, PVC, and EPDM factory membranes have "
            "<b>definite limitations</b>:",
            s["body"],
        ),
        _bullet_block([
            "~6,000 fastener penetrations per 10,000 SF of factory membrane.",
            "Fasteners wear, break, and rust — the cause of roughly <b>40% of membrane punctures</b>.",
            "&quot;Fully-adhered&quot; factory membranes rarely exceed <b>35% true adhesion</b>.",
            "~15,000 linear feet of seams per 10,000 SF of roof — every seam is a leak risk.",
            "When single-ply factory membranes wear out, the entire roof must be torn off and replaced — expensive, lengthy, disruptive.",
        ], s),
        Spacer(1, 0.05 * inch),
        _image(os.path.join(ASSETS, "diagram_layers.png"), 3.5 * inch, 2.3 * inch),
    ]
    right_col = [
        Paragraph("<b>The Fluid Applied Reinforced Membrane</b>", s["h3"]),
        _bullet_block([
            "We <b>manufacture the membrane on-site</b>, using your existing roof as the base. First we repair all damage to ensure the current membrane is watertight.",
            "Apply a fully-adhered <b>emulsion membrane</b> and embed a layer of stitchbonded polyester fabric — creating a new watertight reinforced emulsion membrane.",
            "Apply a premium <b>acrylic membrane</b> and embed a second polyester fabric layer — creating a third watertight, reinforced mid-layer.",
            "Apply a finishing <b>acrylic top-coat radiant barrier</b> — completing a monolithic, seamless reinforced roof system.",
            "<b>Step up to a 20-year system</b> by adding a second emulsion membrane before the first acrylic layer.",
        ], s),
        Spacer(1, 0.05 * inch),
        Paragraph(
            "Fully adhered to your current roof. ~160 mil multi-layered, monolithic, reinforced "
            "membrane that — properly maintained — can be renewed to last the life of your building.",
            s["body"],
        ),
    ]
    body_table = Table([[left_col, right_col]], colWidths=[3.7 * inch, 3.8 * inch])
    body_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    story.append(body_table)
    story.append(Spacer(1, 0.10 * inch))
    story.append(Paragraph(
        "<i>SealTech and our manufacturing partner are trusted by some of America's most "
        "demanding building owners, property-management firms, corporations, school districts, "
        "and local, state, and federal government agencies — all requiring higher industry "
        "roofing standards.</i>",
        s["small"],
    ))
    story.append(PageBreak())

    # ============ PAGE 4 — Monolithic Membrane Options & Warranty ============
    story.append(Paragraph("Monolithic Membrane Options", s["h1"]))
    story.append(Spacer(1, 0.04 * inch))
    story.append(_image(os.path.join(ASSETS, "hvac_detail.jpg"), 7.5 * inch, 2.4 * inch))
    story.append(Spacer(1, 0.08 * inch))

    story.append(Paragraph("<b>A Roof System Made For Life</b>", s["h3"]))
    story.append(Paragraph(
        "Every FARM roof system SealTech installs ships with a <b>Renewable and Transferable "
        "Warranty</b>. Before the end of each warranty period, you simply resurface the roof and "
        "we extend the warranty for another 10 years — repeated indefinitely. The Transferable "
        "clause also adds value to your building: future owners inherit the warranty and can "
        "continue the renewal cycle.",
        s["body"],
    ))
    story.append(Spacer(1, 0.06 * inch))
    story.append(Paragraph("<b>Unlimited Lifetime Renewable Warranty</b>", s["h3"]))
    story.append(Paragraph(
        "Never re-roof your building again. At or before warranty expiration, resurface the "
        "FARM roof with a new application of our acrylic radiant barrier and the warranty "
        "extends another 10 years. This process can be repeated <b>indefinitely</b>.",
        s["body"],
    ))
    story.append(Spacer(1, 0.06 * inch))

    # Warranty options box (matches WSC's pattern)
    war = Table(
        [[Paragraph(
            "<b>Warranty Options:</b>&nbsp;&nbsp;10-Year, 15-Year, 20-Year, &amp; 25-Year NDL Warranty Options.<br/>"
            "All NDL (No-Dollar-Limit), all Renewable, all Transferable. Hail Riders included.",
            s["body"],
        )]],
        colWidths=[7.5 * inch],
    )
    war.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), LIGHT),
        ("BOX", (0, 0), (-1, -1), 1, BRONZE),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
    ]))
    story.append(war)
    story.append(Spacer(1, 0.10 * inch))

    # ElastaHyde colors
    color_left = [
        Paragraph("<b>ElastaHyde Acrylic Colors</b>", s["h3"]),
        Paragraph(
            "<b>Standard:</b> White<br/>"
            "<b>Premium:</b> California Tan · Standard Tan · Platinum Grey · Standard Grey<br/>"
            "<b>Custom:</b> Almost any color can be matched — including signature reds like the "
            "one on the Staples Center in Los Angeles.",
            s["body"],
        ),
    ]
    color_right = [_image(os.path.join(ASSETS, "staples_center.jpg"), 3.0 * inch, 1.8 * inch)]
    color_table = Table([[color_left, color_right]], colWidths=[4.2 * inch, 3.3 * inch])
    color_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    story.append(color_table)
    story.append(PageBreak())

    # ============ PAGE 5 — Featured Clients & Facilities ============
    story.append(Paragraph("Trusted By Demanding Owners", s["h1"]))
    story.append(Spacer(1, 0.06 * inch))
    story.append(_image(os.path.join(ASSETS, "featured_facility_aerial.jpg"), 7.5 * inch, 2.6 * inch))
    story.append(Spacer(1, 0.10 * inch))

    left_col = [
        Paragraph("<b>Featured Client List</b>", s["h3"]),
        _bullet_block([
            "Boeing — multiple US facilities",
            "Lockheed Martin Missiles &amp; Space",
            "Trammell Crow Properties",
            "Local, state, and federal government agencies",
            "K-12 and university school districts",
            "Multi-tenant property management firms",
            "<i>…and 10,000+ additional commercial buildings.</i>",
        ], s),
    ]
    right_col = [
        Paragraph("<b>Featured Facilities</b>", s["h3"]),
        _bullet_block([
            "<b>Boeing</b> — Long Beach, CA · 1,000,000+ SF",
            "<b>Lockheed Martin</b> — Sunnyvale, CA · 2,000,000 SF",
            "<b>Trammell Crow Properties</b> — 5,000,000+ SF total",
            "<b>Historic project:</b> Original gravel roof installed 1959. Fluid-Applied Reinforced Roof installed over it in 1977. Resurfaced and re-warrantied in 1999 and 2009. <b>180,000 SF — still in service.</b>",
        ], s),
    ]
    body_table = Table([[left_col, right_col]], colWidths=[3.6 * inch, 3.9 * inch])
    body_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    story.append(body_table)
    story.append(Spacer(1, 0.12 * inch))

    closer = Table(
        [[Paragraph(
            "Together with our manufacturing partner, SealTech offers the only "
            "<b>100% No-Leak Guaranteed, No-Dollar-Limit (materials &amp; labor) "
            "Lifetime Renewable &amp; Transferable Warranty</b> — with a 2&quot; hail rider included.",
            s["white"],
        )]],
        colWidths=[7.5 * inch],
    )
    closer.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), BLUE),
        ("TOPPADDING", (0, 0), (-1, -1), 12),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 12),
        ("LEFTPADDING", (0, 0), (-1, -1), 16),
        ("RIGHTPADDING", (0, 0), (-1, -1), 16),
    ]))
    story.append(closer)
    story.append(PageBreak())

    # ============ PAGE 6 — Reputation & Contact ============
    story.append(Paragraph("A Reputation For Quality", s["h1"]))
    story.append(Spacer(1, 0.04 * inch))
    story.append(Paragraph(
        "SealTech Building Solutions is a certified, recommended installer of Custom Fluid "
        "Applied Reinforced Monolithic Membrane Roof Systems. We bring the latest spray and "
        "embedment equipment, our own experienced crews, and a single accountable point of "
        "contact for every project — from the first survey to every warranty renewal.",
        s["body"],
    ))
    story.append(Paragraph(
        "SealTech has earned a <b>100% client approval rating</b>. Our goal is to maintain that "
        "same 100% positive outcome for every customer.",
        s["body"],
    ))
    story.append(Spacer(1, 0.10 * inch))
    story.append(_image(os.path.join(ASSETS, "back_cover_aerial.jpg"), 7.5 * inch, 2.6 * inch))
    story.append(Spacer(1, 0.12 * inch))

    # Final contact / call-to-action band
    contact = Table(
        [[Paragraph(
            f"<b>READY FOR A ROOF YOU'LL NEVER REPLACE?</b><br/>"
            f"Call <b>{PHONE}</b>&nbsp;&nbsp;·&nbsp;&nbsp;{EMAIL}&nbsp;&nbsp;·&nbsp;&nbsp;{SITE}",
            s["tagline"],
        )]],
        colWidths=[7.5 * inch],
    )
    contact.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), BRONZE),
        ("TOPPADDING", (0, 0), (-1, -1), 14),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 14),
        ("LEFTPADDING", (0, 0), (-1, -1), 16),
        ("RIGHTPADDING", (0, 0), (-1, -1), 16),
    ]))
    story.append(contact)

    doc.build(story)
    buf.seek(0)
    return buf.read()


# =====================================================================
# Router
# =====================================================================
def create_router(get_current_user):
    router = APIRouter(prefix="/brochures", tags=["brochures"])

    @router.get("/farm.pdf")
    async def farm_brochure(_=Depends(get_current_user)):
        """Download the 6-page FARM (Fluid Applied Reinforced Membrane) brochure."""
        try:
            data = build_farm_brochure()
        except FileNotFoundError as e:
            raise HTTPException(status_code=500, detail=f"Brochure asset missing: {e}")
        return StreamingResponse(
            BytesIO(data),
            media_type="application/pdf",
            headers={
                "Content-Disposition": 'inline; filename="SealTech-FARM-Brochure.pdf"',
            },
        )

    return router
