"""Deterministic risk rules for the four in-scope risk types only:
FX, payment collection, platform/payment fees, logistics.

Thresholds are prototype policy values, not advice. Explanations and
recommendations are fixed templates filled with computed numbers; every flag
still needs human approval before release.
"""
from __future__ import annotations

from decimal import Decimal

LEVELS = ["LOW", "MEDIUM", "HIGH"]

THRESHOLDS = {
    "fx_breakeven_high": Decimal(5),     # margin wiped out by an FX move smaller than 5%
    "fx_breakeven_medium": Decimal(10),
    "fx_long_exposure_days": 30,
    "terms_high_days": 30,               # >30 days credit -> HIGH
    "fee_high_pct": Decimal(15),
    "fee_medium_pct": Decimal(8),
    "ship_high_pct": Decimal(20),
    "ship_medium_pct": Decimal(10),
}

RECOMMENDATIONS = {
    ("fx", "HIGH"): "Consider pricing in your home currency or fixing the rate before accepting similar orders.",
    ("fx", "MEDIUM"): "Monitor the exchange rate until payment arrives; consider shorter terms for foreign-currency orders.",
    ("payment_collection", "HIGH"): "Consider requesting a deposit or shorter terms before shipping.",
    ("payment_collection", "MEDIUM"): "Track the due date and send a reminder before payment is due.",
    ("fees", "HIGH"): "Compare platform and payment options; fees take a large share of this order.",
    ("fees", "MEDIUM"): "Check whether a cheaper payout or conversion option is available.",
    ("logistics", "HIGH"): "Consider insuring the shipment and confirming a transit time with the carrier.",
    ("logistics", "MEDIUM"): "Confirm transit time and consider including shipping costs in the price.",
}


def _bump(level: str) -> str:
    return LEVELS[min(LEVELS.index(level) + 1, len(LEVELS) - 1)] if level in LEVELS else level


def _flag(category, level, explanation, drivers):
    return {"category": category, "level": level, "explanation": explanation, "drivers": drivers,
            "recommendation": RECOMMENDATIONS.get((category, level), "No action suggested.")}


def _dec(v):
    return None if v is None else Decimal(v)


def assess(facts: dict, calc: dict) -> list[dict]:
    res = {k: v["value"] for k, v in calc["results"].items()}
    terms = facts.get("payment_terms_days")
    terms_i = None if terms is None else int(terms)
    flags = []

    # FX
    sale_ccy, home_ccy = facts.get("sale_currency"), facts.get("home_currency")
    be = _dec(res.get("breakeven_fx_move_percent"))
    if sale_ccy is None or home_ccy is None:
        flags.append(_flag("fx", "UNKNOWN", "Sale or home currency is UNKNOWN.", ["sale_currency", "home_currency"]))
    elif sale_ccy == home_ccy:
        flags.append(_flag("fx", "LOW", f"Sale and costs are both in {home_ccy}; no currency mismatch.", ["sale_currency"]))
    elif be is None:
        flags.append(_flag("fx", "UNKNOWN", f"Sale is in {sale_ccy} but breakeven FX move cannot be computed (missing inputs).",
                           ["breakeven_fx_move_percent"]))
    else:
        cushion = abs(be) if be < 0 else Decimal(0)
        level = ("HIGH" if cushion < THRESHOLDS["fx_breakeven_high"]
                 else "MEDIUM" if cushion < THRESHOLDS["fx_breakeven_medium"] else "LOW")
        text = (f"Paid in {sale_ccy}, costs in {home_ccy}. Margin reaches zero if {sale_ccy} falls "
                f"{cushion}% against the assumed rate.")
        if terms_i is not None and terms_i > THRESHOLDS["fx_long_exposure_days"] and level == "LOW":
            level = "MEDIUM"
            text += f" Exposure lasts {terms_i} days until payment, so raised to MEDIUM."
        elif terms_i is None:
            text += " Exposure period is UNKNOWN (payment terms UNKNOWN)."
        flags.append(_flag("fx", level, text, ["breakeven_fx_move_percent", "payment_terms_days"]))

    # Payment collection
    method = facts.get("payment_method") or "UNKNOWN"
    if terms_i is None:
        flags.append(_flag("payment_collection", "UNKNOWN", f"Payment terms are UNKNOWN (method: {method}).",
                           ["payment_terms_days"]))
    else:
        level = "LOW" if terms_i == 0 else "HIGH" if terms_i > THRESHOLDS["terms_high_days"] else "MEDIUM"
        flags.append(_flag("payment_collection", level,
                           f"Buyer pays {terms_i} days after the agreed point (method: {method}); "
                           "goods ship before payment." if terms_i else f"Paid upfront (method: {method}).",
                           ["payment_terms_days", "payment_method"]))

    # Fees
    fee = _dec(res.get("total_fee_percent"))
    if fee is None:
        flags.append(_flag("fees", "UNKNOWN", "At least one fee rate is UNKNOWN.", ["total_fee_percent"]))
    else:
        level = ("HIGH" if fee > THRESHOLDS["fee_high_pct"] else "MEDIUM" if fee > THRESHOLDS["fee_medium_pct"] else "LOW")
        flags.append(_flag("fees", level,
                           f"Platform, payment and conversion fees total {fee}% of the order "
                           f"({res.get('total_fees_sale_ccy')} {sale_ccy}).", ["total_fee_percent"]))

    # Logistics
    ship = _dec(res.get("shipping_percent_of_revenue"))
    insured = facts.get("shipment_insured")
    days = facts.get("estimated_delivery_days")
    if ship is None:
        flags.append(_flag("logistics", "UNKNOWN", "Shipping cost share cannot be computed (missing inputs).",
                           ["shipping_percent_of_revenue"]))
    else:
        level = ("HIGH" if ship > THRESHOLDS["ship_high_pct"] else "MEDIUM" if ship > THRESHOLDS["ship_medium_pct"] else "LOW")
        text = f"Shipping is {ship}% of revenue."
        if insured == "no":
            level = _bump(level)
            text += " Shipment is not insured (level raised one step)."
        elif insured is None:
            text += " Insurance status is UNKNOWN."
        text += " Transit time is UNKNOWN." if days is None else f" Estimated transit {days} days."
        flags.append(_flag("logistics", level, text,
                           ["shipping_percent_of_revenue", "shipment_insured", "estimated_delivery_days"]))
    return flags
