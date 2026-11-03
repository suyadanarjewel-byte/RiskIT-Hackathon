"""Deterministic financial calculations. Claude never produces any of these numbers.

Every result records its basis:
  FACTS             - only document facts (as approved by a human)
  FACTS+ASSUMPTION  - also uses a scenario assumption (e.g. an FX rate)
Any UNKNOWN input makes the result UNKNOWN (None); nothing is defaulted.
"""
from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

HUNDRED = Decimal(100)


def _d(v) -> Decimal | None:
    return None if v is None else Decimal(str(v))


def _q(v: Decimal | None, places: str = "0.01") -> str | None:
    return None if v is None else str(v.quantize(Decimal(places), rounding=ROUND_HALF_UP))


def _all(*xs) -> bool:
    return all(x is not None for x in xs)


def compute(facts: dict[str, str | None], scenario: dict) -> dict:
    sale = _d(facts.get("sale_amount"))
    sale_ccy = facts.get("sale_currency")
    home_ccy = facts.get("home_currency")
    pf, pp, fxf = (_d(facts.get(k)) for k in
                   ("platform_fee_percent", "payment_fee_percent", "fx_conversion_fee_percent"))
    r: dict[str, dict] = {}
    notes: list[str] = []

    def put(name, value, basis, formula, places="0.01"):
        r[name] = {"value": _q(value, places), "basis": basis, "formula": formula}

    # --- FX rate: document facts never contain it here; it is a scenario assumption.
    rate = None
    fx = scenario.get("fx_rate") or {}
    if sale_ccy and home_ccy and sale_ccy == home_ccy:
        rate = Decimal(1)
    elif fx.get("base") == sale_ccy and fx.get("quote") == home_ccy and fx.get("rate") is not None:
        rate = Decimal(str(fx["rate"]))
    else:
        notes.append(f"No scenario FX rate for {sale_ccy}->{home_ccy}; home-currency results are UNKNOWN.")

    total_fee_pct = pf + pp + fxf if _all(pf, pp, fxf) else None
    put("total_fee_percent", total_fee_pct, "FACTS",
        "platform_fee_percent + payment_fee_percent + fx_conversion_fee_percent")

    fees = sale * total_fee_pct / HUNDRED if _all(sale, total_fee_pct) else None
    put("total_fees_sale_ccy", fees, "FACTS", "sale_amount * total_fee_percent / 100")

    net_sale = sale - fees if _all(sale, fees) else None
    put("net_receipt_sale_ccy", net_sale, "FACTS", "sale_amount - total_fees_sale_ccy")

    gross_home = sale * rate if _all(sale, rate) else None
    put("gross_revenue_home", gross_home, "FACTS+ASSUMPTION", "sale_amount * fx_rate")

    net_home = net_sale * rate if _all(net_sale, rate) else None
    put("net_receipt_home", net_home, "FACTS+ASSUMPTION", "net_receipt_sale_ccy * fx_rate")

    def cost_in_home(amount_key, ccy_key):
        amt, ccy = _d(facts.get(amount_key)), facts.get(ccy_key)
        if amt is None or ccy is None or home_ccy is None:
            return None
        if ccy != home_ccy:
            notes.append(f"{amount_key} is in {ccy}, not {home_ccy}; no rate given, so it is UNKNOWN in home currency.")
            return None
        return amt

    product = cost_in_home("product_cost_amount", "product_cost_currency")
    shipping = cost_in_home("shipping_cost_amount", "shipping_cost_currency")
    costs = product + shipping if _all(product, shipping) else None
    put("total_costs_home", costs, "FACTS", "product_cost_amount + shipping_cost_amount")

    margin = net_home - costs if _all(net_home, costs) else None
    put("margin_home", margin, "FACTS+ASSUMPTION", "net_receipt_home - total_costs_home")

    margin_pct = margin / gross_home * HUNDRED if _all(margin, gross_home) and gross_home != 0 else None
    put("margin_percent", margin_pct, "FACTS+ASSUMPTION", "margin_home / gross_revenue_home * 100")

    ship_pct = shipping / gross_home * HUNDRED if _all(shipping, gross_home) and gross_home != 0 else None
    put("shipping_percent_of_revenue", ship_pct, "FACTS+ASSUMPTION",
        "shipping_cost_amount / gross_revenue_home * 100")

    # FX move (in % of the assumed rate) at which margin reaches zero.
    breakeven = (costs / net_home - 1) * HUNDRED if _all(costs, net_home) and net_home != 0 else None
    put("breakeven_fx_move_percent", breakeven, "FACTS+ASSUMPTION",
        "(total_costs_home / net_receipt_home - 1) * 100")

    scenarios = []
    for s in scenario.get("fx_shocks_percent", []):
        shock = Decimal(str(s))
        m = net_sale * rate * (1 + shock / HUNDRED) - costs if _all(net_sale, rate, costs) else None
        scenarios.append({"fx_shock_percent": str(shock), "margin_home": _q(m), "basis": "FACTS+ASSUMPTION"})

    return {"results": r, "fx_scenarios": scenarios, "fx_rate_used": _q(rate, "0.0001"),
            "notes": notes}
