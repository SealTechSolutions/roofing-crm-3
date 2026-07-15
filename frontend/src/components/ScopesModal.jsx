import React, { useEffect, useState } from "react";
import { FileText, Download, ExternalLink, X } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";

const API_BASE = (process.env.REACT_APP_BACKEND_URL || "") + "/api";

// ---------- Shared helpers ----------
export const openScopePdf = async (dealId, dealTitle = "project") => {
  const token = localStorage.getItem("crm_token");
  const url = `${API_BASE}/deals/${dealId}/spec-sheet.pdf?token=${encodeURIComponent(token || "")}`;
  window.open(url, "_blank");
};

export const formatMoney = (n) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(n || 0));

// ---------- ScopesButton — drop-in for Contact / Property row action ----------
// Renders a compact "Scopes (N)" chip that, when clicked, opens the modal
// below listing every scope PDF tied to the given contact_id OR property_id.
// Fetches only when opened to keep the parent list lightweight.
export function ScopesButton({ contactId, propertyId, label = "Scopes", testIdPrefix = "scopes-btn" }) {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(null);

  // Prefetch count on mount so the chip renders "(N)" without waiting for
  // the user to click. Cheap query (limit=1 is enough to check existence
  // but we still get the count via .length in the same call — limit=200
  // is fine because rows are lightweight and the modal will need them
  // anyway on open).
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const params = {};
        if (contactId) params.contact_id = contactId;
        if (propertyId) params.property_id = propertyId;
        const r = await api.get("/scopes", { params });
        if (alive) setCount((r.data || []).length);
      } catch { /* silent */ }
    })();
    return () => { alive = false; };
  }, [contactId, propertyId]);

  const disabled = count === 0;
  const chipTestId = `${testIdPrefix}-${contactId || propertyId || "unknown"}`;

  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); if (!disabled) setOpen(true); }}
        disabled={disabled}
        data-testid={chipTestId}
        title={disabled ? "No scopes yet — add a Proposed Roof Type on a deal for this record" : `${count} scope${count === 1 ? "" : "s"} available`}
        className={`inline-flex items-center gap-1 px-2 h-7 text-[10px] font-bold uppercase tracking-wider rounded-sm border transition-colors ${disabled ? "border-zinc-200 text-zinc-400 cursor-not-allowed" : "border-blue-600 text-blue-700 hover:bg-blue-50"}`}
      >
        <FileText className="w-3 h-3" />
        {label}{count !== null ? ` (${count})` : ""}
      </button>
      {open && (
        <ScopesModal
          contactId={contactId}
          propertyId={propertyId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

// ---------- ScopesModal — full list for one contact OR one property ----------
function ScopesModal({ contactId, propertyId, onClose }) {
  const [scopes, setScopes] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const params = {};
        if (contactId) params.contact_id = contactId;
        if (propertyId) params.property_id = propertyId;
        const r = await api.get("/scopes", { params });
        if (alive) setScopes(r.data || []);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [contactId, propertyId]);

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={onClose}
      data-testid="scopes-modal"
    >
      <div
        className="bg-white border border-zinc-200 rounded-sm w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-zinc-200 flex items-center justify-between">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-700">
              {contactId ? "Contact Scopes" : "Property Scopes"}
            </div>
            <h2 className="font-heading text-xl font-black">Downloadable Scope PDFs</h2>
          </div>
          <button
            onClick={onClose}
            data-testid="scopes-modal-close"
            className="text-zinc-400 hover:text-zinc-700 text-xl leading-none p-1"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-12 text-center text-sm text-zinc-500">Loading scopes…</div>
          ) : scopes.length === 0 ? (
            <div className="p-12 text-center text-sm text-zinc-500">
              No scopes yet for this record.<br />
              <span className="text-xs text-zinc-400 mt-2 block">Open a deal and set the <b>Proposed Roof Type</b> to enable scope generation.</span>
            </div>
          ) : (
            <ScopesTable scopes={scopes} />
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- ScopesTable — shared by ScopesModal and the /scopes page ----------
export function ScopesTable({ scopes, showContact = true, showProperty = true }) {
  return (
    <table className="w-full text-sm" data-testid="scopes-table">
      <thead>
        <tr className="border-b-2 border-zinc-950 text-left sticky top-0 bg-zinc-50">
          <th className="px-5 py-3 text-[10px] font-bold uppercase tracking-wider">Project</th>
          <th className="px-5 py-3 text-[10px] font-bold uppercase tracking-wider">Roof Type</th>
          {showContact && (
            <th className="px-5 py-3 text-[10px] font-bold uppercase tracking-wider">Contact</th>
          )}
          {showProperty && (
            <th className="px-5 py-3 text-[10px] font-bold uppercase tracking-wider">Property</th>
          )}
          <th className="px-5 py-3 text-[10px] font-bold uppercase tracking-wider text-right">Amount</th>
          <th className="px-5 py-3 text-[10px] font-bold uppercase tracking-wider text-right">Actions</th>
        </tr>
      </thead>
      <tbody>
        {scopes.map((s) => (
          <tr key={s.id} className="border-b border-zinc-100 hover:bg-zinc-50" data-testid={`scope-row-${s.id}`}>
            <td className="px-5 py-3">
              <Link to={`/deals/${s.id}`} className="font-bold text-zinc-950 hover:text-blue-700">
                {s.title || "(untitled)"}
              </Link>
              {s.updated_at && (
                <div className="text-[10px] text-zinc-500 mt-0.5">
                  Updated {new Date(s.updated_at).toLocaleDateString()}
                </div>
              )}
            </td>
            <td className="px-5 py-3">
              <span className="inline-flex items-center px-2 h-6 text-[10px] font-bold uppercase tracking-wider bg-zinc-100 text-zinc-700 rounded-sm">
                {s.roof_type || "—"}
              </span>
            </td>
            {showContact && (
              <td className="px-5 py-3 text-zinc-700 text-xs">{s.primary_contact_name || "—"}</td>
            )}
            {showProperty && (
              <td className="px-5 py-3 text-zinc-700 text-xs">
                {s.property_name || s.property_address || "—"}
              </td>
            )}
            <td className="px-5 py-3 text-right font-mono text-xs">{formatMoney(s.chosen_amount)}</td>
            <td className="px-5 py-3">
              <div className="flex items-center justify-end gap-1">
                <button
                  onClick={() => openScopePdf(s.id, s.title)}
                  data-testid={`scope-download-${s.id}`}
                  title="Download / view the scope PDF"
                  className="inline-flex items-center gap-1 px-2 h-7 text-[10px] font-bold uppercase tracking-wider bg-blue-700 text-white hover:bg-blue-800 rounded-sm"
                >
                  <Download className="w-3 h-3" /> Scope
                </button>
                <Link
                  to={`/deals/${s.id}`}
                  data-testid={`scope-open-deal-${s.id}`}
                  title="Open the deal"
                  className="inline-flex items-center gap-1 px-2 h-7 text-[10px] font-bold uppercase tracking-wider border border-zinc-300 text-zinc-700 hover:border-zinc-950 rounded-sm"
                >
                  <ExternalLink className="w-3 h-3" />
                </Link>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
