import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { formatApiError } from "@/lib/api";

const BG = "https://images.pexels.com/photos/4458205/pexels-photo-4458205.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940";

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("admin@roofingcrm.com");
  const [password, setPassword] = useState("admin123");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      await login(email, password);
      nav("/", { replace: true });
    } catch (e) {
      setErr(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-zinc-50">
      <div className="flex items-center justify-center p-8 lg:p-16 order-2 lg:order-1">
        <div className="w-full max-w-md">
          <div className="mb-12 bg-zinc-950 p-4 rounded-sm inline-block">
            <img src="/sealtech-logo.png" alt="SealTech Building Solutions" className="h-14 w-auto" />
          </div>

          <h1 className="font-heading text-3xl sm:text-4xl font-black tracking-tight leading-none mb-2">
            Sign in.
          </h1>
          <p className="text-sm text-zinc-500 mb-10">
            Manage leads, properties, and your project P&amp;L.
          </p>

          <form onSubmit={submit} className="space-y-5" data-testid="login-form">
            <div>
              <label className="block text-xs font-bold uppercase tracking-[0.1em] text-zinc-700 mb-2">Email</label>
              <input
                data-testid="login-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full h-11 px-3 border border-zinc-300 bg-white rounded-sm focus:outline-none focus:ring-2 focus:ring-blue-700 focus:border-transparent text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-[0.1em] text-zinc-700 mb-2">Password</label>
              <input
                data-testid="login-password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full h-11 px-3 border border-zinc-300 bg-white rounded-sm focus:outline-none focus:ring-2 focus:ring-blue-700 focus:border-transparent text-sm"
              />
            </div>

            {err && (
              <div className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-sm" data-testid="login-error">
                {err}
              </div>
            )}

            <button
              data-testid="login-submit"
              type="submit"
              disabled={loading}
              className="w-full h-11 bg-blue-700 text-white font-bold uppercase tracking-wider text-sm hover:bg-blue-800 transition-colors rounded-sm disabled:opacity-50"
            >
              {loading ? "Signing in..." : "Sign In"}
            </button>

            <p className="text-xs text-zinc-500 text-center pt-2">
              No account?{" "}
              <Link to="/register" data-testid="goto-register" className="text-blue-700 font-bold hover:underline">
                Create one
              </Link>
            </p>
          </form>
        </div>
      </div>

      <div
        className="hidden lg:block relative order-1 lg:order-2"
        style={{ backgroundImage: `url(${BG})`, backgroundSize: "cover", backgroundPosition: "center" }}
      >
        <div className="absolute inset-0 bg-zinc-950/70" />
        <div className="relative h-full flex flex-col justify-end p-12 text-white">
          <div className="text-[10px] uppercase tracking-[0.3em] text-orange-500 mb-3">Building Solutions</div>
          <h2 className="font-heading text-4xl font-black tracking-tight leading-tight max-w-md">
            From first call to closed roof. One operating system.
          </h2>
        </div>
      </div>
    </div>
  );
}
