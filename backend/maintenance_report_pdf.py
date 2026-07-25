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

# ═══════════════════════════════════════════════════════════════════════
# STBS-format Annual Maintenance Report
#
# Layout (matches the SealTech STBS template exactly):
#   Page 1: Cover — logo area / title / date / For: address
#   Page 2: Building Information — 4-field contact grid + hero photo
#   Page N: Maintenance BEFORE Images — numbered blocks (photo + Observation + Notes)
#   Page N: Maintenance AFTER Images — same structure, independently numbered
#   Page N: Summary — free narrative + Roof Estimated Service Life bar chart
# ═══════════════════════════════════════════════════════════════════════

SERVICE_LIFE_OPTIONS_PDF = ["15-20 Years", "10-15 Years", "5-10 Years", "3-5 Years", "1-3 Years", "<1 Year"]
# Row colors, left→right matching the STBS template's healthy→failing gradient
SERVICE_LIFE_BAR_COLORS = [
    "#166534",  # dark green — 15-20y
    "#84cc16",  # bright green — 10-15y
    "#facc15",  # yellow — 5-10y
    "#fb923c",  # orange — 3-5y
    "#ef4444",  # red — 1-3y
    "#111827",  # near-black — <1y
]
# Progress-bar widths (longer bar = longer service life expectation, matches the
# visual metaphor in the STBS template).
SERVICE_LIFE_BAR_WIDTHS = [1.00, 0.85, 0.70, 0.50, 0.30, 0.15]


def _stbs_photo_bytes(photo: dict, max_px: int = 900) -> Optional[bytes]:
    """Fetch + downscale a single photo. Prefers the annotated version if
    the rep marked it up. Returns None (skips silently) if the object is
    unreadable so a single missing photo can't break the whole report."""
    try:
        from PIL import Image as _PIL
        path = photo.get("annotated_storage_path") or photo.get("storage_path")
        if not path:
            return None
        content, _ct = get_object(path)
        with _PIL.open(io.BytesIO(content)) as img:
            img = img.convert("RGB")
            img.thumbnail((max_px, max_px), _PIL.LANCZOS)
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=85, optimize=True)
            return buf.getvalue()
    except Exception:
        return None


def _stbs_photo_flowable(photo: dict, target_w: float, target_h: float):
    """Return an RLImage sized to fit target_w × target_h, or a placeholder
    box if the photo failed to load. Preserves aspect ratio by picking the
    tighter of width/height constraints."""
    data = _stbs_photo_bytes(photo)
    if not data:
        ph = Table([[Paragraph("(photo unavailable)", ParagraphStyle("ph", fontName="Helvetica", fontSize=8, textColor=colors.HexColor("#94a3b8"), alignment=TA_CENTER))]], colWidths=[target_w], rowHeights=[target_h])
        ph.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")), ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f8fafc"))]))
        return ph
    try:
        from PIL import Image as _PIL
        with _PIL.open(io.BytesIO(data)) as img:
            iw, ih = img.size
        r = min(target_w / iw, target_h / ih)
        w, h = iw * r, ih * r
    except Exception:
        w, h = target_w, target_h
    img = RLImage(io.BytesIO(data), width=w, height=h)
    return img


def _annual_footer(section_name: str, project_title: str):
    """Return a function suitable for SimpleDocTemplate's on*Page hooks
    that stamps the STBS-style footer: section on the left, project title
    on the right, page number center."""
    def _draw(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(colors.HexColor("#94a3b8"))
        canvas.drawString(MARGIN_X, 0.35 * inch, section_name)
        canvas.drawRightString(PAGE_W - MARGIN_X, 0.35 * inch, project_title)
        canvas.drawCentredString(PAGE_W / 2, 0.35 * inch, f"Page {doc.page}")
        canvas.restoreState()
    return _draw


def _annual_styles():
    """Text styles used only by the annual-maintenance renderer."""
    base = getSampleStyleSheet()
    return {
        "brand": ParagraphStyle("brand", parent=base["Normal"], fontName="Helvetica-Bold", fontSize=10, textColor=colors.HexColor("#0f172a"), alignment=TA_CENTER, leading=12),
        "brand_tag": ParagraphStyle("brand_tag", parent=base["Normal"], fontName="Helvetica", fontSize=8, textColor=colors.HexColor("#64748b"), alignment=TA_CENTER, leading=10, spaceAfter=4),
        "cover_title": ParagraphStyle("cover_title", parent=base["Normal"], fontName="Helvetica-Bold", fontSize=30, textColor=colors.HexColor("#0f172a"), alignment=TA_CENTER, leading=34, spaceBefore=140, spaceAfter=16),
        "cover_date": ParagraphStyle("cover_date", parent=base["Normal"], fontName="Helvetica", fontSize=14, textColor=colors.HexColor("#334155"), alignment=TA_CENTER, leading=18, spaceAfter=8),
        "cover_for": ParagraphStyle("cover_for", parent=base["Normal"], fontName="Helvetica", fontSize=12, textColor=colors.HexColor("#475569"), alignment=TA_CENTER, leading=16),
        "section_title": ParagraphStyle("section_title", parent=base["Normal"], fontName="Helvetica-Bold", fontSize=18, textColor=colors.HexColor("#0f172a"), alignment=TA_LEFT, leading=22, spaceBefore=6, spaceAfter=12),
        "field_label": ParagraphStyle("field_label", parent=base["Normal"], fontName="Helvetica-Bold", fontSize=9, textColor=colors.HexColor("#0f172a"), alignment=TA_LEFT, leading=12),
        "field_val": ParagraphStyle("field_val", parent=base["Normal"], fontName="Helvetica", fontSize=10, textColor=colors.HexColor("#0f172a"), alignment=TA_LEFT, leading=13, spaceAfter=8),
        "photo_num": ParagraphStyle("photo_num", parent=base["Normal"], fontName="Helvetica-Bold", fontSize=22, textColor=colors.HexColor("#1e40af"), alignment=TA_CENTER, leading=26),
        "obs_label": ParagraphStyle("obs_label", parent=base["Normal"], fontName="Helvetica-Bold", fontSize=8, textColor=colors.HexColor("#1e40af"), alignment=TA_LEFT, leading=10, spaceAfter=1),
        "obs_body": ParagraphStyle("obs_body", parent=base["Normal"], fontName="Helvetica", fontSize=10, textColor=colors.HexColor("#0f172a"), alignment=TA_LEFT, leading=13, spaceAfter=6),
        "project_id": ParagraphStyle("project_id", parent=base["Normal"], fontName="Helvetica-Oblique", fontSize=8, textColor=colors.HexColor("#94a3b8"), alignment=TA_LEFT, leading=10),
        "summary_body": ParagraphStyle("summary_body", parent=base["Normal"], fontName="Helvetica", fontSize=11, textColor=colors.HexColor("#0f172a"), alignment=TA_LEFT, leading=16, spaceAfter=8),
        "svl_title": ParagraphStyle("svl_title", parent=base["Normal"], fontName="Helvetica-Bold", fontSize=12, textColor=colors.HexColor("#0f172a"), alignment=TA_LEFT, leading=15, spaceBefore=20, spaceAfter=10),
    }


def _photo_block_flowable(photo: dict, num: int, project_title: str, styles: dict):
    """Render one numbered "Before" or "After" photo block.

    Layout:
        ┌─────────────┬────────────────────┐
        │             │  [1]               │
        │   PHOTO     │  OBSERVATION       │
        │             │  <observation>     │
        │             │  NOTES             │
        │             │  <notes>           │
        │             │  Project: <title>  │
        └─────────────┴────────────────────┘

    Photo cell = 42% of content width; text cell = 55%. Both cells are
    VALIGN=TOP so the numbered header sits at the same Y as the top of
    the photo — matching the STBS template.
    """
    photo_col_w = CONTENT_W * 0.42
    text_col_w = CONTENT_W * 0.55
    photo_h = 3.2 * inch

    img = _stbs_photo_flowable(photo, photo_col_w - 0.15 * inch, photo_h)
    photo_cell = Table([[img]], colWidths=[photo_col_w], rowHeights=[photo_h])
    photo_cell.setStyle(TableStyle([
        ("ALIGN", (0, 0), (-1, -1), "LEFT"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))

    obs = (photo.get("observation") or photo.get("description") or "").strip()
    notes = (photo.get("maint_notes") or "").strip()
    text_flow = [Paragraph(f"<b>{num}</b>", styles["photo_num"])]
    if obs:
        text_flow.append(Paragraph("OBSERVATION", styles["obs_label"]))
        text_flow.append(Paragraph(obs.replace("\n", "<br/>"), styles["obs_body"]))
    if notes:
        text_flow.append(Paragraph("NOTES", styles["obs_label"]))
        text_flow.append(Paragraph(notes.replace("\n", "<br/>"), styles["obs_body"]))
    if not obs and not notes:
        text_flow.append(Paragraph("(No description recorded for this photo)", ParagraphStyle("empty", fontName="Helvetica-Oblique", fontSize=9, textColor=colors.HexColor("#94a3b8"), leading=12)))
    text_flow.append(Spacer(1, 4))
    text_flow.append(Paragraph(f"Project: {project_title}", styles["project_id"]))

    block = Table([[photo_cell, text_flow]], colWidths=[photo_col_w, text_col_w])
    block.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LINEBELOW", (0, 0), (-1, 0), 0.5, colors.HexColor("#e2e8f0")),
    ]))
    return block


def _service_life_chart(selected: Optional[str], styles: dict):
    """Vertical list of 6 rows — one per service-life range — matching the
    STBS template exactly:

        [X]  ██████████████████████████  15-20 Years
        [ ]  ████████████████████░░░░░░  10-15 Years
        [ ]  ████████████████░░░░░░░░░░  5-10 Years
        ...

    The row whose text matches `selected` gets a filled/checked box
    ([X]) so the property owner immediately sees the assessed range.
    """
    checkbox_col_w = 0.35 * inch
    bar_max_w = CONTENT_W - checkbox_col_w - 1.6 * inch          # leave room for label
    label_col_w = 1.4 * inch
    row_h = 0.32 * inch

    rows_data = []
    row_styles = []
    for idx, opt in enumerate(SERVICE_LIFE_OPTIONS_PDF):
        is_selected = (opt == selected)
        # Checkbox — filled square + white X when selected, empty outlined square otherwise.
        cbox_para = Paragraph(
            "<b>X</b>" if is_selected else "&nbsp;",
            ParagraphStyle("cbox", fontName="Helvetica-Bold", fontSize=11,
                           textColor=colors.white if is_selected else colors.HexColor("#94a3b8"),
                           alignment=TA_CENTER, leading=13),
        )
        cbox = Table([[cbox_para]], colWidths=[0.25 * inch], rowHeights=[0.25 * inch])
        cbox.setStyle(TableStyle([
            ("BOX", (0, 0), (-1, -1), 1, colors.HexColor("#0f172a")),
            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#0f172a") if is_selected else colors.white),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ]))

        # Horizontal colored bar — width scales with service-life expectation.
        bar_color = colors.HexColor(SERVICE_LIFE_BAR_COLORS[idx])
        bar_w = bar_max_w * SERVICE_LIFE_BAR_WIDTHS[idx]
        bar = Table([[""]], colWidths=[bar_w], rowHeights=[0.18 * inch])
        bar.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), bar_color),
            ("BOX", (0, 0), (-1, -1), 0.5, bar_color),
        ]))

        label = Paragraph(
            f"<b>{opt}</b>",
            ParagraphStyle("svl_label", fontName="Helvetica-Bold", fontSize=11,
                           textColor=colors.HexColor("#0f172a" if is_selected else "#334155"),
                           alignment=TA_LEFT, leading=13),
        )
        rows_data.append([cbox, bar, label])
        if is_selected:
            row_styles.append(("BACKGROUND", (0, len(rows_data) - 1), (-1, len(rows_data) - 1), colors.HexColor("#f1f5f9")))

    tbl = Table(rows_data, colWidths=[checkbox_col_w, bar_max_w, label_col_w], rowHeights=[row_h] * len(rows_data))
    base_style = [
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (0, 0), (0, -1), "LEFT"),
        ("ALIGN", (1, 0), (1, -1), "LEFT"),      # bars align left so length is meaningful
        ("ALIGN", (2, 0), (2, -1), "LEFT"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]
    tbl.setStyle(TableStyle(base_style + row_styles))
    return tbl


def build_annual_maintenance_report_pdf(
    deal: dict,
    visit: dict,
    property_doc: Optional[dict],
    photos: List[dict],
    hero_photo: Optional[dict] = None,
) -> bytes:
    """Render the SealTech STBS Annual Maintenance Report.

    Inputs:
      deal          — full deal doc (for title + fallback contact)
      visit         — a single entry from `deal.maintenance_visits` (contains
                      visit_date, summary_text, service_life_estimate,
                      building_contact_* snapshots)
      property_doc  — full property record (for site address)
      photos        — every project_photo linked to this visit (both
                      before + after roles combined; split here by
                      `maint_role`)
      hero_photo    — optional explicit "front of building" shot used on
                      page 2. Falls back to the first Before photo.
    """
    styles = _annual_styles()

    # Build project title / address strings once. Property records use the
    # `property_*` field prefix; older imports may use un-prefixed keys, so
    # we fall back through both. Assembled as: "<street>, <unit>, <city>, <state> <zip>"
    # matching the way a customer would read the address on an envelope.
    project_title = (deal.get("title") or "Project").strip()
    address_str = project_title
    if property_doc:
        street = (property_doc.get("property_address") or property_doc.get("address_line_1") or "").strip()
        unit   = (property_doc.get("property_address_line2") or property_doc.get("address_line_2") or "").strip()
        city   = (property_doc.get("property_city") or property_doc.get("city") or "").strip()
        state  = (property_doc.get("property_state") or property_doc.get("state") or "").strip()
        zipc   = (property_doc.get("property_zip") or property_doc.get("zip_code") or "").strip()
        line1 = ", ".join([p for p in [street, unit] if p])
        state_zip = " ".join([p for p in [state, zipc] if p])
        line2 = ", ".join([p for p in [city, state_zip] if p])
        combined = ", ".join([p for p in [line1, line2] if p])
        if combined:
            address_str = combined
    visit_year_str = (visit.get("visit_date") or "").strip()[:4] or datetime.now().strftime("%Y")

    buf = io.BytesIO()
    docx = SimpleDocTemplate(
        buf, pagesize=letter,
        leftMargin=MARGIN_X, rightMargin=MARGIN_X,
        topMargin=MARGIN_Y, bottomMargin=0.75 * inch,
        title=f"{project_title} — Annual Maintenance Report {visit_year_str}",
    )
    story = []

    # ---------- Page 1: Cover ----------
    # SealTech logo — large and centered. If the asset is missing (dev env)
    # we quietly fall back to the text brand line so the PDF still renders.
    import os as _os
    logo_path = _os.path.join(_os.path.dirname(__file__), "assets", "sealtech-logo.png")
    if _os.path.exists(logo_path):
        try:
            from PIL import Image as _PIL
            with _PIL.open(logo_path) as _img:
                iw, ih = _img.size
            # Scale to ~4" wide, preserve aspect ratio
            logo_w = 4.5 * inch
            logo_h = logo_w * (ih / iw) if iw > 0 else 1.4 * inch
            story.append(Spacer(1, 1.2 * inch))
            story.append(RLImage(logo_path, width=logo_w, height=logo_h, hAlign="CENTER"))
        except Exception:
            story.append(Spacer(1, 1.2 * inch))
            story.append(Paragraph("SEALTECH BUILDING SOLUTIONS", styles["brand"]))
            story.append(Paragraph("Commercial Roofing · Restoration · Maintenance", styles["brand_tag"]))
    else:
        story.append(Spacer(1, 1.2 * inch))
        story.append(Paragraph("SEALTECH BUILDING SOLUTIONS", styles["brand"]))
        story.append(Paragraph("Commercial Roofing · Restoration · Maintenance", styles["brand_tag"]))
    story.append(Paragraph("Annual Maintenance Report", styles["cover_title"]))
    # Format visit date human-friendly
    try:
        vd = datetime.strptime(visit.get("visit_date") or "", "%Y-%m-%d")
        story.append(Paragraph(vd.strftime("%B %d, %Y"), styles["cover_date"]))
    except Exception:
        story.append(Paragraph(datetime.now().strftime("%B %d, %Y"), styles["cover_date"]))
    story.append(Paragraph(f"For: {address_str}", styles["cover_for"]))
    story.append(PageBreak())

    # ---------- Page 2: Building Information ----------
    story.append(Paragraph("Building Information", styles["section_title"]))
    contact_name = (visit.get("building_contact_name") or deal.get("customer_contact_name") or "").strip()
    contact_phone = (visit.get("building_contact_phone") or deal.get("customer_contact_phone") or "").strip()
    contact_email = (visit.get("building_contact_email") or deal.get("customer_contact_email") or "").strip()
    info_rows = [
        [Paragraph("Building Address:", styles["field_label"]), Paragraph(address_str or "—", styles["field_val"])],
        [Paragraph("Building Contact:", styles["field_label"]), Paragraph(contact_name or "—", styles["field_val"])],
        [Paragraph("Contact Phone:", styles["field_label"]), Paragraph(contact_phone or "—", styles["field_val"])],
        [Paragraph("Contact Email:", styles["field_label"]), Paragraph(contact_email or "—", styles["field_val"])],
    ]
    info_tbl = Table(info_rows, colWidths=[1.75 * inch, CONTENT_W - 1.75 * inch])
    info_tbl.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    story.append(info_tbl)
    story.append(Spacer(1, 0.2 * inch))

    # Hero photo — full-width
    hero = hero_photo
    if not hero and photos:
        # Fallback: first "before" photo, else first photo overall
        befores = [p for p in photos if p.get("maint_role") == "before"]
        hero = befores[0] if befores else photos[0]
    if hero:
        hero_flow = _stbs_photo_flowable(hero, CONTENT_W, 4.8 * inch)
        story.append(hero_flow)
    story.append(PageBreak())

    # ---------- Pages 3+: Maintenance BEFORE Images ----------
    before_photos = [p for p in photos if p.get("maint_role") == "before"]
    after_photos = [p for p in photos if p.get("maint_role") == "after"]

    if before_photos:
        story.append(Paragraph("Maintenance Before Images and Detail", styles["section_title"]))
        for i, p in enumerate(before_photos, start=1):
            story.append(_photo_block_flowable(p, i, project_title, styles))
            story.append(Spacer(1, 6))
        story.append(PageBreak())

    # ---------- Pages N+: Maintenance AFTER Images ----------
    if after_photos:
        story.append(Paragraph("Maintenance After Images and Detail", styles["section_title"]))
        for i, p in enumerate(after_photos, start=1):
            story.append(_photo_block_flowable(p, i, project_title, styles))
            story.append(Spacer(1, 6))
        story.append(PageBreak())

    # ---------- Last page: Summary + Service Life ----------
    story.append(Paragraph("Summary", styles["section_title"]))
    summary_text = (visit.get("summary_text") or "").strip()
    if summary_text:
        # Split on blank lines → separate paragraphs (matches STBS layout)
        for para in [pp.strip() for pp in summary_text.split("\n\n") if pp.strip()]:
            story.append(Paragraph(para.replace("\n", "<br/>"), styles["summary_body"]))
    else:
        story.append(Paragraph("(No summary provided.)", ParagraphStyle("empty_sum", fontName="Helvetica-Oblique", fontSize=10, textColor=colors.HexColor("#94a3b8"), leading=14)))

    story.append(Paragraph("Roof Estimated Service Life", styles["svl_title"]))
    story.append(_service_life_chart(visit.get("service_life_estimate"), styles))

    docx.build(
        story,
        onFirstPage=_annual_footer("Cover Page", f"{project_title} Annual Maintenance"),
        onLaterPages=_annual_footer("Annual Maintenance Report", f"{project_title} Annual Maintenance"),
    )
    return buf.getvalue()
