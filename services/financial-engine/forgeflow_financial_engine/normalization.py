"""Deterministic, provider-agnostic normalization of company and financial input."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any, Mapping

FINANCIAL_FIELDS = ("revenue", "net_income", "total_assets")


@dataclass(frozen=True)
class NormalizedCompany:
    ticker: str
    name: str | None
    cik: str | None
    exchange: str | None


@dataclass(frozen=True)
class NormalizedFact:
    field_name: str
    raw_value: object
    normalized_value: dict[str, object] | None
    normalization_status: str
    observed_at: str | None


def normalize_company(record: Mapping[str, Any]) -> NormalizedCompany:
    ticker = str(record.get("ticker", "")).strip().upper()
    if not ticker or not ticker.replace("-", "").replace(".", "").isalnum():
        raise ValueError("Company record requires a valid ticker.")
    cik_raw = record.get("cik")
    cik = str(cik_raw).zfill(10) if cik_raw is not None and str(cik_raw).isdigit() else None
    return NormalizedCompany(
        ticker=ticker,
        name=_optional_text(record.get("name")),
        cik=cik,
        exchange=_optional_text(record.get("exchange")),
    )


def normalize_financial_records(record: Mapping[str, Any]) -> list[NormalizedFact]:
    financials = record.get("financials", {})
    if not isinstance(financials, Mapping):
        raise ValueError("Financial record must contain a financials object.")
    return [_normalize_field(field, financials.get(field)) for field in FINANCIAL_FIELDS]


def _normalize_field(field_name: str, raw_value: object) -> NormalizedFact:
    if raw_value is None:
        return NormalizedFact(field_name, None, None, "UNAVAILABLE", None)
    if not isinstance(raw_value, Mapping):
        return NormalizedFact(field_name, raw_value, None, "REJECTED", None)
    value = raw_value.get("value")
    period_end = raw_value.get("period_end")
    unit = raw_value.get("unit")
    try:
        numeric_value = float(value)
        parsed_period = date.fromisoformat(str(period_end)).isoformat()
    except (TypeError, ValueError):
        return NormalizedFact(field_name, dict(raw_value), None, "REJECTED", None)
    if not isinstance(unit, str) or not unit.strip():
        return NormalizedFact(field_name, dict(raw_value), None, "REJECTED", None)
    return NormalizedFact(
        field_name,
        dict(raw_value),
        {"value": numeric_value, "unit": unit.strip().upper(), "period_end": parsed_period},
        "NORMALIZED",
        parsed_period,
    )


def _optional_text(value: object) -> str | None:
    normalized = str(value).strip() if value is not None else ""
    return normalized or None
