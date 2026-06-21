// Product Catalog admin page — Milestone 1 of the Material Calculator.
// Three stacked sections: Calculator Settings (markup/handling),
// Products (master price list with CSV import), and Systems (the 18 named
// roofing assemblies). Recipe editor (which products go into each system at
// what coverage rate) opens in a side-drawer when you tap a system row.
//
// Endpoints used:
//   GET/POST/PATCH/DELETE /api/products
//   POST                  /api/products/import-csv
//   GET/POST/PATCH/DELETE /api/systems
//   GET/PUT               /api/systems/{id}/recipe
//   GET/PUT               /api/calculator/settings
import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Plus, Trash2, Upload, Package, Layers, Settings, ChevronRight, Save, X } from "lucide-react";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const api = axios.create({ baseURL: API });
api.interceptors.request.use((cfg) => {
  const t = localStorage.getItem("crm_token");
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

const CATEGORIES = ["FARM", "All-Acrylic", "Silicone", "TPO", "EPDM", "ModBit", "PVC", "Other"];
const UNITS = ["gal", "pail", "roll", "sf", "lf", "ea", "bag", "tube", "box"];
const COVERAGE_BASIS = [
  { value: "per_100sf", label: "per 100 sf" },
  { value: "per_sf",    label: "per sf" },
  { value: "per_lf",    label: "per linear ft" },
  { value: "per_each_optional", label: "user enters qty" },
];

const inputCls = "border border-zinc-300 px-3 h-9 text-sm w-full focus:outline-none focus:border-blue-700";
const labelCls = "text-[10px] font-bold uppercase tracking-widest text-zinc-500 block mb-1";

export default function ProductCatalog() {
  const [tab, setTab] = useState("products");
  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6" data-testid="product-catalog-page">
      <header>
        <h1 className="text-2xl font-black tracking-tight">Product Catalog &amp; Roofing Systems</h1>
        <p className="text-sm text-zinc-600 mt-1">
          Master price list, named system assemblies, and the shipping / handling-fee defaults that drive the Material Calculator.
        </p>
      </header>
      <div className="flex gap-1 border-b border-zinc-200">
        {[
          ["products", "Products", Package],
          ["systems", "Systems", Layers],
          ["settings", "Calculator Settings", Settings],
        ].map(([k, label, Icon]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold uppercase tracking-wider border-b-2 transition-colors ${
              tab === k ? "border-blue-700 text-blue-700" : "border-transparent text-zinc-500 hover:text-zinc-900"
            }`}
            data-testid={`tab-${k}`}
          >
            <Icon className="w-3.5 h-3.5" />{label}
          </button>
        ))}
      </div>
      {tab === "products" && <ProductsTab />}
      {tab === "systems" && <SystemsTab />}
      {tab === "settings" && <SettingsTab />}
    </div>
  );
}

// ───────────────────────────────────────── PRODUCTS ──────────────────────
function ProductsTab() {
  const [rows, setRows] = useState([]);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState({});

  const load = async () => {
    try { setRows((await api.get("/products")).data); }
    catch { toast.error("Failed to load products"); }
  };
  useEffect(() => { load(); }, []);

  const startEdit = (p) => { setEditingId(p.id); setDraft({ ...p }); };
  const cancelEdit = () => { setEditingId(null); setDraft({}); };
  const saveEdit = async () => {
    try {
      await api.patch(`/products/${editingId}`, draft);
      toast.success("Saved");
      cancelEdit(); load();
    } catch (e) { toast.error(e.response?.data?.detail || "Save failed"); }
  };
  const removeProduct = async (p) => {
    if (!window.confirm(`Delete "${p.name}"? Recipes referencing it will keep their reference but the product won't show in pickers.`)) return;
    await api.delete(`/products/${p.id}`);
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2 justify-end">
        <button onClick={() => setImporting(true)} className="inline-flex items-center gap-2 border border-zinc-300 px-3 h-9 text-xs font-bold uppercase tracking-wider hover:border-blue-700 hover:text-blue-700" data-testid="import-csv-btn">
          <Upload className="w-3.5 h-3.5" /> Import CSV
        </button>
        <button onClick={() => setAdding(true)} className="inline-flex items-center gap-2 bg-blue-700 text-white px-3 h-9 text-xs font-bold uppercase tracking-wider hover:bg-blue-800" data-testid="add-product-btn">
          <Plus className="w-3.5 h-3.5" /> Add Product
        </button>
      </div>
      <div className="border border-zinc-200 rounded-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
            <tr>
              <th className="text-left px-3 py-2">Name</th>
              <th className="text-left px-3 py-2">Vendor</th>
              <th className="text-left px-3 py-2">Category</th>
              <th className="text-right px-3 py-2">Pkg</th>
              <th className="text-left px-3 py-2">Unit</th>
              <th className="text-right px-3 py-2">Unit Price</th>
              <th className="w-20"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={7} className="text-center text-zinc-400 py-8 text-sm">No products yet — tap <b>Add Product</b> or <b>Import CSV</b></td></tr>
            )}
            {rows.map((p) => editingId === p.id ? (
              <tr key={p.id} className="border-t border-zinc-200 bg-blue-50/40">
                <td className="px-3 py-2"><input className={inputCls} value={draft.name||""} onChange={(e)=>setDraft({...draft,name:e.target.value})} /></td>
                <td className="px-3 py-2"><input className={inputCls} value={draft.vendor||""} onChange={(e)=>setDraft({...draft,vendor:e.target.value})} /></td>
                <td className="px-3 py-2"><select className={inputCls} value={draft.category||""} onChange={(e)=>setDraft({...draft,category:e.target.value})}><option value="">—</option>{CATEGORIES.map((c)=><option key={c} value={c}>{c}</option>)}</select></td>
                <td className="px-3 py-2"><input type="number" step="0.01" className={inputCls + " text-right"} value={draft.package_size||""} onChange={(e)=>setDraft({...draft,package_size:e.target.value})} /></td>
                <td className="px-3 py-2"><select className={inputCls} value={draft.unit||""} onChange={(e)=>setDraft({...draft,unit:e.target.value})}>{UNITS.map((u)=><option key={u} value={u}>{u}</option>)}</select></td>
                <td className="px-3 py-2"><input type="number" step="0.01" className={inputCls + " text-right"} value={draft.unit_price||""} onChange={(e)=>setDraft({...draft,unit_price:e.target.value})} /></td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <button onClick={saveEdit} className="p-1 text-emerald-700 hover:bg-emerald-50"><Save className="w-4 h-4" /></button>
                  <button onClick={cancelEdit} className="p-1 text-zinc-500 hover:bg-zinc-100"><X className="w-4 h-4" /></button>
                </td>
              </tr>
            ) : (
              <tr key={p.id} className="border-t border-zinc-200 hover:bg-zinc-50 cursor-pointer" onClick={()=>startEdit(p)}>
                <td className="px-3 py-2 font-medium">{p.name}</td>
                <td className="px-3 py-2 text-zinc-600">{p.vendor || <span className="text-zinc-300">—</span>}</td>
                <td className="px-3 py-2"><span className="text-[10px] font-bold uppercase tracking-wider bg-zinc-100 px-1.5 py-0.5 rounded-sm">{p.category||"—"}</span></td>
                <td className="px-3 py-2 text-right text-zinc-600">{p.package_size}</td>
                <td className="px-3 py-2 text-zinc-600">{p.unit}</td>
                <td className="px-3 py-2 text-right font-mono">${p.unit_price?.toFixed(2)}</td>
                <td className="px-3 py-2 text-right">
                  <button onClick={(e)=>{e.stopPropagation(); removeProduct(p);}} className="p-1 text-rose-600 hover:bg-rose-50"><Trash2 className="w-4 h-4" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {adding && <AddProductModal onClose={()=>{setAdding(false);load();}} />}
      {importing && <ImportCsvModal onClose={()=>{setImporting(false);load();}} />}
    </div>
  );
}

function AddProductModal({ onClose }) {
  const [draft, setDraft] = useState({ name:"", vendor:"", category:"FARM", unit:"gal", package_size:1, unit_price:0 });
  const submit = async () => {
    if (!draft.name.trim()) { toast.error("Name required"); return; }
    try { await api.post("/products", draft); toast.success("Product added"); onClose(); }
    catch (e) { toast.error(e.response?.data?.detail || "Add failed"); }
  };
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white p-6 rounded-sm w-full max-w-md" onClick={(e)=>e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-4">Add Product</h2>
        <div className="space-y-3">
          <div><label className={labelCls}>Name</label><input className={inputCls} value={draft.name} onChange={(e)=>setDraft({...draft,name:e.target.value})} autoFocus /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={labelCls}>Vendor</label><input className={inputCls} value={draft.vendor} onChange={(e)=>setDraft({...draft,vendor:e.target.value})} /></div>
            <div><label className={labelCls}>Category</label><select className={inputCls} value={draft.category} onChange={(e)=>setDraft({...draft,category:e.target.value})}>{CATEGORIES.map((c)=><option key={c} value={c}>{c}</option>)}</select></div>
            <div><label className={labelCls}>Package size</label><input type="number" step="0.01" className={inputCls} value={draft.package_size} onChange={(e)=>setDraft({...draft,package_size:e.target.value})} /></div>
            <div><label className={labelCls}>Unit</label><select className={inputCls} value={draft.unit} onChange={(e)=>setDraft({...draft,unit:e.target.value})}>{UNITS.map((u)=><option key={u} value={u}>{u}</option>)}</select></div>
            <div className="col-span-2"><label className={labelCls}>Unit price ($)</label><input type="number" step="0.01" className={inputCls} value={draft.unit_price} onChange={(e)=>setDraft({...draft,unit_price:e.target.value})} /></div>
          </div>
        </div>
        <div className="flex gap-2 justify-end mt-5">
          <button onClick={onClose} className="border border-zinc-300 px-3 h-9 text-xs font-bold uppercase tracking-wider">Cancel</button>
          <button onClick={submit} className="bg-blue-700 text-white px-3 h-9 text-xs font-bold uppercase tracking-wider">Add</button>
        </div>
      </div>
    </div>
  );
}

function ImportCsvModal({ onClose }) {
  const [csv, setCsv] = useState("name,vendor,category,unit,package_size,unit_price,notes\n");
  const [result, setResult] = useState(null);
  const submit = async () => {
    try {
      const { data } = await api.post("/products/import-csv", { csv });
      setResult(data);
      toast.success(`Imported: ${data.inserted} new, ${data.updated} updated`);
    } catch (e) { toast.error(e.response?.data?.detail || "Import failed"); }
  };
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white p-6 rounded-sm w-full max-w-2xl" onClick={(e)=>e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-1">Import Products from CSV</h2>
        <p className="text-xs text-zinc-600 mb-3">First row must be the header. Required: <code>name</code>. Optional: <code>sku, vendor, category, unit, package_size, unit_price, notes</code>. Existing rows with the same name+vendor get updated (no duplicates).</p>
        <textarea className="w-full h-64 border border-zinc-300 p-2 font-mono text-xs" value={csv} onChange={(e)=>setCsv(e.target.value)} />
        {result && (
          <div className="mt-2 text-xs">
            <b>Done.</b> {result.inserted} inserted, {result.updated} updated.
            {result.errors?.length > 0 && <span className="text-rose-600"> {result.errors.length} errors — check line numbers.</span>}
          </div>
        )}
        <div className="flex gap-2 justify-end mt-4">
          <button onClick={onClose} className="border border-zinc-300 px-3 h-9 text-xs font-bold uppercase tracking-wider">Close</button>
          <button onClick={submit} className="bg-blue-700 text-white px-3 h-9 text-xs font-bold uppercase tracking-wider">Import</button>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────────────────── SYSTEMS ───────────────────────
function SystemsTab() {
  const [rows, setRows] = useState([]);
  const [adding, setAdding] = useState(false);
  const [editingRecipe, setEditingRecipe] = useState(null); // system object

  const load = async () => {
    try { setRows((await api.get("/systems")).data); }
    catch { toast.error("Failed to load systems"); }
  };
  useEffect(() => { load(); }, []);

  const remove = async (sys) => {
    if (!window.confirm(`Delete system "${sys.name}" and its entire recipe?`)) return;
    await api.delete(`/systems/${sys.id}`);
    load();
  };

  // Group by vendor (the vendor determines the system, per Darren). Systems
  // missing a vendor land in a "(No vendor)" bucket at the end so they're
  // still discoverable.
  const grouped = useMemo(() => {
    const g = {};
    rows.forEach((r) => {
      const v = (r.vendor || "(No vendor)").trim() || "(No vendor)";
      (g[v] ||= []).push(r);
    });
    return g;
  }, [rows]);
  const vendorOrder = useMemo(
    () => Object.keys(grouped).sort((a, b) => {
      if (a === "(No vendor)") return 1;
      if (b === "(No vendor)") return -1;
      return a.localeCompare(b);
    }),
    [grouped],
  );

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={()=>setAdding(true)} className="inline-flex items-center gap-2 bg-blue-700 text-white px-3 h-9 text-xs font-bold uppercase tracking-wider hover:bg-blue-800" data-testid="add-system-btn">
          <Plus className="w-3.5 h-3.5" /> Add System
        </button>
      </div>
      {rows.length === 0 && <div className="text-zinc-400 text-sm text-center py-8 border border-dashed border-zinc-200">No systems yet — tap <b>Add System</b></div>}
      {vendorOrder.map((vendor) => (
        <div key={vendor}>
          <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-2">{vendor}</div>
          <div className="border border-zinc-200 rounded-sm overflow-hidden">
            {grouped[vendor].map((s, i) => (
              <div key={s.id} className={`flex items-center justify-between px-4 py-3 hover:bg-zinc-50 cursor-pointer ${i>0 ? "border-t border-zinc-200" : ""}`} onClick={()=>setEditingRecipe(s)} data-testid={`system-row-${s.id}`}>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm flex items-center gap-2">
                    {s.name}
                    {s.system_type && <span className="text-[10px] font-bold uppercase tracking-wider bg-zinc-100 text-zinc-600 px-1.5 py-0.5 rounded-sm">{s.system_type}</span>}
                    {s.warranty_years ? <span className="text-[10px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.5 rounded-sm">{s.warranty_years}-yr warranty</span> : null}
                  </div>
                  {s.description && <div className="text-xs text-zinc-500 mt-0.5">{s.description}</div>}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Edit recipe</span>
                  <ChevronRight className="w-4 h-4 text-zinc-400" />
                  <button onClick={(e)=>{e.stopPropagation();remove(s);}} className="p-1 text-rose-600 hover:bg-rose-50"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
      {adding && <AddSystemModal onClose={()=>{setAdding(false);load();}} />}
      {editingRecipe && <RecipeEditor system={editingRecipe} onClose={()=>{setEditingRecipe(null);load();}} />}
    </div>
  );
}

function AddSystemModal({ onClose }) {
  const [draft, setDraft] = useState({ name:"", vendor:"", system_type:"FARM", warranty_years:10, description:"" });
  const submit = async () => {
    if (!draft.name.trim()) { toast.error("System name required"); return; }
    if (!draft.vendor.trim()) { toast.error("Vendor required — vendor determines the system"); return; }
    try { await api.post("/systems", draft); toast.success("System added"); onClose(); }
    catch (e) { toast.error(e.response?.data?.detail || "Add failed"); }
  };
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white p-6 rounded-sm w-full max-w-md" onClick={(e)=>e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-1">Add System</h2>
        <p className="text-xs text-zinc-600 mb-4">A system is uniquely defined by <b>Vendor</b> + <b>Type</b> + <b>Warranty Period</b>. Coverage rates on the recipe change with the warranty.</p>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><label className={labelCls}>Vendor *</label><input className={inputCls} value={draft.vendor} onChange={(e)=>setDraft({...draft,vendor:e.target.value})} placeholder="e.g., Gaco, Carlisle, GAF" /></div>
            <div><label className={labelCls}>System type</label><select className={inputCls} value={draft.system_type} onChange={(e)=>setDraft({...draft,system_type:e.target.value})}>{CATEGORIES.map((c)=><option key={c} value={c}>{c}</option>)}</select></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={labelCls}>Warranty (years)</label><input type="number" min="0" className={inputCls} value={draft.warranty_years} onChange={(e)=>setDraft({...draft,warranty_years:parseInt(e.target.value)||0})} placeholder="10, 15, 20…" /></div>
            <div><label className={labelCls}>System name</label><input className={inputCls} value={draft.name} onChange={(e)=>setDraft({...draft,name:e.target.value})} autoFocus placeholder="e.g., S20 Silicone 20-yr" /></div>
          </div>
          <div><label className={labelCls}>Description (optional)</label><input className={inputCls} value={draft.description} onChange={(e)=>setDraft({...draft,description:e.target.value})} /></div>
        </div>
        <div className="flex gap-2 justify-end mt-5">
          <button onClick={onClose} className="border border-zinc-300 px-3 h-9 text-xs font-bold uppercase tracking-wider">Cancel</button>
          <button onClick={submit} className="bg-blue-700 text-white px-3 h-9 text-xs font-bold uppercase tracking-wider">Add</button>
        </div>
      </div>
    </div>
  );
}

function RecipeEditor({ system, onClose }) {
  const [products, setProducts] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [pRes, rRes] = await Promise.all([
          api.get("/products"),
          api.get(`/systems/${system.id}/recipe`),
        ]);
        setProducts(pRes.data);
        setItems(rRes.data);
      } catch { toast.error("Failed to load recipe"); }
      finally { setLoading(false); }
    })();
  }, [system.id]);

  const addRow = () => setItems((arr) => [...arr, { product_id:"", coverage_rate:0, coverage_basis:"per_100sf", optional:false, default_included:true, notes:"" }]);
  const updateRow = (idx, patch) => setItems((arr) => arr.map((it,i)=>i===idx?{...it,...patch}:it));
  const removeRow = (idx) => setItems((arr) => arr.filter((_,i)=>i!==idx));

  const save = async () => {
    try {
      await api.put(`/systems/${system.id}/recipe`, { items });
      toast.success("Recipe saved");
      onClose();
    } catch (e) { toast.error(e.response?.data?.detail || "Save failed"); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-sm w-full max-w-5xl h-[85vh] flex flex-col" onClick={(e)=>e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-zinc-200 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold">Recipe — {system.name}</h2>
            <p className="text-xs text-zinc-600">Add each product in this system + its coverage rate. Mark optional add-ons (walk pad, granules) to make them togglable in the calculator.</p>
          </div>
          <button onClick={onClose} className="p-1 text-zinc-500 hover:bg-zinc-100"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 overflow-auto p-6">
          {loading ? <div className="text-center py-8 text-zinc-400">Loading…</div> : (
            <div className="space-y-2">
              {items.length === 0 && <div className="text-center text-zinc-400 py-8 text-sm border border-dashed border-zinc-200">No products in this recipe yet</div>}
              {items.map((it, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center p-2 border border-zinc-200 rounded-sm">
                  <div className="col-span-4">
                    <label className={labelCls}>Product</label>
                    <select className={inputCls} value={it.product_id} onChange={(e)=>updateRow(idx,{product_id:e.target.value})}>
                      <option value="">— Select product —</option>
                      {products.map((p)=><option key={p.id} value={p.id}>{p.name} {p.vendor && `· ${p.vendor}`}</option>)}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className={labelCls}>Coverage rate</label>
                    <input type="number" step="0.01" className={inputCls} value={it.coverage_rate} onChange={(e)=>updateRow(idx,{coverage_rate:parseFloat(e.target.value)||0})} />
                  </div>
                  <div className="col-span-2">
                    <label className={labelCls}>Basis</label>
                    <select className={inputCls} value={it.coverage_basis} onChange={(e)=>updateRow(idx,{coverage_basis:e.target.value})}>{COVERAGE_BASIS.map((b)=><option key={b.value} value={b.value}>{b.label}</option>)}</select>
                  </div>
                  <div className="col-span-3 flex items-end gap-3 pb-1">
                    <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={it.optional} onChange={(e)=>updateRow(idx,{optional:e.target.checked})} /> Optional</label>
                    <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={it.default_included} onChange={(e)=>updateRow(idx,{default_included:e.target.checked})} /> Default ON</label>
                  </div>
                  <div className="col-span-1 flex justify-end">
                    <button onClick={()=>removeRow(idx)} className="p-1 text-rose-600 hover:bg-rose-50"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
              ))}
              <button onClick={addRow} className="inline-flex items-center gap-2 border border-zinc-300 px-3 h-9 text-xs font-bold uppercase tracking-wider hover:border-blue-700 hover:text-blue-700 mt-2"><Plus className="w-3.5 h-3.5" /> Add row</button>
            </div>
          )}
        </div>
        <div className="px-6 py-4 border-t border-zinc-200 flex justify-end gap-2">
          <button onClick={onClose} className="border border-zinc-300 px-3 h-9 text-xs font-bold uppercase tracking-wider">Cancel</button>
          <button onClick={save} className="bg-blue-700 text-white px-3 h-9 text-xs font-bold uppercase tracking-wider">Save Recipe</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────── CALCULATOR SETTINGS ──────────────────
function SettingsTab() {
  const [s, setS] = useState(null);
  useEffect(() => { (async () => {
    try { setS((await api.get("/calculator/settings")).data); }
    catch { toast.error("Failed to load settings"); }
  })(); }, []);
  const save = async () => {
    try { setS((await api.put("/calculator/settings", s)).data); toast.success("Settings saved"); }
    catch (e) { toast.error(e.response?.data?.detail || "Save failed"); }
  };
  if (!s) return <div className="text-center py-8 text-zinc-400">Loading…</div>;
  return (
    <div className="max-w-xl space-y-4">
      <div className="border border-zinc-200 rounded-sm p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div><label className={labelCls}>Shipping %</label><input type="number" step="0.01" className={inputCls} value={s.markup_pct} onChange={(e)=>setS({...s,markup_pct:parseFloat(e.target.value)||0})} /></div>
          <div><label className={labelCls}>Handling fee %</label><input type="number" step="0.01" className={inputCls} value={s.handling_pct} onChange={(e)=>setS({...s,handling_pct:parseFloat(e.target.value)||0})} /></div>
        </div>
        <div>
          <label className={labelCls}>Handling fee applied to</label>
          <select className={inputCls} value={s.handling_basis} onChange={(e)=>setS({...s,handling_basis:e.target.value})}>
            <option value="marked_up">Marked-up total (raw × 1.15, then × 1.10)</option>
            <option value="raw">Raw cost only (raw × 1.10), shipping added separately</option>
          </select>
        </div>
        <div><label className={labelCls}>Default waste factor %</label><input type="number" step="0.01" className={inputCls} value={s.waste_pct} onChange={(e)=>setS({...s,waste_pct:parseFloat(e.target.value)||0})} /></div>
        <div className="grid grid-cols-2 gap-3 pt-2 border-t border-zinc-200">
          <div><label className={labelCls}>Overhead %</label><input type="number" step="0.01" data-testid="settings-overhead-pct" className={inputCls} value={s.overhead_pct ?? 10} onChange={(e)=>setS({...s,overhead_pct:parseFloat(e.target.value)||0})} /></div>
          <div><label className={labelCls}>Profit %</label><input type="number" step="0.01" data-testid="settings-profit-pct" className={inputCls} value={s.profit_pct ?? 10} onChange={(e)=>setS({...s,profit_pct:parseFloat(e.target.value)||0})} /></div>
        </div>
        <div className="flex justify-end">
          <button onClick={save} className="bg-blue-700 text-white px-3 h-9 text-xs font-bold uppercase tracking-wider">Save Settings</button>
        </div>
      </div>
      <div className="text-xs text-zinc-500 border border-zinc-200 p-3 rounded-sm bg-zinc-50">
        <b>How the math works:</b> Raw material cost = Σ(qty × unit price). Shipping adds {s.markup_pct}% (covers freight from the vendor to the jobsite). Handling fee adds {s.handling_pct}% {s.handling_basis === "marked_up" ? "on the shipping-included total" : "on the raw cost only"}. Then per-option Labor + Warranty are added, then Overhead ({s.overhead_pct ?? 10}%) and Profit ({s.profit_pct ?? 10}%) compound on top.
      </div>
    </div>
  );
}
