import React from "react";

/**
 * MiniPipeline — 9-dot strip showing a deal's stage progression at a glance.
 * Logic mirrors detectStageStates() in DealWorkflow.jsx.
 *
 *   green  = stage done
 *   blue   = current stage
 *   grey   = upcoming
 *
 * Designed to fit in a single Deals-list table cell (≈100px wide).
 */
const STAGES = [
  "assessment", "scope", "won", "deposit", "materials",
  "scheduled", "in_progress", "final_inspection", "closed",
];
const LABELS = ["Assessment", "Scope Sent", "Won", "Deposit Paid", "Materials Ordered", "Scheduled", "In Progress", "Final Inspection", "Closed"];

function detect(deal, invoices = []) {
  const status = (deal?.status || "").toLowerCase();
  const milestones = deal?.payment_milestones || [];
  const stages = {};
  stages.assessment = !!deal?.last_scope_sent_at || !!deal?.last_assessment_id;
  stages.scope = !!deal?.last_scope_sent_at || !!deal?.custom_scope || !!deal?.scope_signed_at;
  stages.won = ["won", "in progress", "complete", "closed"].includes(status);
  stages.deposit = (milestones[0] && milestones[0].status === "Paid") || (invoices || []).some((i) => (i.status || "").toLowerCase() === "paid");
  stages.materials = !!deal?.material_order_date;
  stages.scheduled = !!deal?.scheduled_start_date;
  const today = new Date().toISOString().slice(0, 10);
  stages.in_progress = status === "in progress" || (!!deal?.scheduled_start_date && deal.scheduled_start_date <= today);
  stages.final_inspection = (!!deal?.scheduled_end_date && deal.scheduled_end_date <= today) || ["complete", "closed"].includes(status);
  const allPaid = milestones.length > 0 && milestones.every((m) => m.status === "Paid");
  stages.closed = ["complete", "closed"].includes(status) || allPaid;
  return stages;
}

export default function MiniPipeline({ deal, invoices, testId }) {
  const stages = detect(deal, invoices);
  let lastTrue = -1;
  STAGES.forEach((s, i) => { if (stages[s]) lastTrue = i; });
  const currentIdx = Math.min(STAGES.length - 1, lastTrue + 1);
  return (
    <div className="inline-flex items-center gap-0.5" data-testid={testId} title={`Stage: ${LABELS[currentIdx]}`}>
      {STAGES.map((s, i) => {
        const done = stages[s];
        const isCurrent = i === currentIdx && !done;
        const cls = done
          ? "bg-green-700"
          : isCurrent
            ? "bg-blue-700 ring-2 ring-blue-300"
            : "bg-zinc-200";
        return <span key={s} className={`inline-block w-2 h-2 rounded-full ${cls}`} title={`${LABELS[i]}${done ? " — done" : isCurrent ? " — current" : ""}`} />;
      })}
    </div>
  );
}
