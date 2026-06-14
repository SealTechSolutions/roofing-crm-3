"""Assessment Reports — Commercial Roof Assessment module.

Mirrors SealTech's 12-page "Commercial Roof Assessment Report" template, with:
  • Cover (Prepared For / Property / Prepared By / Date)
  • Executive Summary + Roof Asset Score™ (8 metric ratings)
  • Executive Findings (primary concerns + positive findings)
  • Property Information + Assessment Scope checkboxes
  • Aerial roof image
  • R-1..R-5 Asset Condition Findings (each with photos, severity, risk, recommendation)
  • Score Analysis (positive/negative drivers + Restoration Suitability)
  • Repair vs Restoration vs Replacement analysis
  • Capital Planning Forecast (1/3/5/10-year)
  • Recommended Roof Asset Plan (budget priority + 3 horizons)
  • SealTech Recommendation + Supporting Comments
  • Expected Outcome + Conclusion

Assessments may be tied to a Deal (preferred — so photos pulled in via Project Photos),
or stand-alone (loose property record). Soft-deleted assessments land in Admin Trash.

Endpoints (all prefixed with /api/assessments):
  GET    /                  — list (filters: deal_id, status, limit)
  POST   /                  — create
  GET    /{id}              — get
  PUT    /{id}              — update
  DELETE /{id}              — soft-delete
  GET    /{id}/pdf          — render PDF
  POST   /{id}/email        — email PDF via assessments@ alias
  POST   /{id}/finalize     — set status=Final + finalized_at
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Body
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field


# ---------- Sub-models ----------

class AssessmentScore(BaseModel):
    """A single 0-100 metric with reasoning."""
    model_config = ConfigDict(extra="ignore")
    score: int = 0
    reasoning: str = ""


class AssessmentFinding(BaseModel):
    """R-1 through R-5 — one structured finding per major roof component."""
    model_config = ConfigDict(extra="ignore")
    component: str = ""        # "Roof Membrane", "Flashings", etc.
    observations: str = ""
    severity: str = ""         # "Low" | "Moderate" | "High" | "Critical"
    risk: str = ""             # Risk implication text
    recommendation: str = ""
    photo_ids: List[str] = Field(default_factory=list)  # → project_photos.id


class RepairOptionAnalysis(BaseModel):
    """One row in the Repair-vs-Restoration-vs-Replacement comparison."""
    model_config = ConfigDict(extra="ignore")
    cost: str = ""             # "$ — Low" / "$$ — Mid" / "$$$ — High"
    life_extension: str = ""   # "1-3 years", "10-15 years", etc.
    disruption: str = ""       # "Minimal", "Low", "High"
    advantages: List[str] = Field(default_factory=list)
    disadvantages: List[str] = Field(default_factory=list)
    limitations: List[str] = Field(default_factory=list)


class AssessmentIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    # ---- Linking ----
    deal_id: Optional[str] = None
    contact_id: Optional[str] = None
    entity_id: Optional[str] = None

    # ---- Cover ----
    prepared_for: str = ""
    property_name: str = ""
    property_address: str = ""
    prepared_by: str = "Darren Oliver, CSI, IIBEC · SealTech Building Solutions"
    assessment_date: str = ""  # ISO yyyy-mm-dd

    # ---- Executive Summary ----
    purpose: str = ""
    executive_conclusion: str = ""
    overall_recommendation: str = ""

    # ---- Roof Asset Dashboard™ (8 metrics, 0-100) ----
    roof_asset_score: AssessmentScore = Field(default_factory=AssessmentScore)
    condition_rating: AssessmentScore = Field(default_factory=AssessmentScore)
    remaining_service_life: AssessmentScore = Field(default_factory=AssessmentScore)
    restoration_suitability: AssessmentScore = Field(default_factory=AssessmentScore)
    capital_risk: AssessmentScore = Field(default_factory=AssessmentScore)
    hail_resilience: AssessmentScore = Field(default_factory=AssessmentScore)
    maintenance_status: AssessmentScore = Field(default_factory=AssessmentScore)
    warranty_status: AssessmentScore = Field(default_factory=AssessmentScore)

    # ---- Executive Findings ----
    primary_concerns: List[str] = Field(default_factory=list)
    positive_findings: List[str] = Field(default_factory=list)
    recommended_strategy: str = ""
    capital_planning_impact: str = ""
    immediate_action_items: List[str] = Field(default_factory=list)

    # ---- Methodology ----
    methodology_notes: str = ""

    # ---- Property Information ----
    building_type: str = ""
    square_footage: Optional[float] = None
    year_built: Optional[int] = None
    roof_type: str = ""
    roof_age_years: Optional[float] = None
    last_inspection_date: str = ""

    # ---- Assessment Scope Checkboxes ----
    scope_visual_assessment: bool = True
    scope_infrared_survey: bool = False
    scope_moisture_survey: bool = False
    scope_core_samples: bool = False
    scope_drone_imaging: bool = False
    scope_membrane_testing: bool = False
    scope_drainage_evaluation: bool = True
    scope_documentation_review: bool = False

    # ---- Aerial image ----
    aerial_photo_id: Optional[str] = None  # → project_photos.id

    # ---- Asset Condition Findings (R-1..R-5) ----
    finding_r1: AssessmentFinding = Field(default_factory=lambda: AssessmentFinding(component="Roof Membrane"))
    finding_r2: AssessmentFinding = Field(default_factory=lambda: AssessmentFinding(component="Flashings"))
    finding_r3: AssessmentFinding = Field(default_factory=lambda: AssessmentFinding(component="Roof Penetrations"))
    finding_r4: AssessmentFinding = Field(default_factory=lambda: AssessmentFinding(component="Drainage System"))
    finding_r5: AssessmentFinding = Field(default_factory=lambda: AssessmentFinding(component="Rooftop Equipment"))

    # ---- Score Analysis ----
    positive_factors: List[str] = Field(default_factory=list)
    negative_factors: List[str] = Field(default_factory=list)
    restoration_suitability_rating: str = "Moderate"  # "High" | "Moderate" | "Low"
    restoration_analysis: str = ""
    # Factors supporting restoration (checkboxes)
    factor_membrane_intact: bool = False
    factor_minimal_water_intrusion: bool = False
    factor_drainage_functional: bool = False
    factor_structural_integrity: bool = False
    factor_compatible_substrate: bool = False
    factor_recent_inspection: bool = False

    # ---- Repair vs Restoration vs Replacement ----
    option_repair: RepairOptionAnalysis = Field(default_factory=lambda: RepairOptionAnalysis(
        cost="$ — Low", life_extension="1-3 years", disruption="Minimal"
    ))
    option_restoration: RepairOptionAnalysis = Field(default_factory=lambda: RepairOptionAnalysis(
        cost="$$ — Mid", life_extension="10-15 years", disruption="Low"
    ))
    option_replacement: RepairOptionAnalysis = Field(default_factory=lambda: RepairOptionAnalysis(
        cost="$$$ — High", life_extension="20-25 years", disruption="High"
    ))

    # ---- Capital Planning Forecast ----
    forecast_1yr: str = ""
    forecast_3yr: str = ""
    forecast_5yr: str = ""
    forecast_10yr: str = ""

    # ---- Recommended Roof Asset Plan™ ----
    budget_priority: str = "Moderate"  # "Low" | "Moderate" | "High" | "Immediate"
    immediate_actions: List[str] = Field(default_factory=list)
    near_term_actions: List[str] = Field(default_factory=list)
    long_term_actions: List[str] = Field(default_factory=list)

    # ---- SealTech Recommendation (checkboxes) ----
    rec_restoration_program: bool = False
    rec_repair_and_monitor: bool = False
    rec_partial_replacement: bool = False
    rec_full_replacement: bool = False
    rec_maintenance_program: bool = False
    rec_drainage_improvements: bool = False
    supporting_comments: str = ""

    # ---- Expected Outcome ----
    expected_outcomes: List[str] = Field(default_factory=lambda: [
        "Extend roof service life",
        "Improve waterproofing reliability",
        "Delay/Eliminate replacement costs",
        "Reduce future capital exposure",
        "Protect interior assets",
        "Renewable roof system",
    ])

    # ---- Conclusion ----
    conclusion: str = ""

    status: str = "Draft"  # "Draft" | "Final"


# ---------- Router ----------

def create_router(db, get_current_user) -> APIRouter:
    """All endpoints are auth-required. Email uses `assessments@` alias when available."""
    router = APIRouter(prefix="/assessments", tags=["Assessments"])

    async def _ensure(assessment_id: str) -> dict:
        doc = await db.assessments.find_one({"id": assessment_id, "is_deleted": {"$ne": True}}, {"_id": 0})
        if not doc:
            raise HTTPException(status_code=404, detail="Assessment not found")
        return doc

    # ---------- List ----------
    @router.get("")
    async def list_assessments(
        deal_id: Optional[str] = None,
        status: Optional[str] = None,
        limit: int = 100,
        _=Depends(get_current_user),
    ):
        q: dict = {"is_deleted": {"$ne": True}}
        if deal_id:
            q["deal_id"] = deal_id
        if status:
            q["status"] = status
        rows = await db.assessments.find(q, {"_id": 0}).sort("created_at", -1).to_list(min(limit, 500))
        # Hydrate deal title for table rendering
        deal_ids = list({r.get("deal_id") for r in rows if r.get("deal_id")})
        deal_titles: dict = {}
        if deal_ids:
            async for d in db.deals.find({"id": {"$in": deal_ids}}, {"_id": 0, "id": 1, "title": 1}):
                deal_titles[d["id"]] = d.get("title") or ""
        for r in rows:
            r["deal_title"] = deal_titles.get(r.get("deal_id"), "")
        return rows

    # ---------- Get ----------
    @router.get("/{assessment_id}")
    async def get_assessment(assessment_id: str, _=Depends(get_current_user)):
        return await _ensure(assessment_id)

    # ---------- Create ----------
    @router.post("")
    async def create_assessment(body: AssessmentIn, current=Depends(get_current_user)):
        # If linked to a deal, snapshot some defaults so the cover prefills
        if body.deal_id and not body.property_address:
            deal = await db.deals.find_one({"id": body.deal_id}, {"_id": 0})
            if deal:
                body.property_address = deal.get("property_address", "") or body.property_address
                body.property_name = deal.get("property_name", "") or deal.get("title", "") or body.property_name
                # Pull contact if not supplied
                if not body.contact_id and deal.get("contact_id"):
                    body.contact_id = deal["contact_id"]
        # Hydrate prepared_for from contact
        if body.contact_id and not body.prepared_for:
            c = await db.contacts.find_one({"id": body.contact_id}, {"_id": 0})
            if c:
                body.prepared_for = c.get("company_name") or c.get("contact_name") or ""

        if not body.assessment_date:
            body.assessment_date = datetime.now(timezone.utc).date().isoformat()

        doc = body.model_dump()
        doc["id"] = str(uuid.uuid4())
        doc["created_at"] = datetime.now(timezone.utc).isoformat()
        doc["created_by_user_id"] = current.get("id")
        doc["created_by_name"] = current.get("name") or current.get("email", "")
        doc["is_deleted"] = False
        await db.assessments.insert_one(doc.copy())
        doc.pop("_id", None)
        return doc

    # ---------- Update ----------
    @router.put("/{assessment_id}")
    async def update_assessment(assessment_id: str, body: AssessmentIn, current=Depends(get_current_user)):
        await _ensure(assessment_id)
        patch = body.model_dump()
        patch["updated_at"] = datetime.now(timezone.utc).isoformat()
        patch["updated_by_user_id"] = current.get("id")
        # Preserve immutables
        for k in ("id", "created_at", "created_by_user_id", "created_by_name", "is_deleted"):
            patch.pop(k, None)
        await db.assessments.update_one({"id": assessment_id}, {"$set": patch})
        return await db.assessments.find_one({"id": assessment_id}, {"_id": 0})

    # ---------- Finalize ----------
    @router.post("/{assessment_id}/finalize")
    async def finalize_assessment(assessment_id: str, current=Depends(get_current_user)):
        await _ensure(assessment_id)
        await db.assessments.update_one(
            {"id": assessment_id},
            {"$set": {
                "status": "Final",
                "finalized_at": datetime.now(timezone.utc).isoformat(),
                "finalized_by_user_id": current.get("id"),
            }},
        )
        return await db.assessments.find_one({"id": assessment_id}, {"_id": 0})

    # ---------- Soft-delete ----------
    @router.delete("/{assessment_id}")
    async def delete_assessment(assessment_id: str, current=Depends(get_current_user)):
        await _ensure(assessment_id)
        await db.assessments.update_one(
            {"id": assessment_id},
            {"$set": {
                "is_deleted": True,
                "deleted_at": datetime.now(timezone.utc).isoformat(),
                "deleted_by_user_id": current.get("id"),
            }},
        )
        return {"ok": True, "id": assessment_id}

    # ---------- PDF ----------
    @router.get("/{assessment_id}/pdf")
    async def get_assessment_pdf(assessment_id: str, _=Depends(get_current_user)):
        doc = await _ensure(assessment_id)
        from assessment_pdf import build_assessment_pdf
        pdf_bytes = await build_assessment_pdf(db, doc)
        property_label = (doc.get("property_name") or doc.get("property_address") or "assessment").replace(" ", "_")
        filename = f"sealtech-assessment-{property_label[:40]}.pdf"
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": f'inline; filename="{filename}"'},
        )

    # ---------- Email ----------
    @router.post("/{assessment_id}/email")
    async def email_assessment(
        assessment_id: str,
        body: dict = Body(default={}),
        current=Depends(get_current_user),
    ):
        doc = await _ensure(assessment_id)
        to = (body.get("to") or "").strip()
        if not to:
            # Default to linked contact's email
            if doc.get("contact_id"):
                c = await db.contacts.find_one({"id": doc["contact_id"]}, {"_id": 0})
                if c:
                    to = c.get("email", "")
        if not to:
            raise HTTPException(status_code=400, detail="Recipient email is required (or link a contact first)")

        from assessment_pdf import build_assessment_pdf
        pdf_bytes = await build_assessment_pdf(db, doc)
        property_label = (doc.get("property_name") or doc.get("property_address") or "assessment").replace(" ", "_")
        filename = f"sealtech-assessment-{property_label[:40]}.pdf"

        subject = body.get("subject") or f"Commercial Roof Assessment Report — {doc.get('property_name') or doc.get('property_address') or ''}".strip()
        body_text = body.get("message") or (
            f"Hello,\n\nAttached is the Commercial Roof Assessment Report for "
            f"{doc.get('property_name') or doc.get('property_address') or 'your property'}.\n\n"
            "Please review at your convenience. We're happy to walk through the findings on a call.\n\n"
            "Best regards,\nSealTech Building Solutions\n720-715-9955  ·  assessments@sealtechsolutions.co"
        )

        from email_sender import send_email, get_from_aliases
        aliases = get_from_aliases()
        preferred = "assessments@sealtechsolutions.co"
        from_email = preferred if preferred in aliases else (aliases[0] if aliases else None)
        try:
            send_email(
                to=to,
                subject=subject,
                body_text=body_text,
                attachments=[{"filename": filename, "data": pdf_bytes, "mime": "application/pdf"}],
                from_email=from_email,
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Email send failed: {type(e).__name__}: {e}")

        # Log
        await db.assessments.update_one(
            {"id": assessment_id},
            {"$push": {"email_log": {
                "to": to, "subject": subject, "from": from_email or "",
                "sent_at": datetime.now(timezone.utc).isoformat(),
                "sent_by_user_id": current.get("id"),
            }}},
        )
        return {"ok": True, "to": to, "from": from_email}

    return router


def ensure_indexes_sync_task(db):
    """Async helper to add indexes — called from startup hook."""
    async def _go():
        await db.assessments.create_index("id", unique=True)
        await db.assessments.create_index("deal_id")
        await db.assessments.create_index("status")
        await db.assessments.create_index("created_at")
    return _go
