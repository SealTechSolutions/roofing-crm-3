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
import React, { useMemo, useState } from "react";
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
  Package,
  ShoppingCart,
  X,
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
  purchase:     { solid: "bg-indigo-700 hover:bg-indigo-800 text-white",     ghost: "border border-indigo-300 bg-indigo-50 text-indigo-900 hover:border-indigo-700" },
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

  // ── Purchase-Order vendor groups ─────────────────────────────────────────
  // Every material take-off line already carries `vendor_id` + `vendor_name`
  // (snapshotted at add time). Group them so the "Create PO" dropdown can
  // spin up one PO PDF per vendor / manufacturer without any picker.
  const poVendorGroups = useMemo(() => {
    const lines = deal.material_takeoff || [];
    const groups = new Map();
    for (const ln of lines) {
      const vid = ln.vendor_id || "";
      const vname = ln.vendor_name || "Unassigned";
      if (!vid && !vname) continue;
      const key = vid || `__name__${vname}`;
      const g = groups.get(key) || {
        vendor_id: vid,
        vendor_name: vname,
        lines: 0,
        units: 0,
        ordered: 0,
      };
      g.lines += 1;
      g.units += Number(ln.quantity || 0);
      if (ln.ordered) g.ordered += 1;
      groups.set(key, g);
    }
    return Array.from(groups.values())
      .filter((g) => g.vendor_id) // PDF endpoint needs a real vendor_id
      .sort((a, b) => a.vendor_name.localeCompare(b.vendor_name));
  }, [deal.material_takeoff]);

  // Compose-modal state for "Email PO to Vendor" — user reviews the prefilled
  // subject/body before it goes out, matching the pattern the user requested.
  const [poCompose, setPoCompose] = useState(null); // { vendor_id, vendor_name }

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

  // ── Purchase Order helpers ───────────────────────────────────────────────
  const viewPoPdf = (vendorId, { print = false } = {}) => {
    fetchAndOpenPdf(`${API}/deals/${dealId}/purchase-order/${vendorId}.pdf`, { print });
  };

  const downloadPoPdf = (vendor) => {
    const projLabel = (deal.title || "project").replace(/\s+/g, "_");
    const vendLabel = (vendor.vendor_name || "vendor").replace(/\s+/g, "_");
    fetchAndOpenPdf(`${API}/deals/${dealId}/purchase-order/${vendor.vendor_id}.pdf`, {
      downloadAs: `sealtech-PO-${projLabel}-${vendLabel}.pdf`,
    });
  };

  const openComposePo = (vendor) => {
    setPoCompose(vendor);
  };

  const goToTakeoff = () => {
    // Scroll to the take-off card if it exists; otherwise pop open the
    // scope editor so the rep can add lines.
    const el = document.querySelector('[data-testid="takeoff-card"]');
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (onScopeEdit) {
      onScopeEdit();
    } else {
      toast.info("Add material take-off lines from the Scope section first.");
    }
  };

  const confirmMarkComplete = () => {
    const contractTotal = Number(deal.chosen_amount || 0);
    const summary = contractTotal > 0
      ? `This will draft the FINAL INVOICE for the remaining balance on the $${contractTotal.toLocaleString()} contract and close the deal.`
      : "This will close the deal and mark it Complete.";
    if (window.confirm(`${summary}\n\nContinue?`)) onMarkComplete();
  };

  return (
    <>
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

      {/* 4b ▪ Create PO (indigo) — one PO per vendor / manufacturer -------- */}
      {poVendorGroups.length > 0 ? (
        <SplitButton
          palette={PALETTE.purchase.ghost}
          primaryLabel="Create PO"
          PrimaryIcon={ShoppingCart}
          testId="action-purchase-order"
        >
          <DropdownMenuLabel className="text-[10px] uppercase tracking-wider">
            One PO per manufacturer / vendor
          </DropdownMenuLabel>
          <div className="px-2 pb-1.5 text-[10px] text-zinc-500 italic">
            Materials are pulled from this deal&apos;s Take-Off. No pricing on PDF.
          </div>
          <DropdownMenuSeparator />
          {poVendorGroups.map((v) => (
            <DropdownMenuSub key={v.vendor_id}>
              <DropdownMenuSubTrigger data-testid={`po-vendor-${v.vendor_id}`}>
                <Package className="w-4 h-4 mr-2 text-indigo-700" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">{v.vendor_name}</div>
                  <div className="text-[10px] text-zinc-500">
                    {v.lines} line{v.lines !== 1 ? "s" : ""} · {v.units % 1 === 0 ? v.units : v.units.toFixed(1)} units
                    {v.ordered > 0 ? ` · ${v.ordered} already ordered` : ""}
                  </div>
                </div>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="min-w-[200px]">
                <DropdownMenuItem onClick={() => viewPoPdf(v.vendor_id)} data-testid={`po-view-${v.vendor_id}`}>
                  <Eye className="w-4 h-4 mr-2" /> View / Open
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => downloadPoPdf(v)} data-testid={`po-download-${v.vendor_id}`}>
                  <Download className="w-4 h-4 mr-2" /> Download
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => viewPoPdf(v.vendor_id, { print: true })} data-testid={`po-print-${v.vendor_id}`}>
                  <Printer className="w-4 h-4 mr-2" /> Print
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => openComposePo(v)} data-testid={`po-email-${v.vendor_id}`}>
                  <Mail className="w-4 h-4 mr-2" /> Email to Vendor…
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ))}
        </SplitButton>
      ) : (
        <SplitButton
          palette={PALETTE.purchase.ghost}
          primaryLabel="Create PO"
          PrimaryIcon={ShoppingCart}
          primaryAction={goToTakeoff}
          testId="action-purchase-order"
        >
          <DropdownMenuItem onClick={goToTakeoff} data-testid="po-open-takeoff">
            <Package className="w-4 h-4 mr-2" /> Open Material Take-Off →
          </DropdownMenuItem>
          <div className="px-2 py-1.5 text-[10px] text-zinc-500 italic">
            Add take-off lines with a vendor to unlock per-vendor POs.
          </div>
        </SplitButton>
      )}

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

      {poCompose && (
        <PurchaseOrderComposeModal
          deal={deal}
          vendor={poCompose}
          onClose={() => setPoCompose(null)}
          onPreview={() => viewPoPdf(poCompose.vendor_id)}
          onSent={() => setPoCompose(null)}
        />
      )}
    </>
  );
}


// ─── Purchase Order Compose Modal ───────────────────────────────────────────
// Small, self-contained review-before-send dialog. Pre-fills the "to" from
// the vendor record and provides sensible subject/body defaults, but the rep
// can edit anything before it goes out. A "Preview PDF" button lets them
// double-check the material take-off render inline first.
function PurchaseOrderComposeModal({ deal, vendor, onClose, onPreview, onSent }) {
  const dealId = deal.id;

  // Build the same PO # convention the backend uses so the subject preview
  // matches: "<street>_<city>" or the deal title as fallback.
  const poNumber = useMemo(() => {
    const street = (deal.property_address || deal.address || "").trim();
    const city = (deal.property_city || deal.city || "").trim();
    if (street && city) return `${street}_${city}`;
    return (deal.title || "").trim() || dealId.slice(0, 8);
  }, [deal, dealId]);
  const projectName = poNumber;
  const vendorName = vendor.vendor_name || "Vendor";

  const defaultSubject = `Purchase Order — ${poNumber}`;
  const defaultBody =
    `Hi ${vendorName},\n\n` +
    `Please find attached Purchase Order ${poNumber} for project ${projectName}.\n\n` +
    `Could you confirm receipt, lead time, and pricing? Please call Darren Oliver at 720-715-9955 ` +
    `if you have any questions or to discuss volume pricing.\n\n` +
    `Thank you,\nSealTech Building Solutions  ·  720-715-9955`;

  const [toEmail, setToEmail] = useState(vendor.vendor_email || "");
  const [ccEmail, setCcEmail] = useState("");
  const [subject, setSubject] = useState(defaultSubject);
  const [bodyText, setBodyText] = useState(defaultBody);
  const [sending, setSending] = useState(false);

  // Load vendor record once to prefill the recipient email — the take-off
  // line snapshot doesn't carry email, so we look it up on open.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api.get(`/vendors/${vendor.vendor_id}`);
        if (cancelled) return;
        const v = r?.data || {};
        if (!toEmail && v.email) setToEmail(v.email);
      } catch {
        /* silent — user can type the email manually */
      }
    })();
    return () => { cancelled = true; };
  }, [vendor.vendor_id]);

  const send = async () => {
    if (!toEmail || !toEmail.includes("@")) {
      toast.error("Please enter a valid recipient email.");
      return;
    }
    setSending(true);
    try {
      const r = await api.post(`/deals/${dealId}/purchase-order/${vendor.vendor_id}/email`, {
        to_email: toEmail,
        cc_email: ccEmail,
        subject,
        body_text: bodyText,
        // Let backend regenerate HTML from plain text so formatting stays clean —
        // we send the same text as body_html wrapped in <pre> for safety.
        body_html: `<pre style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#0A0A0A;white-space:pre-wrap;margin:0;">${bodyText
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")}</pre>`,
      });
      toast.success(r?.data?.message || `PO emailed to ${toEmail}`);
      onSent?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || e.message || "Send failed");
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
      data-testid="po-compose-modal"
    >
      <div
        className="bg-white rounded-sm max-w-2xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-zinc-200 flex items-start justify-between">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-indigo-700">
              Purchase Order
            </div>
            <h2 className="font-heading text-xl font-black">Email PO to {vendorName}</h2>
            <div className="text-[11px] text-zinc-500 mt-1">
              PO # <b>{poNumber}</b> · Materials pulled live from this deal&apos;s Take-Off
            </div>
          </div>
          <button
            onClick={onClose}
            data-testid="po-compose-close"
            className="text-zinc-400 hover:text-zinc-700 leading-none"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-3 text-sm">
          <button
            type="button"
            onClick={onPreview}
            data-testid="po-compose-preview"
            className="inline-flex items-center gap-2 h-9 px-3 text-xs font-bold uppercase tracking-wider rounded-sm border border-indigo-300 text-indigo-800 bg-indigo-50 hover:bg-indigo-100"
          >
            <Eye className="w-4 h-4" /> Preview PDF
          </button>

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-600 mb-1">
              To *
            </label>
            <input
              value={toEmail}
              onChange={(e) => setToEmail(e.target.value)}
              placeholder="vendor@example.com"
              data-testid="po-compose-to"
              className="w-full h-10 px-3 border border-zinc-300 rounded-sm text-sm"
            />
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-600 mb-1">
              CC
            </label>
            <input
              value={ccEmail}
              onChange={(e) => setCcEmail(e.target.value)}
              placeholder="Optional cc — separate multiple with commas"
              data-testid="po-compose-cc"
              className="w-full h-10 px-3 border border-zinc-300 rounded-sm text-sm"
            />
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-600 mb-1">
              Subject
            </label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              data-testid="po-compose-subject"
              className="w-full h-10 px-3 border border-zinc-300 rounded-sm text-sm"
            />
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-600 mb-1">
              Message
            </label>
            <textarea
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
              rows={10}
              data-testid="po-compose-body"
              className="w-full px-3 py-2 border border-zinc-300 rounded-sm text-sm font-mono"
            />
            <div className="text-[10px] text-zinc-500 mt-1">
              PDF is attached automatically — you don&apos;t need to reference it in the body.
            </div>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-zinc-200 flex items-center justify-between gap-3">
          <div className="text-[11px] text-zinc-500">
            Sent from SealTech · lines will be flagged as <b>ordered</b> after send.
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              data-testid="po-compose-cancel"
              className="h-10 px-4 text-xs font-bold uppercase tracking-wider rounded-sm text-zinc-700 hover:bg-zinc-100"
            >
              Cancel
            </button>
            <button
              onClick={send}
              disabled={sending}
              data-testid="po-compose-send"
              className="h-10 px-4 text-xs font-bold uppercase tracking-wider rounded-sm bg-indigo-700 hover:bg-indigo-800 text-white disabled:opacity-50 inline-flex items-center gap-2"
            >
              <Mail className="w-4 h-4" /> {sending ? "Sending…" : "Send Email"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
