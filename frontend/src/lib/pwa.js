/**
 * Service Worker registration + update prompt + install prompt capture.
 *
 * - Registers `/sw.js` on load.
 * - When a new SW takes "waiting" state, fires a custom `sw:update-ready` event
 *   so the UI can show a "New version — Reload" toast.
 * - Captures the `beforeinstallprompt` event and stashes it on `window` so the
 *   InstallAppButton component can trigger it on user gesture.
 * - Listens for `online` / `offline` and dispatches matching events.
 */

export function registerServiceWorker() {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;

  // Only register in production-style domains. Skip on localhost dev to avoid stale-cache pain.
  const isLocalhost = ["localhost", "127.0.0.1"].includes(window.location.hostname);
  if (isLocalhost && process.env.NODE_ENV !== "production") return;

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        // Look for waiting worker (the next version is staged).
        if (reg.waiting) {
          window.dispatchEvent(new CustomEvent("sw:update-ready", { detail: { registration: reg } }));
        }
        reg.addEventListener("updatefound", () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener("statechange", () => {
            if (nw.state === "installed" && navigator.serviceWorker.controller) {
              window.dispatchEvent(new CustomEvent("sw:update-ready", { detail: { registration: reg } }));
            }
          });
        });
      })
      .catch(() => null);

    // Reload when a new SW takes over so the page is now using the fresh build.
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    });
  });

  // Stash the install prompt so we can fire it from a user gesture later
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    window.__deferredInstallPrompt = e;
    window.dispatchEvent(new CustomEvent("pwa:install-available"));
  });

  window.addEventListener("appinstalled", () => {
    window.__deferredInstallPrompt = null;
    window.dispatchEvent(new CustomEvent("pwa:installed"));
  });

  // Online/offline broadcast helpers (used by App-level toasts)
  window.addEventListener("offline", () => window.dispatchEvent(new CustomEvent("pwa:offline")));
  window.addEventListener("online", () => window.dispatchEvent(new CustomEvent("pwa:online")));
}

export function promoteWaitingWorker(registration) {
  if (registration && registration.waiting) {
    registration.waiting.postMessage({ type: "SKIP_WAITING" });
  }
}

export async function triggerInstallPrompt() {
  const p = window.__deferredInstallPrompt;
  if (!p) return { outcome: "unavailable" };
  await p.prompt();
  const choice = await p.userChoice;
  window.__deferredInstallPrompt = null;
  return choice;
}
