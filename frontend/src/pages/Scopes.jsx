import React, { useEffect, useState, useMemo } from "react";
import { FileText, Search } from "lucide-react";
import { api } from "@/lib/api";
import { ScopesTable } from "@/components/ScopesModal";

export default function Scopes() {
  const [scopes, setScopes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [roofFilter, setRoofFilter] = useState("All");

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get("/scopes", { params: { limit: 500 } });
        setScopes(r.data || []);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Roof-type facet built from the fetched data — keeps the dropdown in sync
  // with whatever's actually in the pipeline instead of hardcoding a list
  // that could drift from `product_catalog.py`.
  const roofTypes = useMemo(() => {
    const set = new Set();
    scopes.forEach((s) => { if (s.roof_type) set.add(s.roof_type); });
    return ["All", ...Array.from(set).sort()];
  }, [scopes]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return scopes.filter((s) => {
      if (roofFilter !== "All" && s.roof_type !== roofFilter) return false;
      if (!needle) return true;
      return [s.title, s.primary_contact_name, s.property_name, s.property_address, s.roof_type]
        .filter(Boolean).some((v) => String(v).toLowerCase().includes(needle));
    });
  }, [scopes, q, roofFilter]);

  return (
    <div className="space-y-6" data-testid="scopes-page">
      <div>
        <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-700 mb-1">Sales Library</div>
        <h1 className="font-heading text-3xl font-black tracking-tight flex items-center gap-3">
          <FileText className="w-7 h-7 text-blue-700" /> Scopes
        </h1>
        <p className="text-sm text-zinc-600 mt-1">
          Every scope PDF across your active pipeline. Click <b>Scope</b> to view / download the PDF; click a project title to open the full deal.
        </p>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            placeholder="Search by project, contact, property, or roof type…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            data-testid="scopes-search"
            className="w-full h-10 pl-9 pr-3 border border-zinc-300 rounded-sm text-sm"
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {roofTypes.map((rt) => (
            <button
              key={rt}
              onClick={() => setRoofFilter(rt)}
              data-testid={`scopes-filter-${rt.toLowerCase().replace(/\s+/g, "-")}`}
              className={`px-3 h-8 text-[10px] font-bold uppercase tracking-wider rounded-sm border transition-colors ${roofFilter === rt ? "border-blue-700 bg-blue-700 text-white" : "border-zinc-300 text-zinc-700 hover:border-zinc-950"}`}
            >
              {rt}
            </button>
          ))}
        </div>
        <div className="text-xs text-zinc-500 ml-auto">
          Showing <b className="text-zinc-950">{filtered.length}</b> of <b className="text-zinc-950">{scopes.length}</b>
        </div>
      </div>

      <div className="bg-white border border-zinc-200 rounded-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-sm text-zinc-500">Loading scopes…</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <div className="text-sm text-zinc-500 mb-2">
              {scopes.length === 0 ? "No scopes yet." : "No scopes match your filters."}
            </div>
            {scopes.length === 0 && (
              <div className="text-xs text-zinc-400">
                Open a deal, set the <b>Proposed Roof Type</b>, and the scope PDF becomes downloadable here.
              </div>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <ScopesTable scopes={filtered} />
          </div>
        )}
      </div>
    </div>
  );
}
