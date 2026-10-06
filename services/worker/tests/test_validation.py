from datetime import UTC, datetime, timedelta

from forgeflow_worker.validation import publication_is_safe, validate_workflow_inputs


NOW = datetime(2026, 10, 6, tzinfo=UTC)


def fact(identifier: str, name: str, value: object, unit: str = "USD", **updates):
    value = {"id": identifier, "source_id": "source-1", "field_name": name, "raw_value": {"unit": unit, "val": value}, "normalization_status": "NORMALIZED", "observed_at": "2025-06-30"}
    return value | updates


def test_flags_stale_sources_invalid_units_missing_provenance_and_periods() -> None:
    findings = validate_workflow_inputs(
        [{"id": "source-1", "retrieved_at": NOW - timedelta(days=401)}],
        [fact("revenue", "revenue", 100, "EUR", source_id=None, observed_at=None)],
        now=NOW,
    )
    assert {finding.code for finding in findings} >= {"STALE_SOURCE", "UNSUPPORTED_UNIT", "MISSING_PROVENANCE", "MISSING_FILING_PERIOD", "MISSING_REQUIRED_FINANCIAL_INPUT"}
    assert not publication_is_safe(findings)


def test_preserves_conflicts_and_allows_a_clearly_labeled_partial_report() -> None:
    findings = validate_workflow_inputs(
        [{"id": "source-1", "retrieved_at": NOW}],
        [fact("revenue-a", "revenue", 100), fact("revenue-b", "revenue", 120), fact("income", "operating_income", 25)],
        now=NOW,
    )
    conflict = next(finding for finding in findings if finding.code == "CONTRADICTORY_FACT_VALUES")
    assert conflict.data_status == "AMBIGUOUS"
    assert set(conflict.details["fact_ids"]) == {"revenue-a", "revenue-b"}
    assert publication_is_safe(findings)
