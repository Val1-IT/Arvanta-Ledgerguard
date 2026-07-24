"""FASE 5/6 — TypeScript-facing bridge for the DataHub-aware investigation agent.

Exposes three subcommands, each reading a single JSON object from stdin and
writing a single JSON object to stdout, so a Node subprocess wrapper
(src/agent/datahub-client.ts, src/remediation/writeback.ts) can drive one real
MCP interaction per call without re-implementing any of
session.py/proof.py/writeback.py's connection, tool-resolution, or write-path
logic — it reuses that exact, already-proven code path instead of a separate,
unproven one.

    python -m src.datahub.mcp.agent_bridge read      < input.json > output.json
    python -m src.datahub.mcp.agent_bridge writeback < input.json > output.json
    python -m src.datahub.mcp.agent_bridge resolve   < input.json > output.json

`read` input:  {"triggerAsset": "product_units"}
`read` output: {"ok": true, "datahubContext": {...}, "activityLog": [...]}
            or {"ok": false, "failureState": "...", "message": "...", "activityLog": [...]}

`writeback` input:  {"targetAsset": "product_units", "summaryText": "..."}
`writeback` output: {"ok": true, "writePath": "mcp"|"sdk", "tagWritten": true,
                      "noteWritten": true, "activityLog": [...]}
                  or {"ok": false, "failureState": "WRITEBACK_FAILED", ...}

`resolve` input:  {"targetAsset": "product_units", "addTrustedTag": true, "summaryText": "..."}
`resolve` output: {"ok": true, "writePath": "mcp"|"sdk", "atRiskTagRemoved": true,
                    "trustedTagAdded": true, "noteWritten": true, "activityLog": [...]}
                or {"ok": false, "failureState": "WRITEBACK_FAILED", ...}

`resolve` is FASE 6's post-remediation counterpart to `writeback`: it removes
the `At Risk` tag (always attempted — a plan only ever reaches RESOLVED after
the ERP data transaction committed and post-write verification passed, so the
incident this tag represents is over) and, only when the caller says the
asset is now fully clean (`addTrustedTag: true`), adds `Trusted` on top. It
never removes `At Risk` from an asset the caller has not confirmed is
resolved — that decision is made once, by src/remediation/writeback.ts, from
the plan's own verification result, never re-derived here.

No subcommand writes its own activity-log file — the caller (the TypeScript
orchestrator / remediation writeback module) owns assembling the final,
per-investigation or per-plan activity log from the JSON `activityLog` this
bridge returns, since one investigation or remediation spans multiple bridge
invocations whose entries must be combined, not overwritten.
"""

from __future__ import annotations

import asyncio
import json
import re
import sys
from dataclasses import asdict
from typing import Any, Dict, List, Optional

from ..bootstrap.assets import DATASETS, GROSS_MARGIN_REPORT, TAG_AT_RISK, TAG_TRUSTED, DatasetDef
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

# Marks the region of a dataset's description that this bridge owns. Every
# write-back replaces the ENTIRE region between these markers, never appends
# to it — so calling this bridge N times (whether the caller is retrying the
# same investigation after a transient failure, or running a brand-new one)
# always converges to exactly one investigation note, not N concatenated
# notes. The marker itself does not encode an investigationId: it does not
# need to, because a write-back is always a full replace of the region, and
# summary_text (built by orchestrator.ts's buildWritebackSummary) already
# states which investigationId produced the current note.
NOTE_MARKER_START = "<!-- ledgerguard:investigation-note:start -->"
NOTE_MARKER_END = "<!-- ledgerguard:investigation-note:end -->"

def _base_description(dataset: DatasetDef) -> str:
    """The description to build a fresh note on top of.

    This is deliberately the STATIC bootstrap description
    (src/datahub/bootstrap/assets.py), never a live read of the dataset's
    current description. Building on top of a live read would make the note
    grow every time something upstream of this bridge behaved unexpectedly
    (e.g. a stray manual edit, or a marker written by a differently-versioned
    bridge); building on a known-clean, version-controlled baseline instead
    means the result is always exactly "baseline + one note", regardless of
    how many times this ran before or what state a prior run left behind.
    The one defensive step taken is stripping the marker region out of the
    baseline too, in case a future baseline ever accidentally includes it.
    """
    start = dataset.description.find(NOTE_MARKER_START)
    if start == -1:
        return dataset.description.rstrip()
    return dataset.description[:start].rstrip()

def _compose_note_text(dataset: DatasetDef, summary_text: str) -> str:
    base = _base_description(dataset)
    marker_block = f"{NOTE_MARKER_START}\n{summary_text}\n{NOTE_MARKER_END}"
    return f"{base}\n\n{marker_block}" if base else marker_block

# Mirrors ADD_TAG_TOOLS' pattern of naming every candidate tool name this
# server build might expose, rather than assuming one exact name — the same
# defensive posture already proven out for add_tags/update_description below.
# "remove_tags" is the name confirmed live against the real MCP server (see
# src/datahub/mcp/mutation_proof.py); "remove_tag" is kept as a fallback for
# a differently-versioned server build, exactly like ADD_TAG_TOOLS does for
# add_tags/add_tag.
REMOVE_TAG_TOOLS = ("remove_tags", "remove_tag")

async def _do_resolve(payload: Dict[str, Any]) -> Dict[str, Any]:
    target_table = payload["targetAsset"]
    add_trusted_tag = bool(payload.get("addTrustedTag", False))
    summary_text = payload["summaryText"]
    dataset = _dataset_by_table(target_table)
    if dataset is None:
        return {"ok": False, "failureState": "DATASET_NOT_FOUND", "message": f"Unknown asset: {target_table}"}

    try:
        async with open_mcp_session(enable_mutations=True) as session:
            remove_tag_tool = _pick(session.tools, REMOVE_TAG_TOOLS)
            add_tag_tool = _pick(session.tools, ADD_TAG_TOOLS)
            desc_tool = _pick(session.tools, DESCRIPTION_TOOLS)
            entity_tool = _pick(session.tools, ENTITY_TOOLS)

            at_risk_tag_removed = False
            if remove_tag_tool:
                at_risk_tag_removed = await _try_call(
                    session,
                    remove_tag_tool,
                    [
                        {"tag_urns": [TAG_AT_RISK.urn], "entity_urns": [dataset.urn]},
                        {"urn": dataset.urn, "tag_urns": [TAG_AT_RISK.urn]},
                        {"entity_urn": dataset.urn, "tag_urns": [TAG_AT_RISK.urn]},
                    ],
                )

            trusted_tag_added = False
            if add_trusted_tag and add_tag_tool:
                trusted_tag_added = await _try_call(
                    session,
                    add_tag_tool,
                    [
                        {"tag_urns": [TAG_TRUSTED.urn], "entity_urns": [dataset.urn]},
                        {"urn": dataset.urn, "tag_urns": [TAG_TRUSTED.urn]},
                        {"entity_urn": dataset.urn, "tag_urns": [TAG_TRUSTED.urn]},
                    ],
                )

            note_text = _compose_note_text(dataset, summary_text)
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
            note_or_trusted_needs_sdk = not note_written or (add_trusted_tag and not trusted_tag_added)
            if note_or_trusted_needs_sdk:
                client = make_client()
                sdk_dataset = _to_dataset(dataset)
                sdk_dataset.set_description(note_text)
                if add_trusted_tag:
                    sdk_dataset.add_tag(TAG_TRUSTED.urn)
                client.entities.upsert(sdk_dataset)
                trusted_tag_added = add_trusted_tag
                note_written = True
                write_path = "sdk"

            if not entity_tool:
                return {
                    "ok": False,
                    "failureState": "WRITEBACK_FAILED",
                    "message": "No MCP entity-read tool available to verify the write.",
                    "activityLog": _activity_entries(session),
                }

            verified = False
            for attempt in range(3):
                if attempt > 0:
                    await asyncio.sleep(0.5 * attempt)
                readback = await _read_entity(session, entity_tool, dataset.urn)
                readback_normalized = readback.replace("\\n", "\n").replace("\\r", "\n")
                at_risk_gone = TAG_AT_RISK.urn not in readback
                trusted_present = (not add_trusted_tag) or (TAG_TRUSTED.urn in readback or "Trusted" in readback)
                note_verified = summary_text[:80] in readback_normalized
                verified = at_risk_gone and trusted_present and note_verified
                if verified:
                    break

            if not verified:
                return {
                    "ok": False,
                    "failureState": "WRITEBACK_FAILED",
                    "message": "Resolution write-back could not be verified via an MCP read-back.",
                    "activityLog": _activity_entries(session),
                }

            return {
                "ok": True,
                "writePath": write_path,
                "atRiskTagRemoved": at_risk_tag_removed,
                "trustedTagAdded": trusted_tag_added,
                "noteWritten": note_written,
                "activityLog": _activity_entries(session),
            }
    except Exception as exc:
        return {"ok": False, "failureState": "WRITEBACK_FAILED", "message": f"{type(exc).__name__}: {exc}"}

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

            note_text = _compose_note_text(dataset, summary_text)
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
    if len(sys.argv) < 2 or sys.argv[1] not in ("read", "writeback", "resolve"):
        print(
            json.dumps(
                {
                    "ok": False,
                    "failureState": "MCP_UNAVAILABLE",
                    "message": "usage: agent_bridge.py read|writeback|resolve < input.json",
                }
            )
        )
        sys.exit(1)

    command = sys.argv[1]
    payload = json.loads(sys.stdin.read() or "{}")

    if command == "read":
        result = asyncio.run(_do_read(payload))
    elif command == "writeback":
        result = asyncio.run(_do_writeback(payload))
    else:
        result = asyncio.run(_do_resolve(payload))

    print(json.dumps(result, default=str))
    sys.exit(0 if result.get("ok") else 1)

if __name__ == "__main__":
    main()
