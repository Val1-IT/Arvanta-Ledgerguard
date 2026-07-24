"""FASE 3C — MCP mutation proof.

Proves, through the official self-hosted DataHub MCP server's *mutation* tools
(not the SDK, not GraphQL directly), that an agent can safely read, mutate, and
restore live metadata on the `inventory_valuation` demo dataset:

  A. read baseline tags + description via MCP
  B. add tag `At Risk` (add_tags) and append an investigation note
     (update_description), both via MCP
  C. read the asset back via MCP and confirm the tag and note landed
  D. remove the tag (remove_tags) and restore the description
     (update_description), both via MCP
  E. read the asset back via MCP one more time and confirm it matches baseline

The tool-argument shapes used here (`tag_urns`/`entity_urns` as plural lists for
add_tags/remove_tags; `entity_urn` singular for update_description) come directly
from reading the installed mcp-server-datahub package source
(tools/tags.py, tools/descriptions.py) — they are not guessed.

If any MCP mutation step fails, this script does NOT silently fall back to the
SDK. `write_path` is only ever "mcp" (full success) or "sdk_fallback" (an actual
SDK write was performed — see `sdk_emergency_fallback` below, which this script
never calls automatically). A failed MCP path with no fallback attempted is
recorded as write_path "none" with verdict "BLOCKED".

    npm run datahub:mcp-mutation-proof
"""

from __future__ import annotations

import asyncio
import json
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

from ..bootstrap.assets import INVENTORY_VALUATION, TAG_AT_RISK
from ..bootstrap.config import REPO_ROOT
from .session import LoggedMcpSession, open_mcp_session

REPORT_PATH = REPO_ROOT / "examples" / "mcp" / "mutation-proof-report.json"
TOOLS_PATH = REPO_ROOT / "examples" / "mcp" / "mutation-tools.json"
LOG_PATH = REPO_ROOT / "examples" / "mcp" / "mutation-activity-log.jsonl"

TARGET = INVENTORY_VALUATION

MUTATION_NOTE = "LedgerGuard MCP mutation proof — development-only metadata change."

REQUIRED_MUTATION_TOOLS = ("add_tags", "remove_tags", "update_description")
ENTITY_TOOLS = ("get_entities", "get_dataset", "get_entity", "get_asset")


@dataclass
class MutationProofReport:
    target_urn: str = TARGET.urn
    mcp_server_tools: List[str] = field(default_factory=list)
    required_tools_present: bool = False
    missing_required_tools: List[str] = field(default_factory=list)
    baseline_tags: List[str] = field(default_factory=list)
    baseline_description: str = ""
    tag_added_via_mcp: bool = False
    note_updated_via_mcp: bool = False
    tag_verified_after_write: bool = False
    note_verified_after_write: bool = False
    tag_removed_via_mcp: bool = False
    description_restored_via_mcp: bool = False
    final_tags: List[str] = field(default_factory=list)
    final_description: str = ""
    final_clean: bool = False
    write_path: str = "none"
    verdict: str = "BLOCKED"
    activity_log: str = ""
    activity_entries: int = 0
    notes: List[str] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return (
            self.required_tools_present
            and self.tag_added_via_mcp
            and self.note_updated_via_mcp
            and self.tag_verified_after_write
            and self.note_verified_after_write
            and self.tag_removed_via_mcp
            and self.description_restored_via_mcp
            and self.final_clean
            and self.write_path == "mcp"
            and self.verdict == "OK"
        )

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


async def _read_entity(session: LoggedMcpSession, tool: str, urn: str) -> str:
    attempts: List[Dict[str, object]] = [{"urns": [urn]}, {"urn": urn}, {"dataset_urn": urn}]
    last: Exception | None = None
    for args in attempts:
        try:
            return await session.call(tool, args)
        except Exception as exc:
            last = exc
    raise RuntimeError(f"entity tool {tool} rejected every argument shape: {last}")


def _parse_entity(text: str) -> Dict[str, Any]:
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return {}
    if isinstance(data, list) and data:
        data = data[0]
    return data if isinstance(data, dict) else {}


def _entity_tags(entity: Dict[str, Any]) -> List[str]:
    tag_list = ((entity.get("tags") or {}).get("tags")) or []
    urns = {t.get("tag", {}).get("urn") for t in tag_list if isinstance(t, dict)}
    return sorted(u for u in urns if u)


def _entity_description(entity: Dict[str, Any]) -> str:
    """Mirrors update_description's own precedence: editableProperties, then properties."""
    editable = (entity.get("editableProperties") or {}).get("description")
    if editable:
        return editable
    return (entity.get("properties") or {}).get("description") or ""


def _write_tools_artifact(tools: List[str], missing: List[str]) -> Path:
    TOOLS_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "mcp_server_tools": tools,
        "required_mutation_tools": list(REQUIRED_MUTATION_TOOLS),
        "missing_required_tools": missing,
        "required_tools_present": not missing,
    }
    TOOLS_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return TOOLS_PATH


# ---------------------------------------------------------------------------
# SDK emergency fallback — kept ONLY as a documented, manually-invoked
# diagnostic tool. run_mutation_proof() below never calls this: if the MCP
# mutation path fails, the acceptance run is BLOCKED rather than silently
# completed some other way.
# ---------------------------------------------------------------------------


def sdk_emergency_fallback_apply() -> None:
    """Emergency-only: apply the same tag + note via the DataHub Python SDK.

    Not used by the FASE 3C acceptance path. Exists so a human operator has a
    documented way to unblock the demo dataset if the MCP server itself is
    unreachable, without inventing an ad hoc GraphQL call.
    """
    from ..bootstrap.bootstrap import _to_dataset
    from ..bootstrap.config import make_client

    client = make_client()
    dataset = _to_dataset(TARGET)
    dataset.set_description(f"{TARGET.description}\n\n{MUTATION_NOTE}")
    dataset.add_tag(TAG_AT_RISK.urn)
    client.entities.upsert(dataset)


def sdk_emergency_fallback_restore() -> None:
    """Emergency-only: restore the dataset to its bootstrap baseline via the SDK."""
    from ..bootstrap.bootstrap import _to_dataset
    from ..bootstrap.config import make_client

    client = make_client()
    client.entities.upsert(_to_dataset(TARGET))


# ---------------------------------------------------------------------------
# Proof
# ---------------------------------------------------------------------------


async def run_mutation_proof() -> MutationProofReport:
    report = MutationProofReport()

    async with open_mcp_session(log_path=LOG_PATH, enable_mutations=True) as session:
        report.mcp_server_tools = session.tools
        missing = [t for t in REQUIRED_MUTATION_TOOLS if t not in session.tools]
        report.required_tools_present = not missing
        report.missing_required_tools = missing
        _write_tools_artifact(session.tools, missing)

        if missing:
            report.notes.append(
                f"Required mutation tools missing from MCP list_tools: {missing}. "
                f"Available: {session.tools}"
            )
            report.write_path = "none"
            report.verdict = "BLOCKED"
            session.write_log()
            report.activity_log = str(LOG_PATH.relative_to(REPO_ROOT)).replace("\\", "/")
            report.activity_entries = len(session.entries)
            return report

        entity_tool = _pick(session.tools, ENTITY_TOOLS)
        if not entity_tool:
            raise RuntimeError(f"No MCP entity-read tool available. Tools: {session.tools}")

        # --- A. baseline read via MCP ----------------------------------------
        baseline_text = await _read_entity(session, entity_tool, TARGET.urn)
        baseline = _parse_entity(baseline_text)
        report.baseline_tags = _entity_tags(baseline)
        report.baseline_description = _entity_description(baseline)

        if TAG_AT_RISK.urn in report.baseline_tags:
            report.notes.append(
                "Baseline already carries the At Risk tag — aborting so this proof "
                "cannot mask a genuine pre-existing state."
            )
            report.write_path = "none"
            report.verdict = "BLOCKED"
            session.write_log()
            report.activity_log = str(LOG_PATH.relative_to(REPO_ROOT)).replace("\\", "/")
            report.activity_entries = len(session.entries)
            return report

        mutation_description = (
            f"{report.baseline_description}\n\n{MUTATION_NOTE}"
            if report.baseline_description
            else MUTATION_NOTE
        )

        try:
            # --- B. mutate via MCP --------------------------------------------
            await session.call(
                "add_tags",
                {"tag_urns": [TAG_AT_RISK.urn], "entity_urns": [TARGET.urn]},
            )
            report.tag_added_via_mcp = True

            await session.call(
                "update_description",
                {
                    "entity_urn": TARGET.urn,
                    "operation": "replace",
                    "description": mutation_description,
                },
            )
            report.note_updated_via_mcp = True

            # --- C. read-after-write via MCP -----------------------------------
            after_text = await _read_entity(session, entity_tool, TARGET.urn)
            after = _parse_entity(after_text)
            after_tags = _entity_tags(after)
            after_description = _entity_description(after)
            report.tag_verified_after_write = TAG_AT_RISK.urn in after_tags
            report.note_verified_after_write = MUTATION_NOTE in after_description

            if not (report.tag_verified_after_write and report.note_verified_after_write):
                raise RuntimeError(
                    "MCP read-after-write did not show the expected tag/note "
                    f"(tags={after_tags}, description={after_description!r})"
                )

            # --- D. restore via MCP --------------------------------------------
            await session.call(
                "remove_tags",
                {"tag_urns": [TAG_AT_RISK.urn], "entity_urns": [TARGET.urn]},
            )
            report.tag_removed_via_mcp = True

            await session.call(
                "update_description",
                {
                    "entity_urn": TARGET.urn,
                    "operation": "replace",
                    "description": report.baseline_description,
                },
            )
            report.description_restored_via_mcp = True

            # --- E. final verification via MCP ---------------------------------
            final_text = await _read_entity(session, entity_tool, TARGET.urn)
            final = _parse_entity(final_text)
            report.final_tags = _entity_tags(final)
            report.final_description = _entity_description(final)

            tags_clean = TAG_AT_RISK.urn not in report.final_tags
            tags_match_baseline = set(report.final_tags) == set(report.baseline_tags)
            description_clean = (
                MUTATION_NOTE not in report.final_description
                and report.final_description == report.baseline_description
            )
            report.final_clean = tags_clean and tags_match_baseline and description_clean

            if report.final_clean:
                report.write_path = "mcp"
                report.verdict = "OK"
                report.notes.append(
                    "Add -> verify -> restore -> verify completed entirely through MCP "
                    "mutation tools (add_tags, update_description, remove_tags). No SDK "
                    "fallback was invoked."
                )
            else:
                report.write_path = "mcp"
                report.verdict = "BLOCKED"
                report.notes.append(
                    "MCP restore calls executed but the final read does not match "
                    f"baseline exactly (final_tags={report.final_tags}, "
                    f"final_description={report.final_description!r}). Not proceeding."
                )
        except Exception as exc:
            report.notes.append(f"MCP mutation path failed: {exc}")
            report.notes.append(
                "Per FASE 3C policy, no automatic SDK fallback was attempted. The "
                "acceptance path is BLOCKED; sdk_emergency_fallback_apply/_restore "
                "exist for manual/diagnostic use only."
            )
            report.write_path = "none"
            report.verdict = "BLOCKED"

        session.write_log()
        report.activity_log = str(LOG_PATH.relative_to(REPO_ROOT)).replace("\\", "/")
        report.activity_entries = len(session.entries)

    return report


def main() -> None:
    report = asyncio.run(run_mutation_proof())
    path = report.write()

    print(f"Target:              {report.target_urn}")
    print(f"MCP tools ({len(report.mcp_server_tools)}): {', '.join(report.mcp_server_tools)}")
    print(f"Required tools present: {report.required_tools_present}")
    print(f"Baseline tags:       {report.baseline_tags}")
    print(f"Baseline description: {report.baseline_description!r}")
    print(f"tag_added_via_mcp:    {report.tag_added_via_mcp}")
    print(f"note_updated_via_mcp: {report.note_updated_via_mcp}")
    print(f"tag_verified_after_write:  {report.tag_verified_after_write}")
    print(f"note_verified_after_write: {report.note_verified_after_write}")
    print(f"tag_removed_via_mcp:  {report.tag_removed_via_mcp}")
    print(f"description_restored_via_mcp: {report.description_restored_via_mcp}")
    print(f"final_clean:          {report.final_clean}")
    print(f"write_path:           {report.write_path}")
    print(f"verdict:              {report.verdict}")
    for note in report.notes:
        print(f"  - {note}")
    print(f"Report:      {path}")
    print(f"Tools file:  {TOOLS_PATH}")
    print(f"Activity log: {REPO_ROOT / report.activity_log}" if report.activity_log else "")

    if not report.passed:
        sys.exit(1)


if __name__ == "__main__":
    main()
