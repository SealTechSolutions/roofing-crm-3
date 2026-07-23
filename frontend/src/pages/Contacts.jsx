import React, { useEffect, useState, useCallback } from "react";
import { api, formatApiError } from "@/lib/api";
import { Plus, Pencil, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { ExportButtons, ImportButton } from "@/components/ExportImport";
import { ScopesButton } from "@/components/ScopesModal";
import ConfirmDialog from "@/components/ConfirmDialog";
import { US_STATES, DEFAULT_STATE } from "@/constants/states";
import { maskPhoneInput, maskTaxIdInput, formatPhoneDisplay } from "@/lib/format";
import { useAuth } from "@/context/AuthContext";
import { useZipAutofill } from "@/hooks/useZipAutofill";

const CONTACT_TYPES = ["Owner", "Property Manager", "Tenant", "Other"];

const empty = {
  contact_name: "",
  company_name: "",
  contact_type: "Owner",
  phone: "",
  work_phone: "",
  mobile_phone: "",
  fax: "",
  email: "",
  address: "",
  address_line2: "",
  city: "",
  state: DEFAULT_STATE,
  zip_code: "",
  billing_same_as_address: true,
  billing_address: "",
  billing_address_line2: "",
  billing_city: "",
  billing_state: DEFAULT_STATE,
  billing_zip: "",
  website: "",
  late_fee_rate_pct: null,
  assigned_to_user_id: "",
};

export default function Contacts() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [items, setItems] = useState([]);
  const [users, setUsers] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);
  const [loading, setLoading] = useState(false);
  const [typeFilter, setTypeFilter] = useState("All");
  const [confirmTarget, setConfirmTarget] = useState(null);

  // Auto-fill City + State when the user types a 5-digit ZIP into either the
  // main-address or billing-address ZIP field. We only overwrite blank fields
  // to avoid stomping on values the user may have already typed.
  const fillMainAddr = useCallback((city, state) => {
    setForm((f) => ({
      ...f,
      city: f.city ? f.city : city,
      state: f.state ? f.state : state,
    }));
  }, []);
  const fillBillingAddr = useCallback((city, state) => {
    setForm((f) => ({
      ...f,
      billing_city: f.billing_city ? f.billing_city : city,
      billing_state: f.billing_state ? f.billing_state : state,
    }));
  }, []);
  useZipAutofill(form.zip_code, fillMainAddr);
  useZipAutofill(form.billing_zip, fillBillingAddr);

  const load = () => api.get("/contacts").then((r) => setItems(r.data));
  useEffect(() => { load(); }, []);
  // Active users list — drives the "Assigned To" dropdown for admins.
  useEffect(() => {
    api.get("/users").then((r) => setUsers(r.data || [])).catch(() => setUsers([]));
  }, []);

  const openCreate = () => { setEditing(null); setForm(empty); setOpen(true); };
  const openEdit = (c) => {
    setEditing(c);
    setForm({ ...empty, ...c });
    setOpen(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (editing) {
        await api.put(`/contacts/${editing.id}`, form);
        toast.success("Contact updated");
      } else {
        await api.post(`/contacts`, form);
        toast.success("Contact created");
      }
      setOpen(false);
      load();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setLoading(false);
    }
  };

  const remove = async () => {
    if (!confirmTarget) return;
    try {
      await api.delete(`/contacts/${confirmTarget.id}`);
      toast.success("Contact deleted");
      load();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setConfirmTarget(null);
    }
  };

  return (
    <div className="p-6 sm:p-8 animate-in fade-in duration-500" data-testid="contacts-page">
      <div className="flex items-end justify-between mb-8 pb-6 border-b border-zinc-200 gap-4 flex-wrap">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-700 mb-2">Contacts</div>
          <h1 className="font-heading text-3xl sm:text-4xl font-black tracking-tight">People &amp; Companies</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <ExportButtons category="contacts" />
          <ImportButton category="contacts" onImported={load} />
          <button
            data-testid="new-contact-button"
            onClick={openCreate}
            className="inline-flex items-center gap-2 bg-blue-700 text-white px-4 h-10 text-xs font-bold uppercase tracking-wider hover:bg-blue-800 rounded-sm transition-colors"
          >
            <Plus className="w-4 h-4" /> New Contact
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        {["All", ...CONTACT_TYPES].map((t) => (
          <button
            key={t}
            data-testid={`contact-type-filter-${t.toLowerCase().replace(/\s/g, "-")}`}
            onClick={() => setTypeFilter(t)}
            className={`px-3 h-8 text-[10px] font-bold uppercase tracking-wider border rounded-sm transition-colors ${
              typeFilter === t ? "bg-zinc-950 text-white border-zinc-950" : "bg-white text-zinc-700 border-zinc-300 hover:border-zinc-950"
            }`}
          >
            {t === "Property Manager" ? "Prop. Mgrs" : t === "All" ? "All" : t + "s"}
          </button>
        ))}
      </div>

      <div className="bg-white border border-zinc-200 rounded-sm overflow-x-auto">
        {items.filter((c) => typeFilter === "All" || (c.contact_type || "Owner") === typeFilter).length === 0 ? (
          <div className="p-12 text-center text-sm text-zinc-500">No contacts match.</div>
        ) : (
          <table className="w-full text-sm" data-testid="contacts-table">
            <thead>
              <tr className="border-b-2 border-zinc-950 text-left">
                <Th>Contact</Th><Th>Type</Th><Th>Company</Th><Th>Phone</Th><Th>Email</Th><Th>City, State</Th><Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {items
                .filter((c) => typeFilter === "All" || (c.contact_type || "Owner") === typeFilter)
                .map((c) => (
                <tr key={c.id} className="border-b border-zinc-100 hover:bg-zinc-50" data-testid={`contact-row-${c.id}`}>
                  <td className="px-6 py-3 font-bold text-zinc-950">
                    {c.contact_name}
                    {c.website && (
                      <a href={c.website.startsWith("http") ? c.website : `https://${c.website}`} target="_blank" rel="noopener noreferrer" className="block text-[10px] font-normal text-blue-700 hover:underline mt-0.5" data-testid={`contact-website-${c.id}`}>
                        🌐 {c.website.replace(/^https?:\/\//, "")}
                      </a>
                    )}
                  </td>
                  <td className="px-6 py-3 text-[10px] uppercase tracking-wider text-zinc-700">{c.contact_type || "—"}</td>
                  <td className="px-6 py-3 text-zinc-700">{c.company_name}</td>
                  <td className="px-6 py-3 text-zinc-600 font-mono text-xs">{formatPhoneDisplay(c.mobile_phone || c.work_phone || c.phone)}</td>
                  <td className="px-6 py-3 text-zinc-600 text-xs">{c.email}</td>
                  <td className="px-6 py-3 text-zinc-600 text-xs">{[c.city, c.state].filter(Boolean).join(", ")}</td>
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-1">
                      <ScopesButton contactId={c.id} testIdPrefix="contact-scopes" />
                      <button data-testid={`edit-contact-${c.id}`} onClick={() => openEdit(c)} className="p-1.5 hover:bg-zinc-200 rounded-sm"><Pencil className="w-3.5 h-3.5" /></button>
                      <button data-testid={`delete-contact-${c.id}`} onClick={() => setConfirmTarget(c)} className="p-1.5 hover:bg-red-100 text-red-700 rounded-sm"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {open && (
        <Modal title={editing ? "Edit Contact" : "New Contact"} onClose={() => setOpen(false)}>
          <form onSubmit={submit} className="space-y-4" data-testid="contact-form">
            <Grid2>
              <Field label="Contact Name *">
                <Input data-testid="contact-name" required value={form.contact_name} onChange={(v) => setForm({ ...form, contact_name: v })} />
              </Field>
              <Field label="Company Name">
                <Input data-testid="contact-company" value={form.company_name} onChange={(v) => setForm({ ...form, company_name: v })} />
              </Field>
              <Field label="Contact Type">
                <Select data-testid="contact-type" value={form.contact_type} onChange={(v) => setForm({ ...form, contact_type: v })} options={CONTACT_TYPES} />
              </Field>
              <Field label="Email">
                <Input data-testid="contact-email" type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
              </Field>
              <Field label="Website / URL">
                <Input data-testid="contact-website" value={form.website} onChange={(v) => setForm({ ...form, website: v })} placeholder="https://company.com" />
              </Field>
              <Field label="Work Phone">
                <Input data-testid="contact-work-phone" format="phone" value={form.work_phone} onChange={(v) => setForm({ ...form, work_phone: v })} />
              </Field>
              <Field label="Mobile Phone">
                <Input data-testid="contact-mobile-phone" format="phone" value={form.mobile_phone} onChange={(v) => setForm({ ...form, mobile_phone: v })} />
              </Field>
              <Field label="Fax">
                <Input data-testid="contact-fax" format="phone" value={form.fax} onChange={(v) => setForm({ ...form, fax: v })} />
              </Field>
              <Field label="Other / Primary Phone">
                <Input data-testid="contact-phone" format="phone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
              </Field>
            </Grid2>
            <Field label="Address Line 1">
              <Input data-testid="contact-address" value={form.address} onChange={(v) => setForm({ ...form, address: v })} />
            </Field>
            <Field label="Address Line 2">
              <Input data-testid="contact-address2" value={form.address_line2} onChange={(v) => setForm({ ...form, address_line2: v })} />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-6 gap-4">
              <div className="sm:col-span-3">
                <Field label="City">
                  <Input data-testid="contact-city" value={form.city} onChange={(v) => setForm({ ...form, city: v })} />
                </Field>
              </div>
              <div className="sm:col-span-1">
                <Field label="State">
                  <Select data-testid="contact-state" value={form.state || DEFAULT_STATE} onChange={(v) => setForm({ ...form, state: v })} options={US_STATES} />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="ZIP">
                  <Input data-testid="contact-zip" value={form.zip_code} onChange={(v) => setForm({ ...form, zip_code: v })} />
                </Field>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                data-testid="contact-billing-same"
                checked={form.billing_same_as_address}
                onChange={(e) => setForm({ ...form, billing_same_as_address: e.target.checked })}
                className="w-4 h-4 accent-blue-700"
              />
              <span className="text-xs uppercase tracking-wider font-bold text-zinc-700">Billing address same as address</span>
            </label>
            {!form.billing_same_as_address && (
              <div className="space-y-4 pl-3 border-l-2 border-blue-700">
                <Field label="Billing Address Line 1">
                  <Input data-testid="contact-billing-address" value={form.billing_address} onChange={(v) => setForm({ ...form, billing_address: v })} />
                </Field>
                <Field label="Billing Address Line 2">
                  <Input data-testid="contact-billing-address2" value={form.billing_address_line2} onChange={(v) => setForm({ ...form, billing_address_line2: v })} />
                </Field>
                <div className="grid grid-cols-1 sm:grid-cols-6 gap-4">
                  <div className="sm:col-span-3">
                    <Field label="Billing City">
                      <Input data-testid="contact-billing-city" value={form.billing_city} onChange={(v) => setForm({ ...form, billing_city: v })} />
                    </Field>
                  </div>
                  <div className="sm:col-span-1">
                    <Field label="State">
                      <Select data-testid="contact-billing-state" value={form.billing_state || DEFAULT_STATE} onChange={(v) => setForm({ ...form, billing_state: v })} options={US_STATES} />
                    </Field>
                  </div>
                  <div className="sm:col-span-2">
                    <Field label="ZIP">
                      <Input data-testid="contact-billing-zip" value={form.billing_zip} onChange={(v) => setForm({ ...form, billing_zip: v })} />
                    </Field>
                  </div>
                </div>
              </div>
            )}

            {/* Per-customer Late-Fee Rate Override */}
            <Field
              label="Late Fee Rate Override"
              hint="Leave blank to inherit the entity default rate. Enter a percent (e.g. 1.0) to charge this customer at a custom monthly rate on balances > 30 days past due."
            >
              <div className="flex items-center gap-2">
                <input
                  data-testid="contact-late-fee-rate"
                  type="number"
                  step="0.01"
                  min="0"
                  max="25"
                  value={form.late_fee_rate_pct ?? ""}
                  placeholder="—  (use entity default)"
                  onChange={(e) => {
                    const v = e.target.value;
                    setForm({ ...form, late_fee_rate_pct: v === "" ? null : parseFloat(v) });
                  }}
                  className="w-40 border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:border-blue-700 font-mono text-right rounded-sm"
                />
                <span className="font-mono text-zinc-500 text-sm">% / month</span>
                {form.late_fee_rate_pct != null && (
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, late_fee_rate_pct: null })}
                    className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 hover:text-rose-700 underline ml-auto"
                    data-testid="contact-late-fee-clear"
                  >
                    Clear override
                  </button>
                )}
              </div>
            </Field>

            {/* Assigned Rep — only an admin can change who owns this
                contact. For non-admins the dropdown is shown read-only so
                the rep can still see who it's tied to. */}
            <Field
              label={isAdmin ? "Assigned Rep" : "Assigned Rep (admin only)"}
              hint="Whoever's name is shown here is the rep of record for this customer — drives Dashboard 'My Contacts' filters, From-name on emails, and any future commission attribution."
            >
              <Select
                data-testid="contact-assigned-to"
                value={form.assigned_to_user_id || ""}
                onChange={(v) => setForm({ ...form, assigned_to_user_id: v })}
                options={[
                  { value: "", label: "— Auto-assign to me —" },
                  ...users.filter((u) => u.is_active !== false).map((u) => ({
                    value: u.id,
                    label: u.name || u.email,
                  })),
                ]}
                disabled={!isAdmin}
              />
            </Field>

            <div className="flex justify-end gap-2 pt-4 border-t border-zinc-200">
              <button type="button" onClick={() => setOpen(false)} className="px-4 h-10 text-xs font-bold uppercase tracking-wider border border-zinc-300 rounded-sm hover:bg-zinc-50">Cancel</button>
              <button type="submit" disabled={loading} data-testid="contact-save" className="px-4 h-10 text-xs font-bold uppercase tracking-wider bg-blue-700 text-white hover:bg-blue-800 rounded-sm disabled:opacity-50">{loading ? "Saving..." : "Save"}</button>
            </div>
          </form>
        </Modal>
      )}

      <ConfirmDialog
        open={!!confirmTarget}
        title="Delete Contact?"
        message={`This will permanently delete ${confirmTarget?.contact_name || "this contact"}${confirmTarget?.company_name ? " · " + confirmTarget.company_name : ""}. This action cannot be undone.`}
        onConfirm={remove}
        onClose={() => setConfirmTarget(null)}
      />
    </div>
  );
}

export const Th = ({ children }) => (
  <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-wider text-zinc-950">{children}</th>
);

export const Modal = ({ title, onClose, children, wide }) => (
  <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose} data-testid="modal-overlay">
    <div className={`bg-white rounded-sm shadow-xl w-full ${wide ? "max-w-4xl" : "max-w-2xl"} max-h-[90vh] overflow-y-auto`} onClick={(e) => e.stopPropagation()}>
      <div className="px-6 py-4 border-b border-zinc-200 flex items-center justify-between">
        <h2 className="font-heading text-xl font-bold tracking-tight">{title}</h2>
        <button onClick={onClose} className="p-1.5 hover:bg-zinc-100 rounded-sm" data-testid="modal-close"><X className="w-4 h-4" /></button>
      </div>
      <div className="p-6">{children}</div>
    </div>
  </div>
);

export const Field = ({ label, hint, children }) => (
  <div>
    <label className="block text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-700 mb-2">{label}</label>
    {children}
    {hint && <div className="mt-1 text-[11px] text-zinc-500 leading-snug">{hint}</div>}
  </div>
);

export const Grid2 = ({ children }) => <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{children}</div>;

export const Input = ({ value, onChange, type = "text", format, taxIdKind, ...props }) => {
  // For number inputs, hide a leading 0 placeholder so users can just start typing
  // without first deleting the "0". Local string state lets the user type freely
  // (including "0", "0.5") and the display syncs back to the numeric prop on blur.
  const [localStr, setLocalStr] = useState(null);

  const displayValue = (() => {
    if (type === "number") {
      if (localStr !== null) return localStr;
      if (value === 0 || value === "0" || value === null || value === undefined) return "";
      return value;
    }
    if (format === "phone") {
      // Always show hyphenated form (handles pasted dots/spaces/parens + legacy data)
      return maskPhoneInput(value ?? "");
    }
    if (format === "ein" || format === "ssn") {
      return maskTaxIdInput(value ?? "", format === "ssn" ? "SSN" : "EIN");
    }
    return value ?? "";
  })();

  const handleChange = (e) => {
    const v = e.target.value;
    if (type === "number") {
      setLocalStr(v);
      const parsed = parseFloat(v);
      onChange(Number.isFinite(parsed) ? parsed : 0);
    } else if (format === "phone") {
      onChange(maskPhoneInput(v));
    } else if (format === "ein" || format === "ssn") {
      onChange(maskTaxIdInput(v, format === "ssn" ? "SSN" : "EIN"));
    } else {
      onChange(v);
    }
  };

  const handleBlur = (e) => {
    if (type === "number") setLocalStr(null);
    if (format === "phone") {
      // Re-format on blur to catch paste-then-tab without an intermediate keystroke
      onChange(maskPhoneInput(e.target.value));
    }
    if (props.onBlur) props.onBlur(e);
  };

  // Spell-check ON for plain text inputs only — never for phone/email/tax IDs/numbers.
  const enableSpellCheck = type === "text" && !format;

  return (
    <input
      type={type}
      spellCheck={enableSpellCheck}
      autoCorrect={enableSpellCheck ? "on" : "off"}
      autoCapitalize={enableSpellCheck ? "sentences" : "off"}
      {...props}
      value={displayValue}
      onChange={handleChange}
      onBlur={handleBlur}
      className="w-full h-10 px-3 border border-zinc-300 bg-white rounded-sm focus:outline-none focus:ring-2 focus:ring-blue-700 text-sm"
    />
  );
};

export const Select = ({ value, onChange, options, ...props }) => (
  <select
    value={value ?? ""}
    onChange={(e) => onChange(e.target.value)}
    className="w-full h-10 px-3 border border-zinc-300 bg-white rounded-sm focus:outline-none focus:ring-2 focus:ring-blue-700 text-sm"
    {...props}
  >
    {options.map((o) => (
      <option key={o.value ?? o} value={o.value ?? o}>
        {o.label ?? o}
      </option>
    ))}
  </select>
);
