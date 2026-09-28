from __future__ import annotations

from contextlib import contextmanager
from os import environ
from uuid import uuid4

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from .runtime import ClaimedTask

DEFAULT_DATABASE_URL = "postgresql://forgeflow:forgeflow@localhost:15432/forgeflow"


class PostgresWorkerRepository:
    def __init__(self, database_url: str | None = None) -> None:
        self._database_url = database_url or environ.get("DATABASE_URL", DEFAULT_DATABASE_URL)

    @contextmanager
    def _connection(self):
        with psycopg.connect(self._database_url, row_factory=dict_row) as connection:
            yield connection

    def register(self, name: str, capabilities: list[str]) -> str:
        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO forgeflow.workers (name, status, capabilities, last_heartbeat_at)
                VALUES (%s, 'RUNNING', %s::jsonb, now())
                ON CONFLICT (name) DO UPDATE
                  SET status = 'RUNNING',
                      capabilities = EXCLUDED.capabilities,
                      last_heartbeat_at = now()
                RETURNING id
                """,
                (name, Jsonb(capabilities)),
            )
            row = cursor.fetchone()
            if row is None:
                raise RuntimeError("Worker registration did not return an identifier")
            return str(row["id"])

    def heartbeat(self, worker_id: str) -> None:
        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE forgeflow.workers
                SET last_heartbeat_at = now()
                WHERE id = %s AND status IN ('RUNNING', 'DRAINING')
                """,
                (worker_id,),
            )

    def set_status(self, worker_id: str, status: str) -> None:
        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(
                "UPDATE forgeflow.workers SET status = %s WHERE id = %s",
                (status, worker_id),
            )

    def claim_next_task(
        self, worker_id: str, supported_kinds: list[str], lease_duration_seconds: int
    ) -> ClaimedTask | None:
        if not supported_kinds:
            return None

        lease_token = str(uuid4())
        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                WITH candidate AS (
                  SELECT id
                  FROM forgeflow.workflow_tasks
                  WHERE state IN ('PENDING', 'RETRYING')
                    AND available_at <= now()
                    AND kind = ANY(%s::text[])
                  ORDER BY available_at, created_at
                  FOR UPDATE SKIP LOCKED
                  LIMIT 1
                )
                UPDATE forgeflow.workflow_tasks task
                SET state = 'LEASED',
                    attempt_count = attempt_count + 1,
                    leased_by_worker_id = %s,
                    lease_token = %s::uuid,
                    lease_expires_at = now() + make_interval(secs => %s::integer)
                FROM candidate
                WHERE task.id = candidate.id
                RETURNING task.id, task.workflow_run_id, task.kind, task.attempt_count,
                          task.lease_expires_at
                """,
                (supported_kinds, worker_id, lease_token, lease_duration_seconds),
            )
            task = cursor.fetchone()
            if task is None:
                return None

            cursor.execute(
                """
                INSERT INTO forgeflow.task_attempts
                    (task_id, worker_id, attempt_number, lease_token, state)
                VALUES (%s, %s, %s, %s::uuid, 'LEASED')
                RETURNING id
                """,
                (task["id"], worker_id, task["attempt_count"], lease_token),
            )
            attempt = cursor.fetchone()
            if attempt is None:
                raise RuntimeError("Task attempt creation did not return an identifier")

            return ClaimedTask(
                task_id=str(task["id"]),
                workflow_id=str(task["workflow_run_id"]),
                kind=str(task["kind"]),
                attempt_id=str(attempt["id"]),
                attempt_number=int(task["attempt_count"]),
                lease_token=lease_token,
                lease_expires_at=task["lease_expires_at"].isoformat(),
            )
