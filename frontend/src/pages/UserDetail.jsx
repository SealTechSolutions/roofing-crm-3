import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { toast } from "sonner";
import {
  ArrowLeft, StickyNote, GraduationCap, Wrench, ShieldAlert, Briefcase, Pin, Trash2,
  Plus, Upload, FileText, Calendar, Pencil, X, Check, Sparkles,
} from "lucide-react";
import { formatPhoneDisplay } from "@/lib/format";

const TABS = [
  { key: "notes",       label: "Notes",            icon: StickyNote,    adminOnly: true },
  { key: "certs",       label: "Certifications",   icon: GraduationCap, adminOnly: false },
  { key: "equipment",   label: "Equipment",        icon: Wrench,        adminOnly: true },
  { key: "skills",      label: "Skills",           icon: Sparkles,      adminOnly: false },
  { key: "emergency",   label: "Emergency",        icon: ShieldAlert,   adminOnly: false },
  { key: "employment",  label: "Employment",       icon: Briefcase,     adminOnly: true },
];

const ROLE_BADGES = {
  admin:   "bg-zinc-950 text-white",
  manager: "bg-blue-100 text-blue-800",
  sales:   "bg-zinc-200 text-zinc-800",
};

export default function UserDetail() {
  const { id } = useParams();
  const [me, setMe] = useState(null);
  const [data, setData] = useState(null);
  const [activeTab, setActiveTab] = useState("notes");
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [meR, profileR] = await Promise.all([
        api.get("/auth/me"),
        api.get(`/users/${id}/profile`),
      ]);
      setMe(meR.data);
      setData(profileR.data);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { reload(); }, [reload]);

  const isAdmin = me?.role === "admin";
  const visibleTabs = useMemo(() => TABS.filter((t) => !t.adminOnly || isAdmin), [isAdmin]);

  // If a non-admin's first visible tab isn't notes, switch
  useEffect(() => {
    if (visibleTabs.length && !visibleTabs.find((t) => t.key === activeTab)) {
      setActiveTab(visibleTabs[0].key);
    }
  }, [visibleTabs, activeTab]);

  if (loading || !data) {
    return <div className="p-8 text-zinc-500 text-sm">Loading…</div>;
  }

  const u = data.user;

  return (
    <div className="p-6 sm:p-8 animate-in fade-in duration-500" data-testid="user-detail-page">
      {/* Back link */}
      <Link to="/users" className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wider text-blue-700 font-bold mb-4 hover:underline" data-testid="back-to-users">
        <ArrowLeft className="w-3.5 h-3.5" /> All Users
      </Link>

      {/* Header card */}
      <div className="bg-white border border-zinc-200 rounded-sm p-6 mb-6 flex items-start gap-5 flex-wrap">
        <div className="w-16 h-16 rounded-full bg-blue-700 text-white font-heading text-2xl font-bold flex items-center justify-center flex-shrink-0">
          {(u.name || u.email || "?").slice(0, 1).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-700 mb-1">Team Member</div>
          <h1 className="font-heading text-3xl font-black tracking-tight" data-testid="user-detail-name">{u.name || u.email}</h1>
          <div className="flex items-center gap-3 mt-2 flex-wrap text-xs text-zinc-700">
            <span className={`inline-block px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-sm ${ROLE_BADGES[u.role] || "bg-zinc-200 text-zinc-800"}`}>{u.role}</span>
            {u.title && <span className="text-zinc-600">{u.title}</span>}
            <a href={`mailto:${u.email}`} className="hover:underline">{u.email}</a>
            {u.phone && <span className="font-mono text-zinc-500">{formatPhoneDisplay(u.phone)}</span>}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 text-[11px] text-zinc-500">
          <span><b className="text-zinc-700">{data.certifications.length}</b> certs</span>
          <span><b className="text-zinc-700">{data.equipment.length}</b> equipment</span>
          {isAdmin && <span><b className="text-zinc-700">{data.notes.length}</b> notes</span>}
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border border-zinc-200 rounded-sm">
        <div className="border-b border-zinc-200 flex items-center gap-1 px-3 overflow-x-auto" role="tablist">
          {visibleTabs.map((t) => {
            const Icon = t.icon;
            const active = activeTab === t.key;
            return (
              <button
                key={t.key}
                role="tab"
                aria-selected={active}
                onClick={() => setActiveTab(t.key)}
                data-testid={`tab-${t.key}`}
                className={`inline-flex items-center gap-2 px-4 py-3 text-xs font-bold uppercase tracking-wider transition-colors border-b-2 -mb-[1px] ${active ? "border-blue-700 text-blue-700" : "border-transparent text-zinc-500 hover:text-zinc-900"}`}
              >
                <Icon className="w-3.5 h-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>

        <div className="p-6">
          {activeTab === "notes"      && isAdmin && <NotesTab userId={id} data={data} reload={reload} me={me} />}
          {activeTab === "certs"      && <CertsTab userId={id} data={data} reload={reload} isAdmin={isAdmin} />}
          {activeTab === "equipment"  && isAdmin && <EquipmentTab userId={id} data={data} reload={reload} />}
          {activeTab === "skills"     && <SkillsTab userId={id} data={data} reload={reload} isAdmin={isAdmin} />}
          {activeTab === "emergency"  && <EmergencyTab userId={id} data={data} reload={reload} canEdit={isAdmin || me?.id === id} />}
          {activeTab === "employment" && isAdmin && <EmploymentTab userId={id} data={data} reload={reload} />}
        </div>
      </div>
    </div>
  );
}

// ============================================================ NOTES TAB
function NotesTab({ userId, data, reload, me }) {
  const [draft, setDraft] = useState("");
  const [pinned, setPinned] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(null);

  const submit = async (e) => {
    e?.preventDefault?.();
    if (!draft.trim()) return;
    setSaving(true);
    try {
      if (editing) {
        await api.put(`/users/${userId}/notes/${editing.id}`, { body: draft.trim(), pinned });
      } else {
        await api.post(`/users/${userId}/notes`, { body: draft.trim(), pinned });
      }
      setDraft(""); setPinned(false); setEditing(null);
      reload();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setSaving(false);
    }
  };

  const togglePin = async (n) => {
    try {
      await api.put(`/users/${userId}/notes/${n.id}`, { body: n.body, pinned: !n.pinned });
      reload();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    }
  };

  const remove = async (n) => {
    if (!window.confirm("Delete this note?")) return;
    try {
      await api.delete(`/users/${userId}/notes/${n.id}`);
      reload();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    }
  };

  const startEdit = (n) => { setEditing(n); setDraft(n.body); setPinned(n.pinned); };
  const cancelEdit = () => { setEditing(null); setDraft(""); setPinned(false); };

  return (
    <div className="space-y-4">
      <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-500 -mb-1">Admin Notes</div>
      <form onSubmit={submit} className="border border-zinc-200 rounded-sm p-3" data-testid="notes-form">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={editing ? "Edit note…" : "Add a note about this user — promotions, time off, performance observations, etc."}
          rows={3}
          className="w-full border-0 focus:ring-0 focus:outline-none text-sm resize-none"
          data-testid="notes-input"
        />
        <div className="flex items-center justify-between pt-2 border-t border-zinc-100">
          <label className="inline-flex items-center gap-1.5 text-[11px] text-zinc-600 cursor-pointer">
            <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} data-testid="notes-pin-toggle" />
            <Pin className="w-3 h-3" /> Pin to top
          </label>
          <div className="flex gap-2">
            {editing && (
              <button type="button" onClick={cancelEdit} className="px-3 h-8 text-[11px] font-bold uppercase tracking-wider border border-zinc-300 rounded-sm hover:bg-zinc-50">Cancel</button>
            )}
            <button type="submit" disabled={saving || !draft.trim()} className="px-3 h-8 text-[11px] font-bold uppercase tracking-wider bg-blue-700 text-white rounded-sm hover:bg-blue-800 disabled:opacity-50" data-testid="notes-save">
              {editing ? "Save" : "Add Note"}
            </button>
          </div>
        </div>
      </form>

      {data.notes.length === 0 ? (
        <div className="text-sm text-zinc-500 italic text-center py-6 border border-dashed border-zinc-300 rounded-sm">No notes yet. Add one above.</div>
      ) : (
        <ul className="space-y-2">
          {data.notes.map((n) => (
            <li key={n.id} className={`border ${n.pinned ? "border-amber-400 bg-amber-50/50" : "border-zinc-200"} rounded-sm p-3`} data-testid={`note-${n.id}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1 flex items-center gap-2">
                    {n.pinned && <Pin className="w-3 h-3 text-amber-700 fill-amber-400" />}
                    <b className="text-zinc-700">{n.author_name}</b>
                    <span>·</span>
                    <span>{new Date(n.created_at).toLocaleString()}</span>
                  </div>
                  <div className="text-sm whitespace-pre-wrap">{n.body}</div>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => togglePin(n)} title={n.pinned ? "Unpin" : "Pin"} className="p-1 hover:bg-zinc-200 rounded-sm"><Pin className={`w-3.5 h-3.5 ${n.pinned ? "text-amber-700 fill-amber-400" : ""}`} /></button>
                  {n.author_id === me.id && (
                    <button onClick={() => startEdit(n)} title="Edit" className="p-1 hover:bg-zinc-200 rounded-sm"><Pencil className="w-3.5 h-3.5" /></button>
                  )}
                  <button onClick={() => remove(n)} title="Delete" className="p-1 hover:bg-red-100 text-red-700 rounded-sm" data-testid={`note-delete-${n.id}`}><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ============================================================ CERTS TAB
function CertsTab({ userId, data, reload, isAdmin }) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: "", issuer: "", cert_number: "", issue_date: "", expiration_date: "" });

  const today = new Date().toISOString().slice(0, 10);

  const reset = () => { setForm({ name: "", issuer: "", cert_number: "", issue_date: "", expiration_date: "" }); setEditing(null); setShowForm(false); };

  const submit = async (e) => {
    e?.preventDefault?.();
    if (!form.name.trim()) { toast.error("Cert name is required"); return; }
    try {
      if (editing) {
        await api.put(`/users/${userId}/certifications/${editing.id}`, form);
      } else {
        await api.post(`/users/${userId}/certifications`, form);
      }
      reset();
      reload();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    }
  };

  const startEdit = (c) => { setEditing(c); setForm({ name: c.name, issuer: c.issuer, cert_number: c.cert_number, issue_date: c.issue_date, expiration_date: c.expiration_date }); setShowForm(true); };

  const remove = async (c) => {
    if (!window.confirm(`Delete certification "${c.name}"?`)) return;
    try {
      await api.delete(`/users/${userId}/certifications/${c.id}`);
      reload();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    }
  };

  const uploadDoc = async (c, file) => {
    if (!file) return;
    const id = toast.loading(`Uploading ${file.name}…`);
    try {
      const fd = new FormData();
      fd.append("file", file);
      await api.post(`/users/${userId}/certifications/${c.id}/document`, fd);
      toast.success("Document attached", { id });
      reload();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message, { id });
    }
  };

  const expirationStatus = (iso) => {
    if (!iso) return { label: "No expiration", className: "bg-zinc-100 text-zinc-600" };
    const d = new Date(iso + "T00:00:00").getTime();
    const days = Math.ceil((d - Date.now()) / 86400000);
    if (days < 0)  return { label: `Expired ${-days}d ago`, className: "bg-rose-100 text-rose-800" };
    if (days <= 30) return { label: `${days}d left`, className: "bg-amber-100 text-amber-800" };
    if (days <= 60) return { label: `${days}d left`, className: "bg-blue-100 text-blue-800" };
    return { label: `${days}d`, className: "bg-emerald-100 text-emerald-800" };
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-500 mb-1">Certifications</div>
          <div className="text-[11px] text-zinc-500">Auto-reminders fire at 60, 30, and 7 days before each expiration.</div>
        </div>
        {isAdmin && !showForm && (
          <button onClick={() => setShowForm(true)} className="inline-flex items-center gap-1.5 h-9 px-3 bg-blue-700 text-white text-[11px] font-bold uppercase tracking-wider rounded-sm hover:bg-blue-800" data-testid="cert-add-btn">
            <Plus className="w-3.5 h-3.5" /> Add Certification
          </button>
        )}
      </div>

      {showForm && isAdmin && (
        <form onSubmit={submit} className="border border-blue-200 bg-blue-50/40 rounded-sm p-4 grid grid-cols-1 md:grid-cols-2 gap-3" data-testid="cert-form">
          <div className="md:col-span-2 flex items-center justify-between -mb-1">
            <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-blue-700">{editing ? "Edit Certification" : "New Certification"}</div>
            <button type="button" onClick={reset} className="text-zinc-500 hover:text-zinc-900"><X className="w-4 h-4" /></button>
          </div>
          <FieldStack label="Name" required>
            <input
              list="cert-suggestions"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g., OSHA 30"
              className="w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm"
              data-testid="cert-name"
            />
            <datalist id="cert-suggestions">
              {data.suggestions.certifications.map((s) => <option key={s} value={s} />)}
            </datalist>
          </FieldStack>
          <FieldStack label="Issuer"><input value={form.issuer} onChange={(e) => setForm({ ...form, issuer: e.target.value })} className="w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm" /></FieldStack>
          <FieldStack label="Certificate #"><input value={form.cert_number} onChange={(e) => setForm({ ...form, cert_number: e.target.value })} className="w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm" /></FieldStack>
          <FieldStack label="Issue date"><input type="date" value={form.issue_date} onChange={(e) => setForm({ ...form, issue_date: e.target.value })} className="w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm" /></FieldStack>
          <FieldStack label="Expiration date"><input type="date" value={form.expiration_date} onChange={(e) => setForm({ ...form, expiration_date: e.target.value })} className="w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm" data-testid="cert-exp" /></FieldStack>
          <div className="md:col-span-2 flex justify-end gap-2 pt-1">
            <button type="button" onClick={reset} className="h-9 px-3 text-[11px] font-bold uppercase tracking-wider border border-zinc-300 rounded-sm">Cancel</button>
            <button type="submit" className="h-9 px-3 text-[11px] font-bold uppercase tracking-wider bg-blue-700 text-white rounded-sm hover:bg-blue-800" data-testid="cert-save">{editing ? "Save" : "Add"}</button>
          </div>
        </form>
      )}

      {data.certifications.length === 0 ? (
        <div className="text-sm text-zinc-500 italic text-center py-6 border border-dashed border-zinc-300 rounded-sm">No certifications recorded.</div>
      ) : (
        <ul className="divide-y divide-zinc-100 border border-zinc-200 rounded-sm" data-testid="cert-list">
          {data.certifications.map((c) => {
            const status = expirationStatus(c.expiration_date);
            return (
              <li key={c.id} className="flex items-start justify-between gap-3 px-4 py-3 hover:bg-zinc-50" data-testid={`cert-row-${c.id}`}>
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <GraduationCap className="w-5 h-5 text-blue-700 mt-0.5 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm truncate">{c.name}</span>
                      <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${status.className}`}>{status.label}</span>
                    </div>
                    <div className="text-xs text-zinc-600 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                      {c.issuer && <span>{c.issuer}</span>}
                      {c.cert_number && <span className="font-mono">#{c.cert_number}</span>}
                      {c.issue_date && <span className="inline-flex items-center gap-1"><Calendar className="w-3 h-3" /> Issued {c.issue_date}</span>}
                      {c.expiration_date && <span className="inline-flex items-center gap-1"><Calendar className="w-3 h-3" /> Exp {c.expiration_date}</span>}
                    </div>
                    {c.document_name && (
                      <div className="text-[11px] text-blue-700 mt-1 inline-flex items-center gap-1"><FileText className="w-3 h-3" /> {c.document_name}</div>
                    )}
                  </div>
                </div>
                {isAdmin && (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <label className="p-1 hover:bg-zinc-200 rounded-sm cursor-pointer" title="Upload document">
                      <Upload className="w-3.5 h-3.5" />
                      <input type="file" className="hidden" onChange={(e) => uploadDoc(c, e.target.files?.[0])} />
                    </label>
                    <button onClick={() => startEdit(c)} title="Edit" className="p-1 hover:bg-zinc-200 rounded-sm"><Pencil className="w-3.5 h-3.5" /></button>
                    <button onClick={() => remove(c)} title="Delete" className="p-1 hover:bg-red-100 text-red-700 rounded-sm" data-testid={`cert-delete-${c.id}`}><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ============================================================ EQUIPMENT TAB
function EquipmentTab({ userId, data, reload }) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ item_name: "", asset_tag: "", serial_number: "", assigned_at: new Date().toISOString().slice(0, 10), notes: "" });

  const submit = async (e) => {
    e?.preventDefault?.();
    if (!form.item_name.trim()) { toast.error("Item name is required"); return; }
    try {
      await api.post(`/users/${userId}/equipment`, form);
      setForm({ item_name: "", asset_tag: "", serial_number: "", assigned_at: new Date().toISOString().slice(0, 10), notes: "" });
      setShowForm(false);
      reload();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    }
  };

  const remove = async (eq) => {
    if (!window.confirm(`Remove "${eq.item_name}" from this user?`)) return;
    try {
      await api.delete(`/users/${userId}/equipment/${eq.id}`);
      reload();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-500 mb-1">Assigned Equipment</div>
          <div className="text-[11px] text-zinc-500">Track trucks, tablets, ladders, and other assets checked out to this person.</div>
        </div>
        {!showForm && (
          <button onClick={() => setShowForm(true)} className="inline-flex items-center gap-1.5 h-9 px-3 bg-blue-700 text-white text-[11px] font-bold uppercase tracking-wider rounded-sm hover:bg-blue-800" data-testid="equip-add-btn">
            <Plus className="w-3.5 h-3.5" /> Add Equipment
          </button>
        )}
      </div>

      {showForm && (
        <form onSubmit={submit} className="border border-blue-200 bg-blue-50/40 rounded-sm p-4 grid grid-cols-1 md:grid-cols-2 gap-3" data-testid="equip-form">
          <FieldStack label="Item *"><input required value={form.item_name} onChange={(e) => setForm({ ...form, item_name: e.target.value })} placeholder="e.g., Ford F-250 #14" className="w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm" data-testid="equip-name" /></FieldStack>
          <FieldStack label="Asset tag"><input value={form.asset_tag} onChange={(e) => setForm({ ...form, asset_tag: e.target.value })} className="w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm" /></FieldStack>
          <FieldStack label="Serial #"><input value={form.serial_number} onChange={(e) => setForm({ ...form, serial_number: e.target.value })} className="w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm" /></FieldStack>
          <FieldStack label="Assigned date"><input type="date" value={form.assigned_at} onChange={(e) => setForm({ ...form, assigned_at: e.target.value })} className="w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm" /></FieldStack>
          <FieldStack label="Notes" className="md:col-span-2"><input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm" /></FieldStack>
          <div className="md:col-span-2 flex justify-end gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="h-9 px-3 text-[11px] font-bold uppercase tracking-wider border border-zinc-300 rounded-sm">Cancel</button>
            <button type="submit" className="h-9 px-3 text-[11px] font-bold uppercase tracking-wider bg-blue-700 text-white rounded-sm hover:bg-blue-800" data-testid="equip-save">Add</button>
          </div>
        </form>
      )}

      {data.equipment.length === 0 ? (
        <div className="text-sm text-zinc-500 italic text-center py-6 border border-dashed border-zinc-300 rounded-sm">No equipment assigned.</div>
      ) : (
        <ul className="divide-y divide-zinc-100 border border-zinc-200 rounded-sm" data-testid="equip-list">
          {data.equipment.map((eq) => (
            <li key={eq.id} className="flex items-start justify-between gap-3 px-4 py-3 hover:bg-zinc-50" data-testid={`equip-row-${eq.id}`}>
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <Wrench className="w-5 h-5 text-blue-700 mt-0.5 flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-sm">{eq.item_name}</div>
                  <div className="text-xs text-zinc-600 mt-0.5 flex flex-wrap gap-x-3">
                    {eq.asset_tag && <span className="font-mono">Tag: {eq.asset_tag}</span>}
                    {eq.serial_number && <span className="font-mono">S/N: {eq.serial_number}</span>}
                    {eq.assigned_at && <span className="inline-flex items-center gap-1"><Calendar className="w-3 h-3" /> {eq.assigned_at}</span>}
                  </div>
                  {eq.notes && <div className="text-xs text-zinc-500 italic mt-0.5">{eq.notes}</div>}
                </div>
              </div>
              <button onClick={() => remove(eq)} className="p-1 hover:bg-red-100 text-red-700 rounded-sm" data-testid={`equip-delete-${eq.id}`}><Trash2 className="w-3.5 h-3.5" /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ============================================================ SKILLS TAB
function SkillsTab({ userId, data, reload, isAdmin }) {
  const [draft, setDraft] = useState("");
  const [skills, setSkills] = useState(data.skills || []);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setSkills(data.skills || []); }, [data.skills]);

  const dirty = useMemo(
    () => JSON.stringify([...skills].sort()) !== JSON.stringify([...(data.skills || [])].sort()),
    [skills, data.skills],
  );

  const toggle = (s) => {
    const lc = s.toLowerCase();
    setSkills((cur) => cur.find((x) => x.toLowerCase() === lc) ? cur.filter((x) => x.toLowerCase() !== lc) : [...cur, s]);
  };

  const addCustom = (e) => {
    e?.preventDefault?.();
    const t = draft.trim();
    if (!t) return;
    if (!skills.find((s) => s.toLowerCase() === t.toLowerCase())) setSkills([...skills, t]);
    setDraft("");
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/users/${userId}/skills`, { skills });
      toast.success("Skills saved");
      reload();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setSaving(false);
    }
  };

  const allChips = useMemo(() => {
    const seen = new Set(skills.map((s) => s.toLowerCase()));
    const extras = data.suggestions.skills.filter((s) => !seen.has(s.toLowerCase()));
    return { selected: skills, suggestions: extras };
  }, [skills, data.suggestions.skills]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-500 mb-1">Skills &amp; Specialties</div>
          <div className="text-[11px] text-zinc-500">Tag what this person is great at. Used later to match crews to jobs.</div>
        </div>
        {isAdmin && dirty && (
          <button onClick={save} disabled={saving} className="h-9 px-3 text-[11px] font-bold uppercase tracking-wider bg-blue-700 text-white rounded-sm hover:bg-blue-800 disabled:opacity-50" data-testid="skills-save">
            {saving ? "Saving…" : "Save changes"}
          </button>
        )}
      </div>

      {allChips.selected.length > 0 && (
        <div className="flex flex-wrap gap-2" data-testid="skills-selected">
          {allChips.selected.map((s) => (
            <button
              key={s}
              type="button"
              disabled={!isAdmin}
              onClick={() => toggle(s)}
              className="inline-flex items-center gap-1.5 px-3 h-8 bg-blue-700 text-white text-[11px] font-bold uppercase tracking-wider rounded-full hover:bg-blue-800 disabled:opacity-70 disabled:cursor-default"
            >
              <Check className="w-3 h-3" /> {s}
              {isAdmin && <X className="w-3 h-3 opacity-70 ml-0.5" />}
            </button>
          ))}
        </div>
      )}

      {isAdmin && allChips.suggestions.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2">Suggestions</div>
          <div className="flex flex-wrap gap-2" data-testid="skills-suggestions">
            {allChips.suggestions.map((s) => (
              <button key={s} type="button" onClick={() => toggle(s)} className="inline-flex items-center gap-1.5 px-3 h-8 border border-zinc-300 text-zinc-700 text-[11px] font-bold uppercase tracking-wider rounded-full hover:bg-zinc-100">
                <Plus className="w-3 h-3" /> {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {isAdmin && (
        <form onSubmit={addCustom} className="flex gap-2 max-w-md">
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add custom skill…" className="flex-1 h-9 px-2 border border-zinc-300 rounded-sm text-sm" data-testid="skills-custom" />
          <button type="submit" className="h-9 px-3 text-[11px] font-bold uppercase tracking-wider border border-zinc-300 rounded-sm hover:bg-zinc-50">Add</button>
        </form>
      )}
    </div>
  );
}

// ============================================================ EMERGENCY TAB
function EmergencyTab({ userId, data, reload, canEdit }) {
  const [form, setForm] = useState(() => data.emergency_contact || {});
  const [saving, setSaving] = useState(false);
  useEffect(() => { setForm(data.emergency_contact || {}); }, [data.emergency_contact]);

  const save = async (e) => {
    e?.preventDefault?.();
    setSaving(true);
    try {
      await api.put(`/users/${userId}/emergency-contact`, form);
      toast.success("Emergency contact saved");
      reload();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-3xl" data-testid="emergency-form">
      <div className="md:col-span-2">
        <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-500 mb-1">Emergency Contact</div>
        <div className="text-[11px] text-zinc-500 mb-2">Who do we call if something happens on a jobsite?</div>
      </div>
      <FieldStack label="Name"><input value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} disabled={!canEdit} className="w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm" data-testid="emergency-name" /></FieldStack>
      <FieldStack label="Relationship"><input value={form.relationship || ""} onChange={(e) => setForm({ ...form, relationship: e.target.value })} disabled={!canEdit} placeholder="Spouse, parent…" className="w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm" /></FieldStack>
      <FieldStack label="Phone *"><input value={form.phone || ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} disabled={!canEdit} className="w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm font-mono" data-testid="emergency-phone" /></FieldStack>
      <FieldStack label="Alt phone"><input value={form.alt_phone || ""} onChange={(e) => setForm({ ...form, alt_phone: e.target.value })} disabled={!canEdit} className="w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm font-mono" /></FieldStack>
      <FieldStack label="Email" className="md:col-span-2"><input type="email" value={form.email || ""} onChange={(e) => setForm({ ...form, email: e.target.value })} disabled={!canEdit} className="w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm" /></FieldStack>
      <FieldStack label="Notes" className="md:col-span-2"><textarea value={form.notes || ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} disabled={!canEdit} rows={2} className="w-full px-2 py-2 border border-zinc-300 rounded-sm text-sm" /></FieldStack>
      {canEdit && (
        <div className="md:col-span-2 flex justify-end">
          <button type="submit" disabled={saving} className="h-9 px-4 text-[11px] font-bold uppercase tracking-wider bg-blue-700 text-white rounded-sm hover:bg-blue-800 disabled:opacity-50" data-testid="emergency-save">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      )}
    </form>
  );
}

// ============================================================ EMPLOYMENT TAB
function EmploymentTab({ userId, data, reload }) {
  const [form, setForm] = useState(() => data.employment || {});
  const [saving, setSaving] = useState(false);
  useEffect(() => { setForm(data.employment || {}); }, [data.employment]);

  const save = async (e) => {
    e?.preventDefault?.();
    setSaving(true);
    try {
      await api.put(`/users/${userId}/employment`, form);
      toast.success("Employment basics saved");
      reload();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-3xl" data-testid="employment-form">
      <div className="md:col-span-2">
        <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-500 mb-1">Employment Basics</div>
        <div className="text-[11px] text-zinc-500 mb-2">Admin-only — hidden when the user views their own profile.</div>
      </div>
      <FieldStack label="Hire date"><input type="date" value={form.hire_date || ""} onChange={(e) => setForm({ ...form, hire_date: e.target.value })} className="w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm" data-testid="employment-hire-date" /></FieldStack>
      <FieldStack label="Pay type">
        <select value={form.pay_type || ""} onChange={(e) => setForm({ ...form, pay_type: e.target.value })} className="w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm">
          <option value="">—</option>
          <option value="hourly">Hourly (W-2)</option>
          <option value="salary">Salary (W-2)</option>
          <option value="1099">1099 / Contractor</option>
        </select>
      </FieldStack>
      <FieldStack label="Hourly rate ($)"><input type="number" step="0.01" value={form.hourly_rate ?? ""} onChange={(e) => setForm({ ...form, hourly_rate: e.target.value ? parseFloat(e.target.value) : null })} className="w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm font-mono" /></FieldStack>
      <FieldStack label="Salary ($/yr)"><input type="number" step="100" value={form.salary ?? ""} onChange={(e) => setForm({ ...form, salary: e.target.value ? parseFloat(e.target.value) : null })} className="w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm font-mono" /></FieldStack>
      <FieldStack label="DL state"><input value={form.driver_license_state || ""} onChange={(e) => setForm({ ...form, driver_license_state: e.target.value.toUpperCase().slice(0, 2) })} placeholder="CO" className="w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm uppercase" /></FieldStack>
      <FieldStack label="DL number"><input value={form.driver_license_number || ""} onChange={(e) => setForm({ ...form, driver_license_number: e.target.value })} className="w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm font-mono" /></FieldStack>
      <FieldStack label="DL expiration"><input type="date" value={form.driver_license_expiration || ""} onChange={(e) => setForm({ ...form, driver_license_expiration: e.target.value })} className="w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm" /></FieldStack>
      <FieldStack label="T-shirt size">
        <select value={form.tshirt_size || ""} onChange={(e) => setForm({ ...form, tshirt_size: e.target.value })} className="w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm">
          <option value="">—</option>
          {["XS","S","M","L","XL","2XL","3XL","4XL"].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </FieldStack>
      <FieldStack label="Birthday (MM-DD)" className="md:col-span-2"><input value={form.birthday || ""} onChange={(e) => setForm({ ...form, birthday: e.target.value })} placeholder="MM-DD or YYYY-MM-DD" className="w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm font-mono max-w-xs" /></FieldStack>
      <div className="md:col-span-2 flex justify-end">
        <button type="submit" disabled={saving} className="h-9 px-4 text-[11px] font-bold uppercase tracking-wider bg-blue-700 text-white rounded-sm hover:bg-blue-800 disabled:opacity-50" data-testid="employment-save">
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

// ============================================================ Helpers
function FieldStack({ label, required, children, className = "" }) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-[10px] font-bold uppercase tracking-wider text-zinc-600 mb-1">{label}{required && <span className="text-rose-600"> *</span>}</span>
      {children}
    </label>
  );
}
