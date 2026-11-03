"""Prompts and schemas for the two Claude calls: extractor and verifier."""
from __future__ import annotations

import json

from . import llm
from .fields import FIELDS

EXTRACT_SYSTEM = """You extract fields from a small cross-border seller's sales and cost documents.
Rules:
- Only report a value a document states directly. Never calculate, convert, sum or infer. If a field is not stated, return it with no candidates.
- If documents state different values for the same field, return every candidate, each with its own document and quote.
- quote: the exact text, copied character-for-character, that contains the value.
- value: numbers without currency symbols or thousands separators (1200.00); percentages as the number only (6.5); currencies as ISO codes; days as an integer; booleans as yes/no.
- uncertainty: one short sentence on any ambiguity in the field, or an empty string.
Return every listed field exactly once."""

VERIFY_SYSTEM = """You are an independent verifier. Another model extracted fields from the documents. Check its output against the documents only.
Report an issue for each of:
- wrong_value: the value does not match what the document says
- unsupported: the quote or document does not support the value
- inferred_or_calculated: the value required calculation, conversion or inference
- missed_value: the documents state a value but the field has no candidates
- missed_conflict: the documents state a different value that was not returned as a candidate
- bad_uncertainty_note: an uncertainty note is wrong or misleading
Do not report style issues. suggested_value: the correct value in the same format, or "" if none. Return verdict FAIL if there is any issue, otherwise PASS."""


def _docs_block(docs: dict[str, str]) -> str:
    return "\n".join(f'<document name="{n}">\n{t}\n</document>' for n, t in docs.items())


def extract(docs: dict[str, str]) -> tuple[dict, dict]:
    names = list(FIELDS)
    schema = {
        "type": "object", "additionalProperties": False, "required": ["fields"],
        "properties": {"fields": {"type": "array", "items": {
            "type": "object", "additionalProperties": False,
            "required": ["name", "candidates", "uncertainty"],
            "properties": {
                "name": {"type": "string", "enum": names},
                "candidates": {"type": "array", "items": {
                    "type": "object", "additionalProperties": False,
                    "required": ["value", "document", "quote"],
                    "properties": {
                        "value": {"type": "string"},
                        "document": {"type": "string", "enum": list(docs)},
                        "quote": {"type": "string"},
                    }}},
                "uncertainty": {"type": "string"},
            }}}},
    }
    field_list = "\n".join(f"- {n}: {d}" for n, (_k, d) in FIELDS.items())
    user = f"{_docs_block(docs)}\n\nFields:\n{field_list}"
    return llm.call_json("extract", EXTRACT_SYSTEM, user, schema, effort="low")


def verify(docs: dict[str, str], extraction: dict) -> tuple[dict, dict]:
    schema = {
        "type": "object", "additionalProperties": False, "required": ["verdict", "issues"],
        "properties": {
            "verdict": {"type": "string", "enum": ["PASS", "FAIL"]},
            "issues": {"type": "array", "items": {
                "type": "object", "additionalProperties": False,
                "required": ["field", "problem", "detail", "suggested_value"],
                "properties": {
                    "field": {"type": "string", "enum": list(FIELDS)},
                    "problem": {"type": "string", "enum": [
                        "wrong_value", "unsupported", "inferred_or_calculated",
                        "missed_value", "missed_conflict", "bad_uncertainty_note"]},
                    "detail": {"type": "string"},
                    "suggested_value": {"type": "string"},
                }}},
        },
    }
    user = (f"{_docs_block(docs)}\n\n<extraction>\n"
            f"{json.dumps(extraction, separators=(',', ':'))}\n</extraction>")
    return llm.call_json("verify", VERIFY_SYSTEM, user, schema, effort="medium")
