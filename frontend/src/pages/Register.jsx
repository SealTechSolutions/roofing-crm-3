import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { formatApiError } from "@/lib/api";

export default function Register() {
  const { register } = useAuth();
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      await register(name, email, password);
      nav("/", { replace: true });
    } catch (e) {
      setErr(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 p-8">
      <div className="w-full max-w-md">
        <div className="mb-12 flex justify-center">
          <div className="bg-zinc-950 p-4 rounded-sm">
            <img src="/sealtech-logo.png" alt="SealTech Building Solutions" className="h-14 w-auto" />
          </div>
        </div>

        <h1 className="font-heading text-3xl font-black tracking-tight mb-2">Create account.</h1>
        <p className="text-sm text-zinc-500 mb-8">Start tracking your pipeline today.</p>

        <form onSubmit={submit} className="space-y-5" data-testid="register-form">
          <div>
            <label className="block text-xs font-bold uppercase tracking-[0.1em] text-zinc-700 mb-2">Name</label>
            <input
              data-testid="register-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full h-11 px-3 border border-zinc-300 bg-white rounded-sm focus:outline-none focus:ring-2 focus:ring-blue-700 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-bold uppercase tracking-[0.1em] text-zinc-700 mb-2">Email</label>
            <input
              data-testid="register-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full h-11 px-3 border border-zinc-300 bg-white rounded-sm focus:outline-none focus:ring-2 focus:ring-blue-700 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-bold uppercase tracking-[0.1em] text-zinc-700 mb-2">Password</label>
            <input
              data-testid="register-password"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full h-11 px-3 border border-zinc-300 bg-white rounded-sm focus:outline-none focus:ring-2 focus:ring-blue-700 text-sm"
            />
          </div>

          {err && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-sm" data-testid="register-error">
              {err}
            </div>
          )}

          <button
            data-testid="register-submit"
            type="submit"
            disabled={loading}
            className="w-full h-11 bg-blue-700 text-white font-bold uppercase tracking-wider text-sm hover:bg-blue-800 transition-colors rounded-sm disabled:opacity-50"
          >
            {loading ? "Creating..." : "Create Account"}
          </button>

          <p className="text-xs text-zinc-500 text-center pt-2">
            Have an account?{" "}
            <Link to="/login" data-testid="goto-login" className="text-blue-700 font-bold hover:underline">
              Sign in
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
