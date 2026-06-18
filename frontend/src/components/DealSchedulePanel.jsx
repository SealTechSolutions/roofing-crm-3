import React, { useEffect, useMemo, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { CalendarDays, Plus, Trash2, Clock, MapPin, X, Bell, Repeat } from "lucide-react";
import { toast } from "sonner";

const EVENT_TYPES = ["Roof Walk", "Presentation", "Meeting", "Job Start", "Other"];
const EMOJI = {
  "Roof Walk": "🪜",
  Presentation: "📊",
  Meeting: "🤝",
  "Job Start": "🚧",
  Other: "📅",
};

const todayIso = () => new Date().toISOString().slice(0, 10);

const formatDateNice = (iso) => {
  try {
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  } catch {
    return iso;
  }
};

const formatTime = (hhmm) => {
  if (!hhmm || !hhmm.includes(":")) return "";
  const [h, m] = hhmm.split(":").map((n) => parseInt(n, 10));
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
};

export default function DealSchedulePanel({ dealId, googleConnected = false }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    title: "",
    event_type: "Roof Walk",
    date: todayIso(),
    start_time: "11:00",
    end_time: "",
    location: "",
    notes: "",
    sync_to_google: true,
    reminder_enabled: true,
    invitees: "",
  });

  const reload = async () => {
    setLoading(true);
    try {
      const r = await api.get(`/deals/${dealId}/events`);
      setEvents(r.data || []);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
  }, [dealId]);

  const upcoming = useMemo(() => {
    const today = todayIso();
    return events.filter((e) => e.date >= today);
  }, [events]);

  const past = useMemo(() => {
    const today = todayIso();
    return events.filter((e) => e.date < today).sort((a, b) => b.date.localeCompare(a.date));
  }, [events]);

  const resetForm = () => {
    setForm({
      title: "",
      event_type: "Roof Walk",
      date: todayIso(),
      start_time: "11:00",
      end_time: "",
      location: "",
      notes: "",
      sync_to_google: true,
      reminder_enabled: true,
      invitees: "",
    });
    setShowForm(false);
  };

  const submit = async (e) => {
    e?.preventDefault?.();
    if (!form.title.trim()) {
      toast.error("Title is required (e.g., 'Roof walk with adjuster')");
      return;
    }
    if (!form.date) {
      toast.error("Date is required");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        invitees: form.invitees
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      };
      await api.post(`/deals/${dealId}/events`, payload);
      toast.success(`${EMOJI[form.event_type]} ${form.event_type} scheduled${form.start_time ? ` at ${formatTime(form.start_time)}` : ""}`);
      resetForm();
      reload();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (eventId, label) => {
    if (!window.confirm(`Delete this event?\n\n${label}`)) return;
    try {
      await api.delete(`/deals/${dealId}/events/${eventId}`);
      toast.success("Event deleted");
      reload();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    }
  };

  return (
    <div className="bg-white border border-zinc-200 rounded-sm p-5 mb-8" data-testid="deal-schedule-panel">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-teal-700">Schedule</div>
          <h3 className="font-heading text-lg font-bold tracking-tight flex items-center gap-2">
            <CalendarDays className="w-5 h-5" />
            Appointments &amp; Events
          </h3>
          <div className="text-[11px] text-zinc-500 mt-0.5">
            Roof walks, presentations, job starts &mdash; tied to this deal. {googleConnected ? "Auto-syncs to Google Calendar." : ""}
          </div>
        </div>
        {!showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-2 bg-teal-700 text-white px-4 h-10 text-xs font-bold uppercase tracking-wider hover:bg-teal-800 rounded-sm transition-colors"
            data-testid="deal-schedule-new-btn"
          >
            <Plus className="w-4 h-4" />
            Schedule Event
          </button>
        )}
      </div>

      {showForm && (
        <form
          onSubmit={submit}
          className="border border-teal-200 bg-teal-50/40 rounded-sm p-4 mb-4 grid grid-cols-1 md:grid-cols-2 gap-3"
          data-testid="deal-schedule-form"
        >
          <div className="md:col-span-2 flex items-center justify-between">
            <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-teal-700">New Event</div>
            <button type="button" onClick={resetForm} className="text-zinc-500 hover:text-zinc-800" aria-label="Close">
              <X className="w-4 h-4" />
            </button>
          </div>

          <label className="text-xs">
            <div className="font-bold uppercase tracking-wider text-[10px] text-zinc-600 mb-1">Type</div>
            <select
              value={form.event_type}
              onChange={(e) => setForm({ ...form, event_type: e.target.value })}
              className="w-full border border-zinc-300 rounded-sm px-2 h-10 text-sm"
              data-testid="deal-schedule-type"
            >
              {EVENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {EMOJI[t]} {t}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs">
            <div className="font-bold uppercase tracking-wider text-[10px] text-zinc-600 mb-1">Title</div>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="e.g., Roof walk with State Farm adjuster"
              className="w-full border border-zinc-300 rounded-sm px-2 h-10 text-sm"
              data-testid="deal-schedule-title"
              autoFocus
            />
          </label>

          <label className="text-xs">
            <div className="font-bold uppercase tracking-wider text-[10px] text-zinc-600 mb-1">Date</div>
            <input
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
              className="w-full border border-zinc-300 rounded-sm px-2 h-10 text-sm"
              data-testid="deal-schedule-date"
            />
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs">
              <div className="font-bold uppercase tracking-wider text-[10px] text-zinc-600 mb-1">Start</div>
              <input
                type="time"
                value={form.start_time}
                onChange={(e) => setForm({ ...form, start_time: e.target.value })}
                className="w-full border border-zinc-300 rounded-sm px-2 h-10 text-sm"
                data-testid="deal-schedule-start"
              />
            </label>
            <label className="text-xs">
              <div className="font-bold uppercase tracking-wider text-[10px] text-zinc-600 mb-1">End (opt.)</div>
              <input
                type="time"
                value={form.end_time}
                onChange={(e) => setForm({ ...form, end_time: e.target.value })}
                className="w-full border border-zinc-300 rounded-sm px-2 h-10 text-sm"
                data-testid="deal-schedule-end"
              />
            </label>
          </div>

          <label className="text-xs md:col-span-2">
            <div className="font-bold uppercase tracking-wider text-[10px] text-zinc-600 mb-1">Location (optional)</div>
            <input
              type="text"
              value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
              placeholder="Site address or meeting link"
              className="w-full border border-zinc-300 rounded-sm px-2 h-10 text-sm"
              data-testid="deal-schedule-location"
            />
          </label>

          <label className="text-xs md:col-span-2">
            <div className="font-bold uppercase tracking-wider text-[10px] text-zinc-600 mb-1">Notes (optional)</div>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={2}
              placeholder="Anything the foreman or rep needs to know"
              className="w-full border border-zinc-300 rounded-sm px-2 py-2 text-sm"
              data-testid="deal-schedule-notes"
            />
          </label>

          <label className="text-xs md:col-span-2">
            <div className="font-bold uppercase tracking-wider text-[10px] text-zinc-600 mb-1">Email reminder to (additional, comma-separated)</div>
            <input
              type="text"
              value={form.invitees}
              onChange={(e) => setForm({ ...form, invitees: e.target.value })}
              placeholder="foreman@... , client@..."
              className="w-full border border-zinc-300 rounded-sm px-2 h-10 text-sm"
              data-testid="deal-schedule-invitees"
            />
          </label>

          <div className="md:col-span-2 flex flex-wrap items-center gap-4 pt-1">
            <label className="inline-flex items-center gap-2 text-xs cursor-pointer" data-testid="deal-schedule-sync-gcal">
              <input
                type="checkbox"
                checked={form.sync_to_google}
                onChange={(e) => setForm({ ...form, sync_to_google: e.target.checked })}
                disabled={!googleConnected}
              />
              <Repeat className="w-3.5 h-3.5" />
              <span className={!googleConnected ? "text-zinc-400" : ""}>
                Push to Google Calendar {!googleConnected && <span className="text-[10px] uppercase tracking-wider">(not connected)</span>}
              </span>
            </label>
            <label className="inline-flex items-center gap-2 text-xs cursor-pointer" data-testid="deal-schedule-reminder">
              <input
                type="checkbox"
                checked={form.reminder_enabled}
                onChange={(e) => setForm({ ...form, reminder_enabled: e.target.checked })}
              />
              <Bell className="w-3.5 h-3.5" />
              Email reminder 1 hour before + show on Dashboard
            </label>
          </div>

          <div className="md:col-span-2 flex gap-2 justify-end pt-1">
            <button
              type="button"
              onClick={resetForm}
              className="px-4 h-10 text-xs font-bold uppercase tracking-wider border border-zinc-300 rounded-sm hover:bg-zinc-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 bg-teal-700 text-white px-4 h-10 text-xs font-bold uppercase tracking-wider hover:bg-teal-800 disabled:opacity-50 rounded-sm"
              data-testid="deal-schedule-save"
            >
              {saving ? "Saving..." : "Save Event"}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500 py-2">Loading...</div>
      ) : events.length === 0 ? (
        <div className="text-sm text-zinc-500 italic py-4 text-center border border-dashed border-zinc-300 rounded-sm" data-testid="deal-schedule-empty">
          No events scheduled. Click <b>Schedule Event</b> to add a roof walk, presentation, meeting, or job start.
        </div>
      ) : (
        <div className="space-y-4">
          {upcoming.length > 0 && (
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-2">Upcoming</div>
              <ul className="divide-y divide-zinc-100 border border-zinc-200 rounded-sm">
                {upcoming.map((ev) => (
                  <EventRow key={ev.id} ev={ev} onDelete={remove} googleConnected={googleConnected} />
                ))}
              </ul>
            </div>
          )}
          {past.length > 0 && (
            <details>
              <summary className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 cursor-pointer hover:text-zinc-800">
                Past ({past.length})
              </summary>
              <ul className="divide-y divide-zinc-100 border border-zinc-200 rounded-sm mt-2 opacity-70">
                {past.map((ev) => (
                  <EventRow key={ev.id} ev={ev} onDelete={remove} googleConnected={googleConnected} past />
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function EventRow({ ev, onDelete, googleConnected, past = false }) {
  const label = `${ev.event_type}: ${ev.title || ""} on ${formatDateNice(ev.date)}`;
  return (
    <li className="flex items-start justify-between gap-3 px-4 py-3 hover:bg-zinc-50" data-testid={`deal-schedule-row-${ev.id}`}>
      <div className="flex items-start gap-3 min-w-0 flex-1">
        <div className="text-2xl leading-none" aria-hidden>
          {EMOJI[ev.event_type] || "📅"}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-teal-100 text-teal-800">
              {ev.event_type}
            </span>
            <span className="font-bold text-sm truncate">{ev.title || "—"}</span>
            {ev.google_event_id && googleConnected && (
              <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-blue-100 text-blue-800" title="Synced to Google Calendar">
                G-Cal
              </span>
            )}
          </div>
          <div className="text-xs text-zinc-600 mt-1 flex items-center gap-3 flex-wrap">
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="w-3 h-3" />
              {formatDateNice(ev.date)}
            </span>
            {ev.start_time && (
              <span className="inline-flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {formatTime(ev.start_time)}
                {ev.end_time ? ` – ${formatTime(ev.end_time)}` : ""}
              </span>
            )}
            {ev.location && (
              <span className="inline-flex items-center gap-1 truncate">
                <MapPin className="w-3 h-3" />
                {ev.location}
              </span>
            )}
          </div>
          {ev.notes && <div className="text-xs text-zinc-500 mt-1 italic truncate">{ev.notes}</div>}
        </div>
      </div>
      {!past && (
        <button
          type="button"
          onClick={() => onDelete(ev.id, label)}
          className="text-zinc-400 hover:text-red-700 p-1"
          aria-label="Delete event"
          data-testid={`deal-schedule-delete-${ev.id}`}
        >
          <Trash2 className="w-4 h-4" />
        </button>
      )}
    </li>
  );
}
