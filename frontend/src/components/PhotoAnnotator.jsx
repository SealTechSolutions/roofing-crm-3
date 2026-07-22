import React, { useEffect, useRef, useState, useCallback } from "react";
import { api, formatApiError } from "@/lib/api";
import { toast } from "sonner";
import {
  X, MousePointer, ArrowUpRight, Circle as CircleIcon, Pen, Type,
  Undo2, Trash2, Save, Loader2,
} from "lucide-react";

/**
 * PhotoAnnotator — CompanyCam-style photo markup modal.
 *
 * Loads the raw (un-annotated) source photo, lets the user draw arrows,
 * circles, freehand pen strokes, and text labels on an HTML <canvas>
 * overlay. On save, we:
 *   1) Flatten the source image + overlay onto a single off-screen canvas
 *   2) Serialize to PNG blob
 *   3) POST to /api/projects/:dealId/photos/:photoId/annotations along
 *      with the raw layer JSON (so the annotator can re-hydrate individual
 *      shapes for editing on next open)
 *
 * Layers are stored as an array of shape objects. Each shape has:
 *   { type: 'arrow'|'circle'|'freehand'|'text', color, size, ... }
 * The renderer walks the array in order — this is what enables Undo
 * (pop the last shape) and future Redo (stash to a redo stack).
 *
 * Everything is drawn in **image-native coordinates** (0..naturalWidth,
 * 0..naturalHeight) then scaled to the display size on render. That way
 * the flattened output is always full resolution regardless of the
 * modal's on-screen size, and re-opening the annotator on a different
 * device (iPhone vs. desktop) shows identical positioning.
 */

const COLORS = [
  { name: "red",    hex: "#ef4444", ring: "ring-red-500" },
  { name: "yellow", hex: "#eab308", ring: "ring-yellow-500" },
  { name: "green",  hex: "#22c55e", ring: "ring-green-500" },
  { name: "blue",   hex: "#3b82f6", ring: "ring-blue-500" },
  { name: "white",  hex: "#ffffff", ring: "ring-white" },
  { name: "black",  hex: "#000000", ring: "ring-black" },
];

const TOOLS = [
  { id: "arrow",    label: "Arrow",    icon: ArrowUpRight },
  { id: "circle",   label: "Circle",   icon: CircleIcon },
  { id: "freehand", label: "Pen",      icon: Pen },
  { id: "text",     label: "Text",     icon: Type },
];

const STROKE_WIDTHS = [3, 6, 12];

export default function PhotoAnnotator({ dealId, photo, onClose, onSaved }) {
  const [tool, setTool] = useState("arrow");
  const [color, setColor] = useState(COLORS[0].hex);
  const [strokeWidth, setStrokeWidth] = useState(6);
  const [layers, setLayers] = useState([]);              // committed shapes
  const [draft, setDraft] = useState(null);              // in-progress shape (mouse-down → move → up)
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [textPrompt, setTextPrompt] = useState(null);    // { x, y } while awaiting text input

  const imageRef = useRef(null);          // HTMLImageElement (natural pixels)
  const canvasRef = useRef(null);         // display <canvas>
  const containerRef = useRef(null);

  // Load the **source** (original, un-annotated) image so the user always
  // draws over a pristine base. `?original=true` forces the server to
  // skip the annotated version if one exists. If the photo has existing
  // annotation layers, hydrate them so this is an "edit" session.
  useEffect(() => {
    let mounted = true;
    let url = null;
    (async () => {
      try {
        const r = await api.get(
          `/projects/${dealId}/photos/${photo.id}/download?original=true`,
          { responseType: "blob" },
        );
        if (!mounted) return;
        url = URL.createObjectURL(r.data);
        const img = new Image();
        img.onload = () => {
          if (!mounted) return;
          imageRef.current = img;
          // If photo already has saved annotations, rehydrate them so
          // the user can edit individual shapes instead of starting fresh.
          if (Array.isArray(photo.annotations) && photo.annotations.length) {
            setLayers(photo.annotations);
          }
          setLoading(false);
        };
        img.src = url;
      } catch (e) {
        toast.error(formatApiError(e?.response?.data?.detail) || e.message || "Could not load photo");
        setLoading(false);
      }
    })();
    return () => { mounted = false; if (url) URL.revokeObjectURL(url); };
  }, [dealId, photo.id, photo.annotations]);

  // Redraw the display canvas whenever layers, draft, image or size change.
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    // Scale factor: canvas pixels per natural image pixel. We drew all
    // shapes in image-native coordinates, so we scale when rendering.
    const sx = canvas.width / img.naturalWidth;
    const sy = canvas.height / img.naturalHeight;
    const drawShape = (s) => {
      ctx.strokeStyle = s.color;
      ctx.fillStyle = s.color;
      ctx.lineWidth = (s.size || 6) * Math.min(sx, sy);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      if (s.type === "arrow") {
        drawArrow(ctx, s.x1 * sx, s.y1 * sy, s.x2 * sx, s.y2 * sy, ctx.lineWidth);
      } else if (s.type === "circle") {
        const cx = (s.x1 + s.x2) / 2 * sx;
        const cy = (s.y1 + s.y2) / 2 * sy;
        const rx = Math.abs(s.x2 - s.x1) / 2 * sx;
        const ry = Math.abs(s.y2 - s.y1) / 2 * sy;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else if (s.type === "freehand") {
        if (!s.points || s.points.length < 2) return;
        ctx.beginPath();
        ctx.moveTo(s.points[0][0] * sx, s.points[0][1] * sy);
        for (let i = 1; i < s.points.length; i++) {
          ctx.lineTo(s.points[i][0] * sx, s.points[i][1] * sy);
        }
        ctx.stroke();
      } else if (s.type === "text") {
        const fontSize = (s.size || 6) * 4 * Math.min(sx, sy);
        ctx.font = `bold ${fontSize}px system-ui, -apple-system, sans-serif`;
        ctx.textBaseline = "top";
        // Draw a semi-transparent background rectangle behind the text
        // for legibility on busy photos (roof textures, sky, etc.).
        const metrics = ctx.measureText(s.text || "");
        const pad = fontSize * 0.2;
        const w = metrics.width + pad * 2;
        const h = fontSize + pad * 2;
        ctx.save();
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillRect(s.x1 * sx - pad, s.y1 * sy - pad, w, h);
        ctx.fillStyle = s.color;
        ctx.fillText(s.text || "", s.x1 * sx, s.y1 * sy);
        ctx.restore();
      }
    };
    layers.forEach(drawShape);
    if (draft) drawShape(draft);
  }, [layers, draft]);

  // Size the canvas to match the container, preserving image aspect ratio.
  useEffect(() => {
    const resize = () => {
      const container = containerRef.current;
      const canvas = canvasRef.current;
      const img = imageRef.current;
      if (!container || !canvas || !img) return;
      const maxW = container.clientWidth;
      const maxH = container.clientHeight;
      const ratio = img.naturalWidth / img.naturalHeight;
      let w = maxW;
      let h = maxW / ratio;
      if (h > maxH) { h = maxH; w = maxH * ratio; }
      canvas.width = Math.floor(w);
      canvas.height = Math.floor(h);
      redraw();
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [loading, redraw]);

  useEffect(() => { redraw(); }, [redraw]);

  // Convert pointer event → image-native coordinate. Works for both
  // mouse and touch events (pointer events unify them).
  const pointerToImage = (e) => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    return {
      x: (cx / canvas.width) * img.naturalWidth,
      y: (cy / canvas.height) * img.naturalHeight,
    };
  };

  const handlePointerDown = (e) => {
    if (loading || saving) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = pointerToImage(e);
    if (tool === "text") {
      setTextPrompt({ x: p.x, y: p.y });
      return;
    }
    if (tool === "freehand") {
      setDraft({ type: "freehand", color, size: strokeWidth, points: [[p.x, p.y]] });
    } else {
      setDraft({ type: tool, color, size: strokeWidth, x1: p.x, y1: p.y, x2: p.x, y2: p.y });
    }
  };

  const handlePointerMove = (e) => {
    if (!draft || loading || saving) return;
    const p = pointerToImage(e);
    if (draft.type === "freehand") {
      setDraft((d) => ({ ...d, points: [...d.points, [p.x, p.y]] }));
    } else {
      setDraft((d) => ({ ...d, x2: p.x, y2: p.y }));
    }
  };

  const handlePointerUp = () => {
    if (!draft) return;
    // Discard shapes that are essentially a single click with no drag
    // (except freehand where every point matters and text handled separately).
    if (draft.type === "arrow" || draft.type === "circle") {
      const dx = draft.x2 - draft.x1;
      const dy = draft.y2 - draft.y1;
      if (Math.sqrt(dx * dx + dy * dy) < 5) { setDraft(null); return; }
    }
    if (draft.type === "freehand" && draft.points.length < 2) { setDraft(null); return; }
    setLayers((L) => [...L, draft]);
    setDraft(null);
  };

  const submitText = (text) => {
    if (!textPrompt) return;
    const trimmed = (text || "").trim();
    if (trimmed) {
      setLayers((L) => [...L, {
        type: "text", color, size: strokeWidth,
        x1: textPrompt.x, y1: textPrompt.y, text: trimmed,
      }]);
    }
    setTextPrompt(null);
  };

  const undo = () => setLayers((L) => L.slice(0, -1));
  const clearAll = () => {
    if (!layers.length) return;
    if (window.confirm(`Clear all ${layers.length} annotation${layers.length === 1 ? "" : "s"}?`)) {
      setLayers([]);
    }
  };

  // Flatten canvas at full source resolution and POST to backend.
  const save = async () => {
    const img = imageRef.current;
    if (!img) return;
    if (!layers.length) {
      toast.error("Draw something first, or click Cancel to close.");
      return;
    }
    setSaving(true);
    try {
      // Off-screen canvas at natural image resolution so the flattened
      // PNG matches the original photo's DPI — no downscaling.
      const off = document.createElement("canvas");
      off.width = img.naturalWidth;
      off.height = img.naturalHeight;
      const octx = off.getContext("2d");
      octx.drawImage(img, 0, 0);
      // Re-render every shape at 1:1 (sx = sy = 1) since off-canvas is
      // already in image-native pixels.
      const drawShape = (s) => {
        octx.strokeStyle = s.color;
        octx.fillStyle = s.color;
        octx.lineWidth = s.size || 6;
        octx.lineCap = "round";
        octx.lineJoin = "round";
        if (s.type === "arrow") {
          drawArrow(octx, s.x1, s.y1, s.x2, s.y2, octx.lineWidth);
        } else if (s.type === "circle") {
          const cx = (s.x1 + s.x2) / 2;
          const cy = (s.y1 + s.y2) / 2;
          const rx = Math.abs(s.x2 - s.x1) / 2;
          const ry = Math.abs(s.y2 - s.y1) / 2;
          octx.beginPath();
          octx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
          octx.stroke();
        } else if (s.type === "freehand") {
          if (!s.points || s.points.length < 2) return;
          octx.beginPath();
          octx.moveTo(s.points[0][0], s.points[0][1]);
          for (let i = 1; i < s.points.length; i++) {
            octx.lineTo(s.points[i][0], s.points[i][1]);
          }
          octx.stroke();
        } else if (s.type === "text") {
          const fontSize = (s.size || 6) * 4;
          octx.font = `bold ${fontSize}px system-ui, -apple-system, sans-serif`;
          octx.textBaseline = "top";
          const metrics = octx.measureText(s.text || "");
          const pad = fontSize * 0.2;
          octx.save();
          octx.fillStyle = "rgba(0,0,0,0.55)";
          octx.fillRect(s.x1 - pad, s.y1 - pad, metrics.width + pad * 2, fontSize + pad * 2);
          octx.fillStyle = s.color;
          octx.fillText(s.text || "", s.x1, s.y1);
          octx.restore();
        }
      };
      layers.forEach(drawShape);

      // Turn canvas into a PNG blob.
      const blob = await new Promise((res) => off.toBlob(res, "image/png", 0.92));
      if (!blob) throw new Error("Failed to encode annotated image");

      const fd = new FormData();
      fd.append("file", blob, `${photo.id}-annotated.png`);
      fd.append("layers", JSON.stringify(layers));
      await api.put(
        `/projects/${dealId}/photos/${photo.id}/annotations`,
        fd,
        { headers: { "Content-Type": "multipart/form-data" } },
      );
      toast.success("Annotations saved");
      onSaved && onSaved();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-zinc-950/95 flex flex-col"
      data-testid="photo-annotator"
    >
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-zinc-950">
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-400 mb-0.5">
            Annotate Photo
          </div>
          <div className="text-sm font-bold text-white truncate max-w-md">
            {photo.display_name || photo.original_filename || "Photo"}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            data-testid="annotator-cancel"
            className="inline-flex items-center gap-1.5 h-9 px-3 text-[11px] font-bold uppercase tracking-wider border border-zinc-700 text-zinc-300 hover:bg-zinc-800 rounded-sm disabled:opacity-40"
          >
            <X className="w-3.5 h-3.5" /> Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || loading || !layers.length}
            data-testid="annotator-save"
            className="inline-flex items-center gap-1.5 h-9 px-4 text-[11px] font-bold uppercase tracking-wider bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-40 rounded-sm"
          >
            {saving ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</> : <><Save className="w-3.5 h-3.5" /> Save</>}
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap px-4 py-2 border-b border-zinc-800 bg-zinc-900">
        {/* Tool picker */}
        <div className="inline-flex items-center rounded-sm overflow-hidden border border-zinc-700">
          {TOOLS.map((t) => {
            const Icon = t.icon;
            const active = tool === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTool(t.id)}
                data-testid={`annotator-tool-${t.id}`}
                className={`h-9 px-3 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider ${active ? "bg-blue-600 text-white" : "bg-zinc-900 text-zinc-300 hover:bg-zinc-800"}`}
              >
                <Icon className="w-3.5 h-3.5" /> {t.label}
              </button>
            );
          })}
        </div>

        {/* Color picker */}
        <div className="inline-flex items-center gap-1.5 ml-2">
          {COLORS.map((c) => (
            <button
              key={c.name}
              type="button"
              onClick={() => setColor(c.hex)}
              data-testid={`annotator-color-${c.name}`}
              aria-label={`Color ${c.name}`}
              style={{ backgroundColor: c.hex }}
              className={`w-7 h-7 rounded-full ring-2 ring-offset-2 ring-offset-zinc-900 ${color === c.hex ? c.ring : "ring-transparent"} border border-zinc-600`}
            />
          ))}
        </div>

        {/* Stroke width */}
        <div className="inline-flex items-center gap-1 ml-2 border border-zinc-700 rounded-sm overflow-hidden">
          {STROKE_WIDTHS.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setStrokeWidth(w)}
              data-testid={`annotator-stroke-${w}`}
              className={`h-9 px-2.5 text-[10px] font-bold uppercase tracking-wider ${strokeWidth === w ? "bg-blue-600 text-white" : "bg-zinc-900 text-zinc-300 hover:bg-zinc-800"}`}
              title={`Stroke width ${w}px`}
            >
              {w === 3 ? "S" : w === 6 ? "M" : "L"}
            </button>
          ))}
        </div>

        {/* Undo / Clear */}
        <div className="inline-flex items-center gap-1 ml-auto">
          <button
            type="button"
            onClick={undo}
            disabled={!layers.length || saving}
            data-testid="annotator-undo"
            className="inline-flex items-center gap-1.5 h-9 px-3 text-[10px] font-bold uppercase tracking-wider border border-zinc-700 text-zinc-300 hover:bg-zinc-800 disabled:opacity-40 rounded-sm"
          >
            <Undo2 className="w-3.5 h-3.5" /> Undo
          </button>
          <button
            type="button"
            onClick={clearAll}
            disabled={!layers.length || saving}
            data-testid="annotator-clear"
            className="inline-flex items-center gap-1.5 h-9 px-3 text-[10px] font-bold uppercase tracking-wider border border-rose-700 text-rose-400 hover:bg-rose-950 disabled:opacity-40 rounded-sm"
          >
            <Trash2 className="w-3.5 h-3.5" /> Clear all
          </button>
        </div>
      </div>

      {/* Canvas area */}
      <div ref={containerRef} className="flex-1 flex items-center justify-center overflow-hidden p-4">
        {loading ? (
          <div className="text-zinc-400 flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading photo…
          </div>
        ) : (
          <canvas
            ref={canvasRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            data-testid="annotator-canvas"
            className="bg-zinc-900 shadow-2xl border border-zinc-800 cursor-crosshair touch-none"
            style={{ touchAction: "none" }}
          />
        )}
      </div>

      {/* Footer hint */}
      <div className="px-4 py-2 border-t border-zinc-800 bg-zinc-950 text-[11px] text-zinc-500 flex items-center gap-3 flex-wrap">
        <span className="inline-flex items-center gap-1"><MousePointer className="w-3 h-3" /> {toolHint(tool)}</span>
        {layers.length > 0 && <span className="text-zinc-400">{layers.length} annotation{layers.length === 1 ? "" : "s"}</span>}
        {photo.annotated_at && (
          <span className="text-emerald-500 ml-auto">Editing existing markup · {new Date(photo.annotated_at).toLocaleString()}</span>
        )}
      </div>

      {/* Text input prompt (modal-in-modal) */}
      {textPrompt && (
        <TextPromptModal
          onCancel={() => setTextPrompt(null)}
          onSubmit={submitText}
        />
      )}
    </div>
  );
}

// ---------- Helpers ----------
function toolHint(tool) {
  switch (tool) {
    case "arrow":    return "Click + drag to draw an arrow";
    case "circle":   return "Click + drag to draw a circle around damage";
    case "freehand": return "Click + drag to draw freehand";
    case "text":     return "Click on the photo to place a text label";
    default:         return "";
  }
}

function drawArrow(ctx, x1, y1, x2, y2, lineWidth) {
  const headLen = Math.max(lineWidth * 3, 14);
  const angle = Math.atan2(y2 - y1, x2 - x1);
  // Shaft
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  // Filled head
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 7), y2 - headLen * Math.sin(angle - Math.PI / 7));
  ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 7), y2 - headLen * Math.sin(angle + Math.PI / 7));
  ctx.closePath();
  ctx.fill();
}

function TextPromptModal({ onCancel, onSubmit }) {
  const [value, setValue] = useState("");
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current && inputRef.current.focus(); }, []);
  return (
    <div
      className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4"
      data-testid="annotator-text-prompt"
    >
      <div className="bg-white max-w-sm w-full rounded-sm">
        <div className="px-5 py-3 border-b border-zinc-200">
          <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-blue-700 mb-0.5">Add text label</div>
          <div className="text-xs text-zinc-500">Keep it short — 40 chars or less reads best.</div>
        </div>
        <div className="p-5">
          <input
            ref={inputRef}
            type="text"
            value={value}
            maxLength={80}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSubmit(value);
              if (e.key === "Escape") onCancel();
            }}
            placeholder="e.g. Blistering / ponding water / bad flashing"
            data-testid="annotator-text-input"
            className="w-full h-10 px-3 border border-zinc-300 rounded-sm text-sm"
          />
        </div>
        <div className="px-5 py-3 border-t border-zinc-200 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-9 px-3 text-xs font-bold uppercase tracking-wider border border-zinc-300 hover:bg-zinc-50 rounded-sm"
            data-testid="annotator-text-cancel"
          >Cancel</button>
          <button
            type="button"
            onClick={() => onSubmit(value)}
            className="h-9 px-4 text-xs font-bold uppercase tracking-wider bg-blue-700 text-white hover:bg-blue-800 rounded-sm"
            data-testid="annotator-text-submit"
          >Add</button>
        </div>
      </div>
    </div>
  );
}
