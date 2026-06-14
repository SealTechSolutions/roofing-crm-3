import React, { useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Modal, Field, Grid2, Input, Select, Th } from "@/pages/Contacts";
import { ExportButtons, ImportButton } from "@/components/ExportImport";
import { US_STATES, DEFAULT_STATE } from "@/constants/states";
import ConfirmDialog from "@/components/ConfirmDialog";
import { formatPhoneDisplay } from "@/lib/format";

const empty = {
  property_name: "",
  property_address: "",
  property_address_line2: "",
  property_city: "",
  property_state: DEFAULT_STATE,
  property_zip: "",
  property_contact_id: "",
  property_contact_name: "",
  property_contact_phone: "",
  notes: "",
};

export default function Properties() {
  const [items, setItems] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);
  const [loading, setLoading] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState(null);

  const load = () => api.get("/properties").then((r) => setItems(r.data));

  const removeConfirmed = async () => {
    if (!confirmTarget) return;
    try {
      await api.delete(`/properties/${confirmTarget.id}`);
      toast.success("Property deleted");
      load();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setConfirmTarget(null);
    }
  };
  useEffect(() => {
    load();
    api.get("/contacts").then((r) => setContacts(r.data));
  }, []);

  const openCreate = () => { setEditing(null); setForm(empty); setOpen(true); };
  const openEdit = (p) => { setEditing(p); setForm({ ...empty, ...p }); setOpen(true); };

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const payload = { ...form };
      if (payload.property_contact_id) {
        const c = contacts.find((x) => x.id === payload.property_contact_id);
        if (c && !payload.property_contact_name) payload.property_contact_name = c.contact_name;
      } else {
        payload.property_contact_id = null;
      }
      if (editing) {
        await api.put(`/properties/${editing.id}`, payload);
        toast.success("Property updated");
      } else {
        await api.post(`/properties`, payload);
        toast.success("Property created");
      }
      setOpen(false);
      load();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setLoading(false);
    }
  };

  const remove = (p) => setConfirmTarget(p);

  const contactOpts = [{ value: "", label: "— None —" }, ...contacts.map((c) => ({ value: c.id, label: `${c.contact_name}${c.company_name ? " · " + c.company_name : ""}` }))];

  return (
    <div className="p-6 sm:p-8 animate-in fade-in duration-500" data-testid="properties-page">
      <div className="flex items-end justify-between mb-8 pb-6 border-b border-zinc-200 gap-4 flex-wrap">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-700 mb-2">Properties</div>
          <h1 className="font-heading text-3xl sm:text-4xl font-black tracking-tight">Sites &amp; Buildings</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <ExportButtons category="properties" />
          <ImportButton category="properties" onImported={load} />
          <button
            data-testid="new-property-button"
            onClick={openCreate}
            className="inline-flex items-center gap-2 bg-blue-700 text-white px-4 h-10 text-xs font-bold uppercase tracking-wider hover:bg-blue-800 rounded-sm transition-colors"
          >
            <Plus className="w-4 h-4" /> New Property
          </button>
        </div>
      </div>

      <div className="bg-white border border-zinc-200 rounded-sm overflow-x-auto">
        {items.length === 0 ? (
          <div className="p-12 text-center text-sm text-zinc-500">No properties yet.</div>
        ) : (
          <table className="w-full text-sm" data-testid="properties-table">
            <thead>
              <tr className="border-b-2 border-zinc-950 text-left">
                <Th>Property</Th><Th>Address</Th><Th>Contact</Th><Th>Phone</Th><Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id} className="border-b border-zinc-100 hover:bg-zinc-50" data-testid={`property-row-${p.id}`}>
                  <td className="px-6 py-3 font-bold text-zinc-950">{p.property_name}</td>
                  <td className="px-6 py-3 text-zinc-600 text-xs">
                    {[p.property_address, [p.property_city, p.property_state].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}
                  </td>
                  <td className="px-6 py-3 text-zinc-700">{p.property_contact_name}</td>
                  <td className="px-6 py-3 text-zinc-600 font-mono text-xs">{formatPhoneDisplay(p.property_contact_phone)}</td>
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-1">
                      <button data-testid={`edit-property-${p.id}`} onClick={() => openEdit(p)} className="p-1.5 hover:bg-zinc-200 rounded-sm"><Pencil className="w-3.5 h-3.5" /></button>
                      <button data-testid={`delete-property-${p.id}`} onClick={() => remove(p)} className="p-1.5 hover:bg-red-100 text-red-700 rounded-sm"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {open && (
        <Modal title={editing ? "Edit Property" : "New Property"} onClose={() => setOpen(false)}>
          <form onSubmit={submit} className="space-y-4" data-testid="property-form">
            <Field label="Property Name *">
              <Input data-testid="property-name" required value={form.property_name} onChange={(v) => setForm({ ...form, property_name: v })} />
            </Field>
            <Field label="Address Line 1">
              <Input data-testid="property-address" value={form.property_address} onChange={(v) => setForm({ ...form, property_address: v })} />
            </Field>
            <Field label="Address Line 2">
              <Input data-testid="property-address2" value={form.property_address_line2} onChange={(v) => setForm({ ...form, property_address_line2: v })} />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-6 gap-4">
              <div className="sm:col-span-3">
                <Field label="City">
                  <Input data-testid="property-city" value={form.property_city} onChange={(v) => setForm({ ...form, property_city: v })} />
                </Field>
              </div>
              <div className="sm:col-span-1">
                <Field label="State">
                  <Select data-testid="property-state" value={form.property_state || DEFAULT_STATE} onChange={(v) => setForm({ ...form, property_state: v })} options={US_STATES} />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="ZIP">
                  <Input data-testid="property-zip" value={form.property_zip} onChange={(v) => setForm({ ...form, property_zip: v })} />
                </Field>
              </div>
            </div>
            <Grid2>
              <Field label="Link to Contact">
                <Select data-testid="property-contact-id" value={form.property_contact_id || ""} onChange={(v) => setForm({ ...form, property_contact_id: v })} options={contactOpts} />
              </Field>
              <Field label="On-Site Contact Name">
                <Input data-testid="property-contact-name" value={form.property_contact_name} onChange={(v) => setForm({ ...form, property_contact_name: v })} />
              </Field>
            </Grid2>
            <Field label="On-Site Contact Phone">
              <Input data-testid="property-contact-phone" format="phone" value={form.property_contact_phone} onChange={(v) => setForm({ ...form, property_contact_phone: v })} />
            </Field>
            <Field label="Notes">
              <textarea
                data-testid="property-notes"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={3}
                className="w-full px-3 py-2 border border-zinc-300 bg-white rounded-sm focus:outline-none focus:ring-2 focus:ring-blue-700 text-sm"
              />
            </Field>
            <div className="flex justify-end gap-2 pt-4 border-t border-zinc-200">
              <button type="button" onClick={() => setOpen(false)} className="px-4 h-10 text-xs font-bold uppercase tracking-wider border border-zinc-300 rounded-sm hover:bg-zinc-50">Cancel</button>
              <button type="submit" disabled={loading} data-testid="property-save" className="px-4 h-10 text-xs font-bold uppercase tracking-wider bg-blue-700 text-white hover:bg-blue-800 rounded-sm disabled:opacity-50">{loading ? "Saving..." : "Save"}</button>
            </div>
          </form>
        </Modal>
      )}

      <ConfirmDialog
        open={!!confirmTarget}
        title="Delete Property?"
        message={`This will permanently delete ${confirmTarget?.property_name || "this property"}. This action cannot be undone.`}
        onConfirm={removeConfirmed}
        onClose={() => setConfirmTarget(null)}
      />
    </div>
  );
}
