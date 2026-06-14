/**
 * Display + input-mask helpers for phone numbers and tax IDs.
 *
 * - `formatPhoneDisplay("5551234567")` → "555-123-4567"
 * - `formatPhoneDisplay("15551234567")` → "555-123-4567"  (drops leading country-code "1")
 * - `formatPhoneDisplay("555.123.4567")` → "555-123-4567"
 * - `formatPhoneDisplay("(555) 123 4567 x100")` → "555-123-4567 x100"  (keeps extension)
 * - Anything that isn't 10/11 digits is returned cleaned but un-hyphenated.
 *
 * - `formatTaxIdDisplay("123456789", "EIN")` → "12-3456789"
 * - `formatTaxIdDisplay("123456789", "SSN")` → "123-45-6789"
 */

const digits = (s) => (s || "").toString().replace(/\D+/g, "");

export function formatPhoneDisplay(raw) {
  if (raw == null || raw === "") return "";
  // Preserve an extension if present (e.g. "x100", "ext 4")
  const m = String(raw).match(/(?:^|\s)(x|ext\.?|extension)\s*([\d-]+)\s*$/i);
  let ext = "";
  let trunk = String(raw);
  if (m) {
    ext = ` x${m[2].replace(/\D+/g, "")}`;
    trunk = trunk.slice(0, m.index);
  }
  let d = digits(trunk);
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}${ext}`;
  if (d.length === 7) return `${d.slice(0, 3)}-${d.slice(3)}${ext}`;
  // Fall back to the cleaned digits if it doesn't fit a US shape
  return d ? `${d}${ext}` : "";
}

/** Live-mask phone input so the user always sees hyphens as they type. */
export function maskPhoneInput(raw) {
  if (raw == null) return "";
  let d = digits(raw);
  if (d.length > 11) d = d.slice(0, 11);
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6, 10)}`;
}

/** EIN = XX-XXXXXXX (9 digits, hyphen after the 2nd). SSN = XXX-XX-XXXX (3-2-4). */
export function maskTaxIdInput(raw, kind = "EIN") {
  let d = digits(raw).slice(0, 9);
  if (!d) return "";
  if (kind === "SSN") {
    if (d.length <= 3) return d;
    if (d.length <= 5) return `${d.slice(0, 3)}-${d.slice(3)}`;
    return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
  }
  // EIN
  if (d.length <= 2) return d;
  return `${d.slice(0, 2)}-${d.slice(2)}`;
}

export function formatTaxIdDisplay(raw, kind = "EIN") {
  return maskTaxIdInput(raw, kind);
}
