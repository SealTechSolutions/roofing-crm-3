import React, { useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { Plus, Pencil, Trash2, Truck, HardHat } from "lucide-react";
import { toast } from "sonner";
import { Modal, Field, Grid2, Input, Select, Th } from "@/pages/Contacts";

export default function Vendors({ kind = "Vendor" }) {
  const isSub = kind === "Subcontractor";
  const empty = { name: "", kind, category: isSub ? "Subcontractor" : "Material Supplier", phone: "", email: "", tin_ein: "", address: "", address_line2: "", city: "", state: "", zip_code: "", notes: "" };

  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);
  const [loading, setLoading] = useState(false);

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

  const remove = async (id) => {
    if (!window.confirm(`Delete this ${kind.toLowerCase()}?`)) return;
    await api.delete(`/vendors/${id}`);
    toast.success(`${kind} deleted`);
    load();
  };

  const Icon = isSub ? HardHat : Truck;
  const heading = isSub ? "Subcontractors" : "Vendors";
  const subtitle = isSub ? "Trade Partners & Crews" : "Material Suppliers";
  const eyebrow = isSub ? "Subcontractors" : "Vendors";

  return (
    <div className="p-6 sm:p-8 animate-in fade-in duration-500" data-testid={`${kind.toLowerCase()}s-page`}>
      <div className="flex items-end justify-between mb-8 pb-6 border-b border-zinc-200">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-700 mb-2">{eyebrow}</div>
          <h1 className="font-heading text-3xl sm:text-4xl font-black tracking-tight">{subtitle}</h1>
        </div>
        <button
          data-testid={`new-${kind.toLowerCase()}-button`}
          onClick={openCreate}
          className="inline-flex items-center gap-2 bg-blue-700 text-white px-4 h-10 text-xs font-bold uppercase tracking-wider hover:bg-blue-800 rounded-sm transition-colors"
        >
          <Plus className="w-4 h-4" /> New {kind}
        </button>
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
                <Th>Name</Th><Th>Category</Th><Th>Phone</Th><Th>Email</Th><Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((v) => (
                <tr key={v.id} className="border-b border-zinc-100 hover:bg-zinc-50" data-testid={`${kind.toLowerCase()}-row-${v.id}`}>
                  <td className="px-6 py-3 font-bold text-zinc-950">{v.name}</td>
                  <td className="px-6 py-3 text-zinc-700 text-xs uppercase tracking-wider">{v.category}</td>
                  <td className="px-6 py-3 text-zinc-600 font-mono text-xs">{v.phone}</td>
                  <td className="px-6 py-3 text-zinc-600 text-xs">{v.email}</td>
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-1">
                      <button data-testid={`edit-${kind.toLowerCase()}-${v.id}`} onClick={() => openEdit(v)} className="p-1.5 hover:bg-zinc-200 rounded-sm"><Pencil className="w-3.5 h-3.5" /></button>
                      <button data-testid={`delete-${kind.toLowerCase()}-${v.id}`} onClick={() => remove(v.id)} className="p-1.5 hover:bg-red-100 text-red-700 rounded-sm"><Trash2 className="w-3.5 h-3.5" /></button>
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
              <Field label="Phone">
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
                  <Input data-testid={`${kind.toLowerCase()}-state`} value={form.state} onChange={(v) => setForm({ ...form, state: v })} maxLength={2} />
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
    </div>
  );
}
