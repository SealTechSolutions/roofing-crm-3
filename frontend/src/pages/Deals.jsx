import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatApiError, formatCurrency } from "@/lib/api";
import { Plus, Pencil, Trash2, ArrowUpRight, Archive } from "lucide-react";
import { toast } from "sonner";
import { Modal, Field, Grid2, Input, Select, Th } from "@/pages/Contacts";
import { StatusPill } from "@/pages/Dashboard";
import { ExportButtons, ImportButton } from "@/components/ExportImport";
import ConfirmDialog from "@/components/ConfirmDialog";

const empty = {
  title: "",
  deal_type: "Scope",
  contact_id: "",
  customer_contact_id: "",
  owner_contact_id: "",
  property_id: "",
  assigned_to_user_id: "",
  lead_source: "Personal",
  referral_source: "",
  project_type: "Repair",
  current_roof_type: "TPO",
  proposed_roof_type: "TPO",
  property_sqft: 0,
  perimeter_lnft: 0,
  avg_parapet_height: 0,
  total_sqft: 0,
  proposal_option_1: 0,
  proposal_option_2: 0,
  proposal_option_3: 0,
  chosen_amount: 0,
  chosen_date: "",
  date_sent: "",
  status: "Lead",
  materials_cost: 0,
  labor_cost: 0,
  subcontractor_cost: 0,
  other_expenses: 0,
  payment_milestones: [],
  cost_items: [],
  notes: "",
};

export default function Deals() {
  const [items, setItems] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [properties, setProperties] = useState([]);
  const [users, setUsers] = useState([]);
  const [options, setOptions] = useState({ lead_sources: [], project_types: [], roof_types: [], deal_statuses: [] });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("All");
  const [confirmTarget, setConfirmTarget] = useState(null);
  const [archiveTarget, setArchiveTarget] = useState(null);

  const load = () => api.get("/deals").then((r) => setItems(r.data));

  useEffect(() => {
    load();
    api.get("/contacts").then((r) => setContacts(r.data));
    api.get("/properties").then((r) => setProperties(r.data));
    api.get("/options").then((r) => setOptions(r.data));
  }, []);

  const openCreate = () => { setEditing(null); setForm(empty); setOpen(true); };
  const openEdit = (d) => { setEditing(d); setForm({ ...empty, ...d, contact_id: d.contact_id || "", customer_contact_id: d.customer_contact_id || "", owner_contact_id: d.owner_contact_id || "", property_id: d.property_id || "" }); setOpen(true); };

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const payload = { ...form };
      if (!payload.contact_id) payload.contact_id = null;
      if (!payload.customer_contact_id) payload.customer_contact_id = null;
      if (!payload.owner_contact_id) payload.owner_contact_id = null;
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

  const remove = (d) => setConfirmTarget(d);

  const removeConfirmed = async () => {
    if (!confirmTarget) return;
    try {
      await api.delete(`/deals/${confirmTarget.id}`);
      toast.success("Project deleted");
      load();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setConfirmTarget(null);
    }
  };

  const archive = (deal) => setArchiveTarget(deal);

  const archiveConfirmed = async () => {
    if (!archiveTarget) return;
    try {
      await api.put(`/deals/${archiveTarget.id}`, { ...archiveTarget, status: "Past Lead" });
      toast.success("Moved to Past Lead Prospects");
      load();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setArchiveTarget(null);
    }
  };

  const contactOpts = [{ value: "", label: "— None —" }, ...contacts.map((c) => ({ value: c.id, label: `${c.contact_name}${c.company_name ? " · " + c.company_name : ""}` }))];
  const propertyOpts = [{ value: "", label: "— None —" }, ...properties.map((p) => ({ value: p.id, label: p.property_name }))];

  // Hide Past Lead from default filter chips; show via dedicated toggle in "All"
  const VISIBLE_FILTERS = ["All", "Lead", "Sent", "Won", "Lost", "Past Lead"];
  const FILTERS = VISIBLE_FILTERS.filter((f) => f === "All" || (options.deal_statuses || []).includes(f));
  const filtered = filter === "All"
    ? items.filter((d) => d.status !== "Past Lead")
    : items.filter((d) => d.status === filter);

  return (
    <div className="p-6 sm:p-8 animate-in fade-in duration-500" data-testid="deals-page">
      <div className="flex items-end justify-between mb-8 pb-6 border-b border-zinc-200 gap-4 flex-wrap">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-700 mb-2">Pipeline</div>
          <h1 className="font-heading text-3xl sm:text-4xl font-black tracking-tight">Projects</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <ExportButtons category="projects" />
          <ImportButton category="projects" onImported={load} />
          <button
            data-testid="new-deal-button"
            onClick={openCreate}
            className="inline-flex items-center gap-2 bg-blue-700 text-white px-4 h-10 text-xs font-bold uppercase tracking-wider hover:bg-blue-800 rounded-sm transition-colors"
          >
            <Plus className="w-4 h-4" /> New Project
          </button>
        </div>
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
            {f === "Past Lead" ? "Past Leads" : f}
          </button>
        ))}
      </div>

      <div className="bg-white border border-zinc-200 rounded-sm overflow-x-auto">
        {filtered.length === 0 ? (
          <div className="p-12 text-center text-sm text-zinc-500">No projects match.</div>
        ) : (
          <table className="w-full text-sm" data-testid="deals-table">
            <thead>
              <tr className="border-b-2 border-zinc-950 text-left">
                <Th>Title</Th><Th>Type</Th><Th>Status</Th><Th>Lead Source</Th><Th>Project</Th><Th>Current → Proposed</Th><Th>Chosen</Th><Th>Profit</Th><Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => {
                const costs = (d.materials_cost || 0) + (d.labor_cost || 0) + (d.subcontractor_cost || 0) + (d.other_expenses || 0);
                const profit = (d.chosen_amount || 0) - costs;
                const isOpen = ["Lead", "Sent"].includes(d.status);
                return (
                  <tr key={d.id} className="border-b border-zinc-100 hover:bg-zinc-50" data-testid={`deal-row-${d.id}`}>
                    <td className="px-6 py-3">
                      <Link to={`/projects/${d.id}`} className="font-bold text-zinc-950 hover:text-blue-700 inline-flex items-center gap-1">
                        {d.title} <ArrowUpRight className="w-3.5 h-3.5" />
                      </Link>
                    </td>
                    <td className="px-6 py-3 text-[10px] font-bold uppercase tracking-wider text-zinc-700">{d.deal_type || "Scope"}</td>
                    <td className="px-6 py-3"><StatusPill status={d.status} /></td>
                    <td className="px-6 py-3 text-zinc-600 text-xs">
                      <div>{d.lead_source}</div>
                      {d.lead_source === "Referral" && d.referral_source && (
                        <div className="text-[10px] text-zinc-400 mt-0.5">via {d.referral_source}</div>
                      )}
                    </td>
                    <td className="px-6 py-3 text-zinc-600 text-xs">{d.project_type}</td>
                    <td className="px-6 py-3 text-zinc-600 text-xs">{d.current_roof_type} → <span className="text-blue-700 font-bold">{d.proposed_roof_type}</span></td>
                    <td className="px-6 py-3 font-mono text-right">{formatCurrency(d.chosen_amount)}</td>
                    <td className={`px-6 py-3 font-mono text-right font-bold ${profit >= 0 ? "text-emerald-700" : "text-red-700"}`}>{formatCurrency(profit)}</td>
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-1">
                        <button data-testid={`edit-deal-${d.id}`} onClick={() => openEdit(d)} title="Edit" className="p-1.5 hover:bg-zinc-200 rounded-sm"><Pencil className="w-3.5 h-3.5" /></button>
                        {isOpen && (
                          <button data-testid={`archive-deal-${d.id}`} onClick={() => archive(d)} title="Move to Past Leads" className="p-1.5 hover:bg-zinc-200 rounded-sm text-zinc-600"><Archive className="w-3.5 h-3.5" /></button>
                        )}
                        <button data-testid={`delete-deal-${d.id}`} onClick={() => remove(d)} title="Delete" className="p-1.5 hover:bg-red-100 text-red-700 rounded-sm"><Trash2 className="w-3.5 h-3.5" /></button>
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
        <Modal wide title={editing ? "Edit Project" : "New Project"} onClose={() => setOpen(false)}>
          <form onSubmit={submit} className="space-y-5" data-testid="deal-form">
            <Grid2>
              <Field label="Project Title *">
                <Input data-testid="deal-title" required value={form.title} onChange={(v) => setForm({ ...form, title: v })} />
              </Field>
              <Field label="Type">
                <Select
                  data-testid="deal-type"
                  value={form.deal_type}
                  onChange={(v) => setForm({ ...form, deal_type: v })}
                  options={options.deal_types || ["Assessment", "Scope"]}
                />
              </Field>
            </Grid2>

            <Grid2>
              <Field label="Customer / Billed-To (e.g., Property Manager)">
                <Select data-testid="deal-customer-contact" value={form.customer_contact_id || ""} onChange={(v) => setForm({ ...form, customer_contact_id: v })} options={contactOpts} />
              </Field>
              <Field label="Property Owner (if different)">
                <Select data-testid="deal-owner-contact" value={form.owner_contact_id || ""} onChange={(v) => setForm({ ...form, owner_contact_id: v })} options={contactOpts} />
              </Field>
              <Field label="Primary Contact">
                <Select data-testid="deal-contact" value={form.contact_id || ""} onChange={(v) => setForm({ ...form, contact_id: v })} options={contactOpts} />
              </Field>
              <Field label="Property">
                <Select data-testid="deal-property" value={form.property_id || ""} onChange={(v) => setForm({ ...form, property_id: v })} options={propertyOpts} />
              </Field>
            </Grid2>

            <Grid2>
              <Field label="Lead Source">
                <Select data-testid="deal-lead-source" value={form.lead_source} onChange={(v) => setForm({ ...form, lead_source: v, referral_source: v === "Referral" ? form.referral_source : "" })} options={options.lead_sources} />
              </Field>
              {form.lead_source === "Referral" && (
                <Field label="Referral Source (who?)">
                  <Input data-testid="deal-referral-source" value={form.referral_source} onChange={(v) => setForm({ ...form, referral_source: v })} placeholder="Name of referrer" />
                </Field>
              )}
              <Field label="Status">
                <Select data-testid="deal-status" value={form.status} onChange={(v) => setForm({ ...form, status: v })} options={options.deal_statuses} />
              </Field>
              <Field label="Project Type">
                <Select data-testid="deal-project-type" value={form.project_type} onChange={(v) => setForm({ ...form, project_type: v })} options={options.project_types} />
              </Field>
              <Field label="Date Sent">
                <Input data-testid="deal-date-sent" type="date" value={form.date_sent} onChange={(v) => setForm({ ...form, date_sent: v })} />
              </Field>
              <Field label="Current Roof Type">
                <Select data-testid="deal-current-roof" value={form.current_roof_type} onChange={(v) => setForm({ ...form, current_roof_type: v })} options={options.roof_types} />
              </Field>
              <Field label="Proposed Roof Type">
                <Select data-testid="deal-proposed-roof" value={form.proposed_roof_type} onChange={(v) => setForm({ ...form, proposed_roof_type: v })} options={options.roof_types} />
              </Field>
              <Field label="Assigned To">
                <Select data-testid="deal-assigned-to" value={form.assigned_to_user_id || ""} onChange={(v) => setForm({ ...form, assigned_to_user_id: v })} options={userOpts} />
              </Field>
            </Grid2>

            <div className="pt-4 border-t border-zinc-200">
              <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-500 mb-3">Measurements</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Field label="Property SqFt">
                  <Input data-testid="deal-property-sqft" type="number" min="0" step="1" value={form.property_sqft} onChange={(v) => setForm({ ...form, property_sqft: v })} />
                </Field>
                <Field label="Perimeter LnFt">
                  <Input data-testid="deal-perimeter-lnft" type="number" min="0" step="1" value={form.perimeter_lnft} onChange={(v) => setForm({ ...form, perimeter_lnft: v })} />
                </Field>
                <Field label="Avg Parapet Ht (ft)">
                  <Input data-testid="deal-parapet-height" type="number" min="0" step="0.5" value={form.avg_parapet_height} onChange={(v) => setForm({ ...form, avg_parapet_height: v })} />
                </Field>
                <Field label="Total SqFt (auto)">
                  <div className="h-10 flex items-center px-3 border border-zinc-200 bg-zinc-50 rounded-sm text-sm font-mono font-bold text-zinc-950" data-testid="deal-total-sqft">
                    {((parseFloat(form.property_sqft || 0)) + (parseFloat(form.perimeter_lnft || 0) * parseFloat(form.avg_parapet_height || 0))).toLocaleString()}
                  </div>
                </Field>
              </div>
              <div className="text-xs text-zinc-500 mt-2">Total = Property SqFt + (Perimeter LnFt × Avg Parapet Height)</div>
            </div>

            <div className="pt-4 border-t border-zinc-200">
              <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-500 mb-3">
                {form.deal_type === "Assessment" ? "Assessment — 3 Roof System Options" : "Scope — Pricing Options"}
              </div>
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
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Chosen Amount ($)">
                  <Input data-testid="deal-chosen-amount" type="number" min="0" step="0.01" value={form.chosen_amount} onChange={(v) => setForm({ ...form, chosen_amount: v })} />
                </Field>
                <Field label="Chosen Date">
                  <Input data-testid="deal-chosen-date" type="date" value={form.chosen_date} onChange={(v) => setForm({ ...form, chosen_date: v })} />
                </Field>
              </div>
              <div className="text-xs text-zinc-500 mt-2">
                Tip: After saving, open the project to add payment milestones and vendor cost line items.
              </div>
            </div>

            <Field label="Notes">
              <textarea
                data-testid="deal-notes"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={3}
                className="w-full px-3 py-2 border border-zinc-300 bg-white rounded-sm focus:outline-none focus:ring-2 focus:ring-blue-700 text-sm"
              />
            </Field>

            <div className="flex justify-end gap-2 pt-4 border-t border-zinc-200">
              <button type="button" onClick={() => setOpen(false)} className="px-4 h-10 text-xs font-bold uppercase tracking-wider border border-zinc-300 rounded-sm hover:bg-zinc-50">Cancel</button>
              <button type="submit" disabled={loading} data-testid="deal-save" className="px-4 h-10 text-xs font-bold uppercase tracking-wider bg-blue-700 text-white hover:bg-blue-800 rounded-sm disabled:opacity-50">{loading ? "Saving..." : "Save Project"}</button>
            </div>
          </form>
        </Modal>
      )}

      <ConfirmDialog
        open={!!confirmTarget}
        title="Delete Project?"
        message={`This will permanently delete ${confirmTarget?.title || "this project"} and all associated milestones, cost items, and documents. This action cannot be undone.`}
        onConfirm={removeConfirmed}
        onClose={() => setConfirmTarget(null)}
      />
      <ConfirmDialog
        open={!!archiveTarget}
        danger={false}
        title="Move to Past Leads?"
        confirmLabel="Move"
        message={`Move "${archiveTarget?.title || "this lead"}" to the Past Lead Prospects archive? You can find it later via the Past Leads filter.`}
        onConfirm={archiveConfirmed}
        onClose={() => setArchiveTarget(null)}
      />
    </div>
  );
}
