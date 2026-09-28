"""Pure, deterministic financial and market metrics with calculation provenance."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from math import sqrt
from typing import Mapping, Sequence

FORMULA_VERSION = "2026-09-28.1"


@dataclass(frozen=True)
class MetricResult:
    metric_name: str
    value: Decimal | None
    unit: str
    status: str
    formula_version: str
    input_snapshot: dict[str, object]
    calculated_at: datetime


def year_over_year_revenue_growth(current: object, prior: object, source_ids: Sequence[str]) -> MetricResult:
    return _ratio_metric("revenue_yoy_growth", current, prior, source_ids, "percent", lambda a, b: (a - b) / b * Decimal("100"))


def operating_margin(operating_income: object, revenue: object, source_ids: Sequence[str]) -> MetricResult:
    return _ratio_metric("operating_margin", operating_income, revenue, source_ids, "percent", lambda a, b: a / b * Decimal("100"))


def total_return(prices: Sequence[object], source_ids: Sequence[str]) -> MetricResult:
    values = _decimal_prices(prices)
    if len(values) < 2 or values[0] <= 0:
        return _unavailable("total_return", "percent", {"prices": list(prices), "source_ids": list(source_ids)})
    return _calculated("total_return", (values[-1] - values[0]) / values[0] * Decimal("100"), "percent", {"prices": [str(v) for v in values], "source_ids": list(source_ids)})


def annualized_volatility(prices: Sequence[object], source_ids: Sequence[str], trading_days: int = 252) -> MetricResult:
    values = _decimal_prices(prices)
    if len(values) < 3 or any(value <= 0 for value in values) or trading_days <= 0:
        return _unavailable("annualized_volatility", "percent", {"prices": list(prices), "source_ids": list(source_ids)})
    returns = [float((current - previous) / previous) for previous, current in zip(values, values[1:])]
    mean = sum(returns) / len(returns)
    variance = sum((value - mean) ** 2 for value in returns) / (len(returns) - 1)
    return _calculated("annualized_volatility", Decimal(str(sqrt(variance * trading_days) * 100)), "percent", {"prices": [str(v) for v in values], "source_ids": list(source_ids), "trading_days": trading_days})


def maximum_drawdown(prices: Sequence[object], source_ids: Sequence[str]) -> MetricResult:
    values = _decimal_prices(prices)
    if not values or any(value <= 0 for value in values):
        return _unavailable("maximum_drawdown", "percent", {"prices": list(prices), "source_ids": list(source_ids)})
    peak, drawdown = values[0], Decimal("0")
    for value in values:
        peak = max(peak, value)
        drawdown = min(drawdown, (value - peak) / peak * Decimal("100"))
    return _calculated("maximum_drawdown", drawdown, "percent", {"prices": [str(v) for v in values], "source_ids": list(source_ids)})


def _ratio_metric(name: str, numerator: object, denominator: object, source_ids: Sequence[str], unit: str, formula: object) -> MetricResult:
    try:
        first, second = Decimal(str(numerator)), Decimal(str(denominator))
        if second == 0:
            raise InvalidOperation
        value = formula(first, second)  # type: ignore[operator]
    except (InvalidOperation, ValueError):
        return _unavailable(name, unit, {"numerator": numerator, "denominator": denominator, "source_ids": list(source_ids)})
    return _calculated(name, value, unit, {"numerator": str(first), "denominator": str(second), "source_ids": list(source_ids)})


def _decimal_prices(prices: Sequence[object]) -> list[Decimal]:
    try:
        return [Decimal(str(price)) for price in prices]
    except InvalidOperation:
        return []


def _calculated(name: str, value: Decimal, unit: str, inputs: dict[str, object]) -> MetricResult:
    return MetricResult(name, value, unit, "CALCULATED", FORMULA_VERSION, inputs, datetime.now(UTC))


def _unavailable(name: str, unit: str, inputs: dict[str, object]) -> MetricResult:
    return MetricResult(name, None, unit, "INVALID_INPUT", FORMULA_VERSION, inputs, datetime.now(UTC))
