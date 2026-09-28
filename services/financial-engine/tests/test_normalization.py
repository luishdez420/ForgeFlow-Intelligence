from __future__ import annotations

import json
from pathlib import Path

import pytest

from forgeflow_financial_engine.normalization import normalize_company, normalize_financial_records

FIXTURES = Path(__file__).parent / "fixtures"


def fixture(name: str) -> dict[str, object]:
    return json.loads((FIXTURES / name).read_text())


def test_normalizes_company_and_financial_values_without_losing_raw_payload() -> None:
    record = fixture("normal_financials.json")
    company = normalize_company(record["company"])
    facts = normalize_financial_records(record)
    assert (company.ticker, company.cik) == ("MSFT", "0000789019")
    assert facts[0].raw_value == {"value": "245122", "unit": "usd", "period_end": "2025-06-30"}
    assert facts[0].normalized_value == {"value": 245122.0, "unit": "USD", "period_end": "2025-06-30"}
    assert [fact.normalization_status for fact in facts] == ["NORMALIZED", "NORMALIZED", "NORMALIZED"]


def test_marks_missing_and_malformed_values_explicitly() -> None:
    facts = normalize_financial_records(fixture("missing_malformed_financials.json"))
    assert [(fact.field_name, fact.normalization_status) for fact in facts] == [
        ("revenue", "UNAVAILABLE"),
        ("net_income", "REJECTED"),
        ("total_assets", "UNAVAILABLE"),
    ]


def test_keeps_conflicting_source_records_independent() -> None:
    first = normalize_financial_records(fixture("normal_financials.json"))[0]
    conflicting = normalize_financial_records(fixture("conflicting_financials.json"))[0]
    assert first.normalized_value != conflicting.normalized_value
    assert first.normalization_status == conflicting.normalization_status == "NORMALIZED"


def test_rejects_company_without_ticker() -> None:
    with pytest.raises(ValueError, match="ticker"):
        normalize_company({"name": "Unknown"})
