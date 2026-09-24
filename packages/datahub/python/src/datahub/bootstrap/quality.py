"""Quality context published to DataHub as OSS-supported assertion metadata.

DataHub OSS does not schedule or execute custom-SQL assertions itself. LedgerGuard
is the evaluator: it runs the five integrity checks deterministically against the
demo Postgres and publishes the definition and the latest run status to DataHub as
`assertionInfo` + `assertionRunEvent` aspects, which OSS does model natively.

This module declares the assertion definitions. Run results are published from the
engine later (FASE 4+); the bootstrap seeds a passing baseline so the assets carry
real quality context from the start.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

from datahub.metadata.urns import AssertionUrn, SchemaFieldUrn

from .assets import (
    GROSS_MARGIN_REPORT,
    INVENTORY_MOVEMENTS,
    INVENTORY_VALUATION,
    JOURNAL_ENTRIES,
    PRODUCT_UNITS,
    DatasetDef,
)


@dataclass(frozen=True)
class AssertionDef:
    """One deterministic ERP integrity check."""

    id: str
    dataset: DatasetDef
    fields: Sequence[str]
    description: str
    logic: str

    @property
    def urn(self) -> str:
        return str(AssertionUrn(self.id))

    def field_urns(self) -> Sequence[str]:
        return [str(SchemaFieldUrn(self.dataset.urn, f)) for f in self.fields]


# The five checks. IDs are stable strings so re-running the bootstrap targets the
# same assertion URNs instead of creating new ones.
ASSERTIONS: Sequence[AssertionDef] = (
    AssertionDef(
        id="ledgerguard_check_1_conversion_factor_positive",
        dataset=PRODUCT_UNITS,
        fields=("conversion_factor",),
        description="Every unit conversion factor must be greater than zero.",
        logic="select count(*) from product_units where conversion_factor <= 0  -- expect 0",
    ),
    AssertionDef(
        id="ledgerguard_check_2_base_quantity_identity",
        dataset=INVENTORY_MOVEMENTS,
        fields=("base_quantity",),
        description=(
            "base_quantity must equal quantity x the product's conversion factor for "
            "every movement. This is the check that fires first on a conversion error."
        ),
        logic=(
            "select count(*) from inventory_movements m join product_units u on "
            "u.product_id = m.product_id and u.unit_name = m.unit_name where "
            "abs(m.base_quantity - (m.quantity * u.conversion_factor)) > 0.001  -- expect 0"
        ),
    ),
    AssertionDef(
        id="ledgerguard_check_3_journals_balanced",
        dataset=JOURNAL_ENTRIES,
        fields=("debit", "credit"),
        description="Total debit must equal total credit for every journal source document.",
        logic=(
            "select count(*) from (select source_type, source_id from journal_entries "
            "group by 1,2 having abs(sum(debit) - sum(credit)) > 0.001) t  -- expect 0"
        ),
    ),
    AssertionDef(
        id="ledgerguard_check_4_valuation_matches_movements",
        dataset=INVENTORY_VALUATION,
        fields=("quantity_on_hand",),
        description=(
            "quantity_on_hand must equal the aggregated base-unit movements "
            "(receipts minus issues) for the product."
        ),
        logic=(
            "with agg as (select product_id, sum(case when movement_type = 'in' then "
            "base_quantity else -base_quantity end) as qty from inventory_movements "
            "group by 1) select count(*) from inventory_valuation v join agg a on "
            "a.product_id = v.product_id where abs(v.quantity_on_hand - a.qty) > 0.001  -- expect 0"
        ),
    ),
    AssertionDef(
        id="ledgerguard_check_5_cogs_matches_ledger",
        dataset=GROSS_MARGIN_REPORT,
        fields=("cost_of_goods_sold",),
        description=(
            "Reported cost of goods sold must equal the net of account 5110 postings "
            "in the general ledger."
        ),
        logic=(
            "with ledger as (select sum(debit - credit) as cogs from journal_entries "
            "where account_code = '5110') select count(*) from gross_margin_report r, "
            "ledger l where abs(r.cost_of_goods_sold - l.cogs) > 0.001  -- expect 0"
        ),
    ),
)
