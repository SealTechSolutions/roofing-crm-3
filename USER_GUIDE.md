# SealTech CRM — Complete User Guide

*Last updated: February 2026*

This is a full field-to-office manual for the SealTech CRM system. Sections are organized by role — start with the section that matches how you use the app.

## Sidebar Navigation (Grouped)

The sidebar is organized into 8 groups so related items live together:

```
📊 Dashboard  (standalone at top)

📇 CONTACTS
   • People & Companies
   • Vendors
   • Subcontractors

📁 PROJECTS
   • Properties
   • Deals
   • Calculator

📸 FIELD
   • Photo Timeline
   • Finish Site Visit
   (Field capture happens on the native iOS app — install via "Get App on My Phone")

📈 REPORTS
   • Assessments
   • Scopes
   • Maintenance

📅 SCHEDULING
   • Calendar
   • Tasks
   • Scheduled Jobs  (admin)

📚 LIBRARY
   • Documents
   • Product Materials
   • Sales Materials

💰 FINANCE
   • Books
   • Invoices
   • Payables

⚙️ COMPANY INFO  (admin only)
   • Users
   • Integrations
   • Trash

──────────
📖 User Guide  (opens this document on GitHub)
```

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Contacts, Properties, Deals — The Core](#contacts-properties-deals)
3. [Field Operations — Photos & Site Visits](#field-operations)
4. [Photo Feature Deep-Dive](#photo-features)
5. [Documents & PDFs](#documents--pdfs)
6. [Calculator (Coating Systems)](#calculator)
7. [Public-Facing Tools](#public-facing)
8. [Accounting Module (Books)](#accounting)
9. [Admin & Compliance](#admin)
10. [Mobile / iOS App](#mobile)
11. [Quick Reference — Common Workflows](#quick-reference)

---

<a name="getting-started"></a>
## 1. Getting Started

### Login
- **Web app:** https://roofing-crm-3.preview.emergentagent.com
- **iOS app:** TestFlight → SealTech CRM
- **Credentials:** `darren@sealtechsolutions.co` / `admin123`

### Roles
- **Admin:** full access, user management, accounting, trash
- **User (rep):** deals, photos, calculator, documents

Set roles per user in **Users** (sidebar).

### Dashboard
The landing page shows your KPIs:
- Open Deals (count + total value)
- Deals in Site Visit / Proposal / Contract stage
- Photos captured this week
- Recent Activity Timeline
- COI expirations & compliance flags

---

<a name="contacts-properties-deals"></a>
## 2. Contacts, Properties, Deals — The Core

The system is built on 3 stacked entities:

```
Contact ──► Property ──► Deal ──► [Photos, Documents, Assessment, Scope, Proposal, Work Orders, Invoices]
```

### Contacts (people & companies)
- **Sidebar → Contacts → +Add**
- Fields: name, company, email, phone, role (Owner / Property Manager / Insurance Adjuster / etc.)
- Auto-linked to any property or deal that references them

### Properties (buildings)
- **Sidebar → Properties → +Add**
- Street/city/state/ZIP + GPS coords + square footage + roof type + install year
- Photos taken in Field Capture GPS-stamp to this property
- Each property can have multiple deals over time (initial → maintenance → re-coat)

### Deals (aka Projects)
- **Sidebar → Deals → +Add**
- Fields: title, property, primary contact, stage, value, expected close
- **Stages:** Lead → Site Visit → Assessment → Proposal → Contract → Scheduled → In Progress → Complete → Warranty
- Drag between stages in the **Kanban view** (Deals → toggle "Kanban")
- Every downstream artifact (photos, PDFs, invoices) attaches to a deal

---

<a name="field-operations"></a>
## 3. Field Operations — Photos & Site Visits

This is the flow reps use on-site.

### Step 1: Field Capture (the shutter — native iOS app)
1. **Open the SealTech iOS app** on your iPhone (install via "Get App on My Phone" in the web sidebar)
2. **Pick a deal** from the dropdown at the top (it remembers your last selection)
3. **Tap the big shutter button** → phone camera opens
4. Take photo → adds to the deal instantly
5. Each photo captures: GPS location, timestamp, uploader name, file size

### Step 2: Tag & Caption (in the field or during wrap-up)
Every photo can have:
- **Tag** (one of): Damage Documentation / Before / During / After / Drone / Detail Shots
- **Description** (free text) — dictate via voice (see [Voice Captions](#voice-captions))
- **Album** (optional grouping like "Main Roof" / "West Wing")

### Step 3: End-of-day wrap-up
**Sidebar → Finish Site Visit** → see all deals you shot on today with quick actions. See [Wrap-Up section](#wrap-up).

---

<a name="photo-features"></a>
## 4. Photo Feature Deep-Dive

Every photo lives in **Deals → [pick deal] → Project Photos section**. Below are the 4 CompanyCam-parity features that stack on top of any photo.

### 4a. Annotations 🎨 (draw on photos)
1. Tap a photo → hover toolbar → **green pencil icon**
2. Fullscreen annotator opens
3. Tools (top toolbar):
   - **Arrow** — click & drag to draw a filled-head arrow
   - **Circle** — click & drag to draw an ellipse
   - **Pen** — freehand drawing
   - **Text** — click on photo → type label → adds with dark background for legibility
4. **Color palette:** red / yellow / green / blue / white / black
5. **Stroke widths:** S / M / L
6. **Undo** — removes last shape
7. **Clear All** — wipes all annotations (asks for confirmation)
8. **Save** → flattens image + overlay to a full-resolution PNG, tags photo with **"MARKED"** emerald badge

**Where annotated versions appear:**
- Photo grid — MARKED badge
- Photo Timeline — MARKED badge
- Condition Report PDF — inspector's marked-up version renders instead of raw
- Client emails — the marked-up version is what customers see

### 4b. Voice-to-Text Captions 🎤
1. Tap a photo → Edit
2. **Mic icon** next to Description field
3. First time: iOS asks for microphone permission → **Allow**
4. Tap mic → **red pulsing button** with live timer appears
5. Dictate: *"Membrane blistering by roof drain, needs immediate patch."*
6. Tap mic again to stop → **spinner** → text appears in Description field
7. **Save**

**Notes:**
- Uses OpenAI Whisper (roofing vocabulary pre-loaded — membrane / TPO / EPDM / blistering / etc.)
- 60-sec safety auto-stop prevents forgotten mic sessions
- Appends to existing description (never overwrites)
- iOS + Android + desktop browsers all supported

### 4c. Before / After Pairs 🔄
1. Tap a photo → hover toolbar → **blue git-compare icon**
2. Modal opens: *"Pair with another photo"*
3. Pick this photo's role: **Before** (rose) or **After** (emerald)
4. Click any other photo in the grid to pair with
5. Both photos get labeled with opposite roles automatically
6. **Emerald "Before / After Pairs" panel** now appears at top of Project Photos
7. Tap the paired thumbnail → **fullscreen slider modal**
8. **Drag the vertical white handle** left/right to reveal Before vs After

**Un-pairing:**
- Open the Pair Picker on either photo → red **"Un-pair"** button (at bottom)
- Backend also auto-cleans back-references when a photo is deleted

### 4d. Email Condition Report 📧
1. Top of Project Photos section → **"Email Report"** button (emerald outline)
2. Modal opens: *"Email Condition Report"*
3. **To** auto-fills from the deal's primary contact
4. Optional: add CC email + personal note
5. Tap **Send Report**
6. Recipient inbox receives a professional PDF (see [Condition Report PDF](#docs))

**What gets attached:**
- Cover page: property, inspector, date, executive summary
- Photos grouped by damage type (Damage → Detail Shots → Before → During → After → Drone)
- Annotated photos preferred over raw
- Green ★ chip marks photos with inspector annotations
- Deal history logs: *"Condition Report emailed to X on [date]"*

### 4e. Photo Timeline (cross-project view)
- **Sidebar → Photo Timeline**
- All photos across all deals, chronologically grouped (Today / Yesterday / This Week / etc.)
- Filter by tag, day range (7D / 30D / 90D / 1Y), or search
- Tap any photo → fullscreen lightbox with property + timestamp metadata
- Annotate button available in the lightbox

<a name="wrap-up"></a>
### 4f. Finish Site Visit (end-of-day cleanup) 🎯
- **Sidebar → Finish Site Visit** (or navigate to `/wrap-up`)
- One card per deal you shot photos on today (or 3D / 7D toggle)
- Each card shows:
  - Photo count + counters (untagged / no-caption / annotated / paired)
  - **Amber pip** if action pending (untagged photos, missing captions, or new photos since last report)
- **Bulk-tag chips** (6 large color-coded buttons) → tap "Damage Documentation" → every untagged photo on that deal gets tagged in one click
- **"Send Condition Report"** → one-tap email to primary contact

**Field team workflow:**
1. Shoot photos throughout the day (multiple deals)
2. Get in truck at end of day
3. Open **Finish Site Visit**
4. For each deal card: tap 1-2 tag chips + tap Send Condition Report
5. **Total time: ~30 seconds per site visit** vs 15 min of manual admin

---

<a name="docs"></a>
<a name="documents--pdfs"></a>
## 5. Documents & PDFs

All PDFs generate on-demand — no need to keep templates or manual editing. Each deal has these downloadable documents.

### 5a. Assessment Report (site conditions)
- **Deal detail → Documents → Assessment**
- Includes: property overview, roof system inspection findings, moisture survey results, membrane analysis, recommendations
- Auto-includes photos with tag = "Damage Documentation"

### 5b. Scope of Work
- **Deal detail → Documents → Scope**
- Editable line items (in-app scope editor)
- Categories: Prep / Base Coat / Reinforcement / Top Coat / Trim / Cleanup
- Also accessible from **Sidebar → Scopes** for global view
- Quick chips on Dashboard, Contacts, Properties for instant download

### 5c. Proposal (public sign-off)
- **Deal detail → Documents → Proposal**
- Rendered as a customer-facing PDF with pricing, warranty, terms
- **Public sign-off:** each proposal has a shareable link like `roofing-crm-3.preview.emergentagent.com/proposal/{token}`
- Customer signs on their phone → drawn signature captured on canvas → deal auto-moves to "Contract" stage

### 5d. Roof Condition Report (⭐ THE new one)
- **Deal detail → Project Photos → "Condition Report" button** (green)
- Client-ready roof condition PDF
- Sections in priority order:
  1. **Damage Documentation** (Rose header, top of report)
  2. **Detail Shots**
  3. **Before**
  4. **During**
  5. **After**
  6. **Drone**
  7. **Untagged / Other**
- Cover page: report date, inspector, executive summary table with photo counts + annotation counts
- **Uses annotated photos** where available so client sees your callouts
- Optional Email button sends this straight from the app via Gmail

### 5e. Work Orders & Change Orders (subcontractor)
- **Deal detail → Documents → Work Order**
- Send to subcontractor with terms + scope + payment split
- Sub signs on their phone (drawn signature) at `roofing-crm-3.preview.emergentagent.com/wo/{token}`
- **Change Orders** create modified WOs mid-project — same signing flow

### 5f. Sales Brochures
- **Sidebar → Library → Brochures**
- 3 versions pre-built:
  1. **Western Colloid FARM** system
  2. **Everest Silicone** system
  3. **FARM vs Silicone Comparison**
- Send during initial contact or attach to proposals

### 5g. Progress Timeline PDF (date-stamped photo album)
- **Deal → Project Photos → "Timeline PDF" button** (white outline)
- Every photo grouped by date
- Different from Condition Report — chronological, not damage-focused
- Good for: showing progress to insurance, warranty documentation

### 5h. Spec Sheets & Purchase Orders
- **Deal → Documents → Spec Sheet** (product data for the customer)
- **Deal → Vendors → Purchase Order** (for material ordering)

---

<a name="calculator"></a>
## 6. Calculator (Coating Systems)

**Sidebar → Calculator**

Two full coating systems supported:

### Western Colloid FARM System
- Base primer / Field Coat / Membrane reinforcement / Top coat
- Waste factor adjustable per line
- Auto-calculates gallons + drums needed

### Everest Silicone System
- Silicone primer / High-solids silicone base / Reinforcement fabric / Silicone top
- **Custom add-ons** section (extra scupper wraps, drain retrofits, etc.)

### Global Settings (Calculator Settings)
Controlled at **Sidebar → Calculator → gear icon** — affects every calculation:
- **Markup %** (over cost basis)
- **Handling %** (freight, storage)
- **Overhead %** (indirect labor)
- **Profit %** (target margin)

### Export from Calculator
- **Save to Deal** — attaches material list + pricing to a deal
- **Spec Sheet PDF** — customer-facing product details
- **Purchase Order** — vendor-facing material order

---

<a name="public-facing"></a>
## 7. Public-Facing Tools

Links you can share with customers or subs — no login required.

### Public Proposal Sign-Off
- URL format: `/proposal/{token}`
- Customer sees the proposal PDF + a signature canvas at the bottom
- On sign: deal moves to Contract stage automatically

### Subcontractor Work Order Signing
- URL format: `/wo/{token}`
- Sub sees the WO PDF + signature canvas
- On sign: WO status → "Signed", deal history logs the event

### Curated Client Photo Gallery (planned P1)
- Share a filtered gallery with customers — you pick which tags/pairs to include
- Coming soon

### Mobile QR Login
- Sidebar → **Mobile QR Login**
- Scan on your phone to auto-login without typing credentials

---

<a name="accounting"></a>
## 8. Accounting Module (Books)

Multi-entity accounting for tracking construction financials.

### Chart of Accounts (COA)
- **Sidebar → Books → COA**
- Assets / Liabilities / Equity / Revenue / COGS / Expenses
- Multi-entity — each subsidiary (SealTech Building Solutions, SealTech Roofing, etc.) has its own COA

### Inter-Co Bank
- **Sidebar → Books → Inter-Co Bank**
- Track transfers between entities (SealTech Building Solutions ↔ SealTech Roofing)
- Auto-generates matching journal entries on both sides

### Period Close
- **Sidebar → Books → Period Close**
- Preview month-end balances → lock the period
- Prevents backdated transactions after close

### Financial Reports
- **Sidebar → Books → Reports**
- **Balance Sheet** (assets vs liabilities + equity)
- **Income Statement** (P&L)
- **Cash Flow Statement**
- All filterable by entity and date range

### Invoices & Payables
- **Sidebar → Invoices** — send invoices to customers (Stripe payment link coming in P3)
- **Sidebar → Payables** — track subcontractor & vendor bills
- Weekly Friday 7AM payables digest auto-emails to admin

---

<a name="admin"></a>
## 9. Admin & Compliance

### Users
- **Sidebar → Users** → +Add User
- Assign role: Admin / User
- Deactivate users without deleting (preserves history)

### COI Reminders (Certificate of Insurance)
- **Sidebar → Subcontractors → [sub] → COI**
- Set expiration date → system auto-emails sub 30 days before
- Dashboard shows any expiring within next 60 days

### Compliance Tracking
- **Sidebar → Vendors / Subcontractors → Compliance tab**
- W-9, business license, insurance cert, safety certs
- Missing items flagged red on the dashboard

### Trash (Soft-Delete)
- **Sidebar → Trash**
- Every "delete" is a soft-delete for 30 days
- Admins can restore contacts, properties, deals, photos from here
- Auto-purged after 30 days

### Email Routing
- **Sidebar → Integrations → Email Routing**
- Route outgoing emails by category (proposals, assessments, invoices, maintenance) to different From addresses
- e.g., proposals from `sales@sealtechsolutions.co`, maintenance from `service@sealtechsolutions.co`

### Google Calendar Sync
- **Sidebar → Integrations → Google Calendar**
- Two-way sync deal appointments with your Google Calendar
- Site visits, install dates, warranty checks all appear

### Automated Stale Deals Digest
- Daily email at 7 AM MT with any deal that hasn't moved stages in > 14 days
- Helps you spot lost leads / stalled proposals

---

<a name="mobile"></a>
## 10. Mobile / iOS App

### Installing on Your iPhone
See separate `NATIVE_APP_SETUP.md` for details. Quick recap:
1. TestFlight app on iPhone
2. Owner adds you to Internal Team in App Store Connect
3. Email invite → tap "View in TestFlight" → Install
4. Icon lands on home screen — tap to launch

### Native Features
- Runs offline for camera capture (photos queue, upload when back online)
- Uses iOS native camera (not browser camera) — better quality
- GPS-tags every photo automatically
- Push notifications (COI expiring, deal stale, proposal signed)

### Getting New Builds
When we ship a new feature:
1. Codemagic auto-builds a new IPA
2. TestFlight app shows "UPDATE" button
3. Tap Update → 30 sec → new version installed

### PWA (Progressive Web App) Alternative
If you don't want TestFlight:
- Open Safari → `roofing-crm-3.preview.emergentagent.com`
- Share button → **"Add to Home Screen"**
- Behaves like a native app (home-screen icon, fullscreen, offline capable)
- Same features as native app EXCEPT no push notifications

---

<a name="quick-reference"></a>
## 11. Quick Reference — Common Workflows

### 🚗 Field Rep: "I just left a site visit"
1. Open **Finish Site Visit** in sidebar
2. Tap "Damage Documentation" chip on the deal card (or "After" if it was a completion visit)
3. Tap **"Send Condition Report"** → confirm recipient → Send
4. Done in under 60 seconds.

### 📝 Sales Rep: "I need a proposal for a new lead"
1. **Contacts** → +Add → enter name & email
2. **Properties** → +Add → link to that contact
3. **Deals** → +Add → link property, set value
4. Go to deal → **Documents → Assessment** (auto-generates from any photos)
5. **Calculator** → build the coating spec → Save to Deal
6. **Documents → Proposal** → download PDF or share the public sign-off link

### 🏗 Foreman: "I need to send a subcontractor a work order"
1. Open deal → **Documents → Work Order**
2. Fill in scope + payment terms → Save
3. Copy the public signing link (`/wo/{token}`)
4. Text or email link to sub
5. Once sub signs, WO status flips to "Signed" and deal history logs it

### 💰 Accountant: "I need to close the month"
1. **Books → Period Close**
2. Click "Preview" for the month → review balances
3. If clean → click "Close Period"
4. **Books → Reports → Balance Sheet & Income Statement** → download for records

### 🖼 Admin: "Someone deleted a photo by mistake"
1. **Sidebar → Trash**
2. Filter by "Photos" and search by date
3. Find the photo → click **Restore**
4. Photo reappears on the original deal

---

## 12. Feature Status Summary

| Feature | Status |
|---------|--------|
| Auth (JWT email/password) | ✅ Shipped |
| Contacts / Properties / Deals CRUD | ✅ Shipped |
| Deals Kanban | ✅ Shipped |
| Field Camera + Object Storage | ✅ Shipped |
| PDF Generator (Assessment, Scope, Proposal, WO, CO) | ✅ Shipped |
| **Photo Annotations (arrows/circles/text)** | ✅ Shipped |
| **Voice-to-text photo captions (Whisper)** | ✅ Shipped |
| **Before/After photo pairs (with slider)** | ✅ Shipped |
| **Condition Report PDF + Email to Client** | ✅ Shipped |
| **Finish Site Visit wrap-up screen** | ✅ Shipped |
| **Photo grid 10× speedup (thumbnails)** | ✅ Shipped |
| Photo Timeline (cross-project) | ✅ Shipped |
| Calculator (Western Colloid + Everest Silicone) | ✅ Shipped |
| Public Proposal / WO sign-off | ✅ Shipped |
| Gmail integration (email PDFs) | ✅ Shipped |
| Google Calendar sync | ✅ Shipped |
| Books / COA / Inter-Co Bank / Period Close | ✅ Shipped |
| COI Reminders | ✅ Shipped |
| Compliance Tracking | ✅ Shipped |
| Admin Trash (soft-delete) | ✅ Shipped |
| PWA install prompt | ✅ Shipped |
| Native iOS app (Capacitor + Codemagic CI/CD) | ✅ Shipped |
| AI auto-tag (Claude vision) | 🟡 P1 backlog |
| Curated client-share gallery links | 🟡 P1 backlog |
| Commission Module | 🟡 P1 backlog |
| Weekly digest email | 🟡 P2 backlog |
| Stripe online payments | 🔴 P3 (blocked on bank setup) |

---

## 13. Support & Troubleshooting

### App won't load / login fails
1. Web app: hard refresh (Ctrl+Shift+R or Cmd+Shift+R)
2. iOS app: force-quit and reopen
3. If still broken: contact admin — likely a backend restart is needed

### Photo won't upload
- Check phone is online
- Photo may still be queued — check the iOS app for pending items
- Force-quit + reopen the app if queue is stuck

### Codemagic build fails
- See `NATIVE_APP_SETUP.md` for the certificate rotation procedure
- Persistent private key is stored in Codemagic env var `IOS_DIST_PRIVATE_KEY` (Secure)
- Cert cap issues are auto-handled in the current yaml

### Voice captions returning empty text
- iPhone: Settings → SealTech CRM → toggle Microphone ON
- Chrome: click the mic icon in the URL bar → Allow

### Email report not arriving
- Check recipient's spam folder first
- Gmail from-address must be in `email_routing` config (Sidebar → Integrations → Email Routing)
- Check backend logs for SMTP auth errors (contact admin)

---

## Contact

**SealTech Building Solutions**
- Web: https://sealtechsolutions.co
- Phone: 720-715-9955
- Owner: Darren Oliver — `darren@sealtechsolutions.co`

*Built on Emergent Labs • React + FastAPI + MongoDB + Capacitor 7 + Codemagic*
