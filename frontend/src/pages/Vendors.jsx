import React, { useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { Plus, Pencil, Trash2, Truck, HardHat, FolderOpen } from "lucide-react";
import { toast } from "sonner";
import { Modal, Field, Grid2, Input, Select, Th } from "@/pages/Contacts";
import { ExportButtons, ImportButton } from "@/components/ExportImport";
import Documents from "@/components/Documents";
import { US_STATES, DEFAULT_STATE } from "@/constants/states";
import ConfirmDialog from "@/components/ConfirmDialog";

export default function Vendors({ kind = "Vendor" }) {
  const isSub = kind === "Subcontractor";
  const empty = { name: "", kind, category: isSub ? "Subcontractor" : "Material Supplier", contact_name: "", contact_title: "", phone: "", work_phone: "", mobile_phone: "", fax: "", email: "", tin_ein: "", address: "", address_line2: "", city: "", state: DEFAULT_STATE, zip_code: "", notes: "" };

  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);
  const [loading, setLoading] = useState(false);
  const [docsFor, setDocsFor] = useState(null);
  const [confirmTarget, setConfirmTarget] = useState(null);

  const load = () => api.get(`/vendors?kind=${encodeURIComponent(kind)}`).then((r) => setItems(r.data));
  useEffect(() => {
    setForm(empty);
    load();
    api.get("/options").then((r) => setCategories(r.data.vendor_categories));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  const openCreate = () => { setEditing(null); setForm(empty); setOpen(true); };
  const openEdit = (v) => { setEditing(v); setForm({ ...empty, ...v }); setOpen(true); };

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const payload = { ...form, kind };
      if (editing) {
        await api.put(`/vendors/${editing.id}`, payload);
        toast.success(`${kind} updated`);
      } else {
        await api.post(`/vendors`, payload);
        toast.success(`${kind} created`);
      }
      setOpen(false);
      load();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setLoading(false);
    }
  };

  const remove = (v) => setConfirmTarget(v);

  const removeConfirmed = async () => {
    if (!confirmTarget) return;
    try {
      await api.delete(`/vendors/${confirmTarget.id}`);
      toast.success(`${kind} deleted`);
      load();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setConfirmTarget(null);
    }
  };

  const Icon = isSub ? HardHat : Truck;
  const heading = isSub ? "Subcontractors" : "Vendors";
  const subtitle = isSub ? "Trade Partners & Crews" : "Material Suppliers";
  const eyebrow = isSub ? "Subcontractors" : "Vendors";

  return (
    <div className="p-6 sm:p-8 animate-in fade-in duration-500" data-testid={`${kind.toLowerCase()}s-page`}>
      <div className="flex items-end justify-between mb-8 pb-6 border-b border-zinc-200 gap-4 flex-wrap">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-700 mb-2">{eyebrow}</div>
          <h1 className="font-heading text-3xl sm:text-4xl font-black tracking-tight">{subtitle}</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <ExportButtons category={isSub ? "subcontractors" : "vendors"} />
          <ImportButton category={isSub ? "subcontractors" : "vendors"} onImported={load} />
          <button
            data-testid={`new-${kind.toLowerCase()}-button`}
            onClick={openCreate}
            className="inline-flex items-center gap-2 bg-blue-700 text-white px-4 h-10 text-xs font-bold uppercase tracking-wider hover:bg-blue-800 rounded-sm transition-colors"
          >
            <Plus className="w-4 h-4" /> New {kind}
          </button>
        </div>
      </div>

      <div className="bg-white border border-zinc-200 rounded-sm overflow-x-auto">
        {items.length === 0 ? (
          <div className="p-12 text-center text-sm text-zinc-500 flex flex-col items-center gap-3">
            <Icon className="w-8 h-8 text-zinc-300" />
            <div>No {heading.toLowerCase()} yet.</div>
          </div>
        ) : (
          <table className="w-full text-sm" data-testid={`${kind.toLowerCase()}s-table`}>
            <thead>
              <tr className="border-b-2 border-zinc-950 text-left">
                <Th>Name</Th><Th>Category</Th><Th>Contact</Th><Th>Phone</Th><Th>Email</Th><Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((v) => (
                <tr key={v.id} className="border-b border-zinc-100 hover:bg-zinc-50" data-testid={`${kind.toLowerCase()}-row-${v.id}`}>
                  <td className="px-6 py-3 font-bold text-zinc-950">{v.name}</td>
                  <td className="px-6 py-3 text-zinc-700 text-xs uppercase tracking-wider">{v.category}</td>
                  <td className="px-6 py-3 text-zinc-700 text-xs">
                    {v.contact_name || "—"}
                    {v.contact_title && <div className="text-[10px] text-zinc-500">{v.contact_title}</div>}
                  </td>
                  <td className="px-6 py-3 text-zinc-600 font-mono text-xs">{v.mobile_phone || v.work_phone || v.phone}</td>
                  <td className="px-6 py-3 text-zinc-600 text-xs">{v.email}</td>
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-1">
                      <button data-testid={`docs-${kind.toLowerCase()}-${v.id}`} onClick={() => setDocsFor(v)} title="Documents" className="p-1.5 hover:bg-zinc-200 rounded-sm"><FolderOpen className="w-3.5 h-3.5" /></button>
                      <button data-testid={`edit-${kind.toLowerCase()}-${v.id}`} onClick={() => openEdit(v)} className="p-1.5 hover:bg-zinc-200 rounded-sm"><Pencil className="w-3.5 h-3.5" /></button>
                      <button data-testid={`delete-${kind.toLowerCase()}-${v.id}`} onClick={() => remove(v)} className="p-1.5 hover:bg-red-100 text-red-700 rounded-sm"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {open && (
        <Modal title={editing ? `Edit ${kind}` : `New ${kind}`} onClose={() => setOpen(false)}>
          <form onSubmit={submit} className="space-y-4" data-testid={`${kind.toLowerCase()}-form`}>
            <Grid2>
              <Field label="Name *">
                <Input data-testid={`${kind.toLowerCase()}-name`} required value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
              </Field>
              <Field label="Category">
                <Select data-testid={`${kind.toLowerCase()}-category`} value={form.category} onChange={(v) => setForm({ ...form, category: v })} options={categories.length ? categories : ["Other"]} />
              </Field>
              <Field label="Contact Name">
                <Input data-testid={`${kind.toLowerCase()}-contact-name`} value={form.contact_name} onChange={(v) => setForm({ ...form, contact_name: v })} placeholder="Primary contact person" />
              </Field>
              <Field label="Contact Title">
                <Input data-testid={`${kind.toLowerCase()}-contact-title`} value={form.contact_title} onChange={(v) => setForm({ ...form, contact_title: v })} placeholder="e.g. Sales Rep, Account Mgr" />
              </Field>
              <Field label="Work Phone">
                <Input data-testid={`${kind.toLowerCase()}-work-phone`} value={form.work_phone} onChange={(v) => setForm({ ...form, work_phone: v })} />
              </Field>
              <Field label="Mobile Phone">
                <Input data-testid={`${kind.toLowerCase()}-mobile-phone`} value={form.mobile_phone} onChange={(v) => setForm({ ...form, mobile_phone: v })} />
              </Field>
              <Field label="Fax">
                <Input data-testid={`${kind.toLowerCase()}-fax`} value={form.fax} onChange={(v) => setForm({ ...form, fax: v })} />
              </Field>
              <Field label="Other / Primary Phone">
                <Input data-testid={`${kind.toLowerCase()}-phone`} value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
              </Field>
              <Field label="Email">
                <Input data-testid={`${kind.toLowerCase()}-email`} type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
              </Field>
              <Field label="TIN / EIN">
                <Input data-testid={`${kind.toLowerCase()}-tin`} value={form.tin_ein} onChange={(v) => setForm({ ...form, tin_ein: v })} placeholder="XX-XXXXXXX" />
              </Field>
            </Grid2>
            <Field label="Address Line 1">
              <Input data-testid={`${kind.toLowerCase()}-address`} value={form.address} onChange={(v) => setForm({ ...form, address: v })} />
            </Field>
            <Field label="Address Line 2">
              <Input data-testid={`${kind.toLowerCase()}-address2`} value={form.address_line2} onChange={(v) => setForm({ ...form, address_line2: v })} />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-6 gap-4">
              <div className="sm:col-span-3">
                <Field label="City">
                  <Input data-testid={`${kind.toLowerCase()}-city`} value={form.city} onChange={(v) => setForm({ ...form, city: v })} />
                </Field>
              </div>
              <div className="sm:col-span-1">
                <Field label="State">
                  <Select data-testid={`${kind.toLowerCase()}-state`} value={form.state || DEFAULT_STATE} onChange={(v) => setForm({ ...form, state: v })} options={US_STATES} />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="ZIP">
                  <Input data-testid={`${kind.toLowerCase()}-zip`} value={form.zip_code} onChange={(v) => setForm({ ...form, zip_code: v })} />
                </Field>
              </div>
            </div>
            <Field label="Notes">
              <textarea
                data-testid={`${kind.toLowerCase()}-notes`}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={3}
                className="w-full px-3 py-2 border border-zinc-300 bg-white rounded-sm focus:outline-none focus:ring-2 focus:ring-blue-700 text-sm"
              />
            </Field>
            <div className="flex justify-end gap-2 pt-4 border-t border-zinc-200">
              <button type="button" onClick={() => setOpen(false)} className="px-4 h-10 text-xs font-bold uppercase tracking-wider border border-zinc-300 rounded-sm hover:bg-zinc-50">Cancel</button>
              <button type="submit" disabled={loading} data-testid={`${kind.toLowerCase()}-save`} className="px-4 h-10 text-xs font-bold uppercase tracking-wider bg-blue-700 text-white hover:bg-blue-800 rounded-sm disabled:opacity-50">{loading ? "Saving..." : "Save"}</button>
            </div>
          </form>
        </Modal>
      )}

      {docsFor && (
        <Modal wide title={`Documents — ${docsFor.name}`} onClose={() => setDocsFor(null)}>
          <Documents parentType={isSub ? "subcontractor" : "vendor"} parentId={docsFor.id} title="Files" />
        </Modal>
      )}
    </div>
  );
}
