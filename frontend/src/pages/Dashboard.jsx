import React, { useEffect, useState } from "react";
import { api, formatCurrency } from "@/lib/api";
import { Link } from "react-router-dom";
import { TrendingUp, FileSpreadsheet, Users, Building2, DollarSign, Trophy, Wrench, Wallet, Truck, PackageCheck, ChevronRight } from "lucide-react";
import { ExportButtons } from "@/components/ExportImport";

const KPI = ({ label, value, hint, icon: Icon, testId }) => (
  <div className="bg-white border border-zinc-200 p-6 rounded-sm" data-testid={testId}>
    <div className="flex items-start justify-between mb-4">
      <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-500">{label}</div>
      <Icon className="w-4 h-4 text-zinc-400" />
    </div>
    <div className="font-heading text-4xl font-black tracking-tighter text-zinc-950 leading-none">{value}</div>
    {hint && <div className="text-xs text-zinc-500 mt-2">{hint}</div>}
  </div>
);

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [deals, setDeals] = useState([]);
  const [revWindow, setRevWindow] = useState("ytd");
  const [revData, setRevData] = useState(null);
  const [motion, setMotion] = useState(null);

  useEffect(() => {
    api.get("/dashboard/summary").then((r) => setData(r.data));
    api.get("/deals").then((r) => setDeals(r.data));
    api.get("/dashboard/materials-in-motion").then((r) => setMotion(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    api.get(`/dashboard/revenue-by-type?window=${revWindow}`).then((r) => setRevData(r.data));
  }, [revWindow]);

  if (!data) {
    return <div className="p-8 text-xs uppercase tracking-[0.2em] text-zinc-500">Loading dashboard...</div>;
  }

  const recent = deals.slice(0, 5);

  return (
    <div className="p-6 sm:p-8 animate-in fade-in slide-in-from-bottom-4 duration-500" data-testid="dashboard-page">
      <div className="flex items-end justify-between mb-8 pb-6 border-b border-zinc-200 gap-4 flex-wrap">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-700 mb-2">Overview</div>
          <h1 className="font-heading text-3xl sm:text-4xl font-black tracking-tight leading-none">Command Center</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="hidden sm:flex flex-col items-end">
            <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-zinc-500 mb-1">Export Everything</div>
            <ExportButtons category="all" />
          </div>
          <Link
            to="/projects"
            data-testid="dashboard-new-deal"
            className="inline-flex items-center gap-2 bg-zinc-950 text-white px-4 h-10 text-xs font-bold uppercase tracking-wider hover:bg-zinc-800 rounded-sm transition-colors"
          >
            View Pipeline →
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <KPI label="Open Leads" value={data.open_leads} hint={`${data.deals_count} total deals`} icon={TrendingUp} testId="kpi-open-leads" />
        <KPI label="Won Deals" value={data.won_deals} hint={`${data.lost_deals} lost`} icon={Trophy} testId="kpi-won-deals" />
        <KPI label="Pipeline Revenue" value={formatCurrency(data.pipeline_revenue)} hint="Open deals — chosen amount or mid proposal option" icon={DollarSign} testId="kpi-pipeline" />
        <KPI label="Profit YTD" value={formatCurrency(data.profit_ytd)} hint={`Won revenue ${formatCurrency(data.won_revenue)}`} icon={FileSpreadsheet} testId="kpi-profit-ytd" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-12">
        <KPI label="Contacts" value={data.contacts_count} icon={Users} testId="kpi-contacts" />
        <KPI label="Properties" value={data.properties_count} icon={Building2} testId="kpi-properties" />
        <KPI label="Won Revenue" value={formatCurrency(data.won_revenue)} icon={DollarSign} testId="kpi-won-revenue" />
        <KPI label="Total Costs" value={formatCurrency(data.total_costs)} icon={FileSpreadsheet} testId="kpi-total-costs" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-12">
        <Link to="/maintenance" className="block">
          <KPI label="Maintenance Plans" value={data.maintenance_count || 0} hint="Active recurring customers" icon={Wrench} testId="kpi-maintenance-count" />
        </Link>
        <Link to="/maintenance" className="block">
          <KPI label="Recurring Annual Revenue" value={formatCurrency(data.maintenance_annual_revenue || 0)} hint="Total annual rate across plans" icon={DollarSign} testId="kpi-maintenance-arr" />
        </Link>
        <Link to="/maintenance" className="block">
          <KPI label="Maintenance Due (30 days)" value={data.maintenance_due_30d || 0} hint="Includes overdue" icon={TrendingUp} testId="kpi-maintenance-due30" />
        </Link>
        <Link to="/maintenance" className="block">
          <KPI label="Maintenance Overdue" value={data.maintenance_overdue || 0} hint="Past next due date" icon={Trophy} testId="kpi-maintenance-overdue" />
        </Link>
      </div>

      {/* Payables KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-12">
        <Link to="/payables" className="block">
          <KPI label="Payables Outstanding" value={formatCurrency(data.payables_outstanding || 0)} hint="All unpaid vendor bills" icon={Wallet} testId="kpi-payables-outstanding" />
        </Link>
        <Link to="/payables" className="block">
          <KPI label="Payables Overdue" value={formatCurrency(data.payables_overdue || 0)} hint={`${data.payables_overdue_count || 0} bills past due`} icon={Wallet} testId="kpi-payables-overdue" />
        </Link>
        <Link to="/payables" className="block">
          <KPI label="Due This Week" value={formatCurrency(data.payables_due_this_week || 0)} hint={`${data.payables_due_this_week_count || 0} bills due in 7 days`} icon={Wallet} testId="kpi-payables-due-week" />
        </Link>
      </div>

      {/* Materials In Motion */}
      <MaterialsInMotion motion={motion} />

      {/* Revenue by Project Type */}
      <div className="bg-white border border-zinc-200 rounded-sm mb-12" data-testid="revenue-by-type-card">
        <div className="px-6 py-4 border-b border-zinc-200 flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="font-heading text-lg font-bold tracking-tight">Revenue by Type</h2>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 mt-1">Booked vs Received — broken out by project category</div>
          </div>
          <div className="inline-flex border border-zinc-300 rounded-sm overflow-hidden" data-testid="revenue-window-toggle">
            <button
              data-testid="revenue-window-ytd"
              onClick={() => setRevWindow("ytd")}
              className={`px-3 h-8 text-[10px] font-bold uppercase tracking-wider transition-colors ${revWindow === "ytd" ? "bg-blue-700 text-white" : "bg-white text-zinc-700 hover:bg-zinc-50"}`}
            >
              YTD
            </button>
            <button
              data-testid="revenue-window-all"
              onClick={() => setRevWindow("all")}
              className={`px-3 h-8 text-[10px] font-bold uppercase tracking-wider transition-colors ${revWindow === "all" ? "bg-blue-700 text-white" : "bg-white text-zinc-700 hover:bg-zinc-50"}`}
            >
              All-Time
            </button>
          </div>
        </div>
        {!revData ? (
          <div className="p-8 text-xs uppercase tracking-wider text-zinc-500 text-center">Loading…</div>
        ) : (
          <table className="w-full text-sm" data-testid="revenue-by-type-table">
            <thead>
              <tr className="border-b-2 border-zinc-950 text-left">
                <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-wider">Project Type</th>
                <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-wider text-right">Count</th>
                <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-wider text-right">Booked</th>
                <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-wider text-right">Received</th>
                <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-wider text-right">Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {revData.rows.map((row) => {
                const outstanding = (row.booked || 0) - (row.received || 0);
                const isMaint = row.project_type === "Maintenance";
                return (
                  <tr key={row.project_type} className={`border-b border-zinc-100 ${isMaint ? "bg-blue-50/40" : ""}`} data-testid={`revenue-row-${row.project_type.replace(/\s+/g, "-").toLowerCase()}`}>
                    <td className="px-6 py-3 font-bold text-zinc-950">
                      {row.project_type}
                      {isMaint && <span className="ml-2 text-[9px] font-bold uppercase tracking-wider text-blue-700">(Recurring Visits)</span>}
                    </td>
                    <td className="px-6 py-3 text-right text-zinc-600 font-mono">{row.count}</td>
                    <td className="px-6 py-3 text-right font-mono">{formatCurrency(row.booked)}</td>
                    <td className="px-6 py-3 text-right font-mono text-emerald-700">{formatCurrency(row.received)}</td>
                    <td className={`px-6 py-3 text-right font-mono ${outstanding > 0 ? "text-orange-700" : "text-zinc-400"}`}>{formatCurrency(outstanding)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-zinc-950 bg-zinc-50">
                <td className="px-6 py-3 font-bold uppercase text-[10px] tracking-wider" colSpan={2}>Total</td>
                <td className="px-6 py-3 text-right font-mono font-bold">{formatCurrency(revData.totals.booked)}</td>
                <td className="px-6 py-3 text-right font-mono font-bold text-emerald-700">{formatCurrency(revData.totals.received)}</td>
                <td className="px-6 py-3 text-right font-mono font-bold text-orange-700">{formatCurrency((revData.totals.booked || 0) - (revData.totals.received || 0))}</td>
              </tr>
            </tfoot>
          </table>
        )}
        <div className="px-6 py-3 border-t border-zinc-100 text-[10px] uppercase tracking-wider text-zinc-500">
          <span className="text-blue-700 font-bold">Note:</span> &quot;Received&quot; currently uses Paid milestone amounts as a proxy. Once invoicing is added, this will track actual invoiced + collected amounts.
        </div>
      </div>

      <div className="bg-white border border-zinc-200 rounded-sm">
        <div className="px-6 py-4 border-b border-zinc-200 flex items-center justify-between">
          <h2 className="font-heading text-lg font-bold tracking-tight">Recent Projects</h2>
          <Link to="/projects" data-testid="see-all-deals" className="text-[10px] font-bold uppercase tracking-[0.15em] text-blue-700 hover:underline">
            See All →
          </Link>
        </div>
        {recent.length === 0 ? (
          <div className="p-12 text-center">
            <div className="text-sm text-zinc-500 mb-4">No projects yet. Start your pipeline.</div>
            <Link
              to="/deals"
              data-testid="empty-create-deal"
              className="inline-flex items-center gap-2 bg-blue-700 text-white px-4 h-10 text-xs font-bold uppercase tracking-wider hover:bg-blue-800 rounded-sm transition-colors"
            >
              Create Deal
            </Link>
          </div>
        ) : (
          <table className="w-full text-sm" data-testid="recent-deals-table">
            <thead>
              <tr className="border-b-2 border-zinc-950 text-left">
                <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-wider">Title</th>
                <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-wider">Project</th>
                <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-wider text-right">Chosen Amount</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((d) => (
                <tr key={d.id} className="border-b border-zinc-100 hover:bg-zinc-50">
                  <td className="px-6 py-3">
                    <Link to={`/projects/${d.id}`} className="font-bold text-zinc-950 hover:text-blue-700">{d.title}</Link>
                  </td>
                  <td className="px-6 py-3"><StatusPill status={d.status} /></td>
                  <td className="px-6 py-3 text-zinc-600">{d.project_type}</td>
                  <td className="px-6 py-3 text-right font-mono">{formatCurrency(d.chosen_amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function MaterialsInMotion({ motion }) {
  if (!motion) return null;
  const t = motion.totals || {};
  const projects = motion.projects || [];
  const byVendor = motion.by_vendor || [];

  // Hide the card entirely if there's nothing in motion AND no take-off history at all
  if (t.projects_with_open_orders === 0 && t.lines_received === 0 && t.lines_pending_to_order === 0) {
    return null;
  }

  return (
    <div className="bg-white border border-zinc-200 rounded-sm mb-12" data-testid="materials-in-motion-card">
      <div className="px-6 py-4 border-b border-zinc-200 flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-700 mb-1 inline-flex items-center gap-2">
            <Truck className="w-3.5 h-3.5" /> Materials In Motion
          </div>
          <h2 className="font-heading text-lg font-bold tracking-tight">Outstanding deliveries across all projects</h2>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 mt-1">
            Ordered take-off lines that have not yet been received on site
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-right">
            <div className="font-heading text-2xl font-black tracking-tighter text-zinc-950 leading-none">
              {t.projects_with_open_orders}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 mt-0.5">Projects</div>
          </div>
          <div className="w-px h-10 bg-zinc-200" />
          <div className="text-right">
            <div className="font-heading text-2xl font-black tracking-tighter text-zinc-950 leading-none">
              {t.lines_ordered_not_received}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 mt-0.5">Open lines</div>
          </div>
          <div className="w-px h-10 bg-zinc-200" />
          <div className="text-right">
            <div className="font-heading text-2xl font-black tracking-tighter text-blue-700 leading-none">
              {formatCurrency(t.open_value || 0)}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 mt-0.5">Open value</div>
          </div>
        </div>
      </div>

      {projects.length === 0 ? (
        <div className="px-6 py-10 text-center">
          <PackageCheck className="w-8 h-8 text-emerald-300 mx-auto mb-3" />
          <div className="text-sm font-bold text-zinc-700 mb-1">Nothing in motion right now.</div>
          <div className="text-xs text-zinc-500">
            {t.lines_received > 0
              ? `All ${t.lines_received} ordered line${t.lines_received === 1 ? "" : "s"} have been received. Nice work.`
              : "Add materials to a project&apos;s take-off and mark them ordered to see them here."}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-0 divide-y lg:divide-y-0 lg:divide-x divide-zinc-200">
          {/* Per-project list */}
          <div className="lg:col-span-2">
            <div className="px-6 py-3 text-[10px] uppercase tracking-wider text-zinc-500 bg-zinc-50 font-bold border-b border-zinc-200">
              By Project
            </div>
            <div className="divide-y divide-zinc-100">
              {projects.map((p) => (
                <Link
                  key={p.id}
                  to={`/projects/${p.id}`}
                  className="flex items-center justify-between px-6 py-3 hover:bg-blue-50/40 transition-colors group"
                  data-testid={`motion-project-${p.id}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-zinc-950 truncate">{p.title}</div>
                    <div className="text-[11px] text-zinc-500 mt-0.5 flex items-center gap-2 flex-wrap">
                      <span className="inline-flex items-center gap-1">
                        <Truck className="w-3 h-3 text-blue-600" />
                        <span className="font-bold text-zinc-700">{p.lines_ordered}</span> open
                      </span>
                      {p.lines_received > 0 && (
                        <>
                          <span>·</span>
                          <span className="inline-flex items-center gap-1">
                            <PackageCheck className="w-3 h-3 text-emerald-600" />
                            <span className="font-bold text-zinc-700">{p.lines_received}</span> received
                          </span>
                        </>
                      )}
                      {p.vendors.length > 0 && (
                        <>
                          <span>·</span>
                          <span className="truncate">{p.vendors.map((v) => v.vendor_name).join(", ")}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <div className="font-mono font-bold text-zinc-950 text-sm">{formatCurrency(p.open_value)}</div>
                    <ChevronRight className="w-4 h-4 text-zinc-400 group-hover:text-blue-700 group-hover:translate-x-0.5 transition-transform" />
                  </div>
                </Link>
              ))}
            </div>
          </div>

          {/* Per-vendor aggregate */}
          <div>
            <div className="px-6 py-3 text-[10px] uppercase tracking-wider text-zinc-500 bg-zinc-50 font-bold border-b border-zinc-200">
              By Vendor — Chase List
            </div>
            <div className="divide-y divide-zinc-100">
              {byVendor.slice(0, 8).map((v) => (
                <div key={v.vendor_name} className="px-6 py-3" data-testid={`motion-vendor-${v.vendor_name}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-bold text-zinc-950 truncate">{v.vendor_name}</div>
                    <div className="font-mono font-bold text-zinc-950 text-sm">{formatCurrency(v.value)}</div>
                  </div>
                  <div className="text-[11px] text-zinc-500 mt-0.5">
                    {v.lines} line{v.lines === 1 ? "" : "s"} · {v.projects} project{v.projects === 1 ? "" : "s"}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


export function StatusPill({ status }) {
  const map = {
    Won: "bg-zinc-950 text-white",
    Lost: "bg-red-100 text-red-800",
    Lead: "bg-zinc-200 text-zinc-800",
    Sent: "bg-orange-100 text-orange-800",
    "Proposal Sent": "bg-orange-100 text-orange-800",
  };
  return (
    <span className={`inline-block px-2 py-1 text-[10px] font-bold uppercase tracking-wider rounded-sm ${map[status] || "bg-zinc-200 text-zinc-800"}`}>
      {status}
    </span>
  );
}
