/**
 * EquipmentRates — Admin settings page for editing standard equipment rental
 * rates. These rates flow into every deal's Live Project P&L card and the
 * "Go to Production" equipment picker so estimates reflect actual costs.
 *
 * Route: /settings/equipment-rates (admin-only)
 * API:   GET/PUT /api/settings/equipment-rates
 */
import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, formatCurrency } from "@/lib/api";
import { Truck, Save, Plus, X } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { Navigate } from "react-router-dom";

export default function EquipmentRates() {
  const { user } = useAuth();
  const [rates, setRates] = useState([]); // array of {label, amount} for stable ordering
  const [updatedAt, setUpdatedAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newAmount, setNewAmount] = useState("");

  useEffect(() => {
    if (user?.role !== "admin") return;
    (async () => {
      try {
        const r = await api.get("/settings/equipment-rates");
        const list = Object.entries(r.data.rates || {})
          .map(([label, amount]) => ({ label, amount }))
          .sort((a, b) => a.label.localeCompare(b.label));
        setRates(list);
        setUpdatedAt(r.data.updated_at);
      } catch (e) {
        toast.error(e?.response?.data?.detail || "Failed to load rates");
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  if (user && user.role !== "admin") return <Navigate to="/" replace />;

  const updateAmount = (idx, val) => {
    setRates((prev) => prev.map((r, i) => (i === idx ? { ...r, amount: val } : r)));
  };

  const removeRow = (idx) => setRates((prev) => prev.filter((_, i) => i !== idx));

  const addRow = () => {
    const label = newLabel.trim();
    const amount = parseFloat(newAmount);
    if (!label) {
      toast.error("Give the equipment a name");
      return;
    }
    if (isNaN(amount) || amount < 0) {
      toast.error("Amount must be a positive number");
      return;
    }
    if (rates.some((r) => r.label.toLowerCase() === label.toLowerCase())) {
      toast.error(`${label} already exists`);
      return;
    }
    setRates((prev) => [...prev, { label, amount }].sort((a, b) => a.label.localeCompare(b.label)));
    setNewLabel("");
    setNewAmount("");
  };

  const save = async () => {
    // Convert to {label: amount} dict, coerce amounts to numbers.
    const payload = {};
    for (const r of rates) {
      const amount = parseFloat(r.amount);
      if (isNaN(amount) || amount < 0) {
        toast.error(`Invalid amount for ${r.label}`);
        return;
      }
      payload[r.label] = amount;
    }
    setSaving(true);
    try {
      const resp = await api.put("/settings/equipment-rates", { rates: payload });
      setUpdatedAt(resp.data.updated_at);
      toast.success("Equipment rates saved");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const totalIfAllRented = rates.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);

  return (
    <div className="max-w-4xl mx-auto py-8 px-4 sm:px-6 lg:px-8" data-testid="equipment-rates-page">
      <div className="mb-6">
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.15em] text-blue-700 mb-2">
          <Truck className="w-4 h-4" /> Company Info · Equipment Rentals
        </div>
        <h1 className="font-heading text-3xl font-black tracking-tight">Equipment Rental Rates</h1>
        <p className="text-sm text-zinc-600 mt-2 max-w-2xl">
          Standard rental cost per project for each type of on-site equipment. These figures show up on every deal&apos;s
          <b> Live Project P&amp;L</b> card and are added to the Equipment cost line the moment the equipment is
          marked as ordered from the &quot;Go to Production&quot; checklist.
        </p>
        {updatedAt && (
          <div className="text-[10px] text-zinc-500 mt-2">Last saved: {new Date(updatedAt).toLocaleString()}</div>
        )}
      </div>

      {loading ? (
        <div className="bg-white border border-zinc-200 rounded-sm p-12 text-center text-zinc-500">Loading…</div>
      ) : (
        <div className="bg-white border border-zinc-200 rounded-sm" data-testid="rates-table">
          <div className="px-5 py-4 border-b border-zinc-200 flex items-center justify-between">
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-zinc-500">
                {rates.length} equipment {rates.length === 1 ? "type" : "types"}
              </div>
              <div className="text-xs text-zinc-500 mt-0.5">
                Combined cost if all rented: <b className="text-zinc-950">{formatCurrency(totalIfAllRented)}</b>
              </div>
            </div>
            <button
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-1.5 bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white text-[10px] font-bold uppercase tracking-wider px-3 h-9 rounded-sm"
              data-testid="save-rates-btn"
            >
              <Save className="w-3.5 h-3.5" /> {saving ? "Saving…" : "Save All"}
            </button>
          </div>

          <div className="divide-y divide-zinc-100">
            {rates.map((r, idx) => (
              <div
                key={r.label}
                className="flex items-center gap-3 px-5 py-3"
                data-testid={`rate-row-${r.label.replace(/\s+/g, "-").toLowerCase()}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-zinc-900">{r.label}</div>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-sm text-zinc-500">$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={r.amount}
                    onChange={(e) => updateAmount(idx, e.target.value)}
                    className="w-28 h-9 px-2 border border-zinc-300 rounded-sm text-sm text-right font-mono"
                    data-testid={`rate-input-${r.label.replace(/\s+/g, "-").toLowerCase()}`}
                  />
                </div>
                <button
                  onClick={() => removeRow(idx)}
                  className="text-zinc-400 hover:text-red-600 p-1"
                  title="Remove this equipment"
                  data-testid={`rate-remove-${r.label.replace(/\s+/g, "-").toLowerCase()}`}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>

          {/* Add-new row */}
          <div className="px-5 py-4 border-t border-zinc-200 bg-zinc-50 flex items-center gap-2">
            <input
              type="text"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Equipment name (e.g. Boom Lift)"
              className="flex-1 h-9 px-3 border border-zinc-300 rounded-sm text-sm"
              data-testid="rate-new-label"
            />
            <div className="flex items-center gap-1">
              <span className="text-sm text-zinc-500">$</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={newAmount}
                onChange={(e) => setNewAmount(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addRow(); } }}
                placeholder="0.00"
                className="w-28 h-9 px-2 border border-zinc-300 rounded-sm text-sm text-right font-mono"
                data-testid="rate-new-amount"
              />
            </div>
            <button
              onClick={addRow}
              className="inline-flex items-center gap-1 px-3 h-9 text-[10px] font-bold uppercase tracking-wider bg-zinc-950 text-white hover:bg-zinc-800 rounded-sm"
              data-testid="rate-add-btn"
            >
              <Plus className="w-3.5 h-3.5" /> Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
