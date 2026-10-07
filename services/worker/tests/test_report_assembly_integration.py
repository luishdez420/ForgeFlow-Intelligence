from __future__ import annotations

from datetime import datetime
from os import environ
from uuid import uuid4

import psycopg
import pytest
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from forgeflow_worker.repository import DEFAULT_DATABASE_URL, PostgresWorkerRepository


run_integration = environ.get("RUN_INTEGRATION") == "1"


@pytest.mark.skipif(not run_integration, reason="Set RUN_INTEGRATION=1 to run PostgreSQL integration tests.")
def test_assembles_and_publishes_a_typed_evidence_report_idempotently() -> None:
    database_url = environ.get("DATABASE_URL", DEFAULT_DATABASE_URL)
    ticker = f"R{uuid4().hex[:8].upper()}"
    repository = PostgresWorkerRepository(database_url)
    with psycopg.connect(database_url, row_factory=dict_row) as connection, connection.cursor() as cursor:
        cursor.execute("INSERT INTO forgeflow.companies (ticker) VALUES (%s) RETURNING id", (ticker,))
        company_id = str(cursor.fetchone()["id"])
        cursor.execute("INSERT INTO forgeflow.workflow_runs (company_id, ticker, workflow_type, state) VALUES (%s, %s, 'COMPANY_ANALYSIS', 'PENDING') RETURNING id", (company_id, ticker))
        workflow_id = str(cursor.fetchone()["id"])
        cursor.execute("""
            INSERT INTO forgeflow.sources (company_id, source_type, provider, origin_url, retrieved_at, content_hash)
            VALUES (%s, 'SEC_FILING', 'SEC EDGAR', %s, %s, %s) RETURNING id
        """, (company_id, f"https://example.test/{ticker}", datetime.now(), uuid4().hex))
        source_id = str(cursor.fetchone()["id"])
        cursor.execute("""
            INSERT INTO forgeflow.facts (company_id, source_id, field_name, raw_value, normalization_status)
            VALUES (%s, %s, 'us-gaap:Revenues', %s::jsonb, 'NORMALIZED'),
                   (%s, %s, 'market_history', %s::jsonb, 'UNAVAILABLE')
        """, (company_id, source_id, Jsonb({"val": 100, "unit": "USD"}), company_id, source_id, Jsonb({"reason": "NO_APPROVED_VENDOR"})))
    try:
        first = repository.assemble_report(workflow_id)
        assert repository.assemble_report(workflow_id) == first
        repository.publish_report(workflow_id)
        with psycopg.connect(database_url, row_factory=dict_row) as connection, connection.cursor() as cursor:
            cursor.execute("SELECT state FROM forgeflow.reports WHERE id = %s", (first,))
            assert cursor.fetchone()["state"] == "PUBLISHED"
            cursor.execute("SELECT item_kind, title FROM forgeflow.report_items WHERE report_id = %s ORDER BY title", (first,))
            assert cursor.fetchall() == [
                {"item_kind": "UNAVAILABLE", "title": "market_history"},
                {"item_kind": "FACT", "title": "us-gaap:Revenues"},
            ]
            cursor.execute("SELECT count(*) AS count FROM forgeflow.report_item_sources WHERE report_item_id IN (SELECT id FROM forgeflow.report_items WHERE report_id = %s)", (first,))
            assert cursor.fetchone()["count"] == 1
    finally:
        with psycopg.connect(database_url) as connection, connection.cursor() as cursor:
            cursor.execute("DELETE FROM forgeflow.reports WHERE workflow_run_id = %s", (workflow_id,))
            cursor.execute("DELETE FROM forgeflow.facts WHERE company_id = %s", (company_id,))
            cursor.execute("DELETE FROM forgeflow.sources WHERE company_id = %s", (company_id,))
            cursor.execute("DELETE FROM forgeflow.workflow_runs WHERE id = %s", (workflow_id,))
            cursor.execute("DELETE FROM forgeflow.companies WHERE id = %s", (company_id,))
