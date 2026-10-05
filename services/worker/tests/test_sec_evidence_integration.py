from __future__ import annotations

import json
from os import environ
from pathlib import Path
from uuid import uuid4

import psycopg
import pytest

from forgeflow_worker.repository import DEFAULT_DATABASE_URL, PostgresWorkerRepository
from forgeflow_worker.sec_edgar import SecEdgarProvider
from forgeflow_worker.sec_facts import extract_initial_facts
from forgeflow_worker.sec_taxonomy import map_sec_facts

FIXTURES = Path(__file__).parent / "fixtures"
run_integration = environ.get("RUN_INTEGRATION") == "1"


class FixtureHttpClient:
    def get_json(self, url: str, _: dict[str, str], __: float) -> object:
        filename = (
            "company_tickers.json" if url.endswith("company_tickers.json")
            else "companyfacts_msft.json" if "companyfacts" in url
            else "submissions_msft.json"
        )
        return json.loads((FIXTURES / filename).read_text())

    def get_bytes(self, url: str, _: dict[str, str], __: float) -> bytes:
        return f"<html><body>{url}</body></html>".encode()


@pytest.mark.skipif(not run_integration, reason="Set RUN_INTEGRATION=1 to run PostgreSQL integration tests.")
def test_persists_sec_evidence_idempotently() -> None:
    database_url = environ.get("DATABASE_URL", DEFAULT_DATABASE_URL)
    ticker = f"X{uuid4().hex[:8].upper()}"
    repository = PostgresWorkerRepository(database_url)
    provider = SecEdgarProvider("ForgeFlow contact@example.com", http_client=FixtureHttpClient())
    company = provider.resolve_ticker("MSFT")
    documents = provider.retrieve_selected_documents(provider.retrieve_filings(company))
    company_facts = provider.retrieve_company_facts(company)
    facts = extract_initial_facts(company_facts)

    with psycopg.connect(database_url) as connection, connection.cursor() as cursor:
        cursor.execute("INSERT INTO forgeflow.companies (ticker) VALUES (%s) RETURNING id", (ticker,))
        company_id = str(cursor.fetchone()[0])
    try:
        first = repository.persist_sec_evidence(company_id, documents, company_facts, facts)
        second = repository.persist_sec_evidence(company_id, documents, company_facts, facts)
        with psycopg.connect(database_url) as connection, connection.cursor() as cursor:
            cursor.execute("SELECT source_id, document_id FROM forgeflow.facts WHERE company_id = %s LIMIT 1", (company_id,))
            source_id, document_id = cursor.fetchone()
        assert repository.persist_canonical_sec_facts(company_id, str(source_id), str(document_id), map_sec_facts(facts)) == 7
        assert repository.persist_canonical_sec_facts(company_id, str(source_id), str(document_id), map_sec_facts(facts)) == 0
        assert first == {"documents": 4, "facts": 8}
        assert second == {"documents": 4, "facts": 0}
        with psycopg.connect(database_url) as connection, connection.cursor() as cursor:
            cursor.execute("SELECT count(*) FROM forgeflow.sources WHERE company_id = %s", (company_id,))
            assert cursor.fetchone()[0] == 4
            cursor.execute("SELECT count(*) FROM forgeflow.documents WHERE source_id IN (SELECT id FROM forgeflow.sources WHERE company_id = %s)", (company_id,))
            assert cursor.fetchone()[0] == 4
            cursor.execute("SELECT count(*) FROM forgeflow.facts WHERE company_id = %s", (company_id,))
            assert cursor.fetchone()[0] == 15
    finally:
        with psycopg.connect(database_url) as connection, connection.cursor() as cursor:
            cursor.execute("DELETE FROM forgeflow.facts WHERE company_id = %s", (company_id,))
            cursor.execute("DELETE FROM forgeflow.documents WHERE source_id IN (SELECT id FROM forgeflow.sources WHERE company_id = %s)", (company_id,))
            cursor.execute("DELETE FROM forgeflow.sources WHERE company_id = %s", (company_id,))
            cursor.execute("DELETE FROM forgeflow.companies WHERE id = %s", (company_id,))
