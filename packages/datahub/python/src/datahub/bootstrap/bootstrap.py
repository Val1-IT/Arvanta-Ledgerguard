"""Idempotent DataHub metadata bootstrap for Arvanta LedgerGuard.

Provisions everything the agent needs as context: owner groups, tags, glossary
terms, the six ERP datasets with schemas and descriptions, dataset-level and
column-level lineage, and quality assertions with a passing baseline run.

Every write is an upsert against a stable URN, so running this repeatedly
converges on the same state. Usage:

    npm run datahub:bootstrap
"""

from __future__ import annotations

import argparse
import json
import logging
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import List

from datahub.emitter.mcp import MetadataChangeProposalWrapper
from datahub.ingestion.graph.client import DataHubGraph
from datahub.metadata import schema_classes as models
from datahub.sdk import DataHubClient, Dataset, GlossaryTerm, Tag

from .assets import (
    BASE_DATE,
    DATASETS,
    OWNER_GROUPS,
    TAGS,
    TERMS,
    DatasetDef,
)
from .config import REPO_ROOT, DataHubConnection, load_connection, make_client, make_graph
from .lineage import EDGES
from .quality import ASSERTIONS

logger = logging.getLogger("ledgerguard.bootstrap")

BASE_DATE_MS = int(BASE_DATE.timestamp() * 1000)
BASELINE_RUN_ID = "ledgerguard-bootstrap-baseline"
OWNERSHIP_TYPE = models.OwnershipTypeClass.TECHNICAL_OWNER
REPORT_PATH = REPO_ROOT / "examples" / "datahub" / "bootstrap-report.json"


@dataclass
class BootstrapReport:
    """What the run actually wrote — used by tests and the checkpoint report."""

    owner_groups: List[str] = field(default_factory=list)
    tags: List[str] = field(default_factory=list)
    terms: List[str] = field(default_factory=list)
    datasets: List[str] = field(default_factory=list)
    lineage_edges: List[str] = field(default_factory=list)
    column_lineage_edges: int = 0
    assertions: List[str] = field(default_factory=list)

    def write(self, path: Path = REPORT_PATH) -> Path:
        """Persist the run result so the idempotency test can diff two runs."""
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(asdict(self), indent=2) + "\n", encoding="utf-8")
        return path

    def summary(self) -> str:
        return (
            f"{len(self.owner_groups)} owner groups, {len(self.tags)} tags, "
            f"{len(self.terms)} glossary terms, {len(self.datasets)} datasets, "
            f"{len(self.lineage_edges)} lineage edges "
            f"({self.column_lineage_edges} column-level mappings), "
            f"{len(self.assertions)} assertions"
        )


# ---------------------------------------------------------------------------
# Individual steps
# ---------------------------------------------------------------------------


def bootstrap_owner_groups(graph: DataHubGraph, report: BootstrapReport) -> None:
    for group in OWNER_GROUPS:
        graph.emit_mcp(
            MetadataChangeProposalWrapper(
                entityUrn=group.urn,
                aspect=models.CorpGroupInfoClass(
                    admins=[],
                    members=[],
                    groups=[],
                    displayName=group.display_name,
                    email=group.email,
                    description=group.description,
                ),
            )
        )
        report.owner_groups.append(group.urn)
        logger.info("owner group  %s", group.urn)


def bootstrap_tags(client: DataHubClient, report: BootstrapReport) -> None:
    for tag in TAGS:
        client.entities.upsert(
            Tag(name=tag.name, description=tag.description, color=tag.color)
        )
        report.tags.append(tag.urn)
        logger.info("tag          %s", tag.urn)


def bootstrap_terms(client: DataHubClient, report: BootstrapReport) -> None:
    for term in TERMS:
        client.entities.upsert(
            GlossaryTerm(
                id=term.id,
                display_name=term.display_name,
                definition=term.definition,
            )
        )
        report.terms.append(term.urn)
        logger.info("glossary     %s", term.urn)


def _to_dataset(definition: DatasetDef) -> Dataset:
    return Dataset(
        platform="postgres",
        name=definition.name,
        description=definition.description,
        subtype="Table",
        custom_properties=definition.custom_properties,
        schema=list(definition.columns),
        owners=[(o.urn, OWNERSHIP_TYPE) for o in definition.owners],
        tags=[t.urn for t in definition.tags],
        terms=[t.urn for t in definition.terms],
    )


def bootstrap_datasets(client: DataHubClient, report: BootstrapReport) -> None:
    for definition in DATASETS:
        client.entities.upsert(_to_dataset(definition))
        report.datasets.append(definition.urn)
        logger.info("dataset      %s", definition.urn)


def bootstrap_lineage(client: DataHubClient, report: BootstrapReport) -> None:
    for edge in EDGES:
        client.lineage.add_lineage(
            upstream=edge.upstream.urn,
            downstream=edge.downstream.urn,
            column_lineage=edge.column_lineage,
            transformation_text=edge.transformation,
        )
        report.lineage_edges.append(edge.label)
        report.column_lineage_edges += len(edge.column_lineage)
        logger.info("lineage      %s (%d column mappings)", edge.label, len(edge.column_lineage))


def bootstrap_assertions(graph: DataHubGraph, report: BootstrapReport) -> None:
    """Publish assertion definitions plus a passing baseline run.

    DataHub OSS models the assertion and its run status; LedgerGuard remains the
    evaluator that actually executes the SQL against the demo database.
    """
    for assertion in ASSERTIONS:
        graph.emit_mcp(
            MetadataChangeProposalWrapper(
                entityUrn=assertion.urn,
                aspect=models.AssertionInfoClass(
                    type=models.AssertionTypeClass.DATASET,
                    description=assertion.description,
                    datasetAssertion=models.DatasetAssertionInfoClass(
                        dataset=assertion.dataset.urn,
                        scope=models.DatasetAssertionScopeClass.DATASET_ROWS,
                        fields=list(assertion.field_urns()),
                        operator=models.AssertionStdOperatorClass.EQUAL_TO,
                        aggregation=models.AssertionStdAggregationClass.ROW_COUNT,
                        parameters=models.AssertionStdParametersClass(
                            value=models.AssertionStdParameterClass(
                                value="0",
                                type=models.AssertionStdParameterTypeClass.NUMBER,
                            )
                        ),
                        nativeType="ledgerguard_integrity_check",
                        logic=assertion.logic,
                    ),
                    source=models.AssertionSourceClass(
                        type=models.AssertionSourceTypeClass.EXTERNAL
                    ),
                    customProperties={
                        "evaluator": "arvanta-ledgerguard",
                        "expected_violating_rows": "0",
                    },
                ),
            )
        )
        # Attach the assertion to its dataset so it shows up under Validation.
        graph.emit_mcp(
            MetadataChangeProposalWrapper(
                entityUrn=assertion.urn,
                aspect=models.AssertionRunEventClass(
                    timestampMillis=BASE_DATE_MS,
                    runId=BASELINE_RUN_ID,
                    asserteeUrn=assertion.dataset.urn,
                    assertionUrn=assertion.urn,
                    status=models.AssertionRunStatusClass.COMPLETE,
                    result=models.AssertionResultClass(
                        type=models.AssertionResultTypeClass.SUCCESS,
                        actualAggValue=0,
                        nativeResults={"violating_rows": "0", "source": "healthy baseline seed"},
                    ),
                ),
            )
        )
        report.assertions.append(assertion.urn)
        logger.info("assertion    %s", assertion.urn)


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


def run_bootstrap(connection: DataHubConnection | None = None) -> BootstrapReport:
    conn = connection or load_connection()
    graph = make_graph(conn)
    client = make_client(graph)
    report = BootstrapReport()

    logger.info("Connected to DataHub GMS at %s (token %s)", conn.gms_url, conn.redacted_token)

    bootstrap_owner_groups(graph, report)
    bootstrap_tags(client, report)
    bootstrap_terms(client, report)
    bootstrap_datasets(client, report)
    bootstrap_lineage(client, report)
    bootstrap_assertions(graph, report)

    graph.flush()
    logger.info("Bootstrap complete: %s", report.summary())
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description="Bootstrap LedgerGuard metadata into DataHub.")
    parser.add_argument("--quiet", action="store_true", help="Only print the final summary.")
    parser.add_argument(
        "--report",
        default=str(REPORT_PATH),
        help="Where to write the machine-readable run report.",
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.WARNING if args.quiet else logging.INFO,
        format="%(message)s",
    )
    report = run_bootstrap()
    written = report.write(Path(args.report))
    print(f"OK  {report.summary()}")
    print(f"Report written to {written}")


if __name__ == "__main__":
    main()
