"""Deterministic, provenance-first validation for company-analysis inputs."""
from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from typing import Any, Iterable


REQUIRED_FINANCIAL_FIELDS = ("revenue", "operating_income")
EXPECTED_UNITS = {
    "revenue": "USD",
    "operating_income": "USD",
    "net_income": "USD",
    "assets": "USD",
    "operating_cash_flow": "USD",
    "share_count": "shares",
}


@dataclass(frozen=True)
class ValidationFinding:
    code: str
    severity: str
    data_status: str
    subject_type: str
    subject_id: str | None
    message: str
    details: dict[str, Any]

    @property
    def finding_key(self) -> str:
        material = {
            "code": self.code,
            "subject_type": self.subject_type,
            "subject_id": self.subject_id,
            "details": self.details,
        }
        encoded = repr(sorted(material.items())).encode("utf-8")
        return sha256(encoded).hexdigest()

    def persistence_value(self) -> dict[str, Any]:
        return {"finding_key": self.finding_key, **asdict(self)}


def _value_and_unit(fact: dict[str, Any]) -> tuple[Any, str | None]:
    raw = fact.get("raw_value") or {}
    candidate = raw.get("raw") if isinstance(raw, dict) else None
    payload = candidate if isinstance(candidate, dict) else raw
    if not isinstance(payload, dict):
        return None, None
    unit = payload.get("unit")
    return payload.get("val"), unit if isinstance(unit, str) else None


def _as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def validate_workflow_inputs(
    sources: Iterable[dict[str, Any]],
    facts: Iterable[dict[str, Any]],
    *,
    now: datetime | None = None,
    max_source_age_days: int = 400,
) -> list[ValidationFinding]:
    """Return every deterministic finding; never choose or discard conflicting facts."""
    reference_time = _as_utc(now or datetime.now(UTC))
    findings: list[ValidationFinding] = []
    source_rows = list(sources)
    fact_rows = list(facts)

    for source in source_rows:
        retrieved_at = source.get("retrieved_at")
        if not isinstance(retrieved_at, datetime):
            findings.append(ValidationFinding("MISSING_SOURCE_RETRIEVAL_TIME", "ERROR", "INVALID", "SOURCE", str(source.get("id")), "A source has no retrieval timestamp.", {}))
        elif _as_utc(retrieved_at) < reference_time - timedelta(days=max_source_age_days):
            findings.append(ValidationFinding("STALE_SOURCE", "WARNING", "AMBIGUOUS", "SOURCE", str(source.get("id")), "A source is older than the configured freshness window.", {"retrieved_at": _as_utc(retrieved_at).isoformat(), "max_age_days": max_source_age_days}))

    canonical_facts: dict[tuple[str, Any, str | None], list[dict[str, Any]]] = {}
    present_fields: set[str] = set()
    for fact in fact_rows:
        field_name = str(fact.get("field_name"))
        fact_id = str(fact.get("id"))
        status = fact.get("normalization_status")
        if not fact.get("source_id"):
            findings.append(ValidationFinding("MISSING_PROVENANCE", "ERROR", "INVALID", "FACT", fact_id, "A fact cannot be published without a source reference.", {"field_name": field_name}))
        if field_name not in EXPECTED_UNITS:
            continue
        if status == "UNAVAILABLE":
            continue
        present_fields.add(field_name)
        value, unit = _value_and_unit(fact)
        expected_unit = EXPECTED_UNITS[field_name]
        if unit != expected_unit:
            findings.append(ValidationFinding("UNSUPPORTED_UNIT", "ERROR", "INVALID", "FACT", fact_id, "A canonical fact uses an unsupported unit.", {"field_name": field_name, "expected_unit": expected_unit, "actual_unit": unit}))
        observed_at = fact.get("observed_at")
        if observed_at is None:
            findings.append(ValidationFinding("MISSING_FILING_PERIOD", "ERROR", "INVALID", "FACT", fact_id, "A canonical fact has no filing period.", {"field_name": field_name}))
        canonical_facts.setdefault((field_name, observed_at, unit), []).append({**fact, "value": value})

    for field_name in REQUIRED_FINANCIAL_FIELDS:
        if field_name not in present_fields:
            findings.append(ValidationFinding("MISSING_REQUIRED_FINANCIAL_INPUT", "WARNING", "UNAVAILABLE", "WORKFLOW", None, "A required financial input is unavailable; dependent outputs must remain unavailable.", {"field_name": field_name}))

    for (field_name, observed_at, unit), grouped in canonical_facts.items():
        values = {repr(item["value"]) for item in grouped if item["value"] is not None}
        if len(values) > 1:
            findings.append(ValidationFinding("CONTRADICTORY_FACT_VALUES", "WARNING", "AMBIGUOUS", "FACT_GROUP", None, "Competing source observations remain visible and no value was selected.", {"field_name": field_name, "observed_at": str(observed_at), "unit": unit, "fact_ids": [str(item.get("id")) for item in grouped], "values": sorted(values)}))

    return findings


def publication_is_safe(findings: Iterable[ValidationFinding]) -> bool:
    """Authoritative publication is blocked only by an unsupported/invalid input."""
    return not any(finding.severity == "ERROR" for finding in findings)
