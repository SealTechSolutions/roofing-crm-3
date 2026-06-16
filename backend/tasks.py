"""Tasks — lightweight to-do entity that syncs to the user's main Google calendar.

Fields:
    title         (required)
    due_date      YYYY-MM-DD (required)
    due_time      HH:MM (optional, 24h)
    deal_id       (optional — linked project)
    notes         (optional)
    done          bool
    priority      "low" | "normal" | "high"
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field


class TaskIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    title: str
    due_date: str  # YYYY-MM-DD
    due_time: str = ""
    deal_id: str = ""
    notes: str = ""
    priority: str = "normal"
    done: bool = False


class Task(TaskIn):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    created_by_user_id: str = ""
    created_at: str = ""
    updated_at: str = ""
    is_deleted: bool = False
    google_event_id: Optional[str] = None
    google_calendar_id: Optional[str] = None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def make_tasks_router(db, get_current_user, push_task_fn=None, public_base_url: str = ""):
    router = APIRouter(prefix="/tasks", tags=["Tasks"])

    async def _push_safe(task_doc):
        if push_task_fn:
            try:
                await push_task_fn(db, task_doc.get("created_by_user_id"), task_doc, public_base_url)
            except Exception:
                pass

    @router.get("")
    async def list_tasks(current=Depends(get_current_user), include_done: bool = False, deal_id: Optional[str] = None):
        q = {"is_deleted": {"$ne": True}}
        if not include_done:
            q["done"] = {"$ne": True}
        if deal_id:
            q["deal_id"] = deal_id
        cur = db.tasks.find(q, {"_id": 0}).sort([("done", 1), ("due_date", 1), ("due_time", 1)])
        return await cur.to_list(2000)

    @router.post("", response_model=Task)
    async def create_task(body: TaskIn, current=Depends(get_current_user)):
        doc = Task(**body.model_dump()).model_dump()
        doc["created_by_user_id"] = current["id"]
        doc["created_at"] = _now()
        doc["updated_at"] = _now()
        await db.tasks.insert_one(doc.copy())
        await _push_safe(doc)
        return await db.tasks.find_one({"id": doc["id"]}, {"_id": 0})

    @router.put("/{task_id}", response_model=Task)
    async def update_task(task_id: str, body: TaskIn, current=Depends(get_current_user)):
        existing = await db.tasks.find_one({"id": task_id})
        if not existing or existing.get("is_deleted"):
            raise HTTPException(status_code=404, detail="Task not found")
        patch = body.model_dump()
        patch["updated_at"] = _now()
        await db.tasks.update_one({"id": task_id}, {"$set": patch})
        doc = await db.tasks.find_one({"id": task_id}, {"_id": 0})
        await _push_safe(doc)
        return doc

    @router.patch("/{task_id}/toggle", response_model=Task)
    async def toggle_done(task_id: str, current=Depends(get_current_user)):
        existing = await db.tasks.find_one({"id": task_id})
        if not existing:
            raise HTTPException(status_code=404, detail="Task not found")
        await db.tasks.update_one({"id": task_id}, {"$set": {"done": not existing.get("done"), "updated_at": _now()}})
        doc = await db.tasks.find_one({"id": task_id}, {"_id": 0})
        await _push_safe(doc)
        return doc

    @router.delete("/{task_id}")
    async def delete_task(task_id: str, current=Depends(get_current_user)):
        await db.tasks.update_one({"id": task_id}, {"$set": {"is_deleted": True, "updated_at": _now()}})
        return {"deleted": True}

    return router
