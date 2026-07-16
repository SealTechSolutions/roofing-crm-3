import React, { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { toast } from "sonner";
import { Camera, Upload, CloudOff, CheckCircle2, AlertCircle, LogOut, Loader2, ChevronLeft, Search, RefreshCcw } from "lucide-react";

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
  // iOS Safari occasionally hands back a "live" MediaStream that never paints
  // any pixels (videoWidth=0, readyState<2). We poll the <video> element a
  // second after start to detect that, and surface a recovery banner +
  // RESTART CAMERA button so the user can re-acquire the stream instead of
  // silently uploading black frames.
  const [streamHealthy, setStreamHealthy] = useState(true);
  const [restarting, setRestarting] = useState(false);
  const autoRetryRef = useRef({ tries: 0, timer: null });
  const [uploadingShot, setUploadingShot] = useState(false);
  const [uploadedCount, setUploadedCount] = useState(0);
  const [queuedCount, setQueuedCount] = useState(0);
  const [online, setOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);

  // ---------- Zoom + lens selection ----------
  // `zoom` is digital zoom (>=1, applied as CSS transform on the video and
  // mirrored on the canvas at capture time so the saved JPEG matches).
  // `ultrawideId` is the deviceId of the rear ultra-wide lens (iPhone Pro
  // models, recent Androids). When the user taps the 0.5x pill we re-acquire
  // the stream with that lens; tapping 1x/2x/3x switches back to the default
  // back camera and applies digital zoom.
  const [zoom, setZoom] = useState(1);
  const [ultrawideId, setUltrawideId] = useState("");
  const [useUltrawide, setUseUltrawide] = useState(false);
  const pinchRef = useRef({ startDist: 0, startZoom: 1 });

  // ---------- GPS / proof-of-presence stamp ----------
  // We watch the device position the moment the user picks a project so the
  // stamp on the first photo is already populated. Stored as {lat, lng, acc}.
  // Stamp pixels are burned into the captured JPEG at upload time (see
  // captureAndUpload below) AND sent as structured metadata so the backend
  // can sort/map photos later without OCR.
  const [position, setPosition] = useState(null); // { lat, lng, acc, ts }
  const [posError, setPosError] = useState("");
  const [stampEnabled, setStampEnabled] = useState(() => {
    const stored = localStorage.getItem("field_stamp_enabled");
    return stored === null ? true : stored === "true";
  });
  const [activeProperty, setActiveProperty] = useState(null);

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

  // Lock browser viewport zoom while this page is mounted. Phones default
  // to pinch-zooming the whole page, which makes the shutter button huge
  // and pushes the camera frame off-screen. We swap the viewport meta tag
  // on mount and restore the original on unmount so other pages aren't
  // affected. iOS Safari requires maximum-scale=1 + user-scalable=no to
  // actually honor this — both are set.
  useEffect(() => {
    const head = document.head;
    let tag = head.querySelector('meta[name="viewport"]');
    const created = !tag;
    const previousContent = tag ? tag.getAttribute("content") : null;
    if (!tag) {
      tag = document.createElement("meta");
      tag.setAttribute("name", "viewport");
      head.appendChild(tag);
    }
    tag.setAttribute(
      "content",
      "width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no, viewport-fit=cover",
    );
    return () => {
      if (created) {
        head.removeChild(tag);
      } else if (previousContent != null) {
        tag.setAttribute("content", previousContent);
      }
    };
  }, []);

  // Persist stamp toggle
  useEffect(() => {
    localStorage.setItem("field_stamp_enabled", String(stampEnabled));
  }, [stampEnabled]);

  // Fetch the deal's linked property (best-effort) so the stamp can show
  // the site address. Falls back to deal title if no property is linked.
  useEffect(() => {
    if (!dealId || !token) { setActiveProperty(null); return; }
    const deal = deals.find((d) => d.id === dealId);
    if (!deal?.property_id) { setActiveProperty(null); return; }
    axios
      .get(`${API_BASE}/api/properties/${deal.property_id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => setActiveProperty(r.data))
      .catch(() => setActiveProperty(null));
  }, [dealId, deals, token]);

  // Watch device position while in the camera view. Released on unmount /
  // when the user backs out to the project list.
  useEffect(() => {
    if (!dealId || typeof navigator === "undefined" || !navigator.geolocation) return undefined;
    let watchId = null;
    setPosError("");
    try {
      watchId = navigator.geolocation.watchPosition(
        (p) => {
          setPosition({
            lat: p.coords.latitude,
            lng: p.coords.longitude,
            acc: p.coords.accuracy || 0,
            ts: p.timestamp || Date.now(),
          });
          setPosError("");
        },
        (err) => {
          setPosError(err.message || "Location unavailable");
        },
        { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
      );
    } catch (e) {
      setPosError(e.message || "Location unavailable");
    }
    return () => {
      if (watchId != null && navigator.geolocation) {
        try { navigator.geolocation.clearWatch(watchId); } catch { /* ignore */ }
      }
    };
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
      setStreamHealthy(true);
      // Tear down any prior stream so switching lenses cleanly releases it.
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      const constraints = useUltrawide && ultrawideId
        ? { video: { deviceId: { exact: ultrawideId } }, audio: false }
        : { video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }
      setCameraReady(true);
      // Best-effort: discover ultrawide lens once we have permission (labels
      // are only populated after the first successful getUserMedia call).
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const back = devices.filter((d) => d.kind === "videoinput");
        const uw = back.find((d) => /ultra.?wide|0\.5/i.test(d.label || ""));
        if (uw && uw.deviceId && uw.deviceId !== ultrawideId) setUltrawideId(uw.deviceId);
      } catch { /* ignore */ }
    } catch (e) {
      setCameraError(e.message || "Camera unavailable. Allow camera access in your browser settings.");
      setCameraReady(false);
      setStreamHealthy(false);
    }
  }, [useUltrawide, ultrawideId]);

  // Hard reset the camera pipeline. Used both by the visible RESTART CAMERA
  // button and by the auto-retry that fires when iOS hands us a stream that
  // never paints (the infamous "black screen" bug). Single source of truth
  // so user-initiated and automatic recovery are identical.
  const restartCamera = useCallback(async () => {
    if (restarting) return;
    setRestarting(true);
    setStreamHealthy(true); // optimistic — health monitor will flip back if it stays dead
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (videoRef.current) {
        try { videoRef.current.pause(); } catch { /* ignore */ }
        videoRef.current.srcObject = null;
      }
      // Tiny delay lets iOS Safari actually release the camera before we
      // re-request it. Without this, the second getUserMedia call frequently
      // returns the same dead stream we just torn down.
      await new Promise((r) => setTimeout(r, 250));
      await startCamera();
    } finally {
      setRestarting(false);
    }
  }, [restarting, startCamera]);

  // Start the camera only when entering the camera view (dealId set). Stop
  // and release the device when returning to the list so the phone's LED
  // turns off and no permission prompt fires until the user actually picks
  // a project to shoot. Also re-fires when the user toggles to the ultrawide
  // lens so the stream is re-acquired with the new deviceId.
  useEffect(() => {
    if (!dealId) return undefined;
    autoRetryRef.current = { tries: 0, timer: null };
    startCamera();
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      setCameraReady(false);
      if (autoRetryRef.current.timer) {
        clearTimeout(autoRetryRef.current.timer);
        autoRetryRef.current.timer = null;
      }
    };
  }, [dealId, startCamera]);

  // ---------- Camera-health monitor (iOS black-screen detector) ----------
  // Once startCamera resolves cameraReady=true, poll the <video> element
  // every 1.2s. If after ~2.5s it still has no frame dimensions / readyState
  // is below HAVE_CURRENT_DATA, mark the stream as dead. We auto-retry up to
  // 3 times with escalating delays (1s, 2s, 4s) before giving up and asking
  // the user to tap RESTART CAMERA. Previously the budget was 1 retry which
  // is why users were reloading their phone twice to get a working camera.
  useEffect(() => {
    if (!dealId || !cameraReady) return undefined;
    let alive = true;
    let consecutiveDead = 0;
    const id = setInterval(() => {
      if (!alive) return;
      const v = videoRef.current;
      const dead = !v || !v.videoWidth || !v.videoHeight || v.readyState < 2;
      if (dead) {
        consecutiveDead += 1;
        // After ~2.5s of dead frames, declare the stream unhealthy.
        if (consecutiveDead >= 2 && streamHealthy) {
          setStreamHealthy(false);
          // Auto-retry with escalating backoff. Budget: 3 attempts.
          if (autoRetryRef.current.tries < 3 && !autoRetryRef.current.timer) {
            const delayMs = [1000, 2000, 4000][autoRetryRef.current.tries] || 4000;
            autoRetryRef.current.timer = setTimeout(() => {
              autoRetryRef.current.tries += 1;
              autoRetryRef.current.timer = null;
              restartCamera();
            }, delayMs);
          }
        }
      } else {
        consecutiveDead = 0;
        if (!streamHealthy) {
          setStreamHealthy(true);
          // Recovery: reset retry budget so a later failure can auto-retry again.
          autoRetryRef.current.tries = 0;
        }
      }
    }, 1200);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [dealId, cameraReady, streamHealthy, restartCamera]);

  // ---------- Visibility / focus recovery ----------
  // iOS Safari (and any mobile browser) silently kills the camera stream
  // when the app is backgrounded — the user switches to a text message,
  // returns to the CRM, and the preview is a black rectangle that never
  // recovers. Fix: listen for `visibilitychange` and `pageshow` and refresh
  // the camera stream when the app returns to the foreground. Also resets
  // the auto-retry budget so any subsequent freeze can still auto-recover.
  useEffect(() => {
    if (!dealId) return undefined;
    const wakeCamera = () => {
      if (document.visibilityState !== "visible") return;
      autoRetryRef.current.tries = 0;
      restartCamera();
    };
    document.addEventListener("visibilitychange", wakeCamera);
    // pageshow fires on iOS Safari when the page is restored from the back-
    // forward cache — critical for the "swipe back to CRM" path.
    window.addEventListener("pageshow", wakeCamera);
    return () => {
      document.removeEventListener("visibilitychange", wakeCamera);
      window.removeEventListener("pageshow", wakeCamera);
    };
  }, [dealId, restartCamera]);

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
          if (item.gps_lat != null) fd.append("gps_lat", String(item.gps_lat));
          if (item.gps_lng != null) fd.append("gps_lng", String(item.gps_lng));
          if (item.gps_accuracy != null) fd.append("gps_accuracy", String(item.gps_accuracy));
          if (item.captured_at) fd.append("captured_at", item.captured_at);
          if (item.stamped) fd.append("stamped", "true");
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
  // Paints a translucent black bar at the bottom of `canvas` with:
  // foreman name • date/time • address (or deal title) • GPS coords ± acc.
  // Sized in proportion to the canvas so the stamp looks consistent across
  // wide / portrait / cropped frames.
  const paintStamp = useCallback((canvas, ctx) => {
    if (!stampEnabled) return;
    const W = canvas.width;
    const H = canvas.height;
    // Stamp ~9% of frame height, min 90px, max 220px.
    const stampH = Math.max(90, Math.min(220, Math.round(H * 0.09)));
    const pad = Math.round(stampH * 0.14);
    const lineGap = Math.round(stampH * 0.10);
    const titleSize = Math.round(stampH * 0.30);
    const bodySize = Math.round(stampH * 0.22);

    // Background bar with subtle gradient so text reads on bright photos.
    const grad = ctx.createLinearGradient(0, H - stampH, 0, H);
    grad.addColorStop(0, "rgba(0,0,0,0.0)");
    grad.addColorStop(0.25, "rgba(0,0,0,0.55)");
    grad.addColorStop(1, "rgba(0,0,0,0.78)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, H - stampH, W, stampH);

    // Cobalt accent stripe (left edge) — matches the CRM brand
    ctx.fillStyle = "#1D4ED8";
    ctx.fillRect(0, H - stampH, Math.max(4, Math.round(stampH * 0.04)), stampH);

    // Text
    ctx.fillStyle = "#FFFFFF";
    ctx.textBaseline = "top";
    ctx.shadowColor = "rgba(0,0,0,0.7)";
    ctx.shadowBlur = 2;

    const foreman = (me?.name || me?.email || "Field Tech").toString();
    const activeDealLocal = deals.find((d) => d.id === dealId);
    const project = activeDealLocal?.title || "Project";
    const address = (() => {
      if (!activeProperty) return "";
      const parts = [
        activeProperty.address,
        [activeProperty.city, activeProperty.state, activeProperty.zip].filter(Boolean).join(", "),
      ].filter(Boolean);
      return parts.join(" · ");
    })();
    const ts = new Date();
    const tsLine = ts.toLocaleString(undefined, {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    const gpsLine = position
      ? `GPS  ${position.lat.toFixed(5)}, ${position.lng.toFixed(5)}  ±${Math.round(position.acc)}m`
      : (posError ? "GPS  unavailable" : "GPS  acquiring…");

    // Title row: foreman name + timestamp on right
    ctx.font = `bold ${titleSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`;
    ctx.textAlign = "left";
    ctx.fillText(foreman.toUpperCase(), pad + 8, H - stampH + pad);
    ctx.textAlign = "right";
    ctx.fillText(tsLine, W - pad, H - stampH + pad);

    // Body row 1: project title (and address if present, line below)
    ctx.font = `${bodySize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`;
    ctx.textAlign = "left";
    const row1Y = H - stampH + pad + titleSize + lineGap;
    ctx.fillText(address ? address : project, pad + 8, row1Y);

    // Body row 2: GPS — bottom-aligned so it always sits flush to the edge
    const row2Y = H - pad - bodySize;
    ctx.fillText(gpsLine, pad + 8, row2Y);

    // SealTech mark (right side of bottom row) — small caps watermark
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillText("SEALTECH · PROOF OF PRESENCE", W - pad, row2Y);

    ctx.shadowBlur = 0;
  }, [stampEnabled, me, deals, dealId, activeProperty, position, posError]);

  const captureAndUpload = useCallback(async () => {
    if (!dealId) { toast.error("Pick a project first."); return; }
    if (!cameraReady || !videoRef.current) {
      toast.error("Camera not ready — tap RESTART CAMERA to refresh.");
      return;
    }
    const video = videoRef.current;
    // Detect iOS Safari black-screen bug: camera stream is technically open
    // but Safari isn't painting frames → videoWidth/Height is 0, so we'd
    // ship a black canvas to the server and the user would never know.
    if (!video.videoWidth || !video.videoHeight || video.readyState < 2) {
      setStreamHealthy(false);
      toast.error("Camera is black — tap RESTART CAMERA. Don't take more shots until this clears.");
      return;
    }
    if (uploadingShot) return;

    const canvas = canvasRef.current || document.createElement("canvas");
    canvasRef.current = canvas;
    const vw = video.videoWidth || 1280;
    const vh = video.videoHeight || 720;
    // Digital zoom: crop the centre 1/zoom of the frame and rescale to the
    // canvas size so the saved JPEG matches what the user saw on screen.
    const z = Math.max(1, zoom);
    const sw = vw / z;
    const sh = vh / z;
    const sx = (vw - sw) / 2;
    const sy = (vh - sh) / 2;
    // Cap output dimensions: phones happily emit 4032×3024 frames which
    // produce 3-6 MB JPEGs that are pointless to ship over LTE. Anything
    // bigger than 2048px on the long side gets proportionally downscaled.
    // This drops typical field shots from ~4 MB to ~600 KB while staying
    // sharp enough for insurance documentation and PDF reports.
    const MAX_DIM = 2048;
    const longSide = Math.max(vw, vh);
    const scale = longSide > MAX_DIM ? MAX_DIM / longSide : 1;
    canvas.width = Math.round(vw * scale);
    canvas.height = Math.round(vh * scale);
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    // Burn the GPS + foreman stamp BEFORE we encode the JPEG so it survives
    // every downstream pipeline (cloud storage, PDFs, insurance submission).
    paintStamp(canvas, ctx);
    const blob = await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.72)
    );
    if (!blob) return;
    const filename = `field-${Date.now()}.jpg`;
    const capturedAt = new Date().toISOString();

    setUploadingShot(true);
    try {
      const meta = {
        gps_lat: position?.lat ?? null,
        gps_lng: position?.lng ?? null,
        gps_accuracy: position?.acc ?? null,
        captured_at: capturedAt,
        stamped: stampEnabled,
      };
      if (navigator.onLine) {
        try {
          const fd = new FormData();
          fd.append("file", blob, filename);
          if (meta.gps_lat != null) fd.append("gps_lat", String(meta.gps_lat));
          if (meta.gps_lng != null) fd.append("gps_lng", String(meta.gps_lng));
          if (meta.gps_accuracy != null) fd.append("gps_accuracy", String(meta.gps_accuracy));
          fd.append("captured_at", capturedAt);
          if (stampEnabled) fd.append("stamped", "true");
          await axios.post(
            `${API_BASE}/api/projects/${dealId}/photos`,
            fd,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          setUploadedCount((n) => n + 1);
        } catch {
          // network blip mid-upload — drop into queue (stamp already baked in)
          await queueAdd({ deal_id: dealId, blob, filename, created_at: Date.now(), ...meta });
          await refreshQueueCount();
        }
      } else {
        await queueAdd({ deal_id: dealId, blob, filename, created_at: Date.now(), ...meta });
        await refreshQueueCount();
      }
    } finally {
      setUploadingShot(false);
    }
  }, [dealId, cameraReady, uploadingShot, token, refreshQueueCount, zoom, paintStamp, position, stampEnabled]);

  // ---------- Pinch-to-zoom + tap-to-zoom ----------
  const onTouchStart = useCallback((e) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchRef.current = { startDist: Math.hypot(dx, dy), startZoom: zoom };
    }
  }, [zoom]);
  const onTouchMove = useCallback((e) => {
    if (e.touches.length === 2 && pinchRef.current.startDist > 0) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const ratio = dist / pinchRef.current.startDist;
      const next = Math.max(1, Math.min(6, pinchRef.current.startZoom * ratio));
      setZoom(next);
      e.preventDefault();
    }
  }, []);
  const setZoomLevel = useCallback((level) => {
    if (level === 0.5) {
      // Switch to ultrawide lens (re-acquires the stream via the camera effect).
      setUseUltrawide(true);
      setZoom(1);
    } else {
      setUseUltrawide(false);
      setZoom(level);
    }
  }, []);

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
    // h-[100dvh] instead of min-h-screen so the container matches the phone's
    // dynamic viewport (subtracts iOS Safari URL bar and home indicator).
    // With `overflow-hidden`, the shutter button is ALWAYS visible without
    // scrolling — the camera area shrinks to fill whatever's between the top
    // bar and the shutter.
    <div className="h-[100dvh] bg-zinc-950 text-white flex flex-col overflow-hidden" data-testid="field-capture">
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
          onClick={restartCamera}
          disabled={restarting}
          className="inline-flex items-center gap-1 px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[10px] font-bold uppercase tracking-wider rounded-sm disabled:opacity-50"
          data-testid="field-restart-camera"
          title="Restart the camera if the preview is black or stuck"
        >
          <RefreshCcw className={"w-3 h-3 " + (restarting ? "animate-spin" : "")} />
          {restarting ? "Restarting" : "Restart"}
        </button>
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
      <div
        className="relative flex-1 bg-black flex items-center justify-center overflow-hidden"
        style={{ touchAction: "none" }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
      >
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
            style={{ transform: `scale(${zoom})`, transformOrigin: "center center", transition: "transform 80ms linear" }}
            className="max-w-full max-h-full object-contain"
            data-testid="field-video"
          />
        )}
        {/* Black-screen recovery banner — overrides the stamp/zoom UI when
            iOS Safari hands us a stream that won't paint. Blocks the shutter
            implicitly because the user will see this before tapping it. */}
        {!cameraError && !streamHealthy && (
          <div
            className="absolute inset-x-0 top-0 z-30 bg-rose-700/95 border-b-2 border-rose-400 px-4 py-3 flex items-center gap-3"
            data-testid="field-black-screen-banner"
          >
            <AlertCircle className="w-6 h-6 text-white flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-bold uppercase tracking-wider text-rose-100">
                Camera is black — photos will not save
              </div>
              <div className="text-[11px] text-rose-50 leading-snug">
                iOS Safari paused the live preview. Tap RESTART CAMERA to recover, then verify you can see the scene before shooting.
              </div>
            </div>
            <button
              onClick={restartCamera}
              disabled={restarting}
              className="inline-flex items-center gap-1 px-3 py-2 bg-white text-rose-700 text-[11px] font-bold uppercase tracking-wider rounded-sm hover:bg-rose-50 disabled:opacity-60"
              data-testid="field-banner-restart"
            >
              <RefreshCcw className={"w-3 h-3 " + (restarting ? "animate-spin" : "")} />
              {restarting ? "Restarting" : "Restart Camera"}
            </button>
          </div>
        )}
        {/* Live stamp preview overlay — mirrors what will be burned in. Tiny
            text in a translucent bar so the foreman knows the stamp is on
            and where it'll land. Strictly visual (the real stamp is drawn
            on the canvas, not on the DOM). Sits above the zoom pills. */}
        {!cameraError && stampEnabled && (
          <div className="absolute left-0 right-0 bottom-16 px-3 py-2 bg-gradient-to-t from-black/80 to-black/20 text-white pointer-events-none select-none" data-testid="field-stamp-preview">
            <div className="border-l-2 border-blue-600 pl-2">
              <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider drop-shadow">
                <span className="truncate">{(me?.name || "Field Tech").toUpperCase()}</span>
                <span className="text-[10px] font-mono opacity-90">
                  {new Date().toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
              <div className="text-[10px] opacity-90 truncate drop-shadow">
                {activeProperty
                  ? [activeProperty.address, activeProperty.city, activeProperty.state].filter(Boolean).join(", ")
                  : (activeDeal?.title || "")}
              </div>
              <div className="text-[10px] opacity-90 font-mono drop-shadow">
                {position
                  ? `GPS ${position.lat.toFixed(5)}, ${position.lng.toFixed(5)}  ±${Math.round(position.acc)}m`
                  : (posError ? "GPS unavailable" : "GPS acquiring…")}
              </div>
            </div>
          </div>
        )}

        {/* Zoom-level pills overlay (bottom of camera area) */}
        {!cameraError && (
          <div
            className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-black/60 backdrop-blur-md px-2 py-1.5 rounded-full"
            data-testid="field-zoom-bar"
          >
            {ultrawideId && (
              <ZoomChip
                label="0.5x"
                active={useUltrawide}
                onClick={() => setZoomLevel(0.5)}
                testId="field-zoom-05x"
              />
            )}
            <ZoomChip
              label="1x"
              active={!useUltrawide && zoom < 1.5}
              onClick={() => setZoomLevel(1)}
              testId="field-zoom-1x"
            />
            <ZoomChip
              label="2x"
              active={!useUltrawide && zoom >= 1.5 && zoom < 2.5}
              onClick={() => setZoomLevel(2)}
              testId="field-zoom-2x"
            />
            <ZoomChip
              label="3x"
              active={!useUltrawide && zoom >= 2.5}
              onClick={() => setZoomLevel(3)}
              testId="field-zoom-3x"
            />
            <span className="text-[10px] font-mono text-zinc-400 ml-1 pr-1" data-testid="field-zoom-current">
              {useUltrawide ? "0.5×" : `${zoom.toFixed(1)}×`}
            </span>
          </div>
        )}
      </div>

      {/* Status strip */}
      <div className="px-4 py-2 bg-zinc-900 border-t border-zinc-800 flex items-center justify-between text-[11px] gap-2 flex-wrap">
        <div className="text-zinc-400 truncate flex-1 min-w-0" data-testid="field-status">
          {activeDeal ? (
            <span>To: <b className="text-zinc-100">{activeDeal.title}</b></span>
          ) : (
            <span className="text-amber-400">Pick a project to enable capture</span>
          )}
        </div>
        <div className="flex items-center gap-3 font-mono text-[11px]">
          <button
            type="button"
            onClick={() => setStampEnabled((v) => !v)}
            className={
              "inline-flex items-center gap-1 px-2 py-1 rounded-sm uppercase tracking-wider font-bold transition-colors " +
              (stampEnabled
                ? "bg-blue-700 text-white hover:bg-blue-800"
                : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700")
            }
            data-testid="field-stamp-toggle"
            title="Toggle GPS / foreman stamp on photos"
          >
            <span aria-hidden>{stampEnabled ? "★" : "☆"}</span>
            <span>Stamp {stampEnabled ? "ON" : "OFF"}</span>
          </button>
          <span
            className={
              "inline-flex items-center gap-1 px-2 py-1 rounded-sm uppercase tracking-wider font-bold " +
              (position
                ? `${position.acc <= 25 ? "bg-emerald-900 text-emerald-200" : "bg-amber-900 text-amber-200"}`
                : (posError ? "bg-rose-900 text-rose-200" : "bg-zinc-800 text-zinc-400"))
            }
            data-testid="field-gps-indicator"
            title={position ? `${position.lat.toFixed(5)}, ${position.lng.toFixed(5)} ± ${Math.round(position.acc)} m` : (posError || "Acquiring GPS…")}
          >
            <span aria-hidden>📍</span>
            {position ? `±${Math.round(position.acc)}m` : (posError ? "GPS OFF" : "GPS…")}
          </span>
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
          disabled={!cameraReady || !dealId || uploadingShot || !streamHealthy || restarting}
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
 * Single zoom-level chip in the bottom-of-camera zoom bar. Active state shows
 * a filled circle with darker bg; inactive state is a flat translucent pill.
 */
function ZoomChip({ label, active, onClick, testId }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={
        "min-w-[42px] h-9 rounded-full text-xs font-bold tracking-wide transition-colors " +
        (active
          ? "bg-amber-400 text-zinc-950"
          : "bg-zinc-800/80 text-zinc-200 hover:bg-zinc-700")
      }
    >
      {label}
    </button>
  );
}

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
