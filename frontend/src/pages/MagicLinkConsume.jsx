import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import axios from "axios";
import { CheckCircle2, AlertCircle, Smartphone } from "lucide-react";

const API_BASE = process.env.REACT_APP_BACKEND_URL;

/**
 * Magic-link consumer page — public route `/m/:token`.
 *
 * The user scans the QR code from a desktop session on their phone, lands
 * here, the token is exchanged for a JWT, and they're redirected to the
 * dashboard already signed in. Single-use; expires in 5 minutes.
 */
export default function MagicLinkConsume() {
  const { token } = useParams();
  const nav = useNavigate();
  const [error, setError] = useState("");
  const [user, setUser] = useState(null);

  useEffect(() => {
    let cancelled = false;
    axios
      .post(`${API_BASE}/api/auth/magic-link/consume`, { token })
      .then((r) => {
        if (cancelled) return;
        const data = r.data;
        // Match what /auth/login does: stash token + user in localStorage
        localStorage.setItem("crm_token", data.access_token);
        if (data.user) localStorage.setItem("crm_user", JSON.stringify(data.user));
        setUser(data.user);
        // Brief pause so the user sees the confirmation before redirect
        setTimeout(() => nav("/", { replace: true }), 1200);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e?.response?.data?.detail || "This link is invalid or expired.");
        }
      });
    return () => { cancelled = true; };
  }, [token, nav]);

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
