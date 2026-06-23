import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import { CheckCircle2, FileText } from "lucide-react";

const API_BASE = (process.env.REACT_APP_BACKEND_URL || "") + "/api";

const CURSIVE_FONTS = [
  "Caveat", "Dancing Script", "Great Vibes", "Sacramento", "Allura", "Pacifico",
];

export default function WorkOrderSign() {
  const { token } = useParams();
  const [wo, setWo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [signerName, setSignerName] = useState("");
  const [signatureText, setSignatureText] = useState("");
  const [signatureFont, setSignatureFont] = useState(CURSIVE_FONTS[0]);
  const [accepted, setAccepted] = useState(false);

  // Dynamically load each cursive font from Google Fonts so the live preview
  // matches the signed PDF — the backend ships the same six TTFs (Caveat,
  // Dancing Script, Great Vibes, Sacramento, Allura, Pacifico) and renders
  // the user's choice directly into the Work Order PDF.
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

  const submit = async (e) => {
    e.preventDefault();
    if (!accepted) { toast.error("Please tick the acceptance box."); return; }
    if (!signerName.trim()) { toast.error("Please enter your full name."); return; }
    if (!signatureText.trim()) { toast.error("Please type your signature."); return; }
    setSubmitting(true);
    try {
      const r = await fetch(`${API_BASE}/work-order/${token}/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signer_name: signerName.trim(),
          signature_text: signatureText.trim(),
          signature_font: signatureFont,
          accepted: true,
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.detail || `Could not submit (${r.status})`);
      }
      toast.success("Work order signed. SealTech has been notified.");
      setDone(true);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center text-zinc-500">Loading work order…</div>;
  if (!wo) return <div className="min-h-screen flex items-center justify-center text-zinc-500">Work order not found or revoked.</div>;

  if (done) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center px-4">
        <div className="bg-white border border-zinc-200 rounded-sm max-w-lg w-full p-8 text-center" data-testid="wo-sign-success">
          <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto mb-4" />
          <h1 className="font-heading text-2xl font-black mb-2 text-blue-900">Work Order Signed</h1>
          <p className="text-sm text-zinc-600 mb-4">
            Thank you{wo.signed_by_name ? `, ${wo.signed_by_name}` : ""}. A copy of the signed work order has been emailed to SealTech.
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
          <h1 className="font-heading text-3xl font-black">Work Order — Review &amp; Sign</h1>
          <p className="text-sm text-blue-200 mt-1">Review the work order below, then sign to accept.</p>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {/* Plain-text recap FIRST — works on every device even when PDF preview can't render */}
        <div className="bg-white border border-zinc-200 rounded-sm p-5 space-y-2 text-sm">
          <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Summary</div>
          <div><b>Project:</b> {f.project_name}</div>
          <div><b>Address:</b> {f.project_address}</div>
          <div><b>Subcontractor:</b> {f.sub_company} {f.sub_contact && `· ${f.sub_contact}`}</div>
          <div><b>Total:</b> <span className="font-mono font-bold text-blue-900">${Number(f.total || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
          <a
            href={`${API_BASE}/work-order/${token}/pdf`}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="wo-sign-open-pdf"
            className="mt-3 inline-flex items-center gap-2 px-4 h-10 text-xs font-bold uppercase tracking-wider bg-blue-700 text-white hover:bg-blue-800 rounded-sm"
          >
            <FileText className="w-3.5 h-3.5" /> Open Work Order PDF
          </a>
        </div>

        {/* Embedded PDF preview — works on most desktops; mobile Safari shows
            a blank iframe, which is why the "Open Work Order PDF" button above
            is provided as the primary affordance. Keep iframe short so the
            signature form below is always above the fold. */}
        <div className="hidden md:block bg-white border border-zinc-200 rounded-sm overflow-hidden">
          <iframe
            src={`${API_BASE}/work-order/${token}/pdf`}
            title="Work Order"
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
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-600 mb-1">Type Your Signature</label>
            <input
              type="text"
              value={signatureText}
              onChange={(e) => setSignatureText(e.target.value)}
              required
              data-testid="wo-sign-text"
              className="w-full h-10 px-3 border border-zinc-300 rounded-sm text-sm"
              placeholder="Type your name in cursive style…"
            />
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <span className="text-[10px] text-zinc-500">Style:</span>
              {CURSIVE_FONTS.map((f) => (
                <button key={f} type="button" onClick={() => setSignatureFont(f)} className={`text-xs px-2 h-7 border rounded-sm ${signatureFont === f ? "border-blue-700 bg-blue-50" : "border-zinc-300 hover:bg-zinc-50"}`} style={{ fontFamily: f }}>{f}</button>
              ))}
            </div>
            {signatureText && (
              <div className="mt-3 p-4 border border-blue-200 bg-blue-50/30 rounded-sm">
                <div className="text-[9px] font-bold uppercase tracking-wider text-zinc-500 mb-1">Signature Preview</div>
                <div className="text-3xl text-blue-900" style={{ fontFamily: signatureFont, lineHeight: 1.5 }}>{signatureText}</div>
              </div>
            )}
          </div>
          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} data-testid="wo-sign-accept" className="mt-0.5" />
            <span>I have reviewed the work order and accept the scope of Work. I agree to perform the Work in strict accordance with the manufacturer's specifications, and to furnish all labor, materials, insurance, supervision, and equipment necessary to complete it in a professional and workmanlike manner.</span>
          </label>
          <button
            type="submit"
            disabled={submitting || !accepted}
            data-testid="wo-sign-submit"
            className="w-full h-12 text-sm font-bold uppercase tracking-wider bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-50 rounded-sm"
          >
            {submitting ? "Signing…" : "Sign & Accept Work Order"}
          </button>
        </form>
      </div>
    </div>
  );
}
