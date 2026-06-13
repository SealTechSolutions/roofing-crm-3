import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import { BookOpen, Plus, Edit2, Save, X, Lock, Building2, Trash2, Activity, Receipt, FileSpreadsheet, ChevronRight } from "lucide-react";

const ACCOUNT_TYPES = ["Asset", "Liability", "Equity", "Revenue", "COGS", "Expense", "Other"];

const TYPE_COLORS = {
  Asset: "bg-blue-50 text-blue-800 border-blue-200",
  Liability: "bg-amber-50 text-amber-800 border-amber-200",
  Equity: "bg-purple-50 text-purple-800 border-purple-200",
  Revenue: "bg-emerald-50 text-emerald-800 border-emerald-200",
  COGS: "bg-orange-50 text-orange-800 border-orange-200",
  Expense: "bg-rose-50 text-rose-800 border-rose-200",
  Other: "bg-zinc-100 text-zinc-700 border-zinc-200",
};

const blankAcct = (entity_id) => ({
  entity_id,
  number: "",
  name: "",
  type: "Expense",
  category: "",
  description: "",
  is_contra: false,
  is_active: true,
});

export default function BooksCOA() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [entities, setEntities] = useState([]);
  const [entityId, setEntityId] = useState(() => localStorage.getItem("books_entity_id") || "");
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("All");

  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState(null);

  const [showNew, setShowNew] = useState(false);
  const [newDraft, setNewDraft] = useState(null);

  const [showEntityEdit, setShowEntityEdit] = useState(false);
  const [showEntityNew, setShowEntityNew] = useState(false);

  // Tabs: 'coa' or 'activity'
  const [view, setView] = useState(() => {
    const fromHash = (typeof window !== "undefined" && window.location.hash || "").replace("#", "");
    return fromHash === "activity" ? "activity" : "coa";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (view === "activity") {
      window.location.hash = "activity";
    } else if (window.location.hash) {
      // Clear hash cleanly (no trailing #) when going back to default COA tab
      const url = window.location.pathname + window.location.search;
      window.history.replaceState(null, "", url);
    }
  }, [view]);

  const currentEntity = useMemo(() => entities.find((e) => e.id === entityId) || null, [entities, entityId]);

  const loadEntities = async () => {
    try {
      const r = await api.get("/books/entities");
      setEntities(r.data || []);
      if (r.data?.length) {
        const exists = r.data.find((e) => e.id === entityId);
        if (!exists) {
          const parent = r.data.find((e) => e.is_parent) || r.data[0];
          setEntityId(parent.id);
          localStorage.setItem("books_entity_id", parent.id);
        }
      }
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    }
  };

  const loadAccounts = async (eid) => {
    if (!eid) return;
    setLoading(true);
    try {
      const r = await api.get(`/books/accounts?entity_id=${eid}`);
      setAccounts(r.data || []);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadEntities(); }, []);
  useEffect(() => { if (entityId) loadAccounts(entityId); }, [entityId]);

  const filteredAccounts = useMemo(() => {
    let out = accounts;
    if (typeFilter !== "All") out = out.filter((a) => a.type === typeFilter);
    if (search.trim()) {
      const s = search.toLowerCase();
      out = out.filter((a) => `${a.number} ${a.name} ${a.category}`.toLowerCase().includes(s));
    }
    return out;
  }, [accounts, search, typeFilter]);

  const grouped = useMemo(() => {
    const g = {};
    for (const a of filteredAccounts) {
      g[a.type] = g[a.type] || [];
      g[a.type].push(a);
    }
    return g;
  }, [filteredAccounts]);

  const switchEntity = (id) => {
    setEntityId(id);
    localStorage.setItem("books_entity_id", id);
    setEditingId(null);
    setShowNew(false);
  };

  // ---- Account CRUD ----
  const startEdit = (a) => {
    setEditingId(a.id);
    setDraft({ ...a });
  };
  const cancelEdit = () => { setEditingId(null); setDraft(null); };
  const saveEdit = async () => {
    if (!draft) return;
    try {
      await api.put(`/books/accounts/${editingId}`, draft);
      toast.success("Account updated");
      cancelEdit();
      loadAccounts(entityId);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    }
  };

  const startNew = () => {
    setNewDraft(blankAcct(entityId));
    setShowNew(true);
  };
  const saveNew = async () => {
    if (!newDraft) return;
    if (!newDraft.number || !newDraft.name) {
      toast.error("Number and Name are required");
      return;
    }
    try {
      await api.post("/books/accounts", newDraft);
      toast.success("Account added");
      setShowNew(false);
      setNewDraft(null);
      loadAccounts(entityId);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    }
  };

  const deactivate = async (a) => {
    if (a.system) {
      toast.error("System account — cannot delete");
      return;
    }
    if (!window.confirm(`Deactivate account ${a.number} – ${a.name}?`)) return;
    try {
      await api.delete(`/books/accounts/${a.id}`);
      toast.success("Account deactivated");
      loadAccounts(entityId);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-100" data-testid="books-coa-page">
      {/* Header */}
      <div className="bg-white border-b border-zinc-200">
        <div className="px-8 py-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BookOpen className="w-7 h-7 text-blue-700" />
            <div>
              <h1 className="text-2xl font-black uppercase tracking-wider text-zinc-900">Books</h1>
              <div className="text-xs uppercase tracking-widest text-zinc-500 font-bold">Chart of Accounts</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {isAdmin && (
              <button
                data-testid="add-entity-btn"
                onClick={() => setShowEntityNew(true)}
                className="px-3 py-2 text-xs font-bold uppercase tracking-wider border border-zinc-300 hover:border-blue-700 hover:text-blue-700 transition-colors flex items-center gap-2"
              >
                <Building2 className="w-3.5 h-3.5" /> New Entity
              </button>
            )}
            {isAdmin && entityId && (
              <button
                data-testid="add-account-btn"
                onClick={startNew}
                className="px-3 py-2 text-xs font-bold uppercase tracking-wider bg-blue-700 text-white hover:bg-blue-800 transition-colors flex items-center gap-2"
              >
                <Plus className="w-3.5 h-3.5" /> Add Account
              </button>
            )}
          </div>
        </div>

        {/* Entity switcher */}
        <div className="px-8 pb-4 flex items-end gap-4">
          <div className="flex-1 max-w-md">
            <label className="block text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-1">Entity</label>
            <select
              data-testid="entity-switcher"
              value={entityId}
              onChange={(e) => switchEntity(e.target.value)}
              className="w-full border border-zinc-300 px-3 py-2 text-sm font-bold focus:outline-none focus:border-blue-700"
            >
              {entities.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}{e.is_parent ? "  (Parent)" : ""}{e.role ? `  — ${e.role}` : ""}
                </option>
              ))}
            </select>
          </div>
          {currentEntity && (
            <div className="flex-1 text-xs text-zinc-600">
              <div className="font-bold uppercase tracking-wider text-zinc-500 text-[10px] mb-1">Legal Name</div>
              <div>{currentEntity.legal_name || "—"} · {currentEntity.entity_type || "—"}</div>
            </div>
          )}
          {currentEntity && isAdmin && (
            <button
              data-testid="edit-entity-btn"
              onClick={() => setShowEntityEdit(true)}
              className="px-3 py-2 text-xs font-bold uppercase tracking-wider border border-zinc-300 hover:border-blue-700 hover:text-blue-700 transition-colors flex items-center gap-2"
            >
              <Edit2 className="w-3.5 h-3.5" /> Edit Entity
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="px-8 pb-0 flex items-center gap-1 border-b border-zinc-200 -mb-px">
          <TabButton active={view === "coa"} onClick={() => setView("coa")} icon={BookOpen} label="Chart of Accounts" testId="tab-coa" />
          <TabButton active={view === "activity"} onClick={() => setView("activity")} icon={Activity} label="Journal Activity" testId="tab-activity" />
        </div>

        {/* Filters — only when on COA tab */}
        {view === "coa" && (
        <div className="px-8 pt-4 pb-4 flex items-center gap-3">
          <input
            data-testid="account-search"
            type="text"
            placeholder="Search by number, name, category..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 max-w-md border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:border-blue-700"
          />
          <select
            data-testid="type-filter"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="border border-zinc-300 px-3 py-2 text-sm font-bold focus:outline-none focus:border-blue-700"
          >
            <option value="All">All Types</option>
            {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <div className="text-xs uppercase tracking-wider font-bold text-zinc-500" data-testid="account-count">
            {filteredAccounts.length} accounts
          </div>
        </div>
        )}
      </div>

      {/* Body — COA */}
      {view === "coa" && (
      <div className="px-8 py-6">
        {loading && <div className="text-sm text-zinc-500">Loading...</div>}
        {!loading && !filteredAccounts.length && (
          <div className="bg-white border border-zinc-200 p-12 text-center text-sm text-zinc-500">
            No accounts match the current filters.
          </div>
        )}

        {showNew && newDraft && (
          <div className="bg-white border-2 border-blue-700 mb-6 p-4" data-testid="new-account-form">
            <div className="text-xs font-bold uppercase tracking-widest text-blue-700 mb-3">New Account</div>
            <div className="grid grid-cols-6 gap-3">
              <input
                data-testid="new-account-number"
                placeholder="Number"
                value={newDraft.number}
                onChange={(e) => setNewDraft({ ...newDraft, number: e.target.value })}
                className="border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:border-blue-700"
              />
              <input
                data-testid="new-account-name"
                placeholder="Account Name"
                value={newDraft.name}
                onChange={(e) => setNewDraft({ ...newDraft, name: e.target.value })}
                className="col-span-2 border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:border-blue-700"
              />
              <select
                data-testid="new-account-type"
                value={newDraft.type}
                onChange={(e) => setNewDraft({ ...newDraft, type: e.target.value })}
                className="border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:border-blue-700"
              >
                {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <input
                data-testid="new-account-category"
                placeholder="Category"
                value={newDraft.category}
                onChange={(e) => setNewDraft({ ...newDraft, category: e.target.value })}
                className="border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:border-blue-700"
              />
              <div className="flex items-center gap-2">
                <button
                  data-testid="save-new-account"
                  onClick={saveNew}
                  className="flex-1 bg-blue-700 text-white px-3 py-2 text-xs font-bold uppercase tracking-wider hover:bg-blue-800 transition-colors"
                >
                  <Save className="w-3.5 h-3.5 inline mr-1" /> Save
                </button>
                <button
                  data-testid="cancel-new-account"
                  onClick={() => { setShowNew(false); setNewDraft(null); }}
                  className="border border-zinc-300 px-2 py-2 text-zinc-600 hover:border-rose-600 hover:text-rose-600 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        )}

        {ACCOUNT_TYPES.map((t) => {
          const items = grouped[t];
          if (!items?.length) return null;
          return (
            <div key={t} className="mb-6" data-testid={`section-${t.toLowerCase()}`}>
              <div className="flex items-center gap-3 mb-2">
                <span className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest border ${TYPE_COLORS[t]}`}>{t}</span>
                <span className="text-xs text-zinc-500">{items.length} accounts</span>
              </div>
              <div className="bg-white border border-zinc-200">
                <table className="w-full text-sm">
                  <thead className="bg-zinc-50 text-[10px] uppercase tracking-widest text-zinc-500 font-bold">
                    <tr>
                      <th className="text-left px-4 py-2 w-24">Number</th>
                      <th className="text-left px-4 py-2">Name</th>
                      <th className="text-left px-4 py-2 w-48">Category</th>
                      <th className="text-left px-4 py-2 w-24">Flags</th>
                      <th className="text-right px-4 py-2 w-32"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((a) => editingId === a.id ? (
                      <tr key={a.id} className="border-t border-zinc-200 bg-blue-50/50" data-testid={`edit-row-${a.id}`}>
                        <td className="px-4 py-2">
                          <input
                            value={draft.number}
                            onChange={(e) => setDraft({ ...draft, number: e.target.value })}
                            disabled={a.system}
                            className="w-20 border border-zinc-300 px-2 py-1 text-sm disabled:bg-zinc-100"
                          />
                        </td>
                        <td className="px-4 py-2">
                          <input
                            value={draft.name}
                            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                            className="w-full border border-zinc-300 px-2 py-1 text-sm"
                          />
                        </td>
                        <td className="px-4 py-2">
                          <input
                            value={draft.category || ""}
                            onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                            className="w-full border border-zinc-300 px-2 py-1 text-sm"
                          />
                        </td>
                        <td className="px-4 py-2 text-xs">
                          {a.system ? <span className="text-blue-700 font-bold">SYSTEM</span> : <span className="text-zinc-400">—</span>}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <button onClick={saveEdit} className="text-blue-700 font-bold text-xs uppercase mr-3" data-testid={`save-${a.id}`}>Save</button>
                          <button onClick={cancelEdit} className="text-zinc-500 text-xs uppercase">Cancel</button>
                        </td>
                      </tr>
                    ) : (
                      <tr key={a.id} className="border-t border-zinc-200 hover:bg-zinc-50" data-testid={`row-${a.number}`}>
                        <td className="px-4 py-2 font-mono text-xs font-bold text-zinc-700">{a.number}</td>
                        <td className="px-4 py-2 text-zinc-900">{a.name}</td>
                        <td className="px-4 py-2 text-zinc-500 text-xs">{a.category || "—"}</td>
                        <td className="px-4 py-2 text-xs">
                          {a.system && <span className="inline-flex items-center gap-1 text-blue-700 font-bold"><Lock className="w-3 h-3" />SYSTEM</span>}
                          {a.is_contra && <span className="ml-2 text-amber-700 font-bold">CONTRA</span>}
                        </td>
                        <td className="px-4 py-2 text-right">
                          {isAdmin && (
                            <>
                              <button
                                onClick={() => startEdit(a)}
                                className="text-zinc-600 hover:text-blue-700 mr-3"
                                data-testid={`edit-${a.number}`}
                                title="Edit"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              {!a.system && (
                                <button
                                  onClick={() => deactivate(a)}
                                  className="text-zinc-600 hover:text-rose-600"
                                  data-testid={`delete-${a.number}`}
                                  title="Deactivate"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>
      )}

      {/* Body — Journal Activity */}
      {view === "activity" && (
        <JournalFeed entityId={entityId} entities={entities} />
      )}

      {showEntityEdit && currentEntity && (
        <EntityModal
          mode="edit"
          initial={currentEntity}
          onClose={() => setShowEntityEdit(false)}
          onSaved={() => { setShowEntityEdit(false); loadEntities(); }}
        />
      )}
      {showEntityNew && (
        <EntityModal
          mode="new"
          initial={null}
          onClose={() => setShowEntityNew(false)}
          onSaved={(created) => {
            setShowEntityNew(false);
            loadEntities().then(() => {
              if (created?.id) switchEntity(created.id);
            });
          }}
        />
      )}
    </div>
  );
}

const ENTITY_TYPES = ["LLC", "C-Corp", "S-Corp", "Sole Prop", "Partnership", "Other"];

function EntityModal({ mode, initial, onClose, onSaved }) {
  const [draft, setDraft] = useState(() => ({
    name: initial?.name || "",
    legal_name: initial?.legal_name || "",
    role: initial?.role || "",
    entity_type: initial?.entity_type || "LLC",
    is_parent: initial?.is_parent || false,
    tax_id: initial?.tax_id || "",
    address: initial?.address || "",
    city: initial?.city || "",
    state: initial?.state || "",
    zip_code: initial?.zip_code || "",
    email: initial?.email || "",
    phone: initial?.phone || "",
    remit_to_address: initial?.remit_to_address || "",
    is_active: initial?.is_active !== false,
  }));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!draft.name.trim()) {
      toast.error("Entity name is required");
      return;
    }
    setSaving(true);
    try {
      if (mode === "edit") {
        await api.put(`/books/entities/${initial.id}`, draft);
        toast.success("Entity updated");
        onSaved();
      } else {
        const r = await api.post(`/books/entities`, draft);
        toast.success("Entity created — default Chart of Accounts seeded");
        onSaved(r.data);
      }
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" data-testid="entity-modal">
      <div className="bg-white max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-zinc-200 flex items-center justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-widest text-blue-700">{mode === "edit" ? "Edit Entity" : "New Entity"}</div>
            <div className="text-lg font-black uppercase tracking-wider text-zinc-900 mt-0.5">{draft.name || "—"}</div>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-900" data-testid="close-entity-modal">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6 grid grid-cols-2 gap-4">
          <Field label="Name *">
            <input data-testid="entity-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="w-full border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:border-blue-700" />
          </Field>
          <Field label="Legal Name">
            <input value={draft.legal_name} onChange={(e) => setDraft({ ...draft, legal_name: e.target.value })} className="w-full border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:border-blue-700" />
          </Field>
          <Field label="Role / Tag">
            <input value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })} placeholder="e.g., Operations, Holding, Commissions" className="w-full border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:border-blue-700" />
          </Field>
          <Field label="Entity Type">
            <select value={draft.entity_type} onChange={(e) => setDraft({ ...draft, entity_type: e.target.value })} className="w-full border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:border-blue-700">
              {ENTITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Tax ID / EIN">
            <input value={draft.tax_id} onChange={(e) => setDraft({ ...draft, tax_id: e.target.value })} className="w-full border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:border-blue-700" />
          </Field>
          <Field label="Phone">
            <input value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} className="w-full border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:border-blue-700" />
          </Field>
          <Field label="Email">
            <input value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} className="w-full border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:border-blue-700" />
          </Field>
          <Field label="Address">
            <input value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value })} className="w-full border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:border-blue-700" />
          </Field>
          <Field label="City">
            <input value={draft.city} onChange={(e) => setDraft({ ...draft, city: e.target.value })} className="w-full border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:border-blue-700" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="State">
              <input value={draft.state} onChange={(e) => setDraft({ ...draft, state: e.target.value })} className="w-full border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:border-blue-700" />
            </Field>
            <Field label="Zip">
              <input value={draft.zip_code} onChange={(e) => setDraft({ ...draft, zip_code: e.target.value })} className="w-full border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:border-blue-700" />
            </Field>
          </div>
          <Field label="Remit-To Address (for invoices)" full>
            <textarea value={draft.remit_to_address} onChange={(e) => setDraft({ ...draft, remit_to_address: e.target.value })} rows={2} className="w-full border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:border-blue-700" />
          </Field>
          <div className="col-span-2 flex items-center gap-4 text-xs">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={draft.is_parent} onChange={(e) => setDraft({ ...draft, is_parent: e.target.checked })} />
              <span className="font-bold uppercase tracking-wider">Parent Entity</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={draft.is_active} onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })} />
              <span className="font-bold uppercase tracking-wider">Active</span>
            </label>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-zinc-200 flex items-center justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-xs font-bold uppercase tracking-wider border border-zinc-300 hover:border-zinc-500 transition-colors">Cancel</button>
          <button
            data-testid="save-entity-btn"
            onClick={save}
            disabled={saving}
            className="px-4 py-2 text-xs font-bold uppercase tracking-wider bg-blue-700 text-white hover:bg-blue-800 transition-colors disabled:opacity-50"
          >
            {saving ? "Saving..." : (mode === "edit" ? "Save Changes" : "Create Entity")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children, full }) {
  return (
    <div className={full ? "col-span-2" : ""}>
      <label className="block text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-1">{label}</label>
      {children}
    </div>
  );
}

// ============ Tab button ============
function TabButton({ active, onClick, icon: Icon, label, testId }) {
  return (
    <button
      data-testid={testId}
      onClick={onClick}
      className={`px-4 py-2.5 text-xs font-bold uppercase tracking-widest border-b-2 -mb-px flex items-center gap-2 transition-colors ${
        active
          ? "border-blue-700 text-blue-700"
          : "border-transparent text-zinc-500 hover:text-zinc-900"
      }`}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
    </button>
  );
}

// ============ Journal Activity feed ============
const KIND_LABELS = {
  issue: { label: "Invoice Issued", tone: "bg-blue-100 text-blue-800", icon: FileSpreadsheet },
  payment: { label: "Payment Received", tone: "bg-emerald-100 text-emerald-800", icon: Receipt },
  bill_received: { label: "Bill Received", tone: "bg-amber-100 text-amber-800", icon: Receipt },
  bill_payment: { label: "Bill Paid", tone: "bg-rose-100 text-rose-800", icon: Receipt },
};

const fmtMoney = (n) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);

function JournalFeed({ entityId, entities }) {
  const [rows, setRows] = useState(null);
  const [includeReversed, setIncludeReversed] = useState(false);
  const [kindFilter, setKindFilter] = useState("All");

  const load = async () => {
    if (!entityId) { setRows([]); return; }
    setRows(null);
    try {
      const r = await api.get(
        `/books/journal-entries?entity_id=${entityId}&limit=200&include_reversed=${includeReversed}`
      );
      setRows(r.data || []);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
      setRows([]);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [entityId, includeReversed]);

  const filtered = useMemo(
    () => (rows || []).filter((r) => kindFilter === "All" || r.kind === kindFilter),
    [rows, kindFilter]
  );

  const entityName = (entities.find((e) => e.id === entityId) || {}).name;

  const totals = useMemo(() => {
    let dr = 0, cr = 0;
    for (const r of filtered) { dr += r.total_debit || 0; cr += r.total_credit || 0; }
    return { dr, cr };
  }, [filtered]);

  return (
    <div className="px-8 py-6" data-testid="journal-feed">
      {/* Activity filters */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <select
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value)}
          className="border border-zinc-300 px-3 py-2 text-sm font-bold focus:outline-none focus:border-blue-700"
          data-testid="kind-filter"
        >
          <option value="All">All Event Types</option>
          <option value="issue">Invoice Issued</option>
          <option value="payment">Payment Received</option>
          <option value="bill_received">Bill Received</option>
          <option value="bill_payment">Bill Paid</option>
        </select>
        <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-zinc-600">
          <input
            type="checkbox"
            data-testid="include-reversed-toggle"
            checked={includeReversed}
            onChange={(e) => setIncludeReversed(e.target.checked)}
          />
          Include reversed
        </label>
        <div className="text-xs uppercase tracking-wider font-bold text-zinc-500 ml-auto" data-testid="journal-count">
          {filtered.length} entries · DR {fmtMoney(totals.dr)} · CR {fmtMoney(totals.cr)}
        </div>
      </div>

      {rows === null && <div className="text-sm text-zinc-500">Loading...</div>}
      {rows && filtered.length === 0 && (
        <div className="bg-white border border-zinc-200 p-12 text-center text-sm text-zinc-500">
          No journal activity for <span className="font-bold">{entityName || "this entity"}</span> yet. Save an invoice or vendor bill with this entity selected to start the ledger.
        </div>
      )}

      {filtered.length > 0 && (
        <div className="bg-white border border-zinc-200">
          {filtered.map((j) => {
            const kind = KIND_LABELS[j.kind] || { label: j.kind, tone: "bg-zinc-100 text-zinc-700", icon: Activity };
            const KindIcon = kind.icon;
            const sourcePath = j.source_type === "vendor_bill"
              ? `/payables?focus=${encodeURIComponent(j.source_id)}`
              : `/invoices?focus=${encodeURIComponent(j.source_id)}`;
            return (
              <div
                key={j.id}
                className={`border-b border-zinc-200 last:border-b-0 px-5 py-4 ${j.is_reversed ? "opacity-50" : ""}`}
                data-testid={`journal-row-${j.id}`}
              >
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 w-10 h-10 rounded-sm bg-zinc-50 border border-zinc-200 flex items-center justify-center">
                    <KindIcon className="w-4 h-4 text-zinc-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest rounded-sm ${kind.tone}`}>{kind.label}</span>
                      {j.is_reversed && <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest bg-rose-100 text-rose-800 rounded-sm">Reversed</span>}
                      <span className="font-mono text-[11px] text-zinc-500">{j.date}</span>
                    </div>
                    <div className={`mt-1 font-bold text-zinc-900 truncate ${j.is_reversed ? "line-through" : ""}`} title={j.memo}>
                      {j.memo || "—"}
                    </div>
                    {/* Lines */}
                    <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-0.5 text-xs">
                      {j.lines.map((ln, i) => (
                        <div key={i} className="flex items-center justify-between font-mono">
                          <span className="text-zinc-700 truncate">
                            <span className="text-zinc-400">{ln.account_number}</span>{" "}
                            <span className="text-zinc-900">{ln.account_name}</span>
                          </span>
                          <span className={`font-bold whitespace-nowrap ml-2 ${ln.debit > 0 ? "text-blue-700" : "text-emerald-700"}`}>
                            {ln.debit > 0 ? `DR ${fmtMoney(ln.debit)}` : `CR ${fmtMoney(ln.credit)}`}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2 flex-shrink-0">
                    <div className="font-mono font-black text-base text-zinc-900">{fmtMoney(j.total_debit)}</div>
                    <Link
                      to={sourcePath}
                      className="text-[10px] font-bold uppercase tracking-wider text-blue-700 hover:text-blue-900 inline-flex items-center gap-1"
                      data-testid={`source-link-${j.id}`}
                    >
                      Open {j.source_type === "vendor_bill" ? "Bill" : "Invoice"} <ChevronRight className="w-3 h-3" />
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

