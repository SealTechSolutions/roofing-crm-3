// Mirror of backend/assessment_bands.py — must stay in sync.
// Each metric maps a 0–100 score to {label, color, sublabel}.

const GREEN_DARK = "#15803D";
const GREEN      = "#16A34A";
const AMBER      = "#D97706";
const ORANGE     = "#EA580C";
const RED        = "#B91C1C";
const GRAY       = "#71717A";

const unknown = () => ({ label: "—", color: GRAY, sublabel: "Not Scored" });

const toInt = (v) => {
  if (v == null || v === "") return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : null;
};

function bandCondition(score) {
  const n = toInt(score);
  if (n == null || n <= 0) return unknown();
  if (n >= 90) return { label: "Excellent",   color: GREEN_DARK, sublabel: `${n}/100` };
  if (n >= 75) return { label: "Good",        color: GREEN,      sublabel: `${n}/100` };
  if (n >= 60) return { label: "Serviceable", color: AMBER,      sublabel: `${n}/100` };
  if (n >= 40) return { label: "At Risk",     color: ORANGE,     sublabel: `${n}/100` };
  return        { label: "Critical",          color: RED,        sublabel: `${n}/100` };
}

function bandRSL(score) {
  const n = toInt(score);
  if (n == null || n < 0) return unknown();
  let color;
  if (n >= 15) color = GREEN_DARK;
  else if (n >= 10) color = GREEN;
  else if (n >= 5) color = AMBER;
  else if (n >= 2) color = ORANGE;
  else color = RED;
  const word = n === 1 ? "Year" : "Years";
  return { label: `${n} ${word}`, color, sublabel: "Remaining" };
}

function bandHighModLow(score) {
  const n = toInt(score);
  if (n == null || n <= 0) return unknown();
  if (n >= 75) return { label: "High",     color: GREEN, sublabel: `${n}/100` };
  if (n >= 50) return { label: "Moderate", color: AMBER, sublabel: `${n}/100` };
  return        { label: "Low",            color: RED,   sublabel: `${n}/100` };
}

function bandMaintenance(score) {
  const n = toInt(score);
  if (n == null || n <= 0) return unknown();
  if (n >= 80) return { label: "Current",  color: GREEN, sublabel: `${n}/100` };
  if (n >= 50) return { label: "Deferred", color: AMBER, sublabel: `${n}/100` };
  return        { label: "Poor",           color: RED,   sublabel: `${n}/100` };
}

function bandWarranty(score) {
  const n = toInt(score);
  if (n == null || n <= 0) return unknown();
  if (n >= 75) return { label: "Active",  color: GREEN, sublabel: `${n}/100` };
  if (n >= 50) return { label: "Limited", color: AMBER, sublabel: `${n}/100` };
  return        { label: "Expired",       color: RED,   sublabel: `${n}/100` };
}

function bandCapitalRisk(score) {
  // Inverted: higher score = higher risk.
  const n = toInt(score);
  if (n == null || n < 0) return unknown();
  if (n >= 80) return { label: "High",     color: RED,    sublabel: `${n}/100` };
  if (n >= 60) return { label: "Elevated", color: ORANGE, sublabel: `${n}/100` };
  if (n >= 30) return { label: "Moderate", color: AMBER,  sublabel: `${n}/100` };
  return        { label: "Low",            color: GREEN,  sublabel: `${n}/100` };
}

function bandRoofAssetScore(score) {
  const n = toInt(score);
  if (n == null || n <= 0) return unknown();
  let color, label;
  if (n >= 85) { color = GREEN_DARK; label = "Excellent"; }
  else if (n >= 70) { color = GREEN; label = "Good"; }
  else if (n >= 55) { color = AMBER; label = "Fair"; }
  else if (n >= 35) { color = ORANGE; label = "At Risk"; }
  else { color = RED; label = "Critical"; }
  return { label: String(n), color, sublabel: label };
}

const DISPATCH = {
  roof_asset_score:        bandRoofAssetScore,
  condition_rating:        bandCondition,
  remaining_service_life:  bandRSL,
  restoration_suitability: bandHighModLow,
  maintenance_status:      bandMaintenance,
  hail_resilience:         bandHighModLow,
  warranty_status:         bandWarranty,
  capital_risk:            bandCapitalRisk,
};

export function bandFor(metricKey, score) {
  const fn = DISPATCH[metricKey];
  return fn ? fn(score) : unknown();
}

export { GREEN_DARK, GREEN, AMBER, ORANGE, RED, GRAY };
