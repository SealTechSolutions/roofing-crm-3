import React, { useEffect, useMemo, useState, useRef } from "react";
import { api, formatApiError, API } from "@/lib/api";
import { toast } from "sonner";
import { BookOpen, Search, Upload, Trash2, Download, Folder, FileText, X, Sparkles } from "lucide-react";
import CameraCaptureButton from "@/components/CameraCaptureButton";

export default function Library() {
  const [taxonomy, setTaxonomy] = useState([]);
  const [files, setFiles] = useState([]);
  const [selectedCat, setSelectedCat] = useState(null);  // null = All
  const [selectedSub, setSelectedSub] = useState(null);
  const [search, setSearch] = useState("");
  const [uploadModal, setUploadModal] = useState(null);  // { category, subcategory }
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const [t, f] = await Promise.all([
        api.get("/library/taxonomy"),
        api.get("/library/files"),
      ]);
      setTaxonomy(t.data?.taxonomy || []);
      setFiles(f.data || []);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    let out = files;
    if (selectedCat) out = out.filter((f) => f.category === selectedCat);
    if (selectedSub) out = out.filter((f) => f.subcategory === selectedSub);
    if (search.trim()) {
      const s = search.toLowerCase();
      out = out.filter((f) => `${f.display_name} ${f.description} ${f.original_filename}`.toLowerCase().includes(s));
    }
    return out;
  }, [files, selectedCat, selectedSub, search]);

  const counts = useMemo(() => {
    const c = {};
    for (const f of files) {
      const k = `${f.category}|${f.subcategory}`;
      c[k] = (c[k] || 0) + 1;
      c[f.category] = (c[f.category] || 0) + 1;
    }
    c.__total__ = files.length;
    return c;
  }, [files]);

  const download = (f) => {
    const token = localStorage.getItem("crm_token");
    window.open(`${API}/library/files/${f.id}/download?token=${encodeURIComponent(token)}`, "_blank");
  };

  const remove = async (f) => {
    if (!window.confirm(`Delete "${f.display_name}"? Soft-deletes; admin can restore later.`)) return;
    try {
      await api.delete(`/library/files/${f.id}`);
      toast.success("Deleted");
      load();
    } catch (e) { toast.error(formatApiError(e?.response?.data?.detail) || e.message); }
  };

  const fmtSize = (n) => {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-6" data-testid="library-page">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <BookOpen className="w-4 h-4 text-blue-700" />
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-700">Document Library</div>
          </div>
          <h1 className="font-heading text-4xl font-black tracking-tight">Library</h1>
          <div className="text-xs text-zinc-500 mt-1">Brochures, specs, safety data, certs, contracts — pull straight into a scope email.</div>
        </div>
      </div>

      {/* Marketing brochures — generated on the fly by the backend. Each card
          downloads the latest version (so updates roll out without needing to
          re-upload anything to the library). */}
      <div className="bg-gradient-to-br from-blue-700 to-blue-900 text-white rounded-sm p-5">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="w-4 h-4 text-amber-300" />
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-300">SealTech Marketing</div>
        </div>
        <div className="font-heading text-lg font-black mb-1">Sales Brochures</div>
        <div className="text-xs text-blue-100 mb-4">One-click PDFs you can attach to a quote or print for a site visit. Generated fresh from the backend every download.</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <BrochureCard
            title="Fluid Applied Reinforced Membrane"
            blurb="6-page FARM pitch — Western Colloid systems, lifetime NDL warranty, before/after photos, client roster."
            href="/brochures/farm.pdf"
            filename="SealTech-FARM-Brochure.pdf"
            testId="brochure-farm"
          />
          <BrochureCard
            title="Silicone Restoration"
            blurb="Coming next — Everest Silkoxy systems, NDL upgrade options, granule finish."
            href={null}
            filename="SealTech-Silicone-Brochure.pdf"
            testId="brochure-silicone"
          />
          <BrochureCard
            title="FARM + Silicone Combined"
            blurb="Coming next — FARM-led overview with 1–2 pages on silicone for whichever the customer prefers."
            href={null}
            filename="SealTech-Combined-Brochure.pdf"
            testId="brochure-combined"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6">
        {/* Sidebar — Categories */}
        <aside className="bg-white border border-zinc-200 rounded-sm p-3 h-fit" data-testid="library-sidebar">
          <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-2 px-2">Categories</div>
          <button
            onClick={() => { setSelectedCat(null); setSelectedSub(null); }}
            className={`w-full text-left px-2 py-1.5 text-xs font-bold uppercase tracking-wider rounded-sm flex items-center justify-between ${!selectedCat ? "bg-zinc-950 text-white" : "hover:bg-zinc-100"}`}
            data-testid="library-cat-all"
          >
            <span>All Documents</span><span className="font-mono text-[10px] opacity-80">{counts.__total__ || 0}</span>
          </button>
          {taxonomy.map((cat) => (
            <div key={cat.category} className="mt-3">
              <button
                onClick={() => { setSelectedCat(cat.category); setSelectedSub(null); }}
                className={`w-full text-left px-2 py-1.5 text-xs font-bold uppercase tracking-wider rounded-sm flex items-center justify-between ${selectedCat === cat.category && !selectedSub ? "bg-zinc-950 text-white" : "hover:bg-zinc-100"}`}
                data-testid={`library-cat-${cat.category.replace(/\s+/g, "-").toLowerCase()}`}
              >
                <span className="flex items-center gap-1.5"><Folder className="w-3 h-3" />{cat.category}</span>
                <span className="font-mono text-[10px] opacity-80">{counts[cat.category] || 0}</span>
              </button>
              {selectedCat === cat.category && (
                <div className="ml-3 mt-1 border-l border-zinc-200 pl-2">
                  {cat.subcategories.map((sub) => (
                    <button
                      key={sub}
                      onClick={() => setSelectedSub(sub === selectedSub ? null : sub)}
                      className={`w-full text-left px-2 py-1 text-[11px] rounded-sm flex items-center justify-between ${selectedSub === sub ? "bg-blue-700 text-white font-bold" : "hover:bg-zinc-100 text-zinc-700"}`}
                      data-testid={`library-sub-${sub.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`}
                    >
                      <span>{sub}</span>
                      <span className="font-mono text-[10px] opacity-80">{counts[`${cat.category}|${sub}`] || 0}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </aside>

        {/* Main — files */}
        <main className="bg-white border border-zinc-200 rounded-sm">
          <div className="flex items-center justify-between gap-3 p-4 border-b border-zinc-200 flex-wrap">
            <div className="flex items-center gap-2 flex-1 min-w-[200px]">
              <Search className="w-4 h-4 text-zinc-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name or description..."
                className="flex-1 h-9 text-sm focus:outline-none"
                data-testid="library-search"
              />
            </div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">
              {filtered.length} document{filtered.length === 1 ? "" : "s"}
              {selectedCat && <> · <b>{selectedCat}</b></>}
              {selectedSub && <> / <b>{selectedSub}</b></>}
            </div>
            <button
              onClick={() => setUploadModal({ category: selectedCat || taxonomy[0]?.category, subcategory: selectedSub || taxonomy[0]?.subcategories?.[0] })}
              className="inline-flex items-center gap-2 bg-blue-700 text-white px-3 h-9 text-[11px] font-bold uppercase tracking-wider hover:bg-blue-800 rounded-sm"
              data-testid="library-upload-btn"
            >
              <Upload className="w-3.5 h-3.5" /> Upload
            </button>
          </div>
          {loading ? (
            <div className="p-12 text-center text-sm text-zinc-500">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center">
              <FileText className="w-8 h-8 text-zinc-300 mx-auto mb-2" />
              <div className="text-sm text-zinc-500">No documents yet in this view.</div>
              <button onClick={() => setUploadModal({ category: selectedCat || taxonomy[0]?.category, subcategory: selectedSub || taxonomy[0]?.subcategories?.[0] })} className="mt-3 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-blue-700 hover:underline">
                <Upload className="w-3.5 h-3.5" /> Upload the first one
              </button>
            </div>
          ) : (
            <div className="divide-y divide-zinc-100">
              {filtered.map((f) => (
                <div key={f.id} className="px-4 py-3 hover:bg-zinc-50 flex items-center gap-3" data-testid={`library-file-${f.id}`}>
                  <FileText className="w-5 h-5 text-zinc-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-sm truncate">{f.display_name}</div>
                    <div className="text-[11px] text-zinc-500 truncate">
                      {f.category} / {f.subcategory} · {f.original_filename} · {fmtSize(f.size)}
                      {f.description && <> · <span className="italic">{f.description}</span></>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button onClick={() => download(f)} className="border border-zinc-300 px-2.5 h-8 text-[10px] font-bold uppercase tracking-wider hover:bg-white rounded-sm inline-flex items-center gap-1" title="Download" data-testid={`library-download-${f.id}`}>
                      <Download className="w-3 h-3" /> Download
                    </button>
                    <button onClick={() => remove(f)} className="p-2 hover:bg-red-100 text-red-700 rounded-sm" title="Delete" data-testid={`library-delete-${f.id}`}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>

      {uploadModal && (
        <UploadModal preset={uploadModal} taxonomy={taxonomy} onClose={() => setUploadModal(null)} onSaved={() => { setUploadModal(null); load(); }} />
      )}
    </div>
  );
}


function UploadModal({ preset, taxonomy, onClose, onSaved }) {
  const [category, setCategory] = useState(preset?.category || taxonomy[0]?.category || "");
  const [subcategory, setSubcategory] = useState(preset?.subcategory || taxonomy[0]?.subcategories?.[0] || "");
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState([]);  // multi-file
  const [saving, setSaving] = useState(false);
  const fileInput = useRef(null);

  const subs = useMemo(() => taxonomy.find((c) => c.category === category)?.subcategories || [], [taxonomy, category]);
  useEffect(() => {
    if (subs.length && !subs.includes(subcategory)) setSubcategory(subs[0]);
  }, [subs, subcategory]);

  const submit = async (e) => {
    e.preventDefault();
    if (!files.length) { toast.error("Pick one or more files"); return; }
    setSaving(true);
    let ok = 0, failed = 0;
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const form = new FormData();
      form.append("file", f);
      form.append("category", category);
      form.append("subcategory", subcategory);
      // Only apply the custom display name when uploading a single file —
      // otherwise let each file keep its own filename.
      form.append("display_name", files.length === 1 ? displayName : "");
      form.append("description", description);
      try {
        await api.post("/library/files", form, { headers: { "Content-Type": "multipart/form-data" } });
        ok += 1;
      } catch (err) {
        failed += 1;
        toast.error(`${f.name}: ${formatApiError(err?.response?.data?.detail) || err.message}`);
      }
    }
    setSaving(false);
    if (ok > 0) {
      toast.success(`${ok} file${ok === 1 ? "" : "s"} uploaded${failed ? ` (${failed} failed)` : ""}`);
      onSaved();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" data-testid="library-upload-modal">
      <form onSubmit={submit} className="bg-white border border-zinc-200 rounded-sm w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-700 mb-1">Upload to Library</div>
            <h3 className="font-heading text-lg font-black tracking-tight">New Document</h3>
          </div>
          <button type="button" onClick={onClose}><X className="w-4 h-4 text-zinc-500" /></button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-600 mb-1">Category *</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full h-10 px-3 border border-zinc-300 rounded-sm text-sm bg-white" data-testid="upload-category">
              {taxonomy.map((c) => <option key={c.category} value={c.category}>{c.category}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-600 mb-1">Sub-category *</label>
            <select value={subcategory} onChange={(e) => setSubcategory(e.target.value)} className="w-full h-10 px-3 border border-zinc-300 rounded-sm text-sm bg-white" data-testid="upload-subcategory">
              {subs.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-600 mb-1">Files * <span className="font-normal text-zinc-500">(pick one or many)</span></label>
            <div className="flex items-center gap-2 flex-wrap">
              <input ref={fileInput} type="file" multiple onChange={(e) => setFiles(Array.from(e.target.files || []))} className="flex-1 min-w-0 text-sm" data-testid="upload-file" />
              <CameraCaptureButton
                onFiles={(fl) => setFiles((prev) => [...prev, ...Array.from(fl)])}
                testId="camera-library-btn"
              />
            </div>
            <div className="text-[10px] text-zinc-500 mt-1">
              PDF, image, or Word doc. Max 50MB each.
              {files.length > 0 && <span className="ml-2 font-bold text-blue-700">{files.length} selected</span>}
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-600 mb-1">
              Display Name {files.length > 1 && <span className="font-normal text-zinc-400 normal-case">(ignored — multiple files keep their own names)</span>}
            </label>
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="(defaults to filename)" disabled={files.length > 1} className="w-full h-10 px-3 border border-zinc-300 rounded-sm text-sm disabled:bg-zinc-50 disabled:text-zinc-400" data-testid="upload-display-name" />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-600 mb-1">Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="(optional)" className="w-full px-3 py-2 border border-zinc-300 rounded-sm text-sm" data-testid="upload-description" />
          </div>
        </div>
        <div className="px-5 py-4 border-t border-zinc-200 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 h-10 text-xs font-bold uppercase tracking-wider border border-zinc-300 rounded-sm hover:bg-zinc-50">Cancel</button>
          <button type="submit" disabled={saving} data-testid="upload-submit" className="px-4 h-10 text-xs font-bold uppercase tracking-wider bg-blue-700 text-white hover:bg-blue-800 rounded-sm disabled:opacity-50">{saving ? "Uploading..." : "Upload"}</button>
        </div>
      </form>
    </div>
  );
}


function BrochureCard({ title, blurb, href, filename, testId }) {
  const [busy, setBusy] = React.useState(false);
  const download = async () => {
    if (!href) return;
    setBusy(true);
    const tid = toast.loading(`Generating ${filename}…`);
    try {
      const r = await api.get(href, { responseType: "blob" });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement("a");
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success(`${filename} downloaded`, { id: tid });
    } catch (e) {
      toast.error(e?.response?.data?.detail || e?.message || "Download failed", { id: tid });
    } finally {
      setBusy(false);
    }
  };
  const enabled = !!href;
  return (
    <div className={`rounded-sm p-4 flex flex-col gap-3 border ${enabled ? "bg-white/10 border-white/20 hover:bg-white/20 transition-colors" : "bg-white/5 border-white/10 opacity-60"}`}>
      <div>
        <div className="font-heading text-sm font-black leading-tight mb-1">{title}</div>
        <div className="text-[11px] text-blue-100 leading-snug">{blurb}</div>
      </div>
      <button
        type="button"
        disabled={!enabled || busy}
        onClick={download}
        data-testid={testId}
        className={`mt-auto flex items-center justify-center gap-1.5 px-3 h-9 text-[10px] font-bold uppercase tracking-wider rounded-sm transition-colors ${enabled ? "bg-amber-400 text-blue-950 hover:bg-amber-300" : "bg-white/10 text-white/40 cursor-not-allowed"}`}
      >
        <Download className="w-3.5 h-3.5" />
        {!enabled ? "Coming soon" : busy ? "Generating…" : "Download PDF"}
      </button>
    </div>
  );
}
