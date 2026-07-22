import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { toast } from "sonner";
import {
  Camera, MapPin, ArrowRight, CheckCircle2, AlertCircle,
  Send, Tag, ChevronDown, ChevronUp, Loader2, ClipboardCheck,
} from "lucide-react";

/**
 * SiteVisitWrapUp — end-of-day cleanup screen for field reps.
 *
 * Renders one card per deal the user shot photos on today (or in the last
 * N days). Each card shows:
 *   • deal title + property address
 *   • photo count + counters (untagged, no-description, annotated, paired)
 *   • "Add Tags" quick chip (bulk-tags untagged photos in one API call)
 *   • "Send Report" button (fires the Condition Report email)
 *   • "Open deal" link
 *
 * The pending-actions pip (yellow dot) shows on cards with missing
 * metadata OR whose latest photo was shot AFTER the last condition
 * report — so once you shoot new photos, the deal re-flags itself as
 * needing follow-up even if you already sent a report earlier in the day.
 *
 * Mobile-first: cards stack vertically, all tap targets are ≥40px, chips
 * wrap on narrow screens. This is the screen a rep opens right after
 * closing his truck door.
 */

const PRESET_TAGS = [
  { key: "Damage Documentation", tone: "bg-rose-600 hover:bg-rose-700 text-white" },
  { key: "Before",               tone: "bg-blue-700 hover:bg-blue-800 text-white" },
  { key: "During",               tone: "bg-amber-600 hover:bg-amber-700 text-white" },
  { key: "After",                tone: "bg-emerald-600 hover:bg-emerald-700 text-white" },
  { key: "Drone",                tone: "bg-sky-600 hover:bg-sky-700 text-white" },
  { key: "Detail Shots",         tone: "bg-zinc-700 hover:bg-zinc-800 text-white" },
];

export default function SiteVisitWrapUp() {
  const [days, setDays] = useState(1);
  const [visits, setVisits] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get(`/site-visits/today?days=${days}`);
      setVisits(Array.isArray(r.data) ? r.data : []);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [days]);

  const pending = visits.filter((v) => v.has_pending_actions).length;
  const clean = visits.length - pending;

  return (
    <div className="min-h-screen bg-zinc-50" data-testid="site-visit-wrap-up">
      {/* Header */}
      <div className="bg-white border-b border-zinc-200 px-4 sm:px-6 py-4 sticky top-0 z-10">
        <div className="flex items-center justify-between max-w-4xl mx-auto">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-emerald-700 mb-0.5 flex items-center gap-1.5">
              <ClipboardCheck className="w-3.5 h-3.5" /> Wrap-Up
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-zinc-900">Finish Site Visit</h1>
            <div className="text-xs text-zinc-500 mt-0.5">
              {loading ? "Loading…" : `${visits.length} deal${visits.length === 1 ? "" : "s"} · ${pending} needs attention · ${clean} ready`}
            </div>
          </div>
          {/* Range selector */}
          <div className="inline-flex rounded-sm border border-zinc-300 overflow-hidden text-[10px] font-bold uppercase tracking-wider">
            {[1, 3, 7].map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`h-9 px-3 ${days === d ? "bg-emerald-700 text-white" : "bg-white text-zinc-700 hover:bg-zinc-50"}`}
                data-testid={`wrap-range-${d}`}
              >
                {d === 1 ? "Today" : `${d}D`}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Cards */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
        {loading ? (
          <div className="text-sm text-zinc-500 flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading site visits…
          </div>
        ) : visits.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-3">
            {visits.map((v) => (
              <SiteVisitCard key={v.deal_id} visit={v} onChanged={load} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="text-center py-16">
      <Camera className="w-10 h-10 mx-auto text-zinc-300 mb-3" />
      <div className="text-lg font-bold text-zinc-800">No site visits yet</div>
      <div className="text-sm text-zinc-500 mt-1 max-w-md mx-auto">
        Once you take photos on a deal, they&apos;ll show up here. This screen is your end-of-day cleanup —
        add missing tags, send condition reports, and close out projects in one place.
      </div>
      <Link
        to="/field-capture"
        className="inline-flex items-center gap-1.5 mt-6 px-4 h-10 text-[11px] font-bold uppercase tracking-wider bg-emerald-700 text-white hover:bg-emerald-800 rounded-sm"
      >
        Start capturing <ArrowRight className="w-4 h-4" />
      </Link>
    </div>
  );
}

function SiteVisitCard({ visit, onChanged }) {
  const [expanded, setExpanded] = useState(visit.has_pending_actions);
  const [tagging, setTagging] = useState(false);
  const [sending, setSending] = useState(false);

  const applyTag = async (tag) => {
    if (tagging || visit.untagged_count === 0) return;
    setTagging(true);
    try {
      const r = await api.put(`/deals/${visit.deal_id}/photos/bulk-tag`, {
        tag,
        days: 1, // only tag today's un-tagged photos so we don't clobber older stuff
      });
      toast.success(`Tagged ${r.data?.tagged || 0} photos as "${tag}"`);
      onChanged && onChanged();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message || "Tag failed");
    } finally {
      setTagging(false);
    }
  };

  const sendReport = async () => {
    if (sending) return;
    setSending(true);
    try {
      const r = await api.post(`/deals/${visit.deal_id}/condition-report/email`, {
        // Backend auto-fills to_email from the deal's primary contact
      });
      const d = r.data || {};
      toast.success(`Sent to ${d.to || "customer"} · ${d.photos_included} photos`, { duration: 6000 });
      onChanged && onChanged();
    } catch (e) {
      const msg = formatApiError(e?.response?.data?.detail) || e.message || "Send failed";
      toast.error(msg, { duration: 8000 });
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className={`rounded-sm border overflow-hidden bg-white ${visit.has_pending_actions ? "border-amber-400 shadow-sm" : "border-zinc-200"}`}
      data-testid={`site-visit-card-${visit.deal_id}`}
    >
      {/* Card header — tap to expand */}
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="w-full text-left px-4 py-3 flex items-start justify-between gap-3 hover:bg-zinc-50"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            {visit.has_pending_actions ? (
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" data-testid={`pending-pip-${visit.deal_id}`} />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            )}
            <div className="text-sm font-bold text-zinc-900 truncate">{visit.deal_title}</div>
          </div>
          {visit.property_address && (
            <div className="text-xs text-zinc-500 flex items-center gap-1 pl-6">
              <MapPin className="w-3 h-3" /> {visit.property_address}
            </div>
          )}
          <div className="mt-2 pl-6 flex items-center gap-2 flex-wrap text-[10px] font-bold uppercase tracking-wider">
            <span className="px-1.5 py-0.5 rounded-sm bg-zinc-100 text-zinc-700">
              {visit.photo_count} photo{visit.photo_count === 1 ? "" : "s"}
            </span>
            {visit.untagged_count > 0 && (
              <span className="px-1.5 py-0.5 rounded-sm bg-amber-100 text-amber-800">
                {visit.untagged_count} untagged
              </span>
            )}
            {visit.no_description_count > 0 && (
              <span className="px-1.5 py-0.5 rounded-sm bg-blue-100 text-blue-800">
                {visit.no_description_count} no caption
              </span>
            )}
            {visit.annotated_count > 0 && (
              <span className="px-1.5 py-0.5 rounded-sm bg-emerald-100 text-emerald-800">
                {visit.annotated_count} annotated
              </span>
            )}
            {visit.paired_count > 0 && (
              <span className="px-1.5 py-0.5 rounded-sm bg-emerald-100 text-emerald-800">
                {visit.paired_count} paired
              </span>
            )}
            {visit.last_condition_report_sent_at && (
              <span className="px-1.5 py-0.5 rounded-sm bg-emerald-50 text-emerald-700 border border-emerald-200">
                Report sent {new Date(visit.last_condition_report_sent_at).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-zinc-400 shrink-0 mt-1" /> : <ChevronDown className="w-4 h-4 text-zinc-400 shrink-0 mt-1" />}
      </button>

      {/* Expanded actions */}
      {expanded && (
        <div className="px-4 py-3 border-t border-zinc-100 bg-zinc-50/50 space-y-3">
          {/* Bulk tag chips — only show when untagged photos exist */}
          {visit.untagged_count > 0 && (
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-500 mb-2 flex items-center gap-1.5">
                <Tag className="w-3 h-3" /> Tag {visit.untagged_count} untagged photo{visit.untagged_count === 1 ? "" : "s"} as…
              </div>
              <div className="flex flex-wrap gap-1.5">
                {PRESET_TAGS.map((t) => (
                  <button
                    key={t.key}
                    onClick={() => applyTag(t.key)}
                    disabled={tagging}
                    className={`px-3 h-10 text-[11px] font-bold uppercase tracking-wider rounded-sm disabled:opacity-50 ${t.tone}`}
                    data-testid={`wrap-tag-${visit.deal_id}-${t.key.replace(/\s+/g, '_')}`}
                  >
                    {t.key}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Action row */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              onClick={sendReport}
              disabled={sending || visit.photo_count === 0}
              className="inline-flex items-center gap-1.5 h-10 px-4 text-[11px] font-bold uppercase tracking-wider bg-emerald-700 text-white hover:bg-emerald-800 rounded-sm disabled:opacity-50"
              data-testid={`wrap-send-${visit.deal_id}`}
            >
              {sending ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Sending…</> : <><Send className="w-3.5 h-3.5" /> Send condition report</>}
            </button>
            <Link
              to={`/deals/${visit.deal_id}#project-photos`}
              className="inline-flex items-center gap-1.5 h-10 px-3 text-[11px] font-bold uppercase tracking-wider border border-zinc-300 text-zinc-700 hover:bg-white rounded-sm"
              data-testid={`wrap-open-${visit.deal_id}`}
            >
              Open deal <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
