"""Work Order issuance + e-signing flow.

Mirrors the customer-facing Proposal e-sign machine but aimed at the
subcontractor: rep generates a Work Order from a Deal → CRM auto-fills
project info and pulls the customer-facing scope bullets → rep edits +
sends → sub clicks the public link → views the PDF → types name + cursive
signature OR draws → backend stamps signature, attaches signed PDF to the
deal, flips deal stage to "Sub Engaged", and emails the rep.

Future: Phase 2 will add a `?kind=change-order` variant that re-uses the
same generator but swaps the header to "CHANGE ORDER" and skips the
auto-stage-flip.
"""
from __future__ import annotations

import os
import secrets
import smtplib
from datetime import datetime, timezone
from io import BytesIO
from typing import Optional

from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.base import MIMEBase
from email import encoders

from fastapi import APIRouter, Body, Depends, HTTPException
from fastapi.responses import StreamingResponse
from reportlab.lib import colors
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import (
    BaseDocTemplate, Frame, PageTemplate, Paragraph, Spacer, Image, Table, TableStyle,
)

BLUE = colors.HexColor("#062B67")
BRONZE = colors.HexColor("#A0703A")
LIGHT = colors.HexColor("#F4F4F5")
BORDER = colors.HexColor("#D4D4D8")
GRAY = colors.HexColor("#52525B")
INK = colors.HexColor("#18181B")

LOGO_PATH = os.path.join(os.path.dirname(__file__), "assets", "sealtech-logo.png")

SEALTECH = {
    "name": "SealTech Building Solutions",
    "address": "2278 Manatt Ct., Unit C02, Castle Rock, CO 80104",
    "phone": "720-715-9955",
    "email": "info@sealtechsolutions.co",
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _styles():
    return {
        "h1":     ParagraphStyle("h1",     fontName="Helvetica-Bold", fontSize=22, leading=26, textColor=BLUE, spaceAfter=4),
        "h2":     ParagraphStyle("h2",     fontName="Helvetica-Bold", fontSize=12, leading=15, textColor=BLUE, spaceAfter=3),
        "label":  ParagraphStyle("label",  fontName="Helvetica-Bold", fontSize=8,  leading=10, textColor=BRONZE, spaceAfter=0),
        "value":  ParagraphStyle("value",  fontName="Helvetica",      fontSize=10, leading=13, textColor=INK, spaceAfter=0),
        "body":   ParagraphStyle("body",   fontName="Helvetica",      fontSize=10, leading=14, textColor=INK, spaceAfter=4),
        "small":  ParagraphStyle("small",  fontName="Helvetica",      fontSize=8,  leading=10, textColor=GRAY),
        "note":   ParagraphStyle("note",   fontName="Helvetica-Oblique", fontSize=9, leading=12, textColor=GRAY),
        "sig":    ParagraphStyle("sig",    fontName="Helvetica-Bold", fontSize=11, leading=14, textColor=INK),
    }


# ------------------ PDF generator ------------------
def build_work_order_pdf(wo: dict, signed_signature: Optional[dict] = None,
                        kind: str = "work-order") -> bytes:
    """Render a Work Order to a 1-page PDF.

    `wo` is the persisted work_orders document (or a draft preview). When
    `signed_signature` is provided the signature line is stamped with either
    a cursive typed name (`{"text": "Joe", "font": "Caveat"}`) or a drawn
    PNG/SVG bytes (`{"image_bytes": ..., "content_type": "image/png"}`).
    `kind` switches header text — Phase-1 only uses "work-order"; Phase-2
    will add "change-order".
    """
    s = _styles()
    buf = BytesIO()
    doc = BaseDocTemplate(
        buf, pagesize=LETTER,
        leftMargin=0.5 * inch, rightMargin=0.5 * inch,
        topMargin=0.5 * inch, bottomMargin=0.45 * inch,
        title="SealTech Work Order",
    )
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height,
                  leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    doc.addPageTemplates([PageTemplate(id="wo", frames=[frame])])

    story = []
    title_text = "WORK ORDER" if kind == "work-order" else "CHANGE ORDER"

    # ---- Top brand bar ----
    logo_cell = [Spacer(1, 0)]
    if os.path.exists(LOGO_PATH):
        try:
            logo_cell = [Image(LOGO_PATH, width=1.6 * inch, height=0.65 * inch, kind="proportional")]
        except Exception:
            pass
    address_block = [
        Paragraph(f"<b>{SEALTECH['name']}</b>", s["value"]),
        Paragraph(SEALTECH["address"], s["small"]),
        Paragraph(f"ph: {SEALTECH['phone']}", s["small"]),
    ]
    title_block = [
        Paragraph(f'<para align="right" textColor="#062B67"><b>{title_text}</b></para>',
                  ParagraphStyle("hdr_title", fontName="Helvetica-Bold", fontSize=22, leading=26, textColor=BLUE)),
        Paragraph(
            f'<para align="right">Date: {wo.get("wo_date") or datetime.now(timezone.utc).strftime("%m/%d/%Y")}</para>',
            s["value"],
        ),
    ]
    header = Table([[logo_cell, address_block, title_block]],
                   colWidths=[1.8 * inch, 3.2 * inch, 2.5 * inch])
    header.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    story.append(header)
    story.append(Spacer(1, 0.12 * inch))

    # ---- Issued-to (Subcontractor) block ----
    sub_rows = [
        [Paragraph("COMPANY NAME", s["label"]), Paragraph(wo.get("sub_company") or "—", s["value"])],
        [Paragraph("COMPANY ADDRESS", s["label"]), Paragraph(wo.get("sub_address") or "—", s["value"])],
        [Paragraph("COMPANY CONTACT", s["label"]), Paragraph(wo.get("sub_contact") or "—", s["value"])],
    ]
    sub_table = Table(sub_rows, colWidths=[1.5 * inch, 6.0 * inch])
    sub_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, -1), LIGHT),
        ("GRID", (0, 0), (-1, -1), 0.5, BORDER),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(sub_table)
    story.append(Spacer(1, 0.12 * inch))

    # ---- NOTES ----
    story.append(Paragraph("NOTES", s["h2"]))
    notes = wo.get("notes") or (
        "Subcontractor agrees to perform the Work described in this Work Order, "
        "including the application of the roof system in strict accordance with "
        "the manufacturer's specifications (see attached). Subcontractor shall "
        "furnish all labor, materials, insurance, supervision, and equipment "
        "necessary to complete the Work in a professional and workmanlike "
        "manner. Any required warranties shall be provided by Subcontractor or "
        "Contractor as specified in the Work Order or by prior agreement. All "
        "items referenced above are collectively referred to as the \u201cWork.\u201d"
    )
    notes_box = Table([[Paragraph(notes, s["body"])]], colWidths=[7.5 * inch])
    notes_box.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.5, BORDER),
        ("BACKGROUND", (0, 0), (-1, -1), LIGHT),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    story.append(notes_box)
    story.append(Spacer(1, 0.12 * inch))

    # ---- Project Details ----
    proj_header = [Paragraph("PROJECT NAME", s["label"]),
                   Paragraph("PROJECT ADDRESS", s["label"]),
                   Paragraph("CONTRACTOR", s["label"])]
    proj_row = [
        Paragraph(wo.get("project_name") or "—", s["value"]),
        Paragraph(wo.get("project_address") or "—", s["value"]),
        Paragraph(wo.get("contractor") or SEALTECH["name"], s["value"]),
    ]
    proj_table = Table([proj_header, proj_row], colWidths=[2.5 * inch, 3.0 * inch, 2.0 * inch])
    proj_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), BLUE),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 8),
        ("GRID", (0, 0), (-1, -1), 0.5, BORDER),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(proj_table)
    story.append(Spacer(1, 0.12 * inch))

    # ---- Work Description table ----
    work_header = [Paragraph("DATE", s["label"]),
                   Paragraph("DESCRIPTION", s["label"]),
                   Paragraph("TOTAL", s["label"])]
    work_row = [
        Paragraph(wo.get("work_date") or datetime.now(timezone.utc).strftime("%m/%d/%Y"), s["value"]),
        Paragraph(wo.get("description") or "—", s["value"]),
        Paragraph(f"${float(wo.get('total') or 0):,.2f}",
                  ParagraphStyle("amt", fontName="Helvetica-Bold", fontSize=11, leading=14, textColor=BLUE, alignment=2)),
    ]
    work_table = Table([work_header, work_row], colWidths=[1.0 * inch, 5.0 * inch, 1.5 * inch])
    work_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), BLUE),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 8),
        ("GRID", (0, 0), (-1, -1), 0.5, BORDER),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    story.append(work_table)
    story.append(Spacer(1, 0.2 * inch))

    # ---- Acceptance block ----
    now_dt = datetime.now(timezone.utc)
    accept_day = now_dt.strftime("%d")
    accept_month = now_dt.strftime("%B")
    accept_year = now_dt.strftime("%Y")
    if signed_signature and signed_signature.get("signed_at"):
        try:
            sdt = datetime.fromisoformat(signed_signature["signed_at"].replace("Z", "+00:00"))
            accept_day = sdt.strftime("%d")
            accept_month = sdt.strftime("%B")
            accept_year = sdt.strftime("%Y")
        except Exception:
            pass
    story.append(Paragraph(
        f"<b>Accepted this {accept_day} day of {accept_month}, {accept_year}.</b>",
        s["body"],
    ))
    story.append(Spacer(1, 0.20 * inch))

    # Signature lines (subcontractor + contractor)
    sig_left_lines = [Paragraph("<b>Subcontractor:</b>", s["sig"])]
    sig_right_lines = [Paragraph("<b>Contractor:</b>", s["sig"])]

    if signed_signature and signed_signature.get("text"):
        # Typed cursive — render the typed name. ReportLab can't load arbitrary
        # Google Fonts without registration, so we use Helvetica-Oblique as a
        # universally-supported visual stand-in for the cursive style. The
        # ProposalSign UI saves the user-chosen font name as metadata; renders
        # as oblique here so the PDF stays self-contained.
        sig_left_lines.append(Spacer(1, 0.18 * inch))
        sig_left_lines.append(Paragraph(
            f'<font face="Helvetica-Oblique" size="16" color="#062B67">{signed_signature["text"]}</font>',
            s["sig"],
        ))
        sig_left_lines.append(Paragraph(
            "_______________________________________",
            s["small"],
        ))
        sig_left_lines.append(Paragraph(
            f"Signed electronically  ·  {signed_signature.get('signed_at','').split('T')[0]}",
            s["small"],
        ))
    elif signed_signature and signed_signature.get("image_bytes"):
        try:
            sig_left_lines.append(Spacer(1, 0.10 * inch))
            sig_left_lines.append(Image(BytesIO(signed_signature["image_bytes"]),
                                        width=2.5 * inch, height=0.6 * inch,
                                        kind="proportional"))
            sig_left_lines.append(Paragraph(
                "_______________________________________",
                s["small"],
            ))
            sig_left_lines.append(Paragraph(
                f"Signed electronically  ·  {signed_signature.get('signed_at','').split('T')[0]}",
                s["small"],
            ))
        except Exception:
            sig_left_lines.append(Paragraph(
                "(drawn signature could not be rendered)", s["small"],
            ))
    else:
        sig_left_lines.append(Spacer(1, 0.20 * inch))
        sig_left_lines.append(Paragraph(
            "_______________________________________", s["small"],
        ))

    sig_right_lines.append(Spacer(1, 0.20 * inch))
    sig_right_lines.append(Paragraph("_______________________________________", s["small"]))
    sig_right_lines.append(Paragraph(SEALTECH["name"], s["small"]))

    sig_table = Table([[sig_left_lines, sig_right_lines]], colWidths=[3.75 * inch, 3.75 * inch])
    sig_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 14),
    ]))
    story.append(sig_table)

    doc.build(story)
    buf.seek(0)
    return buf.read()


# ------------------ Scope auto-populate ------------------
def _auto_scope_from_deal(deal: dict, db) -> str:
    """Build a default DESCRIPTION blurb for the Work Order from the deal's
    resolved scope. Pulls scope_1 (Inspection & Prep — same for everyone) +
    the template's `wo_scope_2` if present (Work-Order-tailored), otherwise
    scope_2 (customer-facing). FARM templates ship a wo_scope_2 that ends
    with a "Manufacturer Spec:" placeholder so the rep pastes the spec from
    Library → Western Colloid → Specifications before sending."""
    try:
        from spec_sheet import _resolve_template, _apply_scope_overrides
        base = _resolve_template(deal.get("proposed_roof_type") or "")
        eff = _apply_scope_overrides(base, deal.get("scope_overrides") or {})
        chunks = []
        if eff.get("scope_1"):
            chunks.append(f"<b>{eff.get('scope_1_title', 'Inspection and Prep')}</b>")
            chunks.extend([f"• {b}" for b in eff["scope_1"]])
        # The template can supply a Work-Order-only override list. When the
        # template's `wo_scope_2_title` is None, the override bullets are
        # appended directly to the same list (no section header) — used by
        # FARM so the sub sees one continuous scope of work.
        if "wo_scope_2" in base:
            wo_bullets = base.get("wo_scope_2") or []
            wo_title = base.get("wo_scope_2_title")
            if wo_title:
                chunks.append(f"<br/><b>{wo_title}</b>")
            chunks.extend([f"• {b}" for b in wo_bullets])
        elif eff.get("scope_2"):
            chunks.append(f"<br/><b>{eff.get('scope_2_title', 'Application')}</b>")
            chunks.extend([f"• {b}" for b in eff["scope_2"]])
        return "<br/>".join(chunks)
    except Exception:
        return ""


# ------------------ Stage flip helper ------------------
SUB_ENGAGED_STAGE = "Sub Engaged"


async def _flip_to_sub_engaged(db, deal_id: str):
    """Move the deal into the "Sub Engaged" Kanban stage on signature."""
    await db.deals.update_one(
        {"id": deal_id},
        {"$set": {
            "subcontractor_accepted": True,
            "subcontractor_accepted_at": _now_iso(),
            "stage": SUB_ENGAGED_STAGE,
            "updated_at": _now_iso(),
        }},
    )


async def _build_deal_spec_pdf(db, deal: dict) -> Optional[bytes]:
    """Build the customer's Spec Sheet PDF so we can attach it to the Work
    Order email — the sub then sees the same scope the customer signed.
    Returns None if anything goes wrong (the WO email still ships)."""
    try:
        from spec_sheet import build_spec_sheet
        from storage import get_object
        cover_bytes = None
        cover_id = deal.get("cover_photo_file_id")
        if not cover_id:
            ph = await db.project_photos.find_one(
                {"deal_id": deal["id"], "is_cover": True, "is_deleted": {"$ne": True}},
                {"_id": 0, "id": 1, "storage_path": 1},
            )
            if ph and ph.get("storage_path"):
                try:
                    cover_bytes = get_object(ph["storage_path"])
                except Exception:
                    cover_bytes = None
        else:
            f = await db.files.find_one({"id": cover_id, "is_deleted": {"$ne": True}}, {"_id": 0, "storage_path": 1})
            if f and f.get("storage_path"):
                try:
                    cover_bytes = get_object(f["storage_path"])
                except Exception:
                    cover_bytes = None

        prop = None
        if deal.get("property_id"):
            prop = await db.properties.find_one({"id": deal["property_id"]}, {"_id": 0})
        contact = None
        if deal.get("primary_contact_id"):
            contact = await db.contacts.find_one({"id": deal["primary_contact_id"]}, {"_id": 0})

        data = {
            "deal": deal, "property": prop or {}, "contact": contact or {},
            "scope_overrides": deal.get("scope_overrides") or {},
            "color": deal.get("roof_color") or "white",
            "total_sqft": deal.get("roof_sqft") or 0,
            "opt_25": float(deal.get("proposal_option_25yr") or 0),
            "opt_20": float(deal.get("proposal_option_20yr") or 0),
            "opt_15": float(deal.get("proposal_option_15yr") or 0),
            "opt_10": float(deal.get("proposal_option_10yr") or 0),
            "w25": float(deal.get("warranty_25yr_add") or 0),
            "w20": float(deal.get("warranty_20yr_add") or 0),
            "w15": float(deal.get("warranty_15yr_add") or 0),
            "w10": float(deal.get("warranty_10yr_add") or 0),
        }
        return build_spec_sheet(data, cover_photo_bytes=cover_bytes,
                                roof_type=deal.get("proposed_roof_type"))
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning(
            "Spec sheet attach failed for deal %s: %r", deal.get("id"), e,
        )
        return None


def _send_email(to: str, subject: str, html: str,
                attachments: Optional[list] = None) -> bool:
    """Send an outbound email via the same Gmail SMTP config the rest of the
    app uses. `attachments` is a list of dicts: {bytes, filename, mime?}.
    Returns True on success; False on any failure (caller logs)."""
    host = os.environ.get("SMTP_HOST")
    user = os.environ.get("SMTP_USER")
    pw   = os.environ.get("SMTP_PASSWORD") or os.environ.get("SMTP_PASS")
    port = int(os.environ.get("SMTP_PORT") or 587)
    sender = os.environ.get("SMTP_FROM") or user
    if not all([host, user, pw, sender]):
        return False
    msg = MIMEMultipart()
    msg["From"] = sender
    msg["To"] = to
    msg["Subject"] = subject
    msg.attach(MIMEText(html, "html"))
    for att in (attachments or []):
        if not att or not att.get("bytes"):
            continue
        sub_type = (att.get("mime") or "pdf").split("/")[-1]
        part = MIMEBase("application", sub_type)
        part.set_payload(att["bytes"])
        encoders.encode_base64(part)
        part.add_header("Content-Disposition", f'attachment; filename="{att.get("filename", "attachment.pdf")}"')
        msg.attach(part)
    try:
        with smtplib.SMTP(host, port, timeout=20) as srv:
            srv.starttls()
            srv.login(user, pw)
            srv.sendmail(sender, [to], msg.as_string())
        return True
    except Exception:
        return False


# ------------------ Router ------------------
def create_router(db, get_current_user, app_url_for_public_links: str):
    router = APIRouter(prefix="/deals", tags=["work-orders"])

    @router.get("/{deal_id}/work-order/draft")
    async def get_draft(deal_id: str, _user=Depends(get_current_user)):
        """Return an auto-populated Work Order draft for the deal so the rep
        can edit any field before sending. Includes the existing persisted
        work_orders row if one exists; otherwise builds from the deal."""
        deal = await db.deals.find_one({"id": deal_id, "is_deleted": {"$ne": True}}, {"_id": 0})
        if not deal:
            raise HTTPException(404, "Deal not found")
        existing = await db.work_orders.find_one({"deal_id": deal_id, "is_deleted": {"$ne": True}}, {"_id": 0})
        prop = None
        if deal.get("property_id"):
            prop = await db.properties.find_one({"id": deal["property_id"]}, {"_id": 0})
        sub = None
        if deal.get("primary_subcontractor_id"):
            # Subcontractors live in the `vendors` collection with kind="Subcontractor"
            sub = await db.vendors.find_one(
                {"id": deal["primary_subcontractor_id"], "kind": "Subcontractor"},
                {"_id": 0},
            )
        # Default total = chosen amount on the deal (the price the customer is paying)
        chosen = float(deal.get("chosen_amount") or 0)
        return {
            "existing": existing,
            "draft": {
                "deal_id": deal_id,
                "wo_date": datetime.now(timezone.utc).strftime("%m/%d/%Y"),
                "project_name": deal.get("title") or "",
                "project_address": (prop or {}).get("address") or deal.get("title") or "",
                "contractor": (sub or {}).get("name") or "",
                "sub_company": (sub or {}).get("name") or "",
                "sub_address": (sub or {}).get("address") or "",
                "sub_contact": (sub or {}).get("contact_name") or "",
                "sub_email": (sub or {}).get("email") or "",
                "work_date": datetime.now(timezone.utc).strftime("%m/%d/%Y"),
                "description": _auto_scope_from_deal(deal, db),
                "total": chosen,
                "notes": "",
            },
        }

    @router.post("/{deal_id}/work-order/preview")
    async def preview(deal_id: str, body: dict = Body(...), _user=Depends(get_current_user)):
        """Render an in-memory preview PDF from the unsaved draft."""
        deal = await db.deals.find_one({"id": deal_id, "is_deleted": {"$ne": True}}, {"_id": 0})
        if not deal:
            raise HTTPException(404, "Deal not found")
        pdf = build_work_order_pdf(body)
        return StreamingResponse(
            BytesIO(pdf), media_type="application/pdf",
            headers={"Content-Disposition": 'inline; filename="WorkOrder-preview.pdf"'},
        )

    @router.post("/{deal_id}/work-order/send")
    async def send(deal_id: str, body: dict = Body(...), _user=Depends(get_current_user)):
        """Persist the Work Order, mint a sign token, email the sub a public
        sign link with the PDF attached. Idempotent — re-sending replaces the
        existing draft for the deal (one WO per deal, per the user's spec)."""
        deal = await db.deals.find_one({"id": deal_id, "is_deleted": {"$ne": True}}, {"_id": 0})
        if not deal:
            raise HTTPException(404, "Deal not found")
        sub_email = (body.get("sub_email") or "").strip()
        if not sub_email or "@" not in sub_email:
            raise HTTPException(400, "Subcontractor email is required to send the work order.")
        # Upsert the WO row + mint a sign token if one doesn't exist
        existing = await db.work_orders.find_one({"deal_id": deal_id, "is_deleted": {"$ne": True}})
        sign_token = (existing or {}).get("sign_token") or secrets.token_urlsafe(24)
        wo_id = (existing or {}).get("id") or secrets.token_urlsafe(16)
        doc = {
            "id": wo_id,
            "deal_id": deal_id,
            "sign_token": sign_token,
            "status": "sent",
            "sent_at": _now_iso(),
            "updated_at": _now_iso(),
            "is_deleted": False,
            # Allowlist-copy of the editable fields the rep passed in
            **{k: body.get(k) for k in [
                "wo_date", "project_name", "project_address", "contractor",
                "sub_company", "sub_address", "sub_contact", "sub_email",
                "work_date", "description", "total", "notes",
            ]},
        }
        if existing:
            await db.work_orders.update_one({"id": wo_id}, {"$set": doc})
        else:
            doc["created_at"] = _now_iso()
            await db.work_orders.insert_one(doc)

        # Render the WO PDF and ALSO the customer-signed spec sheet so the
        # sub gets the full scope packet in one email.
        pdf_bytes = build_work_order_pdf(doc)
        spec_pdf_bytes = await _build_deal_spec_pdf(db, deal)
        sign_url = f"{app_url_for_public_links.rstrip('/')}/work-order/sign/{sign_token}"
        html = (
            f"<p>Hello {doc.get('sub_contact') or doc.get('sub_company') or 'team'},</p>"
            f"<p>SealTech Building Solutions has issued you a Work Order for "
            f"<b>{doc.get('project_name')}</b> at <b>{doc.get('project_address')}</b>.</p>"
            f"<p>Total: <b>${float(doc.get('total') or 0):,.2f}</b></p>"
            f"<p>Two documents are attached: the Work Order itself and the project Spec Sheet "
            f"showing the full scope of work the customer signed off on. Please review both "
            f"and click the link below to e-sign and accept the work:</p>"
            f'<p><a href="{sign_url}" style="background:#062B67;color:#fff;padding:10px 18px;text-decoration:none;border-radius:4px;display:inline-block;font-weight:bold;">REVIEW &amp; SIGN WORK ORDER</a></p>'
            f"<p>Or copy the link:<br/><code>{sign_url}</code></p>"
            f"<p>— SealTech Building Solutions</p>"
        )
        attachments = [{"bytes": pdf_bytes, "filename": "SealTech-WorkOrder.pdf", "mime": "application/pdf"}]
        if spec_pdf_bytes:
            attachments.append({"bytes": spec_pdf_bytes, "filename": "SealTech-SpecSheet.pdf", "mime": "application/pdf"})
        ok = _send_email(sub_email, f"Work Order — {doc.get('project_name')}", html, attachments=attachments)
        return {"ok": True, "email_sent": ok, "sign_token": sign_token, "sign_url": sign_url,
                "work_order_id": wo_id, "spec_attached": bool(spec_pdf_bytes)}

    @router.get("/{deal_id}/work-order/pdf")
    async def admin_pdf(deal_id: str, _user=Depends(get_current_user)):
        """Internal: download the most recent persisted Work Order PDF
        (signed if the sub has e-signed, otherwise the unsigned version)."""
        wo = await db.work_orders.find_one({"deal_id": deal_id, "is_deleted": {"$ne": True}}, {"_id": 0})
        if not wo:
            raise HTTPException(404, "No Work Order has been created for this deal yet.")
        signed_sig = wo.get("signed_signature")  # populated after public sign
        pdf = build_work_order_pdf(wo, signed_signature=signed_sig)
        return StreamingResponse(
            BytesIO(pdf), media_type="application/pdf",
            headers={"Content-Disposition": 'inline; filename="SealTech-WorkOrder.pdf"'},
        )

    return router


# ------------------ Public sign router ------------------
def create_public_router(db, app_url_for_public_links: str):
    router = APIRouter(prefix="/work-order", tags=["work-orders-public"])

    @router.get("/{token}")
    async def view(token: str):
        wo = await db.work_orders.find_one({"sign_token": token, "is_deleted": {"$ne": True}}, {"_id": 0})
        if not wo:
            raise HTTPException(404, "Work order not found or revoked")
        return {
            "id": wo["id"],
            "already_signed": bool(wo.get("signed_at")),
            "signed_at": wo.get("signed_at"),
            "signed_by_name": wo.get("signed_by_name"),
            "fields": {k: wo.get(k) for k in [
                "wo_date", "project_name", "project_address", "contractor",
                "sub_company", "sub_address", "sub_contact",
                "work_date", "description", "total", "notes",
            ]},
        }

    @router.get("/{token}/pdf")
    async def public_pdf(token: str):
        wo = await db.work_orders.find_one({"sign_token": token, "is_deleted": {"$ne": True}}, {"_id": 0})
        if not wo:
            raise HTTPException(404, "Work order not found or revoked")
        pdf = build_work_order_pdf(wo, signed_signature=wo.get("signed_signature"))
        return StreamingResponse(
            BytesIO(pdf), media_type="application/pdf",
            headers={"Content-Disposition": 'inline; filename="SealTech-WorkOrder.pdf"'},
        )

    @router.post("/{token}/sign")
    async def sign(token: str, body: dict = Body(...)):
        wo = await db.work_orders.find_one({"sign_token": token, "is_deleted": {"$ne": True}})
        if not wo:
            raise HTTPException(404, "Work order not found or revoked")
        if wo.get("signed_at"):
            return {"ok": True, "already_signed": True, "signed_at": wo["signed_at"]}
        name = (body.get("signer_name") or "").strip()
        signed_text = (body.get("signature_text") or "").strip()
        signed_font = (body.get("signature_font") or "").strip()[:40]
        drawn = (body.get("signature_data_url") or "").strip()
        accepted = bool(body.get("accepted"))
        if not accepted or not name or (not signed_text and not drawn):
            raise HTTPException(400, "Acceptance, signer name, and a typed or drawn signature are required.")
        signed_signature = {"signed_at": _now_iso()}
        if drawn and drawn.startswith("data:image/"):
            try:
                import base64
                head, _, b64 = drawn.partition(",")
                ct = "image/png" if "image/png" in head else ("image/jpeg" if "image/jpeg" in head else "image/png")
                img_bytes = base64.b64decode(b64)
                if len(img_bytes) > 2_500_000:
                    raise ValueError("signature image too large")
                signed_signature.update(image_bytes=img_bytes, content_type=ct)
            except Exception:
                # Fall back to typed if the drawn payload is malformed
                signed_signature.update(text=signed_text or name, font=signed_font or "Caveat")
        else:
            signed_signature.update(text=signed_text or name, font=signed_font or "Caveat")

        # Build the signed PDF and stash it on a Mongo file ref (for audit + library)
        pdf_bytes = build_work_order_pdf(wo, signed_signature=signed_signature)
        signed_file_id = secrets.token_urlsafe(16)
        # Persist signed signature as plain dict (image_bytes excluded so we can
        # re-render later — we keep just text/font; drawn signatures get
        # written to the files collection as PNG/JPEG attachments).
        persist_sig = {k: v for k, v in signed_signature.items() if k != "image_bytes"}
        if signed_signature.get("image_bytes"):
            try:
                from storage import put_object, APP_NAME
                sp = f"{APP_NAME}/uploads/deal/{wo['deal_id']}/wo-signature-{signed_file_id}.png"
                put_object(sp, signed_signature["image_bytes"], signed_signature.get("content_type") or "image/png")
                await db.files.insert_one({
                    "id": signed_file_id, "parent_type": "deal", "parent_id": wo["deal_id"],
                    "category": "Signature", "storage_path": sp,
                    "original_filename": f"wo-signature-{wo['deal_id'][:8]}.png",
                    "content_type": signed_signature.get("content_type") or "image/png",
                    "size": len(signed_signature["image_bytes"]),
                    "is_deleted": False, "uploaded_by": "public-sign",
                    "uploaded_at": _now_iso(), "created_at": _now_iso(),
                })
                persist_sig["signature_file_id"] = signed_file_id
            except Exception:
                pass

        await db.work_orders.update_one(
            {"id": wo["id"]},
            {"$set": {
                "status": "signed",
                "signed_at": signed_signature["signed_at"],
                "signed_by_name": name,
                "signed_signature": persist_sig,
                "updated_at": _now_iso(),
            }},
        )

        # Flip the deal to "Sub Engaged" stage + accepted flag
        await _flip_to_sub_engaged(db, wo["deal_id"])

        # Notify the rep (deal's assigned user, or any admin if not set)
        deal = await db.deals.find_one({"id": wo["deal_id"]}, {"_id": 0, "assigned_user_id": 1, "title": 1})
        rep_email = None
        if deal and deal.get("assigned_user_id"):
            u = await db.users.find_one({"id": deal["assigned_user_id"]}, {"_id": 0, "email": 1})
            rep_email = (u or {}).get("email")
        if not rep_email:
            rep_email = os.environ.get("SMTP_FROM")
        if rep_email:
            _send_email(
                rep_email,
                f"Work Order signed — {wo.get('project_name')}",
                f"<p><b>{name}</b> just signed the Work Order for <b>{wo.get('project_name')}</b>.</p>"
                f"<p>Signed at: {signed_signature['signed_at']}.</p>"
                f"<p>The deal has been moved to the <b>Sub Engaged</b> stage.</p>",
                attachments=[{"bytes": pdf_bytes, "filename": "SealTech-WorkOrder-Signed.pdf",
                              "mime": "application/pdf"}],
            )
        return {"ok": True, "signed_at": signed_signature["signed_at"], "already_signed": False}

    return router
