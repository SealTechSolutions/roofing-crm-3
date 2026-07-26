/**
 * SystemMap — admin-only bird's-eye view of every page in the CRM.
 *
 * Route: /admin/system-map
 *
 * Purpose: help the owner audit the app for redundancy. Lists every route
 * with its purpose, data collections it reads/writes, and which OTHER pages
 * touch the same collections. Group rows by data-collection lets you spot
 * "hey, 4 pages all read the same collection — do I need all 4?"
 *
 * This is a static curated map (not auto-generated) because most of the
 * value is the human-readable purpose. Update when adding new routes.
 */
import React, { useMemo, useState } from "react";
import { Navigate, Link } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Map as MapIcon, Search, ExternalLink, AlertTriangle } from "lucide-react";

// Every user-facing page in the CRM. Keep in sync with App.js routes.
// Categories mirror the sidebar sections for visual continuity.
const ROUTES = [
  // Sales / Deals
  { path: "/", label: "Dashboard", cat: "Overview", purpose: "Company-wide KPIs (revenue, pipeline, open assessments, open tasks).", reads: ["deals", "invoices", "vendor_bills", "payment_milestones", "users"], writes: [] },
  { path: "/contacts", label: "People & Companies", cat: "Contacts", purpose: "Master list of every person + company we've ever touched.", reads: ["contacts", "properties"], writes: ["contacts"] },
  { path: "/vendors", label: "Vendors", cat: "Contacts", purpose: "Material suppliers (Western Colloid, GAF, Firestone, etc.).", reads: ["vendors"], writes: ["vendors"] },
  { path: "/subcontractors", label: "Subcontractors", cat: "Contacts", purpose: "1099 sub crews + onboarding tracker (W-9, MSA, GL/WC COI, OSHA).", reads: ["vendors"], writes: ["vendors"] },
  { path: "/employees", label: "Employees", cat: "Contacts", purpose: "W2 employees + 12-doc onboarding tracker.", reads: ["employees"], writes: ["employees"] },
  { path: "/properties", label: "Properties", cat: "Projects", purpose: "Physical buildings — one property can have many deals over time.", reads: ["properties", "contacts"], writes: ["properties"] },
  { path: "/projects", label: "Deals (Kanban)", cat: "Projects", purpose: "Sales pipeline — every project from Lead → Won → Complete.", reads: ["deals", "contacts", "properties"], writes: ["deals"] },
  { path: "/deals/:id", label: "Deal Detail", cat: "Projects", purpose: "The command center for a single deal — Scope, PDFs, Money, Take-Off, WOs.", reads: ["deals", "invoices", "vendor_bills", "project_photos", "commissions"], writes: ["deals", "invoices", "cost_items", "payment_milestones"] },
  { path: "/calculator", label: "Calculator", cat: "Projects", purpose: "System pricer — computes BoM + labor + markup → Set Option / Push Materials.", reads: ["product_catalog", "deals"], writes: ["deals"] },
  // Field
  { path: "/wrap-up", label: "Daily Site Wrap-Up", cat: "Field", purpose: "END-OF-DAY photo cleanup — bulk-tag untagged pics from today's site visits.", reads: ["project_photos", "deals"], writes: ["project_photos"] },
  // Reports
  { path: "/assessments", label: "Assessments", cat: "Reports", purpose: "List of all Roof Condition Reports drafted.", reads: ["assessments", "deals"], writes: [] },
  { path: "/scopes", label: "Scopes", cat: "Reports", purpose: "List of all Scope PDFs (technical spec sheets) drafted.", reads: ["deals"], writes: [] },
  { path: "/maintenance", label: "Maintenance", cat: "Reports", purpose: "STBS annual maintenance visit tracker.", reads: ["maintenance_reports", "deals"], writes: ["maintenance_reports"] },
  // Scheduling
  { path: "/calendar", label: "Calendar", cat: "Scheduling", purpose: "Month view of every scheduled event (site visits, WOs, assessments).", reads: ["calendar_events", "deals"], writes: ["calendar_events"] },
  { path: "/tasks", label: "Tasks", cat: "Scheduling", purpose: "Todo list per rep — pulled from deal timelines + manual entries.", reads: ["tasks", "deals"], writes: ["tasks"] },
  { path: "/settings/schedule", label: "Scheduled Jobs", cat: "Scheduling", purpose: "Admin view — every recurring event on the automation schedule.", reads: ["scheduled_jobs"], writes: [] },
  // Library
  { path: "/documents", label: "Documents", cat: "Library", purpose: "General doc library (uploads not tied to a specific deal).", reads: ["documents"], writes: ["documents"] },
  { path: "/materials", label: "Product Materials", cat: "Library", purpose: "SKU catalog by manufacturer — pricing + coverage rates.", reads: ["product_catalog"], writes: ["product_catalog"] },
  { path: "/sales-materials", label: "Sales Materials", cat: "Library", purpose: "Brochures, cut-sheets, warranty info for reps to email.", reads: ["sales_materials"], writes: ["sales_materials"] },
  // Finance
  { path: "/books", label: "Books", cat: "Finance", purpose: "Chart of accounts + multi-entity general ledger.", reads: ["gl_entries", "invoices", "vendor_bills"], writes: ["gl_entries"] },
  { path: "/invoices", label: "Invoices", cat: "Finance", purpose: "Every AR invoice — Draft / Sent / Paid.", reads: ["invoices", "deals"], writes: ["invoices"] },
  { path: "/payables", label: "Payables", cat: "Finance", purpose: "Every AP vendor bill — Pending / Approved / Paid.", reads: ["vendor_bills", "vendors"], writes: ["vendor_bills"] },
  // Admin (Company Info)
  { path: "/users", label: "Users", cat: "Admin", purpose: "CRM login accounts + roles.", reads: ["users"], writes: ["users"] },
  { path: "/settings/integrations", label: "Integrations", cat: "Admin", purpose: "Gmail SMTP / Google Calendar / SMTP creds.", reads: ["integrations"], writes: ["integrations"] },
  { path: "/settings/equipment-rates", label: "Equipment Rates", cat: "Admin", purpose: "Standard $/day rates for equipment used in P&L equipment estimate.", reads: ["settings"], writes: ["settings"] },
  { path: "/settings/scope-bullets", label: "Scope Bullets", cat: "Admin", purpose: "Edit the standard Inspection & Prep boilerplate on Spec Sheet + WO PDFs.", reads: ["settings"], writes: ["settings"] },
  { path: "/trash", label: "Trash", cat: "Admin", purpose: "Soft-deleted records — restorable within retention window.", reads: ["*"], writes: ["*"] },
];

const CAT_COLORS = {
  Overview: "text-purple-800 bg-purple-50 border-purple-300",
  Contacts: "text-blue-800 bg-blue-50 border-blue-300",
  Projects: "text-emerald-800 bg-emerald-50 border-emerald-300",
  Field: "text-teal-800 bg-teal-50 border-teal-300",
  Reports: "text-amber-800 bg-amber-50 border-amber-300",
  Scheduling: "text-cyan-800 bg-cyan-50 border-cyan-300",
  Library: "text-zinc-700 bg-zinc-100 border-zinc-300",
  Finance: "text-rose-800 bg-rose-50 border-rose-300",
  Admin: "text-orange-800 bg-orange-50 border-orange-300",
};

export default function SystemMap() {
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [collectionFilter, setCollectionFilter] = useState("");

  // Build the collection → routes reverse-index for overlap detection.
  const collectionToRoutes = useMemo(() => {
    const map = {};
    for (const r of ROUTES) {
      for (const c of [...(r.reads || []), ...(r.writes || [])]) {
        if (!map[c]) map[c] = new Set();
        map[c].add(r.path);
      }
    }
    return Object.fromEntries(
      Object.entries(map).map(([k, v]) => [k, Array.from(v).sort()])
    );
  }, []);

  const collections = useMemo(() =>
    Object.keys(collectionToRoutes).sort((a, b) => collectionToRoutes[b].length - collectionToRoutes[a].length),
    [collectionToRoutes]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ROUTES.filter((r) => {
      if (collectionFilter && !r.reads.includes(collectionFilter) && !r.writes.includes(collectionFilter)) return false;
      if (!q) return true;
      return (
        r.path.toLowerCase().includes(q) ||
        r.label.toLowerCase().includes(q) ||
        r.purpose.toLowerCase().includes(q) ||
        r.reads.some((c) => c.toLowerCase().includes(q)) ||
        r.writes.some((c) => c.toLowerCase().includes(q))
      );
    });
  }, [query, collectionFilter]);

  if (user && user.role !== "admin") return <Navigate to="/" replace />;

  return (
    <div className="max-w-7xl mx-auto p-6" data-testid="system-map-page">
      <div className="mb-6">
        <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-700 mb-1">Company Info</div>
        <h1 className="font-heading text-3xl font-black text-zinc-900 flex items-center gap-3">
          <MapIcon className="w-7 h-7 text-blue-700" /> System Map
        </h1>
        <p className="text-sm text-zinc-600 mt-2 max-w-3xl">
          Every route in the CRM with its purpose and the MongoDB collections it reads &amp; writes.
          Use the &quot;shared-collections&quot; strip below to spot pages that overlap — a good place
          to look when auditing for redundancy.
        </p>
      </div>

      {/* Shared-collections strip — sorted by how many pages touch each collection. */}
      <div className="bg-white border border-zinc-200 rounded-sm p-4 mb-6" data-testid="shared-collections-strip">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-amber-700 flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5" /> Potential Overlap — Collections Touched by 3+ Pages
            </div>
            <div className="text-[10px] text-zinc-500">Click a chip to filter the list below.</div>
          </div>
          {collectionFilter && (
            <button onClick={() => setCollectionFilter("")} className="text-[10px] font-bold uppercase tracking-widest text-blue-700 hover:text-blue-900" data-testid="clear-filter">
              Clear filter ×
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {collections.filter((c) => (collectionToRoutes[c] || []).length >= 3).map((c) => (
            <button
              key={c}
              onClick={() => setCollectionFilter(c === collectionFilter ? "" : c)}
              data-testid={`collection-chip-${c}`}
              className={`px-2 py-1 text-[11px] font-mono rounded-sm border transition-colors ${
                c === collectionFilter
                  ? "border-blue-700 bg-blue-700 text-white"
                  : "border-amber-300 bg-amber-50 text-amber-900 hover:border-amber-500"
              }`}
              title={`Touched by ${collectionToRoutes[c].length} pages`}
            >
              {c} <span className="text-[9px] opacity-70">({collectionToRoutes[c].length})</span>
            </button>
          ))}
        </div>
      </div>

      {/* Search */}
      <div className="mb-4 relative">
        <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search route, purpose, collection…"
          data-testid="system-map-search"
          className="w-full h-10 pl-10 pr-3 border border-zinc-300 rounded-sm text-sm"
        />
      </div>

      {/* Routes table */}
      <div className="bg-white border border-zinc-200 rounded-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b-2 border-zinc-950 text-left text-[10px] font-bold uppercase tracking-wider text-zinc-500">
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3">Route · Label</th>
              <th className="px-4 py-3">Purpose</th>
              <th className="px-4 py-3">Reads</th>
              <th className="px-4 py-3">Writes</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.path} className="border-b border-zinc-100 hover:bg-zinc-50 align-top" data-testid={`system-map-row-${r.path.replace(/[/:]/g, "-")}`}>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest border rounded-sm ${CAT_COLORS[r.cat] || CAT_COLORS.Admin}`}>
                    {r.cat}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <Link to={r.path.replace(":id", "")} className="font-bold text-blue-700 hover:text-blue-900 flex items-center gap-1">
                    {r.label} <ExternalLink className="w-3 h-3 opacity-60" />
                  </Link>
                  <div className="font-mono text-[10px] text-zinc-500">{r.path}</div>
                </td>
                <td className="px-4 py-3 text-zinc-700 text-xs max-w-md">{r.purpose}</td>
                <td className="px-4 py-3 text-[10px]">
                  {r.reads.length === 0 ? <span className="text-zinc-400">—</span> : (
                    <div className="flex flex-wrap gap-1">
                      {r.reads.map((c) => (
                        <span key={c} className={`px-1.5 py-0.5 font-mono border rounded-sm ${c === collectionFilter ? "border-blue-700 bg-blue-50" : "border-zinc-300 bg-zinc-50"}`}>{c}</span>
                      ))}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-[10px]">
                  {r.writes.length === 0 ? <span className="text-zinc-400">read-only</span> : (
                    <div className="flex flex-wrap gap-1">
                      {r.writes.map((c) => (
                        <span key={c} className={`px-1.5 py-0.5 font-mono border rounded-sm ${c === collectionFilter ? "border-blue-700 bg-blue-100 text-blue-900" : "border-emerald-300 bg-emerald-50 text-emerald-800"}`}>{c}</span>
                      ))}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="text-center text-zinc-500 py-10 text-sm">No routes match your filters.</div>
        )}
      </div>

      <div className="mt-6 text-[11px] text-zinc-500 italic">
        {filtered.length} of {ROUTES.length} routes shown · Update this map when you add a new page (in <code className="font-mono">SystemMap.jsx</code>).
      </div>
    </div>
  );
}
