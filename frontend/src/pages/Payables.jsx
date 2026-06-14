import React, { useEffect, useMemo, useState, useRef } from "react";
import { api, formatCurrency, formatApiError, API, showGlWarnings } from "@/lib/api";
import { Wallet, Plus, Search, Upload, Trash2, Eye, FileSpreadsheet, Send, AlertCircle } from "lucide-react";
import { toast } from "sonner";

const STATUS_STYLES = {
  Pending: "bg-amber-100 text-amber-800 border-amber-300",
  Approved: "bg-blue-100 text-blue-800 border-blue-300",
  Paid: "bg-emerald-100 text-emerald-800 border-emerald-300",
  Disputed: "bg-red-100 text-red-800 border-red-300",
  Void: "bg-zinc-100 text-zinc-500 border-zinc-300 line-through",
};

const TERMS_OPTIONS = ["Due on Receipt", "Net 15", "Net 30", "Net 60", "Custom"];

export default function Payables() {
  const [tab, setTab] = useState("bills"); // bills | report
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("Active");
  const [editor, setEditor] = useState(null);
  const [report, setReport] = useState(null);
  const [vendors, setVendors] = useState([]);
  const [deals, setDeals] = useState([]);
  const fileInputRef = useRef(null);
  const [parsing, setParsing] = useState(false);

  const loadBills = async () => {
    setLoading(true);
    try {
      const r = await api.get("/vendor-bills");
      setRows(r.data);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setLoading(false);
    }
  };

  const loadReport = async () => {
    try {
      const r = await api.get("/payables/report");
      setReport(r.data);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    }
  };

  useEffect(() => {
    loadBills();
    loadReport();
    api.get("/vendors").then((r) => setVendors(r.data)).catch(() => {});
    api.get("/deals").then((r) => setDeals(r.data)).catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = rows;
    if (statusFilter === "Active") {
      out = out.filter((r) => r.status === "Pending" || r.status === "Approved");
    } else if (statusFilter !== "All") {
      out = out.filter((r) => r.status === statusFilter);
    }
    if (q) {
      out = out.filter((r) =>
        (r.vendor_name || "").toLowerCase().includes(q) ||
        (r.bill_number || "").toLowerCase().includes(q) ||
        (r.line_items || []).some((li) => (li.description || "").toLowerCase().includes(q))
      );
    }
    return out;
  }, [rows, search, statusFilter]);

  const totals = useMemo(() => {
    const activeBills = rows.filter((r) => r.status === "Pending" || r.status === "Approved");
    const totalDue = activeBills.reduce((s, r) => s + (Number(r.total || 0) - Number(r.paid_amount || 0)), 0);
    const paid = rows.filter((r) => r.status === "Paid").reduce((s, r) => s + Number(r.paid_amount || 0), 0);
    return { totalDue, paid, activeCount: activeBills.length, totalCount: rows.length };
  }, [rows]);

  const handleUploadClick = () => fileInputRef.current?.click();

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ""; // allow re-upload of same file
    setParsing(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await api.post("/vendor-bills/parse", fd, { headers: { "Content-Type": "multipart/form-data" } });
      const { parsed, suggested_vendor_id, suggested_project_matches, attached_file_id } = r.data;
      // Convert parsed into editor form
      const li = (parsed.line_items || []).map((line, idx) => ({
        description: line.description,
        project_id: suggested_project_matches?.[idx] || "",
        quantity: line.quantity || 1,
        unit_price: line.unit_price || 0,
        amount: line.amount || 0,
      }));
      setEditor({
        vendor_id: suggested_vendor_id || "",
        vendor_name: parsed.vendor_name || "",
        bill_number: parsed.bill_number || "",
        bill_date: parsed.bill_date || "",
        due_date: parsed.due_date || "",
        terms: parsed.terms || "Due on Receipt",
        total: parsed.total || 0,
        subtotal: parsed.subtotal || 0,
        tax: parsed.tax || 0,
        notes: parsed.notes || "",
        line_items: li,
        attached_file_id: attached_file_id || null,
        parsed_by_ai: true,
        status: "Pending",
        _is_new: true,
      });
      toast.success(`Parsed ${parsed.vendor_name || "invoice"} — review and save`);
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || err.message);
    } finally {
      setParsing(false);
    }
  };

  const removeBill = async (b) => {
    if (!window.confirm(`Delete ${b.bill_number || "this bill"}?`)) return;
    try {
      await api.delete(`/vendor-bills/${b.id}`);
      toast.success("Deleted");
      loadBills();
      loadReport();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    }
  };

  const sendReportEmail = async () => {
    try {
      const r = await api.post("/payables/email", {});
      toast.success(`Report emailed to ${r.data.to}`);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    }
  };

  const downloadXlsx = async () => {
    const token = localStorage.getItem("crm_token");
    try {
      const r = await fetch(`${API}/payables/report.xlsx`, { headers: { Authorization: `Bearer ${token}` } });
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "sealtech-payables.xlsx";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      toast.error("Download failed");
    }
  };

  return (
    <div className="p-6 sm:p-8 animate-in fade-in duration-500" data-testid="payables-page">
      <input ref={fileInputRef} type="file" accept="application/pdf,image/*" onChange={handleFileChange} className="hidden" data-testid="upload-input" />

      <div className="flex items-start justify-between mb-8 pb-6 border-b border-zinc-200 gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Wallet className="w-4 h-4 text-blue-700" />
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-700">Payables</div>
          </div>
          <h1 className="font-heading text-3xl sm:text-4xl font-black tracking-tight">Vendor Bills</h1>
          <div className="mt-2 text-xs uppercase tracking-wider text-zinc-500">Upload, parse, and pay vendor invoices</div>
        </div>
        <div className="flex gap-2">
          <button onClick={handleUploadClick} disabled={parsing} className="inline-flex items-center gap-2 border border-blue-700 text-blue-700 px-4 h-10 text-xs font-bold uppercase tracking-wider hover:bg-blue-50 rounded-sm transition-colors disabled:opacity-50" data-testid="upload-bill-button">
            <Upload className="w-4 h-4" /> {parsing ? "Parsing…" : "Upload Invoice (AI)"}
          </button>
          <button onClick={() => setEditor({ _is_new: true, status: "Pending", terms: "Due on Receipt", bill_date: new Date().toISOString().slice(0, 10), line_items: [{ description: "", project_id: "", quantity: 1, unit_price: 0, amount: 0 }] })} className="inline-flex items-center gap-2 bg-blue-700 text-white px-4 h-10 text-xs font-bold uppercase tracking-wider hover:bg-blue-800 rounded-sm transition-colors" data-testid="manual-bill-button">
            <Plus className="w-4 h-4" /> Add Manual Bill
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="inline-flex border border-zinc-300 rounded-sm overflow-hidden mb-6">
        <button onClick={() => setTab("bills")} className={`px-4 h-9 text-[10px] font-bold uppercase tracking-wider ${tab === "bills" ? "bg-blue-700 text-white" : "bg-white hover:bg-zinc-50"}`} data-testid="tab-bills">All Bills</button>
        <button onClick={() => setTab("report")} className={`px-4 h-9 text-[10px] font-bold uppercase tracking-wider ${tab === "report" ? "bg-blue-700 text-white" : "bg-white hover:bg-zinc-50"}`} data-testid="tab-report">
          Friday Report
          {report && (report.overdue_count + report.due_this_week_count > 0) && (
            <span className="ml-2 inline-flex items-center justify-center min-w-[18px] h-[18px] text-[10px] font-bold bg-red-500 text-white rounded-full px-1">{report.overdue_count + report.due_this_week_count}</span>
          )}
        </button>
      </div>

      {tab === "bills" && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <KpiCard label="Active Bills" value={totals.activeCount} hint={`${totals.totalCount} total in history`} testId="kpi-bills-count" />
            <KpiCard label="Outstanding" value={formatCurrency(totals.totalDue)} accent="text-red-700" testId="kpi-bills-outstanding" />
            <KpiCard label="Paid (All-Time)" value={formatCurrency(totals.paid)} accent="text-emerald-700" testId="kpi-bills-paid" />
            <KpiCard label="Overdue + Due 7d" value={report ? (report.overdue_count + report.due_this_week_count) : 0} hint="Click 'Friday Report' tab" accent="text-orange-700" testId="kpi-bills-week" />
          </div>

          {/* Filters */}
          <div className="bg-white border border-zinc-200 rounded-sm p-4 mb-6">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-[240px] relative">
                <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input type="text" placeholder="Search vendor, bill #, line item..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full h-9 pl-9 pr-3 border border-zinc-300 rounded-sm text-sm" data-testid="bills-search" />
              </div>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-9 px-3 border border-zinc-300 rounded-sm text-sm bg-white" data-testid="bills-status-filter">
                <option value="Active">Active (Pending + Approved)</option>
                <option value="All">All Statuses (Show History)</option>
                <option value="Pending">Pending</option>
                <option value="Approved">Approved</option>
                <option value="Paid">Paid</option>
                <option value="Disputed">Disputed</option>
                <option value="Void">Void</option>
              </select>
            </div>
          </div>

          {/* Table */}
          <div className="bg-white border border-zinc-200 rounded-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="bills-table">
                <thead>
                  <tr className="border-b-2 border-zinc-950 text-left text-[10px] uppercase tracking-wider bg-zinc-50">
                    <th className="py-3 px-4">Vendor</th>
                    <th className="py-3 px-4">Bill #</th>
                    <th className="py-3 px-4">Bill Date</th>
                    <th className="py-3 px-4">Due Date</th>
                    <th className="py-3 px-4">Projects</th>
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
                    <tr><td colSpan={9} className="py-8 text-center text-sm text-zinc-500">No bills yet. Click <span className="font-bold">Upload Invoice (AI)</span> or <span className="font-bold">Add Manual Bill</span>.</td></tr>
                  ) : (
                    filtered.map((r) => {
                      const balance = Number(r.total || 0) - Number(r.paid_amount || 0);
                      const projectList = [...new Set((r.line_items || []).map((li) => li.project_title).filter(Boolean))];
                      return (
                        <tr key={r.id} className="border-b border-zinc-100 hover:bg-blue-50/40" data-testid={`bill-row-${r.id}`}>
                          <td className="py-3 px-4">
                            <button onClick={() => setEditor({ ...r, _is_new: false })} className="font-bold text-zinc-950 hover:text-blue-700">{r.vendor_name || "—"}</button>
                            {r.parsed_by_ai && <span className="ml-2 text-[9px] uppercase tracking-wider px-1.5 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-sm">AI</span>}
                          </td>
                          <td className="py-3 px-4 font-mono text-zinc-700">{r.bill_number || "—"}</td>
                          <td className="py-3 px-4 font-mono text-zinc-700">{r.bill_date}</td>
                          <td className="py-3 px-4 font-mono">{r.due_date}</td>
                          <td className="py-3 px-4 text-zinc-700 text-[11px]">{projectList.length ? projectList.slice(0, 2).join(" · ") + (projectList.length > 2 ? ` +${projectList.length - 2}` : "") : "—"}</td>
                          <td className="py-3 px-4 text-right font-mono">{formatCurrency(r.total)}</td>
                          <td className="py-3 px-4 text-right font-mono font-bold">{formatCurrency(balance)}</td>
                          <td className="py-3 px-4">
                            <span className={`inline-flex items-center px-2 h-6 text-[10px] font-bold uppercase tracking-wider border rounded-sm ${STATUS_STYLES[r.status] || STATUS_STYLES.Pending}`}>{r.status}</span>
                          </td>
                          <td className="py-3 px-4 text-right">
                            <div className="inline-flex items-center gap-1">
                              <button onClick={() => setEditor({ ...r, _is_new: false })} title="View / Edit" className="p-1.5 hover:bg-zinc-100 rounded-sm" data-testid={`view-bill-${r.id}`}><Eye className="w-3.5 h-3.5 text-zinc-700" /></button>
                              <button onClick={() => removeBill(r)} title="Delete" className="p-1.5 hover:bg-red-100 text-red-700 rounded-sm" data-testid={`del-bill-${r.id}`}><Trash2 className="w-3.5 h-3.5" /></button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {tab === "report" && report && (
        <div className="space-y-6" data-testid="friday-report">
          <div className="flex justify-between items-center flex-wrap gap-2">
            <div className="text-sm text-zinc-700">
              Showing all bills due through <span className="font-bold font-mono">{report.horizon}</span> (today + 7 days), plus everything currently overdue.
              <br />
              <span className="text-[11px] text-zinc-500">📅 Auto-emailed Friday 7am Mountain to <code className="bg-zinc-100 px-1.5 py-0.5 rounded">finance@sealtechsolutions.co</code></span>
            </div>
            <div className="flex gap-2">
              <button onClick={downloadXlsx} className="inline-flex items-center gap-2 border border-zinc-300 px-4 h-10 text-xs font-bold uppercase tracking-wider hover:border-zinc-950 rounded-sm" data-testid="export-report-xlsx"><FileSpreadsheet className="w-4 h-4" /> Excel</button>
              <button onClick={sendReportEmail} className="inline-flex items-center gap-2 bg-blue-700 text-white px-4 h-10 text-xs font-bold uppercase tracking-wider hover:bg-blue-800 rounded-sm" data-testid="email-report-button"><Send className="w-4 h-4" /> Email Report Now</button>
            </div>
          </div>

          {/* Overdue section */}
          <ReportSection title="Overdue" count={report.overdue_count} total={report.overdue_total} groups={report.overdue} color="red" emptyMsg="Nothing overdue. ✓" />

          {/* Due this week section */}
          <ReportSection title="Due This Week" count={report.due_this_week_count} total={report.due_this_week_total} groups={report.due_this_week} color="amber" emptyMsg="Nothing due in the next 7 days. ✓" />
        </div>
      )}

      {editor && (
        <BillEditor
          bill={editor}
          vendors={vendors}
          deals={deals}
          onClose={() => setEditor(null)}
          onSaved={() => { setEditor(null); loadBills(); loadReport(); }}
        />
      )}
    </div>
  );
}

function ReportSection({ title, count, total, groups, color, emptyMsg }) {
  const colors = {
    red: { border: "border-red-300", bg: "bg-red-50", text: "text-red-700", header: "bg-red-700" },
    amber: { border: "border-amber-300", bg: "bg-amber-50", text: "text-amber-700", header: "bg-amber-600" },
  }[color] || { border: "border-zinc-300", bg: "bg-zinc-50", text: "text-zinc-700", header: "bg-zinc-700" };

  return (
    <div className={`bg-white border ${colors.border} rounded-sm overflow-hidden`} data-testid={`report-section-${color}`}>
      <div className={`px-4 py-3 ${colors.header} text-white flex justify-between items-center`}>
        <div>
          <h2 className="font-heading text-base font-bold uppercase tracking-wider">{title}</h2>
          <div className="text-[11px] opacity-90">{count} bill{count !== 1 ? "s" : ""}</div>
        </div>
        <div className="font-mono font-bold text-lg">{formatCurrency(total)}</div>
      </div>
      {groups.length === 0 ? (
        <div className="p-6 text-center text-sm text-zinc-500">{emptyMsg}</div>
      ) : (
        <div className="divide-y divide-zinc-100">
          {groups.map((grp) => (
            <div key={grp.vendor_id || grp.vendor_name} className="p-4">
              <div className="flex justify-between items-baseline mb-2">
                <div className="font-bold text-zinc-950">{grp.vendor_name}</div>
                <div className={`font-mono font-bold ${colors.text}`}>{formatCurrency(grp.total)}</div>
              </div>
              <ul className="text-sm space-y-1">
                {grp.bills.map((b) => {
                  const balance = Number(b.total || 0) - Number(b.paid_amount || 0);
                  return (
                    <li key={b.id} className="flex justify-between text-zinc-700">
                      <span className="font-mono text-[12px] text-zinc-500">{b.bill_number || "—"} · {b.bill_date} · due {b.due_date}</span>
                      <span className="font-mono font-bold">{formatCurrency(balance)}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Bill Editor ----------
function BillEditor({ bill, vendors, deals, onClose, onSaved }) {
  const isNew = bill._is_new;
  const [form, setForm] = useState(() => ({
    vendor_id: bill.vendor_id || "",
    vendor_name: bill.vendor_name || "",
    bill_number: bill.bill_number || "",
    bill_date: bill.bill_date || new Date().toISOString().slice(0, 10),
    received_date: bill.received_date || new Date().toISOString().slice(0, 10),
    due_date: bill.due_date || "",
    terms: bill.terms || "Due on Receipt",
    total: bill.total || 0,
    subtotal: bill.subtotal || 0,
    tax: bill.tax || 0,
    shipping: bill.shipping || 0,
    status: bill.status || "Pending",
    notes: bill.notes || "",
    attached_file_id: bill.attached_file_id || null,
    parsed_by_ai: !!bill.parsed_by_ai,
    line_items: bill.line_items?.length ? bill.line_items.map((li) => ({ ...li })) : [{ description: "", project_id: "", quantity: 1, unit_price: 0, amount: 0 }],
    paid_amount: bill.paid_amount || 0,
    paid_date: bill.paid_date || "",
    paid_method: bill.paid_method || "",
    paid_reference: bill.paid_reference || "",
    entity_id: bill.entity_id || "",
    counter_entity_id: bill.counter_entity_id || "",
  }));
  const [saving, setSaving] = useState(false);
  const [entities, setEntities] = useState([]);

  // Load Books entities for the entity picker
  useEffect(() => {
    api.get("/books/entities").then((r) => {
      setEntities(r.data || []);
      if (!bill.entity_id) {
        const parent = (r.data || []).find((e) => e.is_parent);
        if (parent) setForm((f) => ({ ...f, entity_id: f.entity_id || parent.id }));
      }
    }).catch(() => setEntities([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateLine = (idx, patch) => {
    const items = [...form.line_items];
    items[idx] = { ...items[idx], ...patch };
    const qty = Number(items[idx].quantity || 0);
    const up = Number(items[idx].unit_price || 0);
    if ("quantity" in patch || "unit_price" in patch) {
      items[idx].amount = qty * up;
    }
    setForm({ ...form, line_items: items });
  };
  const addLine = () => setForm({ ...form, line_items: [...form.line_items, { description: "", project_id: "", quantity: 1, unit_price: 0, amount: 0 }] });
  const removeLine = (idx) => setForm({ ...form, line_items: form.line_items.filter((_, i) => i !== idx) });

  // Onload, snap vendor_name when vendor_id picked
  useEffect(() => {
    if (form.vendor_id) {
      const v = vendors.find((x) => x.id === form.vendor_id);
      if (v && form.vendor_name !== v.name) setForm((f) => ({ ...f, vendor_name: v.name }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.vendor_id, vendors.length]);

  const subtotal = form.line_items.reduce((s, li) => s + Number(li.amount || 0), 0);
  const total = subtotal + Number(form.tax || 0) + Number(form.shipping || 0);

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        ...form,
        total: form.total > 0 ? Number(form.total) : total,
        line_items: form.line_items.map((li) => ({ ...li, quantity: Number(li.quantity || 0), unit_price: Number(li.unit_price || 0), amount: Number(li.amount || 0) })),
      };
      if (isNew) {
        const r = await api.post("/vendor-bills", payload);
        toast.success(`Bill saved`);
        showGlWarnings(toast, r.data);
      } else {
        const r = await api.put(`/vendor-bills/${bill.id}`, payload);
        toast.success("Bill updated");
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
    <div className="fixed inset-0 z-50 bg-zinc-950/60 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose} data-testid="bill-editor">
      <div className="bg-white w-full max-w-5xl rounded-sm shadow-xl my-8" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-zinc-200 flex items-center justify-between">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-500">{isNew ? "New Vendor Bill" : "Edit Vendor Bill"}</div>
            <div className="font-heading text-xl font-black tracking-tight mt-1">{form.vendor_name || "Pick a vendor…"}</div>
          </div>
          <div className="flex items-center gap-3">
            {form.parsed_by_ai && (
              <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider px-2 py-1 bg-blue-50 text-blue-700 border border-blue-200 rounded-sm">
                <AlertCircle className="w-3 h-3" /> Parsed by AI — Review carefully
              </span>
            )}
            <button onClick={onClose} className="text-zinc-500 hover:text-zinc-950 text-xl">×</button>
          </div>
        </div>

        <div className="p-5 space-y-5">
          {/* Books entity picker */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Books Entity (GL posting)</label>
              <select
                value={form.entity_id}
                onChange={(e) => setForm({ ...form, entity_id: e.target.value })}
                className="mt-1 w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm bg-white"
                data-testid="bill-entity-select"
              >
                <option value="">— No GL Posting —</option>
                {entities.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}{e.is_parent ? "  (Parent)" : ""}{e.role ? `  — ${e.role}` : ""}
                  </option>
                ))}
              </select>
              <div className="text-[10px] text-zinc-500 mt-1">COGS &amp; A/P post to this entity's books.</div>
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Counter Entity (Inter-Co)</label>
              <select
                value={form.counter_entity_id}
                onChange={(e) => setForm({ ...form, counter_entity_id: e.target.value })}
                className="mt-1 w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm bg-white"
                disabled={!form.entity_id}
                data-testid="bill-counter-entity-select"
              >
                <option value="">— Not Inter-Company —</option>
                {entities.filter((e) => e.id !== form.entity_id).map((e) => (
                  <option key={e.id} value={e.id}>{e.name}</option>
                ))}
              </select>
              <div className="text-[10px] text-zinc-500 mt-1">If buying from another SealTech entity → posts via 6700/2900 and auto-mirrors 1900/4900.</div>
            </div>
          </div>

          {/* Vendor + Bill Info */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="lg:col-span-2">
              <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Vendor</label>
              <select value={form.vendor_id} onChange={(e) => setForm({ ...form, vendor_id: e.target.value })} className="mt-1 w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm bg-white" data-testid="bill-vendor">
                <option value="">— Pick Vendor —</option>
                {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
              {form.parsed_by_ai && !form.vendor_id && form.vendor_name && (
                <div className="mt-1 text-[10px] text-amber-700">⚠ AI extracted "{form.vendor_name}" — no match found. Pick or create a vendor.</div>
              )}
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Bill #</label>
              <input value={form.bill_number} onChange={(e) => setForm({ ...form, bill_number: e.target.value })} className="mt-1 w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm font-mono" data-testid="bill-number" />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Status</label>
              <select value={form.status} onChange={(e) => {
                const next = e.target.value;
                const patch = { status: next };
                if (next === "Paid") {
                  // Auto-fill paid_amount and paid_date when marking Paid
                  const total = Number(form.total || 0) || form.line_items.reduce((s, li) => s + Number(li.amount || 0), 0) + Number(form.tax || 0);
                  if (Number(form.paid_amount || 0) < total - 0.01) patch.paid_amount = total;
                  if (!form.paid_date) patch.paid_date = new Date().toISOString().slice(0, 10);
                }
                setForm({ ...form, ...patch });
              }} className="mt-1 w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm bg-white" data-testid="bill-status">
                {["Pending", "Approved", "Paid", "Disputed", "Void"].map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
          </div>

          {/* Dates + Terms */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Bill Date</label>
              <input type="date" value={form.bill_date} onChange={(e) => setForm({ ...form, bill_date: e.target.value })} className="mt-1 w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm" data-testid="bill-date" />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Terms</label>
              <select value={form.terms} onChange={(e) => setForm({ ...form, terms: e.target.value })} className="mt-1 w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm bg-white" data-testid="bill-terms">
                {TERMS_OPTIONS.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Due Date</label>
              <input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} className="mt-1 w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm font-mono" data-testid="bill-due" />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Received Date</label>
              <input type="date" value={form.received_date} onChange={(e) => setForm({ ...form, received_date: e.target.value })} className="mt-1 w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm" />
            </div>
          </div>

          {/* Line Items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] font-bold uppercase tracking-wider text-blue-700">Line Items — Assign to Project(s)</div>
              <button onClick={addLine} className="inline-flex items-center gap-1 px-2 h-7 text-[10px] font-bold uppercase tracking-wider border border-zinc-300 hover:border-zinc-950 rounded-sm"><Plus className="w-3 h-3" /> Add Line</button>
            </div>
            <div className="border border-zinc-200 rounded-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-zinc-50 text-left text-[10px] uppercase tracking-wider">
                    <th className="px-2 py-2">Description</th>
                    <th className="px-2 py-2 w-56">Project</th>
                    <th className="px-2 py-2 w-16 text-right">Qty</th>
                    <th className="px-2 py-2 w-28 text-right">Unit Price</th>
                    <th className="px-2 py-2 w-28 text-right">Amount</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {form.line_items.map((li, i) => (
                    <tr key={i} className="border-t border-zinc-100" data-testid={`bill-line-${i}`}>
                      <td className="px-2 py-1">
                        <textarea value={li.description} onChange={(e) => updateLine(i, { description: e.target.value })} placeholder="Description" rows={1} className="w-full min-h-[34px] px-2 py-1 border border-transparent hover:border-zinc-300 focus:border-blue-700 focus:outline-none rounded-sm text-sm resize-y" />
                      </td>
                      <td className="px-2 py-1">
                        <select value={li.project_id || ""} onChange={(e) => updateLine(i, { project_id: e.target.value })} className="w-full h-8 px-2 border border-transparent hover:border-zinc-300 focus:border-blue-700 focus:outline-none rounded-sm text-sm bg-white" data-testid={`bill-line-project-${i}`}>
                          <option value="">— None —</option>
                          {deals.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-1 text-right">
                        <input type="number" value={li.quantity} onChange={(e) => updateLine(i, { quantity: e.target.value })} className="w-full h-8 px-2 text-right border border-transparent hover:border-zinc-300 focus:border-blue-700 focus:outline-none rounded-sm text-sm font-mono" />
                      </td>
                      <td className="px-2 py-1 text-right">
                        <input type="number" value={li.unit_price} onChange={(e) => updateLine(i, { unit_price: e.target.value })} className="w-full h-8 px-2 text-right border border-transparent hover:border-zinc-300 focus:border-blue-700 focus:outline-none rounded-sm text-sm font-mono" />
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
                    <td colSpan={4} className="px-2 py-2 text-right text-[10px] font-bold uppercase tracking-wider">Subtotal</td>
                    <td className="px-2 py-2 text-right font-mono">{formatCurrency(subtotal)}</td>
                    <td></td>
                  </tr>
                  <tr className="bg-zinc-50">
                    <td colSpan={4} className="px-2 py-2 text-right text-[10px] font-bold uppercase tracking-wider">Shipping</td>
                    <td className="px-2 py-2 text-right">
                      <input type="number" value={form.shipping} onChange={(e) => setForm({ ...form, shipping: Number(e.target.value || 0) })} className="w-full h-7 px-2 text-right border border-zinc-300 rounded-sm text-sm font-mono" data-testid="bill-shipping" />
                    </td>
                    <td></td>
                  </tr>
                  <tr className="bg-zinc-50">
                    <td colSpan={4} className="px-2 py-2 text-right text-[10px] font-bold uppercase tracking-wider">Tax</td>
                    <td className="px-2 py-2 text-right">
                      <input type="number" value={form.tax} onChange={(e) => setForm({ ...form, tax: Number(e.target.value || 0) })} className="w-full h-7 px-2 text-right border border-zinc-300 rounded-sm text-sm font-mono" />
                    </td>
                    <td></td>
                  </tr>
                  <tr className="bg-zinc-50 border-t border-zinc-300">
                    <td colSpan={4} className="px-2 py-2 text-right text-[10px] font-bold uppercase tracking-wider">Total (Override)</td>
                    <td className="px-2 py-2 text-right">
                      <input type="number" value={form.total} onChange={(e) => setForm({ ...form, total: Number(e.target.value || 0) })} placeholder={String(total)} className="w-full h-7 px-2 text-right border border-zinc-300 rounded-sm text-sm font-mono font-bold" data-testid="bill-total" />
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Payment tracking */}
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-blue-700 mb-2">Payment Tracking</div>
            <div className="grid grid-cols-4 gap-3">
              <div>
                <label className="text-[10px] uppercase tracking-wider text-zinc-500">Amount Paid</label>
                <input type="number" value={form.paid_amount} onChange={(e) => setForm({ ...form, paid_amount: e.target.value })} className="mt-1 w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm font-mono" />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-zinc-500">Paid Date</label>
                <input type="date" value={form.paid_date} onChange={(e) => setForm({ ...form, paid_date: e.target.value })} className="mt-1 w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm" />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-zinc-500">Method</label>
                <select value={form.paid_method} onChange={(e) => setForm({ ...form, paid_method: e.target.value })} className="mt-1 w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm bg-white">
                  <option value="">—</option>
                  <option value="Check">Check</option>
                  <option value="ACH">ACH</option>
                  <option value="Wire">Wire</option>
                  <option value="Credit Card">Credit Card</option>
                  <option value="Cash">Cash</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-zinc-500">Reference / Check #</label>
                <input value={form.paid_reference} onChange={(e) => setForm({ ...form, paid_reference: e.target.value })} className="mt-1 w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm" />
              </div>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Notes</label>
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} className="mt-1 w-full px-2 py-1.5 border border-zinc-300 rounded-sm text-sm" />
          </div>
        </div>

        <div className="px-5 py-4 border-t border-zinc-200 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 h-9 text-xs font-bold uppercase tracking-wider border border-zinc-300 text-zinc-700 hover:border-zinc-950 rounded-sm">Cancel</button>
          <button disabled={saving} onClick={save} className="px-4 h-9 text-xs font-bold uppercase tracking-wider bg-blue-700 text-white hover:bg-blue-800 rounded-sm disabled:opacity-50" data-testid="save-bill">
            {saving ? "Saving..." : (isNew ? "Save Bill" : "Save Changes")}
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
