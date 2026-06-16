"""Smart Library document suggestions for the Email Scope modal.

Given a deal's proposed_roof_type, this module returns a ranked list of library
file IDs that the CRM thinks the user is most likely to attach when emailing the
scope. The rules are hard-coded (a small, deterministic mapping; see RULES below)
PLUS opt-in extension via Library tags: any LibraryFile with a `smart_tags` list
containing the matching token also gets pulled in.

This is intentionally tiny: rules are explicit, easy to read, easy to update.
"""
from __future__ import annotations

from typing import List, Set, Dict, Optional


# Master matching tokens. Token-based so we don't tie ourselves to exact
# proposed_roof_type strings. Each deal-level value maps to a set of tokens.
#
# Library docs match by either:
#   - category/subcategory contains any of the recommended categories for the token
#   - LibraryFile.smart_tags contains the token
def _tokens_for(proposed_roof_type: str) -> Set[str]:
    p = (proposed_roof_type or "").lower()
    out: Set[str] = set(["general"])  # general docs (T&Cs, MSA, COI) match every roof type
    if "tpo" in p: out.update({"tpo", "single-ply", "thermoplastic"})
    if "pvc" in p: out.update({"pvc", "single-ply", "thermoplastic"})
    if "epdm" in p: out.update({"epdm", "single-ply", "rubber"})
    if "silicone" in p: out.update({"silicone", "restoration", "coating", "fluid-applied"})
    if "farm" in p or "fluid applied" in p or "fluid-applied" in p:
        out.update({"farm", "restoration", "fluid-applied"})
    if "modbit" in p or "bur" in p or "built-up" in p:
        out.update({"modbit", "bur", "asphaltic"})
    if "metal" in p: out.update({"metal"})
    if "tile" in p: out.update({"tile"})
    if "shingle" in p: out.update({"shingle", "steep-slope"})
    if "over-lay" in p or "overlay" in p: out.update({"overlay"})
    if "replacement" in p: out.update({"tear-off", "replacement"})
    if "construction" in p or "other" in p: out.update({"construction"})
    return out


# Category / subcategory matchers per token. A library file matches if its
# (category, subcategory) tuple intersects any rule for an active token.
RULES: Dict[str, List[Dict[str, str]]] = {
    "general": [
        {"category": "Contracts & Legal"},
        {"category": "Certificates & Credentials", "subcategory": "Insurance / COI"},
        {"category": "Certificates & Credentials", "subcategory": "Manufacturer Certifications"},
        {"category": "SealTech Documents", "subcategory": "Brochures"},
    ],
    "restoration": [
        {"category": "Western Colloid"},
        {"category": "Manufacturer Warranties", "subcategory": "Sample Warranties"},
        {"category": "SealTech Documents", "subcategory": "Property Owner Guides"},
    ],
    "fluid-applied": [
        {"category": "Western Colloid"},
        {"category": "Everest Systems"},
    ],
    "coating": [
        {"category": "Western Colloid"},
    ],
    "silicone": [
        {"category": "Western Colloid", "subcategory": "Specifications"},
        {"category": "Western Colloid", "subcategory": "Brochures"},
    ],
    "farm": [
        {"category": "Western Colloid", "subcategory": "Specifications"},
        {"category": "Everest Systems", "subcategory": "Specifications"},
    ],
    "tpo": [
        {"category": "Everest Systems"},
    ],
    "pvc": [
        {"category": "Everest Systems"},
    ],
    "epdm": [],
    "single-ply": [],
    "tear-off": [
        {"category": "SealTech Documents", "subcategory": "Property Owner Guides"},
    ],
    "construction": [
        {"category": "Contracts & Legal"},
    ],
}


def suggest_library_files(library_files: List[dict], deal: dict) -> Dict[str, list]:
    """Return {file_ids: [...], reasons: {file_id: [token1, token2]}}.

    Uses both the hard-coded RULES table and the per-file smart_tags extension.
    """
    proposed = deal.get("proposed_roof_type") or ""
    active_tokens = _tokens_for(proposed)

    file_ids: List[str] = []
    reasons: Dict[str, List[str]] = {}

    for f in library_files:
        if f.get("is_deleted"):
            continue
        cat = (f.get("category") or "").strip()
        sub = (f.get("subcategory") or "").strip()
        smart_tags = set((t or "").lower() for t in (f.get("smart_tags") or []))

        matched: List[str] = []
        # Smart tags first (user-curated wins)
        tag_hits = smart_tags & active_tokens
        if tag_hits:
            matched.extend(sorted(tag_hits))

        # Then the RULES table
        for token in active_tokens:
            for rule in RULES.get(token, []):
                if rule.get("category") and rule["category"] != cat:
                    continue
                if rule.get("subcategory") and rule["subcategory"] != sub:
                    continue
                if token not in matched:
                    matched.append(token)
                break

        if matched:
            file_ids.append(f["id"])
            reasons[f["id"]] = matched

    return {"file_ids": file_ids, "reasons": reasons, "tokens": sorted(active_tokens)}
