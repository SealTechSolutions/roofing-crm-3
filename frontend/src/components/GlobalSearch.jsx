import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { Search, X, FileSpreadsheet, User, Building2, Receipt, Truck, ArrowRight } from "lucide-react";

/**
 * Command-palette style global search modal.
 *
 * Trigger: `⌘K` / `Ctrl+K` from anywhere inside the CRM (registered by
 * this component on `document`). Typing a 2+ character query fetches
 * results from `/api/search` (debounced 200ms) and renders grouped
 * lists across Deals, Contacts, Vendors, Properties, and Invoices.
 * Arrow keys navigate rows; Enter jumps; Escape closes.
 *
 * Deliberately zero-dependency (no shadcn Command primitive) — the
 * result rows are semantically simple <button>s so keyboard nav is
 * completely predictable.
 */
export default function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [data, setData] = useState({ deals: [], contacts: [], properties: [], invoices: [], vendors: [] });
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const resultsRef = useRef(null);

  // Global keyboard shortcut listener: ⌘K on mac, Ctrl+K elsewhere.
  useEffect(() => {
    const onKey = (e) => {
      const cmdK = (e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K");
      if (cmdK) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Focus the input every time we open. Also reset the query so the
  // modal never carries a stale search back into view.
  useEffect(() => {
    if (open) {
      setQ("");
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  // Debounced fetch — anything shorter than 2 chars clears results so we
  // don't hammer the backend on every keystroke while the user is
  // still typing "sm" for "smith".
  useEffect(() => {
    if (!open) return undefined;
    const term = q.trim();
    if (term.length < 2) {
      setData({ deals: [], contacts: [], properties: [], invoices: [], vendors: [] });
      return undefined;
    }
    setLoading(true);
    const handle = setTimeout(async () => {
      try {
        const r = await api.get("/search", { params: { q: term } });
        setData(r.data || {});
        setActiveIndex(0);
      } catch {
        setData({ deals: [], contacts: [], properties: [], invoices: [], vendors: [] });
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(handle);
  }, [q, open]);

  // Flatten results into an ordered list so arrow keys + Enter can jump
  // straight to whichever row is currently highlighted.
  const flat = [];
  (data.deals || []).forEach((d) => flat.push({ kind: "deal", id: d.id, label: d.title, hint: `${d.project_type || ""}${d.proposed_roof_type ? " · " + d.proposed_roof_type : ""}`, to: `/projects/${d.id}` }));
  (data.contacts || []).forEach((c) => flat.push({ kind: "contact", id: c.id, label: c.contact_name || c.company_name || "Contact", hint: [c.company_name, c.email, c.phone].filter(Boolean).join(" · "), to: `/contacts?id=${c.id}` }));
  (data.vendors || []).forEach((v) => flat.push({ kind: "vendor", id: v.id, label: v.contact_name || v.company_name || "Vendor", hint: [v.company_name, v.email, v.phone].filter(Boolean).join(" · "), to: v.kind === "Subcontractor" ? "/subcontractors" : "/vendors" }));
  (data.properties || []).forEach((p) => flat.push({ kind: "property", id: p.id, label: p.property_name, hint: [p.address_line_1, p.city, p.state].filter(Boolean).join(", "), to: `/properties?id=${p.id}` }));
  (data.invoices || []).forEach((i) => flat.push({ kind: "invoice", id: i.id, label: `Invoice #${i.invoice_number || i.id.slice(0, 8)}`, hint: `${i.billing_contact_snapshot?.company_name || i.billing_contact_snapshot?.contact_name || ""} · $${(i.amount || 0).toLocaleString()}`, to: i.deal_id ? `/projects/${i.deal_id}` : "/invoices" }));

  const jump = (idx) => {
    const item = flat[idx];
    if (!item) return;
    setOpen(false);
    navigate(item.to);
  };

  const onKeyDown = (e) => {
    if (e.key === "Escape") { setOpen(false); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIndex((i) => Math.min(i + 1, Math.max(0, flat.length - 1))); return; }
    if (e.key === "ArrowUp")   { e.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)); return; }
    if (e.key === "Enter")     { e.preventDefault(); jump(activeIndex); return; }
  };

  // Scroll the active row into view so keyboard navigation never disappears
  // below the fold when there are many results.
  useEffect(() => {
    if (!resultsRef.current) return;
    const el = resultsRef.current.querySelector(`[data-row="${activeIndex}"]`);
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-start justify-center pt-24 px-4" onClick={() => setOpen(false)} data-testid="global-search-modal">
      <div
        className="bg-white w-full max-w-2xl rounded-sm shadow-2xl border border-zinc-200 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-200">
          <Search className="w-4 h-4 text-zinc-500 flex-shrink-0" />
          <input
            ref={inputRef}
            data-testid="global-search-input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search deals, contacts, vendors, properties, invoices…"
            className="flex-1 outline-none text-sm placeholder:text-zinc-400"
          />
          <div className="flex items-center gap-1">
            <kbd className="text-[9px] font-bold uppercase tracking-wider text-zinc-400 border border-zinc-300 rounded-sm px-1.5 py-0.5">Esc</kbd>
            <button onClick={() => setOpen(false)} className="text-zinc-400 hover:text-zinc-900 p-1" aria-label="Close">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div ref={resultsRef} className="max-h-[60vh] overflow-y-auto">
          {q.trim().length < 2 ? (
            <div className="p-8 text-center text-sm text-zinc-500" data-testid="global-search-empty">
              <div className="text-xs font-bold uppercase tracking-widest text-zinc-400 mb-2">Global Search</div>
              <div>Type 2+ characters to search across the entire CRM.</div>
              <div className="mt-4 flex items-center justify-center gap-3 text-[10px] uppercase tracking-wider text-zinc-500">
                <span><kbd className="border border-zinc-300 rounded-sm px-1.5 py-0.5 font-bold">↑</kbd> <kbd className="border border-zinc-300 rounded-sm px-1.5 py-0.5 font-bold">↓</kbd> Navigate</span>
                <span><kbd className="border border-zinc-300 rounded-sm px-1.5 py-0.5 font-bold">↵</kbd> Open</span>
                <span><kbd className="border border-zinc-300 rounded-sm px-1.5 py-0.5 font-bold">Esc</kbd> Close</span>
              </div>
            </div>
          ) : flat.length === 0 ? (
            <div className="p-8 text-center text-sm text-zinc-500" data-testid="global-search-no-results">
              {loading ? "Searching…" : `No results for "${q.trim()}"`}
            </div>
          ) : (
            <div className="py-2">
              <ResultGroup title="Deals" icon={FileSpreadsheet} items={data.deals} startIdx={0} activeIndex={activeIndex} jump={jump} kind="deal" flat={flat} />
              <ResultGroup title="People" icon={User} items={data.contacts} startIdx={(data.deals || []).length} activeIndex={activeIndex} jump={jump} kind="contact" flat={flat} />
              <ResultGroup title="Vendors & Subs" icon={Truck} items={data.vendors} startIdx={(data.deals || []).length + (data.contacts || []).length} activeIndex={activeIndex} jump={jump} kind="vendor" flat={flat} />
              <ResultGroup title="Properties" icon={Building2} items={data.properties} startIdx={(data.deals || []).length + (data.contacts || []).length + (data.vendors || []).length} activeIndex={activeIndex} jump={jump} kind="property" flat={flat} />
              <ResultGroup title="Invoices" icon={Receipt} items={data.invoices} startIdx={(data.deals || []).length + (data.contacts || []).length + (data.vendors || []).length + (data.properties || []).length} activeIndex={activeIndex} jump={jump} kind="invoice" flat={flat} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ResultGroup({ title, icon: Icon, items, startIdx, activeIndex, jump, kind, flat }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="mb-1">
      <div className="px-4 py-1.5 text-[9px] font-bold uppercase tracking-[0.18em] text-zinc-500 flex items-center gap-1.5 bg-zinc-50 border-y border-zinc-100">
        <Icon className="w-3 h-3" /> {title} · {items.length}
      </div>
      {items.map((_it, offset) => {
        const idx = startIdx + offset;
        const row = flat[idx];
        if (!row) return null;
        const active = idx === activeIndex;
        return (
          <button
            key={row.id}
            data-row={idx}
            data-testid={`global-search-result-${kind}-${row.id}`}
            onMouseEnter={() => { /* no-op — keep keyboard as source of truth */ }}
            onClick={() => jump(idx)}
            className={`w-full text-left px-4 py-2.5 flex items-center justify-between gap-3 border-l-2 transition-colors ${active ? "bg-blue-50 border-blue-700" : "border-transparent hover:bg-zinc-50"}`}
          >
            <div className="min-w-0 flex-1">
              <div className={`text-sm font-bold truncate ${active ? "text-blue-900" : "text-zinc-900"}`}>{row.label}</div>
              {row.hint && <div className="text-xs text-zinc-500 truncate mt-0.5">{row.hint}</div>}
            </div>
            <ArrowRight className={`w-3.5 h-3.5 flex-shrink-0 ${active ? "text-blue-700" : "text-zinc-300"}`} />
          </button>
        );
      })}
    </div>
  );
}
