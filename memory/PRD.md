# SealTech CRM — PRD

## Original Problem Statement
> I need to create a simple crm for a person operation in commercial roofing, include contact name, company name, address, billing address with the option to make the same as address, property name, property address, property contact, lead source, project type, current roof type, proposed roof type, proposal with three option amounts, chosen amount, revenue P&L and we can add more later.

## Branding
- **Name**: SealTech Building Solutions
- **Logo**: `/app/frontend/public/sealtech-logo.png`
- **Colors**: Cobalt blue primary (`#1D4ED8` / `blue-700`), bronze accent (`#A0703A`), black sidebar, zinc neutrals
- **Fonts**: Chivo (headings), Public Sans (body)

## Architecture
- **Backend**: FastAPI + Motor (MongoDB async) + JWT (PyJWT) + bcrypt — `/app/backend/server.py`
- **Frontend**: React 19 + react-router-dom 7 + Tailwind + Shadcn UI + axios + sonner — `/app/frontend/src/`
- **Auth**: Email/password → JWT Bearer (stored in `localStorage` `crm_token`)
- All API routes are `/api/*` prefixed
- One-off import scripts in `/app/backend/scripts/`

## Implemented (cumulative)
- ✅ JWT auth (login/register/me) + admin seed
- ✅ Contacts / Properties / Deals CRUD with billing-same-as-address auto-copy
- ✅ Deals with 3 proposal options, chosen amount, full P&L, change orders
- ✅ Dashboard KPIs + Revenue by Type (YTD / All-Time) + Payables KPIs + Maintenance KPIs
- ✅ Maintenance Plans with visit logs, auto next-due-date
- ✅ Invoices (PDF + Gmail SMTP email, sequential INV-YYYY-NNNN)
- ✅ Payables Module (Gemini Vision invoice parsing, weekly Friday report via APScheduler)
- ✅ Materials Catalog (SKU, vendor cost, shipping %, markup %, loaded cost)
- ✅ Vendor / Subcontractor management with contact name, title, website
- ✅ Spec Sheet PDF generator with brand styling

## Recent Imports (2026-02)
- ✅ Western Colloids Pricing 2023 — 48 items imported under **National Waterproofing and Supply**
- ✅ Everest Systems (filtered) — 38 items imported under **Everest Systems**
  - Silkoxy (H3, EZ, F1, Ever-Tread walk pad)
  - Everprime (Metal, Epoxy, Bleed Block, Bleed Block SS, CS, GP, SP)
  - AF Cleaner Concentrate, EcoLevel, EverStitch 272

## Spec Sheet Templates (2026-02)
- ✅ Per-roof-type scope templates wired through `proposed_roof_type` on the deal
- ✅ Templates: Silicone (default), TPO, EPDM (incl. ballasted), ModBit, BUR, Metal, Shingle, Tile, FARM, PVC (uses TPO scope)
- ✅ Dynamic document title (e.g. "TPO ROOF SYSTEM SCOPE", "ASPHALT SHINGLE ROOF SCOPE")
- ✅ Backward compatible — `build_silicone_spec` retained as alias

## Materials UI Redesign (2026-02)
- ✅ Materials page now groups products by vendor into collapsible black-header sections
- ✅ Each section shows product count + total loaded inventory value
- ✅ Expand-all / Collapse-all shortcuts + per-vendor filter dropdown
- ✅ Inline notes column merged under product name for better readability

## Self-Service Profile + Password Change (2026-02)
- ✅ New `PUT /api/auth/me` for self-edit (name / job title / phone / credentials — never email or role)
- ✅ New `POST /api/auth/change-password` requiring current password, min 8 chars, must differ from current
- ✅ `/profile` page with two cards: Profile Details + Change Password
- ✅ Real-time password strength meter (Weak → Very Strong)
- ✅ Show/hide toggles, autocomplete attributes for browser password managers
- ✅ Sidebar avatar block is now a NavLink to `/profile` — click avatar to edit
- ✅ Renamed "Title" → "Job Title" everywhere with helper text reminding it appears on POs
- ✅ Server-side guard: rejects values that look like a bcrypt hash being saved as plain text

## Per-Rep Scope Signature (2026-02)
- ✅ Added `credentials` (free-text, e.g. "CSI, IIBEC") to User model + `/auth/me` GET/PUT + admin create/update
- ✅ Scope PDF signature pulls `name` + `credentials` from the logged-in user — "Name, Credentials / SealTech Building Solutions"
- ✅ One-time migration on app start: existing admin `name="Admin"` → "Darren Oliver" (credentials are NEVER auto-applied)
- ✅ Profile page has a **Scope Signature Preview** card that mirrors exactly how the rep's name will print on every scope PDF
- ✅ If `credentials` is blank, the comma + credentials are omitted entirely — each rep must explicitly type their own credentials; nothing is inherited from another user

## RESTORATION ROOF SCOPE Page-2 Spread (2026-02)
- ✅ Added a `spread_page_2` flag (set on SILICONE_TEMPLATE) so the shorter restoration scopes open up their Page 2 spacers + bump the cover-photo height from 1.2" → 1.6"
- ✅ Page 2 now fills ~75-85% of the sheet (vs. ~55%) without overflowing; total page count holds at exactly 3 for Silicone + all 12 other templates

## Statement of Account (2026-02)
- ✅ New `statement_pdf.py` — branded, single-page aging PDF with header, Bill-To + Remit-To blocks, **5-bucket aging summary** (Current / 1-30 / 31-60 / 61-90 / 90+), per-invoice detail with days-past-due, TOTAL BALANCE DUE row, and a remittance call-to-action
- ✅ Endpoints:
     `GET /api/customers-with-open-balance` — list every customer with an open invoice + total balance + oldest due date
     `GET /api/contacts/{id}/statement-summary` — JSON aging preview
     `GET /api/contacts/{id}/statement.pdf?token=` — download Statement PDF
     `POST /api/contacts/{id}/statement/email` — Gmail SMTP email with branded HTML body
- ✅ Frontend: **"Statements of Account"** button on the Invoices page header opens a modal listing every customer with open balance — per-row Download PDF + Email Statement actions, grand total at the top
- ✅ Email row is disabled when the customer has no `email` on file with a clear tooltip explaining how to fix
- ✅ Backend filters out Draft/Paid/Void invoices automatically; only Sent/Partial/Overdue with `balance_due > 0.01` show up

## 25-Year Tier on Project Edit & Spec Sheet (2026-02)
- ✅ New `warranty_25yr_add` field on Deal model — sits alongside warranty_20yr_add / 15 / 10
- ✅ Deal edit form now shows the 25-yr Warranty Add input (5-column row: 25 / 20 / 15 / 10 / Coating Color) and **Option labels now match year order**: A→25-yr · B→20-yr · C→15-yr · D→10-yr (alphabetical = descending warranty years)
- ✅ DealDetail page mirrors the same A/B/C/D order; the 25-yr row only appears when amount > 0
- ✅ Spec sheet `_pricing_table` adds a **25-Year row at the top** of all three non-FARM pricing tables (Base Investment, [OPTIONAL] Manufacturer Warranty, and Total Investment with Optional Manufacturer Warranty) when either `opt_25` or `w25` is > 0; typography tightens automatically (8pt / 5pt padding) so the page still holds at exactly 3 pages
- ✅ All 13 templates verified at 3 pages with and without the 25-yr row populated

## 25-Year Tier Locked to FARM Only (2026-02 — corrected)
- ✅ Spec sheet `_pricing_table`: 25-yr row now only renders when `tier_table` is set (i.e., FARM). For every non-FARM template (Silicone, TPO Over-Lay/Replacement, EPDM Over-Lay/Replacement, ModBit Over-Lay/Replacement, PVC Over-Lay/Replacement, Metal, Shingle, Tile, BUR), the three tables always show exactly 3 rows (20/15/10) — even if `opt_25` or `w25` are populated on the deal record.
- ✅ Deal form: Option A ($) — 25-yr and 25-Yr Warranty Add ($) inputs are now conditionally hidden unless the deal's `proposed_roof_type` contains "FARM" or "Fluid Applied". Grid auto-collapses from 4 cols → 3 cols when 25-yr is hidden.
- ✅ Calculate Warranties button: when scope is non-FARM, it skips Hail Rider on the 20-yr add-on AND clears any stale 25-yr value to 0; toast confirms "25-yr skipped — FARM only".
- ✅ Rate-card legend & helper text updated to call out that 25-yr + Hail Rider are FARM-only.
- ✅ Gemini PDF verification: Silicone scope confirmed to render exactly 3 rows per pricing table with no 25-year tier anywhere.

## Document Library + Email Scope w/ Attachments (2026-02)
- ✅ New **Document Library** (`/library` page in sidebar) with 6 categories × 20 sub-categories:
     • SealTech Documents: Property Owner Guides · Assessment & Reporting Documents · Insurance & Storm Education · Brochures
     • Western Colloid: Specifications · Safety Data · Brochures
     • Everest Systems: Specifications · Safety Data · Brochures
     • Certificates & Credentials: Insurance / COI · W-9 · Business License · Manufacturer Certifications
     • Contracts & Legal: Master Service Agreement · Lien Waivers · Change Orders · Terms & Conditions
     • Manufacturer Warranties: Sample Warranties · Issued Warranties · Warranty Reference
- ✅ Endpoints: `GET /library/taxonomy`, `GET/POST/PUT/DELETE /library/files`, `GET /library/files/{id}/download?token=`
- ✅ File storage via existing Emergent Object Storage (50MB max, validated category/subcategory, soft-delete)
- ✅ Frontend Library page: category sidebar with per-folder counts, search box, click-to-expand sub-categories, upload modal (category/subcategory/file/display-name/description), per-row Download + Delete actions
- ✅ Refactored `deal_spec_sheet` to share an internal `_build_spec_pdf_for_deal()` helper so the scope PDF can be built without going through HTTP
- ✅ New `POST /api/deals/{deal_id}/spec-sheet/email` endpoint: builds the scope PDF + attaches any chosen Library file IDs + sends through Gmail (supports the `from_email` alias whitelist)
- ✅ New **"Email to Prospect"** button on DealDetail (replaces the "coming soon" stub) opens a 2-column modal: left = email composition (From/To/CC/custom message), right = Library file picker (filter by category, multi-select with checkboxes). Bottom bar shows "Will send scope PDF + N library docs = N+1 total attachments".
- ✅ End-to-end verified via curl: scope PDF + 1 selected library doc → 2 attachments emailed from `projects@sealtechsolutions.co` with real Gmail Message-ID returned

## Multi-Alias Gmail "From" (2026-02)
- ✅ New env `GMAIL_FROM_ALIASES` (comma-separated) controls which Send-As aliases are allowed; default address is still `GMAIL_FROM_EMAIL`
- ✅ Currently configured aliases: `finance@sealtechsolutions.co` (default), `projects@sealtechsolutions.co`, `darren@sealtechsolutions.co`
- ✅ `send_email()` accepts an optional `from_email` kwarg and validates it against the whitelist (raises ValueError on rejection)
- ✅ New endpoint `GET /api/email-aliases` returns the list + default for the frontend
- ✅ **Invoice email modal** and **Statement email modal** now show a "From" dropdown when ≥ 2 aliases are configured; selection is forwarded as `from_email` to the backend
- ✅ End-to-end verified: real invoice sent from `projects@sealtechsolutions.co` returned a 200 + real Gmail Message-ID; bad alias correctly rejected with descriptive error

## "Calculate Warranties" Auto-Calc (2026-02)
- ✅ New **Calculate Warranties** button (Calculator icon) next to the Warranty Add-Ons section header on the Deal form
- ✅ One click auto-fills all 4 warranty add-on fields from the project's computed SqFt using the standard per-SQ rates with minimums:
     • 10-Yr: max($9.00 × SQ, $1,250)
     • 15-Yr: max($12.00 × SQ, $1,500)
     • 20-Yr: max($15.00 × SQ, $1,750) + ($3.50 × SQ Hail Rider)
     • 25-Yr: max($17.50 × SQ, $2,000) + ($3.50 × SQ Hail Rider)
- ✅ Hail Rider $3.50/SQ auto-added to 20-Yr and 25-Yr only (not available on 10/15)
- ✅ Toast confirms the SQ count + "incl. Hail Rider on 20/25-yr"
- ✅ Refuses to run with helpful error if SqFt fields are blank
- ✅ Rate-card legend printed inline under the warranty grid for quick reference

## Subcontractor Scorecards (2026-02)
- ✅ New `sub_job_logs` collection + `SubJobLogIn` model — tracks: subcontractor, optional project link, work description, scheduled date, completed date, status (Scheduled / In Progress / Completed / Cancelled), 1-5 quality rating, issues/callback count, contract amount, notes
- ✅ Auto-derived `on_time` flag (completed_date ≤ scheduled_date), auto-stamps completed_date when status flips to Completed without one
- ✅ Endpoints: `GET/POST/PUT/DELETE /api/sub-jobs` + `GET /api/subcontractor-scorecards` (aggregated metrics: total/completed/scheduled jobs, on-time %, avg quality, total awarded $, issues total, last completed, letter grade A+→D)
- ✅ Frontend: **Scorecards** button on the Subcontractors page header opens a modal with:
     • Top KPI row (Total Awarded $, Logged Jobs, Total Issues)
     • Full scorecard table with colored on-time % (emerald ≥90%, amber 70-89, red <70), quality stars, letter-grade badges (A+ emerald → D red)
     • Per-row **History** button — opens job history modal with delete action
     • Per-row **Log Job** button (and a header-level one) — opens log-job modal that pre-fills the sub and lets you record work description, dates, status, rating, $, issues, notes
- ✅ Backend math verified end-to-end via curl: 2 completed jobs (1 on-time, 1 four-days-late) → 50% on-time, avg quality 4.5; flipping the scheduled job to late completion → 33.3% on-time, avg quality 4.0, grade "C — Needs Review"

## Late-Fee Policy Wired Everywhere (2026-02)
- ✅ Backend helper `compute_late_fee(invoice, as_of)` + `compute_aging` now compute 1.5%/month on balances ≥ 30 days past due (compounds — 30-59 d = 1 mo, 60-89 d = 2 mo, …)
- ✅ Statement PDF: new **Late Fee** column on the detail table (red when > 0), three-row totals block (Subtotal → Late Fees → **TOTAL DUE incl. Late Fees** in blue), gray footer paragraph stating the full policy
- ✅ Statement summary JSON now returns `late_fees` + `total_due_with_fees` alongside `total`
- ✅ Statement email body (text + HTML) shows the late-fee breakdown when > 0 and always includes the policy block (amber-bordered HTML callout)
- ✅ Invoice PDF: new "LATE FEE POLICY" paragraph below Remittance Instructions
- ✅ Invoice email body (text + HTML) includes the policy block (amber-bordered HTML callout)
- ✅ Verified end-to-end: a real 180-day-overdue invoice ($63,875) renders $5,748.75 late fees (6 mo × 1.5%) → grand total $69,623.75 across Statement PDF, summary JSON, and email response

## Hail Rider Repositioned Beyond FARM (2026-02)
- ✅ Non-FARM warranty add-on table now labels the 20-yr and 25-yr rows as **"… Labor & Material w/Hail Rider"** so the customer sees what's included
- ✅ Deal form helper text no longer says "Leave 25-yr fields at 0 to hide that tier on non-FARM scopes" — the qualifier is gone since any scope can now offer 25-yr

## Material Take-Off / Purchase Orders (2026-02)
- ✅ New `material_takeoff[]` field on Deal — snapshots SKU/name/unit/vendor/loaded cost at add time
- ✅ Project-level take-off card on DealDetail with vendor-grouped tables
- ✅ "Add Materials" picker (Option B) — searchable catalog grouped by product family,
     multi-size qty entry on a single row, multi-line bulk add in one click
- ✅ Per-line: editable qty (auto-recalculates line total), per-line notes, delete
- ✅ **3-state pipeline per line: Pending → Ordered (blue truck) → Received (green PackageCheck)**
- ✅ Row background tints: blue when ordered, green when received
- ✅ Vendor header rolls up pipeline counts: `X/Y ordered · X/Y received`
- ✅ Per-vendor "Download PO" + "Email PO" buttons → ReportLab-built PDF (`purchase_order_pdf.py`)
- ✅ PO PDF: PO# = `<street>_<city>` (project name = PO#), ship-to from property, vendor block,
     line items (qty/size/SKU/product/notes), **NO dollar amounts**
- ✅ Internal "Estimated" cost rolls up in the take-off card (never shown on the PO PDF)
- ✅ Endpoints: `GET /api/materials/grouped`, `POST/PUT/DELETE /api/deals/{id}/takeoff(/{line_id})`,
     `GET /api/deals/{id}/purchase-order/{vendor_id}.pdf`,
     `POST /api/deals/{id}/purchase-order/{vendor_id}/email`

## Estimated vs Actual Variance (2026-02)
- ✅ `VendorBillLine` gained `takeoff_line_id` (link) + `sku` fields
- ✅ New endpoints:
     `GET /api/deals/{id}/takeoff-variance` — per-line/per-vendor/project Est/Act/Variance + $%
     `PUT /api/vendor-bills/{bill_id}/lines/{line_id}/link` — link/unlink bill line ↔ take-off line
     `GET /api/deals/{id}/linkable-bill-lines` — pickable bill lines with SKU auto-match suggestions
- ✅ "Show Variance" toggle on the take-off card adds Actual + Variance columns
- ✅ Per-line "Link Bill" button → modal listing linkable bill lines with auto-match (by SKU) section
- ✅ Variance badge: green (under) / red (over) / grey (at) with $ delta and % delta
- ✅ Footer + vendor header roll up project & vendor variance totals
- ✅ Multiple bills can link to one take-off line (sum into Actual); each bill line links to at most one

## Roof System Variants (TPO / EPDM / ModBit / PVC) — 2026-02
- ✅ Each of TPO, EPDM, ModBit, PVC now has TWO templates: **Over-Lay** and **Replacement**
- ✅ Each variant has a curated PDF title (e.g., "TPO OVER-LAY ROOF SYSTEM SCOPE") and a curated
     Product Type line on page 1 (e.g., "TPO Roof System Over Existing TPO Over-Lay")
- ✅ Bodies authored: TPO Over-Lay (user-provided verbatim), TPO Replacement, EPDM Over-Lay
     (with warranty caveat), EPDM Replacement, ModBit Over-Lay, ModBit Replacement,
     PVC Over-Lay, PVC Replacement
- ✅ Generic "TPO", "EPDM", "ModBit", "PVC" entries kept for backward compatibility

## Materials In Motion (2026-02)
- ✅ New `GET /api/dashboard/materials-in-motion` aggregating across all projects
- ✅ Dashboard card sits below Payables KPIs (hides itself when there's nothing in motion)
- ✅ Right-aligned stats: # projects with open orders · # open lines · $ open value
- ✅ Two columns: "By Project" (sorted by open value, clickable rows → project) and
     "By Vendor — Chase List" (suppliers ranked by open value, so you call the biggest first)

## FARM Spec Sheet Polishing (2026-02)
- ✅ FARM 4-tier comparison table renders on Page 2 with adaptive heading
- ✅ Removed redundant Add-On Manufacturer Warranty section + "(Standard Warranty Included)" tag for FARM (warranty options are already in-body)
- ✅ Page 1 shows the **Inclusions** blurb (e.g. "Approximately 31,000 SF (310 SQ) white Fluid Applied Reinforced Membrane system, including walls and flashings.") plus an enlarged cover photo (7.5" × 2.7") on the lower half of the page
- ✅ Page 2 no longer duplicates the Inclusions block when the template has a `tier_table`
- ✅ **4-tier FARM pricing table** on Page 1: 25-Year Warranty w/Hail Rider, 20-Year Warranty w/Hail Rider, 15-Year Standard Warranty, 10-Year Standard Warranty
- ✅ New `proposal_option_25yr` field on Deal model + form (Option D); flows through to `opt_25` in the spec sheet
- ✅ All other scope templates still hold at exactly 3 pages (TPO/EPDM/ModBit/PVC/Silicone/Metal/Shingle/Tile/BUR verified)
- ✅ Inclusions text now preserves the **FARM** acronym (e.g. "white FARM (fluid applied reinforced membrane) system")
- ✅ FARM tier comparison table on Page 2 bumped to **10pt / 13pt-leading** with bigger cell padding; Page 2 spacers opened up so the section uses most of the page

## Books Module — Phase 1 (2026-02) ✅
- ✅ New `/app/backend/books.py` module exposing `make_router(db, get_current_user, require_admin)`
- ✅ Routes: `GET/POST/PUT/DELETE /api/books/entities`, `GET/POST/PUT/DELETE /api/books/accounts`, `GET /api/books/account-types`
- ✅ `seed_default_entities(db)` runs on startup and is idempotent — seeds 4 default entities (SealTech Holdings (Parent, LLC); Western States Contracting Services, Inc. (C-Corp); SLO & Steady, LLC; Darren Oliver, LLC) plus a 44-line default Chart of Accounts per entity
- ✅ DEFAULT_COA covers 1000s Assets, 2000s Liabilities, 3000s Equity, 4000s Revenue (incl. inter-co), 5000s COGS, 6000s Opex, 9000s Other; `system` flag locks down core accounts (AR/AP/Sales/COGS/Inter-Co/Retained Earnings/Late Fees Earned)
- ✅ `is_contra` flag for Allowance for Doubtful Accounts + Accumulated Depreciation
- ✅ Unique index `(entity_id, number)` on `chart_of_accounts`
- ✅ Soft-delete pattern: entities and accounts go inactive instead of hard-delete; `include_inactive=true` flag retrieves them
- ✅ Edit endpoint never silently reactivates a deactivated entity; account `entity_id` is immutable on update (ledger integrity)
- ✅ Frontend `/app/frontend/src/pages/BooksCOA.jsx` — entity switcher (localStorage persisted), accounts grouped by Type with SYSTEM/CONTRA badges, inline edit, full add/edit Entity modal with all metadata fields (legal_name, EIN, address, remit-to)
- ✅ "Books" nav link in sidebar (`data-testid="nav-books"`); admins see Add Account / New Entity / Edit Entity controls; non-admins are read-only
- ✅ Tested end-to-end: 11/11 pytest backend + 12/12 UI flows pass (see `/app/backend/tests/test_books.py` and `/app/test_reports/iteration_3.json`)

## Books Module — Phase 2 (2026-02) ✅
- ✅ New `/app/backend/gl.py` — double-entry posting engine
- ✅ `post_journal(...)` is idempotent on `posting_key = "{source_type}:{source_id}:{kind}"` — re-saving an invoice / bill simply overwrites the existing GL entry (no duplicate rows)
- ✅ Hooks: `post_invoice_issue` (DR 1100 / CR 4xxx), `post_invoice_payment` (DR 1000 / CR 1100), `post_bill_received` (DR 5000 or 5010 by `vendor.kind` / CR 2000), `post_bill_payment` (DR 2000 / CR 1000)
- ✅ Revenue routing by roof type / invoice_type: FARM → 4030, Silicone/Restoration → 4000, New Construction → 4020, Re-Roof/Replacement → 4010 (default), Maintenance/Repair → 4100
- ✅ COGS routing by `vendor.kind`: Subcontractor → 5010, Vendor → 5000
- ✅ Voiding (status → Draft/Void) or deleting an invoice / bill **fully reverses** all linked journals (`is_reversed=true`), including the payment journal — KPIs adjust live
- ✅ Hooks wrapped in try/except — a GL failure never blocks the underlying CRUD path
- ✅ `entity_id` field added to `InvoiceIn` and `VendorBillIn`; blank = no GL posting (silent skip)
- ✅ Read endpoints: `GET /api/books/journal-entries?entity_id=X[&include_reversed=true]`, `GET /api/books/reports/kpis?entity_id=X`, `GET /api/books/reports/kpis/all`
- ✅ KPIs: cash_on_hand (sum of every account with `category="Bank"` — works for custom bank accounts too), open_ar, open_ap, mtd_revenue, ytd_revenue, ytd_cogs, ytd_gross_profit
- ✅ Frontend: Entity dropdown on **Invoice editor** (`data-testid="invoice-entity-select"`) + **Vendor Bill editor** (`data-testid="bill-entity-select"`), both default to Parent (SealTech Holdings)
- ✅ Frontend: **Dashboard "Books — Per-Entity Snapshot" strip** (`data-testid="books-kpi-strip"`) showing all 4 active entities side-by-side with Cash · Open A/R · Open A/P · MTD Revenue; auto-hides until first GL activity; clicking a row deep-links to /books with that entity pre-selected
- ✅ Tested: 14/14 backend pytest + 4/4 UI flows pass — `/app/test_reports/iteration_4.json` and `/app/backend/tests/test_books_phase2.py`

## Backlog (P0 — next Books phases)
- Books Phase 3: Per-entity P&L + Balance Sheet reports (filterable by date range, drill-down to source doc)
- Books Phase 3: Late-fee monthly accrual batch journal (DR 1100 AR / CR 4200 Late Fees Earned for outstanding A/R > 30 days @ 1.5%)
- Books Phase 4: Inter-company auto-mirroring (Parent ↔ Sub-co) and Bank Reconciliation

## Backlog (P1)
- Subcontractor scorecards (quality / on-time metrics) — DONE
- Statement of Account PDF (aging report per customer) — DONE

## Backlog (P2)
- Stripe online pay link on invoices
- In-app Scope Editor (override any spec-sheet bullet before PDF)
- Admin Trash view (restore / hard-delete soft-deleted records, incl. inactive entities/accounts)
- Google Calendar 2-way sync for project schedules
- Smart auto-attachment suggestions in Email Scope modal (pre-select Library docs by proposed_roof_type)
- Refactor `server.py` (~4,500 lines) into `/app/backend/routes/` modules
