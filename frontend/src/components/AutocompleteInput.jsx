import React, { useId } from "react";

/**
 * AutocompleteInput — type-ahead on a text input using native <datalist>.
 *
 * Props:
 *   value, onChange       — controlled value
 *   options               — array of strings (or { value, label } objects)
 *   placeholder           — input placeholder
 *   className             — input className passthrough
 *   testId                — data-testid
 *   freeText              — default true; allows typing values not in the list
 *
 * Usage:
 *   <AutocompleteInput
 *     value={doc.warranty_status}
 *     onChange={(v) => update({ warranty_status: v })}
 *     options={["Active", "Limited", "Expired", "Unknown"]}
 *     testId="warranty-status"
 *   />
 *
 * Why <datalist>?
 *   - Native, accessible, mobile-friendly (gets a real OS-level dropdown).
 *   - Suggestions filter as you type ("E" → shows Expired).
 *   - Still allows typing values not in the list (so it's not a strict select).
 */
export default function AutocompleteInput({
  value,
  onChange,
  options = [],
  placeholder = "",
  className = "",
  testId,
  ...rest
}) {
  const id = useId();
  const opts = (options || []).map((o) => (typeof o === "string" ? { value: o, label: o } : o));
  return (
    <>
      <input
        list={id}
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={className}
        data-testid={testId}
        autoComplete="off"
        {...rest}
      />
      <datalist id={id}>
        {opts.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label !== o.value ? o.label : ""}
          </option>
        ))}
      </datalist>
    </>
  );
}
