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
- ✅ New `PUT /api/auth/me` for self-edit (name / job title / phone — never email or role)
- ✅ New `POST /api/auth/change-password` requiring current password, min 8 chars, must differ from current
- ✅ `/profile` page with two cards: Profile Details + Change Password
- ✅ Real-time password strength meter (Weak → Very Strong)
- ✅ Show/hide toggles, autocomplete attributes for browser password managers
- ✅ Sidebar avatar block is now a NavLink to `/profile` — click avatar to edit
- ✅ Renamed "Title" → "Job Title" everywhere with helper text reminding it appears on POs
- ✅ Server-side guard: rejects values that look like a bcrypt hash being saved as plain text

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
