import React, { useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { Plus, Pencil, Trash2, Truck } from "lucide-react";
import { toast } from "sonner";
import { Modal, Field, Grid2, Input, Select, Th } from "@/pages/Contacts";

const empty = { name: "", category: "Subcontractor", phone: "", email: "", notes: "" };

export default function Vendors() {
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);
  const [loading, setLoading] = useState(false);

  const load = () => api.get("/vendors").then((r) => setItems(r.data));
  useEffect(() => {
    load();
    api.get("/options").then((r) => setCategories(r.data.vendor_categories));
  }, []);

  const openCreate = () => { setEditing(null); setForm(empty); setOpen(true); };
  const openEdit = (v) => { setEditing(v); setForm({ ...empty, ...v }); setOpen(true); };

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (editing) {
        await api.put(`/vendors/${editing.id}`, form);
        toast.success("Vendor updated");
      } else {
        await api.post(`/vendors`, form);
        toast.success("Vendor created");
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
    if (!window.confirm("Delete this vendor?")) return;
    await api.delete(`/vendors/${id}`);
    toast.success("Vendor deleted");
    load();
  };

  return (
    <div className="p-6 sm:p-8 animate-in fade-in duration-500" data-testid="vendors-page">
      <div className="flex items-end justify-between mb-8 pb-6 border-b border-zinc-200">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-700 mb-2">Vendors</div>
          <h1 className="font-heading text-3xl sm:text-4xl font-black tracking-tight">Suppliers &amp; Subs</h1>
        </div>
        <button
          data-testid="new-vendor-button"
          onClick={openCreate}
          className="inline-flex items-center gap-2 bg-blue-700 text-white px-4 h-10 text-xs font-bold uppercase tracking-wider hover:bg-blue-800 rounded-sm transition-colors"
        >
          <Plus className="w-4 h-4" /> New Vendor
        </button>
      </div>

      <div className="bg-white border border-zinc-200 rounded-sm overflow-x-auto">
        {items.length === 0 ? (
          <div className="p-12 text-center text-sm text-zinc-500 flex flex-col items-center gap-3">
            <Truck className="w-8 h-8 text-zinc-300" />
            <div>No vendors yet. Add your first supplier or subcontractor.</div>
          </div>
        ) : (
          <table className="w-full text-sm" data-testid="vendors-table">
            <thead>
              <tr className="border-b-2 border-zinc-950 text-left">
                <Th>Name</Th><Th>Category</Th><Th>Phone</Th><Th>Email</Th><Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((v) => (
                <tr key={v.id} className="border-b border-zinc-100 hover:bg-zinc-50" data-testid={`vendor-row-${v.id}`}>
                  <td className="px-6 py-3 font-bold text-zinc-950">{v.name}</td>
                  <td className="px-6 py-3 text-zinc-700 text-xs uppercase tracking-wider">{v.category}</td>
                  <td className="px-6 py-3 text-zinc-600 font-mono text-xs">{v.phone}</td>
                  <td className="px-6 py-3 text-zinc-600 text-xs">{v.email}</td>
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-1">
                      <button data-testid={`edit-vendor-${v.id}`} onClick={() => openEdit(v)} className="p-1.5 hover:bg-zinc-200 rounded-sm"><Pencil className="w-3.5 h-3.5" /></button>
                      <button data-testid={`delete-vendor-${v.id}`} onClick={() => remove(v.id)} className="p-1.5 hover:bg-red-100 text-red-700 rounded-sm"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {open && (
        <Modal title={editing ? "Edit Vendor" : "New Vendor"} onClose={() => setOpen(false)}>
          <form onSubmit={submit} className="space-y-4" data-testid="vendor-form">
            <Grid2>
              <Field label="Name *">
                <Input data-testid="vendor-name" required value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
              </Field>
              <Field label="Category">
                <Select data-testid="vendor-category" value={form.category} onChange={(v) => setForm({ ...form, category: v })} options={categories.length ? categories : ["Other"]} />
              </Field>
              <Field label="Phone">
                <Input data-testid="vendor-phone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
              </Field>
              <Field label="Email">
                <Input data-testid="vendor-email" type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
              </Field>
            </Grid2>
            <Field label="Notes">
              <textarea
                data-testid="vendor-notes"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={3}
                className="w-full px-3 py-2 border border-zinc-300 bg-white rounded-sm focus:outline-none focus:ring-2 focus:ring-blue-700 text-sm"
              />
            </Field>
            <div className="flex justify-end gap-2 pt-4 border-t border-zinc-200">
              <button type="button" onClick={() => setOpen(false)} className="px-4 h-10 text-xs font-bold uppercase tracking-wider border border-zinc-300 rounded-sm hover:bg-zinc-50">Cancel</button>
              <button type="submit" disabled={loading} data-testid="vendor-save" className="px-4 h-10 text-xs font-bold uppercase tracking-wider bg-blue-700 text-white hover:bg-blue-800 rounded-sm disabled:opacity-50">{loading ? "Saving..." : "Save"}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
