"""Offline tests: no Claude API calls. Run: python3 -m unittest discover tests"""
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from riskit import __main__ as app
from riskit import calc, risk
from riskit.fields import CONFLICT, FOUND, UNKNOWN, consolidate
from riskit.review import Abort

ROOT = Path(__file__).resolve().parent.parent
DOCS = app.load_docs(ROOT / "samples" / "docs")
SCENARIO = json.loads((ROOT / "samples" / "scenario.json").read_text())


def cand(value, doc, quote):
    return {"value": value, "document": doc, "quote": quote}


# A plausible extractor output for the sample documents.
RAW = {"fields": [
    {"name": "order_id", "candidates": [cand("TL-48213", "sales_order.txt", "Order ref: TL-48213")], "uncertainty": ""},
    {"name": "sale_amount", "candidates": [cand("1200.00", "sales_order.txt", "Order total payable by buyer: USD 1,200.00")], "uncertainty": ""},
    {"name": "sale_currency", "candidates": [cand("USD", "sales_order.txt", "USD 1,200.00")], "uncertainty": ""},
    {"name": "home_currency", "candidates": [cand("GBP", "costs.txt", "All figures in GBP (our accounting currency)")], "uncertainty": ""},
    {"name": "platform_fee_percent", "candidates": [cand("6.5", "sales_order.txt", "TradeLink commission: 6.5% of order total")], "uncertainty": ""},
    {"name": "payment_fee_percent", "candidates": [cand("2.9", "sales_order.txt", "Payment processing fee: 2.9% of order total")], "uncertainty": ""},
    {"name": "fx_conversion_fee_percent", "candidates": [cand("1.5", "sales_order.txt", "(USD to GBP): 1.5% of order total")], "uncertainty": ""},
    {"name": "payment_terms_days", "candidates": [
        cand("30", "sales_order.txt", "Terms: Net 30 from date of shipment"),
        cand("45", "sales_order.txt", "we'll settle this one on net 45 terms")], "uncertainty": "Two terms stated."},
    {"name": "product_cost_amount", "candidates": [cand("560.00", "costs.txt", "£560.00")], "uncertainty": ""},
    {"name": "product_cost_currency", "candidates": [cand("GBP", "costs.txt", "All figures in GBP")], "uncertainty": ""},
    {"name": "shipping_cost_amount", "candidates": [cand("120.00", "costs.txt", "Courier charge: £120.00")], "uncertainty": ""},
    {"name": "shipping_cost_currency", "candidates": [cand("GBP", "costs.txt", "All figures in GBP")], "uncertainty": ""},
    {"name": "shipment_insured", "candidates": [cand("no", "costs.txt", "Shipment insurance: not purchased")], "uncertainty": ""},
    # deliberately invented quote -> deterministic check must catch it
    {"name": "buyer_country", "candidates": [cand("USA", "sales_order.txt", "Buyer located in the USA")], "uncertainty": ""},
]}


class TestFields(unittest.TestCase):
    def test_status_and_quote_checks(self):
        fields, failures = consolidate(RAW, DOCS)
        self.assertEqual(fields["sale_amount"]["status"], FOUND)
        self.assertEqual(fields["sale_amount"]["value"], "1200.00")
        self.assertEqual(fields["payment_terms_days"]["status"], CONFLICT)
        self.assertIsNone(fields["payment_terms_days"]["value"])
        self.assertEqual(fields["estimated_delivery_days"]["status"], UNKNOWN)  # not returned at all
        self.assertEqual([f["field"] for f in failures], ["buyer_country"])


FACTS = {"sale_amount": "1200.00", "sale_currency": "USD", "home_currency": "GBP",
         "platform_fee_percent": "6.5", "payment_fee_percent": "2.9", "fx_conversion_fee_percent": "1.5",
         "payment_terms_days": "45", "product_cost_amount": "560.00", "product_cost_currency": "GBP",
         "shipping_cost_amount": "120.00", "shipping_cost_currency": "GBP", "shipment_insured": "no",
         "estimated_delivery_days": None, "payment_method": "ACH"}


class TestCalc(unittest.TestCase):
    def test_numbers(self):
        r = calc.compute(FACTS, SCENARIO)
        v = {k: x["value"] for k, x in r["results"].items()}
        self.assertEqual(v["total_fee_percent"], "10.90")
        self.assertEqual(v["net_receipt_sale_ccy"], "1069.20")
        self.assertEqual(v["net_receipt_home"], "801.90")
        self.assertEqual(v["margin_home"], "121.90")
        self.assertEqual(v["margin_percent"], "13.54")
        self.assertEqual(v["breakeven_fx_move_percent"], "-15.20")
        self.assertEqual([s["margin_home"] for s in r["fx_scenarios"]], ["81.81", "41.71", "1.62"])
        self.assertEqual(r["results"]["margin_home"]["basis"], "FACTS+ASSUMPTION")
        self.assertEqual(r["results"]["total_costs_home"]["basis"], "FACTS")

    def test_unknown_propagates(self):
        r = calc.compute({**FACTS, "payment_fee_percent": None}, SCENARIO)
        self.assertIsNone(r["results"]["total_fee_percent"]["value"])
        self.assertIsNone(r["results"]["margin_home"]["value"])

    def test_no_fx_assumption_means_unknown(self):
        r = calc.compute(FACTS, {})
        self.assertIsNone(r["results"]["net_receipt_home"]["value"])
        self.assertTrue(r["notes"])


class TestRisk(unittest.TestCase):
    def test_levels(self):
        flags = {f["category"]: f["level"] for f in risk.assess(FACTS, calc.compute(FACTS, SCENARIO))}
        self.assertEqual(flags, {"fx": "MEDIUM", "payment_collection": "HIGH", "fees": "MEDIUM", "logistics": "HIGH"})

    def test_unknown_terms(self):
        f = {**FACTS, "payment_terms_days": None}
        flags = {x["category"]: x["level"] for x in risk.assess(f, calc.compute(f, SCENARIO))}
        self.assertEqual(flags["payment_collection"], "UNKNOWN")


class Scripted:
    def __init__(self, answers):
        self.answers = list(answers)
        self.out = []

    def ask(self, prompt):
        if not self.answers:
            raise Abort("input closed")
        a = self.answers.pop(0)
        if a == "q":
            raise Abort("user quit")
        return a

    def say(self, text=""):
        self.out.append(text)


VERIFIER_FAIL = {"verdict": "FAIL", "issues": [
    {"field": "payment_method", "problem": "missed_value",
     "detail": "Method is stated: bank transfer (ACH).", "suggested_value": "bank transfer (ACH)"}]}
NO_USAGE = {"call": "x", "cached": True, "input_tokens": 0, "output_tokens": 0}


class TestFlow(unittest.TestCase):
    def _run(self, answers, verifier=VERIFIER_FAIL):
        out = Path(tempfile.mkdtemp())
        con = Scripted(answers)
        with mock.patch.object(app.ai, "extract", return_value=(RAW, NO_USAGE)), \
             mock.patch.object(app.ai, "verify", return_value=(verifier, NO_USAGE)):
            code = app.run(ROOT / "samples" / "docs", ROOT / "samples" / "scenario.json", out, con)
        return code, out, con

    def test_blocked_until_human_reviews(self):
        code, out, con = self._run(["Alex", "q"])
        self.assertEqual(code, 2)
        self.assertFalse((out / "released").exists())
        self.assertEqual(len(list((out / "quarantine").glob("*.json"))), 1)

    def test_full_release(self):
        answers = ["Alex",
                   "a", "y",          # approve AI suggestion for payment_method
                   "k", "quote checked by hand",  # buyer_country quote failure: keep
                   "2",               # conflict: net 45
                   "y",               # approve facts
                   "y", "y", "y", "n"]  # approve 3 flags, withhold logistics
        code, out, con = self._run(answers)
        self.assertEqual(code, 0)
        rep = json.loads(next((out / "released").glob("*.json")).read_text())
        self.assertEqual(rep["facts"]["payment_terms_days"]["value"], "45")
        self.assertEqual(rep["facts"]["payment_method"]["value"], "bank transfer (ACH)")
        self.assertEqual([f["approved"] for f in rep["flags"]], [True, True, True, False])
        self.assertFalse(list((out / "quarantine").glob("*.json")))
        md = next((out / "released").glob("*.md")).read_text()
        self.assertIn("Withheld", md)
        self.assertIn("Scenario assumptions (not document facts)", md)


if __name__ == "__main__":
    unittest.main()
