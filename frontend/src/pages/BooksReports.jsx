import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import { ChevronRight, Printer, AlertTriangle, Play, Download } from "lucide-react";

const fmtMoney = (n) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);
const fmtMoneyExact = (n) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(n || 0);

const todayISO = () => new Date().toISOString().slice(0, 10);
const monthStartISO = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
};
const yearStartISO = () => new Date().getFullYear() + "-01-01";

// =========================================================
// P&L Report
// =========================================================
export function ProfitLossReport({ entityId, entityName }) {
  const [dateFrom, setDateFrom] = useState(yearStartISO());
  const [dateTo, setDateTo] = useState(todayISO());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [drill, setDrill] = useState(null); // {account_id, account_name}

  const load = async () => {
    if (!entityId) return;
    setLoading(true);
    try {
      const r = await api.get(
        `/books/reports/profit-loss?entity_id=${entityId}&date_from=${dateFrom}&date_to=${dateTo}`
      );
      setData(r.data);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [entityId, dateFrom, dateTo]);

  if (!entityId) return <div className="p-8 text-zinc-500 text-sm">Select an entity.</div>;

  return (
    <div className="px-8 py-6" data-testid="pl-report">
      <ReportToolbar
        title="Profit & Loss"
        subtitle={`${entityName || ""} · ${dateFrom} → ${dateTo}`}
      >
        <DateRangeQuick
          dateFrom={dateFrom}
          dateTo={dateTo}
          onChange={(from, to) => { setDateFrom(from); setDateTo(to); }}
        />
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="border border-zinc-300 px-2 py-1.5 text-xs" data-testid="pl-date-from" />
        <span className="text-zinc-400 text-xs">→</span>
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="border border-zinc-300 px-2 py-1.5 text-xs" data-testid="pl-date-to" />
        <button onClick={() => window.print()} className="ml-auto px-3 py-1.5 text-xs font-bold uppercase tracking-wider border border-zinc-300 hover:border-blue-700 hover:text-blue-700 transition-colors flex items-center gap-2">
          <Printer className="w-3.5 h-3.5" /> Print
        </button>
      </ReportToolbar>

      {loading && <div className="text-sm text-zinc-500">Loading...</div>}
      {!loading && data && (
        <div className="bg-white border border-zinc-200">
          <ReportSection label="Revenue" rows={data.sections.Revenue} total={data.totals.revenue} entityId={entityId} dateFrom={dateFrom} dateTo={dateTo} onDrill={setDrill} />
          <ReportSection label="Cost of Goods Sold" rows={data.sections.COGS} total={data.totals.cogs} entityId={entityId} dateFrom={dateFrom} dateTo={dateTo} onDrill={setDrill} />
          <SubtotalRow label="Gross Profit" value={data.totals.gross_profit} hint={`Gross Margin ${data.totals.gross_margin_pct}%`} tone="emerald" testId="pl-gross-profit" />
          <ReportSection label="Operating Expense" rows={data.sections.Expense} total={data.totals.operating_expense} entityId={entityId} dateFrom={dateFrom} dateTo={dateTo} onDrill={setDrill} />
          <ReportSection label="Other Income / Expense" rows={data.sections.Other} total={data.totals.other_income_expense} entityId={entityId} dateFrom={dateFrom} dateTo={dateTo} onDrill={setDrill} />
          <SubtotalRow label="Net Income" value={data.totals.net_income} hint={`Net Margin ${data.totals.net_margin_pct}%`} tone="blue" big testId="pl-net-income" />
        </div>
      )}

      {drill && (
        <DrilldownModal
          entityId={entityId}
          account={drill}
          dateFrom={dateFrom}
          dateTo={dateTo}
          onClose={() => setDrill(null)}
        />
      )}
    </div>
  );
}

// =========================================================
// Balance Sheet
// =========================================================
export function BalanceSheetReport({ entityId, entityName }) {
  const [asOf, setAsOf] = useState(todayISO());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [drill, setDrill] = useState(null);

  const load = async () => {
    if (!entityId) return;
    setLoading(true);
    try {
      const r = await api.get(`/books/reports/balance-sheet?entity_id=${entityId}&as_of=${asOf}`);
      setData(r.data);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [entityId, asOf]);

  if (!entityId) return <div className="p-8 text-zinc-500 text-sm">Select an entity.</div>;

  return (
    <div className="px-8 py-6" data-testid="bs-report">
      <ReportToolbar title="Balance Sheet" subtitle={`${entityName || ""} · as of ${asOf}`}>
        <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">As of</span>
        <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="border border-zinc-300 px-2 py-1.5 text-xs" data-testid="bs-as-of" />
        <button onClick={() => window.print()} className="ml-auto px-3 py-1.5 text-xs font-bold uppercase tracking-wider border border-zinc-300 hover:border-blue-700 hover:text-blue-700 transition-colors flex items-center gap-2">
          <Printer className="w-3.5 h-3.5" /> Print
        </button>
      </ReportToolbar>

      {loading && <div className="text-sm text-zinc-500">Loading...</div>}
      {!loading && data && (
        <div className="bg-white border border-zinc-200">
          <ReportSection label="Assets" rows={data.sections.Asset} total={data.totals.assets} entityId={entityId} dateTo={asOf} onDrill={setDrill} hideTotal />
          <SubtotalRow label="Total Assets" value={data.totals.assets} tone="blue" big testId="bs-total-assets" />
          <ReportSection label="Liabilities" rows={data.sections.Liability} total={data.totals.liabilities} entityId={entityId} dateTo={asOf} onDrill={setDrill} hideTotal />
          <ReportSection label="Equity" rows={data.sections.Equity} total={data.totals.equity_accounts} entityId={entityId} dateTo={asOf} onDrill={setDrill} hideTotal />
          <div className="px-5 py-2 border-t border-zinc-200 flex items-center justify-between text-sm bg-zinc-50">
            <span className="italic text-zinc-700">Current-period earnings</span>
            <span className="font-mono font-bold">{fmtMoney(data.current_earnings)}</span>
          </div>
          <SubtotalRow label="Total Equity" value={data.totals.equity_total} tone="emerald" testId="bs-total-equity" />
          <SubtotalRow label="Total Liabilities + Equity" value={data.totals.liab_plus_equity} tone="blue" big testId="bs-total-leq" />
          {!data.totals.balanced && (
            <div className="px-5 py-3 bg-rose-50 border-t border-rose-200 text-xs flex items-center gap-2 text-rose-800 font-bold">
              <AlertTriangle className="w-4 h-4" />
              Out of balance by {fmtMoneyExact(data.totals.out_of_balance)} — check journals or reverse a duplicate.
            </div>
          )}
        </div>
      )}

      {drill && (
        <DrilldownModal entityId={entityId} account={drill} dateTo={asOf} onClose={() => setDrill(null)} />
      )}
    </div>
  );
}

// =========================================================
// Cash Flow Statement (Indirect Method)
// =========================================================
export function CashFlowReport({ entityId, entityName }) {
  const [dateFrom, setDateFrom] = useState(yearStartISO());
  const [dateTo, setDateTo] = useState(todayISO());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [drill, setDrill] = useState(null);

  const load = async () => {
    if (!entityId) return;
    setLoading(true);
    try {
      const r = await api.get(
        `/books/reports/cash-flow?entity_id=${entityId}&date_from=${dateFrom}&date_to=${dateTo}`
      );
      setData(r.data);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [entityId, dateFrom, dateTo]);

  if (!entityId) return <div className="p-8 text-zinc-500 text-sm">Select an entity.</div>;

  return (
    <div className="px-8 py-6" data-testid="cf-report">
      <ReportToolbar title="Cash Flow Statement" subtitle={`${entityName || ""} · ${dateFrom} → ${dateTo} · Indirect method`}>
        <DateRangeQuick dateFrom={dateFrom} dateTo={dateTo} onChange={(from, to) => { setDateFrom(from); setDateTo(to); }} />
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="border border-zinc-300 px-2 py-1.5 text-xs" data-testid="cf-date-from" />
        <span className="text-zinc-400 text-xs">→</span>
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="border border-zinc-300 px-2 py-1.5 text-xs" data-testid="cf-date-to" />
        <button onClick={() => window.print()} className="ml-auto px-3 py-1.5 text-xs font-bold uppercase tracking-wider border border-zinc-300 hover:border-blue-700 hover:text-blue-700 transition-colors flex items-center gap-2">
          <Printer className="w-3.5 h-3.5" /> Print
        </button>
      </ReportToolbar>

      {loading && <div className="text-sm text-zinc-500">Loading...</div>}
      {!loading && data && (
        <div className="bg-white border border-zinc-200">
          {/* ---------- OPERATING ---------- */}
          <div className="px-5 py-2 bg-zinc-50 text-[10px] font-bold uppercase tracking-widest text-zinc-700">Cash from Operating Activities</div>
          <CashFlowLine label="Net Income (from P&L)" value={data.operating.net_income} testId="cf-net-income" />
          {data.operating.depreciation > 0.005 && (
            <CashFlowLine label="+ Depreciation Expense (non-cash)" value={data.operating.depreciation} hint="Added back — no cash leaves the business" testId="cf-depreciation" />
          )}
          {data.operating.working_capital_items.length > 0 && (
            <div className="px-5 py-1.5 text-[10px] font-bold uppercase tracking-widest text-zinc-500 border-t border-zinc-100">Working Capital Changes</div>
          )}
          {data.operating.working_capital_items.map((it) => (
            <CashFlowWCLine
              key={it.account_id}
              item={it}
              entityId={entityId}
              dateFrom={dateFrom}
              dateTo={dateTo}
              onDrill={setDrill}
            />
          ))}
          <SubtotalRow label="Net Cash from Operating" value={data.operating.total} tone="emerald" testId="cf-operating-total" />

          {/* ---------- INVESTING ---------- */}
          <div className="px-5 py-2 bg-zinc-50 text-[10px] font-bold uppercase tracking-widest text-zinc-700 border-t border-zinc-200">Cash from Investing Activities</div>
          {data.investing.items.length === 0 ? (
            <div className="px-5 py-2.5 text-sm text-zinc-400 italic">No fixed-asset purchases or sales in this period</div>
          ) : (
            data.investing.items.map((it) => (
              <CashFlowWCLine
                key={it.account_id}
                item={it}
                entityId={entityId}
                dateFrom={dateFrom}
                dateTo={dateTo}
                onDrill={setDrill}
              />
            ))
          )}
          <SubtotalRow label="Net Cash from Investing" value={data.investing.total} tone="zinc" testId="cf-investing-total" />

          {/* ---------- FINANCING ---------- */}
          <div className="px-5 py-2 bg-zinc-50 text-[10px] font-bold uppercase tracking-widest text-zinc-700 border-t border-zinc-200">Cash from Financing Activities</div>
          {data.financing.items.length === 0 ? (
            <div className="px-5 py-2.5 text-sm text-zinc-400 italic">No long-term debt or equity movements in this period</div>
          ) : (
            data.financing.items.map((it) => (
              <CashFlowWCLine
                key={it.account_id}
                item={it}
                entityId={entityId}
                dateFrom={dateFrom}
                dateTo={dateTo}
                onDrill={setDrill}
              />
            ))
          )}
          <SubtotalRow label="Net Cash from Financing" value={data.financing.total} tone="zinc" testId="cf-financing-total" />

          {/* ---------- RECONCILIATION ---------- */}
          <SubtotalRow label="Net Change in Cash" value={data.totals.net_change_in_cash} tone="blue" big testId="cf-net-change" />
          <div className="px-5 py-2 flex items-center justify-between text-sm border-t border-zinc-200 bg-zinc-50/60">
            <span className="text-zinc-600">Beginning Cash ({dateFrom})</span>
            <span className="font-mono font-bold">{fmtMoneyExact(data.totals.beginning_cash)}</span>
          </div>
          <div className="px-5 py-2 flex items-center justify-between text-sm border-t border-zinc-100">
            <span className="text-zinc-600">Ending Cash ({dateTo})</span>
            <span className="font-mono font-bold">{fmtMoneyExact(data.totals.ending_cash)}</span>
          </div>
          <div className="px-5 py-2 flex items-center justify-between text-sm border-t border-zinc-100">
            <span className="text-zinc-600 italic">Actual Cash Change (from Bank ledgers)</span>
            <span className="font-mono font-bold">{fmtMoneyExact(data.totals.actual_cash_change)}</span>
          </div>
          {!data.totals.reconciled ? (
            <div className="px-5 py-3 bg-rose-50 border-t border-rose-200 text-xs flex items-center gap-2 text-rose-800 font-bold" data-testid="cf-reconcile-warn">
              <AlertTriangle className="w-4 h-4" />
              Reconciliation off by {fmtMoneyExact(data.totals.reconciliation_diff)} — check journals or unclassified accounts.
            </div>
          ) : (
            <div className="px-5 py-2 bg-emerald-50 border-t border-emerald-200 text-[11px] font-bold uppercase tracking-widest text-emerald-800" data-testid="cf-reconcile-ok">
              ✓ Reconciles with Bank ledger movement
            </div>
          )}
        </div>
      )}

      {drill && (
        <DrilldownModal entityId={entityId} account={drill} dateFrom={dateFrom} dateTo={dateTo} onClose={() => setDrill(null)} />
      )}
    </div>
  );
}

function CashFlowLine({ label, value, hint, testId }) {
  return (
    <div className="px-5 py-1.5 flex items-center justify-between text-sm border-t border-zinc-100" data-testid={testId}>
      <div className="text-zinc-800">
        {label}
        {hint && <div className="text-[10px] text-zinc-400 mt-0.5">{hint}</div>}
      </div>
      <span className="font-mono font-bold text-zinc-900">{fmtMoney(value)}</span>
    </div>
  );
}

function CashFlowWCLine({ item, entityId, dateFrom, dateTo, onDrill }) {
  // For Asset accounts: increase (delta>0) consumes cash → red; decrease → green
  // For Liability/Equity: increase (delta>0) provides cash → green; decrease → red
  const cash = item.cash_impact;
  const isAsset = item.account_type === "Asset";
  const verb = isAsset
    ? (item.delta > 0 ? "Increase in" : "Decrease in")
    : (item.delta > 0 ? "Increase in" : "Decrease in");
  return (
    <button
      onClick={() => onDrill({ account_id: item.account_id, account_number: item.account_number, account_name: item.account_name })}
      className="w-full px-5 py-1.5 flex items-center justify-between hover:bg-blue-50 transition-colors text-sm border-t border-zinc-100"
      data-testid={`cf-wc-${item.account_number}`}
    >
      <span className="text-zinc-700 text-left">
        <span className="font-mono text-xs text-zinc-400 mr-2">{item.account_number}</span>
        {verb} {item.account_name}
      </span>
      <span className={`font-mono font-bold ${cash >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
        {cash >= 0 ? "+" : ""}{fmtMoney(cash)}
      </span>
    </button>
  );
}

// =========================================================
// Late-Fee Accrual Tool
// =========================================================
export function LateFeeAccrualTool({ entities }) {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [entityId, setEntityId] = useState("");  // "" = all entities
  const [asOf, setAsOf] = useState(todayISO());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  if (!isAdmin) {
    return <div className="p-8 text-zinc-500 text-sm">Admin only — Late-Fee accrual must be approved before posting to the GL.</div>;
  }

  const run = async () => {
    if (!window.confirm(`Accrue 1.5% late fees for invoices > 30 days overdue as of ${asOf}?\n\nThis is idempotent — re-running for the same month overwrites the previous accrual.`)) return;
    setBusy(true);
    setResult(null);
    try {
      const params = new URLSearchParams({ as_of: asOf });
      if (entityId) params.set("entity_id", entityId);
      const r = await api.post(`/books/late-fees/accrue?${params}`);
      setResult(r.data);
      toast.success(`Accrued ${fmtMoney(r.data.total_late_fees)} across ${r.data.invoices_accrued} invoices`);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-8 py-6 max-w-3xl" data-testid="late-fee-tool">
      <div className="bg-white border border-zinc-200">
        <div className="px-5 py-4 border-b border-zinc-200">
          <h2 className="font-heading text-lg font-bold tracking-tight">Month-End Late Fee Accrual</h2>
          <p className="text-xs text-zinc-500 mt-1">
            Posts a 1.5% monthly fee (DR 1100 A/R ↔ CR 4200 Late Fees Earned) on every unpaid invoice past its 30-day grace period.
            Run once per month after closing.
          </p>
        </div>
        <div className="p-5 grid grid-cols-2 gap-4">
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Entity (blank = all entities)</label>
            <select
              data-testid="late-fee-entity"
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
              className="mt-1 w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm bg-white"
            >
              <option value="">— All Entities —</option>
              {entities.map((e) => (
                <option key={e.id} value={e.id}>{e.name}{e.is_parent ? "  (Parent)" : ""}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">As-of Date</label>
            <input
              data-testid="late-fee-as-of"
              type="date"
              value={asOf}
              onChange={(e) => setAsOf(e.target.value)}
              className="mt-1 w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm bg-white"
            />
          </div>
        </div>
        <div className="px-5 py-3 border-t border-zinc-200 flex items-center justify-between">
          <div className="text-[11px] text-zinc-500">
            Rule: balance × 1.5% per month, more than 30 days overdue. Posting key includes the month so re-runs are safe.
          </div>
          <button
            data-testid="late-fee-run-btn"
            onClick={run}
            disabled={busy}
            className="px-4 py-2 text-xs font-bold uppercase tracking-wider bg-blue-700 text-white hover:bg-blue-800 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            <Play className="w-3.5 h-3.5" />
            {busy ? "Running..." : "Run Accrual"}
          </button>
        </div>
      </div>

      {result && (
        <div className="mt-4 bg-emerald-50 border border-emerald-200 p-5" data-testid="late-fee-result">
          <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-700 mb-3">Last Run Summary</div>
          <div className="grid grid-cols-4 gap-4">
            <ResultCell label="Period" value={result.period} />
            <ResultCell label="Invoices Accrued" value={result.invoices_accrued} />
            <ResultCell label="Total Accrued" value={fmtMoney(result.total_late_fees)} accent />
            <ResultCell label="Skipped" value={result.invoices_skipped} hint="paid / no entity / not yet overdue" />
          </div>
        </div>
      )}
    </div>
  );
}

// =========================================================
// Aging Reports (A/R + A/P)
// =========================================================
export function AgingReport({ entityId, entityName, kind = "ar" }) {
  // kind: "ar" → Accounts Receivable | "ap" → Accounts Payable
  const isAr = kind === "ar";
  const [asOf, setAsOf] = useState(todayISO());
  const [data, setData] = useState(null);
  const [expanded, setExpanded] = useState({});

  useEffect(() => {
    if (!entityId) return;
    const path = isAr ? "ar-aging" : "ap-aging";
    api.get(`/books/reports/${path}?entity_id=${entityId}&as_of=${asOf}`)
      .then((r) => setData(r.data))
      .catch((e) => toast.error(formatApiError(e?.response?.data?.detail) || e.message));
  }, [entityId, asOf, isAr]);

  if (!data) return <div className="px-8 py-6 text-sm text-zinc-500">Loading...</div>;

  const t = data.totals || {};
  const groups = data.groups || [];
  const buckets = [
    { key: "current", label: "Current / Not Yet Due", tone: "bg-emerald-100 text-emerald-800" },
    { key: "b1_30", label: "1–30 Days", tone: "bg-blue-100 text-blue-800" },
    { key: "b31_60", label: "31–60 Days", tone: "bg-amber-100 text-amber-800" },
    { key: "b61_90", label: "61–90 Days", tone: "bg-orange-100 text-orange-800" },
    { key: "b90_plus", label: "90+ Days", tone: "bg-rose-100 text-rose-800" },
  ];

  const exportCsv = () => {
    const rows = [];
    rows.push([isAr ? "Customer" : "Vendor", "Doc #", "Date", "Due Date", "Days Past Due", "Bucket", "Balance", "Total", "Paid", "Status", "Project"]);
    for (const g of groups) {
      for (const r of g.rows) {
        rows.push([g.label, r.number, r.date, r.due_date, r.days_past_due, r.bucket, r.balance, r.total, r.amount_paid, r.status, r.project_title]);
      }
    }
    const csv = rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${isAr ? "AR" : "AP"}_Aging_${entityName || "entity"}_${asOf}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggle = (label) => setExpanded((e) => ({ ...e, [label]: !e[label] }));

  return (
    <div className="px-8 py-6" data-testid={`${kind}-aging-report`}>
      <ReportToolbar
        title={isAr ? "A/R Aging" : "A/P Aging"}
        subtitle={`${entityName || "—"} · As of ${data.as_of} · ${t.count || 0} open ${isAr ? "invoice" : "bill"}${(t.count || 0) === 1 ? "" : "s"}`}
      >
        <div className="flex items-center gap-2">
          <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">As Of</label>
          <input
            type="date"
            value={asOf}
            onChange={(e) => setAsOf(e.target.value)}
            className="h-8 px-2 border border-zinc-300 rounded-sm text-sm font-mono"
            data-testid={`${kind}-aging-asof`}
          />
          <button
            onClick={exportCsv}
            data-testid={`${kind}-aging-export`}
            disabled={(t.count || 0) === 0}
            className="inline-flex items-center gap-1 h-8 px-3 border border-zinc-300 rounded-sm text-[10px] font-bold uppercase tracking-wider hover:bg-zinc-50 disabled:opacity-40"
          >
            <Download className="w-3 h-3" /> CSV
          </button>
          <button onClick={() => window.print()} className="inline-flex items-center gap-1 h-8 px-3 border border-zinc-300 rounded-sm text-[10px] font-bold uppercase tracking-wider hover:bg-zinc-50">
            <Printer className="w-3 h-3" /> Print
          </button>
        </div>
      </ReportToolbar>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-2 mb-4">
        {buckets.map((b) => (
          <div key={b.key} className="border border-zinc-200 rounded-sm p-3 bg-white" data-testid={`${kind}-bucket-${b.key}`}>
            <div className={`inline-block px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest rounded-sm ${b.tone}`}>{b.label}</div>
            <div className="text-lg font-black mt-1 font-mono text-zinc-900">{fmtMoney(t[b.key])}</div>
          </div>
        ))}
        <div className="border-2 border-blue-700 rounded-sm p-3 bg-blue-50/40" data-testid={`${kind}-bucket-total`}>
          <div className="inline-block px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest rounded-sm bg-blue-700 text-white">Total Open</div>
          <div className="text-lg font-black mt-1 font-mono text-blue-900">{fmtMoney(t.balance)}</div>
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="bg-white border border-zinc-200 rounded-sm p-12 text-center text-sm text-zinc-500">
          No open {isAr ? "invoices" : "vendor bills"} for <strong>{entityName || "this entity"}</strong> as of {data.as_of}.
        </div>
      ) : (
        <div className="bg-white border border-zinc-200 rounded-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 border-b border-zinc-200 text-[10px] uppercase tracking-widest font-bold text-zinc-500">
              <tr>
                <th className="text-left px-4 py-2">{isAr ? "Customer" : "Vendor"}</th>
                <th className="text-right px-3 py-2 w-24">Current</th>
                <th className="text-right px-3 py-2 w-24">1–30</th>
                <th className="text-right px-3 py-2 w-24">31–60</th>
                <th className="text-right px-3 py-2 w-24">61–90</th>
                <th className="text-right px-3 py-2 w-24">90+</th>
                <th className="text-right px-3 py-2 w-28">Open Balance</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <React.Fragment key={g.label}>
                  <tr
                    className="border-b border-zinc-200 cursor-pointer hover:bg-zinc-50"
                    onClick={() => toggle(g.label)}
                    data-testid={`${kind}-group-${g.label}`}
                  >
                    <td className="px-4 py-2.5 font-bold text-zinc-900">
                      <span className="inline-block mr-1.5 text-zinc-400">{expanded[g.label] ? "▼" : "▶"}</span>
                      {g.label}
                      <span className="text-[10px] text-zinc-500 font-normal ml-2">({g.count} {g.count === 1 ? "doc" : "docs"})</span>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-zinc-700">{g.current > 0 ? fmtMoney(g.current) : "—"}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-blue-700">{g.b1_30 > 0 ? fmtMoney(g.b1_30) : "—"}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-amber-700">{g.b31_60 > 0 ? fmtMoney(g.b31_60) : "—"}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-orange-700">{g.b61_90 > 0 ? fmtMoney(g.b61_90) : "—"}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-rose-700 font-bold">{g.b90_plus > 0 ? fmtMoney(g.b90_plus) : "—"}</td>
                    <td className="px-3 py-2.5 text-right font-mono font-black text-zinc-900">{fmtMoney(g.balance)}</td>
                  </tr>
                  {expanded[g.label] && g.rows.map((r) => (
                    <tr key={r.id} className="border-b border-zinc-100 bg-zinc-50/40">
                      <td className="px-4 py-2 pl-12 text-xs text-zinc-700">
                        <Link
                          to={`${isAr ? "/invoices" : "/payables"}?focus=${encodeURIComponent(r.id)}`}
                          className="font-mono text-blue-700 hover:text-blue-900"
                        >
                          {r.number || "(no number)"}
                        </Link>
                        <span className="text-zinc-400 mx-1.5">·</span>
                        <span className="text-zinc-600">{r.project_title || "—"}</span>
                        <span className="text-zinc-400 mx-1.5">·</span>
                        <span className="text-zinc-500">Due {r.due_date || "—"}</span>
                        <span className="text-zinc-400 mx-1.5">·</span>
                        <span className={r.days_past_due > 60 ? "text-rose-700 font-bold" : "text-zinc-500"}>
                          {r.days_past_due < 0 ? `in ${-r.days_past_due}d` : `${r.days_past_due}d past`}
                        </span>
                      </td>
                      <td colSpan={5} className="px-3 py-2 text-right text-[10px] uppercase tracking-wider text-zinc-400">
                        Total {fmtMoney(r.total)} · Paid {fmtMoney(r.amount_paid)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-sm text-zinc-900 font-bold">{fmtMoneyExact(r.balance)}</td>
                    </tr>
                  ))}
                </React.Fragment>
              ))}
              <tr className="bg-blue-50 border-t-2 border-blue-700">
                <td className="px-4 py-3 text-[11px] font-black uppercase tracking-widest text-blue-900">Total</td>
                <td className="px-3 py-3 text-right font-mono font-black text-zinc-900">{fmtMoney(t.current)}</td>
                <td className="px-3 py-3 text-right font-mono font-black text-blue-700">{fmtMoney(t.b1_30)}</td>
                <td className="px-3 py-3 text-right font-mono font-black text-amber-700">{fmtMoney(t.b31_60)}</td>
                <td className="px-3 py-3 text-right font-mono font-black text-orange-700">{fmtMoney(t.b61_90)}</td>
                <td className="px-3 py-3 text-right font-mono font-black text-rose-700">{fmtMoney(t.b90_plus)}</td>
                <td className="px-3 py-3 text-right font-mono font-black text-blue-900 text-base">{fmtMoney(t.balance)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <div className="text-[10px] text-zinc-500 mt-3">
        Excludes draft, voided, and inter-company {isAr ? "invoices" : "vendor bills"}. Click a row to drill down.
      </div>
    </div>
  );
}


// =========================================================
// Building blocks
// =========================================================
function ReportToolbar({ title, subtitle, children }) {
  return (
    <div className="mb-4">
      <div className="flex items-baseline gap-4 mb-3 print:mb-1">
        <h1 className="text-xl font-black uppercase tracking-wider text-zinc-900">{title}</h1>
        <div className="text-xs uppercase tracking-widest text-zinc-500 font-bold">{subtitle}</div>
      </div>
      <div className="flex items-center gap-2 flex-wrap print:hidden">{children}</div>
    </div>
  );
}

function DateRangeQuick({ dateFrom, dateTo, onChange }) {
  const presets = [
    { label: "MTD", from: monthStartISO(), to: todayISO() },
    { label: "YTD", from: yearStartISO(), to: todayISO() },
    { label: "Last 30d", from: new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10), to: todayISO() },
    { label: "All", from: "2020-01-01", to: "2099-12-31" },
  ];
  return (
    <div className="flex items-center gap-1">
      {presets.map((p) => (
        <button
          key={p.label}
          onClick={() => onChange(p.from, p.to)}
          className={`px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest border transition-colors ${
            dateFrom === p.from && dateTo === p.to
              ? "border-blue-700 text-blue-700 bg-blue-50"
              : "border-zinc-300 text-zinc-600 hover:border-blue-700 hover:text-blue-700"
          }`}
          data-testid={`preset-${p.label.toLowerCase().replace(/[^a-z0-9]/g, "")}`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

function ReportSection({ label, rows, total, entityId, dateFrom, dateTo, onDrill, hideTotal }) {
  if (!rows?.length) return null;
  return (
    <div className="border-b border-zinc-200">
      <div className="px-5 py-2 bg-zinc-50 text-[10px] font-bold uppercase tracking-widest text-zinc-700">{label}</div>
      {rows.map((r) => (
        <button
          key={r.account_id}
          onClick={() => onDrill({ account_id: r.account_id, account_number: r.account_number, account_name: r.account_name })}
          className="w-full px-5 py-1.5 flex items-center justify-between hover:bg-blue-50 transition-colors text-sm"
          data-testid={`pl-row-${r.account_number}`}
        >
          <span className="font-mono text-xs text-zinc-700">
            <span className="text-zinc-400 mr-2">{r.account_number}</span>
            {r.account_name}
          </span>
          <span className="font-mono font-bold text-zinc-900">{fmtMoney(r.balance)}</span>
        </button>
      ))}
      {!hideTotal && (
        <div className="px-5 py-1.5 flex items-center justify-between text-sm border-t border-zinc-100 bg-zinc-50/60">
          <span className="font-bold text-xs uppercase tracking-wider text-zinc-700">Total {label}</span>
          <span className="font-mono font-black text-zinc-900">{fmtMoney(total)}</span>
        </div>
      )}
    </div>
  );
}

function SubtotalRow({ label, value, hint, tone = "zinc", big = false, testId }) {
  const tones = {
    blue: "bg-blue-50 border-blue-200 text-blue-900",
    emerald: "bg-emerald-50 border-emerald-200 text-emerald-900",
    zinc: "bg-zinc-100 border-zinc-200 text-zinc-900",
  };
  return (
    <div className={`px-5 ${big ? "py-4" : "py-2.5"} flex items-center justify-between border-t-2 ${tones[tone]}`} data-testid={testId}>
      <div>
        <div className={`font-black uppercase tracking-wider ${big ? "text-base" : "text-xs"}`}>{label}</div>
        {hint && <div className="text-[10px] text-zinc-600 mt-0.5">{hint}</div>}
      </div>
      <div className={`font-mono font-black ${big ? "text-2xl" : "text-base"}`}>{fmtMoney(value)}</div>
    </div>
  );
}

function ResultCell({ label, value, hint, accent }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={`font-mono font-black mt-0.5 ${accent ? "text-emerald-700 text-xl" : "text-zinc-900 text-base"}`}>{value}</div>
      {hint && <div className="text-[10px] text-zinc-400 mt-0.5">{hint}</div>}
    </div>
  );
}

function DrilldownModal({ entityId, account, dateFrom, dateTo, onClose }) {
  const [entries, setEntries] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams({ entity_id: entityId, account_id: account.account_id, limit: "200" });
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);
    api.get(`/books/journal-entries?${params}`).then((r) => setEntries(r.data || [])).catch(() => setEntries([]));
  }, [entityId, account, dateFrom, dateTo]);

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" data-testid="drilldown-modal">
      <div className="bg-white max-w-3xl w-full max-h-[80vh] flex flex-col">
        <div className="px-5 py-3 border-b border-zinc-200 flex items-center justify-between">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-blue-700">Account Drill-Down</div>
            <div className="font-bold text-zinc-900 mt-0.5">
              <span className="font-mono text-zinc-400 mr-2">{account.account_number}</span>
              {account.account_name}
            </div>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-900 text-2xl leading-none" data-testid="close-drilldown">×</button>
        </div>
        <div className="overflow-y-auto flex-1">
          {entries === null && <div className="p-8 text-sm text-zinc-500">Loading...</div>}
          {entries && entries.length === 0 && <div className="p-8 text-sm text-zinc-500">No journal entries hit this account in range.</div>}
          {entries && entries.length > 0 && (
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-[10px] uppercase tracking-widest text-zinc-500 font-bold sticky top-0">
                <tr>
                  <th className="text-left px-4 py-2 w-28">Date</th>
                  <th className="text-left px-4 py-2">Memo</th>
                  <th className="text-right px-4 py-2 w-24">DR</th>
                  <th className="text-right px-4 py-2 w-24">CR</th>
                  <th className="text-right px-4 py-2 w-28"></th>
                </tr>
              </thead>
              <tbody>
                {entries.map((j) => {
                  const line = (j.lines || []).find((l) => l.account_id === account.account_id);
                  if (!line) return null;
                  const sourcePath = j.source_type === "vendor_bill" ? `/payables?focus=${j.source_id}` : `/invoices?focus=${j.source_id}`;
                  return (
                    <tr key={j.id} className="border-t border-zinc-100">
                      <td className="px-4 py-2 font-mono text-xs text-zinc-600">{j.date}</td>
                      <td className="px-4 py-2 text-zinc-800 truncate" title={j.memo}>{j.memo}</td>
                      <td className="px-4 py-2 text-right font-mono text-xs font-bold text-blue-700">{line.debit > 0 ? fmtMoney(line.debit) : ""}</td>
                      <td className="px-4 py-2 text-right font-mono text-xs font-bold text-emerald-700">{line.credit > 0 ? fmtMoney(line.credit) : ""}</td>
                      <td className="px-4 py-2 text-right">
                        <Link to={sourcePath} onClick={onClose} className="text-[10px] font-bold uppercase tracking-wider text-blue-700 hover:text-blue-900 inline-flex items-center gap-1">
                          Open <ChevronRight className="w-3 h-3" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
