import React, { useEffect, useMemo, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { toast } from "sonner";
import { CheckSquare, Square, Plus, X, Trash2, ExternalLink, Calendar } from "lucide-react";
import { Link } from "react-router-dom";

const EMPTY = { title: "", due_date: "", due_time: "", deal_id: "", notes: "", priority: "normal", done: false };

export default function Tasks() {
  const [tasks, setTasks] = useState([]);
  const [deals, setDeals] = useState([]);
  const [showDone, setShowDone] = useState(false);
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [t, d] = await Promise.all([
        api.get("/tasks", { params: { include_done: showDone } }),
        api.get("/deals"),
      ]);
      setTasks(t.data || []);
      setDeals((d.data || []).filter((x) => !x.is_deleted));
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || "Failed to load tasks");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDone]);

  const groups = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const overdue = [], todayList = [], upcoming = [], later = [], done = [];
    for (const t of tasks) {
      if (t.done) done.push(t);
      else if (t.due_date && t.due_date < today) overdue.push(t);
      else if (t.due_date === today) todayList.push(t);
      else if (t.due_date && t.due_date <= addDays(today, 7)) upcoming.push(t);
      else later.push(t);
    }
    return { overdue, today: todayList, upcoming, later, done };
  }, [tasks]);

  const toggle = async (task) => {
    try {
      await api.patch(`/tasks/${task.id}/toggle`);
      load();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || "Toggle failed");
    }
  };

  const remove = async (task) => {
    if (!window.confirm(`Delete "${task.title}"?`)) return;
    await api.delete(`/tasks/${task.id}`);
    toast.success("Task deleted");
    load();
  };

  const save = async (form) => {
    if (!form.title.trim() || !form.due_date) {
      toast.error("Title and due date are required");
      return;
    }
    try {
      if (form.id) await api.put(`/tasks/${form.id}`, form);
      else await api.post("/tasks", form);
      toast.success(form.id ? "Task updated" : "Task created");
      setEditing(null);
      load();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || "Save failed");
    }
  };

  return (
    <div className="p-8" data-testid="tasks-page">
      <div className="flex items-end justify-between mb-8 pb-6 border-b border-zinc-200 flex-wrap gap-4">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-700 mb-2">Daily</div>
          <h1 className="text-3xl font-black tracking-tight flex items-center gap-3"><CheckSquare className="w-7 h-7 text-blue-700" /> Tasks</h1>
          <div className="text-sm text-zinc-500 mt-1">Lightweight to-dos. Syncs to your Google primary calendar.</div>
        </div>
        <div className="flex items-center gap-2">
          <label className="inline-flex items-center gap-2 text-xs cursor-pointer" data-testid="show-done-toggle">
            <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} className="accent-blue-700" />
            Show completed
          </label>
          <button onClick={() => setEditing(EMPTY)} className="inline-flex items-center gap-1.5 h-9 px-4 bg-zinc-950 hover:bg-zinc-800 text-white text-[10px] font-bold uppercase tracking-wider rounded-sm" data-testid="new-task-btn">
            <Plus className="w-3.5 h-3.5" /> New Task
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-zinc-500">Loading…</div>
      ) : (
        <div className="space-y-6">
          <Group title="Overdue" color="text-red-700" items={groups.overdue} onToggle={toggle} onEdit={setEditing} onDelete={remove} deals={deals} testId="group-overdue" />
          <Group title="Today" color="text-blue-700" items={groups.today} onToggle={toggle} onEdit={setEditing} onDelete={remove} deals={deals} testId="group-today" />
          <Group title="This Week" color="text-zinc-900" items={groups.upcoming} onToggle={toggle} onEdit={setEditing} onDelete={remove} deals={deals} testId="group-upcoming" />
          <Group title="Later" color="text-zinc-500" items={groups.later} onToggle={toggle} onEdit={setEditing} onDelete={remove} deals={deals} testId="group-later" />
          {showDone && <Group title="Completed" color="text-zinc-400" items={groups.done} onToggle={toggle} onEdit={setEditing} onDelete={remove} deals={deals} testId="group-done" />}
          {tasks.length === 0 && (
            <div className="border border-dashed border-zinc-300 p-12 text-center text-zinc-500 rounded-sm">
              No tasks yet. Click <strong>+ New Task</strong> to add one.
            </div>
          )}
        </div>
      )}

      {editing && <TaskModal initial={editing} deals={deals} onClose={() => setEditing(null)} onSave={save} />}
    </div>
  );
}

function Group({ title, color, items, onToggle, onEdit, onDelete, deals, testId }) {
  if (!items.length) return null;
  return (
    <div data-testid={testId}>
      <div className={`text-[10px] font-bold uppercase tracking-[0.15em] mb-2 ${color}`}>{title} · {items.length}</div>
      <div className="space-y-1">
        {items.map((t) => (
          <Row key={t.id} task={t} onToggle={onToggle} onEdit={onEdit} onDelete={onDelete} dealTitle={deals.find((d) => d.id === t.deal_id)?.title} />
        ))}
      </div>
    </div>
  );
}

function Row({ task, onToggle, onEdit, onDelete, dealTitle }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 bg-white border border-zinc-200 hover:border-zinc-400 rounded-sm group" data-testid={`task-row-${task.id}`}>
      <button onClick={() => onToggle(task)} className="text-zinc-700 hover:text-blue-700" data-testid={`task-toggle-${task.id}`}>
        {task.done ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5" />}
      </button>
      <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onEdit(task)}>
        <div className={`text-sm font-medium truncate ${task.done ? "line-through text-zinc-400" : ""}`}>{task.title}</div>
        <div className="flex items-center gap-3 text-[11px] text-zinc-500 mt-0.5">
          {task.due_date && <span className="font-mono">{task.due_date}{task.due_time ? ` · ${task.due_time}` : ""}</span>}
          {dealTitle && <span className="inline-flex items-center gap-0.5"><ExternalLink className="w-3 h-3" />{dealTitle}</span>}
          {task.priority === "high" && <span className="text-red-700 font-bold">High</span>}
          {task.google_event_id && <span className="inline-flex items-center gap-0.5 text-green-700"><Calendar className="w-3 h-3" />Synced</span>}
        </div>
      </div>
      <button onClick={() => onDelete(task)} className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-red-700 p-1" data-testid={`task-delete-${task.id}`}>
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}

function TaskModal({ initial, deals, onClose, onSave }) {
  const [form, setForm] = useState(initial);
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white border border-zinc-200 rounded-sm w-full max-w-lg" onClick={(e) => e.stopPropagation()} data-testid="task-modal">
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-200">
          <div className="text-sm font-bold uppercase tracking-wider">{form.id ? "Edit Task" : "New Task"}</div>
          <button onClick={onClose} className="p-1 hover:bg-zinc-100 rounded-sm"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-600 mb-1">Title *</label>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full px-3 h-10 border border-zinc-300 rounded-sm text-sm focus:outline-none focus:border-blue-700" autoFocus data-testid="task-title" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-600 mb-1">Due Date *</label>
              <input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} className="w-full px-3 h-10 border border-zinc-300 rounded-sm text-sm" data-testid="task-due-date" />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-600 mb-1">Time (optional)</label>
              <input type="time" value={form.due_time} onChange={(e) => setForm({ ...form, due_time: e.target.value })} className="w-full px-3 h-10 border border-zinc-300 rounded-sm text-sm" data-testid="task-due-time" />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-600 mb-1">Link to Deal (optional)</label>
            <select value={form.deal_id} onChange={(e) => setForm({ ...form, deal_id: e.target.value })} className="w-full px-2 h-10 border border-zinc-300 rounded-sm text-sm bg-white" data-testid="task-deal">
              <option value="">— None —</option>
              {deals.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-600 mb-1">Priority</label>
              <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="w-full px-2 h-10 border border-zinc-300 rounded-sm text-sm bg-white">
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-600 mb-1">Notes</label>
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} className="w-full px-3 py-2 border border-zinc-300 rounded-sm text-sm" data-testid="task-notes" />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-zinc-200">
          <button onClick={onClose} className="h-9 px-4 text-[10px] font-bold uppercase tracking-wider border border-zinc-300 hover:bg-zinc-50 rounded-sm">Cancel</button>
          <button onClick={() => onSave(form)} className="h-9 px-4 text-[10px] font-bold uppercase tracking-wider bg-zinc-950 hover:bg-zinc-800 text-white rounded-sm" data-testid="task-save-btn">Save</button>
        </div>
      </div>
    </div>
  );
}

function addDays(iso, n) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
