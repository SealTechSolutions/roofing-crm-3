"""Soft-delete the 15 fake "Recovered from Field" photos the previous agent
attached to the Dexter deal. These are testing-agent debris from June 14
(10 colored squares, 9 KB each) and June 17 (5 black 70-byte stubs).

Soft-delete only — they stay in the Recently Deleted admin widget for 30
days so they can be restored with one click if I'm wrong about any of them.
"""
from __future__ import annotations

import asyncio
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT / ".env")

DEXTER_DEAL_ID = "b2f4b511-09ee-411d-978f-44a02ac24d13"
DARREN_USER_ID = "ebd982cb-666e-4d7e-aad0-597aecba0634"
FAKE_ALBUM = "Recovered from Field"


async def main() -> None:
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]
    now = datetime.now(timezone.utc).isoformat()

    targets = await db.project_photos.find(
        {
            "deal_id": DEXTER_DEAL_ID,
            "album_name": FAKE_ALBUM,
            "is_deleted": {"$ne": True},
        },
        {"_id": 0, "id": 1, "display_name": 1, "size": 1},
    ).to_list(500)

    print(f"Found {len(targets)} photos in '{FAKE_ALBUM}' on Dexter deal")
    for t in targets:
        print(f"  - {t.get('display_name')} ({t.get('size')} B)")

    if not targets:
        print("Nothing to delete.")
        return

    result = await db.project_photos.update_many(
        {
            "deal_id": DEXTER_DEAL_ID,
            "album_name": FAKE_ALBUM,
            "is_deleted": {"$ne": True},
        },
        {"$set": {"is_deleted": True, "deleted_at": now, "deleted_by": DARREN_USER_ID}},
    )
    print(f"\n✅ Soft-deleted {result.modified_count} photos.")
    print("   Restorable for 30 days from the dashboard's Recently Deleted widget.")


if __name__ == "__main__":
    asyncio.run(main())
