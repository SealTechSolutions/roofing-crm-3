/**
 * DealActionBar — 6 smart, color-coded, state-aware document action buttons at
 * the top of every deal. Each button represents one workflow document type and
 * changes its label + menu based on whether that document exists yet.
 *
 * Left-to-right = deal workflow order:
 *   1. Assessment  (purple)  — Full Report OR Basic Evaluation from the same doc
 *   2. Scope       (blue)    — spec sheet PDF (always generatable from deal fields)
 *   3. Work Order  (orange)  — dispatched to subcontractor
 *   4. Change Order(amber)   — amendments to the original WO
 *   5. Send Field  (teal)    — dispatch photo-capture & on-site info to crew
 *   6. Complete    (emerald) — closes deal + drafts final invoice (confirm dialog)
 *
 * Design goals: fewest clicks, no hidden UI, one row on desktop, wraps cleanly
 * on mobile, consistent color language with the DealDetail section groups.
 */
import React from "react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import {
  ClipboardCheck,
  FileText,
  Camera,
  CheckSquare,
  ChevronDown,
  Download,
  Printer,
  Mail,
  Edit3,
  Plus,
  Eye,
} from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { api, API } from "@/lib/api";

// ─── Shared helpers ─────────────────────────────────────────────────────────

/** Fetches a PDF from an authenticated endpoint and either opens it in a
 *  new tab (for view/print) or triggers a download. */
async function fetchAndOpenPdf(url, { print = false, downloadAs = null } = {}) {
  const token = localStorage.getItem("crm_token");
  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`Failed (${r.status})`);
    const blob = await r.blob();
    const objectUrl = URL.createObjectURL(blob);
    if (downloadAs) {
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = downloadAs;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } else {
      const win = window.open(objectUrl, "_blank");
      if (!win) {
        toast.error("Pop-up blocked. Allow pop-ups from this site to view PDFs.");
      } else if (print) {
        win.addEventListener("load", () => { try { win.print(); } catch { /* noop */ } });
        setTimeout(() => { try { win.print(); } catch { /* noop */ } }, 1500);
      }
    }
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  } catch (e) {
    toast.error(e.message || "Could not open PDF");
  }
}

// Color palettes — one per document type. Uses solid backgrounds for filled
// (existing-doc) state and bordered / lighter for empty state.
const PALETTE = {
  assessment:   { solid: "bg-purple-700 hover:bg-purple-800 text-white",     ghost: "border border-purple-300 bg-purple-50 text-purple-900 hover:border-purple-700" },
  scope:        { solid: "bg-blue-700 hover:bg-blue-800 text-white",         ghost: "border border-blue-300 bg-blue-50 text-blue-900 hover:border-blue-700" },
  work_order:   { solid: "bg-orange-600 hover:bg-orange-700 text-white",     ghost: "border border-orange-300 bg-orange-50 text-orange-900 hover:border-orange-600" },
  change_order: { solid: "bg-amber-500 hover:bg-amber-600 text-white",       ghost: "border border-amber-300 bg-amber-50 text-amber-900 hover:border-amber-500" },
  field:        { solid: "bg-teal-600 hover:bg-teal-700 text-white",         ghost: "" },
  complete:     { solid: "bg-emerald-700 hover:bg-emerald-800 text-white",   ghost: "" },
};

const BTN_BASE = "inline-flex items-center gap-2 px-3.5 h-10 text-[11px] font-bold uppercase tracking-wider rounded-sm transition-colors";

// Renders a "primary button + caret split" so the label is clickable AND the
// dropdown remains discoverable. Standard menu pattern (used by Notion, GitHub, etc).
// Hoisted OUT of the parent component so React doesn't remount the subtree on
// every render — this preserves menu open state and avoids DOM thrash.
const SplitButton = ({ palette, primaryLabel, PrimaryIcon, primaryAction, testId, children, disabled }) => (
  <DropdownMenu>
    <div className="inline-flex items-stretch rounded-sm overflow-hidden">
      {primaryAction ? (
        <button
          onClick={primaryAction}
          disabled={disabled}
          data-testid={`${testId}-primary`}
          className={`${BTN_BASE} ${palette} disabled:opacity-50 rounded-r-none pr-3`}
        >
          {PrimaryIcon && <PrimaryIcon className="w-4 h-4" />} {primaryLabel}
        </button>
      ) : (
        <DropdownMenuTrigger asChild>
          <button
            disabled={disabled}
            data-testid={`${testId}-primary`}
            className={`${BTN_BASE} ${palette} disabled:opacity-50 pr-3`}
          >
            {PrimaryIcon && <PrimaryIcon className="w-4 h-4" />} {primaryLabel}
            <ChevronDown className="w-3.5 h-3.5 -mr-1" />
          </button>
        </DropdownMenuTrigger>
      )}
      {primaryAction && (
        <DropdownMenuTrigger asChild>
          <button
            disabled={disabled}
            data-testid={`${testId}-caret`}
            className={`${BTN_BASE} ${palette} disabled:opacity-50 rounded-l-none pl-2 pr-2 border-l border-white/25`}
            aria-label="More actions"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </DropdownMenuTrigger>
      )}
    </div>
    <DropdownMenuContent align="start" className="min-w-[220px]">
      {children}
    </DropdownMenuContent>
  </DropdownMenu>
);

// ─── Component ──────────────────────────────────────────────────────────────

export default function DealActionBar({
  deal,
  contact,
  dealAssessments,
  onScopeEdit,
  onWorkOrder,
  onChangeOrder,
  onSendToField,
  onMarkComplete,
  onEmailScope,
  onEmailAssessment,
  markingComplete,
}) {
  const nav = useNavigate();
  const dealId = deal.id;

  // ── Existence flags — drives which label each button shows ───────────────
  const hasAssessment = (dealAssessments || []).length > 0;
  const primaryAssessment = hasAssessment ? dealAssessments[0] : null;

  // Scope is always generatable from deal fields, but we treat it as "created"
  // once the deal has a proposal option or a chosen amount set — otherwise the
  // PDF is essentially empty and misleading to email.
  const hasScope = Number(deal.chosen_amount || deal.proposal_option_1 || 0) > 0;

  // ── Handlers ─────────────────────────────────────────────────────────────

  const createAssessment = async () => {
    try {
      const r = await api.post("/assessments", { deal_id: dealId });
      nav(`/assessments/${r.data.id}`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || e.message);
    }
  };

  const editAssessment = () => {
    if (primaryAssessment) nav(`/assessments/${primaryAssessment.id}`);
  };

  const viewAssessmentPdf = (variant, print = false) => {
    if (!primaryAssessment) return;
    const path = variant === "basic" ? "evaluation.pdf" : "report.pdf";
    fetchAndOpenPdf(`${API}/assessments/${primaryAssessment.id}/${path}`, { print });
  };

  const downloadAssessmentPdf = (variant) => {
    if (!primaryAssessment) return;
    const path = variant === "basic" ? "evaluation.pdf" : "report.pdf";
    const label = (deal.title || "assessment").replace(/\s+/g, "_");
    fetchAndOpenPdf(`${API}/assessments/${primaryAssessment.id}/${path}`, {
      downloadAs: `sealtech-${variant === "basic" ? "evaluation" : "assessment"}-${label}.pdf`,
    });
  };

  const emailAssessmentPdf = (variant) => {
    if (onEmailAssessment) onEmailAssessment(primaryAssessment?.id, variant);
    else toast.info("Email is coming soon on assessments");
  };

  const viewScopePdf = (print = false) => {
    fetchAndOpenPdf(`${API}/deals/${dealId}/spec-sheet.pdf`, { print });
  };

  const downloadScopePdf = () => {
    const label = (deal.title || "project").replace(/\s+/g, "_");
    fetchAndOpenPdf(`${API}/deals/${dealId}/spec-sheet.pdf`, {
      downloadAs: `sealtech-scope-${label}.pdf`,
    });
  };

  const confirmMarkComplete = () => {
    const contractTotal = Number(deal.chosen_amount || 0);
    const summary = contractTotal > 0
      ? `This will draft the FINAL INVOICE for the remaining balance on the $${contractTotal.toLocaleString()} contract and close the deal.`
      : "This will close the deal and mark it Complete.";
    if (window.confirm(`${summary}\n\nContinue?`)) onMarkComplete();
  };

  return (
    <div className="flex items-center gap-2 flex-wrap" data-testid="deal-action-bar">
      {/* 1 ▪ Assessment (purple) ------------------------------------------- */}
      {hasAssessment ? (
        <SplitButton
          palette={PALETTE.assessment.solid}
          primaryLabel="Assessment"
          PrimaryIcon={ClipboardCheck}
          testId="action-assessment"
        >
          <DropdownMenuLabel className="text-[10px] uppercase tracking-wider">Full Report</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => viewAssessmentPdf("full")} data-testid="assessment-full-view">
            <Eye className="w-4 h-4 mr-2" /> View / Open
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => downloadAssessmentPdf("full")} data-testid="assessment-full-download">
            <Download className="w-4 h-4 mr-2" /> Download
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => viewAssessmentPdf("full", true)} data-testid="assessment-full-print">
            <Printer className="w-4 h-4 mr-2" /> Print
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => emailAssessmentPdf("full")} data-testid="assessment-full-email">
            <Mail className="w-4 h-4 mr-2" /> Email to Prospect
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-[10px] uppercase tracking-wider">Basic Evaluation</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => viewAssessmentPdf("basic")} data-testid="assessment-basic-view">
            <Eye className="w-4 h-4 mr-2" /> View / Open
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => downloadAssessmentPdf("basic")} data-testid="assessment-basic-download">
            <Download className="w-4 h-4 mr-2" /> Download
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => viewAssessmentPdf("basic", true)} data-testid="assessment-basic-print">
            <Printer className="w-4 h-4 mr-2" /> Print
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => emailAssessmentPdf("basic")} data-testid="assessment-basic-email">
            <Mail className="w-4 h-4 mr-2" /> Email to Prospect
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={editAssessment} data-testid="assessment-edit">
            <Edit3 className="w-4 h-4 mr-2" /> Edit Assessment Data
          </DropdownMenuItem>
        </SplitButton>
      ) : (
        <SplitButton
          palette={PALETTE.assessment.ghost}
          primaryLabel="Create Assessment"
          PrimaryIcon={Plus}
          testId="action-assessment"
        >
          <DropdownMenuLabel className="text-[10px] uppercase tracking-wider">Start a new report</DropdownMenuLabel>
          <DropdownMenuItem onClick={createAssessment} data-testid="assessment-create-full">
            <ClipboardCheck className="w-4 h-4 mr-2" /> Full Assessment (detailed)
          </DropdownMenuItem>
          <DropdownMenuItem onClick={createAssessment} data-testid="assessment-create-basic">
            <ClipboardCheck className="w-4 h-4 mr-2" /> Basic Evaluation (slim 6-page)
          </DropdownMenuItem>
          <div className="px-2 py-1.5 text-[10px] text-zinc-500 italic">
            Both use the same form — pick which PDF variant to generate later.
          </div>
        </SplitButton>
      )}

      {/* 2 ▪ Scope (blue) --------------------------------------------------- */}
      {hasScope ? (
        <SplitButton
          palette={PALETTE.scope.solid}
          primaryLabel="Scope"
          PrimaryIcon={FileText}
          testId="action-scope"
        >
          <DropdownMenuItem onClick={() => viewScopePdf(false)} data-testid="scope-view">
            <Eye className="w-4 h-4 mr-2" /> View / Open
          </DropdownMenuItem>
          <DropdownMenuItem onClick={downloadScopePdf} data-testid="scope-download">
            <Download className="w-4 h-4 mr-2" /> Download
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => viewScopePdf(true)} data-testid="scope-print">
            <Printer className="w-4 h-4 mr-2" /> Print
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onEmailScope} data-testid="scope-email">
            <Mail className="w-4 h-4 mr-2" /> Email to Prospect
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onScopeEdit} data-testid="scope-edit">
            <Edit3 className="w-4 h-4 mr-2" /> Edit Scope Data
          </DropdownMenuItem>
        </SplitButton>
      ) : (
        <SplitButton
          palette={PALETTE.scope.ghost}
          primaryLabel="Create Scope"
          PrimaryIcon={Plus}
          primaryAction={onScopeEdit}
          testId="action-scope"
        >
          <DropdownMenuItem onClick={onScopeEdit} data-testid="scope-edit">
            <Edit3 className="w-4 h-4 mr-2" /> Open Scope Editor
          </DropdownMenuItem>
          <div className="px-2 py-1.5 text-[10px] text-zinc-500 italic">
            Pick a proposal option / set the contract total to enable the PDF.
          </div>
        </SplitButton>
      )}

      {/* 3 ▪ Work Order (orange) ------------------------------------------- */}
      <SplitButton
        palette={deal.last_work_order_sent_at ? PALETTE.work_order.solid : PALETTE.work_order.ghost}
        primaryLabel={deal.last_work_order_sent_at ? "Work Order" : "Send Work Order"}
        PrimaryIcon={deal.last_work_order_sent_at ? FileText : Plus}
        primaryAction={onWorkOrder}
        testId="action-work-order"
      >
        <DropdownMenuItem onClick={onWorkOrder} data-testid="wo-send">
          <Mail className="w-4 h-4 mr-2" /> {deal.last_work_order_sent_at ? "Resend Work Order to Sub" : "Send Work Order to Sub"}
        </DropdownMenuItem>
        {deal.last_work_order_sent_at && (
          <div className="px-2 py-1.5 text-[10px] text-zinc-500 italic">
            Last sent {String(deal.last_work_order_sent_at).slice(0, 10)}
          </div>
        )}
      </SplitButton>

      {/* 4 ▪ Change Order (amber) ------------------------------------------ */}
      <button
        onClick={onChangeOrder}
        data-testid="action-change-order-primary"
        className={`${BTN_BASE} ${PALETTE.change_order.ghost}`}
      >
        <Plus className="w-4 h-4" /> Change Order
      </button>

      {/* 5 ▪ Send to Field (teal) ------------------------------------------ */}
      <button
        onClick={onSendToField}
        data-testid="action-send-to-field"
        className={`${BTN_BASE} ${PALETTE.field.solid}`}
        title="Dispatch photo capture + on-site info to the crew"
      >
        <Camera className="w-4 h-4" /> Send to Field
      </button>

      {/* 6 ▪ Mark Complete (emerald) --------------------------------------- */}
      <button
        onClick={confirmMarkComplete}
        disabled={markingComplete}
        data-testid="action-mark-complete"
        className={`${BTN_BASE} ${PALETTE.complete.solid} disabled:opacity-50`}
        title="Close this deal and draft the Final Invoice"
      >
        <CheckSquare className="w-4 h-4" /> {markingComplete ? "Drafting…" : "Mark Complete"}
      </button>
    </div>
  );
}
