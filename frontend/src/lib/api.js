import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

export const api = axios.create({ baseURL: API });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("crm_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err?.response?.status === 401) {
      const path = window.location.pathname;
      if (path !== "/login" && path !== "/register") {
        localStorage.removeItem("crm_token");
        window.location.href = "/login";
      }
    }
    return Promise.reject(err);
  }
);

export function formatApiError(detail) {
  if (detail == null) return "Something went wrong. Please try again.";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail))
    return detail
      .map((e) => (e && typeof e.msg === "string" ? e.msg : JSON.stringify(e)))
      .filter(Boolean)
      .join(" ");
  if (detail && typeof detail.msg === "string") return detail.msg;
  return String(detail);
}

export function formatCurrency(n) {
  const v = Number(n || 0);
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

/**
 * If a create/update response includes `gl_warnings` (period-locked GL postings),
 * surface each as a sonner warning toast. Returns true if any were shown.
 * Pass the `toast` instance from "sonner" so we don't bloat this module.
 */
export function showGlWarnings(toast, data) {
  const warnings = data?.gl_warnings;
  if (!Array.isArray(warnings) || warnings.length === 0) return false;
  warnings.forEach((w) => {
    toast.warning(w.message || "GL posting deferred — period locked.", {
      description: w.lock_through ? `Locked through ${w.lock_through}` : undefined,
      duration: 9000,
    });
  });
  return true;
}
