"""Tests for the PDF script-signature-font rendering fix.

Covers:
  1. Font TTF files are shipped under /app/backend/assets/fonts/.
  2. _ensure_signature_fonts() registers all 6 with ReportLab.
  3. _signature_font_for() resolves known labels and gracefully falls back.
  4. build_work_order_pdf produces valid PDFs for each script font.
  5. Unknown / empty / missing font label still produces a valid PDF.
  6. Real signed Work Order on token 070FFFHvx78zluNbD3jN6l18KeX3igpI
     (Darren's Dexter WO, signed_signature.font='Dancing Script') downloads as
     application/pdf and the rendered page-1 PNG contains pixels in the
     bottom-left quadrant (where the Subcontractor signature lives).
"""
from __future__ import annotations

import io
import os
import subprocess
import sys
import tempfile

import pytest
import requests

# Make the backend importable
BACKEND_DIR = "/app/backend"
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # Fall back to the frontend .env file so tests still work in CI
    try:
        with open("/app/frontend/.env") as fh:
            for line in fh:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                    break
    except Exception:
        pass

REAL_SIGNED_TOKEN = "070FFFHvx78zluNbD3jN6l18KeX3igpI"
SCRIPT_FONTS = ["Caveat", "Dancing Script", "Great Vibes", "Sacramento", "Allura", "Pacifico"]


# ---------- Font file shipping ----------
def test_six_signature_ttfs_shipped():
    fonts_dir = "/app/backend/assets/fonts"
    expected = {"Caveat.ttf", "DancingScript.ttf", "GreatVibes.ttf",
                "Sacramento.ttf", "Allura.ttf", "Pacifico.ttf"}
    present = set(os.listdir(fonts_dir))
    missing = expected - present
    assert not missing, f"Missing font TTFs: {missing}"
    # all TTFs are real files >5 KB
    for fname in expected:
        size = os.path.getsize(os.path.join(fonts_dir, fname))
        assert size > 5000, f"{fname} suspiciously small ({size} bytes)"


# ---------- Font registration ----------
def test_ensure_signature_fonts_registers_all_six():
    import work_orders
    work_orders._ensure_signature_fonts()
    from reportlab.pdfbase import pdfmetrics
    registered = set(pdfmetrics.getRegisteredFontNames())
    for rl_name in ("Caveat", "DancingScript", "GreatVibes",
                    "Sacramento", "Allura", "Pacifico"):
        assert rl_name in registered, f"{rl_name} not registered. Got: {sorted(registered)}"


# ---------- Resolver ----------
def test_signature_font_resolver_known_labels():
    import work_orders
    assert work_orders._signature_font_for("Caveat") == "Caveat"
    assert work_orders._signature_font_for("Dancing Script") == "DancingScript"
    assert work_orders._signature_font_for("Great Vibes") == "GreatVibes"
    assert work_orders._signature_font_for("Sacramento") == "Sacramento"
    assert work_orders._signature_font_for("Allura") == "Allura"
    assert work_orders._signature_font_for("Pacifico") == "Pacifico"


def test_signature_font_resolver_fallback():
    import work_orders
    assert work_orders._signature_font_for(None) == "Helvetica-Oblique"
    assert work_orders._signature_font_for("") == "Helvetica-Oblique"
    assert work_orders._signature_font_for("Some Bogus Font") == "Helvetica-Oblique"


# ---------- Per-font PDF builds ----------
def _minimal_wo() -> dict:
    return {
        "project_name": "TEST_FontRender",
        "project_address": "123 Test Ln",
        "sub_company": "TestCo",
        "sub_contact": "Test User",
        "sub_email": "test@example.com",
        "wo_date": "06/23/2026",
        "work_date": "06/23/2026",
        "description": "Render font sanity check.",
        "total": 100.0,
        "scope_lines": ["Test line one", "Test line two"],
    }


@pytest.mark.parametrize("font_name", SCRIPT_FONTS)
def test_build_pdf_per_script_font(font_name):
    import work_orders
    pdf = work_orders.build_work_order_pdf(
        _minimal_wo(),
        signed_signature={
            "text": "Darren Oliver",
            "font": font_name,
            "signed_at": "2026-06-23T17:00:00+00:00",
        },
    )
    assert isinstance(pdf, (bytes, bytearray)), f"{font_name}: not bytes"
    assert pdf[:4] == b"%PDF", f"{font_name}: missing %PDF header"
    # Embedding a TTF subset adds quite a bit of bytes — sanity-check
    # the size is well above a plain text-only WO (~30-40 KB).
    assert len(pdf) > 50_000, f"{font_name}: PDF too small ({len(pdf)} bytes) — TTF probably not embedded"


# ---------- Fallback safety ----------
@pytest.mark.parametrize("bad_font", ["Some Bogus Font", "", None])
def test_build_pdf_unknown_font_fallback(bad_font):
    import work_orders
    sig = {"text": "Test", "signed_at": "2026-06-23T17:00:00+00:00"}
    if bad_font is not None:
        sig["font"] = bad_font
    pdf = work_orders.build_work_order_pdf(_minimal_wo(), signed_signature=sig)
    assert pdf[:4] == b"%PDF"
    assert len(pdf) > 10_000


# ---------- Real signed token (READ-ONLY) ----------
def test_real_signed_token_pdf_endpoint_returns_pdf():
    if not BASE_URL:
        pytest.skip("REACT_APP_BACKEND_URL not configured")
    r = requests.get(f"{BASE_URL}/api/work-order/{REAL_SIGNED_TOKEN}/pdf", timeout=30)
    assert r.status_code == 200, f"Got {r.status_code}: {r.text[:200]}"
    assert r.headers.get("content-type", "").startswith("application/pdf"), \
        f"Wrong content-type: {r.headers.get('content-type')}"
    assert r.content[:4] == b"%PDF"
    assert len(r.content) > 50_000, \
        f"Real signed PDF is suspiciously small ({len(r.content)} bytes) — script font may not be embedded"


def test_real_signed_token_pdf_renders_signature_pixels():
    """Render page 1 to PNG via pdftoppm and confirm signature pixels exist
    in the bottom-left quadrant (Subcontractor signature region)."""
    if not BASE_URL:
        pytest.skip("REACT_APP_BACKEND_URL not configured")
    r = requests.get(f"{BASE_URL}/api/work-order/{REAL_SIGNED_TOKEN}/pdf", timeout=30)
    assert r.status_code == 200
    pdf_bytes = r.content

    with tempfile.TemporaryDirectory() as tmp:
        pdf_path = os.path.join(tmp, "wo.pdf")
        with open(pdf_path, "wb") as fh:
            fh.write(pdf_bytes)

        # pdftoppm prefix outputs <prefix>-1.png at page 1
        out_prefix = os.path.join(tmp, "page")
        try:
            subprocess.run(
                ["pdftoppm", "-r", "110", "-png", "-f", "1", "-l", "1",
                 pdf_path, out_prefix],
                check=True, capture_output=True, timeout=30,
            )
        except FileNotFoundError:
            pytest.skip("pdftoppm not available in this environment")

        # pdftoppm writes either page-1.png or page-01.png depending on version
        candidates = [f"{out_prefix}-1.png", f"{out_prefix}-01.png"]
        png_path = next((p for p in candidates if os.path.exists(p)), None)
        assert png_path is not None, f"No PNG produced. Files: {os.listdir(tmp)}"

        png_size = os.path.getsize(png_path)
        assert png_size > 50_000, f"Rendered PNG suspiciously small ({png_size} bytes)"

        try:
            from PIL import Image
        except ImportError:
            pytest.skip("Pillow not installed")

        img = Image.open(png_path).convert("L")
        w, h = img.size
        # Bottom-left quadrant where the Subcontractor signature renders.
        # Trim slightly inward so we don't grab the page-edge whitespace.
        left, upper = int(w * 0.05), int(h * 0.60)
        right, lower = int(w * 0.50), int(h * 0.85)
        crop = img.crop((left, upper, right, lower))
        # Count dark-ish pixels (text). Threshold 200 on 0-255 grayscale.
        dark = sum(1 for px in crop.getdata() if px < 200)
        total = crop.size[0] * crop.size[1]
        ratio = dark / total
        # A line of typed text fills ~0.3-2% of a quadrant. Just confirm
        # *some* ink is there — the PDF isn't blank in the signature spot.
        assert dark > 500, (
            f"Signature region appears blank — only {dark}/{total} dark pixels "
            f"(ratio={ratio:.4f}). Cursive font likely missing."
        )
