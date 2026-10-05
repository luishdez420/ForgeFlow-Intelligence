from __future__ import annotations

import json
from pathlib import Path

import pytest

from forgeflow_worker.sec_edgar import (
    SecEdgarError,
    SecEdgarProvider,
    SecFiling,
    SecEdgarTimeoutError,
    SecRequestRateLimiter,
)
from forgeflow_worker.sec_smoke import smoke_summary

FIXTURES = Path(__file__).parent / "fixtures"


class FixtureHttpClient:
    def __init__(self) -> None:
        self.urls: list[str] = []
        self.headers: list[dict[str, str]] = []

    def get_json(self, url: str, headers: dict[str, str], __: float) -> object:
        self.urls.append(url)
        self.headers.append(headers)
        filename = (
            "company_tickers.json" if url.endswith("company_tickers.json")
            else "companyfacts_msft.json" if "companyfacts" in url
            else "submissions_msft.json"
        )
        return json.loads((FIXTURES / filename).read_text())

    def get_bytes(self, url: str, _: dict[str, str], __: float) -> bytes:
        if "missing" in url:
            raise SecEdgarError("SEC EDGAR returned HTTP 404.")
        return f"<html><body>{url}</body></html>".encode()


def test_resolves_ticker_and_normalizes_supported_filing_references() -> None:
    client = FixtureHttpClient()
    provider = SecEdgarProvider("ForgeFlow Intelligence contact@example.com", http_client=client)

    company = provider.resolve_ticker("msft")
    filings = provider.retrieve_filings(company)

    assert company.cik == "0000789019"
    assert company.name == "MICROSOFT CORP"
    assert company.source_url == "https://www.sec.gov/files/company_tickers.json"
    assert [filing.form for filing in filings] == ["10-K", "10-Q", "8-K"]
    assert filings[0].document_url.endswith("/789019/000095017025089830/msft-20250630.htm")
    assert len(client.urls) == 2
    assert client.urls == [
        "https://www.sec.gov/files/company_tickers.json",
        "https://data.sec.gov/submissions/CIK0000789019.json",
    ]
    assert client.headers == [
        {"User-Agent": "ForgeFlow Intelligence contact@example.com"},
        {"User-Agent": "ForgeFlow Intelligence contact@example.com"},
    ]


def test_rejects_missing_ticker_and_noncompliant_user_agent() -> None:
    with pytest.raises(ValueError, match="User-Agent"):
        SecEdgarProvider("ForgeFlow")
    with pytest.raises(SecEdgarError, match="not found"):
        SecEdgarProvider("ForgeFlow contact@example.com", http_client=FixtureHttpClient()).resolve_ticker("NOPE")


def test_rejects_malformed_filing_arrays() -> None:
    class MalformedClient(FixtureHttpClient):
        def get_json(self, url: str, headers: dict[str, str], timeout_seconds: float) -> object:
            payload = super().get_json(url, headers, timeout_seconds)
            if not url.endswith("company_tickers.json"):
                payload["filings"]["recent"]["form"].pop()
            return payload

    provider = SecEdgarProvider("ForgeFlow contact@example.com", http_client=MalformedClient())
    with pytest.raises(SecEdgarError, match="inconsistent lengths"):
        provider.retrieve_filings(provider.resolve_ticker("MSFT"))


def test_uses_bounded_cache_and_safe_retrieval_telemetry() -> None:
    class Sink:
        events: list[object] = []

        def record(self, event: object) -> None:
            self.events.append(event)

    client, sink = FixtureHttpClient(), Sink()
    provider = SecEdgarProvider(
        "ForgeFlow contact@example.com",
        http_client=client,
        telemetry_sink=sink,
        ticker_cache_max_entries=1,
    )
    provider.resolve_ticker("MSFT")
    provider.resolve_ticker("MSFT")

    assert len(client.urls) == 1
    assert sink.events[-1].cache_hit is True
    assert sink.events[-1].endpoint == "company_tickers"
    assert "contact@example.com" not in repr(sink.events[-1])


def test_rate_limiter_paces_requests_and_timeout_is_retryable() -> None:
    now, waits = [0.0], []
    limiter = SecRequestRateLimiter(
        2,
        clock=lambda: now[0],
        sleeper=lambda seconds: waits.append(seconds),
    )
    limiter.acquire()
    limiter.acquire()
    assert waits == [0.5]

    class TimeoutClient:
        def get_json(self, *_: object) -> object:
            raise TimeoutError()

    with pytest.raises(SecEdgarTimeoutError) as error:
        SecEdgarProvider(
            "ForgeFlow contact@example.com", http_client=TimeoutClient()
        ).resolve_ticker("MSFT")
    assert error.value.classification == "TRANSIENT"


def test_live_provider_requires_explicit_opt_in(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SEC_EDGAR_LIVE_ENABLED", raising=False)
    with pytest.raises(ValueError, match="disabled"):
        SecEdgarProvider.from_environment()


def test_smoke_summary_uses_one_company_and_filing_lookup() -> None:
    provider = SecEdgarProvider(
        "ForgeFlow contact@example.com", http_client=FixtureHttpClient()
    )
    assert smoke_summary(provider, "MSFT") == {
        "ticker": "MSFT",
        "cik": "0000789019",
        "companyName": "MICROSOFT CORP",
        "supportedFilingCount": 3,
        "forms": ["10-K", "10-Q", "8-K"],
    }


def test_retrieves_one_selected_document_per_supported_form_and_company_facts() -> None:
    provider = SecEdgarProvider(
        "ForgeFlow contact@example.com", http_client=FixtureHttpClient()
    )
    company = provider.resolve_ticker("MSFT")
    filings = provider.retrieve_filings(company)

    documents = provider.retrieve_selected_documents(filings + [filings[0]])
    company_facts = provider.retrieve_company_facts(company)

    assert [document.filing.form for document in documents] == ["10-K", "10-Q", "8-K"]
    assert all(document.content.startswith(b"<html>") for document in documents)
    assert company_facts.source_url.endswith("/CIK0000789019.json")
    assert company_facts.content["facts"]["us-gaap"]["Revenues"]["units"]["USD"][0]["val"] == 245000


def test_rejects_malformed_company_facts_and_preserves_missing_document_error() -> None:
    class MalformedFactsClient(FixtureHttpClient):
        def get_json(self, url: str, headers: dict[str, str], timeout: float) -> object:
            if "companyfacts" in url:
                return []
            return super().get_json(url, headers, timeout)

    provider = SecEdgarProvider(
        "ForgeFlow contact@example.com", http_client=MalformedFactsClient()
    )
    company = provider.resolve_ticker("MSFT")
    with pytest.raises(SecEdgarError, match="malformed"):
        provider.retrieve_company_facts(company)
    with pytest.raises(SecEdgarError, match="404"):
        provider.retrieve_selected_documents(
            [
                SecFiling(
                    "missing", "10-K", "2025-01-01", "missing.htm",
                    "https://www.sec.gov/Archives/edgar/data/missing", "https://data.sec.gov/submissions/test"
                )
            ]
        )
