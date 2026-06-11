import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { api, formatCurrency, formatApiError } from "@/lib/api";
import { ArrowLeft, Plus, Trash2, FileText } from "lucide-react";
import { toast } from "sonner";
import { StatusPill } from "@/pages/Dashboard";

export default function DealDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [deal, setDeal] = useState(null);
  const [contact, setContact] = useState(null);
  const [property, setProperty] = useState(null);
  const [vendors, setVendors] = useState([]);
  const [options, setOptions] = useState({});
  const [saving, setSaving] = useState(false);

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
  }, [id]);

  const totals = useMemo(() => {
    if (!deal) return { revenue: 0, costs: 0, profit: 0, margin: 0, scheduled: 0, received: 0, outstanding: 0, paidCosts: 0, pendingCosts: 0 };
    const revenue = Number(deal.chosen_amount || 0);
    const items = deal.cost_items || [];
    const costs = items.reduce((s, i) => s + Number(i.amount || 0), 0);
    const paidCosts = items.filter((i) => i.status === "Paid").reduce((s, i) => s + Number(i.amount || 0), 0);
    const pendingCosts = costs - paidCosts;
    const milestones = deal.payment_milestones || [];
    const scheduled = milestones.reduce((s, m) => s + Number(m.amount || 0), 0);
    const received = milestones.filter((m) => m.status === "Paid").reduce((s, m) => s + Number(m.amount || 0), 0);
    const outstanding = scheduled - received;
    return {
      revenue, costs, profit: revenue - costs,
      margin: revenue > 0 ? ((revenue - costs) / revenue) * 100 : 0,
      scheduled, received, outstanding, paidCosts, pendingCosts,
    };
  }, [deal]);

  const persist = async (patch) => {
    if (!deal) return;
    setSaving(true);
    try {
      const body = { ...deal, ...patch };
      // strip server-managed
      delete body.id; delete body.created_at;
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
    const items = [...(deal.cost_items || []), { category: "Materials", vendor_id: null, vendor_name: "", description: "", amount: 0, date: "", status: "Pending" }];
    persist({ cost_items: items });
  };

  const updateCostItem = (idx, patch) => {
    const items = [...(deal.cost_items || [])];
    items[idx] = { ...items[idx], ...patch };
    persist({ cost_items: items });
  };

  const removeCostItem = (idx) => {
    if (!window.confirm("Remove this cost item?")) return;
    const items = [...(deal.cost_items || [])];
    items.splice(idx, 1);
    persist({ cost_items: items });
  };

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
      </div>

      {/* Financials KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <KpiCard label="Revenue" value={formatCurrency(totals.revenue)} testId="kpi-revenue" />
        <KpiCard label="Total Costs" value={formatCurrency(totals.costs)} hint={`${formatCurrency(totals.paidCosts)} paid · ${formatCurrency(totals.pendingCosts)} pending`} testId="kpi-costs" />
        <KpiCard label="Net Profit" value={formatCurrency(totals.profit)} hint={`Margin ${totals.margin.toFixed(1)}%`} accent={totals.profit >= 0 ? "text-emerald-700" : "text-red-700"} testId="kpi-profit" />
        <KpiCard label="Outstanding" value={formatCurrency(totals.outstanding)} hint={`${formatCurrency(totals.received)} received of ${formatCurrency(totals.scheduled)}`} accent="text-orange-700" testId="kpi-outstanding" />
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
        <Card title={deal.deal_type === "Assessment" ? "Assessment Options" : "Pricing Options"}>
          <Row label="Option A" value={formatCurrency(deal.proposal_option_1)} highlight={Math.abs(totals.revenue - deal.proposal_option_1) < 0.01 && totals.revenue > 0} />
          <Row label="Option B" value={formatCurrency(deal.proposal_option_2)} highlight={Math.abs(totals.revenue - deal.proposal_option_2) < 0.01 && totals.revenue > 0} />
          <Row label="Option C" value={formatCurrency(deal.proposal_option_3)} highlight={Math.abs(totals.revenue - deal.proposal_option_3) < 0.01 && totals.revenue > 0} />
          <div className="border-t-2 border-zinc-950 my-2" />
          <Row label="Chosen" value={formatCurrency(totals.revenue)} bold />
        </Card>

        <Card title="Roof Spec">
          <Row label="Current Roof" value={deal.current_roof_type} />
          <Row label="Proposed Roof" value={deal.proposed_roof_type} bold />
          <Row label="Project Type" value={deal.project_type} />
          <Row label="Lead Source" value={deal.lead_source} />
          {deal.lead_source === "Referral" && deal.referral_source && (
            <Row label="Referred By" value={deal.referral_source} />
          )}
          {deal.date_sent && <Row label="Date Sent" value={deal.date_sent} />}
          {deal.chosen_date && <Row label="Chosen Date" value={deal.chosen_date} />}
        </Card>
      </div>

      {/* Contact + Property */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
        <Card title="Contact">
          {contact ? (
            <>
              <Row label="Name" value={contact.contact_name} bold />
              <Row label="Company" value={contact.company_name} />
              <Row label="Phone" value={contact.phone} />
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
              <Row label="Phone" value={property.property_contact_phone} />
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
  useEffect(() => { setV(value ?? ""); }, [value]);
  return (
    <input
      type={type}
      value={v}
      disabled={disabled}
      onChange={(e) => setV(e.target.value)}
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
