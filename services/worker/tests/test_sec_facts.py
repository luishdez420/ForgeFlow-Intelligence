from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import pytest

from forgeflow_worker.sec_edgar import SecCompany, SecCompanyFacts, SecEdgarError
from forgeflow_worker.sec_facts import extract_initial_facts

FIXTURES = Path(__file__).parent / "fixtures"


def company_facts(payload: object) -> SecCompanyFacts:
    return SecCompanyFacts(
        SecCompany("MSFT", "0000789019", "MICROSOFT CORP", None, "https://www.sec.gov/files/company_tickers.json", datetime.now(UTC)),
        payload,
        "https://data.sec.gov/api/xbrl/companyfacts/CIK0000789019.json",
        datetime.now(UTC),
    )


def test_extracts_raw_xbrl_observations_and_marks_unsupported_concepts_unavailable() -> None:
    facts = extract_initial_facts(company_facts(json.loads((FIXTURES / "companyfacts_msft.json").read_text())))
    revenue = next(fact for fact in facts if fact.field_name == "us-gaap:Revenues")
    missing = next(fact for fact in facts if fact.field_name == "us-gaap:NetIncomeLoss")

    assert revenue.normalization_status == "NORMALIZED"
    assert revenue.observed_at == "2025-06-30"
    assert revenue.raw_value["unit"] == "USD"
    assert revenue.raw_value["accn"] == "0000950170-25-089830"
    assert missing.normalization_status == "UNAVAILABLE"
    assert missing.raw_value == {"reason": "UNAVAILABLE_FROM_SEC_COMPANY_FACTS"}


def test_preserves_duplicate_and_amended_observations() -> None:
    payload = json.loads((FIXTURES / "companyfacts_msft_amended.json").read_text())

    revenue = [fact for fact in extract_initial_facts(company_facts(payload)) if fact.field_name == "us-gaap:Revenues"]
    assert [fact.raw_value["val"] for fact in revenue] == [245000, 245100]
    assert [fact.raw_value["accn"] for fact in revenue] == ["0000950170-25-089830", "0000950170-25-099999"]


def test_rejects_missing_or_malformed_taxonomy() -> None:
    with pytest.raises(SecEdgarError, match="us-gaap"):
        extract_initial_facts(company_facts({"facts": {}}))
    malformed = json.loads((FIXTURES / "companyfacts_malformed.json").read_text())
    with pytest.raises(SecEdgarError, match="malformed"):
        extract_initial_facts(company_facts(malformed))
