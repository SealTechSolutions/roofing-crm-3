import React, { useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { Plus, Pencil, Trash2, KeyRound, Copy, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { Modal, Field, Grid2, Input, Select, Th } from "@/pages/Contacts";
import ConfirmDialog from "@/components/ConfirmDialog";

const ROLES = ["admin", "manager", "sales"];
const ROLE_LABELS = { admin: "Admin", manager: "Manager", sales: "Sales / Estimator" };

const empty = { name: "", email: "", role: "sales", phone: "", title: "" };

export default function Users() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);
  const [loading, setLoading] = useState(false);
  const [credential, setCredential] = useState(null);
  const [confirmTarget, setConfirmTarget] = useState(null);

  const load = () => api.get("/users").then((r) => setItems(r.data));
  useEffect(() => { load(); }, []);

  const openCreate = () => { setEditing(null); setForm(empty); setOpen(true); };
  const openEdit = (u) => { setEditing(u); setForm({ name: u.name || "", email: u.email, role: u.role, phone: u.phone || "", title: u.title || "" }); setOpen(true); };

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (editing) {
        const patch = { name: form.name, role: form.role, phone: form.phone, title: form.title };
        await api.put(`/users/${editing.id}`, patch);
        toast.success("User updated");
        setOpen(false);
      } else {
        const r = await api.post(`/users`, form);
        toast.success("User created");
        setOpen(false);
        setCredential({ user: r.data.user, password: r.data.generated_password });
      }
      load();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setLoading(false);
    }
  };

  const regen = async (u) => {
    try {
      const r = await api.post(`/users/${u.id}/regenerate-password`);
      setCredential({ user: u, password: r.data.generated_password });
      toast.success("New password generated");
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    }
  };

  const removeConfirmed = async () => {
    if (!confirmTarget) return;
    try {
      await api.delete(`/users/${confirmTarget.id}`);
      toast.success("User deleted");
      load();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setConfirmTarget(null);
    }
  };

  const copy = (text) => { navigator.clipboard.writeText(text); toast.success("Copied"); };

  return (
    <div className="p-6 sm:p-8 animate-in fade-in duration-500" data-testid="users-page">
      <div className="flex items-end justify-between mb-8 pb-6 border-b border-zinc-200 gap-4 flex-wrap">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-700 mb-2">Team</div>
          <h1 className="font-heading text-3xl sm:text-4xl font-black tracking-tight">Users &amp; Roles</h1>
        </div>
        <button data-testid="new-user-button" onClick={openCreate} className="inline-flex items-center gap-2 bg-blue-700 text-white px-4 h-10 text-xs font-bold uppercase tracking-wider hover:bg-blue-800 rounded-sm transition-colors">
          <Plus className="w-4 h-4" /> New User
        </button>
      </div>

      <div className="bg-white border border-zinc-200 rounded-sm overflow-x-auto">
        <table className="w-full text-sm" data-testid="users-table">
          <thead>
            <tr className="border-b-2 border-zinc-950 text-left">
              <Th>Name</Th><Th>Email</Th><Th>Role</Th><Th>Job Title</Th><Th>Phone</Th><Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {items.map((u) => (
              <tr key={u.id} className="border-b border-zinc-100 hover:bg-zinc-50" data-testid={`user-row-${u.id}`}>
                <td className="px-6 py-3 font-bold text-zinc-950">{u.name}</td>
                <td className="px-6 py-3 text-zinc-700">{u.email}</td>
                <td className="px-6 py-3">
                  <span className={`inline-block px-2 py-1 text-[10px] font-bold uppercase tracking-wider rounded-sm ${u.role === "admin" ? "bg-zinc-950 text-white" : u.role === "manager" ? "bg-blue-100 text-blue-800" : "bg-zinc-200 text-zinc-800"}`}>
                    {ROLE_LABELS[u.role] || u.role}
                  </span>
                </td>
                <td className="px-6 py-3 text-zinc-600 text-xs">{u.title || "—"}</td>
                <td className="px-6 py-3 text-zinc-600 font-mono text-xs">{u.phone || "—"}</td>
                <td className="px-6 py-3">
                  <div className="flex items-center gap-1">
                    <button data-testid={`regen-${u.id}`} onClick={() => regen(u)} title="Regenerate password" className="p-1.5 hover:bg-zinc-200 rounded-sm"><KeyRound className="w-3.5 h-3.5" /></button>
                    <button data-testid={`edit-user-${u.id}`} onClick={() => openEdit(u)} title="Edit" className="p-1.5 hover:bg-zinc-200 rounded-sm"><Pencil className="w-3.5 h-3.5" /></button>
                    <button data-testid={`delete-user-${u.id}`} onClick={() => setConfirmTarget(u)} title="Delete" className="p-1.5 hover:bg-red-100 text-red-700 rounded-sm"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open && (
        <Modal title={editing ? "Edit User" : "New User"} onClose={() => setOpen(false)}>
          <form onSubmit={submit} className="space-y-4" data-testid="user-form">
            <Grid2>
              <Field label="Name *">
                <Input data-testid="user-name" required value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
              </Field>
              <Field label="Email *">
                <Input data-testid="user-email" type="email" required disabled={!!editing} value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
              </Field>
              <Field label="Role">
                <Select data-testid="user-role" value={form.role} onChange={(v) => setForm({ ...form, role: v })} options={ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))} />
              </Field>
              <Field label="Job Title" hint="e.g., General Manager, Lead Estimator. Appears on Purchase Orders.">
                <Input data-testid="user-title" value={form.title} onChange={(v) => setForm({ ...form, title: v })} placeholder="e.g., General Manager" />
              </Field>
              <Field label="Phone">
                <Input data-testid="user-phone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
              </Field>
            </Grid2>
            {!editing && (
              <div className="bg-blue-50 border border-blue-200 rounded-sm p-3 text-xs text-blue-900">
                A secure 12-character password will be generated and shown to you once after saving. Make sure to copy it before closing.
              </div>
            )}
            <div className="flex justify-end gap-2 pt-4 border-t border-zinc-200">
              <button type="button" onClick={() => setOpen(false)} className="px-4 h-10 text-xs font-bold uppercase tracking-wider border border-zinc-300 rounded-sm hover:bg-zinc-50">Cancel</button>
              <button type="submit" disabled={loading} data-testid="user-save" className="px-4 h-10 text-xs font-bold uppercase tracking-wider bg-blue-700 text-white hover:bg-blue-800 rounded-sm disabled:opacity-50">{loading ? "Saving..." : (editing ? "Save" : "Create User")}</button>
            </div>
          </form>
        </Modal>
      )}

      {credential && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4" data-testid="credential-modal">
          <div className="bg-white rounded-sm shadow-2xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-zinc-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-blue-700" />
                <h2 className="font-heading text-lg font-bold tracking-tight">Password Generated</h2>
              </div>
              <button onClick={() => setCredential(null)} className="p-1.5 hover:bg-zinc-100 rounded-sm"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="text-sm text-zinc-700">
                Share these credentials securely with <b>{credential.user.name}</b>. <b>This password will not be shown again.</b>
              </div>
              <div className="bg-zinc-50 border border-zinc-200 rounded-sm p-4 space-y-3">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Email</div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-mono text-sm break-all">{credential.user.email}</div>
                    <button onClick={() => copy(credential.user.email)} className="p-1 hover:bg-zinc-200 rounded-sm"><Copy className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Temporary Password</div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-mono text-sm font-bold text-blue-700" data-testid="generated-password">{credential.password}</div>
                    <button onClick={() => copy(credential.password)} className="p-1 hover:bg-zinc-200 rounded-sm" data-testid="copy-password"><Copy className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
              </div>
              <button onClick={() => setCredential(null)} data-testid="credential-close" className="w-full h-10 bg-blue-700 text-white text-xs font-bold uppercase tracking-wider rounded-sm hover:bg-blue-800">
                I've Saved It — Close
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!confirmTarget}
        title="Delete User?"
        message={`Permanently delete ${confirmTarget?.name}? They will immediately lose access. This cannot be undone.`}
        onConfirm={removeConfirmed}
        onClose={() => setConfirmTarget(null)}
      />
    </div>
  );
}
