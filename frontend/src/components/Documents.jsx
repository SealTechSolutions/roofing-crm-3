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
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) {
      toast.error("Max file size is 50 MB");
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("parent_type", parentType);
      fd.append("parent_id", parentId);
      fd.append("category", category);
      await api.post(`/files/upload`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success("File uploaded");
      load();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setUploading(false);
    }
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
          <input ref={inputRef} type="file" hidden onChange={handleSelect} data-testid="document-file-input" />
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
        <ul className="divide-y divide-zinc-100" data-testid="documents-list">
          {files.map((f) => {
            const Icon = iconFor(f.original_filename, f.content_type);
            return (
              <li key={f.id} className="flex items-center gap-3 py-2.5" data-testid={`document-${f.id}`}>
                <Icon className="w-5 h-5 text-zinc-400 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-zinc-950 truncate">{f.original_filename}</div>
                  <div className="text-[10px] uppercase tracking-wider text-zinc-500 mt-0.5">
                    {f.category} · {formatSize(f.size)} · {new Date(f.created_at).toLocaleDateString()}
                  </div>
                </div>
                <button onClick={() => downloadFile(f)} title="Download" className="p-1.5 hover:bg-zinc-100 rounded-sm" data-testid={`download-${f.id}`}>
                  <Download className="w-4 h-4 text-zinc-700" />
                </button>
                {onSetCover && f.category === "Photo" && (
                  <button
                    onClick={() => onSetCover(f.id)}
                    title={coverPhotoId === f.id ? "Cover photo" : "Set as cover photo"}
                    className={`p-1.5 rounded-sm ${coverPhotoId === f.id ? "text-orange-500" : "text-zinc-400 hover:text-orange-500 hover:bg-zinc-100"}`}
                    data-testid={`cover-${f.id}`}
                  >
                    <Star className={`w-4 h-4 ${coverPhotoId === f.id ? "fill-current" : ""}`} />
                  </button>
                )}
                <button onClick={() => remove(f.id)} title="Delete" className="p-1.5 hover:bg-red-100 text-red-700 rounded-sm" data-testid={`delete-doc-${f.id}`}>
                  <Trash2 className="w-4 h-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
