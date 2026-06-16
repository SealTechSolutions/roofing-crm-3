/* SealTech CRM service worker
 *
 * Strategy:
 *   - Pre-cache the app shell (HTML + a few key assets) so the app boots offline.
 *   - Cache-first for static build assets (/static/*, images, fonts) — these never
 *     change without a hash, so a long-lived cache is safe.
 *   - Network-first for API calls (/api/*) — always try fresh, fall back to a clear
 *     "offline" JSON response so the frontend can show a toast.
 *   - skipWaiting + clients.claim on demand so the "Reload to update" toast can
 *     promote the new worker instantly.
 *
 * BUMP THIS WHEN THE STRATEGY CHANGES (build hashes are taken care of automatically).
 */
const VERSION = "v3";
const SHELL_CACHE = `sealtech-shell-${VERSION}`;
const STATIC_CACHE = `sealtech-static-${VERSION}`;
const SHELL_URLS = ["/", "/index.html", "/manifest.json", "/sealtech-logo.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_URLS)).catch(() => null)
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== SHELL_CACHE && k !== STATIC_CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/static/") ||
    /\.(png|jpg|jpeg|gif|svg|ico|webp|woff2?|ttf|eot|css|js)$/.test(url.pathname)
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin && !url.pathname.startsWith("/api")) return;

  // API: network-first with a clear offline fallback
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(req).catch(() => new Response(
        JSON.stringify({ detail: "Offline — request will be retried when you reconnect.", offline: true }),
        { status: 503, headers: { "Content-Type": "application/json" } }
      ))
    );
    return;
  }

  // Static assets: cache-first
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((resp) => {
        const copy = resp.clone();
        caches.open(STATIC_CACHE).then((c) => c.put(req, copy)).catch(() => null);
        return resp;
      }).catch(() => hit))
    );
    return;
  }

  // HTML / navigations: network-first, fall back to shell
  if (req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html")) {
    event.respondWith(
      fetch(req).catch(() => caches.match("/index.html"))
    );
  }
});
