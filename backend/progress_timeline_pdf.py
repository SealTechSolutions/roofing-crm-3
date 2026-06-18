"""Progress Timeline PDF — chronological photo album for a project.

Generates a single PDF that walks the project from earliest to latest photos,
grouped by the calendar date each photo was taken (`created_at`). Designed as
a close-out / insurance-packet attachment so the contractor doesn't have to
manually screenshot-and-email dozens of individual photos.

Layout:
- Cover page: project title, address, generation timestamp, total photo count.
- Per-date section: bold date heading ("Today" / "Yesterday" / "Mon, Jun 15"),
  then a 2-column photo grid; each photo card has the image + filename caption.
"""
from __future__ import annotations

import io
from datetime import datetime, timezone, date as date_cls
from typing import List, Dict, Tuple

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image as RLImage,
    PageBreak, KeepTogether,
)

from storage import get_object


PAGE_W, PAGE_H = letter
MARGIN_X = 0.5 * inch
MARGIN_Y = 0.5 * inch
CONTENT_W = PAGE_W - 2 * MARGIN_X
PHOTOS_PER_ROW = 2
CELL_GAP = 0.15 * inch
CELL_W = (CONTENT_W - (PHOTOS_PER_ROW - 1) * CELL_GAP) / PHOTOS_PER_ROW
CELL_PHOTO_H = 3.0 * inch  # max height per photo; ReportLab will preserve aspect


def _styles():
    base = getSampleStyleSheet()
    return {
        "cover_eyebrow": ParagraphStyle(
            "cover_eyebrow", parent=base["Normal"], fontName="Helvetica-Bold",
            fontSize=9, textColor=colors.HexColor("#475569"), alignment=TA_CENTER,
            spaceAfter=6, leading=11, tracking=2,
        ),
        "cover_title": ParagraphStyle(
            "cover_title", parent=base["Normal"], fontName="Helvetica-Bold",
            fontSize=24, textColor=colors.HexColor("#0f172a"), alignment=TA_CENTER,
            spaceAfter=10, leading=28,
        ),
        "cover_sub": ParagraphStyle(
            "cover_sub", parent=base["Normal"], fontName="Helvetica",
            fontSize=11, textColor=colors.HexColor("#475569"), alignment=TA_CENTER,
            spaceAfter=4, leading=14,
        ),
        "date_heading": ParagraphStyle(
            "date_heading", parent=base["Normal"], fontName="Helvetica-Bold",
            fontSize=14, textColor=colors.HexColor("#0f172a"), alignment=TA_LEFT,
            spaceAfter=4, spaceBefore=10,
        ),
        "date_sub": ParagraphStyle(
            "date_sub", parent=base["Normal"], fontName="Helvetica",
            fontSize=9, textColor=colors.HexColor("#64748b"), alignment=TA_LEFT,
            spaceAfter=10,
        ),
        "caption": ParagraphStyle(
            "caption", parent=base["Normal"], fontName="Helvetica",
            fontSize=8, textColor=colors.HexColor("#475569"), alignment=TA_CENTER,
            spaceBefore=4, leading=10,
        ),
        "footer": ParagraphStyle(
            "footer", parent=base["Normal"], fontName="Helvetica",
            fontSize=7, textColor=colors.HexColor("#94a3b8"), alignment=TA_CENTER,
        ),
    }


def _parse_iso(s: str) -> datetime | None:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return None


def _friendly_date_label(d: date_cls, today: date_cls) -> str:
    """Today / Yesterday / Mon, Jun 15 (year omitted when same year)."""
    delta = (today - d).days
    if delta == 0:
        return "Today"
    if delta == 1:
        return "Yesterday"
    fmt = "%a, %b %-d" if d.year == today.year else "%a, %b %-d, %Y"
    try:
        return d.strftime(fmt)
    except ValueError:
        # Windows doesn't support `%-d`; fall back.
        return d.strftime(fmt.replace("%-d", "%d"))


def _group_by_date(photos: List[dict]) -> List[Tuple[date_cls | None, str, List[dict]]]:
    """Returns [(date_obj_or_None, label, photos_sorted_ascending), ...] oldest first."""
    today = datetime.now(timezone.utc).date()
    buckets: Dict[date_cls | None, List[dict]] = {}
    for p in photos:
        dt = _parse_iso(p.get("created_at", "")) if isinstance(p.get("created_at"), str) else p.get("created_at")
        d_only = dt.date() if isinstance(dt, datetime) else None
        buckets.setdefault(d_only, []).append(p)
    # Sort each bucket by created_at ascending
    for k in buckets:
        buckets[k].sort(key=lambda p: str(p.get("created_at", "")))
    # Order the day-keys: None (no-date) goes LAST; otherwise oldest-first.
    ordered_keys = sorted(
        buckets.keys(),
        key=lambda d: (d is None, d or date_cls.min),
    )
    out = []
    for k in ordered_keys:
        label = "No date" if k is None else _friendly_date_label(k, today)
        out.append((k, label, buckets[k]))
    return out


def _photo_cell(photo: dict, styles) -> Table:
    """A single cell of the photo grid — image on top + caption below."""
    img_flow = None
    try:
        data, _ct = get_object(photo["storage_path"])
        # Decode eagerly with PIL so a corrupt JPEG fails here (and falls
        # through to the placeholder) instead of crashing the entire
        # SimpleDocTemplate.build() pass at render time.
        from PIL import Image as PILImage  # type: ignore
        verify_buf = io.BytesIO(data)
        with PILImage.open(verify_buf) as probe:
            probe.load()
        bio = io.BytesIO(data)
        img = RLImage(bio, hAlign="CENTER")
        # Scale into the available cell while preserving aspect ratio. Guard
        # against zero-dimension images (would otherwise produce Infinity).
        src_w = float(img.imageWidth or 0)
        src_h = float(img.imageHeight or 0)
        max_w = CELL_W - 6
        if src_w > 0 and src_h > 0:
            scale = min(max_w / src_w, CELL_PHOTO_H / src_h)
            img.drawWidth = max(1.0, src_w * scale)
            img.drawHeight = max(1.0, src_h * scale)
        else:
            img.drawWidth = max_w
            img.drawHeight = CELL_PHOTO_H
        img_flow = img
    except Exception:
        img_flow = Paragraph("<i>(image unavailable)</i>", styles["caption"])
    label = photo.get("display_name") or photo.get("original_filename") or "Photo"
    dt = _parse_iso(photo.get("created_at", ""))
    try:
        when = dt.strftime("%-I:%M %p") if dt else ""
    except ValueError:
        when = dt.strftime("%I:%M %p") if dt else ""
    caption_html = f"<b>{label}</b>" + (f" &nbsp; <font color='#94a3b8'>{when}</font>" if when else "")
    cell = Table(
        [[img_flow], [Paragraph(caption_html, styles["caption"])]],
        colWidths=[CELL_W],
    )
    cell.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 1), (-1, 1), 6),
    ]))
    return cell


def build_progress_timeline_pdf(deal: dict, photos: List[dict], property_doc: dict | None = None) -> bytes:
    """Render the timeline PDF and return its bytes.

    `photos` must already be filtered to non-deleted records. Caller can choose
    whether to include all tags/albums or filter beforehand.
    """
    styles = _styles()
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=letter,
        leftMargin=MARGIN_X, rightMargin=MARGIN_X,
        topMargin=MARGIN_Y, bottomMargin=MARGIN_Y,
        title=f"{deal.get('title','Project')} — Progress Timeline",
    )
    story = []

    # ---------- Cover ----------
    story.append(Spacer(1, 1.4 * inch))
    story.append(Paragraph("PROJECT PROGRESS TIMELINE", styles["cover_eyebrow"]))
    story.append(Paragraph(deal.get("title") or "Project", styles["cover_title"]))
    addr_parts = []
    if property_doc:
        for k in ("street1", "street2", "city", "state", "zip"):
            v = property_doc.get(k)
            if v:
                addr_parts.append(str(v))
    if addr_parts:
        story.append(Paragraph(" · ".join(addr_parts), styles["cover_sub"]))
    story.append(Spacer(1, 0.35 * inch))
    story.append(Paragraph(
        f"{len(photos)} photo{'s' if len(photos) != 1 else ''} · generated {datetime.now(timezone.utc).strftime('%b %d, %Y at %H:%M UTC')}",
        styles["cover_sub"]
    ))
    if deal.get("deal_type"):
        story.append(Paragraph(deal.get("deal_type"), styles["cover_sub"]))
    story.append(PageBreak())

    # ---------- Body: per-date sections ----------
    if not photos:
        story.append(Paragraph("No photos in this project yet.", styles["caption"]))
    else:
        groups = _group_by_date(photos)
        for _key, label, group_photos in groups:
            story.append(Paragraph(label, styles["date_heading"]))
            story.append(Paragraph(
                f"{len(group_photos)} photo{'s' if len(group_photos) != 1 else ''}",
                styles["date_sub"]
            ))
            # Build rows of PHOTOS_PER_ROW cells each.
            row: List = []
            for p in group_photos:
                row.append(_photo_cell(p, styles))
                if len(row) == PHOTOS_PER_ROW:
                    tbl = Table([row], colWidths=[CELL_W] * PHOTOS_PER_ROW, hAlign="LEFT")
                    tbl.setStyle(TableStyle([
                        ("LEFTPADDING", (0, 0), (-1, -1), 0),
                        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                        ("TOPPADDING", (0, 0), (-1, -1), 0),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
                        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                    ]))
                    story.append(tbl)
                    row = []
            if row:
                # Fill remaining slots with empty cells so columns stay aligned.
                while len(row) < PHOTOS_PER_ROW:
                    row.append("")
                tbl = Table([row], colWidths=[CELL_W] * PHOTOS_PER_ROW, hAlign="LEFT")
                tbl.setStyle(TableStyle([
                    ("LEFTPADDING", (0, 0), (-1, -1), 0),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                    ("TOPPADDING", (0, 0), (-1, -1), 0),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
                ]))
                story.append(tbl)
            story.append(Spacer(1, 0.1 * inch))

    doc.build(story)
    return buf.getvalue()
