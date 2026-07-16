import React, { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { api, formatApiError } from "@/lib/api";
import { toast } from "sonner";
import { X, Smartphone, RefreshCw, Copy, CheckCircle2, Share, Plus, MoreVertical } from "lucide-react";

/**
 * Get App on My Phone — modal that issues a one-time magic-link token and
 * shows a QR code the user scans with their phone camera.
 *
 * The scanned URL (/m/:token) hits the public `consume` endpoint, drops the
 * returned JWT into localStorage, and forwards to the dashboard (or to
 * `redirectPath` when provided — e.g. `/field?deal_id=abc` from a Deal).
 * Token expires in 5 minutes and is single-use.
 *
 * After scanning, the modal is emphatic about the CRITICAL final step: on
 * both iOS and Android the user MUST tap Add-to-Home-Screen to promote the
 * PWA from "site loaded in browser" to "standalone app icon". Skipping this
 * is why the app has previously felt like a URL instead of a native app.
 */
export default function GetAppOnPhoneModal({ onClose, redirectPath, title, subtitle }) {
  const [token, setToken] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  // Detect if the modal was opened from within an already-installed PWA. In
  // that case the "Add to Home Screen" prompt is redundant — show a
  // celebratory confirmation instead.
  const isStandalone = typeof window !== "undefined" && (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    window.navigator?.standalone === true
  );

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

  const url = token
    ? `${window.location.origin}/m/${token}${redirectPath ? `?next=${encodeURIComponent(redirectPath)}` : ""}`
    : "";

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
      <div className="bg-white w-full max-w-md rounded-sm shadow-xl max-h-[92vh] overflow-y-auto">
        <div className="border-b-2 border-zinc-950 px-6 py-4 flex items-center justify-between sticky top-0 bg-white">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 flex items-center gap-1.5">
              <Smartphone className="w-3 h-3" /> {title || "Install SealTech CRM on My Phone"}
            </div>
            <div className="font-heading text-lg font-black tracking-tight mt-0.5">{subtitle || "Turn this website into a real app"}</div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-zinc-100 rounded-sm" data-testid="get-app-close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6">
          {/* Already installed? Show confirmation and skip the install steps. */}
          {isStandalone && (
            <div className="mb-5 p-4 bg-emerald-50 border-2 border-emerald-600 rounded-sm text-center" data-testid="get-app-already-installed">
              <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto mb-2" />
              <div className="text-sm font-bold text-emerald-900">You&apos;re already running the installed app</div>
              <div className="text-xs text-emerald-700 mt-1">You can use this same QR code to install it on additional devices for your team.</div>
            </div>
          )}

          {/* STEP 1 — Scan */}
          <div className="mb-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-6 h-6 rounded-full bg-blue-700 text-white text-xs font-bold flex items-center justify-center">1</div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-800">Scan &amp; open in your phone browser</div>
            </div>
            {token ? (
              <div className="flex flex-col items-center">
                <div className="p-4 bg-white border-2 border-zinc-950 rounded-sm" data-testid="get-app-qr">
                  <QRCodeSVG value={url} size={200} level="M" includeMargin={false} />
                </div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mt-3">Expires in 5 minutes · single use</div>
              </div>
            ) : (
              <div className="text-center py-12 text-sm text-zinc-500">Generating one-time link…</div>
            )}
          </div>

          {/* STEP 2 — Add to Home Screen (the previously-missed step!) */}
          {!isStandalone && (
            <div className="mb-5 p-4 bg-blue-50 border-2 border-blue-700 rounded-sm" data-testid="get-app-add-to-home-step">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-6 h-6 rounded-full bg-blue-700 text-white text-xs font-bold flex items-center justify-center">2</div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-blue-900">
                  Add to Home Screen &mdash; this is what makes it a real app
                </div>
              </div>
              <div className="text-[11px] text-blue-900 mb-3 leading-snug">
                Without this step the CRM stays inside your browser (URL bar visible, back button broken, kicks you out on restart). <b>Do this once — it takes 5 seconds — and you get a real app icon that behaves like Apple Mail or Slack.</b>
              </div>

              {/* iPhone instructions */}
              <div className="bg-white border border-zinc-200 rounded-sm p-3 mb-2">
                <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-700 mb-1.5 flex items-center gap-1"><Smartphone className="w-3 h-3" /> iPhone / iPad (Safari)</div>
                <ol className="text-[11px] text-zinc-700 space-y-1 leading-snug list-decimal ml-5">
                  <li>Tap the <b>Share</b> button <Share className="inline w-3 h-3 -mt-0.5" /> at the bottom of Safari</li>
                  <li>Scroll down and tap <b>Add to Home Screen</b> <Plus className="inline w-3 h-3 -mt-0.5" /></li>
                  <li>Tap <b>Add</b> in the top-right corner</li>
                  <li>Close Safari — launch the CRM from the new home-screen icon <i>(SealTech logo, no URL bar)</i></li>
                </ol>
              </div>

              {/* Android instructions */}
              <div className="bg-white border border-zinc-200 rounded-sm p-3">
                <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-700 mb-1.5 flex items-center gap-1"><Smartphone className="w-3 h-3" /> Android (Chrome)</div>
                <ol className="text-[11px] text-zinc-700 space-y-1 leading-snug list-decimal ml-5">
                  <li>Tap the <b>⋮</b> <MoreVertical className="inline w-3 h-3 -mt-0.5" /> menu (top-right of Chrome)</li>
                  <li>Tap <b>Install app</b> or <b>Add to Home Screen</b></li>
                  <li>Confirm the install prompt</li>
                  <li>The SealTech icon appears on your home screen — launch from there</li>
                </ol>
              </div>
            </div>
          )}

          {/* Backup: copy link */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={copy}
              disabled={!token}
              className="flex-1 inline-flex items-center justify-center gap-1.5 h-9 px-3 text-[10px] font-bold uppercase tracking-wider border border-zinc-300 hover:border-blue-700 hover:text-blue-700 rounded-sm disabled:opacity-50"
              data-testid="get-app-copy"
            >
              {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? "Copied!" : "Copy Link (text to yourself)"}
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

          <div className="mt-4 text-[10px] text-zinc-400 text-center leading-snug">
            Sharing this link is safe — it signs the recipient in as YOU and expires in 5 minutes.<br />
            For your team, ask each person to open the login page separately, sign in with their own account, and follow the same install steps above.
          </div>
        </div>
      </div>
    </div>
  );
}
