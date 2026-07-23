/**
 * useForceSpellcheck — global hook that forces native browser spellcheck to
 * be enabled on every <textarea> and text-like <input> across the app.
 *
 * Why:
 *   • Some embedded WebViews (Capacitor / iOS TestFlight builds) don't apply
 *     spellcheck by default, so users can enter typos ("cahnage",
 *     "insullation") without seeing any warning underline.
 *   • Even on desktop browsers, ensuring the attribute is explicit gives
 *     consistent behavior + also enables autocorrect + autocapitalize on
 *     mobile keyboards.
 *
 * Behavior:
 *   • On mount, walks the whole document tree and force-sets
 *       spellcheck="true"
 *       autocorrect="on"
 *       autocapitalize="sentences"
 *     on every editable element.
 *   • Sets up a MutationObserver so dynamically-added inputs (modals,
 *     finding rows, expandable panels) also get the treatment.
 *   • Only text-like inputs get spellcheck — never numeric / date / email /
 *     password / etc. (we'd fight the browser for no benefit).
 *
 * Usage: call `useForceSpellcheck()` once in a top-level component (Layout).
 */
import { useEffect } from "react";

const NON_TEXT_INPUT_TYPES = new Set([
  "number", "date", "datetime-local", "time", "month", "week",
  "email", "url", "tel", "password", "checkbox", "radio",
  "file", "hidden", "range", "color", "submit", "button", "reset",
]);

function enable(root) {
  root.querySelectorAll("textarea").forEach((el) => {
    // Respect explicit `spellCheck={false}` in JSX (e.g., code fields).
    if (el.getAttribute("spellcheck") === "false") return;
    el.setAttribute("spellcheck", "true");
    el.setAttribute("autocorrect", "on");
    if (!el.hasAttribute("autocapitalize")) el.setAttribute("autocapitalize", "sentences");
  });
  root.querySelectorAll("input").forEach((el) => {
    if (el.getAttribute("spellcheck") === "false") return;
    const t = (el.getAttribute("type") || "text").toLowerCase();
    if (NON_TEXT_INPUT_TYPES.has(t)) return;
    el.setAttribute("spellcheck", "true");
    el.setAttribute("autocorrect", "on");
    if (!el.hasAttribute("autocapitalize")) el.setAttribute("autocapitalize", "sentences");
  });
}

export function useForceSpellcheck() {
  useEffect(() => {
    if (typeof document === "undefined") return;
    enable(document);
    const mo = new MutationObserver((mutations) => {
      for (const m of mutations) {
        m.addedNodes.forEach((n) => {
          if (n.nodeType === 1) enable(n);
        });
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, []);
}
