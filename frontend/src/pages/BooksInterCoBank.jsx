import React, { useEffect, useMemo, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import { Network, CheckCircle2, AlertTriangle, RefreshCw, Lock, Unlock, Save, Trash2, Plus } from "lucide-react";

const fmtMoney = (n) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);
const fmtMoneyExact = (n) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(n || 0);

// ============================================
// Inter-Company Reconciliation
// ============================================
export function InterCompanyReport() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get("/books/reports/inter-company");
      setData(r.data);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  return (
    <div className="px-8 py-6" data-testid="ic-report">
      <div className="bg-white border border-zinc-200">
        <div className="px-5 py-4 border-b border-zinc-200 flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="font-heading text-lg font-bold tracking-tight flex items-center gap-2">
              <Network className="w-5 h-5 text-blue-700" />
              Inter-Company Reconciliation
            </h2>
            <p className="text-xs text-zinc-500 mt-1">
              Auto-pivots all <span className="font-mono">1900</span> Inter-Co A/R and <span className="font-mono">2900</span> Inter-Co A/P balances by counter-entity pair. Every A→B Receivable should equal B→A Payable to the penny.
            </p>
          </div>
          <button onClick={load} className="px-3 py-2 text-xs font-bold uppercase tracking-wider border border-zinc-300 hover:border-blue-700 hover:text-blue-700 transition-colors flex items-center gap-2" data-testid="ic-refresh">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>

        {loading && <div className="p-8 text-sm text-zinc-500">Loading...</div>}
        {!loading && data && data.rows.length === 0 && (
          <div className="p-8 text-center text-sm text-zinc-500">
            No inter-company activity yet. Create an invoice or vendor bill with a Counter Entity selected to start.
          </div>
        )}
        {!loading && data && data.rows.length > 0 && (
          <>
            <div className={`px-5 py-3 border-b border-zinc-200 flex items-center gap-3 ${data.all_balanced ? "bg-emerald-50" : "bg-rose-50"}`}>
              {data.all_balanced ? <CheckCircle2 className="w-5 h-5 text-emerald-700" /> : <AlertTriangle className="w-5 h-5 text-rose-700" />}
              <div className="text-sm">
                <span className="font-bold uppercase tracking-wider text-xs">{data.all_balanced ? "All inter-co pairs balanced" : `Out of balance by ${fmtMoneyExact(data.total_out_of_balance)}`}</span>
                <span className="ml-3 text-zinc-500">as of {data.as_of}</span>
              </div>
            </div>
            <table className="w-full text-sm" data-testid="ic-table">
              <thead className="bg-zinc-50 text-[10px] uppercase tracking-widest text-zinc-500 font-bold">
                <tr>
                  <th className="text-left px-4 py-2">Pair</th>
                  <th className="text-right px-4 py-2">A → Receivable from B</th>
                  <th className="text-right px-4 py-2">B → Payable to A</th>
                  <th className="text-right px-4 py-2">Δ</th>
                  <th className="text-right px-4 py-2">A → Payable to B</th>
                  <th className="text-right px-4 py-2">B → Receivable from A</th>
                  <th className="text-right px-4 py-2">Δ</th>
                  <th className="text-center px-4 py-2 w-20">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.entity_a_id + r.entity_b_id} className="border-t border-zinc-100" data-testid={`ic-row-${r.entity_a_id}-${r.entity_b_id}`}>
                    <td className="px-4 py-2">
                      <div className="font-bold">{r.entity_a_name}</div>
                      <div className="text-[10px] text-zinc-500 uppercase tracking-widest">↔ {r.entity_b_name}</div>
                    </td>
                    <td className="px-4 py-2 text-right font-mono">{fmtMoney(r.a_receivable_from_b)}</td>
                    <td className="px-4 py-2 text-right font-mono">{fmtMoney(r.b_payable_to_a)}</td>
                    <td className={`px-4 py-2 text-right font-mono font-bold ${Math.abs(r.diff_recv_vs_payable) < 0.01 ? "text-emerald-700" : "text-rose-700"}`}>
                      {fmtMoneyExact(r.diff_recv_vs_payable)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono">{fmtMoney(r.a_payable_to_b)}</td>
                    <td className="px-4 py-2 text-right font-mono">{fmtMoney(r.b_receivable_from_a)}</td>
                    <td className={`px-4 py-2 text-right font-mono font-bold ${Math.abs(r.diff_payable_vs_recv) < 0.01 ? "text-emerald-700" : "text-rose-700"}`}>
                      {fmtMoneyExact(r.diff_payable_vs_recv)}
                    </td>
                    <td className="px-4 py-2 text-center">
                      {r.balanced ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 font-bold text-[10px] uppercase tracking-widest"><CheckCircle2 className="w-3 h-3" />OK</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-rose-700 font-bold text-[10px] uppercase tracking-widest"><AlertTriangle className="w-3 h-3" />OFF</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}

// ============================================
// Bank Reconciliation
// ============================================
export function BankReconciliationTool({ entityId, entityName }) {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [accounts, setAccounts] = useState([]);
  const [accountId, setAccountId] = useState("");
  const [history, setHistory] = useState([]);
  const [active, setActive] = useState(null); // active rec (loaded or new)

  // Load bank accounts when entity changes
  useEffect(() => {
    if (!entityId) return;
    api.get(`/books/bank-rec/accounts?entity_id=${entityId}`).then((r) => {
      setAccounts(r.data || []);
      if (r.data?.length && !accountId) setAccountId(r.data[0].id);
    }).catch(() => setAccounts([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId]);

  const loadHistory = async () => {
    if (!entityId) return;
    try {
      const r = await api.get(`/books/bank-rec/list?entity_id=${entityId}`);
      setHistory((r.data || []).filter((x) => !accountId || x.account_id === accountId));
    } catch (e) {
      // non-fatal
    }
  };
  useEffect(() => { loadHistory(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [entityId, accountId]);

  const newRecon = () => {
    if (!accountId) { toast.error("Pick a bank account first"); return; }
    setActive({
      is_new: true,
      entity_id: entityId,
      account_id: accountId,
      statement_date: new Date().toISOString().slice(0, 10),
      statement_balance: 0,
      cleared_journal_ids: [],
      status: "open",
    });
  };

  const openExisting = async (rec) => {
    setActive({ ...rec, is_new: false });
  };

  const account = useMemo(() => accounts.find((a) => a.id === accountId), [accounts, accountId]);

  return (
    <div className="px-8 py-6" data-testid="bank-rec-tool">
      {/* Header card */}
      <div className="bg-white border border-zinc-200">
        <div className="px-5 py-4 border-b border-zinc-200 flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="font-heading text-lg font-bold tracking-tight">Bank Reconciliation · {entityName}</h2>
            <p className="text-xs text-zinc-500 mt-1">Match the GL to your bank statement — toggle cleared, then lock the recon to persist clearings.</p>
          </div>
          {isAdmin && (
            <button onClick={newRecon} className="px-3 py-2 text-xs font-bold uppercase tracking-wider bg-blue-700 text-white hover:bg-blue-800 transition-colors flex items-center gap-2" data-testid="br-new-btn">
              <Plus className="w-3.5 h-3.5" /> New Reconciliation
            </button>
          )}
        </div>
        <div className="p-5">
          <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Bank Account</label>
          <select
            value={accountId}
            onChange={(e) => { setAccountId(e.target.value); setActive(null); }}
            className="mt-1 w-full md:w-96 h-9 px-2 border border-zinc-300 rounded-sm text-sm bg-white"
            data-testid="br-account-select"
          >
            {accounts.map((a) => <option key={a.id} value={a.id}>{`${a.number} — ${a.name}`}</option>)}
          </select>
        </div>
      </div>

      {/* Active reconciliation editor */}
      {active && (
        <ReconEditor
          rec={active}
          account={account}
          isAdmin={isAdmin}
          onClose={() => { setActive(null); loadHistory(); }}
        />
      )}

      {/* History */}
      <div className="mt-6">
        <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-700 mb-2">Reconciliation History</h3>
        {history.length === 0 ? (
          <div className="bg-white border border-zinc-200 p-6 text-sm text-zinc-500">
            No reconciliations yet for this account. Click "New Reconciliation" to start.
          </div>
        ) : (
          <div className="bg-white border border-zinc-200" data-testid="br-history">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-[10px] uppercase tracking-widest text-zinc-500 font-bold">
                <tr>
                  <th className="text-left px-4 py-2">Statement Date</th>
                  <th className="text-right px-4 py-2">Statement Bal</th>
                  <th className="text-right px-4 py-2">Cleared Total</th>
                  <th className="text-right px-4 py-2">Reconciled Bal</th>
                  <th className="text-right px-4 py-2">Difference</th>
                  <th className="text-center px-4 py-2 w-24">Status</th>
                  <th className="text-right px-4 py-2 w-24"></th>
                </tr>
              </thead>
              <tbody>
                {history.map((r) => (
                  <tr key={r.id} className="border-t border-zinc-100" data-testid={`br-row-${r.id}`}>
                    <td className="px-4 py-2 font-mono">{r.statement_date}</td>
                    <td className="px-4 py-2 text-right font-mono">{fmtMoney(r.statement_balance)}</td>
                    <td className="px-4 py-2 text-right font-mono">{fmtMoney(r.cleared_total)}</td>
                    <td className="px-4 py-2 text-right font-mono">{fmtMoney(r.reconciled_balance)}</td>
                    <td className={`px-4 py-2 text-right font-mono ${Math.abs(r.difference) < 0.01 ? "text-emerald-700" : "text-rose-700"}`}>{fmtMoneyExact(r.difference)}</td>
                    <td className="px-4 py-2 text-center">
                      {r.status === "locked" ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest bg-emerald-50 text-emerald-800 border border-emerald-200"><Lock className="w-3 h-3" /> Locked</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest bg-amber-50 text-amber-800 border border-amber-200"><Unlock className="w-3 h-3" /> Open</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button onClick={() => openExisting(r)} className="text-[10px] font-bold uppercase tracking-wider text-blue-700 hover:text-blue-900">Open</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function ReconEditor({ rec, account, isAdmin, onClose }) {
  const [lines, setLines] = useState(null);
  const [stmtBal, setStmtBal] = useState(rec.statement_balance || 0);
  const [stmtDate, setStmtDate] = useState(rec.statement_date);
  const [clearedIds, setClearedIds] = useState(() => new Set(rec.cleared_journal_ids || []));
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(rec.status || "open");

  const loadLines = async () => {
    try {
      const r = await api.get(`/books/bank-rec/lines?entity_id=${rec.entity_id}&account_id=${rec.account_id}&date_to=${stmtDate}`);
      setLines(r.data?.rows || []);
      // If this is a NEW rec, pre-mark already-cleared lines (from prior locked recs)
      if (rec.is_new) {
        const c = new Set();
        (r.data?.rows || []).forEach((ln) => { if (ln.cleared) c.add(ln.journal_id); });
        setClearedIds(c);
      }
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    }
  };
  useEffect(() => { loadLines(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [stmtDate]);

  const totals = useMemo(() => {
    if (!lines) return { cleared: 0, uncleared: 0, gl: 0 };
    let cleared = 0, gl = 0;
    for (const ln of lines) {
      const sign = (ln.debit || 0) - (ln.credit || 0);
      gl += sign;
      if (clearedIds.has(ln.journal_id)) cleared += sign;
    }
    return { cleared: Math.round(cleared * 100) / 100, uncleared: Math.round((gl - cleared) * 100) / 100, gl: Math.round(gl * 100) / 100 };
  }, [lines, clearedIds]);

  const difference = Math.round((totals.cleared - Number(stmtBal)) * 100) / 100;

  const toggle = (id) => {
    const next = new Set(clearedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setClearedIds(next);
  };

  const save = async (newStatus) => {
    setSaving(true);
    try {
      const body = {
        id: rec.is_new ? undefined : rec.id,
        entity_id: rec.entity_id,
        account_id: rec.account_id,
        statement_date: stmtDate,
        statement_balance: Number(stmtBal),
        cleared_journal_ids: Array.from(clearedIds),
        status: newStatus || status,
      };
      const r = await api.post("/books/bank-rec/save", body);
      if (r.data?.error) { toast.error(r.data.error); return; }
      toast.success(newStatus === "locked" ? "Reconciliation locked" : "Saved");
      onClose();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setSaving(false);
    }
  };

  const reopen = async () => {
    if (!window.confirm("Reopen this locked reconciliation? Clearings tied to it will be unwound.")) return;
    setSaving(true);
    try {
      await api.post(`/books/bank-rec/${rec.id}/reopen`);
      toast.success("Reopened");
      onClose();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setSaving(false);
    }
  };

  const del = async () => {
    if (!window.confirm("Delete this reconciliation?")) return;
    setSaving(true);
    try {
      await api.delete(`/books/bank-rec/${rec.id}`);
      toast.success("Deleted");
      onClose();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setSaving(false);
    }
  };

  const locked = status === "locked";

  return (
    <div className="mt-4 bg-white border border-zinc-200" data-testid="recon-editor">
      <div className="px-5 py-3 bg-zinc-50 border-b border-zinc-200 flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-blue-700">
            {rec.is_new ? "New Reconciliation" : `Reconciliation ${rec.id?.slice(0, 8)}`}
          </div>
          <div className="font-bold text-sm">{account?.number} — {account?.name}</div>
        </div>
        <div className="flex items-center gap-2">
          {locked && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest bg-emerald-50 text-emerald-800 border border-emerald-200"><Lock className="w-3 h-3" /> Locked</span>
          )}
          <button onClick={onClose} className="px-3 py-1.5 text-xs font-bold uppercase tracking-wider border border-zinc-300 hover:border-zinc-500 transition-colors">Close</button>
        </div>
      </div>

      <div className="p-5 grid grid-cols-2 md:grid-cols-4 gap-4">
        <div>
          <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Statement Date</label>
          <input type="date" value={stmtDate} disabled={locked} onChange={(e) => setStmtDate(e.target.value)} className="mt-1 w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm bg-white disabled:bg-zinc-50" data-testid="br-stmt-date" />
        </div>
        <div>
          <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Statement Balance</label>
          <input type="number" step="0.01" value={stmtBal} disabled={locked} onChange={(e) => setStmtBal(parseFloat(e.target.value) || 0)} className="mt-1 w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm bg-white disabled:bg-zinc-50 font-mono" data-testid="br-stmt-balance" />
        </div>
        <SnapCell label="GL Balance" value={fmtMoney(totals.gl)} />
        <SnapCell label="Cleared Total" value={fmtMoney(totals.cleared)} tone="blue" />
      </div>

      {/* Diff banner */}
      <div className={`px-5 py-3 border-t ${Math.abs(difference) < 0.01 ? "bg-emerald-50 border-emerald-200" : "bg-rose-50 border-rose-200"} flex items-center justify-between`}>
        <div className="flex items-center gap-2">
          {Math.abs(difference) < 0.01 ? <CheckCircle2 className="w-4 h-4 text-emerald-700" /> : <AlertTriangle className="w-4 h-4 text-rose-700" />}
          <span className="text-xs font-bold uppercase tracking-wider">
            {Math.abs(difference) < 0.01 ? "Reconciles" : `Off by ${fmtMoneyExact(difference)}`}
          </span>
        </div>
        <div className="text-xs text-zinc-600">
          Cleared {fmtMoney(totals.cleared)} vs Statement {fmtMoney(stmtBal)}
        </div>
      </div>

      {/* Lines */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid="recon-lines-table">
          <thead className="bg-zinc-50 text-[10px] uppercase tracking-widest text-zinc-500 font-bold">
            <tr>
              <th className="text-center px-3 py-2 w-12">✓</th>
              <th className="text-left px-3 py-2 w-28">Date</th>
              <th className="text-left px-3 py-2">Memo</th>
              <th className="text-right px-3 py-2 w-28">Deposit</th>
              <th className="text-right px-3 py-2 w-28">Payment</th>
            </tr>
          </thead>
          <tbody>
            {lines === null && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-zinc-500 text-xs">Loading...</td></tr>
            )}
            {lines && lines.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-zinc-500 text-xs">No bank activity through {stmtDate}</td></tr>
            )}
            {lines && lines.map((ln) => (
              <tr key={ln.journal_id} className={`border-t border-zinc-100 ${clearedIds.has(ln.journal_id) ? "bg-emerald-50/30" : ""}`} data-testid={`recon-line-${ln.journal_id}`}>
                <td className="px-3 py-2 text-center">
                  <input
                    type="checkbox"
                    checked={clearedIds.has(ln.journal_id)}
                    onChange={() => toggle(ln.journal_id)}
                    disabled={locked}
                  />
                </td>
                <td className="px-3 py-2 font-mono text-xs text-zinc-600">{ln.date}</td>
                <td className="px-3 py-2 text-zinc-800 truncate">{ln.memo}</td>
                <td className="px-3 py-2 text-right font-mono text-xs font-bold text-emerald-700">{ln.debit > 0 ? fmtMoney(ln.debit) : ""}</td>
                <td className="px-3 py-2 text-right font-mono text-xs font-bold text-rose-700">{ln.credit > 0 ? fmtMoney(ln.credit) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Actions */}
      {isAdmin && (
        <div className="px-5 py-3 border-t border-zinc-200 flex items-center justify-end gap-2 flex-wrap">
          {!rec.is_new && !locked && (
            <button onClick={del} disabled={saving} className="px-3 py-1.5 text-xs font-bold uppercase tracking-wider border border-zinc-300 hover:border-rose-600 hover:text-rose-600 transition-colors flex items-center gap-2"><Trash2 className="w-3.5 h-3.5" /> Delete</button>
          )}
          {!rec.is_new && locked && (
            <button onClick={reopen} disabled={saving} className="px-3 py-1.5 text-xs font-bold uppercase tracking-wider border border-amber-400 text-amber-800 hover:bg-amber-50 transition-colors flex items-center gap-2" data-testid="br-reopen-btn"><Unlock className="w-3.5 h-3.5" /> Reopen</button>
          )}
          {!locked && (
            <>
              <button onClick={() => save("open")} disabled={saving} className="px-3 py-1.5 text-xs font-bold uppercase tracking-wider border border-zinc-300 hover:border-blue-700 hover:text-blue-700 transition-colors flex items-center gap-2" data-testid="br-save-open-btn"><Save className="w-3.5 h-3.5" /> Save Draft</button>
              <button onClick={() => save("locked")} disabled={saving || Math.abs(difference) > 0.01} title={Math.abs(difference) > 0.01 ? "Must reconcile to $0 difference to lock" : ""} className="px-3 py-1.5 text-xs font-bold uppercase tracking-wider bg-blue-700 text-white hover:bg-blue-800 transition-colors disabled:opacity-50 flex items-center gap-2" data-testid="br-lock-btn"><Lock className="w-3.5 h-3.5" /> Lock Reconciliation</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SnapCell({ label, value, tone }) {
  const toneClass = tone === "blue" ? "text-blue-700" : tone === "emerald" ? "text-emerald-700" : tone === "rose" ? "text-rose-700" : "text-zinc-900";
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={`font-mono font-black mt-0.5 ${toneClass}`}>{value}</div>
    </div>
  );
}
