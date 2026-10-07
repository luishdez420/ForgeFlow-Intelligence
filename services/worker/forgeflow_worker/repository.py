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
from .sec_taxonomy import CanonicalFact
from .validation import ValidationFinding, validate_workflow_inputs

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

    def workflow_company(self, workflow_id: str) -> tuple[str, str]:
        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute("SELECT company_id, ticker FROM forgeflow.workflow_runs WHERE id = %s", (workflow_id,))
            row = cursor.fetchone()
        if row is None or row["company_id"] is None: raise RuntimeError("Workflow has no company.")
        return str(row["company_id"]), str(row["ticker"])

    def record_market_data_unavailable(self, company_id: str) -> None:
        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute("""INSERT INTO forgeflow.sources (company_id, source_type, provider, origin_url, retrieved_at, content_hash, metadata)
            VALUES (%s, 'API', 'MARKET_DATA_UNAVAILABLE', 'https://forgeflow.invalid/market-data-unavailable', now(), 'market-data-unavailable-v1', '{"reason":"NO_APPROVED_VENDOR"}'::jsonb)
            ON CONFLICT (provider, origin_url, content_hash) DO NOTHING RETURNING id""", (company_id,))
            row = cursor.fetchone()
            if row is None:
                cursor.execute("SELECT id FROM forgeflow.sources WHERE provider = 'MARKET_DATA_UNAVAILABLE' AND origin_url = 'https://forgeflow.invalid/market-data-unavailable' AND content_hash = 'market-data-unavailable-v1'")
                row = cursor.fetchone()
            cursor.execute("""INSERT INTO forgeflow.facts (company_id, source_id, field_name, raw_value, normalization_status)
            SELECT %s, %s, 'market_history', '{"reason":"NO_APPROVED_VENDOR"}'::jsonb, 'UNAVAILABLE'
            WHERE NOT EXISTS (SELECT 1 FROM forgeflow.facts WHERE company_id = %s AND source_id = %s AND field_name = 'market_history')""", (company_id, row["id"], company_id, row["id"]))

    def persist_financial_metric(self, company_id: str, metric, period_end: str | None = None) -> str:
        """Persist a deterministic metric once per formula/input snapshot."""
        snapshot = Jsonb(metric.input_snapshot)
        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute("""INSERT INTO forgeflow.financial_metrics (company_id, metric_name, period_end, value, unit, formula_version, input_snapshot, calculation_status, calculated_at)
            SELECT %s, %s, %s::date, %s, %s, %s, %s::jsonb, %s, %s
            WHERE NOT EXISTS (SELECT 1 FROM forgeflow.financial_metrics WHERE company_id = %s AND metric_name = %s AND period_end IS NOT DISTINCT FROM %s::date AND formula_version = %s AND input_snapshot = %s::jsonb)
            RETURNING id""", (company_id, metric.metric_name, period_end, metric.value, metric.unit, metric.formula_version, snapshot, metric.status, metric.calculated_at, company_id, metric.metric_name, period_end, metric.formula_version, snapshot))
            row = cursor.fetchone()
            if row is None:
                cursor.execute("SELECT id FROM forgeflow.financial_metrics WHERE company_id = %s AND metric_name = %s AND period_end IS NOT DISTINCT FROM %s::date AND formula_version = %s AND input_snapshot = %s::jsonb", (company_id, metric.metric_name, period_end, metric.formula_version, snapshot))
                row = cursor.fetchone()
        if row is None: raise RuntimeError("Financial metric persistence did not return an identifier")
        return str(row["id"])

    def validate_workflow_sources(self, workflow_id: str) -> list[ValidationFinding]:
        """Persist deterministic validation findings without mutating source evidence."""
        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute("SELECT company_id FROM forgeflow.workflow_runs WHERE id = %s", (workflow_id,))
            workflow = cursor.fetchone()
            if workflow is None or workflow["company_id"] is None:
                raise RuntimeError("Workflow has no company.")
            company_id = str(workflow["company_id"])
            cursor.execute("SELECT id, retrieved_at FROM forgeflow.sources WHERE company_id = %s", (company_id,))
            sources = cursor.fetchall()
            cursor.execute("SELECT id, source_id, field_name, raw_value, normalization_status, observed_at FROM forgeflow.facts WHERE company_id = %s", (company_id,))
            facts = cursor.fetchall()
            findings = validate_workflow_inputs(sources, facts)
            for finding in findings:
                value = finding.persistence_value()
                cursor.execute(
                    """INSERT INTO forgeflow.workflow_validation_findings
                       (workflow_run_id, company_id, finding_key, code, severity, data_status, subject_type, subject_id, message, details)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
                       ON CONFLICT (workflow_run_id, finding_key) DO UPDATE
                       SET severity = EXCLUDED.severity, data_status = EXCLUDED.data_status,
                           message = EXCLUDED.message, details = EXCLUDED.details""",
                    (workflow_id, company_id, value["finding_key"], value["code"], value["severity"], value["data_status"], value["subject_type"], value["subject_id"], value["message"], Jsonb(value["details"])),
                )
        return findings

    def assemble_report(self, workflow_id: str) -> str:
        """Build an idempotent typed report from persisted evidence only."""
        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute("SELECT company_id FROM forgeflow.workflow_runs WHERE id = %s FOR UPDATE", (workflow_id,))
            workflow = cursor.fetchone()
            if workflow is None or workflow["company_id"] is None:
                raise ValueError("Workflow has no company.")
            company_id = str(workflow["company_id"])
            cursor.execute("SELECT count(*) AS count FROM forgeflow.workflow_validation_findings WHERE workflow_run_id = %s AND severity = 'ERROR'", (workflow_id,))
            if int(cursor.fetchone()["count"]) > 0:
                raise ValueError("Report publication is blocked by invalid source validation findings.")
            cursor.execute("""
                INSERT INTO forgeflow.reports (workflow_run_id, company_id, state)
                VALUES (%s, %s, 'DRAFT')
                ON CONFLICT (workflow_run_id) DO UPDATE SET state = 'DRAFT', published_at = NULL
                RETURNING id
            """, (workflow_id, company_id))
            report_id = str(cursor.fetchone()["id"])
            cursor.execute("DELETE FROM forgeflow.report_items WHERE report_id = %s AND item_kind <> 'AI_ANALYSIS'", (report_id,))
            cursor.execute("SELECT COALESCE(MAX(display_order), -1) + 1 AS next_order FROM forgeflow.report_items WHERE report_id = %s", (report_id,))
            order = int(cursor.fetchone()["next_order"])
            cursor.execute("""
                SELECT id, source_id, field_name, raw_value, normalized_value, normalization_status
                FROM forgeflow.facts WHERE company_id = %s ORDER BY created_at, id
            """, (company_id,))
            for fact in cursor.fetchall():
                item_kind = "FACT" if fact["normalized_value"] is not None or fact["normalization_status"] == "NORMALIZED" else "UNAVAILABLE"
                value = fact["normalized_value"] or fact["raw_value"]
                content = self._report_content(value)
                cursor.execute("""
                    INSERT INTO forgeflow.report_items (report_id, item_kind, section, title, content, display_order)
                    VALUES (%s, %s, 'Evidence', %s, %s, %s) RETURNING id
                """, (report_id, item_kind, fact["field_name"], content, order))
                item_id = str(cursor.fetchone()["id"])
                order += 1
                if item_kind != "UNAVAILABLE":
                    cursor.execute("""
                        INSERT INTO forgeflow.report_item_sources (report_item_id, source_id)
                        VALUES (%s, %s) ON CONFLICT DO NOTHING
                    """, (item_id, fact["source_id"]))
            cursor.execute("""
                SELECT id, metric_name, value, unit, calculation_status, input_snapshot
                FROM forgeflow.financial_metrics WHERE company_id = %s ORDER BY calculated_at, id
            """, (company_id,))
            for metric in cursor.fetchall():
                snapshot = metric["input_snapshot"] if isinstance(metric["input_snapshot"], dict) else {}
                source_ids = [source_id for source_id in snapshot.get("source_ids", []) if isinstance(source_id, str)]
                item_kind = "CALCULATION" if metric["calculation_status"] == "CALCULATED" and source_ids else "UNAVAILABLE"
                content = f"{metric['value']} {metric['unit']}" if metric["value"] is not None else str(metric["calculation_status"])
                cursor.execute("""
                    INSERT INTO forgeflow.report_items (report_id, item_kind, section, title, content, display_order, financial_metric_id)
                    VALUES (%s, %s, 'Calculations', %s, %s, %s, %s) RETURNING id
                """, (report_id, item_kind, metric["metric_name"], content, order, metric["id"]))
                item_id = str(cursor.fetchone()["id"])
                order += 1
                if item_kind == "CALCULATION":
                    for source_id in set(source_ids):
                        cursor.execute("""
                            INSERT INTO forgeflow.report_item_sources (report_item_id, source_id)
                            SELECT %s, id FROM forgeflow.sources WHERE id = %s::uuid
                            ON CONFLICT DO NOTHING
                        """, (item_id, source_id))
            return report_id

    def publish_report(self, workflow_id: str) -> None:
        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute("""
                UPDATE forgeflow.reports SET state = 'PUBLISHED', published_at = now()
                WHERE workflow_run_id = %s AND state = 'DRAFT'
            """, (workflow_id,))
            if cursor.rowcount != 1:
                raise ValueError("A draft report must be assembled before publication.")

    @staticmethod
    def _report_content(value: object) -> str:
        if isinstance(value, dict):
            if value.get("reason"):
                return str(value["reason"])
            if value.get("val") is not None:
                suffix = f" {value['unit']}" if value.get("unit") else ""
                return f"{value['val']}{suffix}"
            if value.get("value") is not None:
                suffix = f" {value['unit']}" if value.get("unit") else ""
                return f"{value['value']}{suffix}"
        return json.dumps(value, sort_keys=True, default=str)

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

    def record_task_success(self, task_id: str, lease_token: str) -> None:
        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute("UPDATE forgeflow.workflow_tasks SET state = 'SUCCEEDED', completed_at = now(), lease_token = NULL, lease_expires_at = NULL, leased_by_worker_id = NULL WHERE id = %s AND lease_token = %s::uuid AND state IN ('LEASED', 'RUNNING') RETURNING workflow_run_id", (task_id, lease_token))
            row = cursor.fetchone()
            if row is None: return
            cursor.execute("UPDATE forgeflow.task_attempts SET state = 'SUCCEEDED', completed_at = now() WHERE task_id = %s AND lease_token = %s::uuid AND state IN ('LEASED', 'RUNNING')", (task_id, lease_token))
            cursor.execute("UPDATE forgeflow.workflow_tasks dependent SET state = 'PENDING' FROM forgeflow.workflow_task_dependencies edge WHERE edge.task_id = dependent.id AND dependent.workflow_run_id = %s AND dependent.state = 'WAITING' AND NOT EXISTS (SELECT 1 FROM forgeflow.workflow_task_dependencies required JOIN forgeflow.workflow_tasks prerequisite ON prerequisite.id = required.depends_on_task_id WHERE required.task_id = dependent.id AND prerequisite.state <> 'SUCCEEDED')", (row['workflow_run_id'],))
            cursor.execute("UPDATE forgeflow.workflow_runs SET state = 'SUCCEEDED', completed_at = now() WHERE id = %s AND state NOT IN ('SUCCEEDED', 'FAILED', 'CANCELLED') AND NOT EXISTS (SELECT 1 FROM forgeflow.workflow_tasks WHERE workflow_run_id = %s AND state <> 'SUCCEEDED')", (row["workflow_run_id"], row["workflow_run_id"]))

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

    def persist_canonical_sec_facts(self, company_id: str, source_id: str, document_id: str, facts: list[CanonicalFact]) -> int:
        """Persist every mapping result with source/document identity and version."""
        inserted = 0
        with self._connection() as connection, connection.cursor() as cursor:
            for fact in facts:
                raw_value = {"sec_concept": fact.sec_concept, "unit": fact.unit, "mapping_version": fact.mapping_version, "raw": fact.raw_value}
                cursor.execute(
                    """INSERT INTO forgeflow.facts (company_id, source_id, document_id, field_name, raw_value, normalized_value, normalization_status, observed_at)
                    SELECT %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s, %s::date WHERE NOT EXISTS (
                      SELECT 1 FROM forgeflow.facts WHERE company_id = %s AND source_id = %s AND document_id = %s AND field_name = %s AND raw_value = %s::jsonb
                    )""",
                    (company_id, source_id, document_id, fact.name, Jsonb(raw_value), Jsonb({"unit": fact.unit, "value": fact.raw_value.get("val"), "mapping_version": fact.mapping_version}), fact.status, fact.period_end,
                     company_id, source_id, document_id, fact.name, Jsonb(raw_value)),
                )
                inserted += cursor.rowcount
        return inserted

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
