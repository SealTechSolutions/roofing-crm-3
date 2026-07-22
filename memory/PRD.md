# SealTech CRM — Product Requirements Document

## Original problem statement
Full-stack CRM for a commercial roofing/construction business with Auth (JWT), Dashboard KPIs, Contact/Property/Project/Vendor mgmt, Deal workflow, Object Storage Document Library, PDF generator, Gmail integration, Internal multi-entity accounting module, Project Photos with Public Gallery, Admin Trash, COI Reminders, Cash Flow Statements, Assessment Reports, Project Calendar, Google Calendar Sync, PWA Polish, Automated Stale Deals Digest, In-App Scope Editor, Public Proposal Sign-Off, Mobile QR Login, Mobile standalone field capture, Compliance tracking, Email Routing, and a robust Material Calculator with deal-syncing.

## Current state (Feb 2026)
Production-ready PWA CRM. JWT auth, Visual Deals Kanban, offline-capable field camera, ReportLab PDF generation (Assessments, Proposals, Spec Sheets, Brochures, Work Orders), In-App Scope Editor, Public Proposal & Subcontractor Work Order E-signing, Material Calculator with sizing/warranties/auto-sync, category-aware email routing, custom Work Order/Scope PDF rendering with signatures, admin-only Assigned Rep tracking.

## Recently completed
- 2026-02 — **Maintenance / Roof Condition Report PDF**: `GET /api/projects/{deal_id}/photos/maintenance-report.pdf` produces a client-ready PDF grouped by damage type (not date). Priority order: Damage Documentation → Detail Shots → Before → During → After → Drone → Untagged. Cover page shows report date, inspector name (from auth), photo count, and an executive summary table with per-tag counts + total annotated shots. Each section has its own header, description, and 2-col photo grid; captions call out inspector-annotated photos with a green ★ chip. When a photo has `annotated_storage_path`, the flattened marked-up PNG renders instead of the raw source, so client sees the arrows/circles/text callouts baked into the report. New `maintenance_report_pdf.py` module (~350 LOC). "Condition Report" button added next to "Timeline PDF" on the deal Project Photos section. Verified end-to-end: 9MB PDF with photos + annotations, correct summary counts, proper page breaks.
- 2026-02 — **CompanyCam Photo Annotations MVP**: Draw arrows, circles, freehand pen strokes, and text labels directly on jobsite photos. New `PhotoAnnotator.jsx` canvas modal (`z-60`) with 4 tools, 6-color palette (red/yellow/green/blue/white/black), 3 stroke widths (S/M/L), Undo, Clear all. Save flattens the source image + overlay into a full-resolution PNG on an off-screen canvas and POSTs both the blob and raw layer JSON to `PUT /api/projects/{deal_id}/photos/{photo_id}/annotations`. Editable — re-opening the annotator on an already-marked photo rehydrates every shape. `DELETE .../annotations` reverts to the raw source. `GET .../download` auto-serves the annotated PNG unless `?original=true`. "Marked" emerald badges surface on Project Photo cards, global Photo Timeline cards, and both lightboxes. Wired into `ProjectPhotos.jsx` hover toolbar + lightbox and the `/photos` timeline lightbox. Tested end-to-end: arrow + circle drawn → saved → badge appeared → flattened PNG stored at `sealtech-crm/project_photos/{deal_id}/{photo_id}-annotated.png`.
- 2026-02 — **CompanyCam-style Photo Timeline**: new `/photos` sidebar page + `GET /api/photos/all` endpoint (cross-project photo feed). Photos grouped client-side into Today / Yesterday / This Week / This Month / [Month Year] buckets. Tag chip filters (Before / During / After / Drone / etc.), day-range chips (7D / 30D / 90D / 1Y), search, lazy-loaded thumbnails with IntersectionObserver, fullscreen lightbox with EXIF timestamp + property address + tag + uploader metadata.
- 2026-02 — **iOS TestFlight pipeline SET UP** (delivery pending user's final Codemagic clicks): Apple Team ID `2J8T63SX9L` locked in, App Store Connect API key `7V3U9Q8TT6` connected to Codemagic (Developer Portal integration active), Codemagic Team `6a5fc8d6c7a9522664488997` connected to `github.com/SealTechSolutions/roofing-crm-3`, `codemagic.yaml` in repo (workflow: SealTech CRM — iOS TestFlight). Remaining user-side clicks: generate signing certificate, create `app_store_credentials` env group, trigger first build.
- 2026-02 — **Native iOS app scaffolding (Capacitor 7)**: `capacitor.config.ts`, app icon (1024) + splash (2732) from SealTech logo, `nativeCapabilities.ts` helper, setup playbook at `/app/NATIVE_APP_SETUP.md`.
- 2026-02 — **PWA/mobile UX polish**: Field Capture `h-[100dvh]` (shutter always visible, no scrolling), camera auto-retry 1→3 attempts w/ escalating backoff, `visibilitychange` + `pageshow` listeners auto-restart camera when returning from background (fixes "reload twice" bug), redesigned Get-App-On-Phone modal with prominent iOS + Android install instructions.
- 2026-02 — **Scopes discoverability**: `/scopes` sidebar page + Dashboard "Recent Scopes" widget + per-Contact/Property "Scopes (N)" chips.
- 2026-02 — Assessment PDF page-9 & page-10 fixes: aligned blue & green callout boxes to 7.3" width matching their tables, trimmed 1/8" padding, `KeepTogether` on Restoration Suitability tail keeps whole block on page 9, Option 3 fits back on page 10 (doc 14→12 pages).
- 2026-02 — **Work Order Phase 2**: drawn-signature canvas + Change Order variant.
- 2026-02 — Calculator: Overhead default → 30%, Shipping → 20%, Handling → 12%.
- 2026-02 — Calculator: Custom Add-Ons section now available on **Everest/Silicone** vendor (previously WC-only).
- 2026-02 — Calculator: Added "Spray Elastic Cement" add-on row (WC).
- 2026-02 — Calculator: WC system reordering + renamed 25-Yr→15-Yr Gravel.
- 2026-02 — Metal Roof Restoration Scope PDF: 3-page layout w/ Page 1 inclusions, spacing rhythm matched.
- 2026-02 — Work Order: Library attachment + email dispatch + cursive signature font + tall description box.
- 2026-02 — Email routing/footers cleaned globally.
- 2026-02 — Admin-only Assigned Rep dropdown + badges on deals/contacts.

## Active backlog
- **P1 — Commission Module** (spec at `/app/memory/COMMISSION_PRD.md`): blocked on user confirmation of flat % vs tiered, refund reversals, signature flow.
- **P1 — WSC Fork Strategy**: branding-constants refactor → `branding.py` first, then decide fork vs multi-tenant tag.
- **P2 — Timeline View & Photo Reorganization**: desktop drag-and-drop photo reorder.
- **P2 — server.py refactor**: split >7,200-line `server.py` into `/app/backend/routes/`.
- **P3 — Mobile-only PWA Views**: `/field/today`, `/field/calendar`, `/field/recent-photos`.
- **P3 — Stripe**: blocked on user's bank + Stripe keys.

## Architecture
- Backend: FastAPI + Motor MongoDB + ReportLab. Key modules: `server.py`, `product_catalog.py`, `spec_sheet.py`, `work_orders.py`, `proposal_signing.py`, `email_routing.py`, `email_sender.py`.
- Frontend: React + Tailwind + Shadcn. Key pages: `Calculator.jsx`, `Library.jsx`, `WorkOrderSign.jsx`, `DealDetail.jsx`, `ProposalSign.jsx`.
- Integrations: Gmail SMTP (user creds), Google Calendar (user creds), Emergent Object Storage (Universal LLM Key).

## Key collections
- `deals` — proposed_roof_type, stage, subcontractor_accepted, scope_overrides, proposal_option_1, warranty_20yr_add, assigned_to_user_id, calc_custom_addons.
- `calculator_settings` — singleton: markup_pct, handling_pct (12), overhead_pct (30), profit_pct, shipping_pct (20).
- `library_files`, `work_order_drafts`.

## Refactor debt
- `/app/backend/server.py` > 7,200 lines — split into route modules.
- Brand constants (company name, email, phone, logo) scattered across PDF generators — consolidate into `branding.py`.

## Testing notes
- ALWAYS use `TEST_` prefixed dummy deals when invoking `testing_agent_v3_fork`. Never touch real user data.
- Admin: `darren@sealtechsolutions.co` / `admin123` (see `/app/memory/test_credentials.md`).
