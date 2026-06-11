import React, { useEffect, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { api, formatCurrency } from "@/lib/api";
import { ArrowLeft } from "lucide-react";
import { StatusPill } from "@/pages/Dashboard";

export default function DealDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [deal, setDeal] = useState(null);
  const [contact, setContact] = useState(null);
  const [property, setProperty] = useState(null);

  useEffect(() => {
    api.get(`/deals/${id}`).then(async (r) => {
      setDeal(r.data);
      if (r.data.contact_id) {
        try { const c = await api.get(`/contacts/${r.data.contact_id}`); setContact(c.data); } catch {}
      }
      if (r.data.property_id) {
        try { const p = await api.get(`/properties/${r.data.property_id}`); setProperty(p.data); } catch {}
      }
    }).catch(() => nav("/deals"));
  }, [id, nav]);

  if (!deal) return <div className="p-8 text-xs uppercase tracking-[0.2em] text-zinc-500">Loading...</div>;

  const totalCosts = (deal.materials_cost || 0) + (deal.labor_cost || 0) + (deal.subcontractor_cost || 0) + (deal.other_expenses || 0);
  const revenue = deal.chosen_amount || 0;
  const profit = revenue - totalCosts;
  const margin = revenue > 0 ? (profit / revenue) * 100 : 0;

  return (
    <div className="p-6 sm:p-8 animate-in fade-in duration-500" data-testid="deal-detail-page">
      <Link to="/deals" className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 hover:text-blue-700 mb-4" data-testid="back-to-deals">
        <ArrowLeft className="w-3 h-3" /> Back to Deals
      </Link>

      <div className="flex items-end justify-between mb-8 pb-6 border-b border-zinc-200">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-700">Deal</div>
            <StatusPill status={deal.status} />
          </div>
          <h1 className="font-heading text-3xl sm:text-4xl font-black tracking-tight" data-testid="deal-title">{deal.title}</h1>
          <div className="mt-2 text-xs uppercase tracking-wider text-zinc-500">{deal.lead_source} · {deal.project_type}</div>
        </div>
        <Link to="/deals" className="text-xs font-bold uppercase tracking-wider text-zinc-700 underline">Edit in List</Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <KpiCard label="Revenue (Chosen)" value={formatCurrency(revenue)} testId="kpi-revenue" />
        <KpiCard label="Total Costs" value={formatCurrency(totalCosts)} testId="kpi-costs" />
        <KpiCard label="Net Profit" value={formatCurrency(profit)} hint={`Margin: ${margin.toFixed(1)}%`} accent={profit >= 0 ? "text-emerald-700" : "text-red-700"} testId="kpi-profit" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <Card title="Proposal Options">
          <Row label="Option A" value={formatCurrency(deal.proposal_option_1)} highlight={Math.abs(revenue - deal.proposal_option_1) < 0.01} />
          <Row label="Option B" value={formatCurrency(deal.proposal_option_2)} highlight={Math.abs(revenue - deal.proposal_option_2) < 0.01} />
          <Row label="Option C" value={formatCurrency(deal.proposal_option_3)} highlight={Math.abs(revenue - deal.proposal_option_3) < 0.01} />
          <div className="border-t-2 border-zinc-950 my-2" />
          <Row label="Chosen" value={formatCurrency(revenue)} bold />
        </Card>

        <Card title="Roof Spec">
          <Row label="Current Roof" value={deal.current_roof_type} />
          <Row label="Proposed Roof" value={deal.proposed_roof_type} bold />
          <Row label="Project Type" value={deal.project_type} />
          <Row label="Lead Source" value={deal.lead_source} />
        </Card>
      </div>

      <Card title="P&L Breakdown">
        <Row label="Materials" value={formatCurrency(deal.materials_cost)} />
        <Row label="Labor" value={formatCurrency(deal.labor_cost)} />
        <Row label="Subcontractor" value={formatCurrency(deal.subcontractor_cost)} />
        <Row label="Other Expenses" value={formatCurrency(deal.other_expenses)} />
        <div className="border-t border-zinc-200 my-2" />
        <Row label="Total Costs" value={formatCurrency(totalCosts)} bold />
        <Row label="Revenue" value={formatCurrency(revenue)} bold />
        <div className="border-t-2 border-zinc-950 my-2" />
        <Row label="Net Profit" value={formatCurrency(profit)} bold accent={profit >= 0 ? "text-emerald-700" : "text-red-700"} />
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-8">
        <Card title="Contact">
          {contact ? (
            <>
              <Row label="Name" value={contact.contact_name} bold />
              <Row label="Company" value={contact.company_name} />
              <Row label="Phone" value={contact.phone} />
              <Row label="Email" value={contact.email} />
              <Row label="Address" value={contact.address} />
            </>
          ) : (
            <div className="text-sm text-zinc-500">No contact linked.</div>
          )}
        </Card>
        <Card title="Property">
          {property ? (
            <>
              <Row label="Name" value={property.property_name} bold />
              <Row label="Address" value={property.property_address} />
              <Row label="On-Site Contact" value={property.property_contact_name} />
              <Row label="Phone" value={property.property_contact_phone} />
            </>
          ) : (
            <div className="text-sm text-zinc-500">No property linked.</div>
          )}
        </Card>
      </div>

      {deal.notes && (
        <div className="mt-6 bg-white border border-zinc-200 rounded-sm p-6">
          <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-500 mb-2">Notes</div>
          <div className="text-sm text-zinc-800 whitespace-pre-wrap" data-testid="deal-notes-view">{deal.notes}</div>
        </div>
      )}
    </div>
  );
}

const Card = ({ title, children }) => (
  <div className="bg-white border border-zinc-200 rounded-sm p-6">
    <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-500 mb-4 pb-3 border-b border-zinc-100">{title}</div>
    <div>{children}</div>
  </div>
);

const Row = ({ label, value, bold, highlight, accent }) => (
  <div className={`flex items-center justify-between py-2 ${highlight ? "bg-blue-50 -mx-2 px-2 rounded-sm" : ""}`}>
    <div className="text-xs uppercase tracking-wider text-zinc-500">{label}</div>
    <div className={`text-sm ${bold ? "font-bold text-zinc-950" : "text-zinc-700"} font-mono ${accent || ""}`}>{value || "—"}</div>
  </div>
);

const KpiCard = ({ label, value, hint, testId, accent }) => (
  <div className="bg-white border border-zinc-200 p-6 rounded-sm" data-testid={testId}>
    <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-500 mb-3">{label}</div>
    <div className={`font-heading text-3xl font-black tracking-tighter ${accent || "text-zinc-950"}`}>{value}</div>
    {hint && <div className="text-xs text-zinc-500 mt-2">{hint}</div>}
  </div>
);
