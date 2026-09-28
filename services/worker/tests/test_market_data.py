from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import pytest

from forgeflow_worker.market_data import JsonHttpMarketDataProvider, MarketDataError, MarketDataRateLimitError

FIXTURES = Path(__file__).parent / "fixtures"


class FixtureHttpClient:
    def get_json(self, url: str, headers: dict[str, str], timeout_seconds: float) -> object:
        assert headers["Authorization"] == "Bearer test-key"
        filename = "market_company.json" if "/company?" in url else "market_prices.json"
        return json.loads((FIXTURES / filename).read_text())


def test_normalizes_company_and_historical_prices_from_fixture() -> None:
    provider = JsonHttpMarketDataProvider("fixture", "https://market.example.test", "test-key", http_client=FixtureHttpClient())
    company = provider.get_company_metadata("msft")
    prices = provider.get_historical_prices("msft", date(2025, 1, 2), date(2025, 1, 3))
    assert (company.ticker, company.name, company.provider) == ("MSFT", "Microsoft Corporation", "fixture")
    assert [(price.trading_date.isoformat(), price.close, price.adjusted_close) for price in prices] == [("2025-01-02", 410.0, 409.5), ("2025-01-03", 415.0, None)]
    assert all("test-key" not in price.source_url for price in prices)


def test_maps_invalid_range_and_provider_failures_without_secret() -> None:
    provider = JsonHttpMarketDataProvider("fixture", "https://market.example.test", "secret", http_client=FixtureHttpClient())
    with pytest.raises(ValueError, match="start date"):
        provider.get_historical_prices("MSFT", date(2025, 1, 3), date(2025, 1, 2))
    with pytest.raises(ValueError, match="configuration"):
        JsonHttpMarketDataProvider("", "http://unsafe", "")

    class RateLimitedClient:
        def get_json(self, url: str, headers: dict[str, str], timeout_seconds: float) -> object:
            raise MarketDataRateLimitError("rate limited")

    with pytest.raises(MarketDataRateLimitError, match="rate limited"):
        JsonHttpMarketDataProvider("fixture", "https://market.example.test", "secret", http_client=RateLimitedClient()).get_company_metadata("MSFT")
