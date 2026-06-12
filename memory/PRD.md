# SealTech CRM — PRD

## Original Problem Statement
> I need to create a simple crm for a person operation in commercial roofing, include contact name, company name, address, billing address with the option to make the same as address, property name, property address, property contact, lead source, project type, current roof type, proposed roof type, proposal with three option amounts, chosen amount, revenue P&L and we can add more later.

## Branding
- **Name**: SealTech Building Solutions
- **Logo**: `/app/frontend/public/sealtech-logo.png`
- **Colors**: Cobalt blue primary (`#1D4ED8` / `blue-700`), orange accent (`BUILDING SOLUTIONS`), black sidebar, zinc neutrals
- **Fonts**: Chivo (headings), Public Sans (body)

## Architecture
- **Backend**: FastAPI + Motor (MongoDB async) + JWT (PyJWT) + bcrypt — `/app/backend/server.py`
- **Frontend**: React 19 + react-router-dom 7 + Tailwind + Shadcn UI + axios + sonner — `/app/frontend/src/`
- **Auth**: Email/password → JWT Bearer in `Authorization` header, stored in `localStorage` (`crm_token`)
- All API routes are `/api/*` prefixed

## User Persona
Single owner-operator of a small commercial roofing business, managing the full lead-to-cash pipeline alone.

## Core Requirements (static)
1. **Contacts**: contact_name, company_name, phone, email, address, billing_address (with "same as address" toggle)
2. **Properties**: property_name, property_address, on-site contact (linked or freeform), notes
3. **Deals**: title, contact, property, lead_source, status, project_type, current_roof_type → proposed_roof_type, 3 proposal options + chosen amount, P&L (materials, labor, subcontractors, other), notes
4. **Dashboard**: KPIs (open leads, won deals, pipeline revenue, profit YTD, contacts, properties, won revenue, total costs)
5. **Auth**: JWT email/password login + register

## Implemented (2026-02)
- ✅ JWT auth (login/register/me) + admin seed (`admin@roofingcrm.com` / `admin123`)
- ✅ Contacts CRUD with billing-same-as-address auto-copy
- ✅ Properties CRUD with contact linking
- ✅ Deals CRUD with 3 proposal options, chosen amount, full P&L, status pipeline
- ✅ Deal detail page with P&L breakdown, margin %, linked contact/property
- ✅ Dashboard with 8 KPI cards + recent deals + status-filtered deal list
- ✅ SealTech branded UI (logo, blue/orange palette, Chivo/Public Sans)
- ✅ Backend tested: **20/20 endpoints passing** (iteration_2.json)

## Implemented (2026-06)
- ✅ Maintenance Plan tracking on Projects (toggle + annual rate + start date + auto next-due-date)
- ✅ Visit Log per Project with Subcontractor dropdown, amount, notes
- ✅ New "Maintenance" page in nav: searchable/filterable list, status badges (Overdue / Due Soon / Upcoming), Log Visit modal, Excel + PDF export
- ✅ Dashboard maintenance KPIs (Plans count, ARR, Due 30d, Overdue) — all linked to /maintenance
- ✅ Spec Sheet refinements: header normalization, CONTACT row, "(Standard Warranty Included)" suffix, Upgraded Warranty labels, footer with phone, centered+italic appreciation paragraph, photo right-sized to 1.6" so everything fits 3 pages
- ✅ Project Types expanded to: Repair, Roof Restoration, Roof Replacement, Maintenance, New Construction, Other
- ✅ Revenue by Type card on Dashboard with YTD ↔ All-Time toggle (Booked / Received / Outstanding columns)
- ✅ Maintenance page now shows "Visits Income (YTD)" KPI alongside ARR
- ✅ Brand accent updated from orange to bronze (#A0703A) on Spec Sheet, Login eyebrow, Documents star
- ✅ **Invoicing Module**: Invoice model + endpoints, SealTech-branded PDF, INV-YYYY-NNNN numbering starting at INV-2026-1100, auto-fill Bill To from customer billing address, status workflow (Draft → Sent → Partial → Paid → Overdue), payment tracking, Invoices list page with filters/search/KPIs
- ✅ Auto-create draft invoice when logging a maintenance visit (prompted)
- ✅ Auto-create from milestone endpoint (`POST /api/invoices/from-milestone`)
- ⚠️ Email-sending currently **MOCKED** (marks invoice as Sent, records to/cc emails) — awaiting provider choice (Resend / SendGrid / Gmail SMTP) + API key

## Backlog (P1)
- 📧 Wire actual email delivery for Invoices + Spec Sheets (provider pending user choice)
- Additional Roof Type Templates for Spec Sheet (TPO, EPDM, ModBit, BUR, Metal, Shingle, Tile, FARM)
- Kanban view of deals by status (drag to update)
- Activity timeline per deal (notes, calls, meetings)
- Materials catalog with default unit costs

## Backlog (P2)
- Admin Trash View (restore / permanent-delete soft-deleted records)
- User Profile Self-Edit (name, phone, title, password)
- Google Calendar Sync for project schedules
- Mobile-responsive sidebar (hamburger)
- Stripe payments / invoicing
- Online pay link + ACH info on invoice (user will provide)
