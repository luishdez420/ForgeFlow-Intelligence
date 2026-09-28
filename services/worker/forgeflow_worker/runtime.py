from __future__ import annotations

import signal
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from threading import Event
from time import monotonic
from typing import Protocol


@dataclass(frozen=True)
class ClaimedTask:
    task_id: str
    workflow_id: str
    kind: str
    attempt_id: str
    attempt_number: int
    lease_token: str
    lease_expires_at: str


class WorkerRepository(Protocol):
    def register(self, name: str, capabilities: list[str]) -> str: ...

    def heartbeat(self, worker_id: str) -> None: ...

    def set_status(self, worker_id: str, status: str) -> None: ...

    def claim_next_task(
        self, worker_id: str, supported_kinds: list[str], lease_duration_seconds: int
    ) -> ClaimedTask | None: ...

TaskHandler = Callable[[ClaimedTask], None]


class WorkerRuntime:
    """A bounded polling runtime; task outcome/retry handling arrives in Issue #11."""

    def __init__(
        self,
        repository: WorkerRepository,
        name: str,
        handlers: Mapping[str, TaskHandler],
        *,
        poll_interval_seconds: float = 1.0,
        lease_duration_seconds: int = 60,
    ) -> None:
        if poll_interval_seconds <= 0:
            raise ValueError("poll_interval_seconds must be positive")
        if not 1 <= lease_duration_seconds <= 3600:
            raise ValueError("lease_duration_seconds must be between 1 and 3600")

        self._repository = repository
        self._name = name
        self._handlers = dict(handlers)
        self._poll_interval_seconds = poll_interval_seconds
        self._lease_duration_seconds = lease_duration_seconds
        self._shutdown_requested = Event()
        self._worker_id: str | None = None
        self._last_heartbeat_at = 0.0

    @property
    def worker_id(self) -> str | None:
        return self._worker_id

    def start(self) -> str:
        if self._worker_id is None:
            self._worker_id = self._repository.register(self._name, sorted(self._handlers))
            self._last_heartbeat_at = monotonic()
        return self._worker_id

    def request_shutdown(self) -> None:
        """Enter draining mode: no new tasks are claimed after this call."""
        self._shutdown_requested.set()
        if self._worker_id is not None:
            self._repository.set_status(self._worker_id, "DRAINING")

    def stop(self) -> None:
        self.request_shutdown()
        if self._worker_id is not None:
            self._repository.set_status(self._worker_id, "STOPPED")

    def run_once(self) -> bool:
        worker_id = self.start()
        self._heartbeat_if_due(worker_id)
        if self._shutdown_requested.is_set() or not self._handlers:
            return False

        task = self._repository.claim_next_task(
            worker_id,
            sorted(self._handlers),
            self._lease_duration_seconds,
        )
        if task is None:
            return False

        self._handlers[task.kind](task)
        return True

    def run_forever(self) -> None:
        self.start()
        try:
            while not self._shutdown_requested.is_set():
                handled_task = self.run_once()
                if not handled_task:
                    self._shutdown_requested.wait(self._poll_interval_seconds)
        finally:
            self.stop()

    def install_signal_handlers(self) -> None:
        def handle_shutdown_signal(_: int, __: object) -> None:
            self.request_shutdown()

        signal.signal(signal.SIGTERM, handle_shutdown_signal)
        signal.signal(signal.SIGINT, handle_shutdown_signal)

    def _heartbeat_if_due(self, worker_id: str) -> None:
        if monotonic() - self._last_heartbeat_at >= self._poll_interval_seconds:
            self._repository.heartbeat(worker_id)
            self._last_heartbeat_at = monotonic()
