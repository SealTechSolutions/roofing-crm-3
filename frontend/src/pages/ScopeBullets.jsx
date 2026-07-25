/**
 * ScopeBullets — Admin settings page for editing the "Scope of Work"
 * boilerplate bullets that appear on every Spec Sheet PDF and Work Order.
 *
 * Route: /settings/scope-bullets (admin-only)
 * API:   GET/PUT /api/settings/scope-bullets, POST /api/settings/scope-bullets/reset
 *
 * UX:
 *   - Left column: list of editable templates (Silicone, FARM, TPO, etc.)
 *   - Right column: editable bullet lists for each section
 *     (scope_1 = "Inspection & Prep", wo_scope_2 = "WO Extra Bullets")
 *   - Per-bullet: text area + up/down reorder + delete
 *   - "+ Add bullet" appends a new empty row
 *   - "Save changes" persists to the backend and refreshes the effective list
 *   - "Reset to defaults" reverts this template's overrides
 *   - Blue badge on templates that currently have an override
 */
import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { ArrowUp, ArrowDown, Plus, Trash2, RotateCcw, Save, ClipboardList, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { Navigate } from "react-router-dom";

export default function ScopeBullets() {
  const { user } = useAuth();
  const [templates, setTemplates] = useState([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [draft, setDraft] = useState({}); // { section_key: [bullets] } for the currently-selected template
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(null);

  const load = async () => {
    try {
      const r = await api.get("/settings/scope-bullets");
      const list = r.data.templates || [];
      setTemplates(list);
      setUpdatedAt(r.data.updated_at);
      if (list.length && !selectedKey) {
        setSelectedKey(list[0].key);
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to load scope bullets");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user?.role !== "admin") return;
    load();
  }, [user]);

  // Refresh the local draft whenever the selected template changes
  const selected = useMemo(
    () => templates.find((t) => t.key === selectedKey) || null,
    [templates, selectedKey]
  );

  useEffect(() => {
    if (!selected) {
      setDraft({});
      setDirty(false);
      return;
    }
    const d = {};
    for (const [sk, sv] of Object.entries(selected.sections || {})) {
      d[sk] = [...(sv.effective || [])];
    }
    setDraft(d);
    setDirty(false);
  }, [selectedKey, templates.length]);

  if (user && user.role !== "admin") return <Navigate to="/" replace />;

  const setBullet = (sec, idx, val) => {
    setDraft((prev) => ({
      ...prev,
      [sec]: prev[sec].map((b, i) => (i === idx ? val : b)),
    }));
    setDirty(true);
  };

  const addBullet = (sec) => {
    setDraft((prev) => ({ ...prev, [sec]: [...(prev[sec] || []), ""] }));
    setDirty(true);
  };

  const removeBullet = (sec, idx) => {
    setDraft((prev) => ({ ...prev, [sec]: prev[sec].filter((_, i) => i !== idx) }));
    setDirty(true);
  };

  const moveBullet = (sec, idx, dir) => {
    setDraft((prev) => {
      const arr = [...prev[sec]];
      const swap = idx + dir;
      if (swap < 0 || swap >= arr.length) return prev;
      [arr[idx], arr[swap]] = [arr[swap], arr[idx]];
      return { ...prev, [sec]: arr };
    });
    setDirty(true);
  };

  const restoreDefaults = (sec) => {
    if (!selected) return;
    const def = selected.sections?.[sec]?.defaults || [];
    setDraft((prev) => ({ ...prev, [sec]: [...def] }));
    setDirty(true);
  };

  const saveTemplate = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      // Trim + drop empty bullets before sending
      const sectionsOut = {};
      for (const [sk, list] of Object.entries(draft)) {
        sectionsOut[sk] = (list || []).map((x) => x.trim()).filter(Boolean);
      }
      const r = await api.put("/settings/scope-bullets", {
        template_key: selected.key,
        sections: sectionsOut,
      });
      setTemplates(r.data.templates || []);
      setUpdatedAt(r.data.updated_at);
      setDirty(false);
      toast.success(`${selected.name} saved`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const resetTemplate = async () => {
    if (!selected) return;
    if (!window.confirm(`Reset "${selected.name}" bullets back to the code defaults? Any custom edits will be discarded.`)) {
      return;
    }
    try {
      const r = await api.post("/settings/scope-bullets/reset", { template_key: selected.key });
      setTemplates(r.data.templates || []);
      setUpdatedAt(r.data.updated_at);
      toast.success(`${selected.name} reset to defaults`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Reset failed");
    }
  };

  return (
    <div className="max-w-7xl mx-auto p-6" data-testid="scope-bullets-page">
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-700 mb-1">Settings</div>
          <h1 className="font-heading text-3xl font-black text-zinc-900 flex items-center gap-3">
            <ClipboardList className="w-7 h-7 text-blue-700" /> Scope Boilerplate Editor
          </h1>
          <p className="text-sm text-zinc-600 mt-2 max-w-2xl">
            Edit the standard <b>Inspection &amp; Prep</b> bullets that appear on every Spec Sheet PDF
            and Work Order for each roof system. Changes go live immediately — new deals and freshly
            re-drafted Work Orders will pick up your edits automatically.
          </p>
          {updatedAt && (
            <p className="text-[11px] text-zinc-500 mt-2">
              Last updated {new Date(updatedAt).toLocaleString()}
            </p>
          )}
        </div>
      </div>

      {loading ? (
        <div className="text-center text-zinc-500 py-12">Loading templates…</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
          {/* ── Template list ─────────────────────────────────── */}
          <div className="bg-white border border-zinc-200 rounded-sm overflow-hidden" data-testid="template-list">
            <div className="px-4 py-3 border-b border-zinc-200 bg-zinc-50">
              <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-600">
                Roof System Templates
              </div>
            </div>
            <ul className="divide-y divide-zinc-100 max-h-[70vh] overflow-y-auto">
              {templates.map((t) => {
                const anyOverride = Object.values(t.sections || {}).some((s) => s.has_override);
                return (
                  <li key={t.key}>
                    <button
                      onClick={() => {
                        if (dirty && !window.confirm("You have unsaved changes. Discard and switch templates?")) return;
                        setSelectedKey(t.key);
                      }}
                      data-testid={`template-tab-${t.key}`}
                      className={`w-full text-left px-4 py-3 text-sm hover:bg-blue-50 transition-colors ${
                        selectedKey === t.key ? "bg-blue-50 border-l-4 border-blue-700" : "border-l-4 border-transparent"
                      }`}
                    >
                      <div className="font-semibold text-zinc-900 flex items-center gap-2">
                        {t.name}
                        {anyOverride && (
                          <span
                            className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-blue-800 bg-blue-100 px-1.5 py-0.5 rounded-sm"
                            title="This template has custom bullets"
                          >
                            <CheckCircle2 className="w-2.5 h-2.5" /> Custom
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-zinc-500 truncate">{t.title}</div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* ── Editor panel ──────────────────────────────────── */}
          <div className="space-y-6">
            {!selected ? (
              <div className="bg-white border border-zinc-200 rounded-sm p-8 text-center text-zinc-500">
                Pick a template on the left to edit its bullets.
              </div>
            ) : (
              <>
                <div className="bg-white border border-zinc-200 rounded-sm p-5">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-wider text-blue-700">
                        Editing
                      </div>
                      <h2 className="font-heading text-2xl font-black text-zinc-900" data-testid="selected-template-name">
                        {selected.name}
                      </h2>
                      <div className="text-[11px] text-zinc-500 mt-1">
                        Underlying scope title: <b>{selected.title}</b>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={resetTemplate}
                        data-testid="reset-template-btn"
                        className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-bold uppercase tracking-wider rounded-sm border border-zinc-300 text-zinc-700 hover:bg-zinc-50"
                      >
                        <RotateCcw className="w-3.5 h-3.5" /> Reset to Defaults
                      </button>
                      <button
                        onClick={saveTemplate}
                        disabled={!dirty || saving}
                        data-testid="save-template-btn"
                        className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-bold uppercase tracking-wider rounded-sm bg-blue-700 hover:bg-blue-800 text-white disabled:opacity-40"
                      >
                        <Save className="w-3.5 h-3.5" /> {saving ? "Saving…" : "Save Changes"}
                      </button>
                    </div>
                  </div>

                  {Object.keys(selected.sections || {}).length === 0 && (
                    <div className="text-sm text-zinc-500 italic py-6 text-center">
                      This template has no editable bullet sections.
                    </div>
                  )}

                  {Object.entries(selected.sections || {}).map(([sec, meta]) => {
                    const bullets = draft[sec] || [];
                    return (
                      <div key={sec} className="mt-6 first:mt-0" data-testid={`section-${sec}`}>
                        <div className="flex items-center justify-between mb-2">
                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                              {sec === "scope_1" ? "Section: Inspection & Prep" : "Section: Work Order Extras"}
                            </div>
                            <h3 className="text-sm font-bold text-zinc-900">{meta.label}</h3>
                            <div className="text-[10px] text-zinc-500 mt-0.5">
                              {sec === "scope_1"
                                ? "Appears on every Spec Sheet PDF & Work Order for this roof system."
                                : "Appears ONLY on Work Orders (skipped in the customer-facing Spec Sheet)."}
                            </div>
                          </div>
                          <button
                            onClick={() => restoreDefaults(sec)}
                            data-testid={`restore-defaults-${sec}`}
                            className="text-[10px] font-bold uppercase tracking-wider text-blue-700 hover:text-blue-900"
                          >
                            Load Defaults
                          </button>
                        </div>

                        <ul className="space-y-2">
                          {bullets.map((b, i) => (
                            <li key={i} className="flex items-start gap-2" data-testid={`bullet-${sec}-${i}`}>
                              <div className="flex flex-col gap-0.5 pt-1.5">
                                <button
                                  onClick={() => moveBullet(sec, i, -1)}
                                  disabled={i === 0}
                                  data-testid={`bullet-up-${sec}-${i}`}
                                  className="w-6 h-5 flex items-center justify-center rounded-sm text-zinc-500 hover:bg-zinc-100 disabled:opacity-30"
                                  title="Move up"
                                >
                                  <ArrowUp className="w-3 h-3" />
                                </button>
                                <button
                                  onClick={() => moveBullet(sec, i, 1)}
                                  disabled={i === bullets.length - 1}
                                  data-testid={`bullet-down-${sec}-${i}`}
                                  className="w-6 h-5 flex items-center justify-center rounded-sm text-zinc-500 hover:bg-zinc-100 disabled:opacity-30"
                                  title="Move down"
                                >
                                  <ArrowDown className="w-3 h-3" />
                                </button>
                              </div>
                              <textarea
                                value={b}
                                onChange={(e) => setBullet(sec, i, e.target.value)}
                                data-testid={`bullet-input-${sec}-${i}`}
                                rows={2}
                                className="flex-1 px-3 py-2 border border-zinc-300 rounded-sm text-sm resize-y"
                                placeholder="Type a scope-of-work bullet…"
                              />
                              <button
                                onClick={() => removeBullet(sec, i)}
                                data-testid={`bullet-delete-${sec}-${i}`}
                                className="mt-1.5 w-8 h-8 flex items-center justify-center rounded-sm text-red-600 hover:bg-red-50"
                                title="Delete bullet"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </li>
                          ))}
                        </ul>

                        <button
                          onClick={() => addBullet(sec)}
                          data-testid={`add-bullet-${sec}`}
                          className="mt-3 inline-flex items-center gap-1.5 h-9 px-3 text-xs font-bold uppercase tracking-wider rounded-sm border border-blue-300 bg-blue-50 text-blue-800 hover:bg-blue-100"
                        >
                          <Plus className="w-3.5 h-3.5" /> Add Bullet
                        </button>

                        {/* Diff hint if custom */}
                        {meta.has_override && (
                          <div className="mt-3 text-[11px] text-blue-800 bg-blue-50 border border-blue-200 rounded-sm px-3 py-2">
                            <b>Custom active:</b> this section is currently using your edits instead of the built-in defaults. Click <i>Load Defaults</i> then <i>Save Changes</i> to revert only this section.
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
