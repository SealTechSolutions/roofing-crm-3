/**
 * ProjectLivePnL — the "Phase D" live project-level P&L card.
 *
 * Answers the user's #8 pain point verbatim: "Once the final invoice is
 * deposited, the financials should be able to tell me the project cost
 * broken out in labor, material, equipment, etc..."
 *
 * Shows, in real-time:
 *   - Revenue: contract total, received (paid milestones + paid invoices),
 *              outstanding (scheduled – received)
 *   - Costs by category:
 *       • Materials      (cost_items where category='Materials' + estimated
 *                          deal.materials_cost fallback)
 *       • Labor          (cost_items category='Labor' + deal.labor_cost)
 *       • Subcontractor  (cost_items category='Subcontractor' + deal.subcontractor_cost)
 *       • Equipment      (line for every deal.equipment_ordered entry —
 *                         qty × standard rate table; user can override in UI later)
 *       • Other          (cost_items category='Other' + deal.other_expenses)
 *   - Actual costs from vendor bills (linked line items)
 *   - Gross margin $ and %
 *
 * Because the underlying data is already loaded by the parent, this component
 * is purely computational — no API calls.
 */
import React from "react";
import { formatCurrency } from "@/lib/api";

const CATEGORIES = [
  { key: "Materials",     label: "Materials",     dealField: "materials_cost",       accent: "text-blue-700" },
  { key: "Labor",         label: "Labor",         dealField: "labor_cost",           accent: "text-indigo-700" },
  { key: "Subcontractor", label: "Subcontractor", dealField: "subcontractor_cost",   accent: "text-purple-700" },
  { key: "Equipment",     label: "Equipment",     dealField: null,                   accent: "text-orange-700" },
  { key: "Other",         label: "Other",         dealField: "other_expenses",       accent: "text-zinc-700" },
];

// Standard equipment rate estimates (user-editable later; hard-coded rates for
// MVP so the P&L has real numbers as soon as equipment is checked off).
const EQUIPMENT_STD_COST = {
  "Storage Container": 250,
  "Porta-Potty":       125,
  "Forklift":          1200,
  "Manlift":           1400,
  "Dumpster":          650,
  "Scaffolding":       800,
};

const Bar = ({ label, amount, total, accent, right }) => {
  const pct = total > 0 ? Math.min(100, (amount / total) * 100) : 0;
  return (
    <div className="mb-2 last:mb-0">
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="font-bold uppercase tracking-wider text-zinc-700">{label}</span>
        <span className={`font-mono font-bold ${accent}`}>{formatCurrency(amount)} {right && <span className="text-[10px] font-normal text-zinc-500">· {right}</span>}</span>
      </div>
      <div className="h-1.5 bg-zinc-100 rounded-sm overflow-hidden">
        <div
          className={`h-full ${accent.replace("text-", "bg-")}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
};

const StatBox = ({ label, value, hint, accent, testId }) => (
  <div className="border border-zinc-200 rounded-sm p-4 bg-white" data-testid={testId}>
    <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-500 mb-1">{label}</div>
    <div className={`font-heading font-black text-2xl tracking-tight leading-none ${accent || "text-zinc-950"}`}>{value}</div>
    {hint && <div className="text-[10px] text-zinc-500 mt-1">{hint}</div>}
  </div>
);

export default function ProjectLivePnL({ deal, dealInvoices, vendorBills }) {
  // --- REVENUE ---
  const contractTotal = Number(deal.chosen_amount || 0);
  const milestones = deal.payment_milestones || [];
  const milestonesReceived = milestones
    .filter((m) => m.status === "Paid")
    .reduce((s, m) => s + Number(m.amount || 0), 0);
  const invoicesReceived = (dealInvoices || [])
    .reduce((s, i) => s + Number(i.amount_paid || 0), 0);
  // Prefer invoice-tracked amount if any invoices exist, else fall back to
  // milestone-tracked payments so early-stage deals still show something.
  const received = (dealInvoices || []).length > 0 ? invoicesReceived : milestonesReceived;
  const outstanding = Math.max(0, contractTotal - received);

  // --- ESTIMATED COSTS BY CATEGORY (from cost_items + deal.*_cost) ---
  const costItems = deal.cost_items || [];
  const estByCategory = {};
  for (const cat of CATEGORIES) {
    // Cost items with this category
    const itemsSum = costItems
      .filter((ci) => (ci.category || "Materials") === cat.key)
      .reduce((s, ci) => s + Number(ci.amount || 0), 0);
    // Rolled-up estimate on the deal itself (fallback for legacy deals)
    const rolledUp = cat.dealField ? Number(deal[cat.dealField] || 0) : 0;
    // Use whichever is higher (they should agree once cost_items are populated,
    // but the rolled-up field survives on legacy deals with no cost_items)
    estByCategory[cat.key] = Math.max(itemsSum, rolledUp);
  }
  // Equipment estimate: sum of standard rates for each ordered item
  const equipmentOrdered = deal.equipment_ordered || [];
  const equipmentEst = equipmentOrdered.reduce(
    (s, e) => s + (EQUIPMENT_STD_COST[e.type] || 0), 0,
  );
  // Merge equipment into the estimate (cost_items may also carry equipment,
  // but we treat them as additive since equipment isn't in the CostItem enum)
  estByCategory.Equipment = Math.max(estByCategory.Equipment, equipmentEst);

  const estTotal = Object.values(estByCategory).reduce((s, v) => s + v, 0);

  // --- ACTUAL COSTS (from vendor bills linked to this project) ---
  let actualTotal = 0;
  for (const b of vendorBills || []) {
    const projectLines = (b.line_items || []).filter((li) => li.project_id === deal.id);
    actualTotal += projectLines.reduce((s, li) => s + Number(li.amount || 0), 0);
  }

  // --- PROFIT / MARGIN — use whichever cost figure is larger (safer view) ---
  const costForProfit = Math.max(estTotal, actualTotal);
  const grossProfit = contractTotal - costForProfit;
  const grossMargin = contractTotal > 0 ? (grossProfit / contractTotal) * 100 : 0;
  const profitAccent = grossProfit >= 0 ? "text-emerald-700" : "text-red-700";
  const marginAccent = grossMargin >= 15 ? "text-emerald-700" : grossMargin >= 5 ? "text-amber-700" : "text-red-700";

  const maxCategoryValue = Math.max(1, ...Object.values(estByCategory));

  return (
    <div className="bg-white border border-zinc-200 rounded-sm p-5 mb-8" data-testid="project-live-pnl">
      <div className="flex items-start justify-between mb-4 gap-3 flex-wrap">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-blue-700 mb-1">Live Project P&amp;L</div>
          <h3 className="font-heading text-lg font-bold tracking-tight">Real-time labor, material, equipment & sub breakdown</h3>
          <div className="text-xs text-zinc-500 mt-0.5">Estimates from cost items + take-off. Actuals from vendor bills linked to this project.</div>
        </div>
      </div>

      {/* Top-line stat grid: Revenue / Cost / Profit / Margin */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatBox
          label="Contract Revenue"
          value={formatCurrency(contractTotal)}
          hint={`${formatCurrency(received)} received · ${formatCurrency(outstanding)} outstanding`}
          testId="pnl-revenue"
        />
        <StatBox
          label="Estimated Cost"
          value={formatCurrency(estTotal)}
          hint={actualTotal > 0 ? `Actual so far: ${formatCurrency(actualTotal)}` : "No vendor bills yet"}
          testId="pnl-est-cost"
        />
        <StatBox
          label="Gross Profit"
          value={formatCurrency(grossProfit)}
          hint={`Based on ${actualTotal > estTotal ? "actual" : "estimated"} costs`}
          accent={profitAccent}
          testId="pnl-profit"
        />
        <StatBox
          label="Gross Margin"
          value={`${grossMargin.toFixed(1)}%`}
          hint={grossMargin >= 15 ? "Healthy" : grossMargin >= 5 ? "Thin" : "At risk"}
          accent={marginAccent}
          testId="pnl-margin"
        />
      </div>

      {/* Category breakdown bars */}
      <div className="border-t border-zinc-100 pt-4">
        <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-500 mb-3">Cost Breakdown by Category</div>
        {CATEGORIES.map((cat) => {
          const amount = estByCategory[cat.key] || 0;
          const pctOfCost = estTotal > 0 ? (amount / estTotal) * 100 : 0;
          return (
            <div key={cat.key} data-testid={`pnl-category-${cat.key.toLowerCase()}`}>
              <Bar
                label={cat.label}
                amount={amount}
                total={maxCategoryValue}
                accent={cat.accent}
                right={estTotal > 0 ? `${pctOfCost.toFixed(0)}% of cost` : ""}
              />
            </div>
          );
        })}
        {estTotal === 0 && (
          <div className="text-xs text-zinc-500 py-3 text-center italic">
            No cost estimates yet. Add materials, labor, or subcontractor costs on the &quot;Vendor Cost Line Items&quot; table below — or pull from the Calculator.
          </div>
        )}
      </div>

      {/* Equipment detail (only when equipment ordered) */}
      {equipmentOrdered.length > 0 && (
        <div className="border-t border-zinc-100 pt-4 mt-4" data-testid="pnl-equipment-detail">
          <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-500 mb-2">Equipment Rentals ({equipmentOrdered.length})</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
            {equipmentOrdered.map((e) => (
              <div key={e.type} className="flex items-center justify-between px-3 py-1.5 bg-orange-50 border border-orange-200 rounded-sm">
                <span className="font-bold text-orange-900">{e.type}</span>
                <span className="font-mono text-orange-700">
                  {EQUIPMENT_STD_COST[e.type] ? formatCurrency(EQUIPMENT_STD_COST[e.type]) : "—"}
                </span>
              </div>
            ))}
          </div>
          <div className="text-[10px] text-zinc-400 mt-2 italic">
            Standard rate estimates. Override with an actual amount by adding an &quot;Other&quot; cost item below.
          </div>
        </div>
      )}
    </div>
  );
}
