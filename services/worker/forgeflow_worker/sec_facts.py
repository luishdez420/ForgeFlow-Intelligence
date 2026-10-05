"""Conservative extraction of raw SEC company-facts/XBRL observations.

Canonical financial-taxonomy selection is intentionally deferred to Issue #30.
This module preserves individual source observations and represents absent concepts
explicitly instead of selecting substitutes or inventing values.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from .sec_edgar import SecCompanyFacts, SecEdgarError

INITIAL_US_GAAP_CONCEPTS = (
    "Revenues",
    "SalesRevenueNet",
    "OperatingIncomeLoss",
    "NetIncomeLoss",
    "Assets",
    "CashAndCashEquivalentsAtCarryingValue",
    "NetCashProvidedByUsedInOperatingActivities",
    "EntityCommonStockSharesOutstanding",
)


@dataclass(frozen=True)
class ExtractedSecFact:
    field_name: str
    raw_value: dict[str, object]
    observed_at: str | None
    normalization_status: Literal["NORMALIZED", "UNAVAILABLE"]


def extract_initial_facts(company_facts: SecCompanyFacts) -> list[ExtractedSecFact]:
    """Return raw, filing-contextual XBRL facts without resolving conflicts."""
    payload = company_facts.content
    if not isinstance(payload, dict):
        raise SecEdgarError("SEC company facts response was malformed.")
    all_facts = payload.get("facts")
    if not isinstance(all_facts, dict):
        raise SecEdgarError("SEC company facts response was malformed.")
    taxonomy = all_facts.get("us-gaap")
    if not isinstance(taxonomy, dict):
        raise SecEdgarError("SEC company facts response omitted the us-gaap taxonomy.")

    extracted: list[ExtractedSecFact] = []
    for concept in INITIAL_US_GAAP_CONCEPTS:
        definition = taxonomy.get(concept)
        units = definition.get("units") if isinstance(definition, dict) else None
        usable = False
        if isinstance(units, dict):
            for unit, observations in units.items():
                if not isinstance(unit, str) or not isinstance(observations, list):
                    continue
                for observation in observations:
                    if not isinstance(observation, dict):
                        continue
                    form = observation.get("form")
                    if not isinstance(form, str) or form.removesuffix("/A") not in {"10-K", "10-Q", "8-K"}:
                        continue
                    if not isinstance(observation.get("val"), (int, float, str)):
                        continue
                    end = observation.get("end")
                    if not isinstance(end, str):
                        continue
                    usable = True
                    extracted.append(
                        ExtractedSecFact(
                            field_name=f"us-gaap:{concept}",
                            raw_value={"unit": unit, **observation},
                            observed_at=end,
                            normalization_status="NORMALIZED",
                        )
                    )
        if not usable:
            extracted.append(
                ExtractedSecFact(
                    field_name=f"us-gaap:{concept}",
                    raw_value={"reason": "UNAVAILABLE_FROM_SEC_COMPANY_FACTS"},
                    observed_at=None,
                    normalization_status="UNAVAILABLE",
                )
            )
    return extracted
