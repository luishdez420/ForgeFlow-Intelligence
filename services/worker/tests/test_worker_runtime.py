from forgeflow_worker.runtime import ClaimedTask, WorkerRuntime


class FakeRepository:
    def __init__(self, task: ClaimedTask | None = None) -> None:
        self.task = task
        self.registered_capabilities: list[str] | None = None
        self.heartbeats: list[str] = []
        self.statuses: list[tuple[str, str]] = []
        self.claims = 0

    def register(self, _: str, capabilities: list[str]) -> str:
        self.registered_capabilities = capabilities
        return "worker-1"

    def heartbeat(self, worker_id: str) -> None:
        self.heartbeats.append(worker_id)

    def set_status(self, worker_id: str, status: str) -> None:
        self.statuses.append((worker_id, status))

    def claim_next_task(self, _: str, __: list[str], ___: int) -> ClaimedTask | None:
        self.claims += 1
        task, self.task = self.task, None
        return task

def test_runtime_registers_capabilities_and_executes_supported_task() -> None:
    handled: list[str] = []
    task = ClaimedTask("task-1", "workflow-1", "FETCH_SEC_FILINGS", "attempt-1", 1, "token", "2030-01-01T00:00:00+00:00")
    repository = FakeRepository(task)
    runtime = WorkerRuntime(repository, "test-worker", {"FETCH_SEC_FILINGS": lambda claimed: handled.append(claimed.task_id)})

    assert runtime.run_once() is True
    assert runtime.worker_id == "worker-1"
    assert repository.registered_capabilities == ["FETCH_SEC_FILINGS"]
    assert handled == ["task-1"]


def test_graceful_shutdown_stops_new_task_claims() -> None:
    repository = FakeRepository()
    runtime = WorkerRuntime(repository, "test-worker", {"FETCH_SEC_FILINGS": lambda _: None})
    runtime.start()
    runtime.request_shutdown()

    assert runtime.run_once() is False
    assert repository.claims == 0
    assert repository.statuses == [("worker-1", "DRAINING")]
