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

## Backlog (P1)
- Kanban view of deals by status (drag to update)
- File/photo attachments per deal (drone shots, proposal PDFs, signed contracts)
- Email proposals directly to contact from app
- Activity timeline per deal (notes, calls, meetings)
- Quick-add buttons (e.g., "+ Contact" inside deal modal)

## Backlog (P2)
- Multi-user team accounts with assignment / ownership
- Calendar view of jobs
- Export to CSV
- Mobile-responsive sidebar (hamburger)
- Stripe payments / invoicing
- Recurring maintenance contracts
