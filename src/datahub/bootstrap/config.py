"""Connection configuration for the LedgerGuard DataHub bootstrap.

Reads DATAHUB_GMS_URL / DATAHUB_GMS_TOKEN from the environment (loaded from
`.env`, which is git-ignored). Tokens are never written to the repository.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from datahub.ingestion.graph.client import DatahubClientConfig, DataHubGraph
from datahub.sdk import DataHubClient

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_GMS_URL = "http://localhost:8080"


def _load_dotenv() -> None:
    """Minimal .env loader so the bootstrap has no extra runtime dependency."""
    env_file = REPO_ROOT / ".env"
    if not env_file.exists():
        return
    for raw in env_file.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        # Real environment variables win over the file.
        os.environ.setdefault(key, value)


@dataclass(frozen=True)
class DataHubConnection:
    gms_url: str
    token: Optional[str]

    @property
    def redacted_token(self) -> str:
        if not self.token:
            return "<none>"
        return f"{self.token[:4]}…({len(self.token)} chars)"


def load_connection() -> DataHubConnection:
    _load_dotenv()
    gms_url = os.environ.get("DATAHUB_GMS_URL", "").strip() or DEFAULT_GMS_URL
    token = os.environ.get("DATAHUB_GMS_TOKEN", "").strip() or None
    return DataHubConnection(gms_url=gms_url, token=token)


def make_graph(connection: Optional[DataHubConnection] = None) -> DataHubGraph:
    conn = connection or load_connection()
    return DataHubGraph(DatahubClientConfig(server=conn.gms_url, token=conn.token))


def make_client(graph: Optional[DataHubGraph] = None) -> DataHubClient:
    """SDK client sharing a single graph connection with the raw MCP emitter."""
    return DataHubClient(graph=graph or make_graph())
