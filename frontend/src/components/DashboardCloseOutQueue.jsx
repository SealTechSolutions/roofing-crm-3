/**
 * DashboardCloseOutQueue — the daily reminder card that sits at the very top
 * of the Command Center. Lists every deal currently in the close-out phase
 * (Mark Complete clicked, not yet Fully Closed). Aging-based colors surface
 * stale close-outs; clicking any row jumps to the deal + auto-opens the
 * Close-Out modal.
 *
 * Hides itself entirely when the queue is empty — no "empty state clutter"
 * on days when everything's tidy.
 */
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { CheckSquare, AlertTriangle, ArrowRight, Sparkles } from "lucide-react";

export default function DashboardCloseOutQueue() {
  const [deals, setDeals] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const nav = useNavigate();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api.get("/close-out/queue");
        if (!cancelled) setDeals(r.data || []);
      } catch {
        /* silent — queue is nice-to-have; a load error shouldn't nuke the whole dashboard */
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!loaded || deals.length === 0) return null;

  const oldest = deals[0]?.days_since_start || 0;
  const avg = deals.length > 0 ? Math.round(deals.reduce((s, d) => s + (d.days_since_start || 0), 0) / deals.length) : 0;

  return (
    <div className="bg-white border-l-4 border-amber-500 border-y border-r border-zinc-200 rounded-sm mb-6" data-testid="close-out-queue-card">
      <div className="px-5 py-4 border-b border-zinc-100 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-700 flex items-center gap-1.5">
            <CheckSquare className="w-3.5 h-3.5" /> Close-Out Queue
          </div>
          <h2 className="font-heading text-xl font-black text-zinc-900">
            {deals.length} deal{deals.length !== 1 ? "s" : ""} awaiting close-out
          </h2>
          <div className="text-[11px] text-zinc-500 mt-0.5">
            Avg {avg} day{avg !== 1 ? "s" : ""} in queue · Oldest {oldest} day{oldest !== 1 ? "s" : ""} — click any row to keep going.
          </div>
        </div>
      </div>
      <ul>
        {deals.map((d) => {
          const days = d.days_since_start || 0;
          const aging = days > 14 ? "red" : days > 7 ? "amber" : "green";
          const agingCls = aging === "red"
            ? "text-red-800 bg-red-50 border-red-300"
            : aging === "amber"
              ? "text-amber-800 bg-amber-50 border-amber-300"
              : "text-emerald-800 bg-emerald-50 border-emerald-300";
          const pctReq = d.required_total > 0 ? (d.required_done / d.required_total) * 100 : 0;
          return (
            <li key={d.id}>
              <button
                onClick={() => nav(`/deals/${d.id}?closeout=1`)}
                data-testid={`close-out-queue-row-${d.id}`}
                className="w-full text-left px-5 py-3 border-b border-zinc-100 last:border-b-0 hover:bg-blue-50 transition-colors flex items-center gap-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-sm font-bold text-zinc-900">
                    {d.title}
                    {aging === "red" && <AlertTriangle className="w-3.5 h-3.5 text-red-600" title="Aging — needs attention" />}
                  </div>
                  <div className="text-[11px] text-zinc-500 truncate">
                    {d.property_address}{d.property_city ? ` · ${d.property_city}` : ""}
                  </div>
                </div>
                <div className="flex-shrink-0 flex items-center gap-3">
                  {d.optional_done > 0 && (
                    <span className="text-[10px] text-blue-700 flex items-center gap-0.5" title={`${d.optional_done} optional items done`}>
                      <Sparkles className="w-3 h-3" /> {d.optional_done}
                    </span>
                  )}
                  <div className="w-24">
                    <div className="text-[10px] font-mono text-zinc-600 text-right">{d.required_done}/{d.required_total}</div>
                    <div className="mt-0.5 h-1.5 bg-zinc-200 rounded-sm overflow-hidden">
                      <div className="h-full bg-blue-600" style={{ width: `${pctReq}%` }} />
                    </div>
                  </div>
                  <span className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest border rounded-sm ${agingCls}`}>
                    {days}d
                  </span>
                  <ArrowRight className="w-4 h-4 text-zinc-400" />
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
