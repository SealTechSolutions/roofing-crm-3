/**
 * CloseOutChecklistModal — the 20-item close-out flow that replaces the
 * one-click "Mark Complete" action. Rep works through items over multiple
 * days; the modal auto-saves each toggle so nothing is lost. Only fully
 * closes the deal (Finalize & Archive) once all 16 required items are done.
 * Optional items (Google review, Public Gallery, Maintenance plan, Referral)
 * are tracked but never block finalization.
 *
 * Phase-2 additions (Feb 2026):
 *   • Auto-checks: NDL / final-payment / commission items flip from the
 *     backend when the underlying data is already in place. Auto items
 *     render a violet "AUTO" pill and can't be manually un-checked.
 *   • Embedded P&L widget on the `pnl_variance_review` row — pulls
 *     `/deals/{id}/close-out/pnl-summary` and shows a compact revenue/
 *     cost/margin/variance grid inline.
 *   • File attachments — any checklist item accepts docs (Warranty PDF,
 *     lien waiver photo, punch-list scan). Attachments hang off the item
 *     state and stream from Object Storage.
 */
import React, { useEffect, useMemo, useState, useRef } from "react";
import { toast } from "sonner";
import { api, formatCurrency } from "@/lib/api";
import { X, CheckCircle2, Lock, Archive, Sparkles, Zap, Paperclip, Trash2 } from "lucide-react";

const SECTION_ICONS = {
  "Site & Quality": "\u{1F528}",     // hammer
  "Documentation":  "\u{1F4C4}",     // page
  "Financial":      "\u{1F4B0}",     // money
  "Follow-up":      "\u{1F4E3}",     // megaphone
};

// Items where an uploaded doc is genuinely expected — anywhere else we
// still allow attachments, we just don't advertise the slot.
const ITEMS_EXPECTING_ATTACHMENTS = new Set([
  "punch_list_signed",
  "customer_signoff",
  "mfg_warranty_delivered",
  "contractor_warranty_del",
  "ndl_registered",
  "om_manual_delivered",
  "lien_waivers_signed",
]);

const PnLInline = ({ dealId }) => {
  const [pnl, setPnl] = useState(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let cancelled = false;
    api.get(`/deals/${dealId}/close-out/pnl-summary`)
      .then((r) => { if (!cancelled) setPnl(r.data); })
      .catch(() => { if (!cancelled) setErr(true); });
    return () => { cancelled = true; };
  }, [dealId]);
  if (err) {
    return <div className="mt-2 text-[11px] text-red-700">Could not load P&amp;L snapshot.</div>;
  }
  if (!pnl) {
    return <div className="mt-2 text-[11px] text-zinc-500 italic">Loading P&amp;L snapshot…</div>;
  }
  const variance = Number(pnl.variance_pct || 0);
  const margin = Number(pnl.gross_margin_pct || 0);
  const varCls = Math.abs(variance) <= 5 ? "text-emerald-700"
    : Math.abs(variance) <= 15 ? "text-amber-700"
    : "text-red-700";
  const marCls = margin >= 15 ? "text-emerald-700" : margin >= 5 ? "text-amber-700" : "text-red-700";
  return (
    <div className="mt-2 border border-zinc-200 rounded-sm bg-white p-3" data-testid="close-out-pnl-widget">
      <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-2">Final P&amp;L Snapshot</div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
        <div>
          <div className="text-[9px] uppercase tracking-widest text-zinc-500">Revenue</div>
          <div className="font-heading font-black text-sm text-zinc-900" data-testid="pnl-widget-revenue">{formatCurrency(pnl.revenue)}</div>
        </div>
        <div>
          <div className="text-[9px] uppercase tracking-widest text-zinc-500">Est · Actual</div>
          <div className="font-mono text-[11px] text-zinc-800" data-testid="pnl-widget-costs">
            {formatCurrency(pnl.estimated_cost)}
            <br />
            <span className="text-zinc-500">{formatCurrency(pnl.actual_cost)}</span>
          </div>
        </div>
        <div>
          <div className="text-[9px] uppercase tracking-widest text-zinc-500">Gross Profit</div>
          <div className={`font-heading font-black text-sm ${pnl.gross_profit >= 0 ? "text-emerald-700" : "text-red-700"}`} data-testid="pnl-widget-profit">
            {formatCurrency(pnl.gross_profit)}
          </div>
          <div className={`text-[10px] font-mono ${marCls}`}>{margin.toFixed(1)}% margin</div>
        </div>
        <div>
          <div className="text-[9px] uppercase tracking-widest text-zinc-500">Variance</div>
          <div className={`font-heading font-black text-sm ${varCls}`} data-testid="pnl-widget-variance">
            {variance >= 0 ? "+" : ""}{variance.toFixed(1)}%
          </div>
          <div className="text-[9px] text-zinc-500">est → actual</div>
        </div>
      </div>
      {Math.abs(variance) > 5 && (
        <div className="mt-2 text-[10px] text-amber-800 bg-amber-50 border border-amber-200 rounded-sm px-2 py-1">
          Variance is over 5% — double-check the actuals or add a note explaining the gap before finalizing.
        </div>
      )}
    </div>
  );
};

const AttachmentsRow = ({ dealId, itemKey, atts, onChange }) => {
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const token = typeof window !== "undefined" ? localStorage.getItem("crm_token") : null;

  const handleUpload = async (evt) => {
    const f = evt.target.files?.[0];
    if (!f) return;
    if (f.size > 25 * 1024 * 1024) {
      toast.error("File too large — 25 MB max");
      return;
    }
    const form = new FormData();
    form.append("file", f);
    setUploading(true);
    try {
      const r = await api.post(`/deals/${dealId}/close-out/item/${itemKey}/attachments`, form);
      onChange([...(atts || []), r.data]);
      toast.success("Attached");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleDelete = async (fileId) => {
    if (!window.confirm("Remove this attachment?")) return;
    try {
      await api.delete(`/deals/${dealId}/close-out/item/${itemKey}/attachments/${fileId}`);
      onChange((atts || []).filter((a) => a.id !== fileId));
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Delete failed");
    }
  };

  const list = atts || [];
  return (
    <div className="mt-1.5" data-testid={`close-out-attachments-${itemKey}`}>
      {list.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 mb-1.5">
          {list.map((a) => {
            const href = `${process.env.REACT_APP_BACKEND_URL}/api/deals/${dealId}/close-out/item/${itemKey}/attachments/${a.id}/download?token=${encodeURIComponent(token || "")}`;
            return (
              <li key={a.id} className="inline-flex items-center gap-1.5 text-[10px] px-2 py-1 bg-white border border-zinc-200 rounded-sm">
                <Paperclip className="w-3 h-3 text-zinc-500" />
                <a href={href} target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-700 hover:underline truncate max-w-[180px]">
                  {a.original_filename}
                </a>
                <span className="text-zinc-400 font-mono">{Math.round((a.size || 0) / 1024)} KB</span>
                <button
                  onClick={() => handleDelete(a.id)}
                  data-testid={`close-out-att-delete-${a.id}`}
                  className="text-zinc-400 hover:text-red-600"
                  title="Remove attachment"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex items-center gap-1.5">
        <input ref={fileRef} type="file" onChange={handleUpload} className="hidden" data-testid={`close-out-att-input-${itemKey}`} />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          data-testid={`close-out-att-btn-${itemKey}`}
          className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-blue-700 hover:text-blue-900 disabled:opacity-40"
        >
          <Paperclip className="w-3 h-3" />
          {uploading ? "Uploading…" : (list.length === 0 ? "Attach file" : "Add another")}
        </button>
      </div>
    </div>
  );
};

export default function CloseOutChecklistModal({ deal, onClose, onFinalized }) {
  const [items, setItems] = useState([]);           // canonical item defs from backend
  const [checklist, setChecklist] = useState({});   // per-item state
  const [progress, setProgress] = useState({ required_done: 0, required_total: 16, optional_done: 0, complete: false });
  const [savingKey, setSavingKey] = useState(null);
  const [finalizing, setFinalizing] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = async () => {
    try {
      const [cfg, started] = await Promise.all([
        api.get("/close-out/items"),
        api.post(`/deals/${deal.id}/close-out/start`),
      ]);
      setItems(cfg.data || []);
      const d = started.data || {};
      setChecklist(d.close_out_checklist || {});
      setProgress(d.close_out_progress || { required_done: 0, required_total: 16, optional_done: 0, complete: false });
      setLoaded(true);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to load checklist");
      onClose?.();
    }
  };

  useEffect(() => { load(); }, [deal.id]);

  const toggle = async (key, next) => {
    const state = checklist[key] || {};
    if (state.auto) {
      toast.info("Auto-verified from live data — change the underlying record to un-check.");
      return;
    }
    setSavingKey(key);
    const prev = { ...state };
    setChecklist({ ...checklist, [key]: { ...prev, done: next, date: next ? new Date().toISOString() : "", auto: false } });
    try {
      const r = await api.put(`/deals/${deal.id}/close-out/item`, { key, done: next });
      setProgress(r.data.close_out_progress);
    } catch (e) {
      setChecklist({ ...checklist, [key]: prev });
      toast.error(e?.response?.data?.detail || "Save failed");
    } finally {
      setSavingKey(null);
    }
  };

  const updateNote = async (key, note) => {
    const prev = checklist[key] || { done: false, date: "", note: "", attachments: [] };
    setChecklist({ ...checklist, [key]: { ...prev, note } });
    try {
      await api.put(`/deals/${deal.id}/close-out/item`, { key, done: prev.done, date: prev.date, note });
    } catch {
      /* silent — notes are low-priority */
    }
  };

  const setAttachments = (key, next) => {
    const prev = checklist[key] || { done: false, date: "", note: "", attachments: [] };
    setChecklist({ ...checklist, [key]: { ...prev, attachments: next } });
  };

  const finalize = async (force = false) => {
    setFinalizing(true);
    try {
      const r = await api.post(`/deals/${deal.id}/close-out/finalize`, { force });
      toast.success(force ? "Deal force-closed by admin" : "\u{1F389} Deal fully closed & archived");
      onFinalized?.(r.data);
      onClose?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Finalize failed");
    } finally {
      setFinalizing(false);
    }
  };

  // Group items by section for rendering
  const grouped = useMemo(() => {
    const g = {};
    for (const it of items) {
      if (!g[it.section]) g[it.section] = [];
      g[it.section].push(it);
    }
    return g;
  }, [items]);

  const pctBar = progress.required_total > 0 ? (progress.required_done / progress.required_total) * 100 : 0;
  const pillCls = progress.complete
    ? "bg-emerald-50 text-emerald-800 border-emerald-300"
    : progress.required_done === 0
      ? "bg-red-50 text-red-800 border-red-300"
      : "bg-amber-50 text-amber-800 border-amber-300";

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose} data-testid="close-out-modal">
      <div className="bg-white rounded-sm max-w-3xl w-full max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="px-5 py-4 border-b border-zinc-200 sticky top-0 bg-white z-10">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-700">Close-Out Checklist</div>
              <h2 className="font-heading text-xl font-black">{deal.title}</h2>
              <div className="text-[11px] text-zinc-500 mt-0.5">{deal.property_address}{deal.property_city ? ` \u00B7 ${deal.property_city}` : ""}</div>
            </div>
            <div className="flex items-center gap-3">
              <span className={`px-2.5 py-1 text-[11px] font-bold uppercase tracking-widest border rounded-sm ${pillCls}`} data-testid="close-out-progress-pill">
                {progress.complete ? "Fully Closed" : `${progress.required_done}/${progress.required_total} required`}
              </span>
              <button onClick={onClose} className="text-zinc-400 hover:text-zinc-700" data-testid="close-out-close-btn"><X className="w-5 h-5" /></button>
            </div>
          </div>
          {/* Progress bar */}
          <div className="mt-3 h-1.5 bg-zinc-100 rounded-sm overflow-hidden">
            <div className={`h-full transition-all ${progress.complete ? "bg-emerald-600" : "bg-blue-600"}`} style={{ width: `${pctBar}%` }} />
          </div>
          {progress.optional_done > 0 && (
            <div className="mt-1.5 text-[10px] text-blue-700 flex items-center gap-1">
              <Sparkles className="w-3 h-3" /> {progress.optional_done} optional item{progress.optional_done !== 1 ? "s" : ""} also completed
            </div>
          )}
        </div>

        {/* Sections */}
        <div className="p-5 space-y-6">
          {!loaded ? (
            <div className="text-center text-zinc-500 py-8 text-sm">Loading checklist…</div>
          ) : Object.entries(grouped).map(([section, list]) => (
            <section key={section} data-testid={`close-out-section-${section.toLowerCase().replace(/[^a-z]/g, "-")}`}>
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-2">
                {SECTION_ICONS[section]} {section}
              </h3>
              <ul className="space-y-2">
                {list.map((it) => {
                  const state = checklist[it.key] || { done: false, date: "", note: "", attachments: [], auto: false };
                  const isSaving = savingKey === it.key;
                  const isAuto = !!state.auto;
                  const showsAttachments = ITEMS_EXPECTING_ATTACHMENTS.has(it.key) || (state.attachments || []).length > 0;
                  const showsPnl = it.key === "pnl_variance_review";
                  return (
                    <li key={it.key} className={`rounded-sm border p-3 transition-colors ${
                      state.done
                        ? isAuto
                          ? "border-violet-200 bg-violet-50/50"
                          : "border-emerald-200 bg-emerald-50/50"
                        : it.required
                          ? "border-zinc-200 bg-white"
                          : "border-dashed border-zinc-200 bg-zinc-50/60"
                    }`} data-testid={`close-out-item-${it.key}`}>
                      <div className="flex items-start gap-3">
                        <button
                          onClick={() => toggle(it.key, !state.done)}
                          disabled={isSaving || isAuto}
                          data-testid={`close-out-toggle-${it.key}`}
                          className={`mt-0.5 flex-shrink-0 w-6 h-6 rounded-sm border-2 flex items-center justify-center transition-colors ${
                            state.done
                              ? isAuto
                                ? "border-violet-600 bg-violet-600 text-white"
                                : "border-emerald-600 bg-emerald-600 text-white"
                              : "border-zinc-300 hover:border-blue-600"
                          } ${isSaving ? "opacity-50" : ""} ${isAuto ? "cursor-not-allowed" : ""}`}
                          title={isAuto ? "Auto-verified — change source data to modify" : undefined}
                        >
                          {state.done && <CheckCircle2 className="w-4 h-4" />}
                        </button>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 text-sm flex-wrap">
                            <span className={`font-semibold ${state.done ? "text-zinc-500 line-through" : "text-zinc-900"}`}>{it.label}</span>
                            {it.required ? (
                              <span className="text-red-600 font-bold text-xs" title="Required">*</span>
                            ) : (
                              <span className="text-[9px] font-bold uppercase tracking-widest text-blue-700 bg-blue-50 border border-blue-200 rounded-sm px-1.5">Optional</span>
                            )}
                            {isAuto && (
                              <span className="text-[9px] font-bold uppercase tracking-widest text-violet-700 bg-violet-50 border border-violet-200 rounded-sm px-1.5 inline-flex items-center gap-0.5" data-testid={`close-out-auto-pill-${it.key}`}>
                                <Zap className="w-2.5 h-2.5" /> Auto
                              </span>
                            )}
                            {state.date && state.done && (
                              <span className="text-[10px] text-zinc-500 font-mono">
                                {new Date(state.date).toLocaleDateString()}
                              </span>
                            )}
                          </div>
                          {isAuto && state.note && (
                            <div className="mt-1 text-[10px] italic text-violet-700">{state.note}</div>
                          )}
                          {state.done && !isAuto && (
                            <input
                              type="text"
                              placeholder="Add a note (optional)…"
                              value={state.note || ""}
                              onChange={(e) => setChecklist({ ...checklist, [it.key]: { ...state, note: e.target.value } })}
                              onBlur={(e) => updateNote(it.key, e.target.value)}
                              data-testid={`close-out-note-${it.key}`}
                              className="mt-1.5 w-full text-xs px-2 h-7 border border-zinc-200 rounded-sm bg-white focus:border-blue-400 focus:outline-none"
                            />
                          )}
                          {showsPnl && <PnLInline dealId={deal.id} />}
                          {showsAttachments && (
                            <AttachmentsRow
                              dealId={deal.id}
                              itemKey={it.key}
                              atts={state.attachments || []}
                              onChange={(next) => setAttachments(it.key, next)}
                            />
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-zinc-200 sticky bottom-0 bg-white flex items-center justify-between gap-3 flex-wrap">
          <div className="text-[11px] text-zinc-500 flex items-center gap-1">
            <Lock className="w-3.5 h-3.5" /> Every change auto-saves — come back tomorrow to keep going.
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} data-testid="close-out-later-btn" className="h-10 px-4 text-xs font-bold uppercase tracking-wider rounded-sm text-zinc-700 hover:bg-zinc-100">
              Save & Continue Later
            </button>
            <button
              onClick={() => finalize(false)}
              disabled={!progress.complete || finalizing}
              data-testid="close-out-finalize-btn"
              className={`h-10 px-5 text-xs font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2 ${
                progress.complete
                  ? "bg-emerald-700 hover:bg-emerald-800 text-white"
                  : "bg-zinc-200 text-zinc-400 cursor-not-allowed"
              } ${finalizing ? "opacity-60" : ""}`}
              title={progress.complete ? "Archive this deal and stamp closed" : `Finish the remaining ${progress.required_total - progress.required_done} required item(s) first`}
            >
              <Archive className="w-4 h-4" /> {finalizing ? "Finalizing…" : "Finalize & Archive"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
