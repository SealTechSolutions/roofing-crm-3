"""Executive-friendly band labels for Roof Asset Dashboard™ metrics.

Each metric stores a numeric 0–100 score, but the printed/presented form is a
categorical band (e.g., "Good", "At Risk") that maps to a color. This module
centralizes the band rules so the PDF, API responses, and the frontend list
view all agree.

Semantic note: most metrics read "higher = better". `capital_risk` is intentionally
inverted (higher score = higher risk) per the report's executive convention.

For `remaining_service_life`, the score IS the years remaining (0–50ish range);
the band label is the formatted string e.g. "7 Years Remaining".
"""
from __future__ import annotations

from typing import Optional, TypedDict

# Hex tokens shared with PDF + frontend
COLOR_GREEN_DARK = "#15803D"   # Excellent
COLOR_GREEN = "#16A34A"        # Good / High / Active / Current / Low Risk
COLOR_AMBER = "#D97706"        # Serviceable / Moderate / Limited / Deferred / Elevated
COLOR_ORANGE = "#EA580C"       # At Risk
COLOR_RED = "#B91C1C"          # Critical / Low / Expired / Poor / High Risk
COLOR_GRAY = "#71717A"         # Unknown / not yet documented


class Band(TypedDict):
    label: str        # Headline ("Good", "Active", "7 Years Remaining")
    color: str        # Hex color for the tile background / pill text
    sublabel: str     # Small text under the headline (usually "{score}/100" or "" for RSL)


def _score(value) -> Optional[int]:
    try:
        if value is None or value == "":
            return None
        return int(round(float(value)))
    except (TypeError, ValueError):
        return None


def _unknown(score) -> Band:
    return {"label": "—", "color": COLOR_GRAY, "sublabel": "Not Scored"}


def band_condition(score) -> Band:
    n = _score(score)
    if n is None or n <= 0:
        return _unknown(score)
    if n >= 90:
        return {"label": "Excellent", "color": COLOR_GREEN_DARK, "sublabel": f"{n}/100"}
    if n >= 75:
        return {"label": "Good", "color": COLOR_GREEN, "sublabel": f"{n}/100"}
    if n >= 60:
        return {"label": "Serviceable", "color": COLOR_AMBER, "sublabel": f"{n}/100"}
    if n >= 40:
        return {"label": "At Risk", "color": COLOR_ORANGE, "sublabel": f"{n}/100"}
    return {"label": "Critical", "color": COLOR_RED, "sublabel": f"{n}/100"}


def band_remaining_service_life(score) -> Band:
    """RSL: score IS years remaining."""
    n = _score(score)
    if n is None or n < 0:
        return _unknown(score)
    if n >= 15:
        color = COLOR_GREEN_DARK
    elif n >= 10:
        color = COLOR_GREEN
    elif n >= 5:
        color = COLOR_AMBER
    elif n >= 2:
        color = COLOR_ORANGE
    else:
        color = COLOR_RED
    word = "Year" if n == 1 else "Years"
    return {"label": f"{n} {word}", "color": color, "sublabel": "Remaining"}


def band_restoration_suitability(score) -> Band:
    n = _score(score)
    if n is None or n <= 0:
        return _unknown(score)
    if n >= 75:
        return {"label": "High", "color": COLOR_GREEN, "sublabel": f"{n}/100"}
    if n >= 50:
        return {"label": "Moderate", "color": COLOR_AMBER, "sublabel": f"{n}/100"}
    return {"label": "Low", "color": COLOR_RED, "sublabel": f"{n}/100"}


def band_maintenance_status(score) -> Band:
    n = _score(score)
    if n is None or n <= 0:
        return _unknown(score)
    if n >= 80:
        return {"label": "Current", "color": COLOR_GREEN, "sublabel": f"{n}/100"}
    if n >= 50:
        return {"label": "Deferred", "color": COLOR_AMBER, "sublabel": f"{n}/100"}
    return {"label": "Poor", "color": COLOR_RED, "sublabel": f"{n}/100"}


def band_hail_resilience(score) -> Band:
    n = _score(score)
    if n is None or n <= 0:
        return _unknown(score)
    if n >= 75:
        return {"label": "High", "color": COLOR_GREEN, "sublabel": f"{n}/100"}
    if n >= 50:
        return {"label": "Moderate", "color": COLOR_AMBER, "sublabel": f"{n}/100"}
    return {"label": "Low", "color": COLOR_RED, "sublabel": f"{n}/100"}


def band_warranty_status(score) -> Band:
    n = _score(score)
    if n is None or n <= 0:
        return _unknown(score)
    if n >= 75:
        return {"label": "Active", "color": COLOR_GREEN, "sublabel": f"{n}/100"}
    if n >= 50:
        return {"label": "Limited", "color": COLOR_AMBER, "sublabel": f"{n}/100"}
    return {"label": "Expired", "color": COLOR_RED, "sublabel": f"{n}/100"}


def band_capital_risk(score) -> Band:
    """Inverted semantic: higher score = HIGHER risk = worse."""
    n = _score(score)
    if n is None or n < 0:
        return _unknown(score)
    if n >= 80:
        return {"label": "High", "color": COLOR_RED, "sublabel": f"{n}/100"}
    if n >= 60:
        return {"label": "Elevated", "color": COLOR_ORANGE, "sublabel": f"{n}/100"}
    if n >= 30:
        return {"label": "Moderate", "color": COLOR_AMBER, "sublabel": f"{n}/100"}
    return {"label": "Low", "color": COLOR_GREEN, "sublabel": f"{n}/100"}


def band_roof_asset_score(score) -> Band:
    """Composite stays numeric — band only used for header color."""
    n = _score(score)
    if n is None or n <= 0:
        return _unknown(score)
    if n >= 85:
        color, label = COLOR_GREEN_DARK, "Excellent"
    elif n >= 70:
        color, label = COLOR_GREEN, "Good"
    elif n >= 55:
        color, label = COLOR_AMBER, "Fair"
    elif n >= 35:
        color, label = COLOR_ORANGE, "At Risk"
    else:
        color, label = COLOR_RED, "Critical"
    return {"label": str(n), "color": color, "sublabel": label}


# Single dispatch — used by frontend list view + assessment payload
_DISPATCH = {
    "roof_asset_score": band_roof_asset_score,
    "condition_rating": band_condition,
    "remaining_service_life": band_remaining_service_life,
    "restoration_suitability": band_restoration_suitability,
    "maintenance_status": band_maintenance_status,
    "hail_resilience": band_hail_resilience,
    "warranty_status": band_warranty_status,
    "capital_risk": band_capital_risk,
}


def band_for(metric_key: str, score) -> Band:
    fn = _DISPATCH.get(metric_key)
    if not fn:
        return _unknown(score)
    return fn(score)


def all_bands(assessment: dict) -> dict:
    """Given an assessment dict, return {metric_key: Band} for the 8 dashboard metrics."""
    out = {}
    for key in _DISPATCH:
        sc = assessment.get(key) or {}
        if isinstance(sc, dict):
            out[key] = band_for(key, sc.get("score"))
        else:
            out[key] = band_for(key, sc)
    return out
