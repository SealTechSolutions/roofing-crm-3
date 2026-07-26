/**
 * Employees — W2 employee roster + onboarding tracker.
 *
 * Route: /employees (admin-only)
 *
 * Tracks 12 required + 4 optional documents per hire, grouped into three
 * sections that mirror standard HR onboarding:
 *   1. Federal + State Paperwork (I-9, W-4, State Withholding)
 *   2. Company Onboarding Documents (Offer Letter, Direct Deposit,
 *      Employment Agreement, Benefits Declaration, Handbook, NDA,
 *      Non-Compete, New Hire Questionnaire, Union Agreement)
 *   3. Employee Documents (Birth Certificate, State ID, SSN Card,
 *      Visa/Green Card if non-citizen)
 *
 * A live progress pill (0/12 → 12/12 → Fully Onboarded) shows next to the
 * employee's name on the list AND at the top of the edit modal. The backend
 * auto-stamps `onboarding_completed_at` the moment all 12 required docs first
 * flip on-file (see `_stamp_employee_onboarding` in server.py).
 */
import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Navigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Plus, Pencil, Trash2, X, UserRoundCog, CheckCircle2 } from "lucide-react";

const DEFAULT_STATE = "CO";

const REQUIRED_FLAGS = [
  "i9_on_file", "w4_on_file", "state_wh_on_file",
  "offer_letter_on_file", "direct_deposit_on_file",
  "employment_agreement_on_file", "benefits_declaration_on_file",
  "handbook_on_file", "nda_on_file",
  "birth_certificate_on_file", "state_id_on_file", "ssn_card_on_file",
];

function eeOnboardingCount(f) {
  const done = REQUIRED_FLAGS.filter((k) => !!f[k]).length;
  return { done, total: REQUIRED_FLAGS.length, complete: done === REQUIRED_FLAGS.length };
}

function EeProgressPill({ form }) {
  const { done, total, complete } = eeOnboardingCount(form);
  const cls = complete
    ? "bg-emerald-50 text-emerald-800 border-emerald-300"
    : done === 0
      ? "bg-red-50 text-red-800 border-red-300"
      : "bg-amber-50 text-amber-800 border-amber-300";
  return (
    <span
      className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest border rounded-sm ${cls}`}
      data-testid="employee-onboarding-pill"
    >
      {complete ? "Fully Onboarded" : `Onboarding ${done}/${total}`}
    </span>
  );
}

const emptyEmployee = {
  name: "", email: "", phone: "", mobile_phone: "", date_of_birth: "", ssn_last4: "",
  address: "", address_line2: "", city: "", state: DEFAULT_STATE, zip_code: "",
  emergency_contact_name: "", emergency_contact_phone: "", emergency_contact_relation: "",
  title: "", department: "", hire_date: "", termination_date: "", status: "Active",
  pay_rate: 0, pay_type: "Hourly", notes: "",
  i9_on_file: false, i9_signed_date: "",
  w4_on_file: false, w4_signed_date: "",
  state_wh_on_file: false, state_wh_signed_date: "",
  offer_letter_on_file: false, offer_letter_signed_date: "",
  direct_deposit_on_file: false, direct_deposit_signed_date: "",
  employment_agreement_on_file: false, employment_agreement_signed_date: "",
  benefits_declaration_on_file: false, benefits_declaration_signed_date: "",
  handbook_on_file: false, handbook_signed_date: "",
  nda_on_file: false, nda_signed_date: "",
  noncompete_on_file: false, noncompete_signed_date: "",
  new_hire_questionnaire_on_file: false, new_hire_questionnaire_signed_date: "",
  union_agreement_on_file: false, union_agreement_signed_date: "",
  birth_certificate_on_file: false, state_id_on_file: false, ssn_card_on_file: false,
  visa_or_green_card_on_file: false, visa_or_green_card_type: "", visa_or_green_card_expiry_date: "",
  onboarding_completed_at: "",
};

// ─── Small stateless bits ───────────────────────────────────────────────────
const Field = ({ label, children }) => (
  <label className="block">
    <span className="block text-[10px] font-bold uppercase tracking-wider text-zinc-600 mb-1">{label}</span>
    {children}
  </label>
);
const Input = ({ type = "text", value, onChange, disabled, ...rest }) => (
  <input
    type={type}
    value={value ?? ""}
    onChange={(e) => onChange(e.target.value)}
    disabled={disabled}
    className="w-full px-3 h-10 border border-zinc-300 rounded-sm text-sm disabled:bg-zinc-50 disabled:text-zinc-400"
    {...rest}
  />
);
const Select = ({ value, onChange, options, ...rest }) => (
  <select
    value={value}
    onChange={(e) => onChange(e.target.value)}
    className="w-full px-3 h-10 border border-zinc-300 rounded-sm text-sm bg-white"
    {...rest}
  >
    {options.map((o) => <option key={o} value={o}>{o}</option>)}
  </select>
);

/** Reusable doc row: on-file checkbox + signed-date input. */
function DocRow({ label, required, flagKey, dateKey, form, setForm, testId }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[max-content_1fr_1fr] gap-3 items-end">
      <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-zinc-700 select-none pb-2">
        <input
          type="checkbox"
          checked={!!form[flagKey]}
          onChange={(e) => setForm({ ...form, [flagKey]: e.target.checked })}
          className="accent-blue-700"
          data-testid={`${testId}-onfile`}
        />
        {label} {required
          ? <span className="text-red-600 font-bold" title="Required">*</span>
          : <span className="text-zinc-400 text-[10px]" title="Optional">(optional)</span>}
      </label>
      <Field label={dateKey ? "Signed / On File Date" : ""}>
        {dateKey ? (
          <Input type="date" disabled={!form[flagKey]} value={form[dateKey]} onChange={(v) => setForm({ ...form, [dateKey]: v })} data-testid={`${testId}-date`} />
        ) : <span />}
      </Field>
      <div />
    </div>
  );
}

export default function Employees() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // null=closed, {} or object=open
  const [form, setForm] = useState(emptyEmployee);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get("/employees");
      setItems(r.data || []);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to load employees");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user?.role === "admin") load();
  }, [user]);

  const totalActive = useMemo(() => items.filter((i) => i.status === "Active").length, [items]);
  const totalFullyOnboarded = useMemo(
    () => items.filter((i) => eeOnboardingCount(i).complete).length,
    [items],
  );

  if (user && user.role !== "admin") return <Navigate to="/" replace />;

  const openNew = () => { setEditing({}); setForm({ ...emptyEmployee }); };
  const openEdit = (e) => { setEditing(e); setForm({ ...emptyEmployee, ...e }); };
  const close = () => setEditing(null);

  const save = async (ev) => {
    ev?.preventDefault?.();
    if (!form.name.trim()) { toast.error("Name is required"); return; }
    setSaving(true);
    try {
      if (editing?.id) {
        await api.put(`/employees/${editing.id}`, form);
        toast.success("Employee updated");
      } else {
        await api.post("/employees", form);
        toast.success("Employee created");
      }
      close();
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (e) => {
    if (!window.confirm(`Terminate ${e.name}? (Soft-delete — record kept for audit.)`)) return;
    try {
      await api.delete(`/employees/${e.id}`);
      toast.success("Employee removed");
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Delete failed");
    }
  };

  return (
    <div className="max-w-7xl mx-auto p-6" data-testid="employees-page">
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-700 mb-1">Team</div>
          <h1 className="font-heading text-3xl font-black text-zinc-900 flex items-center gap-3">
            <UserRoundCog className="w-7 h-7 text-blue-700" /> Employees
          </h1>
          <p className="text-sm text-zinc-600 mt-2 max-w-2xl">
            W2 employee roster with 12-doc onboarding tracker. Federal + State
            paperwork, company docs, and identity docs — each tracked with a
            signed date and rolled up into a Fully-Onboarded stamp.
          </p>
        </div>
        <button
          onClick={openNew}
          data-testid="new-employee-btn"
          className="inline-flex items-center gap-2 h-10 px-4 text-xs font-bold uppercase tracking-wider rounded-sm bg-blue-700 hover:bg-blue-800 text-white"
        >
          <Plus className="w-4 h-4" /> New Employee
        </button>
      </div>

      {/* Summary chips */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="bg-white border border-zinc-200 rounded-sm p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Total Employees</div>
          <div className="font-heading text-2xl font-black">{items.length}</div>
        </div>
        <div className="bg-white border border-zinc-200 rounded-sm p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">Active</div>
          <div className="font-heading text-2xl font-black text-emerald-800">{totalActive}</div>
        </div>
        <div className="bg-white border border-zinc-200 rounded-sm p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-blue-700">Fully Onboarded</div>
          <div className="font-heading text-2xl font-black text-blue-800">{totalFullyOnboarded} / {items.length}</div>
        </div>
      </div>

      {loading ? (
        <div className="text-center text-zinc-500 py-12">Loading…</div>
      ) : items.length === 0 ? (
        <div className="bg-white border border-zinc-200 rounded-sm p-10 text-center">
          <UserRoundCog className="w-8 h-8 text-zinc-300 mx-auto mb-3" />
          <div className="text-sm font-bold text-zinc-700 mb-1">No employees yet.</div>
          <div className="text-xs text-zinc-500">Click <span className="font-bold text-blue-700">New Employee</span> to add your first hire.</div>
        </div>
      ) : (
        <div className="bg-white border border-zinc-200 rounded-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-zinc-950 text-left text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                <th className="px-6 py-3">Name</th>
                <th className="px-6 py-3">Title</th>
                <th className="px-6 py-3">Hire Date</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3">Onboarding</th>
                <th className="px-6 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((e) => (
                <tr key={e.id} className="border-b border-zinc-100 hover:bg-zinc-50" data-testid={`employee-row-${e.id}`}>
                  <td className="px-6 py-3 font-bold text-zinc-950">
                    {e.name}
                    {e.email && <div className="text-[10px] text-zinc-500 font-normal">{e.email}</div>}
                  </td>
                  <td className="px-6 py-3 text-zinc-700 text-xs">{e.title || "—"}<div className="text-[10px] text-zinc-500">{e.department}</div></td>
                  <td className="px-6 py-3 text-zinc-600 text-xs font-mono">{e.hire_date || "—"}</td>
                  <td className="px-6 py-3">
                    <span className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest border rounded-sm ${
                      e.status === "Active" ? "bg-emerald-50 text-emerald-800 border-emerald-300"
                      : e.status === "On Leave" ? "bg-amber-50 text-amber-800 border-amber-300"
                      : "bg-zinc-100 text-zinc-600 border-zinc-300"
                    }`}>{e.status}</span>
                  </td>
                  <td className="px-6 py-3"><EeProgressPill form={e} /></td>
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-1">
                      <button data-testid={`edit-employee-${e.id}`} onClick={() => openEdit(e)} className="p-1.5 hover:bg-zinc-200 rounded-sm"><Pencil className="w-3.5 h-3.5" /></button>
                      <button data-testid={`delete-employee-${e.id}`} onClick={() => remove(e)} className="p-1.5 hover:bg-red-100 text-red-700 rounded-sm"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Editor modal */}
      {editing !== null && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={close}>
          <div className="bg-white rounded-sm max-w-3xl w-full max-h-[92vh] overflow-y-auto" onClick={(ev) => ev.stopPropagation()}>
            <div className="px-5 py-4 border-b border-zinc-200 flex items-center justify-between sticky top-0 bg-white z-10">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-700">Team</div>
                <h2 className="font-heading text-xl font-black">{editing?.id ? `Edit ${form.name}` : "New Employee"}</h2>
              </div>
              <div className="flex items-center gap-3">
                <EeProgressPill form={form} />
                <button onClick={close} className="text-zinc-400 hover:text-zinc-700" data-testid="employee-close-btn"><X className="w-5 h-5" /></button>
              </div>
            </div>

            <form onSubmit={save} className="p-5 space-y-5" data-testid="employee-form">
              {/* Personal */}
              <section>
                <h3 className="text-xs font-bold uppercase tracking-widest text-blue-700 mb-2">Personal</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Name *"><Input value={form.name} onChange={(v) => setForm({ ...form, name: v })} data-testid="employee-name" required /></Field>
                  <Field label="Email"><Input type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} data-testid="employee-email" /></Field>
                  <Field label="Mobile Phone"><Input value={form.mobile_phone} onChange={(v) => setForm({ ...form, mobile_phone: v })} /></Field>
                  <Field label="Date of Birth"><Input type="date" value={form.date_of_birth} onChange={(v) => setForm({ ...form, date_of_birth: v })} /></Field>
                  <Field label="SSN (last 4 only)"><Input value={form.ssn_last4} onChange={(v) => setForm({ ...form, ssn_last4: v.replace(/\D/g, "").slice(0, 4) })} placeholder="1234" /></Field>
                  <Field label="Address"><Input value={form.address} onChange={(v) => setForm({ ...form, address: v })} /></Field>
                  <Field label="City"><Input value={form.city} onChange={(v) => setForm({ ...form, city: v })} /></Field>
                  <Field label="State"><Input value={form.state} onChange={(v) => setForm({ ...form, state: v })} /></Field>
                  <Field label="ZIP"><Input value={form.zip_code} onChange={(v) => setForm({ ...form, zip_code: v })} /></Field>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
                  <Field label="Emergency Contact"><Input value={form.emergency_contact_name} onChange={(v) => setForm({ ...form, emergency_contact_name: v })} /></Field>
                  <Field label="EC Phone"><Input value={form.emergency_contact_phone} onChange={(v) => setForm({ ...form, emergency_contact_phone: v })} /></Field>
                  <Field label="EC Relation"><Input value={form.emergency_contact_relation} onChange={(v) => setForm({ ...form, emergency_contact_relation: v })} placeholder="Spouse / Parent / …" /></Field>
                </div>
              </section>

              {/* Job */}
              <section>
                <h3 className="text-xs font-bold uppercase tracking-widest text-blue-700 mb-2">Job</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Title"><Input value={form.title} onChange={(v) => setForm({ ...form, title: v })} data-testid="employee-title" /></Field>
                  <Field label="Department"><Input value={form.department} onChange={(v) => setForm({ ...form, department: v })} /></Field>
                  <Field label="Hire Date"><Input type="date" value={form.hire_date} onChange={(v) => setForm({ ...form, hire_date: v })} data-testid="employee-hire-date" /></Field>
                  <Field label="Termination Date"><Input type="date" value={form.termination_date} onChange={(v) => setForm({ ...form, termination_date: v })} /></Field>
                  <Field label="Pay Rate ($)"><Input type="number" value={form.pay_rate} onChange={(v) => setForm({ ...form, pay_rate: Number(v) || 0 })} /></Field>
                  <Field label="Pay Type"><Select value={form.pay_type} onChange={(v) => setForm({ ...form, pay_type: v })} options={["Hourly", "Salary"]} /></Field>
                  <Field label="Status"><Select value={form.status} onChange={(v) => setForm({ ...form, status: v })} options={["Active", "On Leave", "Terminated"]} /></Field>
                </div>
              </section>

              {/* Onboarding docs */}
              <section className="rounded-sm border border-zinc-200 bg-zinc-50 p-4 space-y-4">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-widest text-blue-700">Onboarding Documents</h3>
                    <div className="text-[10px] text-zinc-500 mt-0.5">
                      All 12 required docs must be on file for an employee to be considered fully onboarded.
                    </div>
                  </div>
                </div>

                {/* Section 1 */}
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-600 mb-2">1 · Federal &amp; State Paperwork</div>
                  <div className="space-y-2">
                    <DocRow label="Form I-9" required flagKey="i9_on_file" dateKey="i9_signed_date" form={form} setForm={setForm} testId="doc-i9" />
                    <DocRow label="Form W-4" required flagKey="w4_on_file" dateKey="w4_signed_date" form={form} setForm={setForm} testId="doc-w4" />
                    <DocRow label="State Tax Withholding" required flagKey="state_wh_on_file" dateKey="state_wh_signed_date" form={form} setForm={setForm} testId="doc-statewh" />
                  </div>
                </div>

                {/* Section 2 */}
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-600 mb-2">2 · Company Onboarding Documents</div>
                  <div className="space-y-2">
                    <DocRow label="Offer Letter" required flagKey="offer_letter_on_file" dateKey="offer_letter_signed_date" form={form} setForm={setForm} testId="doc-offer" />
                    <DocRow label="Direct Deposit" required flagKey="direct_deposit_on_file" dateKey="direct_deposit_signed_date" form={form} setForm={setForm} testId="doc-dd" />
                    <DocRow label="Employment Agreement" required flagKey="employment_agreement_on_file" dateKey="employment_agreement_signed_date" form={form} setForm={setForm} testId="doc-ea" />
                    <DocRow label="Benefits Declaration" required flagKey="benefits_declaration_on_file" dateKey="benefits_declaration_signed_date" form={form} setForm={setForm} testId="doc-benefits" />
                    <DocRow label="Employee Handbook" required flagKey="handbook_on_file" dateKey="handbook_signed_date" form={form} setForm={setForm} testId="doc-handbook" />
                    <DocRow label="Non-Disclosure Agreement" required flagKey="nda_on_file" dateKey="nda_signed_date" form={form} setForm={setForm} testId="doc-nda" />
                    <DocRow label="Non-Compete Agreement" required={false} flagKey="noncompete_on_file" dateKey="noncompete_signed_date" form={form} setForm={setForm} testId="doc-noncompete" />
                    <DocRow label="New Hire Questionnaire" required={false} flagKey="new_hire_questionnaire_on_file" dateKey="new_hire_questionnaire_signed_date" form={form} setForm={setForm} testId="doc-questionnaire" />
                    <DocRow label="Union Agreement" required={false} flagKey="union_agreement_on_file" dateKey="union_agreement_signed_date" form={form} setForm={setForm} testId="doc-union" />
                  </div>
                </div>

                {/* Section 3 */}
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-600 mb-2">3 · Employee Documents (Identity)</div>
                  <div className="space-y-2">
                    <DocRow label="Birth Certificate" required flagKey="birth_certificate_on_file" dateKey={null} form={form} setForm={setForm} testId="doc-birth" />
                    <DocRow label="State ID" required flagKey="state_id_on_file" dateKey={null} form={form} setForm={setForm} testId="doc-stateid" />
                    <DocRow label="Social Security Card" required flagKey="ssn_card_on_file" dateKey={null} form={form} setForm={setForm} testId="doc-ssncard" />
                    {/* Visa / Green Card special: type + expiry */}
                    <div className="grid grid-cols-1 sm:grid-cols-[max-content_1fr_1fr] gap-3 items-end">
                      <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-zinc-700 select-none pb-2">
                        <input
                          type="checkbox"
                          checked={!!form.visa_or_green_card_on_file}
                          onChange={(e) => setForm({ ...form, visa_or_green_card_on_file: e.target.checked })}
                          className="accent-blue-700"
                          data-testid="doc-visa-onfile"
                        />
                        Visa or Green Card <span className="text-zinc-400 text-[10px]" title="Optional — only if non-citizen">(if non-citizen)</span>
                      </label>
                      <Field label="Type">
                        <Input disabled={!form.visa_or_green_card_on_file} value={form.visa_or_green_card_type} onChange={(v) => setForm({ ...form, visa_or_green_card_type: v })} placeholder="Green Card / H-1B / OPT" data-testid="doc-visa-type" />
                      </Field>
                      <Field label="Expires">
                        <Input type="date" disabled={!form.visa_or_green_card_on_file} value={form.visa_or_green_card_expiry_date} onChange={(v) => setForm({ ...form, visa_or_green_card_expiry_date: v })} data-testid="doc-visa-expiry" />
                      </Field>
                    </div>
                  </div>
                </div>

                {form.onboarding_completed_at && (
                  <div className="text-[11px] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-sm px-3 py-2 flex items-center gap-2" data-testid="employee-onboarded-banner">
                    <CheckCircle2 className="w-4 h-4" /> <b>Onboarding complete</b> — {new Date(form.onboarding_completed_at).toLocaleDateString()}
                  </div>
                )}
              </section>

              <Field label="Notes">
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  rows={3}
                  className="w-full px-3 py-2 border border-zinc-300 rounded-sm text-sm"
                />
              </Field>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-200">
                <button type="button" onClick={close} className="h-10 px-4 text-xs font-bold uppercase tracking-wider rounded-sm text-zinc-700 hover:bg-zinc-100">Cancel</button>
                <button type="submit" disabled={saving} data-testid="employee-save-btn" className="h-10 px-4 text-xs font-bold uppercase tracking-wider rounded-sm bg-blue-700 hover:bg-blue-800 text-white disabled:opacity-40">
                  {saving ? "Saving…" : editing?.id ? "Save Changes" : "Create Employee"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
