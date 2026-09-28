from __future__ import annotations

import json
from pathlib import Path

import pytest

from forgeflow_worker.sec_edgar import SecEdgarError, SecEdgarProvider

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
