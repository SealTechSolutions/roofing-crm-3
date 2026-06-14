import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import { BookOpen, Plus, Edit2, Save, X, Lock, Building2, Trash2, Activity, Receipt, FileSpreadsheet, ChevronRight, TrendingUp, Scale, Wand2, FileCheck, Network, Banknote, PencilLine, RotateCcw, Clock, Waves } from "lucide-react";
import { maskPhoneInput, maskTaxIdInput } from "@/lib/format";
import { ProfitLossReport, BalanceSheetReport, LateFeeAccrualTool, AgingReport, CashFlowReport } from "@/pages/BooksReports";
import { PeriodCloseTool } from "@/pages/BooksPeriodClose";
import { InterCompanyReport, BankReconciliationTool } from "@/pages/BooksInterCoBank";

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

  // Tabs: coa | activity | pl | bs | ar-aging | ap-aging | latefees | close | interco | bankrec
  const VALID_VIEWS = ["coa", "activity", "pl", "bs", "cf", "ar-aging", "ap-aging", "latefees", "close", "interco", "bankrec"];
  const [view, setView] = useState(() => {
    const fromHash = (typeof window !== "undefined" && window.location.hash || "").replace("#", "");
    return VALID_VIEWS.includes(fromHash) ? fromHash : "coa";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (view !== "coa") {
      window.location.hash = view;
    } else if (window.location.hash) {
      const url = window.location.pathname + window.location.search;
      window.history.replaceState(null, "", url);
    }
  }, [view]);

  // Sync state if user uses browser back/forward (hash changes externally)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onHash = () => {
      const h = (window.location.hash || "").replace("#", "");
      setView(VALID_VIEWS.includes(h) ? h : "coa");
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
              <div className="text-xs uppercase tracking-widest text-zinc-500 font-bold">Multi-Entity General Ledger</div>
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
        <div className="px-8 pb-0 flex items-center gap-1 border-b border-zinc-200 -mb-px overflow-x-auto">
          <TabButton active={view === "coa"} onClick={() => setView("coa")} icon={BookOpen} label="Chart of Accounts" testId="tab-coa" />
          <TabButton active={view === "activity"} onClick={() => setView("activity")} icon={Activity} label="Journal Activity" testId="tab-activity" />
          <TabButton active={view === "pl"} onClick={() => setView("pl")} icon={TrendingUp} label="P&L" testId="tab-pl" />
          <TabButton active={view === "bs"} onClick={() => setView("bs")} icon={Scale} label="Balance Sheet" testId="tab-bs" />
          <TabButton active={view === "cf"} onClick={() => setView("cf")} icon={Waves} label="Cash Flow" testId="tab-cf" />
          <TabButton active={view === "ar-aging"} onClick={() => setView("ar-aging")} icon={Clock} label="A/R Aging" testId="tab-ar-aging" />
          <TabButton active={view === "ap-aging"} onClick={() => setView("ap-aging")} icon={Clock} label="A/P Aging" testId="tab-ap-aging" />
          <TabButton active={view === "latefees"} onClick={() => setView("latefees")} icon={Wand2} label="Late Fees" testId="tab-latefees" />
          <TabButton active={view === "close"} onClick={() => setView("close")} icon={FileCheck} label="Period Close" testId="tab-close" />
          <TabButton active={view === "interco"} onClick={() => setView("interco")} icon={Network} label="Inter-Co" testId="tab-interco" />
          <TabButton active={view === "bankrec"} onClick={() => setView("bankrec")} icon={Banknote} label="Bank Rec" testId="tab-bankrec" />
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
        <JournalFeed entityId={entityId} entities={entities} isAdmin={isAdmin} />
      )}

      {/* Body — Profit & Loss */}
      {view === "pl" && (
        <ProfitLossReport entityId={entityId} entityName={currentEntity?.name} />
      )}

      {/* Body — Balance Sheet */}
      {view === "bs" && (
        <BalanceSheetReport entityId={entityId} entityName={currentEntity?.name} />
      )}

      {/* Body — Cash Flow */}
      {view === "cf" && (
        <CashFlowReport entityId={entityId} entityName={currentEntity?.name} />
      )}

      {/* Body — A/R Aging */}
      {view === "ar-aging" && (
        <AgingReport entityId={entityId} entityName={currentEntity?.name} kind="ar" />
      )}

      {/* Body — A/P Aging */}
      {view === "ap-aging" && (
        <AgingReport entityId={entityId} entityName={currentEntity?.name} kind="ap" />
      )}

      {/* Body — Late-Fee Accrual */}
      {view === "latefees" && (
        <LateFeeAccrualTool entities={entities} />
      )}

      {/* Body — Period Close */}
      {view === "close" && (
        <PeriodCloseTool entityId={entityId} entities={entities} onEntityRefresh={loadEntities} />
      )}

      {/* Body — Inter-Company Reconciliation */}
      {view === "interco" && (
        <InterCompanyReport />
      )}

      {/* Body — Bank Reconciliation */}
      {view === "bankrec" && (
        <BankReconciliationTool entityId={entityId} entityName={currentEntity?.name} />
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
    tax_id_kind: initial?.tax_id_kind || "EIN",
    address: initial?.address || "",
    city: initial?.city || "",
    state: initial?.state || "",
    zip_code: initial?.zip_code || "",
    email: initial?.email || "",
    phone: initial?.phone || "",
    remit_to_address: initial?.remit_to_address || "",
    monthly_depreciation: Number(initial?.monthly_depreciation) || 0,
    late_fee_rate_pct: initial?.late_fee_rate_pct ?? 1.5,
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
          <Field label={`Tax ID / ${draft.tax_id_kind === "SSN" ? "SSN" : "EIN"}`}>
            <div className="space-y-1.5">
              <div className="flex items-center gap-3 text-[10px] font-bold uppercase tracking-widest text-zinc-600">
                <label className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="radio"
                    name="entity-tax-kind"
                    checked={draft.tax_id_kind !== "SSN"}
                    onChange={() => setDraft({ ...draft, tax_id_kind: "EIN", tax_id: maskTaxIdInput(draft.tax_id, "EIN") })}
                    data-testid="entity-tax-kind-ein"
                  />
                  EIN
                </label>
                <label className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="radio"
                    name="entity-tax-kind"
                    checked={draft.tax_id_kind === "SSN"}
                    onChange={() => setDraft({ ...draft, tax_id_kind: "SSN", tax_id: maskTaxIdInput(draft.tax_id, "SSN") })}
                    data-testid="entity-tax-kind-ssn"
                  />
                  SSN
                </label>
              </div>
              <input
                data-testid="entity-tax-id"
                value={maskTaxIdInput(draft.tax_id, draft.tax_id_kind === "SSN" ? "SSN" : "EIN")}
                onChange={(e) => setDraft({ ...draft, tax_id: maskTaxIdInput(e.target.value, draft.tax_id_kind === "SSN" ? "SSN" : "EIN") })}
                placeholder={draft.tax_id_kind === "SSN" ? "XXX-XX-XXXX" : "XX-XXXXXXX"}
                className="w-full border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:border-blue-700 font-mono"
              />
            </div>
          </Field>
          <Field label="Phone">
            <input
              data-testid="entity-phone"
              value={maskPhoneInput(draft.phone)}
              onChange={(e) => setDraft({ ...draft, phone: maskPhoneInput(e.target.value) })}
              placeholder="XXX-XXX-XXXX"
              className="w-full border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:border-blue-700 font-mono"
            />
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
          <Field label="Monthly Depreciation (Books → Period Close)" full>
            <div className="flex items-center gap-2">
              <span className="font-mono text-zinc-500">$</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={draft.monthly_depreciation}
                onChange={(e) => setDraft({ ...draft, monthly_depreciation: parseFloat(e.target.value) || 0 })}
                className="flex-1 border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:border-blue-700 font-mono"
                data-testid="entity-monthly-depr"
              />
              <span className="text-[10px] text-zinc-500 uppercase tracking-wider">DR 6600 / CR 1510 monthly</span>
            </div>
          </Field>
          <Field label="Late Fee Rate (per month, applied to balances > 30 days past due)" full>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.01"
                min="0"
                max="25"
                value={draft.late_fee_rate_pct}
                onChange={(e) => setDraft({ ...draft, late_fee_rate_pct: parseFloat(e.target.value) || 0 })}
                className="w-28 border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:border-blue-700 font-mono text-right"
                data-testid="entity-late-fee-rate"
              />
              <span className="font-mono text-zinc-500">% / month</span>
              <span className="text-[10px] text-zinc-500 uppercase tracking-wider ml-auto">
                Equivalent to ~{(Number(draft.late_fee_rate_pct) * 12).toFixed(1)}% APR · Individual customers can override
              </span>
            </div>
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
  adjustment: { label: "Manual Adjustment", tone: "bg-violet-100 text-violet-800", icon: PencilLine },
};

const fmtMoney = (n) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);

function JournalFeed({ entityId, entities, isAdmin }) {
  const [rows, setRows] = useState(null);
  const [includeReversed, setIncludeReversed] = useState(false);
  const [kindFilter, setKindFilter] = useState("All");
  const [showComposer, setShowComposer] = useState(false);

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

  const reverseEntry = async (j) => {
    if (!window.confirm(`Reverse manual journal entry posted ${j.date}?\n\n"${j.memo || ""}"\n\nThis cannot be undone.`)) return;
    try {
      await api.post(`/books/journal-entries/${j.id}/reverse`);
      toast.success("Manual journal entry reversed");
      load();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    }
  };

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
          <option value="adjustment">Manual Adjustment</option>
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
        {isAdmin && entityId && (
          <button
            data-testid="new-journal-entry-btn"
            onClick={() => setShowComposer(true)}
            className="ml-auto px-3 py-2 text-xs font-bold uppercase tracking-wider bg-violet-700 text-white hover:bg-violet-800 transition-colors flex items-center gap-2"
          >
            <PencilLine className="w-3.5 h-3.5" /> New Journal Entry
          </button>
        )}
        <div className={`text-xs uppercase tracking-wider font-bold text-zinc-500 ${isAdmin && entityId ? "" : "ml-auto"}`} data-testid="journal-count">
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
            const isManual = j.source_type === "manual";
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
                      {isManual && j.posted_by_name && (
                        <span className="font-mono text-[11px] text-zinc-500">· by {j.posted_by_name}</span>
                      )}
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
                    {isManual ? (
                      isAdmin && !j.is_reversed ? (
                        <button
                          onClick={() => reverseEntry(j)}
                          className="text-[10px] font-bold uppercase tracking-wider text-rose-700 hover:text-rose-900 inline-flex items-center gap-1"
                          data-testid={`reverse-journal-${j.id}`}
                        >
                          <RotateCcw className="w-3 h-3" /> Reverse
                        </button>
                      ) : (
                        <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Manual</span>
                      )
                    ) : (
                      <Link
                        to={sourcePath}
                        className="text-[10px] font-bold uppercase tracking-wider text-blue-700 hover:text-blue-900 inline-flex items-center gap-1"
                        data-testid={`source-link-${j.id}`}
                      >
                        Open {j.source_type === "vendor_bill" ? "Bill" : "Invoice"} <ChevronRight className="w-3 h-3" />
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showComposer && (
        <ManualJournalModal
          entityId={entityId}
          entityName={entityName}
          onClose={() => setShowComposer(false)}
          onSaved={() => { setShowComposer(false); load(); }}
        />
      )}
    </div>
  );
}

// ============ Manual Journal Entry Composer ============
const blankLine = () => ({ account_id: "", debit: "", credit: "", memo: "" });

function ManualJournalModal({ entityId, entityName, onClose, onSaved }) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [memo, setMemo] = useState("");
  const [lines, setLines] = useState([blankLine(), blankLine()]);
  const [accounts, setAccounts] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!entityId) return;
    api.get(`/books/accounts?entity_id=${entityId}`)
      .then((r) => setAccounts(r.data || []))
      .catch((e) => toast.error(formatApiError(e?.response?.data?.detail) || e.message));
  }, [entityId]);

  const updateLine = (idx, patch) => {
    setLines((prev) => prev.map((ln, i) => (i === idx ? { ...ln, ...patch } : ln)));
  };
  const addLine = () => setLines((prev) => [...prev, blankLine()]);
  const removeLine = (idx) => setLines((prev) => prev.length > 2 ? prev.filter((_, i) => i !== idx) : prev);

  const numericLines = lines.map((ln) => ({
    account_id: ln.account_id,
    debit: parseFloat(ln.debit) || 0,
    credit: parseFloat(ln.credit) || 0,
    memo: ln.memo || "",
  }));
  const totals = numericLines.reduce(
    (acc, ln) => ({ dr: acc.dr + ln.debit, cr: acc.cr + ln.credit }),
    { dr: 0, cr: 0 }
  );
  const diff = +(totals.dr - totals.cr).toFixed(2);
  const balanced = Math.abs(diff) < 0.01 && totals.dr > 0;

  const groupedAccounts = useMemo(() => {
    const groups = {};
    for (const a of accounts) {
      groups[a.type] = groups[a.type] || [];
      groups[a.type].push(a);
    }
    for (const k of Object.keys(groups)) groups[k].sort((a, b) => (a.number || "").localeCompare(b.number || ""));
    return groups;
  }, [accounts]);

  const save = async () => {
    if (!balanced) {
      toast.error("Journal must balance and have at least one debit");
      return;
    }
    const payloadLines = numericLines.filter((ln) => ln.account_id && (ln.debit > 0 || ln.credit > 0));
    if (payloadLines.length < 2) {
      toast.error("At least 2 non-zero lines with an account are required");
      return;
    }
    setSaving(true);
    try {
      await api.post("/books/journal-entries/manual", {
        entity_id: entityId,
        date,
        memo,
        lines: payloadLines,
      });
      toast.success("Manual journal entry posted");
      onSaved();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" data-testid="manual-journal-modal">
      <div className="bg-white max-w-4xl w-full max-h-[92vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-zinc-200 flex items-center justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-widest text-violet-700">New Manual Journal Entry</div>
            <div className="text-lg font-black uppercase tracking-wider text-zinc-900 mt-0.5">{entityName || "—"}</div>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-900" data-testid="close-manual-journal">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-1">Posting Date *</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full border border-zinc-300 px-3 py-2 text-sm font-mono focus:outline-none focus:border-violet-700"
                data-testid="manual-journal-date"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-1">Memo / Description *</label>
              <input
                type="text"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="e.g., Owner draw — Q3 distribution, Year-end accrual"
                className="w-full border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:border-violet-700"
                data-testid="manual-journal-memo"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Journal Lines</div>
              <button
                onClick={addLine}
                className="text-xs font-bold uppercase tracking-wider text-violet-700 hover:text-violet-900 inline-flex items-center gap-1"
                data-testid="add-journal-line"
              >
                <Plus className="w-3.5 h-3.5" /> Add line
              </button>
            </div>
            <table className="w-full text-sm border border-zinc-200">
              <thead className="bg-zinc-50 text-[10px] uppercase tracking-widest text-zinc-500 font-bold">
                <tr>
                  <th className="text-left px-3 py-2 w-12">#</th>
                  <th className="text-left px-3 py-2">Account</th>
                  <th className="text-right px-3 py-2 w-32">Debit</th>
                  <th className="text-right px-3 py-2 w-32">Credit</th>
                  <th className="text-left px-3 py-2">Line Memo</th>
                  <th className="px-3 py-2 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((ln, idx) => (
                  <tr key={idx} className="border-t border-zinc-200">
                    <td className="px-3 py-2 font-mono text-xs text-zinc-500">{idx + 1}</td>
                    <td className="px-3 py-2">
                      <select
                        value={ln.account_id}
                        onChange={(e) => updateLine(idx, { account_id: e.target.value })}
                        className="w-full border border-zinc-300 px-2 py-1.5 text-sm focus:outline-none focus:border-violet-700"
                        data-testid={`manual-journal-account-${idx}`}
                      >
                        <option value="">— Select account —</option>
                        {Object.keys(groupedAccounts).map((t) => (
                          <optgroup key={t} label={t}>
                            {groupedAccounts[t].map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.number} · {a.name}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={ln.debit}
                        onChange={(e) => updateLine(idx, { debit: e.target.value, credit: e.target.value ? "" : ln.credit })}
                        placeholder="0.00"
                        className="w-full border border-zinc-300 px-2 py-1.5 text-sm font-mono text-right focus:outline-none focus:border-violet-700"
                        data-testid={`manual-journal-debit-${idx}`}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={ln.credit}
                        onChange={(e) => updateLine(idx, { credit: e.target.value, debit: e.target.value ? "" : ln.debit })}
                        placeholder="0.00"
                        className="w-full border border-zinc-300 px-2 py-1.5 text-sm font-mono text-right focus:outline-none focus:border-violet-700"
                        data-testid={`manual-journal-credit-${idx}`}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={ln.memo}
                        onChange={(e) => updateLine(idx, { memo: e.target.value })}
                        placeholder="Optional"
                        className="w-full border border-zinc-300 px-2 py-1.5 text-sm focus:outline-none focus:border-violet-700"
                        data-testid={`manual-journal-line-memo-${idx}`}
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      {lines.length > 2 && (
                        <button
                          onClick={() => removeLine(idx)}
                          className="text-zinc-400 hover:text-rose-600"
                          data-testid={`remove-journal-line-${idx}`}
                          title="Remove line"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-zinc-50 border-t-2 border-zinc-300">
                <tr>
                  <td colSpan={2} className="px-3 py-2 text-xs font-bold uppercase tracking-wider text-zinc-700 text-right">Totals</td>
                  <td className="px-3 py-2 font-mono font-black text-blue-700 text-right" data-testid="manual-journal-total-dr">
                    {fmtMoney(totals.dr)}
                  </td>
                  <td className="px-3 py-2 font-mono font-black text-emerald-700 text-right" data-testid="manual-journal-total-cr">
                    {fmtMoney(totals.cr)}
                  </td>
                  <td colSpan={2} className="px-3 py-2 text-xs font-bold">
                    {balanced ? (
                      <span className="text-emerald-700" data-testid="manual-journal-balance-status">✓ Balanced</span>
                    ) : (
                      <span className="text-rose-700" data-testid="manual-journal-balance-status">
                        Out of balance by {fmtMoney(Math.abs(diff))}
                      </span>
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="bg-violet-50 border border-violet-200 px-4 py-3 text-xs text-violet-900">
            <strong>Use cases:</strong> owner draws (DR 3900 Distributions / CR 1000 Bank), year-end accruals,
            depreciation true-ups, reclassifications, and any adjustment not tied to an invoice or vendor bill.
            Manual entries can be reversed from the Activity feed; system-generated entries cannot.
          </div>
        </div>

        <div className="px-6 py-4 border-t border-zinc-200 flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-bold uppercase tracking-wider border border-zinc-300 hover:border-zinc-500 transition-colors"
          >
            Cancel
          </button>
          <button
            data-testid="save-manual-journal"
            onClick={save}
            disabled={saving || !balanced || !memo.trim()}
            className="px-4 py-2 text-xs font-bold uppercase tracking-wider bg-violet-700 text-white hover:bg-violet-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "Posting..." : "Post Journal Entry"}
          </button>
        </div>
      </div>
    </div>
  );
}

