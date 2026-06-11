import React, { useEffect, useState } from "react";
import { api, formatCurrency } from "@/lib/api";
import { Link } from "react-router-dom";
import { TrendingUp, FileSpreadsheet, Users, Building2, DollarSign, Trophy } from "lucide-react";

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

  useEffect(() => {
    api.get("/dashboard/summary").then((r) => setData(r.data));
    api.get("/deals").then((r) => setDeals(r.data));
  }, []);

  if (!data) {
    return <div className="p-8 text-xs uppercase tracking-[0.2em] text-zinc-500">Loading dashboard...</div>;
  }

  const recent = deals.slice(0, 5);

  return (
    <div className="p-6 sm:p-8 animate-in fade-in slide-in-from-bottom-4 duration-500" data-testid="dashboard-page">
      <div className="flex items-end justify-between mb-8 pb-6 border-b border-zinc-200">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-orange-600 mb-2">Overview</div>
          <h1 className="font-heading text-3xl sm:text-4xl font-black tracking-tight leading-none">Command Center</h1>
        </div>
        <Link
          to="/deals"
          data-testid="dashboard-new-deal"
          className="hidden sm:inline-flex items-center gap-2 bg-zinc-950 text-white px-4 h-10 text-xs font-bold uppercase tracking-wider hover:bg-zinc-800 rounded-sm transition-colors"
        >
          View Pipeline →
        </Link>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <KPI label="Open Leads" value={data.open_leads} hint={`${data.deals_count} total deals`} icon={TrendingUp} testId="kpi-open-leads" />
        <KPI label="Won Deals" value={data.won_deals} hint={`${data.lost_deals} lost`} icon={Trophy} testId="kpi-won-deals" />
        <KPI label="Pipeline Revenue" value={formatCurrency(data.pipeline_revenue)} hint="Open + Proposal Sent" icon={DollarSign} testId="kpi-pipeline" />
        <KPI label="Profit YTD" value={formatCurrency(data.profit_ytd)} hint={`Won revenue ${formatCurrency(data.won_revenue)}`} icon={FileSpreadsheet} testId="kpi-profit-ytd" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-12">
        <KPI label="Contacts" value={data.contacts_count} icon={Users} testId="kpi-contacts" />
        <KPI label="Properties" value={data.properties_count} icon={Building2} testId="kpi-properties" />
        <KPI label="Won Revenue" value={formatCurrency(data.won_revenue)} icon={DollarSign} testId="kpi-won-revenue" />
        <KPI label="Total Costs" value={formatCurrency(data.total_costs)} icon={FileSpreadsheet} testId="kpi-total-costs" />
      </div>

      <div className="bg-white border border-zinc-200 rounded-sm">
        <div className="px-6 py-4 border-b border-zinc-200 flex items-center justify-between">
          <h2 className="font-heading text-lg font-bold tracking-tight">Recent Deals</h2>
          <Link to="/deals" data-testid="see-all-deals" className="text-[10px] font-bold uppercase tracking-[0.15em] text-orange-600 hover:underline">
            See All →
          </Link>
        </div>
        {recent.length === 0 ? (
          <div className="p-12 text-center">
            <div className="text-sm text-zinc-500 mb-4">No deals yet. Start your pipeline.</div>
            <Link
              to="/deals"
              data-testid="empty-create-deal"
              className="inline-flex items-center gap-2 bg-orange-600 text-white px-4 h-10 text-xs font-bold uppercase tracking-wider hover:bg-orange-700 rounded-sm transition-colors"
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
                    <Link to={`/deals/${d.id}`} className="font-bold text-zinc-950 hover:text-orange-600">{d.title}</Link>
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
    "Proposal Sent": "bg-orange-100 text-orange-800",
  };
  return (
    <span className={`inline-block px-2 py-1 text-[10px] font-bold uppercase tracking-wider rounded-sm ${map[status] || "bg-zinc-200 text-zinc-800"}`}>
      {status}
    </span>
  );
}
