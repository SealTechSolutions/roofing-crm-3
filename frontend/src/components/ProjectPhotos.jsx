import React, { useEffect, useRef, useState, useMemo } from "react";
import { api, formatApiError } from "@/lib/api";
import { toast } from "sonner";
import { Camera, Upload, Trash2, Share2, X, Download, Image as ImageIcon, Star, Link2, Copy, Eye, EyeOff, FileText } from "lucide-react";
import CameraCaptureButton from "@/components/CameraCaptureButton";

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
  // Chronological grouping: "asc" = oldest-first (matches before → during →
  // after narrative); "desc" = newest-first.
  const [sortOrder, setSortOrder] = useState("asc");
  const fileInputRef = useRef(null);

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
   * Group filtered photos by calendar date taken (uses `created_at` which for
   * field-camera photos = exact moment of capture, and for drag-drop uploads
   * = upload date). Returns an array of `{ key, label, photos: [] }` sorted
   * by `sortOrder` — oldest-first by default so the page reads as a natural
   * before → during → after timeline.
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
      const d = p.created_at ? new Date(p.created_at) : new Date(0);
      const dayKey = isNaN(d.getTime()) ? "unknown" : d.toISOString().slice(0, 10);
      if (!buckets.has(dayKey)) {
        buckets.set(dayKey, { key: dayKey, label: dayKey === "unknown" ? "No date" : fmtLabel(d), photos: [], ts: d.getTime() || 0 });
      }
      buckets.get(dayKey).photos.push(p);
    }
    // Sort photos within a day by created_at to keep the order stable.
    const groups = Array.from(buckets.values()).map((g) => ({
      ...g,
      photos: g.photos.slice().sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || ""))),
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
          <option value="">All Albums</option>
          {albums.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select
          value={tagFilter}
          onChange={(e) => setTagFilter(e.target.value)}
          className="h-8 px-2 border border-zinc-300 text-xs rounded-sm bg-white"
          data-testid="tag-filter"
        >
          <option value="">All Tags</option>
          {PRESET_TAGS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <CustomAlbumInput onCreate={(name) => setAlbumFilter(name)} />
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

      {/* Grid grouped by date */}
      {filtered.length === 0 ? (
        <div className="py-16 text-center text-sm text-zinc-500 border-2 border-dashed border-zinc-200 rounded-sm">
          <ImageIcon className="w-8 h-8 mx-auto text-zinc-300 mb-2" />
          {photos.length === 0
            ? "No photos uploaded yet. Drag-drop multiple images or use the Upload Photos button above."
            : "No photos match the current filter."}
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
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-2">
                {group.photos.map((p) => (
                  <PhotoCard
                    key={p.id}
                    photo={p}
                    onView={() => setLightbox(p)}
                    onEdit={() => setEditing(p)}
                    onDelete={() => removePhoto(p)}
                    onToggleCover={() => setCover(p)}
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
        <Lightbox dealId={dealId} photo={lightbox} onClose={() => setLightbox(null)} />
      )}
    </div>
  );
}

// ============ Photo Card ============
function PhotoCard({ photo, onView, onEdit, onDelete, onToggleCover }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
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
  }, [photo.id, photo.deal_id]);

  return (
    <div className="group relative bg-zinc-50 border border-zinc-200 rounded-sm overflow-hidden" data-testid={`photo-card-${photo.id}`}>
      <div className="aspect-[4/3] bg-zinc-200 cursor-pointer" onClick={onView}>
        {src ? (
          <img src={src} alt={photo.display_name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full animate-pulse bg-zinc-200" />
        )}
      </div>
      <div className="p-2">
        <div className="text-xs font-bold text-zinc-900 truncate" title={photo.display_name}>{photo.display_name}</div>
        <div className="flex items-center justify-between mt-1">
          <div className="flex items-center gap-1 flex-wrap">
            {photo.tag && (
              <span className={`px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded-sm ${TAG_TONES[photo.tag] || "bg-zinc-100 text-zinc-700"}`}>{photo.tag}</span>
            )}
            {photo.is_cover && (
              <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded-sm bg-amber-200 text-amber-900 inline-flex items-center gap-0.5">
                <Star className="w-2.5 h-2.5 fill-current" /> Cover
              </span>
            )}
          </div>
          <div className="text-[9px] text-zinc-400 font-mono">{((photo.size || 0) / 1024).toFixed(0)}KB</div>
        </div>
      </div>
      {/* Hover toolbar */}
      <div className="absolute inset-0 bg-zinc-900/0 group-hover:bg-zinc-900/30 transition-colors flex items-end justify-end p-2 opacity-0 group-hover:opacity-100">
        <div className="flex gap-1">
          <button onClick={onToggleCover} className="w-7 h-7 bg-white rounded-sm flex items-center justify-center hover:bg-amber-100" title={photo.is_cover ? "Remove cover" : "Set as cover for PDFs"} data-testid={`photo-cover-${photo.id}`}>
            <Star className={`w-3.5 h-3.5 ${photo.is_cover ? "text-amber-600 fill-amber-500" : "text-zinc-600"}`} />
          </button>
          <button onClick={onEdit} className="px-2 h-7 bg-white rounded-sm text-[10px] font-bold uppercase tracking-wider hover:bg-blue-100" data-testid={`photo-edit-${photo.id}`}>Edit</button>
          <button onClick={onDelete} className="w-7 h-7 bg-white rounded-sm flex items-center justify-center hover:bg-rose-100" title="Delete" data-testid={`photo-delete-${photo.id}`}>
            <Trash2 className="w-3.5 h-3.5 text-rose-600" />
          </button>
        </div>
      </div>
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
function Lightbox({ dealId, photo, onClose }) {
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
      <div className="max-w-6xl max-h-full" onClick={(e) => e.stopPropagation()}>
        {src ? <img src={src} alt={photo.display_name} className="max-h-[85vh] max-w-full" /> : <div className="text-white">Loading...</div>}
        <div className="mt-3 text-center text-white text-sm">
          <strong>{photo.display_name}</strong>
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
