import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Download, RefreshCw, WifiOff } from "lucide-react";
import { promoteWaitingWorker, triggerInstallPrompt } from "@/lib/pwa";

/**
 * PWAControls — mounts once at the app root. Handles:
 *   1. "New version available — Reload" toast (sw:update-ready)
 *   2. Offline/online toasts
 *   3. Renders a small "Install App" button when beforeinstallprompt fired
 *      and the app isn't already standalone-installed.
 */
export default function PWAControls() {
  const [installAvail, setInstallAvail] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    // If already installed (running standalone), hide the install button
    const standalone = window.matchMedia && window.matchMedia("(display-mode: standalone)").matches;
    if (standalone || window.navigator.standalone === true) setInstalled(true);

    const onUpdate = (e) => {
      const reg = e.detail?.registration;
      toast("New version available", {
        description: "Reload to get the latest changes.",
        duration: 1000 * 60 * 10,
        action: {
          label: "Reload",
          onClick: () => promoteWaitingWorker(reg),
        },
      });
    };
    const onInstallAvail = () => setInstallAvail(true);
    const onInstalled = () => { setInstalled(true); setInstallAvail(false); toast.success("App installed"); };
    const onOffline = () => toast.error("You're offline", { description: "Live data and saves are paused until you reconnect.", icon: <WifiOff className="w-4 h-4" /> });
    const onOnline = () => toast.success("Back online");

    window.addEventListener("sw:update-ready", onUpdate);
    window.addEventListener("pwa:install-available", onInstallAvail);
    window.addEventListener("pwa:installed", onInstalled);
    window.addEventListener("pwa:offline", onOffline);
    window.addEventListener("pwa:online", onOnline);
    return () => {
      window.removeEventListener("sw:update-ready", onUpdate);
      window.removeEventListener("pwa:install-available", onInstallAvail);
      window.removeEventListener("pwa:installed", onInstalled);
      window.removeEventListener("pwa:offline", onOffline);
      window.removeEventListener("pwa:online", onOnline);
    };
  }, []);

  if (installed || !installAvail) return null;

  return (
    <button
      onClick={async () => {
        const c = await triggerInstallPrompt();
        if (c?.outcome === "accepted") setInstallAvail(false);
      }}
      className="fixed bottom-4 right-4 z-40 inline-flex items-center gap-2 h-10 px-4 bg-zinc-950 hover:bg-zinc-800 text-white rounded-sm shadow-xl border border-zinc-700 text-[11px] font-bold uppercase tracking-wider"
      data-testid="pwa-install-btn"
      aria-label="Install SealTech CRM as an app"
    >
      <Download className="w-3.5 h-3.5" />
      Install App
    </button>
  );
}

// Compact header version (used on the sidebar)
export function PWAUpdateBadge() {
  const [hasUpdate, setHasUpdate] = useState(false);
  const [reg, setReg] = useState(null);
  useEffect(() => {
    const onUpdate = (e) => { setHasUpdate(true); setReg(e.detail?.registration); };
    window.addEventListener("sw:update-ready", onUpdate);
    return () => window.removeEventListener("sw:update-ready", onUpdate);
  }, []);
  if (!hasUpdate) return null;
  return (
    <button
      onClick={() => promoteWaitingWorker(reg)}
      className="inline-flex items-center gap-1.5 px-2 h-7 text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-900 hover:bg-amber-200 rounded-sm border border-amber-300"
      data-testid="pwa-update-badge"
      title="A new version is ready — click to reload"
    >
      <RefreshCw className="w-3 h-3" />
      Update
    </button>
  );
}
