import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { toast } from "sonner";
import { CheckCircle2, AlertCircle, ExternalLink, RefreshCw, Unlink2, Calendar } from "lucide-react";

/**
 * Settings → Integrations page.
 * Currently hosts the Google Calendar Sync connection + per-event-kind mapping.
 */
export default function Integrations() {
  const [status, setStatus] = useState(null);
  const [calendars, setCalendars] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingMap, setSavingMap] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [params, setParams] = useSearchParams();

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get("/integrations/google/status");
      setStatus(r.data);
      if (r.data.connected) {
        const c = await api.get("/integrations/google/calendars");
        setCalendars(c.data.calendars || []);
        // Auto-apply suggestion if any field is empty
        const s = c.data.suggestion || {};
        const cur = r.data.settings || {};
        const patch = {};
        for (const k of ["assessment_calendar_id", "scope_calendar_id", "finance_calendar_id", "project_calendar_id", "maintenance_calendar_id"]) {
          if (!cur[k] && s[k]) patch[k] = s[k];
        }
        if (Object.keys(patch).length) {
          const saved = await api.put("/integrations/google/settings", patch);
          setStatus({ ...r.data, settings: saved.data });
        }
      }
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || "Failed to load status");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // OAuth callback redirect feedback
    const g = params.get("google");
    if (g === "connected") toast.success("Google account connected");
    else if (g === "error") toast.error(`Google connection failed (${params.get("reason") || "unknown"})`);
    if (g) {
      params.delete("google");
      params.delete("reason");
      setParams(params, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connect = async () => {
    try {
      const r = await api.post("/integrations/google/connect");
      window.location.href = r.data.authorization_url;
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || "Could not start Google OAuth");
    }
  };

  const disconnect = async () => {
    if (!window.confirm("Disconnect Google? Existing CRM events will remain on the calendar but won't update further.")) return;
    await api.post("/integrations/google/disconnect");
    toast.success("Google disconnected");
    load();
  };

  const saveMap = async (key, value) => {
    setSavingMap(true);
    try {
      const saved = await api.put("/integrations/google/settings", { [key]: value || null });
      setStatus({ ...status, settings: saved.data });
      toast.success("Mapping saved");
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || "Save failed");
    } finally {
      setSavingMap(false);
    }
  };

  const toggleEnabled = async () => {
    const enabled = !status.settings.enabled;
    const saved = await api.put("/integrations/google/settings", { enabled });
    setStatus({ ...status, settings: saved.data });
    toast.success(`Sync ${enabled ? "enabled" : "paused"}`);
  };

  const syncNow = async () => {
    setSyncing(true);
    try {
      const r = await api.post("/integrations/google/sync");
      const c = r.data.synced || {};
      toast.success(`Sync complete · ${c.deals || 0} deals · ${c.assessments || 0} assessments · ${c.maintenance || 0} maintenance · ${c.tasks || 0} tasks`);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  if (loading) return <div className="p-8 text-sm text-zinc-500">Loading integrations…</div>;
  const connected = status?.connected;
  const s = status?.settings || {};

  return (
    <div className="p-8 max-w-4xl" data-testid="integrations-page">
      <div className="mb-8 pb-6 border-b border-zinc-200">
        <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-700 mb-2">Settings</div>
        <h1 className="text-3xl font-black tracking-tight">Integrations</h1>
        <div className="text-sm text-zinc-500 mt-1">Connect SealTech CRM to your other tools.</div>
      </div>

      <div className="bg-white border border-zinc-200 rounded-sm p-6" data-testid="google-cal-card">
        <div className="flex items-start justify-between flex-wrap gap-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-sm bg-blue-50 flex items-center justify-center">
              <Calendar className="w-5 h-5 text-blue-700" />
            </div>
            <div>
              <div className="text-lg font-bold">Google Calendar</div>
              <div className="text-xs text-zinc-500">Push CRM assessments, projects, maintenance, and tasks to your Google calendars.</div>
            </div>
          </div>
          {connected ? (
            <div className="inline-flex items-center gap-1.5 px-2 py-1 bg-green-50 text-green-800 text-[10px] font-bold uppercase tracking-wider rounded-sm border border-green-200">
              <CheckCircle2 className="w-3 h-3" /> Connected · {status.google_email}
            </div>
          ) : (
            <div className="inline-flex items-center gap-1.5 px-2 py-1 bg-zinc-100 text-zinc-700 text-[10px] font-bold uppercase tracking-wider rounded-sm border border-zinc-300">
              Not Connected
            </div>
          )}
        </div>

        {!connected ? (
          <button
            onClick={connect}
            className="inline-flex items-center gap-2 h-10 px-5 bg-zinc-950 hover:bg-zinc-800 text-white text-[11px] font-bold uppercase tracking-wider rounded-sm"
            data-testid="google-connect-btn"
          >
            <ExternalLink className="w-3.5 h-3.5" /> Connect Google
          </button>
        ) : (
          <div className="space-y-5">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <label className="inline-flex items-center gap-2 text-sm font-medium" data-testid="sync-enabled-toggle">
                <input type="checkbox" checked={!!s.enabled} onChange={toggleEnabled} className="accent-blue-700 w-4 h-4" />
                Sync enabled
              </label>
              <div className="flex items-center gap-2">
                <button onClick={syncNow} disabled={syncing || !s.enabled} className="inline-flex items-center gap-1.5 h-9 px-3 border border-blue-700 text-blue-700 hover:bg-blue-50 text-[10px] font-bold uppercase tracking-wider rounded-sm disabled:opacity-50" data-testid="sync-now-btn">
                  <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} /> {syncing ? "Syncing…" : "Sync now"}
                </button>
                <button onClick={disconnect} className="inline-flex items-center gap-1.5 h-9 px-3 border border-red-700 text-red-700 hover:bg-red-50 text-[10px] font-bold uppercase tracking-wider rounded-sm" data-testid="google-disconnect-btn">
                  <Unlink2 className="w-3.5 h-3.5" /> Disconnect
                </button>
              </div>
            </div>

            <div className="border-t border-zinc-200 pt-5">
              <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-500 mb-3">Calendar Mapping</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                <MapField label="📅 Assessments" valueKey="assessment_calendar_id" value={s.assessment_calendar_id} calendars={calendars} onSave={saveMap} disabled={savingMap} testId="map-assessments" />
                <MapField label="📝 Scopes" valueKey="scope_calendar_id" value={s.scope_calendar_id} calendars={calendars} onSave={saveMap} disabled={savingMap} testId="map-scope" />
                <MapField label="💰 Finance" valueKey="finance_calendar_id" value={s.finance_calendar_id} calendars={calendars} onSave={saveMap} disabled={savingMap} testId="map-finance" />
                <MapField label="🛠 Projects" valueKey="project_calendar_id" value={s.project_calendar_id} calendars={calendars} onSave={saveMap} disabled={savingMap} testId="map-projects" />
                <MapField label="🟢 Maintenance" valueKey="maintenance_calendar_id" value={s.maintenance_calendar_id} calendars={calendars} onSave={saveMap} disabled={savingMap} testId="map-maintenance" />
              </div>
              <div className="text-[11px] text-zinc-500 mt-3">
                Each kind of CRM event pushes to its matching shared calendar so your <b>darren@</b> stays clean for selling. Auto-detected by calendar name — change anytime, saved instantly.
              </div>
            </div>

            <EmailRoutingPanel />
          </div>
        )}
      </div>
    </div>
  );
}

function MapField({ label, valueKey, value, calendars, onSave, disabled, testId }) {
  return (
    <div>
      <label className="block text-xs font-medium text-zinc-700 mb-1">{label}</label>
      <select
        value={value || ""}
        onChange={(e) => onSave(valueKey, e.target.value)}
        disabled={disabled}
        className="w-full px-2 h-9 border border-zinc-300 bg-white rounded-sm text-sm focus:outline-none focus:ring-2 focus:ring-blue-700"
        data-testid={testId}
      >
        <option value="">— Skip this kind —</option>
        {calendars.map((c) => (
          <option key={c.id} value={c.id}>
            {c.summary}{c.primary ? " (primary)" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}


// ---------------------------------------------------------------------------
// Email "Send As" routing — picks which alias each kind of outbound email
// is sent FROM. Keeps the primary darren@ inbox clean for selling.
// ---------------------------------------------------------------------------
function EmailRoutingPanel() {
  const [loading, setLoading] = React.useState(true);
  const [data, setData] = React.useState({ saved: {}, resolved: {}, categories: [], allowed_aliases: [] });
  const [draft, setDraft] = React.useState({});
  const [saving, setSaving] = React.useState(false);

  const reload = async () => {
    setLoading(true);
    try {
      const r = await api.get("/settings/email-routing");
      setData(r.data);
      setDraft(r.data.saved || {});
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    reload();
  }, []);

  if (loading) {
    return (
      <div className="border-t border-zinc-200 pt-5">
        <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-500 mb-3">Email &ldquo;Send As&rdquo; Routing</div>
        <div className="text-sm text-zinc-500 italic">Loading…</div>
      </div>
    );
  }

  const save = async () => {
    setSaving(true);
    try {
      const r = await api.put("/settings/email-routing", draft);
      setData((d) => ({ ...d, ...r.data }));
      toast.success("Email routing saved — outbound emails will now use the matching alias.");
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setSaving(false);
    }
  };

  const LABELS = {
    assessments: { icon: "📅", label: "Assessments", help: "Assessment scheduling + assessment-report emails" },
    scope:       { icon: "📝", label: "Scopes",      help: "Proposals + scope emails + sales follow-ups + stale-deal digests" },
    finance:     { icon: "💰", label: "Finance",     help: "Invoices, statements, late notices, payables reports" },
    projects:    { icon: "🛠", label: "Projects",    help: "Purchase orders, COI requests, project comms, daily status" },
    maintenance: { icon: "🟢", label: "Maintenance", help: "Maintenance visit reminders" },
  };

  const dirty = (data.categories || []).some((cat) => (draft[cat] || "") !== (data.saved?.[cat] || ""));

  return (
    <div className="border-t border-zinc-200 pt-5 mt-5" data-testid="email-routing-panel">
      <div className="flex items-end justify-between mb-3 flex-wrap gap-2">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-500">Email &ldquo;Send As&rdquo; Routing</div>
          <div className="text-[12px] text-zinc-600 mt-1 max-w-2xl">
            Each kind of outbound CRM email is sent from the matching alias so replies land in the right inbox, not your selling one. Aliases must be verified as <em>Send As</em> on your primary Gmail account.
          </div>
        </div>
        {dirty && (
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-1.5 h-9 px-4 bg-blue-700 text-white text-[10px] font-bold uppercase tracking-wider rounded-sm hover:bg-blue-800 disabled:opacity-50"
            data-testid="email-routing-save"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {(data.categories || []).map((cat) => {
          const meta = LABELS[cat] || { icon: "✉️", label: cat, help: "" };
          return (
            <div key={cat} data-testid={`email-routing-row-${cat}`}>
              <label className="block text-xs font-bold text-zinc-700 mb-1">
                <span className="mr-1">{meta.icon}</span>{meta.label}
              </label>
              <select
                value={draft[cat] || ""}
                onChange={(e) => setDraft((d) => ({ ...d, [cat]: e.target.value }))}
                className="w-full px-2 h-9 border border-zinc-300 bg-white rounded-sm text-sm focus:outline-none focus:ring-2 focus:ring-blue-700"
                data-testid={`email-routing-select-${cat}`}
              >
                <option value="">— Use primary ({data.resolved?.[cat] || "default"}) —</option>
                {(data.allowed_aliases || []).map((alias) => (
                  <option key={alias} value={alias}>{alias}</option>
                ))}
              </select>
              <div className="text-[10px] text-zinc-500 mt-1 leading-snug">{meta.help}</div>
            </div>
          );
        })}
      </div>

      {(!data.allowed_aliases || data.allowed_aliases.length === 0) && (
        <div className="mt-4 px-3 py-2 bg-amber-50 border border-amber-300 text-amber-900 text-[11px] rounded-sm">
          <b>No aliases configured.</b> Set <code>GMAIL_FROM_ALIASES</code> in the backend env to a comma-separated list of Gmail &ldquo;Send As&rdquo; addresses, then refresh.
        </div>
      )}
    </div>
  );
}
