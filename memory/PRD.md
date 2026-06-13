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

## Backlog (P1)
- Subcontractor scorecards (quality / on-time metrics)
- Statement of Account PDF (aging report per customer)

## Backlog (P2)
- Stripe online pay link on invoices
- Admin Trash view (restore / hard-delete)
- User profile self-edit (name, phone, title, password)
- Google Calendar 2-way sync for project schedules
- Refactor `server.py` (~3000 lines) into `/app/backend/routes/` modules
