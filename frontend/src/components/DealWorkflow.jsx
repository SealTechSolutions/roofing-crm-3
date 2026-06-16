import React, { useEffect, useMemo, useState } from "react";
import { api, formatApiError, formatCurrency } from "@/lib/api";
import { toast } from "sonner";
import {
  CheckCircle2, Circle, Clock, ChevronRight, Send, FileText, DollarSign,
  Mail, Calendar as CalIcon, Wrench, Camera, Inbox, ArrowRight, Truck, ClipboardCheck,
  Hammer, ShieldCheck, Lock, AlertCircle,
} from "lucide-react";

/* ------------------------------------------------------------------------------
 * Stage Pipeline (9 stages + smart Next-Step card)
 *
 * Stages auto-detect from deal data:
 *   1. Assessment        — has assessment record
 *   2. Scope Sent        — last_scope_sent_at set OR custom_scope present
 *   3. Won / Signed      — status in [Won, In Progress, Complete]
 *   4. Deposit Paid      — first milestone status === 'Paid' OR any invoice paid
 *   5. Materials Ordered — material_order_date set
 *   6. Scheduled         — scheduled_start_date set
 *   7. In Progress       — status === 'In Progress' OR scheduled_start_date in past
 *   8. Final Inspection  — status near complete OR all milestones paid except final
 *   9. Closed            — status === 'Complete' / 'Closed' OR all milestones paid
 *
 * Single-click → navigate; double-click → mark stage done manually.
 * --------------------------------------------------------------------------- */

const STAGES = [
  { key: "assessment",      label: "Assessment",      Icon: ClipboardCheck, tab: "assessments" },
  { key: "scope",           label: "Scope Sent",      Icon: FileText,       tab: "scope" },
  { key: "won",             label: "Won / Signed",    Icon: ShieldCheck,    tab: "overview" },
  { key: "deposit",         label: "Deposit Paid",    Icon: DollarSign,     tab: "milestones" },
  { key: "materials",       label: "Materials Ordered", Icon: Truck,        tab: "schedule" },
  { key: "scheduled",       label: "Scheduled",       Icon: CalIcon,        tab: "schedule" },
  { key: "in_progress",     label: "In Progress",     Icon: Hammer,         tab: "photos" },
  { key: "final_inspection",label: "Final Inspection",Icon: Camera,         tab: "photos" },
  { key: "closed",          label: "Closed",          Icon: Lock,           tab: "overview" },
];

function detectStageStates(deal, invoices = [], assessments = []) {
  const status = (deal?.status || "").toLowerCase();
  const milestones = deal?.payment_milestones || [];
  const stages = {};

  stages.assessment = (assessments?.length || 0) > 0 || !!deal?.last_scope_sent_at;
  stages.scope = !!deal?.last_scope_sent_at || !!deal?.custom_scope || !!deal?.scope_signed_at;
  stages.won = ["won", "in progress", "complete", "closed"].includes(status);
  // Deposit paid = first milestone Paid OR at least one paid invoice
  const firstMs = milestones[0];
  stages.deposit = (firstMs && firstMs.status === "Paid") || invoices.some((i) => (i.status || "").toLowerCase() === "paid");
  stages.materials = !!deal?.material_order_date;
  stages.scheduled = !!deal?.scheduled_start_date;
  // In Progress when status says so OR start date is in the past
  const today = new Date().toISOString().slice(0, 10);
  stages.in_progress = status === "in progress" || (!!deal?.scheduled_start_date && deal.scheduled_start_date <= today);
  // Final inspection = scheduled_end_date is in the past OR status close to complete
  stages.final_inspection = (!!deal?.scheduled_end_date && deal.scheduled_end_date <= today) || ["complete", "closed"].includes(status);
  // Closed = all milestones Paid OR explicit status
  const allPaid = milestones.length > 0 && milestones.every((m) => m.status === "Paid");
  stages.closed = ["complete", "closed"].includes(status) || allPaid;
  return stages;
}

function deriveCurrentStage(stageStates) {
  // Active = the latest TRUE stage, or the first FALSE if nothing is true
  let lastTrue = -1;
  STAGES.forEach((s, i) => { if (stageStates[s.key]) lastTrue = i; });
  // current stage is the next FALSE after the last TRUE (or 0)
  const currentIdx = Math.min(STAGES.length - 1, lastTrue + 1);
  return { lastTrue, currentIdx };
}

export function DealStagePipeline({ deal, invoices = [], assessments = [], onTabChange, onAdvance }) {
  const stageStates = useMemo(() => detectStageStates(deal, invoices, assessments), [deal, invoices, assessments]);
  const { lastTrue, currentIdx } = deriveCurrentStage(stageStates);

  const handleClick = (s, idx) => {
    // Single click = navigate
    if (s.tab && onTabChange) onTabChange(s.tab);
  };
  const handleDouble = async (s, idx) => {
    if (onAdvance) await onAdvance(s.key, !stageStates[s.key]);
  };

  return (
    <div className="bg-white border border-zinc-200 rounded-sm p-4 mb-6" data-testid="deal-stage-pipeline">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-500">Project Pipeline</div>
        <div className="text-[10px] text-zinc-400">Click to jump · Double-click to mark done</div>
      </div>
      <div className="flex items-center gap-0 overflow-x-auto py-2">
        {STAGES.map((s, i) => {
          const done = stageStates[s.key];
          const isCurrent = i === currentIdx && !done;
          const Icon = s.Icon;
          return (
            <React.Fragment key={s.key}>
              <button
                onClick={() => handleClick(s, i)}
                onDoubleClick={() => handleDouble(s, i)}
                className={`flex flex-col items-center gap-1.5 px-2 py-1 min-w-[72px] cursor-pointer rounded-sm transition group ${isCurrent ? "ring-2 ring-blue-500" : ""}`}
                title={done ? `${s.label} — done` : isCurrent ? `${s.label} — you are here` : `${s.label} — upcoming`}
                data-testid={`stage-${s.key}`}
              >
                <div
                  className={`w-9 h-9 rounded-full flex items-center justify-center text-white transition ${
                    done ? "bg-green-700" : isCurrent ? "bg-blue-700 animate-pulse" : "bg-zinc-200"
                  }`}
                >
                  {done ? <CheckCircle2 className="w-5 h-5" /> : <Icon className={`w-4 h-4 ${done || isCurrent ? "" : "text-zinc-500"}`} />}
                </div>
                <div className={`text-[9px] font-bold uppercase tracking-wider text-center leading-tight ${done ? "text-green-800" : isCurrent ? "text-blue-700" : "text-zinc-500"}`}>
                  {s.label}
                </div>
              </button>
              {i < STAGES.length - 1 && (
                <div className={`h-px flex-1 min-w-[8px] ${i < lastTrue ? "bg-green-700" : "bg-zinc-200"}`} />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------------
 * Next Step Card — single state-aware CTA based on current stage.
 * --------------------------------------------------------------------------- */

function pickNextStep(deal, invoices, assessments, stageStates) {
  const milestones = deal?.payment_milestones || [];
  // 1. Need an assessment
  if (!stageStates.assessment) {
    return { title: "Schedule an assessment", desc: "Capture site conditions before drafting the scope.", actionLabel: "Open Assessments", target: { route: "/assessments" }, kind: "info" };
  }
  // 2. Need to send the scope
  if (!stageStates.scope) {
    return { title: "Email the scope", desc: "Send the proposal PDF + smart-picked library docs.", actionLabel: "Email Scope", action: "email-scope", kind: "primary" };
  }
  // 3. Won?
  if (!stageStates.won) {
    return { title: "Mark this deal as Won", desc: "Confirm chosen amount + date so the milestones and KPIs roll up.", actionLabel: "Mark Won", action: "mark-won", kind: "primary" };
  }
  // 4. Deposit?
  if (!stageStates.deposit) {
    if (milestones.length === 0) {
      return { title: "Add payment milestones", desc: "Apply a 50/50 or 30/40/30 template, or add custom milestones.", actionLabel: "Open Milestones", target: { tab: "milestones" }, kind: "primary" };
    }
    const draftInvoice = invoices.find((i) => (i.status || "").toLowerCase() !== "paid");
    if (draftInvoice) {
      return { title: `Send & collect deposit invoice ${draftInvoice.invoice_number}`, desc: `${formatCurrency(draftInvoice.balance_due || draftInvoice.total)} outstanding`, actionLabel: "Open Invoice", target: { route: `/invoices` }, kind: "primary" };
    }
    return { title: "Issue the deposit invoice", desc: `${milestones[0]?.label || "Deposit"} milestone is unfunded.`, actionLabel: "Create Invoice", target: { route: "/invoices" }, kind: "primary" };
  }
  // 5. Materials?
  if (!stageStates.materials) {
    return { title: "Order materials", desc: "Set the material order date so the calendar shows the delivery target.", actionLabel: "Set Material Order", action: "set-material-order", kind: "primary" };
  }
  // 6. Scheduled?
  if (!stageStates.scheduled) {
    return { title: "Schedule the project", desc: "Set scheduled start + end dates so crews and the calendar align.", actionLabel: "Set Schedule", action: "set-schedule", kind: "primary" };
  }
  // 7. In progress?
  if (!stageStates.in_progress) {
    return { title: "Crews start soon", desc: `Project starts ${deal.scheduled_start_date}. Make sure subs have COIs on file.`, actionLabel: "Verify COIs", target: { route: "/subcontractors" }, kind: "info" };
  }
  // 8. Final inspection?
  if (!stageStates.final_inspection) {
    return { title: "Capture final-inspection photos", desc: "Upload before/during/after albums and mark the completion milestone.", actionLabel: "Open Photos", target: { tab: "photos" }, kind: "primary" };
  }
  // 9. Close out
  if (!stageStates.closed) {
    return { title: "Close the project", desc: "Issue the final invoice, file the warranty, archive the job.", actionLabel: "Mark Complete", action: "mark-complete", kind: "primary" };
  }
  return { title: "All wrapped up — nice work", desc: "Everything's closed. Add a maintenance plan or revisit in 12 months.", actionLabel: "View Maintenance", target: { tab: "maintenance" }, kind: "success" };
}

export function NextStepCard({ deal, invoices, assessments, onAction }) {
  const stageStates = useMemo(() => detectStageStates(deal, invoices, assessments), [deal, invoices, assessments]);
  const step = useMemo(() => pickNextStep(deal, invoices, assessments, stageStates), [deal, invoices, assessments, stageStates]);

  const accent = step.kind === "primary"
    ? "bg-gradient-to-br from-blue-700 to-blue-900 text-white border-blue-900"
    : step.kind === "success"
      ? "bg-gradient-to-br from-green-700 to-green-900 text-white border-green-900"
      : "bg-gradient-to-br from-zinc-100 to-zinc-50 text-zinc-900 border-zinc-300";

  return (
    <div className={`rounded-sm border p-5 mb-6 shadow-sm ${accent}`} data-testid="next-step-card">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${step.kind === "primary" ? "bg-white/20" : "bg-zinc-900/10"}`}>
            <ArrowRight className="w-5 h-5" />
          </div>
          <div>
            <div className={`text-[10px] font-bold uppercase tracking-[0.2em] mb-1 ${step.kind === "primary" || step.kind === "success" ? "text-white/70" : "text-zinc-500"}`}>Next Step</div>
            <div className="text-lg font-bold leading-tight" data-testid="next-step-title">{step.title}</div>
            <div className={`text-sm mt-1 ${step.kind === "primary" || step.kind === "success" ? "text-white/85" : "text-zinc-600"}`}>{step.desc}</div>
          </div>
        </div>
        <button
          onClick={() => onAction(step)}
          className={`inline-flex items-center gap-2 h-10 px-4 text-[11px] font-bold uppercase tracking-wider rounded-sm whitespace-nowrap ${
            step.kind === "primary" ? "bg-white text-blue-900 hover:bg-blue-50" :
            step.kind === "success" ? "bg-white text-green-900 hover:bg-green-50" :
            "bg-zinc-900 text-white hover:bg-zinc-800"
          }`}
          data-testid="next-step-action"
        >
          {step.actionLabel} <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------------
 * Activity Timeline (right rail) — pulled from /deals/{id}/activity
 * --------------------------------------------------------------------------- */

const KIND_ICON = {
  deal_created: Inbox,
  status_change: ArrowRight,
  invoice_created: FileText,
  invoice_sent: Mail,
  payment_received: DollarSign,
  maintenance_visit: Wrench,
  photo_uploaded: Camera,
  assessment_created: ClipboardCheck,
  assessment_completed: CheckCircle2,
};

export function DealActivityTimeline({ dealId }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/deals/${dealId}/activity`)
      .then((r) => setItems(r.data?.items || []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [dealId]);

  if (loading) return <div className="text-xs text-zinc-400">Loading activity…</div>;
  if (!items.length) return (
    <div className="text-xs text-zinc-400 italic px-3 py-4 border border-dashed border-zinc-200 rounded-sm">
      No activity yet. Saves, payments, and uploads will appear here automatically.
    </div>
  );

  return (
    <div className="space-y-2.5" data-testid="deal-activity-timeline">
      {items.map((it, idx) => {
        const Icon = KIND_ICON[it.kind] || Circle;
        return (
          <div key={idx} className="flex items-start gap-2.5">
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
              style={{ background: it.color || "#71717A" }}
            >
              <Icon className="w-3 h-3 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium leading-tight" data-testid={`activity-item-${idx}`}>{it.title}</div>
              {it.subtitle && <div className="text-[11px] text-zinc-500 truncate">{it.subtitle}</div>}
              <div className="text-[10px] font-mono text-zinc-400 mt-0.5">{formatTs(it.ts)}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function formatTs(ts) {
  if (!ts) return "";
  // Date-only string (YYYY-MM-DD)
  if (/^\d{4}-\d{2}-\d{2}$/.test(ts)) return ts;
  try {
    const d = new Date(ts);
    return d.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  } catch {
    return ts;
  }
}

/* ------------------------------------------------------------------------------
 * Quick Actions strip — top-right of the deal page header.
 * --------------------------------------------------------------------------- */

export function DealQuickActions({ deal, onEmailScope, onCreateInvoice, onRecordPayment }) {
  return (
    <div className="flex items-center gap-2 flex-wrap" data-testid="deal-quick-actions">
      <button onClick={onEmailScope} className="inline-flex items-center gap-1.5 h-9 px-3 border border-zinc-300 hover:border-blue-700 hover:text-blue-700 text-[10px] font-bold uppercase tracking-wider rounded-sm" data-testid="quick-email-scope">
        <Mail className="w-3.5 h-3.5" /> Email Scope
      </button>
      <button onClick={onCreateInvoice} className="inline-flex items-center gap-1.5 h-9 px-3 border border-zinc-300 hover:border-blue-700 hover:text-blue-700 text-[10px] font-bold uppercase tracking-wider rounded-sm" data-testid="quick-new-invoice">
        <FileText className="w-3.5 h-3.5" /> + Invoice
      </button>
      <button onClick={onRecordPayment} className="inline-flex items-center gap-1.5 h-9 px-3 border border-zinc-300 hover:border-blue-700 hover:text-blue-700 text-[10px] font-bold uppercase tracking-wider rounded-sm" data-testid="quick-record-payment">
        <DollarSign className="w-3.5 h-3.5" /> Record Payment
      </button>
    </div>
  );
}
