"""SealTech-branded spec sheet / scope generator with per-roof-type templates.

Public API:
    build_spec_sheet(data, cover_photo_bytes=None, roof_type=None) -> bytes
    build_silicone_spec(data, cover_photo_bytes=None)  # back-compat alias
"""
import os
from io import BytesIO
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, Image
from reportlab.platypus.flowables import KeepTogether

LOGO_PATH = os.path.join(os.path.dirname(__file__), "assets", "sealtech-logo.png")


BLUE = colors.HexColor("#1D4ED8")
BRONZE = colors.HexColor("#A0703A")
ORANGE = BRONZE  # back-compat alias — brand accent is bronze, not orange
DARK = colors.HexColor("#0A0A0A")
GRAY = colors.HexColor("#52525B")
LIGHT = colors.HexColor("#F4F4F5")
BORDER = colors.HexColor("#E4E4E7")


def _styles():
    return {
        "title": ParagraphStyle("title", fontName="Helvetica-Bold", fontSize=20, textColor=DARK, leading=24, spaceAfter=4),
        "eyebrow": ParagraphStyle("eyebrow", fontName="Helvetica-Bold", fontSize=8, textColor=ORANGE, leading=10, spaceAfter=2),
        "h2": ParagraphStyle("h2", fontName="Helvetica-Bold", fontSize=12, textColor=BLUE, leading=15, spaceBefore=4, spaceAfter=4),
        "body": ParagraphStyle("body", fontName="Helvetica", fontSize=10, textColor=DARK, leading=12),
        "small": ParagraphStyle("small", fontName="Helvetica", fontSize=8, textColor=GRAY, leading=10),
        "bold": ParagraphStyle("bold", fontName="Helvetica-Bold", fontSize=9, textColor=DARK, leading=12),
        "tc": ParagraphStyle("tc", fontName="Helvetica", fontSize=11, textColor=DARK, leading=14, spaceAfter=8),
        "tc_h": ParagraphStyle("tch", fontName="Helvetica-Bold", fontSize=11, textColor=DARK, leading=14, spaceBefore=4),
        "tc_intro": ParagraphStyle("tc_intro", fontName="Helvetica-Bold", fontSize=10, textColor=DARK, leading=13, spaceAfter=8),
    }


def _currency(v):
    try:
        return "${:,.0f}".format(float(v or 0))
    except Exception:
        return "$0"


# ---------------------------------------------------------------------------
#  Per-roof-type scope templates
# ---------------------------------------------------------------------------
#  Each entry defines the document title and the two scope blocks shown on
#  page 2 ("Inspection / Assessment" and "Installation / Restoration"). The
#  third block, Inclusions, is always built from the project's total_sqft +
#  color + roof_type_label.
# ---------------------------------------------------------------------------

# Generic exclusions shared across all templates
EXCLUSIONS = [
    "Permit fees (if required by jurisdiction).",
    "Heavy equipment (not foreseen for this project).",
    "Structural deck repairs beyond minor patching.",
    "Removal/disposal of pre-existing hazardous materials.",
    "Work outside the defined scope or roof area.",
]


SILICONE_TEMPLATE = {
    "title": "RESTORATION ROOF SCOPE",
    "spread_page_2": True,  # Silicone scopes have fewer bullets; spread page 2 to fill the sheet
    "scope_1_title": "Inspection and Repairs",
    "scope_1": [
        "Inspect the roof for existing leaks, deterioration, and overall substrate condition.",
        "Identify and document any membrane separations, blisters, ponding, and seam failures.",
        "Cut, patch, and repair damaged areas of the existing single-ply membrane as required.",
        "Re-seal seams, flashings, and penetrations to provide a sound substrate.",
        "Verify drains, scuppers, and edge metal are functional and watertight.",
    ],
    "scope_2_title": "Substrate Preparation and Coating",
    "scope_2": [
        "Power-wash the entire roof surface to remove all dirt, oxidation, and loose debris.",
        "Allow substrate to fully dry before application.",
        "Apply manufacturer-approved primer where required.",
        "Apply base coat of silicone roof coating to manufacturer's specified mil thickness.",
        "Reinforce all seams, fasteners, and penetrations with polyester fabric set in silicone.",
        "Apply top coat of silicone with embedded protective granules over walls and field as specified.",
        "Final walk-through and quality inspection with the owner or owner's representative.",
    ],
}

TPO_OVERLAY_TEMPLATE = {
    "title": "TPO OVER-LAY ROOF SYSTEM SCOPE",
    "scope_1_title": "Inspection and Prep",
    "scope_1": [
        "Survey existing roof assembly and document deck condition, slope, and drainage.",
        "Remove loose debris, clean the existing TPO surface thoroughly.",
        "Remove and replace deteriorated flashings, pitch pans, vents, and penetrations as needed.",
        "Secure loose existing membrane.",
    ],
    "scope_2_title": "TPO Membrane Installation",
    "scope_2": [
        "Install cover board and/or insulation overlay (e.g., mechanically fastened polyiso) over the existing membrane for a smooth durable substrate.",
        "Install 60-mil TPO membrane — fully adhered, mechanically attached, or RhinoBond per project specification.",
        "Heat-weld all seams with calibrated hot-air welder; probe-test 100% of seams after cooling.",
        "Detail all penetrations, curbs, parapets, and transitions with manufacturer-approved flashings, pipe boots, and termination bars.",
        "Install splice plates and target patches at all T-joints, drains, and irregular conditions.",
        "Ensure proper integration with existing or new metal flashings (e.g., coping caps, drip edges).",
        "Remove and properly dispose of all debris from the property.",
        "Final walk-through, water-test drains, and quality inspection with the owner.",
    ],
}

TPO_REPLACEMENT_TEMPLATE = {
    "title": "TPO ROOF SYSTEM SCOPE",
    "scope_1_title": "Inspection and Tear-Off / Prep",
    "scope_1": [
        "Survey existing roof assembly and document deck condition, slope, and drainage.",
        "Identify wet insulation by infrared and/or core cuts; quantify replacement areas.",
        "Remove existing membrane, insulation, flashings, base sheets, edge metal, copings, penetrations, and accessories down to the structural deck.",
        "Remove fasteners and clean the deck of debris, adhesives, or contaminants.",
        "Inspect and repair/replace damaged decking, wood blocking, or nailers; secure loose deck panels.",
        "Replace any deteriorated decking with new plywood or steel deck as needed.",
        "Remove and properly dispose of all debris from the property.",
    ],
    "scope_2_title": "TPO Membrane Installation",
    "scope_2": [
        "Install ISO insulation to achieve specified R-value, mechanically attached or fully adhered per manufacturer.",
        "Install ½\" high-density cover board over insulation to provide a smooth, durable substrate.",
        "Install 60-mil TPO membrane — fully adhered, mechanically attached, or RhinoBond per project specification.",
        "Heat-weld all seams with calibrated hot-air welder; probe-test 100% of seams after cooling.",
        "Install new code-required metal drip edge, gravel stop, and termination bar at all perimeters.",
        "Flash all penetrations, curbs, walls, and corners with pre-formed or field-fabricated TPO accessories.",
        "Final walk-through, water-test drains, and quality inspection with the owner.",
    ],
}

EPDM_OVERLAY_TEMPLATE = {
    "title": "EPDM OVER-LAY ROOF SYSTEM SCOPE",
    "scope_1_title": "Inspection and Prep",
    "scope_1": [
        "Survey existing roof assembly and document deck condition, slope, and drainage.",
        "Remove loose debris, clean the existing membrane thoroughly.",
        "Remove and replace deteriorated flashings, pitch pans, vents, and penetrations as needed.",
        "Cut, patch, and repair open seams, splits, and damaged areas of the existing membrane.",
        "Secure loose existing membrane.",
    ],
    "scope_2_title": "EPDM Membrane Installation",
    "scope_2": [
        "Install cover board (e.g., ½\" high-density gypsum or wood fiber) mechanically fastened over the existing membrane for a smooth, durable substrate.",
        "Install 60-mil EPDM membrane — fully adhered with bonding adhesive or mechanically attached per project specification.",
        "Splice all seams with factory-applied seam tape and EPDM splice primer; roll all laps with steel roller.",
        "Install pre-formed pipe boots, inside/outside corners, and uncured EPDM flashing at irregular penetrations.",
        "Terminate membrane at walls and curbs with termination bar, water cut-off mastic, and counter-flashing.",
        "Install new metal edge, drip edge, and gravel stop per SPRI ES-1 requirements.",
        "Remove and properly dispose of all debris from the property.",
        "Final walk-through, water-test drains, and quality inspection with the owner.",
        "NOTE: Manufacturer system warranties typically require tear-off — confirm warranty eligibility prior to acceptance.",
    ],
}

EPDM_REPLACEMENT_TEMPLATE = {
    "title": "EPDM ROOF SYSTEM SCOPE",
    "scope_1_title": "Inspection and Tear-Off / Prep",
    "scope_1": [
        "Survey existing roof assembly and document deck condition, slope, and drainage.",
        "Identify wet insulation by infrared and/or core cuts; quantify replacement areas.",
        "Remove existing membrane, insulation, flashings, base sheets, edge metal, copings, penetrations, and accessories down to the structural deck.",
        "Remove fasteners and clean the deck of debris, adhesives, or contaminants.",
        "Inspect and repair/replace damaged decking, wood blocking, or nailers; secure loose deck panels.",
        "Replace any deteriorated decking with new plywood or steel deck as needed.",
        "Remove and properly dispose of all debris from the property.",
    ],
    "scope_2_title": "EPDM Membrane Installation",
    "scope_2": [
        "Install ISO insulation to achieve specified R-value, mechanically attached or fully adhered per manufacturer.",
        "Install ½\" high-density cover board over insulation to provide a smooth, durable substrate.",
        "Install 60-mil EPDM membrane — fully adhered with bonding adhesive, mechanically attached, or ballasted per project specification.",
        "Splice all seams with factory-applied seam tape and EPDM splice primer; roll all laps with steel roller.",
        "Install pre-formed pipe boots, inside/outside corners, and uncured EPDM flashing at irregular penetrations.",
        "Terminate membrane at walls and curbs with termination bar, water cut-off mastic, and counter-flashing.",
        "Install new code-required metal drip edge, gravel stop, and termination bar at all perimeters.",
        "Final walk-through, water-test drains, and quality inspection with the owner.",
    ],
}

MODBIT_OVERLAY_TEMPLATE = {
    "title": "MODIFIED BITUMEN OVER-LAY ROOF SYSTEM SCOPE",
    "scope_1_title": "Inspection and Prep",
    "scope_1": [
        "Survey existing roof assembly and document deck condition, slope, and drainage.",
        "Power-clean existing surface; remove loose granules, debris, and contamination.",
        "Cut, patch, and repair blisters, splits, and damaged areas of the existing membrane.",
        "Remove and replace deteriorated flashings, pitch pans, vents, and penetrations as needed.",
        "Apply manufacturer-approved primer or bleed-blocking coat over the existing surface.",
    ],
    "scope_2_title": "Modified Bitumen Over-Lay Installation",
    "scope_2": [
        "Install SBS or APP modified bitumen base ply directly over the primed existing surface — mechanically fastened, torch-applied, or cold-process adhered per spec.",
        "Install granulated SBS or APP modified bitumen cap sheet, fully bonded and offset from base ply laps.",
        "Heat-weld or cold-bond all end and side laps; broom-in and inspect for full bleed-out.",
        "Flash all penetrations, walls, and curbs with two-ply modified bitumen flashings terminated with metal counter-flashing.",
        "Install new pitch pans filled with two-part urethane sealant where required.",
        "Install new metal drip edge, gravel stop, and gutter line metal as specified.",
        "Remove and properly dispose of all debris from the property.",
        "Final walk-through, water-test drains, and quality inspection with the owner.",
    ],
}

MODBIT_REPLACEMENT_TEMPLATE = {
    "title": "MODIFIED BITUMEN ROOF SYSTEM SCOPE",
    "scope_1_title": "Inspection and Tear-Off / Prep",
    "scope_1": [
        "Survey existing roof assembly and document deck condition, slope, and drainage.",
        "Identify wet insulation by infrared and/or core cuts; quantify replacement areas.",
        "Remove existing cap sheet, ply membrane, insulation, flashings, base sheets, edge metal, copings, penetrations, and accessories down to the structural deck.",
        "Remove fasteners and clean the deck of debris, adhesives, or contaminants.",
        "Inspect and repair/replace damaged decking, wood blocking, or nailers with new like-for-like material; secure loose deck panels.",
        "Remove and properly dispose of all debris from the property.",
    ],
    "scope_2_title": "Modified Bitumen System Installation",
    "scope_2": [
        "Install ISO insulation to achieve specified R-value, mechanically attached or hot-asphalt-adhered per manufacturer.",
        "Install ½\" high-density cover board over insulation to provide a smooth, durable substrate.",
        "Install SBS or APP modified bitumen base ply per project specification (mechanically attached, torch-applied, cold-process, or self-adhered).",
        "Install granulated SBS or APP modified bitumen cap sheet, fully bonded with offset laps.",
        "Heat-weld or cold-bond all end and side laps; broom-in and inspect for full bleed-out.",
        "Flash all penetrations, walls, and curbs with two-ply modified bitumen flashings and metal counter-flashing; install new pitch pans filled with two-part urethane sealant where required.",
        "Install new code-required metal drip edge, gravel stop, and termination bar at all perimeters.",
        "Final walk-through, water-test drains, and quality inspection with the owner.",
    ],
}

PVC_OVERLAY_TEMPLATE = {
    "title": "PVC OVER-LAY ROOF SYSTEM SCOPE",
    "scope_1_title": "Inspection and Prep",
    "scope_1": [
        "Survey existing roof assembly and document deck condition, slope, and drainage.",
        "Remove loose debris, clean the existing single-ply surface thoroughly.",
        "Remove and replace deteriorated flashings, pitch pans, vents, and penetrations as needed.",
        "Secure loose existing membrane.",
    ],
    "scope_2_title": "PVC Membrane Installation",
    "scope_2": [
        "Install cover board and/or insulation overlay (e.g., mechanically fastened polyiso) over the existing membrane for a smooth, durable substrate.",
        "Install 60-mil PVC membrane — fully adhered, mechanically attached, or RhinoBond per project specification.",
        "Heat-weld all seams with calibrated hot-air welder; probe-test 100% of seams after cooling.",
        "Detail all penetrations, curbs, parapets, and transitions with manufacturer-approved PVC flashings, pipe boots, and termination bars.",
        "Install splice plates and target patches at all T-joints, drains, and irregular conditions.",
        "Ensure proper integration with existing or new PVC-coated metal flashings (e.g., coping caps, drip edges).",
        "Remove and properly dispose of all debris from the property.",
        "Final walk-through, water-test drains, and quality inspection with the owner.",
    ],
}

PVC_REPLACEMENT_TEMPLATE = {
    "title": "PVC ROOF SYSTEM SCOPE",
    "scope_1_title": "Inspection and Tear-Off / Prep",
    "scope_1": [
        "Survey existing roof assembly and document deck condition, slope, and drainage.",
        "Identify wet insulation by infrared and/or core cuts; quantify replacement areas.",
        "Remove existing membrane, insulation, flashings, base sheets, edge metal, copings, penetrations, and accessories down to the structural deck.",
        "Remove fasteners and clean the deck of debris, adhesives, or contaminants.",
        "Inspect and repair/replace damaged decking, wood blocking, or nailers; secure loose deck panels.",
        "Replace any deteriorated decking with new plywood or steel deck as needed.",
        "Remove and properly dispose of all debris from the property.",
    ],
    "scope_2_title": "PVC Membrane Installation",
    "scope_2": [
        "Install ISO insulation to achieve specified R-value, mechanically attached or fully adhered per manufacturer.",
        "Install ½\" high-density cover board over insulation to provide a smooth, durable substrate.",
        "Install 60-mil PVC membrane — fully adhered, mechanically attached, or RhinoBond per project specification.",
        "Heat-weld all seams with calibrated hot-air welder; probe-test 100% of seams after cooling.",
        "Install new code-required PVC-coated metal drip edge, gravel stop, and termination bar at all perimeters.",
        "Flash all penetrations, curbs, walls, and corners with pre-formed or field-fabricated PVC accessories.",
        "Final walk-through, water-test drains, and quality inspection with the owner.",
    ],
}

# ---------------------------------------------------------------------------
#  New Construction templates — no existing roof to tear off or overlay
# ---------------------------------------------------------------------------
TPO_NEW_CONSTRUCTION_TEMPLATE = {
    "title": "TPO NEW CONSTRUCTION SYSTEM SCOPE",
    "scope_1_title": "Inspection and Prep",
    "scope_1": [
        "Verify structural deck condition, slope, and drainage prior to installation.",
        "Inspect and repair/replace damaged decking, wood blocking, or nailers; secure loose deck panels.",
        "Clean deck of construction debris, dust, and contaminants.",
        "Confirm placement of drains, scuppers, curbs, and penetrations per plan.",
        "Remove and properly dispose of all debris from the property.",
    ],
    "scope_2_title": "TPO Membrane Installation",
    "scope_2": [
        "Install vapor retarder where required by spec or climate zone.",
        "Install ISO insulation to achieve specified R-value, mechanically attached or fully adhered per manufacturer.",
        "Install ½\" high-density cover board over insulation to provide a smooth, durable substrate.",
        "Install 60-mil TPO membrane — fully adhered, mechanically attached, or RhinoBond per project specification.",
        "Heat-weld all seams with calibrated hot-air welder; probe-test 100% of seams after cooling.",
        "Install new code-required metal drip edge, gravel stop, and termination bar at all perimeters.",
        "Flash all penetrations, curbs, walls, and corners with pre-formed or field-fabricated TPO accessories.",
        "Final walk-through, water-test drains, and quality inspection with the owner.",
    ],
}

EPDM_NEW_CONSTRUCTION_TEMPLATE = {
    "title": "EPDM NEW CONSTRUCTION SYSTEM SCOPE",
    "scope_1_title": "Inspection and Prep",
    "scope_1": [
        "Verify structural deck condition, slope, and drainage prior to installation.",
        "Inspect and repair/replace damaged decking, wood blocking, or nailers; secure loose deck panels.",
        "Clean deck of construction debris, dust, and contaminants.",
        "Confirm placement of drains, scuppers, curbs, and penetrations per plan.",
        "Remove and properly dispose of all debris from the property.",
    ],
    "scope_2_title": "EPDM Membrane Installation",
    "scope_2": [
        "Install vapor retarder where required by spec or climate zone.",
        "Install ISO insulation to achieve specified R-value, plus ½\" high-density cover board, fully adhered or mechanically attached.",
        "Install 60-mil EPDM membrane — fully adhered with bonding adhesive, mechanically attached, or ballasted per project specification.",
        "Splice all seams with factory-applied seam tape and EPDM splice primer; roll all laps with steel roller.",
        "Install pre-formed pipe boots, inside/outside corners, and uncured EPDM flashing; terminate at walls with termination bar, cut-off mastic, and counter-flashing.",
        "Install new code-required metal drip edge, gravel stop, and termination bar at all perimeters.",
        "Final walk-through, water-test drains, and quality inspection with the owner.",
    ],
}

MODBIT_NEW_CONSTRUCTION_TEMPLATE = {
    "title": "MODIFIED BITUMEN NEW CONSTRUCTION SYSTEM SCOPE",
    "scope_1_title": "Inspection and Prep",
    "scope_1": [
        "Verify structural deck condition, slope, and drainage prior to installation.",
        "Inspect and repair/replace damaged decking, wood blocking, or nailers; secure loose deck panels.",
        "Clean deck of construction debris, dust, and contaminants.",
        "Confirm placement of drains, scuppers, curbs, and penetrations per plan.",
        "Remove and properly dispose of all debris from the property.",
    ],
    "scope_2_title": "Modified Bitumen System Installation",
    "scope_2": [
        "Install ISO insulation to achieve specified R-value, mechanically attached or hot-asphalt-adhered per manufacturer.",
        "Install ½\" high-density cover board over insulation to provide a smooth, durable substrate.",
        "Install SBS or APP modified bitumen base ply per project specification (mechanically attached, torch-applied, cold-process, or self-adhered).",
        "Install granulated SBS or APP modified bitumen cap sheet, fully bonded with offset laps.",
        "Heat-weld or cold-bond all end and side laps; broom-in and inspect for full bleed-out.",
        "Flash all penetrations, walls, and curbs with two-ply modified bitumen flashings and metal counter-flashing; install new pitch pans filled with two-part urethane sealant where required.",
        "Install new code-required metal drip edge, gravel stop, and termination bar at all perimeters.",
        "Final walk-through, water-test drains, and quality inspection with the owner.",
    ],
}

PVC_NEW_CONSTRUCTION_TEMPLATE = {
    "title": "PVC NEW CONSTRUCTION SYSTEM SCOPE",
    "scope_1_title": "Inspection and Prep",
    "scope_1": [
        "Verify structural deck condition, slope, and drainage prior to installation.",
        "Inspect and repair/replace damaged decking, wood blocking, or nailers; secure loose deck panels.",
        "Clean deck of construction debris, dust, and contaminants.",
        "Confirm placement of drains, scuppers, curbs, and penetrations per plan.",
        "Remove and properly dispose of all debris from the property.",
    ],
    "scope_2_title": "PVC Membrane Installation",
    "scope_2": [
        "Install vapor retarder where required by spec or climate zone.",
        "Install ISO insulation to achieve specified R-value, mechanically attached or fully adhered per manufacturer.",
        "Install ½\" high-density cover board over insulation to provide a smooth, durable substrate.",
        "Install 60-mil PVC membrane — fully adhered, mechanically attached, or RhinoBond per project specification.",
        "Heat-weld all seams with calibrated hot-air welder; probe-test 100% of seams after cooling.",
        "Install new code-required PVC-coated metal drip edge, gravel stop, and termination bar at all perimeters.",
        "Flash all penetrations, curbs, walls, and corners with pre-formed or field-fabricated PVC accessories.",
        "Final walk-through, water-test drains, and quality inspection with the owner.",
    ],
}

BUR_NEW_CONSTRUCTION_TEMPLATE = {
    "title": "BUILT-UP ROOF NEW CONSTRUCTION SYSTEM SCOPE",
    "scope_1_title": "Inspection and Prep",
    "scope_1": [
        "Verify structural deck condition, slope, and drainage prior to installation.",
        "Inspect and repair/replace damaged decking, wood blocking, or nailers; secure loose deck panels.",
        "Clean deck of construction debris, dust, and contaminants.",
        "Confirm placement of drains, scuppers, curbs, and penetrations per plan.",
        "Remove and properly dispose of all debris from the property.",
    ],
    "scope_2_title": "Built-Up System Installation",
    "scope_2": [
        "Install ISO insulation to achieve specified R-value with mechanically attached or hot-mopped cover board.",
        "Install mechanically attached or hot-mopped base sheet over insulation / cover board.",
        "Install three (3) plies of Type IV fiberglass ply sheet in Type III/IV hot asphalt at 25 ± 5 lbs/SQ per ply.",
        "Apply flood coat of hot asphalt at 60 ± 5 lbs/SQ and embed #6 gravel (400 lbs/SQ) OR apply granulated mineral cap sheet.",
        "Install two-ply modified bitumen base flashings at walls and curbs, terminated with counter-flashing.",
        "Install new pitch pans filled with two-part urethane sealant at irregular penetrations.",
        "Install new code-required metal drip edge, gravel stop, and termination bar at all perimeters.",
        "Final walk-through, water-test drains, and quality inspection with the owner.",
    ],
}

# Kept as the generic fallback when "TPO" alone is selected (no over-lay / replacement distinction yet)
TPO_TEMPLATE = TPO_OVERLAY_TEMPLATE

EPDM_TEMPLATE = {
    "title": "EPDM ROOF SYSTEM SCOPE",
    "scope_1_title": "Inspection and Tear-Off / Prep",
    "scope_1": [
        "Survey existing roof and document deck condition, drains, scuppers, and curbs.",
        "Identify wet insulation via infrared scan or core cuts; quantify replacement areas.",
        "Tear-off existing roof to structural deck (or prep substrate for re-cover where approved).",
        "Replace deteriorated decking with new plywood or steel deck as needed.",
        "Remove and properly dispose of all debris.",
    ],
    "scope_2_title": "EPDM Membrane Installation",
    "scope_2": [
        "Install polyiso insulation to specified R-value plus ½\" cover board, fully adhered or mechanically attached.",
        "Install 60-mil EPDM membrane — fully adhered with bonding adhesive, mechanically attached, or ballasted per spec.",
        "Splice all seams with factory-applied seam tape and EPDM splice primer; roll all laps with steel roller.",
        "Install pre-formed pipe boots, inside/outside corners, and uncured EPDM flashing at irregular penetrations.",
        "Terminate membrane at walls and curbs with termination bar, water cut-off mastic, and counter-flashing.",
        "Install new metal edge, drip edge, and gravel stop per SPRI ES-1 requirements.",
        "If ballasted: install washed river rock at 10 lbs/SF minimum or per engineered spec.",
        "Final walk-through, water-test drains, and quality inspection with the owner.",
    ],
}

MODBIT_TEMPLATE = {
    "title": "MODIFIED BITUMEN ROOF SCOPE",
    "scope_1_title": "Inspection and Tear-Off / Prep",
    "scope_1": [
        "Survey existing roof and document blisters, splits, alligatoring, and seam failures.",
        "Core-cut to verify insulation moisture content and existing assembly composition.",
        "Tear-off failed cap sheet and ply membrane down to sound substrate or structural deck.",
        "Replace deteriorated decking and wet insulation as required.",
        "Remove and properly dispose of all debris.",
    ],
    "scope_2_title": "Modified Bitumen System Installation",
    "scope_2": [
        "Install polyiso insulation to specified R-value with mechanically attached or hot-asphalt-adhered cover board.",
        "Install SBS or APP modified bitumen base ply — mechanically attached, torch-applied, cold-process adhered, or self-adhered per spec.",
        "Install granulated SBS or APP modified bitumen cap sheet, fully bonded and offset from base ply laps.",
        "Heat-weld or cold-bond all end and side laps; broom-in and inspect for full bleed-out.",
        "Flash all penetrations, walls, and curbs with two-ply modified bitumen flashings terminated with metal counter-flashing.",
        "Install new pitch pans filled with two-part urethane sealant where required.",
        "Install new metal drip edge, gravel stop, and gutter line metal as specified.",
        "Clean granules from drains and gutters; final walk-through and water test.",
    ],
}

BUR_TEMPLATE = {
    "title": "BUILT-UP ROOF (BUR) SCOPE",
    "scope_1_title": "Inspection and Tear-Off / Prep",
    "scope_1": [
        "Survey existing built-up roof system; locate splits, bare felts, and failed flood coat.",
        "Infrared or core-cut survey to identify wet insulation; quantify replacement areas.",
        "Tear-off existing roof system to structural deck (or to sound base ply where approved).",
        "Replace deteriorated decking and wet insulation with new like-for-like materials.",
        "Remove and properly dispose of aggregate, asphalt, and felts.",
    ],
    "scope_2_title": "Four-Ply Built-Up System Installation",
    "scope_2": [
        "Install mechanically attached or hot-mopped base sheet over insulation / cover board.",
        "Install three (3) plies of Type IV fiberglass ply sheet in Type III/IV hot asphalt at 25 ± 5 lbs/SQ per ply.",
        "Apply flood coat of hot asphalt at 60 ± 5 lbs/SQ and immediately embed #6 gravel (400 lbs/SQ) OR apply granulated mineral cap sheet.",
        "Install two-ply modified bitumen base flashings at all walls, curbs, and parapets, terminated with counter-flashing.",
        "Install new pitch pans filled with two-part urethane sealant at all irregular penetrations.",
        "Install new metal edge, gravel stop, and drip edge per SPRI ES-1.",
        "Final walk-through, water-test drains, and quality inspection with the owner.",
    ],
}

METAL_TEMPLATE = {
    "title": "METAL ROOF RESTORATION SCOPE",
    "scope_1_title": "Inspection and Repairs",
    "scope_1": [
        "Survey all seams, fasteners, ridge caps, valleys, and penetrations for failures.",
        "Identify rust, oil-canning, fastener back-out, and panel deflection.",
        "Replace all failed or backed-out fasteners with oversized neoprene-gasketed screws.",
        "Replace severely rusted or perforated panels with matching gauge and profile.",
        "Re-secure loose ridge caps, gable trim, and gutter line metal.",
    ],
    "scope_2_title": "Surface Prep and Coating System",
    "scope_2": [
        "Power-wash entire roof surface to remove dirt, chalk, oxidation, and loose debris; allow to fully dry.",
        "Spot-prime all rusted areas with rust-inhibitive primer; full-prime if more than 25% rust coverage.",
        "Apply butyl seam tape over all panel laps; embed polyester fabric in fluid-applied membrane over tape.",
        "Treat all fastener heads with elastomeric sealant or fabric-reinforced patch.",
        "Apply base coat of acrylic or silicone elastomeric coating to specified mil thickness.",
        "Apply top coat of acrylic or silicone elastomeric coating at specified mil thickness across the entire field.",
        "Final walk-through and quality inspection with the owner.",
    ],
}

SHINGLE_TEMPLATE = {
    "title": "ASPHALT SHINGLE ROOF SCOPE",
    "scope_1_title": "Inspection and Tear-Off",
    "scope_1": [
        "Survey shingle field for granule loss, blistering, lifted tabs, and exposed nails.",
        "Inspect valleys, ridges, hips, sidewalls, chimneys, and penetrations.",
        "Tear-off existing shingles, felts, and accessories down to the wood deck.",
        "Replace damaged or rotten sheathing with new like-for-like material.",
        "Remove and properly dispose of all debris.",
    ],
    "scope_2_title": "New Shingle Installation",
    "scope_2": [
        "Install new drip edge metal at all eaves and rakes.",
        "Install ice and water shield membrane at all eaves, valleys, sidewalls, and around penetrations.",
        "Install synthetic underlayment over remaining field, lapped per manufacturer specification.",
        "Install starter strip along all eaves.",
        "Install architectural laminated asphalt shingles using six-nail pattern per manufacturer specification.",
        "Install new pipe boot flashings, step flashing, and counter-flashing at all walls and chimneys.",
        "Install ridge ventilation (if applicable) and matching hip / ridge cap shingles.",
        "Final clean-up including magnetic nail sweep of property; walk-through with the owner.",
    ],
}

TILE_TEMPLATE = {
    "title": "TILE ROOF RESTORATION SCOPE",
    "scope_1_title": "Inspection and Tile Lift",
    "scope_1": [
        "Survey tile field for cracks, slippage, broken pieces, and missing tiles.",
        "Inspect underlayment exposure at valleys, ridges, hips, and sidewalls.",
        "Carefully remove and stack existing tiles on the roof for reinstallation.",
        "Tear-off and dispose of existing underlayment, valleys, and flashings.",
        "Replace damaged sheathing as required.",
    ],
    "scope_2_title": "Underlayment Replacement and Tile Reinstall",
    "scope_2": [
        "Install one ply of 40# self-adhered underlayment or two plies of 30# felt over entire deck per code.",
        "Install new metal valleys, drip edge, and gable trim.",
        "Install new pipe flashings, lead jacks, and step / counter-flashing at all walls and chimneys.",
        "Reinstall existing tiles (broken pieces replaced with matching profile/color) using approved screws or foam adhesive per code.",
        "Re-mortar ridge and hip caps using polymer-modified mortar or approved foam adhesive system.",
        "Sort and stage replacement tiles to minimize visible color variation.",
        "Final clean-up of property; walk-through with the owner.",
    ],
}

FARM_TEMPLATE = {
    "title": "FLUID APPLIED REINFORCED MEMBRANE SCOPE",
    "scope_1_title": "Inspection and Prep",
    "scope_1": [
        "Survey existing roof assembly and document deck condition, slope, and drainage.",
        "Identify wet insulation by infrared and/or core cuts; quantify replacement/ventilation areas.",
        "Remove all roof debris, power wash existing membrane (if required), and allow to dry.",
    ],
    "scope_2_title": "FARM Application",
    "scope_2": [
        "<b>Flashing:</b> All penetrations will be flashed with a 5-course system of mastic and fabric before and during application. Then one of the following systems will be applied based on the selected warranty tier:",
    ],
    "tier_table": {
        "headers": ["25-YEAR SYSTEM", "20-YEAR SYSTEM", "15-YEAR SYSTEM", "10-YEAR SYSTEM"],
        "rows": [
            [
                "Base Layer of Emulsion with embedded fabric",
                "Base Layer of Emulsion with embedded fabric",
                "Base Layer of Emulsion with embedded fabric",
                "Base Layer of Emulsion with embedded fabric",
            ],
            [
                "Mid Layer of Acrylic with embedded fabric",
                "Mid Layer of Emulsion with embedded fabric",
                "Mid Layer of Acrylic with embedded fabric",
                "Mid Layer of Emulsion with embedded fabric",
            ],
            [
                "Top Layer of Acrylic with embedded fabric",
                "Mid Layer of Acrylic with embedded fabric",
                "Top Layer of Acrylic",
                "Top Layer of Acrylic",
            ],
            [
                "Top Layer of Acrylic",
                "Top Layer of Acrylic",
                "",
                "",
            ],
        ],
        "alt_header": "Alternative if Applicable",
        "alt_rows": [
            [
                "",
                "Two Layers of Acrylic with embedded fabric, Plus Top Layer",
                "",
                "One Layer of Acrylic with embedded fabric, Plus Top Layer",
            ],
        ],
        "warranty_row": [
            "25-Yr Warranty with Hail Rider Included",
            "20-Yr Warranty with Hail Rider Included",
            "15-Yr Standard Warranty Included",
            "10-Yr Standard Warranty Included",
        ],
    },
}


# Lookup table — keys are normalized (lower-cased, alphanumeric chunks)
# Maps roof_type → template dict
CUSTOM_SCOPE_TEMPLATE = {
    "title": "PROJECT SCOPE",
    "dynamic_scope": True,  # build_spec_sheet renders scope from data["custom_scope"] free-form text
    "spread_page_2": True,
    "scope_1_title": "Scope of Work",
    "scope_1": ["Free-form scope to be supplied per project (see deal record)."],
    "scope_2_title": "Project Requirements",
    "scope_2": ["Materials, labor, and workmanship per industry standard."],
}


ROOF_TEMPLATE_MAP = {
    "silicone": SILICONE_TEMPLATE,
    "siliconewgranules": SILICONE_TEMPLATE,
    "tpo": TPO_TEMPLATE,
    "tpooverlay": TPO_OVERLAY_TEMPLATE,
    "tpooverexistingtpo": TPO_OVERLAY_TEMPLATE,
    "tpooverexistingtpooverlay": TPO_OVERLAY_TEMPLATE,
    "tporeplacement": TPO_REPLACEMENT_TEMPLATE,
    "tporeplacingtpo": TPO_REPLACEMENT_TEMPLATE,
    "epdm": EPDM_TEMPLATE,
    "epdmwballast": EPDM_TEMPLATE,
    "epdmoverlay": EPDM_OVERLAY_TEMPLATE,
    "epdmoverexistingepdm": EPDM_OVERLAY_TEMPLATE,
    "epdmreplacement": EPDM_REPLACEMENT_TEMPLATE,
    "epdmreplacingepdm": EPDM_REPLACEMENT_TEMPLATE,
    "pvc": PVC_OVERLAY_TEMPLATE,
    "pvcoverlay": PVC_OVERLAY_TEMPLATE,
    "pvcoverexistingpvc": PVC_OVERLAY_TEMPLATE,
    "pvcreplacement": PVC_REPLACEMENT_TEMPLATE,
    "pvcreplacingpvc": PVC_REPLACEMENT_TEMPLATE,
    "modbit": MODBIT_TEMPLATE,
    "modifiedbitumen": MODBIT_TEMPLATE,
    "modbitoverlay": MODBIT_OVERLAY_TEMPLATE,
    "modifiedbitumenoverlay": MODBIT_OVERLAY_TEMPLATE,
    "modbitreplacement": MODBIT_REPLACEMENT_TEMPLATE,
    "modifiedbitumenreplacement": MODBIT_REPLACEMENT_TEMPLATE,
    "bur": BUR_TEMPLATE,
    "burbuiltup": BUR_TEMPLATE,
    "builtup": BUR_TEMPLATE,
    "metal": METAL_TEMPLATE,
    "shingle": SHINGLE_TEMPLATE,
    "asphaltshingle": SHINGLE_TEMPLATE,
    "tile": TILE_TEMPLATE,
    "farm": FARM_TEMPLATE,
    "farmfluidappliedreinforcedmembrane": FARM_TEMPLATE,
    "fluidappliedreinforcedmembrane": FARM_TEMPLATE,
    "constructionproject": CUSTOM_SCOPE_TEMPLATE,
    "other": CUSTOM_SCOPE_TEMPLATE,
    "otherconstructionwork": CUSTOM_SCOPE_TEMPLATE,
}


NEW_CONSTRUCTION_MAP = {
    "tpo": TPO_NEW_CONSTRUCTION_TEMPLATE,
    "tpooverlay": TPO_NEW_CONSTRUCTION_TEMPLATE,
    "tporeplacement": TPO_NEW_CONSTRUCTION_TEMPLATE,
    "epdm": EPDM_NEW_CONSTRUCTION_TEMPLATE,
    "epdmoverlay": EPDM_NEW_CONSTRUCTION_TEMPLATE,
    "epdmreplacement": EPDM_NEW_CONSTRUCTION_TEMPLATE,
    "epdmwballast": EPDM_NEW_CONSTRUCTION_TEMPLATE,
    "pvc": PVC_NEW_CONSTRUCTION_TEMPLATE,
    "pvcoverlay": PVC_NEW_CONSTRUCTION_TEMPLATE,
    "pvcreplacement": PVC_NEW_CONSTRUCTION_TEMPLATE,
    "modbit": MODBIT_NEW_CONSTRUCTION_TEMPLATE,
    "modbitoverlay": MODBIT_NEW_CONSTRUCTION_TEMPLATE,
    "modbitreplacement": MODBIT_NEW_CONSTRUCTION_TEMPLATE,
    "modifiedbitumen": MODBIT_NEW_CONSTRUCTION_TEMPLATE,
    "modifiedbitumenoverlay": MODBIT_NEW_CONSTRUCTION_TEMPLATE,
    "modifiedbitumenreplacement": MODBIT_NEW_CONSTRUCTION_TEMPLATE,
    "bur": BUR_NEW_CONSTRUCTION_TEMPLATE,
    "burbuiltup": BUR_NEW_CONSTRUCTION_TEMPLATE,
    "builtup": BUR_NEW_CONSTRUCTION_TEMPLATE,
}


def _is_new_construction(current_roof_type: str | None) -> bool:
    """Returns True when the current roof indicates no existing roof to work over."""
    if not current_roof_type:
        return False
    s = str(current_roof_type).strip().lower()
    # Matches "none", "none (new construction)", "n/a", "new construction"
    return s.startswith("none") or s == "n/a" or "new construction" in s


def _resolve_template(roof_type: str | None, current_roof_type: str | None = None) -> dict:
    """Return the scope template matching the given roof_type label.

    If `current_roof_type` indicates new construction, prefer the
    new-construction variant of the membrane system (when one exists).
    Falls back to the silicone restoration scope when nothing matches.
    """
    key = "".join(ch for ch in str(roof_type or "").lower() if ch.isalnum())
    # Custom-scope path always wins over new-construction mapping
    if key in ("constructionproject", "other", "otherconstructionwork"):
        return CUSTOM_SCOPE_TEMPLATE
    if _is_new_construction(current_roof_type) and key in NEW_CONSTRUCTION_MAP:
        return NEW_CONSTRUCTION_MAP[key]
    if not roof_type:
        return SILICONE_TEMPLATE
    return ROOF_TEMPLATE_MAP.get(key, SILICONE_TEMPLATE)


TERMS = [
    ("PAYMENT TERMS.", "Proposals are valid for thirty (30) days from the date issued. Fifty percent (50%) of the total contract amount is due upon acceptance to order materials and prior to scheduling of the work, unless otherwise specified in the milestone schedule. The remaining balance is due at mid-project and/or upon substantial completion per the agreed milestone schedule."),
    ("ACCOUNTS.", "Invoices past due by thirty (30) days will accrue interest at one and one-half percent (1.5%) per month, or the maximum rate permitted by law. The Owner shall be responsible for all reasonable collection costs, including attorneys' fees."),
    ("FINAL INSPECTION.", "If a final inspection is required, a five percent (5%) retainage may be withheld until punch list items are completed to mutual satisfaction. Inspection requests must be submitted in writing within ten (10) days of substantial completion."),
    ("PERFORMANCE OF WORK.", "All work shall be performed in a workmanlike manner using materials specified herein or equivalent. SealTech Building Solutions warrants its workmanship for the period stated in the selected warranty tier. Manufacturer warranties are separate and provided by the product manufacturer."),
    ("FORCE MAJEURE.", "SealTech Building Solutions shall not be liable for any delay or failure in performance caused by events beyond its reasonable control, including but not limited to weather, labor disputes, material shortages, or governmental actions."),
    ("ADDITIONAL WORK.", "Any work outside the scope described in this proposal shall be authorized in writing by the Owner and billed at the prevailing time-and-material rates. Verbal change orders are not binding."),
    ("ACCESS.", "Owner shall provide safe, unobstructed access to the work area, including roof access, electrical hookups, and water as needed. Owner is responsible for moving any personal property from the work area."),
    ("PAID IN FULL.", "Title to all materials installed remains with SealTech Building Solutions until the contract is paid in full. Owner grants SealTech the right to file appropriate lien notices as permitted by law."),
    ("CANCELLATION.", "Cancellation more than seventy-two (72) hours after acceptance but prior to commencement of work shall incur a cancellation fee equal to twenty-five percent (25%) of the total proposal amount."),
]


def _footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(BORDER)
    canvas.setLineWidth(0.5)
    canvas.line(0.5 * inch, 0.6 * inch, 8.0 * inch, 0.6 * inch)
    canvas.setFont("Helvetica", 7)
    canvas.setFillColor(GRAY)
    canvas.drawString(0.5 * inch, 0.45 * inch, "SealTech Building Solutions  -  720-715-9955  -  info@sealtechbuildingsolutions.com  -  www.sealtechbuildingsolutions.com")
    canvas.drawRightString(8.0 * inch, 0.45 * inch, f"{doc.page} | Page")
    canvas.restoreState()


def _header_block(s, doc, template_title: str, template: dict | None = None):
    elems = []
    # Logo at top-left, 50% larger
    if os.path.exists(LOGO_PATH):
        try:
            logo = Image(LOGO_PATH, width=3.3 * inch, height=1.275 * inch, kind="proportional")
            logo.hAlign = "LEFT"
            elems.append(logo)
        except Exception:
            elems.append(Paragraph("SEALTECH  ·  BUILDING SOLUTIONS", s["eyebrow"]))
    else:
        elems.append(Paragraph("SEALTECH  ·  BUILDING SOLUTIONS", s["eyebrow"]))

    elems.append(Spacer(1, 0.05 * inch))
    # Adaptive title font size — keeps even the longest titles on a single line at letter width
    title_text = template_title or ""
    if len(title_text) > 36:
        title_font, title_lead = 18, 22
    elif len(title_text) > 30:
        title_font, title_lead = 20, 24
    else:
        title_font, title_lead = 22, 26
    title_centered = ParagraphStyle(
        "title_centered", parent=s["title"], alignment=1,
        fontSize=title_font, leading=title_lead, spaceAfter=6,
    )
    elems.append(Paragraph(title_text, title_centered))
    elems.append(Spacer(1, 0.35 * inch))

    product_line = doc.get("product_type", "—")
    # Skip the "(Standard Warranty Included)" annotation when the template is FARM (tier_table
    # enumerates tiers in-body) OR Construction Project / Other (no warranty applies).
    if template and (template.get("tier_table") or template.get("dynamic_scope")):
        product_cell = Paragraph(product_line, s["body"])
    else:
        product_cell = Paragraph(
            f'{product_line} <font size="7" color="#52525B"><i>(Standard Warranty Included)</i></font>',
            s["body"],
        )

    cname = (doc.get("contact_name") or "").strip()
    cphone = (doc.get("contact_phone") or "").strip()
    contact_display = "  ·  ".join([p for p in [cname, cphone] if p]) if (cname or cphone) else ""

    info_rows = []
    if contact_display:
        info_rows.append(["CONTACT", Paragraph(contact_display, s["body"])])
    info_rows.extend([
        ["PROJECT ADDRESS", Paragraph(doc.get("project_address", "—"), s["body"])],
        ["PRODUCT TYPE", product_cell],
        ["DATE", Paragraph(doc.get("date", "—"), s["body"])],
    ])
    t = Table(info_rows, colWidths=[1.5 * inch, 6.0 * inch])
    t.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("TEXTCOLOR", (0, 0), (0, -1), BLUE),
        ("TEXTCOLOR", (1, 0), (1, -1), DARK),
        ("LINEBELOW", (0, 0), (-1, -1), 0.25, BORDER),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
    ]))
    elems.append(t)
    elems.append(Spacer(1, 0.15 * inch))
    return elems


def _pricing_table(s, doc, template: dict | None = None):
    elems = []
    has_tier_table = bool(template and template.get("tier_table"))
    is_dynamic = bool(template and template.get("dynamic_scope"))
    table_font = 9
    cell_pad = 7
    total_font = 10
    total_pad = 8
    gap_after = 0.12 * inch
    # Construction Project / Other — single price, no warranty language
    if is_dynamic:
        elems.append(Paragraph(
            f'{doc.get("product_type", "Project Investment")}',
            s["h2"],
        ))
        price = float(doc.get("opt_20") or doc.get("opt_15") or doc.get("opt_10") or 0)
        single = [
            ["Description", "Project Total"],
            ["Construction Project — Custom Scope", _currency(price)],
        ]
        t = Table(single, colWidths=[4.5 * inch, 3.0 * inch])
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), BLUE),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTNAME", (0, 1), (-1, -1), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), total_font),
            ("ALIGN", (1, 0), (1, -1), "RIGHT"),
            ("GRID", (0, 0), (-1, -1), 0.25, BORDER),
            ("BACKGROUND", (0, 1), (-1, 1), LIGHT),
            ("TOPPADDING", (0, 0), (-1, -1), total_pad),
            ("BOTTOMPADDING", (0, 0), (-1, -1), total_pad),
            ("LEFTPADDING", (0, 0), (-1, -1), 10),
            ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ]))
        elems.append(t)
        elems.append(Spacer(1, gap_after))
        return elems
    header_suffix = "" if has_tier_table else ' <font size="9"><i>(Standard Warranty Included)</i></font>'
    elems.append(Paragraph(
        f'{doc.get("product_type", "Roof System Investment")}{header_suffix}',
        s["h2"],
    ))
    if has_tier_table:
        base = [
            ["Warranty Tier", "Base Investment"],
            ["25-Year Warranty w/Hail Rider", _currency(doc.get("opt_25"))],
            ["20-Year Warranty w/Hail Rider", _currency(doc.get("opt_20"))],
            ["15-Year Standard Warranty", _currency(doc.get("opt_15"))],
            ["10-Year Standard Warranty", _currency(doc.get("opt_10"))],
        ]
    else:
        base = [
            ["Warranty Tier", "Base Investment"],
            ["20-Year Workmanship", _currency(doc.get("opt_20"))],
            ["15-Year Workmanship", _currency(doc.get("opt_15"))],
            ["10-Year Workmanship", _currency(doc.get("opt_10"))],
        ]
    t = Table(base, colWidths=[4.5 * inch, 3.0 * inch])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), BLUE),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), table_font),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("GRID", (0, 0), (-1, -1), 0.25, BORDER),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]),
        ("TOPPADDING", (0, 0), (-1, -1), cell_pad),
        ("BOTTOMPADDING", (0, 0), (-1, -1), cell_pad),
    ]))
    elems.append(t)
    elems.append(Spacer(1, gap_after))

    # Templates that already enumerate warranty options in-body (e.g., FARM's tier_table)
    # don't need the optional add-on warranty section — there are no extra warranty fees.
    if has_tier_table:
        return elems

    elems.append(Paragraph("[OPTIONAL] Manufacturer Warranty (Labor &amp; Material)", s["h2"]))
    opt = [
        ["Warranty Tier", "Add-On Cost"],
        ["20-Year Labor & Material w/Hail Rider", _currency(doc.get("w20"))],
        ["15-Year Labor & Material", _currency(doc.get("w15"))],
        ["10-Year Labor & Material", _currency(doc.get("w10"))],
    ]
    t2 = Table(opt, colWidths=[4.5 * inch, 3.0 * inch])
    t2.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), BLUE), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"), ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), table_font), ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("GRID", (0, 0), (-1, -1), 0.25, BORDER),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]),
        ("TOPPADDING", (0, 0), (-1, -1), cell_pad), ("BOTTOMPADDING", (0, 0), (-1, -1), cell_pad),
    ]))
    elems.append(t2)
    elems.append(Spacer(1, gap_after))

    elems.append(Paragraph("Total Investment with Optional Manufacturer Warranty", s["h2"]))
    tot = [
        ["Including 20-Year Upgraded Warranty", _currency((doc.get("opt_20") or 0) + (doc.get("w20") or 0))],
        ["Including 15-Year Upgraded Warranty", _currency((doc.get("opt_15") or 0) + (doc.get("w15") or 0))],
        ["Including 10-Year Upgraded Warranty", _currency((doc.get("opt_10") or 0) + (doc.get("w10") or 0))],
    ]
    t3 = Table(tot, colWidths=[4.5 * inch, 3.0 * inch])
    t3.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), total_font),
        ("TEXTCOLOR", (1, 0), (1, -1), BLUE),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("GRID", (0, 0), (-1, -1), 0.5, DARK),
        ("BACKGROUND", (0, 0), (-1, -1), LIGHT),
        ("TOPPADDING", (0, 0), (-1, -1), total_pad), ("BOTTOMPADDING", (0, 0), (-1, -1), total_pad),
    ]))
    elems.append(t3)
    return elems


def _scope_block(s, title, items):
    elems = [Paragraph(title, s["h2"])]
    bullets = "<br/>".join([f"•&nbsp;&nbsp;{i}" for i in items])
    elems.append(Paragraph(bullets, s["body"]))
    return elems


def _split_bullets(text: str) -> list[str]:
    """Split a multi-line block into a clean bullet list.
    Strips leading dashes/bullets and ignores empty lines.
    """
    if not text:
        return []
    return [ln.strip().lstrip("-•* ") for ln in text.splitlines() if ln.strip()]


def _build_construction_2page(
    data: dict,
    template: dict,
    signer_name: str | None = None,
    signer_credentials: str | None = None,
) -> bytes:
    """Tight 2-page Construction / Other project scope.

    Page 1: header + 3-bucket scope (Project Requirements / Other Requirements /
            Exclusions) + Project Total + appreciation + signoff + acceptance.
    Page 2: Terms & Conditions.

    Reads from these data keys (all optional — falls back to legacy `custom_scope`):
      - construction_project_requirements (one bullet per line)
      - construction_other_requirements   (one bullet per line)
      - construction_exclusions           (one bullet per line)
      - project_type_override             (overrides PROJECT TYPE display label)
    """
    project_reqs = _split_bullets(data.get("construction_project_requirements") or "")
    other_reqs = _split_bullets(data.get("construction_other_requirements") or "")
    exclusions = _split_bullets(data.get("construction_exclusions") or "")

    # Back-compat: if none of the three new fields were filled but a legacy
    # `custom_scope` exists, dump it entirely into Project Requirements (preserving
    # line breaks → bullets). We do NOT auto-split into Other/Exclusions because
    # that mis-labels real data (e.g., "Site preparation" landing under Exclusions
    # just because it was paragraph #3). Default Exclusions get applied below.
    if not (project_reqs or other_reqs or exclusions):
        raw = (data.get("custom_scope") or "").strip()
        if raw:
            project_reqs = _split_bullets(raw)

    # Standard exclusions — these are policy-level and rarely change. If the deal
    # didn't explicitly provide its own exclusions list, fall back to defaults so
    # the section is never blank on the PDF.
    if not exclusions:
        exclusions = [
            "Permit fees (if required by jurisdiction).",
            "Removal/disposal of pre-existing hazardous materials.",
            "Work outside the defined scope.",
        ]

    buf = BytesIO()
    pdf = SimpleDocTemplate(
        buf, pagesize=letter,
        leftMargin=0.5 * inch, rightMargin=0.5 * inch,
        topMargin=0.55 * inch, bottomMargin=0.75 * inch,
        title="Project Scope",
    )
    s = _styles()

    # Compact styles tuned to keep Page 1 on a single sheet.
    h2_compact = ParagraphStyle("h2c", parent=s["h2"], fontSize=11, leading=13, spaceBefore=2, spaceAfter=2)
    h3_compact = ParagraphStyle("h3c", parent=s["bold"], fontSize=10, leading=12, textColor=BRONZE, spaceBefore=2, spaceAfter=2)
    body_compact = ParagraphStyle("bc", parent=s["body"], fontSize=9.5, leading=12)

    story = []

    # ---- Header (logo + title + contact/project/type/date) ----
    # Mirrors `_header_block` but uses the override-aware PROJECT TYPE label and
    # tighter spacing to give the scope room to breathe.
    if os.path.exists(LOGO_PATH):
        try:
            logo = Image(LOGO_PATH, width=3.0 * inch, height=1.15 * inch, kind="proportional")
            logo.hAlign = "LEFT"
            story.append(logo)
        except Exception:
            story.append(Paragraph("SEALTECH  ·  BUILDING SOLUTIONS", s["eyebrow"]))
    else:
        story.append(Paragraph("SEALTECH  ·  BUILDING SOLUTIONS", s["eyebrow"]))

    story.append(Spacer(1, 0.04 * inch))
    title_centered = ParagraphStyle("title_c", parent=s["title"], alignment=1, fontSize=20, leading=24, spaceAfter=4)
    story.append(Paragraph("PROJECT SCOPE", title_centered))
    story.append(Spacer(1, 0.10 * inch))

    project_type_label = (
        (data.get("project_type_override") or "").strip()
        or (data.get("product_type") or "").strip()
        or "Construction Project"
    )

    cname = (data.get("contact_name") or "").strip()
    cphone = (data.get("contact_phone") or "").strip()
    contact_display = "  ·  ".join([p for p in [cname, cphone] if p]) or "—"

    info_rows = [
        ["CONTACT", Paragraph(contact_display, body_compact)],
        ["PROJECT ADDRESS", Paragraph(data.get("project_address", "—"), body_compact)],
        ["PROJECT TYPE", Paragraph(project_type_label, body_compact)],
        ["DATE", Paragraph(data.get("date", "—"), body_compact)],
    ]
    info_tbl = Table(info_rows, colWidths=[1.4 * inch, 6.1 * inch])
    info_tbl.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("TEXTCOLOR", (0, 0), (0, -1), BLUE),
        ("TEXTCOLOR", (1, 0), (1, -1), DARK),
        ("LINEBELOW", (0, 0), (-1, -1), 0.25, BORDER),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(info_tbl)
    story.append(Spacer(1, 0.12 * inch))

    # ---- Scope table — 3 buckets in one outlined block ----
    scope_subtitle = (data.get("construction_scope_subtitle") or "").strip()

    scope_cells = []
    # Header row
    scope_cells.append([Paragraph("<b>Construction Project Custom Scope</b>", h2_compact)])
    # "Scope of Work" header (left-aligned by h3_compact style)
    scope_cells.append([Paragraph("<b>Scope of Work</b>", h3_compact)])
    # Centered subtitle on its own row (e.g., "Landscape Scope") in blue
    if scope_subtitle:
        subtitle_style = ParagraphStyle(
            "subtitle_blue", parent=s["bold"], fontSize=10, leading=12,
            textColor=BLUE, alignment=1,  # 1 = TA_CENTER
        )
        scope_cells.append([Paragraph(scope_subtitle, subtitle_style)])

    def _bullets_para(items: list[str]) -> Paragraph:
        if not items:
            return Paragraph("<i>—</i>", body_compact)
        return Paragraph("<br/>".join([f"•&nbsp;&nbsp;{i}" for i in items]), body_compact)

    if project_reqs:
        scope_cells.append([Paragraph("<b>Project Requirements</b>", h3_compact)])
        scope_cells.append([_bullets_para(project_reqs)])
    if other_reqs:
        scope_cells.append([Paragraph("<b>Other Requirements</b>", h3_compact)])
        scope_cells.append([_bullets_para(other_reqs)])
    if exclusions:
        scope_cells.append([Paragraph("<b>Exclusions</b>", h3_compact)])
        scope_cells.append([_bullets_para(exclusions)])

    scope_tbl = Table(scope_cells, colWidths=[7.5 * inch])
    scope_tbl.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.5, BORDER),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("BACKGROUND", (0, 0), (0, 0), LIGHT),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    story.append(scope_tbl)
    story.append(Spacer(1, 0.08 * inch))

    # ---- Project Total — single price row ----
    price = float(
        data.get("opt_20")
        or data.get("opt_15")
        or data.get("opt_10")
        or data.get("chosen_amount")
        or 0
    )
    total_tbl = Table(
        [["PROJECT TOTAL", _currency(price)]],
        colWidths=[5.0 * inch, 2.5 * inch],
    )
    total_tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), BLUE),
        ("TEXTCOLOR", (0, 0), (-1, -1), colors.white),
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 12),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
    ]))
    story.append(total_tbl)
    story.append(Spacer(1, 0.10 * inch))

    # ---- Appreciation line ----
    appreciation_style = ParagraphStyle(
        "appreciation_c", parent=body_compact, alignment=1, fontName="Helvetica-Oblique",
    )
    story.append(Paragraph(
        "We appreciate your consideration of SealTech Building Solutions for your project investment. "
        "We are committed to delivering exceptional craftsmanship, transparency, and lasting value on every project we undertake.",
        appreciation_style,
    ))
    story.append(Spacer(1, 0.08 * inch))

    # ---- Signer block ----
    # Construction Scope is always signed by Darren Oliver, CSI, IIBEC
    # (founder/PE) per business policy — independent of the logged-in user.
    sn = "Darren Oliver"
    sc = "CSI, IIBEC"
    signer_line = f"<b>{sn}, {sc}</b><br/>SealTech Building Solutions"
    story.append(Paragraph(signer_line, body_compact))
    story.append(Spacer(1, 0.06 * inch))

    # ---- Acceptance block ----
    story.append(Paragraph("Acceptance Of Scope", h2_compact))
    story.append(Paragraph(
        "The investment, specifications, and conditions stated above are satisfactory and are hereby accepted. "
        "SealTech Building Solutions is authorized to perform the work as specified. Payment will be made as outlined in the milestone schedule and Terms &amp; Conditions. "
        "&quot;Owner&quot; refers to the legal owner of the property or their duly authorized representative.",
        body_compact,
    ))
    story.append(Spacer(1, 0.08 * inch))

    accept_rows = [
        ["By:", "________________________________", "Title:", "________________________________"],
        ["Signature:", "________________________________", "Date:", "________________________________"],
    ]
    at = Table(accept_rows, colWidths=[0.7 * inch, 2.95 * inch, 0.6 * inch, 2.95 * inch])
    at.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("TEXTCOLOR", (0, 0), (-1, -1), DARK),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    story.append(at)
    story.append(PageBreak())

    # ---- Page 2: Terms & Conditions ----
    story.append(Paragraph("TERMS AND CONDITIONS", s["title"]))
    story.append(Paragraph(
        "The following terms and conditions are an integral part of this proposal and form a binding agreement upon acceptance. "
        "No representations or reliance on any statements not contained herein shall be binding upon SealTech Building Solutions.",
        s["tc_intro"],
    ))
    story.append(Spacer(1, 0.1 * inch))
    for head, body in TERMS:
        story.append(KeepTogether([
            Paragraph(head, s["tc_h"]),
            Paragraph(body, s["tc"]),
        ]))

    pdf.build(story, onFirstPage=_footer, onLaterPages=_footer)
    return buf.getvalue()


def build_spec_sheet(
    data: dict,
    cover_photo_bytes: bytes = None,
    roof_type: str | None = None,
    current_roof_type: str | None = None,
    signer_name: str | None = None,
    signer_credentials: str | None = None,
) -> bytes:
    """Build a SealTech-branded scope/spec sheet for the given roof type.

    `roof_type` selects which scope template to render. If `current_roof_type`
    indicates no existing roof (e.g. "None (new construction)"), the
    new-construction variant of the system is used when available.
    Falls back to the existing silicone restoration scope otherwise.

    `signer_name` + `signer_credentials` populate the closing signature block
    (e.g. "Darren Oliver, CSI, IIBEC / SealTech Building Solutions"). If not
    provided, falls back to the founder/GM's signature for back-compat.
    """
    template = _resolve_template(
        roof_type or data.get("roof_type_label"),
        current_roof_type or data.get("current_roof_type"),
    )

    # Construction Project / Other — render a dedicated 2-page document
    # (Page 1 = scope + total + signoff, Page 2 = T&C). Bypasses the standard
    # 3-page flow used by roofing templates.
    if template.get("dynamic_scope"):
        return _build_construction_2page(
            data, template,
            signer_name=signer_name,
            signer_credentials=signer_credentials,
        )

    buf = BytesIO()
    pdf = SimpleDocTemplate(buf, pagesize=letter,
                            leftMargin=0.5 * inch, rightMargin=0.5 * inch,
                            topMargin=0.6 * inch, bottomMargin=0.8 * inch,
                            title=template["title"].title())
    s = _styles()
    story = []

    # ---- Page 1: Header + Pricing ----
    story.extend(_header_block(s, data, template["title"], template))
    story.extend(_pricing_table(s, data, template))

    # For templates with a tier_table (e.g. FARM), Page 2 already absorbs the
    # comparison-table footprint, so the Page 1 pricing block is compact and
    # leaves room for the Inclusions blurb + an enlarged cover photo. Render
    # them here on Page 1 so the page is fully utilized.
    if template.get("tier_table"):
        story.append(Spacer(1, 0.06 * inch))
        story.append(Paragraph("Inclusions", s["h2"]))
        total_sqft_p1 = data.get("total_sqft", 0) or 0
        sq_p1 = int(round(total_sqft_p1 / 100))
        color_p1 = data.get("color", "white")
        raw_label = data.get("roof_type_label") or (roof_type or "roof system")
        # Preserve the FARM acronym in body copy: "FARM (fluid applied reinforced membrane)"
        if "farm" in raw_label.lower() or "fluid applied reinforced membrane" in raw_label.lower():
            label_p1 = "FARM (fluid applied reinforced membrane)"
        else:
            label_p1 = raw_label
        inc_text_p1 = f"Approximately {total_sqft_p1:,.0f} SF ({sq_p1} SQ) {color_p1} {label_p1} system, including walls and flashings."
        story.append(Paragraph(inc_text_p1, s["body"]))
        story.append(Spacer(1, 0.08 * inch))
        if cover_photo_bytes:
            try:
                img = Image(BytesIO(cover_photo_bytes), width=7.5 * inch, height=2.7 * inch, kind="proportional")
                img.hAlign = "CENTER"
                story.append(img)
            except Exception:
                story.append(Paragraph("<i>Cover photo could not be embedded.</i>", s["small"]))
        else:
            ph = Table([[" "]], colWidths=[7.5 * inch], rowHeights=[2.7 * inch])
            ph.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.5, BORDER), ("BACKGROUND", (0, 0), (-1, -1), LIGHT)]))
            story.append(ph)
            story.append(Paragraph("Cover photo placeholder — upload a Photo to this project and mark it as Cover.", s["small"]))

    story.append(PageBreak())

    # ---- Page 2: Scope ----
    spread = bool(template.get("spread_page_2")) and not template.get("tier_table")
    story.extend(_scope_block(s, template["scope_1_title"], template["scope_1"]))
    # Page 2 breathing room varies by template: FARM (tier_table) gets a small
    # bump, restoration scopes with fewer bullets ("spread_page_2") get a
    # bigger bump so the page fills out nicely.
    if template.get("tier_table"):
        story.append(Spacer(1, 0.08 * inch))
    elif spread:
        story.append(Spacer(1, 0.14 * inch))
    else:
        story.append(Spacer(1, 0.05 * inch))
    story.extend(_scope_block(s, template["scope_2_title"], template["scope_2"]))

    # Optional tier comparison table (used by FARM and similar multi-warranty systems)
    if template.get("tier_table"):
        tt = template["tier_table"]
        story.append(Spacer(1, 0.10 * inch))
        cell_style = ParagraphStyle("tier_cell", fontName="Helvetica", fontSize=10, textColor=DARK, leading=13, alignment=1)
        head_style = ParagraphStyle("tier_head", fontName="Helvetica-Bold", fontSize=10, textColor=colors.white, leading=13, alignment=1)
        warr_style = ParagraphStyle("tier_warr", fontName="Helvetica-Bold", fontSize=10, textColor=DARK, leading=13, alignment=1)
        alt_style = ParagraphStyle("tier_alt", fontName="Helvetica-Bold", fontSize=9, textColor=BRONZE, leading=11, alignment=1)

        data_rows = [[Paragraph(h, head_style) for h in tt["headers"]]]
        for row in tt.get("rows", []):
            data_rows.append([Paragraph(c, cell_style) if c else "" for c in row])

        alt_rows = tt.get("alt_rows", [])
        alt_start_idx = None
        if alt_rows:
            alt_start_idx = len(data_rows)
            data_rows.append([Paragraph(tt.get("alt_header", "Alternative if Applicable"), alt_style)] * 4)
            for row in alt_rows:
                data_rows.append([Paragraph(c, cell_style) if c else "" for c in row])

        warr_idx = None
        if tt.get("warranty_row"):
            warr_idx = len(data_rows)
            data_rows.append([Paragraph(c, warr_style) for c in tt["warranty_row"]])

        col_w = 7.5 * inch / 4
        ttable = Table(data_rows, colWidths=[col_w] * 4)
        style_cmds = [
            ("BACKGROUND", (0, 0), (-1, 0), BLUE),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("ALIGN", (0, 0), (-1, -1), "CENTER"),
            ("GRID", (0, 0), (-1, -1), 0.25, BORDER),
            ("LEFTPADDING", (0, 0), (-1, -1), 5),
            ("RIGHTPADDING", (0, 0), (-1, -1), 5),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ]
        if alt_start_idx is not None:
            style_cmds.append(("BACKGROUND", (0, alt_start_idx), (-1, alt_start_idx), LIGHT))
            style_cmds.append(("SPAN", (0, alt_start_idx), (-1, alt_start_idx)))
        if warr_idx is not None:
            style_cmds.append(("BACKGROUND", (0, warr_idx), (-1, warr_idx), LIGHT))
            style_cmds.append(("LINEABOVE", (0, warr_idx), (-1, warr_idx), 0.75, DARK))
        ttable.setStyle(TableStyle(style_cmds))
        story.append(ttable)

    # Larger breathing room after the tier table only (FARM has room to spare on page 2)
    if template.get("tier_table"):
        story.append(Spacer(1, 0.10 * inch))
    elif spread:
        story.append(Spacer(1, 0.12 * inch))
    else:
        story.append(Spacer(1, 0.06 * inch))

    # Inclusions block — for tier_table templates (FARM) this is rendered on
    # Page 1 instead, so skip it here. For Construction Project / Other we also skip —
    # the free-form Custom Scope already enumerates exactly what's included.
    if not template.get("tier_table") and not template.get("dynamic_scope"):
        story.append(Paragraph("Inclusions", s["h2"]))
        total_sqft = data.get("total_sqft", 0) or 0
        sq = int(round(total_sqft / 100))
        color = data.get("color", "white")
        label = data.get("roof_type_label") or (roof_type or "roof system")
        inc_text = f"Approximately {total_sqft:,.0f} SF ({sq} SQ) {color} {label} system, including walls and flashings."
        story.append(Paragraph(inc_text, s["body"]))
        story.append(Spacer(1, 0.10 * inch if spread else 0.06 * inch))

    # Cover photo (skipped when template has a tier_table — the table itself fills the visual space)
    if not template.get("tier_table"):
        photo_h = 1.6 * inch if spread else 1.2 * inch
        if cover_photo_bytes:
            try:
                img = Image(BytesIO(cover_photo_bytes), width=7.0 * inch, height=photo_h, kind="proportional")
                story.append(img)
            except Exception:
                story.append(Paragraph("<i>Cover photo could not be embedded.</i>", s["small"]))
        else:
            ph = Table([[" "]], colWidths=[7.0 * inch], rowHeights=[photo_h])
            ph.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.5, BORDER), ("BACKGROUND", (0, 0), (-1, -1), LIGHT)]))
            story.append(ph)
            story.append(Paragraph("Cover photo placeholder — upload a Photo to this project and mark it as Cover.", s["small"]))
        story.append(Spacer(1, 0.10 * inch if spread else 0.06 * inch))

    story.append(Paragraph("Exclusions", s["h2"]))
    excl = "<br/>".join([f"•&nbsp;&nbsp;{e}" for e in EXCLUSIONS])
    story.append(Paragraph(excl, s["body"]))
    # Tier-table templates (FARM) and restoration scopes have more vertical room on page 2 — open it up.
    if template.get("tier_table"):
        story.append(Spacer(1, 0.12 * inch))
    elif spread:
        story.append(Spacer(1, 0.14 * inch))
    else:
        story.append(Spacer(1, 0.08 * inch))

    appreciation_style = ParagraphStyle(
        "appreciation", parent=s["body"], alignment=1, fontName="Helvetica-Oblique",
    )
    story.append(Paragraph(
        "We appreciate your consideration of SealTech Building Solutions for your roofing investment. "
        "We are committed to delivering exceptional craftsmanship, transparency, and lasting value on every project we undertake.",
        appreciation_style,
    ))
    if template.get("tier_table"):
        story.append(Spacer(1, 0.08 * inch))
    elif spread:
        story.append(Spacer(1, 0.10 * inch))
    else:
        story.append(Spacer(1, 0.06 * inch))

    # Closing signature line — pulls directly from the logged-in user. No
    # auto-applied credentials: each rep is responsible for setting their own
    # name + credentials on their Profile page.
    sn = (signer_name or "").strip()
    sc = (signer_credentials or "").strip()
    signer_line = f"<b>{sn}{', ' + sc if (sn and sc) else ''}</b><br/>SealTech Building Solutions"
    sig = Table([
        [Paragraph(signer_line, s["body"]), ""],
    ], colWidths=[3.5 * inch, 4.0 * inch])
    story.append(sig)
    if template.get("tier_table"):
        story.append(Spacer(1, 0.06 * inch))
    elif spread:
        story.append(Spacer(1, 0.06 * inch))
    else:
        story.append(Spacer(1, 0.02 * inch))

    story.append(Paragraph("Acceptance Of Scope", s["h2"]))
    story.append(Paragraph(
        "The investment, specifications, and conditions stated above are satisfactory and are hereby accepted. "
        "SealTech Building Solutions is authorized to perform the work as specified. Payment will be made as outlined in the milestone schedule and Terms &amp; Conditions. "
        "&quot;Owner&quot; refers to the legal owner of the property or their duly authorized representative.",
        s["body"],
    ))
    story.append(Spacer(1, 0.10 * inch if spread else 0.06 * inch))

    accept_rows = [
        ["By:", "________________________________", "Title:", "________________________________"],
        ["Signature:", "________________________________", "Date:", "________________________________"],
    ]
    at = Table(accept_rows, colWidths=[0.7 * inch, 3.0 * inch, 0.6 * inch, 3.0 * inch])
    at.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("TEXTCOLOR", (0, 0), (-1, -1), DARK),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(at)
    story.append(PageBreak())

    # ---- Page 3: Terms & Conditions ----
    story.append(Paragraph("TERMS AND CONDITIONS", s["title"]))
    story.append(Paragraph(
        "The following terms and conditions are an integral part of this proposal and form a binding agreement upon acceptance. "
        "No representations or reliance on any statements not contained herein shall be binding upon SealTech Building Solutions.",
        s["tc_intro"],
    ))
    story.append(Spacer(1, 0.1 * inch))
    for head, body in TERMS:
        story.append(KeepTogether([
            Paragraph(head, s["tc_h"]),
            Paragraph(body, s["tc"]),
        ]))

    pdf.build(story, onFirstPage=_footer, onLaterPages=_footer)
    return buf.getvalue()


# Back-compat shim — existing callers still work, just renders silicone scope.
def build_silicone_spec(data: dict, cover_photo_bytes: bytes = None) -> bytes:
    return build_spec_sheet(data, cover_photo_bytes=cover_photo_bytes, roof_type="Silicone")
