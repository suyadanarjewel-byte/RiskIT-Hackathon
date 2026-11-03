"""The only module that talks to the Claude API.

Cost controls:
  * exactly two calls per new document set (extract, verify);
  * responses cached on disk, keyed by model + prompt + documents + schema,
    so re-running the same inputs makes zero API calls;
  * structured JSON output, so there is no retry-to-fix-format loop;
  * compact prompts; no calculations or prose generation are delegated to Claude.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

MODEL = os.environ.get("RISKIT_MODEL", "claude-opus-5-5")
CACHE_DIR = Path(os.environ.get("RISKIT_CACHE_DIR", ".riskit_cache"))


class LLMError(Exception):
    pass


def call_json(tag: str, system: str, user: str, schema: dict, effort: str) -> tuple[dict, dict]:
    """Return (parsed JSON, usage info). Uses the disk cache when possible."""
    key_src = json.dumps([MODEL, effort, system, user, schema], sort_keys=True)
    key = hashlib.sha256(key_src.encode()).hexdigest()[:24]
    path = CACHE_DIR / f"{tag}-{key}.json"
    if path.exists():
        return json.loads(path.read_text()), {"call": tag, "cached": True, "input_tokens": 0, "output_tokens": 0}

    import anthropic  # imported lazily so offline tests don't need the SDK

    client = anthropic.Anthropic()
    try:
        resp = client.beta.messages.create(
            model=MODEL,
            max_tokens=16000,
            system=system,
            messages=[{"role": "user", "content": user}],
            output_config={"effort": effort, "format": {"type": "json_schema", "schema": schema}},
            # Server-side fallback: if the request is declined by a safety
            # classifier, the API retries on a suitable model in the same call.
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
    except anthropic.AuthenticationError as e:
        raise LLMError("Authentication failed - check ANTHROPIC_API_KEY") from e
    except anthropic.RateLimitError as e:
        raise LLMError("Rate limited by the Claude API - try again shortly") from e
    except anthropic.APIStatusError as e:
        raise LLMError(f"Claude API error {e.status_code}: {e.message}") from e
    except anthropic.APIConnectionError as e:
        raise LLMError("Could not reach the Claude API") from e

    if resp.stop_reason == "refusal":
        raise LLMError(f"{tag}: Claude declined the request")
    if resp.stop_reason == "max_tokens":
        raise LLMError(f"{tag}: response truncated (max_tokens)")
    text = "".join(b.text for b in resp.content if getattr(b, "type", None) == "text")
    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        raise LLMError(f"{tag}: response was not valid JSON") from e

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2))
    return data, {"call": tag, "cached": False,
                  "input_tokens": resp.usage.input_tokens, "output_tokens": resp.usage.output_tokens}
