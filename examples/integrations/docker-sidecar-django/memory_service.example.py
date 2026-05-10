"""MemoryService — Django-flavoured wrapper around the agent-memory CLI.

Lives as ``myproject/services/memory_service.py``. Instantiated once in
``apps.py`` (or a lazy module-level singleton) and injected into views,
management commands, and Celery tasks that need to read or write memory.

The wrapper shells out to the sidecar via ``docker compose exec``, so
there is zero pip dependency on ``@event4u/agent-memory`` — the sidecar
owns the code, the Django side owns the ``MemoryService`` boundary class.

Usage:

    # settings.py
    AGENT_MEMORY_COMPOSE_FILE = BASE_DIR / "docker-compose.yml"
    AGENT_MEMORY_REPOSITORY = "my-django-app"

    # services/memory_service.py (this file) — import + use:
    from django.conf import settings
    memory = MemoryService(
        compose_file=str(settings.AGENT_MEMORY_COMPOSE_FILE),
        repository=settings.AGENT_MEMORY_REPOSITORY,
    )

    # views.py
    def index(request):
        health = memory.health()
        hits = memory.retrieve("invoice calculation")
        ...
"""

from __future__ import annotations

import json
import subprocess
from typing import Any


class AgentMemoryError(RuntimeError):
    """Raised when the CLI exits non-zero or returns non-JSON."""


class MemoryService:
    """Call the agent-memory sidecar via ``docker compose exec``."""

    def __init__(
        self,
        compose_file: str = "docker-compose.yml",
        service: str = "agent-memory",
        repository: str = "my-django-app",
        timeout_seconds: int = 30,
    ) -> None:
        self._compose_file = compose_file
        self._service = service
        self._repository = repository
        self._timeout = timeout_seconds

    def health(self) -> dict[str, Any]:
        return self._run(["health"])

    def ingest(self, type_: str, title: str, summary: str) -> dict[str, Any]:
        return self._run([
            "ingest",
            "--type", type_,
            "--title", title,
            "--summary", summary,
            "--repository", self._repository,
        ])

    def retrieve(self, query: str, limit: int = 5) -> dict[str, Any]:
        return self._run([
            "retrieve", query,
            "--limit", str(limit),
        ])

    def _run(self, args: list[str]) -> dict[str, Any]:
        cmd = [
            "docker", "compose",
            "-f", self._compose_file,
            "exec", "-T", self._service,
            "memory", *args,
        ]
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=self._timeout,
                check=True,
            )
        except subprocess.CalledProcessError as err:
            raise AgentMemoryError(
                f"memory {' '.join(args)} failed ({err.returncode}): {err.stderr.strip()}"
            ) from err
        except subprocess.TimeoutExpired as err:
            raise AgentMemoryError(
                f"memory {' '.join(args)} timed out after {self._timeout}s"
            ) from err

        try:
            return json.loads(result.stdout)
        except json.JSONDecodeError as err:
            raise AgentMemoryError(
                f"memory {' '.join(args)} returned non-JSON: {result.stdout!r}"
            ) from err
