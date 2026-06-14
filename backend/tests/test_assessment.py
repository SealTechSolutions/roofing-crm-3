"""Assessment Reports — backend integration tests.

Covers full CRUD lifecycle + PDF generation + finalize + soft delete.
"""
import os
import uuid

import requests

API_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://roofing-crm-3.preview.emergentagent.com").rstrip("/")
API = f"{API_URL}/api"
ADMIN = {"email": "admin@roofingcrm.com", "password": "admin123"}


def _login() -> dict:
    r = requests.post(f"{API}/auth/login", json=ADMIN, timeout=15)
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_assessment_crud_lifecycle():
    h = _login()
    body = {
        "property_name": f"TEST_ASSESS_{uuid.uuid4().hex[:6]}",
        "property_address": "1234 Test Way, Denver CO 80216",
        "prepared_for": "Test Co.",
        "executive_conclusion": "Roof in fair condition; restoration recommended.",
        "overall_recommendation": "Proceed with restoration",
        "condition_rating": {"score": 72, "reasoning": "Moderate wear"},
        "remaining_service_life": {"score": 58, "reasoning": "5-7 years"},
        "restoration_suitability": {"score": 85, "reasoning": "Membrane sound"},
        "capital_risk": {"score": 65, "reasoning": "Moderate"},
        "primary_concerns": ["Concern A", "Concern B"],
        "positive_findings": ["Positive 1"],
        "budget_priority": "High",
    }
    r = requests.post(f"{API}/assessments", json=body, headers=h, timeout=20)
    assert r.status_code == 200, r.text
    a = r.json()
    aid = a["id"]
    assert a["status"] == "Draft"
    assert a["property_name"] == body["property_name"]
    assert a["condition_rating"]["score"] == 72
    assert a["assessment_date"]  # auto-filled

    try:
        # List
        r2 = requests.get(f"{API}/assessments", headers=h, timeout=10)
        assert r2.status_code == 200
        assert any(x["id"] == aid for x in r2.json())

        # Get
        r3 = requests.get(f"{API}/assessments/{aid}", headers=h, timeout=10)
        assert r3.status_code == 200
        assert len(r3.json()["primary_concerns"]) == 2

        # Update
        upd = {**body, "executive_conclusion": "UPDATED conclusion", "primary_concerns": ["A", "B", "C"]}
        r4 = requests.put(f"{API}/assessments/{aid}", json=upd, headers=h, timeout=15)
        assert r4.status_code == 200
        assert r4.json()["executive_conclusion"] == "UPDATED conclusion"
        assert len(r4.json()["primary_concerns"]) == 3

        # PDF
        r5 = requests.get(f"{API}/assessments/{aid}/pdf", headers=h, timeout=30)
        assert r5.status_code == 200
        assert r5.content.startswith(b"%PDF-")
        assert len(r5.content) > 5000  # non-trivial PDF size

        # Finalize
        r6 = requests.post(f"{API}/assessments/{aid}/finalize", headers=h, timeout=10)
        assert r6.status_code == 200
        assert r6.json()["status"] == "Final"
        assert r6.json().get("finalized_at")

        # List filter by status
        r7 = requests.get(f"{API}/assessments?status=Final", headers=h, timeout=10)
        assert any(x["id"] == aid for x in r7.json())
    finally:
        rd = requests.delete(f"{API}/assessments/{aid}", headers=h, timeout=10)
        assert rd.status_code == 200
        # No longer in active list
        r8 = requests.get(f"{API}/assessments", headers=h, timeout=10)
        assert all(x["id"] != aid for x in r8.json())


def test_assessment_pdf_contains_key_fields():
    """Generate PDF and verify embedded text via pypdf."""
    from pypdf import PdfReader
    import io
    h = _login()
    marker = f"PDFMARKER_{uuid.uuid4().hex[:8].upper()}"
    body = {
        "property_name": marker,
        "property_address": "555 Roof St, Denver CO",
        "prepared_for": "PDF Test LLC",
        "executive_conclusion": "DistinctiveExecConclusionXyz",
        "condition_rating": {"score": 73, "reasoning": "Moderate"},
        "restoration_suitability_rating": "High",
        "primary_concerns": ["UniqueConcernZeta"],
    }
    a = requests.post(f"{API}/assessments", json=body, headers=h, timeout=20).json()
    aid = a["id"]
    try:
        pdf = requests.get(f"{API}/assessments/{aid}/pdf", headers=h, timeout=30).content
        r = PdfReader(io.BytesIO(pdf))
        assert len(r.pages) >= 8, f"Expected 8+ pages got {len(r.pages)}"
        all_text = "\n".join(p.extract_text() or "" for p in r.pages)
        assert marker in all_text
        assert "DistinctiveExecConclusionXyz" in all_text
        assert "UniqueConcernZeta" in all_text
        # Score interpretation table should be present
        assert "INTERPRETATION" in all_text or "Interpretation" in all_text
    finally:
        requests.delete(f"{API}/assessments/{aid}", headers=h, timeout=10)


def test_assessment_linked_deal_hydration():
    """Creating an assessment with a deal_id should hydrate property_address from the deal."""
    h = _login()
    # Find any non-deleted deal
    deals = requests.get(f"{API}/deals", headers=h, timeout=10).json()
    if not deals:
        return  # no deals → skip silently
    deal = deals[0]
    body = {
        "deal_id": deal["id"],
        "prepared_for": "Linked Test",
    }
    a = requests.post(f"{API}/assessments", json=body, headers=h, timeout=15).json()
    try:
        # property_address should be populated from deal if deal had one
        if deal.get("property_address"):
            assert a["property_address"] == deal["property_address"]
        # list filtered by deal_id
        r = requests.get(f"{API}/assessments?deal_id={deal['id']}", headers=h, timeout=10).json()
        assert any(x["id"] == a["id"] for x in r)
        # deal_title hydration in list
        listed = [x for x in r if x["id"] == a["id"]][0]
        if deal.get("title"):
            assert listed.get("deal_title") == deal["title"]
    finally:
        requests.delete(f"{API}/assessments/{a['id']}", headers=h, timeout=10)


def test_convert_assessment_to_scope_full_flow():
    """End-to-end: create deal → create assessment with full findings → convert → verify
    deal's scope fields populated with structured content from the assessment."""
    h = _login()
    # Create dedicated deal
    deal_body = {"title": f"CONVERT_TEST_{uuid.uuid4().hex[:6]}", "project_type": "Repair", "proposed_roof_type": "TPO"}
    deal = requests.post(f"{API}/deals", json=deal_body, headers=h, timeout=15).json()
    did = deal["id"]
    # Create assessment with rich data + restoration recommendation
    a_body = {
        "deal_id": did,
        "property_name": "Test Plaza",
        "property_address": "777 Plaza Way",
        "square_footage": 30000,
        "rec_restoration_program": True,
        "recommended_strategy": "Restore membrane and improve drainage",
        "immediate_actions": ["Stop active leaks", "Clean entire surface"],
        "near_term_actions": ["Annual inspection"],
        "long_term_actions": ["Re-coat in year 10"],
        "finding_r1": {"component": "Roof Membrane", "recommendation": "Apply silicone restoration"},
        "finding_r2": {"component": "Flashings", "recommendation": "Re-flash all penetrations"},
        "finding_r3": {"component": "Penetrations", "observations": "23 penetrations need attention"},
        "finding_r4": {"component": "Drainage", "recommendation": "Add 4 scuppers"},
        "finding_r5": {"component": "Equipment", "recommendation": "Re-set HVAC curbs"},
    }
    a = requests.post(f"{API}/assessments", json=a_body, headers=h, timeout=15).json()
    aid = a["id"]
    try:
        # Convert
        r = requests.post(f"{API}/assessments/{aid}/convert-to-scope", json={}, headers=h, timeout=15)
        assert r.status_code == 200, r.text
        result = r.json()
        assert result["ok"] is True
        assert result["deal_id"] == did
        assert result["recommended_label"] == "Restoration"
        assert result["other_requirements_lines"] == 5  # all 5 findings have content
        assert result["project_requirements_lines"] >= 3  # strategy + 2 immediate + 1 near-term

        # Verify deal was updated
        updated_deal = requests.get(f"{API}/deals/{did}", headers=h, timeout=10).json()
        assert updated_deal["proposed_roof_type"] == "Construction Project"
        assert "Restoration Scope" in updated_deal["construction_scope_subtitle"]
        assert "Test Plaza" in updated_deal["construction_scope_subtitle"]
        assert updated_deal["project_type_override"] == "Restoration"
        assert updated_deal["property_sqft"] == 30000.0
        # PR contains immediate + near-term actions
        pr = updated_deal["construction_project_requirements"]
        assert "Stop active leaks" in pr
        assert "Annual inspection" in pr
        assert "Restore membrane" in pr
        # Other Reqs contains R-1..R-5
        other = updated_deal["construction_other_requirements"]
        assert "Apply silicone restoration" in other
        assert "Re-flash all penetrations" in other
        assert "Add 4 scuppers" in other
        # R-3 used observations fallback
        assert "23 penetrations" in other
        # Exclusions contains long-term + standard
        excl = updated_deal["construction_exclusions"]
        assert "Re-coat in year 10" in excl
        assert "Structural repairs" in excl

        # Assessment was stamped with converted_at
        a2 = requests.get(f"{API}/assessments/{aid}", headers=h, timeout=10).json()
        assert a2.get("converted_to_scope_at")
    finally:
        requests.delete(f"{API}/assessments/{aid}", headers=h, timeout=10)
        requests.delete(f"{API}/deals/{did}", headers=h, timeout=10)


def test_convert_requires_linked_deal():
    """Convert without a linked deal must 400."""
    h = _login()
    a = requests.post(f"{API}/assessments", json={"property_name": f"NO_DEAL_{uuid.uuid4().hex[:6]}"}, headers=h, timeout=15).json()
    try:
        r = requests.post(f"{API}/assessments/{a['id']}/convert-to-scope", json={}, headers=h, timeout=10)
        assert r.status_code == 400
        assert "deal" in r.json()["detail"].lower()
    finally:
        requests.delete(f"{API}/assessments/{a['id']}", headers=h, timeout=10)


def test_convert_picks_correct_recommendation_label():
    """Verify the recommended_label resolver picks the right option based on checkboxes."""
    h = _login()
    deal = requests.post(f"{API}/deals", json={"title": f"REC_PICK_{uuid.uuid4().hex[:6]}"}, headers=h, timeout=15).json()
    did = deal["id"]
    test_cases = [
        ({"rec_full_replacement": True}, "Full Replacement"),
        ({"rec_partial_replacement": True}, "Partial Replacement"),
        ({"rec_repair_and_monitor": True}, "Repair & Maintenance"),
        ({"rec_drainage_improvements": True}, "Drainage Improvements"),
        ({}, "Roof Restoration Program"),  # no checkbox → fallback
    ]
    try:
        for rec_patch, expected_label in test_cases:
            a = requests.post(f"{API}/assessments", json={"deal_id": did, "property_name": "Recheck", **rec_patch}, headers=h, timeout=15).json()
            r = requests.post(f"{API}/assessments/{a['id']}/convert-to-scope", json={}, headers=h, timeout=10).json()
            assert r["recommended_label"] == expected_label, f"For patch {rec_patch}, got {r['recommended_label']} expected {expected_label}"
            requests.delete(f"{API}/assessments/{a['id']}", headers=h, timeout=10)
    finally:
        requests.delete(f"{API}/deals/{did}", headers=h, timeout=10)
