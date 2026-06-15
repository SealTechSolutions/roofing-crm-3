/**
 * GrammarCheck — Optional LanguageTool grammar/style overlay on top of the
 * browser's native spell-check.
 *
 * Usage:
 *   <GrammarCheck text={notes} onChange={setNotes} />
 *
 * Renders a small "Check Grammar" button. On click it sends `text` to
 * LanguageTool's public API (api.languagetool.org), and shows a popover with
 * each issue + clickable replacement suggestions. Clicking a suggestion
 * applies the fix to `text` via `onChange(newText)`.
 *
 * Free-tier limits: ~20 requests/minute, 20 kB per request. Rate-limit errors
 * are surfaced via toast.
 */
import React, { useState, useRef, useEffect } from "react";
import { CheckCircle2, AlertCircle, Loader2, X, SpellCheck2 } from "lucide-react";
import { toast } from "sonner";

const LT_URL = "https://api.languagetool.org/v2/check";

function severityColor(rule) {
  // LT rule categories we care about
  const id = (rule?.category?.id || "").toUpperCase();
  if (id.includes("TYPO") || id.includes("SPELLING")) return "bg-red-50 text-red-800 border-red-300";
  if (id.includes("GRAMMAR") || id.includes("SYNTAX")) return "bg-amber-50 text-amber-800 border-amber-300";
  if (id.includes("STYLE") || id.includes("PUNCT")) return "bg-blue-50 text-blue-800 border-blue-300";
  return "bg-zinc-100 text-zinc-700 border-zinc-300";
}

export default function GrammarCheck({ text, onChange, label = "Check Grammar", className = "", disabled = false }) {
  const [loading, setLoading] = useState(false);
  const [matches, setMatches] = useState(null);
  const [open, setOpen] = useState(false);
  const popoverRef = useRef(null);

  // Click-outside to close
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const check = async () => {
    if (!text || !text.trim()) {
      toast.info("Type some text first, then check.");
      return;
    }
    if (text.length > 20000) {
      toast.error("Text is too long for one check (20,000 char limit). Break it into smaller chunks.");
      return;
    }
    setLoading(true);
    try {
      const body = new URLSearchParams({
        text,
        language: "en-US",
        enabledOnly: "false",
      });
      const res = await fetch(LT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
      if (!res.ok) {
        if (res.status === 429) throw new Error("Rate-limited by LanguageTool. Wait a few seconds and try again.");
        throw new Error(`LanguageTool API error (${res.status})`);
      }
      const data = await res.json();
      setMatches(data.matches || []);
      setOpen(true);
      if ((data.matches || []).length === 0) toast.success("No issues found — looks clean.");
    } catch (e) {
      toast.error(e.message || "Failed to reach LanguageTool");
    } finally {
      setLoading(false);
    }
  };

  const apply = (m, replacement) => {
    if (!onChange) return;
    const next = text.slice(0, m.offset) + replacement + text.slice(m.offset + m.length);
    onChange(next);
    // Remove this match from the list + shift subsequent offsets
    const delta = replacement.length - m.length;
    setMatches((prev) => (prev || [])
      .filter((x) => x.offset !== m.offset)
      .map((x) => x.offset > m.offset ? { ...x, offset: x.offset + delta } : x));
  };

  return (
    <div className={`relative inline-block ${className}`}>
      <button
        type="button"
        onClick={check}
        disabled={disabled || loading}
        className="inline-flex items-center gap-1.5 px-2.5 h-7 text-[10px] font-bold uppercase tracking-wider bg-white border border-zinc-300 hover:border-blue-700 hover:text-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-sm transition-colors"
        data-testid="grammar-check-btn"
      >
        {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <SpellCheck2 className="w-3 h-3" />}
        {loading ? "Checking…" : label}
      </button>

      {open && matches && (
        <div
          ref={popoverRef}
          className="absolute right-0 top-9 z-50 w-[420px] max-h-[480px] overflow-auto bg-white border border-zinc-300 rounded-sm shadow-xl"
          data-testid="grammar-check-popover"
        >
          <div className="flex items-center justify-between px-3 py-2 border-b-2 border-zinc-950 bg-zinc-50 sticky top-0">
            <div className="text-xs font-bold uppercase tracking-widest">
              {matches.length === 0 ? (
                <span className="text-emerald-700 inline-flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5" /> All clear</span>
              ) : (
                <span className="inline-flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5 text-amber-700" /> {matches.length} issue{matches.length === 1 ? "" : "s"}</span>
              )}
            </div>
            <button onClick={() => setOpen(false)} className="p-1 hover:bg-zinc-200 rounded-sm" data-testid="grammar-close"><X className="w-3.5 h-3.5" /></button>
          </div>
          {matches.length === 0 ? (
            <div className="p-4 text-sm text-zinc-600">No grammar or style issues detected.</div>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {matches.map((m, i) => {
                const snippet = text.slice(Math.max(0, m.offset - 12), m.offset + m.length + 12);
                const pre = snippet.slice(0, Math.min(12, m.offset));
                const mid = snippet.slice(pre.length, pre.length + m.length);
                const post = snippet.slice(pre.length + m.length);
                return (
                  <li key={i} className="px-3 py-2.5" data-testid={`grammar-issue-${i}`}>
                    <div className="flex items-start gap-2 mb-1.5">
                      <span className={`px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest border rounded-sm shrink-0 ${severityColor(m.rule)}`}>
                        {(m.rule?.category?.name || "Issue").slice(0, 20)}
                      </span>
                      <div className="text-xs text-zinc-700 leading-snug flex-1">{m.message}</div>
                    </div>
                    <div className="text-[11px] font-mono text-zinc-500 mb-2 bg-zinc-50 px-2 py-1 rounded-sm">
                      …{pre}<span className="bg-red-100 text-red-800 font-bold">{mid}</span>{post}…
                    </div>
                    {m.replacements && m.replacements.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {m.replacements.slice(0, 5).map((r, k) => (
                          <button
                            key={k}
                            onClick={() => apply(m, r.value)}
                            className="px-2 h-6 text-[10px] font-bold bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 rounded-sm transition-colors"
                            data-testid={`grammar-fix-${i}-${k}`}
                          >
                            → {r.value}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <span className="text-[10px] text-zinc-400 italic">No automatic fix available</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <div className="px-3 py-1.5 border-t border-zinc-200 text-[9px] text-zinc-400 sticky bottom-0 bg-white">
            Powered by LanguageTool (free API)
          </div>
        </div>
      )}
    </div>
  );
}
