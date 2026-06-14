import React, { useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { toast } from "sonner";
import { ShieldCheck, Mail, History, Send, Save, ChevronLeft, AlertCircle, CheckCircle2, Calendar } from "lucide-react";
import { Link } from "react-router-dom";

export default function CoiReminders() {
  const [settings, setSettings] = useState(null);
  const [recipients, setRecipients] = useState([]);
  const [history, setHistory] = useState([]);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);

  const load = async () => {
    try {
      const [s, r, h] = await Promise.all([
        api.get("/coi-reminder/settings"),
        api.get("/coi-reminder/preview-recipients"),
        api.get("/coi-reminder/history"),
      ]);
      setSettings(s.data);
      setRecipients(r.data || []);
      setHistory(h.data || []);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    }
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const r = await api.put("/coi-reminder/settings", {
        enabled: settings.enabled,
        next_send_date: settings.next_send_date,
        frequency_months: settings.frequency_months,
        subject: settings.subject,
        additional_insured_text: settings.additional_insured_text,
        body_intro: settings.body_intro,
        body_outro: settings.body_outro,
        cc: settings.cc,
      });
      setSettings(r.data);
      toast.success("COI reminder settings saved");
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setSaving(false);
    }
  };

  const sendNow = async () => {
    const willSend = recipients.filter((r) => r.will_send).length;
    if (!window.confirm(`Send the COI request email to ${willSend} subcontractor(s) RIGHT NOW?\n\nThis is a real email — make sure your template is ready.`)) return;
    setSending(true);
    try {
      const r = await api.post("/coi-reminder/send-now");
      const d = r.data || {};
      toast.success(`COI batch: ${d.sent_count} sent · ${d.skipped_count} skipped · ${d.failed_count} failed`);
      load();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setSending(false);
    }
  };

  if (!settings) return <div className="p-8 text-sm text-zinc-500">Loading...</div>;

  const willSendCount = recipients.filter((r) => r.will_send).length;
  const missingEmailCount = recipients.length - willSendCount;

  return (
    <div className="p-8 max-w-6xl mx-auto" data-testid="coi-reminders-page">
      {/* Header */}
      <div className="mb-6 flex items-start gap-4">
        <div className="w-12 h-12 rounded-sm bg-blue-700 flex items-center justify-center">
          <ShieldCheck className="w-6 h-6 text-white" />
        </div>
        <div className="flex-1">
          <Link to="/subcontractors" className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-900 mb-1">
            <ChevronLeft className="w-3 h-3" /> Back to Subcontractors
          </Link>
          <h1 className="text-2xl font-black text-zinc-900 tracking-tight">COI Reminder System</h1>
          <p className="text-sm text-zinc-600 mt-1">
            Automated annual email to all subcontractors requesting an updated Certificate of Insurance
            naming SealTech&apos;s required Additional Insured.
          </p>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-6">
        <Kpi label="Status" value={settings.enabled ? "Enabled" : "Disabled"} tone={settings.enabled ? "emerald" : "zinc"} icon={CheckCircle2} />
        <Kpi label="Next Run" value={settings.next_send_date || "—"} tone="blue" icon={Calendar} />
        <Kpi label="Recipients" value={`${willSendCount} of ${recipients.length}`} tone="blue" icon={Mail} hint={missingEmailCount > 0 ? `${missingEmailCount} missing email` : ""} />
        <Kpi
          label="Last Sent"
          value={settings.last_sent_at ? new Date(settings.last_sent_at).toLocaleDateString() : "Never"}
          tone="zinc"
          icon={History}
          hint={settings.last_sent_at ? `${settings.last_sent_count} emails` : ""}
        />
      </div>

      {/* Send Now */}
      <div className="mb-6 border-2 border-violet-200 bg-violet-50/40 rounded-sm p-4 flex items-center justify-between gap-4">
        <div className="flex-1">
          <div className="text-[11px] font-black uppercase tracking-[0.15em] text-violet-800">Manual Trigger</div>
          <div className="text-sm text-zinc-700 mt-0.5">
            Send the COI request to <strong>{willSendCount}</strong> subcontractor{willSendCount === 1 ? "" : "s"} right now (bypasses the schedule).
          </div>
        </div>
        <button
          onClick={sendNow}
          disabled={sending || willSendCount === 0}
          data-testid="coi-send-now-btn"
          className="px-5 py-2.5 text-xs font-bold uppercase tracking-wider bg-violet-700 text-white hover:bg-violet-800 disabled:opacity-40 disabled:cursor-not-allowed rounded-sm inline-flex items-center gap-2"
        >
          <Send className="w-4 h-4" /> {sending ? "Sending..." : "Send COI Reminder Now"}
        </button>
      </div>

      {/* Settings */}
      <div className="bg-white border border-zinc-200 rounded-sm p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="text-[11px] font-black uppercase tracking-[0.15em] text-zinc-700">Schedule & Template</div>
          <button
            onClick={save}
            disabled={saving}
            data-testid="coi-save-btn"
            className="px-4 py-2 text-xs font-bold uppercase tracking-wider bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-40 rounded-sm inline-flex items-center gap-2"
          >
            <Save className="w-3.5 h-3.5" /> {saving ? "Saving..." : "Save"}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <Field label="Enabled">
            <label className="flex items-center gap-2 mt-1 text-sm">
              <input
                type="checkbox"
                checked={!!settings.enabled}
                onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
                data-testid="coi-enabled"
              />
              {settings.enabled ? "Scheduler will run" : "Paused"}
            </label>
          </Field>
          <Field label="Next Send Date">
            <input
              type="date"
              value={settings.next_send_date || ""}
              onChange={(e) => setSettings({ ...settings, next_send_date: e.target.value })}
              data-testid="coi-next-date"
              className="w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm font-mono"
            />
          </Field>
          <Field label="Repeat every (months)">
            <input
              type="number"
              min={1}
              max={36}
              value={settings.frequency_months || 12}
              onChange={(e) => setSettings({ ...settings, frequency_months: parseInt(e.target.value) || 12 })}
              data-testid="coi-frequency"
              className="w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm font-mono"
            />
          </Field>
        </div>

        <Field label="Email Subject">
          <input
            value={settings.subject || ""}
            onChange={(e) => setSettings({ ...settings, subject: e.target.value })}
            data-testid="coi-subject"
            className="w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm"
          />
        </Field>

        <div className="mt-4">
          <Field label="Additional Insured (boxed in blue on the email)">
            <textarea
              value={settings.additional_insured_text || ""}
              onChange={(e) => setSettings({ ...settings, additional_insured_text: e.target.value })}
              data-testid="coi-additional-insured"
              rows={4}
              className="w-full px-3 py-2 border border-blue-300 rounded-sm text-sm font-mono bg-blue-50/30"
            />
          </Field>
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Body — Intro paragraph">
            <textarea
              value={settings.body_intro || ""}
              onChange={(e) => setSettings({ ...settings, body_intro: e.target.value })}
              data-testid="coi-body-intro"
              rows={5}
              className="w-full px-3 py-2 border border-zinc-300 rounded-sm text-sm font-mono"
            />
          </Field>
          <Field label="Body — Closing paragraph + signature">
            <textarea
              value={settings.body_outro || ""}
              onChange={(e) => setSettings({ ...settings, body_outro: e.target.value })}
              data-testid="coi-body-outro"
              rows={5}
              className="w-full px-3 py-2 border border-zinc-300 rounded-sm text-sm font-mono"
            />
          </Field>
        </div>

        <div className="mt-4">
          <Field label="Always CC (optional — e.g., your insurance broker)">
            <input
              value={settings.cc || ""}
              onChange={(e) => setSettings({ ...settings, cc: e.target.value })}
              data-testid="coi-cc"
              placeholder="broker@youragency.com"
              className="w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm"
            />
          </Field>
        </div>
      </div>

      {/* Recipients preview */}
      <div className="bg-white border border-zinc-200 rounded-sm p-5 mb-6">
        <div className="text-[11px] font-black uppercase tracking-[0.15em] text-zinc-700 mb-3">
          Active Subcontractors — {recipients.length} on file
        </div>
        {recipients.length === 0 && <div className="text-sm text-zinc-500 py-6 text-center">No active subcontractors found.</div>}
        {recipients.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-widest font-bold text-zinc-500 border-b border-zinc-200">
              <tr>
                <th className="text-left px-3 py-2">Company</th>
                <th className="text-left px-3 py-2">Contact</th>
                <th className="text-left px-3 py-2">Email</th>
                <th className="text-center px-3 py-2 w-32">Will Send?</th>
              </tr>
            </thead>
            <tbody>
              {recipients.map((r) => (
                <tr key={r.id} className="border-b border-zinc-100" data-testid={`recipient-${r.id}`}>
                  <td className="px-3 py-2 font-bold text-zinc-900">{r.name}</td>
                  <td className="px-3 py-2 text-zinc-700">{r.contact_name || "—"}</td>
                  <td className="px-3 py-2 font-mono text-xs text-zinc-700">{r.email || <span className="text-rose-600">no email on file</span>}</td>
                  <td className="px-3 py-2 text-center">
                    {r.will_send
                      ? <span className="inline-block px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-800 rounded-sm">Yes</span>
                      : <span className="inline-block px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-zinc-200 text-zinc-600 rounded-sm">Skipped</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* History */}
      <div className="bg-white border border-zinc-200 rounded-sm p-5">
        <div className="text-[11px] font-black uppercase tracking-[0.15em] text-zinc-700 mb-3">
          Send History — Last {history.length}
        </div>
        {history.length === 0 && <div className="text-sm text-zinc-500 py-6 text-center">No send history yet.</div>}
        {history.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-widest font-bold text-zinc-500 border-b border-zinc-200">
              <tr>
                <th className="text-left px-3 py-2">When</th>
                <th className="text-left px-3 py-2">Trigger</th>
                <th className="text-center px-3 py-2">Sent</th>
                <th className="text-center px-3 py-2">Skipped</th>
                <th className="text-center px-3 py-2">Failed</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id} className="border-b border-zinc-100" data-testid={`history-${h.id}`}>
                  <td className="px-3 py-2 font-mono text-xs">{new Date(h.sent_at).toLocaleString()}</td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-sm ${h.trigger === "manual" ? "bg-violet-100 text-violet-800" : "bg-blue-100 text-blue-800"}`}>
                      {h.trigger}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-center font-bold text-emerald-700">{h.sent_count}</td>
                  <td className="px-3 py-2 text-center text-zinc-600">{h.skipped_count}</td>
                  <td className="px-3 py-2 text-center font-bold text-rose-700">{h.failed_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-500 mb-1">{label}</label>
      {children}
    </div>
  );
}

function Kpi({ label, value, tone = "blue", icon: Icon, hint = "" }) {
  const tones = {
    blue: "border-blue-200 bg-blue-50/40 text-blue-900",
    emerald: "border-emerald-200 bg-emerald-50/40 text-emerald-900",
    zinc: "border-zinc-200 bg-zinc-50 text-zinc-700",
  };
  return (
    <div className={`border-2 rounded-sm p-3 ${tones[tone]}`}>
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest opacity-80">
        {Icon ? <Icon className="w-3.5 h-3.5" /> : null} {label}
      </div>
      <div className="text-xl font-black mt-1">{value}</div>
      {hint ? <div className="text-[10px] opacity-70 mt-0.5">{hint}</div> : null}
    </div>
  );
}
