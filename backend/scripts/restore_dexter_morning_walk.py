"""One-shot recovery script for Darren's 2026-06-19 Dexter morning walk.

The previous main agent's "recovery" routine hard-deleted the project_photos DB
rows but the binary files survived in object storage. This script walks the
storage prefix for the Dexter deal, finds every file with NO matching DB row,
filters out zero-byte garbage (iOS Safari black-screen failures), and inserts
a fresh project_photos record pointing back at the storage object.

Photos are dropped into a dedicated album "Recovered Morning Walk" so Darren
can find them at a glance. Attribution is the real uploader UUID for Darren.
"""
from __future__ import annotations

import asyncio
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

# Allow this script to be run as `python scripts/restore_dexter_morning_walk.py`
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT / ".env")

DEXTER_DEAL_ID = "b2f4b511-09ee-411d-978f-44a02ac24d13"
DARREN_USER_ID = "ebd982cb-666e-4d7e-aad0-597aecba0634"
DARREN_NAME = "Darren Oliver"
RECOVERY_ALBUM = "Recovered Morning Walk · 2026-06-19"
# Anything smaller than this is either a 0-byte black-screen failure or a
# JSON error response that got stored instead of a JPEG. The real shots are
# all 0.5-1.2 MB; we draw the line conservatively at 50 KB.
MIN_REAL_BYTES = 50 * 1024

STORAGE_URL = "https://integrations.emergentagent.com/objstore/api/v1/storage"


def storage_key() -> str:
    emergent_key = os.environ["EMERGENT_LLM_KEY"]
    r = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": emergent_key}, timeout=30)
    r.raise_for_status()
    return r.json()["storage_key"]


def list_objects(sk: str, prefix: str) -> list[dict]:
    r = requests.get(f"{STORAGE_URL}/objects", params={"prefix": prefix},
                     headers={"X-Storage-Key": sk}, timeout=30)
    r.raise_for_status()
    return r.json().get("objects", [])


async def main(dry_run: bool = False) -> None:
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]

    sk = storage_key()
    prefix = f"sealtech-crm/project_photos/{DEXTER_DEAL_ID}/"
    objs = list_objects(sk, prefix)
    print(f"Found {len(objs)} files in object storage under {prefix}")

    # Set of paths already linked from the DB so we don't double-insert.
    known = set()
    async for p in db.project_photos.find({}, {"storage_path": 1, "_id": 0}):
        if p.get("storage_path"):
            known.add(p["storage_path"])

    orphans = [o for o in objs if o.get("path") not in known]
    print(f"  {len(orphans)} orphaned (no DB row)")

    real = [o for o in orphans if (o.get("size") or 0) >= MIN_REAL_BYTES]
    zero = [o for o in orphans if (o.get("size") or 0) < MIN_REAL_BYTES]
    print(f"  {len(real)} real photos (>= {MIN_REAL_BYTES} bytes), {len(zero)} garbage/black-screen failures")

    if dry_run:
        print("\nDRY RUN — no DB writes. Would insert:")
        for o in real:
            print(f"  {o.get('size')/1024:7.1f} KB  {o.get('last_modified')}  {o.get('path')}")
        return

    inserted = 0
    for o in sorted(real, key=lambda x: x.get("last_modified", "")):
        path = o["path"]
        # The filename in object storage is "{photo_id}.{ext}" — reuse the
        # photo_id so the storage_path keeps pointing at the same blob.
        leaf = path.rsplit("/", 1)[-1]
        photo_id, _, ext = leaf.partition(".")
        # last_modified is RFC3339 with "Z" — convert to ISO 8601 with "+00:00"
        ts_raw = o.get("last_modified") or ""
        try:
            captured = datetime.fromisoformat(ts_raw.replace("Z", "+00:00")).isoformat()
        except Exception:
            captured = datetime.now(timezone.utc).isoformat()
        doc = {
            "id": photo_id,
            "deal_id": DEXTER_DEAL_ID,
            "album_name": RECOVERY_ALBUM,
            "tag": "",
            "display_name": f"Morning Walk · {captured[11:16]} UTC",
            "description": "Recovered from object storage on 2026-06-19 after DB row was deleted by the previous agent's bulk-move routine. Binary file survived intact.",
            "storage_path": path,
            "original_filename": f"morning-walk-{captured[11:16].replace(':','')}.{ext or 'jpg'}",
            "content_type": "image/jpeg" if (ext or "").lower() in ("jpg", "jpeg") else "image/png" if (ext or "").lower() == "png" else "application/octet-stream",
            "size": o.get("size") or 0,
            "is_deleted": False,
            "is_cover": False,
            "uploaded_by": DARREN_USER_ID,
            "uploader_name": DARREN_NAME,
            "created_at": captured,
            "captured_at": captured,
            "gps_lat": None,
            "gps_lng": None,
            "gps_accuracy": None,
            "stamped": True,  # field camera always burns the stamp
        }
        # Safety: don't clobber an existing row if the ID was somehow reused.
        existing = await db.project_photos.find_one({"id": photo_id}, {"_id": 0, "id": 1})
        if existing:
            print(f"  SKIP existing id={photo_id}")
            continue
        await db.project_photos.insert_one(doc.copy())
        inserted += 1
        print(f"  RESTORED  {o.get('size')/1024:7.1f} KB  {captured}  {leaf}")

    print(f"\n✅ Inserted {inserted} restored photos into project_photos.")
    print(f"   Album: '{RECOVERY_ALBUM}' on Dexter deal {DEXTER_DEAL_ID}")


if __name__ == "__main__":
    dry = "--dry-run" in sys.argv
    asyncio.run(main(dry_run=dry))
