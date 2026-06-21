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
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import { api, formatCurrency, formatApiError } from "@/lib/api";
import { toast } from "sonner";
import { Calculator as CalcIcon, Plus, X, Save, ChevronLeft, Layers, AlertCircle, Loader2 } from "lucide-react";

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

const MAX_COMPARE = 4;

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
  const nav = useNavigate();
  const [params] = useSearchParams();
  const dealId = params.get("deal");

  const [products, setProducts] = useState([]);
  const [systems, setSystems] = useState([]);
  const [recipes, setRecipes] = useState({}); // {system_id: [recipe_rows]}
  const [settings, setSettings] = useState({ markup_pct: 15, handling_pct: 10, handling_basis: "marked_up", waste_pct: 0 });
  const [loading, setLoading] = useState(true);

  const [totalSf, setTotalSf] = useState("");
  const [waste, setWaste] = useState(0);
  const [allowedSizes, setAllowedSizes] = useState({ tote: true, drum: true, pail: true });
  const [selectedSystemIds, setSelectedSystemIds] = useState([]);
  const [addons, setAddons] = useState({});      // {addon_id: qty} (shared across compared systems)
  const [deal, setDeal] = useState(null);
  const [savingToDeal, setSavingToDeal] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get("/products"),
      api.get("/systems"),
      api.get("/calculator/settings"),
    ]).then(([p, s, st]) => {
      setProducts(p.data || []);
      setSystems(s.data || []);
      setSettings({ ...settings, ...(st.data || {}) });
      setWaste(Number((st.data || {}).waste_pct || 0));
    }).catch((e) => toast.error(formatApiError(e?.response?.data?.detail) || e.message))
      .finally(() => setLoading(false));

    if (dealId) {
      api.get(`/deals/${dealId}`).then((r) => {
        setDeal(r.data);
        // Deals store roof size as `property_sqft` (synced from the latest assessment)
        const sf = r.data.property_sqft || r.data.total_sf;
        if (sf) setTotalSf(String(sf));
      }).catch(() => setDeal(null));
    }
  }, [dealId]);

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

    // Apply add-ons (shared across all systems)
    const addonLines = [];
    for (const [aid, qty] of Object.entries(addons)) {
      if (!qty || qty <= 0) continue;
      const tpl = ADDON_TEMPLATES.find((a) => a.id === aid);
      if (!tpl) continue;
      // Pick the cheapest product with matching SKU (any container)
      const matching = products.filter((p) => p.sku === tpl.sku);
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
    }

    const rawCost = lines.reduce((s, l) => s + l.lineCost, 0) + addonLines.reduce((s, l) => s + l.lineCost, 0);
    const markedUp = rawCost * (1 + settings.markup_pct / 100);
    const handlingBase = settings.handling_basis === "raw" ? rawCost : markedUp;
    const handling = handlingBase * (settings.handling_pct / 100);
    const customer = markedUp + handling;
    const pricePerSf = sf > 0 ? customer / sf : 0;

    return { system, lines, addonLines, rawCost, markedUp, handling, customer, pricePerSf };
  };

  const columns = useMemo(() => {
    return selectedSystemIds
      .map((id) => systems.find((s) => s.id === id))
      .filter(Boolean)
      .map(computeBom);
  }, [selectedSystemIds, recipes, products, totalSf, waste, settings, addons, allowedSizes]);

  /** Save the picked column's BoM back to the originating deal's cost_items. */
  const saveColumnToDeal = async (col) => {
    if (!deal) return;
    if (!window.confirm(`Push this Bill of Materials to deal "${deal.title || deal.name || deal.id}" as Vendor Cost lines?`)) return;
    setSavingToDeal(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const newCostItems = [];
      // One cost line per product (rolled-up across container sizes)
      for (const ln of col.lines) {
        if (ln.lineCost <= 0) continue;
        const containerSummary = ln.packed.map((x) => {
          const kind = classifyContainer(x.product);
          const kindLabel = kind === "tote" ? "tote" : kind === "drum" ? "drum" : kind === "pail" ? "pail" : (x.product.unit || "");
          return `${x.qty}×${x.product.package_size}${x.product.unit} ${kindLabel}`;
        }).join(", ");
        newCostItems.push({
          category: "Materials",
          vendor_id: null,
          vendor_name: ln.product.vendor || "Western Colloid",
          description: `${ln.product.name.split(" — ")[0]} (${containerSummary}) — ${col.system.name}`,
          amount: Math.round(ln.lineCost * 100) / 100,
          date: today,
          status: "Pending",
        });
      }
      for (const ln of col.addonLines) {
        if (ln.lineCost <= 0) continue;
        const containerSummary = ln.packed.map((x) => {
          const kind = classifyContainer(x.product);
          const kindLabel = kind === "tote" ? "tote" : kind === "drum" ? "drum" : kind === "pail" ? "pail" : (x.product.unit || "");
          return `${x.qty}×${x.product.package_size}${x.product.unit} ${kindLabel}`;
        }).join(", ");
        newCostItems.push({
          category: "Materials",
          vendor_id: null,
          vendor_name: ln.packed[0]?.product?.vendor || "Western Colloid",
          description: `${ln.addon.label} (${containerSummary})`,
          amount: Math.round(ln.lineCost * 100) / 100,
          date: today,
          status: "Pending",
        });
      }
      // Note: we deliberately do NOT push the markup/handling line as a cost
      // item — it's customer-side margin, not a vendor expense. The Customer
      // Price is surfaced in the post-save toast so Darren can paste it into
      // the Proposal Options card himself.

      const merged = [...(deal.cost_items || []), ...newCostItems];
      const body = { ...deal, cost_items: merged };
      ["id","created_at","updated_at","created_by",
       "materials_cost","labor_cost","subcontractor_cost","other_expenses_total",
       "total_costs","profit","margin_pct","is_deleted","deleted_at","deleted_by",
       "assigned_user_name","primary_contact_name","property_name"
      ].forEach((k) => { delete body[k]; });
      await api.put(`/deals/${deal.id}`, body);
      toast.success(
        `Added ${newCostItems.length} material cost line${newCostItems.length === 1 ? "" : "s"} ($${col.rawCost.toFixed(0)}). ` +
        `Customer Price: ${formatCurrency(col.customer)} — set in Proposal Options if needed.`,
        { duration: 7000 }
      );
      nav(`/deals/${deal.id}`);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || e.message);
    } finally {
      setSavingToDeal(false);
    }
  };

  /** Sidebar: systems grouped by vendor + warranty band. */
  const systemsByVendor = useMemo(() => {
    const m = new Map();
    for (const s of systems) {
      const key = s.vendor || "Unknown";
      if (!m.has(key)) m.set(key, []);
      m.get(key).push(s);
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => (b.warranty_years || 0) - (a.warranty_years || 0));
    }
    return Array.from(m.entries());
  }, [systems]);

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
          <Link to={`/deals/${deal.id}`} className="inline-flex items-center gap-1 px-3 h-8 text-[10px] font-bold uppercase tracking-wider border border-zinc-300 bg-white hover:bg-zinc-50 rounded-sm" data-testid="back-to-deal">
            <ChevronLeft className="w-3 h-3" /> Back to Deal
          </Link>
        )}
      </header>

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
        {/* Systems sidebar */}
        <aside className="space-y-4">
          <div className="bg-white border border-zinc-200 rounded-sm shadow-sm">
            <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500 border-b border-zinc-200 flex items-center gap-1.5">
              <Layers className="w-3 h-3" /> Pick Systems ({selectedSystemIds.length}/{MAX_COMPARE})
            </div>
            <div className="max-h-[60vh] overflow-y-auto">
              {systemsByVendor.length === 0 && (
                <div className="p-4 text-sm text-zinc-500">No systems yet — import or add one in <Link to="/catalog" className="text-blue-700 underline">Product Catalog</Link>.</div>
              )}
              {systemsByVendor.map(([vendor, sys]) => (
                <div key={vendor} className="border-b border-zinc-100 last:border-b-0">
                  <div className="px-3 py-1.5 bg-zinc-50 text-[10px] font-bold uppercase tracking-widest text-zinc-700">{vendor}</div>
                  {sys.map((s) => {
                    const checked = selectedSystemIds.includes(s.id);
                    return (
                      <label
                        key={s.id}
                        className={`flex items-start gap-2 px-3 py-2 cursor-pointer hover:bg-blue-50 transition-colors ${checked ? "bg-blue-50" : ""}`}
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
              ))}
            </div>
          </div>

          {/* Add-ons */}
          <div className="bg-white border border-zinc-200 rounded-sm shadow-sm">
            <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500 border-b border-zinc-200">Optional Add-ons</div>
            <div className="p-3 space-y-2.5">
              {ADDON_TEMPLATES.map((a) => (
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
            <div className={`grid gap-4 ${columns.length === 1 ? "grid-cols-1" : columns.length === 2 ? "grid-cols-1 md:grid-cols-2" : columns.length === 3 ? "grid-cols-1 md:grid-cols-3" : "grid-cols-1 md:grid-cols-2 xl:grid-cols-4"}`}>
              {columns.map((col, idx) => (
                <CompareColumn
                  key={col.system.id}
                  col={col}
                  settings={settings}
                  totalSf={Number(totalSf)}
                  onRemove={() => toggleSystem(col.system.id)}
                  onSaveToDeal={deal ? () => saveColumnToDeal(col) : null}
                  savingToDeal={savingToDeal}
                  testIdSuffix={idx}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function CompareColumn({ col, settings, totalSf, onRemove, onSaveToDeal, savingToDeal, testIdSuffix }) {
  const { system, lines, addonLines, rawCost, markedUp, handling, customer, pricePerSf } = col;
  const hasRecipe = lines.length > 0;
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

        {onSaveToDeal && (
          <button
            onClick={onSaveToDeal}
            disabled={savingToDeal || !hasRecipe}
            className="mt-3 w-full inline-flex items-center justify-center gap-1 px-3 h-9 text-[10px] font-bold uppercase tracking-wider bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed rounded-sm"
            data-testid={`save-to-deal-${testIdSuffix}`}
          >
            <Save className="w-3 h-3" /> {savingToDeal ? "Saving…" : "Push to Deal"}
          </button>
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
