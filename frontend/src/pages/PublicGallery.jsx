import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import { Download, X, ImageOff } from "lucide-react";

const API_BASE = process.env.REACT_APP_BACKEND_URL;

/** Public photo-share gallery — no authentication. Lives at /share/photos/:token. */
export default function PublicGallery() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [lightbox, setLightbox] = useState(null);

  useEffect(() => {
    axios
      .get(`${API_BASE}/api/public/photo-share/${token}`)
      .then((r) => setData(r.data))
      .catch((e) => setError(e?.response?.data?.detail || "Unable to load gallery"));
  }, [token]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50">
        <div className="text-center p-8 bg-white rounded-sm border border-zinc-200 max-w-md">
          <ImageOff className="w-12 h-12 text-zinc-300 mx-auto mb-3" />
          <h1 className="text-xl font-black text-zinc-900 mb-2">Gallery Unavailable</h1>
          <p className="text-sm text-zinc-600">{error}</p>
          <p className="text-xs text-zinc-400 mt-4">If you believe this is a mistake, contact SealTech Building Solutions directly.</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50">
        <div className="text-zinc-500">Loading gallery...</div>
      </div>
    );
  }

  const photos = data.photos || [];
  const downloadEnabled = data.download_enabled;

  return (
    <div className="min-h-screen bg-zinc-50" data-testid="public-gallery">
      <header className="bg-white border-b border-zinc-200">
        <div className="max-w-6xl mx-auto px-4 py-5">
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-700">SealTech Building Solutions</div>
          <h1 className="text-2xl md:text-3xl font-black text-zinc-900 mt-1">{data.project_title}</h1>
          <div className="text-xs text-zinc-500 mt-1">
            {photos.length} photo{photos.length === 1 ? "" : "s"}
            {data.album_name ? ` · ${data.album_name}` : ""}
            {data.tag ? ` · ${data.tag}` : ""}
            {downloadEnabled ? " · High-res downloads enabled" : " · View only"}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        {photos.length === 0 ? (
          <div className="py-20 text-center text-sm text-zinc-500">No photos in this share.</div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {photos.map((p) => (
              <PublicPhotoTile
                key={p.id}
                token={token}
                photo={p}
                downloadEnabled={downloadEnabled}
                onClick={() => setLightbox(p)}
              />
            ))}
          </div>
        )}
      </main>

      <footer className="text-center text-xs text-zinc-400 py-8">
        © {new Date().getFullYear()} SealTech Building Solutions · sealtechsolutions.co
      </footer>

      {lightbox && (
        <PublicLightbox
          token={token}
          photo={lightbox}
          downloadEnabled={downloadEnabled}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}

function PublicPhotoTile({ token, photo, downloadEnabled, onClick }) {
  const src = `${API_BASE}/api/public/photo-share/${token}/file/${photo.id}`;
  return (
    <div className="bg-white border border-zinc-200 rounded-sm overflow-hidden group" data-testid={`public-photo-${photo.id}`}>
      <div className="aspect-[4/3] bg-zinc-200 cursor-pointer" onClick={onClick}>
        <img src={src} alt={photo.display_name} className="w-full h-full object-cover" loading="lazy" />
      </div>
      <div className="p-2 flex items-center justify-between gap-2">
        <div className="text-xs font-bold text-zinc-900 truncate" title={photo.display_name}>{photo.display_name}</div>
        {downloadEnabled && (
          <a
            href={src}
            download={photo.original_filename || photo.display_name}
            className="text-blue-700 hover:text-blue-900 inline-flex items-center"
            title="Download high-res"
            data-testid={`download-photo-${photo.id}`}
          >
            <Download className="w-3.5 h-3.5" />
          </a>
        )}
      </div>
    </div>
  );
}

function PublicLightbox({ token, photo, downloadEnabled, onClose }) {
  const src = `${API_BASE}/api/public/photo-share/${token}/file/${photo.id}`;
  return (
    <div className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4" onClick={onClose}>
      <button onClick={onClose} className="absolute top-4 right-4 text-white hover:text-zinc-200" aria-label="Close"><X className="w-6 h-6" /></button>
      <div className="max-w-6xl max-h-full" onClick={(e) => e.stopPropagation()}>
        <img src={src} alt={photo.display_name} className="max-h-[80vh] max-w-full" />
        <div className="mt-3 flex items-center justify-between text-white">
          <div>
            <div className="font-bold">{photo.display_name}</div>
            {photo.description && <div className="text-zinc-300 text-xs mt-1">{photo.description}</div>}
          </div>
          {downloadEnabled && (
            <a href={src} download={photo.original_filename || photo.display_name} className="px-3 h-9 bg-white text-zinc-900 rounded-sm text-xs font-bold uppercase tracking-wider hover:bg-zinc-100 inline-flex items-center gap-1.5">
              <Download className="w-3.5 h-3.5" /> Download High-Res
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
