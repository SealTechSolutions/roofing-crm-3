import React, { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { api, formatApiError } from "@/lib/api";
import { toast } from "sonner";
import { X, Smartphone, RefreshCw, Copy, CheckCircle2 } from "lucide-react";

/**
 * Get App on My Phone — modal that issues a one-time magic-link token and
 * shows a QR code the user scans with their phone camera.
 *
 * The scanned URL (/m/:token) hits the public `consume` endpoint, drops the
 * returned JWT into localStorage, and forwards to the dashboard.
 * Token expires in 5 minutes and is single-use.
 */
export default function GetAppOnPhoneModal({ onClose }) {
  const [token, setToken] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const issue = async () => {
    setBusy(true);
    try {
      const r = await api.post("/auth/magic-link");
      setToken(r.data.token);
      setCopied(false);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    issue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const url = token ? `${window.location.origin}/m/${token}` : "";

  const copy = () => {
    if (!url) return;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      toast.success("Link copied — text it to yourself");
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-zinc-950/60 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      data-testid="get-app-modal"
    >
      <div className="bg-white w-full max-w-md rounded-sm shadow-xl">
        <div className="border-b-2 border-zinc-950 px-6 py-4 flex items-center justify-between">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 flex items-center gap-1.5">
              <Smartphone className="w-3 h-3" /> Get App on My Phone
            </div>
            <div className="font-heading text-lg font-black tracking-tight mt-0.5">Scan to sign in</div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-zinc-100 rounded-sm" data-testid="get-app-close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6">
          {token ? (
            <div className="flex flex-col items-center">
              <div className="p-4 bg-white border-2 border-zinc-950 rounded-sm" data-testid="get-app-qr">
                <QRCodeSVG value={url} size={224} level="M" includeMargin={false} />
              </div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mt-4">Expires in 5 minutes · single use</div>
            </div>
          ) : (
            <div className="text-center py-12 text-sm text-zinc-500">Generating one-time link…</div>
          )}

          <ol className="mt-6 space-y-2 text-xs text-zinc-700 list-decimal list-inside">
            <li>Open your phone camera and point it at the QR code above.</li>
            <li>Tap the link that pops up — you&apos;ll land in the CRM already signed in.</li>
            <li>Tap the browser&apos;s share / menu button → <b>Add to Home Screen</b> to install the app.</li>
          </ol>

          <div className="mt-5 flex items-center gap-2">
            <button
              type="button"
              onClick={copy}
              disabled={!token}
              className="flex-1 inline-flex items-center justify-center gap-1.5 h-9 px-3 text-[10px] font-bold uppercase tracking-wider border border-zinc-300 hover:border-blue-700 hover:text-blue-700 rounded-sm disabled:opacity-50"
              data-testid="get-app-copy"
            >
              {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? "Copied!" : "Copy Link"}
            </button>
            <button
              type="button"
              onClick={issue}
              disabled={busy}
              className="inline-flex items-center gap-1.5 h-9 px-3 text-[10px] font-bold uppercase tracking-wider border border-zinc-300 hover:border-zinc-500 rounded-sm disabled:opacity-50"
              data-testid="get-app-refresh"
              title="Generate a new link (previous one becomes invalid)"
            >
              <RefreshCw className="w-3 h-3" />
              {busy ? "…" : "New"}
            </button>
          </div>

          <div className="mt-5 text-[10px] text-zinc-400 text-center">
            Tip: instead of scanning, you can also email or text the copied link to yourself.
          </div>
        </div>
      </div>
    </div>
  );
}
