/**
 * useZipAutofill — fires a /api/lookup/zip/{code} call whenever the ZIP
 * input hits 5 digits and calls back with { city, state }. Used to auto-
 * populate address city + state fields in Contacts / Properties / Invoice
 * editors so users don't have to type them.
 *
 * Usage:
 *   useZipAutofill(form.zip_code, (city, state) => {
 *     setForm(f => ({ ...f, city, state }));
 *   });
 *
 * Notes:
 *   • Only fires when zip becomes exactly 5 digits — no partial lookups.
 *   • Debounced 250ms so rapid typing doesn't hammer the endpoint.
 *   • Won't overwrite user-entered city/state that don't match the ZIP.
 *     The onFill callback is invoked once per new ZIP; the caller decides
 *     whether to overwrite (typical: only overwrite if current value is
 *     empty, but the callback receives both values so caller has full
 *     control).
 *   • Silent on lookup failure — form works normally, user just doesn't
 *     get the autofill.
 */
import { useEffect, useRef } from "react";
import { api } from "@/lib/api";

export function useZipAutofill(zip, onFill) {
  const lastLookupRef = useRef("");
  const timerRef = useRef(null);

  useEffect(() => {
    // Clean digits only, take first 5
    const clean = String(zip || "").replace(/\D/g, "").slice(0, 5);
    if (clean.length !== 5) return;
    if (clean === lastLookupRef.current) return;

    // Debounce so a fast-typing user doesn't fire a call on every keystroke
    // (e.g., "8", "80", "802", "8020", "80202" would be 5 calls without this).
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      lastLookupRef.current = clean;
      api.get(`/lookup/zip/${clean}`)
        .then((r) => {
          if (r.data?.ok && r.data.city && r.data.state) {
            onFill(r.data.city, r.data.state, clean);
          }
        })
        .catch(() => { /* silent — user can still type city/state manually */ });
    }, 250);

    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [zip, onFill]);
}
