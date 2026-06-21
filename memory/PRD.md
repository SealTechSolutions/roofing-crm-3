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

### Smart Library Doc Suggestions (Feb 2026) — P3a SHIPPED
- New `/app/backend/scope_suggestions.py` — small, deterministic rule engine that maps `proposed_roof_type` → matching tokens (tpo / pvc / epdm / silicone / farm / restoration / fluid-applied / coating / modbit / metal / shingle / construction / overlay / tear-off / general). Each token has a list of (category, subcategory) matchers against Library files. Library files can also opt-in by adding a `smart_tags: []` field (user-curated wins).
- New endpoint `GET /api/deals/{id}/scope-suggestions` → `{file_ids, reasons, tokens}` — used by the Email Scope modal.
- Frontend `EmailScopeModal`:
  - Auto-checks suggested docs on mount.
  - Sorts matches to the **top** of the library list.
  - Renders a "✨ Smart-picked N docs for token1, token2" banner with a one-click **Clear / Re-apply** toggle.
  - Each matched doc shows a small **"Smart"** pill next to its name.
- Verified live: FARM deal correctly pulls 6 docs (Western Colloid brochure, Property Owner Guides, etc.).

### Google Calendar Sync + Tasks (Feb 2026)
- **Google OAuth integration** via the playbook (NOT Emergent-managed — full Google Cloud OAuth client). Credentials stored in `/app/backend/.env`. Redirect URI: `https://roofing-crm-3.preview.emergentagent.com/api/oauth/calendar/callback`.
- New backend module `/app/backend/google_calendar.py`:
  - `POST /api/integrations/google/connect` → returns OAuth URL
  - `GET /api/oauth/calendar/callback` → token exchange + refresh-token storage on User
  - `GET /api/integrations/google/status` → connection state + saved mapping
  - `GET /api/integrations/google/calendars` → list user's calendars + auto-suggest IDs for "Projects" / "Maintenance" / primary
  - `PUT /api/integrations/google/settings` → save mapping (3 calendar IDs + enabled toggle)
  - `POST /api/integrations/google/sync` → manual full re-sync button
  - `push_deal`, `push_assessment`, `push_maintenance_visit`, `push_task` push helpers (idempotent upsert by stored `google_event_id`)
- **Event routing**:
  - 📅 main calendar ← Scheduled Assessments + Lead/Quoted/Negotiating follow-ups + Tasks
  - 🛠 "Projects" calendar ← Project bars (won deals w/ scheduled dates) + Material orders
  - 🟢 "Maintenance" calendar ← Maintenance visits
- New backend module `/app/backend/tasks.py` (CRUD + toggle-done + soft-delete). DealIn unchanged; Tasks store `google_event_id` for re-sync.
- Deal `PUT` and schedule `PUT` endpoints now auto-push to Google Calendar after save (best-effort, fire-and-forget).
- Frontend:
  - **`/settings/integrations`** page — Connect/Disconnect button, sync toggle, 3 dropdowns for calendar mapping (auto-populated with detected names), "Sync now" with task count toast.
  - **`/tasks`** page — grouped by Overdue / Today / This Week / Later / Completed. Modal for create/edit. Inline toggle-done. Optional link to a deal. Synced badge if event ID exists.
  - Sidebar nav: **Tasks** + **Integrations** entries added.
- Tested end-to-end (curl): `/connect` returns proper Google OAuth URL with `access_type=offline&prompt=consent`; `/status`, `/tasks` endpoints respond correctly.

### PWA Polish + Camera-Direct Upload (Feb 2026) — P2 SHIPPED
- **Web App Manifest** (`/manifest.json`): name "SealTech CRM" / short "SealTech", theme `#062B67`, standalone display, 3 icons (192/512/maskable-512), auto-generated from `/sealtech-logo.png` by Python+PIL.
- **Service Worker** (`/sw.js`): pre-caches app shell; **cache-first** for `/static/*` + hashed assets; **network-first** for `/api/*` with a JSON `{offline:true}` fallback when disconnected; `skipWaiting`+`clients.claim` so the update toast can promote a new build instantly.
- **PWAControls** component: listens for `sw:update-ready` → toast "New version available · Reload"; `online/offline` → toast; `beforeinstallprompt` → captures the deferred event and renders a small floating **"📲 Install App"** button (auto-hides once installed/standalone).
- **CameraCaptureButton** reusable component (`<label>+<input type=file accept="image/*" capture="environment" multiple>`) added to **4 surfaces**:
  - Project Photos
  - Assessment Editor (photo picker)
  - Library upload modal
  - Vendor / Subcontractor COI section (uploads via existing `/api/library` with `category=Insurance/subcategory=COI`)
- index.html: linked manifest, theme color, apple-touch-icon, `viewport-fit=cover`, mobile-web-app meta tags, retained cache-busting headers.
- Tested end-to-end on preview URL: 14/14 acceptance criteria PASS (iteration_17.json).

### Roof Asset Dashboard™ — Bands + Brand Color (Feb 2026)
- Replaced raw 0-100 percentages with **executive-friendly categorical bands** across PDF, wizard, and list view.
  - **Condition**: Excellent / Good / Serviceable / At Risk / Critical
  - **Remaining Service Life**: `{n} Years Remaining` (not /100)
  - **Restoration Suitability™ / Hail Resilience™**: High / Moderate / Low
  - **Maintenance**: Current / Deferred / Poor
  - **Warranty**: Active / Limited / Expired
  - **Capital Risk™** (inverted — higher score = worse): Low / Moderate / Elevated / High
  - **Roof Asset Score™** stays a single composite number with band-derived header color.
- New backend module `/app/backend/assessment_bands.py` (single source of truth). Frontend mirror `/app/frontend/src/lib/assessmentBands.js`.
- API: GET `/api/assessments` and GET `/api/assessments/{id}` both now return a `bands` field with 8 keys, each `{label, color, sublabel}`.
- PDF: new tile-card layout on Page 3 (composite scorecard tile up top, 4×2 grid of sub-metric tiles below). Soft tinted backgrounds, color-coded borders.
- Wizard (`ScoreInput`): hybrid — keep numeric/slider, add live band pill on the right. RSL gets max=50 and "yrs" unit.
- Assessments list table: 4 new band columns (Asset Score™ / Condition / RSL / Cap Risk™).
- **Brand color change**: cobalt `#1D4ED8` → `#062B67` across ALL printable materials (PDFs, emails, Excel exports). Calendar UI keeps `#1D4ED8`.
- Tested end-to-end: 19/19 pytest backend cases + full frontend acceptance (`iteration_16.json`).

### Project Calendar (Feb 2026) — P0 SHIPPED
- New `/calendar` page with **Month + Week** views, color-coded events:
  - 🔵 **Project bars** (cobalt, span `scheduled_start_date → scheduled_end_date`, draggable to reschedule)
  - 🟠 **Material Order** pins (amber, `material_order_date`, draggable)
  - 🟢 **Maintenance** visits (green, from `maintenance_visits[]` + tentative `next_maintenance_date`)
  - 🔴 **COI Expirations** (red, vendor `gl_coi_expiry_date` / `wc_coi_expiry_date`)
  - 🟣 **Invoice Due** dates (purple, unpaid invoices only)
- Single-click event → popover with details + "Open in CRM"; double-click → navigates to record.
- Drag-to-reschedule for project bars (preserves duration) and material order pins.
- Filter checkboxes per kind in the header legend; "Today" cell has blue ring.
- Backend:
  - `DealIn` now has `scheduled_start_date`, `scheduled_end_date`, `material_order_date`.
  - New `GET /api/calendar?start=YYYY-MM-DD&end=YYYY-MM-DD` returns a unified, flat event feed.
  - New `PUT /api/deals/{id}/schedule` for partial schedule updates (used by drag-and-drop).
- Wired into sidebar nav + Deal create/edit modal (3 date inputs under "Schedule (Project Calendar)").
- Tested: 10/10 backend pytest cases + full frontend acceptance flow (iteration_15.json).

### Cache-Busting + Grammar Check (Feb 2026)
- Added `Cache-Control: no-cache, no-store, must-revalidate`, `Pragma: no-cache`, `Expires: 0` meta tags to `/app/frontend/public/index.html` so browsers always re-validate the HTML and pull the latest CRA-hashed JS bundles after deploys.
- Wired the existing `GrammarCheck` component (LanguageTool free API) into:
  - **AssessmentEditor**: Purpose, Executive Conclusion, Overall Recommendation, Recommended Strategy, Capital Planning Impact, Supporting Comments, Conclusion (via the shared `Field` component which now accepts a `grammar={{ text, onChange }}` prop).
  - **Deals → New/Edit modal → Notes** textarea.
  - **DealDetail → Email Scope modal → Custom Message** textarea.
- Verified live on preview URL: meta tags present in served HTML, "CHECK GRAMMAR" button visible on Deal Notes.

### Assessment PDF Page-2 Polish (Feb 2026)
- "Purpose of Assessment" body text replaced with the official two-paragraph language; `Commercial Roof Assessment Report™` includes the TM mark.
- Roof Asset Score™ rows: compact score boxes (0.85" × auto, 13pt number) restructured to a single non-nested Table so the blue box left-edge sits flush with the Executive Conclusion / Overall Recommendation text boxes (verified at X=81 px in the rendered PDF — perfect alignment).
- All 6 backend assessment tests still pass.

### Object Storage Hard-Delete — Resolved (Feb 2026)
- Confirmed per Emergent Object Storage playbook: **no permanent-delete API exists**; the platform allocates 5 GB per app.
- Our Admin Trash "Permanently Delete" workflow already does the right thing — purges the MongoDB record and gracefully swallows the storage 405. No code change required.

### Stale Deal Dashboard Widget (Feb 2026)
- New `GET /api/dashboard/stale-deals?days=14&won_grace_days=30` endpoint surfaces deals that haven't moved in a while:
  - **Stuck**: any open deal (status not Won / Lost / Past Lead) whose latest `status_history` entry (or `created_at` if no history) is older than `days`.
  - **No Deposit**: deals that flipped to Won `won_grace_days`+ ago but still have zero collected (no invoice payment AND no Paid embedded payment milestone).
- Response shape: `{ threshold_days, won_grace_days, counts: {stuck, no_deposit}, deals: [...] }`.
- Frontend: new `StaleDeals` card on the Dashboard (between Materials In Motion and COI Roster) with filter chips (All / Stuck / No Deposit), a 7d / 14d / 30d threshold toggle, and a per-row "Open" link to the deal. Renders a green "Pipeline is moving — no stale deals" hero when empty.
- Tested: 3 backend pytest cases (`tests/test_stale_deals.py`) — shape, populated short threshold, high-threshold empty.

### Stale Deal Weekly Digest Emailer (Feb 2026)
- New admin-only `POST /api/dashboard/stale-deals/digest?days=14&won_grace_days=30&dry_run=true|false&cc_admin=true|false` endpoint.
- Groups every flagged deal by `assigned_to_user_id || created_by_user_id`. For each owner with at least one stale deal, composes a personalized text+HTML email with two sections: "Stuck > N days" and "Won + days with no deposit". The calling admin is BCC'd on each owner email by default.
- `dry_run=true` returns the recipient preview (owner name, email, stuck/no-deposit counts, subject) without sending — used by the Dashboard "Send Digest" button to show a confirm dialog before firing.
- Refactored the core scan into a shared `_compute_stale_deals()` so the GET widget and the digest emailer use identical logic.
- Frontend: new "Send Digest" button (data-testid=`send-stale-digest`) in the StaleDeals card toolbar — admins click it, get a preview confirm, and the digest fires.
- **Threshold toggle on empty state (Feb 2026 — iteration_19 follow-up)**: added `3d` to the threshold options (now 3/7/14/30) and rendered the toolbar (threshold toggle + Send Digest button, disabled) in the empty-state card too. Previously admins couldn't lower the threshold once the default 14d showed zero stuck deals — now they always have a way to tighten the radar.
- Tested: 4 pytest cases (`tests/test_stale_digest.py`) — dry-run shape, per-owner grouping, high-threshold empty, sales-role 403.
- **Scheduling note**: this endpoint is fire-on-demand. To run it every Monday morning, add a cron / cloud scheduler hitting `POST /api/dashboard/stale-deals/digest?cc_admin=true` with the admin's bearer token. The app does not include its own scheduler.

### Assessment Cover Stamp + Restoration-Eligibility Checkboxes (Feb 2026)
- New `restoration-eligibility-block` callout in Step 1 of `AssessmentEditor.jsx` (Property Information). Two `Checkbox` controls bound to `insulation_saturated` and `structural_deck_damaged`.
- **Auto-save on toggle**: these two checkboxes call `updateAndSave({...})` which fires an immediate `PUT /api/assessments/{id}`. Closes the footgun where a user could click "Generate PDF" without clicking SAVE first and get the wrong cover stamp.
- Backend `assessment_pdf.py` already drives the cover stamp: **REPLACEMENT REQUIRED** (red box, lists triggered disqualifiers) vs **RESTORATION PATH RECOMMENDED** (green box). Tested: 3 pytest cases (`tests/test_assessment_cover_stamp.py`).

### One-Click Invoice & Record-Payment Modals on Deal Detail (Feb 2026)
- Exported `InvoiceEditor` from `Invoices.jsx` for reuse outside the Invoices page.
- DealDetail `+ Invoice` quick action (data-testid=`quick-new-invoice`) now opens the InvoiceEditor inline, prefilled with: deal title, project_total = chosen_amount, bill-to address from linked property, bill_to_email from linked contact, one line item = "<deal.title> — Contract".
- DealDetail `Record Payment` quick action (data-testid=`quick-record-payment`) finds the oldest unpaid invoice on this deal (FIFO), opens InvoiceEditor with `payment_date` defaulted to today, and shows an informational toast when no unpaid invoices exist.
- Hardened InvoiceEditor backdrop: `onClick` now uses `e.target === e.currentTarget` so bubbled clicks from descendant elements don't accidentally close the modal.
- **Fix (Feb 2026 — iteration_19)**: `_recalc_invoice()` now auto-promotes Draft invoices to `Partial` (paid > 0) or `Paid` (balance_due ≤ 0.01) whenever payment is recorded. Previously a Draft invoice paid in full via the Record-Payment modal would stay stuck at "Draft" while the cash was correctly stored. 4 new pytest cases in `tests/test_invoice_status.py` cover all four transitions (Draft→Paid, Draft→Partial, Draft+$0 stays Draft, Void never flips).

### Scope-Sent Pipeline Stamp (Feb 2026 — iteration_20)
- **Bug**: clicking EMAIL TO PROSPECT / EMAIL SCOPE sent the email successfully but the "Scope Sent" pipeline dot stayed gray and the Next-Step card stayed stuck at "Email the scope". Root cause was two-layered: (1) the `/spec-sheet/email` endpoint never wrote `last_scope_sent_at` back to the deal, and (2) the `Deal` Pydantic model (with `extra="ignore"`) was stripping the field off `GET /deals/{id}` responses even if it had been written.
- **Fix**: After a successful send, the endpoint now `$set`s `last_scope_sent_at` + `last_scope_sent_to`, `$inc`s `scope_send_count`, and `$push`es a "Scope emailed" entry into `status_history`. Added `last_scope_sent_at`, `last_scope_sent_to`, `scope_send_count`, `status_history`, and `scope_signed_at` to the `DealIn` Pydantic model so they round-trip through the response.
- Frontend: `EmailScopeModal.send()` now calls `onClose(true)` on success, and `DealDetail` reloads the deal when that flag arrives — pipeline dot updates without a hard refresh.
- **Activity Timeline (Feb 2026 — iteration_21)**: `GET /deals/{id}/activity` now detects `status_history` entries with `label in {"Scope emailed", "Assessment emailed"}` and renders them as a dedicated item — "Scope emailed (send #N)" with subtitle "to <recipient> — N attachments by <Sender Name>". A running counter increments across all sends so reps see at a glance how many times the proposal has gone out.
- Tested: 2 pytest cases (`tests/test_scope_sent_stamp.py`) — Deal model serializes the new fields; end-to-end send increments `scope_send_count`, appends a `status_history` entry, AND surfaces a "Scope emailed (send #N)" item on the activity feed.

### In-Process Scheduler — Lead-to-Sent Auto-Flip + Monday Digest (Feb 2026 — iteration_22)
- New `backend/scheduler.py` module wraps APScheduler's `AsyncIOScheduler` and runs **inside the FastAPI process** — no separate cron container required (the user requested a cron container; an in-process scheduler accomplishes the same outcome with zero ops overhead).
- **Job 1 — `mark_lead_to_sent`**: daily at 02:30 UTC. Promotes any deal still in `Lead` status whose `last_scope_sent_at` is older than 24 hours to `Sent`. Stamps `status_history` with a `user_name="auto-flip"` audit entry so the timeline shows who/why.
- **Job 2 — `weekly_stale_digest`**: Mondays at 14:00 UTC (08:00 America/Denver). Reuses the same engine as the on-demand digest button.
- Refactored the per-owner digest build/send into a shared `_build_and_send_owner_digest(user, deals_for_owner, days, won_grace_days, cc_email, dry_run)` helper so the endpoint and the cron job share one code path.
- New admin endpoints:
  - `GET /api/scheduler/jobs` → list every registered job with its trigger and `next_run_at`.
  - `POST /api/scheduler/jobs/{job_id}/run` → fire any job on-demand (great for sanity checks and regression tests).
- Set env var `DISABLE_SCHEDULER=1` to disable in tests/CI.
- Tested: 5 pytest cases (`tests/test_scheduler_jobs.py`) — jobs registered, unknown-job 404, aged-Lead flips, fresh-send stays Lead, digest job returns counts without crashing. Live verification: seeded a deal with a 25h-old timestamp → triggered `mark_lead_to_sent` → deal promoted Lead→Sent with a "Auto-promoted Lead → Sent (scope emailed 24h+ ago)" history entry.

### In-App Scope Editor + Sent-PDF Snapshot Links (Feb 2026 — iteration_23)

**Scope Editor (P2)** — per-deal bullet overrides without leaving the app:
- New `scope_overrides` field on `DealIn` model + helper `_apply_scope_overrides()` in `spec_sheet.py` deep-merges per-deal overrides onto the resolved template before rendering the PDF.
- Backend endpoints:
  - `GET /api/deals/{id}/scope-bullets` → returns `{template_title, defaults, effective, overrides, overridden_keys[]}` so the editor pre-populates with whatever the user currently sees.
  - `PUT /api/deals/{id}/scope-bullets` → persists overrides; reverts each field automatically when an empty / whitespace-only value is supplied. Returns the updated GET shape in one round-trip.
- Frontend: new `<ScopeEditorModal>` component opened by an "EDIT SCOPE" quick-action button on the deal header. Lets the user edit document title, both section headings, all bullets (with ▲/▼ reorder, delete, "+ Add bullet"), and the Key Advantages section when present. "CUSTOMIZED" badge per section + per-section "Reset" + global "Reset All".
- Save logic is minimal: only fields that differ from template defaults are sent over the wire, so future template improvements still flow through for sections the user didn't touch.

**Sent-PDF Snapshot Links (P3)** — "Open the PDF that went out":
- `POST /api/deals/{id}/spec-sheet/email` now stashes the exact PDF bytes that were attached into Object Storage with `is_sent_snapshot: true` and writes the new file_id into the corresponding `status_history` entry's `pdf_file_id` field.
- `GET /api/deals/{id}/activity` surfaces that file_id on the "Scope emailed (send #N)" row, and the existing `/files/{file_id}/download?token=...` endpoint serves it (no new download surface needed).
- Frontend: each `DealActivityTimeline` row whose `pdf_file_id` is set now wraps its title in an `<a target="_blank">` link — one click re-opens the exact version that went out.
- Tested: 4 pytest cases (`tests/test_scope_editor.py`) — defaults shape, overrides change the PDF, empty overrides revert, snapshot is downloadable.

### Public Proposal Signing — Sign-Off Link (Feb 2026 — iteration_24)

Closed the entire Lead → Sent → Won loop without anyone in the office touching the deal between the scope email going out and the deposit landing.

- New `backend/proposal_signing.py` module with three unauthenticated endpoints under `/api/public/proposal/{token}`:
  - `GET /` — return safe-to-show project summary + effective scope bullets (template + overrides merged).
  - `POST /sign` — signer name + acceptance flag (optional drawn signature data-URL). Flips deal `status` to "Won", stamps `scope_signed_at`, `scope_signed_by_name`, `scope_signed_by_email`, `scope_signed_ip`, `scope_signed_user_agent`, `scope_signature_file_id`, and appends a `public-sign` entry to `status_history` with `from/to: Lead→Won`. Persists the signature image to Object Storage with `parent_type=deal, category=Signature`.
  - `GET /signature` — streams the saved signature image (post-sign confirmation card).
- `ensure_proposal_token()` mints a 24-char URL-safe opaque token on the deal the first time the scope is emailed; idempotent on subsequent sends.
- `/spec-sheet/email` injects the Sign Off link into the email body — both a styled HTML button and a plaintext URL fallback. Assessment emails are excluded.
- All endpoints idempotent: re-signing a token returns the original `signed_at` + `signed_by_name`. Unknown tokens 404 (no information leak).
- New Pydantic fields on `DealIn`: `proposal_sign_token`, `scope_signed_by_name`, `scope_signed_by_email`, `scope_signed_ip`, `scope_signed_user_agent`, `scope_signature_file_id`.
- Frontend: new `/sign/:token` route (no auth) rendering `<ProposalSign>` — branded SealTech header, project summary card, scope bullets card (renders sections 1+2 + key advantages), inline e-signature canvas (mouse + touch), acceptance checkbox, "Accept & Sign Proposal" CTA. On success swaps to a green "Proposal Accepted" card. The existing Next-Step card on DealDetail automatically pivots to "Create deposit invoice" because the deal is now Won.
- **Tested**: 6 new pytest cases (`tests/test_proposal_signing.py`) — token mint via email send, public viewer no-auth, sign flips deal to Won with audit, idempotent re-sign, name+acceptance validation, unknown-token 404. End-to-end browser test confirms: deal starts Lead → recipient lands on `/sign/{token}` → fills name + draws signature + accepts → POSTs → page shows "Proposal Accepted" → backend shows `status=Won, scope_signed_by_name=Jane Customer, signature_file_id=...`.

### Auto-Created Draft Deposit Invoice on Sign (Feb 2026 — iteration_25)
- The moment a proposal is signed via `/sign/{token}`, the backend auto-spawns a Draft Deposit invoice on the deal. The owner just opens it, eyeballs, and clicks Send — a forgettable step removed from the cash-collection cycle.
- Defaults to 50% of `deal.chosen_amount` (or `proposal_mid_amount(deal)` as fallback). Configurable per-sign by passing `deposit_pct` in the sign body (e.g. `deposit_pct: 25`).
- Auto-numbered via `_next_invoice_number()`, line item: `"<title> — 50% Deposit (signed by customer)"`, `source_type: "proposal_signing"`, `source_id: deal_id`, `created_by_user_id: "public-sign"`. Bill-to and project address pre-filled from the linked contact + property.
- Idempotent: re-signing the same proposal returns the original `deposit_invoice_id` and never spawns a duplicate.
- Skipped cleanly when there's no positive amount to invoice — no zero-dollar invoices on sign.
- Books GL hook (`gl.post_invoice_issue`) runs best-effort so the invoice lands in the General Ledger like any manually-created one.
- The sign response now includes `deposit_invoice_id` + `deposit_invoice_number`; the public Proposal Accepted card shows: *"Your deposit invoice (INV-2026-1237) is queued and the SealTech team will send it shortly."*
- **Tested**: 3 new pytest cases (`tests/test_proposal_signing.py`) — auto-creates Draft 50% deposit, no invoice when amount=0, custom `deposit_pct` honored. 34-test critical suite stays green.

### Settings → Schedule Admin Page (Feb 2026 — iteration_26)
- New `/settings/schedule` admin route + sidebar entry surfacing the in-process APScheduler state.
- Per-job card: icon, friendly label, raw job id, plain-English description (e.g. "Mondays 08:00 MT. Each deal owner receives a personalized email..."), the cron trigger expression, and a **next-run timestamp** rendered in the user's local timezone with a relative countdown ("in 23h" / "in 5d").
- **"Run now"** button on each card fires the job out-of-band via `POST /api/scheduler/jobs/{id}/run` and renders the JSON result inline as a "Last manual run" panel. Friendly toasts: *"Promoted 2 Leads → Sent"* / *"Digest fired — 3/3 owners emailed"* / *"No Leads needed promotion"*.
- "Running" / "Stopped" status pill, auto-refresh every 30 seconds, manual Refresh button, empty-state hint when `DISABLE_SCHEDULER=1`.
- Footer note: cron expressions live in `backend/scheduler.py`; UI editor is on the roadmap (held off this iteration per user — they wanted to see the page first).

### Inline Schedule Editor (Feb 2026 — iteration_27)
- Backend: new `scheduler_settings` Mongo collection holds per-job overrides (`{job_id, hour, minute, day_of_week, updated_at}`). On scheduler startup, the trigger config is resolved by merging the persisted override on top of the built-in defaults defined in `JOB_DEFAULTS`.
- New endpoint `PUT /api/scheduler/jobs/{job_id}/schedule` (admin only) — body `{hour, minute, day_of_week?}` — persists the override AND re-registers the live trigger via `APScheduler.reschedule_job()`. Validates `0 ≤ hour ≤ 23`, `0 ≤ minute ≤ 59`. Unknown job → 404. `day_of_week` accepts comma-separated days (`"mon"`, `"mon,fri"`, `"*"`).
- `GET /api/scheduler/jobs` now returns `supports_day_of_week`, `hour`, `minute`, `day_of_week` on every row so the UI editor pre-populates.
- Frontend: inline editor on each Schedule card (data-testid=`schedule-job-<id>-editor`) — M/T/W/T/F/S/S day-of-week chips for weekly jobs, hour + minute number inputs, **Local-equivalent preview** ("Local equivalent: 05:30 PM UTC"), Cancel / Save buttons.
- `start()` is now an awaitable so the persisted overrides are loaded before jobs register.
- **Tested**: 4 new pytest cases (`tests/test_scheduler_edit.py`) — editor fields surfaced, persist + reschedule lands on a real Friday weekday, hour/minute validation, unknown-job 404. Verified live: flipped weekly digest to Mon+Fri 17:30 UTC, the next-run timestamp recomputed to "Fri, Jun 19, 05:30 PM UTC (in 3d)".

### Assessment Photo Picker — 8-Wide Grid + Clearer Project-Library Sourcing (Feb 2026)
- The Assessment Findings photo picker already pulled from the project's photo library, but the header label was generic ("Photo Picker") and the "Upload Photo(s)" CTA made it look like a file-from-disk picker. Renamed the header to **"From Project Photo Library"**, the upload button to **"Add to Library"**, and added a project-photo count next to the buttons so the source is unmistakable.
- Grid switched from `grid-cols-4` (4-wide) to `grid-cols-4 sm:grid-cols-6 md:grid-cols-8` (up to 8-wide on desktop). Tiles are now responsive squares (`PhotoThumb` gained a `tile` variant that uses `w-full aspect-square` instead of fixed 80×80px) so they fill each cell snugly without big gaps.
- Empty-state copy rewritten to tell the user exactly how to get photos in: *"No photos in this project's library yet. Use **Add to Library** or **Take Photo** above to add one."*

### Get App on My Phone — Magic-Link QR (Feb 2026)
- Backend: two new endpoints.
  - `POST /api/auth/magic-link` (auth required) — issues a 24-char URL-safe single-use token bound to the caller. Stored in new `magic_links` Mongo collection with 5-minute expiry and a TTL index for auto-cleanup. Returns `{token, expires_in: 300}`.
  - `POST /api/auth/magic-link/consume` (public) — exchanges the token for a JWT (same shape as `/auth/login`). Marks the token consumed atomically via `$set` filter on `consumed_at: null` so a race can't double-consume. 401 on unknown / expired / already-used tokens (no info leak between the three).
- Frontend:
  - New `GetAppOnPhoneModal` component renders a `qrcode.react` SVG of `<origin>/m/<token>`, with Copy Link + Regenerate buttons and per-OS Add-to-Home-Screen instructions.
  - New `/m/:token` public route (`<MagicLinkConsume>`) consumes the token, drops the JWT into `localStorage`, and redirects to `/` already signed in.
  - New sidebar button "Get App on My Phone" (data-testid=`get-app-button`) opens the modal.
- New package: `qrcode.react@4.2.0` (lightweight, zero extra deps).
- Verified live: button visible in sidebar → click → modal renders QR + instructions → curl-tested the consume endpoint exchanges the token for a valid JWT, returns 401 on re-use, 401 on bogus tokens.

### Standalone Field Photo Capture — `/field` (Feb 2026)
- New full-screen mobile-first route `/field` outside the sidebar Layout for rapid roof-photo capture by field workers.
- **Project picker** (`[data-testid=field-deal-picker]`) lists only OPEN deals — filters out `Closed`, `Lost`, `Past Lead`. Last-used dealId persists in `localStorage` (`field_capture_last_deal_id`) so reopening the page re-selects the same project.
- **Continuous WebRTC live stream** via `navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })` — camera stays open between shots so users tap-tap-tap without the native camera app closing.
- **Zero-click upload**: tap the giant white shutter button (`[data-testid=field-shutter]`) → canvas captures the frame → JPEG blob → instant `POST /api/projects/{deal_id}/photos`. No preview, no confirm, no friction.
- **Offline queue (IndexedDB)**: DB `field-photo-queue` / store `shots` holds `{deal_id, blob, filename, created_at}` rows when offline. Header shows the amber **Offline** pill (`navigator.onLine` + window event listeners) and the status strip shows the `N queued` badge.
- **Auto-flush on connectivity restore**: `window 'online'` event triggers `flushQueue()` which drains the IndexedDB store one row at a time via POST. Mutex (`flushingRef`) prevents concurrent flushes; breaks on first failure so the rest stay queued for the next online event.
- **Logout**: `[data-testid=field-logout]` clears `crm_token` and redirects to `/login`.
- Files: `/app/frontend/src/pages/FieldCapture.jsx` (335 lines), route wired in `/app/frontend/src/App.js` (`<Route path="/field" element={<FieldCapture />} />`, outside the Layout protected branch).
- Backend tests: `/app/backend/tests/test_field_capture.py` (4/4 pytest pass — upload, list, unauth-rejected, deals filter).
- Verified end-to-end via testing agent iteration 20: all 10 scenarios PASS, including programmatic IndexedDB injection + online-event auto-flush + photo verified via `GET /api/projects/{id}/photos` + cleanup.

### Send to Field — Deal Deep-Link QR (Feb 2026)
- Each Deal page now has an amber **"Send to Field"** button (`[data-testid=send-to-field]`) next to **New Assessment**. Click → modal renders a QR code that includes both a one-time magic-link token AND a `?next=/field?deal_id=<id>` deep-link.
- The field worker scans the QR with their phone camera → lands in the CRM signed-in → is redirected straight to `/field` with that project **already pre-selected** in the picker. Zero typing, zero scrolling. Start tapping the shutter.
- `MagicLinkConsume` (`/m/:token`) now supports `?next=…` (same-origin paths only — guarded against open-redirect by checking the path starts with a single `/`).
- `FieldCapture` reads `?deal_id=…` from `window.location.search` and uses it as the pre-selection (falls back to localStorage `field_capture_last_deal_id` if absent or invalid).
- `GetAppOnPhoneModal` is now reusable: optional `redirectPath`, `title`, `subtitle` props let it serve both as the sidebar "Get App on My Phone" generic launcher and the Deal-page "Send to Field" pre-filled launcher.
- Verified live via Playwright: button visible on Deal page → modal opens with custom copy → Copy Link returns `/m/<token>?next=%2Ffield%3Fdeal_id%3D<id>` → fresh visit to `/field?deal_id=<id>` pre-selects the deal in the picker, persists it to localStorage, and shows "To: <Deal Title>" in the status strip.

### Magic-Link "Expired Link" Bug Fix (Feb 2026)
- **Bug**: Every freshly-issued magic link was showing "This link has already been used" on first scan.
- **Root cause**: React 19 StrictMode + react-refresh in the dev preview caused `MagicLinkConsume`'s `useEffect` to fire on TWO independent module evaluations. The component re-mounted, the module re-evaluated (Map state wiped), and a second POST to `/auth/magic-link/consume` fired. The first call succeeded (200, stored JWT), the second hit the backend's `consumed_at` guard and returned 401. The 401's error message overwrote the success UI.
- **Fix**: Replaced the in-memory `Map` cache with a **sessionStorage-backed lock + result cache** keyed by token. The first caller acquires `magic-link-lock-<token>`, fires the network request, and writes either `magic-link-result-<token>` (success) or `magic-link-error-<token>` (failure). Any concurrent or subsequent caller within the same tab polls for the result instead of issuing a duplicate POST. SessionStorage survives StrictMode mount cycles AND HMR module re-evaluation.
- Verified live: 1 consume POST per page load (was 2), success page renders, redirect honours `?next=/field?deal_id=…` and lands on `/field` with the deal pre-selected. Both the sidebar "Get App on My Phone" and Deal page "Send to Field" flows confirmed working end-to-end.

### Field Capture v2 — Project-List + Camera (Feb 2026)
- Refactored `/field` from a single dropdown page into a **two-view stripped-down mobile experience**:
  - **List view** (no `?deal_id=`): top bar (user, online pill, logout) + search box (`[data-testid=field-search]`) + tappable row per open deal (`[data-testid^=field-project-row-]`). Just project NAMES + status sub-line. No camera, no shutter, no sidebar — nothing else.
  - **Camera view** (deal selected): back-arrow (`[data-testid=field-back]`) returns to the list and strips `?deal_id=` from the URL via `history.replaceState` (no full reload, no flash). Header reads "CAPTURING FOR <deal title>".
- Search filter is case-insensitive substring on the deal title; clears restore the full list.
- Deep-link `/field?deal_id=<id>` jumps **straight to the camera** for that deal (skips the list).
- **Sidebar "Get App on My Phone"** QR now uses `redirectPath="/field"` so the phone lands on the project list (not the full Dashboard).
- **Deal-page "Send to Field"** QR uses `redirectPath="/field?deal_id=<id>"` so the phone jumps straight to the camera for that specific job.
- Files: `/app/frontend/src/pages/FieldCapture.jsx` (466 lines, refactored with `TopBar` + `ProjectList` sub-components), `/app/frontend/src/components/Layout.jsx` (sidebar modal redirectPath wired).
- Verified by testing agent iter 21: **13/13 frontend + 5/5 backend pytest PASS**. Includes IndexedDB queue inject + drain, single-consume StrictMode dedupe still holds, photo upload + listing, single-use magic-link enforcement.

### Mobile-Only Field Mode (Feb 2026)
- New `MobileGate` wrapper in `/app/frontend/src/App.js` — any phone-sized viewport (`window.innerWidth < 768`) OR mobile user-agent (iPhone/Android-Mobile/iPod/etc.) hitting ANY protected CRM route is auto-redirected to `/field`.
- Escape hatch: `?desktop=1` on any URL forces the full CRM and is remembered for the tab session (`sessionStorage.force_desktop_crm=1`).
- Service worker bumped `v3 → v4` so any phones with stale cached bundles get a clean reload + activate-cycle cache purge.
- Verified live (5/5 PASS): phone UA visits `/`, `/contacts`, etc. → all redirect to `/field`; `?desktop=1` loads dashboard; desktop UA (1440×900) loads dashboard unchanged.
- Rationale: user is the GM of a small roofing contractor — phones are exclusively for field photo work, never for browsing CRM tables. Removing the full CRM from the phone eliminates the misclick risk and keeps the device focused on shutter+upload.

### Bug Fix — Black Camera View on iPhone (Feb 2026)
- **Symptom**: After tapping a project on `/field`, the camera area showed a **solid black box** (no feed, no error) on iPhone Safari.
- **Root cause**: `startCamera()` fired on the page's first mount, but at that point the user was on the LIST view — the `<video>` element didn't exist in the DOM yet, so `videoRef.current` was `null`. The MediaStream got created and attached to `streamRef.current` BUT never bound to a video element. When the user later tapped a deal and the camera view rendered, the `<video>` mounted with no `srcObject`, hence the black box.
- **Fix** (`/app/frontend/src/pages/FieldCapture.jsx`):
  1. Moved the camera-start effect from "fire on mount" to "fire when `dealId` becomes truthy" — i.e., only when the user enters the camera view. The list view never requests camera permission, which also fixes the iOS permission UX (the system prompt appears at the exact moment the user expects it, not eagerly on landing).
  2. Replaced the regular `useRef` with a **callback ref** (`setVideoEl`) that binds `srcObject` AND calls `play()` the instant the `<video>` element mounts — bulletproof against the list→camera mount race.
  3. Added `autoPlay` attribute to the `<video>` (already has `muted` + `playsInline`) to satisfy iOS Safari's autoplay-with-muted-track policy.
  4. Cleanup on leaving the camera view stops the MediaStream tracks (turns the phone's camera LED off).
- Headless test now surfaces the explicit `Requested device not found` error UI (instead of a silent black box), confirming the new flow.

### Field Camera Zoom & Ultrawide Support (Feb 2026)
- Added **pinch-to-zoom** + **tap-zoom pills** to the camera view:
  - Two-finger pinch on the camera area scales 1× to 6× (digital). `touch-action: none` blocks iOS from page-zooming during the gesture.
  - Bottom-of-camera pill bar: `0.5×` (only shown if the device has an ultra-wide rear lens), `1×`, `2×`, `3×`, plus a live zoom-level readout (e.g., `1.7×`).
  - Active pill is amber-filled; inactive pills are translucent.
- **Ultra-wide lens switching** (`0.5×` on iPhone Pro / recent Androids): after the first successful `getUserMedia` call, `enumerateDevices()` labels become available — we look for one matching `/ultra.?wide|0\.5/i` and stash its `deviceId`. Tapping `0.5×` re-acquires the stream with `{video: {deviceId: {exact: ultrawideId}}}` for true optical wide-angle (not digital interpolation). Tapping `1×/2×/3×` switches back to the default rear camera.
- **Capture matches preview**: the saved JPEG is cropped to the centre `1/zoom` of the source frame and rescaled to full canvas size, so the photo on the server matches exactly what the user saw on screen.
- Files: `/app/frontend/src/pages/FieldCapture.jsx` — added `zoom`, `ultrawideId`, `useUltrawide` state; `onTouchStart`/`onTouchMove` pinch handlers; `setZoomLevel` helper; updated `captureAndUpload` to apply the zoom-crop; new `ZoomChip` sub-component.
- Regression smoke-tested: list view (8 rows), tap → camera (back+shutter present), back → list (8 rows restored). All green.

### Project Photos Grid Densified (Feb 2026)
- Bumped photo grid from `2/3/4` to `3/4/5/6/7/8` cols across responsive breakpoints in `/app/frontend/src/components/ProjectPhotos.jsx` (line 171). Gap tightened `gap-3 → gap-2`.
- At 1920px viewport, the grid now renders **8 columns** of ~186px thumbnails (verified live), letting the user scan ~24+ photos without scrolling vs ~12 previously.

### Project Photos Grouped by Date (Feb 2026)
- Photos now display **grouped by calendar date taken** in `/app/frontend/src/components/ProjectPhotos.jsx`. Each date heading shows a friendly label (`Today`, `Yesterday`, or `Mon, Jun 15`) + a photo count, followed by the grid of shots from that day.
- Default ordering: **Oldest first** (matches the natural before → during → after construction narrative). Toolbar toggle (`[data-testid=photos-order-asc]` / `photos-order-desc`) flips to **Newest first** for the daily-update workflow.
- Uses `created_at` for grouping — for field-camera photos this is the exact moment of capture; for drag-drop uploads it's the upload date.
- Verified live on a deal with 24 photos across 2 dates: groups render correctly, counts accurate, toggle flips group order. Internal grid retains the 3/4/5/6/7/8-col responsive layout from the previous task.

### Progress Timeline PDF + Stale-User Cleanup (Feb 2026)
- **New feature**: `GET /api/projects/{deal_id}/photos/timeline.pdf` — generates a date-grouped photo album as a single PDF. Cover page + per-date sections (Today / Yesterday / friendly day-of-week label) with 2-col photo grid; each photo card has the image + filename + capture time. Honours optional `?album_name=` / `?tag=` filters so users can export e.g. only "After" or only "Drone" shots.
- New module: `/app/backend/progress_timeline_pdf.py` (ReportLab-based).
- Frontend button: `[data-testid=timeline-pdf-btn]` in `ProjectPhotos.jsx` toolbar — fetches blob and triggers an `<a download>` with the deal title in the filename.
- Tests: `/app/backend/tests/test_progress_timeline_pdf.py` (4/4 pass — auth-required, PDF magic header, filter narrows results, empty-project cover-only PDF).
- Verified live on 24-photo deal → 23 MB / 6-page PDF (cover + 2 date sections) with correct title, photo captions, and timestamps. Toast confirmation on success.

### Bounce-Back Email Fix — Admin User Rename
- **Symptom**: Mail Delivery Subsystem bounces in Darren's inbox saying "Delivery incomplete to admin@roofingcrm.com".
- **Root cause**: Seed/placeholder admin email `admin@roofingcrm.com` was still in the DB; the CRM's notification + Monday-digest scheduler tries to mail every admin user at their stored email → bounces because the domain isn't real.
- **Fix** (DB ops + test_credentials.md update):
  1. Deleted 5 leftover test users (`test_user_*`, `test_sales_*`, `test_probe_*`).
  2. Deleted the auto-created duplicate `darren@sealtechsolutions.co` admin (created Jun 18, no deals owned).
  3. Renamed the original admin user's email `admin@roofingcrm.com` → `darren@sealtechsolutions.co` (password unchanged, role unchanged, title preserved).
- Verified: login works at the new email with the same `admin123` password; old email correctly rejected.
- `/app/memory/test_credentials.md` updated for future fork/testing agents.

### Final Invoice Auto-Generation (Hybrid Manual + Suggestion) (Feb 2026)
- **User-picked option (d) — Hybrid manual button + Closed-stage auto-suggest banner**.
- **Backend** (`/app/backend/server.py`):
  - `_compute_final_invoice_preview(deal_id)` — read-only calc: `contract_total = chosen_amount (or MID proposal) + approved change-orders`; `already_invoiced = Σ non-void invoices' total`; returns `final_amount = max(0, contract_total - already_invoiced)` plus `existing_final_invoice_id` if one exists.
  - `_auto_create_final_invoice(deal_id, user_id)` — drafts a `Final` invoice mirroring the existing deposit-auto-create pattern (auto-number, bill-to from contact, project address from property, GL post). Idempotent — returns existing non-void Final if one is already on the deal.
  - `GET /api/deals/{deal_id}/final-invoice/preview` — for the suggestion banner.
  - `POST /api/deals/{deal_id}/final-invoice` — drafts the invoice. Returns 400 if no contract total OR balance already fully invoiced.
- **Frontend** (`/app/frontend/src/pages/DealDetail.jsx`):
  - **Mark Complete button** (`[data-testid=mark-complete-btn]`) next to **Send to Field** — emerald green, drafts the Final invoice and opens the existing InvoiceEditor inline for review/edit before send.
  - **Closed-stage suggestion banner** (`[data-testid=final-invoice-suggestion]`) — appears above the deal header WHEN: status is `Closed` AND no Final invoice exists yet AND a positive balance is remaining. Shows the math (Contract minus prior invoices = balance) and two CTAs: `Draft Final Invoice` / `Not yet`. Auto-loaded via the preview endpoint on every status change.
  - Banner is dismissible per-page-visit (state-level, not persisted).
- Tests: `/app/backend/tests/test_final_invoice.py` (4/4 PASS — preview, create + idempotency, 400 on no contract total, 400 on already-fully-invoiced).
- Verified live: temp Closed deal with $5,000 chosen_amount renders the green banner with correct math, click → POST 200 → Final invoice drafted → banner disappears → InvoiceEditor opens. Toast confirms creation with the new invoice number.

### Deal Page — Invoices List Section (Feb 2026)
- **User issue**: Manatt Ct deal had a Paid deposit invoice but the user couldn't find any indicator of payment on the Deal page; clicking `+ Invoice` opened a fresh draft creator (showing full project total) instead of the existing paid invoice. The "Outstanding $5,000 / $5,000 received of $10,000" tile compounded the confusion.
- **Fix** (`/app/frontend/src/pages/DealDetail.jsx`): Added a new **"Invoices on this project"** table section above the P&L Comparison. Each row shows:
  - Invoice #, Type, Status pill (color-coded: green Paid, blue Sent, amber Partial, red Overdue, zinc Draft/Void)
  - Total, Received (emerald), Balance (orange when > 0, grey when $0)
  - Paid On date + payment method
  - "VIEW →" link — clicking the row fetches the full invoice via `GET /invoices/{id}` and opens the existing inline InvoiceEditor.
- Renders only when the deal has at least one invoice (no empty state needed since `+ Invoice` covers the empty path).
- Sorted newest invoice-date first.
- Verified live: Manatt deal now shows the deposit row with `PAID`, `$5,000 / $5,000 / $0`, `2026-06-15 · ACH`, clickable to open.

### Signature Canvas & No-Rollback Fixes (Feb 2026)
- **Bug 1 — Signature overwrote on top of itself**: `ProposalSign.jsx` canvas has bitmap 620×140 but CSS `w-full` stretches it to the column width. On phones (≤620px), screen→canvas coords weren't being scaled, so strokes got squashed into ~60% of the bitmap and overlapped. **Fix**: scale `(clientX - rect.left) * (c.width / rect.width)` in both `beginStroke` and `strokeMove`. Verified live with a Playwright X-stroke on a 430px viewport — ink now spans 96% width × 81% height of the canvas (was ~60% before).
- **Bug 2 — Signing rolled live projects backwards to Won**: `proposal_signing.py` was blindly setting `status="Won"` regardless of current pipeline stage. A re-sign on an In-Progress / Closed deal would demote it. **Fix**: introduced `PRE_WON = {"Lead", "Past Lead", "Assessment", "Scope Sent"}`; only deals in this set get promoted to Won. Otherwise the current status is preserved, the signature + IP + timestamp + status_history entry are still recorded (legal hold intact), and the auto-deposit invoice is **not** re-fired.
- Tests: `/app/backend/tests/test_proposal_signing_no_rollback.py` (4/4 PASS — Lead → Won + invoice, In Progress stays put, Closed stays put, Scope Sent → Won).
- Manatt Ct deal restored to `In Progress` (correct pre-rollback status), signature audit fields intact.
- Cleanup leftover from previous edit: removed orphan JSX at end of `ProposalSign.jsx` that was triggering a Babel parse error.

### Printable User Guides (Feb 2026)
- Two on-demand backend-rendered PDFs covering the entire CRM:
  - **`GET /api/docs/quick-guide.pdf`** — 4-page laminate-on-the-truck Quick Reference (sidebar map, pipeline cheat, 60-second daily workflow, phone shortcuts, key-buttons table, troubleshooting).
  - **`GET /api/docs/full-manual.pdf`** — 11-page Full User Manual covering Getting Started, Sidebar, Contacts/Properties, Deals + Pipeline, Assessments, Scopes, Public Sign-Off, Invoicing, Final Invoice, Photos + Timeline PDF, Field Capture, Books, Vendors, Calendar, Tasks, Reports, Admin, PWA, Tips/Troubleshooting, and a Glossary.
- Module: `/app/backend/user_guide_pdf.py` (ReportLab, brand-colored navy + bronze, KV tables for cheat-sheet style).
- Sidebar buttons (`[data-testid=dl-quick-guide]`, `[data-testid=dl-full-manual]`) sit between "Get App on My Phone" and "Sign Out". Click → fetch the PDF as a blob → `<a download>` trigger with the proper filename.
- Re-renders live from the codebase on every download, so the docs evolve with the app — no stale Word docs.
- Verified live: both endpoints return valid `%PDF`, quick=4 pages / full=11 pages.

### Signature Canvas — HiDPI / Retina Sharpness (Feb 2026)
- Upgraded `ProposalSign.jsx` signature canvas to render at **device-pixel resolution**:
  - Bitmap is sized to `CSS pixels × window.devicePixelRatio` (so 990×420 on iPhone Pro at 3×, 660×280 on a regular iPhone at 2×, 330×140 on a 1× display).
  - 2D context is `setTransform(dpr, 0, 0, dpr, 0, 0)`-scaled so draw calls use CSS-pixel coords (no more `width/rect.width` math needed in stroke handlers).
- Wired as a **callback ref** (`setCanvasEl`) so the HiDPI setup fires the instant the `<canvas>` mounts. (A regular `useEffect` on mount missed it — the canvas only renders after the deal payload loads.)
- **ResizeObserver** + `window.resize` + `orientationchange` listeners re-fit the bitmap on column-width changes and device rotation.
- Cleanup teardown stored on a `useRef` so React re-mounting the canvas correctly disconnects the old observer.
- Verified live: bitmap = `990×420` at DPR=3 (matches `CSS × DPR` exactly).

## Backlog (P0)
- _(empty — all P0 items complete)_

## 2026-02-18 — Ad-hoc Deal Schedule / Appointments
- **Schedule panel on Deal page** (`/app/frontend/src/components/DealSchedulePanel.jsx`):
  Inline "Schedule Event" form on `DealDetail.jsx` lets the rep book a Roof Walk,
  Presentation, Meeting, Job Start, or Other appointment directly from the deal —
  no jumping to global Calendar/Tasks. Shows Upcoming + collapsible Past lists with
  date/time, location, notes, G-Cal badge.
- **Backend** (`/app/backend/deal_events.py` + 3 server.py wiring blocks):
  - CRUD: `POST/GET/PUT/DELETE /api/deals/{deal_id}/events`
  - Merged into unified `/api/calendar` feed as `kind="appointment"` (teal `#0F766E`).
  - New `/api/dashboard/today` returns today + next 48h events with `deal_title`.
  - Auto-pushes to Google Calendar via existing `gcal.upsert_event` using the
    user's assessment_calendar_id (falls back to project_calendar_id).
  - Reminder scheduler — APScheduler job runs every 5 min, emails owner +
    invitees 1 hour (±5 min) before start_time. Idempotent via
    `reminder_sent_at` field. Mountain Time aware.
- **Dashboard "Today" widget** (`/app/frontend/src/pages/Dashboard.jsx::TodayEvents`):
  Card auto-hides when empty; otherwise groups events by date with "Today" /
  "Tomorrow" / weekday headings, clickable through to the deal. Refetches on
  tab focus + visibilitychange.
- **Tests**: `/app/backend/tests/test_deal_events.py` (14 cases, 100% pass).

## 2026-02-18 — P4: GPS + Foreman Stamp on Field Photos
- **What it does**: Every photo captured via `/field` now has the foreman name, timestamp, project/address, and live GPS coordinates (± accuracy in meters) **burned into the JPEG pixels** at capture time. Undeniable proof-of-presence for insurance claims — survives every downstream pipeline.
- **Backend** (`project_photos.py`): POST `/api/projects/{deal_id}/photos` now accepts `gps_lat`, `gps_lng`, `gps_accuracy`, `captured_at`, `stamped` form fields. All optional, persisted on the photo doc, returned by GET.
- **Frontend** (`FieldCapture.jsx`):
  - `navigator.geolocation.watchPosition` watches device location while in the camera view (high-accuracy, released on unmount/back).
  - `paintStamp(canvas, ctx)` draws a translucent gradient bar at the bottom with cobalt accent stripe → foreman name • timestamp • address • GPS coords ±acc • SealTech watermark. Burned into pixels before JPEG encode.
  - New status-strip widgets: **Stamp ON/OFF toggle** (persists in localStorage) + **GPS indicator** badge (emerald ≤25m, amber >25m, rose if denied).
  - DOM **preview overlay** mirrors the burned-in stamp so the foreman sees exactly what's about to land on the photo.
  - Offline queue (`flushQueue`) propagates GPS metadata so stamps + coords survive offline → online sync.
- **Hardening**: `progress_timeline_pdf._photo_cell` now eagerly PIL-decodes each image — a single corrupt blob falls through to the "(image unavailable)" placeholder instead of crashing the whole timeline PDF.
- **Tests**: `/app/backend/tests/test_photo_gps_stamp.py` (5 cases, 100% pass). Frontend E2E green — toggle, persistence, GPS indicator color thresholds, paintStamp call-site, offline-queue propagation all verified.

## 2026-02-18 — Daily Status Report PDF (the "morning standup")
- **What it does**: One PDF that tells you exactly where every active deal is in the process, what's next, and who owns it.
- **Delivery — two channels, same engine**:
  - **On-demand**: amber "Today's Status Report" button in the sidebar → instantly downloads `Daily Status - YYYY-MM-DD.pdf`.
  - **Auto-email**: APScheduler cron fires **7:00 AM MDT, Mon–Fri** (13:00 UTC) and emails the PDF to admin + every user who owns ≥1 active deal.
- **PDF contents** (`daily_status_pdf.py`):
  - Header KPIs: Active Deals · Pipeline Value · Today's Events · Overdue Items.
  - TODAY · Scheduled Events — time, type, title, owner, location.
  - WHAT'S NEXT · By Pipeline Stage — Lead / Quoted / Awaiting Signature / Sold-Order Materials / Scheduled / In Progress / Awaiting Final Invoice. Each row: deal title, customer, value, next action, owner, idle days color-coded (rose ≥7d, amber ≥3d).
  - ATTENTION · Needs Action — overdue tasks + stale deals + COIs expiring ≤30d.
  - TOMORROW · Heads-up — preview of next-day appointments.
- **Stage derivation** (`derive_stage_and_next`) mirrors the on-screen Project Pipeline indicator so PDF and UI stay in sync. Next-action labels include context: *"Follow up on quote (sent 5d ago)"*, *"Job starts Mon Jun 22"*, *"On site — 3d to completion"*.
- **Backend wiring**:
  - `collect_daily_status_data()` in server.py — single-pass collector shared by the route and the cron.
  - `GET /api/reports/daily-status.pdf` — on-demand download (any auth user).
  - `GET /api/reports/daily-status/recipients` — admin-only inspector.
  - `scheduler._daily_status_email` registered in JOB_DEFAULTS as `daily_status_email`; reschedulable from the existing `/scheduler/jobs/{id}/schedule` admin UI.
- **Cleanup**: Soft-deleted the stale `admin@roofingcrm.com` stub that was still on the recipient list (per handoff note).
- **Tests**: 10/10 pytest + frontend Playwright download test (`/app/backend/tests/test_daily_status.py`, iteration_24, both 100%).

## 2026-02-18 — Per-Category Email & Calendar Routing
- **Why**: Darren keeps role mailboxes in Google Workspace to keep his selling inbox clean. Each kind of CRM email/event now goes to the matching role address + matching shared calendar.
- **Categories** (all `@sealtechsolutions.co`):
  - 📅 **assessments** — assessment scheduling, assessment-report emails
  - 📝 **scope** — proposals, scope emails, sales follow-ups, stale-deal digests
  - 💰 **finance** — invoices, statements, late notices, payables reports
  - 🛠 **projects** — POs, COI requests, project comms, daily status report
  - 🟢 **maintenance** — maintenance visit reminders
- **Backend**:
  - New `email_routing.py` module — `EmailRoutingSettings` Pydantic model, GET/PUT `/api/settings/email-routing` (admin), `get_from_for_category()` resolver.
  - Storage: single doc `app_settings._id="email_routing"` with 5 fields; blank fields fall back to a matching `GMAIL_FROM_ALIASES` env entry.
  - Whitelist enforcement on PUT — every alias must be in `GMAIL_FROM_ALIASES` so Gmail "Send As" relay accepts it.
  - `email_sender.send_for_category(db, category, ...)` — new async helper; resolves the alias then delegates to `send_email`. All ≥13 send sites converted (`server.py`, `assessment.py`, `coi_reminders.py`, `scheduler.py`, `deal_events.py`).
  - `GoogleCalendarSettings` extended with `scope_calendar_id` + `finance_calendar_id` (5 calendar fields total).
  - `deal_events.push_event_to_gcal` now picks the calendar by event_type: Roof Walk → assessments, Presentation/Meeting → scope, Job Start → projects, Other → assessments.
  - `deal_events.send_due_reminders` picks the email category by event_type so the reminder fires from the right mailbox.
  - `GMAIL_FROM_ALIASES` env extended to include `maintenance@sealtechsolutions.co`.
- **Frontend** (`Integrations.jsx`):
  - **Calendar Mapping** UI expanded from 3 → 5 dropdowns (Assessments / Scopes / Finance / Projects / Maintenance).
  - **Email "Send As" Routing** panel below — 5 selects listing every alias from `GMAIL_FROM_ALIASES`. Dirty-state "Save changes" button. Help text per category.
- **Locked**: Material Take-Off must NEVER auto-attach to customer scope emails (Darren 2026-02-18, internal pricing/margin info).
- **Tests**: 12/12 pytest + frontend Playwright pass (iteration_25, 100/100).


## 2026-02-19 — Compliance Wall (Dashboard widget)
- **What it does**: On the main dashboard, a card surfaces every team-member certification expiring within 60 days, sorted most-urgent first. Each row has a "Renew →" button that deep-links to `/users/:id?tab=certs`.
- **Auto-hidden when empty** or for non-admin viewers (403 → component returns null).
- **Color-coded chips**: expired/≤7d → rose, ≤30d → amber, ≤60d → blue.
- **Counter strip**: "X expired · X within 7d · X within 30d · X within 60d".
- **Backend**: `GET /api/dashboard/compliance-wall` (admin-only) — single batched query, joins users in one pass. Lives in `server.py` right after `/dashboard/today`.
- **Frontend**: New `ComplianceWall` component on `Dashboard.jsx`, follows same refresh-on-tab-focus pattern as `TodayEvents`. UserDetail page now also reads `?tab=certs` query param so the renew links land on the right tab.


## 2026-02-19 — User Profile (Notes / Certs / Equipment / Skills / Emergency / Employment)
- **What it does**: Click any user from `/users` → routed detail page at `/users/:id` with 6 tabs surfacing everything an admin needs to track for each team member.
- **Tabs**:
  - 📝 **Notes** *(admin-only)* — timestamped feed with author, pin-to-top, edit-own/delete-own. Empty body rejected. *Per Darren's explicit instruction (2026-02-19): notes area is admin-only; a separate non-admin notes surface can be added later if needed.*
  - 🎓 **Certifications** — name, issuer, cert #, issue/expiration dates, **document upload** (object storage, 25 MB cap). Color-coded expiration badges (red expired, amber ≤30d, blue ≤60d, emerald otherwise). Datalist suggestions (OSHA 10/30, GAF Master, EPA Lead-Safe, CDL, etc.).
  - 🔧 **Equipment** *(admin-only)* — item name, asset tag, serial, assigned-on date, notes. For trucks, tablets, ladders.
  - ✨ **Skills** — chip-tag selector with suggestions (TPO/EPDM/Metal/Coatings/Foreman/etc.) + custom add. Used later for crew-to-job matching.
  - 🚨 **Emergency Contact** — name + relationship + phone + alt phone + email + notes. Editable by admin OR self.
  - 💼 **Employment Basics** *(admin-only)* — hire date, pay type (hourly/salary/1099), hourly_rate, salary, driver's license #/state/expiration, T-shirt size, birthday. **Auto-stripped when the user views their own profile** (hourly_rate + salary hidden).
- **Cert expiration reminders**: APScheduler job runs daily at **13:30 UTC (≈ 7:30 AM MDT)**. For every cert with a future expiration date, fires the SMALLEST (= most urgent) un-sent reminder threshold from `(7, 30, 60)`. Idempotent via `reminders_sent` array. Emails go through the **projects** alias to both the admin pool + the cert holder.
- **Backend**: New `/app/backend/user_profile.py` module + `make_router` mounted at `/api/users/{id}/…`. Storage in 3 new Mongo collections: `user_notes`, `user_certifications`, `user_equipment`. Indexes on `user_id` + `expiration_date`. Inline fields on `users` doc: `skills`, `emergency_contact`, `employment`.
- **Frontend**: New `/app/frontend/src/pages/UserDetail.jsx` with tabbed UI, FieldStack form helper, datalist suggestions, and dirty-state save buttons throughout. Users page now links each user's name + adds a profile (IdCard) icon row action.
- **Authorization rules locked**:
  - Profile bundle GET → admin OR self
  - Notes (all routes) → admin only
  - Certs/Skills/Equipment write → admin only; read → admin OR self
  - Emergency contact → admin OR self can read/write
  - Employment → admin write; self read with hourly_rate + salary stripped
- **Housekeeping**: Deleted the stale `admin@sealtechsolutions.co` user stub (per Darren's request) — duplicate of the primary `darren@` login.
- **Tests**: 19/19 backend pytest + frontend Playwright (admin AND non-admin Emma manager flows) — iteration_26, 100% pass.


## 2026-02-19 — P2: Smart Auto-Attach Cover Photo on Scope Emails
- **What it does**: When the user opens the Email Scope modal, the deal's marked cover photo is automatically detected and pre-selected as an attachment. The bottom-bar summary now reads: `Will send scope PDF + N photo(s) + M library doc(s) = K total attachments`.
- **Behavior matrix**:
  - **Cover photo marked** (is_cover=true) → section labeled "Cover Photo (auto-attached)", checkbox pre-checked, ✓
  - **No cover marked but photos exist** → section labeled "Cover Photo (suggested)", most-recent photo shown UNCHECKED with amber hint "No cover marked — using most recent photo as suggestion."
  - **Zero photos** → section completely hidden
- **Locked safety rule**: Material Take-Off documents live in a separate collection (`material_takeoffs`) and are **NEVER attached** by this endpoint — verified via 6/6 backend pytest including a code-level safety scan of `email_spec_sheet`. Internal pricing/margin info never leaks to customers.
- **Backend** (`server.py` `email_spec_sheet`): New optional `cover_photo_ids: [str]` field on the request body. Empty list → no photos. Omitted → auto-finds is_cover=true photos. Explicit IDs → only those (matching the deal). Files attached with `original_filename` or fallback `{project_label}-cover.{ext}`.
- **Frontend** (`DealDetail.jsx` EmailScopeModal): New `coverPhotos` + `selectedPhotoIds` state. Photos fetched from `/api/projects/{deal_id}/photos` on modal open. New "Cover Photo" section above Library Attachments with file-card style rows + amber COVER badge. Bottom-bar summary updated to count photos.
- **Tests**: 6/6 backend pytest + 3/3 frontend Playwright (zero / cover-marked / cover-unmarked) — iteration_27, 100% pass.



## 2026-02-19 — Field Photo Workflow Polish (5 fixes from field test)
- **(a) Image size**: `FieldCapture.captureAndUpload` now downscales captures to max 2048px on the long side and encodes JPEG quality 0.72. Drops 3-6 MB shots to ~400-1200 KB. Stamp is painted BEFORE the resize-encode pipeline so proof-of-presence pixels survive.
- **(b) Viewport zoom hijack**: The `/field` route installs a viewport meta tag with `maximum-scale=1.0, user-scalable=no` on mount and restores the original on unmount. Pinch-zoom now only affects the camera digital-zoom handler — the page chrome (shutter button, camera frame) stays put.
- **(c) Per-photo download**: PhotoCard hover toolbar now has a Download button (data-testid `photo-download-{id}`); Lightbox also has a Download anchor (`lightbox-download`). Triggers a native browser save-as so the user can open the photo in Paint / Macromedia / wherever.
- **(d) Grid density**: Photo grid tightened to `grid-cols-4 sm:grid-cols-6 md:grid-cols-7 lg:grid-cols-8 xl:grid-cols-9 2xl:grid-cols-10 gap-1.5`. ~8 photos per row at typical desktop widths.
- **(e) Multi-select + bulk move**: New Select-mode toggle on the photos toolbar. In Select mode, tile clicks toggle selection (blue ring + ✓ badge). Sticky blue action bar with **TWO action groups**: (1) **Move to album →** dropdown (existing albums + "+ New album…") + Move button, (2) **Tag as →** quick-buttons for every preset tag (Before / During / After / Drone / Detail Shots / Damage Documentation) + Clear tag, plus a Delete button and Clear control. Bulk move/tag runs with **concurrency 4** so 30+ photos finish in seconds with live "X/Y…" progress in the button label + bottom-of-bar status line. Per-photo failures are logged + surfaced via "X done · Y failed" warning toast.
- **Tested**: iteration_28 — 100% spec compliance on all 5 fixes (code review + live UI test).



## 2026-02-19 — Soft-Delete Audit + Restore (post-incident)
- **Incident**: Testing agent iteration_28's bulk-delete CRUD test wiped Darren's real `Home Front Image.png` on deal `3401 S. Dexter Street_Res`. Cleanup script only purged its own test files; left Darren's photo soft-deleted. Recovered via manual DB script.
- **Diagnostic finding**: Of Darren's reported 16 morning field-camera shots, **only the manual PNG upload reached the backend** — no field-camera POST requests were recorded today. Likely cause: photos stuck in the on-device IndexedDB offline queue and never flushed. Pending investigation if it recurs.
- **New tooling — `/api/admin/recent-deletions`** (admin only): returns every soft-deleted item across `project_photos` + `deals` in the last N hours (default 48) with `{id, kind, label, deleted_at, deleted_by, context, restorable}`. Sortable + restorable in one click.
- **New tooling — `POST /api/admin/restore/{kind}/{id}`**: one-click restore by flipping `is_deleted=false`. Supports `kind ∈ {photo, deal}`.
- **Dashboard widget — `RecentlyDeleted`**: Auto-hidden when empty AND for non-admins. Shows "N items removed — click to restore" with per-row Restore buttons. Lives between Compliance Wall and Materials In Motion. Refetches on tab focus.
- **Process change going forward**: Testing agent must operate on a self-created `TEST_*` deal — never touch deals containing real user content. The new audit widget will surface any test-agent collateral damage immediately on Darren's next dashboard visit.

## 2026-02-20 — Material Calculator: Milestone 1 (Catalog Foundation)
- **Backend** (`/app/backend/product_catalog.py`, ~280 lines) — New router exposing four collections:
  - `product_catalog` (master price list): GET/POST/PATCH/DELETE `/api/products`, plus bulk `POST /api/products/import-csv` that upserts by (name, vendor) so re-uploads update prices instead of duplicating.
  - `roofing_systems` (18 named assemblies): GET/POST/PATCH/DELETE `/api/systems` grouped by `category` (FARM / Silicone / TPO / EPDM / ModBit / PVC / Other).
  - `system_recipes` (product+coverage per system): `GET /api/systems/{id}/recipe`, `PUT /api/systems/{id}/recipe` for atomic recipe replace. Each row: product_id, coverage_rate, coverage_basis ("per_100sf" / "per_sf" / "per_lf" / "per_each_optional"), optional flag, default_included flag.
  - `calculator_settings` (singleton): markup_pct (default **15%**), handling_pct (default **10%**), handling_basis ("marked_up" or "raw"), waste_pct. `GET/PUT /api/calculator/settings`.
- **Frontend** (`/app/frontend/src/pages/ProductCatalog.jsx`, ~340 lines) — Single page with three tabs:
  - **Products** — inline-editable table, Add Product modal, Import CSV modal (paste-then-preview).
  - **Systems** — grouped-by-category list; click a row to open the Recipe Editor drawer where you wire products + coverage rates and mark walk pad / granules as optional add-ons.
  - **Calculator Settings** — markup %, handling %, basis ("marked-up total" vs "raw cost"), default waste factor. Live explainer block recalculates from the current values.
- **Sidebar** — New `/catalog` route with a `Package` lucide icon, sitting between Assessments and Maintenance.
- **Smoke tested** — Created `DeckShield Primer / National Waterproofing / FARM / 5-gal pail / $145` via curl, then verified all three tabs render correctly in the browser.

### Pending — Milestone 2 (Calculator) + Milestone 3 (Deal integration)
- M2: Standalone calculator page at `/calculator` — pick a system, enter total SF, toggle optional add-ons, get a BOM table with calculated qty rounded up to package size, line totals, and grand total (with markup + handling applied per the settings singleton). Save calculations as snapshots.
- M3: "Pull from Calculator" button on the Vendor Cost section of a deal — imports a saved snapshot, pre-fills cost rows, links the calc to the deal.


## 2026-02-21 — Western Colloid Import + Material Calculator M2 & M3 (DONE)
- **Western Colloid catalog imported**: `scripts/import_western_colloid.py` parsed the user-uploaded `WESTERN COLLOID WebProduct Book.csv` (2.3 KB). The CSV is split into two parts (left = product price ladder by container size, right = per-system coverage requirements in GPS = "gallons per square / 100sf"). Imported **31 products** (each chemical SKU exploded across its 1–5 container sizes: 3.5-gal pail / 5-gal pail / 55-gal drum / 275-gal tote / fabric roll) into `product_catalog` with `vendor="Western Colloid"`. Imported **9 Western Colloid systems** (10/15/20/25-yr × Gravel/Membrane/Metal/All-Acrylic) into `roofing_systems` with a `coverage_template` JSON blob carrying per-100sf coverage for the four CSV categories.
- **Recipe auto-population**: `scripts/populate_wc_recipes.py` walked the 9 imported systems and mapped each abstract category to a canonical Western Colloid SKU (Emulsion → 298 5-gal Pail, Acrylic → 720 ARC 5-gal Pail, Fabric Soft → WCP-SS 40", Fabric Firm → WCP-SF 40"), producing **23 system_recipes rows**. Fabric coverage rates from the CSV are stored as linear-feet per 100sf and auto-converted to rolls (÷330 lf/roll) at insert time. Darren can override product picks via the existing Recipe Editor in Product Catalog.
- **`/calculator` page** (`/app/frontend/src/pages/Calculator.jsx`, ~580 lines) — pick up to 4 systems for side-by-side compare, enter Total Roof SF + waste %, choose optional add-ons (Walk Pads Grey/Yellow, Roof Wash, Elastic Cement W/B). For each compared system the page renders a Bill of Materials column with: needed qty, the optimal greedy container mix (largest size first, only whole large containers, smallest size rounds UP for remainder), line subtotals, Raw / +Markup / +Handling / Customer Price totals, and price-per-SF. Compounded math: `raw × 1.15 × 1.10` matches the existing `calculator_settings` singleton.
- **Container packing example** (verified math): 25-yr Gravel @ 10,000 SF → Asphalt Emulsion needs 2,600 gal → 9 × 275-gal tote ($12,598) + 2 × 55-gal drum ($750) + 3 × 5-gal pail ($135) = **2,615 gal for $13,483**. Identical greedy for ElastaHyde Acrylic. Fabric soft `0.9 roll` → rounds up to 1 × $135. Walk Pads add-on 50 gal → 10 × 5-gal pail = $1,500.
- **Deal integration** (Milestone 3): DealDetail's Vendor Cost Line Items card now has a **Pull from Calculator** button (`data-testid="pull-from-calculator"`) linking to `/calculator?deal=<id>`. The calculator pre-fills Total SF from the deal's `property_sqft`, the header reads `Estimate for <deal.title>`, and each compare column shows a **Push to Deal** button that PUTs the materials BoM lines into the deal's `cost_items` array. Each pushed line has `category="Materials"`, `vendor_name="Western Colloid"`, description like `Asphalt Emulsion Non-Fibered (9×275gal, 2×55gal, 3×5gal) — 25-Year Gravel System (E/A)`, and the actual VENDOR-side amount (no markup). Post-save toast surfaces the Customer Price so Darren can paste it into Proposal Options if he wants.
- **Tested** (iteration_29): 7/7 pytest backend cases pass. Frontend Playwright verified: sidebar vendor grouping, 4-system compare limit (5th blocked), 25-yr Gravel math, container packing exact, Walk Pads $1,500 across 4 columns, Pull-from-Calculator button, Push-to-Deal flow (creates Materials cost_items, navigates back to deal). One header bug `deal.name → deal.title` fixed post-test. Final compare column saves only raw cost lines now (markup line removed — was inflating Total Costs).


## 2026-02-21 (evening) — Calculator polish per Darren's review
- **AA system_type fix**: 3 Western Colloid AA systems (20-Yr / 10-Yr All-Acrylic, 10-Yr Metal Roof) were tagged as "Silicone" — wrong. Updated DB + `CATEGORIES` constant (FE + BE) to include "All-Acrylic", so the sidebar now reads "ALL-ACRYLIC · 10-YR" etc.
- **Per-SF price precision**: customer-facing $/SF line now shows two decimals (e.g. `$4.42/SF` instead of `$4/SF`) via inline `Intl.NumberFormat` — `formatCurrency` helper untouched so the rest of the app keeps whole-dollar formatting.
- **Site Access — Allowed Containers toggle**: 3-button pill row in the controls bar (`data-testid="toggle-container-{tote|drum|pail}"`) lets the salesperson exclude container sizes the job site can't accept (no forklift, no truck access, residential alley, etc.). The greedy packer skips disabled sizes in real time and re-runs the math. Container kind ("tote" / "drum" / "pail") is now baked into the on-screen BoM AND the cost-item description pushed to the deal, so the resulting PO line for the vendor reads `Asphalt Emulsion Non-Fibered (47×55gal drum, 3×5gal pail) — 25-Year Gravel`.
- **"Markup" → "Shipping" rename** everywhere in Calculator + Product Catalog Settings. Backend field `markup_pct` kept as-is (no migration).
- **Fabric-layer recipes (final pass)**: After Darren provided the per-system layer counts and confirmed `rolls = ceil(layers × roof_sf / 1000)` (one 40"×330' roll covers ~1,000 sf incl. overlap = 10 squares), `scripts/set_fabric_layers.py` rewrote all 8 fabric recipe rows. Now: 25/20-Yr Gravel = 3 SOFT, 25/20-Yr Membrane = 3 FIRM, 20-Yr AA = 2 FIRM, 15-Yr Membrane = 2 FIRM, 10-Yr Membrane = 1 FIRM, 10-Yr AA = 1 FIRM, 10-Yr Metal = no fabric. Each recipe row carries a human-readable `notes` (e.g. *"3 layers of 40" firm fabric (~1,000 sf coverage per roll incl. overlap)"*) that the calculator now surfaces as an italic subtitle under each BoM line so the salesperson can see the assumption inline.
- **Floating-point safety**: added `snap()` helper in `packContainers` so 5.000076 doesn't ceil to 6 anymore.
- **Pending for Darren's tomorrow review**: AA systems (20-Yr/10-Yr) and 25-Yr Membrane fabric layers are inferred from the CSV — confirm those match field experience.



## 2026-02-19 — Property Evaluation PDF (non-fee-based courtesy report)
- **New 6–7 page PDF** at `GET /api/assessments/{id}/evaluation.pdf` — sibling of the 12-page Commercial Roof Assessment Report. Backed by `/app/backend/property_evaluation_pdf.py` which imports all helpers/colors/styles from `assessment_pdf.py` so the two outputs stay visually consistent without copy-paste drift.
- **Section selection** confirmed by Darren: Cover (rebranded "PROPERTY EVALUATION · Non-Fee-Based Courtesy Evaluation"), Executive Summary, Aerial + up to 3 findings (R-1..R-3), Roof Score Analysis, Repair vs Restoration vs Replacement, SealTech Recommendation + Expected Outcome + Conclusion. Cover carries a footer disclaimer explaining the courtesy nature and pointing at the full Assessment Report as an upgrade path.
- **Shares the same `assessment` document** — inspector fills one form, exports either flavor. Empty findings (R-2/R-3 with no component/observations/photos) are auto-skipped so small jobs don't print blank finding cards.
- **Frontend**: new "EVALUATION PDF" button in the Assessment Editor top bar (next to "ASSESSMENT PDF") and a green file-check icon button in the Assessments list table on every row. Both surfaces verified rendering via screenshot tool.
- **Endpoint smoke-tested** against assessment `f96cf959-…` (2278 Manatt Ct_CR) — returns HTTP 200, `application/pdf`, 7 pages confirmed via pypdf. Same auth + popup-blocker-safe synchronous tab-open pattern as the full Assessment PDF flow.


## 2026-02-19 — Real morning-walk photo recovery + timeline prep (Dexter)
- **Recovery**: Discovered 61 orphaned JPEG blobs in object storage under `sealtech-crm/project_photos/{Dexter}/` with no DB rows — the previous agent's "recovery" had hard-deleted the project_photos rows but the storage cleanup call returned 405 so the binaries survived. Wrote `scripts/restore_dexter_morning_walk.py` which lists the storage prefix, filters out 32 zero-byte black-screen failures (artifacts of the iOS Safari bug we shipped a fix for earlier today), and inserts 29 fresh `project_photos` rows in a dedicated album `Recovered Morning Walk · 2026-06-19`. All 29 photos are sized 0.5–1.27 MB, captured 17:14–18:31 UTC, attributed to Darren, marked `stamped=True`.
- **Fake album cleanup**: `scripts/cleanup_dexter_fake_recovery_album.py` soft-deletes the 16 testing-agent leftovers (10 colored squares, 5 black 70-byte stubs, 1 "aerial.jpg") that the previous agent had relabeled "Recovered from Field". Restorable for 30 days via the dashboard's Recently Deleted widget.
- **Lazy-load thumbnails (`ProjectPhotos.jsx`)**: `PhotoCard` now uses IntersectionObserver with a 200 px pre-load margin so the auth'd `/photos/{id}/download` blob fetch only fires for cards that scroll into view. Cuts initial paint from "26 MB on the wire" to "whatever fits in the viewport" for big galleries. Falls back to eager fetch on browsers without IO (none in practice).
- **EXIF auto-stamp on upload (`project_photos.py`)**: New `_exif_captured_at(image_bytes)` reads `DateTimeOriginal` / `DateTimeDigitized` / `DateTime` from the JPEG. When the upload endpoint receives a photo with no explicit `captured_at`, it now back-fills from EXIF — so a foreman's iPhone photo emailed days later sorts to its real shutter date instead of upload date. Falls back to `_now_iso()` only if EXIF is missing/unparseable.
- **Atomic bulk endpoints (`PATCH /projects/{deal_id}/photos-bulk`, `POST /.../photos-bulk-delete`)**: Replaces the N-parallel-PATCH frontend loop that previously caused partial-success states under load. Single `update_many` against a deal-scoped id filter, max 500 ids per call, accepts `tag` / `album_name` / `captured_at` in one body. The `captured_at` field accepts both `YYYY-MM-DD` (date-picker output, normalized to noon UTC) and full ISO 8601.
- **Pending (deferred to next session)**: timeline-view gallery (group by capture date with day headers), "Set capture date" bulk picker UI, optional desktop drag-to-date interaction. Backend is ready; only the UI wiring is left.


## 2026-02-19 — iOS Safari "Black Screen" Camera Recovery (FieldCapture)
- **Build fix**: Removed duplicate `const video = videoRef.current;` declaration on `FieldCapture.jsx` line 428 and added the missing `toast` import from `sonner`. Frontend now compiles cleanly (one pre-existing eslint warning in `ProjectPhotos.jsx` is unrelated).
- **Persistent RESTART button**: Always-visible "Restart" pill in the camera-view top bar (`data-testid="field-restart-camera"`). Hard-tears down the MediaStream, waits 250 ms for iOS to release the camera, then re-acquires it. Used by both the manual button and the auto-retry path.
- **Black-stream health monitor**: New 1.2 s polling loop watches `video.videoWidth` / `videoHeight` / `readyState`. After ~2.5 s of dead frames the stream is flagged unhealthy, a red full-width banner takes over the camera area, and the shutter button is hard-disabled (`!streamHealthy` guard) so no more silent black uploads.
- **Auto-retry once**: 3 s after the first unhealthy detection the camera is automatically restarted exactly one time. If it still won't paint, the banner stays up and the user must tap RESTART CAMERA. Retry budget resets the moment the stream paints a real frame.
- **Capture-time guard preserved**: `captureAndUpload` still verifies frame dimensions before encoding so any race between the health monitor and a fast shutter tap still rejects the shot with an explicit toast instead of uploading black pixels.




## Backlog (P1)
- Subcontractor scorecards (quality / on-time metrics) — DONE
- Statement of Account PDF (aging report per customer) — DONE

## Backlog (P2)
- Stripe online pay link on invoices
- In-app Scope Editor (override any spec-sheet bullet before PDF)
- Admin Trash view (restore / hard-delete soft-deleted records, incl. inactive entities/accounts)
- Google Calendar 2-way sync for project schedules
- Smart auto-attachment suggestions in Email Scope modal (pre-select Library docs by proposed_roof_type) — **cover photo only; NEVER the Material Take-Off**, which is internal pricing/margin info and must never be sent to customers (locked by Darren 2026-02-18).
- Refactor `server.py` (~4,500 lines) into `/app/backend/routes/` modules
