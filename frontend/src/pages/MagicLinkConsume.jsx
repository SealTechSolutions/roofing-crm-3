import React, { useEffect, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import axios from "axios";
import { CheckCircle2, AlertCircle, Smartphone } from "lucide-react";

const API_BASE = process.env.REACT_APP_BACKEND_URL;

/**
 * Tab-scoped consume cache (sessionStorage) that survives React StrictMode's
 * double-mount AND any HMR-induced module re-evaluation in dev. The first
 * caller acquires a lock and runs the POST; subsequent callers within the
 * same tab/token poll until the result lands. Once a token has been consumed
 * successfully, every later caller in this tab gets the cached JWT response.
 */
const RESULT_KEY = (t) => `magic-link-result-${t}`;
const ERROR_KEY = (t) => `magic-link-error-${t}`;
const LOCK_KEY = (t) => `magic-link-lock-${t}`;

async function consumeOnce(token) {
  // 1. Already-resolved? Return cached.
  const cached = sessionStorage.getItem(RESULT_KEY(token));
  if (cached) return { data: JSON.parse(cached) };
  const cachedErr = sessionStorage.getItem(ERROR_KEY(token));
  if (cachedErr) throw new Error(cachedErr);

  // 2. Acquire lock synchronously (sessionStorage writes are sync).
  if (sessionStorage.getItem(LOCK_KEY(token))) {
    // Another caller is in flight — poll for up to 6s.
    return await new Promise((resolve, reject) => {
      const t0 = Date.now();
      const tick = () => {
        const ok = sessionStorage.getItem(RESULT_KEY(token));
        if (ok) return resolve({ data: JSON.parse(ok) });
        const er = sessionStorage.getItem(ERROR_KEY(token));
        if (er) return reject(new Error(er));
        if (Date.now() - t0 > 6000) return reject(new Error("timeout"));
        setTimeout(tick, 60);
      };
      tick();
    });
  }
  sessionStorage.setItem(LOCK_KEY(token), "1");

  // 3. We hold the lock — fire the single network request.
  try {
    const r = await axios.post(`${API_BASE}/api/auth/magic-link/consume`, { token });
    sessionStorage.setItem(RESULT_KEY(token), JSON.stringify(r.data));
    return r;
  } catch (e) {
    const msg = e?.response?.data?.detail || e?.message || "Could not consume link";
    sessionStorage.setItem(ERROR_KEY(token), msg);
    throw e;
  }
}

/**
 * Magic-link consumer page — public route `/m/:token`.
 *
 * The user scans the QR code from a desktop session on their phone, lands
 * here, the token is exchanged for a JWT, and they're redirected to the
 * dashboard already signed in. Single-use; expires in 5 minutes.
 *
 * Supports `?next=…` query param to redirect to a specific in-app path
 * (e.g. `/field?deal_id=abc`) after sign-in instead of the dashboard.
 */
export default function MagicLinkConsume() {
  const { token } = useParams();
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const nextPath = searchParams.get("next") || "/";
  const [error, setError] = useState("");
  const [user, setUser] = useState(null);

  useEffect(() => {
    let cancelled = false;
    consumeOnce(token)
      .then((r) => {
        if (cancelled) return;
        const data = r.data;
        // Match what /auth/login does: stash token + user in localStorage
        localStorage.setItem("crm_token", data.access_token);
        if (data.user) localStorage.setItem("crm_user", JSON.stringify(data.user));
        setUser(data.user);
        // Only allow same-origin relative paths for `next` to avoid open-redirect.
        const safeNext = nextPath.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/";
        // Brief pause so the user sees the confirmation before redirect
        setTimeout(() => nav(safeNext, { replace: true }), 1200);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e?.response?.data?.detail || "This link is invalid or expired.");
        }
      });
    return () => { cancelled = true; };
  }, [token, nav, nextPath]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 p-4">
      <div className="bg-white border-2 border-zinc-950 rounded-sm shadow-xl p-8 max-w-sm w-full text-center">
        <Smartphone className="w-12 h-12 text-[#062B67] mx-auto mb-4" />
        {error ? (
          <>
            <AlertCircle className="w-10 h-10 text-rose-700 mx-auto mb-2" />
            <h1 className="font-heading text-xl font-black tracking-tight text-zinc-900 mb-1">Sign-in link unavailable</h1>
            <p className="text-sm text-zinc-600">{error}</p>
            <p className="text-xs text-zinc-500 mt-4">Generate a new link from your desktop session and try again.</p>
          </>
        ) : user ? (
          <>
            <CheckCircle2 className="w-10 h-10 text-emerald-700 mx-auto mb-2" />
            <h1 className="font-heading text-xl font-black tracking-tight text-zinc-900 mb-1">Signed in</h1>
            <p className="text-sm text-zinc-600">Welcome back, <b>{user.name || user.email}</b>. Redirecting…</p>
          </>
        ) : (
          <>
            <div className="text-sm text-zinc-600">Signing you in…</div>
          </>
        )}
      </div>
    </div>
  );
}
