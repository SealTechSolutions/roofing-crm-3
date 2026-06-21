/**
 * Material Calculator — Milestone 2 of the Product Catalog roadmap.
 *
 * Pick 1–4 named systems side-by-side, enter the roof's total SF, toggle
 * a waste factor + optional add-ons (walk-pads, primer/wash, etc.), and
 * the page computes:
 *
 *   1. Raw quantities per recipe line (`coverage_rate × sf / 100` for
 *      `per_100sf` basis), bumped by waste %.
 *   2. The optimal mix of WC container sizes (tote → drum → pail) to
 *      cover that quantity. Greedy: fill the biggest first, then the
 *      next size for remaining whole-container chunks, then the smallest
 *      for the final remainder.
 *   3. Raw subtotal, +markup, +handling = customer-facing price.
 *
 * Markup math (matches calculator_settings):
 *      cost      = sum(container_count × container_price)
 *      marked_up = cost × (1 + markup_pct/100)         # 15% default
 *      handling  = marked_up × (handling_pct/100)      # 10% default,
 *                                                       compounded on
 *                                                       marked-up total
 *      customer  = marked_up + handling
 *
 * Deal hand-off (Milestone 3): when the page is opened with
 * `?deal=<id>` (e.g. via the “Pull from Calculator” button on
 * Deal Detail’s Vendor Cost section), the chosen system’s BoM lines
 * are PUT back to that deal as `cost_items` with category="Materials".
 */
import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { api, formatCurrency, formatApiError } from "@/lib/api";
import { toast } from "sonner";
import { Calculator as CalcIcon, Plus, X, Save, ChevronLeft, Layers, AlertCircle, Loader2, FileText, Download, PenLine } from "lucide-react";

const ADDON_TEMPLATES = [
  // Walk-pads
  { id: "walk_pads_grey",   label: "Walk Pads (Grey)",         sku: "850 SWS Grey",   unit: "gal",   default_qty: 0 },
  { id: "walk_pads_yellow", label: "Walk Pads (Burnt Yellow)", sku: "850 SWS Yellow", unit: "gal",   default_qty: 0 },
  // Prep / sealants
  { id: "roof_wash",        label: "Roof Wash & Prep",         sku: "9000",           unit: "gal",   default_qty: 0 },
  { id: "flash_cement_w",   label: "Elastic Cement White",     sku: "800 W",          unit: "gal",   default_qty: 0 },
  { id: "flash_cement_b",   label: "Elastic Cement Black",     sku: "801 B",          unit: "gal",   default_qty: 0 },
  // Reinforcing fabric strips (sold by the roll — qty here is # of rolls)
  { id: "fabric_4in",       label: 'Fabric 4" x 300\'',        sku: '4" x 300\'',     unit: "rolls", default_qty: 0 },
  { id: "fabric_6in",       label: 'Fabric 6" x 300\'',        sku: '6" x 300\'',     unit: "rolls", default_qty: 0 },
  { id: "fabric_12in",      label: 'Fabric 12" x 300\'',       sku: '12" x 300\'',    unit: "rolls", default_qty: 0 },
  { id: "fabric_20in",      label: 'Fabric 20" x 300\'',       sku: '20" x 300\'',    unit: "rolls", default_qty: 0 },
];

// Everest-specific add-ons (Silkoxy Patch / Flashing Grade, EcoLevel, EverStitch
// fabric strips, Silkoxy Ever-Tread Walk Pad) plus SESCO granules — only shown
// in the sidebar when the selected vendor is Everest Systems. Each item maps to
// a real product_catalog row by `match` (vendor + name contains). Granule rows
// trigger a flat $2,000 SESCO freight surcharge on the column (added once if
// any granule qty > 0).
const EVEREST_ADDON_TEMPLATES = [
  // EcoLevel (slope-correction kits)
  { id: "ev_ecolevel_2_5",  label: "EcoLevel — 2.5 Gal Kit",   match: { vendor: "Everest Systems", name_includes: "EcoLevel — 2.5 Gallon Kit" }, unit: "kit",  default_qty: 0 },
  { id: "ev_ecolevel_4",    label: "EcoLevel — 4 Gal Kit",     match: { vendor: "Everest Systems", name_includes: "EcoLevel — 4 Gallon Kit" },   unit: "kit",  default_qty: 0 },
  // EverStitch reinforcing fabric (per roll)
  { id: "ev_stitch_4",   label: 'EverStitch 272 — 4" x 300\'',  match: { vendor: "Everest Systems", name_includes: 'EverStitch 272 — 4"' },  unit: "roll", default_qty: 0 },
  { id: "ev_stitch_6",   label: 'EverStitch 272 — 6" x 300\'',  match: { vendor: "Everest Systems", name_includes: 'EverStitch 272 — 6"' },  unit: "roll", default_qty: 0 },
  { id: "ev_stitch_12",  label: 'EverStitch 272 — 12" x 300\'', match: { vendor: "Everest Systems", name_includes: 'EverStitch 272 — 12"' }, unit: "roll", default_qty: 0 },
  { id: "ev_stitch_20",  label: 'EverStitch 272 — 20" x 300\'', match: { vendor: "Everest Systems", name_includes: 'EverStitch 272 — 20"' }, unit: "roll", default_qty: 0 },
  { id: "ev_stitch_39",  label: 'EverStitch 272 — 39" x 300\'', match: { vendor: "Everest Systems", name_includes: 'EverStitch 272 — 39"' }, unit: "roll", default_qty: 0 },
  { id: "ev_stitch_40",  label: 'EverStitch 272 — 40" x 324\'', match: { vendor: "Everest Systems", name_includes: 'EverStitch 272 — 40"' }, unit: "roll", default_qty: 0 },
  // Silkoxy field add-ons
  { id: "ev_flashing_2",  label: "Silkoxy Flashing Grade — 2 Gal", match: { vendor: "Everest Systems", name_includes: "Silkoxy Flashing Grade — 2 Gal" }, unit: "pail", default_qty: 0 },
  { id: "ev_flashing_5",  label: "Silkoxy Flashing Grade — 5 Gal", match: { vendor: "Everest Systems", name_includes: "Silkoxy Flashing Grade — 5 Gal" }, unit: "pail", default_qty: 0 },
  { id: "ev_patch_2",     label: "Silkoxy Patch — 2 Gal",          match: { vendor: "Everest Systems", name_includes: "Silkoxy Patch — 2 Gal" },          unit: "pail", default_qty: 0 },
  { id: "ev_patch_5",     label: "Silkoxy Patch — 5 Gal",          match: { vendor: "Everest Systems", name_includes: "Silkoxy Patch — 5 Gal" },          unit: "pail", default_qty: 0 },
  { id: "ev_ever_tread",  label: "Silkoxy Ever-Tread Walk Pad",    match: { vendor: "Everest Systems", name_includes: "Ever-Tread Walk Pad" },            unit: "roll", default_qty: 0 },
  // SESCO granules — Sealtech orders by the PALLET (qty here = pallets). The
  // backing product_catalog rows are stored as 1 pallet = $bags_per_pallet ×
  // $/bag (e.g. BUFF = 56 × $8 = $448/pallet). Triggers $2,000 LTL freight.
  { id: "sesco_buff",        label: "Granules — Buff (56 bags/pallet)",      match: { vendor: "SESCO", name_includes: "buff" },        unit: "pallet", isGranule: true, default_qty: 0 },
  { id: "sesco_brown",       label: "Granules — Brown (30 bags/pallet)",     match: { vendor: "SESCO", name_includes: "brown" },       unit: "pallet", isGranule: true, default_qty: 0 },
  { id: "sesco_rainbow",     label: "Granules — Rainbow (30 bags/pallet)",   match: { vendor: "SESCO", name_includes: "rainbow" },     unit: "pallet", isGranule: true, default_qty: 0 },
  { id: "sesco_6_10_white",  label: "Granules — 6/10 White (56 bags/pallet)",match: { vendor: "SESCO", name_includes: "6/10 white" },  unit: "pallet", isGranule: true, default_qty: 0 },
  { id: "sesco_snow_white",  label: "Granules — Snow White (63 bags/pallet)",match: { vendor: "SESCO", name_includes: "snow white" },  unit: "pallet", isGranule: true, default_qty: 0 },
];

// Flat freight surcharge applied once per column when any SESCO granule line
// has qty > 0. Set by SESCO's published LTL rate.
const SESCO_GRANULE_FREIGHT = 2000;

// One-click "stress points bundle" — typical fabric strip qty for a smaller
// commercial roof (penetrations, edges, drains). Tweak via the inputs after.
const STRESS_POINTS_PRESET = {
  fabric_4in:  1,
  fabric_6in:  2,
  fabric_12in: 1,
};

// Persisted UI preferences key in localStorage.
const PREFS_KEY = "calc:prefs:v1";

function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function savePrefs(prefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* ignore quota errors */ }
}

const MAX_COMPARE = 3;

/** Classify a product's package size into a coarse "container kind" so we
 *  can let the user veto tote / drum / pail delivery based on site access. */
function classifyContainer(p) {
  if ((p.unit || "").toLowerCase() === "roll") return "roll";
  const s = Number(p.package_size || 0);
  if (s >= 200) return "tote";
  if (s >= 30)  return "drum";
  return "pail";
}

/** Group products by their (vendor, sku) — each "logical" product can have
 *  multiple container-size SKUs (5-gal pail / 55-gal drum / 275-gal tote). */
function groupBySku(products) {
  const map = new Map();
  for (const p of products) {
    const key = `${p.vendor}||${p.sku}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(p);
  }
  for (const arr of map.values()) arr.sort((a, b) => b.package_size - a.package_size);
  return map;
}

/** Greedy fill of `qtyNeeded` units across the given containers (sorted big→small).
 *  Returns [{product, qty (= # of THIS container), gallons (= qty × pkg_size), cost}]. */
function packContainers(qtyNeeded, containers) {
  const out = [];
  let remaining = qtyNeeded;
  // Floating-point safety: snap a number to its nearest integer when within
  // an epsilon (otherwise 5.000076 ceils to 6 instead of the obvious 5).
  const snap = (n) => {
    const r = Math.round(n);
    return Math.abs(n - r) < 1e-4 ? r : n;
  };
  for (let i = 0; i < containers.length; i++) {
    const c = containers[i];
    const isLast = i === containers.length - 1;
    if (remaining <= 0) break;
    let count;
    const ratio = snap(remaining / c.package_size);
    if (isLast) {
      // Round UP for the final (smallest) container so we always cover the qty.
      count = Math.ceil(ratio);
    } else {
      // For larger containers, only buy "whole" ones that don't overshoot.
      count = Math.floor(ratio);
    }
    if (count > 0) {
      const gallons = count * c.package_size;
      const cost = count * (c.unit_price * c.package_size);
      out.push({ product: c, qty: count, gallons, cost });
      remaining = snap(remaining - gallons);
    }
  }
  return out;
}

function bandWarrantyLabel(years) {
  if (!years) return "";
  return `${years}-Year`;
}

export default function Calculator() {
  const [params, setParams] = useSearchParams();
  const initialDealId = params.get("deal");

  const [products, setProducts] = useState([]);
  const [systems, setSystems] = useState([]);
  const [recipes, setRecipes] = useState({}); // {system_id: [recipe_rows]}
  const [settings, setSettings] = useState({ markup_pct: 15, handling_pct: 10, handling_basis: "marked_up", waste_pct: 0, overhead_pct: 10, profit_pct: 10 });
  const [loading, setLoading] = useState(true);

  // Persisted prefs (loaded once on mount via the lazy initialiser).
  const initialPrefs = loadPrefs() || {};
  const [selectedVendor, setSelectedVendor] = useState(initialPrefs.vendor || "Western Colloid");
  const [totalSf, setTotalSf] = useState("");
  const [waste, setWaste] = useState(initialPrefs.waste ?? 0);
  const [allowedSizes, setAllowedSizes] = useState(initialPrefs.allowedSizes || { tote: true, drum: true, pail: true });
  const [selectedSystemIds, setSelectedSystemIds] = useState([]);
  const [addons, setAddons] = useState({});      // {addon_id: qty} (shared across compared systems)
  // Per-warranty-band labor dollar amount. Rep types this per job — different
  // every roof. Map: {25: 6300, 20: 5800, 15: 4500, 10: 3500}. Persisted to the
  // deal as labor_25yr_add / _20yr_add / _15yr_add / _10yr_add when "Set" fires.
  const [laborByWarranty, setLaborByWarranty] = useState({});
  // Per-warranty OH and Profit % overrides (default to global settings).
  // Stored on the deal as overhead_25yr_pct / profit_25yr_pct etc.
  const [overheadByWarranty, setOverheadByWarranty] = useState({});
  const [profitByWarranty,   setProfitByWarranty]   = useState({});
  // Per-warranty NDL (No-Dollar-Limit) toggle — Everest Systems only. Standard
  // Everest warranty = $1,000 flat, NDL = $3,500 flat, both regardless of roof
  // size. Persisted to the deal as warranty_*_ndl booleans.
  const [ndlByWarranty, setNdlByWarranty] = useState({});

  const [deals, setDeals] = useState([]);
  const [selectedDealId, setSelectedDealId] = useState(initialDealId || "");
  const [deal, setDeal] = useState(null);
  const [savingToDeal, setSavingToDeal] = useState(false);
  const [generatingPo, setGeneratingPo] = useState(false);
  // "estimate" = pre-signature compare; "materials" = post-signature push-to-PO.
  // Default auto-switches based on whether the chosen deal has scope_signed_at.
  const [mode, setMode] = useState("estimate");

  // Save prefs whenever the user changes a "remembered" setting
  useEffect(() => {
    savePrefs({ vendor: selectedVendor, waste, allowedSizes });
  }, [selectedVendor, waste, allowedSizes]);

  useEffect(() => {
    Promise.all([
      api.get("/products"),
      api.get("/systems"),
      api.get("/calculator/settings"),
      api.get("/deals"),
    ]).then(([p, s, st, dl]) => {
      setProducts(p.data || []);
      setSystems(s.data || []);
      setSettings((prev) => ({ ...prev, ...(st.data || {}) }));
      // Only override waste from settings if there is no localStorage pref
      if (initialPrefs.waste === undefined) {
        setWaste(Number((st.data || {}).waste_pct || 0));
      }
      // Sort deals by most-recently-updated first, drop trashed/test-only ones to bottom
      const dealsList = (dl.data || [])
        .filter((d) => !d.is_deleted)
        .sort((a, b) => {
          const ad = a.updated_at || a.created_at || "";
          const bd = b.updated_at || b.created_at || "";
          return bd.localeCompare(ad);
        });
      setDeals(dealsList);
    }).catch((e) => toast.error(formatApiError(e?.response?.data?.detail) || e.message))
      .finally(() => setLoading(false));
  }, []);

  // Load the picked deal whenever the dropdown changes
  useEffect(() => {
    if (!selectedDealId) {
      setDeal(null);
      return;
    }
    api.get(`/deals/${selectedDealId}`).then(async (r) => {
      setDeal(r.data);
      // Pre-fill the per-warranty labor + OH/P inputs from whatever the rep
      // saved last time on this deal (mirrors how warranty_*_add is persisted).
      const numOrUndef = (v) => (v === null || v === undefined || v === "") ? undefined : Number(v);
      setLaborByWarranty({
        25: Number(r.data.labor_25yr_add || 0),
        20: Number(r.data.labor_20yr_add || 0),
        15: Number(r.data.labor_15yr_add || 0),
        10: Number(r.data.labor_10yr_add || 0),
      });
      setOverheadByWarranty({
        25: numOrUndef(r.data.overhead_25yr_pct),
        20: numOrUndef(r.data.overhead_20yr_pct),
        15: numOrUndef(r.data.overhead_15yr_pct),
        10: numOrUndef(r.data.overhead_10yr_pct),
      });
      setProfitByWarranty({
        25: numOrUndef(r.data.profit_25yr_pct),
        20: numOrUndef(r.data.profit_20yr_pct),
        15: numOrUndef(r.data.profit_15yr_pct),
        10: numOrUndef(r.data.profit_10yr_pct),
      });
      setNdlByWarranty({
        25: !!r.data.warranty_25yr_ndl,
        20: !!r.data.warranty_20yr_ndl,
        15: !!r.data.warranty_15yr_ndl,
        10: !!r.data.warranty_10yr_ndl,
      });
      // Auto-switch to Materials & PO mode if the customer has signed off
      // (Darren can manually toggle back to Estimate if needed).
      if (r.data.scope_signed_at) setMode("materials");
      else setMode("estimate");
      // Smart SF fallback: deal.property_sqft -> property record's roof_area
      let sf = r.data.property_sqft || r.data.total_sf;
      if (!sf && r.data.property_id) {
        try {
          const pr = await api.get(`/properties/${r.data.property_id}`);
          sf = pr.data?.roof_area || pr.data?.square_footage;
        } catch { /* ignore */ }
      }
      if (sf) setTotalSf(String(sf));
      // Keep ?deal=<id> in the URL in sync so refresh keeps the selection
      const next = new URLSearchParams(params);
      next.set("deal", selectedDealId);
      setParams(next, { replace: true });
    }).catch(() => setDeal(null));
  }, [selectedDealId]);

  const productById = useMemo(() => {
    const m = {};
    for (const p of products) m[p.id] = p;
    return m;
  }, [products]);

  const groupedBySku = useMemo(() => groupBySku(products), [products]);

  const toggleSystem = async (sysId) => {
    if (selectedSystemIds.includes(sysId)) {
      setSelectedSystemIds(selectedSystemIds.filter((x) => x !== sysId));
      return;
    }
    if (selectedSystemIds.length >= MAX_COMPARE) {
      toast.warning(`Compare up to ${MAX_COMPARE} systems at a time`);
      return;
    }
    setSelectedSystemIds([...selectedSystemIds, sysId]);
    if (!recipes[sysId]) {
      try {
        const r = await api.get(`/systems/${sysId}/recipe`);
        setRecipes((prev) => ({ ...prev, [sysId]: r.data || [] }));
      } catch (e) {
        toast.error("Could not load recipe");
      }
    }
  };

  /** Compute a full Bill-of-Materials column for one system. */
  const computeBom = (system) => {
    const sf = Number(totalSf) || 0;
    const waste_factor = 1 + (Number(waste) || 0) / 100;
    const recipe = recipes[system.id] || [];
    const lines = [];
    for (const r of recipe) {
      const product = productById[r.product_id];
      if (!product) continue;
      // Resolve qty needed based on coverage basis
      let qtyNeeded = 0;
      if (r.coverage_basis === "per_100sf") qtyNeeded = (sf / 100) * Number(r.coverage_rate || 0);
      else if (r.coverage_basis === "per_sf") qtyNeeded = sf * Number(r.coverage_rate || 0);
      else if (r.coverage_basis === "per_each_optional") qtyNeeded = Number(r.coverage_rate || 0);
      else if (r.coverage_basis === "per_lf") qtyNeeded = Number(r.coverage_rate || 0);
      qtyNeeded = qtyNeeded * waste_factor;

      // Container packing across sibling SKUs (same vendor + sku), filtered
      // by what containers the site can physically accept.
      const key = `${product.vendor}||${product.sku}`;
      const siblings = groupedBySku.get(key) || [product];
      const containers = siblings.filter((c) => {
        const k = classifyContainer(c);
        if (k === "roll") return true;        // fabric is unaffected by tote/drum/pail toggles
        return allowedSizes[k];
      });
      // Safety net: if every allowed size was filtered out (e.g. only pails
      // available but pails disabled), fall back to siblings so we still
      // surface a number rather than silently dropping the line.
      const useContainers = containers.length > 0 ? containers : siblings;
      const packed = packContainers(qtyNeeded, useContainers);
      const lineCost = packed.reduce((s, x) => s + x.cost, 0);
      const lineQty  = packed.reduce((s, x) => s + x.gallons, 0);
      lines.push({
        recipe_row: r,
        product, qtyNeeded, qtyPacked: lineQty,
        packed, lineCost,
      });
    }

    // Apply add-ons (shared across all systems). Each entry in `addons` maps an
    // addon-template id to a qty. Two template families exist:
    //   - ADDON_TEMPLATES         → SKU-based (Western Colloid)
    //   - EVEREST_ADDON_TEMPLATES → vendor+name-based (Everest + SESCO granules)
    const addonLines = [];
    let granuleQtyTotal = 0;
    for (const [aid, qty] of Object.entries(addons)) {
      if (!qty || qty <= 0) continue;
      const evTpl = EVEREST_ADDON_TEMPLATES.find((a) => a.id === aid);
      const tpl = evTpl || ADDON_TEMPLATES.find((a) => a.id === aid);
      if (!tpl) continue;
      // Resolve the catalog row(s) backing this add-on.
      let matching;
      if (evTpl) {
        const v = (evTpl.match.vendor || "").toLowerCase();
        const n = (evTpl.match.name_includes || "").toLowerCase();
        matching = products.filter(
          (p) => (p.vendor || "").toLowerCase() === v &&
                 (p.name   || "").toLowerCase().includes(n)
        );
      } else {
        matching = products.filter((p) => p.sku === tpl.sku);
      }
      if (matching.length === 0) continue;
      const filtered = matching.filter((c) => {
        const k = classifyContainer(c);
        if (k === "roll") return true;
        return allowedSizes[k];
      });
      const containers = (filtered.length ? filtered : matching).slice().sort((a, b) => b.package_size - a.package_size);
      const packed = packContainers(Number(qty), containers);
      const lineCost = packed.reduce((s, x) => s + x.cost, 0);
      const lineQty  = packed.reduce((s, x) => s + x.gallons, 0);
      addonLines.push({
        addon: tpl, qtyNeeded: Number(qty), qtyPacked: lineQty, packed, lineCost,
      });
      if (evTpl && evTpl.isGranule) granuleQtyTotal += Number(qty);
    }
    // SESCO LTL freight — flat $2,000 per column when ANY granule is ordered.
    if (granuleQtyTotal > 0) {
      addonLines.push({
        addon: { id: "sesco_freight", label: "SESCO Granule Freight (LTL)", unit: "flat" },
        qtyNeeded: 1, qtyPacked: 1,
        packed: [{ qty: 1, gallons: 0, cost: SESCO_GRANULE_FREIGHT,
                   product: { name: "SESCO LTL Freight", vendor: "SESCO",
                              unit: "flat", package_size: 1 } }],
        lineCost: SESCO_GRANULE_FREIGHT,
      });
    }

    const rawCost = lines.reduce((s, l) => s + l.lineCost, 0) + addonLines.reduce((s, l) => s + l.lineCost, 0);
    const markedUp = rawCost * (1 + settings.markup_pct / 100);
    const handlingBase = settings.handling_basis === "raw" ? rawCost : markedUp;
    const handling = handlingBase * (settings.handling_pct / 100);
    // Warranty up-charge — Everest gets vendor-specific pricing; other vendors
    // read the rep-entered flat $ from the deal.
    //   Standard: $1,000 flat (any band — no inspection). ALWAYS included in
    //             the customer's base price on Everest jobs.
    //   NDL:      $3,000 third-party inspection + per-SF rate based on warranty
    //             band ($0.06/SF @ 10-yr, $0.09/SF @ 15-yr, $0.12/SF @ 20-yr).
    //             Shown to the customer as an OPTIONAL upgrade — never folded
    //             into the base price. 5-yr has no NDL.
    const WARRANTY_ADD_FIELD = { 25: "warranty_25yr_add", 20: "warranty_20yr_add",
                                  15: "warranty_15yr_add", 10: "warranty_10yr_add" };
    const NDL_PER_SF = { 10: 0.06, 15: 0.09, 20: 0.12 };
    const isEverest = (system.vendor || "").toLowerCase().includes("everest");
    const ndlAvailable = isEverest && (system.warranty_years in NDL_PER_SF);
    const isNdl = ndlAvailable && !!ndlByWarranty[system.warranty_years];

    // Standard warranty $ — what's baked into the base customer price.
    const standardWarranty = isEverest ? 1000 : (
      (deal && WARRANTY_ADD_FIELD[system.warranty_years])
        ? Number(deal[WARRANTY_ADD_FIELD[system.warranty_years]] || 0)
        : 0
    );
    // Raw NDL surcharge (before OH+Profit) — only present on Everest jobs.
    const ndlSurchargeRaw = ndlAvailable ? (3000 + (NDL_PER_SF[system.warranty_years] || 0) * sf - 1000) : 0;
    // Display warranty row label drives off the toggle (Standard vs NDL),
    // but the base price math always uses Standard.
    const warrantyAdd = isEverest ? standardWarranty : standardWarranty;
    // Labor — per-warranty input the rep types on each column. Stored in
    // laborByWarranty state and persisted to deal.labor_*_add on save.
    const laborAdd = Number(laborByWarranty[system.warranty_years] || 0);
    // Per-column Overhead / Profit % (fall back to global Settings defaults if
    // the per-column override is undefined). 0% IS a valid override → don't
    // collapse with `||`.
    const ohPct = overheadByWarranty[system.warranty_years] ?? Number(settings.overhead_pct || 0);
    const prPct = profitByWarranty[system.warranty_years]   ?? Number(settings.profit_pct   || 0);
    // Subtotal before OH&P — Standard warranty baseline (the customer's base).
    const subtotal = markedUp + handling + warrantyAdd + laborAdd;
    const overhead = subtotal * (ohPct / 100);
    const profit   = (subtotal + overhead) * (prPct / 100);
    const customerBase = subtotal + overhead + profit;
    // NDL upgrade $ = same compounded markup applied to the surcharge so the
    // upgrade row carries identical margin as the base. This is what we
    // publish on the PDF's "[OPTIONAL] Manufacturer Warranty" line.
    const ndlUpgradeDelta = ndlSurchargeRaw * (1 + ohPct / 100) * (1 + prPct / 100);
    // Displayed customer price = base + NDL only if rep ticked the toggle in
    // the calculator. The toggle is for the rep's internal pricing reference;
    // the PDF always shows base as the headline and NDL as an option.
    const customer = customerBase + (isNdl ? ndlUpgradeDelta : 0);
    const pricePerSf = sf > 0 ? customer / sf : 0;

    return { system, lines, addonLines, rawCost, markedUp, handling, warrantyAdd, isEverest, ndlAvailable, isNdl, ndlUpgradeDelta, customerBase, laborAdd, subtotal, overhead, profit, ohPct, prPct, customer, pricePerSf };
  };

  const columns = useMemo(() => {
    return selectedSystemIds
      .map((id) => systems.find((s) => s.id === id))
      .filter(Boolean)
      .map(computeBom);
  }, [selectedSystemIds, recipes, products, totalSf, waste, settings, addons, allowedSizes, deal, laborByWarranty, overheadByWarranty, profitByWarranty, ndlByWarranty]);

  // ────────────────────────────────────────────────────────────────────
  //   Calculator → Deal action handlers (split by mode)
  // ────────────────────────────────────────────────────────────────────
  const PROPOSAL_FIELD_BY_WARRANTY = {
    25: "proposal_option_25yr", // Option A
    20: "proposal_option_1",    // Option B
    15: "proposal_option_2",    // Option C
    10: "proposal_option_3",    // Option D
  };
  const OPTION_LETTER = { 25: "A", 20: "B", 15: "C", 10: "D" };

  /** ESTIMATE mode: only write the Customer Price into the matching
   *  proposal_option_* field on the deal. No cost lines, no PO. */
  const setOptionOnDeal = async (col) => {
    if (!deal) { toast.warning("Pick a deal from the dropdown first"); return; }
    const field = PROPOSAL_FIELD_BY_WARRANTY[col.system.warranty_years];
    const letter = OPTION_LETTER[col.system.warranty_years];
    if (!field) {
      toast.error(`No proposal slot for ${col.system.warranty_years}-yr warranty`);
      return;
    }
    const LABOR_ADD_FIELD = { 25: "labor_25yr_add", 20: "labor_20yr_add", 15: "labor_15yr_add", 10: "labor_10yr_add" };
    const OH_FIELD     = { 25: "overhead_25yr_pct", 20: "overhead_20yr_pct", 15: "overhead_15yr_pct", 10: "overhead_10yr_pct" };
    const PR_FIELD     = { 25: "profit_25yr_pct",   20: "profit_20yr_pct",   15: "profit_15yr_pct",   10: "profit_10yr_pct" };
    const WAR_ADD_FIELD = { 25: "warranty_25yr_add", 20: "warranty_20yr_add", 15: "warranty_15yr_add", 10: "warranty_10yr_add" };
    const NDL_FIELD     = { 25: "warranty_25yr_ndl", 20: "warranty_20yr_ndl", 15: "warranty_15yr_ndl", 10: "warranty_10yr_ndl" };
    // Everest jobs: the customer's headline price ALWAYS shows the Standard-
    // warranty base ($1,000 baked in). The NDL upgrade $ travels via the
    // `warranty_*_add` field — the spec sheet renders it under "[OPTIONAL]
    // Manufacturer Warranty" so the customer can opt-in separately.
    const baseForDeal = col.isEverest ? col.customerBase : col.customer;
    const customerRounded = Math.round(baseForDeal * 100) / 100;
    const laborField = LABOR_ADD_FIELD[col.system.warranty_years];
    const ohField    = OH_FIELD[col.system.warranty_years];
    const prField    = PR_FIELD[col.system.warranty_years];
    const warField   = WAR_ADD_FIELD[col.system.warranty_years];
    const ndlField   = NDL_FIELD[col.system.warranty_years];
    setSavingToDeal(true);
    try {
      const body = { ...deal, [field]: customerRounded };
      if (laborField) body[laborField] = Math.round((col.laborAdd || 0) * 100) / 100;
      if (ohField) body[ohField] = col.ohPct;
      if (prField) body[prField] = col.prPct;
      // For Everest, persist the NDL UPGRADE delta in warranty_*_add (so the
      // PDF can render it as an optional add-on) — and remember the toggle
      // state in warranty_*_ndl so the calculator restores the same view.
      if (col.isEverest && warField) body[warField] = Math.round((col.ndlUpgradeDelta || 0) * 100) / 100;
      if (col.isEverest && ndlField) body[ndlField] = !!col.isNdl;
      ["id","created_at","updated_at","created_by",
       "materials_cost","labor_cost","subcontractor_cost","other_expenses_total",
       "total_costs","profit","margin_pct","is_deleted","deleted_at","deleted_by",
       "assigned_user_name","primary_contact_name","property_name"
      ].forEach((k) => { delete body[k]; });
      const r = await api.put(`/deals/${deal.id}`, body);
      setDeal(r.data);
      toast.success(`Set Option ${letter} (${col.system.warranty_years}-yr) = ${formatCurrency(baseForDeal)} on the deal.`);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setSavingToDeal(false);
    }
  };

  /** ESTIMATE mode bulk: write ALL compared columns into A/B/C/D in one PUT. */
  const setAllOptionsOnDeal = async () => {
    if (!deal) { toast.warning("Pick a deal first"); return; }
    if (columns.length === 0) { toast.warning("Pick at least one system to compare"); return; }
    const updates = {};
    const summary = [];
    const LABOR_FIELDS = { 25: "labor_25yr_add", 20: "labor_20yr_add", 15: "labor_15yr_add", 10: "labor_10yr_add" };
    const OH_FIELDS    = { 25: "overhead_25yr_pct", 20: "overhead_20yr_pct", 15: "overhead_15yr_pct", 10: "overhead_10yr_pct" };
    const PR_FIELDS    = { 25: "profit_25yr_pct",   20: "profit_20yr_pct",   15: "profit_15yr_pct",   10: "profit_10yr_pct" };
    const WAR_FIELDS   = { 25: "warranty_25yr_add", 20: "warranty_20yr_add", 15: "warranty_15yr_add", 10: "warranty_10yr_add" };
    const NDL_FIELDS   = { 25: "warranty_25yr_ndl", 20: "warranty_20yr_ndl", 15: "warranty_15yr_ndl", 10: "warranty_10yr_ndl" };
    for (const col of columns) {
      const field = PROPOSAL_FIELD_BY_WARRANTY[col.system.warranty_years];
      const letter = OPTION_LETTER[col.system.warranty_years];
      if (!field) continue;
      // Everest jobs: save Standard-warranty base in proposal_option_* and
      // the marked-up NDL upgrade delta in warranty_*_add (the PDF will
      // render it as an "[OPTIONAL] Manufacturer Warranty" upgrade).
      const baseForDeal = col.isEverest ? col.customerBase : col.customer;
      updates[field] = Math.round(baseForDeal * 100) / 100;
      const lf = LABOR_FIELDS[col.system.warranty_years];
      const of_ = OH_FIELDS[col.system.warranty_years];
      const pf = PR_FIELDS[col.system.warranty_years];
      const wf = WAR_FIELDS[col.system.warranty_years];
      const nf = NDL_FIELDS[col.system.warranty_years];
      if (lf) updates[lf] = Math.round((col.laborAdd || 0) * 100) / 100;
      if (of_) updates[of_] = col.ohPct;
      if (pf) updates[pf] = col.prPct;
      if (col.isEverest && wf) updates[wf] = Math.round((col.ndlUpgradeDelta || 0) * 100) / 100;
      if (col.isEverest && nf) updates[nf] = !!col.isNdl;
      summary.push(`Option ${letter} = ${formatCurrency(baseForDeal)}`);
    }
    if (!Object.keys(updates).length) {
      toast.warning("None of the picked systems have a matching A/B/C/D warranty (10/15/20/25-yr)");
      return;
    }
    if (!window.confirm(`Set on "${deal.title || deal.id}":\n\n${summary.join("\n")}\n\nThis OVERWRITES any existing amounts in those fields.`)) return;
    setSavingToDeal(true);
    try {
      const body = { ...deal, ...updates };
      ["id","created_at","updated_at","created_by",
       "materials_cost","labor_cost","subcontractor_cost","other_expenses_total",
       "total_costs","profit","margin_pct","is_deleted","deleted_at","deleted_by",
       "assigned_user_name","primary_contact_name","property_name"
      ].forEach((k) => { delete body[k]; });
      const r = await api.put(`/deals/${deal.id}`, body);
      setDeal(r.data);
      toast.success(`Set ${summary.length} proposal option${summary.length === 1 ? "" : "s"} on the deal.`);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setSavingToDeal(false);
    }
  };

  /** Ensure a Vendor record exists for the picked manufacturer. Returns its id.
   *  Falls back to creating a minimal one (name only) — Darren can fill in
   *  contact + address via the Vendors page later. */
  const ensureVendorId = async (vendorName) => {
    try {
      const r = await api.get("/vendors");
      const existing = (r.data || []).find((v) => (v.name || "").toLowerCase() === vendorName.toLowerCase());
      if (existing) return existing.id;
      const created = await api.post("/vendors", { name: vendorName, vendor_type: "Material Supplier" });
      toast.info(`Created vendor record "${vendorName}" — fill in address/email in /vendors when you have a moment.`);
      return created.data.id;
    } catch (e) {
      toast.error(`Could not look up / create vendor: ${e.message}`);
      return null;
    }
  };

  /** MATERIALS mode: push the BoM to the deal as:
   *   1. material_takeoff lines (one per packed container, used by the PO PDF)
   *   2. cost_items lines (one per product, for cost tracking)
   *   3. winning_warranty_years (so reopening the calc auto-selects this system)
   *  Optionally chain into PO PDF download after the save succeeds.  */
  const pushMaterialsToDeal = async (col, { andDownloadPo = false } = {}) => {
    if (!deal) { toast.warning("Pick a deal first"); return; }
    const vendorName = selectedVendor;
    const vendorId = await ensureVendorId(vendorName);
    if (!vendorId) return;

    setSavingToDeal(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const newTakeoff  = [];
      const newCostItems = [];

      const addLines = (productOrAddon, packed, labelPrefix) => {
        for (const pk of packed) {
          const kind = classifyContainer(pk.product);
          const kindLabel = kind === "tote" ? "Tote" : kind === "drum" ? "Drum" : kind === "pail" ? "Pail" : (pk.product.unit || "");
          const unitDesc = `${pk.product.package_size} ${pk.product.unit} ${kindLabel}`.trim();
          newTakeoff.push({
            id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
            vendor_id: vendorId,
            vendor_name: vendorName,
            sku: pk.product.sku || "",
            name: pk.product.name || labelPrefix,
            unit: unitDesc,
            quantity: pk.qty,
            notes: `${labelPrefix} — ${col.system.name}`,
          });
        }
        if ((productOrAddon?.lineCost ?? 0) > 0) {
          const containerSummary = packed.map((x) => {
            const k = classifyContainer(x.product);
            const kl = k === "tote" ? "tote" : k === "drum" ? "drum" : k === "pail" ? "pail" : (x.product.unit || "");
            return `${x.qty}×${x.product.package_size}${x.product.unit} ${kl}`;
          }).join(", ");
          newCostItems.push({
            category: "Materials",
            vendor_id: vendorId,
            vendor_name: vendorName,
            description: `${labelPrefix} (${containerSummary}) — ${col.system.name}`,
            amount: Math.round(productOrAddon.lineCost * 100) / 100,
            date: today,
            status: "Pending",
          });
        }
      };

      for (const ln of col.lines) {
        if (ln.lineCost <= 0) continue;
        const base = (ln.product.name || "").split(" — ")[0];
        addLines(ln, ln.packed, base);
      }
      for (const ln of col.addonLines) {
        if (ln.lineCost <= 0) continue;
        addLines(ln, ln.packed, ln.addon.label);
      }

      const body = {
        ...deal,
        material_takeoff: [...(deal.material_takeoff || []), ...newTakeoff],
        cost_items:       [...(deal.cost_items || []),      ...newCostItems],
        winning_warranty_years: col.system.warranty_years || null,
        winning_system_name: col.system.name || "",
      };
      ["id","created_at","updated_at","created_by",
       "materials_cost","labor_cost","subcontractor_cost","other_expenses_total",
       "total_costs","profit","margin_pct","is_deleted","deleted_at","deleted_by",
       "assigned_user_name","primary_contact_name","property_name"
      ].forEach((k) => { delete body[k]; });
      const r = await api.put(`/deals/${deal.id}`, body);
      setDeal(r.data);

      toast.success(`Pushed ${newTakeoff.length} take-off line${newTakeoff.length === 1 ? "" : "s"} + ${newCostItems.length} cost line${newCostItems.length === 1 ? "" : "s"} for ${col.system.name}.`);

      if (andDownloadPo) {
        // Open the existing PO PDF endpoint in a new tab. The endpoint reads
        // the auth token from `?token=` query param (it's a GET that the
        // browser opens directly, so the Authorization header isn't sent).
        const token = localStorage.getItem("crm_token") || "";
        const base = process.env.REACT_APP_BACKEND_URL;
        window.open(`${base}/api/deals/${deal.id}/purchase-order/${vendorId}.pdf?token=${encodeURIComponent(token)}`, "_blank");
      }
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setSavingToDeal(false);
    }
  };

  /** MATERIALS mode: generate PO from EXISTING material_takeoff on the deal
   *  (i.e. user already pushed materials earlier and just wants the PDF). */
  const downloadPoOnly = async () => {
    if (!deal) return;
    const vendorId = await ensureVendorId(selectedVendor);
    if (!vendorId) return;
    setGeneratingPo(true);
    try {
      const hasLines = (deal.material_takeoff || []).some((ln) => ln.vendor_id === vendorId);
      if (!hasLines) {
        toast.error(`No take-off lines for ${selectedVendor} on this deal yet. Click "Push to Materials List" first.`);
        return;
      }
      const token = localStorage.getItem("crm_token") || "";
      const base = process.env.REACT_APP_BACKEND_URL;
      window.open(`${base}/api/deals/${deal.id}/purchase-order/${vendorId}.pdf?token=${encodeURIComponent(token)}`, "_blank");
    } finally {
      setGeneratingPo(false);
    }
  };

  /** Unique vendor list for the manufacturer dropdown. */
  const vendorOptions = useMemo(() => {
    const set = new Set();
    for (const s of systems) if (s.vendor) set.add(s.vendor);
    return Array.from(set).sort();
  }, [systems]);

  /** Filtered systems list for the currently-picked manufacturer
   *  (sorted by warranty DESC for high → low presentation). */
  const filteredSystems = useMemo(() => {
    return systems
      .filter((s) => (s.vendor || "Unknown") === selectedVendor)
      .sort((a, b) => (b.warranty_years || 0) - (a.warranty_years || 0));
  }, [systems, selectedVendor]);

  // Auto-select the deal's "winning system" when entering Materials mode.
  // (Declared AFTER filteredSystems so its dep-array doesn't hit a TDZ.)
  useEffect(() => {
    if (mode !== "materials" || !deal || !deal.winning_warranty_years) return;
    const sys = filteredSystems.find((s) => s.warranty_years === deal.winning_warranty_years);
    if (sys && !selectedSystemIds.includes(sys.id)) {
      if (selectedSystemIds.length === 0) toggleSystem(sys.id);
    }
  }, [mode, deal, filteredSystems]);

  if (loading) {
    return <div className="p-10 text-center text-zinc-500"><Loader2 className="w-5 h-5 animate-spin inline mr-2" /> Loading catalog…</div>;
  }

  return (
    <div className="max-w-[1500px] mx-auto p-6 space-y-6" data-testid="calculator-page">
      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-zinc-500">
            <CalcIcon className="w-3.5 h-3.5" /> Material Calculator
          </div>
          <h1 className="text-2xl font-black tracking-tight mt-1">
            {deal ? `Estimate for ${deal.title || deal.name || "Deal"}` : "Quick System Compare"}
          </h1>
          <p className="text-sm text-zinc-600 mt-1">
            Pick up to {MAX_COMPARE} systems, enter total square footage, and see a side-by-side material list with the customer-facing price (cost + {settings.markup_pct}% shipping + {settings.handling_pct}% handling).
          </p>
        </div>
        {deal && (
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-2 flex-wrap justify-end">
              <Link to={`/deals/${deal.id}`} className="inline-flex items-center gap-1 px-3 h-8 text-[10px] font-bold uppercase tracking-wider border border-zinc-300 bg-white hover:bg-zinc-50 rounded-sm" data-testid="back-to-deal">
                <ChevronLeft className="w-3 h-3" /> Back to Deal
              </Link>
              <button
                type="button"
                onClick={() => {
                  const token = localStorage.getItem("crm_token") || "";
                  const base = process.env.REACT_APP_BACKEND_URL;
                  window.open(`${base}/api/deals/${deal.id}/spec-sheet.pdf?token=${encodeURIComponent(token)}`, "_blank");
                }}
                className="inline-flex items-center gap-1 px-3 h-8 text-[10px] font-bold uppercase tracking-wider bg-zinc-900 text-white hover:bg-zinc-700 rounded-sm"
                data-testid="download-scope-pdf"
                title="Download the scope PDF straight to your device — for in-person customer meetings."
              >
                <Download className="w-3 h-3" /> Download Scope
              </button>
              <Link
                to={`/deals/${deal.id}?openScope=1`}
                className="inline-flex items-center gap-1 px-3 h-8 text-[10px] font-bold uppercase tracking-wider bg-amber-600 text-white hover:bg-amber-700 rounded-sm"
                data-testid="open-scope"
                title="Jump to the scope editor on the deal so you can finalize the proposal text and email it from there."
              >
                <FileText className="w-3 h-3" /> Edit Scope →
              </Link>
              <button
                type="button"
                onClick={async () => {
                  try {
                    const r = await api.get(`/deals/${deal.id}/sign-link`);
                    const url = r.data?.sign_url;
                    if (!url) { toast.error("Could not get sign link"); return; }
                    // Copy to clipboard
                    try { await navigator.clipboard.writeText(url); } catch { /* ignore */ }
                    // Open in a new tab so Darren can hand the device to the customer
                    window.open(url, "_blank");
                    toast.success(r.data?.already_signed
                      ? "This deal is already signed — opened the receipt view."
                      : "Sign link copied to clipboard AND opened in a new tab — hand it to the customer.");
                  } catch (e) {
                    toast.error(formatApiError(e?.response?.data?.detail) || e.message);
                  }
                }}
                className="inline-flex items-center gap-1 px-3 h-8 text-[10px] font-bold uppercase tracking-wider bg-emerald-700 text-white hover:bg-emerald-800 rounded-sm"
                data-testid="get-signed"
                title="Mints (or reuses) the public sign URL, copies it to your clipboard, and opens it in a new tab so you can hand the device to the customer right at the table."
              >
                <PenLine className="w-3 h-3" /> Get Signed →
              </button>
            </div>
            {/* Mode toggle — controls which action buttons appear in each compare column. */}
            <div className="inline-flex items-stretch border border-zinc-300 rounded-sm overflow-hidden" data-testid="mode-toggle">
              <button
                onClick={() => setMode("estimate")}
                className={`px-3 h-8 text-[10px] font-bold uppercase tracking-wider transition-colors ${mode === "estimate" ? "bg-blue-700 text-white" : "bg-white text-zinc-700 hover:bg-zinc-50"}`}
                data-testid="mode-estimate"
                title="Pre-signature: per-column buttons WRITE prices into Proposal Options A/B/C/D. Use the orange ‘Open Scope →’ button when you’re ready to take the proposal to the customer."
              >
                Estimate / Quote
              </button>
              <button
                onClick={() => setMode("materials")}
                className={`px-3 h-8 text-[10px] font-bold uppercase tracking-wider transition-colors ${mode === "materials" ? "bg-emerald-700 text-white" : "bg-white text-zinc-700 hover:bg-zinc-50"}`}
                data-testid="mode-materials"
                title="Post-signature: per-column buttons push the BoM to the deal's Material Take-off and generate a Purchase Order PDF."
              >
                Materials &amp; PO
              </button>
            </div>
            {deal.scope_signed_at && (
              <div className="text-[10px] text-emerald-700 font-mono">Scope signed {String(deal.scope_signed_at).slice(0, 10)}</div>
            )}
          </div>
        )}
      </header>

      {/* Manufacturer + Deal selector strip (the two "pre-flight" choices). */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 bg-zinc-50 border-2 border-zinc-300 rounded-sm">
        <div>
          <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 block mb-1">Manufacturer</label>
          <select
            value={selectedVendor}
            onChange={(e) => {
              setSelectedVendor(e.target.value);
              setSelectedSystemIds([]);   // clear comparisons — they were from the old vendor
            }}
            data-testid="select-vendor"
            className="border border-zinc-300 px-3 h-10 text-base w-full bg-white focus:outline-none focus:border-blue-700"
          >
            {vendorOptions.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <div className="text-[10px] text-zinc-500 mt-1">Single-vendor jobs only — add cross-vendor items via the Deal&apos;s Vendor Cost section.</div>
        </div>
        <div>
          <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 block mb-1">Working on Deal</label>
          <select
            value={selectedDealId}
            onChange={(e) => setSelectedDealId(e.target.value)}
            data-testid="select-deal"
            className="border border-zinc-300 px-3 h-10 text-base w-full bg-white focus:outline-none focus:border-blue-700"
          >
            <option value="">— No deal (comparison only) —</option>
            {deals.map((d) => {
              const label = `${d.title || d.name || "(untitled)"}${d.stage ? ` · ${d.stage}` : ""}`;
              return <option key={d.id} value={d.id}>{label.slice(0, 80)}</option>;
            })}
          </select>
          <div className="text-[10px] text-zinc-500 mt-1">Sorted by most-recently-updated. Pushing a column sends cost lines + auto-fills the matching proposal option.</div>
        </div>
      </div>

      {/* Controls bar */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 p-4 bg-white border border-zinc-200 rounded-sm shadow-sm">
        <div>
          <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 block mb-1">Total Roof SF</label>
          <input
            type="number" min="0" inputMode="numeric"
            value={totalSf} onChange={(e) => setTotalSf(e.target.value)}
            placeholder="e.g. 12,500"
            data-testid="input-total-sf"
            className="border border-zinc-300 px-3 h-10 text-base w-full font-mono focus:outline-none focus:border-blue-700"
          />
        </div>
        <div>
          <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 block mb-1">Waste %</label>
          <input
            type="number" min="0" max="100" step="0.5"
            value={waste} onChange={(e) => setWaste(Number(e.target.value))}
            data-testid="input-waste"
            className="border border-zinc-300 px-3 h-10 text-base w-full font-mono focus:outline-none focus:border-blue-700"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 block mb-1" title="Uncheck a container size if the site can't physically accept it (no forklift, narrow access, etc.)">
            Site Access — Allowed Containers
          </label>
          <div className="flex items-center gap-2 h-10">
            {[
              { key: "tote", label: "Totes",  hint: "275 gal" },
              { key: "drum", label: "Drums",  hint: "55 gal"  },
              { key: "pail", label: "Pails",  hint: "5 gal"   },
            ].map((c) => {
              const on = allowedSizes[c.key];
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setAllowedSizes({ ...allowedSizes, [c.key]: !on })}
                  data-testid={`toggle-container-${c.key}`}
                  className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 h-10 text-[11px] font-bold uppercase tracking-wider rounded-sm border transition-colors ${
                    on
                      ? "bg-blue-700 text-white border-blue-700 hover:bg-blue-800"
                      : "bg-zinc-100 text-zinc-400 border-zinc-300 hover:bg-zinc-200 line-through"
                  }`}
                  title={on ? `${c.label} (${c.hint}) included` : `${c.label} (${c.hint}) excluded — site can't accept`}
                >
                  {c.label}
                  <span className={`text-[9px] font-mono ${on ? "text-blue-100" : "text-zinc-400"}`}>{c.hint}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="text-xs flex flex-col justify-center">
          <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Shipping</div>
          <div className="font-mono text-base">{settings.markup_pct}% on raw materials</div>
        </div>
        <div className="text-xs flex flex-col justify-center">
          <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Handling Fee</div>
          <div className="font-mono text-base">
            {settings.handling_pct}% {settings.handling_basis === "marked_up" ? "(on shipping-included total)" : "(on raw cost)"}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6">
        {/* Systems sidebar — flat list of the chosen manufacturer's systems */}
        <aside className="space-y-4">
          <div className="bg-white border border-zinc-200 rounded-sm shadow-sm">
            <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500 border-b border-zinc-200 flex items-center gap-1.5">
              <Layers className="w-3 h-3" /> {selectedVendor} Systems ({selectedSystemIds.length}/{MAX_COMPARE})
            </div>
            <div className="max-h-[60vh] overflow-y-auto">
              {filteredSystems.length === 0 && (
                <div className="p-4 text-sm text-zinc-500">No systems for {selectedVendor} yet — add one in <Link to="/catalog" className="text-blue-700 underline">Product Catalog</Link>.</div>
              )}
              {filteredSystems.map((s) => {
                const checked = selectedSystemIds.includes(s.id);
                return (
                  <label
                    key={s.id}
                    className={`flex items-start gap-2 px-3 py-2 cursor-pointer hover:bg-blue-50 transition-colors border-b border-zinc-100 last:border-b-0 ${checked ? "bg-blue-50" : ""}`}
                    data-testid={`pick-system-${s.id}`}
                  >
                    <input
                      type="checkbox" checked={checked}
                      onChange={() => toggleSystem(s.id)}
                      className="mt-1"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-bold truncate">{s.name}</div>
                      <div className="text-[10px] text-zinc-500 uppercase tracking-wider">
                        {s.system_type} · {bandWarrantyLabel(s.warranty_years)}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Add-ons — switches between Western Colloid SKUs and Everest +
              SESCO granule SKUs based on the currently selected manufacturer. */}
          <div className="bg-white border border-zinc-200 rounded-sm shadow-sm">
            <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500 border-b border-zinc-200 flex items-center justify-between">
              <span>{selectedVendor === "Everest Systems" ? "Everest Add-ons" : "Optional Add-ons"}</span>
              {selectedVendor !== "Everest Systems" && (
                <button
                  type="button"
                  onClick={() => setAddons({ ...addons, ...STRESS_POINTS_PRESET })}
                  data-testid="apply-stress-points-preset"
                  className="text-[10px] font-bold uppercase tracking-wider text-blue-700 hover:underline"
                  title="Drops 1×4&quot;, 2×6&quot;, 1×12&quot; reinforcing fabric in the add-on row — typical stress-point bundle for a small commercial roof."
                >
                  + Stress Points
                </button>
              )}
            </div>
            <div className="p-3 space-y-2.5 max-h-[55vh] overflow-y-auto">
              {(selectedVendor === "Everest Systems" ? EVEREST_ADDON_TEMPLATES : ADDON_TEMPLATES).map((a) => (
                <div key={a.id} className="grid grid-cols-[1fr_70px] gap-2 items-center">
                  <span className="text-xs">{a.label}</span>
                  <input
                    type="number" min="0" step="1"
                    value={addons[a.id] || ""}
                    onChange={(e) => setAddons({ ...addons, [a.id]: Number(e.target.value) || 0 })}
                    placeholder={a.unit}
                    data-testid={`addon-${a.id}`}
                    className="border border-zinc-300 px-2 h-8 text-xs font-mono focus:outline-none focus:border-blue-700"
                  />
                </div>
              ))}
              {selectedVendor === "Everest Systems" && (
                <div className="pt-2 text-[10px] text-zinc-500 italic border-t border-zinc-100">
                  Adding any granule qty auto-applies the SESCO LTL freight ($2,000 flat per order).
                </div>
              )}
            </div>
          </div>
        </aside>

        {/* Comparison columns */}
        <section>
          {selectedSystemIds.length === 0 ? (
            <div className="border-2 border-dashed border-zinc-300 p-12 text-center rounded-sm">
              <AlertCircle className="w-8 h-8 mx-auto text-zinc-400 mb-2" />
              <div className="text-sm font-bold uppercase tracking-wider text-zinc-600">Pick a system to begin</div>
              <p className="text-xs text-zinc-500 mt-1">Choose from the sidebar — you can compare up to {MAX_COMPARE} side-by-side.</p>
            </div>
          ) : !Number(totalSf) ? (
            <div className="border-2 border-dashed border-zinc-300 p-12 text-center rounded-sm">
              <AlertCircle className="w-8 h-8 mx-auto text-amber-500 mb-2" />
              <div className="text-sm font-bold uppercase tracking-wider text-zinc-600">Enter the roof&apos;s total square footage</div>
              <p className="text-xs text-zinc-500 mt-1">Quantities are computed from coverage rates × SF.</p>
            </div>
          ) : (
            <>
            <div className={`grid gap-4 ${columns.length === 1 ? "grid-cols-1" : columns.length === 2 ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1 md:grid-cols-3"}`}>
              {columns.map((col, idx) => (
                <CompareColumn
                  key={col.system.id}
                  col={col}
                  settings={settings}
                  totalSf={Number(totalSf)}
                  mode={mode}
                  onRemove={() => toggleSystem(col.system.id)}
                  onSetOption={deal ? () => setOptionOnDeal(col) : null}
                  onPushMaterials={deal ? () => pushMaterialsToDeal(col) : null}
                  onPushAndPo={deal ? () => pushMaterialsToDeal(col, { andDownloadPo: true }) : null}
                  onLaborChange={(v) => setLaborByWarranty((prev) => ({ ...prev, [col.system.warranty_years]: v }))}
                  onOverheadChange={(v) => setOverheadByWarranty((prev) => ({ ...prev, [col.system.warranty_years]: v }))}
                  onProfitChange={(v) => setProfitByWarranty((prev) => ({ ...prev, [col.system.warranty_years]: v }))}
                  onNdlChange={(v) => setNdlByWarranty((prev) => ({ ...prev, [col.system.warranty_years]: v }))}
                  savingToDeal={savingToDeal}
                  testIdSuffix={idx}
                />
              ))}
            </div>
            {/* Bulk actions row — visible only when we have a deal + columns. */}
            {deal && columns.length > 0 && (
              <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                {mode === "estimate" ? (
                  <button
                    onClick={setAllOptionsOnDeal}
                    disabled={savingToDeal}
                    className="inline-flex items-center gap-1.5 px-4 h-9 text-[11px] font-bold uppercase tracking-wider bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-50 rounded-sm"
                    data-testid="bulk-set-all-options"
                  >
                    <Save className="w-3.5 h-3.5" /> Set ALL → Options on Deal
                  </button>
                ) : (
                  <button
                    onClick={downloadPoOnly}
                    disabled={generatingPo}
                    className="inline-flex items-center gap-1.5 px-4 h-9 text-[11px] font-bold uppercase tracking-wider border border-blue-700 text-blue-700 bg-white hover:bg-blue-50 disabled:opacity-50 rounded-sm"
                    data-testid="download-po-existing"
                    title="Generate a PO PDF from the deal's existing material take-off (for the picked manufacturer)."
                  >
                    <FileText className="w-3.5 h-3.5" /> {generatingPo ? "Generating…" : `PO PDF — ${selectedVendor}`}
                  </button>
                )}
              </div>
            )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function CompareColumn({ col, settings, totalSf, mode, onRemove, onSetOption, onPushMaterials, onPushAndPo, savingToDeal, testIdSuffix, onLaborChange, onOverheadChange, onProfitChange, onNdlChange }) {
  const { system, lines, addonLines, rawCost, markedUp, handling, warrantyAdd, isEverest, ndlAvailable, isNdl, laborAdd, overhead, profit, ohPct, prPct, customer, pricePerSf } = col;
  const hasRecipe = lines.length > 0;
  const optionLetter = { 25: "A", 20: "B", 15: "C", 10: "D" }[system.warranty_years];
  return (
    <div className="bg-white border border-zinc-200 rounded-sm shadow-sm flex flex-col" data-testid={`compare-col-${testIdSuffix}`}>
      <div className="px-3 py-3 border-b-2 border-zinc-950 bg-zinc-50">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-widest text-blue-700">{system.vendor}</div>
            <div className="text-sm font-black truncate">{system.name}</div>
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider mt-0.5">
              {system.system_type} · {system.warranty_years}-yr warranty
            </div>
          </div>
          <button
            onClick={onRemove}
            className="p-1 hover:bg-red-100 text-red-700 rounded-sm flex-shrink-0"
            title="Remove from compare"
            data-testid={`remove-col-${testIdSuffix}`}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {!hasRecipe && (
        <div className="p-4 text-xs text-amber-700 bg-amber-50">
          No recipe assigned yet. Set ingredient products + coverage rates in <Link to="/catalog" className="underline">Product Catalog</Link>.
        </div>
      )}

      <div className="flex-1 p-3 space-y-3 text-xs">
        {lines.map((ln, i) => {
          const baseName = (ln.product.name || "").split(" — ")[0];
          const note = ln.recipe_row?.notes || "";
          return (
            <div key={i} className="pb-2 border-b border-zinc-100">
              <div className="font-bold truncate" title={baseName}>{baseName}</div>
              {note && (
                <div className="text-[10px] text-zinc-500 mt-0.5 italic truncate" title={note}>
                  {note}
                </div>
              )}
              <div className="text-[10px] text-zinc-500 mt-0.5">
                Needs {ln.qtyNeeded.toFixed(1)} {ln.product.unit}
              </div>
              <div className="mt-1 space-y-0.5">
                {ln.packed.map((pk, j) => {
                  const kind = classifyContainer(pk.product);
                  const kindLabel = kind === "tote" ? "tote" : kind === "drum" ? "drum" : kind === "pail" ? "pail" : (pk.product.unit || "");
                  return (
                    <div key={j} className="flex justify-between gap-2">
                      <span className="text-zinc-600 truncate">
                        {pk.qty} × {pk.product.package_size} {pk.product.unit} {kindLabel}
                      </span>
                      <span className="font-mono text-zinc-900">{formatCurrency(pk.cost)}</span>
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-between mt-1 font-mono font-bold">
                <span className="text-[10px] uppercase tracking-wider text-zinc-500">Line subtotal</span>
                <span>{formatCurrency(ln.lineCost)}</span>
              </div>
            </div>
          );
        })}

        {addonLines.length > 0 && (
          <>
            <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 pt-1">Add-ons</div>
            {addonLines.map((ln, i) => (
              <div key={`a-${i}`} className="pb-2 border-b border-zinc-100">
                <div className="font-bold truncate">{ln.addon.label}</div>
                <div className="text-[10px] text-zinc-500 mt-0.5">{ln.qtyNeeded} {ln.addon.unit}</div>
                <div className="mt-1 space-y-0.5">
                  {ln.packed.map((pk, j) => {
                    const kind = classifyContainer(pk.product);
                    const kindLabel = kind === "tote" ? "tote" : kind === "drum" ? "drum" : kind === "pail" ? "pail" : (pk.product.unit || "");
                    return (
                      <div key={j} className="flex justify-between gap-2">
                        <span className="text-zinc-600 truncate">{pk.qty} × {pk.product.package_size} {pk.product.unit} {kindLabel}</span>
                        <span className="font-mono">{formatCurrency(pk.cost)}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="flex justify-between mt-1 font-mono font-bold">
                  <span className="text-[10px] uppercase tracking-wider text-zinc-500">Line subtotal</span>
                  <span>{formatCurrency(ln.lineCost)}</span>
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      <div className="border-t-2 border-zinc-950 p-3 bg-zinc-50 space-y-1 text-xs">
        <Row label="Raw materials" value={rawCost} />
        <Row label={`+${settings.markup_pct}% Shipping`} value={markedUp - rawCost} />
        <Row label={`+${settings.handling_pct}% Handling`} value={handling} />
        {warrantyAdd > 0 && (
          <Row
            label={isEverest
              ? `+ Warranty (${isNdl ? "NDL" : "Standard"}, ${system.warranty_years}-yr)`
              : `+ Warranty (${system.warranty_years}-yr)`}
            value={warrantyAdd}
          />
        )}
        {/* NDL toggle — Everest Systems only, and only for warranty bands
            where NDL is offered (10/15/20-yr). 5-yr Everest has no NDL. */}
        {isEverest && ndlAvailable && (
          <label
            className="flex items-center justify-between gap-2 text-[11px] cursor-pointer select-none"
            data-testid={`ndl-toggle-${testIdSuffix}`}
            title="NDL = No-Dollar-Limit warranty. $3,000 third-party inspection + $0.06/SF (10-yr), $0.09/SF (15-yr) or $0.12/SF (20-yr). Standard warranty is $1,000 flat with no inspection."
          >
            <span className="text-zinc-600">NDL warranty <span className="text-zinc-400 font-mono">($3,000 + per-SF)</span></span>
            <input
              type="checkbox"
              checked={!!isNdl}
              onChange={(e) => onNdlChange?.(e.target.checked)}
              className="h-4 w-4"
            />
          </label>
        )}
        {/* Labor — per-warranty input, free-form $ (per-SF or flat-project) */}
        <div className="flex items-center justify-between gap-2 font-mono">
          <label className="text-zinc-600 text-[11px]">+ Labor ($ for this option)</label>
          <input
            type="number" min="0" step="50"
            value={laborAdd || ""}
            onChange={(e) => onLaborChange?.(Number(e.target.value) || 0)}
            placeholder="0"
            data-testid={`labor-input-${testIdSuffix}`}
            className="w-24 border border-zinc-300 px-2 h-7 text-xs font-mono text-right focus:outline-none focus:border-blue-700"
            title="Enter total labor $ for this system on this job (per-SF × SF or flat-project). Saved on the deal."
          />
        </div>
        {(settings.overhead_pct || 0) > 0 && (
          <PctEditableRow
            label="Overhead"
            pct={ohPct}
            amount={overhead}
            onChange={onOverheadChange}
            testId={`overhead-pct-${testIdSuffix}`}
          />
        )}
        {(settings.profit_pct || 0) > 0 && (
          <PctEditableRow
            label="Profit"
            pct={prPct}
            amount={profit}
            onChange={onProfitChange}
            testId={`profit-pct-${testIdSuffix}`}
          />
        )}
        <div className="border-t border-zinc-300 pt-1.5 mt-1.5 flex items-baseline justify-between">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Customer Price</div>
            {totalSf > 0 && (
              <div className="text-[10px] text-zinc-500 font-mono">
                {pricePerSf.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 })}/SF
              </div>
            )}
          </div>
          <div className="text-lg font-black font-mono" data-testid={`customer-price-${testIdSuffix}`}>
            {formatCurrency(customer)}
          </div>
        </div>

        {/* Mode-specific action button(s) */}
        {mode === "estimate" && onSetOption && optionLetter && (
          <button
            onClick={onSetOption}
            disabled={savingToDeal || !hasRecipe}
            className="mt-3 w-full inline-flex items-center justify-center gap-1 px-3 h-9 text-[10px] font-bold uppercase tracking-wider bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed rounded-sm"
            data-testid={`set-option-${testIdSuffix}`}
            title={`Writes ${formatCurrency(customer)} into Option ${optionLetter} on the deal (price only — no cost lines, no PO).`}
          >
            <Save className="w-3 h-3" />
            {savingToDeal ? "Saving…" : `Set → Option ${optionLetter}`}
          </button>
        )}
        {mode === "estimate" && onSetOption && !optionLetter && (
          <div className="mt-3 px-2 py-2 bg-amber-50 border border-amber-200 text-[10px] text-amber-800 rounded-sm text-center">
            {system.warranty_years || "?"}-yr warranty has no Option slot — A/B/C/D map to 25/20/15/10-yr. The price is calculated for reference only.
          </div>
        )}
        {mode === "materials" && onPushMaterials && (
          <div className="mt-3 grid grid-cols-2 gap-1.5">
            <button
              onClick={onPushMaterials}
              disabled={savingToDeal || !hasRecipe}
              className="inline-flex items-center justify-center gap-1 px-2 h-9 text-[10px] font-bold uppercase tracking-wider bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed rounded-sm"
              data-testid={`push-materials-${testIdSuffix}`}
              title="Adds BoM lines to the deal's Material Take-off AND Vendor Cost Line Items."
            >
              <Save className="w-3 h-3" />
              {savingToDeal ? "Saving…" : "Push Materials"}
            </button>
            <button
              onClick={onPushAndPo}
              disabled={savingToDeal || !hasRecipe}
              className="inline-flex items-center justify-center gap-1 px-2 h-9 text-[10px] font-bold uppercase tracking-wider bg-emerald-700 text-white hover:bg-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed rounded-sm"
              data-testid={`push-and-po-${testIdSuffix}`}
              title="Push materials AND immediately download the Purchase Order PDF for this vendor."
            >
              <FileText className="w-3 h-3" />
              {savingToDeal ? "Saving…" : "Push + PO"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between font-mono">
      <span className="text-zinc-600">{label}</span>
      <span>{formatCurrency(value)}</span>
    </div>
  );
}

function PctEditableRow({ label, pct, amount, onChange, testId }) {
  return (
    <div className="flex items-center justify-between gap-2 font-mono">
      <span className="text-zinc-600 text-[11px] flex items-center gap-1">
        +
        <input
          type="number"
          min="0"
          max="100"
          step="0.5"
          value={pct ?? ""}
          onChange={(e) => onChange?.(e.target.value === "" ? null : Number(e.target.value))}
          className="w-12 border border-zinc-300 px-1 h-6 text-[11px] font-mono text-right focus:outline-none focus:border-blue-700"
          data-testid={testId}
          title={`${label} % — per-option override. Clear the field to fall back to the global default.`}
        />
        % {label}
      </span>
      <span>{formatCurrency(amount)}</span>
    </div>
  );
}
