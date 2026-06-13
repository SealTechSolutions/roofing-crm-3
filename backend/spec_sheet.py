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
    "title": "FARM (FLUID APPLIED REINFORCED MEMBRANE) SCOPE",
    "scope_1_title": "Inspection and Substrate Prep",
    "scope_1": [
        "Survey substrate and document delaminations, splits, blisters, and failed flashings.",
        "Identify wet insulation via infrared survey or core cuts; remove and replace wet areas.",
        "Cut, patch, and repair all open seams, splits, and damaged membrane sections.",
        "Re-secure loose flashings, metal edge, and counter-flashings.",
        "Power-wash the entire roof surface; allow substrate to fully dry prior to application.",
    ],
    "scope_2_title": "Fluid Applied Reinforced Membrane Installation",
    "scope_2": [
        "Apply manufacturer-approved primer where required by the system specification.",
        "Apply tack coat of fluid applied membrane at specified rate.",
        "Fully embed reinforcing polyester fabric into wet base coat, rolling out all wrinkles and laps.",
        "Apply intermediate coat to fully encapsulate the reinforcing fabric at specified mil thickness.",
        "Apply top coat to manufacturer-specified dry mil thickness across the entire field.",
        "Reinforce all penetrations, drains, scuppers, and wall transitions with additional fabric plies.",
        "Final walk-through, water-test drains, and quality inspection with the owner.",
    ],
}


# Lookup table — keys are normalized (lower-cased, alphanumeric chunks)
# Maps roof_type → template dict
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
}


def _resolve_template(roof_type: str | None) -> dict:
    """Return the scope template matching the given roof_type label.

    Falls back to the silicone template if no match is found so that existing
    deals without a `proposed_roof_type` continue to render the original
    restoration scope.
    """
    if not roof_type:
        return SILICONE_TEMPLATE
    key = "".join(ch for ch in str(roof_type).lower() if ch.isalnum())
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


def _header_block(s, doc, template_title: str):
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
    title_centered = ParagraphStyle(
        "title_centered", parent=s["title"], alignment=1,
        fontSize=22, leading=26, spaceAfter=6,
    )
    elems.append(Paragraph(template_title, title_centered))
    elems.append(Spacer(1, 0.35 * inch))

    product_line = doc.get("product_type", "—")
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


def _pricing_table(s, doc):
    elems = []
    elems.append(Paragraph(
        f'{doc.get("product_type", "Roof System Investment")} <font size="9"><i>(Standard Warranty Included)</i></font>',
        s["h2"],
    ))
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
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("GRID", (0, 0), (-1, -1), 0.25, BORDER),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    elems.append(t)
    elems.append(Spacer(1, 0.12 * inch))

    elems.append(Paragraph("[OPTIONAL] Manufacturer Warranty (Labor &amp; Material)", s["h2"]))
    opt = [
        ["Warranty Tier", "Add-On Cost"],
        ["20-Year Labor & Material", _currency(doc.get("w20"))],
        ["15-Year Labor & Material", _currency(doc.get("w15"))],
        ["10-Year Labor & Material", _currency(doc.get("w10"))],
    ]
    t2 = Table(opt, colWidths=[4.5 * inch, 3.0 * inch])
    t2.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), BLUE), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"), ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 9), ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("GRID", (0, 0), (-1, -1), 0.25, BORDER),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]),
        ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    elems.append(t2)
    elems.append(Spacer(1, 0.12 * inch))

    elems.append(Paragraph("Total Investment with Optional Manufacturer Warranty", s["h2"]))
    tot = [
        ["Including 20-Year Upgraded Warranty", _currency((doc.get("opt_20") or 0) + (doc.get("w20") or 0))],
        ["Including 15-Year Upgraded Warranty", _currency((doc.get("opt_15") or 0) + (doc.get("w15") or 0))],
        ["Including 10-Year Upgraded Warranty", _currency((doc.get("opt_10") or 0) + (doc.get("w10") or 0))],
    ]
    t3 = Table(tot, colWidths=[4.5 * inch, 3.0 * inch])
    t3.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("TEXTCOLOR", (1, 0), (1, -1), BLUE),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("GRID", (0, 0), (-1, -1), 0.5, DARK),
        ("BACKGROUND", (0, 0), (-1, -1), LIGHT),
        ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    elems.append(t3)
    return elems


def _scope_block(s, title, items):
    elems = [Paragraph(title, s["h2"])]
    bullets = "<br/>".join([f"•&nbsp;&nbsp;{i}" for i in items])
    elems.append(Paragraph(bullets, s["body"]))
    return elems


def build_spec_sheet(data: dict, cover_photo_bytes: bytes = None, roof_type: str | None = None) -> bytes:
    """Build a SealTech-branded scope/spec sheet for the given roof type.

    `roof_type` selects which scope template to render. If omitted, falls back
    to the existing silicone restoration scope.
    """
    template = _resolve_template(roof_type or data.get("roof_type_label"))

    buf = BytesIO()
    pdf = SimpleDocTemplate(buf, pagesize=letter,
                            leftMargin=0.5 * inch, rightMargin=0.5 * inch,
                            topMargin=0.6 * inch, bottomMargin=0.8 * inch,
                            title=template["title"].title())
    s = _styles()
    story = []

    # ---- Page 1: Header + Pricing ----
    story.extend(_header_block(s, data, template["title"]))
    story.extend(_pricing_table(s, data))
    story.append(PageBreak())

    # ---- Page 2: Scope ----
    story.extend(_scope_block(s, template["scope_1_title"], template["scope_1"]))
    story.append(Spacer(1, 0.05 * inch))
    story.extend(_scope_block(s, template["scope_2_title"], template["scope_2"]))
    story.append(Spacer(1, 0.06 * inch))

    story.append(Paragraph("Inclusions", s["h2"]))
    total_sqft = data.get("total_sqft", 0) or 0
    sq = int(round(total_sqft / 100))
    color = data.get("color", "white")
    label = data.get("roof_type_label") or (roof_type or "roof system")
    inc_text = f"Approximately {total_sqft:,.0f} SF ({sq} SQ) {color} {label} system, including walls and flashings."
    story.append(Paragraph(inc_text, s["body"]))
    story.append(Spacer(1, 0.06 * inch))

    # Cover photo
    if cover_photo_bytes:
        try:
            img = Image(BytesIO(cover_photo_bytes), width=7.0 * inch, height=1.2 * inch, kind="proportional")
            story.append(img)
        except Exception:
            story.append(Paragraph("<i>Cover photo could not be embedded.</i>", s["small"]))
    else:
        ph = Table([[" "]], colWidths=[7.0 * inch], rowHeights=[1.2 * inch])
        ph.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.5, BORDER), ("BACKGROUND", (0, 0), (-1, -1), LIGHT)]))
        story.append(ph)
        story.append(Paragraph("Cover photo placeholder — upload a Photo to this project and mark it as Cover.", s["small"]))
    story.append(Spacer(1, 0.06 * inch))

    story.append(Paragraph("Exclusions", s["h2"]))
    excl = "<br/>".join([f"•&nbsp;&nbsp;{e}" for e in EXCLUSIONS])
    story.append(Paragraph(excl, s["body"]))
    story.append(Spacer(1, 0.08 * inch))

    appreciation_style = ParagraphStyle(
        "appreciation", parent=s["body"], alignment=1, fontName="Helvetica-Oblique",
    )
    story.append(Paragraph(
        "We appreciate your consideration of SealTech Building Solutions for your roofing investment. "
        "We are committed to delivering exceptional craftsmanship, transparency, and lasting value on every project we undertake.",
        appreciation_style,
    ))
    story.append(Spacer(1, 0.06 * inch))

    sig = Table([
        [Paragraph("<b>Darren Oliver, CSI, IIBEC</b><br/>GM, SealTech Building Solutions", s["body"]), ""],
    ], colWidths=[3.5 * inch, 4.0 * inch])
    story.append(sig)
    story.append(Spacer(1, 0.02 * inch))

    story.append(Paragraph("Acceptance Of Scope", s["h2"]))
    story.append(Paragraph(
        "The investment, specifications, and conditions stated above are satisfactory and are hereby accepted. "
        "SealTech Building Solutions is authorized to perform the work as specified. Payment will be made as outlined in the milestone schedule and Terms &amp; Conditions. "
        "&quot;Owner&quot; refers to the legal owner of the property or their duly authorized representative.",
        s["body"],
    ))
    story.append(Spacer(1, 0.06 * inch))

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
