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

## Backlog (P1)
- Subcontractor scorecards (quality / on-time metrics)
- Statement of Account PDF (aging report per customer)
- Additional Roof Type Spec Sheet templates (TPO, EPDM, ModBit, BUR, Metal, Shingle, Tile, FARM)

## Backlog (P2)
- Stripe online pay link on invoices
- Admin Trash view (restore / hard-delete)
- User profile self-edit (name, phone, title, password)
- Google Calendar 2-way sync for project schedules
- Refactor `server.py` (~3000 lines) into `/app/backend/routes/` modules
