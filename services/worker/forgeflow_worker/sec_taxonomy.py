"""Versioned, deterministic mapping from raw SEC concepts to product facts."""
from __future__ import annotations

from dataclasses import dataclass

from .sec_facts import ExtractedSecFact

MAPPING_VERSION = "2026-10-05.1"
CANONICAL_CONCEPTS: dict[str, tuple[str, ...]] = {
    "revenue": ("us-gaap:Revenues", "us-gaap:SalesRevenueNet"),
    "operating_income": ("us-gaap:OperatingIncomeLoss",),
    "net_income": ("us-gaap:NetIncomeLoss",),
    "assets": ("us-gaap:Assets",),
    "operating_cash_flow": ("us-gaap:NetCashProvidedByUsedInOperatingActivities",),
    "share_count": ("us-gaap:EntityCommonStockSharesOutstanding",),
}

@dataclass(frozen=True)
class CanonicalFact:
    name: str
    sec_concept: str
    unit: str | None
    period_end: str | None
    raw_value: dict[str, object]
    mapping_version: str
    status: str

def map_sec_facts(facts: list[ExtractedSecFact]) -> list[CanonicalFact]:
    """Map every raw observation; deliberately never choose a silent winner."""
    mapped: list[CanonicalFact] = []
    for name, concepts in CANONICAL_CONCEPTS.items():
        matches = [fact for fact in facts if fact.field_name in concepts]
        if not matches:
            mapped.append(CanonicalFact(name, concepts[0], None, None, {"reason": "UNAVAILABLE_FROM_SEC_COMPANY_FACTS"}, MAPPING_VERSION, "UNAVAILABLE"))
            continue
        for fact in matches:
            unit = fact.raw_value.get("unit")
            mapped.append(CanonicalFact(name, fact.field_name, unit if isinstance(unit, str) else None, fact.observed_at, fact.raw_value, MAPPING_VERSION, fact.normalization_status))
    return mapped
