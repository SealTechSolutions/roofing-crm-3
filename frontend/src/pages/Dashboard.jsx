import React, { useEffect, useState } from "react";
import { api, formatCurrency } from "@/lib/api";
import { Link } from "react-router-dom";
import { TrendingUp, FileSpreadsheet, Users, Building2, DollarSign, Trophy, Wrench } from "lucide-react";
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

  useEffect(() => {
    api.get("/dashboard/summary").then((r) => setData(r.data));
    api.get("/deals").then((r) => setDeals(r.data));
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
          <span className="text-blue-700 font-bold">Note:</span> "Received" currently uses Paid milestone amounts as a proxy. Once invoicing is added, this will track actual invoiced + collected amounts.
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
