import React, { useEffect, useState, useRef } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import { CheckCircle2, FileText, ShieldCheck, AlertCircle, RotateCcw } from "lucide-react";

const API_BASE = process.env.REACT_APP_BACKEND_URL;

/**
 * Public Proposal Signing Page — `/sign/:token`
 *
 * No authentication. The token gates access. Shows the project summary +
 * effective scope bullets, asks for the signer's name (and optionally a drawn
 * signature), then POSTs to /api/public/proposal/{token}/sign which flips the
 * deal status to "Won" and stamps scope_signed_at on the backend.
 */
export default function ProposalSign() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  // Form state
  const [signerName, setSignerName] = useState("");
  const [signerEmail, setSignerEmail] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(null); // sign response

  // Signature canvas
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  useEffect(() => {
    axios
      .get(`${API_BASE}/api/public/proposal/${token}`)
      .then((r) => {
        setData(r.data);
        if (r.data.primary_contact_name) setSignerName(r.data.primary_contact_name);
        if (r.data.primary_contact_email) setSignerEmail(r.data.primary_contact_email);
      })
      .catch((e) => setError(e?.response?.data?.detail || "Unable to load proposal"));
  }, [token]);

  const beginStroke = (e) => {
    const c = canvasRef.current;
    if (!c) return;
    drawingRef.current = true;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    // Scale screen → canvas. CSS stretches the 620×140 bitmap to fill the
    // column; without this the strokes get squashed onto the left side and
    // end up overlapping (the "signature wrote on top of itself" bug).
    const rect = c.getBoundingClientRect();
    const x = (clientX - rect.left) * (c.width / rect.width);
    const y = (clientY - rect.top) * (c.height / rect.height);
    const ctx = c.getContext("2d");
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#0A0A0A";
  };
  const strokeMove = (e) => {
    if (!drawingRef.current) return;
    const c = canvasRef.current;
    if (!c) return;
    e.preventDefault?.();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const rect = c.getBoundingClientRect();
    const x = (clientX - rect.left) * (c.width / rect.width);
    const y = (clientY - rect.top) * (c.height / rect.height);
    const ctx = c.getContext("2d");
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasInk(true);
  };
  const endStroke = () => {
    drawingRef.current = false;
  };
  const clearInk = () => {
    const c = canvasRef.current;
    if (!c) return;
    c.getContext("2d").clearRect(0, 0, c.width, c.height);
    setHasInk(false);
  };

  const submit = async () => {
    if (!signerName.trim()) {
      setError("Please enter your full name to sign.");
      return;
    }
    if (!accepted) {
      setError("Please accept the proposal to continue.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const signature_data_url = hasInk && canvasRef.current
        ? canvasRef.current.toDataURL("image/png")
        : null;
      const r = await axios.post(`${API_BASE}/api/public/proposal/${token}/sign`, {
        signer_name: signerName.trim(),
        signer_email: signerEmail.trim(),
        accepted: true,
        signature_data_url,
      });
      setSuccess(r.data);
    } catch (e) {
      setError(e?.response?.data?.detail || "Could not record signature. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  if (error && !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50">
        <div className="text-center p-8 bg-white rounded-sm border border-zinc-200 max-w-md">
          <AlertCircle className="w-12 h-12 text-zinc-300 mx-auto mb-3" />
          <h1 className="text-xl font-black text-zinc-900 mb-2">Proposal Unavailable</h1>
          <p className="text-sm text-zinc-600">{error}</p>
          <p className="text-xs text-zinc-400 mt-4">If you believe this is a mistake, contact SealTech Building Solutions directly.</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50">
        <div className="text-zinc-500">Loading proposal…</div>
      </div>
    );
  }

  const alreadySigned = data.signed?.is_signed || !!success;
  const justSigned = success && !success.already_signed;

  return (
    <div className="min-h-screen bg-zinc-50">
      {/* Banner */}
      <div className="bg-[#062B67] text-white py-6 px-6 sm:px-10">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-4">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.25em] opacity-80">SealTech Building Solutions</div>
            <h1 className="font-heading text-2xl sm:text-3xl font-black tracking-tight mt-1" data-testid="proposal-title">
              {data.project_title}
            </h1>
            <div className="text-[11px] opacity-80 mt-0.5">
              {[data.client_address, data.client_city, data.client_state, data.client_zip].filter(Boolean).join(", ")}
            </div>
          </div>
          <FileText className="w-12 h-12 opacity-30" />
        </div>
      </div>

      <div className="max-w-3xl mx-auto p-6 sm:p-10 space-y-6">
        {/* Project summary card */}
        <div className="bg-white border border-zinc-200 rounded-sm p-5">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Roof System</div>
              <div className="font-mono mt-1">{data.proposed_roof_type || "—"}</div>
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Project Total</div>
              <div className="font-mono mt-1 font-bold">${(data.chosen_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Client</div>
              <div className="mt-1">{data.client_company || data.client_name || "—"}</div>
            </div>
          </div>
        </div>

        {/* Scope card */}
        <div className="bg-white border border-zinc-200 rounded-sm p-5">
          <h2 className="font-heading text-lg font-black tracking-tight mb-3">{data.scope?.title || "Project Scope"}</h2>

          {data.scope?.scope_1_title && data.scope.scope_1?.length > 0 && (
            <div className="mb-5">
              <h3 className="text-xs font-bold uppercase tracking-[0.15em] text-zinc-700 mb-2">{data.scope.scope_1_title}</h3>
              <ul className="space-y-1.5 text-xs leading-relaxed text-zinc-800" data-testid="proposal-scope-1">
                {data.scope.scope_1.map((b, i) => (
                  <li key={i} className="flex gap-2"><span className="text-blue-700 font-mono">{i + 1}.</span><span>{b}</span></li>
                ))}
              </ul>
            </div>
          )}
          {data.scope?.scope_2_title && data.scope.scope_2?.length > 0 && (
            <div className="mb-5">
              <h3 className="text-xs font-bold uppercase tracking-[0.15em] text-zinc-700 mb-2">{data.scope.scope_2_title}</h3>
              <ul className="space-y-1.5 text-xs leading-relaxed text-zinc-800" data-testid="proposal-scope-2">
                {data.scope.scope_2.map((b, i) => (
                  <li key={i} className="flex gap-2"><span className="text-blue-700 font-mono">{i + 1}.</span><span>{b}</span></li>
                ))}
              </ul>
            </div>
          )}
          {data.scope?.key_advantages?.length > 0 && (
            <div>
              <h3 className="text-xs font-bold uppercase tracking-[0.15em] text-zinc-700 mb-2">Key Advantages</h3>
              <ul className="space-y-1.5 text-xs leading-relaxed text-zinc-800" data-testid="proposal-advantages">
                {data.scope.key_advantages.map((b, i) => (
                  <li key={i} className="flex gap-2"><span className="text-emerald-700">✓</span><span>{b}</span></li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Sign-off card */}
        {alreadySigned ? (
          <div className="bg-emerald-50 border-2 border-emerald-300 rounded-sm p-6" data-testid="proposal-already-signed">
            {(() => {
              const tsIso = success?.signed_at || data.signed?.signed_at || "";
              const tsDisplay = tsIso ? new Date(tsIso).toLocaleString() : "just now";
              return (
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="w-8 h-8 text-emerald-700 flex-shrink-0" />
                  <div>
                    <h2 className="font-heading text-xl font-black tracking-tight text-emerald-900">Proposal Accepted</h2>
                    <p className="text-sm text-emerald-800 mt-1">
                      Signed by <b>{success?.signed_by_name || data.signed?.signed_by_name || "—"}</b> on {tsDisplay}.
                    </p>
                    {justSigned && success?.deposit_invoice_number && (
                      <p className="text-xs text-emerald-700 mt-3" data-testid="proposal-deposit-receipt">
                        Your deposit invoice (<b>{success.deposit_invoice_number}</b>) is queued and the SealTech team will send it shortly. No further action needed on your end.
                      </p>
                    )}
                    {justSigned && !success?.deposit_invoice_number && (
                      <p className="text-xs text-emerald-700 mt-3">
                        Thank you. Your SealTech project team will be in touch shortly to coordinate the deposit and schedule.
                      </p>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        ) : (
          <div className="bg-white border-2 border-zinc-950 rounded-sm p-6" data-testid="proposal-sign-card">
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 mb-1 flex items-center gap-1.5">
              <ShieldCheck className="w-3 h-3" /> Electronic Signature
            </div>
            <h2 className="font-heading text-xl font-black tracking-tight mb-4">Accept &amp; Sign</h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-600 block mb-1.5">Full Name</label>
                <input
                  type="text"
                  value={signerName}
                  onChange={(e) => setSignerName(e.target.value)}
                  className="w-full px-2.5 py-2 border border-zinc-300 rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-blue-700"
                  data-testid="proposal-signer-name"
                  required
                />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-600 block mb-1.5">Email (optional)</label>
                <input
                  type="email"
                  value={signerEmail}
                  onChange={(e) => setSignerEmail(e.target.value)}
                  className="w-full px-2.5 py-2 border border-zinc-300 rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-blue-700"
                  data-testid="proposal-signer-email"
                />
              </div>
            </div>

            <div className="mb-4">
              <label className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-600 block mb-1.5 flex items-center justify-between">
                <span>Sign Here (optional)</span>
                {hasInk && (
                  <button onClick={clearInk} type="button" className="inline-flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-900" data-testid="proposal-clear-signature">
                    <RotateCcw className="w-3 h-3" /> Clear
                  </button>
                )}
              </label>
              <canvas
                ref={canvasRef}
                width={620}
                height={140}
                className="w-full border-2 border-dashed border-zinc-300 rounded-sm bg-zinc-50 cursor-crosshair touch-none"
                onMouseDown={beginStroke}
                onMouseMove={strokeMove}
                onMouseUp={endStroke}
                onMouseLeave={endStroke}
                onTouchStart={beginStroke}
                onTouchMove={strokeMove}
                onTouchEnd={endStroke}
                data-testid="proposal-signature-canvas"
              />
            </div>

            <label className="flex items-start gap-2 mb-5 cursor-pointer" data-testid="proposal-accept-checkbox">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-blue-700"
              />
              <span className="text-xs text-zinc-700 leading-relaxed">
                I accept the scope of work above as the agreed deliverable for this project, and I authorize SealTech Building Solutions to proceed.
                I understand my typed name above functions as my legally binding electronic signature.
              </span>
            </label>

            {error && (
              <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 px-3 py-2 mb-4 rounded-sm" data-testid="proposal-error">
                {error}
              </div>
            )}

            <button
              type="button"
              onClick={submit}
              disabled={busy || !accepted || !signerName.trim()}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-8 h-12 text-[11px] font-bold uppercase tracking-[0.15em] bg-blue-700 hover:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-sm transition-colors"
              data-testid="proposal-sign-submit"
            >
              {busy ? "Signing…" : "Accept & Sign Proposal"}
            </button>
          </div>
        )}

        <div className="text-center text-[10px] text-zinc-400 pt-4 border-t border-zinc-200">
          SealTech Building Solutions  ·  720-715-9955  ·  info@sealtechbuildingsolutions.com
        </div>
      </div>
    </div>
  );
}
