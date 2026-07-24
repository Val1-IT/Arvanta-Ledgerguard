"""Declarative definition of every LedgerGuard metadata asset in DataHub.

This module contains data only. `bootstrap.py` turns it into metadata change
proposals. Keeping it declarative is what makes the bootstrap idempotent: each
run emits the same aspects for the same URNs, so re-running converges on the
same state instead of accumulating duplicates.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, List, Sequence, Tuple

from datahub.metadata.urns import CorpGroupUrn, DatasetUrn, GlossaryTermUrn, TagUrn

# ---------------------------------------------------------------------------
# Platform / naming
# ---------------------------------------------------------------------------

PLATFORM = "postgres"
ENV = "PROD"
DATABASE = "ledgerguard"
SCHEMA = "public"

# Deterministic timestamp shared with the demo seed (src/domain/constants.ts).
BASE_DATE = datetime(2026, 1, 1, tzinfo=timezone.utc)


def dataset_name(table: str) -> str:
    return f"{DATABASE}.{SCHEMA}.{table}"


def dataset_urn(table: str) -> str:
    return str(DatasetUrn(platform=PLATFORM, name=dataset_name(table), env=ENV))


# ---------------------------------------------------------------------------
# Owners (corp groups)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class OwnerGroup:
    id: str
    display_name: str
    description: str
    email: str

    @property
    def urn(self) -> str:
        return str(CorpGroupUrn(self.id))


INVENTORY_OPS = OwnerGroup(
    id="inventory-operations",
    display_name="Inventory Operations",
    description="Owns product master data, unit definitions, and stock movements.",
    email="inventory-ops@ledgerguard.demo",
)
FINANCE_CONTROLLER = OwnerGroup(
    id="finance-controller",
    display_name="Finance Controller",
    description="Owns inventory valuation, the general ledger, and margin reporting.",
    email="finance-controller@ledgerguard.demo",
)
DATA_PLATFORM = OwnerGroup(
    id="data-platform",
    display_name="Data Platform",
    description="Owns the ERP data pipelines and the DataHub metadata graph.",
    email="data-platform@ledgerguard.demo",
)

OWNER_GROUPS: Sequence[OwnerGroup] = (INVENTORY_OPS, FINANCE_CONTROLLER, DATA_PLATFORM)


# ---------------------------------------------------------------------------
# Tags
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class TagDef:
    name: str
    description: str
    color: str

    @property
    def urn(self) -> str:
        return str(TagUrn(self.name))


TAG_ERP = TagDef("ERP", "Asset originates from the ERP transactional system.", "#1A1D24")
TAG_FINANCE_CRITICAL = TagDef(
    "Finance Critical",
    "Errors in this asset directly distort reported financial results.",
    "#B4341F",
)
TAG_INVENTORY_CRITICAL = TagDef(
    "Inventory Critical",
    "Errors in this asset distort stock quantities and inventory value.",
    "#E8B441",
)
TAG_AT_RISK = TagDef(
    "At Risk",
    "LedgerGuard has flagged this asset as affected by an open data-integrity incident.",
    "#B4341F",
)
TAG_TRUSTED = TagDef(
    "Trusted",
    "All LedgerGuard integrity checks currently pass for this asset.",
    "#2E7D4F",
)
TAG_REQUIRES_APPROVAL = TagDef(
    "Requires Approval",
    "Remediation touching this asset requires explicit human approval.",
    "#5B4FCF",
)

TAGS: Sequence[TagDef] = (
    TAG_ERP,
    TAG_FINANCE_CRITICAL,
    TAG_INVENTORY_CRITICAL,
    TAG_AT_RISK,
    TAG_TRUSTED,
    TAG_REQUIRES_APPROVAL,
)


# ---------------------------------------------------------------------------
# Glossary terms
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class TermDef:
    id: str
    display_name: str
    definition: str

    @property
    def urn(self) -> str:
        return str(GlossaryTermUrn(self.id))


TERM_UNIT_CONVERSION = TermDef(
    id="UnitConversion",
    display_name="Unit Conversion",
    definition=(
        "The factor that converts a quantity expressed in an alternative selling unit "
        "into the product's base unit. Example: 1 CARTON = 12 PCS. Every downstream "
        "stock quantity, inventory value, and cost of goods sold figure depends on it, "
        "so an incorrect factor silently misstates the financial statements."
    ),
)
TERM_INVENTORY_VALUATION = TermDef(
    id="InventoryValuation",
    display_name="Inventory Valuation",
    definition=(
        "The monetary value of stock on hand, computed as quantity on hand multiplied "
        "by average cost. Derived from base-unit movement quantities."
    ),
)
TERM_COGS = TermDef(
    id="CostOfGoodsSold",
    display_name="Cost of Goods Sold",
    definition=(
        "The cost attributed to goods sold in a period, posted to account 5110 and "
        "reported on the gross margin report. Derived from base-unit issue quantities "
        "valued at average cost."
    ),
)
TERM_GROSS_MARGIN = TermDef(
    id="GrossMargin",
    display_name="Gross Margin",
    definition=(
        "Revenue minus cost of goods sold, expressed in currency and as a percentage "
        "of revenue. The final downstream consumer of the unit-conversion chain."
    ),
)
TERM_FINANCIALLY_TRUSTED = TermDef(
    id="FinanciallyTrustedDataset",
    display_name="Financially Trusted Dataset",
    definition=(
        "A dataset whose values are relied upon for financial reporting and which is "
        "therefore covered by LedgerGuard's deterministic integrity checks."
    ),
)

TERMS: Sequence[TermDef] = (
    TERM_UNIT_CONVERSION,
    TERM_INVENTORY_VALUATION,
    TERM_COGS,
    TERM_GROSS_MARGIN,
    TERM_FINANCIALLY_TRUSTED,
)


# ---------------------------------------------------------------------------
# Datasets
# ---------------------------------------------------------------------------

# (column name, native postgres type, column description)
Column = Tuple[str, str, str]


@dataclass(frozen=True)
class DatasetDef:
    table: str
    description: str
    owners: Sequence[OwnerGroup]
    tags: Sequence[TagDef]
    terms: Sequence[TermDef]
    columns: Sequence[Column]
    custom_properties: Dict[str, str] = field(default_factory=dict)

    @property
    def urn(self) -> str:
        return dataset_urn(self.table)

    @property
    def name(self) -> str:
        return dataset_name(self.table)


PRODUCTS = DatasetDef(
    table="products",
    description=(
        "Product master data for the demo ERP. Defines each product's base unit and "
        "standard cost. Root of the inventory lineage chain."
    ),
    owners=(INVENTORY_OPS,),
    tags=(TAG_ERP,),
    terms=(TERM_FINANCIALLY_TRUSTED,),
    columns=(
        ("id", "text", "Primary key."),
        ("sku", "text", "Unique stock keeping unit code."),
        ("name", "text", "Human readable product name."),
        ("base_unit", "text", "Unit all quantities are normalised to (PCS)."),
        ("standard_cost", "numeric(18,2)", "Standard cost per base unit, in IDR."),
        ("created_at", "timestamptz", "Record creation time."),
    ),
    custom_properties={"erp_module": "inventory", "demo_row_count": "1"},
)

PRODUCT_UNITS = DatasetDef(
    table="product_units",
    description=(
        "Alternative selling units per product and the factor that converts them to "
        "the base unit. THE ROOT-CAUSE ASSET for the LedgerGuard demo incident: a "
        "single wrong conversion_factor (1 CARTON = 10 instead of 12 PCS) propagates "
        "into stock quantities, inventory value, journal postings, and gross margin."
    ),
    owners=(INVENTORY_OPS,),
    tags=(TAG_ERP, TAG_INVENTORY_CRITICAL, TAG_FINANCE_CRITICAL, TAG_REQUIRES_APPROVAL),
    terms=(TERM_UNIT_CONVERSION, TERM_FINANCIALLY_TRUSTED),
    columns=(
        ("id", "text", "Primary key."),
        ("product_id", "text", "Foreign key to products.id."),
        ("unit_name", "text", "Unit label, e.g. PCS or CARTON."),
        (
            "conversion_factor",
            "numeric(12,4)",
            "Number of base units in one of this unit. Correct value for CARTON is 12. "
            "Must always be greater than zero; every downstream financial figure is a "
            "function of this number.",
        ),
        ("valid_from", "timestamptz", "Start of validity for this factor."),
        ("updated_at", "timestamptz", "Last modification time — the change audit trail."),
    ),
    custom_properties={"erp_module": "inventory", "demo_row_count": "2"},
)

INVENTORY_MOVEMENTS = DatasetDef(
    table="inventory_movements",
    description=(
        "Every stock receipt and issue. Quantities are captured in the transacting "
        "unit and normalised to base units via product_units.conversion_factor."
    ),
    owners=(INVENTORY_OPS, DATA_PLATFORM),
    tags=(TAG_ERP, TAG_INVENTORY_CRITICAL, TAG_FINANCE_CRITICAL),
    terms=(TERM_UNIT_CONVERSION, TERM_FINANCIALLY_TRUSTED),
    columns=(
        ("id", "text", "Primary key."),
        ("product_id", "text", "Foreign key to products.id."),
        ("movement_type", "text", "'in' for receipts, 'out' for issues."),
        ("quantity", "numeric(18,3)", "Quantity in the transacting unit."),
        ("unit_name", "text", "Transacting unit, joins to product_units.unit_name."),
        (
            "base_quantity",
            "numeric(18,3)",
            "quantity x conversion_factor. Integrity check 2 asserts this identity "
            "holds for every row.",
        ),
        ("unit_cost", "numeric(18,2)", "Cost per base unit at movement time, in IDR."),
        ("total_value", "numeric(18,2)", "Monetary value of the movement, in IDR."),
        ("occurred_at", "timestamptz", "Business time of the movement."),
    ),
    custom_properties={"erp_module": "inventory", "demo_row_count": "60"},
)

INVENTORY_VALUATION = DatasetDef(
    table="inventory_valuation",
    description=(
        "Current stock position and its monetary value per product, aggregated from "
        "inventory_movements base quantities."
    ),
    owners=(FINANCE_CONTROLLER, DATA_PLATFORM),
    tags=(TAG_ERP, TAG_FINANCE_CRITICAL, TAG_INVENTORY_CRITICAL),
    terms=(TERM_INVENTORY_VALUATION, TERM_FINANCIALLY_TRUSTED),
    columns=(
        ("id", "text", "Primary key."),
        ("product_id", "text", "Foreign key to products.id."),
        (
            "quantity_on_hand",
            "numeric(18,3)",
            "Base units in stock: sum(in) - sum(out). Integrity check 4 asserts this "
            "matches the movement aggregate.",
        ),
        ("average_cost", "numeric(18,2)", "Weighted average cost per base unit, in IDR."),
        (
            "inventory_value",
            "numeric(18,2)",
            "quantity_on_hand x average_cost. The balance-sheet inventory figure.",
        ),
        ("calculated_at", "timestamptz", "When the valuation was last recomputed."),
    ),
    custom_properties={"erp_module": "finance", "demo_row_count": "1"},
)

JOURNAL_ENTRIES = DatasetDef(
    table="journal_entries",
    description=(
        "General ledger postings generated by inventory and sales transactions. "
        "Account 5110 carries cost of goods sold; 1140 carries inventory."
    ),
    owners=(FINANCE_CONTROLLER,),
    tags=(TAG_ERP, TAG_FINANCE_CRITICAL, TAG_REQUIRES_APPROVAL),
    terms=(TERM_COGS, TERM_FINANCIALLY_TRUSTED),
    columns=(
        ("id", "text", "Primary key."),
        ("source_type", "text", "'purchase' or 'sale'."),
        ("source_id", "text", "Identifier of the originating transaction."),
        ("account_code", "text", "Chart of accounts code (1110/1140/2110/4110/5110)."),
        ("debit", "numeric(18,2)", "Debit amount in IDR."),
        ("credit", "numeric(18,2)", "Credit amount in IDR."),
        ("posted_at", "timestamptz", "Posting time."),
    ),
    custom_properties={"erp_module": "finance", "demo_row_count": "132"},
)

GROSS_MARGIN_REPORT = DatasetDef(
    table="gross_margin_report",
    description=(
        "Period gross margin reporting. The final downstream consumer of the "
        "unit-conversion lineage chain and the asset where the financial impact of a "
        "conversion error becomes visible to management."
    ),
    owners=(FINANCE_CONTROLLER,),
    tags=(TAG_ERP, TAG_FINANCE_CRITICAL),
    terms=(TERM_GROSS_MARGIN, TERM_COGS, TERM_FINANCIALLY_TRUSTED),
    columns=(
        ("id", "text", "Primary key."),
        ("period", "text", "Reporting period, e.g. 2026-01."),
        ("revenue", "numeric(18,2)", "Total revenue for the period, in IDR."),
        (
            "cost_of_goods_sold",
            "numeric(18,2)",
            "COGS for the period. Integrity check 5 asserts this matches the sum of "
            "account 5110 journal postings.",
        ),
        ("gross_profit", "numeric(18,2)", "revenue - cost_of_goods_sold."),
        ("gross_margin_percentage", "numeric(7,4)", "gross_profit / revenue x 100."),
        ("generated_at", "timestamptz", "When the report was generated."),
    ),
    custom_properties={"erp_module": "finance", "demo_row_count": "1"},
)

DATASETS: Sequence[DatasetDef] = (
    PRODUCTS,
    PRODUCT_UNITS,
    INVENTORY_MOVEMENTS,
    INVENTORY_VALUATION,
    JOURNAL_ENTRIES,
    GROSS_MARGIN_REPORT,
)

DATASET_TABLES: List[str] = [d.table for d in DATASETS]
