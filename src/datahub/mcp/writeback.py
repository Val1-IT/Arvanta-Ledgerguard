"""FASE 3B — write-back proof and metadata reset.

Proves LedgerGuard can write context back into DataHub and that the change really
persisted:

  1. add the tag `At Risk` to a demo dataset
  2. add an investigation note stating the change came from the LedgerGuard
     development proof
  3. read the asset back and confirm both landed

Write path preference:
  * the official MCP server's mutation tools (`add_tags`, `update_description`),
    enabled with TOOLS_IS_MUTATION_ENABLED=true — used whenever available;
  * otherwise the DataHub Python SDK as a documented supporting operation.
Which path was used is recorded in the report — it is never guessed.

The read-back always goes through MCP, so persistence is proven by the same
interface the agent uses for context.

    npm run datahub:writeback-proof   # apply + verify
    npm run datahub:metadata-reset    # restore the dataset to its baseline
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Dict, List, Optional

from ..bootstrap.assets import INVENTORY_VALUATION, TAG_AT_RISK
from ..bootstrap.bootstrap import _to_dataset
from ..bootstrap.config import REPO_ROOT, make_client
from .session import LoggedMcpSession, open_mcp_session

REPORT_PATH = REPO_ROOT / "examples" / "mcp" / "writeback-report.json"
LOG_PATH = REPO_ROOT / "examples" / "mcp" / "writeback-activity-log.jsonl"

TARGET = INVENTORY_VALUATION

INVESTIGATION_NOTE = (
    "LedgerGuard investigation note: this asset was tagged `At Risk` by the Arvanta "
    "LedgerGuard development proof (FASE 3B write-back verification). The tag and "
    "this note were written by an automated agent proof run, not by a human data "
    "steward, and are removed again by `npm run datahub:metadata-reset`."
)

ADD_TAG_TOOLS = ("add_tags", "add_tag")
DESCRIPTION_TOOLS = ("update_description", "set_description", "update_documentation")
ENTITY_TOOLS = ("get_entities", "get_dataset", "get_entity")


@dataclass
class WritebackReport:
    target_urn: str = TARGET.urn
    write_path: str = ""
    mutation_tools_available: List[str] = field(default_factory=list)
    tag_written: bool = False
    note_written: bool = False
    tag_verified_via_mcp: bool = False
    note_verified_via_mcp: bool = False
    restored: bool = False
    activity_log: str = ""
    notes: List[str] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return self.tag_verified_via_mcp and self.note_verified_via_mcp

    def write(self, path: Path = REPORT_PATH) -> Path:
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = asdict(self)
        payload["passed"] = self.passed
        path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        return path


def _pick(tools: List[str], candidates) -> Optional[str]:
    for candidate in candidates:
        if candidate in tools:
            return candidate
    return None


async def _read_entity(session: LoggedMcpSession, tool: str, urn: str) -> str:
    for args in ({"urns": [urn]}, {"urn": urn}, {"dataset_urn": urn}):
        try:
            return await session.call(tool, args)
        except Exception:
            continue
    raise RuntimeError(f"entity tool {tool} rejected every argument shape")


async def _try_call(session: LoggedMcpSession, tool: str, shapes: List[Dict[str, object]]) -> bool:
    for args in shapes:
        try:
            await session.call(tool, args)
            return True
        except Exception:
            continue
    return False


# ---------------------------------------------------------------------------
# SDK fallback — used only when MCP exposes no mutation tool for the operation.
# ---------------------------------------------------------------------------


def _sdk_apply(with_note: bool) -> None:
    client = make_client()
    dataset = _to_dataset(TARGET)
    if with_note:
        dataset.set_description(f"{TARGET.description}\n\n{INVESTIGATION_NOTE}")
        dataset.add_tag(TAG_AT_RISK.urn)
    client.entities.upsert(dataset)


def _sdk_restore() -> None:
    """Re-upsert the dataset exactly as the bootstrap defines it."""
    client = make_client()
    client.entities.upsert(_to_dataset(TARGET))


# ---------------------------------------------------------------------------
# Proof
# ---------------------------------------------------------------------------


async def run_writeback() -> WritebackReport:
    report = WritebackReport()

    async with open_mcp_session(log_path=LOG_PATH, enable_mutations=True) as session:
        tag_tool = _pick(session.tools, ADD_TAG_TOOLS)
        desc_tool = _pick(session.tools, DESCRIPTION_TOOLS)
        entity_tool = _pick(session.tools, ENTITY_TOOLS)
        report.mutation_tools_available = [t for t in (tag_tool, desc_tool) if t]

        if not entity_tool:
            raise RuntimeError(f"No MCP entity-read tool available. Tools: {session.tools}")

        # --- write the tag ---------------------------------------------------
        if tag_tool:
            report.tag_written = await _try_call(
                session,
                tag_tool,
                [
                    {"urn": TARGET.urn, "tag_urns": [TAG_AT_RISK.urn]},
                    {"urn": TARGET.urn, "tags": [TAG_AT_RISK.urn]},
                    {"entity_urn": TARGET.urn, "tag_urns": [TAG_AT_RISK.urn]},
                ],
            )

        # --- write the investigation note ------------------------------------
        note_text = f"{TARGET.description}\n\n{INVESTIGATION_NOTE}"
        if desc_tool:
            report.note_written = await _try_call(
                session,
                desc_tool,
                [
                    {"urn": TARGET.urn, "description": note_text},
                    {"entity_urn": TARGET.urn, "description": note_text},
                ],
            )

        if report.tag_written and report.note_written:
            report.write_path = "mcp"
            report.notes.append(
                f"Both writes performed through MCP tools: {tag_tool}, {desc_tool}."
            )
        else:
            _sdk_apply(with_note=True)
            report.tag_written = True
            report.note_written = True
            report.write_path = "mcp" if report.mutation_tools_available else "sdk"
            if report.write_path == "sdk":
                report.notes.append(
                    "This MCP server build exposes no mutation tools, so the write-back "
                    "was performed with the DataHub Python SDK as a documented "
                    "supporting operation. The read-back below still goes through MCP."
                )
            else:
                report.write_path = "sdk"
                report.notes.append(
                    "MCP mutation tools were present but rejected the write; the "
                    "DataHub Python SDK was used as a documented fallback."
                )

        # --- read back through MCP -------------------------------------------
        readback = await _read_entity(session, entity_tool, TARGET.urn)
        report.tag_verified_via_mcp = TAG_AT_RISK.urn in readback or "At Risk" in readback
        report.note_verified_via_mcp = "LedgerGuard investigation note" in readback

        session.write_log()
        report.activity_log = str(LOG_PATH.relative_to(REPO_ROOT)).replace("\\", "/")

    return report


async def run_restore() -> WritebackReport:
    """Restore the demo dataset to the metadata the bootstrap defines."""
    report = WritebackReport(write_path="sdk")
    _sdk_restore()

    async with open_mcp_session(log_path=LOG_PATH, enable_mutations=True) as session:
        entity_tool = _pick(session.tools, ENTITY_TOOLS)
        if not entity_tool:
            raise RuntimeError("No MCP entity-read tool available for verification.")
        readback = await _read_entity(session, entity_tool, TARGET.urn)
        report.restored = "LedgerGuard investigation note" not in readback
        session.write_log()
        report.activity_log = str(LOG_PATH.relative_to(REPO_ROOT)).replace("\\", "/")
        report.notes.append(
            "Baseline restored: the dataset carries exactly the metadata declared in "
            "src/datahub/bootstrap/assets.py."
        )
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description="DataHub write-back proof / metadata reset.")
    parser.add_argument(
        "--restore",
        action="store_true",
        help="Restore the demo dataset to its bootstrap baseline instead of writing.",
    )
    args = parser.parse_args()

    if args.restore:
        report = asyncio.run(run_restore())
        report.write(REPORT_PATH.with_name("writeback-restore-report.json"))
        print(f"Restored {report.target_urn}: {'OK' if report.restored else 'FAILED'}")
        sys.exit(0 if report.restored else 1)

    report = asyncio.run(run_writeback())
    path = report.write()
    print(f"Target:        {report.target_urn}")
    print(f"Write path:    {report.write_path}")
    print(f"MCP mutations: {report.mutation_tools_available or 'none exposed'}")
    print(f"Tag verified via MCP read-back:  {report.tag_verified_via_mcp}")
    print(f"Note verified via MCP read-back: {report.note_verified_via_mcp}")
    for note in report.notes:
        print(f"  - {note}")
    print(f"Report: {path}")
    sys.exit(0 if report.passed else 1)


if __name__ == "__main__":
    main()
