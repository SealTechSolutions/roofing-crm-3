import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import { Lock, Unlock, FileCheck, AlertTriangle, Play, RefreshCw, CheckCircle2, ChevronRight, History } from "lucide-react";

const fmtMoney = (n) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);

const monthOptions = () => {
  // Last 18 months including current
  const out = [];
  const d = new Date();
  for (let i = 0; i < 18; i++) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    out.push({ value: `${y}-${m}`, label: d.toLocaleDateString("en-US", { month: "short", year: "numeric" }) });
    d.setMonth(d.getMonth() - 1);
  }
  return out;
};

export function PeriodCloseTool({ entityId, entities, onEntityRefresh }) {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const months = useMemo(monthOptions, []);
  // Default to LAST closed-month candidate = previous month
  const defaultPeriod = months[1]?.value || months[0]?.value;
  const [period, setPeriod] = useState(defaultPeriod);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [closes, setCloses] = useState([]);

  const entity = useMemo(() => entities.find((e) => e.id === entityId), [entities, entityId]);

  const loadPreview = async () => {
    if (!entityId || !period) return;
    setPreview(null);
    try {
      const r = await api.get(`/books/period-close/preview?entity_id=${entityId}&period=${period}`);
      setPreview(r.data);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    }
  };

  const loadCloses = async () => {
    if (!entityId) return;
    try {
      const r = await api.get(`/books/period-close/list?entity_id=${entityId}`);
      setCloses(r.data || []);
    } catch (e) {
      // non-fatal
    }
  };

  useEffect(() => { loadPreview(); loadCloses(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [entityId, period]);

  const runClose = async () => {
    if (!preview) return;
    const msg =
      `Close ${entity?.name} for ${period}?\n\n` +
      `• Accrue late fees: ${preview.actions.late_fee_accrual.invoices_eligible} invoice(s) · ${fmtMoney(preview.actions.late_fee_accrual.estimated_total)}\n` +
      `• Depreciation: ${preview.actions.depreciation.will_post ? fmtMoney(preview.actions.depreciation.amount) : "skip (set monthly depreciation on entity to enable)"}\n` +
      `• Snapshot P&L + Balance Sheet PDFs → Library\n` +
      `• Lock postings through ${preview.actions.lock_through_after}\n\n` +
      `This is reversible (admin can Reopen the period anytime).`;
    if (!window.confirm(msg)) return;
    setBusy(true);
    try {
      await api.post(`/books/period-close/run?entity_id=${entityId}&period=${period}`);
      toast.success(`${period} closed for ${entity?.name}`);
      await Promise.all([loadPreview(), loadCloses()]);
      onEntityRefresh && onEntityRefresh();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setBusy(false);
    }
  };

  const reopen = async (closedPeriod) => {
    if (!window.confirm(`Reopen ${entity?.name} for ${closedPeriod}? CRM postings dated within or before this period will be allowed again.`)) return;
    setBusy(true);
    try {
      await api.post(`/books/period-close/reopen?entity_id=${entityId}&period=${closedPeriod}`);
      toast.success(`${closedPeriod} reopened`);
      await Promise.all([loadPreview(), loadCloses()]);
      onEntityRefresh && onEntityRefresh();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!entityId) return <div className="p-8 text-zinc-500 text-sm">Select an entity to manage its monthly close.</div>;

  return (
    <div className="px-8 py-6" data-testid="period-close-tool">
      {/* Header card */}
      <div className="bg-white border border-zinc-200">
        <div className="px-5 py-4 border-b border-zinc-200 flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="font-heading text-lg font-bold tracking-tight flex items-center gap-2">
              <FileCheck className="w-5 h-5 text-blue-700" />
              Close the Books — {entity?.name}
            </h2>
            <p className="text-xs text-zinc-500 mt-1">
              Runs the late-fee accrual, posts depreciation, snapshots P&amp;L + Balance Sheet PDFs to the Library, and locks the period.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider font-bold text-zinc-500">Current lock</span>
            <span className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest border ${entity?.lock_through ? "bg-amber-50 text-amber-800 border-amber-200" : "bg-emerald-50 text-emerald-800 border-emerald-200"}`} data-testid="entity-lock-status">
              {entity?.lock_through ? `through ${entity.lock_through}` : "Open"}
            </span>
          </div>
        </div>

        <div className="p-5 grid grid-cols-1 md:grid-cols-3 gap-5">
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Period</label>
            <select
              data-testid="close-period-select"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="mt-1 w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm bg-white"
            >
              {months.map((m) => <option key={m.value} value={m.value}>{m.label} ({m.value})</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Monthly Depreciation</label>
            <div className="mt-1 px-2 h-9 border border-zinc-200 rounded-sm bg-zinc-50 flex items-center justify-between text-sm">
              <span className="font-mono font-bold" data-testid="close-monthly-depr">{fmtMoney(entity?.monthly_depreciation || 0)}</span>
              <span className="text-[10px] text-zinc-500">Edit on Entity</span>
            </div>
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Refresh Preview</label>
            <button onClick={loadPreview} className="mt-1 w-full h-9 px-2 border border-zinc-300 rounded-sm text-xs font-bold uppercase tracking-wider hover:border-blue-700 hover:text-blue-700 transition-colors flex items-center justify-center gap-2">
              <RefreshCw className="w-3.5 h-3.5" /> Reload
            </button>
          </div>
        </div>
      </div>

      {/* Preview */}
      {preview && (
        <div className="mt-4 bg-white border border-zinc-200" data-testid="close-preview">
          <div className="px-5 py-3 bg-zinc-50 border-b border-zinc-200 flex items-center justify-between">
            <div className="font-bold text-xs uppercase tracking-widest text-zinc-700">Close Preview · {preview.period}</div>
            {preview.already_closed && (
              <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest bg-emerald-50 text-emerald-800 border border-emerald-200 inline-flex items-center gap-1">
                <Lock className="w-3 h-3" /> Already Closed
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-0">
            <ActionRow
              label="① Late-Fee Accrual"
              detail={`${preview.actions.late_fee_accrual.invoices_eligible} invoice(s) > 30 days overdue`}
              amount={preview.actions.late_fee_accrual.estimated_total}
              willRun={preview.actions.late_fee_accrual.invoices_eligible > 0}
              testId="action-latefee"
            />
            <ActionRow
              label="② Depreciation Entry"
              detail={preview.actions.depreciation.will_post ? `DR 6600 / CR 1510` : "Set monthly_depreciation > 0 on entity"}
              amount={preview.actions.depreciation.amount}
              willRun={preview.actions.depreciation.will_post}
              testId="action-depr"
            />
            <ActionRow
              label="③ PDF Snapshots"
              detail="P&L + Balance Sheet → Library › Books › Period Close Snapshots"
              willRun
              testId="action-pdf"
            />
            <ActionRow
              label="④ Period Lock"
              detail={`Postings through ${preview.actions.lock_through_after} will be refused`}
              willRun
              testId="action-lock"
            />
          </div>
          {/* Snapshot totals */}
          <div className="border-t border-zinc-200 px-5 py-3 grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
            <SnapCell label="Revenue (period)" value={fmtMoney(preview.snapshot_totals.revenue)} />
            <SnapCell label="Net Income" value={fmtMoney(preview.snapshot_totals.net_income)} tone="blue" />
            <SnapCell label="Total Assets" value={fmtMoney(preview.snapshot_totals.assets)} />
            <SnapCell
              label="Balanced?"
              value={preview.snapshot_totals.balanced ? "✓ Yes" : "✗ No"}
              tone={preview.snapshot_totals.balanced ? "emerald" : "rose"}
            />
          </div>
          {!preview.snapshot_totals.balanced && (
            <div className="px-5 py-3 bg-rose-50 border-t border-rose-200 text-xs flex items-center gap-2 text-rose-800 font-bold">
              <AlertTriangle className="w-4 h-4" />
              Books are out of balance — fix before closing or you'll lock in the mismatch.
            </div>
          )}
          {/* Run button */}
          {isAdmin && (
            <div className="px-5 py-4 border-t border-zinc-200 flex items-center justify-between">
              <div className="text-[11px] text-zinc-500">Idempotent — running again on a closed period returns the existing record. Reopen first to fully re-run.</div>
              <button
                data-testid="close-run-btn"
                onClick={runClose}
                disabled={busy || preview.already_closed}
                className="px-4 py-2 text-xs font-bold uppercase tracking-wider bg-blue-700 text-white hover:bg-blue-800 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                <Play className="w-3.5 h-3.5" />
                {busy ? "Closing..." : (preview.already_closed ? "Already Closed" : `Close ${preview.period}`)}
              </button>
            </div>
          )}
        </div>
      )}

      {/* History */}
      <div className="mt-6">
        <div className="flex items-center gap-2 mb-2">
          <History className="w-4 h-4 text-zinc-700" />
          <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-700">Close History</h3>
        </div>
        {closes.length === 0 && (
          <div className="bg-white border border-zinc-200 p-6 text-sm text-zinc-500">
            No closes yet for this entity. Pick a period above and run your first close.
          </div>
        )}
        {closes.length > 0 && (
          <div className="bg-white border border-zinc-200" data-testid="close-history">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-[10px] uppercase tracking-widest text-zinc-500 font-bold">
                <tr>
                  <th className="text-left px-4 py-2">Period</th>
                  <th className="text-right px-4 py-2">Net Income</th>
                  <th className="text-right px-4 py-2">Late Fees</th>
                  <th className="text-right px-4 py-2">Depreciation</th>
                  <th className="text-left px-4 py-2">Status</th>
                  <th className="text-left px-4 py-2">PDFs</th>
                  <th className="text-right px-4 py-2 w-32"></th>
                </tr>
              </thead>
              <tbody>
                {closes.map((c) => (
                  <tr key={c.id} className="border-t border-zinc-100" data-testid={`close-row-${c.period}`}>
                    <td className="px-4 py-2 font-mono font-bold">{c.period}</td>
                    <td className="px-4 py-2 text-right font-mono">{fmtMoney(c.snapshot?.net_income)}</td>
                    <td className="px-4 py-2 text-right font-mono text-emerald-700">{fmtMoney(c.late_fee_accrual?.total_late_fees)}</td>
                    <td className="px-4 py-2 text-right font-mono">{fmtMoney(c.depreciation_posted)}</td>
                    <td className="px-4 py-2">
                      {c.is_reopened ? (
                        <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest bg-amber-50 text-amber-800 border border-amber-200 inline-flex items-center gap-1">
                          <Unlock className="w-3 h-3" /> Reopened
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest bg-emerald-50 text-emerald-800 border border-emerald-200 inline-flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" /> Closed
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-[11px]">
                      {(c.pdf_document_ids || []).length > 0 ? (
                        <Link to="/library" className="text-blue-700 hover:text-blue-900 inline-flex items-center gap-1 font-bold uppercase tracking-wider">
                          Library <ChevronRight className="w-3 h-3" />
                        </Link>
                      ) : <span className="text-zinc-400">—</span>}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {isAdmin && !c.is_reopened && (
                        <button
                          onClick={() => reopen(c.period)}
                          disabled={busy}
                          className="text-[10px] font-bold uppercase tracking-wider text-amber-700 hover:text-amber-900 inline-flex items-center gap-1"
                          data-testid={`reopen-${c.period}`}
                        >
                          <Unlock className="w-3 h-3" /> Reopen
                        </button>
                      )}
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

function ActionRow({ label, detail, amount, willRun, testId }) {
  return (
    <div className="px-5 py-3 border-b md:border-b-0 md:border-r border-zinc-100 last:border-r-0 flex items-start gap-3" data-testid={testId}>
      <div className={`mt-1 w-6 h-6 rounded-sm flex items-center justify-center text-xs font-bold ${willRun ? "bg-blue-50 text-blue-700" : "bg-zinc-100 text-zinc-400"}`}>
        {willRun ? "✓" : "—"}
      </div>
      <div className="flex-1">
        <div className="font-bold text-xs uppercase tracking-wider">{label}</div>
        <div className="text-[11px] text-zinc-500 mt-0.5">{detail}</div>
      </div>
      {typeof amount === "number" && (
        <div className={`font-mono font-bold text-sm ${willRun ? "text-zinc-900" : "text-zinc-400"}`}>{fmtMoney(amount)}</div>
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
