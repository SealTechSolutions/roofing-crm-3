"""Maintenance Report PDF — client-ready roof condition report.

Compiles all project photos (preferring the annotated versions when
available) into a professional PDF organized by **damage type / photo
tag**, not by date. Designed as a same-day deliverable that a rep can
email to a client (or their insurance adjuster) after a site visit.

Layout:
- Cover page: property, inspector, date, executive summary counts
- Sections in priority order (damage first, drone last):
    Damage Documentation → Detail Shots → Before → During → After → Drone → (Untagged)
- Each section: bold header + description + 2-col photo grid with
  captions showing filename, capture time, and any custom description
  the rep saved on the photo

Annotation handling:
- If a photo has `annotated_storage_path`, that flattened PNG is used
  (arrows/circles/text markup burned in). Otherwise the raw source.
- We surface a small "Annotated" chip in the caption so the client
  knows which shots were called out by the inspector.
"""
from __future__ import annotations

import io
from datetime import datetime, timezone
from typing import List, Dict, Tuple, Optional

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image as RLImage,
    PageBreak,
)

from storage import get_object


PAGE_W, PAGE_H = letter
MARGIN_X = 0.5 * inch
MARGIN_Y = 0.5 * inch
CONTENT_W = PAGE_W - 2 * MARGIN_X
PHOTOS_PER_ROW = 2
CELL_GAP = 0.15 * inch
CELL_W = (CONTENT_W - (PHOTOS_PER_ROW - 1) * CELL_GAP) / PHOTOS_PER_ROW
CELL_PHOTO_H = 3.1 * inch

# Damage / observation sections in priority order — damage first so the
# client sees the issues that drive the proposal on page 2, drone / after
# shots at the back as supporting context.
TAG_ORDER = [
    "Damage Documentation",
    "Detail Shots",
    "Before",
    "During",
    "After",
    "Drone",
]

TAG_DESCRIPTIONS = {
    "Damage Documentation": "Existing conditions requiring remediation. Areas circled/annotated in red should be treated as high priority.",
    "Detail Shots":         "Close-up inspection photos highlighting membrane, flashing, and seam conditions.",
    "Before":               "Baseline pre-work documentation of the roof system.",
    "During":               "Work-in-progress captures showing prep, base coat, and reinforcement application.",
    "After":                "Post-completion photos of finished coating system.",
    "Drone":                "Aerial context photos of the full roof plane and adjacent structures.",
}


def _styles():
    base = getSampleStyleSheet()
    return {
        "cover_eyebrow": ParagraphStyle(
            "cover_eyebrow", parent=base["Normal"], fontName="Helvetica-Bold",
            fontSize=9, textColor=colors.HexColor("#1d4ed8"), alignment=TA_CENTER,
            spaceAfter=8, leading=11,
        ),
        "cover_title": ParagraphStyle(
            "cover_title", parent=base["Normal"], fontName="Helvetica-Bold",
            fontSize=26, textColor=colors.HexColor("#0f172a"), alignment=TA_CENTER,
            spaceAfter=10, leading=30,
        ),
        "cover_sub": ParagraphStyle(
            "cover_sub", parent=base["Normal"], fontName="Helvetica",
            fontSize=11, textColor=colors.HexColor("#475569"), alignment=TA_CENTER,
            spaceAfter=4, leading=15,
        ),
        "cover_meta_label": ParagraphStyle(
            "cover_meta_label", parent=base["Normal"], fontName="Helvetica-Bold",
            fontSize=8, textColor=colors.HexColor("#94a3b8"), alignment=TA_LEFT,
            spaceAfter=1, leading=10,
        ),
        "cover_meta_val": ParagraphStyle(
            "cover_meta_val", parent=base["Normal"], fontName="Helvetica-Bold",
            fontSize=12, textColor=colors.HexColor("#0f172a"), alignment=TA_LEFT,
            leading=15,
        ),
        "section_eyebrow": ParagraphStyle(
            "section_eyebrow", parent=base["Normal"], fontName="Helvetica-Bold",
            fontSize=8, textColor=colors.HexColor("#1d4ed8"), alignment=TA_LEFT,
            spaceBefore=8, spaceAfter=2, leading=10,
        ),
        "section_heading": ParagraphStyle(
            "section_heading", parent=base["Normal"], fontName="Helvetica-Bold",
            fontSize=18, textColor=colors.HexColor("#0f172a"), alignment=TA_LEFT,
            spaceAfter=4, leading=22,
        ),
        "section_desc": ParagraphStyle(
            "section_desc", parent=base["Normal"], fontName="Helvetica",
            fontSize=10, textColor=colors.HexColor("#475569"), alignment=TA_LEFT,
            spaceAfter=12, leading=14,
        ),
        "caption": ParagraphStyle(
            "caption", parent=base["Normal"], fontName="Helvetica",
            fontSize=8, textColor=colors.HexColor("#475569"), alignment=TA_LEFT,
            spaceBefore=4, leading=11,
        ),
        "caption_annotated": ParagraphStyle(
            "caption_annotated", parent=base["Normal"], fontName="Helvetica-Bold",
            fontSize=7, textColor=colors.HexColor("#047857"), alignment=TA_LEFT,
            leading=9,
        ),
        "summary_row_label": ParagraphStyle(
            "summary_row_label", parent=base["Normal"], fontName="Helvetica",
            fontSize=11, textColor=colors.HexColor("#0f172a"), alignment=TA_LEFT,
            leading=15,
        ),
        "summary_row_count": ParagraphStyle(
            "summary_row_count", parent=base["Normal"], fontName="Helvetica-Bold",
            fontSize=11, textColor=colors.HexColor("#1d4ed8"), alignment=TA_LEFT,
            leading=15,
        ),
        "footer": ParagraphStyle(
            "footer", parent=base["Normal"], fontName="Helvetica",
            fontSize=7, textColor=colors.HexColor("#94a3b8"), alignment=TA_CENTER,
        ),
    }


def _parse_iso(s: str) -> Optional[datetime]:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return None


def _fmt_time(dt: Optional[datetime]) -> str:
    if not dt:
        return ""
    try:
        return dt.strftime("%-I:%M %p")
    except ValueError:
        return dt.strftime("%I:%M %p")


def _fmt_date(dt: Optional[datetime]) -> str:
    if not dt:
        return ""
    try:
        return dt.strftime("%b %-d, %Y")
    except ValueError:
        return dt.strftime("%b %d, %Y")


def _group_by_tag(photos: List[dict]) -> Dict[str, List[dict]]:
    """Bucket photos by tag; unrecognized tags / untagged fall into 'Untagged'."""
    buckets: Dict[str, List[dict]] = {t: [] for t in TAG_ORDER}
    buckets["Untagged"] = []
    for p in photos:
        tag = (p.get("tag") or "").strip()
        if tag in buckets:
            buckets[tag].append(p)
        else:
            buckets["Untagged"].append(p)
    # Sort each bucket by captured_at (or created_at fallback) ascending so
    # the client reads the earliest observation of each type first.
    for k in buckets:
        buckets[k].sort(key=lambda p: str(p.get("captured_at") or p.get("created_at") or ""))
    return buckets


def _photo_cell(photo: dict, styles) -> Table:
    """A single photo cell — image + caption below. Prefers the annotated
    version (arrows/circles/text overlay) when one exists."""
    # Choose the storage path: annotated overlay if the inspector marked
    # up the photo, otherwise the raw source.
    annotated_path = photo.get("annotated_storage_path")
    path = annotated_path or photo.get("storage_path")
    img_flow = None
    if path:
        try:
            data, _ct = get_object(path)
            from PIL import Image as PILImage  # type: ignore
            with PILImage.open(io.BytesIO(data)) as probe:
                probe.load()
            img = RLImage(io.BytesIO(data), hAlign="CENTER")
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
    else:
        img_flow = Paragraph("<i>(image unavailable)</i>", styles["caption"])

    # Caption: display name + capture time + optional inspector note.
    # If the photo is annotated, prepend a small green "ANNOTATED" chip so
    # the client sees which shots were called out by the inspector.
    label = photo.get("display_name") or photo.get("original_filename") or "Photo"
    dt = _parse_iso(photo.get("captured_at") or photo.get("created_at") or "")
    when = _fmt_time(dt)
    date_str = _fmt_date(dt)

    caption_lines = []
    if annotated_path:
        caption_lines.append(Paragraph("★ INSPECTOR ANNOTATED", styles["caption_annotated"]))
    ts_html = f"<b>{label}</b>"
    if date_str or when:
        ts_html += f" &nbsp; <font color='#94a3b8'>{date_str} · {when}</font>" if when else f" &nbsp; <font color='#94a3b8'>{date_str}</font>"
    caption_lines.append(Paragraph(ts_html, styles["caption"]))
    if photo.get("description"):
        # Client note — up to ~120 chars; long notes truncate.
        note = str(photo["description"]).strip()
        if len(note) > 140:
            note = note[:137] + "…"
        caption_lines.append(Paragraph(f'<i>"{note}"</i>', styles["caption"]))

    rows = [[img_flow]]
    for line in caption_lines:
        rows.append([line])
    cell = Table(rows, colWidths=[CELL_W])
    cell.setStyle(TableStyle([
        ("BOX",       (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
        ("VALIGN",    (0, 0), (-1, -1), "TOP"),
        ("ALIGN",     (0, 0), (-1, 0),  "CENTER"),
        ("LEFTPADDING",   (0, 0), (-1, -1), 6),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 6),
        ("TOPPADDING",    (0, 0), (-1, 0),  6),
        ("TOPPADDING",    (0, 1), (-1, -1), 3),
        ("BOTTOMPADDING", (0, -1), (-1, -1), 8),
    ]))
    return cell


def _build_summary_table(buckets: Dict[str, List[dict]], annotated_count: int, styles) -> Table:
    """A one-page executive summary showing count of photos per damage tag."""
    rows: List[List] = [
        [Paragraph("<b>Documentation Type</b>", styles["cover_meta_label"]),
         Paragraph("<b>Photo Count</b>", styles["cover_meta_label"])],
    ]
    for tag in TAG_ORDER:
        n = len(buckets.get(tag, []))
        if n == 0:
            continue
        rows.append([
            Paragraph(tag, styles["summary_row_label"]),
            Paragraph(str(n), styles["summary_row_count"]),
        ])
    if buckets.get("Untagged"):
        rows.append([
            Paragraph("Additional / Untagged", styles["summary_row_label"]),
            Paragraph(str(len(buckets["Untagged"])), styles["summary_row_count"]),
        ])
    rows.append([
        Paragraph("<b>Inspector-Annotated (with markups)</b>", styles["summary_row_label"]),
        Paragraph(f"<b>{annotated_count}</b>", styles["summary_row_count"]),
    ])
    tbl = Table(rows, colWidths=[3.6 * inch, 1.4 * inch], hAlign="LEFT")
    tbl.setStyle(TableStyle([
        ("LINEBELOW",    (0, 0), (-1, 0), 1.0, colors.HexColor("#0f172a")),
        ("LINEBELOW",    (0, -2), (-1, -2), 0.5, colors.HexColor("#cbd5e1")),
        ("BACKGROUND",   (0, -1), (-1, -1), colors.HexColor("#f1f5f9")),
        ("LEFTPADDING",  (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING",   (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING",(0, 0), (-1, -1), 6),
        ("VALIGN",       (0, 0), (-1, -1), "MIDDLE"),
    ]))
    return tbl


def _grid_rows(cells: List, styles) -> List:
    """Wrap a flat list of photo cells into ReportLab Tables of PHOTOS_PER_ROW columns."""
    out: List = []
    row: List = []
    for c in cells:
        row.append(c)
        if len(row) == PHOTOS_PER_ROW:
            tbl = Table([row], colWidths=[CELL_W] * PHOTOS_PER_ROW, hAlign="LEFT")
            tbl.setStyle(TableStyle([
                ("LEFTPADDING",   (0, 0), (-1, -1), 0),
                ("RIGHTPADDING",  (0, 0), (-1, -1), 0),
                ("TOPPADDING",    (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
                ("VALIGN",        (0, 0), (-1, -1), "TOP"),
            ]))
            out.append(tbl)
            row = []
    if row:
        while len(row) < PHOTOS_PER_ROW:
            row.append("")
        tbl = Table([row], colWidths=[CELL_W] * PHOTOS_PER_ROW, hAlign="LEFT")
        tbl.setStyle(TableStyle([
            ("LEFTPADDING",   (0, 0), (-1, -1), 0),
            ("RIGHTPADDING",  (0, 0), (-1, -1), 0),
            ("TOPPADDING",    (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
            ("VALIGN",        (0, 0), (-1, -1), "TOP"),
        ]))
        out.append(tbl)
    return out


def _footer(canvas, doc):
    """Page footer with report ID + page N of M substitute (via pageNumber only —
    ReportLab doesn't know the total until pass 2, so we just show the number)."""
    canvas.saveState()
    canvas.setFont("Helvetica", 7)
    canvas.setFillColor(colors.HexColor("#94a3b8"))
    canvas.drawCentredString(PAGE_W / 2, 0.3 * inch,
                             f"SealTech Building Solutions — Roof Condition Report · Page {doc.page}")
    canvas.restoreState()


def build_maintenance_report_pdf(
    deal: dict,
    photos: List[dict],
    property_doc: Optional[dict] = None,
    inspector_name: str = "",
) -> bytes:
    """Render the maintenance / condition report and return its bytes.

    Photos should already be filtered to non-deleted records. Photos with
    a `tag` field are grouped by tag in priority order (Damage → Drone).
    Photos with an `annotated_storage_path` are rendered using the
    inspector's marked-up version.
    """
    styles = _styles()
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=letter,
        leftMargin=MARGIN_X, rightMargin=MARGIN_X,
        topMargin=MARGIN_Y, bottomMargin=0.6 * inch,
        title=f"{deal.get('title','Project')} — Roof Condition Report",
    )
    story = []

    # ---------- Cover ----------
    story.append(Spacer(1, 1.1 * inch))
    story.append(Paragraph("ROOF CONDITION ASSESSMENT REPORT", styles["cover_eyebrow"]))
    story.append(Paragraph(deal.get("title") or "Project", styles["cover_title"]))

    addr_parts = []
    if property_doc:
        for k in ("street1", "street2", "city", "state", "zip"):
            v = property_doc.get(k)
            if v:
                addr_parts.append(str(v))
    if addr_parts:
        story.append(Paragraph(" · ".join(addr_parts), styles["cover_sub"]))

    story.append(Spacer(1, 0.5 * inch))

    # Meta block: Inspector / Date / Photo count in a 3-col grid
    now_str = datetime.now(timezone.utc).strftime("%B %d, %Y")
    meta_rows = [
        [
            Paragraph("REPORT DATE", styles["cover_meta_label"]),
            Paragraph("INSPECTOR", styles["cover_meta_label"]),
            Paragraph("PHOTOS DOCUMENTED", styles["cover_meta_label"]),
        ],
        [
            Paragraph(now_str, styles["cover_meta_val"]),
            Paragraph(inspector_name or "SealTech Roofing Inspector", styles["cover_meta_val"]),
            Paragraph(f"{len(photos)}", styles["cover_meta_val"]),
        ],
    ]
    meta = Table(meta_rows, colWidths=[CONTENT_W / 3] * 3, hAlign="LEFT")
    meta.setStyle(TableStyle([
        ("BOX",          (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
        ("LINEBELOW",    (0, 0), (-1, 0),  0.5, colors.HexColor("#e2e8f0")),
        ("LEFTPADDING",  (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING",   (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING",(0, 0), (-1, -1), 10),
        ("VALIGN",       (0, 0), (-1, -1), "TOP"),
    ]))
    story.append(meta)
    story.append(Spacer(1, 0.35 * inch))

    # Executive summary
    buckets = _group_by_tag(photos)
    annotated_count = sum(1 for p in photos if p.get("annotated_storage_path"))
    story.append(Paragraph("DOCUMENTATION SUMMARY", styles["cover_eyebrow"]))
    story.append(_build_summary_table(buckets, annotated_count, styles))
    story.append(Spacer(1, 0.25 * inch))
    story.append(Paragraph(
        "This report contains photographic documentation captured during a site visit. "
        "Photos marked with a green &#9733; icon include inspector annotations "
        "(arrows, circles, or text callouts) highlighting areas of concern.",
        styles["section_desc"]
    ))
    story.append(PageBreak())

    # ---------- Body: one section per tag, priority order ----------
    if not photos:
        story.append(Paragraph("No photos have been captured for this project yet.", styles["section_desc"]))
    else:
        rendered_any = False
        section_order = TAG_ORDER + ["Untagged"]
        for tag in section_order:
            group_photos = buckets.get(tag, [])
            if not group_photos:
                continue
            if rendered_any:
                story.append(PageBreak())
            rendered_any = True
            story.append(Paragraph("SECTION", styles["section_eyebrow"]))
            story.append(Paragraph(tag.upper() if tag == "Untagged" else tag, styles["section_heading"]))
            desc = TAG_DESCRIPTIONS.get(tag) or "Additional site documentation."
            annotated_in_group = sum(1 for p in group_photos if p.get("annotated_storage_path"))
            desc_suffix = f" · {len(group_photos)} photo{'s' if len(group_photos) != 1 else ''}"
            if annotated_in_group:
                desc_suffix += f" · {annotated_in_group} with inspector annotations"
            story.append(Paragraph(desc + desc_suffix, styles["section_desc"]))

            cells = [_photo_cell(p, styles) for p in group_photos]
            for row_tbl in _grid_rows(cells, styles):
                story.append(row_tbl)

    doc.build(story, onFirstPage=_footer, onLaterPages=_footer)
    return buf.getvalue()
