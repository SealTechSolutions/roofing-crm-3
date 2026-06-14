import React, { useEffect, useMemo, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { toast } from "sonner";
import { Trash2, RotateCcw, AlertTriangle, FileText, Image as ImageIcon, Building2, MapPin, Briefcase, Receipt, Users, Package } from "lucide-react";

const TABS = [
  { key: "library_files",  label: "Documents",     icon: FileText },
  { key: "project_photos", label: "Photos",        icon: ImageIcon },
  { key: "deals",          label: "Projects",      icon: Briefcase },
  { key: "contacts",       label: "Contacts",      icon: Users },
  { key: "properties",     label: "Properties",    icon: MapPin },
  { key: "invoices",       label: "Invoices",      icon: Receipt },
  { key: "vendor_bills",   label: "Vendor Bills",  icon: Receipt },
  { key: "vendors",        label: "Vendors/Subs",  icon: Building2 },
  { key: "materials",      label: "Materials",     icon: Package },
];

export default function Trash() {
  const [active, setActive] = useState("library_files");
  const [counts, setCounts] = useState({});
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [confirmEmpty, setConfirmEmpty] = useState(false);

  const refreshCounts = async () => {
    try {
      const r = await api.get("/trash/counts");
      const map = {};
      for (const b of r.data.buckets || []) map[b.resource] = b.count;
      setCounts(map);
    } catch (e) { /* */ }
  };

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get(`/trash/${active}`);
      setRows(r.data || []);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refreshCounts(); }, []);
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [active]);

  const restore = async (item) => {
    try {
      await api.post(`/trash/${active}/${item.id}/restore`);
      toast.success(`Restored: ${item.label}`);
      load(); refreshCounts();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    }
  };

  const purge = async (item) => {
    const typed = window.prompt(
      `PERMANENTLY DELETE this item? This CANNOT be undone.\n\nItem: ${item.label}\n\nType DELETE to confirm:`
    );
    if (typed === null) return;
    const normalized = typed.replace(/["'`]/g, "").trim().toUpperCase();
    if (normalized !== "DELETE") {
      toast.error("Confirmation did not match — purge cancelled");
      return;
    }
    try {
      const r = await api.delete(`/trash/${active}/${item.id}/purge`);
      toast.success(`Permanently deleted: ${item.label} · storage: ${r.data.storage_cleanup}`);
      load(); refreshCounts();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    }
  };

  const emptyBucket = async () => {
    const typed = window.prompt(`EMPTY THE ${active.toUpperCase()} TRASH?\n\nThis permanently deletes ALL ${rows.length} items below.\nType EMPTY to confirm:`);
    if (typed === null) return;
    const normalized = typed.replace(/["'`]/g, "").trim().toUpperCase();
    if (normalized !== "EMPTY") {
      toast.error("Confirmation did not match — empty cancelled");
      return;
    }
    try {
      const r = await api.post(`/trash/${active}/empty`, { confirm: "EMPTY" });
      const d = r.data || {};
      toast.success(`Emptied ${d.purged} items · storage OK ${d.storage_ok} · failed ${d.storage_failed}`);
      load(); refreshCounts();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    }
  };

  const totalCount = Object.values(counts).reduce((s, n) => s + n, 0);
  const activeLabel = useMemo(() => (TABS.find((t) => t.key === active) || {}).label || active, [active]);

  return (
    <div className="p-8 max-w-7xl mx-auto" data-testid="trash-page">
      <div className="flex items-start gap-4 mb-6">
        <div className="w-12 h-12 rounded-sm bg-rose-700 flex items-center justify-center">
          <Trash2 className="w-6 h-6 text-white" />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-black text-zinc-900 tracking-tight">Trash</h1>
          <p className="text-sm text-zinc-600 mt-1">
            Soft-deleted items across the CRM. Restore to put them back, or permanently delete to free up storage and remove from object storage.
            <strong className="text-rose-700"> Permanent deletes cannot be undone.</strong>
          </p>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Total in Trash</div>
          <div className="text-3xl font-black text-zinc-900 font-mono" data-testid="trash-total">{totalCount}</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 border-b border-zinc-200 mb-5">
        {TABS.map((t) => {
          const Icon = t.icon;
          const n = counts[t.key] || 0;
          return (
            <button
              key={t.key}
              onClick={() => setActive(t.key)}
              data-testid={`trash-tab-${t.key}`}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-[11px] font-bold uppercase tracking-wider border-b-2 transition-colors ${
                active === t.key
                  ? "border-rose-700 text-rose-700"
                  : "border-transparent text-zinc-500 hover:text-zinc-900"
              }`}
            >
              <Icon className="w-3.5 h-3.5" /> {t.label}
              {n > 0 && (
                <span className={`px-1.5 py-0.5 text-[9px] rounded-sm ${active === t.key ? "bg-rose-100 text-rose-800" : "bg-zinc-100 text-zinc-700"}`}>{n}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs text-zinc-500">
          {rows.length} item{rows.length === 1 ? "" : "s"} in <strong>{activeLabel}</strong> trash
        </div>
        {rows.length > 0 && (
          <button
            onClick={emptyBucket}
            data-testid="empty-bucket-btn"
            className="inline-flex items-center gap-1.5 px-3 h-9 text-[10px] font-bold uppercase tracking-wider bg-rose-700 text-white hover:bg-rose-800 rounded-sm"
          >
            <AlertTriangle className="w-3.5 h-3.5" /> Empty {activeLabel} Trash
          </button>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <div className="bg-white border border-zinc-200 p-12 text-center text-sm text-zinc-500">Loading...</div>
      ) : rows.length === 0 ? (
        <div className="bg-white border border-zinc-200 p-12 text-center">
          <Trash2 className="w-10 h-10 text-zinc-300 mx-auto mb-2" />
          <div className="text-sm text-zinc-500">{activeLabel} trash is empty.</div>
        </div>
      ) : (
        <div className="bg-white border border-zinc-200 rounded-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 border-b border-zinc-200 text-[10px] uppercase tracking-widest font-bold text-zinc-500">
              <tr>
                <th className="text-left px-4 py-2">Name</th>
                <th className="text-left px-3 py-2 w-44">Deleted</th>
                <th className="text-left px-3 py-2 w-24">Size</th>
                <th className="text-right px-3 py-2 w-56">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-zinc-100" data-testid={`trash-row-${r.id}`}>
                  <td className="px-4 py-2.5">
                    <div className="font-bold text-zinc-900 truncate" title={r.label}>{r.label}</div>
                    <Extras row={r} />
                  </td>
                  <td className="px-3 py-2.5 text-xs font-mono text-zinc-600">
                    {r.deleted_at ? new Date(r.deleted_at).toLocaleString() : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-xs font-mono text-zinc-600">
                    {r.size ? `${(r.size / 1024).toFixed(0)} KB` : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <button
                      onClick={() => restore(r)}
                      data-testid={`restore-${r.id}`}
                      className="inline-flex items-center gap-1 px-2 h-7 text-[10px] font-bold uppercase tracking-wider bg-white border border-emerald-700 text-emerald-700 hover:bg-emerald-50 rounded-sm mr-1.5"
                    >
                      <RotateCcw className="w-3 h-3" /> Restore
                    </button>
                    <button
                      onClick={() => purge(r)}
                      data-testid={`purge-${r.id}`}
                      className="inline-flex items-center gap-1 px-2 h-7 text-[10px] font-bold uppercase tracking-wider bg-rose-700 text-white hover:bg-rose-800 rounded-sm"
                    >
                      <Trash2 className="w-3 h-3" /> Permanently Delete
                    </button>
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

function Extras({ row }) {
  const e = row.extra || {};
  const bits = [];
  if (e.album_name) bits.push(`Album: ${e.album_name}`);
  if (e.tag) bits.push(e.tag);
  if (e.category) bits.push(e.category);
  if (e.kind) bits.push(e.kind);
  if (e.vendor_name) bits.push(`Vendor: ${e.vendor_name}`);
  if (e.bill_to_company) bits.push(`Customer: ${e.bill_to_company}`);
  if (e.total != null) bits.push(`$${Number(e.total).toLocaleString()}`);
  if (e.content_type) bits.push(e.content_type);
  if (bits.length === 0) return null;
  return <div className="text-[10px] text-zinc-500 mt-0.5">{bits.join(" · ")}</div>;
}
