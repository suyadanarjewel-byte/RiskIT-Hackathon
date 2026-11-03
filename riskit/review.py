"""Human-in-the-loop steps. Nothing is released without passing through here.

All input goes through a Console object so tests can script the answers.
EOF or 'q' at any prompt aborts; whatever was blocked stays blocked.
"""
from __future__ import annotations

from datetime import datetime, timezone

from .fields import CONFLICT, FIELDS, FOUND, UNKNOWN, make_state, parse_value


class Abort(Exception):
    pass


class Console:
    def ask(self, prompt: str) -> str:
        try:
            ans = input(prompt).strip()
        except EOFError:
            raise Abort("input closed")
        if ans.lower() == "q":
            raise Abort("user quit")
        return ans

    def say(self, text: str = "") -> None:
        print(text)


class Audit:
    def __init__(self, approver: str):
        self.approver = approver
        self.events: list[dict] = []

    def log(self, action: str, **detail) -> None:
        self.events.append({"time": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                            "approver": self.approver, "action": action, **detail})


def show_fields(con: Console, fields: dict) -> None:
    con.say(f"{'FIELD':28} {'STATUS':9} VALUE / SOURCES")
    for name, st in fields.items():
        if st["status"] == FOUND:
            src = ", ".join(sorted({c["document"] for c in st["candidates"]}))
            con.say(f"{name:28} {FOUND:9} {st['value']}  [{src}]")
        elif st["status"] == UNKNOWN:
            con.say(f"{name:28} {UNKNOWN:9} -")
        else:
            con.say(f"{name:28} {CONFLICT:9} " + " | ".join(c["value"] for c in st["candidates"]))
        if st.get("uncertainty"):
            con.say(f"{'':38}note (AI): {st['uncertainty']}")


def _human_value(con: Console, name: str) -> str | None:
    kind = FIELDS[name][0]
    while True:
        raw = con.ask(f"  Enter value for {name} ({kind}), or U for UNKNOWN: ")
        if raw.upper() == "U":
            return None
        parsed = parse_value(kind, raw)
        if parsed is not None:
            return parsed
        con.say(f"  Not a valid {kind}.")


def _set(fields: dict, name: str, value: str | None, how: str, audit: Audit) -> None:
    cands = [] if value is None else [{"value": value, "document": f"HUMAN:{audit.approver}",
                                       "quote": how, "quote_verified": True}]
    old = fields[name]
    fields[name] = make_state(name, cands, old.get("uncertainty", ""))
    fields[name]["resolution"] = {"by": audit.approver, "how": how,
                                  "previous_candidates": old["candidates"]}


def resolve_verifier_failures(con: Console, fields: dict, issues: list[dict], audit: Audit) -> None:
    """Every issue needs an explicit human decision. AI suggestions are applied only on approval."""
    for i, iss in enumerate(issues, 1):
        name = iss["field"]
        con.say(f"\n[{i}/{len(issues)}] {name}: {iss['problem']} ({iss.get('source', 'ai_verifier')})")
        con.say(f"  {iss['detail']}")
        con.say(f"  Current: {fields[name]['status']} "
                + ", ".join(f"{c['value']} ({c['document']})" for c in fields[name]["candidates"]))
        sug = iss.get("suggested_value") or ""
        opts = "[k]eep current, [e]nter value"
        if sug:
            opts = f"[a]ccept AI suggestion '{sug}', " + opts
        while True:
            ch = con.ask(f"  {opts}: ").lower()
            if ch == "a" and sug:
                parsed = parse_value(FIELDS[name][0], sug)
                if parsed is None:
                    con.say("  AI suggestion is not a valid value; choose another option.")
                    continue
                if con.ask(f"  Approve AI correction {name} = {parsed}? [y/n]: ").lower() != "y":
                    continue
                _set(fields, name, parsed, f"approved AI verifier correction: {iss['detail']}", audit)
                audit.log("approve_ai_correction", field=name, value=parsed, issue=iss)
                break
            if ch == "k":
                reason = ""
                while not reason:
                    reason = con.ask("  Reason for keeping current value (required): ")
                if fields[name]["resolution"] is None:
                    fields[name]["resolution"] = {"by": audit.approver, "how": f"kept after review: {reason}"}
                audit.log("reject_verifier_issue", field=name, reason=reason, issue=iss)
                break
            if ch == "e":
                val = _human_value(con, name)
                _set(fields, name, val, f"human correction after verifier issue: {iss['detail']}", audit)
                audit.log("human_correction", field=name, value=val, issue=iss)
                break


def resolve_conflicts(con: Console, fields: dict, audit: Audit) -> None:
    for name, st in fields.items():
        if st["status"] != CONFLICT:
            continue
        con.say(f"\nCONFLICT in {name}:")
        for i, c in enumerate(st["candidates"], 1):
            con.say(f"  {i}. {c['value']}  from {c['document']}: \"{c['quote']}\"")
        while True:
            ch = con.ask("  Pick a number, [e]nter a value, or [u] mark UNKNOWN: ").lower()
            if ch.isdigit() and 1 <= int(ch) <= len(st["candidates"]):
                c = st["candidates"][int(ch) - 1]
                _set(fields, name, c["value"], f"user chose value from {c['document']}", audit)
                audit.log("resolve_conflict", field=name, value=c["value"], chosen_source=c["document"])
                break
            if ch == "e":
                val = _human_value(con, name)
                _set(fields, name, val, "user entered value to resolve conflict", audit)
                audit.log("resolve_conflict", field=name, value=val, chosen_source="human")
                break
            if ch == "u":
                _set(fields, name, None, "user marked UNKNOWN to resolve conflict", audit)
                audit.log("resolve_conflict", field=name, value=None)
                break


def approve_extraction(con: Console, fields: dict, audit: Audit) -> None:
    """Approve facts and the AI uncertainty notes as a whole; allow edits first."""
    while True:
        con.say("\nFacts to be used (after your resolutions):")
        show_fields(con, fields)
        ans = con.ask("Approve these facts and AI notes? [y] or type a field name to edit: ")
        if ans.lower() == "y":
            audit.log("approve_facts", facts={k: v["value"] for k, v in fields.items()})
            return
        if ans in fields:
            val = _human_value(con, ans)
            _set(fields, ans, val, "edited by user at fact approval", audit)
            audit.log("edit_fact", field=ans, value=val)
        else:
            con.say("  Unknown field name.")


def approve_flags(con: Console, flags: list[dict], audit: Audit) -> None:
    for f in flags:
        con.say(f"\n[{f['category']}] {f['level']}")
        con.say(f"  Explanation: {f['explanation']}")
        con.say(f"  Recommendation: {f['recommendation']}")
        while True:
            ans = con.ask("  Approve for release? [y/n]: ").lower()
            if ans in ("y", "n"):
                break
        f["approved"] = ans == "y"
        audit.log("approve_flag" if f["approved"] else "withhold_flag", category=f["category"], level=f["level"])
