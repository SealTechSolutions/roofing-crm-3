/**
 * GoToProductionChecklist — the "Phase C" one-card production kickoff view.
 *
 * Aggregates the four things the office must do the moment a deal is Won:
 *   1. Schedule the crew           (existing DealSchedulePanel)
 *   2. Order material              (existing MaterialTakeoff)
 *   3. Assign a subcontractor +
 *      send the Work Order         (existing WorkOrderModal)
 *   4. Order on-site equipment     (NEW — persisted on deal.equipment_ordered)
 *
 * Each row shows current status ("done" / "pending"), the primary action
 * button, and a summary of what's already been done. This card is intended
 * to sit at the very top of the "Execution" section of the deal page, so a
 * project manager can drive a job from Won → In Progress without leaving
 * the page.
 */
import React, { useState } from "react";
import { CheckCircle2, Circle, Calendar, Package, HardHat, Truck, ChevronDown, ChevronRight } from "lucide-react";
import { api } from "../lib/api";
import { toast } from "sonner";

// Common on-site equipment types for commercial roofing / construction.
// Users can also add free-form entries via the text input.
const COMMON_EQUIPMENT = [
  "Storage Container",
  "Porta-Potty",
  "Forklift",
  "Manlift",
  "Dumpster",
  "Scaffolding",
];

const Row = ({ done, icon: Icon, label, summary, action, actionLabel, testId, expandable, expanded, onToggle }) => {
  const StatusIcon = done ? CheckCircle2 : Circle;
  const statusColor = done ? "text-emerald-600" : "text-zinc-300";
  return (
    <div className="border-b border-zinc-100 last:border-b-0" data-testid={testId}>
      <div className="flex items-center gap-4 py-3">
        <StatusIcon className={`w-5 h-5 flex-shrink-0 ${statusColor}`} />
        <div className="flex-shrink-0 w-8 h-8 rounded-sm bg-blue-50 border border-blue-200 flex items-center justify-center">
          <Icon className="w-4 h-4 text-blue-700" />
        </div>
        <div className="flex-1 min-w-0">
          <div className={`text-sm font-bold ${done ? "text-zinc-500 line-through" : "text-zinc-900"}`}>{label}</div>
          {summary && <div className="text-xs text-zinc-500 mt-0.5">{summary}</div>}
        </div>
        {expandable ? (
          <button
            onClick={onToggle}
            className="inline-flex items-center gap-1 px-3 h-9 text-[10px] font-bold uppercase tracking-wider border border-zinc-300 hover:border-zinc-950 rounded-sm"
            data-testid={`${testId}-toggle`}
          >
            {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            {done ? "Manage" : "Order"}
          </button>
        ) : action && (
          <button
            onClick={action}
            className="inline-flex items-center gap-1 px-3 h-9 text-[10px] font-bold uppercase tracking-wider bg-blue-700 text-white hover:bg-blue-800 rounded-sm"
            data-testid={`${testId}-action`}
          >
            {actionLabel || (done ? "Update" : "Start")}
          </button>
        )}
      </div>
    </div>
  );
};

export default function GoToProductionChecklist({ deal, onScrollToSchedule, onScrollToMaterials, onSendWorkOrder, onEquipmentChange }) {
  const [equipmentExpanded, setEquipmentExpanded] = useState(false);
  const [customEquipment, setCustomEquipment] = useState("");
  const [savingEquipment, setSavingEquipment] = useState(false);

  // --- Derive status of each row from the deal doc ---
  const equipment = deal.equipment_ordered || [];
  const orderedTypes = new Set(equipment.map((e) => e.type));

  const schedule_done = !!(deal.scheduled_start_date || deal.scheduled_end_date);
  const materials_done = !!(deal.material_order_date || (deal.material_takeoff || []).length > 0);
  const wo_done = !!(deal.last_work_order_sent_at); // stamped by WorkOrderModal
  const equipment_done = equipment.length > 0;

  const totalDone = [schedule_done, materials_done, wo_done, equipment_done].filter(Boolean).length;

  // --- Equipment order toggle: adds/removes an item from deal.equipment_ordered ---
  const toggleEquipment = async (type) => {
    if (savingEquipment) return;
    setSavingEquipment(true);
    const isOn = orderedTypes.has(type);
    const nextEquipment = isOn
      ? equipment.filter((e) => e.type !== type)
      : [...equipment, { type, ordered_at: new Date().toISOString().slice(0, 10) }];
    try {
      const patched = { ...deal, equipment_ordered: nextEquipment };
      await api.put(`/deals/${deal.id}`, patched);
      onEquipmentChange && onEquipmentChange(nextEquipment);
      toast.success(isOn ? `${type} removed from order` : `${type} marked as ordered`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || e.message || "Could not update equipment");
    } finally {
      setSavingEquipment(false);
    }
  };

  const addCustomEquipment = async () => {
    const label = customEquipment.trim();
    if (!label) return;
    if (orderedTypes.has(label)) {
      toast.info(`${label} already on the order`);
      return;
    }
    const nextEquipment = [...equipment, { type: label, ordered_at: new Date().toISOString().slice(0, 10) }];
    try {
      const patched = { ...deal, equipment_ordered: nextEquipment };
      await api.put(`/deals/${deal.id}`, patched);
      onEquipmentChange && onEquipmentChange(nextEquipment);
      setCustomEquipment("");
      toast.success(`${label} added`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || e.message || "Could not add equipment");
    }
  };

  const scheduleSummary = schedule_done
    ? [deal.scheduled_start_date, deal.scheduled_end_date].filter(Boolean).join(" → ") || "Scheduled"
    : "Not scheduled yet";
  const materialsSummary = materials_done
    ? `${(deal.material_takeoff || []).length} take-off line${(deal.material_takeoff || []).length === 1 ? "" : "s"}${deal.material_order_date ? ` · delivery ${deal.material_order_date}` : ""}`
    : "No materials ordered yet";
  const woSummary = wo_done
    ? `Work order sent ${deal.last_work_order_sent_at ? "on " + String(deal.last_work_order_sent_at).slice(0, 10) : ""}`
    : "No sub assigned or WO sent yet";
  const equipmentSummary = equipment_done
    ? equipment.map((e) => e.type).join(" · ")
    : "No equipment ordered yet";

  return (
    <div className="bg-white border border-zinc-200 rounded-sm mb-6" data-testid="go-to-production-checklist">
      <div className="px-5 py-4 border-b border-zinc-200 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-blue-700 mb-1">Production Kickoff</div>
          <h3 className="font-heading text-lg font-bold tracking-tight">Go to Production</h3>
          <div className="text-xs text-zinc-500 mt-0.5">
            The four things to do the moment a deal is Won. Check them off as you go.
          </div>
        </div>
        <div
          className="text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 border border-zinc-300 rounded-sm bg-zinc-50"
          data-testid="production-progress"
        >
          {totalDone} of 4 complete
        </div>
      </div>
      <div className="px-5">
        <Row
          done={schedule_done}
          icon={Calendar}
          label="1 · Schedule the crew"
          summary={scheduleSummary}
          action={onScrollToSchedule}
          actionLabel={schedule_done ? "Update" : "Schedule"}
          testId="production-row-schedule"
        />
        <Row
          done={materials_done}
          icon={Package}
          label="2 · Order material"
          summary={materialsSummary}
          action={onScrollToMaterials}
          actionLabel={materials_done ? "Manage" : "Open Take-Off"}
          testId="production-row-materials"
        />
        <Row
          done={wo_done}
          icon={HardHat}
          label="3 · Assign subcontractor + send Work Order"
          summary={woSummary}
          action={onSendWorkOrder}
          actionLabel={wo_done ? "Resend WO" : "Send WO"}
          testId="production-row-wo"
        />
        <Row
          done={equipment_done}
          icon={Truck}
          label="4 · Order on-site equipment"
          summary={equipmentSummary}
          expandable
          expanded={equipmentExpanded}
          onToggle={() => setEquipmentExpanded((v) => !v)}
          testId="production-row-equipment"
        />
        {equipmentExpanded && (
          <div className="pb-4 pt-2" data-testid="equipment-picker">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">
              {COMMON_EQUIPMENT.map((type) => {
                const on = orderedTypes.has(type);
                return (
                  <label
                    key={type}
                    className={`flex items-center gap-2 px-3 py-2 border rounded-sm cursor-pointer text-sm ${
                      on ? "bg-emerald-50 border-emerald-300 text-emerald-900" : "bg-white border-zinc-300 hover:border-zinc-950"
                    }`}
                    data-testid={`equipment-toggle-${type.replace(/\s+/g, "-").toLowerCase()}`}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggleEquipment(type)}
                      disabled={savingEquipment}
                      className="w-4 h-4"
                    />
                    <span className={on ? "font-bold" : ""}>{type}</span>
                  </label>
                );
              })}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={customEquipment}
                onChange={(e) => setCustomEquipment(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustomEquipment(); } }}
                placeholder="Other equipment (e.g. Boom Lift, Roller)…"
                className="flex-1 h-9 px-3 border border-zinc-300 rounded-sm text-sm"
                data-testid="equipment-custom-input"
              />
              <button
                onClick={addCustomEquipment}
                disabled={!customEquipment.trim()}
                className="inline-flex items-center gap-1 px-3 h-9 text-[10px] font-bold uppercase tracking-wider bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-40 rounded-sm"
                data-testid="equipment-custom-add"
              >
                Add
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
