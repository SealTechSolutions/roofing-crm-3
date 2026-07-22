import React, { useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { toast } from "sonner";
import { GitCompareArrows, X, Loader2, Camera, ArrowLeftRight } from "lucide-react";

/**
 * BeforeAfterPairPanel — CompanyCam-style before/after view for a deal.
 *
 * Two entry points:
 *   1) Inline panel above ProjectPhotos: lists existing pairs as
 *      side-by-side thumbnails, with a slider modal on click.
 *   2) `PhotoPairPicker` (below) — opens from the photo card, lets the
 *      user select a partner photo to pair with, and picks the role.
 *
 * Backend contract (see project_photos.py):
 *   GET  /api/projects/:dealId/photos/pairs
 *   PUT  /api/projects/:dealId/photos/:photoId/pair
 *        body: {paired_photo_id, role: "before" | "after"}
 *        or   {paired_photo_id: null}  → un-pair
 */
export default function BeforeAfterPairPanel({ dealId, refreshKey }) {
  const [pairs, setPairs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState(null);   // pair currently open in fullscreen slider

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get(`/projects/${dealId}/photos/pairs`);
      setPairs(Array.isArray(r.data) ? r.data : []);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [dealId, refreshKey]);

  if (!loading && pairs.length === 0) return null;   // hide entire panel when empty

  return (
    <div className="rounded-sm border border-emerald-200 bg-emerald-50/40 p-4" data-testid="before-after-panel">
      <div className="flex items-center gap-2 mb-3">
        <GitCompareArrows className="w-4 h-4 text-emerald-700" />
        <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-emerald-800">
          Before / After Pairs
        </div>
        <div className="text-xs text-emerald-700 ml-1">
          {pairs.length} {pairs.length === 1 ? "pair" : "pairs"}
        </div>
      </div>
      {loading ? (
        <div className="text-xs text-zinc-500 inline-flex items-center gap-1.5">
          <Loader2 className="w-3 h-3 animate-spin" /> loading pairs…
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {pairs.map((p) => (
            <PairThumb
              key={`${p.before.id}-${p.after.id}`}
              dealId={dealId}
              pair={p}
              onOpen={() => setView(p)}
            />
          ))}
        </div>
      )}
      {view && <PairSliderModal dealId={dealId} pair={view} onClose={() => setView(null)} />}
    </div>
  );
}

// ---------------- PairThumb: side-by-side preview card ----------------
function PairThumb({ dealId, pair, onOpen }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group text-left rounded-sm border border-emerald-200 bg-white overflow-hidden hover:border-emerald-500 hover:shadow-md transition"
      data-testid={`pair-thumb-${pair.before.id}`}
    >
      <div className="grid grid-cols-2">
        <PairThumbSide dealId={dealId} photo={pair.before} label="Before" />
        <PairThumbSide dealId={dealId} photo={pair.after}  label="After" />
      </div>
      <div className="px-2.5 py-1.5 flex items-center justify-between text-[10px] text-zinc-600">
        <span className="font-bold uppercase tracking-wider">
          {(pair.before.tag || pair.after.tag) ? (pair.before.tag || pair.after.tag) : "Comparison"}
        </span>
        <span className="text-emerald-700 inline-flex items-center gap-1">
          <ArrowLeftRight className="w-3 h-3" /> Slide to compare
        </span>
      </div>
    </button>
  );
}

function PairThumbSide({ dealId, photo, label }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let url = null;
    api.get(`/projects/${dealId}/photos/${photo.id}/download?thumb=1`, { responseType: "blob" })
      .then((r) => { url = URL.createObjectURL(r.data); setSrc(url); })
      .catch(() => {});
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [dealId, photo.id]);
  return (
    <div className="relative aspect-square bg-zinc-100 overflow-hidden">
      {src
        ? <img src={src} alt={photo.display_name || label} className="w-full h-full object-cover" />
        : <div className="w-full h-full flex items-center justify-center text-zinc-400"><Camera className="w-5 h-5" /></div>
      }
      <span className={`absolute top-1 left-1 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded-sm ${label === "Before" ? "bg-rose-600 text-white" : "bg-emerald-600 text-white"}`}>
        {label}
      </span>
    </div>
  );
}

// ---------------- PairSliderModal: fullscreen slider comparison ----------------
function PairSliderModal({ dealId, pair, onClose }) {
  const [beforeSrc, setBeforeSrc] = useState(null);
  const [afterSrc, setAfterSrc]   = useState(null);
  // Slider position in percent (0 = show only "before", 100 = show only "after").
  // Starts at 50 so the reveal effect is centered.
  const [pos, setPos] = useState(50);

  useEffect(() => {
    let urls = [];
    Promise.all([
      api.get(`/projects/${dealId}/photos/${pair.before.id}/download`, { responseType: "blob" })
        .then((r) => { const u = URL.createObjectURL(r.data); urls.push(u); setBeforeSrc(u); }),
      api.get(`/projects/${dealId}/photos/${pair.after.id}/download`, { responseType: "blob" })
        .then((r) => { const u = URL.createObjectURL(r.data); urls.push(u); setAfterSrc(u); }),
    ]).catch(() => {});
    return () => { urls.forEach((u) => URL.revokeObjectURL(u)); };
  }, [dealId, pair.before.id, pair.after.id]);

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/90 flex flex-col"
      onClick={onClose}
      data-testid="pair-slider-modal"
    >
      <div className="flex items-center justify-between px-4 py-3">
        <div className="text-white text-sm font-bold">Before / After comparison</div>
        <button onClick={onClose} className="text-white/70 hover:text-white p-1" data-testid="pair-slider-close">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div
        className="flex-1 flex items-center justify-center p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative w-full max-w-5xl aspect-video max-h-[80vh] bg-zinc-800 overflow-hidden select-none">
          {/* Before image (fills entire area) */}
          {beforeSrc && (
            <img
              src={beforeSrc}
              alt="Before"
              className="absolute inset-0 w-full h-full object-contain"
              draggable={false}
            />
          )}
          {/* After image (clipped to the slider position — only right side visible) */}
          {afterSrc && (
            <img
              src={afterSrc}
              alt="After"
              className="absolute inset-0 w-full h-full object-contain"
              style={{ clipPath: `inset(0 0 0 ${pos}%)` }}
              draggable={false}
            />
          )}

          {/* Slider handle line */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-white shadow-[0_0_10px_rgba(0,0,0,0.7)]"
            style={{ left: `${pos}%`, transform: "translateX(-50%)" }}
          />
          <div
            className="absolute top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white shadow-lg flex items-center justify-center"
            style={{ left: `${pos}%`, transform: "translate(-50%, -50%)" }}
          >
            <ArrowLeftRight className="w-4 h-4 text-zinc-700" />
          </div>

          {/* Labels */}
          <span className="absolute top-3 left-3 px-2 py-1 text-[10px] font-bold uppercase tracking-wider rounded-sm bg-rose-600 text-white">
            Before
          </span>
          <span className="absolute top-3 right-3 px-2 py-1 text-[10px] font-bold uppercase tracking-wider rounded-sm bg-emerald-600 text-white">
            After
          </span>

          {/* Range slider overlay — invisible track but drives `pos` state.
              Sitting on top of the images lets the user drag anywhere in the
              frame with mouse or touch (touch-action:none prevents scroll). */}
          <input
            type="range"
            min={0}
            max={100}
            value={pos}
            onChange={(e) => setPos(Number(e.target.value))}
            className="absolute inset-0 w-full h-full opacity-0 cursor-ew-resize"
            style={{ touchAction: "none" }}
            aria-label="Before / after comparison slider"
            data-testid="pair-slider-input"
          />
        </div>
      </div>

      <div className="px-4 py-3 text-center text-xs text-zinc-400" onClick={(e) => e.stopPropagation()}>
        Drag the slider or use ← → arrow keys · Position: {pos}%
      </div>
    </div>
  );
}

// ---------------- Photo pair picker (used inside PhotoCard menu) ----------------
/**
 * Modal that lets the user pick another photo on the same deal to pair
 * this one with. The current photo's role can be flipped between Before
 * and After — backend enforces the partner gets the opposite role.
 */
export function PhotoPairPicker({ dealId, photo, onClose, onPaired }) {
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState("before"); // this photo's role
  const [saving, setSaving] = useState(false);
  const [thumbs, setThumbs] = useState({});   // {photoId: objectUrl}

  useEffect(() => {
    let mounted = true;
    let urls = [];
    (async () => {
      setLoading(true);
      try {
        const r = await api.get(`/projects/${dealId}/photos`);
        const all = Array.isArray(r.data) ? r.data : [];
        // Exclude self + already-paired photos so the user can't create
        // three-way pairs or accidentally overwrite existing links.
        const list = all.filter((p) => p.id !== photo.id && !p.paired_photo_id);
        if (mounted) setCandidates(list);
        // Lazily load thumbnails for the first ~24 candidates.
        for (const p of list.slice(0, 24)) {
          try {
            // Pair picker candidates use thumb (600px JPEG) — the picker
            // shows up to 24 small tiles, doesn't need full-res.
            const rr = await api.get(`/projects/${dealId}/photos/${p.id}/download?thumb=1`, { responseType: "blob" });
            const u = URL.createObjectURL(rr.data);
            urls.push(u);
            if (mounted) setThumbs((prev) => ({ ...prev, [p.id]: u }));
          } catch { /* swallow */ }
        }
      } catch (e) {
        toast.error(formatApiError(e?.response?.data?.detail) || e.message);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; urls.forEach((u) => URL.revokeObjectURL(u)); };
  }, [dealId, photo.id]);

  const save = async (partnerId) => {
    if (saving) return;
    setSaving(true);
    try {
      await api.put(`/projects/${dealId}/photos/${photo.id}/pair`, {
        paired_photo_id: partnerId,
        role,
      });
      toast.success("Photos paired");
      onPaired && onPaired();
      onClose && onClose();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message || "Pair failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[65] bg-black/70 flex items-center justify-center p-4"
      onClick={onClose}
      data-testid="pair-picker"
    >
      <div
        className="bg-white w-full max-w-3xl max-h-[85vh] rounded-sm overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-zinc-200 flex items-center justify-between">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-blue-700 mb-0.5">
              Pair with another photo
            </div>
            <div className="text-xs text-zinc-500 truncate">
              This photo: <b>{photo.display_name || photo.original_filename || "Untitled"}</b>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1 text-zinc-500 hover:text-zinc-800" data-testid="pair-picker-close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-zinc-200 bg-zinc-50 flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-600">This photo is the:</span>
          <div className="inline-flex rounded-sm border border-zinc-300 overflow-hidden">
            <button
              type="button"
              onClick={() => setRole("before")}
              className={`h-8 px-3 text-[10px] font-bold uppercase tracking-wider ${role === "before" ? "bg-rose-600 text-white" : "bg-white text-zinc-700 hover:bg-zinc-100"}`}
              data-testid="pair-role-before"
            >Before</button>
            <button
              type="button"
              onClick={() => setRole("after")}
              className={`h-8 px-3 text-[10px] font-bold uppercase tracking-wider ${role === "after" ? "bg-emerald-600 text-white" : "bg-white text-zinc-700 hover:bg-zinc-100"}`}
              data-testid="pair-role-after"
            >After</button>
          </div>
          <span className="text-[10px] text-zinc-500 ml-2">
            Partner will be labelled <b>{role === "before" ? "After" : "Before"}</b>.
          </span>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="text-xs text-zinc-500 inline-flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin" /> loading photos on this deal…
            </div>
          ) : candidates.length === 0 ? (
            <div className="text-xs text-zinc-500">
              No other unpaired photos on this deal yet. Take another photo (Before or After) then come back to pair.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {candidates.slice(0, 24).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  disabled={saving}
                  onClick={() => save(p.id)}
                  className="group text-left rounded-sm border border-zinc-200 overflow-hidden hover:border-blue-500 hover:shadow-md transition disabled:opacity-50"
                  data-testid={`pair-candidate-${p.id}`}
                  title={p.display_name || ""}
                >
                  <div className="aspect-square bg-zinc-100">
                    {thumbs[p.id]
                      ? <img src={thumbs[p.id]} alt="" className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex items-center justify-center text-zinc-300"><Camera className="w-5 h-5" /></div>
                    }
                  </div>
                  <div className="px-2 py-1.5">
                    <div className="text-[10px] font-bold text-zinc-800 truncate">{p.display_name || "Untitled"}</div>
                    <div className="text-[9px] text-zinc-500">{p.tag || (p.captured_at || p.created_at || "").slice(0, 10)}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {photo.paired_photo_id && (
          <div className="px-5 py-3 border-t border-zinc-200 bg-rose-50 flex items-center justify-between">
            <div className="text-xs text-rose-800">This photo is already paired.</div>
            <button
              type="button"
              onClick={() => save(null)}
              disabled={saving}
              className="h-8 px-3 text-[10px] font-bold uppercase tracking-wider bg-white border border-rose-600 text-rose-700 hover:bg-rose-100 rounded-sm"
              data-testid="pair-unpair"
            >Un-pair</button>
          </div>
        )}
      </div>
    </div>
  );
}
