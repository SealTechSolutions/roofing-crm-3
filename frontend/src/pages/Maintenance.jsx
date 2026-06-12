import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatCurrency, formatApiError, API } from "@/lib/api";
import { Wrench, Search, FileSpreadsheet, FileText, Plus } from "lucide-react";
import { toast } from "sonner";

const STATUS_STYLES = {
  Overdue: "bg-red-100 text-red-800 border-red-300",
  "Due Soon": "bg-orange-100 text-orange-800 border-orange-300",
  Upcoming: "bg-emerald-100 text-emerald-800 border-emerald-300",
  Unscheduled: "bg-zinc-100 text-zinc-700 border-zinc-300",
};

export default function Maintenance() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [sortBy, setSortBy] = useState("next_maintenance_date");
  const [logModalFor, setLogModalFor] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get("/maintenance");
      setRows(r.data);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = rows;
    if (statusFilter !== "All") out = out.filter((r) => r.status === statusFilter);
    if (q) {
      out = out.filter((r) =>
        (r.contact_name || "").toLowerCase().includes(q) ||
        (r.title || "").toLowerCase().includes(q) ||
        (r.property_address || "").toLowerCase().includes(q) ||
        (r.contact_phone || "").toLowerCase().includes(q)
      );
    }
    out = [...out].sort((a, b) => {
      const va = a[sortBy] || "";
      const vb = b[sortBy] || "";
      if (sortBy === "maintenance_rate") return Number(vb) - Number(va);
      // empty dates sort last
      if (!va) return 1;
      if (!vb) return -1;
      return String(va).localeCompare(String(vb));
    });
    return out;
  }, [rows, search, statusFilter, sortBy]);

  const totals = useMemo(() => {
    const annualRev = filtered.reduce((s, r) => s + Number(r.maintenance_rate || 0), 0);
    const overdue = filtered.filter((r) => r.status === "Overdue").length;
    const due30 = filtered.filter((r) => r.status === "Due Soon" || r.status === "Overdue").length;
    return { annualRev, overdue, due30, count: filtered.length };
  }, [filtered]);

  const [ytdIncome, setYtdIncome] = useState(0);
  useEffect(() => {
    api.get("/dashboard/revenue-by-type?window=ytd").then((r) => {
      const m = (r.data?.rows || []).find((x) => x.project_type === "Maintenance");
      setYtdIncome(m?.received || 0);
    }).catch(() => setYtdIncome(0));
  }, [rows]);

  const downloadList = async (fmt) => {
    const token = localStorage.getItem("crm_token");
    try {
      const r = await fetch(`${API}/maintenance/export.${fmt}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) throw new Error(`Export failed (${r.status})`);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `sealtech-maintenance.${fmt}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      toast.error(e.message || "Download failed");
    }
  };

  return (
    <div className="p-6 sm:p-8 animate-in fade-in duration-500" data-testid="maintenance-page">
      <div className="flex items-start justify-between mb-8 pb-6 border-b border-zinc-200 gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Wrench className="w-4 h-4 text-blue-700" />
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-700">Recurring</div>
          </div>
          <h1 className="font-heading text-3xl sm:text-4xl font-black tracking-tight">Maintenance Plans</h1>
          <div className="mt-2 text-xs uppercase tracking-wider text-zinc-500">Track annual visits, due dates, and recurring revenue</div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => downloadList("xlsx")}
            className="inline-flex items-center gap-2 border border-zinc-300 text-zinc-700 px-4 h-10 text-xs font-bold uppercase tracking-wider hover:border-zinc-950 rounded-sm transition-colors"
            data-testid="export-maintenance-xlsx"
          >
            <FileSpreadsheet className="w-4 h-4" /> Excel
          </button>
          <button
            onClick={() => downloadList("pdf")}
            className="inline-flex items-center gap-2 bg-zinc-950 text-white px-4 h-10 text-xs font-bold uppercase tracking-wider hover:bg-zinc-800 rounded-sm transition-colors"
            data-testid="export-maintenance-pdf"
          >
            <FileText className="w-4 h-4" /> PDF
          </button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        <KpiCard label="Customers on Plan" value={totals.count} testId="kpi-maint-count" />
        <KpiCard label="Annual Recurring Revenue" value={formatCurrency(totals.annualRev)} hint="Contracted rate" testId="kpi-maint-arr" accent="text-emerald-700" />
        <KpiCard label="Visits Income (YTD)" value={formatCurrency(ytdIncome)} hint="Actual income from logged visits" testId="kpi-maint-ytd-income" accent="text-emerald-700" />
        <KpiCard label="Due Within 30 Days" value={totals.due30} testId="kpi-maint-due30" accent="text-orange-700" />
        <KpiCard label="Overdue" value={totals.overdue} testId="kpi-maint-overdue" accent="text-red-700" />
      </div>

      {/* Filters */}
      <div className="bg-white border border-zinc-200 rounded-sm p-4 mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[240px] relative">
            <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by customer, property, phone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-9 pl-9 pr-3 border border-zinc-300 rounded-sm text-sm"
              data-testid="maintenance-search"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-9 px-3 border border-zinc-300 rounded-sm text-sm bg-white"
            data-testid="maintenance-status-filter"
          >
            <option value="All">All Statuses</option>
            <option value="Overdue">Overdue</option>
            <option value="Due Soon">Due Soon (≤30 days)</option>
            <option value="Upcoming">Upcoming</option>
            <option value="Unscheduled">Unscheduled</option>
          </select>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="h-9 px-3 border border-zinc-300 rounded-sm text-sm bg-white"
            data-testid="maintenance-sort"
          >
            <option value="next_maintenance_date">Sort: Next Due Date</option>
            <option value="contact_name">Sort: Customer Name</option>
            <option value="property_address">Sort: Property Address</option>
            <option value="maintenance_rate">Sort: Annual Rate (High→Low)</option>
            <option value="last_maintenance_date">Sort: Last Visit Date</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-zinc-200 rounded-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="maintenance-table">
            <thead>
              <tr className="border-b-2 border-zinc-950 text-left text-[10px] uppercase tracking-wider bg-zinc-50">
                <th className="py-3 px-4">Customer</th>
                <th className="py-3 px-4">Property</th>
                <th className="py-3 px-4 text-right">Annual Rate</th>
                <th className="py-3 px-4">Last Visit</th>
                <th className="py-3 px-4">Next Due</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Visits</th>
                <th className="py-3 px-4"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="py-8 text-center text-xs uppercase tracking-wider text-zinc-500">Loading...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="py-8 text-center text-sm text-zinc-500">No maintenance plans match. Toggle Maintenance Plan on a Project to see it here.</td></tr>
              ) : (
                filtered.map((r) => (
                  <tr key={r.id} className="border-b border-zinc-100 hover:bg-blue-50/40" data-testid={`maint-row-${r.id}`}>
                    <td className="py-3 px-4">
                      <div className="font-bold text-zinc-950">{r.contact_name || "—"}</div>
                      <div className="text-[11px] text-zinc-500">{r.contact_phone || ""}</div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="text-zinc-700">{r.property_name || r.title || "—"}</div>
                      <div className="text-[11px] text-zinc-500">{r.property_address || ""}</div>
                    </td>
                    <td className="py-3 px-4 text-right font-mono">{formatCurrency(r.maintenance_rate)}</td>
                    <td className="py-3 px-4 font-mono text-zinc-700">{r.last_maintenance_date || "—"}</td>
                    <td className="py-3 px-4 font-mono font-bold">{r.next_maintenance_date || "—"}</td>
                    <td className="py-3 px-4">
                      <span className={`inline-flex items-center px-2 h-6 text-[10px] font-bold uppercase tracking-wider border rounded-sm ${STATUS_STYLES[r.status]}`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-zinc-600">{r.visit_count}</td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          onClick={() => setLogModalFor(r)}
                          className="inline-flex items-center gap-1 px-2 h-7 text-[10px] font-bold uppercase tracking-wider bg-blue-700 text-white hover:bg-blue-800 rounded-sm"
                          data-testid={`log-visit-${r.id}`}
                        >
                          <Plus className="w-3 h-3" /> Log Visit
                        </button>
                        <Link
                          to={`/projects/${r.id}`}
                          className="px-2 h-7 inline-flex items-center text-[10px] font-bold uppercase tracking-wider border border-zinc-300 hover:border-zinc-950 rounded-sm"
                          data-testid={`open-project-${r.id}`}
                        >
                          Open
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {logModalFor && (
        <LogVisitModal
          row={logModalFor}
          onClose={() => setLogModalFor(null)}
          onSaved={() => { setLogModalFor(null); load(); }}
        />
      )}
    </div>
  );
}

function LogVisitModal({ row, onClose, onSaved }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState(row.maintenance_rate || 0);
  const [subs, setSubs] = useState([]);
  const [subId, setSubId] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get("/vendors?kind=Subcontractor").then((r) => setSubs(r.data)).catch(() => setSubs([]));
  }, []);

  const submit = async () => {
    if (!date) { toast.error("Visit date is required"); return; }
    setSaving(true);
    try {
      const payload = { visit_date: date, amount: Number(amount || 0), notes };
      if (subId) payload.subcontractor_id = subId;
      await api.post(`/deals/${row.id}/maintenance-visits`, payload);
      toast.success("Visit logged — next due date advanced");
      onSaved();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-zinc-950/60 flex items-center justify-center p-4" onClick={onClose} data-testid="log-visit-modal">
      <div className="bg-white w-full max-w-lg rounded-sm shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-zinc-200">
          <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-500">Log Maintenance Visit</div>
          <div className="font-heading text-xl font-black tracking-tight mt-1">{row.contact_name || row.title}</div>
          <div className="text-xs text-zinc-500 mt-0.5">{row.property_address}</div>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Visit Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm" data-testid="modal-visit-date" />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Amount ($)</label>
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1 w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm font-mono" data-testid="modal-visit-amount" />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Subcontractor</label>
            <select value={subId} onChange={(e) => setSubId(e.target.value)} className="mt-1 w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm bg-white" data-testid="modal-visit-sub">
              <option value="">— None / In-house —</option>
              {subs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="mt-1 w-full px-2 py-1.5 border border-zinc-300 rounded-sm text-sm" placeholder="What was done? Any findings?" data-testid="modal-visit-notes" />
          </div>
        </div>
        <div className="px-5 py-4 border-t border-zinc-200 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 h-9 text-xs font-bold uppercase tracking-wider border border-zinc-300 text-zinc-700 hover:border-zinc-950 rounded-sm" data-testid="modal-cancel">Cancel</button>
          <button disabled={saving} onClick={submit} className="px-4 h-9 text-xs font-bold uppercase tracking-wider bg-blue-700 text-white hover:bg-blue-800 rounded-sm disabled:opacity-50" data-testid="modal-save-visit">
            {saving ? "Saving..." : "Log Visit"}
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
