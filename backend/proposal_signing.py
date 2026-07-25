"""Public proposal signing — the "Sign Off" link on the scope email.

When a scope is emailed, a unique opaque token is minted (or reused) on the deal
and embedded in the email as `/sign/{token}`. The recipient lands on a public,
unauthenticated viewer page that shows the project summary, the scope bullets
they're being asked to accept, and a signature surface. On submit:

  1. `scope_signed_at` is stamped on the deal
  2. status flips to "Won" (with a clean status_history entry)
  3. optional signature image is persisted to Object Storage and linked
  4. signer name/email/ip is stored for audit

The frontend Next-Step card then automatically pivots to "Create deposit
invoice" because the deal is now Won — closing the Lead → Sent → Won → Invoice
loop without anyone in the office touching it.
"""
from __future__ import annotations

import io
import secrets
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Body, Request, Response
from fastapi.responses import StreamingResponse

from storage import put_object, get_object, APP_NAME


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _gen_token() -> str:
    # 32-char URL-safe token. ~190 bits of entropy — plenty for an unauth viewer.
    return secrets.token_urlsafe(24)


async def ensure_proposal_token(db, deal_id: str) -> str:
    """Return the deal's existing `proposal_sign_token`, minting + persisting
    a new one if missing. Called from the scope-email flow."""
    deal = await db.deals.find_one(
        {"id": deal_id, "is_deleted": {"$ne": True}},
        {"_id": 0, "proposal_sign_token": 1, "id": 1},
    )
    if deal is None:
        raise ValueError(f"Deal {deal_id} not found")
    token = deal.get("proposal_sign_token")
    if token:
        return token
    token = _gen_token()
    await db.deals.update_one(
        {"id": deal_id},
        {"$set": {"proposal_sign_token": token}},
    )
    return token


def create_public_router(db, get_current_user, compute_scope_data, auto_create_deposit_invoice=None, build_signed_pdf_fn=None):
    """Public + authed routers for the proposal signing flow.

    `compute_scope_data` is injected from server.py so we don't reimport the
    monolith (circular). It receives a deal_id and returns the same data dict
    that `build_spec_sheet` consumes — we slice out the scope bullets, totals,
    addresses for the public viewer.

    `auto_create_deposit_invoice(deal_id, percentage)` is an optional callable
    invoked AFTER a successful sign that spawns a Draft deposit invoice. When
    omitted (or it returns None) the sign flow still succeeds — the invoice
    side-effect is purely additive.

    `build_signed_pdf_fn(deal_dict) -> bytes` is the shared spec-sheet PDF
    builder (server._build_spec_pdf_for_deal stripped of the auth/user lookup
    so the public download endpoint can reuse it). When provided, the
    `/public/proposal/{token}/pdf` endpoint becomes available — lets the
    customer grab a copy of their signed scope from the confirmation card.
    """
    router = APIRouter(prefix="/public/proposal", tags=["Public Proposal Signing"])

    @router.get("/{token}")
    async def public_view(token: str):
        """Return safe-to-show proposal data for the public viewer page."""
        deal = await db.deals.find_one(
            {"proposal_sign_token": token, "is_deleted": {"$ne": True}},
            {"_id": 0},
        )
        if not deal:
            raise HTTPException(404, "Proposal link not found or revoked")

        data = await compute_scope_data(deal["id"])

        signed_already = bool(deal.get("scope_signed_at"))

        # Build the price picker options — one entry per warranty tier that
        # has a non-zero price. Customer selects one at sign time; the chosen
        # option's price populates `chosen_amount` on the deal. Options are
        # ordered richest → cheapest so the recommended package sits first.
        opt_25 = float(deal.get("proposal_option_25yr") or 0)
        opt_20 = float(deal.get("proposal_option_1") or 0)
        opt_15 = float(deal.get("proposal_option_2") or 0)
        opt_10 = float(deal.get("proposal_option_3") or 0)
        # NDL Warranty Upgrade — Western Colloid all-tier opt-in. Standard
        # base pricing (opt_10/15/20/25) already includes the Material/Labor
        # warranty. The NDL upgrade replaces that with a No-Dollar-Limit
        # warranty (and, for 20/25-yr, bundles in impact/hail coverage).
        # Feb-2026 confirmed pricing:
        #   10-yr NDL:                     $0.10/SF, min $1,000
        #   15-yr NDL:                     $0.15/SF, min $1,500
        #   20-yr NDL w/ Hail Rider:       $0.20/SF, min $2,000
        #   25-yr NDL w/ Hail Rider:       $0.25/SF, min $2,500
        _roof_type = (deal.get("proposed_roof_type") or "").upper()
        _is_wc_farm = "FARM" in _roof_type or "FLUID APPLIED" in _roof_type
        _sqft = float(deal.get("total_sqft") or deal.get("property_sqft") or 0)

        def _ndl_default(years: int) -> float:
            rates = {10: (0.10, 1000.0), 15: (0.15, 1500.0),
                     20: (0.20, 2000.0), 25: (0.25, 2500.0)}
            per_sf, floor = rates.get(years, (0.0, 0.0))
            if per_sf == 0:
                return 0.0
            return round(max(_sqft * per_sf, floor), 2) if _sqft > 0 else floor

        # Field lookup — check both the "ndl_upgrade_*" and legacy
        # "hail_rider_*" fields (which we shipped first for 20/25-yr). If
        # the rep never set an explicit $, fall back to the per-tier default.
        def _ndl_for(years: int, base_price: float) -> float:
            explicit = float(
                deal.get(f"ndl_upgrade_{years}yr_add")
                or (deal.get(f"hail_rider_{years}yr_add") if years in (20, 25) else 0)
                or 0
            )
            if explicit > 0:
                return explicit
            if _is_wc_farm and base_price > 0:
                return _ndl_default(years)
            return 0.0

        ndl_10 = _ndl_for(10, opt_10)
        ndl_15 = _ndl_for(15, opt_15)
        ndl_20 = _ndl_for(20, opt_20)
        ndl_25 = _ndl_for(25, opt_25)

        def _ndl_label(years: int) -> str:
            if years in (20, 25):
                return "Upgrade to NDL Warranty w/ Hail Rider"
            return "Upgrade to NDL Warranty"

        raw_options = [
            {"id": "opt_25", "warranty_years": 25, "label": "25-Year Standard Warranty",
             "price": opt_25, "ndl_upgrade_price": ndl_25, "ndl_upgrade_label": _ndl_label(25)},
            {"id": "opt_20", "warranty_years": 20, "label": "20-Year Standard Warranty",
             "price": opt_20, "ndl_upgrade_price": ndl_20, "ndl_upgrade_label": _ndl_label(20)},
            {"id": "opt_15", "warranty_years": 15, "label": "15-Year Standard Warranty",
             "price": opt_15, "ndl_upgrade_price": ndl_15, "ndl_upgrade_label": _ndl_label(15)},
            {"id": "opt_10", "warranty_years": 10, "label": "10-Year Standard Warranty",
             "price": opt_10, "ndl_upgrade_price": ndl_10, "ndl_upgrade_label": _ndl_label(10)},
        ]
        # Back-compat alias so older frontends that still read `hail_rider_price` continue working.
        for o in raw_options:
            o["hail_rider_price"] = o["ndl_upgrade_price"] if o["warranty_years"] in (20, 25) else 0
        proposal_options = [o for o in raw_options if o["price"] > 0]
        # Already-chosen amount (deal.chosen_amount) doubles as the default
        # picker selection — if the rep locked one in before sending, the
        # customer sees that pre-selected but can still change tiers.
        chosen_id = ""
        chosen_amount = float(deal.get("chosen_amount") or 0)
        if chosen_amount > 0:
            for o in proposal_options:
                if abs(o["price"] - chosen_amount) < 0.01:
                    chosen_id = o["id"]
                    break

        return {
            "project_title": deal.get("title") or "Project Proposal",
            "company": data.get("client_company") or "",
            "client_name": data.get("client_name") or "",
            "client_address": data.get("client_address") or "",
            "client_city": data.get("client_city") or "",
            "client_state": data.get("client_state") or "",
            "client_zip": data.get("client_zip") or "",
            "primary_contact_email": deal.get("primary_contact_email") or "",
            "primary_contact_name": deal.get("primary_contact_name") or "",
            "chosen_amount": chosen_amount,
            "chosen_option_id": chosen_id,
            "proposal_options": proposal_options,
            "proposed_roof_type": deal.get("proposed_roof_type") or "",
            "deal_type": deal.get("deal_type") or "Scope",
            # Effective bullets (template + overrides applied) — same shape as /scope-bullets GET
            "scope": {
                "title": data.get("scope_title") or "",
                "scope_1_title": data.get("scope_1_title") or "",
                "scope_1": data.get("scope_1") or [],
                "scope_2_title": data.get("scope_2_title") or "",
                "scope_2": data.get("scope_2") or [],
                "key_advantages": data.get("key_advantages") or [],
            },
            "signed": {
                "is_signed": signed_already,
                "signed_at": deal.get("scope_signed_at") or "",
                "signed_by_name": deal.get("scope_signed_by_name") or "",
                "signed_by_email": deal.get("scope_signed_by_email") or "",
            },
        }

    @router.post("/{token}/sign")
    async def public_sign(
        token: str,
        request: Request,
        body: dict = Body(...),
    ):
        """E-sign the proposal. Idempotent: a second sign attempt returns the
        original signature and a flag so the UI can show "Already signed" UX."""
        deal = await db.deals.find_one(
            {"proposal_sign_token": token, "is_deleted": {"$ne": True}},
            {"_id": 0},
        )
        if not deal:
            raise HTTPException(404, "Proposal link not found or revoked")

        if deal.get("scope_signed_at"):
            return {
                "ok": True,
                "already_signed": True,
                "signed_at": deal["scope_signed_at"],
                "signed_by_name": deal.get("scope_signed_by_name") or "",
            }

        signer_name = (body.get("signer_name") or "").strip()
        signer_email = (body.get("signer_email") or "").strip()
        accepted = bool(body.get("accepted"))
        signature_data_url: Optional[str] = body.get("signature_data_url")
        signature_font = (body.get("signature_font") or "").strip()[:40]
        # Optional NDL Warranty Upgrade opt-in — customer ticked the upgrade
        # on the sign page. Applies to WC 10/15/20/25-yr; 20/25-yr bundle in
        # Hail Rider coverage as part of the NDL upgrade. Accepts the legacy
        # `add_hail_rider` flag too so older sign links still work.
        add_ndl_upgrade = bool(body.get("add_ndl_upgrade") or body.get("add_hail_rider"))
        # Customer picks a warranty tier from the price picker; the chosen
        # option locks in `chosen_amount` and `winning_warranty_years` on
        # the deal so downstream milestones + Books use the right price.
        chosen_option_id = (body.get("chosen_option_id") or "").strip()
        chosen_price = None
        chosen_warranty_years = None
        OPTION_FIELD_MAP = {
            "opt_25": ("proposal_option_25yr", 25),
            "opt_20": ("proposal_option_1", 20),
            "opt_15": ("proposal_option_2", 15),
            "opt_10": ("proposal_option_3", 10),
        }
        if chosen_option_id in OPTION_FIELD_MAP:
            field, years = OPTION_FIELD_MAP[chosen_option_id]
            chosen_price = float(deal.get(field) or 0)
            chosen_warranty_years = years
        # Fall back to whatever was already on the deal (a rep locked in a
        # single option via the Calculator's "Set Option") so old sign links
        # without a picker still work.
        if not chosen_price or chosen_price <= 0:
            fallback = float(deal.get("chosen_amount") or 0)
            if fallback > 0:
                chosen_price = fallback

        # NDL Upgrade price — added to base only when the customer opted in
        # AND the chosen tier has a non-zero NDL price on the deal. If the
        # rep never explicitly set a value in the Calculator, fall back to
        # the Feb-2026 WC defaults (see _ndl_default in public_view).
        ndl_price = 0.0
        if add_ndl_upgrade and chosen_warranty_years in (10, 15, 20, 25):
            explicit = float(
                deal.get(f"ndl_upgrade_{chosen_warranty_years}yr_add")
                or (deal.get(f"hail_rider_{chosen_warranty_years}yr_add") if chosen_warranty_years in (20, 25) else 0)
                or 0
            )
            if explicit > 0:
                ndl_price = explicit
            else:
                _rt = (deal.get("proposed_roof_type") or "").upper()
                if "FARM" in _rt or "FLUID APPLIED" in _rt:
                    _sqft = float(deal.get("total_sqft") or deal.get("property_sqft") or 0)
                    rates = {10: (0.10, 1000.0), 15: (0.15, 1500.0),
                             20: (0.20, 2000.0), 25: (0.25, 2500.0)}
                    per_sf, floor = rates[chosen_warranty_years]
                    ndl_price = round(max(_sqft * per_sf, floor), 2) if _sqft > 0 else floor
        final_chosen_amount = (chosen_price or 0) + ndl_price

        if not accepted:
            raise HTTPException(400, "Acceptance is required to sign the proposal")
        if not signer_name:
            raise HTTPException(400, "Signer name is required")
        if final_chosen_amount <= 0:
            raise HTTPException(400, "Please select a warranty tier before signing.")

        # Persist a drawn signature image (if provided) to Object Storage
        signature_file_id = ""
        if signature_data_url and signature_data_url.startswith("data:image/"):
            try:
                import base64
                head, _, b64 = signature_data_url.partition(",")
                ct = "image/png"
                if "image/svg" in head:
                    ct = "image/svg+xml"
                elif "image/jpeg" in head or "image/jpg" in head:
                    ct = "image/jpeg"
                img_bytes = base64.b64decode(b64)
                # Cheap sanity cap so a malicious payload can't blow up storage
                if len(img_bytes) > 2_500_000:  # 2.5MB
                    raise ValueError("signature image too large")
                signature_file_id = secrets.token_urlsafe(16)
                ext = "png" if ct == "image/png" else ("svg" if "svg" in ct else "jpg")
                sp = f"{APP_NAME}/uploads/deal/{deal['id']}/signature-{signature_file_id}.{ext}"
                put_object(sp, img_bytes, ct)
                await db.files.insert_one({
                    "id": signature_file_id,
                    "parent_type": "deal",
                    "parent_id": deal["id"],
                    "category": "Signature",
                    "storage_path": sp,
                    "original_filename": f"signature-{deal['id'][:8]}.{ext}",
                    "content_type": ct,
                    "size": len(img_bytes),
                    "is_deleted": False,
                    "uploaded_by": "public-sign",
                    "created_at": _now_iso(),
                    "is_sent_snapshot": False,
                })
            except Exception:
                # Signing must succeed even if the signature image upload fails —
                # the legal hold is the name + IP + timestamp.
                signature_file_id = ""

        now = _now_iso()
        client_ip = (request.client.host if request.client else "") or ""
        ua = request.headers.get("user-agent", "")
        prev_status = deal.get("status") or "Lead"

        # Only promote pre-Won statuses to "Won". If the deal is already past
        # Won (Deposit Paid / Materials Ordered / Scheduled / In Progress /
        # Final Inspection / Closed), keep the current pipeline stage — the
        # customer just re-signed (or signed late) and we must not roll the
        # project backwards. The signature + history entry are still recorded
        # so the legal hold and audit trail are intact.
        PRE_WON = {"Lead", "Past Lead", "Assessment", "Scope Sent"}
        new_status = "Won" if prev_status in PRE_WON else prev_status

        history_entry = {
            "at": now,
            "from": prev_status,
            "to": new_status,
            "user_id": "public-sign",
            "user_name": signer_name,
            "label": "Proposal accepted (public sign-off)",
            "signer_email": signer_email,
            "ip": client_ip,
        }

        await db.deals.update_one(
            {"id": deal["id"]},
            {
                "$set": {
                    "status": new_status,
                    "scope_signed_at": now,
                    "scope_signed_by_name": signer_name,
                    "scope_signed_by_email": signer_email,
                    "scope_signed_ip": client_ip,
                    "scope_signed_user_agent": ua[:300],
                    "scope_signature_file_id": signature_file_id,
                    "scope_signature_font": signature_font,
                    # Persist customer's chosen tier + total. The hail-rider
                    # opt-in is stamped so downstream Books / WO scope know
                    # to include it in the contract total.
                    "chosen_amount": float(final_chosen_amount),
                    "chosen_date": now[:10],
                    **({"winning_warranty_years": chosen_warranty_years} if chosen_warranty_years else {}),
                    **({"chosen_option_id": chosen_option_id} if chosen_option_id else {}),
                    **({"ndl_upgrade_accepted": True,
                        "ndl_upgrade_accepted_amount": ndl_price,
                        # Legacy aliases kept in sync so downstream code that
                        # still reads `hail_rider_accepted_*` continues working.
                        "hail_rider_accepted": True,
                        "hail_rider_accepted_amount": ndl_price}
                       if add_ndl_upgrade and ndl_price > 0 else {}),
                    "updated_at": now,
                },
                "$push": {"status_history": history_entry},
            },
        )

        # Hands-free cash collection: auto-spawn a Draft deposit invoice
        # (default 50%) so the project owner just opens, reviews, and sends.
        # Only when this is the FIRST signing of a pre-Won deal — we don't
        # want to spawn a duplicate deposit on a re-signed Won/In-Progress job.
        auto_invoice: Optional[dict] = None
        if auto_create_deposit_invoice is not None and prev_status in PRE_WON:
            try:
                deposit_pct = float(body.get("deposit_pct") or 50)
                if deposit_pct > 0:
                    auto_invoice = await auto_create_deposit_invoice(deal["id"], deposit_pct)
            except Exception:
                # Sign must succeed even if invoice creation fails.
                auto_invoice = None

        return {
            "ok": True,
            "already_signed": False,
            "signed_at": now,
            "signed_by_name": signer_name,
            "deal_id": deal["id"],
            "status": new_status,
            "signature_file_id": signature_file_id,
            "deposit_invoice_id": (auto_invoice or {}).get("id", ""),
            "deposit_invoice_number": (auto_invoice or {}).get("invoice_number", ""),
        }

    @router.get("/{token}/signature")
    async def public_signature_image(token: str):
        """Stream the saved signature image (for the post-sign 'thank you' card)."""
        deal = await db.deals.find_one(
            {"proposal_sign_token": token, "is_deleted": {"$ne": True}},
            {"_id": 0, "scope_signature_file_id": 1},
        )
        if not deal or not deal.get("scope_signature_file_id"):
            raise HTTPException(404, "Signature not on file")
        rec = await db.files.find_one(
            {"id": deal["scope_signature_file_id"], "is_deleted": {"$ne": True}},
            {"_id": 0},
        )
        if not rec:
            raise HTTPException(404, "Signature file missing")
        content, _ = get_object(rec["storage_path"])
        return StreamingResponse(io.BytesIO(content), media_type=rec.get("content_type", "image/png"))

    @router.get("/{token}/pdf")
    async def public_signed_pdf(token: str):
        """Public download of the signed scope PDF. Surfaced from the
        post-sign confirmation card ("Download Signed Copy") so the
        customer always has a copy on hand without needing email access."""
        if build_signed_pdf_fn is None:
            raise HTTPException(503, "Signed-copy download is not enabled on this server")
        deal = await db.deals.find_one(
            {"proposal_sign_token": token, "is_deleted": {"$ne": True}},
            {"_id": 0},
        )
        if not deal:
            raise HTTPException(404, "Proposal link not found or revoked")
        # Don't gate on `scope_signed_at` — reps may want to share the same
        # link as a preview. The PDF body itself shows the signature only
        # when the deal has actually been signed, so this is safe.
        pdf_bytes = await build_signed_pdf_fn(deal)
        safe_title = (deal.get("title") or "project").replace(" ", "_").replace("/", "_")
        filename = f"sealtech-scope-{safe_title}-signed.pdf"
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    return router
