from __future__ import annotations

from os import environ
from uuid import uuid4

import psycopg
import pytest
from psycopg.rows import dict_row

from forgeflow_financial_engine.metrics import operating_margin, year_over_year_revenue_growth
from forgeflow_worker.repository import DEFAULT_DATABASE_URL, PostgresWorkerRepository

run_integration = environ.get("RUN_INTEGRATION") == "1"


@pytest.mark.skipif(not run_integration, reason="Set RUN_INTEGRATION=1 to run PostgreSQL integration tests.")
def test_persists_versioned_calculated_and_invalid_metrics_idempotently() -> None:
    database_url = environ.get("DATABASE_URL", DEFAULT_DATABASE_URL)
    ticker = f"M{uuid4().hex[:8].upper()}"
    repository = PostgresWorkerRepository(database_url)
    with psycopg.connect(database_url) as connection, connection.cursor() as cursor:
        cursor.execute("INSERT INTO forgeflow.companies (ticker) VALUES (%s) RETURNING id", (ticker,))
        company_id = str(cursor.fetchone()[0])
    try:
        calculated = operating_margin("25", "100", ["source-a"])
        invalid = year_over_year_revenue_growth("100", "0", ["source-a"])
        first_id = repository.persist_financial_metric(company_id, calculated, "2025-06-30")
        assert repository.persist_financial_metric(company_id, calculated, "2025-06-30") == first_id
        repository.persist_financial_metric(company_id, invalid, "2025-06-30")
        with psycopg.connect(database_url, row_factory=dict_row) as connection, connection.cursor() as cursor:
            cursor.execute("SELECT metric_name, value, formula_version, input_snapshot, calculation_status FROM forgeflow.financial_metrics WHERE company_id = %s ORDER BY metric_name", (company_id,))
            rows = cursor.fetchall()
        assert len(rows) == 2
        by_name = {row["metric_name"]: row for row in rows}
        assert by_name["revenue_yoy_growth"]["calculation_status"] == "INVALID_INPUT"
        assert by_name["operating_margin"]["value"] == 25
        assert by_name["operating_margin"]["input_snapshot"]["source_ids"] == ["source-a"]
    finally:
        with psycopg.connect(database_url) as connection, connection.cursor() as cursor:
            cursor.execute("DELETE FROM forgeflow.financial_metrics WHERE company_id = %s", (company_id,))
            cursor.execute("DELETE FROM forgeflow.companies WHERE id = %s", (company_id,))
