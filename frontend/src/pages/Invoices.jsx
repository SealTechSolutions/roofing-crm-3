import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatCurrency, formatApiError, API, showGlWarnings } from "@/lib/api";
import { Receipt, Plus, Search, Download, Send, Trash2, Eye, FileText, Building2 } from "lucide-react";
import { toast } from "sonner";

const STATUS_STYLES = {
  Draft: "bg-zinc-100 text-zinc-700 border-zinc-300",
  Sent: "bg-blue-100 text-blue-800 border-blue-300",
  Paid: "bg-emerald-100 text-emerald-800 border-emerald-300",
  Partial: "bg-amber-100 text-amber-800 border-amber-300",
  Overdue: "bg-red-100 text-red-800 border-red-300",
  Void: "bg-zinc-100 text-zinc-500 border-zinc-300 line-through",
};

export default function Invoices() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [editor, setEditor] = useState(null); // invoice object or {} for new
  const [emailModal, setEmailModal] = useState(null);
  const [statementsOpen, setStatementsOpen] = useState(false);
  const [deals, setDeals] = useState([]);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get("/invoices");
      setRows(r.data);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    api.get("/deals").then((r) => setDeals(r.data)).catch(() => setDeals([]));
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = rows;
    if (statusFilter !== "All") out = out.filter((r) => r.status === statusFilter);
    if (q) {
      out = out.filter((r) =>
        (r.invoice_number || "").toLowerCase().includes(q) ||
        (r.bill_to_company || "").toLowerCase().includes(q) ||
        (r.bill_to_name || "").toLowerCase().includes(q) ||
        (r.project_title || "").toLowerCase().includes(q)
      );
    }
    return out;
  }, [rows, search, statusFilter]);

  const totals = useMemo(() => {
    const outstanding = filtered.filter((r) => !["Paid", "Void"].includes(r.status)).reduce((s, r) => s + Number(r.balance_due || 0), 0);
    const overdue = filtered.filter((r) => r.status === "Overdue").reduce((s, r) => s + Number(r.balance_due || 0), 0);
    const collected = filtered.reduce((s, r) => s + Number(r.amount_paid || 0), 0);
    return { outstanding, overdue, collected, count: filtered.length };
  }, [filtered]);

  const downloadPdf = (inv) => {
    const token = localStorage.getItem("crm_token");
    window.open(`${API}/invoices/${inv.id}/pdf?token=${encodeURIComponent(token)}`, "_blank");
  };

  const removeInvoice = async (inv) => {
    if (!window.confirm(`Delete ${inv.invoice_number}?`)) return;
    try {
      await api.delete(`/invoices/${inv.id}`);
      toast.success("Invoice deleted");
      load();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    }
  };

  return (
    <div className="p-6 sm:p-8 animate-in fade-in duration-500" data-testid="invoices-page">
      <div className="flex items-start justify-between mb-8 pb-6 border-b border-zinc-200 gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Receipt className="w-4 h-4 text-blue-700" />
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-700">Receivables</div>
          </div>
          <h1 className="font-heading text-3xl sm:text-4xl font-black tracking-tight">Invoices</h1>
          <div className="mt-2 text-xs uppercase tracking-wider text-zinc-500">Generate, send, and track invoices for projects and maintenance visits</div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setStatementsOpen(true)}
            className="inline-flex items-center gap-2 bg-white border border-zinc-300 text-zinc-950 px-4 h-10 text-xs font-bold uppercase tracking-wider hover:bg-zinc-50 rounded-sm transition-colors"
            data-testid="open-statements-button"
            title="Generate a Statement of Account PDF for any customer with open invoices"
          >
            <FileText className="w-4 h-4" /> Statements of Account
          </button>
          <button
            onClick={() => setEditor({})}
            className="inline-flex items-center gap-2 bg-blue-700 text-white px-4 h-10 text-xs font-bold uppercase tracking-wider hover:bg-blue-800 rounded-sm transition-colors"
            data-testid="new-invoice-button"
          >
            <Plus className="w-4 h-4" /> New Invoice
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Total Invoices" value={totals.count} testId="kpi-inv-count" />
        <KpiCard label="Outstanding" value={formatCurrency(totals.outstanding)} hint="All unpaid balances" testId="kpi-inv-outstanding" accent="text-orange-700" />
        <KpiCard label="Overdue" value={formatCurrency(totals.overdue)} hint="Past due date" testId="kpi-inv-overdue" accent="text-red-700" />
        <KpiCard label="Collected" value={formatCurrency(totals.collected)} hint="Total payments received" testId="kpi-inv-collected" accent="text-emerald-700" />
      </div>

      {/* Filters */}
      <div className="bg-white border border-zinc-200 rounded-sm p-4 mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[240px] relative">
            <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search invoice #, company, project..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-9 pl-9 pr-3 border border-zinc-300 rounded-sm text-sm"
              data-testid="invoice-search"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-9 px-3 border border-zinc-300 rounded-sm text-sm bg-white"
            data-testid="invoice-status-filter"
          >
            <option value="All">All Statuses</option>
            <option value="Draft">Draft</option>
            <option value="Sent">Sent</option>
            <option value="Partial">Partial</option>
            <option value="Paid">Paid</option>
            <option value="Overdue">Overdue</option>
            <option value="Void">Void</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-zinc-200 rounded-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="invoices-table">
            <thead>
              <tr className="border-b-2 border-zinc-950 text-left text-[10px] uppercase tracking-wider bg-zinc-50">
                <th className="py-3 px-4">Invoice #</th>
                <th className="py-3 px-4">Bill To</th>
                <th className="py-3 px-4">Project</th>
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4">Due</th>
                <th className="py-3 px-4 text-right">Total</th>
                <th className="py-3 px-4 text-right">Balance</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="py-8 text-center text-xs uppercase tracking-wider text-zinc-500">Loading...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} className="py-8 text-center text-sm text-zinc-500">No invoices yet. Click <span className="font-bold">New Invoice</span> to create one.</td></tr>
              ) : (
                filtered.map((r) => (
                  <tr key={r.id} className="border-b border-zinc-100 hover:bg-blue-50/40" data-testid={`invoice-row-${r.id}`}>
                    <td className="py-3 px-4">
                      <button onClick={() => setEditor(r)} className="font-bold text-zinc-950 hover:text-blue-700 font-mono">{r.invoice_number}</button>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-bold text-zinc-950">{r.bill_to_company || r.bill_to_name || "—"}</div>
                      <div className="text-[11px] text-zinc-500">{r.bill_to_name && r.bill_to_company ? r.bill_to_name : ""}</div>
                    </td>
                    <td className="py-3 px-4 text-zinc-700">
                      {r.project_title || "—"}
                      {r.invoice_type && <div className="text-[10px] uppercase tracking-wider text-blue-700 font-bold mt-0.5">{r.invoice_type}</div>}
                    </td>
                    <td className="py-3 px-4 font-mono text-zinc-700">{r.invoice_date}</td>
                    <td className="py-3 px-4 font-mono text-zinc-700">{r.due_date}</td>
                    <td className="py-3 px-4 text-right font-mono">{formatCurrency(r.total)}</td>
                    <td className="py-3 px-4 text-right font-mono font-bold">{formatCurrency(r.balance_due)}</td>
                    <td className="py-3 px-4">
                      <span className={`inline-flex items-center px-2 h-6 text-[10px] font-bold uppercase tracking-wider border rounded-sm ${STATUS_STYLES[r.status] || STATUS_STYLES.Draft}`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button onClick={() => setEditor(r)} title="View / Edit" className="p-1.5 hover:bg-zinc-100 rounded-sm" data-testid={`view-inv-${r.id}`}><Eye className="w-3.5 h-3.5 text-zinc-700" /></button>
                        <button onClick={() => downloadPdf(r)} title="Download PDF" className="p-1.5 hover:bg-zinc-100 rounded-sm" data-testid={`pdf-inv-${r.id}`}><Download className="w-3.5 h-3.5 text-zinc-700" /></button>
                        <button onClick={() => setEmailModal(r)} title="Email" className="p-1.5 hover:bg-zinc-100 rounded-sm" data-testid={`email-inv-${r.id}`}><Send className="w-3.5 h-3.5 text-blue-700" /></button>
                        <button onClick={() => removeInvoice(r)} title="Delete" className="p-1.5 hover:bg-red-100 text-red-700 rounded-sm" data-testid={`del-inv-${r.id}`}><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editor && (
        <InvoiceEditor
          invoice={editor}
          deals={deals}
          onClose={() => setEditor(null)}
          onSaved={() => { setEditor(null); load(); }}
        />
      )}

      {emailModal && (
        <EmailInvoiceModal
          invoice={emailModal}
          onClose={() => setEmailModal(null)}
          onSent={() => { setEmailModal(null); load(); }}
        />
      )}

      {statementsOpen && (
        <StatementsModal onClose={() => setStatementsOpen(false)} />
      )}
    </div>
  );
}

// ---------- Invoice editor ----------
/** Two-dropdown picker for Inter-Company invoices: FROM (issuer) → TO (counter).
 *  Validates the two are different entities and applies the template on click.
 */
function IcQuickPicker({ entities, defaultFromId, onApply, onCancel }) {
  const [fromId, setFromId] = useState(defaultFromId || (entities[0]?.id || ""));
  const [toId, setToId] = useState("");
  const fromEnt = entities.find((e) => e.id === fromId);
  const toEnt = entities.find((e) => e.id === toId);
  const canApply = fromId && toId && fromId !== toId;
  return (
    <div className="mt-3 grid grid-cols-1 md:grid-cols-5 gap-2 items-end" data-testid="ic-quick-picker">
      <div className="md:col-span-2">
        <label className="text-[10px] font-bold uppercase tracking-wider text-violet-700">Bill FROM (issuer)</label>
        <select
          value={fromId}
          onChange={(e) => setFromId(e.target.value)}
          className="mt-1 w-full h-9 px-2 border border-violet-300 rounded-sm text-sm bg-white"
          data-testid="ic-picker-from"
        >
          <option value="">— Select entity —</option>
          {entities.map((e) => (
            <option key={e.id} value={e.id} disabled={e.id === toId}>
              {e.name}{e.role ? ` — ${e.role}` : ""}
            </option>
          ))}
        </select>
      </div>
      <div className="md:col-span-2">
        <label className="text-[10px] font-bold uppercase tracking-wider text-violet-700">Bill TO (counter)</label>
        <select
          value={toId}
          onChange={(e) => setToId(e.target.value)}
          className="mt-1 w-full h-9 px-2 border border-violet-300 rounded-sm text-sm bg-white"
          data-testid="ic-picker-to"
        >
          <option value="">— Select entity —</option>
          {entities.map((e) => (
            <option key={e.id} value={e.id} disabled={e.id === fromId}>
              {e.name}{e.role ? ` — ${e.role}` : ""}
            </option>
          ))}
        </select>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => canApply && onApply(fromId, toId)}
          disabled={!canApply}
          data-testid="ic-picker-apply"
          className="h-9 px-3 text-[10px] font-bold uppercase tracking-wider bg-violet-700 text-white rounded-sm hover:bg-violet-800 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Apply
        </button>
        <button
          type="button"
          onClick={onCancel}
          data-testid="ic-picker-cancel"
          className="h-9 px-3 text-[10px] font-bold uppercase tracking-wider border border-violet-300 text-violet-700 rounded-sm hover:bg-violet-100"
        >
          Cancel
        </button>
      </div>
      {fromEnt && toEnt && fromId !== toId && (
        <div className="md:col-span-5 text-[10px] text-violet-800 bg-white border border-violet-200 rounded-sm p-2 mt-1">
          <strong>{fromEnt.name}</strong> will invoice <strong>{toEnt.name}</strong>.
          On save: <span className="font-mono">DR 1900 IC A/R / CR 4900 IC Revenue</span> on {fromEnt.name},
          mirrored as <span className="font-mono">DR 6700 IC Expense / CR 2900 IC A/P</span> on {toEnt.name}.
        </div>
      )}
    </div>
  );
}


function InvoiceEditor({ invoice, deals, onClose, onSaved }) {
  const isNew = !invoice?.id;
  const [existingInvoices, setExistingInvoices] = useState([]); // for the linked deal
  const [changeOrders, setChangeOrders] = useState([]); // approved change orders on the linked deal
  const [form, setForm] = useState(() => ({
    deal_id: invoice.deal_id || "",
    customer_contact_id: invoice.customer_contact_id || "",
    invoice_type: invoice.invoice_type || "",
    bill_to_company: invoice.bill_to_company || "",
    bill_to_name: invoice.bill_to_name || "",
    bill_to_address: invoice.bill_to_address || "",
    bill_to_address_line2: invoice.bill_to_address_line2 || "",
    bill_to_city: invoice.bill_to_city || "",
    bill_to_state: invoice.bill_to_state || "",
    bill_to_zip: invoice.bill_to_zip || "",
    bill_to_email: invoice.bill_to_email || "",
    cc_email: invoice.cc_email || "",
    invoice_date: invoice.invoice_date || new Date().toISOString().slice(0, 10),
    due_date: invoice.due_date || "",
    terms: invoice.terms || "Due Upon Receipt",
    project_title: invoice.project_title || "",
    project_address: invoice.project_address || "",
    project_total: invoice.project_total || 0,
    notes: invoice.notes || "",
    line_items: invoice.line_items?.length
      ? invoice.line_items.map((li) => ({ ...li }))
      : [{ description: "", quantity: 1, unit_price: 0, amount: 0 }],
    status: invoice.status || "Draft",
    amount_paid: invoice.amount_paid || 0,
    payment_date: invoice.payment_date || "",
    payment_method: invoice.payment_method || "",
    payment_reference: invoice.payment_reference || "",
    source_type: invoice.source_type || "",
    source_id: invoice.source_id || "",
    entity_id: invoice.entity_id || "",
    counter_entity_id: invoice.counter_entity_id || "",
  }));
  const [saving, setSaving] = useState(false);
  const [entities, setEntities] = useState([]);
  const [icPickerOpen, setIcPickerOpen] = useState(false);

  // Load Books entities for the entity picker
  useEffect(() => {
    api.get("/books/entities").then((r) => {
      setEntities(r.data || []);
      if (!form.entity_id) {
        const parent = (r.data || []).find((e) => e.is_parent);
        if (parent) setForm((f) => ({ ...f, entity_id: parent.id }));
      }
    }).catch(() => setEntities([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply an Inter-Company invoice template: set both entity sides + auto-fill Bill To from the counter entity.
  const applyIcTemplate = (fromEntityId, toEntityId) => {
    const fromEnt = entities.find((e) => e.id === fromEntityId);
    const toEnt = entities.find((e) => e.id === toEntityId);
    if (!fromEnt || !toEnt) return;
    const role = (fromEnt.role || "").trim();
    setForm((f) => ({
      ...f,
      deal_id: "",  // IC charges are usually not project-scoped
      entity_id: fromEntityId,
      counter_entity_id: toEntityId,
      bill_to_company: toEnt.legal_name || toEnt.name || "",
      bill_to_name: "Accounts Payable",
      bill_to_address: toEnt.remit_to_address || toEnt.address || "",
      bill_to_address_line2: "",
      bill_to_city: toEnt.city || "",
      bill_to_state: toEnt.state || "",
      bill_to_zip: toEnt.zip_code || "",
      bill_to_email: toEnt.email || f.bill_to_email,
      project_title: role ? `Inter-Company Charge — ${role}` : "Inter-Company Charge",
      project_address: "",
      project_total: 0,
      invoice_type: "",
    }));
    setIcPickerOpen(false);
    toast.success(`Inter-Company invoice: ${fromEnt.name} → ${toEnt.name}`);
  };

  // Whenever deal_id is set (new or existing invoice), load CO list + existing invoices for context
  useEffect(() => {
    if (!form.deal_id) {
      setChangeOrders([]);
      setExistingInvoices([]);
      return;
    }
    (async () => {
      try {
        const d = await api.get(`/deals/${form.deal_id}`);
        const approvedCOs = (d.data.change_orders || []).filter((co) => (co.status || "Approved") === "Approved");
        setChangeOrders(approvedCOs);
      } catch { setChangeOrders([]); }
      try {
        const invs = await api.get(`/invoices?deal_id=${form.deal_id}`);
        // Exclude the current invoice if editing
        setExistingInvoices((invs.data || []).filter((i) => i.id !== invoice.id));
      } catch { setExistingInvoices([]); }
    })();
  }, [form.deal_id, invoice.id]);

  const handleDealChange = async (deal_id) => {
    setForm({ ...form, deal_id });
    if (!deal_id || !isNew) return;
    // Auto-fill bill-to from the deal's customer
    try {
      const r = await api.get(`/deals/${deal_id}`);
      const d = r.data;
      // Approved change orders → auto-add as line items
      const approvedCOs = (d.change_orders || []).filter((co) => (co.status || "Approved") === "Approved");
      const coTotal = approvedCOs.reduce((s, co) => s + Number(co.amount || 0), 0);
      const coLines = approvedCOs.map((co) => ({
        description: `Change Order — ${co.description}${co.date ? ` (${co.date})` : ""}`,
        quantity: 1,
        unit_price: Number(co.amount || 0),
        amount: Number(co.amount || 0),
      }));
      const cid = d.customer_contact_id || d.contact_id;
      // Compute project total from chosen_amount or MID proposal option (typical buy point) + approved change orders
      const opts = [Number(d.proposal_option_1 || 0), Number(d.proposal_option_2 || 0), Number(d.proposal_option_3 || 0), Number(d.proposal_option_25yr || 0)].filter((x) => x > 0).sort((a, b) => a - b);
      const midOption = opts.length ? opts[Math.floor(opts.length / 2)] : 0;
      const baseTotal = Number(d.chosen_amount || 0) > 0 ? Number(d.chosen_amount) : midOption;
      const projTotal = baseTotal + coTotal;
      let patch = { project_title: d.title || "", project_total: projTotal };
      if (cid) {
        const c = await api.get(`/contacts/${cid}`);
        const cust = c.data;
        const same = cust.billing_same_as_address;
        const billing = same
          ? { addr: cust.address, addr2: cust.address_line2, city: cust.city, state: cust.state, zip: cust.zip_code }
          : { addr: cust.billing_address, addr2: cust.billing_address_line2, city: cust.billing_city, state: cust.billing_state, zip: cust.billing_zip };
        patch = {
          ...patch,
          customer_contact_id: cid,
          bill_to_company: cust.company_name || "",
          bill_to_name: cust.contact_name || "",
          bill_to_address: billing.addr || "",
          bill_to_address_line2: billing.addr2 || "",
          bill_to_city: billing.city || "",
          bill_to_state: billing.state || "",
          bill_to_zip: billing.zip || "",
          bill_to_email: cust.email || "",
        };
      }
      if (d.property_id) {
        const p = await api.get(`/properties/${d.property_id}`);
        const prop = p.data;
        const addr1 = [prop.property_address, prop.property_address_line2].filter(Boolean).join(" ");
        const line2 = [prop.property_city, prop.property_state].filter(Boolean).join(", ");
        const tail = prop.property_zip ? `${line2} ${prop.property_zip}` : line2;
        patch.project_address = [addr1, tail].filter(Boolean).join("  ·  ");
      }
      setForm((f) => {
        // If existing line items are empty (default new-invoice state), replace with CO lines.
        // Otherwise append.
        const existing = f.line_items || [];
        const onlyEmpty = existing.length === 1 && !existing[0].description && !Number(existing[0].unit_price);
        const newLines = coLines.length
          ? (onlyEmpty ? coLines : [...existing, ...coLines])
          : existing;
        return { ...f, ...patch, deal_id, line_items: newLines };
      });
      if (coLines.length > 0) {
        toast.success(`${coLines.length} change order${coLines.length > 1 ? "s" : ""} added to invoice (${formatCurrency(coTotal)})`);
      }
    } catch {}
  };

  const updateLine = (idx, patch) => {
    const items = [...form.line_items];
    items[idx] = { ...items[idx], ...patch };
    items[idx].amount = Number(items[idx].quantity || 0) * Number(items[idx].unit_price || 0);
    setForm({ ...form, line_items: items });
  };
  const addLine = () => setForm({ ...form, line_items: [...form.line_items, { description: "", quantity: 1, unit_price: 0, amount: 0 }] });
  const removeLine = (idx) => setForm({ ...form, line_items: form.line_items.filter((_, i) => i !== idx) });

  // Quick presets — clicking adds a line item with templated (editable) description.
  // When a project is linked, the unit_price auto-calculates from project_total.
  const PRESETS = [
    { label: "Project Amount", desc: "Project Amount — Full contract value", pct: 100 },
    { label: "Deposit", desc: "Deposit Invoice — Initial deposit per signed agreement", pct: 50 },
    { label: "Mid-Project", desc: "Mid-Project Invoice — Progress draw per signed agreement", pct: 25 },
    // Final: 50% by default, 25% if a Mid-Project invoice already exists for this deal
    { label: "Final", desc: "Final Invoice — Completion of all scoped work", pctDefault: 50, pctIfMid: 25 },
    { label: "Maintenance", desc: "Annual Maintenance Visit — Inspection, cleaning, and seam touch-ups", pct: null },
    { label: "Repair", desc: "Repair Services — Roof repair as described", pct: null },
  ];

  const applyPreset = (preset) => {
    // Resolve percentage (Final has conditional)
    let pct = preset.pct;
    if (preset.label === "Final") {
      const hasMid = existingInvoices.some((i) => i.invoice_type === "Mid-Project" && i.status !== "Void");
      pct = hasMid ? preset.pctIfMid : preset.pctDefault;
    }
    const projectTotal = Number(form.project_total || 0);
    const unitPrice = pct && projectTotal > 0 ? Math.round((projectTotal * pct) / 100 * 100) / 100 : 0;
    const descSuffix = pct && projectTotal > 0 ? ` (${pct}% of $${projectTotal.toLocaleString()})` : "";
    const newLine = {
      description: preset.desc + descSuffix,
      quantity: 1,
      unit_price: unitPrice,
      amount: unitPrice,
    };
    // If the only line item is empty, replace it; otherwise append
    const items = form.line_items;
    const firstEmpty = items.length === 1 && !items[0].description && !Number(items[0].unit_price);
    const next = firstEmpty ? [newLine] : [...items, newLine];
    // Also stamp invoice_type if currently blank
    const patchType = !form.invoice_type ? { invoice_type: preset.label } : {};
    setForm({ ...form, line_items: next, ...patchType });
    if (pct && projectTotal > 0) {
      toast.success(`Added ${pct}% line item: ${formatCurrency(unitPrice)}${preset.label === "Final" && existingInvoices.some((i) => i.invoice_type === "Mid-Project" && i.status !== "Void") ? " (mid invoice detected → 25%)" : ""}`);
    }
  };

  const addChangeOrderLine = (co) => {
    const newLine = {
      description: `Change Order — ${co.description}${co.date ? ` (${co.date})` : ""}`,
      quantity: 1,
      unit_price: Number(co.amount || 0),
      amount: Number(co.amount || 0),
    };
    setForm({ ...form, line_items: [...form.line_items, newLine] });
    toast.success("Change order added as line item");
  };

  const subtotal = form.line_items.reduce((s, li) => s + Number(li.amount || 0), 0);
  const total = subtotal;
  const balance_due = total - Number(form.amount_paid || 0);

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        ...form,
        amount_paid: Number(form.amount_paid || 0),
        line_items: form.line_items.map((li) => ({ ...li, quantity: Number(li.quantity || 0), unit_price: Number(li.unit_price || 0) })),
      };
      if (isNew) {
        const r = await api.post("/invoices", payload);
        toast.success(`Created ${r.data.invoice_number}`);
        showGlWarnings(toast, r.data);
      } else {
        const r = await api.put(`/invoices/${invoice.id}`, payload);
        toast.success("Invoice updated");
        showGlWarnings(toast, r.data);
      }
      onSaved();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-zinc-950/60 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose} data-testid="invoice-editor">
      <div className="bg-white w-full max-w-4xl rounded-sm shadow-xl my-8" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-zinc-200 flex items-center justify-between">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-500">{isNew ? "New Invoice" : "Edit Invoice"}</div>
            <div className="font-heading text-xl font-black tracking-tight mt-1 font-mono">{invoice.invoice_number || "Pending #"}</div>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-950 text-xl">×</button>
        </div>
        <div className="p-5 space-y-5">
          {/* Inter-Company Invoice quick-template */}
          {isNew && (
            <div className="border border-violet-200 bg-violet-50/40 rounded-sm p-3" data-testid="ic-template-panel">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-violet-700" />
                  <div>
                    <div className="text-[11px] font-black uppercase tracking-[0.15em] text-violet-800">Inter-Company Invoice</div>
                    <div className="text-[10px] text-violet-700/80">Bill one of your entities from another (commissions, rent, IC labor, etc). Auto-fills Bill-To from the receiving entity.</div>
                  </div>
                </div>
                {!icPickerOpen && (
                  <button
                    type="button"
                    onClick={() => setIcPickerOpen(true)}
                    data-testid="ic-template-open-btn"
                    className="text-[10px] font-bold uppercase tracking-wider bg-violet-700 text-white px-3 py-1.5 rounded-sm hover:bg-violet-800"
                  >
                    Use Template
                  </button>
                )}
              </div>
              {icPickerOpen && (
                <IcQuickPicker
                  entities={entities}
                  defaultFromId={form.entity_id}
                  onApply={applyIcTemplate}
                  onCancel={() => setIcPickerOpen(false)}
                />
              )}
            </div>
          )}

          {/* Books — Entity routing */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                Books Entity (GL Posting) <span className="text-emerald-700 font-black ml-1">· INVOICE FROM</span>
              </label>
              <select
                value={form.entity_id}
                onChange={(e) => setForm({ ...form, entity_id: e.target.value })}
                className="mt-1 w-full h-9 px-2 border border-emerald-300 rounded-sm text-sm bg-emerald-50/40"
                data-testid="invoice-entity-select"
              >
                <option value="">— No GL Posting —</option>
                {entities.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}{e.is_parent ? "  (Parent)" : ""}{e.role ? `  — ${e.role}` : ""}
                  </option>
                ))}
              </select>
              <div className="text-[10px] text-zinc-500 mt-1"><strong>The entity sending the invoice.</strong> Its books get the A/R + revenue.</div>
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                Counter Entity (Inter-Co) <span className="text-amber-700 font-black ml-1">· INVOICE TO</span>
              </label>
              <select
                value={form.counter_entity_id}
                onChange={(e) => setForm({ ...form, counter_entity_id: e.target.value })}
                className="mt-1 w-full h-9 px-2 border border-amber-300 rounded-sm text-sm bg-amber-50/40"
                disabled={!form.entity_id}
                data-testid="invoice-counter-entity-select"
              >
                <option value="">— Not Inter-Company —</option>
                {entities.filter((e) => e.id !== form.entity_id).map((e) => (
                  <option key={e.id} value={e.id}>{e.name}</option>
                ))}
              </select>
              <div className="text-[10px] text-zinc-500 mt-1"><strong>Only for Inter-Company invoices</strong> — the SealTech entity being billed (its books auto-mirror 6700/2900).</div>
            </div>
          </div>

          {/* Link to project (OPTIONAL — leave blank for rent, commissions, IC charges, misc invoices) */}
          {isNew && (
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                Link to Project <span className="text-zinc-400 font-normal normal-case ml-1">(optional — skip for rent, commissions, IC charges, or any non-project invoice)</span>
              </label>
              <select value={form.deal_id} onChange={(e) => handleDealChange(e.target.value)} className="mt-1 w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm bg-white" data-testid="invoice-deal-select">
                <option value="">— None / Manual (no project) —</option>
                {deals.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
              </select>
            </div>
          )}

          {/* Bill To */}
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-blue-700 mb-2">Bill To</div>
            <div className="grid grid-cols-2 gap-3">
              <input value={form.bill_to_company} onChange={(e) => setForm({ ...form, bill_to_company: e.target.value })} placeholder="Company Name" className="h-9 px-2 border border-zinc-300 rounded-sm text-sm" data-testid="bill-to-company" />
              <input value={form.bill_to_name} onChange={(e) => setForm({ ...form, bill_to_name: e.target.value })} placeholder="Contact Name" className="h-9 px-2 border border-zinc-300 rounded-sm text-sm" data-testid="bill-to-name" />
              <input value={form.bill_to_address} onChange={(e) => setForm({ ...form, bill_to_address: e.target.value })} placeholder="Address" className="h-9 px-2 border border-zinc-300 rounded-sm text-sm col-span-2" data-testid="bill-to-address" />
              <input value={form.bill_to_address_line2} onChange={(e) => setForm({ ...form, bill_to_address_line2: e.target.value })} placeholder="Line 2 / Suite" className="h-9 px-2 border border-zinc-300 rounded-sm text-sm col-span-2" />
              <input value={form.bill_to_city} onChange={(e) => setForm({ ...form, bill_to_city: e.target.value })} placeholder="City" className="h-9 px-2 border border-zinc-300 rounded-sm text-sm" />
              <div className="grid grid-cols-2 gap-2">
                <input value={form.bill_to_state} onChange={(e) => setForm({ ...form, bill_to_state: e.target.value })} placeholder="State" className="h-9 px-2 border border-zinc-300 rounded-sm text-sm" />
                <input value={form.bill_to_zip} onChange={(e) => setForm({ ...form, bill_to_zip: e.target.value })} placeholder="ZIP" className="h-9 px-2 border border-zinc-300 rounded-sm text-sm" />
              </div>
              <input value={form.bill_to_email} onChange={(e) => setForm({ ...form, bill_to_email: e.target.value })} placeholder="Email (for sending)" type="email" className="h-9 px-2 border border-zinc-300 rounded-sm text-sm col-span-2" data-testid="bill-to-email" />
            </div>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Invoice Date</label>
              <input type="date" value={form.invoice_date} onChange={(e) => setForm({ ...form, invoice_date: e.target.value })} className="mt-1 w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm" />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Due Date</label>
              <input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} className="mt-1 w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm" />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Terms</label>
              <input value={form.terms} onChange={(e) => setForm({ ...form, terms: e.target.value })} className="mt-1 w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm" />
            </div>
          </div>

          {/* Project */}
          <div className="grid grid-cols-3 gap-3">
            <input value={form.project_title} onChange={(e) => setForm({ ...form, project_title: e.target.value })} placeholder="Project Title" className="h-9 px-2 border border-zinc-300 rounded-sm text-sm" data-testid="project-title" />
            <input value={form.project_address} onChange={(e) => setForm({ ...form, project_address: e.target.value })} placeholder="Project Address / Location" className="h-9 px-2 border border-zinc-300 rounded-sm text-sm" />
            <div className="relative">
              <input type="number" value={form.project_total} onChange={(e) => setForm({ ...form, project_total: Number(e.target.value || 0) })} placeholder="Project Total" className="h-9 pl-7 pr-2 w-full border border-zinc-300 rounded-sm text-sm font-mono" data-testid="project-total" />
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-400 text-sm">$</span>
            </div>
          </div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 -mt-3">Project Total appears on the invoice for context (e.g., "Deposit of X on a Y project")</div>

          {/* Line Items */}
          <div>
            <div className="flex items-center justify-between mb-2 gap-3 flex-wrap">
              <div className="flex items-center gap-3">
                <div className="text-[10px] font-bold uppercase tracking-wider text-blue-700">Line Items</div>
                <select
                  value={form.invoice_type}
                  onChange={(e) => setForm({ ...form, invoice_type: e.target.value })}
                  className="h-7 px-2 border border-zinc-300 rounded-sm text-[11px] bg-white"
                  data-testid="invoice-type-select"
                >
                  <option value="">Invoice Type…</option>
                  <option value="Project Amount">Project Amount</option>
                  <option value="Deposit">Deposit</option>
                  <option value="Mid-Project">Mid-Project</option>
                  <option value="Final">Final</option>
                  <option value="Maintenance">Maintenance</option>
                  <option value="Repair">Repair</option>
                </select>
              </div>
              <button onClick={addLine} className="inline-flex items-center gap-1 px-2 h-7 text-[10px] font-bold uppercase tracking-wider border border-zinc-300 hover:border-zinc-950 rounded-sm" data-testid="add-line-item"><Plus className="w-3 h-3" /> Add Blank Line</button>
            </div>
            {/* Preset buttons */}
            <div className="flex flex-wrap gap-1.5 mb-2">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  onClick={() => applyPreset(p)}
                  className="inline-flex items-center gap-1 px-2.5 h-7 text-[10px] font-bold uppercase tracking-wider border border-zinc-300 hover:border-blue-700 hover:text-blue-700 rounded-sm transition-colors"
                  data-testid={`preset-${p.label.toLowerCase().replace(/\s+/g, "-")}`}
                  title={p.desc}
                >
                  <Plus className="w-3 h-3" /> {p.label}
                </button>
              ))}
            </div>

            {/* Change Orders picker (only when deal linked + COs exist) */}
            {changeOrders.length > 0 && (
              <div className="bg-amber-50/40 border border-amber-200 rounded-sm p-3 mb-2" data-testid="change-orders-panel">
                <div className="text-[10px] font-bold uppercase tracking-wider text-amber-900 mb-2">Approved Change Orders Available</div>
                <div className="space-y-1">
                  {changeOrders.map((co) => (
                    <div key={co.id} className="flex items-center justify-between gap-2 text-sm" data-testid={`co-pick-${co.id}`}>
                      <div className="flex-1">
                        <span className="font-mono text-zinc-500 text-[11px] mr-2">{co.date}</span>
                        <span>{co.description}</span>
                        <span className="ml-2 font-mono font-bold text-blue-700">{formatCurrency(co.amount)}</span>
                      </div>
                      <button
                        onClick={() => addChangeOrderLine(co)}
                        className="inline-flex items-center gap-1 px-2 h-6 text-[10px] font-bold uppercase tracking-wider bg-blue-700 text-white hover:bg-blue-800 rounded-sm"
                        data-testid={`add-co-line-${co.id}`}
                      >
                        <Plus className="w-3 h-3" /> Add as Line
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="border border-zinc-200 rounded-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-zinc-50 text-left text-[10px] uppercase tracking-wider">
                    <th className="px-2 py-2">Description</th>
                    <th className="px-2 py-2 w-16 text-right">Qty</th>
                    <th className="px-2 py-2 w-28 text-right">Unit Price</th>
                    <th className="px-2 py-2 w-28 text-right">Amount</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {form.line_items.map((li, i) => (
                    <tr key={i} className="border-t border-zinc-100" data-testid={`line-item-${i}`}>
                      <td className="px-2 py-1">
                        <textarea value={li.description} onChange={(e) => updateLine(i, { description: e.target.value })} placeholder="Description (multi-line ok)" rows={1} className="w-full min-h-[34px] px-2 py-1 border border-transparent hover:border-zinc-300 focus:border-blue-700 focus:outline-none rounded-sm text-sm resize-y" data-testid={`line-desc-${i}`} />
                      </td>
                      <td className="px-2 py-1 text-right">
                        <input type="number" value={li.quantity} onChange={(e) => updateLine(i, { quantity: e.target.value })} className="w-full h-8 px-2 text-right border border-transparent hover:border-zinc-300 focus:border-blue-700 focus:outline-none rounded-sm text-sm font-mono" data-testid={`line-qty-${i}`} />
                      </td>
                      <td className="px-2 py-1 text-right">
                        <input type="number" value={li.unit_price} onChange={(e) => updateLine(i, { unit_price: e.target.value })} className="w-full h-8 px-2 text-right border border-transparent hover:border-zinc-300 focus:border-blue-700 focus:outline-none rounded-sm text-sm font-mono" data-testid={`line-unit-${i}`} />
                      </td>
                      <td className="px-2 py-1 text-right font-mono text-sm">{formatCurrency(li.amount)}</td>
                      <td className="text-right pr-1">
                        <button onClick={() => removeLine(i)} className="p-1 hover:bg-red-100 text-red-700 rounded-sm"><Trash2 className="w-3 h-3" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-zinc-950 bg-zinc-50">
                    <td colSpan={3} className="px-2 py-2 text-right text-[10px] font-bold uppercase tracking-wider">Total</td>
                    <td className="px-2 py-2 text-right font-mono font-bold">{formatCurrency(total)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Payment */}
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-blue-700 mb-2">Payment Tracking</div>
            <div className="grid grid-cols-4 gap-3">
              <div>
                <label className="text-[10px] uppercase tracking-wider text-zinc-500">Amount Paid</label>
                <input type="number" value={form.amount_paid} onChange={(e) => setForm({ ...form, amount_paid: e.target.value })} className="mt-1 w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm font-mono" data-testid="amount-paid" />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-zinc-500">Payment Date</label>
                <input type="date" value={form.payment_date} onChange={(e) => setForm({ ...form, payment_date: e.target.value })} className="mt-1 w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm" />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-zinc-500">Method</label>
                <select value={form.payment_method} onChange={(e) => setForm({ ...form, payment_method: e.target.value })} className="mt-1 w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm bg-white">
                  <option value="">—</option>
                  <option value="Check">Check</option>
                  <option value="ACH">ACH</option>
                  <option value="Wire">Wire</option>
                  <option value="Credit Card">Credit Card</option>
                  <option value="Cash">Cash</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-zinc-500">Reference / Check #</label>
                <input value={form.payment_reference} onChange={(e) => setForm({ ...form, payment_reference: e.target.value })} className="mt-1 w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm" />
              </div>
            </div>
            <div className="mt-2 text-xs text-zinc-500 font-mono">Balance Due: <span className="font-bold text-zinc-950">{formatCurrency(balance_due)}</span></div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Notes (appears on PDF)</label>
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} className="mt-1 w-full px-2 py-1.5 border border-zinc-300 rounded-sm text-sm" placeholder="Optional payment instructions, thank-you note, etc." data-testid="invoice-notes" />
          </div>
        </div>
        <div className="px-5 py-4 border-t border-zinc-200 flex justify-between items-center gap-2">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">{isNew ? "Save to generate invoice number" : `Status: ${form.status}`}</div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 h-9 text-xs font-bold uppercase tracking-wider border border-zinc-300 text-zinc-700 hover:border-zinc-950 rounded-sm">Cancel</button>
            <button disabled={saving} onClick={save} className="px-4 h-9 text-xs font-bold uppercase tracking-wider bg-blue-700 text-white hover:bg-blue-800 rounded-sm disabled:opacity-50" data-testid="save-invoice">
              {saving ? "Saving..." : (isNew ? "Create Invoice" : "Save Changes")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- Email modal ----------
function EmailInvoiceModal({ invoice, onClose, onSent }) {
  const [to, setTo] = useState(invoice.bill_to_email || "");
  const [cc, setCc] = useState(invoice.cc_email || "");
  const [aliases, setAliases] = useState([]);
  const [fromEmail, setFromEmail] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    api.get("/email-aliases").then((r) => {
      setAliases(r.data?.aliases || []);
      setFromEmail(r.data?.default || (r.data?.aliases?.[0] || ""));
    }).catch(() => {});
  }, []);

  const send = async () => {
    if (!to.trim()) { toast.error("Recipient email required"); return; }
    setSending(true);
    try {
      const r = await api.post(`/invoices/${invoice.id}/email`, { to_email: to, cc_email: cc, from_email: fromEmail });
      if (r.data?.mocked) {
        toast.warning(`Invoice marked Sent (email provider not yet configured — would send to ${to}${cc ? ` cc: ${cc}` : ""})`);
      } else {
        toast.success(r.data?.message || "Invoice emailed");
      }
      onSent();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-zinc-950/60 flex items-center justify-center p-4" onClick={onClose} data-testid="email-modal">
      <div className="bg-white w-full max-w-lg rounded-sm shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-zinc-200">
          <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-500">Email Invoice</div>
          <div className="font-heading text-xl font-black tracking-tight mt-1 font-mono">{invoice.invoice_number}</div>
          <div className="text-xs text-zinc-500 mt-1">{invoice.bill_to_company || invoice.bill_to_name} · {formatCurrency(invoice.balance_due)} due</div>
        </div>
        <div className="p-5 space-y-3">
          {aliases.length > 1 && (
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">From</label>
              <select value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} className="mt-1 w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm bg-white" data-testid="email-from">
                {aliases.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">To</label>
            <input type="email" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm" placeholder="customer@example.com" data-testid="email-to" />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">CC (optional)</label>
            <input type="email" value={cc} onChange={(e) => setCc(e.target.value)} className="mt-1 w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm" placeholder="you@yourcompany.com" data-testid="email-cc" />
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-sm p-3 text-[11px] text-blue-900">
            Sending from <b>{fromEmail || "finance@sealtechsolutions.co"}</b> via Gmail. PDF invoice will be attached automatically.
          </div>
        </div>
        <div className="px-5 py-4 border-t border-zinc-200 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 h-9 text-xs font-bold uppercase tracking-wider border border-zinc-300 text-zinc-700 hover:border-zinc-950 rounded-sm">Cancel</button>
          <button disabled={sending} onClick={send} className="inline-flex items-center gap-2 px-4 h-9 text-xs font-bold uppercase tracking-wider bg-blue-700 text-white hover:bg-blue-800 rounded-sm disabled:opacity-50" data-testid="send-email">
            <Send className="w-3.5 h-3.5" /> {sending ? "Sending..." : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}

const KpiCard = ({ label, value, hint, testId, accent }) => (
  <div className="bg-white border border-zinc-200 p-6 rounded-sm" data-testid={testId}>
    <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-500 mb-3">{label}</div>
    <div className={`font-heading text-3xl font-black tracking-tighter ${accent || "text-zinc-950"}`}>{value}</div>
    {hint && <div className="text-xs text-zinc-500 mt-2">{hint}</div>}
  </div>
);


// ---------- Statements of Account modal ----------
function StatementsModal({ onClose }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [emailModal, setEmailModal] = useState(null); // customer row

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await api.get("/customers-with-open-balance");
        if (alive) setRows(r.data);
      } catch (e) {
        toast.error(formatApiError(e?.response?.data?.detail) || e.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const grandTotal = rows.reduce((s, r) => s + Number(r.open_balance || 0), 0);

  const download = (row) => {
    const token = localStorage.getItem("crm_token");
    window.open(`${API}/contacts/${row.customer_id}/statement.pdf?token=${encodeURIComponent(token)}`, "_blank");
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start sm:items-center justify-center p-4 overflow-y-auto" data-testid="statements-modal">
      <div className="bg-white border border-zinc-200 rounded-sm w-full max-w-4xl my-8">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <FileText className="w-4 h-4 text-blue-700" />
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-700">Receivables</div>
            </div>
            <h2 className="font-heading text-2xl font-black tracking-tight">Statements of Account</h2>
            <div className="text-xs text-zinc-500 mt-1">Every customer with an open invoice balance. Download or email a per-customer aging statement.</div>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-950 text-xs uppercase tracking-wider font-bold" data-testid="statements-close">Close</button>
        </div>

        <div className="p-6">
          {loading ? (
            <div className="text-sm text-zinc-500 py-12 text-center">Loading customers…</div>
          ) : rows.length === 0 ? (
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-sm p-6 text-sm">
              <b>All clear.</b> No customers currently have an open invoice balance.
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between text-xs uppercase tracking-wider text-zinc-500 mb-3 px-1">
                <div>{rows.length} customer{rows.length === 1 ? "" : "s"} with open balance</div>
                <div>
                  Total outstanding: <span className="font-bold text-zinc-950" data-testid="statements-grand-total">{formatCurrency(grandTotal)}</span>
                </div>
              </div>
              <div className="border border-zinc-200 rounded-sm overflow-hidden">
                <table className="w-full text-sm" data-testid="statements-table">
                  <thead className="bg-zinc-50 border-b-2 border-zinc-950 text-left text-[10px] uppercase tracking-wider">
                    <tr>
                      <th className="py-3 px-4">Customer</th>
                      <th className="py-3 px-4">Email</th>
                      <th className="py-3 px-4 text-center">Open Invoices</th>
                      <th className="py-3 px-4 text-right">Open Balance</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {rows.map((r) => (
                      <tr key={r.customer_id} className="hover:bg-zinc-50" data-testid={`statement-row-${r.customer_id}`}>
                        <td className="py-3 px-4">
                          <div className="font-bold">{r.company_name || r.contact_name || "—"}</div>
                          {r.company_name && r.contact_name && (
                            <div className="text-[11px] text-zinc-500">{r.contact_name}</div>
                          )}
                        </td>
                        <td className="py-3 px-4 text-xs text-zinc-600 font-mono break-all">{r.email || <span className="text-zinc-400 italic">— no email on file —</span>}</td>
                        <td className="py-3 px-4 text-center font-mono">{r.invoice_count}</td>
                        <td className="py-3 px-4 text-right font-bold font-mono text-blue-700">{formatCurrency(r.open_balance)}</td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2 justify-end">
                            <button
                              onClick={() => download(r)}
                              className="inline-flex items-center gap-1.5 border border-zinc-300 px-2.5 h-8 text-[10px] font-bold uppercase tracking-wider hover:bg-zinc-50 rounded-sm"
                              data-testid={`statement-download-${r.customer_id}`}
                              title="Download Statement PDF"
                            >
                              <Download className="w-3.5 h-3.5" /> PDF
                            </button>
                            <button
                              onClick={() => setEmailModal(r)}
                              disabled={!r.email}
                              className="inline-flex items-center gap-1.5 bg-blue-700 text-white px-2.5 h-8 text-[10px] font-bold uppercase tracking-wider hover:bg-blue-800 disabled:opacity-40 disabled:cursor-not-allowed rounded-sm"
                              data-testid={`statement-email-${r.customer_id}`}
                              title={r.email ? "Email Statement to customer" : "Add an email to this customer's contact first"}
                            >
                              <Send className="w-3.5 h-3.5" /> Email
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      {emailModal && (
        <EmailStatementModal
          customer={emailModal}
          onClose={() => setEmailModal(null)}
          onSent={() => setEmailModal(null)}
        />
      )}
    </div>
  );
}


function EmailStatementModal({ customer, onClose, onSent }) {
  const [toEmail, setToEmail] = useState(customer.email || "");
  const [ccEmail, setCcEmail] = useState("");
  const [aliases, setAliases] = useState([]);
  const [fromEmail, setFromEmail] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    api.get("/email-aliases").then((r) => {
      setAliases(r.data?.aliases || []);
      setFromEmail(r.data?.default || (r.data?.aliases?.[0] || ""));
    }).catch(() => {});
  }, []);

  const send = async () => {
    if (!toEmail.trim()) { toast.error("Enter a recipient email"); return; }
    setSending(true);
    try {
      const r = await api.post(`/contacts/${customer.customer_id}/statement/email`, { to_email: toEmail.trim(), cc_email: ccEmail.trim(), from_email: fromEmail });
      toast.success(r.data.message || "Statement sent");
      onSent();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setSending(false);
    }
  };

  const label = customer.company_name || customer.contact_name || "Customer";

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" data-testid="email-statement-modal">
      <div className="bg-white border border-zinc-200 rounded-sm w-full max-w-md p-6">
        <div className="mb-5 pb-4 border-b border-zinc-200">
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-700 mb-1">Email Statement</div>
          <div className="font-heading text-lg font-black tracking-tight">{label}</div>
          <div className="text-xs text-zinc-500 mt-1">Open balance: <span className="font-bold text-zinc-950 font-mono">{formatCurrency(customer.open_balance)}</span> across {customer.invoice_count} invoice{customer.invoice_count === 1 ? "" : "s"}</div>
        </div>
        <div className="space-y-3">
          {aliases.length > 1 && (
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-600 mb-1">From</label>
              <select value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} className="w-full h-10 px-3 border border-zinc-300 rounded-sm text-sm bg-white" data-testid="statement-from-email">
                {aliases.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-600 mb-1">To *</label>
            <input value={toEmail} onChange={(e) => setToEmail(e.target.value)} className="w-full h-10 px-3 border border-zinc-300 rounded-sm text-sm" data-testid="statement-to-email" />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-600 mb-1">CC</label>
            <input value={ccEmail} onChange={(e) => setCcEmail(e.target.value)} placeholder="(optional)" className="w-full h-10 px-3 border border-zinc-300 rounded-sm text-sm" data-testid="statement-cc-email" />
          </div>
        </div>
        <div className="mt-6 flex items-center justify-end gap-2">
          <button onClick={onClose} disabled={sending} className="px-4 h-10 text-xs font-bold uppercase tracking-wider border border-zinc-300 rounded-sm hover:bg-zinc-50" data-testid="cancel-email-statement">Cancel</button>
          <button onClick={send} disabled={sending} className="inline-flex items-center gap-2 bg-blue-700 text-white px-4 h-10 text-xs font-bold uppercase tracking-wider hover:bg-blue-800 disabled:opacity-40 rounded-sm" data-testid="send-statement-email">
            <Send className="w-4 h-4" /> {sending ? "Sending..." : "Send Statement"}
          </button>
        </div>
      </div>
    </div>
  );
}
