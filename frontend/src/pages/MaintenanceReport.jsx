import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, API, formatApiError } from "@/lib/api";
import { toast } from "sonner";
import { ArrowLeft, Upload, Save, FileText, Trash2, Sparkles, GripVertical, Star, StarOff, Loader2, Mail, Receipt, Copy } from "lucide-react";

const SERVICE_LIFE_OPTIONS = ["15-20 Years", "10-15 Years", "5-10 Years", "3-5 Years", "1-3 Years", "<1 Year"];

/**
 * Annual Maintenance Report Editor
 *
 * Route: /maintenance/report/:dealId/:visitId
 *
 * A single-page editor that lets a rep dial in every piece of the STBS
 * Annual Maintenance Report before generating the PDF:
 *   - Building contact snapshot (auto-filled, editable)
 *   - Summary narrative (free-text)
 *   - Roof Estimated Service Life (single-select, 6 chips)
 *   - Photos split into "Before Maintenance" / "After Maintenance" panels
 *     - Upload directly into this visit (file input)
 *     - Reassign role (Before ↔ After) via a dropdown
 *     - Per-photo Observation + Notes textareas
 *     - "AI Describe" button (Claude Vision) for auto-drafting text
 *     - Star icon = "hero" photo (used on Building Information page)
 *     - Delete
 *   - "Generate Report PDF" button → opens the STBS PDF in a new tab
 *
 * All edits save through debounced PATCH calls so the rep can just
 * type and move on. No manual save buttons except for the top-level
 * Save-to-Deal button which forces a flush.
 */
export default function MaintenanceReport() {
  const { dealId, visitId } = useParams();
  const navigate = useNavigate();
  const [deal, setDeal] = useState(null);
  const [visit, setVisit] = useState(null);
  const [property, setProperty] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);
  const [uploadRole, setUploadRole] = useState("before");
  // Modal state for Phase 2 flows
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false);

  // ── Loaders ──────────────────────────────────────────────────────────
  const loadEverything = useCallback(async () => {
    setLoading(true);
    try {
      const dr = await api.get(`/deals/${dealId}`);
      setDeal(dr.data);
      const v = (dr.data.maintenance_visits || []).find((x) => x.id === visitId);
      if (!v) {
        toast.error("Maintenance visit not found");
        navigate("/maintenance");
        return;
      }
      setVisit(v);
      if (dr.data.property_id) {
        try {
          const pr = await api.get(`/properties/${dr.data.property_id}`);
          setProperty(pr.data);
        } catch { setProperty(null); }
      }
      const pr = await api.get(`/projects/${dealId}/maintenance-photos`, { params: { visit_id: visitId } });
      setPhotos(pr.data || []);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setLoading(false);
    }
  }, [dealId, visitId, navigate]);
  useEffect(() => { loadEverything(); }, [loadEverything]);

  // ── Auto-save visit fields (debounced) ───────────────────────────────
  const saveTimer = useRef(null);
  const patchVisit = useCallback((patch) => {
    setVisit((cur) => ({ ...cur, ...patch }));
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await api.patch(`/deals/${dealId}/maintenance-visits/${visitId}`, patch);
      } catch (e) {
        toast.error("Save failed: " + (formatApiError(e?.response?.data?.detail) || e.message));
      }
    }, 500);
  }, [dealId, visitId]);

  // Pre-fill contact snapshot from the deal's customer contact on first render
  // if the visit hasn't captured its own snapshot yet. Runs once per visit load.
  const seededContact = useRef(false);
  useEffect(() => {
    if (!visit || !deal || seededContact.current) return;
    if (!visit.building_contact_name && !visit.building_contact_phone && !visit.building_contact_email) {
      const seed = {
        building_contact_name: deal.customer_contact_name || deal.primary_contact_name || "",
        building_contact_phone: deal.customer_contact_phone || deal.primary_contact_phone || "",
        building_contact_email: deal.customer_contact_email || deal.primary_contact_email || "",
      };
      if (seed.building_contact_name || seed.building_contact_phone || seed.building_contact_email) {
        patchVisit(seed);
      }
    }
    seededContact.current = true;
  }, [visit, deal, patchVisit]);

  // ── Photo actions ────────────────────────────────────────────────────
  const uploadFiles = async (files) => {
    if (!files?.length) return;
    setUploading(true);
    let ok = 0;
    for (const f of files) {
      try {
        const fd = new FormData();
        fd.append("file", f);
        fd.append("album_name", "Maintenance");
        fd.append("maintenance_visit_id", visitId);
        fd.append("maint_role", uploadRole);
        await fetch(`${API}/projects/${dealId}/photos?deal_id=${dealId}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${localStorage.getItem("crm_token")}` },
          body: fd,
        }).then(async (r) => { if (!r.ok) throw new Error(await r.text()); return r.json(); });
        ok += 1;
      } catch (e) {
        toast.error(`Upload failed for ${f.name}: ${e.message}`);
      }
    }
    setUploading(false);
    if (ok) toast.success(`${ok} photo${ok === 1 ? "" : "s"} uploaded to ${uploadRole === "before" ? "Before" : "After"}`);
    loadEverything();
  };

  const patchPhoto = async (photoId, patch) => {
    // Optimistic update — no spinner needed since typing feels instant
    setPhotos((cur) => cur.map((p) => (p.id === photoId ? { ...p, ...patch } : p)));
    try {
      await api.patch(`/projects/${dealId}/photos/${photoId}`, patch);
    } catch (e) {
      toast.error("Photo save failed: " + (formatApiError(e?.response?.data?.detail) || e.message));
    }
  };

  const deletePhoto = async (photoId) => {
    if (!window.confirm("Delete this photo from the maintenance report?")) return;
    try {
      await api.delete(`/projects/${dealId}/photos/${photoId}`);
      setPhotos((cur) => cur.filter((p) => p.id !== photoId));
      toast.success("Photo deleted");
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    }
  };

  const aiDescribe = async (photoId, role) => {
    const t = toast.loading("Claude Vision is drafting Observation + Notes…");
    try {
      const r = await api.post(`/projects/${dealId}/photos/ai-describe`, {
        photo_ids: [photoId], role, overwrite: true,
      });
      const result = r.data.results?.[0];
      if (result?.observation || result?.notes) {
        setPhotos((cur) => cur.map((p) => (p.id === photoId ? { ...p, observation: result.observation, maint_notes: result.notes } : p)));
        toast.success("AI draft ready — review + edit as needed", { id: t });
      } else {
        toast.warning("AI could not confidently describe this photo — write it manually.", { id: t });
      }
    } catch (e) {
      toast.error("AI describe failed: " + (formatApiError(e?.response?.data?.detail) || e.message), { id: t });
    }
  };

  const setHero = async (photoId) => {
    patchVisit({ hero_photo_id: photoId });
    toast.success("Hero photo set for the Building Information page");
  };

  // ── Derived ──────────────────────────────────────────────────────────
  const beforePhotos = useMemo(() => photos.filter((p) => p.maint_role === "before"), [photos]);
  const afterPhotos = useMemo(() => photos.filter((p) => p.maint_role === "after"), [photos]);

  const openPdf = () => {
    const url = `${API}/deals/${dealId}/maintenance-visits/${visitId}/report.pdf?token=${encodeURIComponent(localStorage.getItem("crm_token") || "")}`;
    window.open(url, "_blank");
  };

  /**
   * Copy summary + service-life estimate + contact snapshot from the
   * prior year's visit into this one. Server-side check ensures we only
   * fill fields that are currently blank so the rep doesn't lose edits.
   */
  const copyFromPrior = async () => {
    try {
      const r = await api.post(`/deals/${dealId}/maintenance-visits/${visitId}/copy-from-prior`);
      const filled = r.data?.filled || {};
      const priorDate = r.data?.prior_visit_date || "prior visit";
      if (Object.keys(filled).length === 0) {
        toast.info(`Nothing to copy from ${priorDate} — all target fields already filled.`);
        return;
      }
      setVisit((cur) => ({ ...cur, ...filled }));
      toast.success(`Copied ${Object.keys(filled).length} field${Object.keys(filled).length === 1 ? "" : "s"} from ${priorDate} visit`);
    } catch (e) {
      const msg = formatApiError(e?.response?.data?.detail) || e.message;
      toast.warning(msg);
    }
  };

  if (loading) return <div className="p-10 text-center text-zinc-500"><Loader2 className="w-5 h-5 animate-spin inline mr-2" /> Loading report…</div>;
  if (!visit) return null;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6" data-testid="maintenance-report-editor">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Link to="/maintenance" className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500 hover:text-zinc-900 mb-2" data-testid="back-to-maint">
            <ArrowLeft className="w-3 h-3" /> Back to Maintenance
          </Link>
          <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-blue-700 mb-1">Annual Maintenance Report</div>
          <h1 className="font-heading text-3xl font-black tracking-tight">{deal?.title}</h1>
          <div className="text-xs text-zinc-500 mt-1">Visit Date: <span className="font-mono font-bold text-zinc-900">{visit.visit_date}</span></div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={copyFromPrior}
            data-testid="mr-copy-prior"
            title="Fill blank fields from the previous year's visit — saves you from retyping context that carries over."
            className="inline-flex items-center gap-1 px-3 h-10 text-[10px] font-bold uppercase tracking-wider border border-zinc-300 text-zinc-700 hover:border-zinc-950 rounded-sm"
          >
            <Copy className="w-3.5 h-3.5" /> Copy from Prior Visit
          </button>
          <button
            onClick={() => setInvoiceModalOpen(true)}
            data-testid="mr-open-invoice-modal"
            className="inline-flex items-center gap-1 px-3 h-10 text-[10px] font-bold uppercase tracking-wider bg-white border border-emerald-700 text-emerald-700 hover:bg-emerald-50 rounded-sm"
          >
            <Receipt className="w-3.5 h-3.5" /> Draft Invoice
          </button>
          <button
            onClick={() => setEmailModalOpen(true)}
            data-testid="mr-open-email-modal"
            className="inline-flex items-center gap-1 px-3 h-10 text-[10px] font-bold uppercase tracking-wider bg-blue-700 text-white hover:bg-blue-800 rounded-sm"
          >
            <Mail className="w-3.5 h-3.5" /> Email Report
          </button>
          <button
            onClick={openPdf}
            data-testid="generate-report-pdf"
            className="inline-flex items-center gap-2 bg-zinc-950 text-white px-3 h-10 text-[10px] font-bold uppercase tracking-wider hover:bg-blue-800 rounded-sm"
          >
            <FileText className="w-3.5 h-3.5" /> Preview PDF
          </button>
        </div>
      </div>

      {/* Building Information */}
      <section className="border border-zinc-200 rounded-sm bg-white p-5">
        <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 mb-3">Building Information</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Building Contact">
            <input type="text" data-testid="mr-contact-name" value={visit.building_contact_name || ""} onChange={(e) => patchVisit({ building_contact_name: e.target.value })} className="w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm" />
          </Field>
          <Field label="Contact Phone">
            <input type="tel" data-testid="mr-contact-phone" value={visit.building_contact_phone || ""} onChange={(e) => patchVisit({ building_contact_phone: e.target.value })} className="w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm font-mono" />
          </Field>
          <Field label="Contact Email">
            <input type="email" data-testid="mr-contact-email" value={visit.building_contact_email || ""} onChange={(e) => patchVisit({ building_contact_email: e.target.value })} className="w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm font-mono" />
          </Field>
          <Field label="Building Address (from Property record)">
            <div className="h-9 px-2 border border-dashed border-zinc-300 rounded-sm text-sm flex items-center text-zinc-600 bg-zinc-50">
              {property ? [property.address_line_1, property.city, property.state, property.zip_code].filter(Boolean).join(", ") : "(No property linked to this deal)"}
            </div>
          </Field>
        </div>
      </section>

      {/* Upload strip */}
      <section className="border border-blue-300 rounded-sm bg-blue-50/40 p-4 flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-700 mb-1">Upload Photos for This Visit</div>
          <div className="text-xs text-zinc-600">Photos are stored separately from the deal&apos;s other photos — filed under this maintenance visit ({visit.visit_date?.slice(0, 4) || "year"}).</div>
        </div>
        <select value={uploadRole} onChange={(e) => setUploadRole(e.target.value)} className="h-9 px-2 border border-zinc-300 rounded-sm text-sm bg-white" data-testid="upload-role">
          <option value="before">Before Maintenance</option>
          <option value="after">After Maintenance</option>
        </select>
        <input ref={fileInputRef} type="file" accept="image/*" multiple hidden onChange={(e) => uploadFiles(Array.from(e.target.files || []))} data-testid="mr-file-input" />
        <button onClick={() => fileInputRef.current?.click()} disabled={uploading} className="inline-flex items-center gap-2 bg-blue-700 text-white px-4 h-9 text-xs font-bold uppercase tracking-wider hover:bg-blue-800 rounded-sm disabled:opacity-50" data-testid="mr-upload-btn">
          <Upload className="w-3.5 h-3.5" /> {uploading ? "Uploading…" : `Upload to ${uploadRole === "before" ? "Before" : "After"}`}
        </button>
      </section>

      {/* Before Panel */}
      <PhotoPanel
        title="Maintenance Before"
        photos={beforePhotos}
        role="before"
        heroId={visit.hero_photo_id}
        onPatch={patchPhoto}
        onDelete={deletePhoto}
        onAiDescribe={aiDescribe}
        onSetHero={setHero}
      />

      {/* After Panel */}
      <PhotoPanel
        title="Maintenance After"
        photos={afterPhotos}
        role="after"
        heroId={visit.hero_photo_id}
        onPatch={patchPhoto}
        onDelete={deletePhoto}
        onAiDescribe={aiDescribe}
        onSetHero={setHero}
      />

      {/* Summary + Service Life */}
      <section className="border border-zinc-200 rounded-sm bg-white p-5 space-y-5" data-testid="mr-summary-section">
        <div>
          <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 mb-2">Summary</h2>
          <textarea
            rows={8}
            data-testid="mr-summary-text"
            value={visit.summary_text || ""}
            onChange={(e) => patchVisit({ summary_text: e.target.value })}
            placeholder="Overall write-up for the client. Separate paragraphs with a blank line."
            className="w-full px-3 py-2 border border-zinc-300 rounded-sm text-sm leading-relaxed"
          />
          <div className="text-[10px] text-zinc-500 mt-1">Saves automatically as you type.</div>
        </div>

        <div>
          <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 mb-3">Roof Estimated Service Life</h2>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            {SERVICE_LIFE_OPTIONS.map((opt, i) => {
              const active = visit.service_life_estimate === opt;
              const tones = [
                "bg-emerald-700 text-white border-emerald-700",
                "bg-lime-600 text-white border-lime-600",
                "bg-amber-500 text-white border-amber-500",
                "bg-orange-500 text-white border-orange-500",
                "bg-red-600 text-white border-red-600",
                "bg-red-900 text-white border-red-900",
              ];
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => patchVisit({ service_life_estimate: active ? null : opt })}
                  data-testid={`svl-${opt.replace(/[^a-z0-9]/gi, "").toLowerCase()}`}
                  className={`h-11 text-xs font-bold uppercase tracking-wider rounded-sm border transition-colors ${active ? tones[i] : "bg-white border-zinc-300 text-zinc-600 hover:border-zinc-500"}`}
                >
                  {opt}
                </button>
              );
            })}
          </div>
          <div className="text-[10px] text-zinc-500 mt-1">Single-select. Click the active option again to clear.</div>
        </div>
      </section>

      {emailModalOpen && (
        <EmailReportModal
          dealId={dealId}
          visitId={visitId}
          visit={visit}
          deal={deal}
          onClose={() => setEmailModalOpen(false)}
          onSent={(sentInfo) => {
            setEmailModalOpen(false);
            setVisit((cur) => ({ ...cur, report_sent_at: new Date().toISOString(), report_sent_to: sentInfo.to }));
          }}
        />
      )}
      {invoiceModalOpen && (
        <InvoiceReviewModal
          dealId={dealId}
          visitId={visitId}
          visit={visit}
          deal={deal}
          onClose={() => setInvoiceModalOpen(false)}
        />
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-500 block mb-1">{label}</label>
      {children}
    </div>
  );
}

function PhotoPanel({ title, photos, role, heroId, onPatch, onDelete, onAiDescribe, onSetHero }) {
  return (
    <section className="border border-zinc-200 rounded-sm bg-white" data-testid={`mr-panel-${role}`}>
      <div className="px-5 py-3 border-b border-zinc-200 flex items-center gap-2">
        <h2 className="font-heading text-lg font-black tracking-tight">{title}</h2>
        <span className="text-[10px] font-bold uppercase tracking-wider bg-zinc-100 px-2 py-0.5 rounded-sm text-zinc-600">{photos.length} photo{photos.length === 1 ? "" : "s"}</span>
      </div>
      {photos.length === 0 ? (
        <div className="p-10 text-center text-sm text-zinc-500">No {role} photos yet — upload above with the &ldquo;{role === "before" ? "Before" : "After"} Maintenance&rdquo; role selected.</div>
      ) : (
        <div className="divide-y divide-zinc-100">
          {photos.map((p, idx) => (
            <PhotoRow
              key={p.id}
              photo={p}
              num={idx + 1}
              role={role}
              isHero={heroId === p.id}
              onPatch={onPatch}
              onDelete={onDelete}
              onAiDescribe={onAiDescribe}
              onSetHero={onSetHero}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function PhotoRow({ photo, num, role, isHero, onPatch, onDelete, onAiDescribe, onSetHero }) {
  // Debounce text-field patches so we don't PATCH on every keystroke.
  const [obs, setObs] = useState(photo.observation || "");
  const [notes, setNotes] = useState(photo.maint_notes || "");
  useEffect(() => { setObs(photo.observation || ""); }, [photo.observation]);
  useEffect(() => { setNotes(photo.maint_notes || ""); }, [photo.maint_notes]);
  const obsT = useRef(null);
  const notesT = useRef(null);
  const commitObs = (val) => {
    setObs(val);
    if (obsT.current) clearTimeout(obsT.current);
    obsT.current = setTimeout(() => onPatch(photo.id, { observation: val }), 600);
  };
  const commitNotes = (val) => {
    setNotes(val);
    if (notesT.current) clearTimeout(notesT.current);
    notesT.current = setTimeout(() => onPatch(photo.id, { maint_notes: val }), 600);
  };
  const swapRole = () => onPatch(photo.id, { maint_role: role === "before" ? "after" : "before" });

  return (
    <div className="p-4 grid grid-cols-1 md:grid-cols-[80px_240px_1fr_auto] gap-4 items-start" data-testid={`mr-photo-${photo.id}`}>
      <div className="text-center">
        <div className="font-heading text-2xl font-black text-blue-800">{num}</div>
        <button type="button" onClick={() => onSetHero(photo.id)} title={isHero ? "This is the hero photo" : "Use as hero photo (Building Information page)"} className={`inline-flex items-center gap-1 mt-2 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded-sm ${isHero ? "bg-amber-500 text-white" : "text-zinc-400 hover:text-amber-500"}`} data-testid={`mr-hero-${photo.id}`}>
          {isHero ? <Star className="w-3 h-3 fill-current" /> : <StarOff className="w-3 h-3" />}
          {isHero ? "Hero" : "Set Hero"}
        </button>
      </div>
      <div>
        <img src={photo.thumbnail_url || photo.display_url || `${API}/projects/${photo.deal_id}/photos/${photo.id}/file?token=${encodeURIComponent(localStorage.getItem("crm_token") || "")}`} alt="" className="w-full h-40 object-cover border border-zinc-200 rounded-sm" />
        <div className="text-[10px] text-zinc-500 mt-1 truncate" title={photo.display_name}>{photo.display_name || photo.original_filename || "Photo"}</div>
      </div>
      <div className="space-y-2">
        <div>
          <label className="text-[9px] font-bold uppercase tracking-[0.15em] text-blue-700 block mb-0.5">Observation</label>
          <textarea rows={2} value={obs} onChange={(e) => commitObs(e.target.value)} placeholder="What did you see?" className="w-full px-2 py-1.5 border border-zinc-300 rounded-sm text-sm leading-tight" data-testid={`mr-obs-${photo.id}`} />
        </div>
        <div>
          <label className="text-[9px] font-bold uppercase tracking-[0.15em] text-blue-700 block mb-0.5">Notes</label>
          <textarea rows={2} value={notes} onChange={(e) => commitNotes(e.target.value)} placeholder="Context, recommendation, or repair note" className="w-full px-2 py-1.5 border border-zinc-300 rounded-sm text-sm leading-tight" data-testid={`mr-notes-${photo.id}`} />
        </div>
      </div>
      <div className="flex flex-col gap-1.5 items-stretch min-w-[110px]">
        <button type="button" onClick={() => onAiDescribe(photo.id, role)} className="inline-flex items-center justify-center gap-1 h-8 px-2 text-[10px] font-bold uppercase tracking-wider bg-white border border-violet-700 text-violet-700 hover:bg-violet-50 rounded-sm" data-testid={`mr-ai-${photo.id}`}>
          <Sparkles className="w-3 h-3" /> AI Describe
        </button>
        <button type="button" onClick={swapRole} className="inline-flex items-center justify-center gap-1 h-8 px-2 text-[10px] font-bold uppercase tracking-wider bg-white border border-zinc-300 text-zinc-700 hover:border-zinc-500 rounded-sm" data-testid={`mr-swap-${photo.id}`}>
          <GripVertical className="w-3 h-3" /> Move to {role === "before" ? "After" : "Before"}
        </button>
        <button type="button" onClick={() => onDelete(photo.id)} className="inline-flex items-center justify-center gap-1 h-8 px-2 text-[10px] font-bold uppercase tracking-wider bg-white border border-rose-300 text-rose-700 hover:bg-rose-50 rounded-sm" data-testid={`mr-delete-${photo.id}`}>
          <Trash2 className="w-3 h-3" /> Delete
        </button>
      </div>
    </div>
  );
}

// ─── Email Report Preview Modal ─────────────────────────────────────
function EmailReportModal({ dealId, visitId, visit, deal, onClose, onSent }) {
  const defaultSubject = `Annual Maintenance Report — ${deal?.title || "your property"} — ${(visit?.visit_date || "").slice(0, 4)}`;
  const defaultMessage = `Attached is your Annual Maintenance Report for ${deal?.title || "your property"}, documenting the site visit on ${visit?.visit_date}. The report walks through the before/after condition of the roof, includes our observations and notes for each area serviced, and closes with our estimated service life for the current system.`;
  const [to, setTo] = useState(visit?.building_contact_email || "");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("maintenance@sealtechsolutions.co");
  const [subject, setSubject] = useState(defaultSubject);
  const [message, setMessage] = useState(defaultMessage);
  const [sending, setSending] = useState(false);

  const previewPdf = () => {
    const url = `${API}/deals/${dealId}/maintenance-visits/${visitId}/report.pdf?token=${encodeURIComponent(localStorage.getItem("crm_token") || "")}`;
    window.open(url, "_blank");
  };

  const send = async () => {
    if (!to.trim()) { toast.error("Recipient email required"); return; }
    setSending(true);
    try {
      const r = await api.post(`/deals/${dealId}/maintenance-visits/${visitId}/email`, {
        to_email: to.trim(), cc_email: cc.trim(), bcc_email: bcc.trim(),
        subject: subject.trim(), message: message.trim(),
      });
      toast.success(`Report emailed to ${r.data.to}${r.data.bcc ? ` (BCC ${r.data.bcc})` : ""}`);
      onSent({ to: r.data.to });
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-zinc-950/60 flex items-center justify-center p-4" onClick={onClose} data-testid="email-report-modal">
      <div className="bg-white w-full max-w-2xl rounded-sm shadow-xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-zinc-200">
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-700">Email Annual Maintenance Report</div>
          <div className="font-heading text-xl font-black tracking-tight mt-1">{deal?.title}</div>
          <div className="text-xs text-zinc-500 mt-0.5">Visit: {visit?.visit_date}</div>
        </div>
        <div className="p-5 space-y-3">
          <Field label="To">
            <input type="email" data-testid="email-to" value={to} onChange={(e) => setTo(e.target.value)} className="w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm font-mono" />
          </Field>
          <Field label="CC (optional)">
            <input type="email" data-testid="email-cc" value={cc} onChange={(e) => setCc(e.target.value)} className="w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm font-mono" placeholder="Additional recipient" />
          </Field>
          <Field label="BCC (defaults to maintenance@ — every report is archived here)">
            <input type="email" data-testid="email-bcc" value={bcc} onChange={(e) => setBcc(e.target.value)} className="w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm font-mono" />
          </Field>
          <Field label="Subject">
            <input type="text" data-testid="email-subject" value={subject} onChange={(e) => setSubject(e.target.value)} className="w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm" />
          </Field>
          <Field label="Message">
            <textarea rows={6} data-testid="email-message" value={message} onChange={(e) => setMessage(e.target.value)} className="w-full px-2 py-2 border border-zinc-300 rounded-sm text-sm leading-relaxed" />
          </Field>
          <div className="text-[10px] text-zinc-500">
            The freshly-generated PDF will be attached automatically as <span className="font-mono">{`${(deal?.title || "Project").slice(0, 50)} - Annual Maintenance ${(visit?.visit_date || "").slice(0, 4)}.pdf`}</span>
          </div>
        </div>
        <div className="px-5 py-4 border-t border-zinc-200 flex justify-between items-center gap-2 flex-wrap">
          <button onClick={previewPdf} data-testid="email-preview-pdf" className="inline-flex items-center gap-1 px-3 h-9 text-[10px] font-bold uppercase tracking-wider border border-zinc-300 text-zinc-700 hover:border-zinc-950 rounded-sm">
            <FileText className="w-3.5 h-3.5" /> Preview PDF
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 h-9 text-xs font-bold uppercase tracking-wider border border-zinc-300 text-zinc-700 hover:border-zinc-950 rounded-sm" data-testid="email-cancel">Cancel</button>
            <button onClick={send} disabled={sending} data-testid="email-send" className="inline-flex items-center gap-1 px-4 h-9 text-xs font-bold uppercase tracking-wider bg-blue-700 text-white hover:bg-blue-800 rounded-sm disabled:opacity-50">
              <Mail className="w-3.5 h-3.5" /> {sending ? "Sending…" : "Send"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Invoice Review Modal ───────────────────────────────────────────
function InvoiceReviewModal({ dealId, visitId, visit, deal, onClose }) {
  const [amount, setAmount] = useState(visit?.amount || deal?.maintenance_rate || 0);
  const [saving, setSaving] = useState(false);
  const [invoice, setInvoice] = useState(null);            // populated after draft is created
  const create = async () => {
    setSaving(true);
    try {
      // Update the visit's amount to match the reviewed number, then draft the invoice
      if (Number(amount || 0) !== Number(visit?.amount || 0)) {
        await api.patch(`/deals/${dealId}/maintenance-visits/${visitId}`, { amount: Number(amount || 0) });
      }
      const r = await api.post("/invoices/from-maintenance-visit", { deal_id: dealId, visit_id: visitId });
      setInvoice(r.data);
      toast.success(`Draft invoice ${r.data.invoice_number} created`);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="fixed inset-0 z-50 bg-zinc-950/60 flex items-center justify-center p-4" onClick={onClose} data-testid="invoice-review-modal">
      <div className="bg-white w-full max-w-md rounded-sm shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-zinc-200">
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-700">Draft Invoice for This Visit</div>
          <div className="font-heading text-xl font-black tracking-tight mt-1">{deal?.title}</div>
          <div className="text-xs text-zinc-500 mt-0.5">{visit?.visit_date} · Review before creating</div>
        </div>
        <div className="p-5 space-y-4">
          {!invoice ? (
            <>
              <Field label="Invoice Amount ($)">
                <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="invoice-amount" className="w-full h-10 px-2 border border-zinc-300 rounded-sm text-sm font-mono" autoFocus />
              </Field>
              <div className="text-[10px] text-zinc-500">
                A draft invoice will be created and can be edited from the Invoices page before sending. Nothing is emailed at this step.
              </div>
              <div className="border border-zinc-200 rounded-sm p-3 bg-zinc-50 text-xs space-y-1">
                <div><span className="text-zinc-500">Deal:</span> <span className="font-bold">{deal?.title}</span></div>
                <div><span className="text-zinc-500">Visit Date:</span> <span className="font-mono">{visit?.visit_date}</span></div>
                <div><span className="text-zinc-500">Amount:</span> <span className="font-mono font-bold text-emerald-700">${Number(amount || 0).toLocaleString()}</span></div>
              </div>
            </>
          ) : (
            <div className="space-y-2">
              <div className="text-sm">
                Draft <b>{invoice.invoice_number}</b> created for <b>${Number(invoice.amount || 0).toLocaleString()}</b>.
              </div>
              <a href="/invoices" className="inline-flex items-center gap-1 px-3 h-9 text-[10px] font-bold uppercase tracking-wider bg-emerald-700 text-white hover:bg-emerald-800 rounded-sm">
                <Receipt className="w-3.5 h-3.5" /> Open Invoices
              </a>
            </div>
          )}
        </div>
        <div className="px-5 py-4 border-t border-zinc-200 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 h-9 text-xs font-bold uppercase tracking-wider border border-zinc-300 text-zinc-700 hover:border-zinc-950 rounded-sm" data-testid="invoice-cancel">{invoice ? "Close" : "Cancel"}</button>
          {!invoice && (
            <button onClick={create} disabled={saving || !Number(amount)} data-testid="invoice-create" className="inline-flex items-center gap-1 px-4 h-9 text-xs font-bold uppercase tracking-wider bg-emerald-700 text-white hover:bg-emerald-800 rounded-sm disabled:opacity-50">
              <Receipt className="w-3.5 h-3.5" /> {saving ? "Creating…" : "Create Draft"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
