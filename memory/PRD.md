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

## Books Module — Journal Activity Feed (2026-02) ✅
- ✅ Books page now has tabs (data-testid `tab-coa` / `tab-activity`); hash-driven state (#activity) survives reloads and shareable URLs
- ✅ `JournalFeed` component on the Activity tab pulls `/api/books/journal-entries?entity_id=X&include_reversed=...` and displays every GL event with kind badge (Invoice Issued / Payment Received / Bill Received / Bill Paid), date, memo, ALL DR/CR lines with color-coded numbers, and total
- ✅ Filter by event kind + Include-reversed toggle; running totals shown in the header counter (DR/CR)
- ✅ Reversed entries render at 50% opacity with strikethrough + red "REVERSED" badge
- ✅ "Open Invoice / Open Bill" deep-link on each row → `/invoices?focus=<id>` or `/payables?focus=<id>` (focus param ready for future scroll-to-row)
- ✅ Empty state: friendly message when an entity has no GL activity yet
- ✅ Tested: 6/6 new + 14/14 Phase 2 regression + 12/12 frontend flows pass (`/app/test_reports/iteration_5.json`, `/app/backend/tests/test_books_phase3.py`)

## Books Module — Phase 3 reports (2026-02) ✅
- ✅ `gl.report_profit_loss(entity, date_from, date_to)` — Income Statement with Revenue / COGS / Gross Profit (+ margin %) / Operating Expense / Other / Net Income (+ margin %)
- ✅ `gl.report_balance_sheet(entity, as_of)` — Assets / Liabilities / Equity with current-period earnings rolled into total equity; `out_of_balance` reconciliation check (epsilon 0.01)
- ✅ Drill-down support on `/api/books/journal-entries` via `account_id`, `account_number`, `date_from`, `date_to`, `source_id` filters
- ✅ Three new endpoints: `GET /reports/profit-loss`, `GET /reports/balance-sheet`, `POST /late-fees/accrue` (admin only)
- ✅ `gl.accrue_late_fees(entity_id?, as_of?)` — month-end batch posting 1.5% × balance × DR 1100 / CR 4200 for every unpaid invoice >30 days past due. Idempotent: `posting_key = "invoice:{id}:late_fee:{YYYY-MM}"`. Returns counts (accrued / skipped) + total.
- ✅ Frontend `/pages/BooksReports.jsx` — ProfitLossReport, BalanceSheetReport, LateFeeAccrualTool, DrilldownModal, DateRangeQuick presets (MTD / YTD / Last 30d / All) + print button
- ✅ Books page now has 5 tabs (`coa`, `activity`, `pl`, `bs`, `latefees`); hash-routing supports browser back/forward via `hashchange` listener
- ✅ Click any P&L or B/S row → drilldown modal lists every journal hitting that account in the window, with deep-link to source invoice / vendor bill
- ✅ Tested: 13/13 new + 31/31 regression pytest + full Playwright suite pass (`/app/test_reports/iteration_6.json`, `/app/backend/tests/test_books_phase4.py`)

## Books Module — Period Close (2026-02) ✅
- ✅ New `/app/backend/period_close.py` — orchestrator: preview / run / reopen / list
- ✅ `run_close(entity, period)` in order: (1) late-fee accrual for the month → (2) depreciation entry (DR 6600 / CR 1510 = entity.monthly_depreciation, idempotent via posting_key `period_close:{entity_id}:depreciation:{period}`) → (3) generate P&L + Balance Sheet PDFs via `period_close_pdf.py` and upload to Library under `Books / Period Close Snapshots` → (4) set `entity.lock_through = YYYY-MM-31` → (5) persist a `period_closes` audit record
- ✅ `gl.post_journal` now respects `entity.lock_through` — any CRM event with date ≤ lock_through is silently refused (warning logged); `bypass_period_lock=True` flag lets the orchestrator itself post the depreciation entry safely
- ✅ `reopen_period(entity, period)` flips `is_reopened=true` and recomputes `entity.lock_through` to max(remaining closed period_end) — instantly re-allows postings
- ✅ Added `6600 Depreciation Expense` (system) to DEFAULT_COA; existing entities auto-seeded on next boot
- ✅ Entity model: new `monthly_depreciation` (editable on Entity modal) and `lock_through` (system-managed, preserved by PUT)
- ✅ Library taxonomy adds `Books` category with `Period Close Snapshots`, `Tax & Audit Packets`, `Bank Statements` subcategories
- ✅ New endpoints: `GET /period-close/preview`, `POST /period-close/run` (admin), `POST /period-close/reopen` (admin), `GET /period-close/list`
- ✅ Frontend `/pages/BooksPeriodClose.jsx` — entity lock pill, period dropdown, monthly-depr readout, 4-step action checklist, snapshot totals + balanced indicator, run button, history table with Reopen
- ✅ Books page now has 6 tabs (`coa`, `activity`, `pl`, `bs`, `latefees`, `close`); hash-routed
- ✅ Tested: 12/12 new pytest + 100% frontend Playwright pass (`/app/test_reports/iteration_7.json`, `/app/backend/tests/test_books_period_close.py`)

## Books Module — Phase 4 (Inter-Company + Bank Rec) (2026-02) ✅
- ✅ Invoices and Vendor Bills carry a new `counter_entity_id` field. When set, GL hooks auto-post both **issuer-side** (DR 1900 / CR 4900 for invoice; DR 6700 / CR 2900 for bill) AND a **mirror** journal on the counter entity (source_type `invoice_ic_mirror` / `vendor_bill_ic_mirror`). Both journals tagged `counter_entity_id` + `is_inter_company` for the reconciliation pivot.
- ✅ Symmetric in both directions — Parent → WSCS, WSCS → Parent, Darren → WSCS, etc. all balance to the penny.
- ✅ Mirrors handle status change, entity change, counter change, and delete (full reversal).
- ✅ New `GET /api/books/reports/inter-company` — pivots every A↔B pair, surfaces diff_recv_vs_payable + diff_payable_vs_recv with `balanced` and `all_balanced` flags.
- ✅ New `bank_rec.py` module: `bank_reconciliations` + `bank_clearings` collections.
- ✅ Endpoints: `/bank-rec/accounts`, `/bank-rec/lines`, `/bank-rec/list`, `/bank-rec/{id}`, `POST /bank-rec/save` (admin), `POST /bank-rec/{id}/reopen` (admin), `DELETE /bank-rec/{id}` (admin).
- ✅ Reconciliation flow: select bank account → list all journal lines on that account through statement_date → toggle cleared → Save Draft (open) or Lock (writes idempotent `bank_clearings`, freezes clearings). Reopen unwinds clearings tied to that rec.
- ✅ Frontend `/pages/BooksInterCoBank.jsx` — InterCompanyReport (pair table with green/rose balanced indicator) + BankReconciliationTool with full editor (account select, statement date+balance, line checklist, diff banner, lock/save/reopen/delete buttons).
- ✅ Books page now has **8 tabs**: COA · Activity · P&L · BS · Late Fees · Period Close · Inter-Co · Bank Rec.
- ✅ Tested: 20/20 new pytest + full regression pass (`/app/test_reports/iteration_8.json`)

## Construction & Non-Roofing Projects Support (2026-02) ✅
- ✅ Dropdown labels updated: "Current Roof Type" → "Current Roof Type / Or Construction Project"; "Proposed Roof Type" → "Proposed Roof Type / Other Construction Project"
- ✅ New options: `Other Construction Work` (current side), `Construction Project` + `Other` (proposed side); Project Type already had `Other`
- ✅ New `custom_scope` free-form text field on Deal model
- ✅ New `CUSTOM_SCOPE_TEMPLATE` in `spec_sheet.py` with `dynamic_scope=True` flag; `_resolve_template` short-circuits to it for Construction Project / Other / Other Construction Work (beating the new-construction lookup)
- ✅ PDF builder splits custom_scope text by paragraph break — first paragraph → "Scope of Work" bullets, rest → "Project Requirements"; still produces exactly **3 pages** (cover · scope · terms)
- ✅ Page-1 "PRODUCT TYPE" label renders "Construction Project — Custom Scope" instead of the nonsensical auto-generated "Construction Project Roof System Over..."
- ✅ Frontend: Deals form shows the Custom Scope textarea only when proposed=Construction Project/Other OR current=Other Construction Work; DealDetail page renders the saved scope in a "Custom Scope (on proposal PDF)" panel
- ✅ Tested: 9/9 pytest + 12/12 frontend checks (`/app/test_reports/iteration_10.json`, `/app/backend/tests/test_construction_scope.py`)

## Construction Projects — Single Price, No Warranty (2026-02) ✅
- ✅ Form (Deals.jsx): when proposed = Construction Project / Other (or current = Other Construction Work), warranty add-on rows are replaced by a "no manufacturer warranty tiers" notice, and the pricing block collapses to **ONE field** `Project Price ($)` (writes to `proposal_option_1`; options 2/3/25yr forced to 0).
- ✅ DealDetail.jsx: shows a single `Project Price` row instead of Option A/B/C/D.
- ✅ PDF (spec_sheet.py): `_pricing_table` short-circuits when `template.dynamic_scope=True` and renders a single-row "Construction Project — Custom Scope · Project Total $XX,XXX" block. PRODUCT TYPE header drops the "(Standard Warranty Included)" tag. Page-2 roof-specific Inclusions block also suppressed.
- ✅ Verified by pypdf: $26,000 shows · no 10/15/20-yr warranty text anywhere · no "roof system, including walls and flashings" · Custom scope still rendered · Exclusions + Terms preserved.

## Books Module — Phase 7 (Locked-Period UI Warning) (2026-02) ✅
- ✅ New `gl.check_period_lock(entity_id, posting_date)` helper
- ✅ Backend `_invoice_gl_warnings` and `_bill_gl_warnings` populate a `gl_warnings: [{type, side, kind, entity_id, posting_date, lock_through, message}]` list on Invoice + VendorBill responses when the GL post is deferred (issuer-side, payment-side, AND inter-co mirror-side coverage). CRM persistence is unaffected.
- ✅ Frontend `showGlWarnings(toast, data)` util in `/lib/api.js` emits one Sonner `toast.warning(...)` per entry (9s, with `Locked through YYYY-MM-DD` as description). Wired into InvoiceEditor + BillEditor save handlers.
- ✅ Cosmetic: fixed `<span>`-in-`<option>` hydration warning on Bank Rec account dropdown
- ✅ Tested: 15/15 new pytest + 20/20 Phase-6 regression + live Sonner toast capture (`/app/test_reports/iteration_9.json`, `/app/backend/tests/test_books_phase7_gl_warnings.py`)

## Construction Project — Form Restructure + Exclusions Defaults (2026-02) ✅
- ✅ **Bug fix**: Legacy `custom_scope` no longer auto-distributes across 3 buckets by blank lines (that was mis-labeling real data — e.g. "Site preparation" landing under "Exclusions" just because it was paragraph #3). All legacy text now dumps into Project Requirements only.
- ✅ Exclusions defaults: New deals start with the standard 3-bullet boilerplate (`Permit fees · hazardous materials · work outside scope`) pre-filled. PDF also falls back to defaults if the field happens to be blank at render time.
- ✅ Deal form restructured: PR + OR grouped together inside a **blue-bordered "Scope of Work"** panel; Exclusions moved into a visually-separate **amber-bordered "Standard Boilerplate"** panel below with a "Reset to defaults" button and a help hint clarifying these rarely change.
- ✅ `openEdit` re-applies exclusion defaults to legacy deals that never set their own (non-destructive — only fires when the field is empty).
- ✅ Tested: 9/9 pytest including 2 new — `test_legacy_custom_scope_dumps_all_to_project_requirements` proves no section bleed-over; `test_explicit_exclusions_override_defaults` proves user-provided exclusions win over the boilerplate.

## Construction Project — 2-Page PDF Rebuild (2026-02) ✅
- ✅ New dedicated 2-page rendering function `_build_construction_2page` in `spec_sheet.py`. Bypasses the standard 3-page roofing flow when `dynamic_scope=True` (Construction Project / Other / Other Construction Work).
- ✅ Page 1: SealTech logo + centered **PROJECT SCOPE** title + Contact / Project Address / Project Type / Date header table → outlined scope block with 3 buckets (**Project Requirements / Other Requirements / Exclusions**) → blue full-width **PROJECT TOTAL** bar → appreciation line → "**Darren Oliver, CSI, IIBEC**" signer (hardcoded — always Darren per business policy) → Acceptance Of Scope block with By/Title/Signature/Date.
- ✅ Page 2: TERMS AND CONDITIONS — all 9 sections (PAYMENT TERMS, ACCOUNTS, FINAL INSPECTION, PERFORMANCE OF WORK, FORCE MAJEURE, ADDITIONAL WORK, ACCESS, PAID IN FULL, CANCELLATION) using the same boilerplate as the roofing template.
- ✅ Backend Deal model (`server.py`) extended with 4 new fields: `construction_project_requirements`, `construction_other_requirements`, `construction_exclusions`, `project_type_override`. All optional and back-compat: if the 3 new buckets are empty, legacy `custom_scope` is auto-split on blank lines into the same 3 buckets.
- ✅ Frontend Deal form (`Deals.jsx`) — when Proposed Roof Type = "Construction Project"/"Other": renders the "Construction Scope · 2-Page PDF" panel with 4 dedicated inputs (project type override + 3 textareas). The legacy single-textarea is collapsed inside a `<details>` advanced disclosure for back-compat editing.
- ✅ DealDetail view (`DealDetail.jsx`) surfaces the 3 buckets and project_type_override when present; falls back to displaying legacy `custom_scope` if those are empty.
- ✅ Project Type label on PDF: auto-pulled from `proposed_roof_type`, overridable per-deal via `project_type_override`.
- ✅ Tested: 8/8 new pytest (`/app/backend/tests/test_construction_2page.py`) — exactly 2 pages, all section headers present on each page, signer always Darren, project_type_override honored, legacy custom_scope back-compat verified.


- ✅ New `/app/frontend/src/lib/format.js` with `maskPhoneInput`, `formatPhoneDisplay`, `maskTaxIdInput`. Phone helper normalizes any input (`5551234567`, `555.123.4567`, `(555) 123-4567`, `1-555-123-4567`) to `555-123-4567`; strips leading country-code "1"; preserves trailing extensions (`x100`, `ext 4`).
- ✅ Shared `Input` component (Contacts.jsx, used by Contacts/Properties/Vendors/Users/Deals) extended with `format="phone" | "ein" | "ssn"` prop — live-masks as the user types AND re-formats on blur (catches paste-then-tab edge case).
- ✅ Phone fields wired across the app: Contacts (work/mobile/primary/fax), Properties (on-site contact phone), Vendors & Subcontractors (work/mobile/primary/fax), Users, Profile, Books → Entity Modal.
- ✅ Phone display formatting applied to list rows: Contacts, Properties, Vendors, Users, Maintenance, DealDetail — legacy records with un-hyphenated numbers now render with hyphens too.
- ✅ Tax-ID EIN/SSN selector: added `tax_id_kind` field on Entity (`books.py`) and `tin_kind` on Vendor (`server.py`); both default to `"EIN"`. UI shows a radio toggle (EIN ↔ SSN) right above the input; switching kinds re-masks the existing digits to the new format (33-1234567 ↔ 331-23-4567). EIN mask = `XX-XXXXXXX`, SSN mask = `XXX-XX-XXXX`, both capped at 9 digits.
- ✅ Tested: 8/8 frontend formatting scenarios (paste dots, parens, leading-1, EIN typing, EIN→SSN switch re-mask, fresh SSN, entity phone) + Contacts list legacy-data display.

## Books Module — Manual Journal Entries (2026-02) ✅
- ✅ New `ManualJournalIn` Pydantic model + `POST /api/books/journal-entries/manual` (admin-only) — validates 2+ lines, balanced DR/CR, mutually-exclusive DR/CR per line, accounts owned by the selected entity, and respects the per-entity `lock_through` period lock.
- ✅ Posts via `gl.post_journal` with `source_type="manual"`, `kind="adjustment"`, tagged `is_manual=true` + `posted_by_name` for audit traceability.
- ✅ New `POST /api/books/journal-entries/{id}/reverse` (admin-only) — only manual entries can be reversed from the Activity feed; also respects the period lock on the original posting date.
- ✅ Frontend `BooksCOA.jsx` Activity tab: violet "New Journal Entry" CTA + full modal composer (date picker, memo, multi-row DR/CR table with account dropdowns grouped by Asset/Liability/Equity/etc., live "✓ Balanced" / "Out of balance by $X" indicator, Add/Remove line, line-level memos, post button gated on balanced+memo).
- ✅ Manual entries get a violet "Manual Adjustment" badge in the activity feed and a "Reverse" button (admin-only) in place of the source-doc link; reversed entries are visually crossed out and opacity-dimmed.
- ✅ "Manual Adjustment" added to the kind filter dropdown.
- ✅ Tested: 7/7 new pytest (`/app/backend/tests/test_books_manual_journal.py`) + frontend smoke (composer modal renders, account dropdown grouped, live balance indicator works).

### Admin Trash — Empty-keyword validation hardened + UI hint banner (Feb 2026)
- Bug: bulk `Empty Trash` rejected `EMPTY` when typed with quotes / different case / surrounding whitespace.
- Fix: `/app/frontend/src/pages/Trash.jsx` normalises input via `replace(/["'`]/g,"").trim().toUpperCase()` before comparison.
- Single-item purge prompt simplified to require `DELETE` keyword (also case-insensitive + quote-tolerant) instead of typing the long item label.
- Amber reminder banner at top of Trash page: "Single row → DELETE · Empty Trash → EMPTY".

### Books — Cash Flow Statement (Indirect Method) (Feb 2026)
- New `GET /api/books/reports/cash-flow?entity_id=&date_from=&date_to=` endpoint returning Operating / Investing / Financing sections with full reconciliation to Bank ledger movement.
- Indirect method: Net Income + Depreciation add-back ± Δ non-cash working capital = Operating; − Δ Fixed Assets = Investing; + Δ Long-term debt + Δ Equity (excl. RE) = Financing.
- Reconciliation invariant: Operating + Investing + Financing == Bank-ledger change (verified ±$0.01, shown as ✓ Reconciles badge or red ⚠ warning if drift).
- New "Cash Flow" tab in Books, drill-down to journal lines per account row.
- Files: `/app/backend/gl.py` (`_cf_classify`, `report_cash_flow`), `/app/backend/books.py` endpoint, `/app/frontend/src/pages/BooksReports.jsx` (`CashFlowReport`), `/app/frontend/src/pages/BooksCOA.jsx` (tab wiring).
- ✅ Tested: 8/8 new pytest + frontend e2e (100% pass).

### Per-Entity / Per-Customer Configurable Late-Fee Rate (Feb 2026)
- Moved hardcoded 1.5% to a resolver chain: **Customer override → Entity default → 1.5% fallback**.
- `Entity.late_fee_rate_pct` (default 1.5%) editable in Entity modal; auto-migration backfills 1.5 for existing entities on boot.
- `Contact.late_fee_rate_pct` (optional override; null = inherit entity). "Clear override" button on contact form.
- Resolver `gl.resolve_late_fee_rate(entity, customer)` returns decimal; `resolve_late_fee_rate_pct(...)` returns percent for display.
- Wired through: GL accrual batch, invoice PDF footer text, invoice email body+HTML, statement PDF, statement email body+HTML, `/contacts/{id}/statement-summary` payload (`late_fee_rate_pct` field), and the aging late-fee math.
- Handles edge cases: zero is a valid override (charges 0%), null falls back, malformed/negative values ignored.
- Files: `gl.py`, `books.py`, `server.py`, `statement_pdf.py`, `invoice_pdf.py`, `BooksCOA.jsx`, `Contacts.jsx`.
- ✅ Tested: 8/8 resolver unit tests + 8/8 integration tests + frontend e2e (100% pass).

### Recurring Journal Templates (Feb 2026)
- Save the current journal-entry layout as a reusable template (name, description, default_memo, lines snapshot).
- Load any template from a dropdown inside the Manual Journal composer → prefills memo + lines instantly.
- Tracks `use_count` + `last_used_at`; dropdown sorts MRU.
- Soft-delete to Admin Trash (restorable like any other entity).
- Snapshots account number/name/type per line so renaming an account later doesn't break the template's UX; validation runs at use-time.
- Endpoints: `GET/POST/PUT/DELETE /api/books/journal-templates`, `POST /api/books/journal-templates/{id}/use`.
- UI: violet "Templates" toolbar in ManualJournalModal; SaveTemplateModal sub-modal for naming.
- ✅ Tested: 9/9 backend pytest + frontend e2e (100% pass).

### Bulk Vendor-Bill CSV Import with GL Impact Preview (Feb 2026)
- New "Bulk CSV" button on Payables page → modal with 3 steps: Pick file → Preview → Done.
- Server parses CSV (case-insensitive headers, accepts synonyms like `vendor_name`, `supplier`, `payee`), matches vendors (case-insensitive exact + prefix), resolves expense accounts (csv-number → csv-name → vendor-category default), and returns per-row preview with `gl_lines:[{side:DR/CR, account_number, amount}]`.
- Lenient parsers: dates accept ISO, MM/DD/YYYY, M/D/YY; amounts accept `$1,234.56`, `(123)` for negatives.
- Preview table flags each row: ✓ Valid (green) or list of errors (red). Commit only runs valid rows; invalid skipped with reasons.
- Each created bill posts through the normal GL pipeline (DR expense / CR 2000 AP) — same path as Add Manual Bill.
- Endpoints: `POST /api/vendor-bills/csv-preview` (multipart), `POST /api/vendor-bills/csv-commit` (JSON).
- ✅ Tested: 9/9 backend pytest + frontend e2e (100% pass).

### Commercial Roof Assessment Reports (Feb 2026)
- New "Assessments" module with sidebar nav, list page, and 5-step wizard editor; also accessible from Deal Detail via "New Assessment" button (auto-links and prefills property/contact).
- 5-step wizard: **Cover & Property → Roof Asset Score → Condition Findings → Analysis & Options → Plan & Recommendation**.
- Roof Asset Dashboard™ — 8 metrics (Roof Asset Score, Condition Rating, Remaining Service Life, Restoration Suitability, Capital Risk, Hail Resilience, Maintenance Status, Warranty Status) each with slider + numeric input + reasoning line. Color-coded (≥80 green, 60-79 amber, <60 red).
- R-1 through R-5 Asset Condition Findings, each with severity dropdown, observations/risk/recommendation textareas, and up to 4 photos pulled from the linked deal's project_photos library (with in-editor upload-new flow).
- Aerial roof image picker (single photo) + Restoration Suitability rating buttons + 6 supporting-factor checkboxes + 8-row scope checkboxes.
- Repair-vs-Restoration-vs-Replacement comparison: 3 options with cost / life extension / disruption + advantages/disadvantages/limitations bullet lists.
- Capital Planning Forecast: 1/3/5/10-year outlooks. Recommended Roof Asset Plan™ with budget priority + 3 action horizons.
- 12-page branded PDF generated via ReportLab (`assessment_pdf.py`) embeds photos from object storage; reconciliation page count uses two-pass rendering.
- "Mark Final" toggles status; "View PDF" opens auth-fetched blob in new tab; "Email PDF" sends via `assessments@` alias.
- **Convert Assessment → Scope** button on the editor: pre-fills the linked Project's 2-page Construction PDF with Recommended Strategy + Immediate/Near-term Actions → Project Requirements, R-1..R-5 recommendations → Other Requirements, Long-term Actions + standard exclusions → Exclusions. Auto-picks scope subtitle from the SealTech Recommendation checkbox (Restoration / Full Replacement / Partial Replacement / Repair & Maintenance / Maintenance Program / Drainage Improvements).
- Soft-delete to Admin Trash (restorable).
- Endpoints: `GET/POST/PUT/DELETE /api/assessments`, `POST /api/assessments/{id}/finalize`, `GET /api/assessments/{id}/pdf`, `POST /api/assessments/{id}/email`, `POST /api/assessments/{id}/convert-to-scope`.
- ✅ Tested: 6/6 backend pytest (incl. 3 convert-to-scope tests) + full frontend e2e (100% pass).

### Assessment PDF Page-2 Polish (Feb 2026)
- "Purpose of Assessment" body text replaced with the official two-paragraph language; `Commercial Roof Assessment Report™` includes the TM mark.
- Roof Asset Score™ rows: compact score boxes (0.85" × auto, 13pt number) restructured to a single non-nested Table so the blue box left-edge sits flush with the Executive Conclusion / Overall Recommendation text boxes (verified at X=81 px in the rendered PDF — perfect alignment).
- All 6 backend assessment tests still pass.

## Backlog (P0)
- _(empty — all P0 items complete)_

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
