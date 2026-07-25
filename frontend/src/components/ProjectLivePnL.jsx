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
import React, { useEffect, useState } from "react";
import { api, formatCurrency } from "@/lib/api";
import { Pencil, Check, X } from "lucide-react";
import { toast } from "sonner";

const CATEGORIES = [
  { key: "Materials",     label: "Materials",     dealField: "materials_cost",       accent: "text-blue-700" },
  { key: "Labor",         label: "Labor",         dealField: "labor_cost",           accent: "text-indigo-700" },
  { key: "Subcontractor", label: "Subcontractor", dealField: "subcontractor_cost",   accent: "text-purple-700" },
  { key: "Equipment",     label: "Equipment",     dealField: null,                   accent: "text-orange-700" },
  { key: "Other",         label: "Other",         dealField: "other_expenses",       accent: "text-zinc-700" },
];

// Baseline fallback rates used until the /settings/equipment-rates payload
// arrives (or if it fails to load). The admin settings page overrides these.
const FALLBACK_EQUIPMENT_RATES = {
  "Storage Container": 250,
  "Porta-Potty":       125,
  "Forklift":          1200,
  "Manlift":           1400,
  "Dumpster":          650,
  "Scaffolding":       800,
};

const Bar = ({ label, amount, total, accent, right, dealField, onEdit }) => {
  const pct = total > 0 ? Math.min(100, (amount / total) * 100) : 0;
  const editable = !!(dealField && onEdit);
  return (
    <div className="mb-2 last:mb-0">
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="font-bold uppercase tracking-wider text-zinc-700">{label}</span>
        {editable ? (
          <button
            onClick={onEdit}
            data-testid={`pnl-edit-${label.toLowerCase()}`}
            className="group inline-flex items-center gap-1.5 px-2 h-7 rounded-sm border border-transparent hover:border-blue-300 hover:bg-blue-50 transition-colors cursor-text"
            title={`Click to type a ${label} estimate`}
          >
            <span className={`font-mono font-bold ${accent} group-hover:text-blue-800`}>{formatCurrency(amount)}</span>
            {right && <span className="text-[10px] font-normal text-zinc-500">· {right}</span>}
            <Pencil className="w-3.5 h-3.5 text-blue-600 group-hover:text-blue-800" />
            <span className="text-[9px] font-bold uppercase tracking-wider text-blue-600 group-hover:text-blue-800 hidden sm:inline">Edit</span>
          </button>
        ) : (
          <span className="inline-flex items-center gap-1.5">
            <span className={`font-mono font-bold ${accent}`}>{formatCurrency(amount)}</span>
            {right && <span className="text-[10px] font-normal text-zinc-500">· {right}</span>}
          </span>
        )}
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

const EditableRow = ({ label, initialValue, accent, dealField, onCancel, onSave }) => {
  const [val, setVal] = useState(String(initialValue || ""));
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    setSaving(true);
    try {
      await onSave(dealField, Number(val) || 0);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="mb-2 last:mb-0" data-testid={`pnl-editor-${label.toLowerCase()}`}>
      <div className="flex items-center justify-between gap-2 text-xs mb-1">
        <span className={`font-bold uppercase tracking-wider ${accent}`}>{label}</span>
        <div className="flex items-center gap-1.5">
          <span className="text-zinc-500 font-mono text-[11px]">$</span>
          <input
            type="number"
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") onCancel(); }}
            data-testid={`pnl-input-${label.toLowerCase()}`}
            autoFocus
            className="w-28 border border-blue-500 px-2 h-7 text-xs font-mono text-right rounded-sm focus:outline-none"
          />
          <button
            onClick={submit}
            disabled={saving}
            data-testid={`pnl-save-${label.toLowerCase()}`}
            className="p-1 rounded-sm text-emerald-700 hover:bg-emerald-50 disabled:opacity-40"
            title="Save"
          >
            <Check className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onCancel}
            data-testid={`pnl-cancel-${label.toLowerCase()}`}
            className="p-1 rounded-sm text-zinc-500 hover:bg-zinc-100"
            title="Cancel"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
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

export default function ProjectLivePnL({ deal, dealInvoices, vendorBills, onSave }) {
  // --- Fetch admin-editable equipment rates once on mount ---
  const [equipmentRates, setEquipmentRates] = useState(FALLBACK_EQUIPMENT_RATES);
  const [editingField, setEditingField] = useState(null); // 'materials_cost' | 'labor_cost' | ...
  useEffect(() => {
    let cancelled = false;
    api.get("/settings/equipment-rates")
      .then((r) => {
        if (cancelled) return;
        if (r.data?.rates) setEquipmentRates(r.data.rates);
      })
      .catch(() => { /* fallback stays */ });
    return () => { cancelled = true; };
  }, []);

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

  // --- CLIENT-SIDE BACK-SOLVE for legacy deals ---
  // If the deal was priced BEFORE we started persisting materials_cost /
  // subcontractor_cost on Set-Option, both stay $0 forever. Back-solve them
  // from the scope math the Calculator already ran so the P&L reflects real
  // numbers without forcing the rep to open the Calculator again.
  //
  // Working backward from the customer price:
  //     customer = (materials + handling + labor) × (1 + oh/100) × (1 + profit/100)
  //     where handling ≈ 12% of materials, so materials × 1.12 + labor = customer / [oh · profit]
  //
  // We only back-solve when BOTH Materials and Subcontractor slots are still
  // $0 (no other data present) — never overrides real numbers already
  // pushed from the Calculator or a linked vendor bill.
  const WARRANTY_FIELDS = [
    { yr: 25, opt: "proposal_option_25yr", labor: "labor_25yr_add", oh: "overhead_25yr_pct", pr: "profit_25yr_pct", war: "warranty_25yr_add", hail: "hail_rider_25yr_add" },
    { yr: 20, opt: "proposal_option_1",    labor: "labor_20yr_add", oh: "overhead_20yr_pct", pr: "profit_20yr_pct", war: "warranty_20yr_add", hail: "hail_rider_20yr_add" },
    { yr: 15, opt: "proposal_option_2",    labor: "labor_15yr_add", oh: "overhead_15yr_pct", pr: "profit_15yr_pct", war: "warranty_15yr_add", hail: "" },
    { yr: 10, opt: "proposal_option_3",    labor: "labor_10yr_add", oh: "overhead_10yr_pct", pr: "profit_10yr_pct", war: "warranty_10yr_add", hail: "" },
  ];
  const noMatEst = (estByCategory.Materials || 0) <= 0;
  const noSubEst = (estByCategory.Subcontractor || 0) <= 0;
  if (contractTotal > 0 && (noMatEst || noSubEst)) {
    // Fuzzy-match chosen_amount to the closest proposal option (20% tolerance,
    // covers hail-rider / NDL upgrades that inflate the signed total).
    let best = null;
    for (const w of WARRANTY_FIELDS) {
      const price = Number(deal[w.opt] || 0);
      if (price <= 0) continue;
      const diffPct = Math.abs(price - contractTotal) / contractTotal;
      if (best === null || diffPct < best.diffPct) best = { w, diffPct, price };
    }
    if (best && best.diffPct <= 0.20) {
      const w = best.w;
      const ohPct = Number(deal[w.oh] ?? 20);
      const prPct = Number(deal[w.pr] ?? 30);
      const laborAdd = Number(deal[w.labor] || 0);
      const warAdd = Number(deal[w.war] || 0);
      const hailAdd = w.hail ? Number(deal[w.hail] || 0) : 0;
      // Strip any add-ons (hail-rider / NDL upgrade) — Set-Option writes them
      // ABOVE the base proposal price, so back-solving without stripping them
      // over-estimates cost.
      const base = Math.max(0, contractTotal - hailAdd - warAdd);
      const mult = (1 + ohPct / 100) * (1 + prPct / 100);
      const subtotal = mult > 0 ? base / mult : 0;
      // subtotal ≈ (materials × 1.12) + laborAdd  →  materials ≈ (subtotal − labor) / 1.12
      const matPlusHandling = Math.max(0, subtotal - laborAdd);
      const matEst = Math.round(matPlusHandling / 1.12);
      if (noMatEst && matEst > 0) estByCategory.Materials = matEst;
      if (noSubEst && laborAdd > 0) estByCategory.Subcontractor = Math.round(laborAdd);
    }
  }

  // Equipment estimate: sum of standard rates for each ordered item
  const equipmentOrdered = deal.equipment_ordered || [];
  const equipmentEst = equipmentOrdered.reduce(
    (s, e) => s + (Number(equipmentRates[e.type]) || 0), 0,
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
        <div className="flex items-center justify-between mb-3">
          <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-500">Cost Breakdown by Category</div>
          {onSave && (
            <div className="text-[11px] text-blue-700 font-bold flex items-center gap-1">
              <Pencil className="w-3.5 h-3.5" /> Click any row&apos;s <span className="font-mono">$ amount</span> to type an estimate
            </div>
          )}
        </div>
        {CATEGORIES.map((cat) => {
          const amount = estByCategory[cat.key] || 0;
          const pctOfCost = estTotal > 0 ? (amount / estTotal) * 100 : 0;
          const isEditing = editingField === cat.dealField && cat.dealField;
          const saveHandler = async (field, val) => {
            try {
              await onSave({ [field]: Math.round(val * 100) / 100 });
              toast.success(`${cat.label} estimate saved`);
              setEditingField(null);
            } catch (e) {
              toast.error(e?.response?.data?.detail || "Save failed");
            }
          };
          return (
            <div key={cat.key} data-testid={`pnl-category-${cat.key.toLowerCase()}`}>
              {isEditing ? (
                <EditableRow
                  label={cat.label}
                  initialValue={Number(deal[cat.dealField] || 0)}
                  accent={cat.accent}
                  dealField={cat.dealField}
                  onCancel={() => setEditingField(null)}
                  onSave={saveHandler}
                />
              ) : (
                <Bar
                  label={cat.label}
                  amount={amount}
                  total={maxCategoryValue}
                  accent={cat.accent}
                  right={estTotal > 0 ? `${pctOfCost.toFixed(0)}% of cost` : ""}
                  dealField={onSave ? cat.dealField : null}
                  onEdit={() => setEditingField(cat.dealField)}
                />
              )}
            </div>
          );
        })}
        {estTotal === 0 && (
          <div className="text-xs text-zinc-500 py-3 text-center italic">
            No cost estimates yet. Click any pencil above to type an estimate, add items on the &quot;Vendor Cost Line Items&quot; table below, or push materials from the Calculator.
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
                  {equipmentRates[e.type] != null ? formatCurrency(equipmentRates[e.type]) : "—"}
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
