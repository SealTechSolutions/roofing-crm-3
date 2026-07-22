import React, { useEffect, useRef, useState } from "react";
import { Mic, Loader2, Square } from "lucide-react";
import { api, formatApiError } from "@/lib/api";
import { toast } from "sonner";

/**
 * VoiceCaptionButton — tap to record, tap again to stop and transcribe.
 *
 * Wraps browser MediaRecorder API. Sends the recorded audio blob to
 * `POST /api/projects/:dealId/photos/transcribe` (OpenAI Whisper via
 * Emergent Universal Key) and passes the resulting text to `onText`.
 *
 * States (in order):
 *   idle      → shows Mic icon
 *   recording → shows red Square (stop) + live timer
 *   uploading → shows Spinner (transcribing…)
 *   idle      → resets after transcript delivered
 *
 * Falls back gracefully if the browser doesn't support MediaRecorder
 * (rare — every iOS 14+ / Chrome / Safari does) by disabling the button
 * and setting a tooltip.
 */
export default function VoiceCaptionButton({ dealId, onText, size = "md", className = "" }) {
  const [state, setState] = useState("idle"); // idle | recording | uploading
  const [elapsed, setElapsed] = useState(0);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  // Guard against a browser without MediaRecorder or getUserMedia (older
  // Safari on iOS < 14, Chrome-in-iframe with no permission policy, etc.).
  const supported = typeof window !== "undefined"
    && typeof window.MediaRecorder !== "undefined"
    && navigator?.mediaDevices?.getUserMedia;

  // Kill the mic stream + timer on unmount so the browser's little red
  // "recording" indicator disappears the moment the user closes the panel.
  useEffect(() => {
    return () => {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
    };
  }, []);

  const start = async () => {
    if (!supported) {
      toast.error("Voice capture isn't available on this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      // Prefer webm/opus for tiny file sizes; iOS Safari will negotiate to
      // audio/mp4 (AAC) automatically since it doesn't support opus.
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]
        .find((t) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || "";
      const options = mime ? { mimeType: mime } : {};
      const mr = new MediaRecorder(stream, options);
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = handleStop;
      mediaRecorderRef.current = mr;
      mr.start();
      setState("recording");
      setElapsed(0);
      // Start timer + 60-sec safety auto-stop so a forgotten mic doesn't
      // eat quota or drain phone battery.
      timerRef.current = setInterval(() => {
        setElapsed((n) => {
          const next = n + 1;
          if (next >= 60) { stop(); }
          return next;
        });
      }, 1000);
    } catch (e) {
      const msg = e?.name === "NotAllowedError"
        ? "Microphone access denied. Enable it in your browser/iOS settings and try again."
        : e?.message || "Could not access microphone.";
      toast.error(msg);
    }
  };

  const stop = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
  };

  const handleStop = async () => {
    const chunks = chunksRef.current;
    chunksRef.current = [];
    if (!chunks.length) { setState("idle"); return; }

    // Reconstruct the recorded audio into a single Blob and upload.
    const mime = chunks[0].type || "audio/webm";
    const ext = mime.includes("mp4") ? "m4a"
              : mime.includes("ogg") ? "ogg"
              : mime.includes("wav") ? "wav"
              : "webm";
    const blob = new Blob(chunks, { type: mime });
    if (blob.size < 500) {
      // Under half a KB is a "tap-and-instantly-release" — no useful audio.
      toast.error("Recording too short. Hold to record, tap again to stop.");
      setState("idle");
      setElapsed(0);
      return;
    }
    setState("uploading");
    try {
      const fd = new FormData();
      fd.append("file", blob, `voice-caption.${ext}`);
      const r = await api.post(`/projects/${dealId}/photos/transcribe`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const text = (r.data?.text || "").trim();
      if (!text) {
        toast.error("Couldn't hear anything. Try again in a quieter spot.");
      } else {
        onText && onText(text);
        toast.success("Caption transcribed");
      }
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message || "Transcription failed");
    } finally {
      setState("idle");
      setElapsed(0);
    }
  };

  const btnSize = size === "sm" ? "h-8 w-8" : size === "lg" ? "h-11 w-11" : "h-9 w-9";
  const iconSize = size === "sm" ? "w-3.5 h-3.5" : size === "lg" ? "w-5 h-5" : "w-4 h-4";

  if (!supported) {
    return (
      <button
        type="button"
        disabled
        title="Voice captions not supported on this browser."
        className={`inline-flex items-center justify-center rounded-sm border border-zinc-200 bg-zinc-50 text-zinc-300 ${btnSize} ${className}`}
        data-testid="voice-caption-unsupported"
      >
        <Mic className={iconSize} />
      </button>
    );
  }

  if (state === "recording") {
    return (
      <button
        type="button"
        onClick={stop}
        title="Tap to stop and transcribe"
        className={`inline-flex items-center justify-center gap-1.5 rounded-sm bg-rose-600 text-white hover:bg-rose-700 shadow-sm animate-pulse ${size === "lg" ? "h-11 px-3" : "h-9 px-2.5"} ${className}`}
        data-testid="voice-caption-recording"
      >
        <Square className={iconSize} fill="currentColor" />
        <span className={`font-mono ${size === "sm" ? "text-[10px]" : "text-xs"}`}>{formatElapsed(elapsed)}</span>
      </button>
    );
  }

  if (state === "uploading") {
    return (
      <button
        type="button"
        disabled
        title="Transcribing…"
        className={`inline-flex items-center justify-center rounded-sm border border-blue-300 bg-blue-50 text-blue-700 ${btnSize} ${className}`}
        data-testid="voice-caption-uploading"
      >
        <Loader2 className={`${iconSize} animate-spin`} />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={start}
      title="Dictate caption (voice → text)"
      className={`inline-flex items-center justify-center rounded-sm border border-zinc-300 text-zinc-700 hover:bg-emerald-50 hover:border-emerald-400 hover:text-emerald-700 ${btnSize} ${className}`}
      data-testid="voice-caption-start"
    >
      <Mic className={iconSize} />
    </button>
  );
}

function formatElapsed(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
