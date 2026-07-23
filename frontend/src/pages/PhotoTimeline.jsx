import React, { useEffect, useState, useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import { Search, MapPin, Camera, ExternalLink, Filter, X, Pen, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import PhotoAnnotator from "@/components/PhotoAnnotator";

const PRESET_TAGS = ["Before", "During", "After", "Drone", "Detail Shots", "Damage Documentation"];
const TAG_TONES = {
  "Before": "bg-amber-100 text-amber-800 border-amber-300",
  "During": "bg-blue-100 text-blue-800 border-blue-300",
  "After": "bg-emerald-100 text-emerald-800 border-emerald-300",
  "Drone": "bg-violet-100 text-violet-800 border-violet-300",
  "Detail Shots": "bg-sky-100 text-sky-800 border-sky-300",
  "Damage Documentation": "bg-rose-100 text-rose-800 border-rose-300",
};

/**
 * PhotoTimeline — CompanyCam-style cross-project photo feed.
 *
 * Fetches from /api/photos/all (server sorts by captured_at desc), then
 * groups client-side into human-readable date buckets: Today, Yesterday,
 * This Week, This Month, [Month Year]. Each date section shows the photo
 * cards labeled with their parent project + tag chip so the user always
 * knows what site they're looking at without clicking through.
 *
 * Reused across the dedicated /photos page AND the future Dashboard
 * "Recent Photos" widget — the same date-grouping logic is baked into the
 * `useDateGroups` hook so both surfaces stay in sync.
 */
export default function PhotoTimeline() {
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [dayRange, setDayRange] = useState(30);
  const [lightbox, setLightbox] = useState(null);
  // Photo currently being annotated. `null` when annotator modal closed.
  const [annotating, setAnnotating] = useState(null);

  useEffect(() => {
    setLoading(true);
    api.get("/photos/all", { params: { days: dayRange, limit: 500 } })
      .then((r) => setPhotos(r.data || []))
      .finally(() => setLoading(false));
  }, [dayRange]);

  // Client-side search + tag filter. Kept in memory (no re-fetch) so
  // toggling filters feels instant even on tablets.
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return photos.filter((p) => {
      if (tagFilter && p.tag !== tagFilter) return false;
      if (!needle) return true;
      return [p.display_name, p.description, p.deal_title, p.property_name, p.property_address, p.uploader_name, p.tag]
        .filter(Boolean).some((v) => String(v).toLowerCase().includes(needle));
    });
  }, [photos, q, tagFilter]);

  const groups = useDateGroups(filtered);

  return (
    <div className="space-y-6" data-testid="photo-timeline-page">
      <div>
        <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-700 mb-1">Project Photos</div>
        <h1 className="font-heading text-3xl font-black tracking-tight flex items-center gap-3">
          <Camera className="w-7 h-7 text-blue-700" /> Photo Timeline
        </h1>
        <p className="text-sm text-zinc-600 mt-1">
          Every jobsite photo across every project, grouped by date. Newest first. Tap any photo to view full-size.
        </p>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            placeholder="Search project, address, tag, uploader…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            data-testid="photo-timeline-search"
            className="w-full h-10 pl-9 pr-3 border border-zinc-300 rounded-sm text-sm"
          />
        </div>
        {/* Day range chips */}
        <div className="flex items-center gap-1">
          {[7, 30, 90, 365].map((d) => (
            <button
              key={d}
              onClick={() => setDayRange(d)}
              data-testid={`photo-timeline-days-${d}`}
              className={`px-3 h-8 text-[10px] font-bold uppercase tracking-wider rounded-sm border ${dayRange === d ? "border-blue-700 bg-blue-700 text-white" : "border-zinc-300 text-zinc-700 hover:border-zinc-950"}`}
            >
              {d < 365 ? `${d}D` : "1Y"}
            </button>
          ))}
        </div>
        {/* Tag chips */}
        <div className="flex items-center gap-1 flex-wrap">
          <button
            onClick={() => setTagFilter("")}
            className={`px-2 h-8 text-[10px] font-bold uppercase tracking-wider rounded-sm border ${!tagFilter ? "border-zinc-950 bg-zinc-950 text-white" : "border-zinc-300 text-zinc-700 hover:border-zinc-950"}`}
          >
            All Tags
          </button>
          {PRESET_TAGS.map((t) => (
            <button
              key={t}
              onClick={() => setTagFilter(t)}
              data-testid={`photo-timeline-tag-${t.toLowerCase().replace(/\s+/g, "-")}`}
              className={`px-2 h-8 text-[10px] font-bold uppercase tracking-wider rounded-sm border transition-colors ${tagFilter === t ? "border-blue-700 bg-blue-700 text-white" : `${TAG_TONES[t] || "border-zinc-300 text-zinc-700"} hover:border-zinc-950`}`}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="text-xs text-zinc-500 ml-auto">
          <b className="text-zinc-950">{filtered.length}</b> photo{filtered.length === 1 ? "" : "s"}
        </div>
      </div>

      {/* Timeline body */}
      {loading ? (
        <div className="bg-white border border-zinc-200 rounded-sm p-12 text-center text-sm text-zinc-500">
          Loading photos…
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white border border-zinc-200 rounded-sm p-12 text-center">
          <Camera className="w-8 h-8 text-zinc-300 mx-auto mb-2" />
          <div className="text-sm text-zinc-500 mb-1">
            {photos.length === 0 ? `No photos in the last ${dayRange} days.` : "No photos match your filters."}
          </div>
          {photos.length === 0 && (
            <div className="text-xs text-zinc-400">
              Take a photo via Field Capture, or upload directly on a deal&apos;s Photos tab.
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-8">
          {groups.map((group) => (
            <section key={group.key} data-testid={`photo-timeline-group-${group.key}`}>
              <div className="sticky top-0 z-10 bg-zinc-50/90 backdrop-blur-sm py-2 mb-3 border-b border-zinc-200">
                <div className="flex items-baseline justify-between">
                  <h2 className="font-heading text-lg font-black tracking-tight">{group.label}</h2>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                    {group.photos.length} photo{group.photos.length === 1 ? "" : "s"}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                {group.photos.map((p) => (
                  <TimelineCard
                    key={p.id}
                    photo={p}
                    onView={() => setLightbox(p)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <PhotoLightbox
          photo={lightbox}
          onClose={() => setLightbox(null)}
          onAnnotate={() => { setAnnotating(lightbox); setLightbox(null); }}
        />
      )}
      {annotating && (
        <PhotoAnnotator
          dealId={annotating.deal_id}
          photo={annotating}
          onClose={() => setAnnotating(null)}
          onSaved={() => {
            setAnnotating(null);
            // Refetch so the "Marked" badge appears on the timeline card.
            setPhotos((prev) => prev.map((p) => p.id === annotating.id ? { ...p, annotated_storage_path: "pending" } : p));
          }}
        />
      )}
    </div>
  );
}

// ---------- Date grouping (shared with Dashboard widget) ----------
function useDateGroups(photos) {
  return useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const yday = new Date(today); yday.setDate(today.getDate() - 1);
    const weekAgo = new Date(today); weekAgo.setDate(today.getDate() - 6);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthName = (d) => d.toLocaleDateString(undefined, { month: "long", year: "numeric" });

    const bucket = (d) => {
      if (d >= today) return { key: "today", label: "Today", sort: 5 };
      if (d >= yday) return { key: "yesterday", label: "Yesterday", sort: 4 };
      if (d >= weekAgo) return { key: "this-week", label: "This Week", sort: 3 };
      if (d >= monthStart) return { key: "this-month", label: "This Month", sort: 2 };
      // Older photos bucket by month/year (e.g. "January 2026")
      const k = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, "0")}`;
      return { key: k, label: monthName(d), sort: -(d.getFullYear() * 12 + d.getMonth()) };
    };

    const map = new Map();
    for (const p of photos) {
      const stamp = p.captured_at || p.created_at;
      const d = stamp ? new Date(stamp) : new Date(0);
      const dOnly = new Date(d); dOnly.setHours(0, 0, 0, 0);
      const b = bucket(dOnly);
      if (!map.has(b.key)) map.set(b.key, { ...b, photos: [] });
      map.get(b.key).photos.push(p);
    }
    // Within a bucket, keep the server-provided newest-first order.
    return Array.from(map.values()).sort((a, b) => b.sort - a.sort);
  }, [photos]);
}

// ---------- Individual photo card (lazy-loaded thumbnail) ----------
function TimelineCard({ photo, onView }) {
  const [src, setSrc] = useState(null);
  const [visible, setVisible] = useState(false);
  const ref = useRef(null);

  // IntersectionObserver so a 500-photo timeline doesn't fire 500 auth'd
  // download requests up-front — cards fetch their blob only when they
  // scroll near the viewport.
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) setVisible(true); });
    }, { rootMargin: "300px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return undefined;
    let mounted = true;
    let url = null;
    // Timeline card grid uses ?thumb=1 (600px JPEG) for fast list rendering;
    // full-resolution image loads only when the user opens the lightbox.
    api.get(`/projects/${photo.deal_id}/photos/${photo.id}/download?thumb=1`, { responseType: "blob" })
      .then((r) => {
        if (!mounted) return;
        url = URL.createObjectURL(r.data);
        setSrc(url);
      })
      .catch(() => { /* placeholder */ });
    return () => { mounted = false; if (url) URL.revokeObjectURL(url); };
  }, [visible, photo.id, photo.deal_id]);

  const stamp = photo.captured_at || photo.created_at;
  const timeStr = stamp
    ? new Date(stamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : "";

  return (
    <div ref={ref} className="group relative bg-zinc-50 border border-zinc-200 rounded-sm overflow-hidden" data-testid={`timeline-card-${photo.id}`}>
      <button
        type="button"
        onClick={onView}
        className="w-full aspect-square bg-zinc-200 relative overflow-hidden"
      >
        {src ? (
          <img src={src} alt={photo.display_name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Camera className="w-6 h-6 text-zinc-400" />
          </div>
        )}
        {/* Tag chip overlay */}
        {photo.tag && (
          <span className={`absolute top-1 left-1 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded-sm border ${TAG_TONES[photo.tag] || "bg-zinc-100 text-zinc-700 border-zinc-300"}`}>
            {photo.tag}
          </span>
        )}
        {/* Annotated badge — shows if the photo has arrow/circle/text markup */}
        {photo.annotated_storage_path && (
          <span
            className="absolute bottom-1 left-1 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded-sm bg-emerald-500 text-white inline-flex items-center gap-0.5"
            title="Has annotations"
            data-testid={`timeline-annotated-${photo.id}`}
          >
            <Pen className="w-2.5 h-2.5" /> Marked
          </span>
        )}
        {/* Time-of-day overlay */}
        {timeStr && (
          <span className="absolute top-1 right-1 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded-sm bg-black/60 text-white">
            {timeStr}
          </span>
        )}
      </button>
      <div className="p-2">
        <Link
          to={`/deals/${photo.deal_id}`}
          className="text-[11px] font-bold text-zinc-950 hover:text-blue-700 flex items-center gap-1 leading-tight"
          data-testid={`timeline-card-deal-${photo.id}`}
        >
          <span className="truncate">{photo.deal_title || "(untitled project)"}</span>
          <ExternalLink className="w-2.5 h-2.5 shrink-0" />
        </Link>
        {(photo.property_name || photo.property_address) && (
          <div className="text-[10px] text-zinc-500 flex items-center gap-1 mt-0.5 truncate">
            <MapPin className="w-2.5 h-2.5 shrink-0" />
            <span className="truncate">{photo.property_name || photo.property_address}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Lightbox (full-size photo view) ----------
function PhotoLightbox({ photo, onClose, onAnnotate }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let mounted = true;
    let url = null;
    api.get(`/projects/${photo.deal_id}/photos/${photo.id}/download`, { responseType: "blob" })
      .then((r) => { if (mounted) { url = URL.createObjectURL(r.data); setSrc(url); } });
    return () => { mounted = false; if (url) URL.revokeObjectURL(url); };
  }, [photo.id, photo.deal_id]);
  const stamp = photo.captured_at || photo.created_at;
  const stampStr = stamp ? new Date(stamp).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "";
  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4" onClick={onClose} data-testid="timeline-lightbox">
      <div className="max-w-6xl w-full max-h-[92vh] flex flex-col items-center" onClick={(e) => e.stopPropagation()}>
        <div className="self-stretch flex items-center justify-between mb-2">
          {onAnnotate && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onAnnotate(); }}
              className="inline-flex items-center gap-1.5 px-3 h-9 text-[11px] font-bold uppercase tracking-wider bg-emerald-600 text-white hover:bg-emerald-500 rounded-sm"
              data-testid="timeline-lightbox-annotate"
            >
              <Pen className="w-3.5 h-3.5" /> Annotate
            </button>
          )}
          <button onClick={onClose} className="ml-auto p-2 text-white/70 hover:text-white" data-testid="lightbox-close"><X className="w-5 h-5" /></button>
        </div>
        {src ? (
          <img src={src} alt={photo.display_name} className="max-h-[75vh] max-w-full object-contain" />
        ) : (
          <div className="text-white/60">Loading…</div>
        )}
        <div className="mt-4 bg-white/10 backdrop-blur-sm text-white px-4 py-3 rounded-sm text-sm max-w-3xl">
          <div className="flex items-center gap-2 mb-1">
            {photo.tag && (
              <span className={`inline-flex items-center px-2 h-5 text-[9px] font-bold uppercase tracking-wider rounded-sm ${TAG_TONES[photo.tag] || "bg-zinc-200 text-zinc-800"}`}>{photo.tag}</span>
            )}
            <Link to={`/deals/${photo.deal_id}`} className="font-bold hover:text-blue-300 inline-flex items-center gap-1">
              {photo.deal_title} <ExternalLink className="w-3 h-3" />
            </Link>
          </div>
          {(photo.property_name || photo.property_address) && (
            <div className="text-[11px] text-white/70 flex items-center gap-1"><MapPin className="w-3 h-3" /> {photo.property_name || photo.property_address}</div>
          )}
          <div className="text-[11px] text-white/70 mt-1">{stampStr} {photo.uploader_name && ` · ${photo.uploader_name}`}</div>
          {photo.description && <div className="text-xs text-white/90 mt-2 italic">&ldquo;{photo.description}&rdquo;</div>}
        </div>
      </div>
    </div>
  );
}
