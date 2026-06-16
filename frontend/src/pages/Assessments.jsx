import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { toast } from "sonner";
import { ClipboardCheck, Plus, Search, FileText, Mail, Trash2, ExternalLink, Filter } from "lucide-react";

const STATUS_COLORS = {
  Draft: "bg-amber-100 text-amber-900 border-amber-300",
  Final: "bg-emerald-100 text-emerald-900 border-emerald-300",
};

export default function Assessments() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get("/assessments");
      setItems(r.data || []);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((a) => {
      if (statusFilter !== "All" && a.status !== statusFilter) return false;
      if (!q) return true;
      return (
        (a.property_name || "").toLowerCase().includes(q) ||
        (a.property_address || "").toLowerCase().includes(q) ||
        (a.prepared_for || "").toLowerCase().includes(q) ||
        (a.deal_title || "").toLowerCase().includes(q)
      );
    });
  }, [items, search, statusFilter]);

  const onDelete = async (a) => {
    if (!window.confirm(`Soft-delete the assessment for "${a.property_name || a.property_address || "Untitled"}"? It will land in Admin Trash.`)) return;
    try {
      await api.delete(`/assessments/${a.id}`);
      toast.success("Assessment moved to Trash");
      load();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    }
  };

  const onOpenPdf = (a) => {
    const token = localStorage.getItem("crm_token");
    const url = `${process.env.REACT_APP_BACKEND_URL}/api/assessments/${a.id}/pdf`;
    // Open the placeholder tab SYNCHRONOUSLY (still inside the click gesture)
    // so popup blockers don't silently swallow it. We update its URL after the
    // async fetch resolves.
    const newWin = window.open("", "_blank");
    if (!newWin) {
      toast.error("Browser blocked the pop-up. Allow pop-ups for this site, then try again.");
      return;
    }
    newWin.document.write("<title>Loading PDF…</title><p style=\"font-family:sans-serif;color:#666;padding:20px;\">Generating Assessment PDF — please wait…</p>");
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => {
        if (!r.ok) throw new Error(`PDF generation failed (HTTP ${r.status})`);
        return r.blob();
      })
      .then((blob) => {
        newWin.location.href = URL.createObjectURL(blob);
      })
      .catch((e) => {
        newWin.document.body.innerHTML = `<p style="font-family:sans-serif;color:#b00;padding:20px;">${e.message}</p>`;
        toast.error(`PDF generation failed: ${e.message}`);
      });
  };

  const counts = useMemo(() => ({
    all: items.length,
    draft: items.filter((a) => a.status === "Draft").length,
    final: items.filter((a) => a.status === "Final").length,
  }), [items]);

  return (
    <div className="p-8 max-w-7xl mx-auto" data-testid="assessments-page">
      {/* Header */}
      <div className="flex items-start gap-4 mb-6">
        <div className="w-12 h-12 rounded-sm bg-blue-700 flex items-center justify-center">
          <ClipboardCheck className="w-6 h-6 text-white" />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-black text-zinc-900 tracking-tight">Roof Assessments</h1>
          <p className="text-sm text-zinc-600 mt-1">Independent Roof Consulting &amp; Asset Management reports.</p>
        </div>
        <button
          onClick={() => navigate("/assessments/new")}
          className="inline-flex items-center gap-2 bg-blue-700 text-white px-4 h-10 text-xs font-bold uppercase tracking-wider hover:bg-blue-800 rounded-sm transition-colors"
          data-testid="new-assessment-btn"
        >
          <Plus className="w-4 h-4" /> New Assessment
        </button>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <KpiCard label="Total" value={counts.all} testId="kpi-total" />
        <KpiCard label="Draft" value={counts.draft} testId="kpi-draft" accent="text-amber-700" />
        <KpiCard label="Final" value={counts.final} testId="kpi-final" accent="text-emerald-700" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[260px]">
          <Search className="w-4 h-4 absolute left-3 top-3 text-zinc-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search property, client, deal..."
            className="w-full pl-9 pr-3 py-2 border border-zinc-300 text-sm focus:outline-none focus:border-blue-700"
            data-testid="assessments-search"
          />
        </div>
        <div className="flex items-center gap-2 text-xs">
          <Filter className="w-3.5 h-3.5 text-zinc-400" />
          {["All", "Draft", "Final"].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 text-xs font-bold uppercase tracking-wider border rounded-sm transition-colors ${
                statusFilter === s
                  ? "border-blue-700 bg-blue-700 text-white"
                  : "border-zinc-300 text-zinc-700 hover:border-zinc-500"
              }`}
              data-testid={`filter-${s.toLowerCase()}`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {loading && <div className="text-sm text-zinc-500 py-8">Loading...</div>}
      {!loading && filtered.length === 0 && (
        <div className="bg-white border border-zinc-200 p-12 text-center" data-testid="empty-state">
          <ClipboardCheck className="w-12 h-12 text-zinc-300 mx-auto mb-3" />
          <div className="text-lg font-bold text-zinc-700">No assessments yet</div>
          <div className="text-sm text-zinc-500 mt-1">Create your first Commercial Roof Assessment Report.</div>
          <button
            onClick={() => navigate("/assessments/new")}
            className="mt-4 inline-flex items-center gap-2 bg-blue-700 text-white px-4 py-2 text-xs font-bold uppercase tracking-wider hover:bg-blue-800"
          >
            <Plus className="w-4 h-4" /> Create Assessment
          </button>
        </div>
      )}
      {!loading && filtered.length > 0 && (
        <div className="bg-white border border-zinc-200" data-testid="assessments-table">
          <table className="w-full text-sm">
            <thead className="bg-zinc-100">
              <tr className="text-left text-[10px] font-bold uppercase tracking-widest text-zinc-600">
                <th className="px-4 py-3">Property</th>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3 text-center">Asset Score™</th>
                <th className="px-4 py-3 text-center">Condition</th>
                <th className="px-4 py-3 text-center">RSL</th>
                <th className="px-4 py-3 text-center">Cap Risk™</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => (
                <tr key={a.id} className="border-t border-zinc-100 hover:bg-blue-50/40 transition-colors" data-testid={`row-${a.id}`}>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => navigate(`/assessments/${a.id}`)}
                      className="text-left font-bold text-zinc-900 hover:text-blue-700"
                      data-testid={`open-${a.id}`}
                    >
                      {a.property_name || <span className="italic text-zinc-400">Untitled property</span>}
                    </button>
                    {a.property_address && (
                      <div className="text-xs text-zinc-500 mt-0.5">{a.property_address}</div>
                    )}
                    {a.deal_title && (
                      <div className="text-[10px] text-blue-700 mt-0.5 uppercase tracking-wider">Deal: {a.deal_title}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-zinc-700">{a.prepared_for || "—"}</td>
                  <td className="px-4 py-3 font-mono text-xs text-zinc-700">{a.assessment_date || "—"}</td>
                  <td className="px-4 py-3 text-center"><BandPill band={a.bands?.roof_asset_score} testId={`band-ras-${a.id}`} /></td>
                  <td className="px-4 py-3 text-center"><BandPill band={a.bands?.condition_rating} testId={`band-cond-${a.id}`} /></td>
                  <td className="px-4 py-3 text-center"><BandPill band={a.bands?.remaining_service_life} testId={`band-rsl-${a.id}`} /></td>
                  <td className="px-4 py-3 text-center"><BandPill band={a.bands?.capital_risk} testId={`band-caprisk-${a.id}`} /></td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider border rounded-sm ${STATUS_COLORS[a.status] || "bg-zinc-100 text-zinc-700 border-zinc-300"}`}>
                      {a.status || "Draft"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-1">
                      <button
                        onClick={() => navigate(`/assessments/${a.id}`)}
                        title="Edit"
                        className="p-1.5 text-zinc-500 hover:text-blue-700 hover:bg-blue-50 transition-colors rounded-sm"
                        data-testid={`edit-${a.id}`}
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => onOpenPdf(a)}
                        title="View PDF"
                        className="p-1.5 text-zinc-500 hover:text-blue-700 hover:bg-blue-50 transition-colors rounded-sm"
                        data-testid={`pdf-${a.id}`}
                      >
                        <FileText className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => onDelete(a)}
                        title="Delete"
                        className="p-1.5 text-zinc-500 hover:text-rose-700 hover:bg-rose-50 transition-colors rounded-sm"
                        data-testid={`delete-${a.id}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function KpiCard({ label, value, accent, testId }) {
  return (
    <div className="bg-white border border-zinc-200 p-5 rounded-sm" data-testid={testId}>
      <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-500 mb-2">{label}</div>
      <div className={`text-3xl font-black tracking-tighter ${accent || "text-zinc-950"}`}>{value}</div>
    </div>
  );
}

function BandPill({ band, testId }) {
  if (!band) return <span className="text-xs text-zinc-400">—</span>;
  return (
    <span
      className="inline-block px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white rounded-sm whitespace-nowrap"
      style={{ background: band.color }}
      title={band.sublabel}
      data-testid={testId}
    >
      {band.label}
    </span>
  );
}
