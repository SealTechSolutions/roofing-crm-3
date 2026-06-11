import React, { useState } from "react";
import { api, formatApiError, API } from "@/lib/api";
import { Download, FileSpreadsheet, FileText, Upload, X } from "lucide-react";
import { toast } from "sonner";

export function ExportButtons({ category, label }) {
  const trigger = (fmt) => {
    const token = localStorage.getItem("crm_token");
    const url = `${API}/export/${category}.${fmt}?token=${encodeURIComponent(token)}`;
    // Use fetch with auth header so we don't expose token in browser history; then save
    fetch(url.replace(/\?token=.*$/, ""), {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => {
        if (!r.ok) throw new Error("Export failed");
        return r.blob();
      })
      .then((blob) => {
        const a = document.createElement("a");
        const objUrl = URL.createObjectURL(blob);
        a.href = objUrl;
        a.download = `sealtech-${category}.${fmt}`;
        a.click();
        URL.revokeObjectURL(objUrl);
      })
      .catch((e) => toast.error(e.message));
  };
  return (
    <div className="flex items-center gap-2">
      <button data-testid={`export-${category}-xlsx`} onClick={() => trigger("xlsx")} className="inline-flex items-center gap-1 px-3 h-9 text-[10px] font-bold uppercase tracking-wider border border-zinc-300 hover:border-zinc-950 rounded-sm">
        <FileSpreadsheet className="w-3.5 h-3.5" /> Excel
      </button>
      <button data-testid={`export-${category}-pdf`} onClick={() => trigger("pdf")} className="inline-flex items-center gap-1 px-3 h-9 text-[10px] font-bold uppercase tracking-wider border border-zinc-300 hover:border-zinc-950 rounded-sm">
        <FileText className="w-3.5 h-3.5" /> PDF
      </button>
    </div>
  );
}

export function ImportButton({ category, onImported }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("skip");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const downloadTemplate = () => {
    const token = localStorage.getItem("crm_token");
    fetch(`${API}/export/template/${category}.xlsx`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.blob())
      .then((blob) => {
        const a = document.createElement("a");
        const url = URL.createObjectURL(blob);
        a.href = url;
        a.download = `sealtech-${category}-template.xlsx`;
        a.click();
        URL.revokeObjectURL(url);
      });
  };

  const submit = async () => {
    if (!file) return;
    setBusy(true);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("duplicate_mode", mode);
      const r = await api.post(`/import/${category}`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      setResult(r.data);
      toast.success(`Imported ${r.data.imported} · Updated ${r.data.updated} · Skipped ${r.data.skipped}`);
      onImported?.();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button data-testid={`import-${category}-button`} onClick={() => { setOpen(true); setResult(null); setFile(null); }} className="inline-flex items-center gap-1 px-3 h-9 text-[10px] font-bold uppercase tracking-wider border border-zinc-300 hover:border-zinc-950 rounded-sm">
        <Upload className="w-3.5 h-3.5" /> Import
      </button>
      {open && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-sm shadow-xl w-full max-w-xl" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-zinc-200 flex items-center justify-between">
              <h2 className="font-heading text-xl font-bold tracking-tight">Import {category}</h2>
              <button onClick={() => setOpen(false)} className="p-1.5 hover:bg-zinc-100 rounded-sm"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-6 space-y-5">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-500 mb-2">Step 1 — Get the template</div>
                <button onClick={downloadTemplate} data-testid={`import-${category}-template`} className="inline-flex items-center gap-1 px-3 h-9 text-[10px] font-bold uppercase tracking-wider border border-zinc-300 hover:border-zinc-950 rounded-sm">
                  <Download className="w-3.5 h-3.5" /> Download Template (.xlsx)
                </button>
                <p className="text-xs text-zinc-500 mt-2">Fill it in and re-upload, or upload your own .csv / .xlsx with matching headers.</p>
              </div>

              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-500 mb-2">Step 2 — File</div>
                <input
                  type="file"
                  accept=".csv,.xlsx"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                  data-testid={`import-${category}-file`}
                  className="text-sm"
                />
              </div>

              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-500 mb-2">Step 3 — Duplicate handling</div>
                <div className="flex gap-2">
                  {[["skip", "Skip"], ["update", "Update Existing"], ["create", "Always Create New"]].map(([v, l]) => (
                    <button
                      key={v}
                      data-testid={`import-mode-${v}`}
                      onClick={() => setMode(v)}
                      className={`px-3 h-9 text-[10px] font-bold uppercase tracking-wider border rounded-sm transition-colors ${
                        mode === v ? "bg-zinc-950 text-white border-zinc-950" : "bg-white border-zinc-300 hover:border-zinc-950"
                      }`}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </div>

              {result && (
                <div className="bg-zinc-50 border border-zinc-200 rounded-sm p-3 text-xs space-y-1">
                  <div><b>Imported:</b> {result.imported}</div>
                  <div><b>Updated:</b> {result.updated}</div>
                  <div><b>Skipped:</b> {result.skipped}</div>
                  {result.errors?.length > 0 && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-red-700 font-bold">{result.errors.length} error(s)</summary>
                      <ul className="mt-1 pl-3 list-disc">
                        {result.errors.slice(0, 20).map((e, i) => <li key={i}>Row {e.row}: {e.error}</li>)}
                      </ul>
                    </details>
                  )}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-4 border-t border-zinc-200">
                <button onClick={() => setOpen(false)} className="px-4 h-10 text-xs font-bold uppercase tracking-wider border border-zinc-300 rounded-sm hover:bg-zinc-50">Close</button>
                <button onClick={submit} disabled={!file || busy} data-testid={`import-${category}-submit`} className="px-4 h-10 text-xs font-bold uppercase tracking-wider bg-blue-700 text-white hover:bg-blue-800 rounded-sm disabled:opacity-50">{busy ? "Importing..." : "Import"}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
