"""Thin logged wrapper around the official self-hosted DataHub MCP server.

Every tool call the agent makes goes through `LoggedMcpSession.call`, which records
the MCP tool name, the wall-clock time, a brief input, and a brief result to a
JSONL activity log. Nothing here fabricates results: the log is written from the
actual MCP responses, and a failed call is recorded as a failure.

The server is the official `mcp-server-datahub` package run over stdio against a
self-hosted DataHub OSS/Core instance (DATAHUB_GMS_URL / DATAHUB_GMS_TOKEN).
"""

from __future__ import annotations

import json
import os
import shutil
from contextlib import asynccontextmanager
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, AsyncIterator, Dict, List, Optional

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from ..bootstrap.config import REPO_ROOT, load_connection

DEFAULT_LOG_PATH = REPO_ROOT / "examples" / "mcp" / "activity-log.jsonl"
MAX_RESULT_CHARS = 600


def _server_command() -> str:
    """Locate the installed mcp-server-datahub executable."""
    override = os.environ.get("DATAHUB_MCP_COMMAND", "").strip()
    if override:
        return override
    for candidate in (
        REPO_ROOT / ".venv" / "Scripts" / "mcp-server-datahub.exe",
        REPO_ROOT / ".venv" / "bin" / "mcp-server-datahub",
    ):
        if candidate.exists():
            return str(candidate)
    found = shutil.which("mcp-server-datahub")
    if found:
        return found
    raise RuntimeError(
        "mcp-server-datahub not found. Install it with "
        "`pip install -r src/datahub/requirements.txt` or set DATAHUB_MCP_COMMAND."
    )


@dataclass
class ActivityEntry:
    seq: int
    timestamp: str
    tool: str
    input: str
    result: str
    ok: bool
    duration_ms: int


def _brief(value: Any, limit: int = MAX_RESULT_CHARS) -> str:
    if isinstance(value, str):
        text = value
    else:
        try:
            text = json.dumps(value, default=str, ensure_ascii=False)
        except TypeError:
            text = str(value)
    text = " ".join(text.split())
    if len(text) > limit:
        return f"{text[:limit]}… (+{len(text) - limit} chars)"
    return text


def result_text(result: Any) -> str:
    """Flatten an MCP CallToolResult into plain text."""
    parts: List[str] = []
    for item in getattr(result, "content", []) or []:
        text = getattr(item, "text", None)
        if text:
            parts.append(text)
    if not parts and getattr(result, "structuredContent", None):
        parts.append(json.dumps(result.structuredContent, default=str))
    return "\n".join(parts)


class LoggedMcpSession:
    def __init__(self, session: ClientSession, log_path: Path = DEFAULT_LOG_PATH) -> None:
        self._session = session
        self._log_path = log_path
        self._entries: List[ActivityEntry] = []
        self._seq = 0
        self.tools: List[str] = []

    async def discover_tools(self) -> List[str]:
        listing = await self._session.list_tools()
        self.tools = sorted(t.name for t in listing.tools)
        return self.tools

    async def call(self, tool: str, arguments: Optional[Dict[str, Any]] = None) -> str:
        """Call an MCP tool, log it, and return the response as text."""
        arguments = arguments or {}
        self._seq += 1
        started = datetime.now(timezone.utc)
        ok = True
        try:
            raw = await self._session.call_tool(tool, arguments)
            text = result_text(raw)
            if getattr(raw, "isError", False):
                ok = False
        except Exception as exc:  # recorded, then re-raised — never silently faked
            text = f"{type(exc).__name__}: {exc}"
            ok = False

        finished = datetime.now(timezone.utc)
        self._entries.append(
            ActivityEntry(
                seq=self._seq,
                timestamp=started.isoformat(),
                tool=tool,
                input=_brief(arguments, limit=240),
                result=_brief(text),
                ok=ok,
                duration_ms=int((finished - started).total_seconds() * 1000),
            )
        )
        if not ok:
            raise RuntimeError(f"MCP tool {tool} failed: {text}")
        return text

    @property
    def entries(self) -> List[ActivityEntry]:
        return list(self._entries)

    def write_log(self) -> Path:
        self._log_path.parent.mkdir(parents=True, exist_ok=True)
        with self._log_path.open("w", encoding="utf-8") as fh:
            for entry in self._entries:
                fh.write(json.dumps(asdict(entry), ensure_ascii=False) + "\n")
        return self._log_path


@asynccontextmanager
async def open_mcp_session(
    log_path: Path = DEFAULT_LOG_PATH,
    enable_mutations: bool = False,
) -> AsyncIterator[LoggedMcpSession]:
    conn = load_connection()
    env = dict(os.environ)
    env["DATAHUB_GMS_URL"] = conn.gms_url
    if conn.token:
        env["DATAHUB_GMS_TOKEN"] = conn.token
    env["TOOLS_IS_USER_ENABLED"] = "true"
    if enable_mutations:
        env["TOOLS_IS_MUTATION_ENABLED"] = "true"

    params = StdioServerParameters(command=_server_command(), args=[], env=env)
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            logged = LoggedMcpSession(session, log_path=log_path)
            await logged.discover_tools()
            yield logged
