"""SealTech CRM User Guide PDFs — Quick Reference + Full Manual.

Two builders that emit professional, printable PDFs documenting the entire
CRM. Re-rendered on demand so the docs evolve with the app.

  • build_quick_guide_pdf()  → ~3 pages, daily-driver cheat sheet
  • build_full_manual_pdf()  → ~20+ pages, every feature, every button
"""
from __future__ import annotations

import io
from datetime import datetime, timezone

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, ListFlowable, ListItem, KeepTogether,
)

# ---- Brand colors (match assessment_pdf.py) ----
NAVY = colors.HexColor("#062B67")
BRONZE = colors.HexColor("#A0703A")
DARK = colors.HexColor("#0A0A0A")
GRAY = colors.HexColor("#52525B")
LIGHT_GRAY = colors.HexColor("#F4F4F5")
BORDER = colors.HexColor("#E4E4E7")
SOFT_BLUE = colors.HexColor("#EFF6FF")
EMERALD = colors.HexColor("#047857")
AMBER = colors.HexColor("#B45309")


def _styles():
    base = getSampleStyleSheet()
    return {
        "cover_eyebrow": ParagraphStyle(
            "cover_eyebrow", parent=base["Normal"], fontName="Helvetica-Bold",
            fontSize=9, textColor=BRONZE, alignment=TA_CENTER, spaceAfter=8, leading=11,
        ),
        "cover_title": ParagraphStyle(
            "cover_title", parent=base["Normal"], fontName="Helvetica-Bold",
            fontSize=28, textColor=NAVY, alignment=TA_CENTER, spaceAfter=6, leading=32,
        ),
        "cover_sub": ParagraphStyle(
            "cover_sub", parent=base["Normal"], fontName="Helvetica",
            fontSize=12, textColor=GRAY, alignment=TA_CENTER, spaceAfter=4, leading=16,
        ),
        "h1": ParagraphStyle(
            "h1", parent=base["Normal"], fontName="Helvetica-Bold",
            fontSize=18, textColor=NAVY, leading=22, spaceBefore=10, spaceAfter=6,
        ),
        "h2": ParagraphStyle(
            "h2", parent=base["Normal"], fontName="Helvetica-Bold",
            fontSize=13, textColor=NAVY, leading=16, spaceBefore=8, spaceAfter=4,
        ),
        "h3": ParagraphStyle(
            "h3", parent=base["Normal"], fontName="Helvetica-Bold",
            fontSize=10, textColor=BRONZE, leading=12, spaceBefore=6, spaceAfter=2,
        ),
        "body": ParagraphStyle(
            "body", parent=base["Normal"], fontName="Helvetica",
            fontSize=10, textColor=DARK, leading=14, spaceAfter=4, alignment=TA_LEFT,
        ),
        "small": ParagraphStyle(
            "small", parent=base["Normal"], fontName="Helvetica",
            fontSize=8.5, textColor=GRAY, leading=11, spaceAfter=2,
        ),
        "callout": ParagraphStyle(
            "callout", parent=base["Normal"], fontName="Helvetica-Bold",
            fontSize=10, textColor=NAVY, leading=14, spaceAfter=4,
            backColor=SOFT_BLUE, borderColor=NAVY, borderWidth=0.5,
            borderPadding=8, borderRadius=2, leftIndent=4, rightIndent=4,
        ),
        "toc": ParagraphStyle(
            "toc", parent=base["Normal"], fontName="Helvetica",
            fontSize=10, textColor=DARK, leading=15, spaceAfter=2,
        ),
        "footer": ParagraphStyle(
            "footer", parent=base["Normal"], fontName="Helvetica",
            fontSize=7, textColor=GRAY, alignment=TA_CENTER,
        ),
    }


# ---------- Helpers ----------
def _bullets(items, styles):
    return ListFlowable(
        [ListItem(Paragraph(t, styles["body"]), leftIndent=14) for t in items],
        bulletType="bullet", start="•", leftIndent=10, bulletFontSize=10,
        bulletColor=BRONZE,
    )


def _kv_table(rows, styles, col_widths=None):
    cw = col_widths or [1.6 * inch, 4.4 * inch]
    data = [[Paragraph(f"<b>{k}</b>", styles["small"]), Paragraph(v, styles["small"])] for k, v in rows]
    t = Table(data, colWidths=cw)
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("BACKGROUND", (0, 0), (0, -1), LIGHT_GRAY),
        ("LINEBELOW", (0, 0), (-1, -1), 0.25, BORDER),
    ]))
    return t


def _cover(title: str, subtitle: str, styles, *, version_note: str | None = None):
    story = [
        Spacer(1, 1.6 * inch),
        Paragraph("SEALTECH BUILDING SOLUTIONS", styles["cover_eyebrow"]),
        Paragraph(title, styles["cover_title"]),
        Paragraph(subtitle, styles["cover_sub"]),
        Spacer(1, 0.35 * inch),
        Paragraph(
            f"Generated {datetime.now(timezone.utc).strftime('%B %d, %Y')}",
            styles["cover_sub"],
        ),
    ]
    if version_note:
        story.append(Spacer(1, 0.2 * inch))
        story.append(Paragraph(version_note, styles["small"]))
    story.append(PageBreak())
    return story


# ===========================================================================
# QUICK REFERENCE PDF
# ===========================================================================
def build_quick_guide_pdf() -> bytes:
    """Compact 2–3 page laminate-on-the-truck quick reference."""
    styles = _styles()
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=letter,
        leftMargin=0.5 * inch, rightMargin=0.5 * inch,
        topMargin=0.5 * inch, bottomMargin=0.5 * inch,
        title="SealTech CRM — Quick Reference",
    )
    story = _cover(
        "Quick Reference Guide",
        "Daily workflow at a glance",
        styles,
        version_note="This guide is generated from the live CRM. Reprint anytime — features may evolve.",
    )

    # --- Section: Login & Sidebar ---
    story.append(Paragraph("Sign In", styles["h1"]))
    story.append(Paragraph(
        "Open <b>https://&lt;your-CRM-URL&gt;</b> in Chrome or Safari. Sign in with your email and password. "
        "On your phone, the app auto-redirects to the <b>Field Capture</b> screen — to access the full CRM "
        "from a phone, append <b>?desktop=1</b> to the URL once and it sticks for the session.",
        styles["body"],
    ))
    story.append(Spacer(1, 0.1 * inch))

    story.append(Paragraph("Sidebar — the 5 sections you use every day", styles["h1"]))
    story.append(_kv_table([
        ("Dashboard", "KPIs (Open Leads, Stale Deals, Outstanding Invoices), recent activity."),
        ("Contacts / Properties", "People and addresses. Every Deal links to one of each."),
        ("Deals", "Kanban pipeline. Drag cards across stages. Click any card to open."),
        ("Calendar / Tasks", "Project schedule, jobs, follow-ups. Syncs with Google Calendar."),
        ("Books", "Internal accounting — invoices, payments, vendor bills, P&amp;L, cash flow."),
        ("Library", "Object-storage document library for shared files."),
        ("Schedule (Admin)", "Background jobs: Lead auto-promotion + Monday Stale Deals email digest."),
    ], styles))

    # --- Section: Pipeline cheat ---
    story.append(Spacer(1, 0.15 * inch))
    story.append(Paragraph("Deal Pipeline (left → right)", styles["h1"]))
    pipeline = [
        ("Lead", "First contact. Auto-stale after N days → Past Lead."),
        ("Assessment", "Roof inspection booked / completed."),
        ("Scope Sent", "Proposal emailed. Status dot turns green when scope email sends."),
        ("Won / Signed", "Customer accepted. Auto-spawns a 50% Draft Deposit invoice."),
        ("Deposit Paid", "First money received. Move once cleared."),
        ("Materials Ordered", "Stock locked in."),
        ("Scheduled", "Crew + date locked on the calendar."),
        ("In Progress", "Crew is on the job."),
        ("Final Inspection", "Punch list / walk-through."),
        ("Closed", "Final invoice ready. Banner suggests drafting it automatically."),
    ]
    story.append(_kv_table(pipeline, styles))

    # --- Section: 60-second daily workflow ---
    story.append(PageBreak())
    story.append(Paragraph("60-Second Daily Workflow", styles["h1"]))
    story.append(_bullets([
        "<b>Morning:</b> Dashboard → review Stale Deals widget. Anything red? Click through and update.",
        "<b>New inquiry comes in:</b> Contacts → New → fill the contact. Then Properties → New. Then Deals → New → link contact + property.",
        "<b>After site visit:</b> open the Deal → click <b>NEW ASSESSMENT</b> (top toolbar). Fill the 6-step wizard. Click <b>VIEW PDF</b> to share or email.",
        "<b>Sending proposal:</b> on the Deal click <b>EMAIL SCOPE</b>. Customer signs at the public link → status auto-flips to Won → 50% deposit invoice drafted automatically.",
        "<b>Field photos:</b> click <b>SEND TO FIELD</b> on the Deal → scan the QR with your phone → camera opens with that project pre-selected. Snap-snap-snap, zero clicks per shot.",
        "<b>Wrapping a job:</b> drag the Deal to <b>Closed</b> in the pipeline. Green banner appears: \"Ready to bill?\" Click <b>DRAFT FINAL INVOICE</b>. Review, send.",
        "<b>End of day:</b> Calendar → review tomorrow's jobs. Tasks → check off the day's follow-ups.",
    ], styles))

    # --- Section: Phone shortcuts ---
    story.append(Spacer(1, 0.15 * inch))
    story.append(Paragraph("Phone — Field Capture", styles["h1"]))
    story.append(Paragraph(
        "Your phone always lands on the <b>Field Capture</b> screen (zero CRM clutter). Two ways to get there with a project pre-selected:",
        styles["body"],
    ))
    story.append(_bullets([
        "<b>From a Deal:</b> click the amber <b>SEND TO FIELD</b> button → scan the QR on your phone → camera opens for that exact project.",
        "<b>From the sidebar:</b> click <b>GET APP ON MY PHONE</b> → scan QR → land on a list of all open projects. Tap one → camera.",
    ], styles))
    story.append(Paragraph("On the camera screen:", styles["h3"]))
    story.append(_bullets([
        "Big white button = <b>shutter</b>. Tap-tap-tap; auto-uploads each shot.",
        "<b>Pinch</b> or tap <b>1× / 2× / 3×</b> pills to zoom. <b>0.5×</b> appears on iPhone Pro / phones with an ultrawide lens.",
        "No signal? Strokes are saved to your phone (IndexedDB) and auto-sync the moment you're back on Wi-Fi or cell.",
        "<b>←</b> arrow (top-left) returns to the project list.",
    ], styles))

    # --- Section: Key buttons cheat ---
    story.append(PageBreak())
    story.append(Paragraph("Key Buttons — What They Do", styles["h1"]))
    story.append(_kv_table([
        ("+ Invoice", "Creates a NEW Draft invoice on the Deal. Edit lines → Sent → Record Payment."),
        ("Record Payment", "Finds the open invoice and posts a payment. Status auto-flips to Paid/Partial."),
        ("New Assessment", "Starts a fresh assessment wizard linked to this Deal."),
        ("Send to Field", "QR for the phone — opens Field Capture pre-selected to this project."),
        ("Mark Complete", "Drafts the Final Invoice for the remaining balance (after deposits & change orders)."),
        ("Email Scope", "Sends the spec sheet / proposal PDF via your Gmail. Logs the send in the timeline."),
        ("Timeline PDF (Photos)", "Generates a date-grouped photo album as a single PDF — perfect for insurance close-out."),
        ("Share with Customer (Photos)", "Public, read-only gallery link customers can view without logging in."),
        ("View / Edit (invoice row on Deal)", "Opens the existing invoice editor with payment details."),
        ("Get App on My Phone (sidebar)", "QR for a 5-minute magic link → land signed-in on the phone."),
    ], styles))

    story.append(Spacer(1, 0.15 * inch))
    story.append(Paragraph("Status Pills (Invoices)", styles["h1"]))
    story.append(_kv_table([
        ("Draft", "Created but not yet sent. Safe to edit freely."),
        ("Sent", "Emailed / handed over. Now waiting on payment."),
        ("Partial", "Some payment received but balance &gt; $0."),
        ("Paid", "Fully paid. Balance $0. Receipt-ready."),
        ("Overdue", "Past due date with balance &gt; $0."),
        ("Void", "Cancelled. Excluded from totals."),
    ], styles))

    story.append(Spacer(1, 0.15 * inch))
    story.append(Paragraph("Trouble?", styles["h1"]))
    story.append(_bullets([
        "Camera shows black on phone → close Safari fully (swipe up) and reopen. Settings → Safari → Camera → set to Allow.",
        "Magic link says \"expired\" → it's already been used. Generate a fresh QR.",
        "Don't see your paid deposit on the Deal → scroll past the KPI tiles. The <b>Invoices on this project</b> table lists every invoice with status + payment.",
        "Want the full CRM on your phone temporarily? Add <b>?desktop=1</b> to the URL once.",
    ], styles))

    doc.build(story)
    return buf.getvalue()


# ===========================================================================
# FULL MANUAL PDF
# ===========================================================================
def build_full_manual_pdf() -> bytes:
    """Comprehensive ~20+ page user manual covering every CRM feature."""
    styles = _styles()
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=letter,
        leftMargin=0.65 * inch, rightMargin=0.65 * inch,
        topMargin=0.6 * inch, bottomMargin=0.6 * inch,
        title="SealTech CRM — Full User Manual",
    )
    story = _cover(
        "Full User Manual",
        "Every screen. Every button. Every workflow.",
        styles,
        version_note="Generated live from the production CRM. Reprint as the app evolves.",
    )

    # ---------- Table of Contents ----------
    story.append(Paragraph("Table of Contents", styles["h1"]))
    toc = [
        "1. Getting Started",
        "2. Sidebar Navigation",
        "3. Contacts &amp; Properties",
        "4. Deals &amp; the Pipeline",
        "5. Assessments",
        "6. Scopes, Spec Sheets &amp; In-App Scope Editor",
        "7. Public Proposal Sign-Off",
        "8. Invoicing &amp; Payments",
        "9. Final Invoice (Project Completion)",
        "10. Project Photos &amp; Progress Timeline PDF",
        "11. Field Capture (Mobile)",
        "12. Books — Internal Accounting Module",
        "13. Vendors, Bills &amp; COI Reminders",
        "14. Calendar &amp; Google Sync",
        "15. Tasks",
        "16. Reports, Cash Flow &amp; Statements",
        "17. Admin — Schedule, Users, Trash",
        "18. PWA &amp; Offline Behavior",
        "19. Tips, Shortcuts &amp; Troubleshooting",
        "20. Glossary",
    ]
    for entry in toc:
        story.append(Paragraph(entry, styles["toc"]))
    story.append(PageBreak())

    # ---------- 1. Getting Started ----------
    story.append(Paragraph("1. Getting Started", styles["h1"]))
    story.append(Paragraph("Signing in", styles["h2"]))
    story.append(Paragraph(
        "Open the CRM URL in Chrome or Safari. Enter your email + password. Your session persists in this "
        "browser until you sign out. The token lives in <b>localStorage</b> under the key <b>crm_token</b>.",
        styles["body"],
    ))
    story.append(Paragraph("Mobile auto-redirect", styles["h2"]))
    story.append(Paragraph(
        "When you open the CRM on a phone (iPhone, Android), the app automatically routes you to the "
        "stripped-down <b>Field Capture</b> screen — no sidebar, no dashboards. To force the full CRM on a "
        "phone (rare), add <b>?desktop=1</b> to any URL once; the preference sticks for the tab session.",
        styles["body"],
    ))
    story.append(Paragraph("Get App on My Phone (Magic-Link QR)", styles["h2"]))
    story.append(Paragraph(
        "Sidebar → <b>Get App on My Phone</b> generates a QR encoding a one-time, 5-minute magic link. Scan "
        "it with your phone camera; the phone signs in automatically and lands on the Field Capture project list.",
        styles["body"],
    ))

    # ---------- 2. Sidebar ----------
    story.append(Paragraph("2. Sidebar Navigation", styles["h1"]))
    story.append(_kv_table([
        ("Dashboard", "KPIs (Open Leads, Stale Deals widget, Outstanding Invoices, Pipeline value). Click any tile to drill in."),
        ("Contacts", "People you do business with — homeowners, board members, property managers."),
        ("Properties", "Physical addresses. A Property can have multiple Deals over its lifetime (recurring maintenance, follow-up roofs, etc.)."),
        ("Deals", "Kanban pipeline + table view. The center of gravity for the CRM."),
        ("Vendors", "Suppliers, sub-contractors. Track COI expirations, run vendor bills against project P&amp;L."),
        ("Library", "Object-storage document library — brochures, spec sheets, certifications, anything you want shareable."),
        ("Calendar", "Project + task calendar. Syncs with Google Calendar when configured."),
        ("Tasks", "Personal follow-ups + project punch lists."),
        ("Invoices", "All invoices across all deals (use Deal page for per-deal view)."),
        ("Books", "Accounting — Chart of Accounts, Journal Entries, P&amp;L, Balance Sheet, Cash Flow."),
        ("Reports", "Cash Flow Statements, Assessment Reports, Stale Deals."),
        ("Schedule", "<b>Admin-only</b> — cron-style settings for background jobs (Lead auto-promotion, Monday Stale Deals digest)."),
        ("Trash", "<b>Admin-only</b> — soft-deleted records. Restorable for N days, then purged."),
    ], styles))

    # ---------- 3. Contacts & Properties ----------
    story.append(Paragraph("3. Contacts &amp; Properties", styles["h1"]))
    story.append(Paragraph(
        "Every Deal must link to one Contact (the customer) and one Property (the jobsite address). Build "
        "Contacts and Properties FIRST, then create the Deal.",
        styles["body"],
    ))
    story.append(Paragraph("Creating a Contact", styles["h2"]))
    story.append(_bullets([
        "Contacts → <b>+ NEW CONTACT</b>.",
        "Required: name + at least one phone OR email.",
        "Optional: title, company, billing address (used as the bill-to on invoices when set).",
    ], styles))
    story.append(Paragraph("Creating a Property", styles["h2"]))
    story.append(_bullets([
        "Properties → <b>+ NEW PROPERTY</b>.",
        "Required: street + city + state + zip.",
        "Property type (residential / commercial), roof type, year built, sq-ft — all optional but help on assessments and proposals.",
    ], styles))

    # ---------- 4. Deals & Pipeline ----------
    story.append(Paragraph("4. Deals &amp; the Pipeline", styles["h1"]))
    story.append(Paragraph("Creating a Deal", styles["h2"]))
    story.append(_bullets([
        "Deals → <b>+ NEW DEAL</b>. Pick a contact + property (or create on the fly).",
        "Title is auto-filled from the property address; you can rename it.",
        "Deal type: <b>Scope</b> (roof / construction) or <b>Maintenance</b>. Both share the same workflow."
    ], styles))
    story.append(Paragraph("Pipeline stages", styles["h2"]))
    story.append(Paragraph(
        "The pipeline runs left to right: <b>Lead → Assessment → Scope Sent → Won → Deposit Paid → "
        "Materials Ordered → Scheduled → In Progress → Final Inspection → Closed</b>. Drag a card across "
        "stages or use the dropdown on the Deal page. Each transition is timestamped in the <b>Status History</b>.",
        styles["body"],
    ))
    story.append(Paragraph("Top-bar buttons on a Deal", styles["h2"]))
    story.append(_kv_table([
        ("+ Invoice", "Drafts a NEW invoice (NOT the existing one)."),
        ("Record Payment", "Posts a payment against the open invoice."),
        ("New Assessment", "Starts an assessment linked to this Deal."),
        ("Send to Field", "Generates a QR → phone opens with this Deal pre-selected for photos."),
        ("Mark Complete", "Drafts the Final Invoice for the remaining contract balance."),
        ("Email Scope", "Sends the spec sheet PDF via your Gmail integration."),
        ("Edit Scope", "Opens the In-App Scope Editor for bullet-by-bullet overrides."),
        ("Print Proposal", "Renders the proposal PDF for download / print."),
    ], styles))
    story.append(Paragraph("Invoices on this project (table on Deal page)", styles["h2"]))
    story.append(Paragraph(
        "Below the KPI tiles you'll see <b>Invoices on this project</b>. Each row shows the invoice number, "
        "type, status pill (color-coded), total, received, balance, payment date and method. Click any row "
        "to open the invoice editor.",
        styles["body"],
    ))

    # ---------- 5. Assessments ----------
    story.append(PageBreak())
    story.append(Paragraph("5. Assessments", styles["h1"]))
    story.append(Paragraph(
        "An <b>Assessment</b> is a structured roof inspection report — six steps walking you through site "
        "conditions, photo evidence, findings, recommendations, and a budget priority score. The output is "
        "a polished branded PDF you can email or attach to the proposal.",
        styles["body"],
    ))
    story.append(Paragraph("Six-step wizard", styles["h2"]))
    story.append(_bullets([
        "<b>Site Info:</b> roof system, year installed, dimensions.",
        "<b>Drone &amp; Visual:</b> aerial + walking-tour observations.",
        "<b>Findings:</b> labeled rows (Finding #1, #2, …) with severity + supporting photos.",
        "<b>Restoration vs Replacement Stamp:</b> two checkboxes auto-output \"Restoration Path Recommended\" "
        "or \"Replacement Required\" on the cover page.",
        "<b>Recommendations:</b> bulleted next steps.",
        "<b>Budget Priority:</b> A / B / C ranking on the cover.",
    ], styles))
    story.append(Paragraph("Photo picker", styles["h2"]))
    story.append(Paragraph(
        "Pulls directly from the Deal's Project Photo library (8-column grid). No re-uploading needed — pick "
        "the same photos for the assessment, the proposal, the close-out packet.",
        styles["body"],
    ))

    # ---------- 6. Scopes, Spec Sheets ----------
    story.append(Paragraph("6. Scopes, Spec Sheets &amp; In-App Scope Editor", styles["h1"]))
    story.append(Paragraph(
        "The <b>Scope</b> is your standard system-level spec sheet (e.g., GAF Liberty Cap Sheet 3-Ply over "
        "tapered iso). Pick a base scope on the Deal; the CRM auto-generates the spec-sheet bullets, "
        "warranty language, and exclusions in the PDF.",
        styles["body"],
    ))
    story.append(Paragraph("In-App Scope Editor", styles["h2"]))
    story.append(Paragraph(
        "Click <b>Edit Scope</b> on the Deal to open a modal where you can edit each spec-sheet bullet "
        "in-place. The overrides are persisted on the Deal as <b>scope_overrides</b> and used by the PDF "
        "generator. Every save is snapshot-PDF'd into the Activity Timeline so you can see what was sent "
        "to the customer at each revision.",
        styles["body"],
    ))
    story.append(Paragraph("Email Scope", styles["h2"]))
    story.append(Paragraph(
        "Opens a modal with the customer's email pre-filled, an editable cover note, and the latest scope "
        "PDF attached. Sends through your Gmail SMTP integration. The Deal's status timeline records the "
        "send event (timestamp, recipient, attachment count) and the pipeline dot for \"Scope Sent\" turns "
        "green automatically.",
        styles["body"],
    ))

    # ---------- 7. Public Proposal Sign-Off ----------
    story.append(Paragraph("7. Public Proposal Sign-Off", styles["h1"]))
    story.append(Paragraph(
        "Every Deal can be sent as a public, signable proposal via the URL <b>/sign/&lt;token&gt;</b>. The "
        "customer doesn't need a CRM account — they see the proposal in their browser, type their name + "
        "email, draw their signature on a canvas, and click <b>Accept &amp; Sign Proposal</b>.",
        styles["body"],
    ))
    story.append(Paragraph("What happens on sign", styles["h2"]))
    story.append(_bullets([
        "If the Deal is in a pre-Won stage (Lead / Past Lead / Assessment / Scope Sent) → status auto-promotes to <b>Won</b>.",
        "If the Deal is already past Won (In Progress, Closed, etc.) → status is preserved (no rollback).",
        "Signature image, signer name + email, IP address, user agent, and timestamp are recorded for legal hold.",
        "An entry is added to the Status History: \"Proposal accepted (public sign-off)\".",
        "On the FIRST promotion to Won, a 50% Draft <b>Deposit Invoice</b> is auto-spawned. Open, review, send.",
    ], styles))
    story.append(Paragraph(
        "Re-signs on already-advanced deals do NOT create duplicate invoices — the auto-deposit fires only once.",
        styles["small"],
    ))

    # ---------- 8. Invoicing & Payments ----------
    story.append(Paragraph("8. Invoicing &amp; Payments", styles["h1"]))
    story.append(Paragraph("Creating a new invoice", styles["h2"]))
    story.append(_bullets([
        "On a Deal: click <b>+ Invoice</b> in the top bar. A new Draft is created.",
        "Edit line items, customize bill-to + project address, set due date and terms.",
        "Status path: Draft → Sent → Partial → Paid (or Overdue if past due).",
    ], styles))
    story.append(Paragraph("Recording a payment", styles["h2"]))
    story.append(_bullets([
        "Open the invoice (click the row in the Deal's invoice table, or use the global Invoices list).",
        "Enter Amount Paid + Payment Date + Method + Reference (check #, ACH ref, etc.).",
        "Status auto-flips to <b>Paid</b> (if full) or <b>Partial</b> (if part).",
        "GL postings are auto-created against your Books accounts.",
    ], styles))
    story.append(Paragraph("Sending an invoice via Gmail", styles["h2"]))
    story.append(Paragraph(
        "Open the invoice → <b>Email Invoice</b>. Recipient defaults to the bill-to email, message is "
        "pre-filled, and the PDF is attached. The send is logged in the timeline.",
        styles["body"],
    ))

    # ---------- 9. Final Invoice ----------
    story.append(PageBreak())
    story.append(Paragraph("9. Final Invoice (Project Completion)", styles["h1"]))
    story.append(Paragraph(
        "The Final Invoice is the closeout — it bills the contract total minus everything already invoiced "
        "(deposits, progress invoices, change orders). The CRM offers TWO ways to draft it:",
        styles["body"],
    ))
    story.append(Paragraph("(a) Manual: \"Mark Complete\" button", styles["h2"]))
    story.append(Paragraph(
        "On any Deal, click the green <b>MARK COMPLETE</b> button. The CRM computes the remaining balance "
        "(contract + approved change-orders − sum of non-void prior invoices) and drafts a Final invoice "
        "for that amount. Opens the editor inline.",
        styles["body"],
    ))
    story.append(Paragraph("(b) Auto-suggest banner on Closed", styles["h2"]))
    story.append(Paragraph(
        "When you drag a deal to the <b>Closed</b> stage AND no Final invoice exists yet AND there's a "
        "positive balance, a green banner appears at the top of the deal: <i>\"This project is Closed — "
        "ready to bill? Contract $X minus prior invoices $Y = $Z remaining balance.\"</i> One click → Final "
        "invoice drafted.",
        styles["body"],
    ))
    story.append(Paragraph("Idempotent", styles["h2"]))
    story.append(Paragraph(
        "Hitting Mark Complete or the banner twice returns the SAME invoice — no duplicate drafts. Also "
        "refuses to draft if the project's already fully invoiced.",
        styles["body"],
    ))

    # ---------- 10. Photos & Timeline PDF ----------
    story.append(Paragraph("10. Project Photos &amp; Progress Timeline PDF", styles["h1"]))
    story.append(Paragraph("Uploading", styles["h2"]))
    story.append(_bullets([
        "Drag-drop multiple photos onto the photo section.",
        "OR click <b>Upload Photos</b> to browse.",
        "OR (recommended) use the phone via <b>Send to Field</b>.",
    ], styles))
    story.append(Paragraph("Organization", styles["h2"]))
    story.append(_bullets([
        "Albums (Default, Drone, Inspection, etc.) — group shots logically.",
        "Tags (Before, During, After) — story-of-the-job markers.",
        "Cover photo — one shot is the project hero, used on PDFs.",
        "Grouped by date — photos cluster under <b>Today</b>, <b>Yesterday</b>, or <i>Mon, Jun 15</i> headings. Toggle <b>Oldest first</b> (default — before/during/after narrative) vs <b>Newest first</b>.",
    ], styles))
    story.append(Paragraph("Timeline PDF", styles["h2"]))
    story.append(Paragraph(
        "Click <b>TIMELINE PDF</b> in the photo section. The CRM generates a single PDF: cover page + "
        "per-date photo grid (2-column, each card with filename + capture time). Respects the active "
        "album/tag filter — export e.g. only Drone shots or only Before/After. Perfect for insurance "
        "close-out packets — no more manually screen-capping individual photos.",
        styles["body"],
    ))
    story.append(Paragraph("Public Customer Gallery", styles["h2"]))
    story.append(Paragraph(
        "Click <b>Share with Customer</b> to mint a public, read-only URL. The customer views all photos "
        "in their browser without an account. You can revoke the link anytime.",
        styles["body"],
    ))

    # ---------- 11. Field Capture ----------
    story.append(Paragraph("11. Field Capture (Mobile)", styles["h1"]))
    story.append(Paragraph("Two ways to land", styles["h2"]))
    story.append(_bullets([
        "<b>Deal-specific:</b> on the Deal, click amber <b>SEND TO FIELD</b> → scan QR → camera opens for that exact project.",
        "<b>General:</b> sidebar → <b>GET APP ON MY PHONE</b> → scan QR → land on the project list. Tap a project → camera.",
    ], styles))
    story.append(Paragraph("Project list view", styles["h2"]))
    story.append(_bullets([
        "Only open deals (Closed / Lost / Past Lead are filtered out).",
        "Search box at the top — type to filter live.",
        "Big tap targets — designed for thumb use.",
    ], styles))
    story.append(Paragraph("Camera view", styles["h2"]))
    story.append(_bullets([
        "Live WebRTC stream — camera stays open between shots (no native camera close).",
        "<b>Pinch</b> to zoom smoothly (1× → 6× digital).",
        "<b>Tap pills</b>: 1× / 2× / 3× plus 0.5× ultrawide on iPhone Pro / supported Androids.",
        "Big white shutter button = instant capture + auto-upload. Zero clicks per shot.",
        "<b>←</b> arrow returns to the project list.",
    ], styles))
    story.append(Paragraph("Offline mode (IndexedDB queue)", styles["h2"]))
    story.append(Paragraph(
        "When you're out of signal: the header pill turns amber (<b>Offline</b>) and shots are stored "
        "locally in your phone's IndexedDB. When you walk back into Wi-Fi or cell, the queue auto-drains "
        "in the background — every queued shot is uploaded with no input from you.",
        styles["body"],
    ))

    # ---------- 12. Books ----------
    story.append(PageBreak())
    story.append(Paragraph("12. Books — Internal Accounting Module", styles["h1"]))
    story.append(Paragraph(
        "Multi-entity general ledger built into the CRM. Each Invoice issue / payment / vendor bill / "
        "vendor payment automatically posts a Journal Entry against your Chart of Accounts.",
        styles["body"],
    ))
    story.append(_bullets([
        "<b>Chart of Accounts:</b> Income, Cost of Goods, Operating Expenses, Asset/Liability ledgers.",
        "<b>Journal Entries:</b> manual or auto-posted. Searchable + drillable to source.",
        "<b>Reports:</b> Profit &amp; Loss, Balance Sheet, Cash Flow Statement, Account Activity.",
        "<b>Reconciliation:</b> mark JEs reconciled to bank statements.",
    ], styles))

    # ---------- 13. Vendors & COI ----------
    story.append(Paragraph("13. Vendors, Bills &amp; COI Reminders", styles["h1"]))
    story.append(Paragraph(
        "Track every supplier and sub-contractor. Each vendor has:",
        styles["body"],
    ))
    story.append(_bullets([
        "Contact info + W-9 status.",
        "<b>Certificate of Insurance (COI)</b> with expiration date. Background job pings you 30/14/7 days before expiry.",
        "Vendor Bills — line-item against a project for accurate per-job P&amp;L.",
        "Vendor Payments — auto-creates the cash-disbursement JE.",
    ], styles))

    # ---------- 14. Calendar ----------
    story.append(Paragraph("14. Calendar &amp; Google Sync", styles["h1"]))
    story.append(Paragraph(
        "Project schedule lives on the Calendar — drag events to reschedule, click to open the underlying "
        "Deal or Task. When Google Calendar OAuth is configured (admin), the CRM bidirectionally syncs "
        "events — schedule a job in the CRM, it shows up on your phone's calendar instantly.",
        styles["body"],
    ))

    # ---------- 15. Tasks ----------
    story.append(Paragraph("15. Tasks", styles["h1"]))
    story.append(_bullets([
        "Personal follow-ups + project punch lists.",
        "Assign to yourself or other users. Due dates, priority.",
        "Tasks linked to a Deal show on the Deal page's Tasks pane.",
    ], styles))

    # ---------- 16. Reports ----------
    story.append(Paragraph("16. Reports, Cash Flow &amp; Statements", styles["h1"]))
    story.append(_bullets([
        "<b>Cash Flow Statement:</b> rolling 30/60/90 day view of money in/out, broken by category.",
        "<b>Assessment Reports:</b> filter assessments by date, type, status.",
        "<b>Stale Deals:</b> deals with no activity beyond your threshold. Emailed every Monday morning.",
        "<b>Outstanding Invoices:</b> aging buckets (current / 30 / 60 / 90+).",
        "<b>Vendor COI Status:</b> who's expiring soon.",
    ], styles))

    # ---------- 17. Admin ----------
    story.append(Paragraph("17. Admin — Schedule, Users, Trash", styles["h1"]))
    story.append(Paragraph("Schedule (admin)", styles["h2"]))
    story.append(_bullets([
        "Background jobs (APScheduler) — Lead auto-promotion + Monday Stale Deals digest.",
        "Inline cron editor: day-of-week, hour, minute.",
        "Live reload — change applies on save.",
    ], styles))
    story.append(Paragraph("Users", styles["h2"]))
    story.append(_bullets([
        "Admins can invite users with role (admin / sales / field).",
        "Each user has email, name, title (e.g., \"General Manager\").",
        "Notifications are sent to a user's stored email — keep it correct to avoid bounce-backs.",
    ], styles))
    story.append(Paragraph("Trash", styles["h2"]))
    story.append(_bullets([
        "Soft-deleted records (deals, invoices, contacts) land here.",
        "Restore with one click within the retention window.",
        "Otherwise auto-purged after the configured TTL.",
    ], styles))

    # ---------- 18. PWA ----------
    story.append(Paragraph("18. PWA &amp; Offline Behavior", styles["h1"]))
    story.append(Paragraph(
        "The CRM is a Progressive Web App. A service worker (current version v4) caches the shell so the "
        "app loads instantly. HTML is fetched <b>network-first</b> (so you always see the latest code when "
        "online); static assets are <b>cache-first</b> (instant loads). The Field Capture page additionally "
        "queues photo uploads in IndexedDB while offline and drains them on reconnect.",
        styles["body"],
    ))
    story.append(Paragraph(
        "To force a cache refresh on a phone: swipe up to fully close Safari (don't just background it), "
        "then reopen the URL. The new service worker activates on next visit.",
        styles["body"],
    ))

    # ---------- 19. Tips ----------
    story.append(PageBreak())
    story.append(Paragraph("19. Tips, Shortcuts &amp; Troubleshooting", styles["h1"]))
    story.append(Paragraph("Common pitfalls", styles["h2"]))
    story.append(_kv_table([
        ("Black camera on phone", "iOS denied permission. Settings → Safari → Camera → set the SealTech site to <b>Ask</b> or <b>Allow</b>."),
        ("\"Link expired\" on QR", "Token is single-use OR expired (5-min TTL). Generate a fresh QR."),
        ("Don't see your paid deposit", "Scroll past KPI tiles. The <b>Invoices on this project</b> table lists every invoice."),
        ("Full CRM on phone", "Append <b>?desktop=1</b> to any URL once."),
        ("Bounce-back emails", "Check the user's email in the DB — placeholder/seed emails (admin@roofingcrm.com) cause bounces. Update via admin."),
        ("Wrong signature look", "Make sure you're on the latest build — the canvas-coords fix is in v4 of the SW. Hit Clear and re-sign."),
        ("Pipeline rolled backward", "Fixed: signing only promotes pre-Won statuses now."),
    ], styles))
    story.append(Paragraph("Pro tips", styles["h2"]))
    story.append(_bullets([
        "Take a Before, During, and After shot from the SAME ANGLE each time — the Timeline PDF tells a much better story.",
        "Set a cover photo for every deal — it shows on PDFs and the Customer Gallery.",
        "Drag a deal to Closed BEFORE generating the Final Invoice — the auto-suggest banner makes it one-click.",
        "Mark vendor COIs the moment you receive them — the 30-day warning saves you on jobsite emergencies.",
        "Use the Magic-Link QR to demo the CRM on a prospect's phone without giving them an account.",
    ], styles))

    # ---------- 20. Glossary ----------
    story.append(Paragraph("20. Glossary", styles["h1"]))
    story.append(_kv_table([
        ("CRM", "Customer Relationship Manager — the central app."),
        ("Deal", "A potential or active project. Lives in the pipeline."),
        ("Pipeline", "The left-to-right stages a Deal moves through."),
        ("Stale Deal", "A deal with no activity for longer than your threshold."),
        ("Scope", "Your standard system-level spec sheet (e.g., GAF Liberty Cap Sheet 3-Ply)."),
        ("Spec Sheet", "Output of the Scope + In-App Editor — the PDF the customer signs."),
        ("Assessment", "Structured roof inspection report — 6-step wizard, branded PDF."),
        ("Deposit Invoice", "First invoice on a Deal — typically 50% on signing."),
        ("Final Invoice", "Closeout invoice — contract minus everything already billed."),
        ("Change Order", "Approved addition or deduction to the contract scope."),
        ("Field Capture", "Mobile photo capture screen at <b>/field</b> — zero-CRM-clutter."),
        ("Magic Link", "5-minute, single-use QR/URL that signs you in on another device."),
        ("PWA", "Progressive Web App — installable on phone/desktop, works offline."),
        ("COI", "Certificate of Insurance — vendor liability proof."),
        ("GL / JE", "General Ledger / Journal Entry — accounting Books primitives."),
        ("P&amp;L", "Profit &amp; Loss statement — revenue minus expenses."),
    ], styles))

    doc.build(story)
    return buf.getvalue()
