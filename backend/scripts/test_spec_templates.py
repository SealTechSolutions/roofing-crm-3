"""Smoke test — render one PDF per roof type and write to /tmp."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from spec_sheet import build_spec_sheet

sample = {
    "contact_name": "Jane Owner",
    "contact_phone": "(720) 555-1212",
    "project_address": "1234 Industrial Blvd  ·  Denver, CO 80216",
    "product_type": "{rt} Roof System Over Existing Membrane",
    "date": "06/12/2026",
    "opt_20": 125000, "opt_15": 115000, "opt_10": 95000,
    "w20": 18000, "w15": 12000, "w10": 6000,
    "total_sqft": 24500,
    "color": "white",
}

ROOF_TYPES = [
    "Silicone", "TPO", "EPDM", "ModBit", "BUR (Built-Up)",
    "Metal", "Shingle", "Tile", "FARM (Fluid Applied Reinforced Membrane)",
    "PVC",
]

for rt in ROOF_TYPES:
    data = dict(sample)
    data["product_type"] = sample["product_type"].format(rt=rt)
    data["roof_type_label"] = rt
    pdf = build_spec_sheet(data, roof_type=rt)
    out = f"/tmp/spec_{rt.split()[0].replace('(','').replace(')','')}.pdf"
    with open(out, "wb") as fh:
        fh.write(pdf)
    print(f"[OK] {rt:<40} -> {out} ({len(pdf):,} bytes)")
