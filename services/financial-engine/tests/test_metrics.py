from decimal import Decimal

from forgeflow_financial_engine.metrics import annualized_volatility, maximum_drawdown, operating_margin, total_return, year_over_year_revenue_growth


def test_financial_formulas_include_formula_and_source_provenance() -> None:
    growth = year_over_year_revenue_growth("120", "100", ["source-a"])
    margin = operating_margin("25", "100", ["source-a"])
    assert (growth.value, margin.value) == (Decimal("20.0"), Decimal("25.00"))
    assert growth.input_snapshot["source_ids"] == ["source-a"]
    assert growth.formula_version


def test_market_formulas_are_deterministic() -> None:
    prices = [100, 110, 90, 120]
    assert total_return(prices, ["market-source"]).value == Decimal("20.0")
    assert maximum_drawdown(prices, ["market-source"]).value == Decimal("-18.18181818181818181818181818")
    assert annualized_volatility(prices, ["market-source"]).value is not None


def test_invalid_or_insufficient_inputs_are_explicit() -> None:
    assert operating_margin("10", "0", []).status == "INVALID_INPUT"
    assert total_return([100], []).status == "INVALID_INPUT"
    assert annualized_volatility([100, 101], []).status == "INVALID_INPUT"
    assert maximum_drawdown([100, 0], []).status == "INVALID_INPUT"
