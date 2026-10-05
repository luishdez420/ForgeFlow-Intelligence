from __future__ import annotations

from contextlib import contextmanager
from hashlib import sha256
import json
from math import ceil
from os import environ
from uuid import uuid4

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from .runtime import ClaimedTask
from .sec_edgar import SecCompanyFacts, SecDocument
from .sec_facts import ExtractedSecFact

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

    def record_task_failure(
        self, task_id: str, lease_token: str, classification: str, code: str, message: str
    ) -> None:
        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, workflow_run_id, attempt_count, max_attempts, lease_token,
                       retry_initial_delay_seconds, retry_max_delay_seconds, retry_backoff_multiplier
                FROM forgeflow.workflow_tasks
                WHERE id = %s AND lease_token = %s::uuid
                  AND state IN ('LEASED', 'RUNNING')
                FOR UPDATE
                """,
                (task_id, lease_token),
            )
            task = cursor.fetchone()
            if task is None:
                return

            retry = classification in {"TRANSIENT", "RATE_LIMIT"} and task["attempt_count"] < task["max_attempts"]
            delay = (
                min(
                    task["retry_max_delay_seconds"],
                    ceil(task["retry_initial_delay_seconds"] * float(task["retry_backoff_multiplier"]) ** (task["attempt_count"] - 1)),
                )
                if retry
                else 0
            )
            cursor.execute(
                """
                UPDATE forgeflow.task_attempts
                SET state = 'FAILED', completed_at = now(), error_class = %s,
                    error_code = %s, error_message = %s
                WHERE task_id = %s AND lease_token = %s::uuid
                  AND state IN ('LEASED', 'RUNNING')
                """,
                (classification, code, message, task_id, lease_token),
            )
            cursor.execute(
                """
                UPDATE forgeflow.workflow_tasks
                SET state = CASE WHEN %s THEN 'RETRYING' ELSE 'FAILED' END,
                    available_at = CASE WHEN %s THEN now() + make_interval(secs => %s::integer) ELSE available_at END,
                    lease_token = NULL, lease_expires_at = NULL, leased_by_worker_id = NULL,
                    completed_at = CASE WHEN %s THEN NULL ELSE now() END,
                    last_error_code = %s, last_error_message = %s
                WHERE id = %s AND lease_token = %s::uuid
                """,
                (retry, retry, delay, retry, code, message, task_id, lease_token),
            )
            if not retry:
                cursor.execute(
                    """
                    WITH RECURSIVE blocked AS (
                      SELECT dependency.task_id AS id
                      FROM forgeflow.workflow_task_dependencies dependency
                      JOIN forgeflow.workflow_tasks prerequisite ON prerequisite.id = dependency.depends_on_task_id
                      WHERE prerequisite.workflow_run_id = %s
                        AND prerequisite.state IN ('FAILED', 'CANCELLED')
                      UNION
                      SELECT dependency.task_id
                      FROM forgeflow.workflow_task_dependencies dependency
                      JOIN blocked ON blocked.id = dependency.depends_on_task_id
                    )
                    UPDATE forgeflow.workflow_tasks
                    SET state = 'CANCELLED', completed_at = now(), last_error_code = 'DEPENDENCY_TERMINAL',
                        last_error_message = 'A prerequisite task failed or was cancelled.'
                    WHERE id IN (SELECT id FROM blocked)
                      AND state IN ('PENDING', 'WAITING', 'RETRYING')
                    """,
                    (task["workflow_run_id"],),
                )

    def persist_sec_evidence(
        self,
        company_id: str,
        documents: list[SecDocument],
        company_facts: SecCompanyFacts,
        extracted_facts: list[ExtractedSecFact],
    ) -> dict[str, int]:
        """Idempotently persist immutable SEC evidence and raw XBRL observations."""
        with self._connection() as connection, connection.cursor() as cursor:
            company_facts_source = self._record_source(
                cursor, company_id, "API", company_facts.source_url,
                json.dumps(company_facts.content, sort_keys=True, separators=(",", ":")).encode(),
                company_facts.retrieved_at, {"cik": company_facts.company.cik, "dataset": "companyfacts"},
            )
            company_facts_document = self._record_document(
                cursor, company_facts_source, "SEC_COMPANY_FACTS", company_facts.source_url,
                None, company_facts.source_url,
                json.dumps(company_facts.content, sort_keys=True, separators=(",", ":")).encode(),
                {"cik": company_facts.company.cik},
            )
            inserted_facts = 0
            for fact in extracted_facts:
                cursor.execute(
                    """
                    INSERT INTO forgeflow.facts (company_id, source_id, document_id, field_name, raw_value, normalization_status, observed_at)
                    SELECT %s, %s, %s, %s, %s::jsonb, %s, %s::date
                    WHERE NOT EXISTS (
                      SELECT 1 FROM forgeflow.facts
                      WHERE company_id = %s AND source_id = %s AND document_id = %s
                        AND field_name = %s AND raw_value = %s::jsonb
                        AND normalization_status = %s AND observed_at IS NOT DISTINCT FROM %s::date
                    )
                    """,
                    (company_id, company_facts_source, company_facts_document, fact.field_name,
                     Jsonb(fact.raw_value), fact.normalization_status, fact.observed_at,
                     company_id, company_facts_source, company_facts_document, fact.field_name,
                     Jsonb(fact.raw_value), fact.normalization_status, fact.observed_at),
                )
                inserted_facts += cursor.rowcount
            for document in documents:
                source_id = self._record_source(
                    cursor, company_id, "SEC_FILING", document.filing.document_url, document.content,
                    document.retrieved_at, {"cik": company_facts.company.cik, "form": document.filing.form},
                )
                self._record_document(
                    cursor, source_id, document.filing.form, document.filing.accession_number,
                    document.filing.filing_date, document.filing.document_url, document.content,
                    {"primary_document": document.filing.primary_document},
                )
            return {"documents": len(documents) + 1, "facts": inserted_facts}

    @staticmethod
    def _record_source(cursor, company_id: str, source_type: str, origin_url: str, content: bytes, retrieved_at, metadata: dict[str, str]) -> str:
        content_hash = sha256(content).hexdigest()
        cursor.execute(
            """
            INSERT INTO forgeflow.sources (company_id, source_type, provider, origin_url, retrieved_at, content_hash, metadata)
            VALUES (%s, %s, 'SEC EDGAR', %s, %s, %s, %s::jsonb)
            ON CONFLICT (provider, origin_url, content_hash) DO NOTHING RETURNING id
            """, (company_id, source_type, origin_url, retrieved_at, content_hash, Jsonb(metadata)),
        )
        row = cursor.fetchone()
        if row is None:
            cursor.execute("SELECT id FROM forgeflow.sources WHERE provider = 'SEC EDGAR' AND origin_url = %s AND content_hash = %s", (origin_url, content_hash))
            row = cursor.fetchone()
        if row is None: raise RuntimeError("SEC source persistence did not return an identifier")
        return str(row["id"])

    @staticmethod
    def _record_document(cursor, source_id: str, document_type: str, external_identifier: str | None, filing_date: str | None, content_location: str, content: bytes, metadata: dict[str, str]) -> str:
        content_hash = sha256(content).hexdigest()
        cursor.execute(
            """
            INSERT INTO forgeflow.documents (source_id, document_type, external_identifier, filing_date, content_location, content_hash, metadata)
            VALUES (%s, %s, %s, %s::date, %s, %s, %s::jsonb)
            ON CONFLICT (source_id, content_hash) DO NOTHING RETURNING id
            """, (source_id, document_type, external_identifier, filing_date, content_location, content_hash, Jsonb(metadata)),
        )
        row = cursor.fetchone()
        if row is None:
            cursor.execute("SELECT id FROM forgeflow.documents WHERE source_id = %s AND content_hash = %s", (source_id, content_hash))
            row = cursor.fetchone()
        if row is None: raise RuntimeError("SEC document persistence did not return an identifier")
        return str(row["id"])
