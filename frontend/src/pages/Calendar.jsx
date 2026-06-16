import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, formatApiError, formatCurrency } from "@/lib/api";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Calendar as CalIcon, X, ExternalLink } from "lucide-react";

/**
 * Project Calendar — month + week views.
 * Color-coded event feed driven by GET /api/calendar?start=&end=
 *
 *   project        - cobalt blue   - drag to reschedule
 *   material_order - amber         - drag to reschedule
 *   maintenance    - green         - read-only
 *   coi_expiry     - red           - read-only
 *   invoice_due    - purple        - read-only
 *
 * UX:
 *   - Single click on event → popover with details + "Open in CRM" link
 *   - Double click on event → navigates to the related record
 *   - Drag a project / material order event onto a new day → PUT /api/deals/{id}
 *     (only events with kind: project | material_order are draggable; the bar
 *     moves by the delta in days so duration is preserved.)
 */

const KIND_LABEL = {
  project: "Project",
  material_order: "Material Order",
  maintenance: "Maintenance",
  coi_expiry: "COI Expiration",
  invoice_due: "Invoice Due",
};

const LEGEND = [
  { kind: "project", label: "Project (scheduled)", color: "#1D4ED8" },
  { kind: "material_order", label: "Material Order", color: "#D97706" },
  { kind: "maintenance", label: "Maintenance", color: "#16A34A" },
  { kind: "coi_expiry", label: "COI Expiration", color: "#B91C1C" },
  { kind: "invoice_due", label: "Invoice Due", color: "#7E22CE" },
];

// ---------- date helpers (no timezone shenanigans — work in YYYY-MM-DD strings) ----------
const pad = (n) => String(n).padStart(2, "0");
const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseISO = (s) => {
  if (!s) return null;
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (iso, n) => {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
};
const diffDays = (a, b) => Math.round((parseISO(a) - parseISO(b)) / 86400000);
const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
const endOfMonth = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0);
const startOfWeek = (d) => {
  const x = new Date(d);
  const day = x.getDay(); // 0 = Sun
  x.setDate(x.getDate() - day);
  return x;
};
const endOfWeek = (d) => {
  const x = startOfWeek(d);
  x.setDate(x.getDate() + 6);
  return x;
};

// Build grid days for a given month: 6-week (42 day) grid starting Sunday
function buildMonthGrid(refDate) {
  const first = startOfMonth(refDate);
  const gridStart = startOfWeek(first);
  const days = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    days.push(d);
  }
  return days;
}

function buildWeekGrid(refDate) {
  const start = startOfWeek(refDate);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push(d);
  }
  return days;
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export default function Calendar() {
  const nav = useNavigate();
  const [view, setView] = useState("month"); // month | week
  const [cursor, setCursor] = useState(new Date()); // anchor date for nav
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [popover, setPopover] = useState(null); // { event, x, y }
  const [filters, setFilters] = useState({ project: true, material_order: true, maintenance: true, coi_expiry: true, invoice_due: true });

  // Window we fetch (always pad a little so dragging across edges still shows context)
  const range = useMemo(() => {
    if (view === "week") {
      return { start: toISO(startOfWeek(cursor)), end: toISO(endOfWeek(cursor)) };
    }
    const gridStartISO = toISO(startOfWeek(startOfMonth(cursor)));
    return { start: gridStartISO, end: addDays(gridStartISO, 41) };
  }, [view, cursor]);

  const fetchEvents = async () => {
    setLoading(true);
    try {
      const r = await api.get("/calendar", { params: range });
      setEvents(r.data || []);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || "Failed to load calendar");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.start, range.end]);

  // ---------- Drag-to-reschedule ----------
  const draggingRef = useRef(null);
  const onDragStart = (e, ev) => {
    if (ev.kind !== "project" && ev.kind !== "material_order") {
      e.preventDefault();
      return;
    }
    draggingRef.current = ev;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", ev.id);
  };
  const onDayDragOver = (e) => {
    if (!draggingRef.current) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };
  const onDayDrop = async (e, targetISO) => {
    e.preventDefault();
    const ev = draggingRef.current;
    draggingRef.current = null;
    if (!ev) return;
    if (ev.start === targetISO && ev.kind === "material_order") return;
    try {
      if (ev.kind === "material_order") {
        await api.put(`/deals/${ev.deal_id}/schedule`, { material_order_date: targetISO });
        toast.success(`Material order moved to ${targetISO}`);
      } else if (ev.kind === "project") {
        // Preserve duration when sliding the bar
        const delta = diffDays(targetISO, ev.start);
        if (delta === 0) return;
        const newStart = targetISO;
        const newEnd = ev.end ? addDays(ev.end, delta) : targetISO;
        await api.put(`/deals/${ev.deal_id}/schedule`, { scheduled_start_date: newStart, scheduled_end_date: newEnd });
        toast.success(`Project rescheduled to ${newStart} → ${newEnd}`);
      }
      await fetchEvents();
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Reschedule failed");
    }
  };

  // ---------- Event click → popover (single), dbl-click → navigate ----------
  const eventHref = (ev) => {
    if (ev.deal_id) return `/deals/${ev.deal_id}`;
    if (ev.vendor_id) return `/subcontractors`;
    if (ev.invoice_id) return `/invoices`;
    return null;
  };
  const onEventClick = (e, ev) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setPopover({ event: ev, x: rect.left + rect.width / 2, y: rect.bottom + 8 });
  };
  const onEventDblClick = (e, ev) => {
    e.stopPropagation();
    const href = eventHref(ev);
    if (href) nav(href);
  };

  // Filter visible events
  const visible = useMemo(() => events.filter((ev) => filters[ev.kind]), [events, filters]);

  // Group events by day for fast rendering
  const eventsByDay = useMemo(() => {
    const map = {};
    for (const ev of visible) {
      if (ev.kind === "project" && ev.end && ev.end !== ev.start) {
        let d = ev.start;
        let guard = 0;
        while (d <= ev.end && guard++ < 365) {
          (map[d] ||= []).push({ ...ev, _spanDay: d, _isStart: d === ev.start, _isEnd: d === ev.end });
          d = addDays(d, 1);
        }
      } else {
        (map[ev.start] ||= []).push(ev);
      }
    }
    return map;
  }, [visible]);

  const goPrev = () => {
    const d = new Date(cursor);
    if (view === "week") d.setDate(d.getDate() - 7);
    else d.setMonth(d.getMonth() - 1);
    setCursor(d);
  };
  const goNext = () => {
    const d = new Date(cursor);
    if (view === "week") d.setDate(d.getDate() + 7);
    else d.setMonth(d.getMonth() + 1);
    setCursor(d);
  };
  const goToday = () => setCursor(new Date());

  const headerLabel = useMemo(() => {
    if (view === "week") {
      const s = startOfWeek(cursor), e = endOfWeek(cursor);
      const sameMo = s.getMonth() === e.getMonth();
      return sameMo
        ? `${MONTH_NAMES[s.getMonth()]} ${s.getDate()}–${e.getDate()}, ${e.getFullYear()}`
        : `${MONTH_NAMES[s.getMonth()]} ${s.getDate()} – ${MONTH_NAMES[e.getMonth()]} ${e.getDate()}, ${e.getFullYear()}`;
    }
    return `${MONTH_NAMES[cursor.getMonth()]} ${cursor.getFullYear()}`;
  }, [cursor, view]);

  const days = view === "week" ? buildWeekGrid(cursor) : buildMonthGrid(cursor);
  const todayISO = toISO(new Date());

  return (
    <div className="p-8" data-testid="calendar-page" onClick={() => setPopover(null)}>
      <div className="flex items-end justify-between mb-6 flex-wrap gap-4">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 mb-1">Schedule</div>
          <h1 className="text-3xl font-black tracking-tight flex items-center gap-3">
            <CalIcon className="w-7 h-7 text-blue-700" /> Project Calendar
          </h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded-sm border border-zinc-300 overflow-hidden" data-testid="calendar-view-toggle">
            <button onClick={() => setView("month")} className={`px-3 h-8 text-[10px] font-bold uppercase tracking-wider ${view === "month" ? "bg-zinc-950 text-white" : "bg-white hover:bg-zinc-50"}`} data-testid="view-month">Month</button>
            <button onClick={() => setView("week")} className={`px-3 h-8 text-[10px] font-bold uppercase tracking-wider ${view === "week" ? "bg-zinc-950 text-white" : "bg-white hover:bg-zinc-50"}`} data-testid="view-week">Week</button>
          </div>
          <button onClick={goPrev} className="p-1.5 border border-zinc-300 bg-white hover:bg-zinc-50 rounded-sm" data-testid="cal-prev" aria-label="Previous"><ChevronLeft className="w-4 h-4" /></button>
          <button onClick={goToday} className="px-3 h-8 text-[10px] font-bold uppercase tracking-wider border border-zinc-300 bg-white hover:bg-zinc-50 rounded-sm" data-testid="cal-today">Today</button>
          <button onClick={goNext} className="p-1.5 border border-zinc-300 bg-white hover:bg-zinc-50 rounded-sm" data-testid="cal-next" aria-label="Next"><ChevronRight className="w-4 h-4" /></button>
        </div>
      </div>

      <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
        <div className="text-xl font-bold tracking-tight" data-testid="cal-header-label">{headerLabel}</div>
        <div className="flex items-center gap-3 flex-wrap">
          {LEGEND.map((l) => (
            <label key={l.kind} className="inline-flex items-center gap-1.5 text-[11px] cursor-pointer select-none" data-testid={`filter-${l.kind}`}>
              <input type="checkbox" checked={!!filters[l.kind]} onChange={(e) => setFilters((f) => ({ ...f, [l.kind]: e.target.checked }))} />
              <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: l.color }} />
              <span className="text-zinc-700 font-medium">{l.label}</span>
            </label>
          ))}
        </div>
      </div>

      <div className={`bg-white border border-zinc-200 rounded-sm overflow-hidden ${loading ? "opacity-60" : ""}`}>
        {/* Weekday header */}
        <div className="grid grid-cols-7 border-b border-zinc-200 bg-zinc-50">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} className="px-2 py-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500 text-center">{d}</div>
          ))}
        </div>
        {/* Day grid */}
        <div className={`grid grid-cols-7 ${view === "week" ? "" : ""}`}>
          {days.map((d) => {
            const iso = toISO(d);
            const inMonth = view === "week" ? true : d.getMonth() === cursor.getMonth();
            const dayEvents = eventsByDay[iso] || [];
            const isToday = iso === todayISO;
            return (
              <div
                key={iso}
                onDragOver={onDayDragOver}
                onDrop={(e) => onDayDrop(e, iso)}
                className={`border-r border-b border-zinc-100 ${view === "week" ? "min-h-[480px]" : "min-h-[120px]"} p-1.5 ${inMonth ? "bg-white" : "bg-zinc-50/60"} ${isToday ? "ring-2 ring-inset ring-blue-500" : ""}`}
                data-testid={`cal-day-${iso}`}
              >
                <div className={`text-[11px] font-bold mb-1 ${inMonth ? "text-zinc-800" : "text-zinc-400"} ${isToday ? "text-blue-700" : ""}`}>
                  {d.getDate()}
                </div>
                <div className="space-y-1">
                  {dayEvents.slice(0, view === "week" ? 30 : 5).map((ev, i) => {
                    const isBar = ev.kind === "project";
                    const radiusL = isBar && !ev._isStart ? "rounded-l-none" : "";
                    const radiusR = isBar && !ev._isEnd ? "rounded-r-none" : "";
                    const draggable = ev.kind === "project" || ev.kind === "material_order";
                    return (
                      <div
                        key={`${ev.id}-${i}`}
                        draggable={draggable}
                        onDragStart={(e) => onDragStart(e, ev)}
                        onClick={(e) => onEventClick(e, ev)}
                        onDoubleClick={(e) => onEventDblClick(e, ev)}
                        title={ev.title}
                        className={`text-[10px] px-1.5 py-0.5 rounded-sm text-white font-semibold truncate cursor-pointer hover:opacity-90 ${radiusL} ${radiusR} ${draggable ? "shadow-sm" : ""}`}
                        style={{ background: ev.color, opacity: ev.tentative ? 0.55 : 1 }}
                        data-testid={`cal-event-${ev.kind}-${ev.id}`}
                      >
                        {isBar ? (ev._isStart ? ev.title : "↪") : ev.title}
                      </div>
                    );
                  })}
                  {dayEvents.length > (view === "week" ? 30 : 5) && (
                    <div className="text-[9px] text-zinc-500 font-medium pl-1">+ {dayEvents.length - 5} more</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Popover */}
      {popover && (
        <div
          className="fixed z-50 w-72 bg-white border border-zinc-300 rounded-sm shadow-2xl"
          style={{ left: Math.min(popover.x - 144, window.innerWidth - 300), top: Math.min(popover.y, window.innerHeight - 220) }}
          onClick={(e) => e.stopPropagation()}
          data-testid="cal-popover"
        >
          <div className="flex items-center justify-between px-3 py-2 border-b-2 border-zinc-950" style={{ background: popover.event.color }}>
            <div className="text-[10px] font-bold uppercase tracking-widest text-white">{KIND_LABEL[popover.event.kind] || "Event"}</div>
            <button onClick={() => setPopover(null)} className="p-0.5 hover:bg-white/20 rounded-sm" data-testid="cal-popover-close"><X className="w-3 h-3 text-white" /></button>
          </div>
          <div className="p-3 space-y-2">
            <div className="text-sm font-bold leading-snug">{popover.event.title}</div>
            <div className="text-[11px] text-zinc-600">
              {popover.event.start === popover.event.end || !popover.event.end
                ? popover.event.start
                : `${popover.event.start} → ${popover.event.end}`}
            </div>
            {popover.event.amount > 0 && (
              <div className="text-[11px] text-zinc-700"><span className="text-zinc-500 uppercase font-bold tracking-widest text-[9px]">Amount</span> · <span className="font-mono font-bold">{formatCurrency(popover.event.amount)}</span></div>
            )}
            {popover.event.status && (
              <div className="text-[11px] text-zinc-700"><span className="text-zinc-500 uppercase font-bold tracking-widest text-[9px]">Status</span> · {popover.event.status}</div>
            )}
            {popover.event.tentative && <div className="text-[10px] text-amber-700 italic">Tentative (not yet logged)</div>}
            {eventHref(popover.event) && (
              <button
                onClick={() => { nav(eventHref(popover.event)); setPopover(null); }}
                className="w-full inline-flex items-center justify-center gap-1.5 mt-1 h-8 text-[10px] font-bold uppercase tracking-wider bg-zinc-950 text-white hover:bg-zinc-800 rounded-sm"
                data-testid="cal-popover-open"
              >
                <ExternalLink className="w-3 h-3" /> Open in CRM
              </button>
            )}
          </div>
        </div>
      )}

      <div className="mt-4 text-[11px] text-zinc-500">
        Tip: drag a <span className="font-bold" style={{ color: "#1D4ED8" }}>project bar</span> or <span className="font-bold" style={{ color: "#D97706" }}>material order</span> onto a new day to reschedule. Double-click any event to open it.
      </div>
    </div>
  );
}
