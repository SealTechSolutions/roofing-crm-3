"""Daily Status Report PDF — the "morning standup in PDF form".

For every active deal in the CRM, surfaces:
    1) where it is in the process (derived pipeline stage),
    2) the next concrete action that needs to happen, and
    3) the person responsible for doing it.

Also includes:
    - Today's ad-hoc appointments (Roof Walks, Presentations, etc.)
    - Tomorrow's appointment preview
    - Overdue / stale items
    - Top-line KPIs

The same renderer powers two delivery channels:
    - On-demand: GET /api/reports/daily-status.pdf (sidebar button)
    - Auto-email: APScheduler cron 7:00 AM Mon-Fri to admin + deal owners

Pure function — caller passes the queried collections in, no DB inside.
"""
from __future__ import annotations

import io
from collections import defaultdict
from datetime import datetime, timezone, timedelta, date as date_cls
from typing import List, Tuple

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
)


# ---------------------------------------------------------------------------
# Styles
# ---------------------------------------------------------------------------

NAVY = colors.HexColor("#062B67")
COBALT = colors.HexColor("#1D4ED8")
TEAL = colors.HexColor("#0F766E")
AMBER = colors.HexColor("#B45309")
ROSE = colors.HexColor("#BE123C")
INK = colors.HexColor("#0F172A")
SUBTLE = colors.HexColor("#64748B")
DIVIDER = colors.HexColor("#E2E8F0")
BG_SOFT = colors.HexColor("#F8FAFC")


def _styles():
    base = getSampleStyleSheet()
    out = {}
    out["title"] = ParagraphStyle(
        "title", parent=base["Title"], fontName="Helvetica-Bold",
        fontSize=22, leading=26, textColor=NAVY, alignment=0, spaceAfter=2,
    )
    out["sub"] = ParagraphStyle(
        "sub", parent=base["Normal"], fontName="Helvetica",
        fontSize=10, leading=12, textColor=SUBTLE,
    )
    out["section"] = ParagraphStyle(
        "section", parent=base["Normal"], fontName="Helvetica-Bold",
        fontSize=12, leading=14, textColor=NAVY, spaceBefore=10, spaceAfter=4,
        borderWidth=0, borderColor=NAVY, borderPadding=0,
    )
    out["kicker"] = ParagraphStyle(
        "kicker", parent=base["Normal"], fontName="Helvetica-Bold",
        fontSize=8, leading=10, textColor=TEAL, alignment=0, spaceAfter=2,
    )
    out["body"] = ParagraphStyle(
        "body", parent=base["Normal"], fontName="Helvetica",
        fontSize=9, leading=12, textColor=INK,
    )
    out["body_bold"] = ParagraphStyle(
        "body_bold", parent=base["Normal"], fontName="Helvetica-Bold",
        fontSize=9, leading=12, textColor=INK,
    )
    out["body_subtle"] = ParagraphStyle(
        "body_subtle", parent=base["Normal"], fontName="Helvetica",
        fontSize=8, leading=10, textColor=SUBTLE,
    )
    out["alert"] = ParagraphStyle(
        "alert", parent=base["Normal"], fontName="Helvetica-Bold",
        fontSize=9, leading=11, textColor=ROSE,
    )
    out["empty"] = ParagraphStyle(
        "empty", parent=base["Normal"], fontName="Helvetica-Oblique",
        fontSize=9, leading=11, textColor=SUBTLE, alignment=1, spaceBefore=4, spaceAfter=4,
    )
    return out


# ---------------------------------------------------------------------------
# Pipeline-stage derivation — the "where is each deal" logic.
# Mirrors the on-screen Project Pipeline indicator on the Deal page so the
# PDF and the UI stay in sync without the user having to re-learn anything.
# ---------------------------------------------------------------------------

STAGES_ORDER = [
    "Lead",
    "Quoted",
    "Awaiting Signature",
    "Sold — Order Materials",
    "Scheduled",
    "In Progress",
    "Awaiting Final Invoice",
]

# Color per stage — same emerald-amber-cobalt language as the rest of the app.
STAGE_COLORS = {
    "Lead":                    colors.HexColor("#0EA5E9"),
    "Quoted":                  colors.HexColor("#6366F1"),
    "Awaiting Signature":      colors.HexColor("#A855F7"),
    "Sold — Order Materials":  colors.HexColor("#F59E0B"),
    "Scheduled":               colors.HexColor("#10B981"),
    "In Progress":             colors.HexColor("#059669"),
    "Awaiting Final Invoice":  colors.HexColor("#DC2626"),
}


def _today_iso() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def _parse_date(s) -> date_cls | None:
    if not s:
        return None
    try:
        return datetime.fromisoformat(str(s)[:10]).date()
    except Exception:
        return None


def derive_stage_and_next(deal: dict, today: date_cls, invoices_for_deal: List[dict]) -> Tuple[str, str]:
    """Return (stage_label, next_action) for a single deal.

    Rules (top of list wins):
      • status="Lead" and no scope sent     → "Lead" / "Schedule assessment"
      • status="Lead" and scope sent        → "Quoted" / "Follow up on quote (sent {d}d ago)"
      • status="Sent"                       → "Quoted" / same
      • scope_signed_at set, no material_order_date → "Awaiting Signature" already passed; promote to "Sold — Order Materials"
      • status="Won", no material_order_date         → "Sold — Order Materials" / "Place material order"
      • material_order_date set, scheduled_start_date in future  → "Scheduled" / "Job starts {date}"
      • scheduled_start_date <= today and scheduled_end_date >= today  → "In Progress" / "Complete work • {N} days left"
      • status="Won", end_date in past or scheduled_end_date <= today and no fully-paid final invoice → "Awaiting Final Invoice" / "Generate final invoice"
    """
    status = (deal.get("status") or "Lead").strip()
    scope_signed = bool(deal.get("scope_signed_at"))
    last_scope_sent = deal.get("last_scope_sent_at") or ""
    mat_order = _parse_date(deal.get("material_order_date"))
    sched_start = _parse_date(deal.get("scheduled_start_date"))
    sched_end = _parse_date(deal.get("scheduled_end_date"))

    if status in ("Lost", "Past Lead"):
        return ("Closed/Lost", "—")

    # Lead bucket
    if status == "Lead":
        if not last_scope_sent:
            return ("Lead", "Schedule assessment")
        # Lead with scope sent = quoted-but-not-status-flipped
        ago = _days_since_iso(last_scope_sent, today)
        return ("Quoted", f"Follow up on quote (sent {ago}d ago)" if ago is not None else "Follow up on quote")

    # Sent / Quoted
    if status == "Sent":
        if scope_signed and not mat_order:
            return ("Sold — Order Materials", "Place material order")
        if scope_signed:
            # signed but material ordered — treat as scheduled/in-progress flow below
            pass
        else:
            ago = _days_since_iso(last_scope_sent, today) if last_scope_sent else None
            tail = f"(sent {ago}d ago)" if ago is not None else ""
            return ("Quoted", f"Follow up on quote {tail}".strip())

    # Won path
    if status == "Won" or scope_signed:
        # In-progress window
        if sched_start and sched_end and sched_start <= today <= sched_end:
            days_left = (sched_end - today).days
            return ("In Progress", f"On site — {days_left}d to completion")
        if sched_end and sched_end < today:
            # Job ended — check final invoice
            has_paid_final = any(
                inv.get("is_final") and (inv.get("status") == "Paid")
                for inv in invoices_for_deal
            )
            if has_paid_final:
                return ("Closed/Lost", "—")
            return ("Awaiting Final Invoice", "Generate / collect final invoice")
        if sched_start and sched_start > today:
            return ("Scheduled", f"Job starts {sched_start.strftime('%a %b %-d')}")
        if mat_order and not sched_start:
            return ("Scheduled", f"Material order placed {mat_order.strftime('%b %-d')} — set start date")
        if not mat_order:
            return ("Sold — Order Materials", "Place material order")

    return ("Lead", "Schedule next step")


def _days_since_iso(iso: str, today: date_cls) -> int | None:
    d = _parse_date(iso)
    if not d:
        return None
    return (today - d).days


# ---------------------------------------------------------------------------
# Renderer
# ---------------------------------------------------------------------------

def _money(n) -> str:
    try:
        return f"${float(n):,.0f}"
    except Exception:
        return "$0"


def _format_kpi(label: str, value: str, accent=NAVY):
    cell = Table([
        [Paragraph('<font color="#0F766E">■</font>', ParagraphStyle("dot", fontSize=6))],
        [Paragraph(f'<b><font size="14" color="{accent.hexval()}">{value}</font></b>', ParagraphStyle("v"))],
        [Paragraph(f'<font color="#64748B" size="7"><b>{label.upper()}</b></font>', ParagraphStyle("l"))],
    ], colWidths=[1.6 * inch])
    cell.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), BG_SOFT),
        ("BOX", (0, 0), (-1, -1), 0.5, DIVIDER),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LINEABOVE", (0, 0), (-1, 0), 2, accent),
    ]))
    return cell


def _stage_chip(stage_label: str) -> Paragraph:
    c = STAGE_COLORS.get(stage_label, NAVY)
    return Paragraph(
        f'<b><font color="{c.hexval()}" size="7">■ {stage_label.upper()}</font></b>',
        ParagraphStyle("chip", fontSize=7, leading=9),
    )


def build_daily_status_pdf(
    *,
    deals: List[dict],
    invoices_by_deal: dict,
    users_by_id: dict,
    today_events: List[dict],
    tomorrow_events: List[dict],
    overdue_tasks: List[dict],
    coi_expiring_soon: List[dict],
    stale_deals: List[dict],
    company_name: str = "SealTech Solutions",
    now: datetime | None = None,
) -> bytes:
    styles = _styles()
    now = now or datetime.now(timezone.utc)
    today = now.date()

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=letter,
        leftMargin=0.6 * inch, rightMargin=0.6 * inch,
        topMargin=0.55 * inch, bottomMargin=0.55 * inch,
        title=f"Daily Status — {today.isoformat()}",
        author=company_name,
    )
    flow = []

    # Header
    flow.append(Paragraph("DAILY STATUS REPORT", styles["kicker"]))
    flow.append(Paragraph(
        f"{company_name} &nbsp; · &nbsp; {today.strftime('%A, %B %-d, %Y')}",
        styles["title"],
    ))
    flow.append(Paragraph(
        "Where every active deal is in the process, what's next, and who owns it.",
        styles["sub"],
    ))
    flow.append(Spacer(1, 10))

    # ---- Bucket deals by derived stage ----
    open_deals = [d for d in deals if (d.get("status") not in ("Lost", "Past Lead")) and not d.get("is_deleted")]
    by_stage: dict[str, List[Tuple[dict, str]]] = defaultdict(list)
    total_pipeline_value = 0.0
    for d in open_deals:
        invs = invoices_by_deal.get(d["id"], [])
        stage, action = derive_stage_and_next(d, today, invs)
        if stage == "Closed/Lost":
            continue
        by_stage[stage].append((d, action))
        try:
            total_pipeline_value += float(d.get("chosen_amount") or 0)
        except Exception:
            pass

    # ---- KPI strip ----
    kpis = [
        _format_kpi("Active Deals", str(sum(len(v) for v in by_stage.values())), accent=COBALT),
        _format_kpi("Pipeline Value", _money(total_pipeline_value), accent=NAVY),
        _format_kpi("Today's Events", str(len(today_events)), accent=TEAL),
        _format_kpi("Overdue Items", str(len(overdue_tasks) + len(stale_deals)), accent=ROSE if (overdue_tasks or stale_deals) else SUBTLE),
    ]
    kpi_tbl = Table([kpis], colWidths=[1.7 * inch] * 4, hAlign="LEFT")
    kpi_tbl.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
    ]))
    flow.append(kpi_tbl)
    flow.append(Spacer(1, 12))

    # ---- TODAY's schedule ----
    flow.append(Paragraph("TODAY · Scheduled Events", styles["section"]))
    if not today_events:
        flow.append(Paragraph("No appointments scheduled for today.", styles["empty"]))
    else:
        rows = [["Time", "Type", "Title", "Owner", "Where"]]
        for ev in today_events:
            owner = users_by_id.get(ev.get("created_by_user_id"), {})
            rows.append([
                Paragraph(_fmt_time(ev.get("start_time")) or "All day", styles["body_bold"]),
                Paragraph(ev.get("event_type") or "Other", styles["body"]),
                Paragraph(_safe(ev.get("title") or ev.get("deal_title") or "—"), styles["body"]),
                Paragraph(_safe(owner.get("name") or owner.get("email") or "—"), styles["body"]),
                Paragraph(_safe(ev.get("location") or ev.get("deal_title") or ""), styles["body_subtle"]),
            ])
        flow.append(_grid_table(rows, col_widths=[0.7, 1.0, 2.3, 1.2, 1.8]))
    flow.append(Spacer(1, 8))

    # ---- WHAT'S NEXT — by stage ----
    flow.append(Paragraph("WHAT'S NEXT · By Pipeline Stage", styles["section"]))
    any_deal = False
    for stage in STAGES_ORDER:
        items = by_stage.get(stage, [])
        if not items:
            continue
        any_deal = True
        # Stage header row spanning the table
        flow.append(Spacer(1, 4))
        flow.append(_stage_chip(stage))
        flow.append(Spacer(1, 2))
        rows = [["Deal", "Customer", "Value", "Next Action", "Owner", "Idle"]]
        # Sort within stage: oldest activity first (squeaky wheel)
        items.sort(key=_idle_key(today), reverse=True)
        for d, action in items:
            owner = users_by_id.get(d.get("assigned_to_user_id") or d.get("created_by_user_id"), {})
            idle_days = _idle_days(d, today)
            idle_cell = Paragraph(
                f'<b><font color="{ROSE.hexval() if idle_days >= 7 else (AMBER.hexval() if idle_days >= 3 else SUBTLE.hexval())}">{idle_days}d</font></b>',
                styles["body_bold"],
            )
            rows.append([
                Paragraph(f'<b>{_safe(d.get("title") or "Untitled")}</b>', styles["body"]),
                Paragraph(_safe(d.get("primary_contact_name") or d.get("primary_contact_company") or "—"), styles["body_subtle"]),
                Paragraph(_money(d.get("chosen_amount")), styles["body_bold"]),
                Paragraph(_safe(action), styles["body"]),
                Paragraph(_safe(owner.get("name") or owner.get("email") or "—"), styles["body"]),
                idle_cell,
            ])
        flow.append(_grid_table(rows, col_widths=[1.8, 1.4, 0.8, 1.8, 1.2, 0.5]))

    if not any_deal:
        flow.append(Paragraph("No active deals in the pipeline.", styles["empty"]))

    flow.append(Spacer(1, 10))

    # ---- ATTENTION NEEDED ----
    has_attention = bool(overdue_tasks or stale_deals or coi_expiring_soon)
    flow.append(Paragraph("ATTENTION · Needs Action", styles["section"]))
    if not has_attention:
        flow.append(Paragraph("All clear — no overdue tasks, stale deals, or expiring COIs.", styles["empty"]))
    else:
        rows = [["Item", "Owner", "Detail"]]
        for t in overdue_tasks:
            owner = users_by_id.get(t.get("assigned_to_user_id"), {})
            rows.append([
                Paragraph(f'<font color="{ROSE.hexval()}"><b>● Overdue Task</b></font> &nbsp; {_safe(t.get("title"))}', styles["body"]),
                Paragraph(_safe(owner.get("name") or owner.get("email") or "—"), styles["body"]),
                Paragraph(f"Due {_safe(t.get('due_date'))}", styles["body_subtle"]),
            ])
        for s in stale_deals:
            owner = users_by_id.get(s.get("owner_user_id"), {})
            rows.append([
                Paragraph(f'<font color="{AMBER.hexval()}"><b>● Stale Deal</b></font> &nbsp; {_safe(s.get("title"))}', styles["body"]),
                Paragraph(_safe(owner.get("name") or owner.get("email") or "—"), styles["body"]),
                Paragraph(f"{s.get('days_in_stage')}d in {_safe(s.get('status'))}", styles["body_subtle"]),
            ])
        for c in coi_expiring_soon:
            rows.append([
                Paragraph(f'<font color="{NAVY.hexval()}"><b>● COI Expiring</b></font> &nbsp; {_safe(c.get("name") or c.get("vendor_name"))}', styles["body"]),
                Paragraph(_safe(c.get("contact_name") or "—"), styles["body"]),
                Paragraph(f"Expires {_safe(c.get('coi_expiration'))}", styles["body_subtle"]),
            ])
        flow.append(_grid_table(rows, col_widths=[3.5, 1.8, 2.0]))

    flow.append(Spacer(1, 10))

    # ---- TOMORROW preview ----
    if tomorrow_events:
        flow.append(Paragraph("TOMORROW · Heads-up", styles["section"]))
        rows = [["Time", "Type", "Title", "Owner"]]
        for ev in tomorrow_events:
            owner = users_by_id.get(ev.get("created_by_user_id"), {})
            rows.append([
                Paragraph(_fmt_time(ev.get("start_time")) or "All day", styles["body_bold"]),
                Paragraph(_safe(ev.get("event_type")), styles["body"]),
                Paragraph(_safe(ev.get("title") or ev.get("deal_title") or "—"), styles["body"]),
                Paragraph(_safe(owner.get("name") or owner.get("email") or "—"), styles["body"]),
            ])
        flow.append(_grid_table(rows, col_widths=[0.8, 1.2, 3.5, 1.8]))
        flow.append(Spacer(1, 8))

    # Footer
    flow.append(Spacer(1, 6))
    flow.append(Paragraph(
        f'Generated {now.strftime("%Y-%m-%d %H:%M UTC")} · '
        f'{sum(len(v) for v in by_stage.values())} active deals · '
        f'{_money(total_pipeline_value)} in pipeline',
        styles["body_subtle"],
    ))

    doc.build(flow)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

def _safe(s) -> str:
    if s is None:
        return ""
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _fmt_time(hhmm: str) -> str:
    if not hhmm or ":" not in str(hhmm):
        return ""
    try:
        h, m = str(hhmm).split(":")
        h = int(h)
        m = int(m)
        ampm = "PM" if h >= 12 else "AM"
        h12 = h % 12 or 12
        return f"{h12}:{m:02d} {ampm}"
    except Exception:
        return str(hhmm)


def _idle_days(deal: dict, today: date_cls) -> int:
    history = deal.get("status_history") or []
    iso = (history[-1].get("at") if history else None) or deal.get("updated_at") or deal.get("created_at")
    try:
        d = datetime.fromisoformat(str(iso).replace("Z", "+00:00")).date()
    except Exception:
        return 0
    return max(0, (today - d).days)


def _idle_key(today):
    return lambda x: _idle_days(x[0], today)


def _grid_table(rows: list, col_widths: list) -> Table:
    """Standard report table — header in navy, zebra body, divider lines."""
    total_w = sum(col_widths)
    widths = [(w / total_w) * 7.3 * inch for w in col_widths]
    tbl = Table(rows, colWidths=widths, repeatRows=1)
    style = TableStyle([
        ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 8),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LINEBELOW", (0, 0), (-1, -1), 0.25, DIVIDER),
    ])
    # Zebra stripe
    for i in range(1, len(rows)):
        if i % 2 == 0:
            style.add("BACKGROUND", (0, i), (-1, i), BG_SOFT)
    tbl.setStyle(style)
    return tbl
