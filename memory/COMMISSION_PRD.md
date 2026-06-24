# Commission Module — Product Requirements Document
**SealTech Building Solutions CRM**
**Status: Draft for Darren's review — not yet implemented**
**Last updated:** June 24, 2026

---

## 1. The one-sentence pitch

A simple, defensible way to track how much commission each sales rep has earned, when it's owed, and when it's paid — driven automatically from invoices the customer has actually paid, so we never owe commission on money we haven't collected.

---

## 2. Why we need this

**Today** there's no commission tracking anywhere in the CRM. Sara's deals close, the cash comes in, and Darren has to mentally (or on a spreadsheet) figure out who's owed what for the month. That's:

- **Slow** — every month-end is 2–3 hours of manual reconciliation
- **Error-prone** — easy to miss a deposit invoice or pay commission twice
- **Opaque to the reps** — Sara can't see "I'm owed $X right now" without asking, which kills motivation and trust

**Tomorrow** the reps log in, click "My Commissions," see a live running total of what they've earned this month, see what's already been paid out, see what's pending collection — and a monthly statement gets auto-generated for them to e-sign before payout.

---

## 3. Goals

- ✅ Commission is **accrued on collected revenue**, not invoiced revenue (we only pay reps on money in the bank)
- ✅ Each rep has a configurable **commission rate** set by an admin
- ✅ Reps see their **own dashboard tile** — "This month: $X earned, $Y paid, $Z pending"
- ✅ Admin sees a **company-wide commission ledger** — who's owed, who's been paid, what's outstanding
- ✅ **Monthly statement PDF** per rep, exportable, e-signable, auditable
- ✅ Commission **payout entry** flows into the existing Payables module so cash-out is a single workflow
- ✅ Once a statement is signed and paid, the period is **locked** — no retroactive changes

### Non-goals (Phase 1)

- ❌ Splits between multiple reps on one deal (e.g. lead-gen rep + closer rep)
  → Add in Phase 2 if needed; ~95 % of SealTech deals today are single-rep
- ❌ Tiered or commission-by-product (e.g. higher % on Silicone than TPO)
  → Phase 2; flat % is simpler and matches current pay structure
- ❌ Clawbacks on refunded invoices
  → Phase 2; edge case for now, manually adjust if it happens
- ❌ Manager overrides / team-based commissions (e.g. sales manager gets 1% of all team revenue)
  → Phase 3 if SealTech ever has a sales manager
- ❌ 1099 tax form generation
  → Use QuickBooks or a tax tool; not the CRM's job

---

## 4. User stories

### Sara (sales rep, role = `sales`)
- *As a rep,* I want to see my running commission total for the month on my Dashboard
- *As a rep,* I want to see exactly which invoices contributed to that total and how much each one earned me
- *As a rep,* I want to receive an email when my monthly statement is ready to review
- *As a rep,* I want to e-sign the statement to confirm the amount before payout
- *As a rep,* I want to see my historical statements (last 12 months) so I can verify pay records

### Darren (admin, role = `admin`)
- *As an admin,* I want to set each rep's commission rate (e.g. Sara = 7 %, Pat = 5 %)
- *As an admin,* I want to see a company-wide commission report — "Open commissions: $X across N reps"
- *As an admin,* I want to generate everyone's monthly statement with one click on the last day of the month
- *As an admin,* I want statements to auto-route into Payables as a "Bill" so I pay reps the same way I pay subs
- *As an admin,* I want to lock a closed month so historical statements don't drift if an invoice is edited later
- *As an admin,* I want an audit log of every commission accrual change (who, what, when, why)

### Emma (manager, role = `manager`)
- *As a manager,* I want to see my own commission earnings (if I'm assigned to deals)
- *As a manager,* I want to see the team's open commission liability for cash-flow planning
- *As a manager,* I don't need to approve commissions — that's an admin job

---

## 5. Data model

### New collection: `commission_rates`
Stored per user. One row per user that's eligible for commission.
```json
{
  "id": "uuid",
  "user_id": "ebd982cb-...",
  "rate_pct": 7.0,
  "effective_from": "2026-01-01",        // ISO date — rate change history kept by inserting new rows
  "notes": "Bumped from 5% to 7% after promotion",
  "created_by": "darren-id",
  "created_at": "2026-06-24T..."
}
```
Reading the "current rate" for a user = `SELECT TOP 1 ... WHERE user_id = X AND effective_from <= today ORDER BY effective_from DESC`. Rate changes are non-destructive — historical statements use the rate in effect on the **invoice collection date**, not today's rate.

### New collection: `commission_accruals`
One row per **invoice payment event**. This is the atomic unit of commission.
```json
{
  "id": "uuid",
  "user_id": "sara-id",
  "deal_id": "...",
  "invoice_id": "...",
  "payment_event_id": "...",          // ties back to the actual ACH/check/CC payment
  "invoice_amount_collected": 5000.00,
  "rate_pct_at_time": 7.0,
  "commission_amount": 350.00,
  "accrued_at": "2026-06-20T...",     // when the payment was received → same as payment_event.received_at
  "status": "open" | "statemented" | "paid" | "voided",
  "statement_id": "uuid-or-null",     // null until rolled into a monthly statement
  "voided_at": null,
  "voided_reason": null,
  "created_at": "..."
}
```

### New collection: `commission_statements`
One row per rep per month (typical) or per ad-hoc period.
```json
{
  "id": "uuid",
  "user_id": "sara-id",
  "period_label": "June 2026",
  "period_start": "2026-06-01",
  "period_end": "2026-06-30",
  "accrual_ids": ["a1", "a2", "a3", ...],
  "total_commission": 1450.00,
  "status": "draft" | "sent" | "signed" | "paid" | "locked",
  "signed_at": null,
  "signed_signature": null,           // {text, font, signed_at} — same shape as scope signatures
  "payable_id": null,                 // Links to the Payables row once payout is recorded
  "pdf_storage_path": null,           // Cached PDF after generation
  "created_at": "...",
  "created_by": "darren-id"
}
```

### Reads from existing collections (no schema change needed)
- `deals.assigned_to_user_id` → tells us which rep gets credit for each deal
- `invoices` → tells us what was billed
- `payment_events` (or whatever the existing payments collection is called) → tells us what's been collected

---

## 6. The workflow

### A. Setup (one-time, admin)
1. Admin opens Settings → Commissions
2. For each active user, sets a `rate_pct` (e.g. Sara 7 %, Pat 5 %, Emma 0 %)
3. Saves → creates `commission_rates` rows
4. Admin sees a banner: "Commission tracking is now active. Earlier invoices will not retroactively accrue — only payments received from today forward."

### B. Accrual (automatic, on every payment)
1. Customer pays an invoice (manual entry by admin, or via Stripe/ACH when that ships)
2. The existing payment-recording endpoint fires
3. **NEW** post-save hook:
   - Look up `invoice.deal_id` → `deal.assigned_to_user_id` → the rep
   - If rep has a `commission_rates` row, compute `payment_amount × rate_pct` = commission
   - Insert a `commission_accruals` row with `status: "open"`
4. Sara's "This Month" tile on the Dashboard updates in real time

### C. Statement generation (monthly, admin-triggered)
1. On the 1st of each month (or any day), Darren clicks "Generate Statements" in the Commissions admin
2. For each rep with `open` accruals in the prior month:
   - Bundle all accruals → create one `commission_statements` row
   - Mark all those accruals `status: "statemented"`, `statement_id` = new id
   - Render a PDF (same look-and-feel as Invoices/Statements of Account)
   - Email it to the rep with a public sign link (same flow as Scope and Work Order)
   - Auto-create a draft Payable in the Payables module so Darren can pay it with one click

### D. Rep signs the statement
1. Sara opens the email → public link
2. Sees: project list, amounts, commission per project, grand total
3. Types name → picks script signature → clicks Sign
4. Statement `status: "signed"`, `signed_signature` stored
5. Darren gets a notification ("Sara signed her June statement, $1,450")
6. Payable row stays Draft until Darren actually pays it

### E. Payout
1. Darren goes to Payables → finds the rep statement → clicks Pay
2. Records check/ACH details
3. Statement `status: "paid"`
4. All linked accruals `status: "paid"`
5. The month is closeable

### F. Period lock
- Once all of a month's statements are `paid`, the admin can click "Lock period"
- Voids future edits to invoices in that period (can still edit, but it triggers a separate "commission adjustment" accrual rather than retroactively changing the original)
- Tightens the audit story for tax season

---

## 7. Edge cases & decisions

### Q: What if a customer pays in installments?
Each payment creates its own accrual. So a $10,000 deal paid 30 % deposit + 70 % final creates two accruals: one for $3,000 × rate %, one for $7,000 × rate %. Total commission lands the same.

### Q: What if a deal is reassigned mid-project?
**Default:** the rep who is currently assigned at the time of **the payment** gets the commission. Tracked via `commission_accruals.user_id` so reassignment after the payment doesn't retroactively shift credit.
**Edge:** if Darren wants to split credit between previous and current rep, he can manually `void` the auto-accrual and add two custom accruals. Phase 2: an admin-facing "Adjust Commission" tool.

### Q: What if an invoice is refunded?
**Phase 1:** manually create a negative-amount `commission_accruals` row (admin-only). It reduces the next statement.
**Phase 2:** automatic reversal hook when payment is voided.

### Q: What's the commission base — pre-tax or post-tax? Gross or net?
**Default (configurable):** **Pre-tax, gross invoice total**. Most contractor commission structures work this way. There's a `commission_basis` setting per rep (`gross` | `net_of_materials` | `net_profit`) for Phase 2 if Darren wants to switch.

### Q: Do salaried roles like Office Admin get commissions?
**No** — leave their `commission_rates` row absent or set `rate_pct = 0`. The accrual logic only fires when a non-zero rate is found.

### Q: Can a rep dispute the statement?
**Phase 1:** if they don't sign, the statement stays "sent" status. Darren can manually mark it disputed, regenerate, and resend.
**Phase 2:** an in-app "Dispute" button that opens a comment thread.

### Q: How does this interact with the existing "Books Period Close" feature?
The commission period close happens AFTER the books close. Sequence:
1. Books close for June (you do this today)
2. Commission statements generate (pulls all paid invoices from the closed period)
3. Statements signed by reps
4. Payouts recorded
5. Commission period locked

### Q: Tax treatment?
Out of scope. Reps marked as W2 employees get commission via payroll (the CRM doesn't run payroll). Reps marked as 1099 contractors → commission shows up on their year-end 1099. The CRM exports a CSV the bookkeeper can hand to the tax prep tool.

---

## 8. UI changes

### Existing pages — small additions
- **Dashboard (sales rep view):** new "My Commissions" tile — "$1,450 earned · $0 paid · $1,450 pending"
- **Dashboard (admin view):** new "Open Commission Liability" KPI — total open accruals across all reps
- **User edit modal (Users page):** new "Commission Rate %" field (admin-only)
- **Invoice detail:** show "Commission to: Sara Oliver · $350.00" badge below the line items (read-only, audit only)
- **Deal detail:** small "Commission credited to: Sara" badge near the existing "Assigned Rep" badge

### New pages
- **`/commissions`** (admin) — company-wide ledger: open accruals, statements by status, payout history, lock-period button
- **`/commissions/mine`** (rep) — personal earnings dashboard, statement history, current-month detail
- **`/commissions/statements/:id`** (admin) — single-statement view with edit (only while Draft) + Send + Print actions
- **`/sign/commission/:token`** (public) — rep-facing sign page (mirrors `/sign/:token` for scope)

### New emails
- **Statement Ready** — sent to rep when a new statement is generated. Body: total amount + link to review/sign.
- **Statement Signed** — sent to admin when a rep signs. Body: rep name + amount + link to view.
- **Statement Paid** — sent to rep when admin marks the linked Payable as paid. Body: receipt detail.

All routed through the `finance@sealtechsolutions.co` alias.

---

## 9. Phased implementation plan

### Phase 1 — MVP (the version we'd actually build first)
**Scope:**
- `commission_rates` per user (flat %, admin-editable)
- Auto-accrual on every payment event
- Admin-triggered monthly statement generation (1 click per period)
- PDF statement (re-use the existing Statement of Account template)
- Email + public sign flow (re-use Work Order / Scope sign infrastructure)
- Payable auto-creation on statement-signed
- Rep dashboard tile + admin ledger page

**Effort estimate:** ~18–24 hours
- Backend (model + endpoints + accrual hook): ~8 h
- PDF generator: ~3 h
- Public sign page: ~2 h (re-uses the WO sign component pattern)
- Admin ledger UI: ~4 h
- Rep dashboard tile: ~2 h
- Tests + edge-case hardening: ~3 h

### Phase 2 — Sometime later
- Splits between multiple reps on a single deal
- Tiered commission (e.g. 5 % under $25K, 7 % over)
- Commission-by-product (Silicone % > TPO %)
- Auto-reverse on invoice void
- In-app dispute thread
- Commission CSV export for 1099 prep

### Phase 3 — Far future
- Manager overrides ("Emma gets 1 % of all team revenue")
- Team-based commissions
- Commission forecasting based on pipeline

---

## 10. Open questions for Darren

These are the ones I'd want a clear answer on before writing any code:

1. **What's the default commission rate** — flat 5 % for everyone? Or different per rep from day 1?
2. **Is the commission base gross or net?** SealTech today seems to pay commission on the full invoice including materials cost. Confirming.
3. **Statement period — monthly or bi-weekly?** Most contractors do monthly. Confirming.
4. **Should the rep be required to sign the statement before payout?** Or can Darren pay immediately without sign? (Signing is a small friction; some shops skip it. Recommend keep it — it makes future disputes a non-issue.)
5. **Are commissions paid on the **deposit** invoice, the **final** invoice, or both?** Default I'd assume: both — every dollar collected accrues commission proportionally.
6. **Refund policy** — if a customer demands a refund and SealTech writes a check back, does the rep's commission reverse? Most shops say yes. Confirming.
7. **W2 vs 1099 reps** — does SealTech have any W2 sales people, or are all reps independent contractors? Affects whether commission flows out via payroll (W2) or as a vendor payment (1099). Phase 1 assumes 1099 / Payables route.
8. **Who else gets commission** — just sales reps, or also referral sources, finder's fees, lead-gen partners? If yes to any of those, we'd add a "Commission Recipient" record that's not necessarily a User of the system.
9. **Backfill?** When we launch, do we want to backfill commissions for invoices already collected in 2026, or start fresh from launch date forward? (Default: start fresh; backfill is risky and reps' expectations need to be set carefully.)

---

## 11. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Reps misunderstand the rules, expect more than the system pays | Show the live formula on every statement: "Collected: $X × 7% = $Y" — no black box |
| Bug in accrual logic underpays reps → trust damage | Manual override + audit log; admin can adjust before statement send; lock only after sign-off |
| Bug in accrual logic overpays → cash impact on SealTech | Statement signing is the human check; admin reviews every statement before send (Phase 1) |
| Rate change mid-period creates ambiguity | Rate is captured **on the accrual** at time of payment; rate changes only affect future payments |
| Reassignment shifts credit unfairly | Credit is locked at payment time (not at current deal-assignee time) — reassign all you want, history stays correct |
| Refunds create negative balances that wipe out a rep's whole month | Cap the auto-reversal at the rep's open balance for the period; require admin sign-off for over-cap reversals |
| Tax audit asks how commission was computed | Per-payment audit row + immutable rate-history + signed statements = defensible paper trail |

---

## 12. Decision checkpoint

Before any code is written, Darren needs to answer the 9 questions in Section 10 + confirm:

- [ ] Approve the MVP scope as defined in Section 9 (Phase 1)
- [ ] Approve the data model in Section 5 (or request changes)
- [ ] Approve the workflow in Section 6 (especially: accrual-on-payment, statement-then-payout sequence)
- [ ] Approve the UI mock list in Section 8
- [ ] Confirm: build in SealTech only (skip WSC for now since it's a sunset)
- [ ] Confirm budget: ~18–24 hours of dev work

Once those are checked, this PRD becomes the build spec.

---

*— End of PRD. Sleep on it. Mark up anything that doesn't match how you actually want commissions to run. We can iterate on this doc before touching code.*
