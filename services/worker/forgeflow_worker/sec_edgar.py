"""Official SEC EDGAR access with an injectable HTTP boundary for fixture tests."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Protocol
from urllib.error import HTTPError
from urllib.request import Request, urlopen

SEC_DATA_URL = "https://data.sec.gov"
SEC_ARCHIVES_URL = "https://www.sec.gov/Archives/edgar/data"


class SecEdgarError(RuntimeError):
    pass


class SecEdgarRateLimitError(SecEdgarError):
    pass


class HttpClient(Protocol):
    def get_json(self, url: str, headers: dict[str, str], timeout_seconds: float) -> object: ...


@dataclass(frozen=True)
class SecCompany:
    ticker: str
    cik: str
    name: str
    exchange: str | None
    source_url: str
    retrieved_at: datetime


@dataclass(frozen=True)
class SecFiling:
    accession_number: str
    form: str
    filing_date: str
    primary_document: str
    document_url: str
    source_url: str


class UrlLibHttpClient:
    def get_json(self, url: str, headers: dict[str, str], timeout_seconds: float) -> object:
        request = Request(url, headers=headers)
        try:
            with urlopen(request, timeout=timeout_seconds) as response:  # noqa: S310
                return json.loads(response.read())
        except HTTPError as error:
            if error.code == 429:
                raise SecEdgarRateLimitError("SEC EDGAR rate limited the request.") from error
            raise SecEdgarError(f"SEC EDGAR returned HTTP {error.code}.") from error


class SecEdgarProvider:
    def __init__(
        self,
        user_agent: str,
        *,
        http_client: HttpClient | None = None,
        timeout_seconds: float = 10,
    ) -> None:
        if "@" not in user_agent or len(user_agent.strip()) < 8:
            raise ValueError("SEC EDGAR requires a contactable User-Agent containing an email address.")
        if timeout_seconds <= 0:
            raise ValueError("timeout_seconds must be positive")
        self._headers = {"User-Agent": user_agent.strip(), "Accept-Encoding": "gzip, deflate"}
        self._http = http_client or UrlLibHttpClient()
        self._timeout_seconds = timeout_seconds
        self._ticker_cache: dict[str, SecCompany] = {}

    def resolve_ticker(self, ticker: str) -> SecCompany:
        normalized_ticker = ticker.strip().upper()
        if normalized_ticker in self._ticker_cache:
            return self._ticker_cache[normalized_ticker]
        payload = self._http.get_json(
            f"{SEC_DATA_URL}/files/company_tickers.json", self._headers, self._timeout_seconds
        )
        if not isinstance(payload, dict):
            raise SecEdgarError("SEC ticker response was not an object.")
        for row in payload.values():
            if not isinstance(row, dict) or str(row.get("ticker", "")).upper() != normalized_ticker:
                continue
            cik = str(row.get("cik_str", "")).zfill(10)
            name = str(row.get("title", "")).strip()
            if not cik.isdigit() or not name:
                raise SecEdgarError("SEC ticker response omitted a valid CIK or company name.")
            company = SecCompany(
                ticker=normalized_ticker,
                cik=cik,
                name=name,
                exchange=None,
                source_url=f"{SEC_DATA_URL}/files/company_tickers.json",
                retrieved_at=datetime.now(UTC),
            )
            self._ticker_cache[normalized_ticker] = company
            return company
        raise SecEdgarError(f"Ticker {normalized_ticker} was not found in SEC EDGAR.")

    def retrieve_filings(self, company: SecCompany) -> list[SecFiling]:
        source_url = f"{SEC_DATA_URL}/submissions/CIK{company.cik}.json"
        payload = self._http.get_json(source_url, self._headers, self._timeout_seconds)
        if not isinstance(payload, dict) or not isinstance(payload.get("filings"), dict):
            raise SecEdgarError("SEC submissions response was malformed.")
        recent = payload["filings"].get("recent")
        if not isinstance(recent, dict):
            raise SecEdgarError("SEC submissions response omitted recent filings.")
        forms = recent.get("form", [])
        accessions = recent.get("accessionNumber", [])
        dates = recent.get("filingDate", [])
        documents = recent.get("primaryDocument", [])
        if not all(isinstance(values, list) for values in (forms, accessions, dates, documents)):
            raise SecEdgarError("SEC filing arrays were malformed.")
        if len({len(forms), len(accessions), len(dates), len(documents)}) != 1:
            raise SecEdgarError("SEC filing arrays had inconsistent lengths.")
        filings: list[SecFiling] = []
        for form, accession, filing_date, document in zip(forms, accessions, dates, documents, strict=True):
            if form not in {"10-K", "10-Q", "8-K"} or not isinstance(accession, str) or not isinstance(document, str):
                continue
            accession_digits = accession.replace("-", "")
            filings.append(SecFiling(
                accession_number=accession,
                form=form,
                filing_date=str(filing_date),
                primary_document=document,
                document_url=f"{SEC_ARCHIVES_URL}/{int(company.cik)}/{accession_digits}/{document}",
                source_url=source_url,
            ))
        return filings
