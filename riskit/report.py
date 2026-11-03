"""Write quarantined (blocked) records and released reports."""
from __future__ import annotations

import json
from pathlib import Path


def write_quarantine(out: Path, run_id: str, payload: dict) -> Path:
    p = out / "quarantine" / f"{run_id}.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(payload, indent=2))
    return p


def _fmt(v):
    return "UNKNOWN" if v is None else v


def render_markdown(r: dict) -> str:
    L = [f"# RiskIT report - run {r['run_id']}", "",
         f"Approved by: {r['approver']}  ", f"Verifier verdict: {r['verifier']['verdict']} "
         f"({len(r['verifier']['issues'])} issue(s), all resolved by a human)", ""]

    L += ["## Document facts", "", "| Field | Value | Status | Source |", "|---|---|---|---|"]
    for name, st in r["facts"].items():
        src = "; ".join(f"{c['document']}: \"{c['quote']}\"" for c in st["candidates"]) or "-"
        L.append(f"| {name} | {_fmt(st['value'])} | {st['status']} | {src} |")

    resolved = {n: st["resolution"] for n, st in r["facts"].items() if st.get("resolution")}
    if resolved:
        L += ["", "## Human resolutions", ""]
        L += [f"- **{n}**: {res['how']} (by {res['by']})" for n, res in resolved.items()]

    L += ["", "## Scenario assumptions (not document facts)", "", "```json",
          json.dumps(r["scenario"], indent=2), "```"]

    L += ["", "## Calculations (deterministic code)", "", "| Result | Value | Basis | Formula |", "|---|---|---|---|"]
    for name, c in r["calc"]["results"].items():
        L.append(f"| {name} | {_fmt(c['value'])} | {c['basis']} | `{c['formula']}` |")
    if r["calc"]["fx_scenarios"]:
        L += ["", "| FX shock % | Margin (home) | Basis |", "|---|---|---|"]
        L += [f"| {s['fx_shock_percent']} | {_fmt(s['margin_home'])} | {s['basis']} |" for s in r["calc"]["fx_scenarios"]]
    L += [f"- {n}" for n in r["calc"]["notes"]]

    L += ["", "## Risk flags (human-approved)", ""]
    for f in r["flags"]:
        if f.get("approved"):
            L += [f"### {f['category']} - {f['level']}", f["explanation"], "", f"*Recommendation:* {f['recommendation']}", ""]
    withheld = [f for f in r["flags"] if not f.get("approved")]
    if withheld:
        L += ["## Withheld (not approved)", ""] + [f"- {f['category']}" for f in withheld]

    L += ["", "## Claude API usage", ""]
    L += [f"- {u['call']}: " + ("cache hit, 0 tokens" if u["cached"] else
                                f"{u['input_tokens']} in / {u['output_tokens']} out") for u in r["usage"]]
    L += ["", "Out of scope: KYC, KYB, sanctions, tax, legal compliance, full financial-statement analysis."]
    return "\n".join(L) + "\n"


def write_release(out: Path, run_id: str, report: dict) -> Path:
    d = out / "released"
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{run_id}.json").write_text(json.dumps(report, indent=2))
    md = d / f"{run_id}.md"
    md.write_text(render_markdown(report))
    return md
