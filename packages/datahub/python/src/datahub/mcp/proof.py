"""FASE 3B — MCP connectivity proof.

Proves, through the official self-hosted DataHub MCP server (no GraphQL, no SDK),
that an agent can obtain every piece of context LedgerGuard's investigation needs:

  1. search for the dataset `product_units`
  2. read its schema
  3. find the field `conversion_factor`
  4. read the dataset owner
  5. read tags and glossary terms
  6. traverse downstream lineage `product_units` -> `gross_margin_report`
  7. emit a real activity log (MCP tool name, time, brief input, brief result)

Nothing is hardcoded or simulated: every assertion is evaluated against the actual
MCP response text, and a step that cannot be satisfied is reported as FAILED.

    npm run datahub:mcp-proof
"""

from __future__ import annotations

import asyncio
import json
import re
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Sequence

from ..bootstrap.assets import (
    GROSS_MARGIN_REPORT,
    INVENTORY_MOVEMENTS,
    INVENTORY_VALUATION,
    JOURNAL_ENTRIES,
    PRODUCT_UNITS,
)
from ..bootstrap.config import REPO_ROOT
from .session import LoggedMcpSession, open_mcp_session

REPORT_PATH = REPO_ROOT / "examples" / "mcp" / "proof-report.json"
LOG_PATH = REPO_ROOT / "examples" / "mcp" / "activity-log.jsonl"

# Tool-name candidates, most preferred first. The MCP server's tool surface has
# changed across releases, so the proof resolves names from the live tool list
# instead of assuming a version.
SEARCH_TOOLS = ("search", "search_entities", "search_assets")
ENTITY_TOOLS = ("get_entities", "get_dataset", "get_entity", "get_asset")
SCHEMA_FIELD_TOOLS = ("list_schema_fields", "get_schema_fields", "search_schema_fields")
LINEAGE_TOOLS = ("get_lineage", "get_lineage_paths_between", "lineage")


@dataclass
class ProofStep:
    number: int
    name: str
    tool: str
    passed: bool
    detail: str
    evidence: str = ""


@dataclass
class ProofReport:
    gms_reachable: bool = False
    mcp_server: str = "mcp-server-datahub (self-hosted, stdio)"
    available_tools: List[str] = field(default_factory=list)
    steps: List[ProofStep] = field(default_factory=list)
    activity_log: str = ""
    activity_entries: int = 0

    @property
    def passed(self) -> bool:
        return bool(self.steps) and all(s.passed for s in self.steps)

    def write(self, path: Path = REPORT_PATH) -> Path:
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = asdict(self)
        payload["passed"] = self.passed
        path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        return path


def _pick(tools: Sequence[str], candidates: Sequence[str]) -> Optional[str]:
    for candidate in candidates:
        if candidate in tools:
            return candidate
    return None


def _short(text: str, limit: int = 400) -> str:
    flat = " ".join(text.split())
    return flat[:limit] + ("…" if len(flat) > limit else "")


async def _search(session: LoggedMcpSession, tool: str, query: str) -> str:
    """Call the search tool, tolerating small argument-name differences."""
    attempts: List[Dict[str, object]] = [
        {"query": query, "num_results": 10},
        {"query": query},
        {"input": query},
    ]
    last: Exception | None = None
    for args in attempts:
        try:
            return await session.call(tool, args)
        except Exception as exc:  # try the next argument shape
            last = exc
    raise RuntimeError(f"search tool {tool} rejected every argument shape: {last}")


async def _read_entity(session: LoggedMcpSession, tool: str, urn: str) -> str:
    attempts: List[Dict[str, object]] = [
        {"urns": [urn]},
        {"urn": urn},
        {"dataset_urn": urn},
    ]
    last: Exception | None = None
    for args in attempts:
        try:
            return await session.call(tool, args)
        except Exception as exc:
            last = exc
    raise RuntimeError(f"entity tool {tool} rejected every argument shape: {last}")


async def _lineage(session: LoggedMcpSession, tool: str, urn: str) -> str:
    attempts: List[Dict[str, object]] = [
        {"urn": urn, "upstream": False, "max_hops": 5},
        {"urn": urn, "direction": "DOWNSTREAM", "max_hops": 5},
        {"urn": urn, "upstream": False},
        {"urn": urn},
    ]
    last: Exception | None = None
    for args in attempts:
        try:
            return await session.call(tool, args)
        except Exception as exc:
            last = exc
    raise RuntimeError(f"lineage tool {tool} rejected every argument shape: {last}")


async def _fields(session: LoggedMcpSession, tool: str, urn: str, query: str) -> str:
    """Call the schema-field tool, tolerating small argument-name differences."""
    attempts: List[Dict[str, object]] = [
        {"urn": urn, "query": query},
        {"urn": urn},
        {"dataset_urn": urn, "query": query},
        {"dataset_urn": urn},
    ]
    last: Exception | None = None
    for args in attempts:
        try:
            return await session.call(tool, args)
        except Exception as exc:
            last = exc
    raise RuntimeError(f"fields tool {tool} rejected every argument shape: {last}")


async def run_proof() -> ProofReport:
    report = ProofReport()

    async with open_mcp_session(log_path=LOG_PATH) as session:
        report.gms_reachable = True
        report.available_tools = session.tools

        search_tool = _pick(session.tools, SEARCH_TOOLS)
        entity_tool = _pick(session.tools, ENTITY_TOOLS)
        fields_tool = _pick(session.tools, SCHEMA_FIELD_TOOLS)
        lineage_tool = _pick(session.tools, LINEAGE_TOOLS)

        if not (search_tool and entity_tool and lineage_tool):
            missing = [
                label
                for label, tool in (
                    ("search", search_tool),
                    ("entity read", entity_tool),
                    ("lineage", lineage_tool),
                )
                if tool is None
            ]
            raise RuntimeError(
                "The MCP server does not expose the required tools: "
                + ", ".join(missing)
                + f". Available: {session.tools}"
            )

        # --- 1. search for product_units -----------------------------------
        search_text = await _search(session, search_tool, "product_units")
        found = PRODUCT_UNITS.urn in search_text or "product_units" in search_text
        report.steps.append(
            ProofStep(
                1,
                "Search dataset product_units",
                search_tool,
                found,
                "Dataset located in DataHub search results"
                if found
                else "product_units did not appear in the MCP search response",
                _short(search_text),
            )
        )

        # --- 2..5 read the dataset entity ----------------------------------
        entity_text = await _read_entity(session, entity_tool, PRODUCT_UNITS.urn)

        has_schema = "conversion_factor" in entity_text and "unit_name" in entity_text
        report.steps.append(
            ProofStep(
                2,
                "Read dataset schema",
                entity_tool,
                has_schema,
                "Schema returned with the demo columns"
                if has_schema
                else "Schema fields were absent from the MCP response",
                _short(entity_text, 700),
            )
        )

        # --- 3. locate conversion_factor specifically ----------------------
        field_tool_used = fields_tool or entity_tool
        if fields_tool:
            try:
                field_text = await _fields(
                    session, fields_tool, PRODUCT_UNITS.urn, "conversion_factor"
                )
            except Exception:
                # Fall back to the already-fetched entity schema rather than
                # failing the whole proof over an argument-shape mismatch in
                # this optional, more-specific tool.
                field_tool_used = entity_tool
                field_text = entity_text
        else:
            field_text = entity_text
        has_field = "conversion_factor" in field_text
        report.steps.append(
            ProofStep(
                3,
                "Find field conversion_factor",
                field_tool_used,
                has_field,
                "Field conversion_factor found on product_units"
                if has_field
                else "conversion_factor not present in the MCP response",
                _short(
                    "\n".join(
                        line
                        for line in field_text.splitlines()
                        if "conversion_factor" in line
                    )
                    or field_text
                ),
            )
        )

        # --- 4. owner -------------------------------------------------------
        owner_match = re.search(r"urn:li:corpGroup:[a-z0-9-]+", entity_text)
        report.steps.append(
            ProofStep(
                4,
                "Read dataset owner",
                entity_tool,
                owner_match is not None,
                f"Owner {owner_match.group(0)}" if owner_match else "No owner URN in the response",
                owner_match.group(0) if owner_match else _short(entity_text),
            )
        )

        # --- 5. tags and glossary terms -------------------------------------
        tags = sorted(set(re.findall(r"urn:li:tag:[^\"',\s\)]+", entity_text)))
        terms = sorted(set(re.findall(r"urn:li:glossaryTerm:[^\"',\s\)]+", entity_text)))
        report.steps.append(
            ProofStep(
                5,
                "Read tags and glossary terms",
                entity_tool,
                bool(tags) and bool(terms),
                f"{len(tags)} tags, {len(terms)} glossary terms",
                json.dumps({"tags": tags, "terms": terms}),
            )
        )

        # --- 6. downstream lineage to gross_margin_report --------------------
        lineage_text = await _lineage(session, lineage_tool, PRODUCT_UNITS.urn)
        reached = GROSS_MARGIN_REPORT.urn in lineage_text or (
            "gross_margin_report" in lineage_text
        )
        hops = [
            d.table
            for d in (
                INVENTORY_MOVEMENTS,
                INVENTORY_VALUATION,
                JOURNAL_ENTRIES,
                GROSS_MARGIN_REPORT,
            )
            if d.table in lineage_text
        ]
        report.steps.append(
            ProofStep(
                6,
                "Traverse downstream lineage product_units -> gross_margin_report",
                lineage_tool,
                reached,
                f"Reached {len(hops)} downstream assets: {', '.join(hops)}"
                if reached
                else "gross_margin_report was not reachable from product_units",
                _short(lineage_text, 700),
            )
        )

        # --- 7. activity log --------------------------------------------------
        log_file = session.write_log()
        entries = session.entries
        report.activity_log = str(log_file.relative_to(REPO_ROOT)).replace("\\", "/")
        report.activity_entries = len(entries)
        report.steps.append(
            ProofStep(
                7,
                "Real MCP activity log",
                "-",
                len(entries) > 0 and all(e.tool for e in entries),
                f"{len(entries)} MCP tool calls logged with tool name, timestamp, "
                f"input and result to {report.activity_log}",
                json.dumps(asdict(entries[0])) if entries else "",
            )
        )

    return report


def main() -> None:
    report = asyncio.run(run_proof())
    path = report.write()

    print(f"MCP server tools ({len(report.available_tools)}): {', '.join(report.available_tools)}")
    print()
    for step in report.steps:
        mark = "PASS" if step.passed else "FAIL"
        print(f"  [{mark}] {step.number}. {step.name}  (tool: {step.tool})")
        print(f"         {step.detail}")
    print()
    print(f"Report:       {path}")
    print(f"Activity log: {REPO_ROOT / report.activity_log}")

    if not report.passed:
        sys.exit(1)


if __name__ == "__main__":
    main()
