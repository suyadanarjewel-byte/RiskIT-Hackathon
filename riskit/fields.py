"""Field catalogue and deterministic value parsing.

Claude only proposes candidate values with verbatim quotes. Everything in this
module (parsing, status decisions, quote checks) is deterministic code.
"""
from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation

UNKNOWN = "UNKNOWN"
FOUND = "FOUND"
CONFLICT = "CONFLICT"

# name -> (kind, description shown to Claude)
FIELDS: dict[str, tuple[str, str]] = {
    "order_id": ("text", "Order or invoice reference"),
    "sale_amount": ("number", "Total amount the buyer pays for the order, in the sale currency"),
    "sale_currency": ("currency", "Currency the buyer pays in (ISO code)"),
    "home_currency": ("currency", "Seller's home / accounting currency (ISO code)"),
    "buyer_country": ("text", "Buyer's country"),
    "platform_name": ("text", "Marketplace or sales platform used"),
    "platform_fee_percent": ("percent", "Platform commission as a percent of the order total"),
    "payment_fee_percent": ("percent", "Payment processing fee as a percent of the order total"),
    "fx_conversion_fee_percent": ("percent", "Currency conversion fee as a percent of the order total"),
    "payment_method": ("text", "How the buyer pays"),
    "payment_terms_days": ("days", "Days until the buyer must pay (0 if paid upfront)"),
    "product_cost_amount": ("number", "Seller's cost of goods for this order"),
    "product_cost_currency": ("currency", "Currency of the product cost (ISO code)"),
    "shipping_cost_amount": ("number", "Shipping cost paid by the seller"),
    "shipping_cost_currency": ("currency", "Currency of the shipping cost (ISO code)"),
    "shipping_method": ("text", "Carrier / service used"),
    "estimated_delivery_days": ("days", "Estimated transit time in days"),
    "shipment_insured": ("bool", "Whether the shipment is insured (yes/no)"),
}

_NUM = re.compile(r"-?\d+(?:\.\d+)?")


def parse_value(kind: str, raw: str) -> str | None:
    """Normalise a candidate value. Returns None if it cannot be parsed."""
    s = (raw or "").strip()
    if not s:
        return None
    if kind in ("number", "percent"):
        m = _NUM.search(s.replace(",", ""))
        if not m:
            return None
        try:
            return str(Decimal(m.group()))
        except InvalidOperation:
            return None
    if kind == "days":
        m = _NUM.search(s.replace(",", ""))
        if not m or "." in m.group():
            return None
        return str(int(m.group()))
    if kind == "currency":
        s = s.upper()
        return s if re.fullmatch(r"[A-Z]{3}", s) else None
    if kind == "bool":
        low = s.lower()
        if low in ("yes", "true", "y"):
            return "yes"
        if low in ("no", "false", "n"):
            return "no"
        return None
    return s  # text


def canonical(kind: str, parsed: str) -> str:
    """Key used to decide whether two candidates are the same value."""
    if kind in ("number", "percent"):
        return str(Decimal(parsed).normalize())
    return parsed.strip().lower()


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip().lower()


def quote_in_document(quote: str, doc_text: str) -> bool:
    return bool(quote.strip()) and _norm(quote) in _norm(doc_text)


def consolidate(raw: dict, docs: dict[str, str]) -> tuple[dict, list[dict]]:
    """Turn Claude's raw candidates into field states plus deterministic check failures.

    Status is decided here, not by Claude:
      no candidates -> UNKNOWN, >1 distinct value -> CONFLICT, else FOUND.
    """
    by_name = {f.get("name"): f for f in raw.get("fields", [])}
    fields: dict[str, dict] = {}
    failures: list[dict] = []

    for name, (kind, _desc) in FIELDS.items():
        f = by_name.get(name) or {"candidates": [], "uncertainty": ""}
        cands = []
        for c in f.get("candidates", []):
            parsed = parse_value(kind, c.get("value", ""))
            quote_ok = quote_in_document(c.get("quote", ""), docs.get(c.get("document", ""), ""))
            if not quote_ok:
                failures.append({
                    "field": name, "problem": "quote_not_in_document", "source": "deterministic_check",
                    "detail": f"Quote not found verbatim in {c.get('document')!r}: {c.get('quote')!r}",
                    "suggested_value": "",
                })
            if parsed is None:
                failures.append({
                    "field": name, "problem": "unparseable_value", "source": "deterministic_check",
                    "detail": f"Value {c.get('value')!r} is not a valid {kind}", "suggested_value": "",
                })
                continue
            cands.append({"value": parsed, "document": c.get("document"), "quote": c.get("quote"),
                          "quote_verified": quote_ok})
        fields[name] = make_state(name, cands, f.get("uncertainty", ""))
    return fields, failures


def make_state(name: str, cands: list[dict], uncertainty: str = "") -> dict:
    kind = FIELDS[name][0]
    distinct = {canonical(kind, c["value"]) for c in cands}
    if not cands:
        status, value = UNKNOWN, None
    elif len(distinct) > 1:
        status, value = CONFLICT, None
    else:
        status, value = FOUND, cands[0]["value"]
    return {"kind": kind, "status": status, "value": value, "candidates": cands,
            "uncertainty": uncertainty, "resolution": None}
