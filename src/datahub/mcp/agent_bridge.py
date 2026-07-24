"""FASE 5 — TypeScript-facing bridge for the DataHub-aware investigation agent.

Exposes two subcommands, each reading a single JSON object from stdin and
writing a single JSON object to stdout, so a Node subprocess wrapper
(src/agent/datahub-client.ts) can drive one real MCP interaction per call
without re-implementing any of session.py/proof.py/writeback.py's connection,
tool-resolution, or write-path logic — it reuses that exact, already-proven
code path instead of a separate, unproven one.

    python -m src.datahub.mcp.agent_bridge read      < input.json > output.json
    python -m src.datahub.mcp.agent_bridge writeback < input.json > output.json

`read` input:  {"triggerAsset": "product_units"}
`read` output: {"ok": true, "datahubContext": {...}, "activityLog": [...]}
            or {"ok": false, "failureState": "...", "message": "...", "activityLog": [...]}

`writeback` input:  {"targetAsset": "product_units", "summaryText": "..."}
`writeback` output: {"ok": true, "writePath": "mcp"|"sdk", "tagWritten": true,
                      "noteWritten": true, "activityLog": [...]}
                  or {"ok": false, "failureState": "WRITEBACK_FAILED", ...}

Neither subcommand writes its own activity-log file — the caller (the
TypeScript orchestrator) owns assembling the final, per-investigation
activity log from the JSON `activityLog` this bridge returns, since one
investigation spans multiple bridge invocations (read, then optionally
writeback) whose entries must be combined, not overwritten.
"""

from __future__ import annotations

import asyncio
import json
import re
import sys
from dataclasses import asdict
from typing import Any, Dict, List, Optional

from ..bootstrap.assets import DATASETS, GROSS_MARGIN_REPORT, TAG_AT_RISK, DatasetDef
from ..bootstrap.bootstrap import _to_dataset
from ..bootstrap.config import make_client
from .proof import ENTITY_TOOLS, LINEAGE_TOOLS, SCHEMA_FIELD_TOOLS, SEARCH_TOOLS, _fields, _lineage, _pick, _read_entity, _search
from .session import LoggedMcpSession, open_mcp_session
from .writeback import ADD_TAG_TOOLS, DESCRIPTION_TOOLS, _try_call


def _dataset_by_table(table: str) -> Optional[DatasetDef]:
    for d in DATASETS:
        if d.table == table:
            return d
    return None


def _activity_entries(session: LoggedMcpSession) -> List[Dict[str, Any]]:
    return [asdict(e) for e in session.entries]


async def _do_read(payload: Dict[str, Any]) -> Dict[str, Any]:
    trigger_table = payload["triggerAsset"]
    dataset = _dataset_by_table(trigger_table)
    if dataset is None:
        return {"ok": False, "failureState": "DATASET_NOT_FOUND", "message": f"Unknown asset: {trigger_table}"}

    try:
        async with open_mcp_session() as session:
            search_tool = _pick(session.tools, SEARCH_TOOLS)
            entity_tool = _pick(session.tools, ENTITY_TOOLS)
            fields_tool = _pick(session.tools, SCHEMA_FIELD_TOOLS)
            lineage_tool = _pick(session.tools, LINEAGE_TOOLS)
            if not (search_tool and entity_tool and lineage_tool):
                return {
                    "ok": False,
                    "failureState": "MCP_UNAVAILABLE",
                    "message": f"Required MCP tools are missing from this server. Available: {session.tools}",
                    "activityLog": _activity_entries(session),
                }

            # 1. search for the dataset
            search_text = await _search(session, search_tool, trigger_table)
            if trigger_table not in search_text and dataset.urn not in search_text:
                return {
                    "ok": False,
                    "failureState": "DATASET_NOT_FOUND",
                    "message": f"{trigger_table} was not found via MCP search.",
                    "activityLog": _activity_entries(session),
                }

            # 2. read its schema
            entity_text = await _read_entity(session, entity_tool, dataset.urn)

            # 3. for product_units specifically, confirm conversion_factor by name
            if dataset.table == "product_units":
                field_text = entity_text
                if fields_tool:
                    try:
                        field_text = await _fields(session, fields_tool, dataset.urn, "conversion_factor")
                    except Exception:
                        field_text = entity_text
                if "conversion_factor" not in field_text and "conversion_factor" not in entity_text:
                    return {
                        "ok": False,
                        "failureState": "DATASET_NOT_FOUND",
                        "message": "conversion_factor was not found on product_units via MCP.",
                        "activityLog": _activity_entries(session),
                    }

            # 4. owner, 5. tags/glossary terms — read from the same entity response
            owners = sorted(set(re.findall(r"urn:li:corpGroup:[a-z0-9-]+", entity_text)))
            tags = sorted(set(re.findall(r"urn:li:tag:[^\"',\s\)]+", entity_text)))
            terms = sorted(set(re.findall(r"urn:li:glossaryTerm:[^\"',\s\)]+", entity_text)))

            # 6. traverse downstream lineage up to gross_margin_report
            lineage_path = [dataset.urn]
            reached_margin = dataset.table == GROSS_MARGIN_REPORT.table
            if not reached_margin:
                lineage_text = await _lineage(session, lineage_tool, dataset.urn)
                for downstream in DATASETS:
                    if downstream.table != dataset.table and downstream.urn in lineage_text:
                        lineage_path.append(downstream.urn)
                reached_margin = (
                    GROSS_MARGIN_REPORT.urn in lineage_text or GROSS_MARGIN_REPORT.table in lineage_text
                )
                if reached_margin and GROSS_MARGIN_REPORT.urn not in lineage_path:
                    lineage_path.append(GROSS_MARGIN_REPORT.urn)
                if not reached_margin:
                    return {
                        "ok": False,
                        "failureState": "LINEAGE_INCOMPLETE",
                        "message": f"Lineage from {trigger_table} did not reach gross_margin_report.",
                        "activityLog": _activity_entries(session),
                    }

            return {
                "ok": True,
                "datahubContext": {
                    "assetsRead": [dataset.urn],
                    "owners": owners,
                    "glossaryTerms": terms,
                    "tags": tags,
                    "lineagePath": lineage_path,
                },
                "activityLog": _activity_entries(session),
            }
    except Exception as exc:
        return {"ok": False, "failureState": "MCP_UNAVAILABLE", "message": f"{type(exc).__name__}: {exc}"}


async def _do_writeback(payload: Dict[str, Any]) -> Dict[str, Any]:
    target_table = payload["targetAsset"]
    summary_text = payload["summaryText"]
    dataset = _dataset_by_table(target_table)
    if dataset is None:
        return {"ok": False, "failureState": "DATASET_NOT_FOUND", "message": f"Unknown asset: {target_table}"}

    try:
        async with open_mcp_session(enable_mutations=True) as session:
            tag_tool = _pick(session.tools, ADD_TAG_TOOLS)
            desc_tool = _pick(session.tools, DESCRIPTION_TOOLS)
            entity_tool = _pick(session.tools, ENTITY_TOOLS)

            tag_written = False
            if tag_tool:
                tag_written = await _try_call(
                    session,
                    tag_tool,
                    [
                        {"urn": dataset.urn, "tag_urns": [TAG_AT_RISK.urn]},
                        {"urn": dataset.urn, "tags": [TAG_AT_RISK.urn]},
                        {"entity_urn": dataset.urn, "tag_urns": [TAG_AT_RISK.urn]},
                    ],
                )

            note_text = f"{dataset.description}\n\n{summary_text}"
            note_written = False
            if desc_tool:
                note_written = await _try_call(
                    session,
                    desc_tool,
                    [
                        {"urn": dataset.urn, "description": note_text},
                        {"entity_urn": dataset.urn, "description": note_text},
                    ],
                )

            write_path = "mcp"
            if not (tag_written and note_written):
                # SDK fallback is never silent: write_path always records which
                # path actually ran, and this branch only runs when MCP itself
                # exposed no working mutation tool for one of the two writes.
                client = make_client()
                sdk_dataset = _to_dataset(dataset)
                sdk_dataset.set_description(note_text)
                sdk_dataset.add_tag(TAG_AT_RISK.urn)
                client.entities.upsert(sdk_dataset)
                tag_written = True
                note_written = True
                write_path = "sdk"

            if not entity_tool:
                return {
                    "ok": False,
                    "failureState": "WRITEBACK_FAILED",
                    "message": "No MCP entity-read tool available to verify the write.",
                    "activityLog": _activity_entries(session),
                }

            readback = await _read_entity(session, entity_tool, dataset.urn)
            # The MCP entity tool returns JSON-serialized text, where real
            # newlines inside string fields come back as the two-character
            # escape sequence \n — normalize before substring-matching a
            # multi-line summary_text, or every note containing a newline in
            # its first 80 characters would spuriously fail verification.
            readback_normalized = readback.replace("\\n", "\n").replace("\\r", "\n")
            tag_verified = TAG_AT_RISK.urn in readback or "At Risk" in readback
            note_verified = summary_text[:80] in readback_normalized

            if not (tag_verified and note_verified):
                return {
                    "ok": False,
                    "failureState": "WRITEBACK_FAILED",
                    "message": "Write-back could not be verified via an MCP read-back.",
                    "activityLog": _activity_entries(session),
                }

            return {
                "ok": True,
                "writePath": write_path,
                "tagWritten": tag_written,
                "noteWritten": note_written,
                "activityLog": _activity_entries(session),
            }
    except Exception as exc:
        return {"ok": False, "failureState": "WRITEBACK_FAILED", "message": f"{type(exc).__name__}: {exc}"}


def main() -> None:
    if len(sys.argv) < 2 or sys.argv[1] not in ("read", "writeback"):
        print(
            json.dumps(
                {
                    "ok": False,
                    "failureState": "MCP_UNAVAILABLE",
                    "message": "usage: agent_bridge.py read|writeback < input.json",
                }
            )
        )
        sys.exit(1)

    command = sys.argv[1]
    payload = json.loads(sys.stdin.read() or "{}")

    if command == "read":
        result = asyncio.run(_do_read(payload))
    else:
        result = asyncio.run(_do_writeback(payload))

    print(json.dumps(result, default=str))
    sys.exit(0 if result.get("ok") else 1)


if __name__ == "__main__":
    main()
