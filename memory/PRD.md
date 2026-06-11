# Roofing CRM — Product Requirements Document

## Original Problem Statement
> Create a simple CRM for a person operating in commercial roofing — contact name, company name, address, billing address (option same as address), property name, property address, property contact, lead source, project type, current/proposed roof type, proposal (3 option amounts), chosen amount, revenue P&L, plus the ability to extend later.

## User Choices
- **Auth**: Simple email/password JWT
- **Lead sources** (fixed): Referral, Website, Cold Call, Door Knock, Social Media, Repeat Customer, Other
- **Roof types** (fixed): TPO, EPDM, PVC, Modified Bitumen, Built-Up (BUR), Metal, Shingle, Tile
- **P&L**: Detailed — materials, labor, subcontractors, other expenses (auto-calculated profit)
- **Dashboard**: KPIs (open leads, won deals, pipeline revenue, profit YTD)

## Persona
Single-operator commercial roofing contractor managing contacts, properties, and project pipeline + financials end-to-end.

## Architecture
- **Backend**: FastAPI + Motor (async MongoDB), JWT (HS256) auth via Bearer token. All routes prefixed `/api`.
- **Frontend**: React (CRA) + Tailwind + Shadcn UI primitives + Sonner toasts. JWT stored in `localStorage.crm_token`.
- **Database**: MongoDB collections: `users`, `contacts`, `properties`, `deals`.

## Implemented (Feb 11, 2026)
- JWT auth: register, login, /me, admin seed (admin@roofingcrm.com / admin123)
- Contacts CRUD with billing-same-as-address toggle
- Properties CRUD with optional link to a contact
- Deals CRUD with 3 proposal options, chosen amount, status (Lead/Proposal Sent/Won/Lost), and full P&L breakdown (materials, labor, subcontractor, other → profit auto-calc)
- Dashboard with 8 KPI cards + recent deals
- Deal detail page with proposal options card, roof spec, P&L breakdown, linked contact & property
- Dropdown options endpoint `/api/options`
- Status filter chips on Deals list
- Swiss/High-Contrast UI design (Chivo + Public Sans, orange #EA580C accents, dark sidebar)

## Test Coverage
- Backend: 20/20 pytest tests pass (auth, CRUD, dashboard aggregations)
- Frontend: 10/10 E2E flows pass (login, navigation, all CRUD modals, deal detail)

## Backlog
### P1 (next)
- [ ] Deal stage timeline / change history
- [ ] Soft-delete + archive for deals
- [ ] CSV export of contacts and deals

### P2
- [ ] File attachments per deal (photos, proposals, contracts)
- [ ] Email proposal directly from deal page
- [ ] Multi-user team support with role permissions
- [ ] Calendar of follow-ups / tasks

### P3
- [ ] Revenue forecasting chart
- [ ] Geo-map of properties
