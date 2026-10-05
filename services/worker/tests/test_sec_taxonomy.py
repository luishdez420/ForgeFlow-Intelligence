from forgeflow_worker.sec_facts import ExtractedSecFact
from forgeflow_worker.sec_taxonomy import MAPPING_VERSION, map_sec_facts


def fact(concept: str, value: object, unit: str = "USD", end: str = "2025-06-30") -> ExtractedSecFact:
    return ExtractedSecFact(concept, {"unit": unit, "val": value}, end, "NORMALIZED")


def test_maps_golden_revenue_concepts_with_version_and_period() -> None:
    mapped = map_sec_facts([fact("us-gaap:Revenues", 100), fact("us-gaap:SalesRevenueNet", 101)])
    revenue = [item for item in mapped if item.name == "revenue"]
    assert [item.sec_concept for item in revenue] == ["us-gaap:Revenues", "us-gaap:SalesRevenueNet"]
    assert [item.raw_value["val"] for item in revenue] == [100, 101]
    assert all(item.mapping_version == MAPPING_VERSION and item.period_end == "2025-06-30" for item in revenue)


def test_preserves_competing_values_and_marks_absent_concepts_unavailable() -> None:
    mapped = map_sec_facts([fact("us-gaap:Revenues", 100), fact("us-gaap:Revenues", 120, end="2025-09-30")])
    revenue = [item for item in mapped if item.name == "revenue"]
    net_income = next(item for item in mapped if item.name == "net_income")
    assert [(item.raw_value["val"], item.period_end) for item in revenue] == [(100, "2025-06-30"), (120, "2025-09-30")]
    assert net_income.status == "UNAVAILABLE"


def test_preserves_share_count_units_without_conversion() -> None:
    mapped = map_sec_facts([fact("us-gaap:EntityCommonStockSharesOutstanding", 7, "shares")])
    share_count = next(item for item in mapped if item.name == "share_count")
    assert share_count.unit == "shares"
