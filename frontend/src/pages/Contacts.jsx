import React, { useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { Plus, Pencil, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { ExportButtons, ImportButton } from "@/components/ExportImport";
import ConfirmDialog from "@/components/ConfirmDialog";
import { US_STATES, DEFAULT_STATE } from "@/constants/states";

const CONTACT_TYPES = ["Owner", "Property Manager", "Tenant", "Other"];

const empty = {
  contact_name: "",
  company_name: "",
  contact_type: "Owner",
  phone: "",
  work_phone: "",
  mobile_phone: "",
  fax: "",
  email: "",
  address: "",
  address_line2: "",
  city: "",
  state: DEFAULT_STATE,
  zip_code: "",
  billing_same_as_address: true,
  billing_address: "",
  billing_address_line2: "",
  billing_city: "",
  billing_state: DEFAULT_STATE,
  billing_zip: "",
  website: "",
};

export default function Contacts() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);
  const [loading, setLoading] = useState(false);
  const [typeFilter, setTypeFilter] = useState("All");
  const [confirmTarget, setConfirmTarget] = useState(null);

  const load = () => api.get("/contacts").then((r) => setItems(r.data));
  useEffect(() => { load(); }, []);

  const openCreate = () => { setEditing(null); setForm(empty); setOpen(true); };
  const openEdit = (c) => {
    setEditing(c);
    setForm({ ...empty, ...c });
    setOpen(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (editing) {
        await api.put(`/contacts/${editing.id}`, form);
        toast.success("Contact updated");
      } else {
        await api.post(`/contacts`, form);
        toast.success("Contact created");
      }
      setOpen(false);
      load();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setLoading(false);
    }
  };

  const remove = async () => {
    if (!confirmTarget) return;
    try {
      await api.delete(`/contacts/${confirmTarget.id}`);
      toast.success("Contact deleted");
      load();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setConfirmTarget(null);
    }
  };

  return (
    <div className="p-6 sm:p-8 animate-in fade-in duration-500" data-testid="contacts-page">
      <div className="flex items-end justify-between mb-8 pb-6 border-b border-zinc-200 gap-4 flex-wrap">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-700 mb-2">Contacts</div>
          <h1 className="font-heading text-3xl sm:text-4xl font-black tracking-tight">People &amp; Companies</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <ExportButtons category="contacts" />
          <ImportButton category="contacts" onImported={load} />
          <button
            data-testid="new-contact-button"
            onClick={openCreate}
            className="inline-flex items-center gap-2 bg-blue-700 text-white px-4 h-10 text-xs font-bold uppercase tracking-wider hover:bg-blue-800 rounded-sm transition-colors"
          >
            <Plus className="w-4 h-4" /> New Contact
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        {["All", ...CONTACT_TYPES].map((t) => (
          <button
            key={t}
            data-testid={`contact-type-filter-${t.toLowerCase().replace(/\s/g, "-")}`}
            onClick={() => setTypeFilter(t)}
            className={`px-3 h-8 text-[10px] font-bold uppercase tracking-wider border rounded-sm transition-colors ${
              typeFilter === t ? "bg-zinc-950 text-white border-zinc-950" : "bg-white text-zinc-700 border-zinc-300 hover:border-zinc-950"
            }`}
          >
            {t === "Property Manager" ? "Prop. Mgrs" : t === "All" ? "All" : t + "s"}
          </button>
        ))}
      </div>

      <div className="bg-white border border-zinc-200 rounded-sm overflow-x-auto">
        {items.filter((c) => typeFilter === "All" || (c.contact_type || "Owner") === typeFilter).length === 0 ? (
          <div className="p-12 text-center text-sm text-zinc-500">No contacts match.</div>
        ) : (
          <table className="w-full text-sm" data-testid="contacts-table">
            <thead>
              <tr className="border-b-2 border-zinc-950 text-left">
                <Th>Contact</Th><Th>Type</Th><Th>Company</Th><Th>Phone</Th><Th>Email</Th><Th>City, State</Th><Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {items
                .filter((c) => typeFilter === "All" || (c.contact_type || "Owner") === typeFilter)
                .map((c) => (
                <tr key={c.id} className="border-b border-zinc-100 hover:bg-zinc-50" data-testid={`contact-row-${c.id}`}>
                  <td className="px-6 py-3 font-bold text-zinc-950">
                    {c.contact_name}
                    {c.website && (
                      <a href={c.website.startsWith("http") ? c.website : `https://${c.website}`} target="_blank" rel="noopener noreferrer" className="block text-[10px] font-normal text-blue-700 hover:underline mt-0.5" data-testid={`contact-website-${c.id}`}>
                        🌐 {c.website.replace(/^https?:\/\//, "")}
                      </a>
                    )}
                  </td>
                  <td className="px-6 py-3 text-[10px] uppercase tracking-wider text-zinc-700">{c.contact_type || "—"}</td>
                  <td className="px-6 py-3 text-zinc-700">{c.company_name}</td>
                  <td className="px-6 py-3 text-zinc-600 font-mono text-xs">{c.mobile_phone || c.work_phone || c.phone}</td>
                  <td className="px-6 py-3 text-zinc-600 text-xs">{c.email}</td>
                  <td className="px-6 py-3 text-zinc-600 text-xs">{[c.city, c.state].filter(Boolean).join(", ")}</td>
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-1">
                      <button data-testid={`edit-contact-${c.id}`} onClick={() => openEdit(c)} className="p-1.5 hover:bg-zinc-200 rounded-sm"><Pencil className="w-3.5 h-3.5" /></button>
                      <button data-testid={`delete-contact-${c.id}`} onClick={() => setConfirmTarget(c)} className="p-1.5 hover:bg-red-100 text-red-700 rounded-sm"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {open && (
        <Modal title={editing ? "Edit Contact" : "New Contact"} onClose={() => setOpen(false)}>
          <form onSubmit={submit} className="space-y-4" data-testid="contact-form">
            <Grid2>
              <Field label="Contact Name *">
                <Input data-testid="contact-name" required value={form.contact_name} onChange={(v) => setForm({ ...form, contact_name: v })} />
              </Field>
              <Field label="Company Name">
                <Input data-testid="contact-company" value={form.company_name} onChange={(v) => setForm({ ...form, company_name: v })} />
              </Field>
              <Field label="Contact Type">
                <Select data-testid="contact-type" value={form.contact_type} onChange={(v) => setForm({ ...form, contact_type: v })} options={CONTACT_TYPES} />
              </Field>
              <Field label="Email">
                <Input data-testid="contact-email" type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
              </Field>
              <Field label="Website / URL">
                <Input data-testid="contact-website" value={form.website} onChange={(v) => setForm({ ...form, website: v })} placeholder="https://company.com" />
              </Field>
              <Field label="Work Phone">
                <Input data-testid="contact-work-phone" value={form.work_phone} onChange={(v) => setForm({ ...form, work_phone: v })} />
              </Field>
              <Field label="Mobile Phone">
                <Input data-testid="contact-mobile-phone" value={form.mobile_phone} onChange={(v) => setForm({ ...form, mobile_phone: v })} />
              </Field>
              <Field label="Fax">
                <Input data-testid="contact-fax" value={form.fax} onChange={(v) => setForm({ ...form, fax: v })} />
              </Field>
              <Field label="Other / Primary Phone">
                <Input data-testid="contact-phone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
              </Field>
            </Grid2>
            <Field label="Address Line 1">
              <Input data-testid="contact-address" value={form.address} onChange={(v) => setForm({ ...form, address: v })} />
            </Field>
            <Field label="Address Line 2">
              <Input data-testid="contact-address2" value={form.address_line2} onChange={(v) => setForm({ ...form, address_line2: v })} />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-6 gap-4">
              <div className="sm:col-span-3">
                <Field label="City">
                  <Input data-testid="contact-city" value={form.city} onChange={(v) => setForm({ ...form, city: v })} />
                </Field>
              </div>
              <div className="sm:col-span-1">
                <Field label="State">
                  <Select data-testid="contact-state" value={form.state || DEFAULT_STATE} onChange={(v) => setForm({ ...form, state: v })} options={US_STATES} />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="ZIP">
                  <Input data-testid="contact-zip" value={form.zip_code} onChange={(v) => setForm({ ...form, zip_code: v })} />
                </Field>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                data-testid="contact-billing-same"
                checked={form.billing_same_as_address}
                onChange={(e) => setForm({ ...form, billing_same_as_address: e.target.checked })}
                className="w-4 h-4 accent-blue-700"
              />
              <span className="text-xs uppercase tracking-wider font-bold text-zinc-700">Billing address same as address</span>
            </label>
            {!form.billing_same_as_address && (
              <div className="space-y-4 pl-3 border-l-2 border-blue-700">
                <Field label="Billing Address Line 1">
                  <Input data-testid="contact-billing-address" value={form.billing_address} onChange={(v) => setForm({ ...form, billing_address: v })} />
                </Field>
                <Field label="Billing Address Line 2">
                  <Input data-testid="contact-billing-address2" value={form.billing_address_line2} onChange={(v) => setForm({ ...form, billing_address_line2: v })} />
                </Field>
                <div className="grid grid-cols-1 sm:grid-cols-6 gap-4">
                  <div className="sm:col-span-3">
                    <Field label="Billing City">
                      <Input data-testid="contact-billing-city" value={form.billing_city} onChange={(v) => setForm({ ...form, billing_city: v })} />
                    </Field>
                  </div>
                  <div className="sm:col-span-1">
                    <Field label="State">
                      <Select data-testid="contact-billing-state" value={form.billing_state || DEFAULT_STATE} onChange={(v) => setForm({ ...form, billing_state: v })} options={US_STATES} />
                    </Field>
                  </div>
                  <div className="sm:col-span-2">
                    <Field label="ZIP">
                      <Input data-testid="contact-billing-zip" value={form.billing_zip} onChange={(v) => setForm({ ...form, billing_zip: v })} />
                    </Field>
                  </div>
                </div>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-4 border-t border-zinc-200">
              <button type="button" onClick={() => setOpen(false)} className="px-4 h-10 text-xs font-bold uppercase tracking-wider border border-zinc-300 rounded-sm hover:bg-zinc-50">Cancel</button>
              <button type="submit" disabled={loading} data-testid="contact-save" className="px-4 h-10 text-xs font-bold uppercase tracking-wider bg-blue-700 text-white hover:bg-blue-800 rounded-sm disabled:opacity-50">{loading ? "Saving..." : "Save"}</button>
            </div>
          </form>
        </Modal>
      )}

      <ConfirmDialog
        open={!!confirmTarget}
        title="Delete Contact?"
        message={`This will permanently delete ${confirmTarget?.contact_name || "this contact"}${confirmTarget?.company_name ? " · " + confirmTarget.company_name : ""}. This action cannot be undone.`}
        onConfirm={remove}
        onClose={() => setConfirmTarget(null)}
      />
    </div>
  );
}

export const Th = ({ children }) => (
  <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-wider text-zinc-950">{children}</th>
);

export const Modal = ({ title, onClose, children, wide }) => (
  <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose} data-testid="modal-overlay">
    <div className={`bg-white rounded-sm shadow-xl w-full ${wide ? "max-w-4xl" : "max-w-2xl"} max-h-[90vh] overflow-y-auto`} onClick={(e) => e.stopPropagation()}>
      <div className="px-6 py-4 border-b border-zinc-200 flex items-center justify-between">
        <h2 className="font-heading text-xl font-bold tracking-tight">{title}</h2>
        <button onClick={onClose} className="p-1.5 hover:bg-zinc-100 rounded-sm" data-testid="modal-close"><X className="w-4 h-4" /></button>
      </div>
      <div className="p-6">{children}</div>
    </div>
  </div>
);

export const Field = ({ label, children }) => (
  <div>
    <label className="block text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-700 mb-2">{label}</label>
    {children}
  </div>
);

export const Grid2 = ({ children }) => <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{children}</div>;

export const Input = ({ value, onChange, type = "text", ...props }) => (
  <input
    type={type}
    value={value ?? ""}
    onChange={(e) => onChange(type === "number" ? parseFloat(e.target.value || 0) : e.target.value)}
    className="w-full h-10 px-3 border border-zinc-300 bg-white rounded-sm focus:outline-none focus:ring-2 focus:ring-blue-700 text-sm"
    {...props}
  />
);

export const Select = ({ value, onChange, options, ...props }) => (
  <select
    value={value ?? ""}
    onChange={(e) => onChange(e.target.value)}
    className="w-full h-10 px-3 border border-zinc-300 bg-white rounded-sm focus:outline-none focus:ring-2 focus:ring-blue-700 text-sm"
    {...props}
  >
    {options.map((o) => (
      <option key={o.value ?? o} value={o.value ?? o}>
        {o.label ?? o}
      </option>
    ))}
  </select>
);
