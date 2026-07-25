"""Shared photo helpers used by the PDF builders.

The field-capture flow (see `frontend/src/pages/FieldCapture.jsx::paintStamp`)
burns a "PROOF OF PRESENCE" banner into the bottom of every photo when the
rep has stamping enabled. The banner is sized to ~9% of the frame height
(min 90px, max 220px, capped by canvas). Once written into pixels it cannot
be removed retroactively — the JPEG in storage has the text baked in.

To keep client-facing PDF reports clean, we strip the banner on the fly when
embedding a stamped photo into a report. The `stamped` flag on the photo
document (set by the upload endpoint) tells us which images to trim.
"""
from __future__ import annotations

import io
import logging

from PIL import Image

logger = logging.getLogger(__name__)

# Fraction of image height to crop off the bottom for stamped photos. The
# stamp is authored at 9% of frame height; 11% gives a small safety margin
# so the gradient's soft top edge is also removed cleanly.
_STAMP_CROP_FRACTION = 0.11


def strip_stamp_banner(img_bytes: bytes, stamped: bool) -> bytes:
    """Remove the burned-in proof-of-presence banner from `img_bytes`.

    Returns the original bytes untouched when `stamped` is False or when
    the crop fails (bad image, tiny thumbnail, etc.) so callers can wrap
    every _load_photo() call without special-casing.
    """
    if not stamped or not img_bytes:
        return img_bytes
    try:
        with Image.open(io.BytesIO(img_bytes)) as im:
            im.load()
            w, h = im.size
            crop_h = int(round(h * _STAMP_CROP_FRACTION))
            if crop_h <= 0 or crop_h >= h:
                return img_bytes
            cropped = im.crop((0, 0, w, h - crop_h))
            # Preserve orientation-baked pixels — we already read them into
            # memory. Output as JPEG to keep report file sizes small; the
            # source is always JPEG from FieldCapture's canvas.toBlob().
            if cropped.mode in ("RGBA", "P"):
                cropped = cropped.convert("RGB")
            out = io.BytesIO()
            cropped.save(out, format="JPEG", quality=85, optimize=True)
            return out.getvalue()
    except Exception as e:
        logger.warning("strip_stamp_banner failed: %s", e)
        return img_bytes
