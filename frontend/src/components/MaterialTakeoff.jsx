import React, { useEffect, useMemo, useState } from "react";
import { api, formatCurrency, formatApiError, API } from "@/lib/api";
import { Plus, Search, X, Trash2, FileText, Mail, Package, Boxes, CheckCircle2, Circle, Truck, PackageCheck, Link2, TrendingDown, TrendingUp, Minus } from "lucide-react";
import { toast } from "sonner";

/**
 * MaterialTakeoff
 * ----------------
 * Project Material Take-Off — pick from catalog, build per-vendor PO PDFs.
 * Lives inside DealDetail. Receives the full deal object and a `reload` callback.
 */
export default function MaterialTakeoff({ deal, reload }) {
  const [showPicker, setShowPicker] = useState(false);
  const [showVariance, setShowVariance] = useState(false);
  const [varianceData, setVarianceData] = useState(null);
  const [linkerLine, setLinkerLine] = useState(null); // takeoff line currently being linked
  const dealId = deal.id;

  // Pull variance whenever the take-off changes (so Actual stays current with linked bills)
  useEffect(() => {
    let cancelled = false;
    const fetchVariance = async () => {
      try {
        const r = await api.get(`/deals/${dealId}/takeoff-variance`);
        if (!cancelled) setVarianceData(r.data);
      } catch (e) {
        if (!cancelled) setVarianceData(null);
      }
    };
    fetchVariance();
    return () => { cancelled = true; };
  }, [dealId, deal.material_takeoff]);

  // Build a map: takeoff_line_id → { actual, variance, variance_pct, linked_bills }
  const varianceByLine = useMemo(() => {
    const m = {};
    if (varianceData?.lines) {
      for (const ln of varianceData.lines) m[ln.id] = ln;
    }
    return m;
  }, [varianceData]);

  const varianceByVendor = useMemo(() => {
    const m = {};
    if (varianceData?.by_vendor) {
      for (const v of varianceData.by_vendor) m[v.vendor_name] = v;
    }
    return m;
  }, [varianceData]);

  // Group existing take-off lines by vendor
  const groups = useMemo(() => {
    const lines = deal.material_takeoff || [];
    const map = new Map();
    for (const ln of lines) {
      const key = ln.vendor_name || "Unassigned";
      if (!map.has(key)) map.set(key, { vendor_name: key, vendor_id: ln.vendor_id, lines: [], total: 0, qty: 0, ordered: 0, received: 0 });
      const g = map.get(key);
      g.lines.push(ln);
      g.total += Number(ln.line_total || 0);
      g.qty += Number(ln.quantity || 0);
      if (ln.ordered) g.ordered += 1;
      if (ln.received) g.received += 1;
    }
    return Array.from(map.values()).sort((a, b) => a.vendor_name.localeCompare(b.vendor_name));
  }, [deal.material_takeoff]);

  const grandTotal = useMemo(
    () => groups.reduce((s, g) => s + g.total, 0),
    [groups]
  );

  const removeLine = async (lineId) => {
    try {
      await api.delete(`/deals/${dealId}/takeoff/${lineId}`);
      await reload();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    }
  };

  const updateLine = async (lineId, patch) => {
    try {
      await api.put(`/deals/${dealId}/takeoff/${lineId}`, patch);
      await reload();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    }
  };

  const downloadPO = async (vendorId, vendorName) => {
    const token = localStorage.getItem("crm_token");
    const url = `${API}/deals/${dealId}/purchase-order/${vendorId}.pdf?token=${encodeURIComponent(token)}`;
    try {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        toast.error(err.detail || `Download failed (${r.status})`);
        return;
      }
      const blob = await r.blob();
      const dl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = dl;
      a.download = `PO_${(deal.title || "project").replace(/[^\w-]+/g, "_")}_${vendorName.replace(/\s+/g, "_")}.pdf`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(dl), 60000);
      toast.success(`PO downloaded for ${vendorName}`);
    } catch (e) {
      toast.error("Download failed");
    }
  };

  const emailPO = async (vendorId, vendorName) => {
    const to = window.prompt(`Send PO to ${vendorName} at which email?\n\n(leave blank to use the vendor's saved email)`);
    if (to === null) return;
    try {
      const r = await api.post(`/deals/${dealId}/purchase-order/${vendorId}/email`, { to_email: to || "" });
      toast.success(r.data.message || "PO emailed");
      await reload();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    }
  };

  return (
    <div className="bg-white border border-zinc-200 rounded-sm p-6 mb-6" data-testid="takeoff-card">
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-zinc-100 gap-3 flex-wrap">
        <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-500">
          <span className="inline-flex items-center gap-2">
            <Package className="w-3.5 h-3.5 text-blue-700" /> Material Take-Off
            {grandTotal > 0 && (
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-sm">
                Est. {formatCurrency(grandTotal)}
              </span>
            )}
            {varianceData?.totals?.actual > 0 && (
              <VarianceBadge
                variance={varianceData.totals.variance}
                variancePct={varianceData.totals.variance_pct}
                linked={varianceData.totals.linked_lines}
                total={varianceData.totals.lines}
                actual={varianceData.totals.actual}
              />
            )}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {groups.length > 0 && (
            <button
              onClick={() => setShowVariance((v) => !v)}
              className={`inline-flex items-center gap-2 px-3 h-9 text-[11px] font-bold uppercase tracking-wider rounded-sm transition-colors ${
                showVariance ? "bg-zinc-950 text-white" : "border border-zinc-300 text-zinc-700 hover:border-zinc-950"
              }`}
              data-testid="toggle-variance-view"
              title="Show Estimated vs Actual per line"
            >
              <TrendingUp className="w-3.5 h-3.5" /> {showVariance ? "Hide Variance" : "Show Variance"}
            </button>
          )}
          <button
            onClick={() => setShowPicker(true)}
            className="inline-flex items-center gap-2 bg-blue-700 text-white px-3 h-9 text-[11px] font-bold uppercase tracking-wider hover:bg-blue-800 rounded-sm"
            data-testid="takeoff-add-button"
          >
            <Plus className="w-3.5 h-3.5" /> Add Materials
          </button>
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="py-10 text-center">
          <Boxes className="w-8 h-8 text-zinc-300 mx-auto mb-3" />
          <div className="text-sm font-bold text-zinc-700 mb-1">No materials added yet.</div>
          <div className="text-xs text-zinc-500">
            Click <span className="font-bold text-blue-700">+ Add Materials</span> to pull items from the catalog,
            set quantities by size, and generate a Purchase Order PDF.
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <div key={g.vendor_name} className="border border-zinc-200 rounded-sm overflow-hidden" data-testid={`takeoff-vendor-${g.vendor_name}`}>
              <div className="flex items-center justify-between px-4 py-2.5 bg-zinc-950 text-white">
                <div className="flex items-center gap-3">
                  <span className="font-heading font-bold tracking-tight text-sm">{g.vendor_name}</span>
                  <span className="text-[10px] uppercase tracking-[0.2em] text-zinc-400">·</span>
                  <span className="text-[11px] uppercase tracking-wider text-zinc-300">
                    {g.lines.length} line{g.lines.length === 1 ? "" : "s"}  ·  {Number(g.qty)} unit{g.qty === 1 ? "" : "s"}  ·  Est. {formatCurrency(g.total)}
                  </span>
                  {(g.ordered > 0 || g.received > 0) && (
                    <span className="inline-flex items-center gap-2 text-[10px] uppercase tracking-wider text-zinc-300">
                      <span className="text-zinc-500">·</span>
                      {g.ordered > 0 && (
                        <span className="inline-flex items-center gap-1">
                          <Truck className="w-3 h-3 text-blue-300" />
                          <span className="font-bold text-white">{g.ordered}</span>/{g.lines.length} ordered
                        </span>
                      )}
                      {g.received > 0 && (
                        <span className="inline-flex items-center gap-1">
                          <PackageCheck className="w-3 h-3 text-emerald-300" />
                          <span className="font-bold text-white">{g.received}</span>/{g.lines.length} received
                        </span>
                      )}
                    </span>
                  )}
                  {varianceByVendor[g.vendor_name]?.actual > 0 && (
                    <VarianceBadge
                      variance={varianceByVendor[g.vendor_name].variance}
                      variancePct={varianceByVendor[g.vendor_name].variance_pct}
                      actual={varianceByVendor[g.vendor_name].actual}
                      compact
                    />
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {g.vendor_id && (
                    <>
                      <button
                        onClick={() => downloadPO(g.vendor_id, g.vendor_name)}
                        className="inline-flex items-center gap-1.5 px-2.5 h-7 bg-white text-zinc-950 hover:bg-zinc-100 rounded-sm text-[10px] font-bold uppercase tracking-wider"
                        title="Download Purchase Order PDF"
                        data-testid={`download-po-${g.vendor_name}`}
                      >
                        <FileText className="w-3 h-3" /> Download PO
                      </button>
                      <button
                        onClick={() => emailPO(g.vendor_id, g.vendor_name)}
                        className="inline-flex items-center gap-1.5 px-2.5 h-7 border border-white/40 text-white hover:bg-white/10 rounded-sm text-[10px] font-bold uppercase tracking-wider"
                        title="Email Purchase Order to vendor"
                        data-testid={`email-po-${g.vendor_name}`}
                      >
                        <Mail className="w-3 h-3" /> Email PO
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid={`takeoff-table-${g.vendor_name}`}>
                  <thead>
                    <tr className="border-b border-zinc-200 text-left text-[10px] uppercase tracking-wider bg-zinc-50">
                      <th className="py-2 px-3 w-14 text-center" title="Ordered — click the truck to toggle when the PO is placed">Ordered</th>
                      <th className="py-2 px-3 w-14 text-center" title="Received — click the box to toggle when material arrives on site">Received</th>
                      <th className="py-2 px-3 w-20 text-right">Qty</th>
                      <th className="py-2 px-3 w-28">Size / Unit</th>
                      <th className="py-2 px-3">Product</th>
                      <th className="py-2 px-3 w-24 text-right">Unit Cost</th>
                      <th className="py-2 px-3 w-24 text-right">Estimated</th>
                      {showVariance && (
                        <>
                          <th className="py-2 px-3 w-24 text-right" title="Sum of linked vendor-bill line items">Actual</th>
                          <th className="py-2 px-3 w-28 text-right" title="Actual − Estimated">Variance</th>
                        </>
                      )}
                      <th className="py-2 px-3 w-12"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.lines.map((ln) => (
                      <tr
                        key={ln.id}
                        className={`border-b border-zinc-100 transition-colors ${ln.received ? "bg-emerald-50/60" : ln.ordered ? "bg-blue-50/30" : ""}`}
                        data-testid={`takeoff-line-${ln.id}`}
                      >
                        <td className="py-2 px-3 text-center">
                          <button
                            onClick={() => updateLine(ln.id, { ordered: !ln.ordered })}
                            title={ln.ordered ? "Ordered — click to un-mark" : "Mark as ordered"}
                            className="inline-flex p-1 rounded-sm hover:bg-blue-100"
                            data-testid={`toggle-ordered-${ln.id}`}
                          >
                            {ln.ordered ? (
                              <Truck className="w-4 h-4 text-blue-600" />
                            ) : (
                              <Truck className="w-4 h-4 text-zinc-300" />
                            )}
                          </button>
                        </td>
                        <td className="py-2 px-3 text-center">
                          <button
                            onClick={() => {
                              const nextReceived = !ln.received;
                              // Marking as received implies ordered
                              updateLine(ln.id, nextReceived ? { received: true, ordered: true } : { received: false });
                            }}
                            title={ln.received ? "Received on site — click to un-mark" : "Mark as received on site"}
                            className="inline-flex p-1 rounded-sm hover:bg-emerald-100"
                            data-testid={`toggle-received-${ln.id}`}
                          >
                            {ln.received ? (
                              <PackageCheck className="w-4 h-4 text-emerald-600" />
                            ) : (
                              <Circle className="w-4 h-4 text-zinc-300" />
                            )}
                          </button>
                        </td>
                        <td className="py-2 px-3 text-right">
                          <input
                            type="number"
                            step="1"
                            min="0"
                            value={ln.quantity}
                            onChange={(e) => updateLine(ln.id, { quantity: Number(e.target.value || 0) })}
                            className="w-16 h-8 px-2 text-right border border-zinc-300 rounded-sm text-sm font-mono"
                            data-testid={`qty-${ln.id}`}
                          />
                        </td>
                        <td className="py-2 px-3 text-zinc-700 text-[12px]">{ln.unit || "—"}</td>
                        <td className="py-2 px-3">
                          <div className="font-bold text-zinc-950 leading-tight">
                            {(ln.name || "").split(" — ")[0]}
                          </div>
                          {ln.sku && (
                            <div className="text-[10px] text-zinc-500 mt-0.5 font-mono">SKU {ln.sku}</div>
                          )}
                          {ln.notes && (
                            <div className="text-[11px] text-zinc-500 mt-0.5 italic">{ln.notes}</div>
                          )}
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-[12px] text-zinc-600">{formatCurrency(ln.unit_cost)}</td>
                        <td className="py-2 px-3 text-right font-mono font-bold">{formatCurrency(ln.line_total)}</td>
                        {showVariance && (() => {
                          const v = varianceByLine[ln.id];
                          const actual = v?.actual || 0;
                          const variance = v?.variance || 0;
                          const variancePct = v?.variance_pct;
                          const isOver = variance > 0.5;
                          const isUnder = variance < -0.5;
                          return (
                            <>
                              <td className="py-2 px-3 text-right font-mono text-[12px]">
                                {actual > 0 ? (
                                  <span className="font-bold text-zinc-950">{formatCurrency(actual)}</span>
                                ) : (
                                  <button
                                    onClick={() => setLinkerLine(ln)}
                                    className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-blue-700 hover:bg-blue-50 px-1.5 py-0.5 rounded-sm"
                                    data-testid={`link-bill-${ln.id}`}
                                    title="Link a vendor bill line to this take-off line"
                                  >
                                    <Link2 className="w-3 h-3" /> Link bill
                                  </button>
                                )}
                              </td>
                              <td className={`py-2 px-3 text-right font-mono text-[12px] ${
                                isOver ? "text-red-700" : isUnder ? "text-emerald-700" : "text-zinc-500"
                              }`}>
                                {actual > 0 ? (
                                  <span className="inline-flex items-center gap-1 justify-end" title={`${variance >= 0 ? "Over" : "Under"} estimate by ${formatCurrency(Math.abs(variance))}`}>
                                    {isOver && <TrendingUp className="w-3 h-3" />}
                                    {isUnder && <TrendingDown className="w-3 h-3" />}
                                    {!isOver && !isUnder && <Minus className="w-3 h-3" />}
                                    <span className="font-bold">{variance >= 0 ? "+" : ""}{formatCurrency(variance)}</span>
                                    {variancePct !== null && variancePct !== undefined && (
                                      <span className="text-[10px] text-zinc-500 ml-1">({variancePct >= 0 ? "+" : ""}{variancePct}%)</span>
                                    )}
                                  </span>
                                ) : (
                                  <span className="text-zinc-300">—</span>
                                )}
                              </td>
                            </>
                          );
                        })()}
                        <td className="py-2 px-3 text-right">
                          <div className="inline-flex items-center gap-0.5">
                            {showVariance && varianceByLine[ln.id]?.actual > 0 && (
                              <button
                                onClick={() => setLinkerLine(ln)}
                                className="p-1.5 hover:bg-blue-100 text-blue-700 rounded-sm"
                                title="Manage linked bills"
                                data-testid={`manage-bills-${ln.id}`}
                              >
                                <Link2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <button
                              onClick={() => removeLine(ln.id)}
                              className="p-1.5 hover:bg-red-100 text-red-700 rounded-sm"
                              title="Remove from take-off"
                              data-testid={`del-line-${ln.id}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {grandTotal > 0 && (
        <div className="mt-4 flex items-center justify-between gap-3 text-[11px] uppercase tracking-wider text-zinc-500 flex-wrap">
          <div className="max-w-xl">
            Estimated cost is computed from catalog &quot;loaded cost&quot; (vendor price × shipping). It is{" "}
            <span className="font-bold text-zinc-700">never</span> shown on the Purchase Order PDF.
          </div>
          <div className="text-right">
            <div className="font-mono font-bold text-zinc-950 text-base">
              Total Estimated: {formatCurrency(grandTotal)}
            </div>
            {varianceData?.totals?.actual > 0 && (
              <div className="mt-1 font-mono text-[12px] text-zinc-600">
                Actual {formatCurrency(varianceData.totals.actual)}  ·  Variance{" "}
                <span className={`font-bold ${
                  varianceData.totals.variance > 0.5 ? "text-red-700" :
                  varianceData.totals.variance < -0.5 ? "text-emerald-700" : "text-zinc-700"
                }`}>
                  {varianceData.totals.variance >= 0 ? "+" : ""}{formatCurrency(varianceData.totals.variance)}
                  {varianceData.totals.variance_pct !== null && ` (${varianceData.totals.variance_pct >= 0 ? "+" : ""}${varianceData.totals.variance_pct}%)`}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {showPicker && (
        <TakeoffPicker
          deal={deal}
          onClose={() => setShowPicker(false)}
          onSaved={async () => {
            setShowPicker(false);
            await reload();
          }}
        />
      )}

      {linkerLine && (
        <BillLinker
          deal={deal}
          takeoffLine={linkerLine}
          varianceLine={varianceByLine[linkerLine.id]}
          onClose={() => setLinkerLine(null)}
          onChanged={async () => {
            // Refresh variance after linking
            try {
              const r = await api.get(`/deals/${dealId}/takeoff-variance`);
              setVarianceData(r.data);
            } catch (e) {
              /* swallow - variance is best-effort */
            }
          }}
        />
      )}
    </div>
  );
}


/** Compact badge showing variance status — green=under, red=over, grey=at estimate */
function VarianceBadge({ variance, variancePct, linked, total, actual, compact }) {
  const isOver = variance > 0.5;
  const isUnder = variance < -0.5;
  const colorClasses = isOver
    ? "bg-red-50 text-red-700 border-red-200"
    : isUnder
    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : "bg-zinc-100 text-zinc-700 border-zinc-200";
  const Icon = isOver ? TrendingUp : isUnder ? TrendingDown : Minus;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 border rounded-sm ${colorClasses}`}>
      <Icon className="w-3 h-3" />
      <span>Actual {formatCurrency(actual)}</span>
      {!compact && (
        <span className="opacity-70">
          ({variance >= 0 ? "+" : ""}{formatCurrency(variance)}
          {variancePct !== null && variancePct !== undefined ? `, ${variancePct >= 0 ? "+" : ""}${variancePct}%` : ""})
        </span>
      )}
      {compact && variancePct !== null && variancePct !== undefined && (
        <span className="opacity-70">({variancePct >= 0 ? "+" : ""}{variancePct}%)</span>
      )}
      {!compact && total !== undefined && (
        <span className="opacity-70 ml-1">· {linked}/{total} linked</span>
      )}
    </span>
  );
}


/**
 * BillLinker — modal that lists all vendor-bill line items eligible to link to a
 * specific take-off line. Suggests SKU-matches at the top.
 */
function BillLinker({ deal, takeoffLine, varianceLine, onClose, onChanged }) {
  const [loading, setLoading] = useState(true);
  const [billLines, setBillLines] = useState([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      try {
        const r = await api.get(`/deals/${deal.id}/linkable-bill-lines`);
        if (cancelled) return;
        setBillLines(r.data?.lines || []);
      } catch (e) {
        toast.error(formatApiError(e?.response?.data?.detail) || e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    init();
    return () => { cancelled = true; };
  }, [deal.id]);

  const reload = async () => {
    setLoading(true);
    try {
      const r = await api.get(`/deals/${deal.id}/linkable-bill-lines`);
      setBillLines(r.data?.lines || []);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setLoading(false);
    }
  };

  const linkedHere = useMemo(
    () => billLines.filter((bl) => bl.linked_to === takeoffLine.id),
    [billLines, takeoffLine.id]
  );
  const suggested = useMemo(
    () => billLines.filter((bl) => !bl.linked_to && bl.suggested_takeoff_line_id === takeoffLine.id),
    [billLines, takeoffLine.id]
  );
  const others = useMemo(() => {
    const q = search.trim().toLowerCase();
    return billLines.filter((bl) => {
      if (bl.linked_to === takeoffLine.id) return false;
      if (!bl.linked_to && bl.suggested_takeoff_line_id === takeoffLine.id) return false;
      if (q) {
        return (bl.description || "").toLowerCase().includes(q) ||
               (bl.sku || "").toLowerCase().includes(q) ||
               (bl.vendor_name || "").toLowerCase().includes(q) ||
               (bl.bill_number || "").toLowerCase().includes(q);
      }
      return true;
    });
  }, [billLines, search, takeoffLine.id]);

  const link = async (bl, target) => {
    try {
      await api.put(`/vendor-bills/${bl.bill_id}/lines/${bl.line_id}/link`, { takeoff_line_id: target });
      await reload();
      await onChanged();
      toast.success(target ? "Linked" : "Unlinked");
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-zinc-950/80 backdrop-blur-sm flex items-center justify-center p-4" data-testid="bill-linker">
      <div className="bg-white border border-zinc-300 rounded-sm w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200">
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-700 mb-1">Link Vendor Bills</div>
            <div className="font-heading text-lg font-black tracking-tight truncate">{takeoffLine.name}</div>
            <div className="text-[11px] uppercase tracking-wider text-zinc-500 mt-0.5">
              {takeoffLine.quantity} × {takeoffLine.unit}  ·  Estimated <span className="font-bold text-zinc-700 font-mono">{formatCurrency(takeoffLine.line_total)}</span>
              {varianceLine && varianceLine.actual > 0 && (
                <>
                  {" · "} Actual <span className="font-bold text-zinc-700 font-mono">{formatCurrency(varianceLine.actual)}</span>
                </>
              )}
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-zinc-100 rounded-sm" data-testid="bill-linker-close"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-6 py-3 border-b border-zinc-200 bg-zinc-50">
          <div className="relative">
            <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search bill #, SKU, vendor, description..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-9 pl-9 pr-3 border border-zinc-300 rounded-sm text-sm"
              data-testid="linker-search"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="py-10 text-center text-xs uppercase tracking-wider text-zinc-500">Loading…</div>
          ) : billLines.length === 0 ? (
            <div className="py-10 text-center text-sm text-zinc-500">
              No vendor bills available to link yet. Upload a bill in the{" "}
              <a href="/payables" className="text-blue-700 font-bold underline">Payables</a> module first.
            </div>
          ) : (
            <div className="space-y-5">
              {linkedHere.length > 0 && (
                <BillLineSection title="Linked to this line" lines={linkedHere} action="Unlink" onAction={(bl) => link(bl, null)} actionClass="text-red-700 hover:bg-red-50 border-red-200" />
              )}
              {suggested.length > 0 && (
                <BillLineSection
                  title="Suggested matches (same SKU)"
                  badge="AUTO-MATCH"
                  lines={suggested}
                  action="Link"
                  onAction={(bl) => link(bl, takeoffLine.id)}
                  actionClass="text-blue-700 hover:bg-blue-50 border-blue-200"
                />
              )}
              {others.length > 0 && (
                <BillLineSection
                  title="Other bills from same vendor / project"
                  lines={others}
                  action="Link"
                  onAction={(bl) => link(bl, takeoffLine.id)}
                  actionClass="text-blue-700 hover:bg-blue-50 border-blue-200"
                  disabledMsg={(bl) => bl.linked_to && bl.linked_to !== takeoffLine.id ? "Already linked to another take-off line" : null}
                />
              )}
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t border-zinc-200 bg-zinc-50 flex items-center justify-between text-[11px] uppercase tracking-wider text-zinc-500">
          <span>Each bill line links to at most one take-off line. Actual = sum of linked amounts.</span>
          <button onClick={onClose} className="h-8 px-3 border border-zinc-300 hover:border-zinc-950 rounded-sm font-bold" data-testid="linker-done">Done</button>
        </div>
      </div>
    </div>
  );
}


function BillLineSection({ title, badge, lines, action, onAction, actionClass, disabledMsg }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">{title}</div>
        {badge && <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded-sm">{badge}</span>}
      </div>
      <div className="space-y-1.5">
        {lines.map((bl) => {
          const disabled = disabledMsg ? disabledMsg(bl) : null;
          return (
            <div key={`${bl.bill_id}-${bl.line_id}`} className="border border-zinc-200 rounded-sm p-3 flex items-start justify-between gap-3" data-testid={`bill-line-${bl.line_id}`}>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap text-[10px] uppercase tracking-wider text-zinc-500 mb-1">
                  <span className="font-bold text-zinc-700">{bl.vendor_name || "Vendor"}</span>
                  <span>·</span>
                  <span>Bill #{bl.bill_number || "—"}</span>
                  {bl.bill_date && <><span>·</span><span>{bl.bill_date}</span></>}
                  {bl.sku && <><span>·</span><span className="font-mono">SKU {bl.sku}</span></>}
                </div>
                <div className="text-sm text-zinc-950">{bl.description || <span className="text-zinc-400 italic">No description</span>}</div>
                <div className="text-[11px] text-zinc-600 mt-0.5 font-mono">
                  Qty {bl.quantity}  ·  <span className="font-bold">{formatCurrency(bl.amount)}</span>
                </div>
              </div>
              {disabled ? (
                <div className="text-[10px] text-zinc-500 italic max-w-[120px] text-right">{disabled}</div>
              ) : (
                <button
                  onClick={() => onAction(bl)}
                  className={`px-3 h-8 border text-[10px] font-bold uppercase tracking-wider rounded-sm whitespace-nowrap ${actionClass}`}
                  data-testid={`action-${bl.line_id}`}
                >
                  {action}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}


/**
 * TakeoffPicker — modal that lets the user pick materials, set qty per size, and add all at once.
 */
function TakeoffPicker({ deal, onClose, onSaved }) {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [vendorFilter, setVendorFilter] = useState("All");
  const [qty, setQty] = useState({}); // material_id → quantity
  const [notes, setNotes] = useState({}); // material_id → notes
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      try {
        const r = await api.get("/materials/grouped");
        if (cancelled) return;
        setGroups(r.data || []);
      } catch (e) {
        toast.error(formatApiError(e?.response?.data?.detail) || e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    init();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = groups;
    if (vendorFilter !== "All") out = out.filter((g) => g.vendor_name === vendorFilter);
    if (!q) return out;
    return out
      .map((g) => ({
        ...g,
        families: g.families
          .map((f) => {
            const fMatch = f.family.toLowerCase().includes(q) || (f.category || "").toLowerCase().includes(q);
            const variants = f.variants.filter(
              (v) => fMatch || (v.label || "").toLowerCase().includes(q) || (v.sku || "").toLowerCase().includes(q) || (v.notes || "").toLowerCase().includes(q)
            );
            return fMatch ? f : { ...f, variants };
          })
          .filter((f) => f.variants.length > 0),
      }))
      .filter((g) => g.families.length > 0);
  }, [groups, search, vendorFilter]);

  const totals = useMemo(() => {
    let lines = 0;
    let units = 0;
    let cost = 0;
    for (const g of groups) {
      for (const f of g.families) {
        for (const v of f.variants) {
          const q = Number(qty[v.material_id] || 0);
          if (q > 0) {
            lines += 1;
            units += q;
            cost += q * Number(v.loaded_cost || 0);
          }
        }
      }
    }
    return { lines, units, cost };
  }, [qty, groups]);

  const handleSave = async () => {
    const linesPayload = [];
    for (const g of groups) {
      for (const f of g.families) {
        for (const v of f.variants) {
          const q = Number(qty[v.material_id] || 0);
          if (q > 0) {
            linesPayload.push({
              material_id: v.material_id,
              quantity: q,
              notes: notes[v.material_id] || "",
            });
          }
        }
      }
    }
    if (linesPayload.length === 0) {
      toast.error("Enter a quantity for at least one item.");
      return;
    }
    setSaving(true);
    try {
      await api.post(`/deals/${deal.id}/takeoff`, { lines: linesPayload });
      toast.success(`Added ${linesPayload.length} line${linesPayload.length === 1 ? "" : "s"} to take-off`);
      await onSaved();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-zinc-950/80 backdrop-blur-sm flex items-center justify-center p-4" data-testid="takeoff-picker">
      <div className="bg-white border border-zinc-300 rounded-sm w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-700 mb-1">Material Take-Off</div>
            <div className="font-heading text-xl font-black tracking-tight">Add Materials to {deal.title}</div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-zinc-100 rounded-sm" data-testid="takeoff-picker-close">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Filters */}
        <div className="px-6 py-3 border-b border-zinc-200 bg-zinc-50 flex items-center gap-3 flex-wrap">
          <div className="flex-1 min-w-[240px] relative">
            <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search product, SKU, size..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-9 pl-9 pr-3 border border-zinc-300 rounded-sm text-sm"
              data-testid="picker-search"
            />
          </div>
          <select
            value={vendorFilter}
            onChange={(e) => setVendorFilter(e.target.value)}
            className="h-9 px-3 border border-zinc-300 rounded-sm text-sm bg-white"
            data-testid="picker-vendor-filter"
          >
            <option value="All">All Vendors</option>
            {groups.map((g) => (
              <option key={g.vendor_name} value={g.vendor_name}>{g.vendor_name} ({g.variant_count})</option>
            ))}
          </select>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="py-10 text-center text-xs uppercase tracking-wider text-zinc-500">Loading catalog…</div>
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center text-sm text-zinc-500">No materials match your search.</div>
          ) : (
            <div className="space-y-6">
              {filtered.map((g) => (
                <div key={g.vendor_name}>
                  <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 mb-2 pb-1 border-b border-zinc-200">
                    {g.vendor_name}
                  </div>
                  <div className="space-y-2">
                    {g.families.map((f) => {
                      const hasAnyQty = f.variants.some((v) => Number(qty[v.material_id] || 0) > 0);
                      return (
                        <div
                          key={`${g.vendor_name}-${f.family}`}
                          className={`border rounded-sm p-3 ${hasAnyQty ? "border-blue-300 bg-blue-50/40" : "border-zinc-200"}`}
                          data-testid={`family-${f.family}`}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <div className="font-bold text-zinc-950 text-[13px]">{f.family}</div>
                            {hasAnyQty && (
                              <div className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                                <CheckCircle2 className="w-3 h-3" /> {f.variants.filter((v) => Number(qty[v.material_id] || 0) > 0).length} selected
                              </div>
                            )}
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                            {f.variants.map((v) => {
                              const q = qty[v.material_id] || "";
                              return (
                                <div key={v.material_id} className="flex items-center gap-2 text-sm" data-testid={`variant-${v.material_id}`}>
                                  <div className="flex-1 min-w-0">
                                    <div className="font-medium text-zinc-900 truncate" title={v.label}>{v.label}</div>
                                    <div className="text-[10px] text-zinc-500 font-mono">
                                      {v.sku ? `SKU ${v.sku}  ·  ` : ""}{formatCurrency(v.loaded_cost)} loaded
                                    </div>
                                  </div>
                                  <input
                                    type="number"
                                    min="0"
                                    step="1"
                                    placeholder="Qty"
                                    value={q}
                                    onChange={(e) =>
                                      setQty({ ...qty, [v.material_id]: e.target.value === "" ? "" : Math.max(0, Number(e.target.value)) })
                                    }
                                    className="w-16 h-8 px-2 text-right border border-zinc-300 rounded-sm text-sm font-mono focus:border-blue-700 focus:outline-none"
                                    data-testid={`qty-input-${v.material_id}`}
                                  />
                                </div>
                              );
                            })}
                          </div>
                          {hasAnyQty && (
                            <div className="mt-2 pt-2 border-t border-blue-100">
                              <input
                                type="text"
                                placeholder="Notes (optional — e.g., color, area, urgency)"
                                value={notes[f.family] || ""}
                                onChange={(e) => {
                                  const newNotes = { ...notes };
                                  for (const v of f.variants) {
                                    if (Number(qty[v.material_id] || 0) > 0) newNotes[v.material_id] = e.target.value;
                                  }
                                  newNotes[f.family] = e.target.value;
                                  setNotes(newNotes);
                                }}
                                className="w-full h-8 px-2 border border-blue-200 rounded-sm text-xs"
                                data-testid={`notes-${f.family}`}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-zinc-200 bg-zinc-50 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-[11px] uppercase tracking-wider text-zinc-600">
            {totals.lines === 0 ? (
              <span>Enter quantities to start your take-off.</span>
            ) : (
              <>
                <span className="font-bold text-zinc-950">{totals.lines}</span> line{totals.lines === 1 ? "" : "s"}  ·  <span className="font-bold text-zinc-950">{totals.units}</span> units  ·  Est. <span className="font-bold text-zinc-950 font-mono">{formatCurrency(totals.cost)}</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="h-9 px-4 text-[11px] font-bold uppercase tracking-wider border border-zinc-300 hover:border-zinc-950 rounded-sm"
              data-testid="picker-cancel"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || totals.lines === 0}
              className="h-9 px-4 text-[11px] font-bold uppercase tracking-wider bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-40 disabled:cursor-not-allowed rounded-sm inline-flex items-center gap-2"
              data-testid="picker-save"
            >
              <Plus className="w-3.5 h-3.5" />
              {saving ? "Adding…" : "Add to Take-Off"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
