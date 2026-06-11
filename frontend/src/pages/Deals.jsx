import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatApiError, formatCurrency } from "@/lib/api";
import { Plus, Pencil, Trash2, ArrowUpRight } from "lucide-react";
import { toast } from "sonner";
import { Modal, Field, Grid2, Input, Select, Th } from "@/pages/Contacts";
import { StatusPill } from "@/pages/Dashboard";

const empty = {
  title: "",
  contact_id: "",
  property_id: "",
  lead_source: "Other",
  project_type: "Repair",
  current_roof_type: "TPO",
  proposed_roof_type: "TPO",
  proposal_option_1: 0,
  proposal_option_2: 0,
  proposal_option_3: 0,
  chosen_amount: 0,
  status: "Lead",
  materials_cost: 0,
  labor_cost: 0,
  subcontractor_cost: 0,
  other_expenses: 0,
  notes: "",
};

export default function Deals() {
  const [items, setItems] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [properties, setProperties] = useState([]);
  const [options, setOptions] = useState({ lead_sources: [], project_types: [], roof_types: [], deal_statuses: [] });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("All");

  const load = () => api.get("/deals").then((r) => setItems(r.data));

  useEffect(() => {
    load();
    api.get("/contacts").then((r) => setContacts(r.data));
    api.get("/properties").then((r) => setProperties(r.data));
    api.get("/options").then((r) => setOptions(r.data));
  }, []);

  const openCreate = () => { setEditing(null); setForm(empty); setOpen(true); };
  const openEdit = (d) => { setEditing(d); setForm({ ...empty, ...d, contact_id: d.contact_id || "", property_id: d.property_id || "" }); setOpen(true); };

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const payload = { ...form };
      if (!payload.contact_id) payload.contact_id = null;
      if (!payload.property_id) payload.property_id = null;
      if (editing) {
        await api.put(`/deals/${editing.id}`, payload);
        toast.success("Deal updated");
      } else {
        await api.post(`/deals`, payload);
        toast.success("Deal created");
      }
      setOpen(false);
      load();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setLoading(false);
    }
  };

  const remove = async (id) => {
    if (!window.confirm("Delete this deal?")) return;
    await api.delete(`/deals/${id}`);
    toast.success("Deal deleted");
    load();
  };

  const contactOpts = [{ value: "", label: "— None —" }, ...contacts.map((c) => ({ value: c.id, label: `${c.contact_name}${c.company_name ? " · " + c.company_name : ""}` }))];
  const propertyOpts = [{ value: "", label: "— None —" }, ...properties.map((p) => ({ value: p.id, label: p.property_name }))];

  const filtered = filter === "All" ? items : items.filter((d) => d.status === filter);
  const FILTERS = ["All", ...options.deal_statuses];

  return (
    <div className="p-6 sm:p-8 animate-in fade-in duration-500" data-testid="deals-page">
      <div className="flex items-end justify-between mb-8 pb-6 border-b border-zinc-200">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-orange-600 mb-2">Pipeline</div>
          <h1 className="font-heading text-3xl sm:text-4xl font-black tracking-tight">Deals &amp; Proposals</h1>
        </div>
        <button
          data-testid="new-deal-button"
          onClick={openCreate}
          className="inline-flex items-center gap-2 bg-orange-600 text-white px-4 h-10 text-xs font-bold uppercase tracking-wider hover:bg-orange-700 rounded-sm transition-colors"
        >
          <Plus className="w-4 h-4" /> New Deal
        </button>
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        {FILTERS.map((f) => (
          <button
            key={f}
            data-testid={`filter-${f.toLowerCase().replace(/\s/g, "-")}`}
            onClick={() => setFilter(f)}
            className={`px-3 h-8 text-[10px] font-bold uppercase tracking-wider border rounded-sm transition-colors ${
              filter === f ? "bg-zinc-950 text-white border-zinc-950" : "bg-white text-zinc-700 border-zinc-300 hover:border-zinc-950"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="bg-white border border-zinc-200 rounded-sm overflow-x-auto">
        {filtered.length === 0 ? (
          <div className="p-12 text-center text-sm text-zinc-500">No deals match.</div>
        ) : (
          <table className="w-full text-sm" data-testid="deals-table">
            <thead>
              <tr className="border-b-2 border-zinc-950 text-left">
                <Th>Title</Th><Th>Status</Th><Th>Source</Th><Th>Project</Th><Th>Current → Proposed</Th><Th>Chosen</Th><Th>Profit</Th><Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => {
                const costs = (d.materials_cost || 0) + (d.labor_cost || 0) + (d.subcontractor_cost || 0) + (d.other_expenses || 0);
                const profit = (d.chosen_amount || 0) - costs;
                return (
                  <tr key={d.id} className="border-b border-zinc-100 hover:bg-zinc-50" data-testid={`deal-row-${d.id}`}>
                    <td className="px-6 py-3">
                      <Link to={`/deals/${d.id}`} className="font-bold text-zinc-950 hover:text-orange-600 inline-flex items-center gap-1">
                        {d.title} <ArrowUpRight className="w-3.5 h-3.5" />
                      </Link>
                    </td>
                    <td className="px-6 py-3"><StatusPill status={d.status} /></td>
                    <td className="px-6 py-3 text-zinc-600 text-xs">{d.lead_source}</td>
                    <td className="px-6 py-3 text-zinc-600 text-xs">{d.project_type}</td>
                    <td className="px-6 py-3 text-zinc-600 text-xs">{d.current_roof_type} → <span className="text-orange-700 font-bold">{d.proposed_roof_type}</span></td>
                    <td className="px-6 py-3 font-mono text-right">{formatCurrency(d.chosen_amount)}</td>
                    <td className={`px-6 py-3 font-mono text-right font-bold ${profit >= 0 ? "text-emerald-700" : "text-red-700"}`}>{formatCurrency(profit)}</td>
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-1">
                        <button data-testid={`edit-deal-${d.id}`} onClick={() => openEdit(d)} className="p-1.5 hover:bg-zinc-200 rounded-sm"><Pencil className="w-3.5 h-3.5" /></button>
                        <button data-testid={`delete-deal-${d.id}`} onClick={() => remove(d.id)} className="p-1.5 hover:bg-red-100 text-red-700 rounded-sm"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {open && (
        <Modal wide title={editing ? "Edit Deal" : "New Deal"} onClose={() => setOpen(false)}>
          <form onSubmit={submit} className="space-y-5" data-testid="deal-form">
            <Field label="Deal Title *">
              <Input data-testid="deal-title" required value={form.title} onChange={(v) => setForm({ ...form, title: v })} />
            </Field>

            <Grid2>
              <Field label="Contact">
                <Select data-testid="deal-contact" value={form.contact_id || ""} onChange={(v) => setForm({ ...form, contact_id: v })} options={contactOpts} />
              </Field>
              <Field label="Property">
                <Select data-testid="deal-property" value={form.property_id || ""} onChange={(v) => setForm({ ...form, property_id: v })} options={propertyOpts} />
              </Field>
            </Grid2>

            <Grid2>
              <Field label="Lead Source">
                <Select data-testid="deal-lead-source" value={form.lead_source} onChange={(v) => setForm({ ...form, lead_source: v })} options={options.lead_sources} />
              </Field>
              <Field label="Status">
                <Select data-testid="deal-status" value={form.status} onChange={(v) => setForm({ ...form, status: v })} options={options.deal_statuses} />
              </Field>
              <Field label="Project Type">
                <Select data-testid="deal-project-type" value={form.project_type} onChange={(v) => setForm({ ...form, project_type: v })} options={options.project_types} />
              </Field>
              <Field label="Current Roof Type">
                <Select data-testid="deal-current-roof" value={form.current_roof_type} onChange={(v) => setForm({ ...form, current_roof_type: v })} options={options.roof_types} />
              </Field>
              <Field label="Proposed Roof Type">
                <Select data-testid="deal-proposed-roof" value={form.proposed_roof_type} onChange={(v) => setForm({ ...form, proposed_roof_type: v })} options={options.roof_types} />
              </Field>
            </Grid2>

            <div className="pt-4 border-t border-zinc-200">
              <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-500 mb-3">Proposal — 3 Option Amounts</div>
              <div className="grid grid-cols-3 gap-4">
                <Field label="Option A ($)">
                  <Input data-testid="deal-option-1" type="number" min="0" step="0.01" value={form.proposal_option_1} onChange={(v) => setForm({ ...form, proposal_option_1: v })} />
                </Field>
                <Field label="Option B ($)">
                  <Input data-testid="deal-option-2" type="number" min="0" step="0.01" value={form.proposal_option_2} onChange={(v) => setForm({ ...form, proposal_option_2: v })} />
                </Field>
                <Field label="Option C ($)">
                  <Input data-testid="deal-option-3" type="number" min="0" step="0.01" value={form.proposal_option_3} onChange={(v) => setForm({ ...form, proposal_option_3: v })} />
                </Field>
              </div>
              <div className="mt-4">
                <Field label="Chosen Amount ($)">
                  <Input data-testid="deal-chosen-amount" type="number" min="0" step="0.01" value={form.chosen_amount} onChange={(v) => setForm({ ...form, chosen_amount: v })} />
                </Field>
              </div>
            </div>

            <div className="pt-4 border-t border-zinc-200">
              <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-500 mb-3">Costs / P&amp;L</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Field label="Materials ($)"><Input data-testid="deal-materials" type="number" min="0" step="0.01" value={form.materials_cost} onChange={(v) => setForm({ ...form, materials_cost: v })} /></Field>
                <Field label="Labor ($)"><Input data-testid="deal-labor" type="number" min="0" step="0.01" value={form.labor_cost} onChange={(v) => setForm({ ...form, labor_cost: v })} /></Field>
                <Field label="Subcontractor ($)"><Input data-testid="deal-subcontractor" type="number" min="0" step="0.01" value={form.subcontractor_cost} onChange={(v) => setForm({ ...form, subcontractor_cost: v })} /></Field>
                <Field label="Other ($)"><Input data-testid="deal-other" type="number" min="0" step="0.01" value={form.other_expenses} onChange={(v) => setForm({ ...form, other_expenses: v })} /></Field>
              </div>
            </div>

            <Field label="Notes">
              <textarea
                data-testid="deal-notes"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={3}
                className="w-full px-3 py-2 border border-zinc-300 bg-white rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-600 text-sm"
              />
            </Field>

            <div className="flex justify-end gap-2 pt-4 border-t border-zinc-200">
              <button type="button" onClick={() => setOpen(false)} className="px-4 h-10 text-xs font-bold uppercase tracking-wider border border-zinc-300 rounded-sm hover:bg-zinc-50">Cancel</button>
              <button type="submit" disabled={loading} data-testid="deal-save" className="px-4 h-10 text-xs font-bold uppercase tracking-wider bg-orange-600 text-white hover:bg-orange-700 rounded-sm disabled:opacity-50">{loading ? "Saving..." : "Save Deal"}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
