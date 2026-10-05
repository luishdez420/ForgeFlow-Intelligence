from __future__ import annotations

import json
from pathlib import Path

import pytest

from forgeflow_worker.sec_edgar import (
    SecEdgarError,
    SecEdgarProvider,
    SecEdgarTimeoutError,
    SecRequestRateLimiter,
)
from forgeflow_worker.sec_smoke import smoke_summary

FIXTURES = Path(__file__).parent / "fixtures"


class FixtureHttpClient:
    def __init__(self) -> None:
        self.urls: list[str] = []

    def get_json(self, url: str, _: dict[str, str], __: float) -> object:
        self.urls.append(url)
        filename = "company_tickers.json" if url.endswith("company_tickers.json") else "submissions_msft.json"
        return json.loads((FIXTURES / filename).read_text())


def test_resolves_ticker_and_normalizes_supported_filing_references() -> None:
    client = FixtureHttpClient()
    provider = SecEdgarProvider("ForgeFlow Intelligence contact@example.com", http_client=client)

    company = provider.resolve_ticker("msft")
    filings = provider.retrieve_filings(company)

    assert company.cik == "0000789019"
    assert company.name == "MICROSOFT CORP"
    assert [filing.form for filing in filings] == ["10-K", "10-Q", "8-K"]
    assert filings[0].document_url.endswith("/789019/000095017025089830/msft-20250630.htm")
    assert len(client.urls) == 2


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
