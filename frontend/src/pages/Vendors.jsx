import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatApiError, formatCurrency } from "@/lib/api";
import { Plus, Pencil, Trash2, Truck, HardHat, FolderOpen, BarChart3, Star, ClipboardList, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Modal, Field, Grid2, Input, Select, Th } from "@/pages/Contacts";
import { ExportButtons, ImportButton } from "@/components/ExportImport";
import Documents from "@/components/Documents";
import { US_STATES, DEFAULT_STATE } from "@/constants/states";
import ConfirmDialog from "@/components/ConfirmDialog";
import { formatPhoneDisplay, maskTaxIdInput } from "@/lib/format";
import CameraCaptureButton from "@/components/CameraCaptureButton";

export default function Vendors({ kind = "Vendor" }) {
  const isSub = kind === "Subcontractor";
  const empty = { name: "", kind, category: isSub ? "Subcontractor" : "Material Supplier", contact_name: "", contact_title: "", website: "", phone: "", work_phone: "", mobile_phone: "", fax: "", email: "", tin_ein: "", address: "", address_line2: "", city: "", state: DEFAULT_STATE, zip_code: "", notes: "", gl_coi_on_file: false, gl_coi_issued_date: "", gl_coi_expiry_date: "", wc_coi_on_file: false, wc_coi_issued_date: "", wc_coi_expiry_date: "" };

  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);
  const [loading, setLoading] = useState(false);
  const [docsFor, setDocsFor] = useState(null);
  const [confirmTarget, setConfirmTarget] = useState(null);
  const [scorecardsOpen, setScorecardsOpen] = useState(false);

  const load = () => api.get(`/vendors?kind=${encodeURIComponent(kind)}`).then((r) => setItems(r.data));
  useEffect(() => {
    setForm(empty);
    load();
    api.get("/options").then((r) => setCategories(r.data.vendor_categories));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  const openCreate = () => { setEditing(null); setForm(empty); setOpen(true); };
  const openEdit = (v) => { setEditing(v); setForm({ ...empty, ...v }); setOpen(true); };

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const payload = { ...form, kind };
      if (editing) {
        await api.put(`/vendors/${editing.id}`, payload);
        toast.success(`${kind} updated`);
      } else {
        await api.post(`/vendors`, payload);
        toast.success(`${kind} created`);
      }
      setOpen(false);
      load();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setLoading(false);
    }
  };

  const remove = (v) => setConfirmTarget(v);

  const uploadCoi = async (files, vendorName) => {
    // Push the captured COI image(s) into the central Library under Insurance/COI
    // so it's searchable, expirable, and shareable. Vendor's checkbox + expiry date
    // remain the source of truth for the COI Roster status.
    if (!files || !files.length) return;
    let ok = 0, failed = 0;
    for (const file of Array.from(files)) {
      try {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("category", "Insurance");
        fd.append("subcategory", "COI");
        fd.append("display_name", `COI — ${vendorName || "Vendor"} — ${new Date().toISOString().slice(0,10)}`);
        fd.append("description", `Captured via mobile camera for ${vendorName || "vendor"}`);
        await api.post("/library", fd, { headers: { "Content-Type": "multipart/form-data" } });
        ok++;
      } catch (e) {
        failed++;
      }
    }
    if (ok) toast.success(`${ok} COI file${ok === 1 ? "" : "s"} uploaded to Library`);
    if (failed) toast.error(`${failed} upload${failed === 1 ? "" : "s"} failed`);
  };

  const removeConfirmed = async () => {
    if (!confirmTarget) return;
    try {
      await api.delete(`/vendors/${confirmTarget.id}`);
      toast.success(`${kind} deleted`);
      load();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setConfirmTarget(null);
    }
  };

  const Icon = isSub ? HardHat : Truck;
  const heading = isSub ? "Subcontractors" : "Vendors";
  const subtitle = isSub ? "Trade Partners & Crews" : "Material Suppliers";
  const eyebrow = isSub ? "Subcontractors" : "Vendors";

  return (
    <div className="p-6 sm:p-8 animate-in fade-in duration-500" data-testid={`${kind.toLowerCase()}s-page`}>
      <div className="flex items-end justify-between mb-8 pb-6 border-b border-zinc-200 gap-4 flex-wrap">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-700 mb-2">{eyebrow}</div>
          <h1 className="font-heading text-3xl sm:text-4xl font-black tracking-tight">{subtitle}</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <ExportButtons category={isSub ? "subcontractors" : "vendors"} />
          <ImportButton category={isSub ? "subcontractors" : "vendors"} onImported={load} />
          {isSub && (
            <button
              data-testid="open-scorecards-button"
              onClick={() => setScorecardsOpen(true)}
              className="inline-flex items-center gap-2 bg-white border border-zinc-300 text-zinc-950 px-4 h-10 text-xs font-bold uppercase tracking-wider hover:bg-zinc-50 rounded-sm transition-colors"
              title="Track on-time delivery + quality ratings + total $ awarded per crew"
            >
              <BarChart3 className="w-4 h-4" /> Scorecards
            </button>
          )}
          {isSub && (
            <Link
              to="/coi-reminders"
              data-testid="coi-reminders-link"
              className="inline-flex items-center gap-2 bg-white border border-blue-700 text-blue-700 px-4 h-10 text-xs font-bold uppercase tracking-wider hover:bg-blue-50 rounded-sm transition-colors"
              title="Annual Certificate of Insurance email reminder system"
            >
              <ShieldCheck className="w-4 h-4" /> COI Reminders
            </Link>
          )}
          <button
            data-testid={`new-${kind.toLowerCase()}-button`}
            onClick={openCreate}
            className="inline-flex items-center gap-2 bg-blue-700 text-white px-4 h-10 text-xs font-bold uppercase tracking-wider hover:bg-blue-800 rounded-sm transition-colors"
          >
            <Plus className="w-4 h-4" /> New {kind}
          </button>
        </div>
      </div>

      <div className="bg-white border border-zinc-200 rounded-sm overflow-x-auto">
        {items.length === 0 ? (
          <div className="p-12 text-center text-sm text-zinc-500 flex flex-col items-center gap-3">
            <Icon className="w-8 h-8 text-zinc-300" />
            <div>No {heading.toLowerCase()} yet.</div>
          </div>
        ) : (
          <table className="w-full text-sm" data-testid={`${kind.toLowerCase()}s-table`}>
            <thead>
              <tr className="border-b-2 border-zinc-950 text-left">
                <Th>Name</Th><Th>Category</Th><Th>Contact</Th><Th>Phone</Th><Th>Email</Th>{isSub && <Th>COI</Th>}<Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((v) => (
                <tr key={v.id} className="border-b border-zinc-100 hover:bg-zinc-50" data-testid={`${kind.toLowerCase()}-row-${v.id}`}>
                  <td className="px-6 py-3 font-bold text-zinc-950">
                    {v.name}
                    {v.website && (
                      <a href={v.website.startsWith("http") ? v.website : `https://${v.website}`} target="_blank" rel="noopener noreferrer" className="block text-[10px] font-normal text-blue-700 hover:underline mt-0.5" data-testid={`website-${v.id}`}>
                        🌐 {v.website.replace(/^https?:\/\//, "")}
                      </a>
                    )}
                  </td>
                  <td className="px-6 py-3 text-zinc-700 text-xs uppercase tracking-wider">{v.category}</td>
                  <td className="px-6 py-3 text-zinc-700 text-xs">
                    {v.contact_name || "—"}
                    {v.contact_title && <div className="text-[10px] text-zinc-500">{v.contact_title}</div>}
                  </td>
                  <td className="px-6 py-3 text-zinc-600 font-mono text-xs">{formatPhoneDisplay(v.mobile_phone || v.work_phone || v.phone)}</td>
                  <td className="px-6 py-3 text-zinc-600 text-xs">{v.email}</td>
                  {isSub && (
                    <td className="px-6 py-3"><CoiStatusPill form={v} /></td>
                  )}
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-1">
                      <button data-testid={`docs-${kind.toLowerCase()}-${v.id}`} onClick={() => setDocsFor(v)} title="Documents" className="p-1.5 hover:bg-zinc-200 rounded-sm"><FolderOpen className="w-3.5 h-3.5" /></button>
                      <button data-testid={`edit-${kind.toLowerCase()}-${v.id}`} onClick={() => openEdit(v)} className="p-1.5 hover:bg-zinc-200 rounded-sm"><Pencil className="w-3.5 h-3.5" /></button>
                      <button data-testid={`delete-${kind.toLowerCase()}-${v.id}`} onClick={() => remove(v)} className="p-1.5 hover:bg-red-100 text-red-700 rounded-sm"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {open && (
        <Modal title={editing ? `Edit ${kind}` : `New ${kind}`} onClose={() => setOpen(false)}>
          <form onSubmit={submit} className="space-y-4" data-testid={`${kind.toLowerCase()}-form`}>
            <Grid2>
              <Field label="Name *">
                <Input data-testid={`${kind.toLowerCase()}-name`} required value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
              </Field>
              <Field label="Category">
                <Select data-testid={`${kind.toLowerCase()}-category`} value={form.category} onChange={(v) => setForm({ ...form, category: v })} options={categories.length ? categories : ["Other"]} />
              </Field>
              <Field label="Contact Name">
                <Input data-testid={`${kind.toLowerCase()}-contact-name`} value={form.contact_name} onChange={(v) => setForm({ ...form, contact_name: v })} placeholder="Primary contact person" />
              </Field>
              <Field label="Contact Title">
                <Input data-testid={`${kind.toLowerCase()}-contact-title`} value={form.contact_title} onChange={(v) => setForm({ ...form, contact_title: v })} placeholder="e.g. Sales Rep, Account Mgr" />
              </Field>
              <Field label="Website / URL">
                <Input data-testid={`${kind.toLowerCase()}-website`} value={form.website} onChange={(v) => setForm({ ...form, website: v })} placeholder="https://vendor.com" />
              </Field>
              <Field label="Work Phone">
                <Input data-testid={`${kind.toLowerCase()}-work-phone`} format="phone" value={form.work_phone} onChange={(v) => setForm({ ...form, work_phone: v })} />
              </Field>
              <Field label="Mobile Phone">
                <Input data-testid={`${kind.toLowerCase()}-mobile-phone`} format="phone" value={form.mobile_phone} onChange={(v) => setForm({ ...form, mobile_phone: v })} />
              </Field>
              <Field label="Fax">
                <Input data-testid={`${kind.toLowerCase()}-fax`} format="phone" value={form.fax} onChange={(v) => setForm({ ...form, fax: v })} />
              </Field>
              <Field label="Other / Primary Phone">
                <Input data-testid={`${kind.toLowerCase()}-phone`} format="phone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
              </Field>
              <Field label="Email">
                <Input data-testid={`${kind.toLowerCase()}-email`} type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
              </Field>
              <Field label={form.tin_kind === "SSN" ? "TIN / SSN" : "TIN / EIN"}>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-3 text-[10px] font-bold uppercase tracking-widest text-zinc-600">
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input
                        type="radio"
                        name={`${kind.toLowerCase()}-tin-kind`}
                        checked={form.tin_kind !== "SSN"}
                        onChange={() => setForm({ ...form, tin_kind: "EIN", tin_ein: maskTaxIdInput(form.tin_ein, "EIN") })}
                        data-testid={`${kind.toLowerCase()}-tin-kind-ein`}
                      />
                      EIN
                    </label>
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input
                        type="radio"
                        name={`${kind.toLowerCase()}-tin-kind`}
                        checked={form.tin_kind === "SSN"}
                        onChange={() => setForm({ ...form, tin_kind: "SSN", tin_ein: maskTaxIdInput(form.tin_ein, "SSN") })}
                        data-testid={`${kind.toLowerCase()}-tin-kind-ssn`}
                      />
                      SSN
                    </label>
                  </div>
                  <Input
                    data-testid={`${kind.toLowerCase()}-tin`}
                    format={form.tin_kind === "SSN" ? "ssn" : "ein"}
                    value={form.tin_ein}
                    onChange={(v) => setForm({ ...form, tin_ein: v })}
                    placeholder={form.tin_kind === "SSN" ? "XXX-XX-XXXX" : "XX-XXXXXXX"}
                  />
                </div>
              </Field>
            </Grid2>
            <Field label="Address Line 1">
              <Input data-testid={`${kind.toLowerCase()}-address`} value={form.address} onChange={(v) => setForm({ ...form, address: v })} />
            </Field>
            <Field label="Address Line 2">
              <Input data-testid={`${kind.toLowerCase()}-address2`} value={form.address_line2} onChange={(v) => setForm({ ...form, address_line2: v })} />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-6 gap-4">
              <div className="sm:col-span-3">
                <Field label="City">
                  <Input data-testid={`${kind.toLowerCase()}-city`} value={form.city} onChange={(v) => setForm({ ...form, city: v })} />
                </Field>
              </div>
              <div className="sm:col-span-1">
                <Field label="State">
                  <Select data-testid={`${kind.toLowerCase()}-state`} value={form.state || DEFAULT_STATE} onChange={(v) => setForm({ ...form, state: v })} options={US_STATES} />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="ZIP">
                  <Input data-testid={`${kind.toLowerCase()}-zip`} value={form.zip_code} onChange={(v) => setForm({ ...form, zip_code: v })} />
                </Field>
              </div>
            </div>
            <div className="rounded-sm border border-zinc-200 bg-zinc-50 p-4 space-y-3" data-testid={`${kind.toLowerCase()}-coi-section`}>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <h3 className="text-xs font-bold uppercase tracking-widest text-blue-700">Certificates of Insurance (COI)</h3>
                <div className="flex items-center gap-2">
                  <CameraCaptureButton
                    onFiles={(files) => uploadCoi(files, form.name || "Vendor")}
                    testId={`${kind.toLowerCase()}-camera-coi-btn`}
                    label="Snap COI"
                  />
                  <CoiStatusPill form={form} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-[max-content_1fr_1fr] gap-3 items-end">
                <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-zinc-700 select-none pb-2">
                  <input
                    type="checkbox"
                    checked={!!form.gl_coi_on_file}
                    onChange={(e) => setForm({ ...form, gl_coi_on_file: e.target.checked })}
                    className="accent-blue-700"
                    data-testid={`${kind.toLowerCase()}-gl-coi-on-file`}
                  />
                  General Liability COI
                </label>
                <Field label="GL Issued">
                  <Input type="date" disabled={!form.gl_coi_on_file} value={form.gl_coi_issued_date} onChange={(v) => setForm({ ...form, gl_coi_issued_date: v })} data-testid={`${kind.toLowerCase()}-gl-coi-issued`} />
                </Field>
                <Field label="GL Expires">
                  <Input type="date" disabled={!form.gl_coi_on_file} value={form.gl_coi_expiry_date} onChange={(v) => setForm({ ...form, gl_coi_expiry_date: v })} data-testid={`${kind.toLowerCase()}-gl-coi-expiry`} />
                </Field>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-[max-content_1fr_1fr] gap-3 items-end">
                <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-zinc-700 select-none pb-2">
                  <input
                    type="checkbox"
                    checked={!!form.wc_coi_on_file}
                    onChange={(e) => setForm({ ...form, wc_coi_on_file: e.target.checked })}
                    className="accent-blue-700"
                    data-testid={`${kind.toLowerCase()}-wc-coi-on-file`}
                  />
                  Workers&apos; Comp COI
                </label>
                <Field label="WC Issued">
                  <Input type="date" disabled={!form.wc_coi_on_file} value={form.wc_coi_issued_date} onChange={(v) => setForm({ ...form, wc_coi_issued_date: v })} data-testid={`${kind.toLowerCase()}-wc-coi-issued`} />
                </Field>
                <Field label="WC Expires">
                  <Input type="date" disabled={!form.wc_coi_on_file} value={form.wc_coi_expiry_date} onChange={(v) => setForm({ ...form, wc_coi_expiry_date: v })} data-testid={`${kind.toLowerCase()}-wc-coi-expiry`} />
                </Field>
              </div>
            </div>
            <Field label="Notes">
              <textarea
                data-testid={`${kind.toLowerCase()}-notes`}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={3}
                className="w-full px-3 py-2 border border-zinc-300 bg-white rounded-sm focus:outline-none focus:ring-2 focus:ring-blue-700 text-sm"
              />
            </Field>
            <div className="flex justify-end gap-2 pt-4 border-t border-zinc-200">
              <button type="button" onClick={() => setOpen(false)} className="px-4 h-10 text-xs font-bold uppercase tracking-wider border border-zinc-300 rounded-sm hover:bg-zinc-50">Cancel</button>
              <button type="submit" disabled={loading} data-testid={`${kind.toLowerCase()}-save`} className="px-4 h-10 text-xs font-bold uppercase tracking-wider bg-blue-700 text-white hover:bg-blue-800 rounded-sm disabled:opacity-50">{loading ? "Saving..." : "Save"}</button>
            </div>
          </form>
        </Modal>
      )}

      {docsFor && (
        <Modal wide title={`Documents — ${docsFor.name}`} onClose={() => setDocsFor(null)}>
          <Documents parentType={isSub ? "subcontractor" : "vendor"} parentId={docsFor.id} title="Files" />
        </Modal>
      )}

      {scorecardsOpen && (
        <ScorecardsModal subs={items} onClose={() => setScorecardsOpen(false)} />
      )}
    </div>
  );
}


// ---------- COI Status helper ----------
// Returns one of: "ok" | "expiring" | "expired" | "missing"
// "expiring" = within 30 days of expiry; "expired" = past expiry date.
function coiStatus(form) {
  if (!form.gl_coi_on_file && !form.wc_coi_on_file) return "missing";
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const checkOne = (onFile, expiry) => {
    if (!onFile) return "missing";
    if (!expiry) return "missing";
    const d = new Date(expiry); if (isNaN(d.getTime())) return "missing";
    const diffDays = Math.floor((d - today) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return "expired";
    if (diffDays <= 30) return "expiring";
    return "ok";
  };
  const gl = form.gl_coi_on_file ? checkOne(form.gl_coi_on_file, form.gl_coi_expiry_date) : "missing";
  const wc = form.wc_coi_on_file ? checkOne(form.wc_coi_on_file, form.wc_coi_expiry_date) : "missing";
  if (gl === "expired" || wc === "expired") return "expired";
  if (gl === "expiring" || wc === "expiring") return "expiring";
  if (gl === "ok" && wc === "ok") return "ok";
  return "missing";
}

function CoiStatusPill({ form }) {
  const status = coiStatus(form);
  const map = {
    ok:       { label: "All Current",     cls: "bg-emerald-50 text-emerald-800 border-emerald-300" },
    expiring: { label: "Expiring Soon",   cls: "bg-amber-50 text-amber-800 border-amber-300" },
    expired:  { label: "Expired",         cls: "bg-red-50 text-red-800 border-red-300" },
    missing:  { label: "Missing / Incomplete", cls: "bg-zinc-100 text-zinc-700 border-zinc-300" },
  };
  const cfg = map[status];
  return (
    <span className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest border rounded-sm ${cfg.cls}`} data-testid="coi-status-pill">
      {cfg.label}
    </span>
  );
}



// ---------- Subcontractor Scorecards modal ----------
function ScorecardsModal({ subs, onClose }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [jobsModal, setJobsModal] = useState(null); // { sub, rows }
  const [logModal, setLogModal] = useState(null);   // pre-fill sub

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get("/subcontractor-scorecards");
      setRows(r.data);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const openJobs = async (sub) => {
    try {
      const r = await api.get(`/sub-jobs?subcontractor_id=${sub.subcontractor_id}`);
      setJobsModal({ sub, rows: r.data });
    } catch (e) { toast.error(formatApiError(e?.response?.data?.detail) || e.message); }
  };

  const totals = rows.reduce((acc, r) => ({
    awarded: acc.awarded + r.total_awarded,
    jobs: acc.jobs + r.total_jobs,
    issues: acc.issues + r.issues_total,
  }), { awarded: 0, jobs: 0, issues: 0 });

  const gradeColor = (g) => {
    if (g.startsWith("A+")) return "bg-emerald-100 text-emerald-900 border-emerald-300";
    if (g.startsWith("A")) return "bg-emerald-50 text-emerald-800 border-emerald-200";
    if (g.startsWith("B")) return "bg-blue-50 text-blue-800 border-blue-200";
    if (g.startsWith("C")) return "bg-amber-50 text-amber-900 border-amber-200";
    if (g.startsWith("D")) return "bg-red-50 text-red-800 border-red-300";
    return "bg-zinc-50 text-zinc-500 border-zinc-200";
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start sm:items-center justify-center p-4 overflow-y-auto" data-testid="scorecards-modal">
      <div className="bg-white border border-zinc-200 rounded-sm w-full max-w-6xl my-8">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <BarChart3 className="w-4 h-4 text-blue-700" />
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-700">Performance</div>
            </div>
            <h2 className="font-heading text-2xl font-black tracking-tight">Subcontractor Scorecards</h2>
            <div className="text-xs text-zinc-500 mt-1">On-time delivery, quality ratings, and total $ awarded per crew. Log a completed job to update the metrics.</div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setLogModal({})} className="inline-flex items-center gap-1.5 bg-blue-700 text-white px-3 h-9 text-[10px] font-bold uppercase tracking-wider hover:bg-blue-800 rounded-sm" data-testid="log-job-button"><ClipboardList className="w-3.5 h-3.5" /> Log Job</button>
            <button onClick={onClose} className="text-zinc-500 hover:text-zinc-950 text-xs uppercase tracking-wider font-bold" data-testid="scorecards-close">Close</button>
          </div>
        </div>

        <div className="p-6">
          {loading ? (
            <div className="text-sm text-zinc-500 py-12 text-center">Loading scorecards…</div>
          ) : rows.length === 0 ? (
            <div className="bg-zinc-50 border border-zinc-200 rounded-sm p-6 text-sm text-zinc-600">
              No subcontractors on file yet. Add a crew, then come back to log their jobs.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="border border-zinc-200 rounded-sm p-3">
                  <div className="text-[9px] font-bold uppercase tracking-wider text-zinc-500">Total Awarded ($)</div>
                  <div className="font-bold font-mono text-xl text-zinc-950 mt-0.5" data-testid="total-awarded">{formatCurrency(totals.awarded)}</div>
                </div>
                <div className="border border-zinc-200 rounded-sm p-3">
                  <div className="text-[9px] font-bold uppercase tracking-wider text-zinc-500">Logged Jobs</div>
                  <div className="font-bold font-mono text-xl text-zinc-950 mt-0.5" data-testid="total-jobs">{totals.jobs}</div>
                </div>
                <div className="border border-zinc-200 rounded-sm p-3">
                  <div className="text-[9px] font-bold uppercase tracking-wider text-zinc-500">Total Issues / Callbacks</div>
                  <div className={`font-bold font-mono text-xl mt-0.5 ${totals.issues > 0 ? "text-red-700" : "text-emerald-700"}`} data-testid="total-issues">{totals.issues}</div>
                </div>
              </div>
              <div className="border border-zinc-200 rounded-sm overflow-hidden">
                <table className="w-full text-sm" data-testid="scorecards-table">
                  <thead className="bg-zinc-50 border-b-2 border-zinc-950 text-left text-[10px] uppercase tracking-wider">
                    <tr>
                      <th className="py-3 px-3">Subcontractor</th>
                      <th className="py-3 px-3 text-center">Jobs</th>
                      <th className="py-3 px-3 text-center">On-Time %</th>
                      <th className="py-3 px-3 text-center">Avg Quality</th>
                      <th className="py-3 px-3 text-right">Total Awarded</th>
                      <th className="py-3 px-3 text-center">Issues</th>
                      <th className="py-3 px-3 text-center">Last Done</th>
                      <th className="py-3 px-3">Grade</th>
                      <th className="py-3 px-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {rows.map((r) => {
                      const ot = r.on_time_pct;
                      const q = r.avg_quality;
                      return (
                        <tr key={r.subcontractor_id} className="hover:bg-zinc-50" data-testid={`scorecard-row-${r.subcontractor_id}`}>
                          <td className="py-3 px-3">
                            <div className="font-bold">{r.subcontractor_name}</div>
                            {r.category && <div className="text-[10px] text-zinc-500 uppercase tracking-wider">{r.category}</div>}
                          </td>
                          <td className="py-3 px-3 text-center font-mono">
                            <div className="font-bold">{r.total_jobs}</div>
                            {r.scheduled_jobs > 0 && <div className="text-[10px] text-zinc-500">{r.scheduled_jobs} upcoming</div>}
                          </td>
                          <td className="py-3 px-3 text-center font-mono">
                            {r.completed_jobs === 0 ? <span className="text-zinc-400">—</span> : (
                              <span className={`font-bold ${ot >= 90 ? "text-emerald-700" : ot >= 70 ? "text-amber-700" : "text-red-700"}`}>{ot.toFixed(0)}%</span>
                            )}
                          </td>
                          <td className="py-3 px-3 text-center">
                            {r.rated_jobs === 0 ? <span className="text-zinc-400">—</span> : (
                              <div className="inline-flex items-center gap-1">
                                <Star className={`w-3 h-3 ${q >= 4 ? "fill-amber-400 text-amber-400" : "fill-zinc-300 text-zinc-300"}`} />
                                <span className="font-mono font-bold">{q.toFixed(1)}</span>
                                <span className="text-[10px] text-zinc-500">/ 5</span>
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-3 text-right font-mono font-bold">{formatCurrency(r.total_awarded)}</td>
                          <td className="py-3 px-3 text-center font-mono">
                            {r.issues_total > 0 ? <span className="text-red-700 font-bold">{r.issues_total}</span> : <span className="text-zinc-400">0</span>}
                          </td>
                          <td className="py-3 px-3 text-center text-[11px] text-zinc-600 font-mono">{r.last_completed || "—"}</td>
                          <td className="py-3 px-3">
                            <span className={`inline-block px-2 py-1 text-[10px] font-bold uppercase tracking-wider border rounded-sm ${gradeColor(r.grade)}`}>{r.grade}</span>
                          </td>
                          <td className="py-3 px-3">
                            <div className="flex items-center gap-1 justify-end">
                              <button
                                onClick={() => openJobs(r)}
                                className="border border-zinc-300 px-2.5 h-7 text-[10px] font-bold uppercase tracking-wider hover:bg-zinc-50 rounded-sm"
                                data-testid={`view-jobs-${r.subcontractor_id}`}
                              >History</button>
                              <button
                                onClick={() => setLogModal({ subcontractor_id: r.subcontractor_id, subcontractor_name: r.subcontractor_name })}
                                className="bg-blue-700 text-white px-2.5 h-7 text-[10px] font-bold uppercase tracking-wider hover:bg-blue-800 rounded-sm"
                                data-testid={`log-job-${r.subcontractor_id}`}
                              >Log Job</button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      {jobsModal && (
        <SubJobsHistoryModal sub={jobsModal.sub} initialRows={jobsModal.rows} onClose={() => setJobsModal(null)} onChange={load} />
      )}
      {logModal && (
        <LogSubJobModal preset={logModal} subs={subs} onClose={() => setLogModal(null)} onSaved={() => { setLogModal(null); load(); }} />
      )}
    </div>
  );
}


function SubJobsHistoryModal({ sub, initialRows, onClose, onChange }) {
  const [rows, setRows] = useState(initialRows || []);
  const reload = async () => {
    try {
      const r = await api.get(`/sub-jobs?subcontractor_id=${sub.subcontractor_id}`);
      setRows(r.data);
      onChange();
    } catch (e) { toast.error(formatApiError(e?.response?.data?.detail) || e.message); }
  };

  const remove = async (j) => {
    if (!window.confirm(`Delete this job log entry? (${j.work_description || "no description"})`)) return;
    try {
      await api.delete(`/sub-jobs/${j.id}`);
      toast.success("Job log deleted");
      reload();
    } catch (e) { toast.error(formatApiError(e?.response?.data?.detail) || e.message); }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-start justify-center p-4 overflow-y-auto" data-testid="sub-jobs-history-modal">
      <div className="bg-white border border-zinc-200 rounded-sm w-full max-w-5xl my-8">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-700 mb-1">Job History</div>
            <h3 className="font-heading text-xl font-black tracking-tight">{sub.subcontractor_name}</h3>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-950 text-xs uppercase tracking-wider font-bold">Close</button>
        </div>
        <div className="p-6">
          {rows.length === 0 ? (
            <div className="text-sm text-zinc-500 text-center py-8">No jobs logged for this crew yet.</div>
          ) : (
            <div className="border border-zinc-200 rounded-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 border-b-2 border-zinc-950 text-left text-[10px] uppercase tracking-wider">
                  <tr>
                    <th className="py-2 px-3">Work / Project</th>
                    <th className="py-2 px-3">Scheduled</th>
                    <th className="py-2 px-3">Completed</th>
                    <th className="py-2 px-3 text-center">Status</th>
                    <th className="py-2 px-3 text-center">Quality</th>
                    <th className="py-2 px-3 text-right">Awarded</th>
                    <th className="py-2 px-3 text-center">On-Time</th>
                    <th className="py-2 px-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {rows.map((j) => (
                    <tr key={j.id} className="hover:bg-zinc-50">
                      <td className="py-2 px-3">
                        <div className="font-bold text-xs">{j.work_description || "—"}</div>
                        {j.deal_title && <div className="text-[10px] text-zinc-500">{j.deal_title}</div>}
                      </td>
                      <td className="py-2 px-3 font-mono text-xs">{j.scheduled_date || "—"}</td>
                      <td className="py-2 px-3 font-mono text-xs">{j.completed_date || "—"}</td>
                      <td className="py-2 px-3 text-center text-[10px] uppercase tracking-wider">{j.status}</td>
                      <td className="py-2 px-3 text-center font-mono">{j.quality_rating ? `${j.quality_rating}/5` : "—"}</td>
                      <td className="py-2 px-3 text-right font-mono">{formatCurrency(j.contract_amount)}</td>
                      <td className="py-2 px-3 text-center text-[10px]">
                        {j.on_time === true ? <span className="text-emerald-700 font-bold">YES</span> : j.on_time === false ? <span className="text-red-700 font-bold">LATE</span> : <span className="text-zinc-400">—</span>}
                      </td>
                      <td className="py-2 px-3 text-right">
                        <button onClick={() => remove(j)} className="p-1 hover:bg-red-100 text-red-700 rounded-sm" title="Delete log entry"><Trash2 className="w-3 h-3" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


function LogSubJobModal({ preset, subs, onClose, onSaved }) {
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    subcontractor_id: preset?.subcontractor_id || "",
    deal_id: "",
    work_description: "",
    scheduled_date: today,
    completed_date: "",
    status: "Scheduled",
    quality_rating: "",
    issues_count: 0,
    contract_amount: 0,
    notes: "",
  });
  const [deals, setDeals] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get("/deals").then((r) => setDeals(r.data)).catch(() => {});
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.subcontractor_id) { toast.error("Pick a subcontractor"); return; }
    setSaving(true);
    try {
      const payload = {
        ...form,
        quality_rating: form.quality_rating ? Number(form.quality_rating) : null,
        contract_amount: Number(form.contract_amount || 0),
        issues_count: Number(form.issues_count || 0),
        completed_date: form.completed_date || null,
      };
      await api.post("/sub-jobs", payload);
      toast.success("Job logged");
      onSaved();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center p-4 overflow-y-auto" data-testid="log-sub-job-modal">
      <form onSubmit={submit} className="bg-white border border-zinc-200 rounded-sm w-full max-w-2xl my-8">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-700 mb-1">Log Subcontractor Job</div>
            <h3 className="font-heading text-xl font-black tracking-tight">{preset?.subcontractor_name || "New Job Entry"}</h3>
          </div>
          <button type="button" onClick={onClose} className="text-zinc-500 hover:text-zinc-950 text-xs uppercase tracking-wider font-bold">Close</button>
        </div>
        <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Subcontractor *">
            <Select data-testid="log-sub-id" value={form.subcontractor_id} onChange={(v) => setForm({ ...form, subcontractor_id: v })} options={[{ value: "", label: "— Pick —" }, ...subs.map((s) => ({ value: s.id, label: s.name }))]} />
          </Field>
          <Field label="Project">
            <Select data-testid="log-deal-id" value={form.deal_id} onChange={(v) => setForm({ ...form, deal_id: v })} options={[{ value: "", label: "— None —" }, ...deals.map((d) => ({ value: d.id, label: d.title }))]} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Work Description">
              <Input data-testid="log-work-desc" value={form.work_description} onChange={(v) => setForm({ ...form, work_description: v })} placeholder="e.g., Tear-off & deck prep" />
            </Field>
          </div>
          <Field label="Scheduled Date">
            <Input data-testid="log-scheduled" type="date" value={form.scheduled_date} onChange={(v) => setForm({ ...form, scheduled_date: v })} />
          </Field>
          <Field label="Completed Date">
            <Input data-testid="log-completed" type="date" value={form.completed_date} onChange={(v) => setForm({ ...form, completed_date: v })} />
          </Field>
          <Field label="Status">
            <Select data-testid="log-status" value={form.status} onChange={(v) => setForm({ ...form, status: v })} options={["Scheduled", "In Progress", "Completed", "Cancelled"].map((s) => ({ value: s, label: s }))} />
          </Field>
          <Field label="Quality Rating (1-5)">
            <Select data-testid="log-quality" value={form.quality_rating} onChange={(v) => setForm({ ...form, quality_rating: v })} options={[{ value: "", label: "— Not Rated —" }, { value: "5", label: "5 — Excellent" }, { value: "4", label: "4 — Good" }, { value: "3", label: "3 — OK" }, { value: "2", label: "2 — Below Avg" }, { value: "1", label: "1 — Poor" }]} />
          </Field>
          <Field label="Contract Amount ($)">
            <Input data-testid="log-amount" type="number" step="0.01" min="0" value={form.contract_amount} onChange={(v) => setForm({ ...form, contract_amount: v })} />
          </Field>
          <Field label="Issues / Callbacks">
            <Input data-testid="log-issues" type="number" min="0" step="1" value={form.issues_count} onChange={(v) => setForm({ ...form, issues_count: v })} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Notes">
              <textarea data-testid="log-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} className="w-full px-3 py-2 border border-zinc-300 rounded-sm text-sm" />
            </Field>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-zinc-200">
          <button type="button" onClick={onClose} className="px-4 h-10 text-xs font-bold uppercase tracking-wider border border-zinc-300 rounded-sm hover:bg-zinc-50">Cancel</button>
          <button type="submit" disabled={saving} data-testid="save-sub-job" className="px-4 h-10 text-xs font-bold uppercase tracking-wider bg-blue-700 text-white hover:bg-blue-800 rounded-sm disabled:opacity-50">{saving ? "Saving..." : "Save Job"}</button>
        </div>
      </form>
    </div>
  );
}
