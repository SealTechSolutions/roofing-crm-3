# SealTech CRM — Product Requirements Document

## Original problem statement
Full-stack CRM for a commercial roofing/construction business with Auth (JWT), Dashboard KPIs, Contact/Property/Project/Vendor mgmt, Deal workflow, Object Storage Document Library, PDF generator, Gmail integration, Internal multi-entity accounting module, Project Photos with Public Gallery, Admin Trash, COI Reminders, Cash Flow Statements, Assessment Reports, Project Calendar, Google Calendar Sync, PWA Polish, Automated Stale Deals Digest, In-App Scope Editor, Public Proposal Sign-Off, Mobile QR Login, Mobile standalone field capture, Compliance tracking, Email Routing, and a robust Material Calculator with deal-syncing.

## Current state (Feb 2026)
Production-ready PWA CRM. JWT auth, Visual Deals Kanban, offline-capable field camera, ReportLab PDF generation (Assessments, Proposals, Spec Sheets, Brochures, Work Orders), In-App Scope Editor, Public Proposal & Subcontractor Work Order E-signing, Material Calculator with sizing/warranties/auto-sync, category-aware email routing, custom Work Order/Scope PDF rendering with signatures, admin-only Assigned Rep tracking.

## Recently completed
- 2026-02 — Calculator: Overhead default → 30% (config, UI, live `calculator_settings` singleton).
- 2026-02 — Calculator: Shipping → 20%, Handling → 12% defaults, font sizing tightened to 1-line.
- 2026-02 — Calculator: Custom Add-Ons section now available on **Everest/Silicone** vendor (previously WC-only).
- 2026-02 — Calculator: Added "Spray Elastic Cement" add-on row (WC).
- 2026-02 — Calculator: WC system reordering + renamed 25-Yr→15-Yr Gravel.
- 2026-02 — Metal Roof Restoration Scope PDF: 3-page layout w/ Page 1 inclusions, spacing rhythm matched.
- 2026-02 — Work Order: Library attachment + email dispatch + cursive signature font + tall description box.
- 2026-02 — Email routing/footers cleaned globally.
- 2026-02 — Admin-only Assigned Rep dropdown + badges on deals/contacts.

## Active backlog
- **P0 — Work Order Phase 2**: drawn-signature canvas on Subcontractor WO E-sign + Change Order variant.
- **P0 — Sales Brochures**: Brochure #2 (Silicone), Brochure #3 (FARM vs Silicone side-by-side).
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
