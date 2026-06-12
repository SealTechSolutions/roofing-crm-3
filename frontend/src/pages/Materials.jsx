import React, { useEffect, useMemo, useState, useRef } from "react";
import { api, formatCurrency, formatApiError, API } from "@/lib/api";
import { Boxes, Plus, Search, Upload, Trash2, FileSpreadsheet, Edit2, Save, X, ChevronDown, ChevronRight, Package } from "lucide-react";
import { toast } from "sonner";

const DEFAULT_CATEGORIES = ["Coating", "Primer", "Fabric", "Mastic", "Fasteners", "Sealant", "Equipment", "Tools", "Other"];
const COMMON_UNITS = ["each", "gallon", "5-gal pail", "55-gal drum", "roll", "box", "case", "sq ft", "lb", "linear ft", "tube"];

const NO_VENDOR_KEY = "__none__";
const NO_VENDOR_LABEL = "Unassigned";

export default function Materials() {
  const [rows, setRows] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("All");
  const [vendorFilter, setVendorFilter] = useState("All");
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [collapsed, setCollapsed] = useState(() => new Set());
  const importRef = useRef(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get("/materials");
      setRows(r.data);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      try {
        const [mat, ven, opt] = await Promise.all([
          api.get("/materials"),
          api.get("/vendors").catch(() => ({ data: [] })),
          api.get("/options").catch(() => ({ data: {} })),
        ]);
        if (cancelled) return;
        setRows(mat.data);
        setVendors(ven.data || []);
        if (opt.data?.material_categories?.length) setCategories(opt.data.material_categories);
      } catch (e) {
        toast.error(formatApiError(e?.response?.data?.detail) || e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    init();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = rows;
    if (catFilter !== "All") out = out.filter((r) => r.category === catFilter);
    if (vendorFilter !== "All") {
      if (vendorFilter === NO_VENDOR_KEY) {
        out = out.filter((r) => !r.vendor_name);
      } else {
        out = out.filter((r) => r.vendor_name === vendorFilter);
      }
    }
    if (q) {
      out = out.filter((r) =>
        (r.sku || "").toLowerCase().includes(q) ||
        (r.name || "").toLowerCase().includes(q) ||
        (r.vendor_name || "").toLowerCase().includes(q) ||
        (r.notes || "").toLowerCase().includes(q)
      );
    }
    return out;
  }, [rows, search, catFilter, vendorFilter]);

  // Group filtered rows by vendor
  const groups = useMemo(() => {
    const buckets = new Map();
    for (const m of filtered) {
      const key = m.vendor_name || NO_VENDOR_LABEL;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(m);
    }
    // Sort vendor groups alphabetically, with "Unassigned" last
    return Array.from(buckets.entries())
      .sort((a, b) => {
        if (a[0] === NO_VENDOR_LABEL) return 1;
        if (b[0] === NO_VENDOR_LABEL) return -1;
        return a[0].localeCompare(b[0]);
      })
      .map(([vendor, items]) => ({
        vendor,
        items,
        count: items.length,
        totalValue: items.reduce(
          (sum, m) => sum + Number(m.default_price || 0) * (1 + Number(m.shipping_pct || 0) / 100),
          0
        ),
      }));
  }, [filtered]);

  // Unique vendor names from rows for the vendor filter dropdown (sorted alpha)
  const vendorOptions = useMemo(() => {
    const counts = new Map();
    let unassigned = 0;
    for (const r of rows) {
      if (!r.vendor_name) unassigned += 1;
      else counts.set(r.vendor_name, (counts.get(r.vendor_name) || 0) + 1);
    }
    const arr = Array.from(counts.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, n]) => ({ value: name, label: `${name} (${n})` }));
    if (unassigned > 0) {
      arr.push({ value: NO_VENDOR_KEY, label: `${NO_VENDOR_LABEL} (${unassigned})` });
    }
    return arr;
  }, [rows]);

  const toggleGroup = (vendor) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(vendor)) next.delete(vendor);
      else next.add(vendor);
      return next;
    });
  };
  const collapseAll = () => setCollapsed(new Set(groups.map((g) => g.vendor)));
  const expandAll = () => setCollapsed(new Set());

  const startEdit = (m) => {
    setEditingId(m.id);
    setDraft({ ...m });
  };
  const startAdd = () => {
    setEditingId("new");
    setDraft({ sku: "", name: "", category: "Other", unit: "each", default_price: 0, shipping_pct: 0, markup_pct: 0, vendor_id: "", vendor_name: "", notes: "" });
  };
  const cancelEdit = () => { setEditingId(null); setDraft(null); };

  const saveEdit = async () => {
    if (!draft?.name?.trim()) { toast.error("Name is required"); return; }
    try {
      const payload = {
        ...draft,
        default_price: Number(draft.default_price || 0),
        shipping_pct: Number(draft.shipping_pct || 0),
        markup_pct: Number(draft.markup_pct || 0),
      };
      if (editingId === "new") {
        await api.post("/materials", payload);
        toast.success("Material added");
      } else {
        await api.put(`/materials/${editingId}`, payload);
        toast.success("Material updated");
      }
      cancelEdit();
      load();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    }
  };

  const removeRow = async (m) => {
    if (!window.confirm(`Delete ${m.name}?`)) return;
    try {
      await api.delete(`/materials/${m.id}`);
      toast.success("Deleted");
      load();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    }
  };

  const handleImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const fd = new FormData();
    fd.append("file", file);
    try {
      const r = await api.post("/materials/bulk-import", fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success(`Imported: ${r.data.created} new · ${r.data.updated} updated · ${r.data.skipped} skipped`);
      load();
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || err.message);
    }
  };

  const download = async (path, filename) => {
    const token = localStorage.getItem("crm_token");
    try {
      const r = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      toast.error("Download failed");
    }
  };

  return (
    <div className="p-6 sm:p-8 animate-in fade-in duration-500" data-testid="materials-page">
      <input ref={importRef} type="file" accept=".csv,.xlsx" onChange={handleImport} className="hidden" />

      <div className="flex items-start justify-between mb-8 pb-6 border-b border-zinc-200 gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Boxes className="w-4 h-4 text-blue-700" />
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-700">Catalog</div>
          </div>
          <h1 className="font-heading text-3xl sm:text-4xl font-black tracking-tight">Materials</h1>
          <div className="mt-2 text-xs uppercase tracking-wider text-zinc-500">Internal cost catalog — never shown to customers</div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => download("/materials/template.xlsx", "sealtech-materials-template.xlsx")} className="inline-flex items-center gap-2 border border-zinc-300 text-zinc-700 px-3 h-10 text-xs font-bold uppercase tracking-wider hover:border-zinc-950 rounded-sm" data-testid="download-template">
            <FileSpreadsheet className="w-4 h-4" /> Template
          </button>
          <button onClick={() => download("/materials/export.xlsx", "sealtech-materials.xlsx")} className="inline-flex items-center gap-2 border border-zinc-300 text-zinc-700 px-3 h-10 text-xs font-bold uppercase tracking-wider hover:border-zinc-950 rounded-sm" data-testid="export-materials">
            <FileSpreadsheet className="w-4 h-4" /> Export
          </button>
          <button onClick={() => importRef.current?.click()} className="inline-flex items-center gap-2 border border-blue-700 text-blue-700 px-3 h-10 text-xs font-bold uppercase tracking-wider hover:bg-blue-50 rounded-sm" data-testid="import-materials">
            <Upload className="w-4 h-4" /> Import CSV/XLSX
          </button>
          <button onClick={startAdd} className="inline-flex items-center gap-2 bg-blue-700 text-white px-4 h-10 text-xs font-bold uppercase tracking-wider hover:bg-blue-800 rounded-sm" data-testid="add-material">
            <Plus className="w-4 h-4" /> Add Material
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-zinc-200 rounded-sm p-4 mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[240px] relative">
            <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input type="text" placeholder="Search SKU, name, vendor, notes..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full h-9 pl-9 pr-3 border border-zinc-300 rounded-sm text-sm" data-testid="materials-search" />
          </div>
          <select value={vendorFilter} onChange={(e) => setVendorFilter(e.target.value)} className="h-9 px-3 border border-zinc-300 rounded-sm text-sm bg-white" data-testid="materials-vendor-filter">
            <option value="All">All Vendors ({rows.length})</option>
            {vendorOptions.map((v) => (
              <option key={v.value} value={v.value}>{v.label}</option>
            ))}
          </select>
          <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} className="h-9 px-3 border border-zinc-300 rounded-sm text-sm bg-white" data-testid="materials-cat-filter">
            <option value="All">All Categories ({rows.length})</option>
            {categories.map((c) => {
              const count = rows.filter((r) => r.category === c).length;
              return <option key={c} value={c}>{c} ({count})</option>;
            })}
          </select>
          {groups.length > 1 && (
            <div className="flex items-center gap-1 ml-auto">
              <button onClick={expandAll} className="text-[11px] uppercase tracking-wider text-zinc-600 hover:text-blue-700 px-2 h-7" data-testid="expand-all">Expand all</button>
              <span className="text-zinc-300">·</span>
              <button onClick={collapseAll} className="text-[11px] uppercase tracking-wider text-zinc-600 hover:text-blue-700 px-2 h-7" data-testid="collapse-all">Collapse all</button>
            </div>
          )}
        </div>
      </div>

      {/* New row (top of page when adding) */}
      {editingId === "new" && draft && (
        <div className="bg-white border border-blue-700 rounded-sm overflow-hidden mb-6">
          <div className="px-4 py-2 bg-blue-50 border-b border-blue-200 text-[11px] font-bold uppercase tracking-wider text-blue-700">New Material</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><HeadRow /></thead>
              <tbody>
                <EditRow draft={draft} setDraft={setDraft} categories={categories} vendors={vendors} onSave={saveEdit} onCancel={cancelEdit} />
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Grouped tables by vendor */}
      {loading ? (
        <div className="py-16 text-center text-xs uppercase tracking-wider text-zinc-500">Loading...</div>
      ) : groups.length === 0 && editingId !== "new" ? (
        <div className="bg-white border border-zinc-200 rounded-sm py-16 text-center">
          <Package className="w-8 h-8 text-zinc-300 mx-auto mb-3" />
          <div className="font-bold text-zinc-700 mb-1">No materials match your filters.</div>
          <div className="text-xs text-zinc-500">Adjust the search/filters above, or click <span className="font-bold">+ Add Material</span>.</div>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => {
            const isCollapsed = collapsed.has(g.vendor);
            return (
              <div key={g.vendor} className="bg-white border border-zinc-200 rounded-sm overflow-hidden" data-testid={`vendor-group-${g.vendor}`}>
                <button
                  type="button"
                  onClick={() => toggleGroup(g.vendor)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-zinc-950 text-white hover:bg-zinc-900 transition"
                  data-testid={`vendor-toggle-${g.vendor}`}
                >
                  <div className="flex items-center gap-3">
                    {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    <span className="font-heading font-bold tracking-tight text-base">{g.vendor}</span>
                    <span className="text-[10px] uppercase tracking-[0.2em] text-zinc-400">·</span>
                    <span className="text-[11px] uppercase tracking-wider text-zinc-300">{g.count} product{g.count === 1 ? "" : "s"}</span>
                  </div>
                  <div className="text-[11px] uppercase tracking-wider text-zinc-300">
                    Loaded inventory value <span className="font-mono font-bold text-white ml-2">{formatCurrency(g.totalValue)}</span>
                  </div>
                </button>
                {!isCollapsed && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm" data-testid={`materials-table-${g.vendor}`}>
                      <thead><HeadRow /></thead>
                      <tbody>
                        {g.items.map((m) => (
                          editingId === m.id && draft ? (
                            <EditRow key={m.id} draft={draft} setDraft={setDraft} categories={categories} vendors={vendors} onSave={saveEdit} onCancel={cancelEdit} />
                          ) : (
                            <tr key={m.id} className="border-b border-zinc-100 hover:bg-blue-50/40" data-testid={`material-row-${m.id}`}>
                              <td className="py-2 px-3 font-mono text-zinc-700 text-[12px]">{m.sku || "—"}</td>
                              <td className="py-2 px-3">
                                <div className="font-bold text-zinc-950">{m.name}</div>
                                {m.notes && <div className="text-[11px] text-zinc-500 mt-0.5 leading-snug">{m.notes}</div>}
                              </td>
                              <td className="py-2 px-3 text-zinc-700 text-[12px]">{m.category}</td>
                              <td className="py-2 px-3 text-zinc-700 text-[12px]">{m.unit}</td>
                              <td className="py-2 px-3 text-right font-mono">{formatCurrency(m.default_price)}</td>
                              <td className="py-2 px-3 text-right font-mono text-zinc-600 text-[12px]">{Number(m.shipping_pct || 0).toFixed(1)}%</td>
                              <td className="py-2 px-3 text-right font-mono text-[12px]" style={{ color: "#A0703A" }}>{Number(m.markup_pct || 0).toFixed(1)}%</td>
                              <td className="py-2 px-3 text-right font-mono font-bold">{formatCurrency(Number(m.default_price || 0) * (1 + Number(m.shipping_pct || 0) / 100))}</td>
                              <td className="py-2 px-3 text-right">
                                <div className="inline-flex items-center gap-1">
                                  <button onClick={() => startEdit(m)} title="Edit" className="p-1.5 hover:bg-zinc-100 rounded-sm" data-testid={`edit-mat-${m.id}`}><Edit2 className="w-3.5 h-3.5 text-zinc-700" /></button>
                                  <button onClick={() => removeRow(m)} title="Delete" className="p-1.5 hover:bg-red-100 text-red-700 rounded-sm" data-testid={`del-mat-${m.id}`}><Trash2 className="w-3.5 h-3.5" /></button>
                                </div>
                              </td>
                            </tr>
                          )
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function HeadRow() {
  return (
    <tr className="border-b-2 border-zinc-950 text-left text-[10px] uppercase tracking-wider bg-zinc-50">
      <th className="py-3 px-3 w-28">SKU</th>
      <th className="py-3 px-3">Name</th>
      <th className="py-3 px-3 w-28">Category</th>
      <th className="py-3 px-3 w-24">Unit</th>
      <th className="py-3 px-3 w-24 text-right">Default Price</th>
      <th className="py-3 px-3 w-16 text-right" title="Typical shipping % on this item">Ship %</th>
      <th className="py-3 px-3 w-20 text-right" title="Internal markup target — never shown to customers">Markup %</th>
      <th className="py-3 px-3 w-24 text-right" title="Default Price × (1 + Shipping %)">Loaded</th>
      <th className="py-3 px-3 w-24"></th>
    </tr>
  );
}

function EditRow({ draft, setDraft, categories, vendors, onSave, onCancel }) {
  const set = (patch) => setDraft({ ...draft, ...patch });
  const loaded = Number(draft.default_price || 0) * (1 + Number(draft.shipping_pct || 0) / 100);
  return (
    <>
      <tr className="border-b border-blue-100 bg-blue-50/30" data-testid="material-edit-row">
        <td className="py-2 px-2"><input value={draft.sku} onChange={(e) => set({ sku: e.target.value })} placeholder="SKU" className="w-full h-8 px-2 border border-zinc-300 rounded-sm text-sm font-mono" /></td>
        <td className="py-2 px-2"><input value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="Name *" className="w-full h-8 px-2 border border-zinc-300 rounded-sm text-sm" data-testid="edit-mat-name" /></td>
        <td className="py-2 px-2">
          <select value={draft.category} onChange={(e) => set({ category: e.target.value })} className="w-full h-8 px-2 border border-zinc-300 rounded-sm text-sm bg-white">
            {categories.map((c) => <option key={c}>{c}</option>)}
            {!categories.includes(draft.category) && draft.category && <option>{draft.category}</option>}
          </select>
        </td>
        <td className="py-2 px-2">
          <input list="units-list" value={draft.unit} onChange={(e) => set({ unit: e.target.value })} placeholder="Unit" className="w-full h-8 px-2 border border-zinc-300 rounded-sm text-sm" />
          <datalist id="units-list">{COMMON_UNITS.map((u) => <option key={u}>{u}</option>)}</datalist>
        </td>
        <td className="py-2 px-2"><input type="number" step="0.01" value={draft.default_price} onChange={(e) => set({ default_price: e.target.value })} className="w-full h-8 px-2 text-right border border-zinc-300 rounded-sm text-sm font-mono" data-testid="edit-mat-price" /></td>
        <td className="py-2 px-2"><input type="number" step="0.1" value={draft.shipping_pct} onChange={(e) => set({ shipping_pct: e.target.value })} className="w-full h-8 px-2 text-right border border-zinc-300 rounded-sm text-sm font-mono" data-testid="edit-mat-shipping" /></td>
        <td className="py-2 px-2"><input type="number" step="0.1" value={draft.markup_pct} onChange={(e) => set({ markup_pct: e.target.value })} className="w-full h-8 px-2 text-right border border-zinc-300 rounded-sm text-sm font-mono" data-testid="edit-mat-markup" /></td>
        <td className="py-2 px-2 text-right font-mono font-bold">{formatCurrency(loaded)}</td>
        <td className="py-2 px-2 text-right">
          <div className="inline-flex items-center gap-1">
            <button onClick={onSave} title="Save" className="p-1.5 hover:bg-blue-100 text-blue-700 rounded-sm" data-testid="save-mat"><Save className="w-3.5 h-3.5" /></button>
            <button onClick={onCancel} title="Cancel" className="p-1.5 hover:bg-zinc-100 rounded-sm"><X className="w-3.5 h-3.5 text-zinc-700" /></button>
          </div>
        </td>
      </tr>
      <tr className="border-b-2 border-blue-700 bg-blue-50/30">
        <td colSpan={2} className="py-2 px-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider text-zinc-500 whitespace-nowrap">Vendor</span>
            <select value={draft.vendor_id || ""} onChange={(e) => {
              const v = vendors.find((x) => x.id === e.target.value);
              set({ vendor_id: e.target.value, vendor_name: v?.name || "" });
            }} className="w-full h-8 px-2 border border-zinc-300 rounded-sm text-sm bg-white">
              <option value="">— None —</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
        </td>
        <td colSpan={7} className="py-2 px-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider text-zinc-500 whitespace-nowrap">Notes</span>
            <input value={draft.notes || ""} onChange={(e) => set({ notes: e.target.value })} placeholder="Optional notes (color, application, etc.)" className="w-full h-8 px-2 border border-zinc-300 rounded-sm text-sm" data-testid="edit-mat-notes" />
          </div>
        </td>
      </tr>
    </>
  );
}
