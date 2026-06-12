"""Vendor invoice (bill) PDF/image parser using Gemini 2.5 Flash Vision via Emergent LLM key."""
import os
import json
import re
import tempfile
import logging
from typing import Optional

from emergentintegrations.llm.chat import LlmChat, UserMessage, FileContentWithMimeType

logger = logging.getLogger(__name__)


PARSE_SYSTEM = """You are a precise invoice-parsing assistant for a commercial roofing contractor.
You will receive a vendor's invoice (PDF or image) and must extract its data into structured JSON.

OUTPUT FORMAT (strict JSON, no markdown fences, no commentary):
{
  "vendor_name": "string — the supplier/vendor company name as shown on the invoice (not our company)",
  "bill_number": "string — the vendor's invoice or document number",
  "bill_date": "YYYY-MM-DD — invoice issue date",
  "due_date": "YYYY-MM-DD — payment due date if shown, else empty string",
  "terms": "string — 'Due on Receipt' / 'Net 15' / 'Net 30' / 'Net 60' / etc, else empty",
  "total": number,
  "subtotal": number,
  "tax": number,
  "po_number": "string — purchase order number or job/project name referenced, else empty",
  "line_items": [
    { "description": "string", "quantity": number, "unit_price": number, "amount": number }
  ],
  "notes": "string — any payment instructions, remit-to info"
}

RULES:
- All numbers must be plain numbers (no $, no commas)
- Dates must be ISO format YYYY-MM-DD
- If a field is missing, use "" for strings, 0 for numbers, [] for line_items
- The TOTAL is what we owe the vendor (the largest "balance due" / "total due" / "amount due" figure)
- If you see "Net 30" or similar, set both "terms" and compute due_date = bill_date + 30 days
- DO NOT wrap the JSON in markdown code fences. Return raw JSON only.
"""


async def parse_invoice_bytes(file_bytes: bytes, filename: str, mime_type: Optional[str] = None) -> dict:
    """Send the uploaded vendor invoice through Gemini Vision and return parsed JSON."""
    if mime_type is None:
        ext = (filename or "").lower().rsplit(".", 1)[-1]
        mime_type = {
            "pdf": "application/pdf",
            "png": "image/png",
            "jpg": "image/jpeg",
            "jpeg": "image/jpeg",
            "webp": "image/webp",
            "heic": "image/heic",
        }.get(ext, "application/pdf")

    suffix = "." + (filename.rsplit(".", 1)[-1] if "." in filename else "pdf")
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tf:
        tf.write(file_bytes)
        tmp_path = tf.name

    try:
        api_key = os.environ.get("EMERGENT_LLM_KEY", "").strip()
        if not api_key:
            raise RuntimeError("EMERGENT_LLM_KEY missing from backend/.env")

        chat = LlmChat(
            api_key=api_key,
            session_id=f"vendor-bill-parse-{filename}",
            system_message=PARSE_SYSTEM,
        ).with_model("gemini", "gemini-2.5-flash")

        attachment = FileContentWithMimeType(file_path=tmp_path, mime_type=mime_type)
        msg = UserMessage(text="Parse this vendor invoice into the structured JSON exactly as specified.", file_contents=[attachment])

        result_text = await chat.send_message(msg)
        # Strip code fences if model wrapped them anyway
        cleaned = result_text.strip()
        if cleaned.startswith("```"):
            cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
            cleaned = re.sub(r"\s*```$", "", cleaned)
        try:
            parsed = json.loads(cleaned)
        except json.JSONDecodeError:
            # Try to find a JSON object substring
            m = re.search(r"\{.*\}", cleaned, re.DOTALL)
            if not m:
                raise RuntimeError(f"Gemini returned non-JSON output: {cleaned[:500]}")
            parsed = json.loads(m.group(0))

        # Normalize numbers
        for k in ("total", "subtotal", "tax"):
            try:
                parsed[k] = float(parsed.get(k) or 0)
            except (TypeError, ValueError):
                parsed[k] = 0.0
        items = []
        for it in (parsed.get("line_items") or []):
            try:
                qty = float(it.get("quantity") or 1)
            except (TypeError, ValueError):
                qty = 1.0
            try:
                up = float(it.get("unit_price") or 0)
            except (TypeError, ValueError):
                up = 0.0
            try:
                amt = float(it.get("amount") or 0)
            except (TypeError, ValueError):
                amt = 0.0
            if not amt and qty and up:
                amt = round(qty * up, 2)
            items.append({
                "description": str(it.get("description") or "").strip(),
                "quantity": qty,
                "unit_price": up,
                "amount": amt,
            })
        parsed["line_items"] = items

        for k in ("vendor_name", "bill_number", "bill_date", "due_date", "terms", "po_number", "notes"):
            parsed[k] = str(parsed.get(k) or "").strip()
        return parsed
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
