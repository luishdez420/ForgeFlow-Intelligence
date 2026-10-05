"""Opt-in, minimal live SEC EDGAR smoke check; never persists response content."""

from __future__ import annotations

import json
from argparse import ArgumentParser
from typing import Protocol

from .sec_edgar import SecCompany, SecEdgarProvider, SecFiling


class SecProvider(Protocol):
    def resolve_ticker(self, ticker: str) -> SecCompany: ...

    def retrieve_filings(self, company: SecCompany) -> list[SecFiling]: ...


def smoke_summary(provider: SecProvider, ticker: str) -> dict[str, object]:
    company = provider.resolve_ticker(ticker)
    filings = provider.retrieve_filings(company)
    return {
        "ticker": company.ticker,
        "cik": company.cik,
        "companyName": company.name,
        "supportedFilingCount": len(filings),
        "forms": [filing.form for filing in filings[:3]],
    }


def main() -> None:
    parser = ArgumentParser(description="Perform a minimal opt-in live SEC EDGAR check.")
    parser.add_argument("--ticker", default="MSFT")
    arguments = parser.parse_args()
    print(json.dumps(smoke_summary(SecEdgarProvider.from_environment(), arguments.ticker), sort_keys=True))


if __name__ == "__main__":
    main()
