import React, { useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import { User, KeyRound, Save, Eye, EyeOff, ShieldAlert } from "lucide-react";

export default function Profile() {
  const { user, refreshUser } = useAuth();

  return (
    <div className="p-6 sm:p-8 max-w-3xl animate-in fade-in duration-500" data-testid="profile-page">
      <div className="mb-8 pb-6 border-b border-zinc-200">
        <div className="flex items-center gap-2 mb-2">
          <User className="w-4 h-4 text-blue-700" />
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-700">Account</div>
        </div>
        <h1 className="font-heading text-3xl sm:text-4xl font-black tracking-tight">My Profile</h1>
        <div className="mt-2 text-xs uppercase tracking-wider text-zinc-500">
          Edit your name, job title, credentials, phone, and password
        </div>
      </div>

      <ProfileSection user={user} onSaved={refreshUser} />
      <PasswordSection />
    </div>
  );
}


function ProfileSection({ user, onSaved }) {
  const [name, setName] = useState(user?.name || "");
  const [title, setTitle] = useState(user?.title || "");
  const [phone, setPhone] = useState(user?.phone || "");
  const [credentials, setCredentials] = useState(user?.credentials || "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    setSaving(true);
    try {
      await api.put("/auth/me", { name: name.trim(), title: title.trim(), phone: phone.trim(), credentials: credentials.trim() });
      await onSaved();
      toast.success("Profile updated");
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setSaving(false);
    }
  };

  // Live signature preview matches the spec sheet exactly
  const sigName = name.trim() || "Darren Oliver";
  const sigCreds = credentials.trim() || (name.trim() ? "" : "CSI, IIBEC");
  const sigLine = sigCreds ? `${sigName}, ${sigCreds}` : sigName;

  return (
    <div className="bg-white border border-zinc-200 rounded-sm p-6 mb-6">
      <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 mb-5 pb-3 border-b border-zinc-100">
        Profile Details
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-5">
        <Field label="Name *">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full h-10 px-3 border border-zinc-300 rounded-sm text-sm focus:border-blue-700 focus:outline-none"
            data-testid="profile-name"
          />
        </Field>
        <Field label="Email" hint="Email cannot be changed — contact an admin if needed.">
          <input
            value={user?.email || ""}
            disabled
            className="w-full h-10 px-3 border border-zinc-200 bg-zinc-50 text-zinc-500 rounded-sm text-sm"
            data-testid="profile-email"
          />
        </Field>
        <Field label="Job Title" hint="e.g., General Manager, Lead Estimator. Appears on Purchase Orders.">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g., General Manager"
            className="w-full h-10 px-3 border border-zinc-300 rounded-sm text-sm focus:border-blue-700 focus:outline-none"
            data-testid="profile-title"
          />
        </Field>
        <Field label="Phone" hint="Direct line shown on Purchase Orders to vendors.">
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="e.g., 720-715-9955"
            className="w-full h-10 px-3 border border-zinc-300 rounded-sm text-sm focus:border-blue-700 focus:outline-none"
            data-testid="profile-phone"
          />
        </Field>
        <Field label="Credentials" hint="Letters after your name on the scope signature (e.g., CSI, IIBEC). Leave blank to omit.">
          <input
            value={credentials}
            onChange={(e) => setCredentials(e.target.value)}
            placeholder="e.g., CSI, IIBEC"
            className="w-full h-10 px-3 border border-zinc-300 rounded-sm text-sm focus:border-blue-700 focus:outline-none"
            data-testid="profile-credentials"
          />
        </Field>
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-600 mb-1.5">
            Scope Signature Preview
          </label>
          <div className="border border-zinc-200 rounded-sm bg-zinc-50 px-3 py-2 text-sm leading-snug" data-testid="signature-preview">
            <div className="font-bold text-zinc-950">{sigLine}</div>
            <div className="text-zinc-600 text-xs">SealTech Building Solutions</div>
          </div>
          <div className="mt-1 text-[11px] text-zinc-500 leading-snug">This is exactly how your name will print at the bottom of every scope PDF you generate.</div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 pt-4 border-t border-zinc-100">
        <div className="text-[10px] uppercase tracking-wider text-zinc-500">
          Role: <span className="font-bold text-zinc-700">{user?.role}</span>
        </div>
        <button
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-2 bg-blue-700 text-white px-4 h-10 text-xs font-bold uppercase tracking-wider hover:bg-blue-800 disabled:opacity-40 rounded-sm"
          data-testid="save-profile"
        >
          <Save className="w-4 h-4" /> {saving ? "Saving..." : "Save Profile"}
        </button>
      </div>
    </div>
  );
}


function PasswordSection() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNext, setShowNext] = useState(false);
  const [saving, setSaving] = useState(false);

  const reset = () => { setCurrent(""); setNext(""); setConfirm(""); };

  const submit = async () => {
    if (!current) { toast.error("Enter your current password"); return; }
    if (next.length < 8) { toast.error("New password must be at least 8 characters"); return; }
    if (next !== confirm) { toast.error("New password and confirmation do not match"); return; }
    if (next === current) { toast.error("New password must be different from current password"); return; }
    setSaving(true);
    try {
      await api.post("/auth/change-password", { current_password: current, new_password: next });
      toast.success("Password changed successfully. You can keep using the app — no need to log back in.");
      reset();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setSaving(false);
    }
  };

  // Strength indicator
  const strength = (() => {
    let score = 0;
    if (next.length >= 8) score += 1;
    if (next.length >= 12) score += 1;
    if (/[A-Z]/.test(next) && /[a-z]/.test(next)) score += 1;
    if (/\d/.test(next)) score += 1;
    if (/[^A-Za-z0-9]/.test(next)) score += 1;
    return score; // 0–5
  })();
  const strengthLabel = ["", "Weak", "Fair", "Good", "Strong", "Very Strong"][strength] || "";
  const strengthColor = ["bg-zinc-200", "bg-red-500", "bg-orange-500", "bg-yellow-500", "bg-emerald-500", "bg-emerald-700"][strength] || "bg-zinc-200";

  return (
    <div className="bg-white border border-zinc-200 rounded-sm p-6">
      <div className="flex items-center justify-between mb-5 pb-3 border-b border-zinc-100 gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-blue-700" />
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">
            Change Password
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4">
        <Field label="Current Password *">
          <div className="relative">
            <input
              type={showCurrent ? "text" : "password"}
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoComplete="current-password"
              className="w-full h-10 px-3 pr-10 border border-zinc-300 rounded-sm text-sm focus:border-blue-700 focus:outline-none font-mono"
              data-testid="change-pw-current"
            />
            <button
              type="button"
              onClick={() => setShowCurrent((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-zinc-500 hover:text-zinc-950"
              title={showCurrent ? "Hide" : "Show"}
              data-testid="toggle-current-visibility"
            >
              {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </Field>

        <Field label="New Password *" hint="At least 8 characters. Mixing case, digits, and symbols makes it stronger.">
          <div className="relative">
            <input
              type={showNext ? "text" : "password"}
              value={next}
              onChange={(e) => setNext(e.target.value)}
              autoComplete="new-password"
              className="w-full h-10 px-3 pr-10 border border-zinc-300 rounded-sm text-sm focus:border-blue-700 focus:outline-none font-mono"
              data-testid="change-pw-new"
            />
            <button
              type="button"
              onClick={() => setShowNext((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-zinc-500 hover:text-zinc-950"
              title={showNext ? "Hide" : "Show"}
              data-testid="toggle-new-visibility"
            >
              {showNext ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {next && (
            <div className="mt-2 flex items-center gap-2">
              <div className="flex-1 h-1.5 bg-zinc-200 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all ${strengthColor}`}
                  style={{ width: `${(strength / 5) * 100}%` }}
                />
              </div>
              <span className="text-[10px] uppercase tracking-wider text-zinc-600 font-bold w-20 text-right" data-testid="pw-strength">
                {strengthLabel}
              </span>
            </div>
          )}
        </Field>

        <Field label="Confirm New Password *">
          <input
            type={showNext ? "text" : "password"}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            className={`w-full h-10 px-3 border rounded-sm text-sm focus:outline-none font-mono ${
              confirm && confirm !== next ? "border-red-400 focus:border-red-600" : "border-zinc-300 focus:border-blue-700"
            }`}
            data-testid="change-pw-confirm"
          />
          {confirm && confirm !== next && (
            <div className="mt-1 text-[11px] text-red-600">Passwords do not match.</div>
          )}
        </Field>
      </div>

      <div className="mt-5 pt-4 border-t border-zinc-100 flex items-center justify-between gap-3 flex-wrap">
        <div className="text-[11px] text-zinc-500 flex items-start gap-2 max-w-md leading-snug">
          <ShieldAlert className="w-3.5 h-3.5 text-amber-600 mt-0.5 flex-shrink-0" />
          <span>Tip: never type your password into the <b>Job Title</b> or <b>Phone</b> fields — those values are printed on Purchase Orders.</span>
        </div>
        <button
          onClick={submit}
          disabled={saving || !current || !next || !confirm}
          className="inline-flex items-center gap-2 bg-blue-700 text-white px-4 h-10 text-xs font-bold uppercase tracking-wider hover:bg-blue-800 disabled:opacity-40 disabled:cursor-not-allowed rounded-sm"
          data-testid="submit-password-change"
        >
          <KeyRound className="w-4 h-4" /> {saving ? "Changing..." : "Change Password"}
        </button>
      </div>
    </div>
  );
}


function Field({ label, hint, children }) {
  return (
    <div>
      <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-600 mb-1.5">
        {label}
      </label>
      {children}
      {hint && <div className="mt-1 text-[11px] text-zinc-500 leading-snug">{hint}</div>}
    </div>
  );
}
