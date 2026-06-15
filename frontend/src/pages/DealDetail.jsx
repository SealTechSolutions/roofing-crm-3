import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { api, formatCurrency, formatApiError, API } from "@/lib/api";
import { ArrowLeft, Plus, Trash2, FileText, Star, Download, Printer, Mail, Wrench, FilePlus, ClipboardCheck } from "lucide-react";
import { toast } from "sonner";
import { StatusPill } from "@/pages/Dashboard";
import Documents from "@/components/Documents";
import MaterialTakeoff from "@/components/MaterialTakeoff";
import { ScopePreview } from "@/pages/Deals";
import { formatPhoneDisplay } from "@/lib/format";
import ProjectPhotos from "@/components/ProjectPhotos";

export default function DealDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [deal, setDeal] = useState(null);
  const [contact, setContact] = useState(null);
  const [property, setProperty] = useState(null);
  const [vendors, setVendors] = useState([]);
  const [options, setOptions] = useState({});
  const [saving, setSaving] = useState(false);
  const [vendorBills, setVendorBills] = useState([]);  // actual bills linked to this project
  const [emailScopeOpen, setEmailScopeOpen] = useState(false);

  const reload = async () => {
    const r = await api.get(`/deals/${id}`);
    setDeal(r.data);
    if (r.data.contact_id) {
      try { const c = await api.get(`/contacts/${r.data.contact_id}`); setContact(c.data); } catch { setContact(null); }
    } else setContact(null);
    if (r.data.property_id) {
      try { const p = await api.get(`/properties/${r.data.property_id}`); setProperty(p.data); } catch { setProperty(null); }
    } else setProperty(null);
  };

  useEffect(() => {
    reload().catch(() => nav("/projects"));
    api.get("/vendors").then((r) => setVendors(r.data));
    api.get("/options").then((r) => setOptions(r.data));
    api.get(`/vendor-bills?project_id=${id}`).then((r) => setVendorBills(r.data)).catch(() => setVendorBills([]));
  }, [id]);

  const totals = useMemo(() => {
    if (!deal) return { revenue: 0, costs: 0, profit: 0, margin: 0, scheduled: 0, received: 0, outstanding: 0, paidCosts: 0, pendingCosts: 0, actualCosts: 0, actualPaid: 0, actualUnpaid: 0, actualProfit: 0, actualMargin: 0 };
    const revenue = Number(deal.chosen_amount || 0);
    const items = deal.cost_items || [];
    const costs = items.reduce((s, i) => s + Number(i.amount || 0), 0);
    const paidCosts = items.filter((i) => i.status === "Paid").reduce((s, i) => s + Number(i.amount || 0), 0);
    const pendingCosts = costs - paidCosts;
    const milestones = deal.payment_milestones || [];
    const scheduled = milestones.reduce((s, m) => s + Number(m.amount || 0), 0);
    const received = milestones.filter((m) => m.status === "Paid").reduce((s, m) => s + Number(m.amount || 0), 0);
    const outstanding = scheduled - received;

    // Actual costs from vendor bills — sum line items where project_id matches this project
    let actualCosts = 0;
    let actualPaid = 0;
    let actualUnpaid = 0;
    for (const b of vendorBills) {
      const projectLines = (b.line_items || []).filter((li) => li.project_id === deal.id);
      const lineTotal = projectLines.reduce((s, li) => s + Number(li.amount || 0), 0);
      actualCosts += lineTotal;
      // Paid proportionally — bill paid_amount / total ratio × this project's share
      const billTotal = Number(b.total || 0);
      const paidRatio = billTotal > 0 ? Number(b.paid_amount || 0) / billTotal : 0;
      const paidShare = lineTotal * paidRatio;
      if (b.status === "Paid") {
        actualPaid += lineTotal;
      } else {
        actualPaid += paidShare;
        actualUnpaid += lineTotal - paidShare;
      }
    }
    const actualProfit = revenue - actualCosts;
    const actualMargin = revenue > 0 ? (actualProfit / revenue) * 100 : 0;

    return {
      revenue, costs, profit: revenue - costs,
      margin: revenue > 0 ? ((revenue - costs) / revenue) * 100 : 0,
      scheduled, received, outstanding, paidCosts, pendingCosts,
      actualCosts: Math.round(actualCosts * 100) / 100,
      actualPaid: Math.round(actualPaid * 100) / 100,
      actualUnpaid: Math.round(actualUnpaid * 100) / 100,
      actualProfit: Math.round(actualProfit * 100) / 100,
      actualMargin,
    };
  }, [deal, vendorBills]);

  const persist = async (patch) => {
    if (!deal) return;
    setSaving(true);
    try {
      const body = { ...deal, ...patch };
      // Strip server-managed + server-computed fields. Backend recomputes these
      // from cost_items / payment_milestones / proposal_options on PUT.
      ["id", "created_at", "updated_at", "created_by",
       "materials_cost", "labor_cost", "subcontractor_cost", "other_expenses_total",
       "total_costs", "profit", "margin_pct",
       "is_deleted", "deleted_at", "deleted_by",
       "assigned_user_name", "primary_contact_name", "property_name"
      ].forEach((k) => { delete body[k]; });
      const r = await api.put(`/deals/${id}`, body);
      setDeal(r.data);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setSaving(false);
    }
  };

  const applyTemplate = (key) => {
    const tpl = options.milestone_templates?.[key];
    if (!tpl) return;
    if ((deal.payment_milestones || []).length > 0 && !window.confirm("Replace existing milestones?")) return;
    const ms = tpl.map((t) => ({ label: t.label, percent: t.percent, status: "Pending", due_date: "", paid_date: "", notes: "" }));
    persist({ payment_milestones: ms });
  };

  const addMilestone = () => {
    const ms = [...(deal.payment_milestones || []), { label: "", percent: 0, status: "Pending", due_date: "", paid_date: "", notes: "" }];
    persist({ payment_milestones: ms });
  };

  const updateMilestone = (idx, patch) => {
    const ms = [...(deal.payment_milestones || [])];
    ms[idx] = { ...ms[idx], ...patch };
    persist({ payment_milestones: ms });
  };

  const removeMilestone = (idx) => {
    if (!window.confirm("Remove this milestone?")) return;
    const ms = [...(deal.payment_milestones || [])];
    ms.splice(idx, 1);
    persist({ payment_milestones: ms });
  };

  const addCostItem = () => {
    // Blur any in-progress cell edit so pending typed values commit BEFORE we
    // add a new row (otherwise the re-render wipes uncommitted input).
    if (document.activeElement && typeof document.activeElement.blur === "function") {
      document.activeElement.blur();
    }
    // Defer to the next microtask so the blur's onCommit handler runs first
    setTimeout(() => {
      const items = [...(deal?.cost_items || []), { category: "Materials", vendor_id: null, vendor_name: "", description: "", amount: 0, date: "", status: "Pending" }];
      persist({ cost_items: items });
    }, 0);
  };

  const updateCostItem = (idx, patch) => {
    const items = [...(deal.cost_items || [])];
    items[idx] = { ...items[idx], ...patch };
    persist({ cost_items: items });
  };

  const removeCostItem = (idx) => {
    if (!window.confirm("Remove this cost item?")) return;
    // Blur any active cell input so a pending typed value doesn't re-inject the
    // row we're about to delete (same root-cause class as the +Add bug).
    if (document.activeElement && typeof document.activeElement.blur === "function") {
      document.activeElement.blur();
    }
    setTimeout(() => {
      const items = [...(deal.cost_items || [])];
      items.splice(idx, 1);
      Promise.resolve(persist({ cost_items: items })).then(() => toast.success("Cost item removed"));
    }, 0);
  };

  // ----- Maintenance Plan handlers -----
  const [newVisit, setNewVisit] = useState({ visit_date: new Date().toISOString().slice(0, 10), amount: 0, subcontractor_id: "", notes: "" });
  const subcontractors = useMemo(() => vendors.filter((v) => v.kind === "Subcontractor"), [vendors]);

  const logVisit = async () => {
    if (!newVisit.visit_date) {
      toast.error("Visit date is required");
      return;
    }
    setSaving(true);
    try {
      const payload = { ...newVisit, amount: Number(newVisit.amount || 0) };
      if (!payload.subcontractor_id) delete payload.subcontractor_id;
      const r = await api.post(`/deals/${id}/maintenance-visits`, payload);
      setDeal(r.data);
      // Find newest visit
      const visits = r.data?.maintenance_visits || [];
      const newest = [...visits].sort((a, b) => (b.visit_date || "").localeCompare(a.visit_date || ""))[0];
      setNewVisit({ visit_date: new Date().toISOString().slice(0, 10), amount: Number(r.data.maintenance_rate || 0), subcontractor_id: "", notes: "" });
      toast.success("Visit logged — next due date advanced");
      if (newest && Number(payload.amount) > 0 && window.confirm(`Create a draft invoice for $${Number(payload.amount).toLocaleString()}?`)) {
        try {
          const inv = await api.post("/invoices/from-maintenance-visit", { deal_id: id, visit_id: newest.id });
          toast.success(`Draft invoice ${inv.data.invoice_number} created`);
        } catch (e) {
          toast.error("Visit logged, but invoice could not be auto-created");
        }
      }
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setSaving(false);
    }
  };

  const removeVisit = async (visitId) => {
    if (!window.confirm("Remove this visit? Next due date will recalculate.")) return;
    setSaving(true);
    try {
      const r = await api.delete(`/deals/${id}/maintenance-visits/${visitId}`);
      setDeal(r.data);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setSaving(false);
    }
  };

  // ----- Change Order handlers -----
  const [newCO, setNewCO] = useState({ description: "", amount: 0, date: new Date().toISOString().slice(0, 10), status: "Approved", notes: "" });

  const addChangeOrder = () => {
    if (!newCO.description.trim()) {
      toast.error("Description is required");
      return;
    }
    const co = { ...newCO, id: crypto.randomUUID(), amount: Number(newCO.amount || 0) };
    const list = [...(deal?.change_orders || []), co];
    persist({ change_orders: list });
    setNewCO({ description: "", amount: 0, date: new Date().toISOString().slice(0, 10), status: "Approved", notes: "" });
  };

  const removeChangeOrder = (coId) => {
    if (!window.confirm("Remove this change order?")) return;
    persist({ change_orders: (deal?.change_orders || []).filter((co) => co.id !== coId) });
  };

  const updateChangeOrder = (coId, patch) => {
    const list = (deal?.change_orders || []).map((co) => (co.id === coId ? { ...co, ...patch } : co));
    persist({ change_orders: list });
  };

  const changeOrderTotal = (deal?.change_orders || [])
    .filter((co) => (co.status || "Approved") === "Approved")
    .reduce((s, co) => s + Number(co.amount || 0), 0);

  if (!deal) return <div className="p-8 text-xs uppercase tracking-[0.2em] text-zinc-500">Loading...</div>;

  return (
    <div className="p-6 sm:p-8 animate-in fade-in duration-500" data-testid="deal-detail-page">
      <Link to="/projects" className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 hover:text-blue-700 mb-4" data-testid="back-to-deals">
        <ArrowLeft className="w-3 h-3" /> Back to Projects
      </Link>

      <div className="flex items-start justify-between mb-8 pb-6 border-b border-zinc-200 gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-3 mb-2 flex-wrap">
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-700">{deal.deal_type || "Scope"}</div>
            <StatusPill status={deal.status} />
            {saving && <div className="text-[10px] uppercase tracking-wider text-zinc-400">Saving...</div>}
          </div>
          <h1 className="font-heading text-3xl sm:text-4xl font-black tracking-tight" data-testid="deal-title">{deal.title}</h1>
          <div className="mt-2 text-xs uppercase tracking-wider text-zinc-500">{deal.lead_source} · {deal.project_type}</div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            data-testid="generate-spec-sheet"
            onClick={async () => {
              const token = localStorage.getItem("crm_token");
              try {
                toast.info("Generating spec sheet...");
                const r = await fetch(`${API}/deals/${id}/spec-sheet.pdf`, { headers: { Authorization: `Bearer ${token}` } });
                if (!r.ok) {
                  const txt = await r.text();
                  throw new Error(`Spec sheet failed (${r.status}): ${txt.slice(0,200)}`);
                }
                const blob = await r.blob();
                const url = URL.createObjectURL(blob);
                const newWin = window.open(url, "_blank");
                if (!newWin) {
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `sealtech-scope-${(deal.title || "project").replace(/\s+/g, "_")}.pdf`;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                }
                setTimeout(() => URL.revokeObjectURL(url), 60_000);
                toast.success("Spec sheet ready");
              } catch (e) {
                toast.error(e.message || "Could not generate spec sheet");
              }
            }}
            className="inline-flex items-center gap-2 bg-blue-700 text-white px-4 h-10 text-xs font-bold uppercase tracking-wider hover:bg-blue-800 rounded-sm transition-colors"
          >
            <Download className="w-4 h-4" /> View / Download
          </button>
          <button
            data-testid="print-spec-sheet"
            onClick={async () => {
              const token = localStorage.getItem("crm_token");
              try {
                toast.info("Preparing for print...");
                const r = await fetch(`${API}/deals/${id}/spec-sheet.pdf`, { headers: { Authorization: `Bearer ${token}` } });
                if (!r.ok) throw new Error(`Print failed (${r.status})`);
                const blob = await r.blob();
                const url = URL.createObjectURL(blob);
                const win = window.open(url, "_blank");
                if (!win) {
                  toast.error("Pop-up blocked. Allow pop-ups from this site to print directly.");
                } else {
                  // Try to auto-trigger print once the PDF loads
                  win.addEventListener("load", () => { try { win.print(); } catch (e) {} });
                  // Fallback: trigger print after 1.5s in case load doesn't fire for PDFs
                  setTimeout(() => { try { win.print(); } catch (e) {} }, 1500);
                }
                setTimeout(() => URL.revokeObjectURL(url), 60_000);
              } catch (e) {
                toast.error(e.message || "Could not print");
              }
            }}
            className="inline-flex items-center gap-2 bg-zinc-950 text-white px-4 h-10 text-xs font-bold uppercase tracking-wider hover:bg-zinc-800 rounded-sm transition-colors"
          >
            <Printer className="w-4 h-4" /> Print
          </button>
          <button
            data-testid="email-spec-sheet"
            onClick={() => setEmailScopeOpen(true)}
            className="inline-flex items-center gap-2 border border-zinc-300 text-zinc-700 px-4 h-10 text-xs font-bold uppercase tracking-wider hover:border-zinc-950 rounded-sm transition-colors"
          >
            <Mail className="w-4 h-4" /> Email to Prospect
          </button>
          <button
            data-testid="new-assessment-from-deal"
            onClick={async () => {
              try {
                const r = await api.post("/assessments", { deal_id: id });
                nav(`/assessments/${r.data.id}`);
              } catch (e) {
                toast.error(e?.response?.data?.detail || e.message);
              }
            }}
            className="inline-flex items-center gap-2 border border-blue-700 text-blue-700 px-4 h-10 text-xs font-bold uppercase tracking-wider hover:bg-blue-50 rounded-sm transition-colors"
          >
            <ClipboardCheck className="w-4 h-4" /> New Assessment
          </button>
        </div>
      </div>

      {/* Financials KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <KpiCard label="Revenue" value={formatCurrency(totals.revenue)} testId="kpi-revenue" />
        <KpiCard label="Total Costs" value={formatCurrency(totals.costs)} hint={`${formatCurrency(totals.paidCosts)} paid · ${formatCurrency(totals.pendingCosts)} pending`} testId="kpi-costs" />
        <KpiCard label="Net Profit" value={formatCurrency(totals.profit)} hint={`Margin ${totals.margin.toFixed(1)}%`} accent={totals.profit >= 0 ? "text-emerald-700" : "text-red-700"} testId="kpi-profit" />
        <KpiCard label="Outstanding" value={formatCurrency(totals.outstanding)} hint={`${formatCurrency(totals.received)} received of ${formatCurrency(totals.scheduled)}`} accent="text-orange-700" testId="kpi-outstanding" />
      </div>

      {/* Estimated vs Actual P&L */}
      <div className="bg-white border border-zinc-200 rounded-sm p-5 mb-8" data-testid="pnl-comparison">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-blue-700">P&amp;L Comparison</div>
            <h3 className="font-heading text-lg font-bold tracking-tight">Estimated vs Actual</h3>
          </div>
          <Link to={`/payables?project=${id}`} className="text-[10px] font-bold uppercase tracking-wider text-blue-700 hover:underline">
            View Vendor Bills ({vendorBills.length}) →
          </Link>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b-2 border-zinc-950 text-left text-[10px] uppercase tracking-wider">
              <th className="py-2"></th>
              <th className="py-2 text-right">Estimated (Cost Items)</th>
              <th className="py-2 text-right">Actual (Vendor Bills)</th>
              <th className="py-2 text-right">Variance</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-zinc-100">
              <td className="py-3 font-bold">Revenue</td>
              <td className="py-3 text-right font-mono">{formatCurrency(totals.revenue)}</td>
              <td className="py-3 text-right font-mono">{formatCurrency(totals.revenue)}</td>
              <td className="py-3 text-right font-mono text-zinc-400">—</td>
            </tr>
            <tr className="border-b border-zinc-100">
              <td className="py-3 font-bold">Costs</td>
              <td className="py-3 text-right font-mono">{formatCurrency(totals.costs)}</td>
              <td className="py-3 text-right font-mono">{formatCurrency(totals.actualCosts)}</td>
              <td className={`py-3 text-right font-mono font-bold ${totals.actualCosts > totals.costs ? "text-red-700" : "text-emerald-700"}`}>
                {totals.actualCosts > totals.costs ? "+" : ""}{formatCurrency(totals.actualCosts - totals.costs)}
              </td>
            </tr>
            <tr className="border-b-2 border-zinc-950 bg-zinc-50">
              <td className="py-3 font-bold">Net Profit</td>
              <td className={`py-3 text-right font-mono font-bold ${totals.profit >= 0 ? "text-emerald-700" : "text-red-700"}`}>{formatCurrency(totals.profit)}</td>
              <td className={`py-3 text-right font-mono font-bold ${totals.actualProfit >= 0 ? "text-emerald-700" : "text-red-700"}`}>{formatCurrency(totals.actualProfit)}</td>
              <td className={`py-3 text-right font-mono font-bold ${totals.actualProfit >= totals.profit ? "text-emerald-700" : "text-red-700"}`}>
                {totals.actualProfit >= totals.profit ? "+" : ""}{formatCurrency(totals.actualProfit - totals.profit)}
              </td>
            </tr>
            <tr>
              <td className="py-2 text-[11px] uppercase tracking-wider text-zinc-500">Margin</td>
              <td className="py-2 text-right font-mono text-[11px] text-zinc-600">{totals.margin.toFixed(1)}%</td>
              <td className="py-2 text-right font-mono text-[11px] text-zinc-600">{totals.actualMargin.toFixed(1)}%</td>
              <td className="py-2"></td>
            </tr>
          </tbody>
        </table>
        {vendorBills.length === 0 ? (
          <div className="mt-3 text-[11px] text-zinc-500 italic">No vendor bills attached to this project yet. Upload one on the Payables page and link a line item to this project to see actuals here.</div>
        ) : (
          <div className="mt-3 text-[11px] text-zinc-500">
            {vendorBills.length} bill{vendorBills.length > 1 ? "s" : ""} attached · {formatCurrency(totals.actualPaid)} paid · {formatCurrency(totals.actualUnpaid)} unpaid
          </div>
        )}
      </div>

      {/* Milestones */}
      <Card title="Payment Milestones" right={
        <div className="flex flex-wrap items-center gap-2">
          {Object.keys(options.milestone_templates || {}).map((k) => (
            <button key={k} data-testid={`milestone-template-${k.replace(/\//g, "-")}`} onClick={() => applyTemplate(k)} className="px-3 h-8 text-[10px] font-bold uppercase tracking-wider border border-zinc-300 hover:border-zinc-950 rounded-sm">
              {k}
            </button>
          ))}
          <button data-testid="add-milestone" onClick={addMilestone} className="inline-flex items-center gap-1 px-3 h-8 text-[10px] font-bold uppercase tracking-wider bg-blue-700 text-white hover:bg-blue-800 rounded-sm">
            <Plus className="w-3 h-3" /> Custom
          </button>
        </div>
      }>
        {(deal.payment_milestones || []).length === 0 ? (
          <div className="text-sm text-zinc-500 py-6 text-center">No milestones yet. Pick a template (50/50 or 50/25/25) or add custom.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="milestones-table">
              <thead>
                <tr className="border-b-2 border-zinc-950 text-left text-[10px] uppercase tracking-wider">
                  <th className="py-2 pr-3">Label</th>
                  <th className="py-2 pr-3 w-20 text-right">%</th>
                  <th className="py-2 pr-3 w-32 text-right">Amount</th>
                  <th className="py-2 pr-3 w-36">Due Date</th>
                  <th className="py-2 pr-3 w-36">Status</th>
                  <th className="py-2 pr-3 w-36">Paid Date</th>
                  <th className="py-2 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {deal.payment_milestones.map((m, i) => (
                  <tr key={m.id || i} className="border-b border-zinc-100" data-testid={`milestone-row-${i}`}>
                    <td className="py-2 pr-3">
                      <CellInput value={m.label} onCommit={(v) => updateMilestone(i, { label: v })} placeholder="Deposit / Mid-Job / Completion" data-testid={`milestone-label-${i}`} />
                    </td>
                    <td className="py-2 pr-3 text-right">
                      <CellInput type="number" step="5" min="0" max="100" value={m.percent} onCommit={(v) => updateMilestone(i, { percent: parseFloat(v || 0) })} className="text-right" data-testid={`milestone-percent-${i}`} />
                    </td>
                    <td className="py-2 pr-3 text-right font-mono">{formatCurrency(m.amount)}</td>
                    <td className="py-2 pr-3">
                      <CellInput type="date" value={m.due_date} onCommit={(v) => updateMilestone(i, { due_date: v })} data-testid={`milestone-due-${i}`} />
                    </td>
                    <td className="py-2 pr-3">
                      <CellSelect value={m.status} onCommit={(v) => updateMilestone(i, { status: v, paid_date: v === "Paid" && !m.paid_date ? new Date().toISOString().slice(0, 10) : m.paid_date })} options={options.milestone_statuses || ["Pending", "Invoiced", "Paid"]} data-testid={`milestone-status-${i}`} />
                    </td>
                    <td className="py-2 pr-3">
                      <CellInput type="date" value={m.paid_date} onCommit={(v) => updateMilestone(i, { paid_date: v })} disabled={m.status !== "Paid"} data-testid={`milestone-paid-${i}`} />
                    </td>
                    <td className="py-2 text-right">
                      <button onClick={() => removeMilestone(i)} className="p-1.5 hover:bg-red-100 text-red-700 rounded-sm" data-testid={`milestone-delete-${i}`}><Trash2 className="w-3.5 h-3.5" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-zinc-950">
                  <td className="py-2 pr-3 font-bold uppercase text-[10px] tracking-wider">Total Scheduled</td>
                  <td className="py-2 pr-3 text-right font-mono text-zinc-500 text-xs">{deal.payment_milestones.reduce((s, m) => s + Number(m.percent || 0), 0)}%</td>
                  <td className="py-2 pr-3 text-right font-mono font-bold">{formatCurrency(totals.scheduled)}</td>
                  <td colSpan={4}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      {/* Cost Items */}
      <Card title="Vendor Cost Line Items" right={
        <button data-testid="add-cost-item" onClick={addCostItem} className="inline-flex items-center gap-1 px-3 h-8 text-[10px] font-bold uppercase tracking-wider bg-blue-700 text-white hover:bg-blue-800 rounded-sm">
          <Plus className="w-3 h-3" /> Add Line
        </button>
      }>
        {(deal.cost_items || []).length === 0 ? (
          <div className="text-sm text-zinc-500 py-6 text-center">No cost items yet. Add materials, labor, or sub payments as they occur.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="cost-items-table">
              <thead>
                <tr className="border-b-2 border-zinc-950 text-left text-[10px] uppercase tracking-wider">
                  <th className="py-2 pr-3 w-32">Category</th>
                  <th className="py-2 pr-3 w-44">Vendor</th>
                  <th className="py-2 pr-3">Description</th>
                  <th className="py-2 pr-3 w-32 text-right">Amount</th>
                  <th className="py-2 pr-3 w-36">Date</th>
                  <th className="py-2 pr-3 w-28">Status</th>
                  <th className="py-2 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {deal.cost_items.map((c, i) => (
                  <tr key={c.id || i} className="border-b border-zinc-100" data-testid={`cost-row-${i}`}>
                    <td className="py-2 pr-3">
                      <CellSelect value={c.category} onCommit={(v) => updateCostItem(i, { category: v })} options={options.cost_categories || ["Materials", "Labor", "Subcontractor", "Other"]} data-testid={`cost-category-${i}`} />
                    </td>
                    <td className="py-2 pr-3">
                      <CellSelect
                        value={c.vendor_id || "__free__"}
                        onCommit={(v) => {
                          if (v === "__free__") return updateCostItem(i, { vendor_id: null });
                          const vendor = vendors.find((x) => x.id === v);
                          updateCostItem(i, { vendor_id: v, vendor_name: vendor?.name || "" });
                        }}
                        options={[{ value: "__free__", label: c.vendor_name || "— Pick / Custom —" }, ...vendors.map((v) => ({ value: v.id, label: v.name }))]}
                        data-testid={`cost-vendor-${i}`}
                      />
                      {!c.vendor_id && (
                        <CellInput value={c.vendor_name} onCommit={(v) => updateCostItem(i, { vendor_name: v })} placeholder="Vendor name" className="mt-1 text-xs" data-testid={`cost-vendor-name-${i}`} />
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      <CellInput value={c.description} onCommit={(v) => updateCostItem(i, { description: v })} placeholder="What was this for?" data-testid={`cost-description-${i}`} />
                    </td>
                    <td className="py-2 pr-3 text-right">
                      <CellInput type="number" value={c.amount} onCommit={(v) => updateCostItem(i, { amount: parseFloat(v || 0) })} className="text-right font-mono" data-testid={`cost-amount-${i}`} />
                    </td>
                    <td className="py-2 pr-3">
                      <CellInput type="date" value={c.date} onCommit={(v) => updateCostItem(i, { date: v })} data-testid={`cost-date-${i}`} />
                    </td>
                    <td className="py-2 pr-3">
                      <CellSelect value={c.status} onCommit={(v) => updateCostItem(i, { status: v })} options={options.cost_item_statuses || ["Pending", "Paid"]} data-testid={`cost-status-${i}`} />
                    </td>
                    <td className="py-2 text-right">
                      <button onClick={() => removeCostItem(i)} className="p-1.5 hover:bg-red-100 text-red-700 rounded-sm" data-testid={`cost-delete-${i}`}><Trash2 className="w-3.5 h-3.5" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-zinc-950">
                  <td className="py-2 pr-3 font-bold uppercase text-[10px] tracking-wider" colSpan={3}>Total Costs (auto-rolls into Dashboard)</td>
                  <td className="py-2 pr-3 text-right font-mono font-bold">{formatCurrency(totals.costs)}</td>
                  <td colSpan={3}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t border-zinc-100">
          <Mini label="Materials" value={formatCurrency(deal.materials_cost)} />
          <Mini label="Labor" value={formatCurrency(deal.labor_cost)} />
          <Mini label="Subcontractor" value={formatCurrency(deal.subcontractor_cost)} />
          <Mini label="Other" value={formatCurrency(deal.other_expenses)} />
        </div>
      </Card>

      {/* Pricing options + spec */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
        <Card title={(() => {
          const isConstruction = /^(construction project|other)$/i.test(deal.proposed_roof_type || "") || /other construction work/i.test(deal.current_roof_type || "");
          if (isConstruction) return "Project Price";
          return deal.deal_type === "Assessment" ? "Assessment Options" : "Pricing Options";
        })()}>
          {(() => {
            const isConstruction = /^(construction project|other)$/i.test(deal.proposed_roof_type || "") || /other construction work/i.test(deal.current_roof_type || "");
            if (isConstruction) {
              return (
                <Row label="Project Price" value={formatCurrency(deal.proposal_option_1)} bold highlight={Math.abs(totals.revenue - deal.proposal_option_1) < 0.01 && totals.revenue > 0} />
              );
            }
            return (
              <>
                {Number(deal.proposal_option_25yr || 0) > 0 && (
                  <Row label="Option A — 25-yr" value={formatCurrency(deal.proposal_option_25yr)} highlight={Math.abs(totals.revenue - deal.proposal_option_25yr) < 0.01 && totals.revenue > 0} />
                )}
                <Row label="Option B — 20-yr" value={formatCurrency(deal.proposal_option_1)} highlight={Math.abs(totals.revenue - deal.proposal_option_1) < 0.01 && totals.revenue > 0} />
                <Row label="Option C — 15-yr" value={formatCurrency(deal.proposal_option_2)} highlight={Math.abs(totals.revenue - deal.proposal_option_2) < 0.01 && totals.revenue > 0} />
                <Row label="Option D — 10-yr" value={formatCurrency(deal.proposal_option_3)} highlight={Math.abs(totals.revenue - deal.proposal_option_3) < 0.01 && totals.revenue > 0} />
              </>
            );
          })()}
          <div className="border-t-2 border-zinc-950 my-2" />
          <Row label="Chosen" value={formatCurrency(totals.revenue)} bold />
        </Card>

        <Card title="Roof Spec & Measurements">
          <Row label="Current Roof / Project" value={deal.current_roof_type} />
          <Row label="Proposed Roof / Project" value={deal.proposed_roof_type} bold />
          <div className="pl-1 pb-2">
            <ScopePreview currentRoof={deal.current_roof_type} proposedRoof={deal.proposed_roof_type} />
          </div>
          {(deal.construction_project_requirements || deal.construction_other_requirements || deal.construction_exclusions) && (
            <div id="construction-scope" className="border-t border-zinc-100 mt-2 pt-2 space-y-2" data-testid="deal-detail-construction-scope">
              {deal.project_type_override && (
                <Row label="Project Type (PDF)" value={deal.project_type_override} bold />
              )}
              {deal.construction_project_requirements && (
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-blue-700 mb-1">Project Requirements</div>
                  <pre className="whitespace-pre-wrap text-xs text-zinc-700 font-sans bg-zinc-50 p-2 border border-zinc-200 rounded-sm">{deal.construction_project_requirements}</pre>
                </div>
              )}
              {deal.construction_other_requirements && (
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-blue-700 mb-1">Other Requirements</div>
                  <pre className="whitespace-pre-wrap text-xs text-zinc-700 font-sans bg-zinc-50 p-2 border border-zinc-200 rounded-sm">{deal.construction_other_requirements}</pre>
                </div>
              )}
              {deal.construction_exclusions && (
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-blue-700 mb-1">Exclusions</div>
                  <pre className="whitespace-pre-wrap text-xs text-zinc-700 font-sans bg-zinc-50 p-2 border border-zinc-200 rounded-sm">{deal.construction_exclusions}</pre>
                </div>
              )}
            </div>
          )}
          {deal.custom_scope && !(deal.construction_project_requirements || deal.construction_other_requirements || deal.construction_exclusions) && (
            <div className="border-t border-zinc-100 mt-2 pt-2">
              <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-500 mb-1">Custom Scope (legacy free-form)</div>
              <pre className="whitespace-pre-wrap text-xs text-zinc-700 font-sans bg-zinc-50 p-2 border border-zinc-200 rounded-sm" data-testid="deal-detail-custom-scope">{deal.custom_scope}</pre>
            </div>
          )}
          <Row label="Project Type" value={deal.project_type} />
          <Row label="Lead Source" value={deal.lead_source} />
          {deal.lead_source === "Referral" && deal.referral_source && (
            <Row label="Referred By" value={deal.referral_source} />
          )}
          {deal.date_sent && <Row label="Date Sent" value={deal.date_sent} />}
          {deal.chosen_date && <Row label="Chosen Date" value={deal.chosen_date} />}
          {(deal.property_sqft || deal.perimeter_lnft || deal.avg_parapet_height) ? (
            <>
              <div className="border-t border-zinc-100 my-2" />
              <Row label="Property SqFt" value={deal.property_sqft ? Number(deal.property_sqft).toLocaleString() : "—"} />
              <Row label="Perimeter LnFt" value={deal.perimeter_lnft ? Number(deal.perimeter_lnft).toLocaleString() : "—"} />
              <Row label="Avg Parapet Ht (ft)" value={deal.avg_parapet_height || "—"} />
              <Row label="Total SqFt" value={deal.total_sqft ? Number(deal.total_sqft).toLocaleString() : "—"} bold />
            </>
          ) : null}
        </Card>
      </div>

      {/* Documents */}
      <Documents
        parentType="project"
        parentId={id}
        title="Documents — Measurement Reports, Assessments, Scopes, Invoices, Photos"
        coverPhotoId={deal.cover_photo_file_id}
        onSetCover={(fileId) => persist({ cover_photo_file_id: deal.cover_photo_file_id === fileId ? null : fileId })}
      />

      {/* Material Take-Off */}
      <MaterialTakeoff deal={deal} reload={reload} />

      {/* Maintenance Plan */}
      <Card
        title={
          <span className="inline-flex items-center gap-2">
            <Wrench className="w-3.5 h-3.5 text-blue-700" /> Maintenance Plan
          </span>
        }
        right={
          <button
            data-testid="toggle-maintenance-plan"
            onClick={() => persist({ maintenance_plan: !deal.maintenance_plan })}
            className={`inline-flex items-center gap-2 px-3 h-8 text-[10px] font-bold uppercase tracking-wider rounded-sm transition-colors ${
              deal.maintenance_plan
                ? "bg-emerald-600 text-white hover:bg-emerald-700"
                : "border border-zinc-300 text-zinc-700 hover:border-zinc-950"
            }`}
          >
            {deal.maintenance_plan ? "✓ Plan Active" : "Enable Maintenance Plan"}
          </button>
        }
      >
        {!deal.maintenance_plan ? (
          <div className="text-sm text-zinc-500 py-4">
            Click <span className="font-bold">Enable Maintenance Plan</span> to track this customer's annual maintenance, set a rate, and log yearly visits.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Annual Rate ($)</label>
                <CellInput
                  type="number"
                  value={deal.maintenance_rate}
                  onCommit={(v) => persist({ maintenance_rate: parseFloat(v || 0) })}
                  className="font-mono border-zinc-300 mt-1"
                  data-testid="maintenance-rate"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Plan Start Date</label>
                <CellInput
                  type="date"
                  value={deal.maintenance_start_date}
                  onCommit={(v) => persist({ maintenance_start_date: v })}
                  className="border-zinc-300 mt-1"
                  data-testid="maintenance-start"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Next Due (auto)</label>
                <div className="mt-1 h-9 px-2 flex items-center text-sm font-mono font-bold text-blue-700" data-testid="maintenance-next-due">
                  {deal.next_maintenance_date || "— set start date"}
                </div>
              </div>
            </div>

            {/* Log new visit */}
            <div className="bg-zinc-50 border border-zinc-200 rounded-sm p-3 mb-4">
              <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-2">Log New Visit</div>
              <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
                <input
                  type="date"
                  value={newVisit.visit_date}
                  onChange={(e) => setNewVisit({ ...newVisit, visit_date: e.target.value })}
                  className="h-9 px-2 border border-zinc-300 rounded-sm text-sm"
                  data-testid="new-visit-date"
                />
                <input
                  type="number"
                  placeholder="Amount"
                  value={newVisit.amount}
                  onChange={(e) => setNewVisit({ ...newVisit, amount: e.target.value })}
                  className="h-9 px-2 border border-zinc-300 rounded-sm text-sm font-mono"
                  data-testid="new-visit-amount"
                />
                <select
                  value={newVisit.subcontractor_id}
                  onChange={(e) => setNewVisit({ ...newVisit, subcontractor_id: e.target.value })}
                  className="h-9 px-2 border border-zinc-300 rounded-sm text-sm bg-white"
                  data-testid="new-visit-sub"
                >
                  <option value="">— Subcontractor —</option>
                  {subcontractors.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                <input
                  type="text"
                  placeholder="Notes (optional)"
                  value={newVisit.notes}
                  onChange={(e) => setNewVisit({ ...newVisit, notes: e.target.value })}
                  className="h-9 px-2 border border-zinc-300 rounded-sm text-sm"
                  data-testid="new-visit-notes"
                />
                <button
                  onClick={logVisit}
                  className="h-9 inline-flex items-center justify-center gap-1 px-3 text-[10px] font-bold uppercase tracking-wider bg-blue-700 text-white hover:bg-blue-800 rounded-sm"
                  data-testid="log-visit-button"
                >
                  <Plus className="w-3 h-3" /> Log Visit
                </button>
              </div>
            </div>

            {/* Visit history */}
            {(deal.maintenance_visits || []).length === 0 ? (
              <div className="text-sm text-zinc-500 py-3 text-center">No visits logged yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="visit-history-table">
                  <thead>
                    <tr className="border-b-2 border-zinc-950 text-left text-[10px] uppercase tracking-wider">
                      <th className="py-2 pr-3 w-36">Visit Date</th>
                      <th className="py-2 pr-3 w-32 text-right">Amount</th>
                      <th className="py-2 pr-3 w-44">Subcontractor</th>
                      <th className="py-2 pr-3">Notes</th>
                      <th className="py-2 w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {(deal.maintenance_visits || []).map((v) => (
                      <tr key={v.id} className="border-b border-zinc-100" data-testid={`visit-row-${v.id}`}>
                        <td className="py-2 pr-3 font-mono">{v.visit_date}</td>
                        <td className="py-2 pr-3 text-right font-mono">{formatCurrency(v.amount)}</td>
                        <td className="py-2 pr-3 text-zinc-700">{v.subcontractor_name || "—"}</td>
                        <td className="py-2 pr-3 text-zinc-700">{v.notes || "—"}</td>
                        <td className="py-2 text-right">
                          <button onClick={() => removeVisit(v.id)} className="p-1.5 hover:bg-red-100 text-red-700 rounded-sm" data-testid={`delete-visit-${v.id}`}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Card>

      {/* Change Orders */}
      <Card
        title={
          <span className="inline-flex items-center gap-2">
            <FilePlus className="w-3.5 h-3.5 text-blue-700" /> Change Orders
            {changeOrderTotal !== 0 && (
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-sm">
                +{formatCurrency(changeOrderTotal)} approved
              </span>
            )}
          </span>
        }
      >
        {/* Add new change order */}
        <div className="bg-zinc-50 border border-zinc-200 rounded-sm p-3 mb-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-2">Add Change Order</div>
          <div className="grid grid-cols-1 sm:grid-cols-6 gap-2">
            <input
              type="date"
              value={newCO.date}
              onChange={(e) => setNewCO({ ...newCO, date: e.target.value })}
              className="h-9 px-2 border border-zinc-300 rounded-sm text-sm"
              data-testid="new-co-date"
            />
            <input
              type="text"
              placeholder="Description"
              value={newCO.description}
              onChange={(e) => setNewCO({ ...newCO, description: e.target.value })}
              className="h-9 px-2 border border-zinc-300 rounded-sm text-sm sm:col-span-2"
              data-testid="new-co-desc"
            />
            <input
              type="number"
              placeholder="Amount"
              value={newCO.amount}
              onChange={(e) => setNewCO({ ...newCO, amount: e.target.value })}
              className="h-9 px-2 border border-zinc-300 rounded-sm text-sm font-mono"
              data-testid="new-co-amount"
            />
            <select
              value={newCO.status}
              onChange={(e) => setNewCO({ ...newCO, status: e.target.value })}
              className="h-9 px-2 border border-zinc-300 rounded-sm text-sm bg-white"
              data-testid="new-co-status"
            >
              <option value="Draft">Draft</option>
              <option value="Approved">Approved</option>
              <option value="Rejected">Rejected</option>
            </select>
            <button
              onClick={addChangeOrder}
              className="h-9 inline-flex items-center justify-center gap-1 px-3 text-[10px] font-bold uppercase tracking-wider bg-blue-700 text-white hover:bg-blue-800 rounded-sm"
              data-testid="add-co-button"
            >
              <Plus className="w-3 h-3" /> Add
            </button>
          </div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 mt-2">
            Approved change orders are added to Project Total on new invoices for this project.
          </div>
        </div>

        {/* Change order history */}
        {(deal.change_orders || []).length === 0 ? (
          <div className="text-sm text-zinc-500 py-3 text-center">No change orders on this project.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="change-orders-table">
              <thead>
                <tr className="border-b-2 border-zinc-950 text-left text-[10px] uppercase tracking-wider">
                  <th className="py-2 pr-3 w-32">Date</th>
                  <th className="py-2 pr-3">Description</th>
                  <th className="py-2 pr-3 w-32 text-right">Amount</th>
                  <th className="py-2 pr-3 w-28">Status</th>
                  <th className="py-2 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {(deal.change_orders || []).map((co) => (
                  <tr key={co.id} className="border-b border-zinc-100" data-testid={`co-row-${co.id}`}>
                    <td className="py-2 pr-3 font-mono">{co.date || "—"}</td>
                    <td className="py-2 pr-3 text-zinc-700">{co.description}</td>
                    <td className="py-2 pr-3 text-right font-mono font-bold">{formatCurrency(co.amount)}</td>
                    <td className="py-2 pr-3">
                      <select
                        value={co.status || "Approved"}
                        onChange={(e) => updateChangeOrder(co.id, { status: e.target.value })}
                        className={`h-7 px-2 text-[10px] font-bold uppercase tracking-wider border rounded-sm bg-white ${
                          (co.status || "Approved") === "Approved" ? "border-emerald-300 text-emerald-700" :
                          co.status === "Rejected" ? "border-red-300 text-red-700" :
                          "border-zinc-300 text-zinc-600"
                        }`}
                      >
                        <option value="Draft">Draft</option>
                        <option value="Approved">Approved</option>
                        <option value="Rejected">Rejected</option>
                      </select>
                    </td>
                    <td className="py-2 text-right">
                      <button onClick={() => removeChangeOrder(co.id)} className="p-1.5 hover:bg-red-100 text-red-700 rounded-sm" data-testid={`del-co-${co.id}`}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-zinc-950 bg-zinc-50">
                  <td className="py-2 pr-3 font-bold uppercase text-[10px] tracking-wider" colSpan={2}>Approved Change Orders Total</td>
                  <td className="py-2 pr-3 text-right font-mono font-bold text-blue-700">{formatCurrency(changeOrderTotal)}</td>
                  <td colSpan={2}></td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Contact + Property */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
        <Card title="Contact">
          {contact ? (
            <>
              <Row label="Name" value={contact.contact_name} bold />
              <Row label="Company" value={contact.company_name} />
              <Row label="Phone" value={formatPhoneDisplay(contact.phone)} />
              <Row label="Email" value={contact.email} />
              <Row label="Address" value={contact.address} />
            </>
          ) : (
            <div className="text-sm text-zinc-500">No contact linked.</div>
          )}
        </Card>
        <Card title="Property">
          {property ? (
            <>
              <Row label="Name" value={property.property_name} bold />
              <Row label="Address" value={property.property_address} />
              <Row label="On-Site Contact" value={property.property_contact_name} />
              <Row label="Phone" value={formatPhoneDisplay(property.property_contact_phone)} />
            </>
          ) : (
            <div className="text-sm text-zinc-500">No property linked.</div>
          )}
        </Card>
      </div>

      {deal.notes && (
        <div className="mt-6 bg-white border border-zinc-200 rounded-sm p-6">
          <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-500 mb-2">Notes</div>
          <div className="text-sm text-zinc-800 whitespace-pre-wrap" data-testid="deal-notes-view">{deal.notes}</div>
        </div>
      )}

      {/* Project Photos — upload, organize by album + tag, share with customer */}
      <div className="mt-6">
        <ProjectPhotos dealId={id} dealTitle={deal.title} />
      </div>

      {emailScopeOpen && (
        <EmailScopeModal
          dealId={id}
          dealTitle={deal.title}
          dealType={deal.deal_type}
          primaryContactEmail={contact?.email || ""}
          onClose={() => setEmailScopeOpen(false)}
        />
      )}
    </div>
  );
}

const Card = ({ title, right, children }) => (
  <div className="bg-white border border-zinc-200 rounded-sm p-6 mb-6">
    <div className="flex items-center justify-between mb-4 pb-3 border-b border-zinc-100 gap-3 flex-wrap">
      <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-500">{title}</div>
      {right}
    </div>
    <div>{children}</div>
  </div>
);

const Row = ({ label, value, bold, highlight, accent }) => (
  <div className={`flex items-center justify-between py-2 ${highlight ? "bg-blue-50 -mx-2 px-2 rounded-sm" : ""}`}>
    <div className="text-xs uppercase tracking-wider text-zinc-500">{label}</div>
    <div className={`text-sm ${bold ? "font-bold text-zinc-950" : "text-zinc-700"} font-mono ${accent || ""}`}>{value || "—"}</div>
  </div>
);

const KpiCard = ({ label, value, hint, testId, accent }) => (
  <div className="bg-white border border-zinc-200 p-6 rounded-sm" data-testid={testId}>
    <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-500 mb-3">{label}</div>
    <div className={`font-heading text-3xl font-black tracking-tighter ${accent || "text-zinc-950"}`}>{value}</div>
    {hint && <div className="text-xs text-zinc-500 mt-2">{hint}</div>}
  </div>
);

const Mini = ({ label, value }) => (
  <div className="border border-zinc-200 rounded-sm px-3 py-2">
    <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
    <div className="text-sm font-bold font-mono">{value}</div>
  </div>
);

const CellInput = ({ value, onCommit, type = "text", className = "", disabled, ...rest }) => {
  const [v, setV] = useState(value ?? "");
  // When the underlying value changes externally (other user, server sync) but the
  // user has unsaved local edits, commit the local value FIRST so we don't lose typing.
  useEffect(() => {
    if (String(v) !== String(value ?? "") && document.activeElement?.dataset?.testid !== rest["data-testid"]) {
      // External update + we don't have focus → safe to sync down
      setV(value ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      type={type}
      value={v}
      disabled={disabled}
      onChange={(e) => {
        const next = e.target.value;
        setV(next);
        // For numeric cells, commit on every keystroke so a parent re-render
        // (e.g., a sibling "Add Row" click) doesn't wipe unsaved input.
        if (type === "number" && String(next) !== String(value ?? "")) {
          onCommit(next);
        }
      }}
      onBlur={() => { if (String(v) !== String(value ?? "")) onCommit(v); }}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
      className={`w-full h-9 px-2 border border-transparent hover:border-zinc-300 focus:border-blue-700 focus:outline-none bg-transparent rounded-sm text-sm ${className} ${disabled ? "opacity-50" : ""}`}
      {...rest}
    />
  );
};

const CellSelect = ({ value, onCommit, options = [], className = "", ...rest }) => (
  <select
    value={value ?? ""}
    onChange={(e) => onCommit(e.target.value)}
    className={`w-full h-9 px-2 border border-transparent hover:border-zinc-300 focus:border-blue-700 focus:outline-none bg-transparent rounded-sm text-sm ${className}`}
    {...rest}
  >
    {options.map((o) => (
      <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>
    ))}
  </select>
);


function EmailScopeModal({ dealId, dealTitle, dealType, primaryContactEmail, onClose }) {
  const [to, setTo] = useState(primaryContactEmail || "");
  const [cc, setCc] = useState("");
  const [message, setMessage] = useState("");
  const [aliases, setAliases] = useState([]);
  const [fromEmail, setFromEmail] = useState("");
  const [taxonomy, setTaxonomy] = useState([]);
  const [libFiles, setLibFiles] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [filterCat, setFilterCat] = useState("");
  const [sending, setSending] = useState(false);

  const isAssessment = (dealType || "").toLowerCase() === "assessment";
  const docKind = isAssessment ? "assessment" : "scope";

  useEffect(() => {
    api.get("/email-aliases").then((r) => {
      setAliases(r.data?.aliases || []);
      // Prefer the per-doc-type default (scope@ or assessments@); fall back to legacy `default`
      const docDefault = (r.data?.defaults || {})[docKind];
      setFromEmail(docDefault || r.data?.default || "");
    }).catch(() => {});
    api.get("/library/taxonomy").then((r) => setTaxonomy(r.data?.taxonomy || [])).catch(() => {});
    api.get("/library/files").then((r) => setLibFiles(r.data || [])).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKind]);

  const toggleId = (id) => setSelectedIds((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
  const filtered = filterCat ? libFiles.filter((f) => f.category === filterCat) : libFiles;

  const send = async () => {
    if (!to.trim()) { toast.error("Recipient email required"); return; }
    setSending(true);
    try {
      const r = await api.post(`/deals/${dealId}/spec-sheet/email`, {
        to_email: to.trim(),
        cc_email: cc.trim(),
        from_email: fromEmail,
        message: message.trim(),
        library_file_ids: selectedIds,
      });
      toast.success(r.data?.message || "Scope emailed");
      onClose();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-y-auto" data-testid="email-scope-modal">
      <div className="bg-white border border-zinc-200 rounded-sm w-full max-w-3xl my-8">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-700 mb-1">
              Email {isAssessment ? "Assessment" : "Scope"}
            </div>
            <h3 className="font-heading text-xl font-black tracking-tight">{dealTitle}</h3>
            <div className="text-xs text-zinc-500 mt-1">
              {isAssessment ? "Assessment" : "Scope"} PDF is auto-attached. Add Library docs (brochures, specs, certs, contracts) as additional attachments.
              <span className="ml-1 text-zinc-400">Sending from <span className="font-mono text-zinc-700">{fromEmail || "—"}</span>.</span>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-zinc-500 hover:text-zinc-950 text-xs uppercase tracking-wider font-bold">Close</button>
        </div>
        <div className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Left — email composition */}
          <div className="space-y-3">
            {aliases.length > 1 && (
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-600 mb-1">From</label>
                <select value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} className="w-full h-10 px-3 border border-zinc-300 rounded-sm text-sm bg-white" data-testid="scope-from-email">
                  {aliases.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-600 mb-1">To *</label>
              <input value={to} onChange={(e) => setTo(e.target.value)} className="w-full h-10 px-3 border border-zinc-300 rounded-sm text-sm" data-testid="scope-to-email" />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-600 mb-1">CC</label>
              <input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="(optional)" className="w-full h-10 px-3 border border-zinc-300 rounded-sm text-sm" data-testid="scope-cc-email" />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-600 mb-1">Custom Message (optional)</label>
              <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} placeholder="Override the default email body. Leave blank for the standard proposal blurb." className="w-full px-3 py-2 border border-zinc-300 rounded-sm text-sm" data-testid="scope-message" />
            </div>
          </div>

          {/* Right — library picker */}
          <div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Library Attachments ({selectedIds.length} selected)</div>
              <select value={filterCat} onChange={(e) => setFilterCat(e.target.value)} className="h-7 px-2 border border-zinc-300 rounded-sm text-xs bg-white" data-testid="scope-lib-filter">
                <option value="">All categories</option>
                {taxonomy.map((c) => <option key={c.category} value={c.category}>{c.category}</option>)}
              </select>
            </div>
            <div className="border border-zinc-200 rounded-sm max-h-72 overflow-y-auto">
              {filtered.length === 0 ? (
                <div className="text-center text-xs text-zinc-500 py-8">No library docs match.</div>
              ) : filtered.map((f) => (
                <label key={f.id} className="flex items-start gap-2 px-3 py-2 border-b border-zinc-100 hover:bg-zinc-50 cursor-pointer" data-testid={`scope-lib-${f.id}`}>
                  <input type="checkbox" checked={selectedIds.includes(f.id)} onChange={() => toggleId(f.id)} className="mt-1" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold truncate">{f.display_name}</div>
                    <div className="text-[10px] text-zinc-500 truncate">{f.category} / {f.subcategory}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-zinc-200 flex justify-between items-center gap-2">
          <div className="text-[11px] text-zinc-500">
            Will send <b>scope PDF</b> + <b>{selectedIds.length}</b> library doc{selectedIds.length === 1 ? "" : "s"} = <b>{selectedIds.length + 1}</b> total attachment{selectedIds.length === 0 ? "" : "s"}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="px-4 h-10 text-xs font-bold uppercase tracking-wider border border-zinc-300 rounded-sm hover:bg-zinc-50">Cancel</button>
            <button type="button" onClick={send} disabled={sending} className="inline-flex items-center gap-2 bg-blue-700 text-white px-4 h-10 text-xs font-bold uppercase tracking-wider hover:bg-blue-800 disabled:opacity-50 rounded-sm" data-testid="scope-send"><Mail className="w-4 h-4" /> {sending ? "Sending..." : "Send Scope"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
