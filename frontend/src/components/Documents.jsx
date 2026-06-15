import React, { useEffect, useRef, useState } from "react";
import { api, formatApiError, API } from "@/lib/api";
import { Upload, Download, Trash2, FileText, File as FileIcon, Image as ImageIcon, Star } from "lucide-react";
import { toast } from "sonner";

const CATEGORY_OPTIONS = [
  "Measurement Report", "Assessment", "Scope", "Proposal", "Invoice",
  "Photo", "Insurance/COI", "W-9", "Other",
];

function formatSize(bytes) {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function iconFor(name = "", type = "") {
  if (type?.startsWith("image/")) return ImageIcon;
  if (name.toLowerCase().endsWith(".pdf")) return FileText;
  return FileIcon;
}

export default function Documents({ parentType, parentId, title = "Documents", coverPhotoId = null, onSetCover = null }) {
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [category, setCategory] = useState("Other");
  const inputRef = useRef(null);

  const load = () => {
    if (!parentId) return;
    api.get(`/files?parent_type=${parentType}&parent_id=${parentId}`).then((r) => setFiles(r.data));
  };
  useEffect(() => { load(); }, [parentType, parentId]);

  const handleSelect = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (files.length === 0) return;
    // Pre-flight: enforce 50 MB per file
    const tooBig = files.filter((f) => f.size > 50 * 1024 * 1024);
    if (tooBig.length) {
      toast.error(`Max file size is 50 MB. Skipped: ${tooBig.map((f) => f.name).join(", ")}`);
    }
    const queue = files.filter((f) => f.size <= 50 * 1024 * 1024);
    if (queue.length === 0) return;
    setUploading(true);
    let ok = 0, failed = 0;
    for (const file of queue) {
      try {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("parent_type", parentType);
        fd.append("parent_id", parentId);
        fd.append("category", category);
        await api.post(`/files/upload`, fd, { headers: { "Content-Type": "multipart/form-data" } });
        ok += 1;
      } catch (err) {
        failed += 1;
        toast.error(`${file.name}: ${formatApiError(err?.response?.data?.detail) || err.message}`);
      }
    }
    if (ok > 0) toast.success(`${ok} file${ok === 1 ? "" : "s"} uploaded${failed ? ` (${failed} failed)` : ""}`);
    load();
    setUploading(false);
  };

  const downloadFile = (f) => {
    const token = localStorage.getItem("crm_token");
    const url = `${API}/files/${f.id}/download?token=${encodeURIComponent(token)}`;
    window.open(url, "_blank");
  };

  const remove = async (id) => {
    if (!window.confirm("Delete this file?")) return;
    await api.delete(`/files/${id}`);
    toast.success("File deleted");
    load();
  };

  return (
    <div className="bg-white border border-zinc-200 rounded-sm p-6 mb-6" data-testid={`documents-${parentType}`}>
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-zinc-100 gap-3 flex-wrap">
        <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-500">{title}</div>
        <div className="flex items-center gap-2">
          <select
            data-testid="document-category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="h-8 px-2 text-xs border border-zinc-300 rounded-sm bg-white"
          >
            {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input ref={inputRef} type="file" hidden multiple onChange={handleSelect} data-testid="document-file-input" />
          <button
            data-testid="document-upload-button"
            disabled={uploading || !parentId}
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center gap-1 px-3 h-8 text-[10px] font-bold uppercase tracking-wider bg-blue-700 text-white hover:bg-blue-800 rounded-sm disabled:opacity-50"
          >
            <Upload className="w-3.5 h-3.5" /> {uploading ? "Uploading..." : "Upload"}
          </button>
        </div>
      </div>
      {files.length === 0 ? (
        <div className="text-sm text-zinc-500 py-6 text-center">No documents yet. Upload measurement reports, assessments, scopes, invoices, photos, COIs, etc.</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2.5" data-testid="documents-list">
          {files.map((f) => {
            const Icon = iconFor(f.original_filename, f.content_type);
            const isImage = (f.content_type || "").startsWith("image/");
            const token = localStorage.getItem("crm_token");
            const previewUrl = isImage ? `${API}/files/${f.id}/download?token=${encodeURIComponent(token)}` : null;
            const isCover = coverPhotoId === f.id;
            return (
              <div
                key={f.id}
                className={`group relative bg-white border ${isCover ? "border-amber-500" : "border-zinc-200"} rounded-sm overflow-hidden hover:border-blue-700 hover:shadow-sm transition-all`}
                data-testid={`document-${f.id}`}
              >
                {/* Thumbnail — square aspect */}
                <div
                  className="relative aspect-square bg-zinc-100 cursor-pointer flex items-center justify-center"
                  onClick={() => downloadFile(f)}
                  title="Open / download"
                >
                  {isImage ? (
                    <img src={previewUrl} alt={f.original_filename} loading="lazy" className="w-full h-full object-cover" />
                  ) : (
                    <div className="flex flex-col items-center gap-1 text-zinc-400">
                      <Icon className="w-7 h-7" />
                      <span className="text-[8px] uppercase tracking-widest font-bold text-zinc-500">
                        {(f.original_filename.split(".").pop() || "FILE").toUpperCase()}
                      </span>
                    </div>
                  )}
                  {isCover && (
                    <span className="absolute top-1 left-1 bg-amber-500 text-white text-[8px] font-bold uppercase tracking-widest px-1 py-0.5 rounded-sm">Cover</span>
                  )}
                  {/* Hover actions overlay */}
                  <div className="absolute top-1 right-1 flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={(e) => { e.stopPropagation(); downloadFile(f); }} title="Download" className="p-1 bg-white/95 hover:bg-white shadow-sm rounded-sm" data-testid={`download-${f.id}`}>
                      <Download className="w-3 h-3 text-zinc-700" />
                    </button>
                    {onSetCover && (f.category === "Photo" || isImage) && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onSetCover(f.id); }}
                        title={isCover ? "Cover photo" : "Set as cover photo"}
                        className="p-1 bg-white/95 hover:bg-white shadow-sm rounded-sm"
                        data-testid={`cover-${f.id}`}
                      >
                        <Star className="w-3 h-3" style={{ fill: isCover ? "#A0703A" : "none", color: isCover ? "#A0703A" : "#52525B" }} />
                      </button>
                    )}
                    <button onClick={(e) => { e.stopPropagation(); remove(f.id); }} title="Delete" className="p-1 bg-white/95 hover:bg-red-100 shadow-sm rounded-sm text-red-700" data-testid={`delete-doc-${f.id}`}>
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
                {/* Metadata — compact */}
                <div className="p-1.5 border-t border-zinc-100">
                  <div className="text-[10px] font-bold text-zinc-950 truncate leading-tight" title={f.original_filename}>{f.original_filename}</div>
                  <div className="text-[9px] uppercase tracking-wider text-zinc-500 mt-0.5 truncate">
                    {f.category}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
