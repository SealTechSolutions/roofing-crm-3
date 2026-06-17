import React, { useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { toast } from "sonner";
import {
  Clock, Play, RefreshCw, AlertCircle, CheckCircle2,
  CalendarClock, Mail, ArrowUpRight,
} from "lucide-react";

/**
 * Settings → Schedule
 *
 * Read-only admin view of every in-process APScheduler job: name, trigger,
 * next-run timestamp (in both UTC and the user's local TZ), plus a
 * "Run now" button to fire any job on-demand for sanity checks.
 *
 * Editing the schedule (cron expression / time-of-day) is not surfaced yet —
 * the underlying triggers are wired in code (`backend/scheduler.py`). Tell
 * the team if you want a UI editor next.
 */
const JOB_META = {
  mark_lead_to_sent: {
    icon: ArrowUpRight,
    label: "Auto-flip Lead → Sent",
    description: "Any deal still in Lead status 24 hours after the scope was emailed is auto-promoted to Sent and stamped on the activity timeline.",
  },
  weekly_stale_digest: {
    icon: Mail,
    label: "Weekly Stale-Deals Digest",
    description: "Mondays 08:00 MT. Each deal owner receives a personalized email listing their stuck deals + Won-without-deposit alerts.",
  },
};

function formatLocal(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      weekday: "short", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
      timeZoneName: "short",
    });
  } catch {
    return iso;
  }
}

function relativeFromNow(iso) {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms)) return "";
  const abs = Math.abs(ms);
  const mins = Math.round(abs / 60000);
  const hours = Math.round(mins / 60);
  const days = Math.round(hours / 24);
  const fwd = ms >= 0;
  if (mins < 1) return fwd ? "in seconds" : "just now";
  if (mins < 60) return fwd ? `in ${mins}m` : `${mins}m ago`;
  if (hours < 24) return fwd ? `in ${hours}h` : `${hours}h ago`;
  return fwd ? `in ${days}d` : `${days}d ago`;
}

export default function Schedule() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [runningJob, setRunningJob] = useState("");
  const [lastResults, setLastResults] = useState({}); // jobId -> last result

  const load = async () => {
    try {
      const r = await api.get("/scheduler/jobs");
      setData(r.data);
      setError("");
    } catch (e) {
      setError(formatApiError(e?.response?.data?.detail) || e.message);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const fetchOnce = async () => {
      try {
        const r = await api.get("/scheduler/jobs");
        if (!cancelled) {
          setData(r.data);
          setError("");
        }
      } catch (e) {
        if (!cancelled) setError(formatApiError(e?.response?.data?.detail) || e.message);
      }
    };
    fetchOnce();
    const t = setInterval(fetchOnce, 30_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  const runNow = async (jobId) => {
    if (runningJob) return;
    setRunningJob(jobId);
    try {
      const r = await api.post(`/scheduler/jobs/${jobId}/run`);
      setLastResults((prev) => ({ ...prev, [jobId]: { ts: new Date().toISOString(), result: r.data?.result } }));
      const result = r.data?.result || {};
      // Friendly toast per job
      if (jobId === "mark_lead_to_sent") {
        const n = result.flipped || 0;
        toast.success(n === 0 ? "No Leads needed promotion" : `Promoted ${n} Lead${n === 1 ? "" : "s"} → Sent`);
      } else if (jobId === "weekly_stale_digest") {
        const sent = result.sent || 0;
        const eligible = result.owners_eligible || 0;
        if (eligible === 0) toast.info("No owners are eligible for a digest right now");
        else toast.success(`Digest fired — ${sent}/${eligible} owners emailed`);
      } else {
        toast.success("Job ran");
      }
      await load();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setRunningJob("");
    }
  };

  if (error) {
    return (
      <div className="p-10 max-w-4xl mx-auto" data-testid="schedule-error">
        <div className="bg-rose-50 border border-rose-200 rounded-sm p-6 flex items-start gap-3">
          <AlertCircle className="w-6 h-6 text-rose-700 flex-shrink-0" />
          <div>
            <h2 className="font-heading text-lg font-black tracking-tight text-rose-900">Schedule unavailable</h2>
            <p className="text-sm text-rose-800 mt-1">{error}</p>
            <p className="text-xs text-rose-700 mt-2">This page is admin-only. If you&apos;re an admin and see this, the scheduler may not have started — check backend logs.</p>
          </div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-10 text-sm text-zinc-500" data-testid="schedule-loading">Loading schedule…</div>
    );
  }

  return (
    <div className="p-6 sm:p-10 max-w-5xl mx-auto" data-testid="schedule-page">
      <div className="flex items-end justify-between mb-6 gap-4 flex-wrap">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 mb-1 flex items-center gap-1.5">
            <CalendarClock className="w-3 h-3" /> Settings &middot; Schedule
          </div>
          <h1 className="font-heading text-3xl font-black tracking-tight">Scheduled Jobs</h1>
          <p className="text-xs text-zinc-600 mt-1 max-w-xl">
            In-process cron jobs that run inside the FastAPI process. No external worker needed.
            Each job can be triggered manually with &quot;Run now&quot; — handy for testing or pushing a digest mid-cycle.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 px-3 h-8 text-[10px] font-bold uppercase tracking-wider rounded-sm ${
              data.running ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"
            }`}
            data-testid="schedule-running-pill"
          >
            {data.running ? <CheckCircle2 className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
            {data.running ? "Running" : "Stopped"}
          </span>
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center gap-1.5 px-3 h-8 text-[10px] font-bold uppercase tracking-wider border border-zinc-300 hover:border-zinc-500 rounded-sm"
            data-testid="schedule-refresh"
            title="Refresh next-run timestamps"
          >
            <RefreshCw className="w-3 h-3" />
            Refresh
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {(data.jobs || []).map((job) => {
          const meta = JOB_META[job.id] || { icon: Clock, label: job.name, description: "" };
          const Icon = meta.icon;
          const last = lastResults[job.id];
          const isRunning = runningJob === job.id;
          return (
            <div
              key={job.id}
              className="bg-white border border-zinc-200 rounded-sm p-5 flex flex-col sm:flex-row gap-4 sm:items-center"
              data-testid={`schedule-job-${job.id}`}
            >
              <div className="flex items-center gap-3 sm:flex-1">
                <div className="w-10 h-10 rounded-sm bg-[#062B67] text-white flex items-center justify-center flex-shrink-0">
                  <Icon className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="font-heading text-base font-black tracking-tight" data-testid={`schedule-job-${job.id}-label`}>
                    {meta.label}
                  </div>
                  <div className="text-[11px] text-zinc-500 mt-0.5 font-mono">{job.id}</div>
                  {meta.description && (
                    <div className="text-xs text-zinc-600 mt-1.5 max-w-xl">{meta.description}</div>
                  )}
                  <div className="text-[11px] text-zinc-400 mt-1 font-mono">{job.trigger}</div>
                </div>
              </div>

              <div className="flex sm:flex-col sm:items-end gap-3 sm:gap-1 sm:min-w-[200px]">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Next Run</div>
                  <div className="text-xs font-mono mt-0.5" data-testid={`schedule-job-${job.id}-next-run`}>
                    {formatLocal(job.next_run_at)}
                  </div>
                  <div className="text-[10px] text-zinc-500 mt-0.5">{relativeFromNow(job.next_run_at)}</div>
                </div>
                <button
                  type="button"
                  onClick={() => runNow(job.id)}
                  disabled={isRunning}
                  className="inline-flex items-center gap-1.5 px-3 h-8 text-[10px] font-bold uppercase tracking-wider bg-blue-700 hover:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-sm transition-colors"
                  data-testid={`schedule-job-${job.id}-run`}
                >
                  <Play className="w-3 h-3" />
                  {isRunning ? "Running…" : "Run now"}
                </button>
              </div>

              {last && (
                <div className="sm:col-span-full sm:w-full bg-zinc-50 border-l-2 border-blue-700 px-3 py-2 text-[11px] text-zinc-700 font-mono">
                  <div className="text-[9px] uppercase tracking-wider text-zinc-500 mb-0.5">
                    Last manual run · {formatLocal(last.ts)}
                  </div>
                  <pre className="whitespace-pre-wrap break-words" data-testid={`schedule-job-${job.id}-last-result`}>
                    {JSON.stringify(last.result, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          );
        })}
        {(data.jobs || []).length === 0 && (
          <div className="bg-amber-50 border border-amber-200 p-6 rounded-sm text-sm text-amber-900" data-testid="schedule-empty">
            No scheduled jobs are registered. If you set <code className="px-1.5 py-0.5 bg-amber-100 rounded-sm">DISABLE_SCHEDULER=1</code> in the backend env, unset it and restart.
          </div>
        )}
      </div>

      <div className="mt-8 bg-zinc-50 border border-zinc-200 rounded-sm p-5 text-xs text-zinc-600">
        <div className="font-bold text-zinc-900 mb-1">Want to change a schedule?</div>
        <p>
          Cron expressions are defined in <code className="px-1 py-0.5 bg-white border border-zinc-200 rounded-sm font-mono">backend/scheduler.py</code>.
          Editing them through this page is on the roadmap — tell the team if you want it next.
        </p>
      </div>
    </div>
  );
}
