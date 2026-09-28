"""Replaceable market-data contracts; vendor response shape stays inside adapters."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, date, datetime
from os import environ
from typing import Protocol
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


class MarketDataError(RuntimeError):
    classification = "PERMANENT"


class MarketDataTransientError(MarketDataError):
    classification = "TRANSIENT"


class MarketDataRateLimitError(MarketDataError):
    classification = "RATE_LIMIT"


@dataclass(frozen=True)
class CompanyMetadata:
    ticker: str
    name: str
    exchange: str | None
    currency: str | None
    provider: str
    source_url: str
    retrieved_at: datetime


@dataclass(frozen=True)
class HistoricalPrice:
    ticker: str
    trading_date: date
    close: float
    adjusted_close: float | None
    currency: str | None
    provider: str
    source_url: str
    retrieved_at: datetime


class MarketDataProvider(Protocol):
    def get_company_metadata(self, ticker: str) -> CompanyMetadata: ...

    def get_historical_prices(self, ticker: str, start: date, end: date) -> list[HistoricalPrice]: ...


class HttpClient(Protocol):
    def get_json(self, url: str, headers: dict[str, str], timeout_seconds: float) -> object: ...


class UrlLibHttpClient:
    def get_json(self, url: str, headers: dict[str, str], timeout_seconds: float) -> object:
        try:
            with urlopen(Request(url, headers=headers), timeout=timeout_seconds) as response:  # noqa: S310
                return json.loads(response.read())
        except HTTPError as error:
            if error.code == 429:
                raise MarketDataRateLimitError("Market-data provider rate limited the request.") from error
            if 500 <= error.code < 600:
                raise MarketDataTransientError("Market-data provider was temporarily unavailable.") from error
            raise MarketDataError(f"Market-data provider returned HTTP {error.code}.") from error
        except URLError as error:
            raise MarketDataTransientError("Market-data provider could not be reached.") from error


class JsonHttpMarketDataProvider:
    """Initial configurable adapter for a normalized JSON endpoint, not a vendor domain model."""

    def __init__(self, provider_name: str, base_url: str, api_key: str, *, http_client: HttpClient | None = None, timeout_seconds: float = 10) -> None:
        if not provider_name.strip() or not base_url.startswith("https://") or not api_key:
            raise ValueError("Market-data provider configuration requires name, HTTPS base URL, and API key.")
        self._provider_name, self._base_url, self._api_key = provider_name.strip(), base_url.rstrip("/"), api_key
        self._http, self._timeout_seconds = http_client or UrlLibHttpClient(), timeout_seconds

    @classmethod
    def from_environment(cls, *, http_client: HttpClient | None = None) -> "JsonHttpMarketDataProvider":
        try:
            return cls(environ["MARKET_DATA_PROVIDER"], environ["MARKET_DATA_BASE_URL"], environ["MARKET_DATA_API_KEY"], http_client=http_client)
        except KeyError as error:
            raise ValueError("Market-data runtime configuration is incomplete.") from error

    def _fetch(self, path: str, query: dict[str, str]) -> tuple[object, str, datetime]:
        url = f"{self._base_url}{path}?{urlencode(query)}"
        payload = self._http.get_json(url, {"Authorization": f"Bearer {self._api_key}"}, self._timeout_seconds)
        return payload, url, datetime.now(UTC)

    def get_company_metadata(self, ticker: str) -> CompanyMetadata:
        symbol = ticker.upper().strip()
        payload, url, retrieved_at = self._fetch("/company", {"ticker": symbol})
        if not isinstance(payload, dict) or not isinstance(payload.get("name"), str):
            raise MarketDataError("Market-data company response was malformed.")
        return CompanyMetadata(symbol, payload["name"], payload.get("exchange") if isinstance(payload.get("exchange"), str) else None, payload.get("currency") if isinstance(payload.get("currency"), str) else None, self._provider_name, url, retrieved_at)

    def get_historical_prices(self, ticker: str, start: date, end: date) -> list[HistoricalPrice]:
        if start > end:
            raise ValueError("Price start date must not be after end date.")
        symbol = ticker.upper().strip()
        payload, url, retrieved_at = self._fetch("/prices", {"ticker": symbol, "start": start.isoformat(), "end": end.isoformat()})
        rows = payload.get("prices") if isinstance(payload, dict) else None
        if not isinstance(rows, list):
            raise MarketDataError("Market-data price response was malformed.")
        prices: list[HistoricalPrice] = []
        for row in rows:
            if not isinstance(row, dict):
                raise MarketDataError("Market-data price row was malformed.")
            try:
                prices.append(HistoricalPrice(symbol, date.fromisoformat(str(row["date"])), float(row["close"]), float(row["adjusted_close"]) if row.get("adjusted_close") is not None else None, row.get("currency") if isinstance(row.get("currency"), str) else None, self._provider_name, url, retrieved_at))
            except (KeyError, TypeError, ValueError) as error:
                raise MarketDataError("Market-data price row was malformed.") from error
        return prices
