import React, { useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { toast } from "sonner";
import { X, Plus, Trash2, RotateCcw, GripVertical } from "lucide-react";

/**
 * Scope Editor — per-deal override of any spec-sheet bullet before PDF.
 *
 * Pre-populates with the deal's effective bullets (template defaults merged
 * with any saved overrides). Each section (scope_1 / scope_2 / key_advantages)
 * is editable as an ordered list. Reset reverts to template defaults.
 * Saving PUTs to /deals/{id}/scope-bullets which immediately affects the next
 * spec-sheet PDF render — both downloads and email-scope sends.
 */
export default function ScopeEditorModal({ dealId, onClose, onSaved }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get(`/deals/${dealId}/scope-bullets`)
      .then((r) => {
        const d = r.data;
        // Start the form with the effective bullets so the user edits what they actually see.
        setData({
          ...d,
          form: {
            title: d.effective.title || d.defaults.title || "",
            scope_1_title: d.effective.scope_1_title || d.defaults.scope_1_title || "",
            scope_1: [...(d.effective.scope_1 || d.defaults.scope_1 || [])],
            scope_2_title: d.effective.scope_2_title || d.defaults.scope_2_title || "",
            scope_2: [...(d.effective.scope_2 || d.defaults.scope_2 || [])],
            key_advantages: [...(d.effective.key_advantages || d.defaults.key_advantages || [])],
          },
        });
      })
      .catch((e) => {
        toast.error(formatApiError(e?.response?.data?.detail) || e.message);
        onClose();
      });
  }, [dealId, onClose]);

  if (!data) {
    return (
      <div className="fixed inset-0 z-50 bg-zinc-950/60 flex items-center justify-center" data-testid="scope-editor-loading">
        <div className="text-white text-sm">Loading scope…</div>
      </div>
    );
  }

  const setField = (key, value) => setData((d) => ({ ...d, form: { ...d.form, [key]: value } }));
  const setBullet = (listKey, idx, value) =>
    setData((d) => {
      const next = [...d.form[listKey]];
      next[idx] = value;
      return { ...d, form: { ...d.form, [listKey]: next } };
    });
  const addBullet = (listKey) =>
    setData((d) => ({ ...d, form: { ...d.form, [listKey]: [...d.form[listKey], ""] } }));
  const removeBullet = (listKey, idx) =>
    setData((d) => {
      const next = [...d.form[listKey]];
      next.splice(idx, 1);
      return { ...d, form: { ...d.form, [listKey]: next } };
    });
  const moveBullet = (listKey, idx, dir) =>
    setData((d) => {
      const next = [...d.form[listKey]];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return d;
      [next[idx], next[j]] = [next[j], next[idx]];
      return { ...d, form: { ...d.form, [listKey]: next } };
    });
  const resetSection = (sectionKeys) =>
    setData((d) => {
      const reset = { ...d.form };
      for (const k of sectionKeys) {
        reset[k] = Array.isArray(d.defaults[k]) ? [...d.defaults[k]] : d.defaults[k] || "";
      }
      return { ...d, form: reset };
    });

  const save = async () => {
    setBusy(true);
    try {
      // Only send fields whose values differ from defaults — this keeps the
      // saved override blob minimal so template updates flow through for
      // anything the user didn't intentionally customize.
      const out = {};
      if ((data.form.title || "") !== (data.defaults.title || "")) out.title = data.form.title;
      if ((data.form.scope_1_title || "") !== (data.defaults.scope_1_title || "")) out.scope_1_title = data.form.scope_1_title;
      if ((data.form.scope_2_title || "") !== (data.defaults.scope_2_title || "")) out.scope_2_title = data.form.scope_2_title;
      const listsEq = (a, b) =>
        a.length === b.length && a.every((x, i) => (x || "").trim() === (b[i] || "").trim());
      if (!listsEq(data.form.scope_1, data.defaults.scope_1 || [])) out.scope_1 = data.form.scope_1;
      if (!listsEq(data.form.scope_2, data.defaults.scope_2 || [])) out.scope_2 = data.form.scope_2;
      if (!listsEq(data.form.key_advantages, data.defaults.key_advantages || []))
        out.key_advantages = data.form.key_advantages;
      const r = await api.put(`/deals/${dealId}/scope-bullets`, out);
      toast.success(
        Object.keys(out).length === 0
          ? "Scope reset to template defaults"
          : `Saved ${r.data.overridden_keys.length} override${r.data.overridden_keys.length === 1 ? "" : "s"} — next PDF will use them`
      );
      onSaved?.(r.data);
      onClose();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setBusy(false);
    }
  };

  const resetAll = () =>
    setData((d) => ({
      ...d,
      form: {
        title: d.defaults.title || "",
        scope_1_title: d.defaults.scope_1_title || "",
        scope_1: [...(d.defaults.scope_1 || [])],
        scope_2_title: d.defaults.scope_2_title || "",
        scope_2: [...(d.defaults.scope_2 || [])],
        key_advantages: [...(d.defaults.key_advantages || [])],
      },
    }));

  const renderBulletList = (listKey, label, sectionKeys) => {
    const bullets = data.form[listKey];
    const hasOverride = JSON.stringify(bullets) !== JSON.stringify(data.defaults[listKey] || []);
    return (
      <div className="bg-white border border-zinc-200 rounded-sm p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[11px] font-bold uppercase tracking-[0.15em] text-zinc-700 flex items-center gap-2">
            {label}
            {hasOverride && (
              <span className="text-[9px] px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded-sm">
                CUSTOMIZED
              </span>
            )}
          </div>
          {hasOverride && (
            <button
              type="button"
              onClick={() => resetSection(sectionKeys || [listKey])}
              className="inline-flex items-center gap-1 text-[10px] text-zinc-600 hover:text-blue-700"
              data-testid={`scope-reset-${listKey}`}
            >
              <RotateCcw className="w-3 h-3" /> Reset
            </button>
          )}
        </div>
        <div className="space-y-2">
          {bullets.map((b, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <div className="flex flex-col items-center pt-1.5">
                <button
                  type="button"
                  onClick={() => moveBullet(listKey, i, -1)}
                  disabled={i === 0}
                  className="text-zinc-400 hover:text-zinc-700 disabled:opacity-30 leading-none"
                  title="Move up"
                >
                  ▲
                </button>
                <button
                  type="button"
                  onClick={() => moveBullet(listKey, i, 1)}
                  disabled={i === bullets.length - 1}
                  className="text-zinc-400 hover:text-zinc-700 disabled:opacity-30 leading-none"
                  title="Move down"
                >
                  ▼
                </button>
              </div>
              <textarea
                value={b}
                onChange={(e) => setBullet(listKey, i, e.target.value)}
                rows={Math.max(1, Math.ceil(b.length / 90))}
                className="flex-1 px-2.5 py-1.5 border border-zinc-300 rounded-sm text-xs focus:outline-none focus:ring-1 focus:ring-blue-700"
                data-testid={`scope-${listKey}-${i}`}
              />
              <button
                type="button"
                onClick={() => removeBullet(listKey, i)}
                className="p-1.5 text-zinc-400 hover:text-rose-700"
                title="Delete bullet"
                data-testid={`scope-${listKey}-${i}-remove`}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => addBullet(listKey)}
            className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-blue-700 hover:text-blue-900"
            data-testid={`scope-${listKey}-add`}
          >
            <Plus className="w-3 h-3" /> Add bullet
          </button>
        </div>
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-zinc-950/60 flex items-start justify-center p-4 overflow-y-auto"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      data-testid="scope-editor"
    >
      <div className="bg-zinc-50 w-full max-w-4xl my-8 rounded-sm shadow-xl">
        <div className="bg-white border-b-2 border-zinc-950 px-6 py-4 flex items-center justify-between sticky top-0 z-10">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">Scope Editor</div>
            <div className="font-heading text-lg font-black tracking-tight">
              {data.template_title || "Project Scope"}
            </div>
            <div className="text-[10px] text-zinc-500 mt-0.5">
              Edits apply only to this project. {data.overridden_keys.length > 0 ? `${data.overridden_keys.length} section${data.overridden_keys.length === 1 ? "" : "s"} customized.` : "All sections are at template defaults."}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={resetAll}
              className="inline-flex items-center gap-1 px-3 h-9 text-[10px] font-bold uppercase tracking-wider border border-zinc-300 hover:border-zinc-500 rounded-sm"
              data-testid="scope-reset-all"
            >
              <RotateCcw className="w-3 h-3" /> Reset All
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 hover:bg-zinc-100 rounded-sm"
              data-testid="scope-editor-close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-4">
          <div className="bg-white border border-zinc-200 rounded-sm p-4">
            <label className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-600 block mb-2">
              Document Title
            </label>
            <input
              type="text"
              value={data.form.title}
              onChange={(e) => setField("title", e.target.value)}
              className="w-full px-2.5 py-1.5 border border-zinc-300 rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-blue-700"
              data-testid="scope-title"
            />
          </div>

          <div className="bg-white border border-zinc-200 rounded-sm p-4">
            <label className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-600 block mb-2">
              Section 1 Heading
            </label>
            <input
              type="text"
              value={data.form.scope_1_title}
              onChange={(e) => setField("scope_1_title", e.target.value)}
              className="w-full px-2.5 py-1.5 border border-zinc-300 rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-blue-700"
              data-testid="scope-scope_1_title"
            />
          </div>
          {renderBulletList("scope_1", "Section 1 — Bullets", ["scope_1", "scope_1_title"])}

          <div className="bg-white border border-zinc-200 rounded-sm p-4">
            <label className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-600 block mb-2">
              Section 2 Heading
            </label>
            <input
              type="text"
              value={data.form.scope_2_title}
              onChange={(e) => setField("scope_2_title", e.target.value)}
              className="w-full px-2.5 py-1.5 border border-zinc-300 rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-blue-700"
              data-testid="scope-scope_2_title"
            />
          </div>
          {renderBulletList("scope_2", "Section 2 — Bullets", ["scope_2", "scope_2_title"])}

          {data.defaults.key_advantages && data.defaults.key_advantages.length > 0 &&
            renderBulletList("key_advantages", "Key Advantages")}
        </div>

        <div className="bg-white border-t-2 border-zinc-950 px-6 py-4 flex items-center justify-end gap-2 sticky bottom-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 h-10 text-[11px] font-bold uppercase tracking-wider border border-zinc-300 hover:border-zinc-500 rounded-sm"
            data-testid="scope-cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="px-5 h-10 text-[11px] font-bold uppercase tracking-wider bg-blue-700 hover:bg-blue-800 text-white rounded-sm disabled:opacity-50"
            data-testid="scope-save"
          >
            {busy ? "Saving…" : "Save Scope"}
          </button>
        </div>
      </div>
    </div>
  );
}
