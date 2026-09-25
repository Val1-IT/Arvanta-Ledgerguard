"""Dataset-level and column-level lineage for the LedgerGuard demo.

The chain LedgerGuard's agent has to be able to traverse is:

    product_units.conversion_factor
      -> inventory_movements.base_quantity
        -> inventory_valuation.inventory_value
          -> journal_entries
            -> gross_margin_report

Column lineage is expressed as {downstream_column: [upstream_columns]}, which the
DataHub SDK turns into fineGrainedLineage entries on the downstream dataset.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Sequence

from .assets import (
    GROSS_MARGIN_REPORT,
    INVENTORY_MOVEMENTS,
    INVENTORY_VALUATION,
    JOURNAL_ENTRIES,
    PRODUCT_UNITS,
    PRODUCTS,
    DatasetDef,
)


@dataclass(frozen=True)
class LineageEdge:
    upstream: DatasetDef
    downstream: DatasetDef
    # {downstream_column: [upstream_columns]}
    column_lineage: Dict[str, List[str]]
    transformation: str

    @property
    def label(self) -> str:
        return f"{self.upstream.table} -> {self.downstream.table}"


EDGES: Sequence[LineageEdge] = (
    LineageEdge(
        upstream=PRODUCTS,
        downstream=INVENTORY_MOVEMENTS,
        column_lineage={
            "product_id": ["id"],
            "unit_cost": ["standard_cost"],
        },
        transformation=(
            "Movements reference the product master; unit_cost is seeded from the "
            "product standard cost."
        ),
    ),
    LineageEdge(
        upstream=PRODUCT_UNITS,
        downstream=INVENTORY_MOVEMENTS,
        column_lineage={
            # The single most important edge in the whole graph.
            "base_quantity": ["conversion_factor", "unit_name"],
            "unit_name": ["unit_name"],
        },
        transformation="base_quantity = quantity * product_units.conversion_factor",
    ),
    LineageEdge(
        upstream=INVENTORY_MOVEMENTS,
        downstream=INVENTORY_VALUATION,
        column_lineage={
            "quantity_on_hand": ["base_quantity", "movement_type"],
            "average_cost": ["total_value", "base_quantity"],
            "inventory_value": ["base_quantity", "unit_cost", "total_value"],
        },
        transformation=(
            "quantity_on_hand = sum(base_quantity where in) - sum(base_quantity where "
            "out); average_cost = sum(total_value in) / sum(base_quantity in); "
            "inventory_value = quantity_on_hand * average_cost"
        ),
    ),
    LineageEdge(
        upstream=INVENTORY_VALUATION,
        downstream=JOURNAL_ENTRIES,
        column_lineage={
            "debit": ["inventory_value", "average_cost"],
            "credit": ["inventory_value", "average_cost"],
        },
        transformation=(
            "Inventory and COGS postings are valued at average_cost derived from the "
            "valuation record; account 5110 carries cost of goods sold."
        ),
    ),
    LineageEdge(
        upstream=JOURNAL_ENTRIES,
        downstream=GROSS_MARGIN_REPORT,
        column_lineage={
            "cost_of_goods_sold": ["debit", "account_code"],
            "revenue": ["credit", "account_code"],
            "gross_profit": ["debit", "credit"],
            "gross_margin_percentage": ["debit", "credit"],
        },
        transformation=(
            "cost_of_goods_sold = sum(debit - credit) for account 5110; revenue = "
            "sum(credit - debit) for account 4110; gross_profit = revenue - "
            "cost_of_goods_sold; gross_margin_percentage = gross_profit / revenue * 100"
        ),
    ),
)

# The path the FASE 3B MCP proof must be able to traverse.
CRITICAL_PATH: Sequence[DatasetDef] = (
    PRODUCT_UNITS,
    INVENTORY_MOVEMENTS,
    INVENTORY_VALUATION,
    JOURNAL_ENTRIES,
    GROSS_MARGIN_REPORT,
)
