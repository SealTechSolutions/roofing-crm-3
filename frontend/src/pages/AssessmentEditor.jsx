import React, { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { toast } from "sonner";
import {
  ClipboardCheck, ChevronLeft, ChevronRight, Save, FileText, Mail, CheckCircle2,
  Plus, X, Trash2, Image as ImageIcon, Upload, AlertTriangle, ArrowRightCircle,
} from "lucide-react";

const BLANK_SCORE = { score: 0, reasoning: "" };
const BLANK_FINDING = (component) => ({
  component, observations: "", severity: "", risk: "", recommendation: "", photo_ids: [],
});
const BLANK_OPTION = (cost, life, disrupt) => ({
  cost, life_extension: life, disruption: disrupt,
  advantages: [], disadvantages: [], limitations: [],
});

const BLANK_ASSESSMENT = {
  deal_id: "",
  contact_id: "",
  entity_id: "",
  // Cover
  prepared_for: "",
  contact_name: "",
  property_name: "",
  property_address: "",
  prepared_by: "Darren Oliver, CSI, IIBEC · SealTech Building Solutions",
  assessment_date: new Date().toISOString().slice(0, 10),
  // Executive
  purpose: "",
  executive_conclusion: "",
  overall_recommendation: "",
  // Scores
  roof_asset_score: { ...BLANK_SCORE },
  condition_rating: { ...BLANK_SCORE },
  remaining_service_life: { ...BLANK_SCORE },
  restoration_suitability: { ...BLANK_SCORE },
  capital_risk: { ...BLANK_SCORE },
  hail_resilience: { ...BLANK_SCORE },
  maintenance_status: { ...BLANK_SCORE },
  warranty_status: { ...BLANK_SCORE },
  // Findings
  primary_concerns: [],
  positive_findings: [],
  recommended_strategy: "",
  capital_planning_impact: "",
  immediate_action_items: [],
  methodology_notes: "",
  // Property (14 fields matching original report)
  building_type: "",
  year_built: null,
  occupancy_type: "",
  roof_type: "",
  manufacturer: "",
  installation_date: "",
  roof_age_years: null,
  warranty_status_text: "",
  square_footage: null,
  repair_history: "",
  weather_conditions: "",
  last_inspection_date: "",
  // Scope checkboxes
  scope_visual_assessment: true,
  scope_infrared_survey: false,
  scope_moisture_survey: false,
  scope_core_samples: false,
  scope_drone_imaging: false,
  scope_membrane_testing: false,
  scope_drainage_evaluation: true,
  scope_documentation_review: false,
  // Aerial
  aerial_photo_id: null,
  // R-1..R-5
  finding_r1: BLANK_FINDING("Roof Membrane"),
  finding_r2: BLANK_FINDING("Flashings"),
  finding_r3: BLANK_FINDING("Roof Penetrations"),
  finding_r4: BLANK_FINDING("Drainage System"),
  finding_r5: BLANK_FINDING("Rooftop Equipment"),
  // Score analysis
  positive_factors: [],
  negative_factors: [],
  restoration_suitability_rating: "Moderate",
  restoration_analysis: "",
  factor_membrane_intact: false,
  factor_minimal_water_intrusion: false,
  factor_drainage_functional: false,
  factor_structural_integrity: false,
  factor_compatible_substrate: false,
  factor_recent_inspection: false,
  // Options
  option_repair: BLANK_OPTION("$ — Low", "1-3 years", "Minimal"),
  option_restoration: BLANK_OPTION("$$ — Mid", "10-15 years", "Low"),
  option_replacement: BLANK_OPTION("$$$ — High", "20-25 years", "High"),
  // Forecast
  forecast_1yr: "",
  forecast_3yr: "",
  forecast_5yr: "",
  forecast_10yr: "",
  // Plan
  budget_priority: "Moderate",
  immediate_actions: [],
  near_term_actions: [],
  long_term_actions: [],
  // Recommendations
  rec_restoration_program: false,
  rec_repair_and_monitor: false,
  rec_partial_replacement: false,
  rec_full_replacement: false,
  rec_maintenance_program: false,
  rec_drainage_improvements: false,
  rec_restoration_program_comment: "",
  rec_repair_and_monitor_comment: "",
  rec_partial_replacement_comment: "",
  rec_full_replacement_comment: "",
  rec_maintenance_program_comment: "",
  rec_drainage_improvements_comment: "",
  supporting_comments: "",
  expected_outcomes: [
    "Extend roof service life",
    "Improve waterproofing reliability",
    "Delay/Eliminate replacement costs",
    "Reduce future capital exposure",
    "Protect interior assets",
    "Renewable roof system",
  ],
  conclusion: "",
  status: "Draft",
};

const STEPS = [
  { key: "cover", label: "Cover & Property" },
  { key: "scores", label: "Roof Asset Score" },
  { key: "findings", label: "Condition Findings" },
  { key: "analysis", label: "Analysis & Options" },
  { key: "plan", label: "Plan & Recommendation" },
];

export default function AssessmentEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = !id;
  const [step, setStep] = useState(0);
  const [doc, setDoc] = useState(BLANK_ASSESSMENT);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [contacts, setContacts] = useState([]);
  const [deals, setDeals] = useState([]);
  const [dealPhotos, setDealPhotos] = useState([]);
  const [photoPickerFor, setPhotoPickerFor] = useState(null); // 'aerial' | 'finding_rN'

  useEffect(() => {
    api.get("/contacts").then((r) => setContacts(r.data || [])).catch(() => {});
    api.get("/deals").then((r) => setDeals(r.data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (isNew) return;
    setLoading(true);
    api.get(`/assessments/${id}`)
      .then((r) => setDoc({ ...BLANK_ASSESSMENT, ...r.data }))
      .catch((e) => toast.error(formatApiError(e?.response?.data?.detail) || e.message))
      .finally(() => setLoading(false));
  }, [id, isNew]);

  // When linked deal changes, fetch its photos
  useEffect(() => {
    if (!doc.deal_id) { setDealPhotos([]); return; }
    api.get(`/projects/${doc.deal_id}/photos`)
      .then((r) => setDealPhotos(r.data || []))
      .catch(() => setDealPhotos([]));
  }, [doc.deal_id]);

  const update = (patch) => setDoc((d) => ({ ...d, ...patch }));
  const updateScore = (key, patch) => setDoc((d) => ({ ...d, [key]: { ...d[key], ...patch } }));
  const updateFinding = (key, patch) => setDoc((d) => ({ ...d, [key]: { ...d[key], ...patch } }));
  const updateOption = (key, patch) => setDoc((d) => ({ ...d, [key]: { ...d[key], ...patch } }));

  const save = async (afterSave) => {
    setSaving(true);
    try {
      if (isNew) {
        const r = await api.post("/assessments", doc);
        toast.success("Assessment created");
        if (afterSave === "stay") {
          navigate(`/assessments/${r.data.id}`, { replace: true });
        } else if (afterSave === "list") {
          navigate("/assessments");
        } else {
          navigate(`/assessments/${r.data.id}`, { replace: true });
        }
      } else {
        await api.put(`/assessments/${id}`, doc);
        toast.success("Saved");
        if (afterSave === "list") navigate("/assessments");
      }
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setSaving(false);
    }
  };

  const finalize = async () => {
    if (!id) { toast.error("Save the assessment first"); return; }
    if (!window.confirm("Mark this assessment as Final? You can still edit it after, but it's a useful flag for reporting.")) return;
    try {
      await api.post(`/assessments/${id}/finalize`);
      toast.success("Marked Final");
      const r = await api.get(`/assessments/${id}`);
      setDoc({ ...BLANK_ASSESSMENT, ...r.data });
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    }
  };

  const viewPdf = async () => {
    if (isNew) { toast.error("Save the assessment first"); return; }
    const token = localStorage.getItem("crm_token");
    // Open placeholder tab synchronously so popup blockers don't swallow it.
    const newWin = window.open("", "_blank");
    if (!newWin) {
      toast.error("Browser blocked the pop-up. Allow pop-ups for this site, then try again.");
      return;
    }
    newWin.document.write("<title>Loading PDF…</title><p style=\"font-family:sans-serif;color:#666;padding:20px;\">Generating Assessment PDF — please wait…</p>");
    try {
      const r = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/assessments/${id}/pdf`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error(`PDF generation failed (HTTP ${r.status})`);
      const blob = await r.blob();
      newWin.location.href = URL.createObjectURL(blob);
    } catch (e) {
      newWin.document.body.innerHTML = `<p style="font-family:sans-serif;color:#b00;padding:20px;">${e.message}</p>`;
      toast.error(`PDF: ${e.message}`);
    }
  };

  const emailPdf = async () => {
    if (isNew) { toast.error("Save the assessment first"); return; }
    let to = "";
    if (doc.contact_id) {
      const c = contacts.find((x) => x.id === doc.contact_id);
      to = c?.email || "";
    }
    to = window.prompt("Send the assessment PDF to:", to);
    if (!to || !to.trim()) return;
    try {
      await api.post(`/assessments/${id}/email`, { to: to.trim() });
      toast.success(`Sent to ${to.trim()}`);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    }
  };

  const convertToScope = async () => {
    if (isNew) { toast.error("Save the assessment first"); return; }
    if (!doc.deal_id) {
      toast.error("Link this assessment to a Project (Step 1) before converting.");
      return;
    }
    const anyRec = doc.rec_restoration_program || doc.rec_repair_and_monitor ||
                   doc.rec_partial_replacement || doc.rec_full_replacement ||
                   doc.rec_maintenance_program || doc.rec_drainage_improvements;
    const warning = !anyRec
      ? "No SealTech Recommendation checkbox is selected (Step 5). The scope will default to 'Roof Restoration Program'.\n\n"
      : "";
    if (!window.confirm(
      `${warning}This will pre-fill the linked Project's Construction Scope using:\n` +
      `• Recommended Strategy + Immediate Actions → Project Requirements\n` +
      `• R-1..R-5 Recommendations → Other Requirements\n` +
      `• Long-term Actions + standard exclusions → Exclusions\n\n` +
      "Existing scope text on the Deal will be overwritten. Continue?"
    )) return;
    try {
      const r = await api.post(`/assessments/${id}/convert-to-scope`);
      toast.success(`Scope pre-filled (${r.data.recommended_label}) — opening Project...`);
      setTimeout(() => navigate(`/projects/${r.data.deal_id}`), 600);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    }
  };

  const next = () => setStep((s) => Math.min(STEPS.length - 1, s + 1));
  const prev = () => setStep((s) => Math.max(0, s - 1));

  const linkedDeal = useMemo(() => deals.find((d) => d.id === doc.deal_id), [deals, doc.deal_id]);

  if (loading) return <div className="p-12 text-sm text-zinc-500">Loading...</div>;

  return (
    <div className="p-6 max-w-5xl mx-auto" data-testid="assessment-editor">
      {/* Header */}
      <div className="flex items-start gap-4 mb-5">
        <button onClick={() => navigate("/assessments")} className="p-2 text-zinc-500 hover:text-blue-700" data-testid="back-btn">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="w-10 h-10 rounded-sm bg-blue-700 flex items-center justify-center flex-shrink-0">
          <ClipboardCheck className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-widest text-blue-700">
            {isNew ? "New" : doc.status === "Final" ? "Final · " + doc.assessment_date : "Draft"}
          </div>
          <h1 className="text-xl font-black text-zinc-900 truncate">
            {doc.property_name || doc.property_address || "Untitled Assessment"}
          </h1>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          {!isNew && (
            <>
              <button onClick={viewPdf} className="inline-flex items-center gap-2 border border-zinc-300 px-3 h-9 text-xs font-bold uppercase tracking-wider hover:border-blue-700 hover:text-blue-700" data-testid="view-pdf-btn">
                <FileText className="w-3.5 h-3.5" /> PDF
              </button>
              <button onClick={emailPdf} className="inline-flex items-center gap-2 border border-zinc-300 px-3 h-9 text-xs font-bold uppercase tracking-wider hover:border-blue-700 hover:text-blue-700" data-testid="email-pdf-btn">
                <Mail className="w-3.5 h-3.5" /> Email
              </button>
              {doc.status !== "Final" && (
                <button onClick={finalize} className="inline-flex items-center gap-2 border border-emerald-600 text-emerald-700 px-3 h-9 text-xs font-bold uppercase tracking-wider hover:bg-emerald-50" data-testid="finalize-btn">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Mark Final
                </button>
              )}
              <button
                onClick={convertToScope}
                disabled={!doc.deal_id}
                title={doc.deal_id ? "Pre-fill linked Project's scope from this assessment" : "Link a Project (Step 1) to enable"}
                className="inline-flex items-center gap-2 border border-bronze-600 px-3 h-9 text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ borderColor: "#A0703A", color: "#A0703A" }}
                data-testid="convert-to-scope-btn"
              >
                <ArrowRightCircle className="w-3.5 h-3.5" /> Convert to Scope
              </button>
            </>
          )}
          <button onClick={() => save("stay")} disabled={saving} className="inline-flex items-center gap-2 bg-blue-700 text-white px-3 h-9 text-xs font-bold uppercase tracking-wider hover:bg-blue-800 disabled:opacity-60" data-testid="save-btn">
            <Save className="w-3.5 h-3.5" /> {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      {/* Wizard step indicator */}
      <div className="flex items-center gap-1 mb-6" data-testid="wizard-steps">
        {STEPS.map((sObj, i) => (
          <button
            key={sObj.key}
            onClick={() => setStep(i)}
            className={`flex-1 px-3 py-3 text-[10px] font-bold uppercase tracking-wider border-b-2 transition-colors ${
              i === step ? "border-blue-700 text-blue-700 bg-blue-50" :
              i < step ? "border-emerald-500 text-emerald-700" :
              "border-zinc-200 text-zinc-500 hover:text-zinc-900"
            }`}
            data-testid={`step-${sObj.key}`}
          >
            <span className="opacity-60 mr-2">{i + 1}.</span>{sObj.label}
          </button>
        ))}
      </div>

      {/* Step content */}
      <div className="bg-white border border-zinc-200 p-6">
        {step === 0 && <StepCover doc={doc} update={update} contacts={contacts} deals={deals} linkedDeal={linkedDeal} />}
        {step === 1 && <StepScores doc={doc} updateScore={updateScore} update={update} />}
        {step === 2 && (
          <StepFindings
            doc={doc}
            updateFinding={updateFinding}
            update={update}
            dealPhotos={dealPhotos}
            onPickPhoto={(target) => setPhotoPickerFor(target)}
          />
        )}
        {step === 3 && <StepAnalysis doc={doc} update={update} updateOption={updateOption} />}
        {step === 4 && <StepPlan doc={doc} update={update} />}
      </div>

      {/* Wizard footer nav */}
      <div className="flex items-center justify-between mt-5">
        <button
          onClick={prev}
          disabled={step === 0}
          className="inline-flex items-center gap-2 border border-zinc-300 px-4 py-2 text-xs font-bold uppercase tracking-wider hover:border-zinc-500 disabled:opacity-40 disabled:cursor-not-allowed"
          data-testid="prev-step-btn"
        >
          <ChevronLeft className="w-3.5 h-3.5" /> Previous
        </button>
        <div className="text-[11px] text-zinc-500 uppercase tracking-wider font-bold">Step {step + 1} of {STEPS.length}</div>
        {step < STEPS.length - 1 ? (
          <button
            onClick={next}
            className="inline-flex items-center gap-2 bg-blue-700 text-white px-4 py-2 text-xs font-bold uppercase tracking-wider hover:bg-blue-800"
            data-testid="next-step-btn"
          >
            Next <ChevronRight className="w-3.5 h-3.5" />
          </button>
        ) : (
          <button
            onClick={() => save("list")}
            disabled={saving}
            className="inline-flex items-center gap-2 bg-emerald-700 text-white px-4 py-2 text-xs font-bold uppercase tracking-wider hover:bg-emerald-800 disabled:opacity-60"
            data-testid="finish-btn"
          >
            <Save className="w-3.5 h-3.5" /> Save &amp; Finish
          </button>
        )}
      </div>

      {photoPickerFor && (
        <PhotoPickerModal
          dealId={doc.deal_id}
          dealPhotos={dealPhotos}
          existingIds={
            photoPickerFor === "aerial" ? (doc.aerial_photo_id ? [doc.aerial_photo_id] : []) :
            doc[photoPickerFor]?.photo_ids || []
          }
          multiSelect={photoPickerFor !== "aerial"}
          onClose={() => setPhotoPickerFor(null)}
          onPick={(ids) => {
            if (photoPickerFor === "aerial") {
              update({ aerial_photo_id: ids[0] || null });
            } else {
              updateFinding(photoPickerFor, { photo_ids: ids });
            }
            setPhotoPickerFor(null);
          }}
          onUploaded={(photo) => {
            setDealPhotos((ps) => [photo, ...ps]);
          }}
        />
      )}
    </div>
  );
}

// =====================================================================
// Step 1 — Cover & Property
// =====================================================================
function StepCover({ doc, update, contacts, deals, linkedDeal }) {
  return (
    <div className="space-y-5" data-testid="step-cover-body">
      <SectionTitle>Cover Block</SectionTitle>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Prepared For (Client)">
          <input value={doc.prepared_for} onChange={(e) => update({ prepared_for: e.target.value })} className={inputCls} data-testid="prepared-for" />
        </Field>
        <Field label="Assessment Date">
          <input type="date" value={doc.assessment_date || ""} onChange={(e) => update({ assessment_date: e.target.value })} className={inputCls} data-testid="assessment-date" />
        </Field>
        <Field label="Contact Name (point of contact at client)" full>
          <input value={doc.contact_name} onChange={(e) => update({ contact_name: e.target.value })} className={inputCls} placeholder="e.g., John Smith, Facilities Manager" data-testid="contact-name" />
        </Field>
        <Field label="Property Name" full>
          <input value={doc.property_name} onChange={(e) => update({ property_name: e.target.value })} className={inputCls} placeholder="e.g., Acme Distribution Center" data-testid="property-name" />
        </Field>
        <Field label="Property Address" full>
          <input value={doc.property_address} onChange={(e) => update({ property_address: e.target.value })} className={inputCls} placeholder="Street, City, ST ZIP" data-testid="property-address" />
        </Field>
        <Field label="Prepared By" full>
          <input value={doc.prepared_by} onChange={(e) => update({ prepared_by: e.target.value })} className={inputCls} data-testid="prepared-by" />
        </Field>
      </div>

      <SectionTitle>Link to Existing Records</SectionTitle>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Linked Deal / Project (optional — enables photo attachments)">
          <select value={doc.deal_id || ""} onChange={(e) => update({ deal_id: e.target.value })} className={inputCls} data-testid="link-deal">
            <option value="">— No project —</option>
            {deals.map((d) => <option key={d.id} value={d.id}>{d.title || d.id.slice(0, 8)}</option>)}
          </select>
        </Field>
        <Field label="Linked Contact (optional)">
          <select value={doc.contact_id || ""} onChange={(e) => update({ contact_id: e.target.value })} className={inputCls} data-testid="link-contact">
            <option value="">— No contact —</option>
            {contacts.map((c) => <option key={c.id} value={c.id}>{c.contact_name} {c.company_name ? `· ${c.company_name}` : ""}</option>)}
          </select>
        </Field>
      </div>

      <SectionTitle>Property Information</SectionTitle>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Building Type">
          <input value={doc.building_type} onChange={(e) => update({ building_type: e.target.value })} className={inputCls} placeholder="Warehouse, Office, Retail..." data-testid="building-type" />
        </Field>
        <Field label="Year Constructed">
          <YearOrUnknown value={doc.year_built} onChange={(v) => update({ year_built: v })} testId="year-built" />
        </Field>
        <Field label="Occupancy Type">
          <input value={doc.occupancy_type} onChange={(e) => update({ occupancy_type: e.target.value })} className={inputCls} placeholder="Owner-occupied, Tenant, Mixed..." data-testid="occupancy-type" />
        </Field>
        <Field label="Roof Type">
          <input value={doc.roof_type} onChange={(e) => update({ roof_type: e.target.value })} className={inputCls} placeholder="TPO, EPDM, BUR, Mod Bit..." data-testid="roof-type" />
        </Field>
        <Field label="Manufacturer">
          <input value={doc.manufacturer} onChange={(e) => update({ manufacturer: e.target.value })} className={inputCls} placeholder="Carlisle, GAF, Firestone..." data-testid="manufacturer" />
        </Field>
        <Field label="Installation Date">
          <DateOrUnknown value={doc.installation_date} onChange={(v) => update({ installation_date: v })} testId="installation-date" />
        </Field>
        <Field label="Estimated Roof Age (years)">
          <input type="number" step="0.5" value={doc.roof_age_years ?? ""} onChange={(e) => update({ roof_age_years: e.target.value === "" ? null : parseFloat(e.target.value) })} className={inputCls} data-testid="roof-age" />
        </Field>
        <Field label="Warranty Status">
          <input value={doc.warranty_status_text} onChange={(e) => update({ warranty_status_text: e.target.value })} className={inputCls} placeholder="Expired, 5 years remaining, NDL 15-year..." data-testid="warranty-status" />
        </Field>
        <Field label="Approximate Roof Area (sq ft)">
          <input type="number" value={doc.square_footage ?? ""} onChange={(e) => update({ square_footage: e.target.value === "" ? null : parseFloat(e.target.value) })} className={inputCls} data-testid="sqft" />
        </Field>
        <Field label="Last Inspection Date">
          <DateOrUnknown value={doc.last_inspection_date} onChange={(v) => update({ last_inspection_date: v })} testId="last-inspection" />
        </Field>
        <Field label="Repair History" full>
          <textarea rows={2} value={doc.repair_history} onChange={(e) => update({ repair_history: e.target.value })} className={inputCls} placeholder="Notes on prior repairs, leak history, prior contractors..." data-testid="repair-history" />
        </Field>
        <Field label="Weather Conditions (at time of assessment)" full>
          <input value={doc.weather_conditions} onChange={(e) => update({ weather_conditions: e.target.value })} className={inputCls} placeholder="Sunny, 65°F, dry roof. Light wind." data-testid="weather-conditions" />
        </Field>
      </div>

      <SectionTitle>Assessment Scope Included</SectionTitle>
      <div className="grid grid-cols-2 gap-3">
        {[
          ["scope_visual_assessment", "Visual Assessment"],
          ["scope_infrared_survey", "Infrared Survey"],
          ["scope_moisture_survey", "Moisture Survey"],
          ["scope_core_samples", "Core Samples"],
          ["scope_drone_imaging", "Drone Imaging"],
          ["scope_membrane_testing", "Membrane Testing"],
          ["scope_drainage_evaluation", "Drainage Evaluation"],
          ["scope_documentation_review", "Documentation Review"],
        ].map(([key, label]) => (
          <Checkbox key={key} testId={`scope-${key}`} checked={!!doc[key]} onChange={(v) => update({ [key]: v })} label={label} />
        ))}
      </div>

      {linkedDeal && (
        <div className="text-xs text-blue-700 bg-blue-50 border border-blue-200 px-3 py-2 rounded-sm">
          ✓ Linked to <strong>{linkedDeal.title}</strong> — project photos will be available on the Findings step.
        </div>
      )}
    </div>
  );
}

// =====================================================================
// Step 2 — Scores (Roof Asset Dashboard)
// =====================================================================
const SCORE_KEYS = [
  ["roof_asset_score", "Roof Asset Score™ (overall)"],
  ["condition_rating", "Condition Rating"],
  ["remaining_service_life", "Remaining Service Life"],
  ["restoration_suitability", "Restoration Suitability™"],
  ["capital_risk", "Capital Risk™"],
  ["hail_resilience", "Hail Resilience™"],
  ["maintenance_status", "Maintenance Status"],
  ["warranty_status", "Warranty Status"],
];

function StepScores({ doc, updateScore, update }) {
  return (
    <div className="space-y-5" data-testid="step-scores-body">
      <SectionTitle>Roof Asset Dashboard™ — 0-100 Scores</SectionTitle>
      <div className="text-xs text-zinc-500">
        Slide each metric (or type the number) and add a short reasoning line. These render on Pages 2-3 of the PDF.
      </div>
      <div className="space-y-3">
        {SCORE_KEYS.map(([key, label]) => (
          <ScoreInput
            key={key}
            label={label}
            value={doc[key]?.score || 0}
            reasoning={doc[key]?.reasoning || ""}
            onChangeScore={(v) => updateScore(key, { score: v })}
            onChangeReasoning={(v) => updateScore(key, { reasoning: v })}
            testId={`score-${key}`}
          />
        ))}
      </div>

      <SectionTitle>Executive Summary Narrative</SectionTitle>
      <Field label="Purpose of Assessment">
        <textarea rows={3} value={doc.purpose} onChange={(e) => update({ purpose: e.target.value })} className={inputCls} data-testid="purpose" />
      </Field>
      <Field label="Executive Conclusion">
        <textarea rows={4} value={doc.executive_conclusion} onChange={(e) => update({ executive_conclusion: e.target.value })} className={inputCls} data-testid="exec-conclusion" />
      </Field>
      <Field label="Overall Recommendation">
        <textarea rows={2} value={doc.overall_recommendation} onChange={(e) => update({ overall_recommendation: e.target.value })} className={inputCls} data-testid="overall-rec" />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Primary Concerns (one per line)">
          <ListInput value={doc.primary_concerns} onChange={(v) => update({ primary_concerns: v })} placeholder="Add a concern..." testId="primary-concerns" />
        </Field>
        <Field label="Positive Findings (one per line)">
          <ListInput value={doc.positive_findings} onChange={(v) => update({ positive_findings: v })} placeholder="Add a positive..." testId="positive-findings" />
        </Field>
      </div>
    </div>
  );
}

// =====================================================================
// Step 3 — Condition Findings R-1..R-5
// =====================================================================
function StepFindings({ doc, updateFinding, update, dealPhotos, onPickPhoto }) {
  const aerialPhoto = dealPhotos.find((p) => p.id === doc.aerial_photo_id);
  return (
    <div className="space-y-6" data-testid="step-findings-body">
      <SectionTitle>Aerial Image of Roof</SectionTitle>
      <div className="flex items-center gap-4">
        <div className="flex-1">
          {aerialPhoto ? (
            <PhotoThumb photo={aerialPhoto} large />
          ) : (
            <div className="border-2 border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500">
              No aerial image selected
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => onPickPhoto("aerial")}
            disabled={!doc.deal_id}
            className="inline-flex items-center gap-2 border border-blue-700 text-blue-700 px-3 py-2 text-xs font-bold uppercase tracking-wider hover:bg-blue-50 disabled:opacity-40"
            data-testid="pick-aerial"
            title={doc.deal_id ? "" : "Link a Deal first to access photos"}
          >
            <ImageIcon className="w-3.5 h-3.5" /> {aerialPhoto ? "Change" : "Select Photo"}
          </button>
          {doc.aerial_photo_id && (
            <button
              type="button"
              onClick={() => update({ aerial_photo_id: null })}
              className="text-[10px] uppercase tracking-wider text-zinc-500 hover:text-rose-700"
            >
              Clear
            </button>
          )}
        </div>
      </div>
      {!doc.deal_id && (
        <div className="text-xs bg-amber-50 border border-amber-200 px-3 py-2 text-amber-900 flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5" />
          Link a Project on Step 1 to enable photo selection. Aerial &amp; finding photos pull from that project&apos;s photo library.
        </div>
      )}

      <SectionTitle>Asset Condition Findings (R-1 to R-5)</SectionTitle>
      {[
        ["finding_r1", "R-1"],
        ["finding_r2", "R-2"],
        ["finding_r3", "R-3"],
        ["finding_r4", "R-4"],
        ["finding_r5", "R-5"],
      ].map(([key, code]) => (
        <FindingBlock
          key={key}
          code={code}
          finding={doc[key]}
          dealPhotos={dealPhotos}
          dealLinked={!!doc.deal_id}
          onChange={(patch) => updateFinding(key, patch)}
          onPickPhoto={() => onPickPhoto(key)}
        />
      ))}
    </div>
  );
}

function FindingBlock({ code, finding, dealPhotos, dealLinked, onChange, onPickPhoto }) {
  const photos = dealPhotos.filter((p) => (finding.photo_ids || []).includes(p.id));
  return (
    <div className="border border-zinc-200 p-4 rounded-sm" data-testid={`block-${code}`}>
      <div className="flex items-center gap-3 mb-3">
        <span className="font-mono font-black text-bronze-700 text-bronze-700" style={{ color: "#A0703A" }}>{code}</span>
        <input
          value={finding.component}
          onChange={(e) => onChange({ component: e.target.value })}
          className="flex-1 font-bold text-zinc-900 border-b border-zinc-200 focus:outline-none focus:border-blue-700 px-1 py-0.5"
          data-testid={`${code}-component`}
        />
        <select
          value={finding.severity}
          onChange={(e) => onChange({ severity: e.target.value })}
          className="text-xs border border-zinc-300 px-2 py-1"
          data-testid={`${code}-severity`}
        >
          <option value="">Severity</option>
          {["Low", "Moderate", "High", "Critical"].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-1 gap-3 text-sm">
        <Field label="Observations">
          <textarea rows={2} value={finding.observations} onChange={(e) => onChange({ observations: e.target.value })} className={inputCls} data-testid={`${code}-observations`} />
        </Field>
        <Field label="Risk">
          <textarea rows={2} value={finding.risk} onChange={(e) => onChange({ risk: e.target.value })} className={inputCls} data-testid={`${code}-risk`} />
        </Field>
        <Field label="Recommendation">
          <textarea rows={2} value={finding.recommendation} onChange={(e) => onChange({ recommendation: e.target.value })} className={inputCls} data-testid={`${code}-recommendation`} />
        </Field>
      </div>
      <div className="mt-3 flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={onPickPhoto}
          disabled={!dealLinked}
          className="inline-flex items-center gap-2 border border-blue-700 text-blue-700 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider hover:bg-blue-50 disabled:opacity-40"
          data-testid={`${code}-attach-photos`}
        >
          <ImageIcon className="w-3.5 h-3.5" /> Attach Photos ({photos.length}/4)
        </button>
        <div className="flex gap-2 flex-wrap">
          {photos.map((p) => <PhotoThumb key={p.id} photo={p} />)}
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// Step 4 — Analysis & Options (Score drivers + Restoration + Repair/Restore/Replace)
// =====================================================================
function StepAnalysis({ doc, update, updateOption }) {
  return (
    <div className="space-y-5" data-testid="step-analysis-body">
      <SectionTitle>Score Drivers</SectionTitle>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Positive Factors (one per line)">
          <LinesArea value={doc.positive_factors} onChange={(v) => update({ positive_factors: v })} rows={3} placeholder="One positive driver per line…" testId="positive-factors" />
        </Field>
        <Field label="Negative Factors (one per line)">
          <LinesArea value={doc.negative_factors} onChange={(v) => update({ negative_factors: v })} rows={3} placeholder="One negative driver per line…" testId="negative-factors" />
        </Field>
      </div>

      <SectionTitle>Restoration Suitability™ Analysis</SectionTitle>
      <Field label="Restoration Suitability Rating">
        <div className="flex gap-2" data-testid="restoration-rating">
          {["High", "Moderate", "Low"].map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => update({ restoration_suitability_rating: r })}
              className={`px-4 py-2 text-xs font-bold uppercase tracking-wider border rounded-sm ${
                doc.restoration_suitability_rating === r
                  ? r === "High" ? "border-emerald-600 bg-emerald-600 text-white"
                  : r === "Moderate" ? "border-amber-600 bg-amber-600 text-white"
                  : "border-rose-600 bg-rose-600 text-white"
                  : "border-zinc-300 text-zinc-700 hover:border-zinc-500"
              }`}
              data-testid={`rating-${r}`}
            >
              {r}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Analysis">
        <textarea rows={3} value={doc.restoration_analysis} onChange={(e) => update({ restoration_analysis: e.target.value })} className={inputCls} data-testid="restoration-analysis" />
      </Field>

      <SectionTitle>Factors Supporting Restoration</SectionTitle>
      <div className="grid grid-cols-2 gap-3">
        {[
          ["factor_membrane_intact", "Membrane Largely Intact"],
          ["factor_minimal_water_intrusion", "Minimal Water Intrusion"],
          ["factor_drainage_functional", "Drainage Still Functional"],
          ["factor_structural_integrity", "Structural Integrity Sound"],
          ["factor_compatible_substrate", "Compatible Substrate"],
          ["factor_recent_inspection", "Recent Inspection Available"],
        ].map(([key, label]) => (
          <Checkbox key={key} testId={`factor-${key}`} checked={!!doc[key]} onChange={(v) => update({ [key]: v })} label={label} />
        ))}
      </div>

      <SectionTitle>Repair vs Restoration vs Replacement</SectionTitle>
      {[
        ["option_repair", "Option 1 — Continue Repairs"],
        ["option_restoration", "Option 2 — Restoration"],
        ["option_replacement", "Option 3 — Replacement"],
      ].map(([key, label]) => (
        <div key={key} className="border border-zinc-200 p-4 rounded-sm" data-testid={`opt-${key}`}>
          <div className="font-bold mb-3">{label}</div>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <Field label="Cost">
              <input value={doc[key].cost} onChange={(e) => updateOption(key, { cost: e.target.value })} className={inputCls} data-testid={`${key}-cost`} />
            </Field>
            <Field label="Life Extension">
              <input value={doc[key].life_extension} onChange={(e) => updateOption(key, { life_extension: e.target.value })} className={inputCls} data-testid={`${key}-life`} />
            </Field>
            <Field label="Disruption">
              <input value={doc[key].disruption} onChange={(e) => updateOption(key, { disruption: e.target.value })} className={inputCls} data-testid={`${key}-disruption`} />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Advantages (one per line)">
              <LinesArea value={doc[key].advantages} onChange={(v) => updateOption(key, { advantages: v })} rows={3} testId={`${key}-adv`} />
            </Field>
            <Field label="Disadvantages (one per line)">
              <LinesArea value={doc[key].disadvantages} onChange={(v) => updateOption(key, { disadvantages: v })} rows={3} testId={`${key}-dis`} />
            </Field>
            <Field label="Limitations (one per line)">
              <LinesArea value={doc[key].limitations} onChange={(v) => updateOption(key, { limitations: v })} rows={3} testId={`${key}-lim`} />
            </Field>
          </div>
        </div>
      ))}
    </div>
  );
}

// =====================================================================
// Step 5 — Plan & Recommendation
// =====================================================================
function StepPlan({ doc, update }) {
  return (
    <div className="space-y-5" data-testid="step-plan-body">
      <SectionTitle>Recommended Strategy</SectionTitle>
      <Field label="Recommended Strategy">
        <textarea rows={4} value={doc.recommended_strategy} onChange={(e) => update({ recommended_strategy: e.target.value })} className={inputCls} data-testid="rec-strategy" />
      </Field>
      <Field label="Capital Planning Impact">
        <textarea rows={4} value={doc.capital_planning_impact} onChange={(e) => update({ capital_planning_impact: e.target.value })} className={inputCls} data-testid="capital-impact" />
      </Field>
      <Field label="Immediate Action Items (one per line)">
        <LinesArea value={doc.immediate_action_items} onChange={(v) => update({ immediate_action_items: v })} rows={4} testId="immediate-action-items" />
      </Field>

      <SectionTitle>Capital Planning Forecast</SectionTitle>
      <div className="grid grid-cols-2 gap-4">
        <Field label="1-Year Outlook">
          <textarea rows={2} value={doc.forecast_1yr} onChange={(e) => update({ forecast_1yr: e.target.value })} className={inputCls} data-testid="forecast-1yr" />
        </Field>
        <Field label="3-Year Outlook">
          <textarea rows={2} value={doc.forecast_3yr} onChange={(e) => update({ forecast_3yr: e.target.value })} className={inputCls} data-testid="forecast-3yr" />
        </Field>
        <Field label="5-Year Outlook">
          <textarea rows={2} value={doc.forecast_5yr} onChange={(e) => update({ forecast_5yr: e.target.value })} className={inputCls} data-testid="forecast-5yr" />
        </Field>
        <Field label="10-Year Outlook">
          <textarea rows={2} value={doc.forecast_10yr} onChange={(e) => update({ forecast_10yr: e.target.value })} className={inputCls} data-testid="forecast-10yr" />
        </Field>
      </div>

      <SectionTitle>Roof Asset Plan™</SectionTitle>
      <Field label="Budget Priority">
        <div className="flex gap-2" data-testid="budget-priority">
          {["Low", "Moderate", "High", "Immediate"].map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => update({ budget_priority: r })}
              className={`px-3 py-1.5 text-xs font-bold uppercase tracking-wider border ${
                doc.budget_priority === r ? "border-blue-700 bg-blue-700 text-white" : "border-zinc-300 text-zinc-700"
              }`}
              data-testid={`priority-${r}`}
            >
              {r}
            </button>
          ))}
        </div>
      </Field>
      <div className="grid grid-cols-3 gap-4">
        <Field label="Immediate Actions (0-12 Mo, one per line)">
          <LinesArea value={doc.immediate_actions} onChange={(v) => update({ immediate_actions: v })} rows={3} testId="immediate-actions" />
        </Field>
        <Field label="Near-Term (1-3 Yr, one per line)">
          <LinesArea value={doc.near_term_actions} onChange={(v) => update({ near_term_actions: v })} rows={3} testId="near-actions" />
        </Field>
        <Field label="Long-Term (3-10 Yr, one per line)">
          <LinesArea value={doc.long_term_actions} onChange={(v) => update({ long_term_actions: v })} rows={3} testId="long-actions" />
        </Field>
      </div>

      <SectionTitle>SealTech Recommendation</SectionTitle>
      <div className="space-y-2">
        {[
          ["rec_restoration_program", "Restoration Program"],
          ["rec_repair_and_monitor", "Repair & Monitor"],
          ["rec_partial_replacement", "Partial Replacement"],
          ["rec_full_replacement", "Full Replacement"],
          ["rec_maintenance_program", "Maintenance Program"],
          ["rec_drainage_improvements", "Drainage Improvements"],
        ].map(([key, label]) => {
          const commentKey = `${key}_comment`;
          return (
            <div key={key} className="flex items-center gap-3">
              <div className="w-56 shrink-0">
                <Checkbox testId={`rec-${key}`} checked={!!doc[key]} onChange={(v) => update({ [key]: v })} label={label} />
              </div>
              <input
                type="text"
                placeholder="Comments"
                value={doc[commentKey] || ""}
                onChange={(e) => update({ [commentKey]: e.target.value })}
                className={`${inputCls} flex-1`}
                data-testid={`rec-${key}-comment`}
              />
            </div>
          );
        })}
      </div>
      <Field label="Supporting Comments">
        <textarea rows={6} value={doc.supporting_comments} onChange={(e) => update({ supporting_comments: e.target.value })} className={inputCls} data-testid="supporting-comments" />
      </Field>

      <SectionTitle>Expected Outcome</SectionTitle>
      <ListInput value={doc.expected_outcomes} onChange={(v) => update({ expected_outcomes: v })} testId="expected-outcomes" />

      <SectionTitle>Conclusion</SectionTitle>
      <Field label="Conclusion (final paragraph)">
        <textarea rows={3} value={doc.conclusion} onChange={(e) => update({ conclusion: e.target.value })} className={inputCls} data-testid="conclusion" />
      </Field>
    </div>
  );
}

// =====================================================================
// Photo picker modal
// =====================================================================
function PhotoPickerModal({ dealId, dealPhotos, existingIds, multiSelect, onClose, onPick, onUploaded }) {
  const [selected, setSelected] = useState(new Set(existingIds || []));
  const [uploading, setUploading] = useState(false);

  const toggle = (id) => {
    setSelected((s) => {
      const n = new Set(s);
      if (multiSelect) {
        if (n.has(id)) n.delete(id); else if (n.size < 4) n.add(id);
        else { toast.error("Maximum 4 photos per finding"); return n; }
      } else {
        n.clear(); n.add(id);
      }
      return n;
    });
  };

  const upload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0 || !dealId) return;
    setUploading(true);
    let lastUploaded = null;
    let ok = 0, failed = 0;
    for (const file of files) {
      try {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("album_name", "Assessment");
        const r = await api.post(`/projects/${dealId}/photos`, fd, { headers: { "Content-Type": "multipart/form-data" } });
        onUploaded(r.data);
        lastUploaded = r.data;
        ok += 1;
      } catch (err) {
        failed += 1;
        toast.error(`${file.name}: ${formatApiError(err?.response?.data?.detail) || err.message}`);
      }
    }
    // Auto-select the last uploaded photo (or the first in the batch when multi-select is off)
    if (lastUploaded) toggle(lastUploaded.id);
    if (ok > 0) toast.success(`${ok} photo${ok === 1 ? "" : "s"} uploaded${failed ? ` (${failed} failed)` : ""}`);
    setUploading(false);
    e.target.value = "";
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" data-testid="photo-picker-modal">
      <div className="bg-white max-w-4xl w-full max-h-[88vh] overflow-y-auto">
        <div className="px-5 py-3 border-b border-zinc-200 flex items-center justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-widest text-blue-700">Photo Picker</div>
            <div className="text-base font-black text-zinc-900">{multiSelect ? "Pick up to 4 photos" : "Pick aerial photo"}</div>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-900"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5">
          <div className="mb-4">
            <label className="inline-flex items-center gap-2 border border-blue-700 text-blue-700 px-3 py-2 text-xs font-bold uppercase tracking-wider hover:bg-blue-50 cursor-pointer rounded-sm">
              <Upload className="w-3.5 h-3.5" /> {uploading ? "Uploading..." : "Upload Photo(s)"}
              <input type="file" accept="image/*" multiple onChange={upload} className="hidden" data-testid="photo-upload" />
            </label>
            <span className="ml-3 text-xs text-zinc-500">{dealPhotos.length} photo{dealPhotos.length === 1 ? "" : "s"} in project library</span>
          </div>
          {dealPhotos.length === 0 ? (
            <div className="text-sm text-zinc-500 text-center py-8 border border-dashed border-zinc-300">
              No photos in this project yet. Upload one above to get started.
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-3">
              {dealPhotos.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => toggle(p.id)}
                  className={`relative border-2 transition-all ${
                    selected.has(p.id) ? "border-blue-700 ring-2 ring-blue-300" : "border-zinc-200 hover:border-blue-400"
                  }`}
                  data-testid={`pick-photo-${p.id}`}
                >
                  <PhotoThumb photo={p} />
                  {selected.has(p.id) && (
                    <div className="absolute top-1 right-1 bg-blue-700 text-white w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold">
                      ✓
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-zinc-200 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-xs font-bold uppercase tracking-wider border border-zinc-300 hover:border-zinc-500">Cancel</button>
          <button
            onClick={() => onPick([...selected])}
            className="px-4 py-2 text-xs font-bold uppercase tracking-wider bg-blue-700 text-white hover:bg-blue-800"
            data-testid="picker-confirm"
          >
            Use {selected.size} {multiSelect ? "Photos" : "Photo"}
          </button>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// Reusable bits
// =====================================================================
const inputCls = "w-full border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:border-blue-700 rounded-sm";

function SectionTitle({ children }) {
  return (
    <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-bronze-700 border-b border-zinc-200 pb-1.5 mt-2" style={{ color: "#A0703A" }}>
      {children}
    </div>
  );
}

function Field({ label, children, full }) {
  return (
    <div className={full ? "col-span-2" : ""}>
      <label className="block text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function Checkbox({ checked, onChange, label, testId }) {
  return (
    <label className="inline-flex items-center gap-2 cursor-pointer text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid={testId} className="rounded-sm" />
      <span>{label}</span>
    </label>
  );
}

function ScoreInput({ label, value, reasoning, onChangeScore, onChangeReasoning, testId }) {
  const color = value >= 80 ? "#16A34A" : value >= 60 ? "#D97706" : value >= 1 ? "#B91C1C" : "#A0A0A0";
  return (
    <div className="border border-zinc-200 p-3" data-testid={testId}>
      <div className="flex items-center gap-3 mb-2">
        <div className="text-sm font-bold flex-1">{label}</div>
        <input
          type="number"
          min="0"
          max="100"
          value={value}
          onChange={(e) => onChangeScore(Math.min(100, Math.max(0, parseInt(e.target.value) || 0)))}
          className="w-16 text-right border border-zinc-300 px-2 py-1 text-sm font-mono font-bold"
          data-testid={`${testId}-num`}
          style={{ color }}
        />
        <span className="text-xs text-zinc-400 font-mono">/100</span>
      </div>
      <input
        type="range"
        min="0"
        max="100"
        value={value}
        onChange={(e) => onChangeScore(parseInt(e.target.value))}
        className="w-full accent-blue-700"
        data-testid={`${testId}-slider`}
        style={{ accentColor: color }}
      />
      <input
        value={reasoning}
        onChange={(e) => onChangeReasoning(e.target.value)}
        placeholder="Reasoning (one short line)..."
        className="mt-2 w-full border border-zinc-200 px-2 py-1 text-xs focus:outline-none focus:border-blue-700"
        data-testid={`${testId}-reason`}
      />
    </div>
  );
}

function ListInput({ value, onChange, placeholder, testId }) {
  const [text, setText] = useState("");
  const items = value || [];
  return (
    <div className="space-y-1.5" data-testid={testId}>
      {items.map((it, i) => (
        <div key={i} className="flex items-center gap-2 group">
          <span className="text-zinc-400">•</span>
          <input
            value={it}
            onChange={(e) => { const n = [...items]; n[i] = e.target.value; onChange(n); }}
            className="flex-1 border border-zinc-200 px-2 py-1 text-sm focus:outline-none focus:border-blue-700"
            data-testid={`${testId}-item-${i}`}
          />
          <button
            type="button"
            onClick={() => onChange(items.filter((_, j) => j !== i))}
            className="text-zinc-400 hover:text-rose-700"
            data-testid={`${testId}-rm-${i}`}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <span className="text-zinc-300">+</span>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && text.trim()) {
              e.preventDefault();
              onChange([...items, text.trim()]);
              setText("");
            }
          }}
          placeholder={placeholder || "Type and press Enter to add..."}
          className="flex-1 border border-zinc-200 px-2 py-1 text-sm focus:outline-none focus:border-blue-700 italic"
          data-testid={`${testId}-add`}
        />
      </div>
    </div>
  );
}

// Textarea-backed list editor — one line per bullet. Stores List<string>.
// Use this for fields whose PDF renders as a single text box (Forecast outlooks,
// Action horizons, Positive/Negative Factors, Option pros/cons).
function LinesArea({ value, onChange, placeholder, rows = 3, testId }) {
  const items = Array.isArray(value) ? value : [];
  const text = items.join("\n");
  return (
    <textarea
      rows={rows}
      value={text}
      onChange={(e) => onChange(e.target.value.split("\n").map((s) => s).filter((s, i, arr) => !(s === "" && i === arr.length - 1)))}
      onBlur={(e) => onChange(e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))}
      placeholder={placeholder || "One item per line…"}
      className="w-full border border-zinc-200 px-2 py-1.5 text-sm focus:outline-none focus:border-blue-700"
      data-testid={testId}
    />
  );
}

// Date OR free-text "Unknown". Stores `""` (empty), `YYYY-MM-DD`, or `"Unknown"`.
function DateOrUnknown({ value, onChange, testId }) {
  const isUnknown = String(value || "").trim().toLowerCase() === "unknown";
  return (
    <div className="flex items-center gap-2">
      <input
        type="date"
        value={isUnknown ? "" : (value || "")}
        disabled={isUnknown}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 border border-zinc-200 px-2 py-1.5 text-sm focus:outline-none focus:border-blue-700 disabled:bg-zinc-50 disabled:text-zinc-400"
        data-testid={testId}
      />
      <label className="inline-flex items-center gap-1.5 text-xs text-zinc-600 select-none cursor-pointer">
        <input
          type="checkbox"
          checked={isUnknown}
          onChange={(e) => onChange(e.target.checked ? "Unknown" : "")}
          className="accent-blue-700"
          data-testid={`${testId}-unknown`}
        />
        Unknown
      </label>
    </div>
  );
}

// Year OR free-text "Unknown". Stores number, "Unknown", or null.
function YearOrUnknown({ value, onChange, testId }) {
  const isUnknown = typeof value === "string" && value.trim().toLowerCase() === "unknown";
  const num = isUnknown ? "" : (value ?? "");
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        min={1800}
        max={2100}
        value={num}
        disabled={isUnknown}
        onChange={(e) => onChange(e.target.value === "" ? null : parseInt(e.target.value))}
        className="flex-1 border border-zinc-200 px-2 py-1.5 text-sm focus:outline-none focus:border-blue-700 disabled:bg-zinc-50 disabled:text-zinc-400"
        data-testid={testId}
      />
      <label className="inline-flex items-center gap-1.5 text-xs text-zinc-600 select-none cursor-pointer">
        <input
          type="checkbox"
          checked={isUnknown}
          onChange={(e) => onChange(e.target.checked ? "Unknown" : null)}
          className="accent-blue-700"
          data-testid={`${testId}-unknown`}
        />
        Unknown
      </label>
    </div>
  );
}

function PhotoThumb({ photo, large }) {
  const token = localStorage.getItem("crm_token");
  const url = `${process.env.REACT_APP_BACKEND_URL}/api/projects/${photo.deal_id}/photos/${photo.id}/download?token_qs=${encodeURIComponent(token || "")}`;
  // The endpoint doesn't take token_qs; use img tag with crossOrigin won't work for auth headers.
  // Instead, fetch and create blob URL on mount.
  const [blobUrl, setBlobUrl] = React.useState("");
  React.useEffect(() => {
    let active = true;
    fetch(`${process.env.REACT_APP_BACKEND_URL}/api/projects/${photo.deal_id}/photos/${photo.id}/download`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.ok ? r.blob() : null)
      .then((b) => { if (active && b) setBlobUrl(URL.createObjectURL(b)); })
      .catch(() => {});
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo.id]);
  const size = large ? "h-48" : "h-20 w-20";
  return (
    <div className={`${size} bg-zinc-100 overflow-hidden flex items-center justify-center`}>
      {blobUrl ? (
        <img src={blobUrl} alt={photo.display_name || ""} className="object-cover w-full h-full" />
      ) : (
        <ImageIcon className="w-5 h-5 text-zinc-400" />
      )}
    </div>
  );
}
