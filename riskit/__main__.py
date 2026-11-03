"""RiskIT demo flow.

    python3 -m riskit samples/docs --scenario samples/scenario.json

Steps: extract (Claude) -> deterministic checks -> verify (Claude) -> BLOCK if any
failure until a human approves corrections -> resolve conflicts -> approve facts ->
deterministic calculations and risk rules -> approve each flag -> release.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from . import ai, calc, report, risk
from .fields import CONFLICT, consolidate
from .llm import LLMError
from .review import (Abort, Audit, Console, approve_extraction, approve_flags,
                     resolve_conflicts, resolve_verifier_failures, show_fields)


def load_docs(folder: Path) -> dict[str, str]:
    docs = {p.name: p.read_text() for p in sorted(folder.glob("*.txt"))}
    if not docs:
        raise SystemExit(f"No .txt documents found in {folder}")
    return docs


def run(docs_dir: Path, scenario_path: Path, out: Path, con: Console) -> int:
    docs = load_docs(docs_dir)
    scenario = json.loads(scenario_path.read_text())
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    usage = []

    con.say(f"RiskIT run {run_id}: {len(docs)} document(s): {', '.join(docs)}")
    approver = ""
    try:
        while not approver:
            approver = con.ask("Reviewer name: ")
    except Abort:
        return 2
    audit = Audit(approver)

    # 1. Extraction (Claude call 1)
    try:
        raw, u = ai.extract(docs)
        usage.append(u)
        fields, check_failures = consolidate(raw, docs)
        # 2. Verification (Claude call 2) on the raw extraction
        ver, u = ai.verify(docs, raw)
        usage.append(u)
    except LLMError as e:
        con.say(f"ERROR: {e}")
        return 1
    for x in usage:
        con.say(f"  Claude {x['call']}: " + ("cache hit (0 tokens)" if x["cached"]
                                             else f"{x['input_tokens']} in / {x['output_tokens']} out tokens"))

    issues = [{**i, "source": "ai_verifier"} for i in ver.get("issues", [])] + check_failures
    blocked = ver.get("verdict") != "PASS" or bool(issues)

    con.say("\nExtracted facts:")
    show_fields(con, fields)

    try:
        # 3. Containment gate
        if blocked:
            q = report.write_quarantine(out, run_id, {
                "status": "BLOCKED", "verifier": ver, "check_failures": check_failures,
                "fields": fields, "audit": audit.events})
            con.say(f"\n*** BLOCKED: verifier found {len(issues)} issue(s). Output contained in {q}")
            con.say("Each issue needs a human decision before anything can be released. ('q' to stop)")
            resolve_verifier_failures(con, fields, issues, audit)
            audit.log("unblock", issues=len(issues))
            con.say("\nAll verifier issues reviewed; output unblocked.")

        # 4. Conflicts require user resolution
        if any(st["status"] == CONFLICT for st in fields.values()):
            con.say("\nConflicting values found - you must choose:")
            resolve_conflicts(con, fields, audit)

        # 5. Approve facts and AI uncertainty notes
        approve_extraction(con, fields, audit)

        # 6. Deterministic calculations + risk rules
        facts = {k: v["value"] for k, v in fields.items()}
        c = calc.compute(facts, scenario)
        flags = risk.assess(facts, c)
        con.say(f"\nScenario assumptions (separate from facts): FX rate {c['fx_rate_used'] or 'UNKNOWN'}")
        for n in c["notes"]:
            con.say(f"  note: {n}")
        for name, r in c["results"].items():
            con.say(f"  {name:30} {r['value'] or 'UNKNOWN':>12}  [{r['basis']}]")

        # 7. Approve each flag, explanation and recommendation
        approve_flags(con, flags, audit)
    except Abort as e:
        report.write_quarantine(out, run_id, {"status": "ABORTED_BLOCKED" if blocked else "ABORTED",
                                              "reason": str(e), "fields": fields, "audit": audit.events})
        con.say(f"\nStopped ({e}). Nothing was released.")
        return 2

    # 8. Release
    audit.log("release")
    md = report.write_release(out, run_id, {
        "run_id": run_id, "approver": approver, "documents": list(docs),
        "verifier": {"verdict": ver.get("verdict"), "issues": issues},
        "facts": fields, "scenario": scenario, "calc": c, "flags": flags,
        "audit": audit.events, "usage": usage})
    if blocked:
        (out / "quarantine" / f"{run_id}.json").unlink(missing_ok=True)
    con.say(f"\nReleased: {md}")
    return 0


def main() -> None:
    p = argparse.ArgumentParser(prog="riskit", description="Transaction-level risk assessment demo")
    p.add_argument("docs", type=Path, help="folder of plain-text sales/cost documents")
    p.add_argument("--scenario", type=Path, required=True, help="scenario assumptions JSON")
    p.add_argument("--out", type=Path, default=Path("out"))
    a = p.parse_args()
    sys.exit(run(a.docs, a.scenario, a.out, Console()))


if __name__ == "__main__":
    main()
