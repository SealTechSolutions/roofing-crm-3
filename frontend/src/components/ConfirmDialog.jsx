import React from "react";
import { AlertTriangle, X } from "lucide-react";

export default function ConfirmDialog({ open, title = "Are you sure?", message, confirmLabel = "Delete", danger = true, onConfirm, onClose }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4" onClick={onClose} data-testid="confirm-overlay">
      <div className="bg-white rounded-sm shadow-2xl w-full max-w-md animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-zinc-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {danger && <AlertTriangle className="w-5 h-5 text-red-600" />}
            <h2 className="font-heading text-lg font-bold tracking-tight">{title}</h2>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-zinc-100 rounded-sm" data-testid="confirm-close"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-6">
          <p className="text-sm text-zinc-700">{message}</p>
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-zinc-200">
          <button onClick={onClose} data-testid="confirm-cancel" className="px-4 h-10 text-xs font-bold uppercase tracking-wider border border-zinc-300 rounded-sm hover:bg-zinc-50">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            data-testid="confirm-yes"
            className={`px-4 h-10 text-xs font-bold uppercase tracking-wider text-white rounded-sm ${danger ? "bg-red-600 hover:bg-red-700" : "bg-blue-700 hover:bg-blue-800"}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
