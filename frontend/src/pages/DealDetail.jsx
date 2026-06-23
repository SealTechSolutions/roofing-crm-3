import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams, useNavigate, useSearchParams } from "react-router-dom";
import { api, formatCurrency, formatApiError, API } from "@/lib/api";
import { ArrowLeft, Plus, Trash2, FileText, Star, Download, Printer, Mail, Wrench, FilePlus, ClipboardCheck, Clock, Camera, CheckSquare, X as XIcon } from "lucide-react";
import { toast } from "sonner";
import { StatusPill } from "@/pages/Dashboard";
import Documents from "@/components/Documents";
import MaterialTakeoff from "@/components/MaterialTakeoff";
import { ScopePreview } from "@/pages/Deals";
import { formatPhoneDisplay } from "@/lib/format";
import ProjectPhotos from "@/components/ProjectPhotos";
import GrammarCheck from "@/components/GrammarCheck";
import { DealStagePipeline, NextStepCard, DealActivityTimeline, DealQuickActions } from "@/components/DealWorkflow";
import { InvoiceEditor } from "@/pages/Invoices";
import ScopeEditorModal from "@/components/ScopeEditorModal";
import GetAppOnPhoneModal from "@/components/GetAppOnPhoneModal";
import DealSchedulePanel from "@/components/DealSchedulePanel";

export default function DealDetail() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const [deal, setDeal] = useState(null);
  const [contact, setContact] = useState(null);
  const [property, setProperty] = useState(null);
  const [vendors, setVendors] = useState([]);
  const [options, setOptions] = useState({});
  const [saving, setSaving] = useState(false);
  const [vendorBills, setVendorBills] = useState([]);  // actual bills linked to this project
  const [emailScopeOpen, setEmailScopeOpen] = useState(false);
  const [dealInvoices, setDealInvoices] = useState([]);
  const [dealAssessments, setDealAssessments] = useState([]);
  // One-click + Invoice / Record Payment quick-action modals (live on the Deal page itself)
  const [invoiceEditor, setInvoiceEditor] = useState(null); // null | invoice object (new or existing)
  const [scopeEditorOpen, setScopeEditorOpen] = useState(false);
  const [sendToFieldOpen, setSendToFieldOpen] = useState(false);
  const [workOrderOpen, setWorkOrderOpen] = useState(false);
  const [finalInvoicePreview, setFinalInvoicePreview] = useState(null); // {contract_total, already_invoiced, final_amount, existing_final_invoice_id?}
  const [closedBannerDismissed, setClosedBannerDismissed] = useState(false);
  const [markingComplete, setMarkingComplete] = useState(false);
  const [googleConnected, setGoogleConnected] = useState(false);

  // Auto-open the scope editor when arriving from the Calculator's
  // "Open Scope →" button (`/deals/<id>?openScope=1`).
  useEffect(() => {
    if (sp.get("openScope") === "1") {
      setScopeEditorOpen(true);
    }
  }, [sp]);

  const reload = async () => {
    const r = await api.get(`/deals/${id}`);
    setDeal(r.data);
    if (r.data.contact_id) {
      try { const c = await api.get(`/contacts/${r.data.contact_id}`); setContact(c.data); } catch { setContact(null); }
    } else setContact(null);
    if (r.data.property_id) {
      try { const p = await api.get(`/properties/${r.data.property_id}`); setProperty(p.data); } catch { setProperty(null); }
    } else setProperty(null);
  };

  useEffect(() => {
    reload().catch(() => nav("/projects"));
    api.get("/vendors").then((r) => setVendors(r.data));
    api.get("/options").then((r) => setOptions(r.data));
    api.get(`/vendor-bills?project_id=${id}`).then((r) => setVendorBills(r.data)).catch(() => setVendorBills([]));
    api.get(`/invoices?deal_id=${id}`).then((r) => setDealInvoices(r.data || [])).catch(() => setDealInvoices([]));
    api.get(`/assessments?deal_id=${id}`).then((r) => setDealAssessments(r.data || [])).catch(() => setDealAssessments([]));
    api.get(`/integrations/google/status`).then((r) => setGoogleConnected(!!r.data?.connected)).catch(() => setGoogleConnected(false));
  }, [id]);

  // Refresh the Final-invoice preview whenever this deal's status flips, so
  // the Closed-stage suggestion banner can show the projected balance amount.
  useEffect(() => {
    if (!deal) return;
    if (deal.status !== "Closed") {
      setFinalInvoicePreview(null);
      return;
    }
    api.get(`/deals/${id}/final-invoice/preview`)
      .then((r) => setFinalInvoicePreview(r.data))
      .catch(() => setFinalInvoicePreview(null));
  }, [deal?.status, id]);

  /**
   * Open the freshly-drafted Final invoice (or the pre-existing one) in the
   * inline InvoiceEditor so the user can review/edit before sending.
   */
  const markCompleteAndInvoice = async () => {
    if (markingComplete) return;
    setMarkingComplete(true);
    try {
      const r = await api.post(`/deals/${id}/final-invoice`);
      const newInv = r.data;
      // Refresh the local deal-invoices list so the banner updates.
      api.get(`/invoices?deal_id=${id}`)
        .then((rr) => setDealInvoices(rr.data || []))
        .catch(() => { /* refresh failure is not fatal */ });
      api.get(`/deals/${id}/final-invoice/preview`)
        .then((rp) => setFinalInvoicePreview(rp.data))
        .catch(() => { /* preview refresh failure is not fatal */ });
      toast.success(`Final invoice ${newInv.invoice_number} drafted ($${Number(newInv.total || newInv.total_amount || newInv.subtotal || 0).toLocaleString()})`);
      setInvoiceEditor(newInv);
    } catch (e) {
      toast.error(e?.response?.data?.detail || e.message || "Could not draft Final invoice");
    } finally {
      setMarkingComplete(false);
    }
  };

  const totals = useMemo(() => {
    if (!deal) return { revenue: 0, costs: 0, profit: 0, margin: 0, scheduled: 0, received: 0, outstanding: 0, paidCosts: 0, pendingCosts: 0, actualCosts: 0, actualPaid: 0, actualUnpaid: 0, actualProfit: 0, actualMargin: 0 };
    const revenue = Number(deal.chosen_amount || 0);
    const items = deal.cost_items || [];
    const costs = items.reduce((s, i) => s + Number(i.amount || 0), 0);
    const paidCosts = items.filter((i) => i.status === "Paid").reduce((s, i) => s + Number(i.amount || 0), 0);
    const pendingCosts = costs - paidCosts;
    const milestones = deal.payment_milestones || [];
    const scheduled = milestones.reduce((s, m) => s + Number(m.amount || 0), 0);
    const received = milestones.filter((m) => m.status === "Paid").reduce((s, m) => s + Number(m.amount || 0), 0);
    const outstanding = scheduled - received;

    // Actual costs from vendor bills — sum line items where project_id matches this project
    let actualCosts = 0;
    let actualPaid = 0;
    let actualUnpaid = 0;
    for (const b of vendorBills) {
      const projectLines = (b.line_items || []).filter((li) => li.project_id === deal.id);
      const lineTotal = projectLines.reduce((s, li) => s + Number(li.amount || 0), 0);
      actualCosts += lineTotal;
      // Paid proportionally — bill paid_amount / total ratio × this project's share
      const billTotal = Number(b.total || 0);
      const paidRatio = billTotal > 0 ? Number(b.paid_amount || 0) / billTotal : 0;
      const paidShare = lineTotal * paidRatio;
      if (b.status === "Paid") {
        actualPaid += lineTotal;
      } else {
        actualPaid += paidShare;
        actualUnpaid += lineTotal - paidShare;
      }
    }
    const actualProfit = revenue - actualCosts;
    const actualMargin = revenue > 0 ? (actualProfit / revenue) * 100 : 0;

    return {
      revenue, costs, profit: revenue - costs,
      margin: revenue > 0 ? ((revenue - costs) / revenue) * 100 : 0,
      scheduled, received, outstanding, paidCosts, pendingCosts,
      actualCosts: Math.round(actualCosts * 100) / 100,
      actualPaid: Math.round(actualPaid * 100) / 100,
      actualUnpaid: Math.round(actualUnpaid * 100) / 100,
      actualProfit: Math.round(actualProfit * 100) / 100,
      actualMargin,
    };
  }, [deal, vendorBills]);

  const persist = async (patch) => {
    if (!deal) return;
    setSaving(true);
    try {
      const body = { ...deal, ...patch };
      // Strip server-managed + server-computed fields. Backend recomputes these
      // from cost_items / payment_milestones / proposal_options on PUT.
      ["id", "created_at", "updated_at", "created_by",
       "materials_cost", "labor_cost", "subcontractor_cost", "other_expenses_total",
       "total_costs", "profit", "margin_pct",
       "is_deleted", "deleted_at", "deleted_by",
       "assigned_user_name", "primary_contact_name", "property_name"
      ].forEach((k) => { delete body[k]; });
      const r = await api.put(`/deals/${id}`, body);
      setDeal(r.data);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setSaving(false);
    }
  };

  const applyTemplate = (key) => {
    const tpl = options.milestone_templates?.[key];
    if (!tpl) return;
    if ((deal.payment_milestones || []).length > 0 && !window.confirm("Replace existing milestones?")) return;
    const ms = tpl.map((t) => ({ label: t.label, percent: t.percent, status: "Pending", due_date: "", paid_date: "", notes: "" }));
    persist({ payment_milestones: ms });
  };

  const addMilestone = () => {
    const ms = [...(deal.payment_milestones || []), { label: "", percent: 0, status: "Pending", due_date: "", paid_date: "", notes: "" }];
    persist({ payment_milestones: ms });
  };

  const updateMilestone = (idx, patch) => {
    const ms = [...(deal.payment_milestones || [])];
    ms[idx] = { ...ms[idx], ...patch };
    persist({ payment_milestones: ms });
  };

  const removeMilestone = (idx) => {
    if (!window.confirm("Remove this milestone?")) return;
    const ms = [...(deal.payment_milestones || [])];
    ms.splice(idx, 1);
    persist({ payment_milestones: ms });
  };

  const addCostItem = () => {
    // Blur any in-progress cell edit so pending typed values commit BEFORE we
    // add a new row (otherwise the re-render wipes uncommitted input).
    if (document.activeElement && typeof document.activeElement.blur === "function") {
      document.activeElement.blur();
    }
    // Defer to the next microtask so the blur's onCommit handler runs first
    setTimeout(() => {
      const items = [...(deal?.cost_items || []), { category: "Materials", vendor_id: null, vendor_name: "", description: "", amount: 0, date: "", status: "Pending" }];
      persist({ cost_items: items });
    }, 0);
  };

  const updateCostItem = (idx, patch) => {
    const items = [...(deal.cost_items || [])];
    items[idx] = { ...items[idx], ...patch };
    persist({ cost_items: items });
  };

  const removeCostItem = async (idx) => {
    if (!window.confirm("Remove this cost item?")) return;
    // Compute the new list from the CURRENT deal (this read is synchronous and
    // captures any cell edits that have already committed). Then PUT directly.
    const items = (deal.cost_items || []).filter((_, i) => i !== idx);
    try {
      const r = await api.put(`/deals/${id}`, (() => {
        const body = { ...deal, cost_items: items };
        ["id","created_at","updated_at","created_by",
         "materials_cost","labor_cost","subcontractor_cost","other_expenses_total",
         "total_costs","profit","margin_pct","is_deleted","deleted_at","deleted_by",
         "assigned_user_name","primary_contact_name","property_name"
        ].forEach((k) => delete body[k]);
        return body;
      })());
      setDeal(r.data);
      toast.success("Cost item removed");
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message || "Delete failed");
    }
  };

  // ----- Maintenance Plan handlers -----
  const [newVisit, setNewVisit] = useState({ visit_date: new Date().toISOString().slice(0, 10), amount: 0, subcontractor_id: "", notes: "" });
  const subcontractors = useMemo(() => vendors.filter((v) => v.kind === "Subcontractor"), [vendors]);

  const logVisit = async () => {
    if (!newVisit.visit_date) {
      toast.error("Visit date is required");
      return;
    }
    setSaving(true);
    try {
      const payload = { ...newVisit, amount: Number(newVisit.amount || 0) };
      if (!payload.subcontractor_id) delete payload.subcontractor_id;
      const r = await api.post(`/deals/${id}/maintenance-visits`, payload);
      setDeal(r.data);
      // Find newest visit
      const visits = r.data?.maintenance_visits || [];
      const newest = [...visits].sort((a, b) => (b.visit_date || "").localeCompare(a.visit_date || ""))[0];
      setNewVisit({ visit_date: new Date().toISOString().slice(0, 10), amount: Number(r.data.maintenance_rate || 0), subcontractor_id: "", notes: "" });
      toast.success("Visit logged — next due date advanced");
      if (newest && Number(payload.amount) > 0 && window.confirm(`Create a draft invoice for $${Number(payload.amount).toLocaleString()}?`)) {
        try {
          const inv = await api.post("/invoices/from-maintenance-visit", { deal_id: id, visit_id: newest.id });
          toast.success(`Draft invoice ${inv.data.invoice_number} created`);
        } catch (e) {
          toast.error("Visit logged, but invoice could not be auto-created");
        }
      }
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setSaving(false);
    }
  };

  const removeVisit = async (visitId) => {
    if (!window.confirm("Remove this visit? Next due date will recalculate.")) return;
    setSaving(true);
    try {
      const r = await api.delete(`/deals/${id}/maintenance-visits/${visitId}`);
      setDeal(r.data);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setSaving(false);
    }
  };

  // ----- Change Order handlers -----
  const [newCO, setNewCO] = useState({ description: "", amount: 0, date: new Date().toISOString().slice(0, 10), status: "Approved", notes: "" });

  const addChangeOrder = () => {
    if (!newCO.description.trim()) {
      toast.error("Description is required");
      return;
    }
    const co = { ...newCO, id: crypto.randomUUID(), amount: Number(newCO.amount || 0) };
    const list = [...(deal?.change_orders || []), co];
    persist({ change_orders: list });
    setNewCO({ description: "", amount: 0, date: new Date().toISOString().slice(0, 10), status: "Approved", notes: "" });
  };

  const removeChangeOrder = (coId) => {
    if (!window.confirm("Remove this change order?")) return;
    persist({ change_orders: (deal?.change_orders || []).filter((co) => co.id !== coId) });
  };

  const updateChangeOrder = (coId, patch) => {
    const list = (deal?.change_orders || []).map((co) => (co.id === coId ? { ...co, ...patch } : co));
    persist({ change_orders: list });
  };

  const changeOrderTotal = (deal?.change_orders || [])
    .filter((co) => (co.status || "Approved") === "Approved")
    .reduce((s, co) => s + Number(co.amount || 0), 0);

  if (!deal) return <div className="p-8 text-xs uppercase tracking-[0.2em] text-zinc-500">Loading...</div>;

  return (
    <div className="p-6 sm:p-8 animate-in fade-in duration-500" data-testid="deal-detail-page">
      <Link to="/projects" className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 hover:text-blue-700 mb-4" data-testid="back-to-deals">
        <ArrowLeft className="w-3 h-3" /> Back to Projects
      </Link>

      {/* Closed-stage suggestion: this deal just hit Closed but no Final invoice exists yet. */}
      {deal.status === "Closed"
        && finalInvoicePreview
        && !finalInvoicePreview.existing_final_invoice_id
        && finalInvoicePreview.final_amount > 0
        && !closedBannerDismissed && (
        <div
          className="mb-6 bg-emerald-50 border border-emerald-300 rounded-sm p-4 flex items-start gap-3"
          data-testid="final-invoice-suggestion"
        >
          <CheckSquare className="w-5 h-5 text-emerald-700 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-emerald-900">This project is Closed — ready to bill?</div>
            <div className="text-xs text-emerald-800 mt-1 leading-snug">
              Contract <b>${finalInvoicePreview.contract_total.toLocaleString()}</b>
              {" "}minus prior invoices <b>${finalInvoicePreview.already_invoiced.toLocaleString()}</b>
              {" "}= <b className="text-emerald-950">${finalInvoicePreview.final_amount.toLocaleString()}</b> remaining balance.
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button
                data-testid="final-invoice-suggest-create"
                onClick={markCompleteAndInvoice}
                disabled={markingComplete}
                className="inline-flex items-center gap-1.5 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white text-[10px] font-bold uppercase tracking-wider px-3 h-8 rounded-sm"
              >
                <CheckSquare className="w-3.5 h-3.5" /> {markingComplete ? "Drafting…" : "Draft Final Invoice"}
              </button>
              <button
                data-testid="final-invoice-suggest-dismiss"
                onClick={() => setClosedBannerDismissed(true)}
                className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 hover:text-emerald-900 px-2 h-8"
              >
                Not yet
              </button>
            </div>
          </div>
          <button
            onClick={() => setClosedBannerDismissed(true)}
            className="text-emerald-700 hover:text-emerald-900 -mr-1"
            aria-label="Dismiss"
          >
            <XIcon className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="flex items-start justify-between mb-8 pb-6 border-b border-zinc-200 gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-3 mb-2 flex-wrap">
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-700">{deal.deal_type || "Scope"}</div>
            <StatusPill status={deal.status} />
            {saving && <div className="text-[10px] uppercase tracking-wider text-zinc-400">Saving...</div>}
          </div>
          <h1 className="font-heading text-3xl sm:text-4xl font-black tracking-tight" data-testid="deal-title">{deal.title}</h1>
          <div className="mt-2 text-xs uppercase tracking-wider text-zinc-500">{deal.lead_source} · {deal.project_type}</div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            data-testid="generate-spec-sheet"
            onClick={async () => {
              const token = localStorage.getItem("crm_token");
              try {
                toast.info("Generating spec sheet...");
                const r = await fetch(`${API}/deals/${id}/spec-sheet.pdf`, { headers: { Authorization: `Bearer ${token}` } });
                if (!r.ok) {
                  const txt = await r.text();
                  throw new Error(`Spec sheet failed (${r.status}): ${txt.slice(0,200)}`);
                }
                const blob = await r.blob();
                const url = URL.createObjectURL(blob);
                const newWin = window.open(url, "_blank");
                if (!newWin) {
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `sealtech-scope-${(deal.title || "project").replace(/\s+/g, "_")}.pdf`;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                }
                setTimeout(() => URL.revokeObjectURL(url), 60_000);
                toast.success("Spec sheet ready");
              } catch (e) {
                toast.error(e.message || "Could not generate spec sheet");
              }
            }}
            className="inline-flex items-center gap-2 bg-blue-700 text-white px-4 h-10 text-xs font-bold uppercase tracking-wider hover:bg-blue-800 rounded-sm transition-colors"
          >
            <Download className="w-4 h-4" /> View / Download
          </button>
          <button
            data-testid="print-spec-sheet"
            onClick={async () => {
              const token = localStorage.getItem("crm_token");
              try {
                toast.info("Preparing for print...");
                const r = await fetch(`${API}/deals/${id}/spec-sheet.pdf`, { headers: { Authorization: `Bearer ${token}` } });
                if (!r.ok) throw new Error(`Print failed (${r.status})`);
                const blob = await r.blob();
                const url = URL.createObjectURL(blob);
                const win = window.open(url, "_blank");
                if (!win) {
                  toast.error("Pop-up blocked. Allow pop-ups from this site to print directly.");
                } else {
                  // Try to auto-trigger print once the PDF loads
                  win.addEventListener("load", () => { try { win.print(); } catch (e) {} });
                  // Fallback: trigger print after 1.5s in case load doesn't fire for PDFs
                  setTimeout(() => { try { win.print(); } catch (e) {} }, 1500);
                }
                setTimeout(() => URL.revokeObjectURL(url), 60_000);
              } catch (e) {
                toast.error(e.message || "Could not print");
              }
            }}
            className="inline-flex items-center gap-2 bg-zinc-950 text-white px-4 h-10 text-xs font-bold uppercase tracking-wider hover:bg-zinc-800 rounded-sm transition-colors"
          >
            <Printer className="w-4 h-4" /> Print
          </button>
          <button
            data-testid="email-spec-sheet"
            onClick={() => setEmailScopeOpen(true)}
            className="inline-flex items-center gap-2 border border-zinc-300 text-zinc-700 px-4 h-10 text-xs font-bold uppercase tracking-wider hover:border-zinc-950 rounded-sm transition-colors"
          >
            <Mail className="w-4 h-4" /> Email to Prospect
          </button>
          <button
            data-testid="send-work-order"
            onClick={() => setWorkOrderOpen(true)}
            title="Issue a Work Order to the subcontractor — includes the spec sheet"
            className="inline-flex items-center gap-2 bg-blue-700 text-white px-4 h-10 text-xs font-bold uppercase tracking-wider hover:bg-blue-800 rounded-sm transition-colors"
          >
            <FileText className="w-4 h-4" /> Send Work Order
          </button>
          <button
            data-testid="new-assessment-from-deal"
            onClick={async () => {
              try {
                const r = await api.post("/assessments", { deal_id: id });
                nav(`/assessments/${r.data.id}`);
              } catch (e) {
                toast.error(e?.response?.data?.detail || e.message);
              }
            }}
            className="inline-flex items-center gap-2 border border-blue-700 text-blue-700 px-4 h-10 text-xs font-bold uppercase tracking-wider hover:bg-blue-50 rounded-sm transition-colors"
          >
            <ClipboardCheck className="w-4 h-4" /> New Assessment
          </button>
          <button
            data-testid="send-to-field"
            onClick={() => setSendToFieldOpen(true)}
            title="Open Field Photo Capture on your phone with this project pre-selected"
            className="inline-flex items-center gap-2 bg-amber-600 text-white px-4 h-10 text-xs font-bold uppercase tracking-wider hover:bg-amber-700 rounded-sm transition-colors"
          >
            <Camera className="w-4 h-4" /> Send to Field
          </button>
          <button
            data-testid="mark-complete-btn"
            onClick={markCompleteAndInvoice}
            disabled={markingComplete}
            title="Mark this project complete and draft the Final invoice for the remaining balance"
            className="inline-flex items-center gap-2 bg-emerald-700 text-white px-4 h-10 text-xs font-bold uppercase tracking-wider hover:bg-emerald-800 disabled:opacity-50 rounded-sm transition-colors"
          >
            <CheckSquare className="w-4 h-4" /> {markingComplete ? "Drafting…" : "Mark Complete"}
          </button>
          <DealQuickActions
            deal={deal}
            onEmailScope={() => setEmailScopeOpen(true)}
            onEditScope={() => setScopeEditorOpen(true)}
            onCreateInvoice={() => {
              // Prefill from deal + linked contact + property
              const contractTotal = Number(deal.chosen_amount || 0);
              const desc = deal.title ? `${deal.title} — Contract` : "Project Invoice";
              const fullAddr = [property?.address, property?.city, property?.state, property?.zip]
                .filter(Boolean)
                .join(", ");
              setInvoiceEditor({
                deal_id: deal.id,
                customer_contact_id: deal.contact_id || "",
                invoice_type: "Project Amount",
                bill_to_company: property?.name || contact?.company || "",
                bill_to_name: contact?.name || "",
                bill_to_address: property?.address || contact?.address || "",
                bill_to_city: property?.city || contact?.city || "",
                bill_to_state: property?.state || contact?.state || "",
                bill_to_zip: property?.zip || contact?.zip || "",
                bill_to_email: contact?.email || "",
                invoice_date: new Date().toISOString().slice(0, 10),
                terms: "Due Upon Receipt",
                project_title: deal.title || "",
                project_address: fullAddr,
                project_total: contractTotal,
                line_items: contractTotal > 0
                  ? [{ description: desc, quantity: 1, unit_price: contractTotal, amount: contractTotal }]
                  : [{ description: desc, quantity: 1, unit_price: 0, amount: 0 }],
                status: "Draft",
              });
            }}
            onRecordPayment={async () => {
              // Find an open invoice on this deal; if none, prompt user to create one first
              const unpaid = (dealInvoices || []).filter(
                (inv) => !["Paid", "Void"].includes(inv.status) &&
                  Number(inv.balance_due || 0) > 0.005
              );
              if (unpaid.length === 0) {
                toast.info(
                  "No open invoices on this project yet. Click + Invoice first, save it, then come back to record a payment."
                );
                return;
              }
              // Pick the oldest unpaid (FIFO collection) and open the editor
              const target = [...unpaid].sort((a, b) =>
                String(a.invoice_date || a.created_at || "").localeCompare(
                  String(b.invoice_date || b.created_at || "")
                )
              )[0];
              try {
                const full = await api.get(`/invoices/${target.id}`);
                setInvoiceEditor({
                  ...full.data,
                  // Default the payment date to today so the form is one click away from save
                  payment_date: full.data.payment_date || new Date().toISOString().slice(0, 10),
                });
              } catch (e) {
                toast.error(formatApiError(e?.response?.data?.detail) || e.message);
              }
            }}
          />
        </div>
      </div>

      <DealStagePipeline
        deal={deal}
        invoices={dealInvoices}
        assessments={dealAssessments}
        onTabChange={(tab) => {
          // Scroll to the area associated with that tab
          const sel = `[data-section="${tab}"]`;
          const el = document.querySelector(sel);
          if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
        }}
        onAdvance={async (stageKey, becomingDone) => {
          // Manual mark-as-done — limited to status-driven stages
          const map = { won: "Won", in_progress: "In Progress", closed: "Complete" };
          const newStatus = map[stageKey];
          if (!newStatus) {
            toast.info(`"${stageKey}" advances automatically when the underlying data is set.`);
            return;
          }
          if (!becomingDone && deal.status === newStatus) {
            toast.info("Already at this stage.");
            return;
          }
          try {
            await api.put(`/deals/${id}`, { ...deal, status: newStatus });
            toast.success(`Marked ${newStatus}`);
            reload();
          } catch (e) {
            toast.error(formatApiError(e?.response?.data?.detail) || e.message);
          }
        }}
      />

      <NextStepCard
        deal={deal}
        invoices={dealInvoices}
        assessments={dealAssessments}
        onAction={async (step) => {
          if (step.target?.route) {
            nav(step.target.route);
            return;
          }
          if (step.target?.tab) {
            const el = document.querySelector(`[data-section="${step.target.tab}"]`);
            if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
            return;
          }
          if (step.action === "email-scope") {
            setEmailScopeOpen(true);
            return;
          }
          if (step.action === "mark-won") {
            try {
              await api.put(`/deals/${id}`, { ...deal, status: "Won" });
              toast.success("Marked Won");
              reload();
            } catch (e) { toast.error(e.message); }
            return;
          }
          if (step.action === "mark-complete") {
            try {
              await api.put(`/deals/${id}`, { ...deal, status: "Complete" });
              toast.success("Project completed");
              reload();
            } catch (e) { toast.error(e.message); }
            return;
          }
          if (step.action === "set-material-order" || step.action === "set-schedule") {
            const el = document.querySelector(`[data-section="schedule"]`);
            if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
            else toast.info("Open the project edit modal to set these dates.");
            return;
          }
          toast.info("Action coming soon");
        }}
      />

      {/* Financials KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <KpiCard label="Revenue" value={formatCurrency(totals.revenue)} testId="kpi-revenue" />
        <KpiCard label="Total Costs" value={formatCurrency(totals.costs)} hint={`${formatCurrency(totals.paidCosts)} paid · ${formatCurrency(totals.pendingCosts)} pending`} testId="kpi-costs" />
        <KpiCard label="Net Profit" value={formatCurrency(totals.profit)} hint={`Margin ${totals.margin.toFixed(1)}%`} accent={totals.profit >= 0 ? "text-emerald-700" : "text-red-700"} testId="kpi-profit" />
        <KpiCard label="Outstanding" value={formatCurrency(totals.outstanding)} hint={`${formatCurrency(totals.received)} received of ${formatCurrency(totals.scheduled)}`} accent="text-orange-700" testId="kpi-outstanding" />
      </div>

      {/* Invoices list — click a row to open the editor and see payment details. */}
      {dealInvoices.length > 0 && (
        <div className="bg-white border border-zinc-200 rounded-sm p-5 mb-8" data-testid="deal-invoices-section">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-blue-700">Invoices on this project</div>
              <h3 className="font-heading text-lg font-bold tracking-tight">{dealInvoices.length} invoice{dealInvoices.length !== 1 ? "s" : ""}</h3>
            </div>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-zinc-950 text-left text-[10px] uppercase tracking-wider text-zinc-500">
                <th className="py-2">Invoice #</th>
                <th className="py-2">Type</th>
                <th className="py-2">Status</th>
                <th className="py-2 text-right">Total</th>
                <th className="py-2 text-right">Received</th>
                <th className="py-2 text-right">Balance</th>
                <th className="py-2">Paid On</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {[...dealInvoices]
                .sort((a, b) => String(b.invoice_date || b.created_at || "").localeCompare(String(a.invoice_date || a.created_at || "")))
                .map((inv) => {
                  const statusColor = {
                    Paid: "bg-emerald-100 text-emerald-800",
                    Sent: "bg-blue-100 text-blue-800",
                    Partial: "bg-amber-100 text-amber-800",
                    Overdue: "bg-red-100 text-red-800",
                    Draft: "bg-zinc-200 text-zinc-700",
                    Void: "bg-zinc-100 text-zinc-400 line-through",
                  }[inv.status] || "bg-zinc-100 text-zinc-700";
                  return (
                    <tr
                      key={inv.id}
                      className="border-b border-zinc-100 hover:bg-zinc-50 cursor-pointer"
                      data-testid={`deal-invoice-row-${inv.id}`}
                      onClick={async () => {
                        try {
                          const full = await api.get(`/invoices/${inv.id}`);
                          setInvoiceEditor(full.data);
                        } catch (e) {
                          toast.error(formatApiError(e?.response?.data?.detail) || e.message);
                        }
                      }}
                    >
                      <td className="py-3 font-mono font-bold">{inv.invoice_number}</td>
                      <td className="py-3 text-xs">{inv.invoice_type || "—"}</td>
                      <td className="py-3"><span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${statusColor}`}>{inv.status}</span></td>
                      <td className="py-3 text-right font-mono">{formatCurrency(inv.total || 0)}</td>
                      <td className="py-3 text-right font-mono text-emerald-700">{formatCurrency(inv.amount_paid || 0)}</td>
                      <td className={`py-3 text-right font-mono font-bold ${Number(inv.balance_due || 0) > 0.005 ? "text-orange-700" : "text-zinc-400"}`}>
                        {formatCurrency(inv.balance_due || 0)}
                      </td>
                      <td className="py-3 text-xs text-zinc-600">
                        {inv.payment_date
                          ? <span>{inv.payment_date} {inv.payment_method ? <span className="text-zinc-400">· {inv.payment_method}</span> : null}</span>
                          : <span className="text-zinc-300">—</span>}
                      </td>
                      <td className="py-3 text-right text-[10px] font-bold uppercase tracking-wider text-blue-700">View →</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}

      {/* Schedule / Events panel — ad-hoc appointments tied to this deal */}
      <DealSchedulePanel dealId={id} googleConnected={googleConnected} />

      {/* Estimated vs Actual P&L */}
      <div className="bg-white border border-zinc-200 rounded-sm p-5 mb-8" data-testid="pnl-comparison">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-blue-700">P&amp;L Comparison</div>
            <h3 className="font-heading text-lg font-bold tracking-tight">Estimated vs Actual</h3>
          </div>
          <Link to={`/payables?project=${id}`} className="text-[10px] font-bold uppercase tracking-wider text-blue-700 hover:underline">
            View Vendor Bills ({vendorBills.length}) →
          </Link>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b-2 border-zinc-950 text-left text-[10px] uppercase tracking-wider">
              <th className="py-2"></th>
              <th className="py-2 text-right">Estimated (Cost Items)</th>
              <th className="py-2 text-right">Actual (Vendor Bills)</th>
              <th className="py-2 text-right">Variance</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-zinc-100">
              <td className="py-3 font-bold">Revenue</td>
              <td className="py-3 text-right font-mono">{formatCurrency(totals.revenue)}</td>
              <td className="py-3 text-right font-mono">{formatCurrency(totals.revenue)}</td>
              <td className="py-3 text-right font-mono text-zinc-400">—</td>
            </tr>
            <tr className="border-b border-zinc-100">
              <td className="py-3 font-bold">Costs</td>
              <td className="py-3 text-right font-mono">{formatCurrency(totals.costs)}</td>
              <td className="py-3 text-right font-mono">{formatCurrency(totals.actualCosts)}</td>
              <td className={`py-3 text-right font-mono font-bold ${totals.actualCosts > totals.costs ? "text-red-700" : "text-emerald-700"}`}>
                {totals.actualCosts > totals.costs ? "+" : ""}{formatCurrency(totals.actualCosts - totals.costs)}
              </td>
            </tr>
            <tr className="border-b-2 border-zinc-950 bg-zinc-50">
              <td className="py-3 font-bold">Net Profit</td>
              <td className={`py-3 text-right font-mono font-bold ${totals.profit >= 0 ? "text-emerald-700" : "text-red-700"}`}>{formatCurrency(totals.profit)}</td>
              <td className={`py-3 text-right font-mono font-bold ${totals.actualProfit >= 0 ? "text-emerald-700" : "text-red-700"}`}>{formatCurrency(totals.actualProfit)}</td>
              <td className={`py-3 text-right font-mono font-bold ${totals.actualProfit >= totals.profit ? "text-emerald-700" : "text-red-700"}`}>
                {totals.actualProfit >= totals.profit ? "+" : ""}{formatCurrency(totals.actualProfit - totals.profit)}
              </td>
            </tr>
            <tr>
              <td className="py-2 text-[11px] uppercase tracking-wider text-zinc-500">Margin</td>
              <td className="py-2 text-right font-mono text-[11px] text-zinc-600">{totals.margin.toFixed(1)}%</td>
              <td className="py-2 text-right font-mono text-[11px] text-zinc-600">{totals.actualMargin.toFixed(1)}%</td>
              <td className="py-2"></td>
            </tr>
          </tbody>
        </table>
        {vendorBills.length === 0 ? (
          <div className="mt-3 text-[11px] text-zinc-500 italic">No vendor bills attached to this project yet. Upload one on the Payables page and link a line item to this project to see actuals here.</div>
        ) : (
          <div className="mt-3 text-[11px] text-zinc-500">
            {vendorBills.length} bill{vendorBills.length > 1 ? "s" : ""} attached · {formatCurrency(totals.actualPaid)} paid · {formatCurrency(totals.actualUnpaid)} unpaid
          </div>
        )}
      </div>

      {/* Milestones */}
      <Card title="Payment Milestones" data-section="milestones" right={
        <div className="flex flex-wrap items-center gap-2">
          {Object.keys(options.milestone_templates || {}).map((k) => (
            <button key={k} data-testid={`milestone-template-${k.replace(/\//g, "-")}`} onClick={() => applyTemplate(k)} className="px-3 h-8 text-[10px] font-bold uppercase tracking-wider border border-zinc-300 hover:border-zinc-950 rounded-sm">
              {k}
            </button>
          ))}
          <button data-testid="add-milestone" onClick={addMilestone} className="inline-flex items-center gap-1 px-3 h-8 text-[10px] font-bold uppercase tracking-wider bg-blue-700 text-white hover:bg-blue-800 rounded-sm">
            <Plus className="w-3 h-3" /> Custom
          </button>
        </div>
      }>
        {(deal.payment_milestones || []).length === 0 ? (
          <div className="text-sm text-zinc-500 py-6 text-center">No milestones yet. Pick a template (50/50 or 50/25/25) or add custom.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="milestones-table">
              <thead>
                <tr className="border-b-2 border-zinc-950 text-left text-[10px] uppercase tracking-wider">
                  <th className="py-2 pr-3">Label</th>
                  <th className="py-2 pr-3 w-20 text-right">%</th>
                  <th className="py-2 pr-3 w-32 text-right">Amount</th>
                  <th className="py-2 pr-3 w-36">Due Date</th>
                  <th className="py-2 pr-3 w-36">Status</th>
                  <th className="py-2 pr-3 w-36">Paid Date</th>
                  <th className="py-2 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {deal.payment_milestones.map((m, i) => (
                  <tr key={m.id || i} className="border-b border-zinc-100" data-testid={`milestone-row-${i}`}>
                    <td className="py-2 pr-3">
                      <CellInput value={m.label} onCommit={(v) => updateMilestone(i, { label: v })} placeholder="Deposit / Mid-Job / Completion" data-testid={`milestone-label-${i}`} />
                    </td>
                    <td className="py-2 pr-3 text-right">
                      <CellInput type="number" step="5" min="0" max="100" value={m.percent} onCommit={(v) => updateMilestone(i, { percent: parseFloat(v || 0) })} className="text-right" data-testid={`milestone-percent-${i}`} />
                    </td>
                    <td className="py-2 pr-3 text-right font-mono">{formatCurrency(m.amount)}</td>
                    <td className="py-2 pr-3">
                      <CellInput type="date" value={m.due_date} onCommit={(v) => updateMilestone(i, { due_date: v })} data-testid={`milestone-due-${i}`} />
                    </td>
                    <td className="py-2 pr-3">
                      <CellSelect value={m.status} onCommit={(v) => updateMilestone(i, { status: v, paid_date: v === "Paid" && !m.paid_date ? new Date().toISOString().slice(0, 10) : m.paid_date })} options={options.milestone_statuses || ["Pending", "Invoiced", "Paid"]} data-testid={`milestone-status-${i}`} />
                    </td>
                    <td className="py-2 pr-3">
                      <CellInput type="date" value={m.paid_date} onCommit={(v) => updateMilestone(i, { paid_date: v })} disabled={m.status !== "Paid"} data-testid={`milestone-paid-${i}`} />
                    </td>
                    <td className="py-2 text-right">
                      <button onClick={() => removeMilestone(i)} className="p-1.5 hover:bg-red-100 text-red-700 rounded-sm" data-testid={`milestone-delete-${i}`}><Trash2 className="w-3.5 h-3.5" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-zinc-950">
                  <td className="py-2 pr-3 font-bold uppercase text-[10px] tracking-wider">Total Scheduled</td>
                  <td className="py-2 pr-3 text-right font-mono text-zinc-500 text-xs">{deal.payment_milestones.reduce((s, m) => s + Number(m.percent || 0), 0)}%</td>
                  <td className="py-2 pr-3 text-right font-mono font-bold">{formatCurrency(totals.scheduled)}</td>
                  <td colSpan={4}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      {/* Cost Items */}
      <Card title="Vendor Cost Line Items" right={
        <div className="flex items-center gap-2">
          <Link to={`/calculator?deal=${deal.id}`} className="inline-flex items-center gap-1 px-3 h-8 text-[10px] font-bold uppercase tracking-wider border border-blue-700 text-blue-700 bg-white hover:bg-blue-50 rounded-sm" data-testid="pull-from-calculator">
            <FileText className="w-3 h-3" /> Pull from Calculator
          </Link>
          <button data-testid="add-cost-item" onClick={addCostItem} className="inline-flex items-center gap-1 px-3 h-8 text-[10px] font-bold uppercase tracking-wider bg-blue-700 text-white hover:bg-blue-800 rounded-sm">
            <Plus className="w-3 h-3" /> Add Line
          </button>
        </div>
      }>
        {(deal.cost_items || []).length === 0 ? (
          <div className="text-sm text-zinc-500 py-6 text-center">No cost items yet. Add materials, labor, or sub payments as they occur.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="cost-items-table">
              <thead>
                <tr className="border-b-2 border-zinc-950 text-left text-[10px] uppercase tracking-wider">
                  <th className="py-2 pr-3 w-32">Category</th>
                  <th className="py-2 pr-3 w-44">Vendor</th>
                  <th className="py-2 pr-3">Description</th>
                  <th className="py-2 pr-3 w-32 text-right">Amount</th>
                  <th className="py-2 pr-3 w-36">Date</th>
                  <th className="py-2 pr-3 w-28">Status</th>
                  <th className="py-2 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {deal.cost_items.map((c, i) => (
                  <tr key={c.id || i} className="border-b border-zinc-100" data-testid={`cost-row-${i}`}>
                    <td className="py-2 pr-3">
                      <CellSelect value={c.category} onCommit={(v) => updateCostItem(i, { category: v })} options={options.cost_categories || ["Materials", "Labor", "Subcontractor", "Other"]} data-testid={`cost-category-${i}`} />
                    </td>
                    <td className="py-2 pr-3">
                      <CellSelect
                        value={c.vendor_id || "__free__"}
                        onCommit={(v) => {
                          if (v === "__free__") return updateCostItem(i, { vendor_id: null });
                          const vendor = vendors.find((x) => x.id === v);
                          updateCostItem(i, { vendor_id: v, vendor_name: vendor?.name || "" });
                        }}
                        options={[{ value: "__free__", label: c.vendor_name || "— Pick / Custom —" }, ...vendors.map((v) => ({ value: v.id, label: v.name }))]}
                        data-testid={`cost-vendor-${i}`}
                      />
                      {!c.vendor_id && (
                        <CellInput value={c.vendor_name} onCommit={(v) => updateCostItem(i, { vendor_name: v })} placeholder="Vendor name" className="mt-1 text-xs" data-testid={`cost-vendor-name-${i}`} />
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      <CellInput value={c.description} onCommit={(v) => updateCostItem(i, { description: v })} placeholder="What was this for?" data-testid={`cost-description-${i}`} />
                    </td>
                    <td className="py-2 pr-3 text-right">
                      <CellInput type="number" value={c.amount} onCommit={(v) => updateCostItem(i, { amount: parseFloat(v || 0) })} className="text-right font-mono" data-testid={`cost-amount-${i}`} />
                    </td>
                    <td className="py-2 pr-3">
                      <CellInput type="date" value={c.date} onCommit={(v) => updateCostItem(i, { date: v })} data-testid={`cost-date-${i}`} />
                    </td>
                    <td className="py-2 pr-3">
                      <CellSelect value={c.status} onCommit={(v) => updateCostItem(i, { status: v })} options={options.cost_item_statuses || ["Pending", "Paid"]} data-testid={`cost-status-${i}`} />
                    </td>
                    <td className="py-2 text-right">
                      <button onClick={() => removeCostItem(i)} className="p-1.5 hover:bg-red-100 text-red-700 rounded-sm" data-testid={`cost-delete-${i}`}><Trash2 className="w-3.5 h-3.5" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-zinc-950">
                  <td className="py-2 pr-3 font-bold uppercase text-[10px] tracking-wider" colSpan={3}>Total Costs (auto-rolls into Dashboard)</td>
                  <td className="py-2 pr-3 text-right font-mono font-bold">{formatCurrency(totals.costs)}</td>
                  <td colSpan={3}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t border-zinc-100">
          <Mini label="Materials" value={formatCurrency(deal.materials_cost)} />
          <Mini label="Labor" value={formatCurrency(deal.labor_cost)} />
          <Mini label="Subcontractor" value={formatCurrency(deal.subcontractor_cost)} />
          <Mini label="Other" value={formatCurrency(deal.other_expenses)} />
        </div>
      </Card>

      {/* Pricing options + spec */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
        <Card title={(() => {
          const isConstruction = /^(construction project|other)$/i.test(deal.proposed_roof_type || "") || /other construction work/i.test(deal.current_roof_type || "");
          if (isConstruction) return "Project Price";
          return deal.deal_type === "Assessment" ? "Assessment Options" : "Pricing Options";
        })()}>
          {(() => {
            const isConstruction = /^(construction project|other)$/i.test(deal.proposed_roof_type || "") || /other construction work/i.test(deal.current_roof_type || "");
            if (isConstruction) {
              return (
                <Row label="Project Price" value={formatCurrency(deal.proposal_option_1)} bold highlight={Math.abs(totals.revenue - deal.proposal_option_1) < 0.01 && totals.revenue > 0} />
              );
            }
            return (
              <>
                {Number(deal.proposal_option_25yr || 0) > 0 && (
                  <Row label="Option A — 25-yr" value={formatCurrency(deal.proposal_option_25yr)} highlight={Math.abs(totals.revenue - deal.proposal_option_25yr) < 0.01 && totals.revenue > 0} />
                )}
                <Row label="Option B — 20-yr" value={formatCurrency(deal.proposal_option_1)} highlight={Math.abs(totals.revenue - deal.proposal_option_1) < 0.01 && totals.revenue > 0} />
                <Row label="Option C — 15-yr" value={formatCurrency(deal.proposal_option_2)} highlight={Math.abs(totals.revenue - deal.proposal_option_2) < 0.01 && totals.revenue > 0} />
                <Row label="Option D — 10-yr" value={formatCurrency(deal.proposal_option_3)} highlight={Math.abs(totals.revenue - deal.proposal_option_3) < 0.01 && totals.revenue > 0} />
              </>
            );
          })()}
          <div className="border-t-2 border-zinc-950 my-2" />
          <Row label="Chosen" value={formatCurrency(totals.revenue)} bold />
        </Card>

        <Card title="Roof Spec & Measurements">
          <Row label="Current Roof / Project" value={deal.current_roof_type} />
          <Row label="Proposed Roof / Project" value={deal.proposed_roof_type} bold />
          <div className="pl-1 pb-2">
            <ScopePreview currentRoof={deal.current_roof_type} proposedRoof={deal.proposed_roof_type} />
          </div>
          {(deal.construction_project_requirements || deal.construction_other_requirements || deal.construction_exclusions) && (
            <div id="construction-scope" className="border-t border-zinc-100 mt-2 pt-2 space-y-2" data-testid="deal-detail-construction-scope">
              {deal.project_type_override && (
                <Row label="Project Type (PDF)" value={deal.project_type_override} bold />
              )}
              {deal.construction_project_requirements && (
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-blue-700 mb-1">Project Requirements</div>
                  <pre className="whitespace-pre-wrap text-xs text-zinc-700 font-sans bg-zinc-50 p-2 border border-zinc-200 rounded-sm">{deal.construction_project_requirements}</pre>
                </div>
              )}
              {deal.construction_other_requirements && (
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-blue-700 mb-1">Other Requirements</div>
                  <pre className="whitespace-pre-wrap text-xs text-zinc-700 font-sans bg-zinc-50 p-2 border border-zinc-200 rounded-sm">{deal.construction_other_requirements}</pre>
                </div>
              )}
              {deal.construction_exclusions && (
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-blue-700 mb-1">Exclusions</div>
                  <pre className="whitespace-pre-wrap text-xs text-zinc-700 font-sans bg-zinc-50 p-2 border border-zinc-200 rounded-sm">{deal.construction_exclusions}</pre>
                </div>
              )}
            </div>
          )}
          {deal.custom_scope && !(deal.construction_project_requirements || deal.construction_other_requirements || deal.construction_exclusions) && (
            <div className="border-t border-zinc-100 mt-2 pt-2">
              <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-500 mb-1">Custom Scope (legacy free-form)</div>
              <pre className="whitespace-pre-wrap text-xs text-zinc-700 font-sans bg-zinc-50 p-2 border border-zinc-200 rounded-sm" data-testid="deal-detail-custom-scope">{deal.custom_scope}</pre>
            </div>
          )}
          <Row label="Project Type" value={deal.project_type} />
          <Row label="Lead Source" value={deal.lead_source} />
          {deal.lead_source === "Referral" && deal.referral_source && (
            <Row label="Referred By" value={deal.referral_source} />
          )}
          {deal.date_sent && <Row label="Date Sent" value={deal.date_sent} />}
          {deal.chosen_date && <Row label="Chosen Date" value={deal.chosen_date} />}
          {(deal.property_sqft || deal.perimeter_lnft || deal.avg_parapet_height) ? (
            <>
              <div className="border-t border-zinc-100 my-2" />
              <Row label="Property SqFt" value={deal.property_sqft ? Number(deal.property_sqft).toLocaleString() : "—"} />
              <Row label="Perimeter LnFt" value={deal.perimeter_lnft ? Number(deal.perimeter_lnft).toLocaleString() : "—"} />
              <Row label="Avg Parapet Ht (ft)" value={deal.avg_parapet_height || "—"} />
              <Row label="Total SqFt" value={deal.total_sqft ? Number(deal.total_sqft).toLocaleString() : "—"} bold />
            </>
          ) : null}
        </Card>
      </div>

      {/* Documents */}
      <Documents
        parentType="project"
        parentId={id}
        title="Documents — Measurement Reports, Assessments, Scopes, Invoices, Photos"
        coverPhotoId={deal.cover_photo_file_id}
        onSetCover={(fileId) => persist({ cover_photo_file_id: deal.cover_photo_file_id === fileId ? null : fileId })}
      />

      {/* Material Take-Off */}
      <MaterialTakeoff deal={deal} reload={reload} />

      {/* Activity Timeline */}
      <Card
        title={
          <span className="inline-flex items-center gap-2">
            <Clock className="w-3.5 h-3.5 text-blue-700" /> Recent Activity
          </span>
        }
      >
        <div className="px-4 py-3 max-h-96 overflow-y-auto">
          <DealActivityTimeline dealId={id} />
        </div>
      </Card>

      {/* Maintenance Plan */}
      <Card
        title={
          <span className="inline-flex items-center gap-2">
            <Wrench className="w-3.5 h-3.5 text-blue-700" /> Maintenance Plan
          </span>
        }
        right={
          <button
            data-testid="toggle-maintenance-plan"
            onClick={() => persist({ maintenance_plan: !deal.maintenance_plan })}
            className={`inline-flex items-center gap-2 px-3 h-8 text-[10px] font-bold uppercase tracking-wider rounded-sm transition-colors ${
              deal.maintenance_plan
                ? "bg-emerald-600 text-white hover:bg-emerald-700"
                : "border border-zinc-300 text-zinc-700 hover:border-zinc-950"
            }`}
          >
            {deal.maintenance_plan ? "✓ Plan Active" : "Enable Maintenance Plan"}
          </button>
        }
      >
        {!deal.maintenance_plan ? (
          <div className="text-sm text-zinc-500 py-4">
            Click <span className="font-bold">Enable Maintenance Plan</span> to track this customer's annual maintenance, set a rate, and log yearly visits.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Annual Rate ($)</label>
                <CellInput
                  type="number"
                  value={deal.maintenance_rate}
                  onCommit={(v) => persist({ maintenance_rate: parseFloat(v || 0) })}
                  className="font-mono border-zinc-300 mt-1"
                  data-testid="maintenance-rate"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Plan Start Date</label>
                <CellInput
                  type="date"
                  value={deal.maintenance_start_date}
                  onCommit={(v) => persist({ maintenance_start_date: v })}
                  className="border-zinc-300 mt-1"
                  data-testid="maintenance-start"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Next Due (auto)</label>
                <div className="mt-1 h-9 px-2 flex items-center text-sm font-mono font-bold text-blue-700" data-testid="maintenance-next-due">
                  {deal.next_maintenance_date || "— set start date"}
                </div>
              </div>
            </div>

            {/* Log new visit */}
            <div className="bg-zinc-50 border border-zinc-200 rounded-sm p-3 mb-4">
              <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-2">Log New Visit</div>
              <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
                <input
                  type="date"
                  value={newVisit.visit_date}
                  onChange={(e) => setNewVisit({ ...newVisit, visit_date: e.target.value })}
                  className="h-9 px-2 border border-zinc-300 rounded-sm text-sm"
                  data-testid="new-visit-date"
                />
                <input
                  type="number"
                  placeholder="Amount"
                  value={newVisit.amount}
                  onChange={(e) => setNewVisit({ ...newVisit, amount: e.target.value })}
                  className="h-9 px-2 border border-zinc-300 rounded-sm text-sm font-mono"
                  data-testid="new-visit-amount"
                />
                <select
                  value={newVisit.subcontractor_id}
                  onChange={(e) => setNewVisit({ ...newVisit, subcontractor_id: e.target.value })}
                  className="h-9 px-2 border border-zinc-300 rounded-sm text-sm bg-white"
                  data-testid="new-visit-sub"
                >
                  <option value="">— Subcontractor —</option>
                  {subcontractors.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                <input
                  type="text"
                  placeholder="Notes (optional)"
                  value={newVisit.notes}
                  onChange={(e) => setNewVisit({ ...newVisit, notes: e.target.value })}
                  className="h-9 px-2 border border-zinc-300 rounded-sm text-sm"
                  data-testid="new-visit-notes"
                />
                <button
                  onClick={logVisit}
                  className="h-9 inline-flex items-center justify-center gap-1 px-3 text-[10px] font-bold uppercase tracking-wider bg-blue-700 text-white hover:bg-blue-800 rounded-sm"
                  data-testid="log-visit-button"
                >
                  <Plus className="w-3 h-3" /> Log Visit
                </button>
              </div>
            </div>

            {/* Visit history */}
            {(deal.maintenance_visits || []).length === 0 ? (
              <div className="text-sm text-zinc-500 py-3 text-center">No visits logged yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="visit-history-table">
                  <thead>
                    <tr className="border-b-2 border-zinc-950 text-left text-[10px] uppercase tracking-wider">
                      <th className="py-2 pr-3 w-36">Visit Date</th>
                      <th className="py-2 pr-3 w-32 text-right">Amount</th>
                      <th className="py-2 pr-3 w-44">Subcontractor</th>
                      <th className="py-2 pr-3">Notes</th>
                      <th className="py-2 w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {(deal.maintenance_visits || []).map((v) => (
                      <tr key={v.id} className="border-b border-zinc-100" data-testid={`visit-row-${v.id}`}>
                        <td className="py-2 pr-3 font-mono">{v.visit_date}</td>
                        <td className="py-2 pr-3 text-right font-mono">{formatCurrency(v.amount)}</td>
                        <td className="py-2 pr-3 text-zinc-700">{v.subcontractor_name || "—"}</td>
                        <td className="py-2 pr-3 text-zinc-700">{v.notes || "—"}</td>
                        <td className="py-2 text-right">
                          <button onClick={() => removeVisit(v.id)} className="p-1.5 hover:bg-red-100 text-red-700 rounded-sm" data-testid={`delete-visit-${v.id}`}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Card>

      {/* Change Orders */}
      <Card
        title={
          <span className="inline-flex items-center gap-2">
            <FilePlus className="w-3.5 h-3.5 text-blue-700" /> Change Orders
            {changeOrderTotal !== 0 && (
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-sm">
                +{formatCurrency(changeOrderTotal)} approved
              </span>
            )}
          </span>
        }
      >
        {/* Add new change order */}
        <div className="bg-zinc-50 border border-zinc-200 rounded-sm p-3 mb-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-2">Add Change Order</div>
          <div className="grid grid-cols-1 sm:grid-cols-6 gap-2">
            <input
              type="date"
              value={newCO.date}
              onChange={(e) => setNewCO({ ...newCO, date: e.target.value })}
              className="h-9 px-2 border border-zinc-300 rounded-sm text-sm"
              data-testid="new-co-date"
            />
            <input
              type="text"
              placeholder="Description"
              value={newCO.description}
              onChange={(e) => setNewCO({ ...newCO, description: e.target.value })}
              className="h-9 px-2 border border-zinc-300 rounded-sm text-sm sm:col-span-2"
              data-testid="new-co-desc"
            />
            <input
              type="number"
              placeholder="Amount"
              value={newCO.amount}
              onChange={(e) => setNewCO({ ...newCO, amount: e.target.value })}
              className="h-9 px-2 border border-zinc-300 rounded-sm text-sm font-mono"
              data-testid="new-co-amount"
            />
            <select
              value={newCO.status}
              onChange={(e) => setNewCO({ ...newCO, status: e.target.value })}
              className="h-9 px-2 border border-zinc-300 rounded-sm text-sm bg-white"
              data-testid="new-co-status"
            >
              <option value="Draft">Draft</option>
              <option value="Approved">Approved</option>
              <option value="Rejected">Rejected</option>
            </select>
            <button
              onClick={addChangeOrder}
              className="h-9 inline-flex items-center justify-center gap-1 px-3 text-[10px] font-bold uppercase tracking-wider bg-blue-700 text-white hover:bg-blue-800 rounded-sm"
              data-testid="add-co-button"
            >
              <Plus className="w-3 h-3" /> Add
            </button>
          </div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 mt-2">
            Approved change orders are added to Project Total on new invoices for this project.
          </div>
        </div>

        {/* Change order history */}
        {(deal.change_orders || []).length === 0 ? (
          <div className="text-sm text-zinc-500 py-3 text-center">No change orders on this project.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="change-orders-table">
              <thead>
                <tr className="border-b-2 border-zinc-950 text-left text-[10px] uppercase tracking-wider">
                  <th className="py-2 pr-3 w-32">Date</th>
                  <th className="py-2 pr-3">Description</th>
                  <th className="py-2 pr-3 w-32 text-right">Amount</th>
                  <th className="py-2 pr-3 w-28">Status</th>
                  <th className="py-2 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {(deal.change_orders || []).map((co) => (
                  <tr key={co.id} className="border-b border-zinc-100" data-testid={`co-row-${co.id}`}>
                    <td className="py-2 pr-3 font-mono">{co.date || "—"}</td>
                    <td className="py-2 pr-3 text-zinc-700">{co.description}</td>
                    <td className="py-2 pr-3 text-right font-mono font-bold">{formatCurrency(co.amount)}</td>
                    <td className="py-2 pr-3">
                      <select
                        value={co.status || "Approved"}
                        onChange={(e) => updateChangeOrder(co.id, { status: e.target.value })}
                        className={`h-7 px-2 text-[10px] font-bold uppercase tracking-wider border rounded-sm bg-white ${
                          (co.status || "Approved") === "Approved" ? "border-emerald-300 text-emerald-700" :
                          co.status === "Rejected" ? "border-red-300 text-red-700" :
                          "border-zinc-300 text-zinc-600"
                        }`}
                      >
                        <option value="Draft">Draft</option>
                        <option value="Approved">Approved</option>
                        <option value="Rejected">Rejected</option>
                      </select>
                    </td>
                    <td className="py-2 text-right">
                      <button onClick={() => removeChangeOrder(co.id)} className="p-1.5 hover:bg-red-100 text-red-700 rounded-sm" data-testid={`del-co-${co.id}`}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-zinc-950 bg-zinc-50">
                  <td className="py-2 pr-3 font-bold uppercase text-[10px] tracking-wider" colSpan={2}>Approved Change Orders Total</td>
                  <td className="py-2 pr-3 text-right font-mono font-bold text-blue-700">{formatCurrency(changeOrderTotal)}</td>
                  <td colSpan={2}></td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Contact + Property */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
        <Card title="Contact">
          {contact ? (
            <>
              <Row label="Name" value={contact.contact_name} bold />
              <Row label="Company" value={contact.company_name} />
              <Row label="Phone" value={formatPhoneDisplay(contact.phone)} />
              <Row label="Email" value={contact.email} />
              <Row label="Address" value={contact.address} />
            </>
          ) : (
            <div className="text-sm text-zinc-500">No contact linked.</div>
          )}
        </Card>
        <Card title="Property">
          {property ? (
            <>
              <Row label="Name" value={property.property_name} bold />
              <Row label="Address" value={property.property_address} />
              <Row label="On-Site Contact" value={property.property_contact_name} />
              <Row label="Phone" value={formatPhoneDisplay(property.property_contact_phone)} />
            </>
          ) : (
            <div className="text-sm text-zinc-500">No property linked.</div>
          )}
        </Card>
      </div>

      {deal.notes && (
        <div className="mt-6 bg-white border border-zinc-200 rounded-sm p-6">
          <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-500 mb-2">Notes</div>
          <div className="text-sm text-zinc-800 whitespace-pre-wrap" data-testid="deal-notes-view">{deal.notes}</div>
        </div>
      )}

      {/* Project Photos — upload, organize by album + tag, share with customer */}
      <div className="mt-6">
        <ProjectPhotos dealId={id} dealTitle={deal.title} />
      </div>

      {emailScopeOpen && (
        <EmailScopeModal
          dealId={id}
          dealTitle={deal.title}
          dealType={deal.deal_type}
          primaryContactEmail={contact?.email || ""}
          onClose={(sent) => {
            setEmailScopeOpen(false);
            // After a successful send the backend stamps `last_scope_sent_at`
            // on the deal — refresh so the pipeline dot turns green immediately.
            if (sent) reload().catch(() => {});
          }}
        />
      )}

      {invoiceEditor && (
        <InvoiceEditor
          invoice={invoiceEditor}
          deals={[deal]}
          onClose={() => setInvoiceEditor(null)}
          onSaved={() => {
            setInvoiceEditor(null);
            // Refresh the deal's invoice list so the next "Record Payment"
            // click sees the new one immediately.
            api
              .get(`/invoices?deal_id=${id}`)
              .then((r) => setDealInvoices(r.data || []))
              .catch(() => {});
            toast.success("Invoice saved");
          }}
        />
      )}

      {scopeEditorOpen && (
        <ScopeEditorModal
          dealId={id}
          onClose={() => setScopeEditorOpen(false)}
          onSaved={() => reload().catch(() => {})}
        />
      )}

      {sendToFieldOpen && (
        <GetAppOnPhoneModal
          onClose={() => setSendToFieldOpen(false)}
          redirectPath={`/field?deal_id=${id}`}
          title="Send to Field"
          subtitle={`Scan to capture photos for ${deal?.title || "this project"}`}
        />
      )}
      {workOrderOpen && (
        <WorkOrderModal
          dealId={id}
          onClose={() => setWorkOrderOpen(false)}
          onSent={(res) => {
            toast.success(res?.email_sent
              ? `Work order emailed to ${res?.sign_url ? "the sub" : "subcontractor"}`
              : "Work order saved (email could not be sent — check SMTP)");
            setWorkOrderOpen(false);
            reload();
          }}
        />
      )}
    </div>
  );
}

const Card = ({ title, right, children, ...rest }) => (
  <div className="bg-white border border-zinc-200 rounded-sm p-6 mb-6" {...rest}>
    <div className="flex items-center justify-between mb-4 pb-3 border-b border-zinc-100 gap-3 flex-wrap">
      <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-500">{title}</div>
      {right}
    </div>
    <div>{children}</div>
  </div>
);

const Row = ({ label, value, bold, highlight, accent }) => (
  <div className={`flex items-center justify-between py-2 ${highlight ? "bg-blue-50 -mx-2 px-2 rounded-sm" : ""}`}>
    <div className="text-xs uppercase tracking-wider text-zinc-500">{label}</div>
    <div className={`text-sm ${bold ? "font-bold text-zinc-950" : "text-zinc-700"} font-mono ${accent || ""}`}>{value || "—"}</div>
  </div>
);

const KpiCard = ({ label, value, hint, testId, accent }) => (
  <div className="bg-white border border-zinc-200 p-6 rounded-sm" data-testid={testId}>
    <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-500 mb-3">{label}</div>
    <div className={`font-heading text-3xl font-black tracking-tighter ${accent || "text-zinc-950"}`}>{value}</div>
    {hint && <div className="text-xs text-zinc-500 mt-2">{hint}</div>}
  </div>
);

const Mini = ({ label, value }) => (
  <div className="border border-zinc-200 rounded-sm px-3 py-2">
    <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
    <div className="text-sm font-bold font-mono">{value}</div>
  </div>
);

const CellInput = ({ value, onCommit, type = "text", className = "", disabled, ...rest }) => {
  const [v, setV] = useState(value ?? "");
  // When the underlying value changes externally (other user, server sync) but the
  // user has unsaved local edits, commit the local value FIRST so we don't lose typing.
  useEffect(() => {
    if (String(v) !== String(value ?? "") && document.activeElement?.dataset?.testid !== rest["data-testid"]) {
      // External update + we don't have focus → safe to sync down
      setV(value ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      type={type}
      value={v}
      disabled={disabled}
      onChange={(e) => {
        const next = e.target.value;
        setV(next);
        // For numeric cells, commit on every keystroke so a parent re-render
        // (e.g., a sibling "Add Row" click) doesn't wipe unsaved input.
        if (type === "number" && String(next) !== String(value ?? "")) {
          onCommit(next);
        }
      }}
      onBlur={() => { if (String(v) !== String(value ?? "")) onCommit(v); }}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
      className={`w-full h-9 px-2 border border-transparent hover:border-zinc-300 focus:border-blue-700 focus:outline-none bg-transparent rounded-sm text-sm ${className} ${disabled ? "opacity-50" : ""}`}
      {...rest}
    />
  );
};

const CellSelect = ({ value, onCommit, options = [], className = "", ...rest }) => (
  <select
    value={value ?? ""}
    onChange={(e) => onCommit(e.target.value)}
    className={`w-full h-9 px-2 border border-transparent hover:border-zinc-300 focus:border-blue-700 focus:outline-none bg-transparent rounded-sm text-sm ${className}`}
    {...rest}
  >
    {options.map((o) => (
      <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>
    ))}
  </select>
);


function EmailScopeModal({ dealId, dealTitle, dealType, primaryContactEmail, onClose }) {
  const [to, setTo] = useState(primaryContactEmail || "");
  const [cc, setCc] = useState("");
  const [message, setMessage] = useState("");
  const [aliases, setAliases] = useState([]);
  const [fromEmail, setFromEmail] = useState("");
  const [taxonomy, setTaxonomy] = useState([]);
  const [libFiles, setLibFiles] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [filterCat, setFilterCat] = useState("");
  const [sending, setSending] = useState(false);
  const [smartMatches, setSmartMatches] = useState({ ids: new Set(), reasons: {}, tokens: [] });
  const [smartApplied, setSmartApplied] = useState(false);
  const [coverPhotos, setCoverPhotos] = useState([]); // [{id, signed_url, display_name, is_cover}]
  const [selectedPhotoIds, setSelectedPhotoIds] = useState([]); // ids of project photos to attach

  const isAssessment = (dealType || "").toLowerCase() === "assessment";
  const docKind = isAssessment ? "assessment" : "scope";

  useEffect(() => {
    api.get("/email-aliases").then((r) => {
      setAliases(r.data?.aliases || []);
      const docDefault = (r.data?.defaults || {})[docKind];
      setFromEmail(docDefault || r.data?.default || "");
    }).catch(() => {});
    api.get("/library/taxonomy").then((r) => setTaxonomy(r.data?.taxonomy || [])).catch(() => {});
    api.get("/library/files").then((r) => setLibFiles(r.data || [])).catch(() => {});
    // Pull smart suggestions for this deal — pre-check + sort matches to top
    api.get(`/deals/${dealId}/scope-suggestions`).then((r) => {
      const ids = new Set(r.data?.file_ids || []);
      setSmartMatches({ ids, reasons: r.data?.reasons || {}, tokens: r.data?.tokens || [] });
      setSelectedIds(Array.from(ids));
      setSmartApplied(true);
    }).catch(() => {});
    // Fetch project photos so we can auto-attach the cover photo (Material
    // Take-Off lives in a separate collection and is intentionally NOT
    // offered here — internal pricing, never to customer).
    api.get(`/projects/${dealId}/photos`).then((r) => {
      const all = r.data || [];
      const covers = all.filter((p) => p.is_cover);
      const candidates = covers.length > 0 ? covers : all.slice(0, 1);
      setCoverPhotos(candidates);
      setSelectedPhotoIds(covers.map((p) => p.id));
    }).catch(() => setCoverPhotos([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKind, dealId]);

  const toggleId = (id) => setSelectedIds((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
  const clearSmart = () => {
    setSelectedIds((s) => s.filter((id) => !smartMatches.ids.has(id)));
    setSmartApplied(false);
  };
  const reapplySmart = () => {
    setSelectedIds((s) => Array.from(new Set([...s, ...Array.from(smartMatches.ids)])));
    setSmartApplied(true);
  };

  const filtered = useMemo(() => {
    const base = filterCat ? libFiles.filter((f) => f.category === filterCat) : libFiles;
    // Sort: smart matches first, then by display_name
    return [...base].sort((a, b) => {
      const am = smartMatches.ids.has(a.id) ? 0 : 1;
      const bm = smartMatches.ids.has(b.id) ? 0 : 1;
      if (am !== bm) return am - bm;
      return (a.display_name || "").localeCompare(b.display_name || "");
    });
  }, [libFiles, filterCat, smartMatches]);

  const send = async () => {
    if (!to.trim()) { toast.error("Recipient email required"); return; }
    setSending(true);
    try {
      const r = await api.post(`/deals/${dealId}/spec-sheet/email`, {
        to_email: to.trim(),
        cc_email: cc.trim(),
        from_email: fromEmail,
        message: message.trim(),
        library_file_ids: selectedIds,
        cover_photo_ids: selectedPhotoIds,
      });
      toast.success(r.data?.message || "Scope emailed");
      onClose(true);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-y-auto" data-testid="email-scope-modal">
      <div className="bg-white border border-zinc-200 rounded-sm w-full max-w-3xl my-8">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-700 mb-1">
              Email {isAssessment ? "Assessment" : "Scope"}
            </div>
            <h3 className="font-heading text-xl font-black tracking-tight">{dealTitle}</h3>
            <div className="text-xs text-zinc-500 mt-1">
              {isAssessment ? "Assessment" : "Scope"} PDF is auto-attached. Add Library docs (brochures, specs, certs, contracts) as additional attachments.
              <span className="ml-1 text-zinc-400">Sending from <span className="font-mono text-zinc-700">{fromEmail || "—"}</span>.</span>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-zinc-500 hover:text-zinc-950 text-xs uppercase tracking-wider font-bold">Close</button>
        </div>
        <div className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Left — email composition */}
          <div className="space-y-3">
            {aliases.length > 1 && (
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-600 mb-1">From</label>
                <select value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} className="w-full h-10 px-3 border border-zinc-300 rounded-sm text-sm bg-white" data-testid="scope-from-email">
                  {aliases.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-600 mb-1">To *</label>
              <input value={to} onChange={(e) => setTo(e.target.value)} className="w-full h-10 px-3 border border-zinc-300 rounded-sm text-sm" data-testid="scope-to-email" />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-600 mb-1">CC</label>
              <input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="(optional)" className="w-full h-10 px-3 border border-zinc-300 rounded-sm text-sm" data-testid="scope-cc-email" />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1 gap-2">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-600">Custom Message (optional)</label>
                <GrammarCheck text={message || ""} onChange={setMessage} label="Check Grammar" />
              </div>
              <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} placeholder="Override the default email body. Leave blank for the standard proposal blurb." className="w-full px-3 py-2 border border-zinc-300 rounded-sm text-sm" data-testid="scope-message" />
            </div>
          </div>

          {/* Right — library picker */}
          <div>
            {coverPhotos.length > 0 && (
              <div className="mb-3" data-testid="scope-cover-photos">
                <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-2">
                  Cover Photo {coverPhotos.some((p) => p.is_cover) ? "(auto-attached)" : "(suggested)"}
                </div>
                <div className="space-y-1.5">
                  {coverPhotos.map((p) => {
                    const checked = selectedPhotoIds.includes(p.id);
                    const togglePhoto = () => setSelectedPhotoIds((s) => s.includes(p.id) ? s.filter((x) => x !== p.id) : [...s, p.id]);
                    return (
                      <label
                        key={p.id}
                        className={`flex items-center gap-2 px-3 py-2 border rounded-sm cursor-pointer transition-colors ${checked ? "border-blue-700 bg-blue-50/40" : "border-zinc-300 hover:bg-zinc-50"}`}
                        data-testid={`scope-cover-photo-${p.id}`}
                      >
                        <input type="checkbox" checked={checked} onChange={togglePhoto} />
                        <div className="text-xs flex-1 min-w-0 flex items-center gap-2">
                          <span className="text-sm">🖼️</span>
                          <span className="font-bold truncate">{p.display_name || p.original_filename || "Photo"}</span>
                          {p.is_cover && (
                            <span className="text-[9px] font-bold uppercase tracking-wider bg-amber-400 text-zinc-950 px-1.5 py-0.5 rounded">Cover</span>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </div>
                <div className="text-[10px] text-zinc-500 mt-1">
                  {selectedPhotoIds.length === 0 ? "No photo attached." : `Attaching ${selectedPhotoIds.length} photo${selectedPhotoIds.length === 1 ? "" : "s"}.`}
                  {!coverPhotos.some((p) => p.is_cover) && coverPhotos.length > 0 && (
                    <span className="text-amber-700 ml-1">No cover marked — using most recent photo as suggestion.</span>
                  )}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Library Attachments ({selectedIds.length} selected)</div>
              <select value={filterCat} onChange={(e) => setFilterCat(e.target.value)} className="h-7 px-2 border border-zinc-300 rounded-sm text-xs bg-white" data-testid="scope-lib-filter">
                <option value="">All categories</option>
                {taxonomy.map((c) => <option key={c.category} value={c.category}>{c.category}</option>)}
              </select>
            </div>
            {smartMatches.ids.size > 0 && (
              <div className="mb-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-sm flex items-center justify-between gap-2 text-[11px]" data-testid="smart-pick-badge">
                <div className="text-blue-900">
                  <span className="font-bold">✨ Smart-picked {smartMatches.ids.size} doc{smartMatches.ids.size === 1 ? "" : "s"}</span>
                  <span className="text-blue-700"> for {smartMatches.tokens.filter((t) => t !== "general").slice(0, 3).join(", ") || "this scope"}</span>
                </div>
                <button
                  type="button"
                  onClick={smartApplied ? clearSmart : reapplySmart}
                  className="text-blue-700 hover:text-blue-900 font-bold uppercase tracking-wider text-[10px]"
                  data-testid="smart-pick-toggle"
                >
                  {smartApplied ? "Clear" : "Re-apply"}
                </button>
              </div>
            )}
            <div className="border border-zinc-200 rounded-sm max-h-72 overflow-y-auto">
              {filtered.length === 0 ? (
                <div className="text-center text-xs text-zinc-500 py-8">No library docs match.</div>
              ) : filtered.map((f) => {
                const isSmart = smartMatches.ids.has(f.id);
                return (
                  <label key={f.id} className={`flex items-start gap-2 px-3 py-2 border-b border-zinc-100 hover:bg-zinc-50 cursor-pointer ${isSmart ? "bg-blue-50/40" : ""}`} data-testid={`scope-lib-${f.id}`}>
                    <input type="checkbox" checked={selectedIds.includes(f.id)} onChange={() => toggleId(f.id)} className="mt-1" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <div className="text-xs font-bold truncate">{f.display_name}</div>
                        {isSmart && <span className="inline-block px-1.5 py-px text-[8px] font-bold uppercase tracking-wider bg-blue-700 text-white rounded-sm whitespace-nowrap" title={(smartMatches.reasons[f.id] || []).join(", ")}>Smart</span>}
                      </div>
                      <div className="text-[10px] text-zinc-500 truncate">{f.category} / {f.subcategory}</div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-zinc-200 flex justify-between items-center gap-2">
          <div className="text-[11px] text-zinc-500">
            Will send <b>scope PDF</b>
            {selectedPhotoIds.length > 0 && <> + <b>{selectedPhotoIds.length}</b> photo{selectedPhotoIds.length === 1 ? "" : "s"}</>}
            {" "}+ <b>{selectedIds.length}</b> library doc{selectedIds.length === 1 ? "" : "s"} = <b>{selectedIds.length + selectedPhotoIds.length + 1}</b> total attachment{(selectedIds.length + selectedPhotoIds.length + 1) === 1 ? "" : "s"}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="px-4 h-10 text-xs font-bold uppercase tracking-wider border border-zinc-300 rounded-sm hover:bg-zinc-50">Cancel</button>
            <button type="button" onClick={send} disabled={sending} className="inline-flex items-center gap-2 bg-blue-700 text-white px-4 h-10 text-xs font-bold uppercase tracking-wider hover:bg-blue-800 disabled:opacity-50 rounded-sm" data-testid="scope-send"><Mail className="w-4 h-4" /> {sending ? "Sending..." : "Send Scope"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * WorkOrderModal — issues a Work Order to the subcontractor.
 *
 * Flow: GET draft from backend (auto-fills sub info, project, scope bullets
 * from the same spec sheet the customer sees) → rep edits any field →
 * Preview (PDF) OR Send. Sending persists the WO, attaches the spec sheet,
 * emails the sub with a public sign link, and toasts back.
 */
function WorkOrderModal({ dealId, onClose, onSent }) {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({});
  const [existing, setExisting] = useState(null);
  // Subcontractor roster — drives the "Contractor" dropdown so the rep can
  // pick a vendor and auto-fill all sub fields in one shot.
  const [subs, setSubs] = useState([]);
  // Western Colloid manufacturer specs from the Library — picker lets the rep
  // attach one or more to the outbound WO email AND drop a reference line
  // into the description so the sub knows which spec governs the job.
  const [librarySpecs, setLibrarySpecs] = useState([]);
  const [selectedLibraryIds, setSelectedLibraryIds] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        const [draftR, subsR, libR] = await Promise.all([
          api.get(`/deals/${dealId}/work-order/draft`),
          api.get("/vendors?kind=Subcontractor").catch(() => ({ data: [] })),
          api.get("/library/files?category=Western%20Colloid&subcategory=Specifications").catch(() => ({ data: [] })),
        ]);
        setForm(draftR.data?.existing ? { ...draftR.data.draft, ...draftR.data.existing } : draftR.data?.draft || {});
        setExisting(draftR.data?.existing || null);
        setSubs((subsR.data || []).slice().sort((a, b) => (a.name || "").localeCompare(b.name || "")));
        setLibrarySpecs((libR.data || []).slice().sort((a, b) => (a.display_name || a.original_filename || "").localeCompare(b.display_name || b.original_filename || "")));
        setSelectedLibraryIds(draftR.data?.existing?.library_file_ids || []);
      } catch (e) {
        const status = e?.response?.status;
        if (status === 404) {
          toast.error("This deal can't be found — it may have been deleted. Refresh the page.", { duration: 8000 });
          onClose?.();
        } else {
          toast.error(e?.response?.data?.detail || e.message);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [dealId]);

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  // Toggle a Library spec into/out of the attachment list. We key off the
  // file id so the checkbox state stays in sync after reloads.
  const toggleLibraryFile = (lf) => {
    setSelectedLibraryIds((prev) =>
      prev.includes(lf.id) ? prev.filter((x) => x !== lf.id) : [...prev, lf.id]
    );
  };

  // Picking a sub from the dropdown auto-fills every field that came from the
  // vendor record — Contractor name, company, address, contact, email. Rep
  // can still edit any of them after.
  const pickSub = (subId) => {
    if (!subId) { set("contractor", ""); return; }
    const sub = subs.find((x) => x.id === subId);
    if (!sub) return;
    setForm((p) => ({
      ...p,
      contractor: sub.name || "",
      sub_company: sub.name || "",
      sub_address: sub.address || "",
      sub_contact: sub.contact_name || "",
      sub_email: sub.email || "",
    }));
  };

  const preview = async () => {
    try {
      const r = await api.post(`/deals/${dealId}/work-order/preview`, { ...form, library_file_ids: selectedLibraryIds }, { responseType: "blob" });
      const url = URL.createObjectURL(r.data);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (e) {
      toast.error(e?.response?.data?.detail || e.message);
    }
  };

  const send = async () => {
    if (!form.sub_email || !form.sub_email.includes("@")) {
      toast.error("Subcontractor email is required"); return;
    }
    setSubmitting(true);
    try {
      const r = await api.post(`/deals/${dealId}/work-order/send`, { ...form, library_file_ids: selectedLibraryIds });
      onSent?.(r.data);
    } catch (e) {
      const status = e?.response?.status;
      const detail = e?.response?.data?.detail;
      if (status === 404) {
        toast.error("This deal can't be found in the database — it may have been deleted. Refresh the page and try again.", { duration: 8000 });
      } else if (detail) {
        toast.error(typeof detail === "string" ? detail : JSON.stringify(detail));
      } else {
        toast.error(`Work order send failed (HTTP ${status || "?"}) — ${e.message}`);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-sm max-w-3xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()} data-testid="work-order-modal">
        <div className="px-5 py-4 border-b border-zinc-200 flex items-center justify-between">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-700">Issue Work Order</div>
            <h2 className="font-heading text-xl font-black">Send Work Order to Subcontractor</h2>
            {existing && (
              <div className="text-[11px] text-amber-700 mt-1">
                ⚠ A work order already exists for this deal. Saving will overwrite it
                {existing.signed_at && " — but the existing signature will NOT be invalidated; the sub will need to sign the new version."}
              </div>
            )}
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-700 text-xl leading-none px-2">×</button>
        </div>
        {loading ? (
          <div className="p-8 text-center text-zinc-500 text-sm">Loading draft…</div>
        ) : (
          <div className="p-5 space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <Field label="WO Date" value={form.wo_date} onChange={(v) => set("wo_date", v)} testId="wo-date" />
              <Field label="Work Date" value={form.work_date} onChange={(v) => set("work_date", v)} testId="wo-work-date" />
            </div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mt-2">Subcontractor</div>
            <Field label="Company Name" value={form.sub_company} onChange={(v) => set("sub_company", v)} testId="wo-sub-company" />
            <Field label="Company Address" value={form.sub_address} onChange={(v) => set("sub_address", v)} testId="wo-sub-address" />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Contact Name" value={form.sub_contact} onChange={(v) => set("sub_contact", v)} testId="wo-sub-contact" />
              <Field label="Email *" value={form.sub_email} onChange={(v) => set("sub_email", v)} testId="wo-sub-email" required />
            </div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mt-2">Project</div>
            <Field label="Project Name" value={form.project_name} onChange={(v) => set("project_name", v)} testId="wo-project-name" />
            <Field label="Project Address" value={form.project_address} onChange={(v) => set("project_address", v)} testId="wo-project-address" />
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-600 mb-1">Contractor (entity SealTech is paying)</label>
              <select
                value={subs.find((s) => s.name === form.contractor)?.id || ""}
                onChange={(e) => pickSub(e.target.value)}
                data-testid="wo-contractor-select"
                className="w-full h-10 px-3 border border-zinc-300 rounded-sm text-sm bg-white"
              >
                <option value="">— Pick a subcontractor —</option>
                {subs.map((sub) => (
                  <option key={sub.id} value={sub.id}>
                    {sub.name}{sub.contact_name ? ` · ${sub.contact_name}` : ""}
                  </option>
                ))}
              </select>
              <div className="text-[10px] text-zinc-500 mt-1">Picking a sub auto-fills the company name, address, contact, and email below. Edit any field after.</div>
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-600 mb-1">Description (scope of work)</label>
              <textarea
                value={form.description || ""}
                onChange={(e) => set("description", e.target.value)}
                rows={14}
                data-testid="wo-description"
                className="w-full px-3 py-2 border border-zinc-300 rounded-sm text-xs font-mono"
              />
              <div className="text-[10px] text-zinc-500 mt-1">Edit freely — the box on the PDF auto-grows to push the signatures to the bottom of the page. HTML tags <b>&lt;b&gt;</b>, <b>&lt;br/&gt;</b> supported.</div>
            </div>
            {/* Library spec picker — pulls PDFs uploaded under
                Library → Western Colloid → Specifications. Ticked specs are
                attached to the outbound email AND referenced in the
                description. */}
            <div className="border border-zinc-200 rounded-sm">
              <div className="px-3 py-2 bg-zinc-50 border-b border-zinc-200 text-[10px] font-bold uppercase tracking-wider text-zinc-600">
                Attach Manufacturer Specs <span className="text-zinc-400 normal-case font-normal">(Library → Western Colloid → Specifications)</span>
              </div>
              <div className="p-3 max-h-40 overflow-y-auto space-y-1">
                {librarySpecs.length === 0 && (
                  <div className="text-[11px] text-zinc-500 italic">No specs in Library yet. Upload PDFs under Library → Western Colloid → Specifications to make them available here.</div>
                )}
                {librarySpecs.map((lf) => (
                  <label key={lf.id} className="flex items-start gap-2 text-xs cursor-pointer hover:bg-zinc-50 px-2 py-1 rounded-sm">
                    <input type="checkbox" checked={selectedLibraryIds.includes(lf.id)} onChange={() => toggleLibraryFile(lf)} data-testid={`wo-lib-${lf.id}`} className="mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-zinc-900 truncate">{lf.display_name || lf.original_filename}</div>
                      {lf.description && <div className="text-[10px] text-zinc-500 truncate">{lf.description}</div>}
                    </div>
                  </label>
                ))}
              </div>
              {selectedLibraryIds.length > 0 ? (
                <div className="px-3 py-2 bg-blue-50 border-t border-blue-200 text-[11px] text-blue-900">
                  <b>{selectedLibraryIds.length}</b> manufacturer spec{selectedLibraryIds.length === 1 ? "" : "s"} will be attached. The auto-generated SealTech Spec Sheet is <b>replaced</b> by your selection — sub gets one scope packet, not two.
                </div>
              ) : (
                <div className="px-3 py-2 bg-amber-50 border-t border-amber-200 text-[11px] text-amber-900">
                  No manufacturer spec attached → the email will include the auto-generated <b>SealTech Spec Sheet</b> (Silicone Roof Scope template) as the scope reference.
                </div>
              )}
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-600 mb-1">Total ($)</label>
              <input type="number" step="0.01" value={form.total || 0} onChange={(e) => set("total", Number(e.target.value))} data-testid="wo-total" className="w-48 h-10 px-3 border border-zinc-300 rounded-sm text-sm font-mono text-right" />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-600 mb-1">Notes (override default Master-Subcontractor text)</label>
              <textarea value={form.notes || ""} onChange={(e) => set("notes", e.target.value)} rows={3} placeholder="Leave blank to use the standard Work Order language (subcontractor agrees to perform the Work per manufacturer specs, furnishes labor/materials/insurance/supervision/equipment, etc.)" data-testid="wo-notes" className="w-full px-3 py-2 border border-zinc-300 rounded-sm text-xs" />
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-sm p-3 text-[11px] text-blue-900">
              <b>Email attachments:</b> Work Order PDF + customer-signed Spec Sheet PDF + any Manufacturer Specs you ticked above.
            </div>
          </div>
        )}
        <div className="px-5 py-4 border-t border-zinc-200 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 h-10 text-xs font-bold uppercase tracking-wider border border-zinc-300 rounded-sm hover:bg-zinc-50">Cancel</button>
          <button type="button" onClick={preview} disabled={loading} data-testid="wo-preview" className="px-4 h-10 text-xs font-bold uppercase tracking-wider border border-blue-700 text-blue-700 hover:bg-blue-50 rounded-sm disabled:opacity-50">Preview PDF</button>
          <button type="button" onClick={send} disabled={loading || submitting} data-testid="wo-send" className="px-4 h-10 text-xs font-bold uppercase tracking-wider bg-blue-700 text-white hover:bg-blue-800 rounded-sm disabled:opacity-50">{submitting ? "Sending…" : "Send to Subcontractor"}</button>
        </div>
      </div>
    </div>
  );
}

const Field = ({ label, value, onChange, testId, required }) => (
  <div>
    <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-600 mb-1">{label}</label>
    <input type="text" value={value || ""} onChange={(e) => onChange(e.target.value)} data-testid={testId} required={required} className="w-full h-10 px-3 border border-zinc-300 rounded-sm text-sm" />
  </div>
);

