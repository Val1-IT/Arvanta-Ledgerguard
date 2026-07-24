"""One-off diagnostic for FASE 3C item 1: why mutation tools were missing.

Spawns the same mcp-server-datahub subprocess `open_mcp_session` uses, but
captures the child's stderr explicitly (instead of letting it inherit ours)
so we can see the "Mutation Tools ENABLED/DISABLED" startup log line, and
prints exactly which executable/env vars were used.

    .venv/Scripts/python.exe -m src.datahub.mcp.diagnose_mutation
"""

from __future__ import annotations

import asyncio
import os
import sys
import tempfile

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from ..bootstrap.config import load_connection
from .session import _server_command


async def main() -> None:
    command = _server_command()
    print(f"Resolved mcp-server-datahub executable: {command}")

    conn = load_connection()
    env = dict(os.environ)
    env["DATAHUB_GMS_URL"] = conn.gms_url
    if conn.token:
        env["DATAHUB_GMS_TOKEN"] = conn.token
    env["TOOLS_IS_USER_ENABLED"] = "true"
    env["TOOLS_IS_MUTATION_ENABLED"] = "true"

    print("Env vars passed to subprocess:")
    for key in ("DATAHUB_GMS_URL", "TOOLS_IS_USER_ENABLED", "TOOLS_IS_MUTATION_ENABLED", "DATAHUB_MCP_COMMAND"):
        print(f"  {key}={env.get(key)!r}")
    print(f"  DATAHUB_GMS_TOKEN set: {'DATAHUB_GMS_TOKEN' in env}")

    stderr_path = os.path.join(tempfile.gettempdir(), "mcp_server_datahub_diagnose_stderr.log")

    params = StdioServerParameters(command=command, args=[], env=env)
    with open(stderr_path, "w+", encoding="utf-8") as stderr_file:
        async with stdio_client(params, errlog=stderr_file) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                listing = await session.list_tools()
                tools = sorted(t.name for t in listing.tools)

        stderr_file.flush()
        stderr_file.seek(0)
        raw_stderr = stderr_file.read()

    print("\n--- child stderr (startup log) ---")
    print(raw_stderr)
    print("--- end child stderr ---\n")

    print(f"Discovered {len(tools)} tools:")
    for t in tools:
        print(f"  - {t}")

    required = {"add_tags", "remove_tags", "update_description"}
    missing = required - set(tools)
    if missing:
        print(f"\nMISSING required mutation tools: {sorted(missing)}")
        sys.exit(1)
    else:
        print("\nAll required mutation tools present.")


if __name__ == "__main__":
    asyncio.run(main())
