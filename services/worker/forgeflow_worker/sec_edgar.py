"""Official SEC EDGAR access with a compliant, injectable live HTTP boundary."""
from __future__ import annotations

import json
from collections import OrderedDict
from dataclasses import dataclass
from datetime import UTC, datetime
from os import environ
from socket import timeout as SocketTimeout
from threading import Lock
from time import monotonic, sleep
from typing import Callable, Protocol
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

SEC_DATA_URL = "https://data.sec.gov"
SEC_ARCHIVES_URL = "https://www.sec.gov/Archives/edgar/data"

class SecEdgarError(RuntimeError): classification = "PERMANENT"
class SecEdgarTransientError(SecEdgarError): classification = "TRANSIENT"
class SecEdgarTimeoutError(SecEdgarTransientError): pass
class SecEdgarRateLimitError(SecEdgarTransientError): classification = "RATE_LIMIT"

class HttpClient(Protocol):
    def get_json(self, url: str, headers: dict[str, str], timeout_seconds: float) -> object: ...
class TelemetrySink(Protocol):
    def record(self, event: "SecRetrievalTelemetry") -> None: ...

@dataclass(frozen=True)
class SecRetrievalTelemetry:
    endpoint: str; outcome: str; cache_hit: bool; elapsed_milliseconds: int; error_classification: str | None = None
@dataclass(frozen=True)
class SecCompany:
    ticker: str; cik: str; name: str; exchange: str | None; source_url: str; retrieved_at: datetime
@dataclass(frozen=True)
class SecFiling:
    accession_number: str; form: str; filing_date: str; primary_document: str; document_url: str; source_url: str

class SecRequestRateLimiter:
    """Pass one instance to every live provider in a worker process."""
    def __init__(self, requests_per_second: float = 8, *, clock: Callable[[], float] = monotonic, sleeper: Callable[[float], None] = sleep) -> None:
        if requests_per_second <= 0: raise ValueError("requests_per_second must be positive")
        self._interval, self._clock, self._sleeper, self._next, self._lock = 1 / requests_per_second, clock, sleeper, 0.0, Lock()
    def acquire(self) -> None:
        with self._lock:
            now = self._clock(); wait = max(0.0, self._next - now); self._next = max(now, self._next) + self._interval
        if wait: self._sleeper(wait)

class UrlLibHttpClient:
    def get_json(self, url: str, headers: dict[str, str], timeout_seconds: float) -> object:
        try:
            with urlopen(Request(url, headers=headers), timeout=timeout_seconds) as response:  # noqa: S310
                return json.loads(response.read())
        except HTTPError as error:
            if error.code == 429: raise SecEdgarRateLimitError("SEC EDGAR rate limited the request.") from error
            if 500 <= error.code < 600: raise SecEdgarTransientError("SEC EDGAR was temporarily unavailable.") from error
            raise SecEdgarError(f"SEC EDGAR returned HTTP {error.code}.") from error
        except (SocketTimeout, TimeoutError) as error: raise SecEdgarTimeoutError("SEC EDGAR request timed out.") from error
        except URLError as error: raise SecEdgarTransientError("SEC EDGAR could not be reached.") from error

class SecEdgarProvider:
    def __init__(self, user_agent: str, *, http_client: HttpClient | None = None, rate_limiter: SecRequestRateLimiter | None = None, telemetry_sink: TelemetrySink | None = None, timeout_seconds: float = 10, ticker_cache_ttl_seconds: float = 3600, ticker_cache_max_entries: int = 1000, clock: Callable[[], float] = monotonic) -> None:
        if "@" not in user_agent or len(user_agent.strip()) < 8: raise ValueError("SEC EDGAR requires a contactable User-Agent containing an email address.")
        if min(timeout_seconds, ticker_cache_ttl_seconds, ticker_cache_max_entries) <= 0: raise ValueError("SEC EDGAR timeout and cache bounds must be positive.")
        self._headers, self._http, self._limiter = {"User-Agent": user_agent.strip(), "Accept-Encoding": "gzip, deflate"}, http_client or UrlLibHttpClient(), rate_limiter or SecRequestRateLimiter()
        self._telemetry, self._timeout, self._ttl, self._max, self._clock = telemetry_sink, timeout_seconds, ticker_cache_ttl_seconds, ticker_cache_max_entries, clock
        self._cache: OrderedDict[str, tuple[SecCompany, float]] = OrderedDict()
    @classmethod
    def from_environment(cls, **kwargs: object) -> "SecEdgarProvider":
        if environ.get("SEC_EDGAR_LIVE_ENABLED", "").lower() != "true": raise ValueError("Live SEC EDGAR is disabled; set SEC_EDGAR_LIVE_ENABLED=true explicitly.")
        return cls(environ.get("SEC_EDGAR_USER_AGENT", ""), timeout_seconds=float(environ.get("SEC_EDGAR_TIMEOUT_SECONDS", "10")), ticker_cache_ttl_seconds=float(environ.get("SEC_EDGAR_TICKER_CACHE_TTL_SECONDS", "3600")), ticker_cache_max_entries=int(environ.get("SEC_EDGAR_TICKER_CACHE_MAX_ENTRIES", "1000")), **kwargs)
    def _record(self, endpoint: str, outcome: str, start: float, cache_hit: bool = False, error: SecEdgarError | None = None) -> None:
        if self._telemetry: self._telemetry.record(SecRetrievalTelemetry(endpoint, outcome, cache_hit, max(0, int((self._clock() - start) * 1000)), error.classification if error else None))
    def _get(self, endpoint: str, url: str) -> object:
        start = self._clock(); self._limiter.acquire()
        try: payload = self._http.get_json(url, self._headers, self._timeout)
        except (SocketTimeout, TimeoutError) as cause:
            error = SecEdgarTimeoutError("SEC EDGAR request timed out.")
            self._record(endpoint, "FAILED", start, error=error)
            raise error from cause
        except URLError as cause:
            error = SecEdgarTransientError("SEC EDGAR could not be reached.")
            self._record(endpoint, "FAILED", start, error=error)
            raise error from cause
        except SecEdgarError as error: self._record(endpoint, "FAILED", start, error=error); raise
        self._record(endpoint, "SUCCEEDED", start); return payload
    def resolve_ticker(self, ticker: str) -> SecCompany:
        symbol, now = ticker.strip().upper(), self._clock(); cached = self._cache.get(ticker.strip().upper())
        if cached and cached[1] > now: self._cache.move_to_end(symbol); self._record("company_tickers", "SUCCEEDED", now, True); return cached[0]
        if cached: del self._cache[symbol]
        payload = self._get("company_tickers", f"{SEC_DATA_URL}/files/company_tickers.json")
        if not isinstance(payload, dict): raise SecEdgarError("SEC ticker response was not an object.")
        for row in payload.values():
            if not isinstance(row, dict) or str(row.get("ticker", "")).upper() != symbol: continue
            cik, name = str(row.get("cik_str", "")).zfill(10), str(row.get("title", "")).strip()
            if not cik.isdigit() or not name: raise SecEdgarError("SEC ticker response omitted a valid CIK or company name.")
            company = SecCompany(symbol, cik, name, None, f"{SEC_DATA_URL}/files/company_tickers.json", datetime.now(UTC))
            self._cache[symbol] = (company, self._clock() + self._ttl); self._cache.move_to_end(symbol)
            while len(self._cache) > self._max: self._cache.popitem(last=False)
            return company
        raise SecEdgarError(f"Ticker {symbol} was not found in SEC EDGAR.")
    def retrieve_filings(self, company: SecCompany) -> list[SecFiling]:
        source_url = f"{SEC_DATA_URL}/submissions/CIK{company.cik}.json"; payload = self._get("submissions", source_url)
        if not isinstance(payload, dict) or not isinstance(payload.get("filings"), dict): raise SecEdgarError("SEC submissions response was malformed.")
        recent = payload["filings"].get("recent")
        if not isinstance(recent, dict): raise SecEdgarError("SEC submissions response omitted recent filings.")
        forms, accessions, dates, documents = recent.get("form", []), recent.get("accessionNumber", []), recent.get("filingDate", []), recent.get("primaryDocument", [])
        if not all(isinstance(values, list) for values in (forms, accessions, dates, documents)): raise SecEdgarError("SEC filing arrays were malformed.")
        if len({len(forms), len(accessions), len(dates), len(documents)}) != 1: raise SecEdgarError("SEC filing arrays had inconsistent lengths.")
        return [SecFiling(accession, form, str(filing_date), document, f"{SEC_ARCHIVES_URL}/{int(company.cik)}/{accession.replace('-', '')}/{document}", source_url) for form, accession, filing_date, document in zip(forms, accessions, dates, documents, strict=True) if form in {"10-K", "10-Q", "8-K"} and isinstance(accession, str) and isinstance(document, str)]
