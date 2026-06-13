"""SealTech Books module — multi-entity Chart of Accounts foundation.

Phase 1 deliverable: Entities + Chart of Accounts only. Auto-journal hooks
(Invoice → GL, Bill → GL, etc.) come in Phase 2.
"""
from typing import Optional, List
from pydantic import BaseModel, ConfigDict


ACCOUNT_TYPES = ["Asset", "Liability", "Equity", "Revenue", "COGS", "Expense", "Other"]


# Default Chart of Accounts seeded for every new entity (matches the design sketch).
DEFAULT_COA = [
    # 1000s — Assets
    {"number": "1000", "name": "Bank — Operating Checking", "type": "Asset", "category": "Bank"},
    {"number": "1010", "name": "Bank — Payroll Checking", "type": "Asset", "category": "Bank"},
    {"number": "1020", "name": "Bank — Savings / Reserves", "type": "Asset", "category": "Bank"},
    {"number": "1100", "name": "Accounts Receivable", "type": "Asset", "category": "AR", "system": True},
    {"number": "1150", "name": "Allowance for Doubtful Accounts", "type": "Asset", "category": "Contra-AR", "is_contra": True},
    {"number": "1200", "name": "Materials Inventory", "type": "Asset", "category": "Inventory"},
    {"number": "1250", "name": "Work-In-Progress (WIP)", "type": "Asset", "category": "Inventory"},
    {"number": "1500", "name": "Trucks & Equipment", "type": "Asset", "category": "Fixed Asset"},
    {"number": "1510", "name": "Accumulated Depreciation", "type": "Asset", "category": "Contra-Fixed", "is_contra": True},
    {"number": "1900", "name": "Inter-Company Receivable", "type": "Asset", "category": "Inter-Co", "system": True},
    # 2000s — Liabilities
    {"number": "2000", "name": "Accounts Payable", "type": "Liability", "category": "AP", "system": True},
    {"number": "2050", "name": "Credit Card — Operating", "type": "Liability", "category": "Credit Card"},
    {"number": "2100", "name": "Customer Deposits", "type": "Liability", "category": "Deferred Revenue", "system": True},
    {"number": "2150", "name": "Sales Tax Payable", "type": "Liability", "category": "Tax"},
    {"number": "2200", "name": "Payroll Liabilities", "type": "Liability", "category": "Payroll"},
    {"number": "2900", "name": "Inter-Company Payable", "type": "Liability", "category": "Inter-Co", "system": True},
    # 3000s — Equity
    {"number": "3000", "name": "Owner's Capital", "type": "Equity", "category": "Equity"},
    {"number": "3100", "name": "Retained Earnings", "type": "Equity", "category": "Equity", "system": True},
    {"number": "3900", "name": "Distributions", "type": "Equity", "category": "Equity"},
    # 4000s — Revenue
    {"number": "4000", "name": "Roofing Revenue — Restoration (Silicone)", "type": "Revenue", "category": "Sales", "system": True},
    {"number": "4010", "name": "Roofing Revenue — Re-Roof / Replacement", "type": "Revenue", "category": "Sales", "system": True},
    {"number": "4020", "name": "Roofing Revenue — New Construction", "type": "Revenue", "category": "Sales", "system": True},
    {"number": "4030", "name": "Roofing Revenue — FARM", "type": "Revenue", "category": "Sales", "system": True},
    {"number": "4100", "name": "Maintenance Plan Revenue", "type": "Revenue", "category": "Sales", "system": True},
    {"number": "4150", "name": "Change Order Revenue", "type": "Revenue", "category": "Sales"},
    {"number": "4200", "name": "Late Fees Earned", "type": "Revenue", "category": "Other Income", "system": True},
    {"number": "4900", "name": "Inter-Company Revenue", "type": "Revenue", "category": "Inter-Co", "system": True},
    # 5000s — COGS
    {"number": "5000", "name": "Materials — Direct", "type": "COGS", "category": "Job Cost", "system": True},
    {"number": "5010", "name": "Subcontractor Labor", "type": "COGS", "category": "Job Cost", "system": True},
    {"number": "5020", "name": "Equipment Rental", "type": "COGS", "category": "Job Cost"},
    {"number": "5030", "name": "Direct Labor / Crew Wages", "type": "COGS", "category": "Job Cost"},
    {"number": "5040", "name": "Job Supplies", "type": "COGS", "category": "Job Cost"},
    {"number": "5050", "name": "Permits & Inspections", "type": "COGS", "category": "Job Cost"},
    # 6000s — Operating Expense
    {"number": "6000", "name": "Rent — Office / Yard", "type": "Expense", "category": "Facilities"},
    {"number": "6100", "name": "Vehicle — Fuel", "type": "Expense", "category": "Vehicle"},
    {"number": "6110", "name": "Vehicle — Repairs", "type": "Expense", "category": "Vehicle"},
    {"number": "6200", "name": "Insurance — General Liability", "type": "Expense", "category": "Insurance"},
    {"number": "6210", "name": "Insurance — Workers Comp", "type": "Expense", "category": "Insurance"},
    {"number": "6300", "name": "Office & Admin", "type": "Expense", "category": "Office"},
    {"number": "6400", "name": "Sales Commissions", "type": "Expense", "category": "Sales"},
    {"number": "6500", "name": "Marketing & Advertising", "type": "Expense", "category": "Marketing"},
    {"number": "6900", "name": "Bank / Credit Card Fees", "type": "Expense", "category": "Bank Fees"},
    # 9000s — Other
    {"number": "9000", "name": "Interest Income / Expense", "type": "Other", "category": "Other"},
    {"number": "9100", "name": "Gain/Loss on Asset Sale", "type": "Other", "category": "Other"},
]


class EntityIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str
    legal_name: str = ""
    role: str = ""  # short tag e.g., "Parent", "Labor", "Properties", "Commissions"
    is_parent: bool = False
    tax_id: str = ""
    address: str = ""
    city: str = ""
    state: str = ""
    zip_code: str = ""
    email: str = ""
    phone: str = ""
    remit_to_address: str = ""
    is_active: bool = True


class AccountIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    entity_id: str
    number: str
    name: str
    type: str  # one of ACCOUNT_TYPES
    category: str = ""
    description: str = ""
    is_contra: bool = False
    is_active: bool = True
