import React, { useEffect, useRef, useState, useMemo } from "react";
import { api, formatApiError } from "@/lib/api";
import { toast } from "sonner";
import { Camera, Upload, Trash2, Share2, X, Download, Image as ImageIcon, Star, Link2, Copy, Eye, EyeOff, FileText, Pen } from "lucide-react";
import CameraCaptureButton from "@/components/CameraCaptureButton";
import PhotoAnnotator from "@/components/PhotoAnnotator";

const PRESET_TAGS = [
  "Before",
  "During",
  "After",
  "Drone",
  "Detail Shots",
  "Damage Documentation",
];
const TAG_TONES = {
  "Before": "bg-amber-100 text-amber-800",
  "During": "bg-blue-100 text-blue-800",
  "After": "bg-emerald-100 text-emerald-800",
  "Drone": "bg-violet-100 text-violet-800",
  "Detail Shots": "bg-sky-100 text-sky-800",
  "Damage Documentation": "bg-rose-100 text-rose-800",
};

export default function ProjectPhotos({ dealId, dealTitle }) {
  const [photos, setPhotos] = useState([]);
  const [albumFilter, setAlbumFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [uploading, setUploading] = useState(false);
  const [editing, setEditing] = useState(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  // Photo currently being annotated (arrows/circles/text markup). Null =
  // annotator modal closed.
  const [annotating, setAnnotating] = useState(null);
  // Chronological grouping: "asc" = oldest-first (matches before → during →
  // after narrative); "desc" = newest-first.
  const [sortOrder, setSortOrder] = useState("asc");
  // Multi-select: lets the user batch-move shots taken this morning into
  // the right album in one click instead of editing each one individually.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkMoveTarget, setBulkMoveTarget] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0 });
  // Bulk "Set capture date" — fixes the common case of emailed/uploaded
  // photos that arrive without EXIF (or with the wrong EXIF) and stack on
  // the upload date instead of the day they were actually shot. The rep
  // picks a YYYY-MM-DD; backend normalizes it to noon UTC so the day
  // header lands cleanly.
  const [bulkCapturedAt, setBulkCapturedAt] = useState("");
  const fileInputRef = useRef(null);

  const toggleSelect = (id) => {
    setSelectedIds((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const clearSelection = () => { setSelectedIds(new Set()); setSelectMode(false); setBulkMoveTarget(""); };

  const selectAllVisible = (visible) => {
    setSelectedIds(new Set(visible.map((p) => p.id)));
  };

  const bulkSetTag = async (newTag) => {
    if (!selectedIds.size) return;
    setBulkBusy(true);
    const ids = Array.from(selectedIds);
    setBulkProgress({ done: 0, total: ids.length });
    let ok = 0;
    let failed = 0;
    const CONCURRENCY = 4;
    const queue = ids.slice();
    const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      while (queue.length) {
        const id = queue.shift();
        try {
          // Empty string clears the tag — backend accepts that
          await api.patch(`/projects/${dealId}/photos/${id}`, { tag: newTag });
          ok += 1;
        } catch (err) {
          failed += 1;
          console.warn("[photos] bulk tag failed for", id, err?.response?.status);
        }
        setBulkProgress((p) => ({ done: p.done + 1, total: p.total }));
      }
    });
    await Promise.all(workers);
    const label = newTag ? `→ ${newTag}` : "(tag cleared)";
    if (failed > 0) toast.warning(`Tagged ${ok} · ${failed} failed ${label}`);
    else toast.success(`Tagged ${ok} photo${ok === 1 ? "" : "s"} ${label}`);
    clearSelection();
    setBulkBusy(false);
    setBulkProgress({ done: 0, total: 0 });
    load();
  };

  const bulkMove = async (targetAlbum) => {    if (!selectedIds.size) return;
    if (!targetAlbum || !targetAlbum.trim()) { toast.error("Pick an album"); return; }
    setBulkBusy(true);
    const ids = Array.from(selectedIds);
    try {
      // Sequential to keep server load gentle on field-LTE connections.
      let ok = 0;
      for (const id of ids) {
        try {
          await api.patch(`/projects/${dealId}/photos/${id}`, { album_name: targetAlbum.trim() });
          ok += 1;
        } catch { /* swallow per-photo */ }
      }
      toast.success(`Moved ${ok} of ${ids.length} photo${ids.length === 1 ? "" : "s"} → ${targetAlbum}`);
      clearSelection();
      load();
    } finally {
      setBulkBusy(false);
    }
  };

  const bulkDelete = async () => {
    if (!selectedIds.size) return;
    if (!window.confirm(`Delete ${selectedIds.size} photo${selectedIds.size === 1 ? "" : "s"}?`)) return;
    setBulkBusy(true);
    const ids = Array.from(selectedIds);
    let ok = 0;
    for (const id of ids) {
      try { await api.delete(`/projects/${dealId}/photos/${id}`); ok += 1; } catch { /* swallow */ }
    }
    toast.success(`Deleted ${ok} of ${ids.length}`);
    clearSelection();
    setBulkBusy(false);
    load();
  };

  // Bulk-set `captured_at` for selected photos. Re-anchors photos to the day
  // they were actually shot so the timeline stops bunching everything under
  // the upload date (the typical "Mary emailed me a roll from Tuesday" case).
  const bulkSetCapturedAt = async () => {
    if (!selectedIds.size) return;
    if (!bulkCapturedAt) { toast.error("Pick a date first"); return; }
    setBulkBusy(true);
    try {
      const r = await api.patch(`/projects/${dealId}/photos-bulk`, {
        ids: Array.from(selectedIds),
        captured_at: bulkCapturedAt,
      });
      toast.success(`Re-dated ${r?.data?.matched_count ?? selectedIds.size} photo${selectedIds.size === 1 ? "" : "s"} → ${bulkCapturedAt}`);
      clearSelection();
      setBulkCapturedAt("");
      load();
    } catch (e) {
      toast.error(formatApiError(e) || "Could not update capture dates");
    } finally {
      setBulkBusy(false);
    }
  };

  // Download a single photo to the user's hard drive (Paint / Macromedia /
  // wherever) — uses the auth'd /download endpoint and triggers a browser
  // save-as dialog via a hidden anchor.
  const downloadPhoto = async (photo) => {
    try {
      const r = await api.get(`/projects/${dealId}/photos/${photo.id}/download`, { responseType: "blob" });
      const url = URL.createObjectURL(r.data);
      const ext = (photo.content_type || "image/jpeg").split("/").pop().split("+")[0] || "jpg";
      const base = (photo.display_name || photo.original_filename || "photo").replace(/\.[^.]+$/, "");
      const a = document.createElement("a");
      a.href = url;
      a.download = `${base}.${ext}`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    }
  };

  const load = async () => {
    try {
      const r = await api.get(`/projects/${dealId}/photos`);
      setPhotos(r.data || []);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [dealId]);

  const albums = useMemo(() => {
    const set = new Set(photos.map((p) => p.album_name || "Default"));
    return ["Default", ...Array.from(set).filter((a) => a && a !== "Default")];
  }, [photos]);

  const filtered = useMemo(
    () => photos.filter((p) =>
      (!albumFilter || (p.album_name || "Default") === albumFilter) &&
      (!tagFilter || p.tag === tagFilter)
    ),
    [photos, albumFilter, tagFilter]
  );

  /**
   * Group filtered photos by **captured_at** (the EXIF/camera shutter time
   * extracted at upload). Falls back to `created_at` (upload time) when a
   * photo has no captured_at — typically true for old uploads from before
   * EXIF extraction was wired up. Returns `{ key, label, photos: [] }` sorted
   * by `sortOrder` — oldest-first by default so the gallery reads as a
   * natural before → during → after timeline of the actual job site.
   */
  const dateGroups = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    const fmtLabel = (d) => {
      const dayKey = d.toISOString().slice(0, 10);
      const todayKey = today.toISOString().slice(0, 10);
      const yKey = yesterday.toISOString().slice(0, 10);
      if (dayKey === todayKey) return "Today";
      if (dayKey === yKey) return "Yesterday";
      return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
    };
    const buckets = new Map();
    for (const p of filtered) {
      // captured_at = true shutter time (EXIF). Fall back to created_at
      // (upload time) for legacy rows so they still show somewhere on the
      // timeline instead of disappearing into "No date".
      const stamp = p.captured_at || p.created_at;
      const d = stamp ? new Date(stamp) : new Date(0);
      const dayKey = isNaN(d.getTime()) ? "unknown" : d.toISOString().slice(0, 10);
      if (!buckets.has(dayKey)) {
        buckets.set(dayKey, { key: dayKey, label: dayKey === "unknown" ? "No date" : fmtLabel(d), photos: [], ts: d.getTime() || 0 });
      }
      buckets.get(dayKey).photos.push(p);
    }
    // Sort photos within a day by capture/upload timestamp (same fallback
    // hierarchy) so 9:14 am shows before 11:32 am within the same date row.
    const groups = Array.from(buckets.values()).map((g) => ({
      ...g,
      photos: g.photos.slice().sort((a, b) =>
        String(a.captured_at || a.created_at || "").localeCompare(String(b.captured_at || b.created_at || ""))
      ),
    }));
    groups.sort((a, b) => sortOrder === "asc" ? a.ts - b.ts : b.ts - a.ts);
    return groups;
  }, [filtered, sortOrder]);

  const uploadFiles = async (files) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    const albumName = albumFilter || "Default";
    let ok = 0, fail = 0;
    for (const f of Array.from(files)) {
      const fd = new FormData();
      fd.append("file", f);
      fd.append("album_name", albumName);
      if (tagFilter) fd.append("tag", tagFilter);
      try {
        await api.post(`/projects/${dealId}/photos`, fd, { headers: { "Content-Type": "multipart/form-data" } });
        ok++;
      } catch (e) {
        fail++;
        toast.error(`${f.name}: ${formatApiError(e?.response?.data?.detail) || e.message}`);
      }
    }
    setUploading(false);
    if (ok) toast.success(`Uploaded ${ok} photo${ok === 1 ? "" : "s"}${fail ? ` · ${fail} failed` : ""}`);
    if (fileInputRef.current) fileInputRef.current.value = "";
    load();
  };

  const removePhoto = async (p) => {
    if (!window.confirm(`Delete "${p.display_name}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/projects/${dealId}/photos/${p.id}`);
      toast.success("Photo deleted");
      load();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    }
  };

  const setCover = async (p) => {
    try {
      await api.patch(`/projects/${dealId}/photos/${p.id}`, { is_cover: !p.is_cover });
      toast.success(p.is_cover ? "Removed as cover photo" : "Set as cover photo (will appear on PDFs)");
      load();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    }
  };

  /**
   * Triggers the Progress Timeline PDF download. Honors the current album +
   * tag filters so the user can export e.g. only "Drone" or only "After" shots.
   * Uses the auth token from localStorage to make an authenticated fetch
   * (needed because anchor downloads don't carry our Authorization header).
   */
  const downloadTimelinePdf = async () => {
    try {
      const params = new URLSearchParams();
      if (albumFilter) params.set("album_name", albumFilter);
      if (tagFilter) params.set("tag", tagFilter);
      const r = await api.get(
        `/projects/${dealId}/photos/timeline.pdf${params.toString() ? `?${params}` : ""}`,
        { responseType: "blob" }
      );
      const url = URL.createObjectURL(r.data);
      const a = document.createElement("a");
      a.href = url;
      const safe = (dealTitle || "Project").replace(/[^a-z0-9\- _]/gi, "_");
      a.download = `${safe} - Progress Timeline.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success("Timeline PDF downloaded");
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message || "Could not generate PDF");
    }
  };

  const totalSize = photos.reduce((s, p) => s + (p.size || 0), 0);

  return (
    <div className="bg-white border border-zinc-200 rounded-sm p-6 mb-6" data-testid="project-photos">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Camera className="w-5 h-5 text-blue-700" />
          <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-700">
            Project Photos · {photos.length} <span className="text-zinc-400">({(totalSize / (1024 * 1024)).toFixed(1)} MB)</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            data-testid="timeline-pdf-btn"
            onClick={downloadTimelinePdf}
            disabled={photos.length === 0}
            title="Generate a date-stamped PDF album of all photos"
            className="inline-flex items-center gap-1.5 px-3 h-9 text-[10px] font-bold uppercase tracking-wider bg-white border border-zinc-700 text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 rounded-sm"
          >
            <FileText className="w-3.5 h-3.5" /> Timeline PDF
          </button>
          <button
            data-testid="open-share-photos-btn"
            onClick={() => setShareOpen(true)}
            disabled={photos.length === 0}
            className="inline-flex items-center gap-1.5 px-3 h-9 text-[10px] font-bold uppercase tracking-wider bg-white border border-blue-700 text-blue-700 hover:bg-blue-50 disabled:opacity-40 rounded-sm"
          >
            <Share2 className="w-3.5 h-3.5" /> Share with Customer
          </button>
          <CameraCaptureButton onFiles={uploadFiles} disabled={uploading} testId="camera-photo-btn" />
          <label className="inline-flex items-center gap-1.5 px-3 h-9 text-[10px] font-bold uppercase tracking-wider bg-blue-700 text-white hover:bg-blue-800 rounded-sm cursor-pointer">
            <Upload className="w-3.5 h-3.5" /> {uploading ? "Uploading..." : "Upload Photos"}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              data-testid="upload-photo-input"
              onChange={(e) => uploadFiles(e.target.files)}
              disabled={uploading}
            />
          </label>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <select
          value={albumFilter}
          onChange={(e) => setAlbumFilter(e.target.value)}
          className="h-8 px-2 border border-zinc-300 text-xs rounded-sm bg-white"
          data-testid="album-filter"
        >
          <option value="">All Albums ({photos.length})</option>
          {albums.map((a) => {
            const n = photos.filter((p) => (p.album_name || "Default") === a).length;
            return <option key={a} value={a}>{a} ({n})</option>;
          })}
        </select>
        <select
          value={tagFilter}
          onChange={(e) => setTagFilter(e.target.value)}
          className="h-8 px-2 border border-zinc-300 text-xs rounded-sm bg-white"
          data-testid="tag-filter"
        >
          <option value="">All Tags</option>
          {PRESET_TAGS.map((t) => {
            const n = photos.filter((p) => p.tag === t).length;
            return <option key={t} value={t}>{t} ({n})</option>;
          })}
        </select>
        <CustomAlbumInput onCreate={(name) => setAlbumFilter(name)} />
        <button
          type="button"
          onClick={() => { if (selectMode) clearSelection(); else setSelectMode(true); }}
          className={"h-8 px-3 text-[10px] font-bold uppercase tracking-wider rounded-sm border " + (selectMode ? "bg-blue-700 text-white border-blue-700" : "bg-white border-zinc-300 text-zinc-700 hover:bg-zinc-50")}
          data-testid="photos-select-toggle"
        >
          {selectMode ? `Cancel (${selectedIds.size})` : "Select"}
        </button>
        {selectMode && (
          <button
            type="button"
            onClick={() => selectAllVisible(filtered)}
            className="h-8 px-3 text-[10px] font-bold uppercase tracking-wider rounded-sm border bg-white border-zinc-300 text-zinc-700 hover:bg-zinc-50"
            data-testid="photos-select-all"
          >
            Select all visible
          </button>
        )}
        <div className="ml-auto inline-flex items-center gap-1 border border-zinc-300 rounded-sm bg-white overflow-hidden">
          <span className="px-2 text-[10px] font-bold uppercase tracking-wider text-zinc-500">Order</span>
          <button
            type="button"
            onClick={() => setSortOrder("asc")}
            className={"h-8 px-2.5 text-[10px] font-bold uppercase tracking-wider " + (sortOrder === "asc" ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100")}
            data-testid="photos-order-asc"
            title="Before → During → After"
          >
            Oldest first
          </button>
          <button
            type="button"
            onClick={() => setSortOrder("desc")}
            className={"h-8 px-2.5 text-[10px] font-bold uppercase tracking-wider " + (sortOrder === "desc" ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100")}
            data-testid="photos-order-desc"
            title="Newest first"
          >
            Newest first
          </button>
        </div>
      </div>

      {/* Bulk-action bar — sticky just below filters when any photo selected */}
      {selectMode && selectedIds.size > 0 && (
        <div className="sticky top-0 z-20 mb-4 bg-blue-700 text-white rounded-sm px-4 py-3 shadow-md" data-testid="photos-bulk-bar">
          <div className="flex items-center gap-4 flex-wrap">
            <span className="text-[11px] font-bold uppercase tracking-wider whitespace-nowrap">
              {selectedIds.size} selected
            </span>

            {/* Action 1: Move to album */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-blue-200 text-[10px] uppercase tracking-wider font-bold">Move to album →</span>
              <select
                value={bulkMoveTarget}
                onChange={(e) => setBulkMoveTarget(e.target.value)}
                disabled={bulkBusy}
                className="h-8 px-2 text-xs text-zinc-900 bg-white border-0 rounded-sm font-bold disabled:opacity-50"
                data-testid="photos-bulk-target"
              >
                <option value="">— pick album —</option>
                {albums.map((a) => <option key={a} value={a}>{a}</option>)}
                <option value="__new__">+ New album…</option>
              </select>
              <button
                type="button"
                disabled={!bulkMoveTarget || bulkBusy}
                onClick={async () => {
                  let target = bulkMoveTarget;
                  if (target === "__new__") {
                    const name = window.prompt("New album name:");
                    if (!name || !name.trim()) return;
                    target = name.trim();
                  }
                  await bulkMove(target);
                }}
                className="h-8 px-3 text-[10px] font-bold uppercase tracking-wider bg-white text-blue-700 hover:bg-blue-50 disabled:opacity-50 rounded-sm"
                data-testid="photos-bulk-move"
              >
                {bulkBusy ? (bulkProgress.total > 0 ? `Moving ${bulkProgress.done}/${bulkProgress.total}…` : "Moving…") : "Move"}
              </button>
            </div>

            {/* Separator */}
            <div className="h-6 w-px bg-blue-500/60" />

            {/* Action 2: Set tag */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-blue-200 text-[10px] uppercase tracking-wider font-bold">Tag as →</span>
              {PRESET_TAGS.map((t) => (
                <button
                  key={t}
                  type="button"
                  disabled={bulkBusy}
                  onClick={() => bulkSetTag(t)}
                  className={`h-7 px-2 text-[10px] font-bold uppercase tracking-wider rounded-sm border border-white/40 hover:bg-white hover:text-blue-700 disabled:opacity-50 ${TAG_TONES[t] ? "bg-white/15 text-white" : "bg-white/15 text-white"}`}
                  data-testid={`photos-bulk-tag-${t.replace(/\s+/g, "-").toLowerCase()}`}
                  title={`Tag all ${selectedIds.size} selected photos as ${t}`}
                >
                  {t}
                </button>
              ))}
              <button
                type="button"
                disabled={bulkBusy}
                onClick={() => bulkSetTag("")}
                className="h-7 px-2 text-[10px] uppercase tracking-wider text-blue-200 hover:text-white disabled:opacity-50"
                title="Clear tag from selected photos"
                data-testid="photos-bulk-tag-clear"
              >
                Clear tag
              </button>
            </div>

            {/* Separator */}
            <div className="h-6 w-px bg-blue-500/60" />

            {/* Action 3: Set capture date — fixes the "emailed photos all
                stack on the upload date" mess. Backend normalizes the
                YYYY-MM-DD to noon UTC so day-headers line up cleanly. */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-blue-200 text-[10px] uppercase tracking-wider font-bold whitespace-nowrap">Set capture date →</span>
              <input
                type="date"
                value={bulkCapturedAt}
                onChange={(e) => setBulkCapturedAt(e.target.value)}
                disabled={bulkBusy}
                className="h-8 px-2 text-xs text-zinc-900 bg-white border-0 rounded-sm font-bold disabled:opacity-50"
                data-testid="photos-bulk-captured-at"
                title="Re-anchors all selected photos to this date so they cluster under the right day on the timeline."
              />
              <button
                type="button"
                disabled={!bulkCapturedAt || bulkBusy}
                onClick={bulkSetCapturedAt}
                className="h-8 px-3 text-[10px] font-bold uppercase tracking-wider bg-white text-blue-700 hover:bg-blue-50 disabled:opacity-50 rounded-sm"
                data-testid="photos-bulk-set-date"
              >
                {bulkBusy ? "Setting…" : "Apply"}
              </button>
            </div>

            <button
              type="button"
              disabled={bulkBusy}
              onClick={bulkDelete}
              className="h-8 px-3 text-[10px] font-bold uppercase tracking-wider bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50 rounded-sm ml-auto"
              data-testid="photos-bulk-delete"
            >
              <Trash2 className="w-3 h-3 inline -mt-0.5" /> Delete
            </button>
            <button
              type="button"
              onClick={clearSelection}
              disabled={bulkBusy}
              className="text-blue-200 hover:text-white text-[10px] uppercase tracking-wider disabled:opacity-50"
            >
              Clear
            </button>
          </div>
          {bulkBusy && bulkProgress.total > 0 && (
            <div className="mt-2 text-[10px] text-blue-100">{bulkProgress.done} / {bulkProgress.total} photos updated</div>
          )}
        </div>
      )}

      {/* Grid grouped by date */}
      {filtered.length === 0 ? (
        <div className="py-16 text-center text-sm text-zinc-500 border-2 border-dashed border-zinc-200 rounded-sm" data-testid="photos-empty-state">
          <ImageIcon className="w-8 h-8 mx-auto text-zinc-300 mb-2" />
          {photos.length === 0 ? (
            "No photos uploaded yet. Drag-drop multiple images or use the Upload Photos button above."
          ) : (
            <>
              <div className="mb-3">
                No photos match the current filter
                {albumFilter && <> in album <b className="text-zinc-700">{albumFilter}</b></>}
                {tagFilter && <> tagged <b className="text-zinc-700">{tagFilter}</b></>}
                .
              </div>
              <div className="text-[11px] text-zinc-500 mb-3">
                {photos.length} total photo{photos.length === 1 ? "" : "s"} in this project.
              </div>
              <button
                type="button"
                onClick={() => { setAlbumFilter(""); setTagFilter(""); }}
                className="inline-flex items-center gap-1.5 h-8 px-3 text-[11px] font-bold uppercase tracking-wider bg-blue-700 text-white rounded-sm hover:bg-blue-800"
                data-testid="photos-clear-filters"
              >
                Clear filters → show all {photos.length}
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-6" data-testid="photo-grid">
          {dateGroups.map((group) => (
            <section key={group.key} data-testid={`photos-date-group-${group.key}`}>
              <h3 className="flex items-center gap-3 mb-2.5">
                <span className="text-xs font-bold uppercase tracking-[0.15em] text-zinc-900">{group.label}</span>
                <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                  {group.photos.length} {group.photos.length === 1 ? "photo" : "photos"}
                </span>
                <span className="flex-1 h-px bg-zinc-200" />
              </h3>
              <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-7 lg:grid-cols-8 xl:grid-cols-9 2xl:grid-cols-10 gap-1.5" data-testid="photo-grid-row">
                {group.photos.map((p) => (
                  <PhotoCard
                    key={p.id}
                    photo={p}
                    selected={selectedIds.has(p.id)}
                    selectMode={selectMode}
                    onView={() => setLightbox(p)}
                    onEdit={() => setEditing(p)}
                    onDelete={() => removePhoto(p)}
                    onToggleCover={() => setCover(p)}
                    onToggleSelect={() => toggleSelect(p.id)}
                    onDownload={() => downloadPhoto(p)}
                    onAnnotate={() => setAnnotating(p)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {editing && (
        <EditPhotoModal
          dealId={dealId}
          photo={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
      {shareOpen && (
        <ShareModal
          dealId={dealId}
          dealTitle={dealTitle}
          albums={albums}
          onClose={() => setShareOpen(false)}
        />
      )}
      {lightbox && (
        <Lightbox
          dealId={dealId}
          photo={lightbox}
          onClose={() => setLightbox(null)}
          onAnnotate={() => { setAnnotating(lightbox); setLightbox(null); }}
        />
      )}
      {annotating && (
        <PhotoAnnotator
          dealId={dealId}
          photo={annotating}
          onClose={() => setAnnotating(null)}
          onSaved={() => { setAnnotating(null); load(); }}
        />
      )}
    </div>
  );
}

// ============ Photo Card ============
function PhotoCard({ photo, onView, onEdit, onDelete, onToggleCover, selected, selectMode, onToggleSelect, onDownload }) {
  const [src, setSrc] = useState(null);
  // Only fetch the JPEG once the card is actually visible (or about to be).
  // Without this every card in the gallery fires a 0.5-1.2 MB blob download
  // on mount, which on a project with 30+ photos saturates the user's LTE
  // and makes the page feel "stuck". IntersectionObserver gives us native,
  // zero-dependency lazy-load with a 200px pre-load margin so scrolling
  // feels instant. Browsers that don't support IO (none in practice) fall
  // back to the eager fetch.
  const cardRef = useRef(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (visible) return undefined;
    if (typeof IntersectionObserver === "undefined") { setVisible(true); return undefined; }
    const el = cardRef.current;
    if (!el) return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible) return undefined;
    // Load via auth'd download endpoint; produces a blob URL we can put in <img>
    let mounted = true;
    let url = null;
    api.get(`/projects/${photo.deal_id}/photos/${photo.id}/download`, { responseType: "blob" })
      .then((r) => {
        if (!mounted) return;
        url = URL.createObjectURL(r.data);
        setSrc(url);
      })
      .catch(() => { /* show broken-image placeholder */ });
    return () => { mounted = false; if (url) URL.revokeObjectURL(url); };
  }, [visible, photo.id, photo.deal_id]);

  const handleClick = () => {
    if (selectMode) { onToggleSelect && onToggleSelect(); }
    else { onView(); }
  };

  return (
    <div
      ref={cardRef}
      className={"group relative bg-zinc-50 border rounded-sm overflow-hidden " + (selected ? "border-blue-700 ring-2 ring-blue-300" : "border-zinc-200")}
      data-testid={`photo-card-${photo.id}`}
    >
      <div className="aspect-[4/3] bg-zinc-200 cursor-pointer" onClick={handleClick}>
        {src ? (
          <img src={src} alt={photo.display_name} className={"w-full h-full object-cover " + (selectMode && !selected ? "opacity-70" : "")} />
        ) : (
          <div className="w-full h-full animate-pulse bg-zinc-200" />
        )}
        {selectMode && (
          <div className={"absolute top-1 left-1 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold border-2 transition-colors " + (selected ? "bg-blue-700 border-white text-white" : "bg-white/80 border-zinc-400 text-transparent")} aria-hidden>
            ✓
          </div>
        )}
      </div>
      <div className="p-1.5">
        <div className="text-[11px] font-bold text-zinc-900 truncate" title={photo.display_name}>{photo.display_name}</div>
        <div className="flex items-center justify-between mt-0.5">
          <div className="flex items-center gap-1 flex-wrap">
            {photo.tag && (
              <span className={`px-1 py-0.5 text-[8px] font-bold uppercase tracking-wider rounded-sm ${TAG_TONES[photo.tag] || "bg-zinc-100 text-zinc-700"}`}>{photo.tag}</span>
            )}
            {photo.is_cover && (
              <span className="px-1 py-0.5 text-[8px] font-bold uppercase tracking-wider rounded-sm bg-amber-200 text-amber-900 inline-flex items-center gap-0.5">
                <Star className="w-2 h-2 fill-current" /> Cover
              </span>
            )}
            {photo.annotated_storage_path && (
              <span
                className="px-1 py-0.5 text-[8px] font-bold uppercase tracking-wider rounded-sm bg-emerald-100 text-emerald-800 inline-flex items-center gap-0.5"
                title={photo.annotated_at ? `Annotated ${new Date(photo.annotated_at).toLocaleString()}` : "Has annotations"}
                data-testid={`photo-annotated-badge-${photo.id}`}
              >
                <Pen className="w-2 h-2" /> Marked
              </span>
            )}
          </div>
          <div className="text-[8px] text-zinc-400 font-mono">{((photo.size || 0) / 1024).toFixed(0)}KB</div>
        </div>
      </div>
      {/* Hover toolbar */}
      {!selectMode && (
        <div className="absolute inset-0 bg-zinc-900/0 group-hover:bg-zinc-900/30 transition-colors flex items-end justify-end p-1 opacity-0 group-hover:opacity-100">
          <div className="flex gap-1">
            <button onClick={(e) => { e.stopPropagation(); onDownload && onDownload(); }} className="w-6 h-6 bg-white rounded-sm flex items-center justify-center hover:bg-blue-100" title="Save to disk (Paint / Macromedia / etc.)" data-testid={`photo-download-${photo.id}`}>
              <Download className="w-3 h-3 text-blue-700" />
            </button>
            <button onClick={(e) => { e.stopPropagation(); onToggleCover(); }} className="w-6 h-6 bg-white rounded-sm flex items-center justify-center hover:bg-amber-100" title={photo.is_cover ? "Remove cover" : "Set as cover for PDFs"} data-testid={`photo-cover-${photo.id}`}>
              <Star className={`w-3 h-3 ${photo.is_cover ? "text-amber-600 fill-amber-500" : "text-zinc-600"}`} />
            </button>
            <button onClick={(e) => { e.stopPropagation(); onEdit(); }} className="px-1.5 h-6 bg-white rounded-sm text-[9px] font-bold uppercase tracking-wider hover:bg-blue-100" data-testid={`photo-edit-${photo.id}`}>Edit</button>
            <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="w-6 h-6 bg-white rounded-sm flex items-center justify-center hover:bg-rose-100" title="Delete" data-testid={`photo-delete-${photo.id}`}>
              <Trash2 className="w-3 h-3 text-rose-600" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============ Edit Modal ============
function EditPhotoModal({ dealId, photo, onClose, onSaved }) {
  const [form, setForm] = useState({
    album_name: photo.album_name || "Default",
    tag: photo.tag || "",
    display_name: photo.display_name || "",
    description: photo.description || "",
  });
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await api.patch(`/projects/${dealId}/photos/${photo.id}`, form);
      toast.success("Photo updated");
      onSaved();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" data-testid="edit-photo-modal">
      <div className="bg-white max-w-md w-full">
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-200">
          <div className="text-[11px] font-black uppercase tracking-[0.15em] text-zinc-700">Edit Photo</div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-900"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-3">
          <Field label="Display Name">
            <input value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} className="w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm" data-testid="edit-photo-name" />
          </Field>
          <Field label="Album">
            <input value={form.album_name} onChange={(e) => setForm({ ...form, album_name: e.target.value })} placeholder="Default" className="w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm" data-testid="edit-photo-album" />
          </Field>
          <Field label="Tag (optional)">
            <select value={form.tag} onChange={(e) => setForm({ ...form, tag: e.target.value })} className="w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm bg-white" data-testid="edit-photo-tag">
              <option value="">— No tag —</option>
              {PRESET_TAGS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Description / Caption">
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} className="w-full px-2 py-1.5 border border-zinc-300 rounded-sm text-sm" data-testid="edit-photo-desc" />
          </Field>
        </div>
        <div className="px-5 py-3 border-t border-zinc-200 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 h-9 text-xs font-bold uppercase tracking-wider border border-zinc-300 hover:bg-zinc-50 rounded-sm">Cancel</button>
          <button onClick={save} disabled={saving} className="px-3 h-9 text-xs font-bold uppercase tracking-wider bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-40 rounded-sm" data-testid="edit-photo-save">{saving ? "Saving..." : "Save"}</button>
        </div>
      </div>
    </div>
  );
}

// ============ Share Modal ============
function ShareModal({ dealId, dealTitle, albums, onClose }) {
  const [albumName, setAlbumName] = useState("");
  const [tag, setTag] = useState("");
  const [downloadEnabled, setDownloadEnabled] = useState(true);
  const [expiresInDays, setExpiresInDays] = useState(90);
  const [creating, setCreating] = useState(false);
  const [shares, setShares] = useState([]);

  const loadShares = async () => {
    try {
      const r = await api.get(`/projects/${dealId}/photo-shares/list`);
      setShares(r.data || []);
    } catch (e) { /* */ }
  };
  useEffect(() => { loadShares(); /* eslint-disable-next-line */ }, []);

  const createShare = async () => {
    setCreating(true);
    try {
      const r = await api.post(`/projects/${dealId}/photo-shares`, {
        album_name: albumName || null,
        tag: tag || null,
        download_enabled: downloadEnabled,
        expires_in_days: parseInt(expiresInDays) || 0,
      });
      const token = r.data.token;
      const url = `${window.location.origin}/share/photos/${token}`;
      await navigator.clipboard.writeText(url).catch(() => {});
      toast.success("Share link created and copied to clipboard");
      loadShares();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (token) => {
    if (!window.confirm("Revoke this share link? Anyone holding it will lose access.")) return;
    try {
      await api.delete(`/projects/${dealId}/photo-shares/${token}`);
      toast.success("Share revoked");
      loadShares();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" data-testid="share-photos-modal">
      <div className="bg-white max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-700 mb-1">Share Photos with Customer</div>
            <h3 className="font-heading text-xl font-black tracking-tight">{dealTitle}</h3>
            <div className="text-xs text-zinc-500 mt-1">Public link · No login needed · Mobile-friendly gallery</div>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-900"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Album (optional — leave blank to share all)">
              <select value={albumName} onChange={(e) => setAlbumName(e.target.value)} className="w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm bg-white" data-testid="share-album">
                <option value="">All albums</option>
                {albums.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </Field>
            <Field label="Tag (optional)">
              <select value={tag} onChange={(e) => setTag(e.target.value)} className="w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm bg-white" data-testid="share-tag">
                <option value="">All tags</option>
                {PRESET_TAGS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Allow Downloads?">
              <label className="flex items-center gap-2 mt-1 text-sm">
                <input type="checkbox" checked={downloadEnabled} onChange={(e) => setDownloadEnabled(e.target.checked)} data-testid="share-download" />
                {downloadEnabled ? "Yes — customers can save photos" : "View only"}
              </label>
            </Field>
            <Field label="Expires In (days · 0 = never)">
              <input type="number" min={0} max={365} value={expiresInDays} onChange={(e) => setExpiresInDays(e.target.value)} className="w-full h-9 px-2 border border-zinc-300 rounded-sm text-sm font-mono" data-testid="share-expires" />
            </Field>
          </div>

          <button
            onClick={createShare}
            disabled={creating}
            data-testid="create-share-btn"
            className="w-full h-10 text-xs font-bold uppercase tracking-wider bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-40 rounded-sm inline-flex items-center justify-center gap-2"
          >
            <Link2 className="w-3.5 h-3.5" /> {creating ? "Creating..." : "Create Share Link · Copy to Clipboard"}
          </button>

          {shares.length > 0 && (
            <div className="pt-2">
              <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-500 mb-2">Active share links — {shares.length}</div>
              <div className="space-y-2">
                {shares.map((s) => {
                  const url = `${window.location.origin}/share/photos/${s.token}`;
                  return (
                    <div key={s.token} className="border border-zinc-200 rounded-sm p-3 bg-zinc-50/40" data-testid={`active-share-${s.token}`}>
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <div className="flex items-center gap-1.5 text-[10px]">
                          {s.download_enabled
                            ? <span className="px-1.5 py-0.5 font-bold uppercase tracking-wider bg-emerald-100 text-emerald-800 rounded-sm inline-flex items-center gap-1"><Download className="w-2.5 h-2.5" /> Download</span>
                            : <span className="px-1.5 py-0.5 font-bold uppercase tracking-wider bg-zinc-200 text-zinc-700 rounded-sm inline-flex items-center gap-1"><EyeOff className="w-2.5 h-2.5" /> View only</span>}
                          {s.album_name && <span className="px-1.5 py-0.5 font-bold uppercase tracking-wider bg-blue-100 text-blue-800 rounded-sm">Album: {s.album_name}</span>}
                          {s.tag && <span className="px-1.5 py-0.5 font-bold uppercase tracking-wider bg-violet-100 text-violet-800 rounded-sm">{s.tag}</span>}
                          <span className="text-zinc-500">· {s.view_count || 0} views</span>
                          {s.expires_at && <span className="text-zinc-500">· Expires {new Date(s.expires_at).toLocaleDateString()}</span>}
                        </div>
                        <button onClick={() => revoke(s.token)} className="text-[10px] font-bold uppercase tracking-wider text-rose-600 hover:text-rose-800" data-testid={`revoke-share-${s.token}`}>Revoke</button>
                      </div>
                      <div className="flex items-center gap-2">
                        <input readOnly value={url} className="flex-1 h-8 px-2 border border-zinc-300 rounded-sm text-xs font-mono bg-white" />
                        <button onClick={() => { navigator.clipboard.writeText(url); toast.success("Link copied"); }} className="h-8 px-2 border border-zinc-300 rounded-sm hover:bg-zinc-50 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider"><Copy className="w-3 h-3" /> Copy</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============ Lightbox ============
function Lightbox({ dealId, photo, onClose, onAnnotate }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let url = null;
    api.get(`/projects/${dealId}/photos/${photo.id}/download`, { responseType: "blob" })
      .then((r) => { url = URL.createObjectURL(r.data); setSrc(url); })
      .catch(() => {});
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [dealId, photo.id]);
  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={onClose} data-testid="photo-lightbox">
      <button onClick={onClose} className="absolute top-4 right-4 text-white hover:text-zinc-200"><X className="w-6 h-6" /></button>
      <div className="absolute top-4 left-4 flex items-center gap-2">
        {src && (
          <a
            href={src}
            download={photo.display_name || photo.original_filename || "photo.jpg"}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1.5 px-3 h-9 text-[11px] font-bold uppercase tracking-wider bg-white text-zinc-900 hover:bg-zinc-100 rounded-sm"
            data-testid="lightbox-download"
            title="Save full-resolution photo to disk"
          >
            <Download className="w-3.5 h-3.5" /> Download
          </a>
        )}
        {onAnnotate && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onAnnotate(); }}
            className="inline-flex items-center gap-1.5 px-3 h-9 text-[11px] font-bold uppercase tracking-wider bg-emerald-600 text-white hover:bg-emerald-500 rounded-sm"
            data-testid="lightbox-annotate"
            title="Draw arrows, circles, and text on this photo"
          >
            <Pen className="w-3.5 h-3.5" /> Annotate
          </button>
        )}
      </div>
      <div className="max-w-6xl max-h-full" onClick={(e) => e.stopPropagation()}>
        {src ? <img src={src} alt={photo.display_name} className="max-h-[85vh] max-w-full" /> : <div className="text-white">Loading...</div>}
        <div className="mt-3 text-center text-white text-sm">
          <strong>{photo.display_name}</strong>
          {photo.annotated_storage_path && (
            <span className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded-sm bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              <Pen className="w-2.5 h-2.5" /> Annotated
            </span>
          )}
          {photo.description && <div className="text-zinc-300 text-xs mt-1">{photo.description}</div>}
        </div>
      </div>
    </div>
  );
}

// ============ Helpers ============
function Field({ label, children }) {
  return (
    <div>
      <label className="block text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-500 mb-1">{label}</label>
      {children}
    </div>
  );
}

function CustomAlbumInput({ onCreate }) {
  const [show, setShow] = useState(false);
  const [name, setName] = useState("");
  if (!show) {
    return (
      <button onClick={() => setShow(true)} className="text-[10px] font-bold uppercase tracking-wider text-blue-700 hover:underline">+ New Album</button>
    );
  }
  return (
    <div className="flex items-center gap-1">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && name.trim()) { onCreate(name.trim()); setShow(false); setName(""); }
          if (e.key === "Escape") { setShow(false); setName(""); }
        }}
        placeholder="Album name"
        className="h-8 px-2 border border-zinc-300 rounded-sm text-xs"
      />
      <button onClick={() => { if (name.trim()) { onCreate(name.trim()); setShow(false); setName(""); } }} className="text-[10px] font-bold uppercase text-blue-700">Add</button>
      <button onClick={() => { setShow(false); setName(""); }} className="text-[10px] text-zinc-500">×</button>
    </div>
  );
}
