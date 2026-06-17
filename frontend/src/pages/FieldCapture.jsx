import React, { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { Camera, Upload, CloudOff, CheckCircle2, AlertCircle, LogOut, Loader2, ChevronLeft, Search } from "lucide-react";

const API_BASE = process.env.REACT_APP_BACKEND_URL;
const QUEUE_DB = "field-photo-queue";
const QUEUE_STORE = "shots";

// ---------- Tiny IndexedDB wrapper (offline queue) ----------
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(QUEUE_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(QUEUE_STORE, { keyPath: "id", autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function queueAdd(item) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, "readwrite");
    tx.objectStore(QUEUE_STORE).add(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function queueAll() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, "readonly");
    const req = tx.objectStore(QUEUE_STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
async function queueDelete(id) {
  const db = await openDb();
  return new Promise((resolve) => {
    const tx = db.transaction(QUEUE_STORE, "readwrite");
    tx.objectStore(QUEUE_STORE).delete(id);
    tx.oncomplete = () => resolve();
  });
}

// ---------- The page ----------
export default function FieldCapture() {
  const nav = useNavigate();
  // Read ?deal_id=… deep-link param directly from window.location so it
  // survives all dev-env source instrumentation. Static one-shot read.
  const urlDealId = (() => {
    if (typeof window === "undefined") return "";
    try {
      const sp = new URLSearchParams(window.location.search);
      return sp.get("deal_id") || "";
    } catch (e) { return ""; }
  })();
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const canvasRef = useRef(null);
  const flushingRef = useRef(false);

  const [token] = useState(() => localStorage.getItem("crm_token") || "");
  const [me, setMe] = useState(null);
  const [deals, setDeals] = useState([]);
  const [dealId, setDealId] = useState("");
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [uploadingShot, setUploadingShot] = useState(false);
  const [uploadedCount, setUploadedCount] = useState(0);
  const [queuedCount, setQueuedCount] = useState(0);
  const [online, setOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);

  // ---------- Auth + projects bootstrap ----------
  useEffect(() => {
    if (!token) {
      nav("/login", { replace: true });
      return;
    }
    const h = { Authorization: `Bearer ${token}` };
    axios
      .get(`${API_BASE}/api/auth/me`, { headers: h })
      .then((r) => setMe(r.data))
      .catch(() => nav("/login", { replace: true }));
    axios
      .get(`${API_BASE}/api/deals?limit=1000`, { headers: h })
      .then((r) => {
        const open = (r.data || []).filter(
          (d) => !["Closed", "Lost", "Past Lead"].includes(d.status || "")
        );
        // Sort: most recently updated first
        open.sort((a, b) => String(b.updated_at || b.created_at || "").localeCompare(String(a.updated_at || a.created_at || "")));
        setDeals(open);
        // Deep-link from a Deal page: ?deal_id=… wins over localStorage default.
        if (urlDealId && open.find((d) => d.id === urlDealId)) {
          setDealId(urlDealId);
        } else {
          const last = localStorage.getItem("field_capture_last_deal_id");
          if (last && open.find((d) => d.id === last)) setDealId(last);
        }
      })
      .catch(() => setDeals([]));
  }, [token, nav, urlDealId]);

  // Persist project pick
  useEffect(() => {
    if (dealId) localStorage.setItem("field_capture_last_deal_id", dealId);
  }, [dealId]);

  // ---------- Camera stream ----------
  // Use a callback ref so we can bind srcObject the instant the <video>
  // element mounts (the element doesn't exist on the list view, so a regular
  // useRef would be null when startCamera runs).
  const setVideoEl = useCallback((el) => {
    videoRef.current = el;
    if (el && streamRef.current) {
      el.srcObject = streamRef.current;
      el.play().catch(() => {});
    }
  }, []);

  const startCamera = useCallback(async () => {
    try {
      setCameraError("");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }
      setCameraReady(true);
    } catch (e) {
      setCameraError(e.message || "Camera unavailable. Allow camera access in your browser settings.");
      setCameraReady(false);
    }
  }, []);

  // Start the camera only when entering the camera view (dealId set). Stop
  // and release the device when returning to the list so the phone's LED
  // turns off and no permission prompt fires until the user actually picks
  // a project to shoot.
  useEffect(() => {
    if (!dealId) return undefined;
    startCamera();
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      setCameraReady(false);
    };
  }, [dealId, startCamera]);

  // ---------- Online/offline listeners ----------
  useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine);
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
    };
  }, []);

  // ---------- Queue management ----------
  const refreshQueueCount = useCallback(async () => {
    const items = await queueAll();
    setQueuedCount(items.length);
  }, []);

  const flushQueue = useCallback(async () => {
    if (flushingRef.current || !navigator.onLine) return;
    flushingRef.current = true;
    try {
      const items = await queueAll();
      for (const item of items) {
        try {
          const fd = new FormData();
          fd.append("file", item.blob, item.filename);
          await axios.post(
            `${API_BASE}/api/projects/${item.deal_id}/photos`,
            fd,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          await queueDelete(item.id);
          setUploadedCount((n) => n + 1);
        } catch {
          // Stop on first failure (likely back offline) — retry next time.
          break;
        }
      }
    } finally {
      flushingRef.current = false;
      await refreshQueueCount();
    }
  }, [token, refreshQueueCount]);

  // Auto-flush on mount + on connectivity restore
  useEffect(() => {
    refreshQueueCount();
    flushQueue();
    const onOnline = () => flushQueue();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [flushQueue, refreshQueueCount]);

  // ---------- Capture + upload ----------
  const captureAndUpload = useCallback(async () => {
    if (!dealId) { alert("Pick a project first."); return; }
    if (!cameraReady || !videoRef.current) return;
    if (uploadingShot) return;

    const video = videoRef.current;
    const canvas = canvasRef.current || document.createElement("canvas");
    canvasRef.current = canvas;
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.85)
    );
    if (!blob) return;
    const filename = `field-${Date.now()}.jpg`;

    setUploadingShot(true);
    try {
      if (navigator.onLine) {
        try {
          const fd = new FormData();
          fd.append("file", blob, filename);
          await axios.post(
            `${API_BASE}/api/projects/${dealId}/photos`,
            fd,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          setUploadedCount((n) => n + 1);
        } catch {
          // network blip mid-upload — drop into queue
          await queueAdd({ deal_id: dealId, blob, filename, created_at: Date.now() });
          await refreshQueueCount();
        }
      } else {
        await queueAdd({ deal_id: dealId, blob, filename, created_at: Date.now() });
        await refreshQueueCount();
      }
    } finally {
      setUploadingShot(false);
    }
  }, [dealId, cameraReady, uploadingShot, token, refreshQueueCount]);

  // ---------- Render ----------
  const activeDeal = deals.find((d) => d.id === dealId);

  // Handler to leave the camera and return to the project list. Stops the
  // stream so the phone's flashlight/camera light turns off between sessions.
  const backToList = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraReady(false);
    setDealId("");
    localStorage.removeItem("field_capture_last_deal_id");
    // Strip ?deal_id= from the URL without a full reload so the list view shows.
    if (window.location.search) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  // ---------- Project list view (no project selected yet) ----------
  if (!dealId) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white flex flex-col" data-testid="field-capture">
        <TopBar me={me} online={online} onLogout={() => { localStorage.removeItem("crm_token"); nav("/login", { replace: true }); }} />
        <ProjectList
          deals={deals}
          onPick={(id) => setDealId(id)}
          queuedCount={queuedCount}
        />
      </div>
    );
  }

  // ---------- Camera capture view (project picked) ----------
  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col" data-testid="field-capture">
      {/* Top bar — back arrow + project name */}
      <div className="px-2 py-3 bg-zinc-900 border-b border-zinc-800 flex items-center gap-2">
        <button
          onClick={backToList}
          className="p-2 -ml-1 text-zinc-300 hover:text-white rounded-sm"
          data-testid="field-back"
          aria-label="Back to projects"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Capturing for</div>
          <div className="text-sm text-white font-semibold truncate">{activeDeal ? activeDeal.title : "…"}</div>
        </div>
        {!online ? (
          <span className="inline-flex items-center gap-1 px-2 py-1 bg-amber-900 text-amber-200 text-[10px] font-bold uppercase rounded-sm">
            <CloudOff className="w-3 h-3" /> Offline
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-900 text-emerald-200 text-[10px] font-bold uppercase rounded-sm">
            <CheckCircle2 className="w-3 h-3" /> Online
          </span>
        )}
        <button
          onClick={() => { localStorage.removeItem("crm_token"); nav("/login", { replace: true }); }}
          className="p-2 text-zinc-400 hover:text-white"
          data-testid="field-logout"
          title="Sign out"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>

      {/* Live camera */}
      <div className="relative flex-1 bg-black flex items-center justify-center overflow-hidden">
        {cameraError ? (
          <div className="text-center p-6">
            <AlertCircle className="w-10 h-10 text-rose-500 mx-auto mb-3" />
            <div className="text-sm text-zinc-300 mb-2">{cameraError}</div>
            <button onClick={startCamera} className="px-4 py-2 bg-blue-700 hover:bg-blue-800 text-xs font-bold uppercase tracking-wider rounded-sm">
              Try Again
            </button>
          </div>
        ) : (
          <video
            ref={setVideoEl}
            playsInline
            muted
            autoPlay
            className="max-w-full max-h-full object-contain"
            data-testid="field-video"
          />
        )}
      </div>

      {/* Status strip */}
      <div className="px-4 py-2 bg-zinc-900 border-t border-zinc-800 flex items-center justify-between text-[11px]">
        <div className="text-zinc-400 truncate" data-testid="field-status">
          {activeDeal ? (
            <span>To: <b className="text-zinc-100">{activeDeal.title}</b></span>
          ) : (
            <span className="text-amber-400">Pick a project to enable capture</span>
          )}
        </div>
        <div className="flex items-center gap-3 font-mono text-[11px]">
          <span className="text-emerald-400" data-testid="field-uploaded-count">
            <CheckCircle2 className="inline w-3 h-3" /> {uploadedCount}
          </span>
          {queuedCount > 0 && (
            <span className="text-amber-400" data-testid="field-queued-count">
              <CloudOff className="inline w-3 h-3" /> {queuedCount} queued
            </span>
          )}
        </div>
      </div>

      {/* Big shutter */}
      <div className="bg-zinc-900 px-4 py-6 flex items-center justify-center border-t border-zinc-800">
        <button
          onClick={captureAndUpload}
          disabled={!cameraReady || !dealId || uploadingShot}
          className="w-24 h-24 rounded-full bg-white hover:bg-zinc-200 active:scale-95 transition-all flex items-center justify-center shadow-2xl border-4 border-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed"
          data-testid="field-shutter"
          aria-label="Capture photo"
        >
          {uploadingShot ? (
            <Loader2 className="w-10 h-10 text-blue-700 animate-spin" />
          ) : (
            <div className="w-20 h-20 rounded-full bg-zinc-100 border-2 border-zinc-300" />
          )}
        </button>
      </div>
    </div>
  );
}

// ---------- Small sub-components ----------

/**
 * Top bar shared between list view and camera view (the camera view renders
 * its own variant with a back arrow). Shows the signed-in user, online pill,
 * and logout button.
 */
function TopBar({ me, online, onLogout }) {
  return (
    <div className="px-4 py-3 bg-zinc-900 border-b border-zinc-800 flex items-center gap-3">
      <Camera className="w-5 h-5 text-blue-400" />
      <div className="flex-1 min-w-0">
        <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Field Capture</div>
        <div className="text-xs text-zinc-300 truncate">{me ? me.name || me.email : "…"}</div>
      </div>
      {!online ? (
        <span className="inline-flex items-center gap-1 px-2 py-1 bg-amber-900 text-amber-200 text-[10px] font-bold uppercase rounded-sm">
          <CloudOff className="w-3 h-3" /> Offline
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-900 text-emerald-200 text-[10px] font-bold uppercase rounded-sm">
          <CheckCircle2 className="w-3 h-3" /> Online
        </span>
      )}
      <button
        onClick={onLogout}
        className="p-2 text-zinc-400 hover:text-white"
        data-testid="field-logout"
        title="Sign out"
      >
        <LogOut className="w-4 h-4" />
      </button>
    </div>
  );
}

/**
 * Full-screen project list: search box + a tappable row per open deal.
 * Tap a row → onPick(dealId) which flips the parent into camera mode.
 */
function ProjectList({ deals, onPick, queuedCount }) {
  const [q, setQ] = useState("");
  const filtered = q.trim()
    ? deals.filter((d) => (d.title || "").toLowerCase().includes(q.toLowerCase()))
    : deals;
  return (
    <div className="flex-1 flex flex-col">
      {/* Search */}
      <div className="px-4 py-3 bg-zinc-900 border-b border-zinc-800">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search projects…"
            className="w-full bg-zinc-800 border border-zinc-700 text-white pl-10 pr-3 py-3 text-base rounded-sm focus:outline-none focus:border-blue-500 placeholder-zinc-500"
            data-testid="field-search"
            autoFocus={false}
          />
        </div>
        <div className="mt-2 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">
          {filtered.length} {filtered.length === 1 ? "project" : "projects"}
          {queuedCount > 0 && (
            <span className="ml-2 text-amber-400" data-testid="field-queued-count">
              · {queuedCount} queued to upload
            </span>
          )}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="text-center text-zinc-500 text-sm py-12 px-6">
            {deals.length === 0 ? "No open projects." : "No matches."}
          </div>
        ) : (
          <ul className="divide-y divide-zinc-800" data-testid="field-project-list">
            {filtered.map((d) => (
              <li key={d.id}>
                <button
                  onClick={() => onPick(d.id)}
                  className="w-full text-left px-4 py-5 hover:bg-zinc-900 active:bg-zinc-800 transition-colors flex items-center gap-3"
                  data-testid={`field-project-row-${d.id}`}
                >
                  <Camera className="w-5 h-5 text-blue-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-base font-semibold text-white truncate">{d.title}</div>
                    <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 mt-0.5">{d.status}</div>
                  </div>
                  <Upload className="w-4 h-4 text-zinc-600 flex-shrink-0" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
