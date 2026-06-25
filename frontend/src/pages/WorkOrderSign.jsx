import React, { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import { CheckCircle2, FileText, Eraser, Type as TypeIcon, PenLine } from "lucide-react";

const API_BASE = (process.env.REACT_APP_BACKEND_URL || "") + "/api";

const CURSIVE_FONTS = [
  "Caveat", "Dancing Script", "Great Vibes", "Sacramento", "Allura", "Pacifico",
];

// ---------------- DrawSignaturePad ----------------
// Lightweight HTML5 canvas signature capture. Works on both mouse and touch
// (iOS Safari, Android Chrome). Exports a transparent PNG data URL via
// `getDataUrl()` on the imperative ref the parent holds. The "blank" flag
// lets the parent disable the submit button until the user actually signs.
function DrawSignaturePad({ onChange }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const last = useRef({ x: 0, y: 0 });
  const [blank, setBlank] = useState(true);

  // The canvas is rendered with CSS width = 100% of its container but its
  // backing-store needs a higher pixel ratio for crisp lines on retina /
  // mobile. We compute the ratio once on mount and re-fit on resize.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const fit = () => {
      const ratio = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.round(rect.width * ratio);
      canvas.height = Math.round(rect.height * ratio);
      const ctx = canvas.getContext("2d");
      ctx.scale(ratio, ratio);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#062B67";
      ctx.lineWidth = 2.2;
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  // Translate a mouse/touch event to canvas-local CSS coordinates. The
  // backing-store scale set in `fit()` means we draw in CSS pixels here.
  const pt = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    if (e.touches && e.touches[0]) {
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const start = (e) => {
    e.preventDefault();
    drawing.current = true;
    last.current = pt(e);
  };
  const move = (e) => {
    if (!drawing.current) return;
    e.preventDefault();
    const p = pt(e);
    const ctx = canvasRef.current.getContext("2d");
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    if (blank) {
      setBlank(false);
      onChange?.(false);
    }
  };
  const end = () => { drawing.current = false; };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setBlank(true);
    onChange?.(true);
  };

  // Imperative escape hatch — the parent attaches a ref via window-scope
  // bridge below (see WorkOrderSign.jsx using `drawRef.current.toPng()`).
  useEffect(() => {
    DrawSignaturePad.toPng = () => {
      if (!canvasRef.current || blank) return null;
      return canvasRef.current.toDataURL("image/png");
    };
  }, [blank]);

  return (
    <div className="space-y-2">
      <div className="border-2 border-dashed border-blue-300 bg-white rounded-sm" style={{ touchAction: "none" }}>
        <canvas
          ref={canvasRef}
          className="block w-full"
          style={{ height: "180px", cursor: "crosshair" }}
          onMouseDown={start}
          onMouseMove={move}
          onMouseUp={end}
          onMouseLeave={end}
          onTouchStart={start}
          onTouchMove={move}
          onTouchEnd={end}
          data-testid="wo-sign-canvas"
        />
      </div>
      <div className="flex items-center justify-between">
        <div className="text-[10px] text-zinc-500 italic">
          {blank ? "Sign with your mouse / finger above." : "Looking good — draw again to add strokes or Clear to start over."}
        </div>
        <button
          type="button"
          onClick={clear}
          data-testid="wo-sign-canvas-clear"
          className="inline-flex items-center gap-1.5 text-[11px] px-2 h-7 border border-zinc-300 rounded-sm hover:bg-zinc-50"
        >
          <Eraser className="w-3 h-3" /> Clear
        </button>
      </div>
    </div>
  );
}

export default function WorkOrderSign() {
  const { token } = useParams();
  const [wo, setWo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [signerName, setSignerName] = useState("");
  const [signatureText, setSignatureText] = useState("");
  const [signatureFont, setSignatureFont] = useState(CURSIVE_FONTS[0]);
  const [signatureMode, setSignatureMode] = useState("type"); // "type" | "draw"
  const [drawIsBlank, setDrawIsBlank] = useState(true);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    const link = document.createElement("link");
    link.href = `https://fonts.googleapis.com/css2?${CURSIVE_FONTS.map((f) => `family=${encodeURIComponent(f)}`).join("&")}&display=swap`;
    link.rel = "stylesheet";
    document.head.appendChild(link);
    return () => document.head.removeChild(link);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API_BASE}/work-order/${token}`);
        if (!r.ok) throw new Error(`Work order not found (${r.status})`);
        const j = await r.json();
        setWo(j);
        if (j.already_signed) setDone(true);
      } catch (e) {
        toast.error(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const kind = wo?.kind || "work-order";
  const isCO = kind === "change-order";
  const docLabel = isCO ? "Change Order" : "Work Order";

  const submit = async (e) => {
    e.preventDefault();
    if (!accepted) { toast.error("Please tick the acceptance box."); return; }
    if (!signerName.trim()) { toast.error("Please enter your full name."); return; }
    let payload = {
      signer_name: signerName.trim(),
      accepted: true,
    };
    if (signatureMode === "draw") {
      const dataUrl = DrawSignaturePad.toPng?.();
      if (!dataUrl || drawIsBlank) {
        toast.error("Please draw your signature in the canvas, or switch to Type.");
        return;
      }
      payload.signature_data_url = dataUrl;
    } else {
      if (!signatureText.trim()) { toast.error("Please type your signature."); return; }
      payload.signature_text = signatureText.trim();
      payload.signature_font = signatureFont;
    }
    setSubmitting(true);
    try {
      const r = await fetch(`${API_BASE}/work-order/${token}/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.detail || `Could not submit (${r.status})`);
      }
      toast.success(`${docLabel} signed. SealTech has been notified.`);
      setDone(true);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center text-zinc-500">Loading {docLabel.toLowerCase()}…</div>;
  if (!wo) return <div className="min-h-screen flex items-center justify-center text-zinc-500">{docLabel} not found or revoked.</div>;

  if (done) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center px-4">
        <div className="bg-white border border-zinc-200 rounded-sm max-w-lg w-full p-8 text-center" data-testid="wo-sign-success">
          <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto mb-4" />
          <h1 className="font-heading text-2xl font-black mb-2 text-blue-900">{docLabel} Signed</h1>
          <p className="text-sm text-zinc-600 mb-4">
            Thank you{wo.signed_by_name ? `, ${wo.signed_by_name}` : ""}. A copy of the signed {docLabel.toLowerCase()} has been emailed to SealTech.
          </p>
          <a href={`${API_BASE}/work-order/${token}/pdf`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 px-4 h-10 text-xs font-bold uppercase tracking-wider bg-blue-700 text-white hover:bg-blue-800 rounded-sm">
            <FileText className="w-3.5 h-3.5" /> Download Signed PDF
          </a>
        </div>
      </div>
    );
  }

  const f = wo.fields || {};
  return (
    <div className="min-h-screen bg-zinc-50" data-testid="wo-sign-page">
      <div className="bg-blue-900 text-white py-6">
        <div className="max-w-3xl mx-auto px-4">
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-300 mb-1">SealTech Building Solutions</div>
          <h1 className="font-heading text-3xl font-black">{docLabel} — Review &amp; Sign</h1>
          <p className="text-sm text-blue-200 mt-1">
            {isCO
              ? "This Change Order amends the previously executed Work Order. Review the change(s) below, then sign to accept."
              : "Review the work order below, then sign to accept."}
          </p>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {/* Plain-text recap FIRST — works on every device even when PDF preview can't render */}
        <div className="bg-white border border-zinc-200 rounded-sm p-5 space-y-2 text-sm">
          <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Summary</div>
          <div><b>Project:</b> {f.project_name}</div>
          <div><b>Address:</b> {f.project_address}</div>
          <div><b>Subcontractor:</b> {f.sub_company} {f.sub_contact && `· ${f.sub_contact}`}</div>
          <div><b>Total{isCO ? " (this Change Order)" : ""}:</b> <span className="font-mono font-bold text-blue-900">${Number(f.total || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
          <a
            href={`${API_BASE}/work-order/${token}/pdf`}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="wo-sign-open-pdf"
            className="mt-3 inline-flex items-center gap-2 px-4 h-10 text-xs font-bold uppercase tracking-wider bg-blue-700 text-white hover:bg-blue-800 rounded-sm"
          >
            <FileText className="w-3.5 h-3.5" /> Open {docLabel} PDF
          </a>
        </div>

        {/* Embedded PDF preview — works on most desktops; mobile Safari shows
            a blank iframe, which is why the "Open Work Order PDF" button above
            is provided as the primary affordance. Keep iframe short so the
            signature form below is always above the fold. */}
        <div className="hidden md:block bg-white border border-zinc-200 rounded-sm overflow-hidden">
          <iframe
            src={`${API_BASE}/work-order/${token}/pdf`}
            title={docLabel}
            className="w-full"
            style={{ height: "60vh" }}
          />
        </div>

        {/* Signature form */}
        <form onSubmit={submit} className="bg-white border border-zinc-200 rounded-sm p-5 space-y-4">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-600 mb-1">Full Legal Name</label>
            <input
              type="text"
              value={signerName}
              onChange={(e) => setSignerName(e.target.value)}
              required
              data-testid="wo-sign-name"
              className="w-full h-10 px-3 border border-zinc-300 rounded-sm text-sm"
              placeholder="e.g. Jordan Mitchell"
            />
          </div>

          {/* Signature mode tabs — Type (cursive font) vs Draw (canvas) */}
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-600 mb-2">Signature</label>
            <div className="inline-flex border border-zinc-300 rounded-sm overflow-hidden mb-3" role="tablist">
              <button
                type="button"
                onClick={() => setSignatureMode("type")}
                data-testid="wo-sign-mode-type"
                className={`inline-flex items-center gap-1.5 px-3 h-9 text-[11px] font-bold uppercase tracking-wider ${signatureMode === "type" ? "bg-blue-700 text-white" : "bg-white text-zinc-700 hover:bg-zinc-50"}`}
              >
                <TypeIcon className="w-3.5 h-3.5" /> Type
              </button>
              <button
                type="button"
                onClick={() => setSignatureMode("draw")}
                data-testid="wo-sign-mode-draw"
                className={`inline-flex items-center gap-1.5 px-3 h-9 text-[11px] font-bold uppercase tracking-wider border-l border-zinc-300 ${signatureMode === "draw" ? "bg-blue-700 text-white" : "bg-white text-zinc-700 hover:bg-zinc-50"}`}
              >
                <PenLine className="w-3.5 h-3.5" /> Draw
              </button>
            </div>

            {signatureMode === "type" ? (
              <>
                <input
                  type="text"
                  value={signatureText}
                  onChange={(e) => setSignatureText(e.target.value)}
                  data-testid="wo-sign-text"
                  className="w-full h-10 px-3 border border-zinc-300 rounded-sm text-sm"
                  placeholder="Type your name in cursive style…"
                />
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] text-zinc-500">Style:</span>
                  {CURSIVE_FONTS.map((font) => (
                    <button key={font} type="button" onClick={() => setSignatureFont(font)} className={`text-xs px-2 h-7 border rounded-sm ${signatureFont === font ? "border-blue-700 bg-blue-50" : "border-zinc-300 hover:bg-zinc-50"}`} style={{ fontFamily: font }}>{font}</button>
                  ))}
                </div>
                {signatureText && (
                  <div className="mt-3 p-4 border border-blue-200 bg-blue-50/30 rounded-sm">
                    <div className="text-[9px] font-bold uppercase tracking-wider text-zinc-500 mb-1">Signature Preview</div>
                    <div className="text-3xl text-blue-900" style={{ fontFamily: signatureFont, lineHeight: 1.5 }}>{signatureText}</div>
                  </div>
                )}
              </>
            ) : (
              <DrawSignaturePad onChange={(b) => setDrawIsBlank(b)} />
            )}
          </div>

          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} data-testid="wo-sign-accept" className="mt-0.5" />
            <span>
              {isCO
                ? "I have reviewed this Change Order and accept the revised scope and pricing. All other terms of the original Work Order remain in full force and effect."
                : "I have reviewed the work order and accept the scope of Work. I agree to perform the Work in strict accordance with the manufacturer's specifications, and to furnish all labor, materials, insurance, supervision, and equipment necessary to complete it in a professional and workmanlike manner."}
            </span>
          </label>
          <button
            type="submit"
            disabled={submitting || !accepted}
            data-testid="wo-sign-submit"
            className="w-full h-12 text-sm font-bold uppercase tracking-wider bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-50 rounded-sm"
          >
            {submitting ? "Signing…" : `Sign & Accept ${docLabel}`}
          </button>
        </form>
      </div>
    </div>
  );
}
