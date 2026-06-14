"""Regression tests for vendor category → COGS account routing in gl.cogs_account_for.

Verifies the 4 new site-service rental vendor categories
(Equipment / Porta Potty / Dumpster / Storage Container) all map to
5020 Equipment Rental, while subcontractors stay on 5010 and the rest fall
back to 5000 Materials — Direct.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from gl import cogs_account_for  # noqa: E402


def test_subcontractor_kind_routes_to_5010():
    assert cogs_account_for({"kind": "Subcontractor", "category": "Subcontractor"}) == "5010"
    assert cogs_account_for({"kind": "subcontractor"}) == "5010"


def test_subcontractor_category_routes_to_5010_even_if_kind_is_vendor():
    # A "Vendor" kind with category=Subcontractor (rare data shape) should still hit 5010
    assert cogs_account_for({"kind": "Vendor", "category": "Subcontractor"}) == "5010"


def test_equipment_supplier_routes_to_5020():
    assert cogs_account_for({"kind": "Vendor", "category": "Equipment Supplier"}) == "5020"


def test_porta_potty_supplier_routes_to_5020():
    assert cogs_account_for({"kind": "Vendor", "category": "Porta Potty Supplier"}) == "5020"


def test_dumpster_supplier_routes_to_5020():
    assert cogs_account_for({"kind": "Vendor", "category": "Dumpster Supplier"}) == "5020"


def test_storage_container_supplier_routes_to_5020():
    assert cogs_account_for({"kind": "Vendor", "category": "Storage Container Supplier"}) == "5020"


def test_material_supplier_routes_to_5000():
    assert cogs_account_for({"kind": "Vendor", "category": "Material Supplier"}) == "5000"


def test_unknown_category_falls_back_to_5000():
    assert cogs_account_for({"kind": "Vendor", "category": "Other"}) == "5000"
    assert cogs_account_for({"kind": "Vendor", "category": ""}) == "5000"


def test_none_vendor_falls_back_to_5000():
    assert cogs_account_for(None) == "5000"


def test_case_insensitive_category_match():
    assert cogs_account_for({"kind": "Vendor", "category": "EQUIPMENT SUPPLIER"}) == "5020"
    assert cogs_account_for({"kind": "Vendor", "category": "porta potty supplier"}) == "5020"
