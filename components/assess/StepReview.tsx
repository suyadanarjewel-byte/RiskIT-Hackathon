"use client";

/**
 * Step 2: AI verification & human review.
 *  A. Verifier findings (blocking): approve / correct / mark UNKNOWN / reject each one.
 *     The verifier never approves its own corrections; only human decisions are recorded.
 *  B. Needs your input: missing, estimated and conflicting values.
 *  C. Extracted values: everything else, editable.
 * "Approve and Continue" records the human approval (lib/review.applyDecisions).
 */
import { useMemo, useState } from "react";
import {
  buildCorrectedAssessment, canProceed, finalDecision, recordVerifierDecision, type ContainmentState,
} from "../../lib/containment";
import {
  applyDecisions, buildRows, canConfirm, canContinue, needsApproval, parseInput, rowStatus,
  type Decision, type ReviewRow,
} from "../../lib/review";
import { getReviewer, setReviewer as saveReviewer, type AssessmentSession } from "../../lib/store";
import type { AssessableFieldName, OrderAssessment, VerificationIssue } from "../../lib/types";
import { useI18n } from "../I18nProvider";
import { IconAlert, IconArrowLeft, IconArrowRight, IconCheck, IconEdit, IconFile, IconSearch, IconSparkle, IconUser } from "../Icons";
import { Banner, Chip, Prov, SectionHead, showValue, useFormat } from "../ui";

type Update = (p: Partial<AssessmentSession> | ((s: AssessmentSession) => AssessmentSession)) => void;

// ---------- Value editor for any field shape ----------

const SHAPES: Partial<Record<AssessableFieldName, { key: string; kind: "number" | "text" | "integer" | "bool" | "currency" | "country" }[]>> = {
  freight_cost: [{ key: "amount", kind: "number" }, { key: "currency", kind: "currency" }, { key: "is_estimated", kind: "bool" }],
  insurance_cost: [{ key: "amount", kind: "number" }, { key: "currency", kind: "currency" }, { key: "is_estimated", kind: "bool" }],
  platform_fee: [{ key: "percent", kind: "number" }, { key: "fixed_amount", kind: "number" }, { key: "currency", kind: "currency" }],
  payment_fee: [{ key: "percent", kind: "number" }, { key: "fixed_amount", kind: "number" }, { key: "currency", kind: "currency" }],
  shipment_origin: [{ key: "country", kind: "country" }, { key: "place", kind: "text" }],
  destination: [{ key: "country", kind: "country" }, { key: "place", kind: "text" }],
  payment_terms: [{ key: "description", kind: "text" }, { key: "net_days", kind: "integer" }],
};
const SCALAR: Partial<Record<AssessableFieldName, "date" | "number" | "currency" | "country" | "text">> = {
  order_date: "date", expected_delivery_date: "date", payment_due_date: "date", quantity: "number", sales_value: "number",
  deposit_percent: "number", sales_currency: "currency", reporting_currency: "currency", buyer_country: "country",
};

function ValueEditor({ field, initial, onSubmit, onCancel }: {
  field: AssessableFieldName; initial: unknown; onSubmit: (v: unknown) => string | null; onCancel: () => void;
}) {
  const { t } = useI18n();
  const shape = SHAPES[field];
  const init = (initial && typeof initial === "object" ? initial : {}) as Record<string, unknown>;
  const [vals, setVals] = useState<Record<string, string>>(() =>
    shape ? Object.fromEntries(shape.map((s) => [s.key, init[s.key] === null || init[s.key] === undefined ? "" : String(init[s.key])]))
      : { value: initial === null || initial === undefined ? "" : String(initial) });
  const [err, setErr] = useState<string | null>(null);

  const build = (): unknown => {
    if (!shape) {
      const k = SCALAR[field] ?? "text";
      const v = vals.value.trim();
      if (!v) return null;
      return k === "number" ? Number(v.replace(/,/g, "")) : k === "currency" || k === "country" ? v.toUpperCase() : v;
    }
    const out: Record<string, unknown> = {};
    for (const s of shape) {
      const v = (vals[s.key] ?? "").trim();
      if (s.kind === "bool") out[s.key] = v === "true";
      else if (!v) out[s.key] = null;
      else if (s.kind === "number" || s.kind === "integer") out[s.key] = Number(v.replace(/,/g, ""));
      else if (s.kind === "currency" || s.kind === "country") out[s.key] = v.toUpperCase();
      else out[s.key] = v;
    }
    return out;
  };

  return (
    <form className="value-editor" onSubmit={(e) => { e.preventDefault(); setErr(onSubmit(build())); }}>
      {(shape ?? [{ key: "value", kind: SCALAR[field] ?? "text" }]).map((s) => (
        s.kind === "bool" ? (
          <label key={s.key} className="check">
            <input type="checkbox" checked={vals[s.key] === "true"} onChange={(e) => setVals({ ...vals, [s.key]: String(e.target.checked) })} />
            {t("prov.estimate")}
          </label>
        ) : (
          <label key={s.key} className="field">
            <span>{s.key === "value" ? t(`field.${field}`) : t(`sub.${s.key}`)}</span>
            <input type={s.kind === "date" ? "date" : "text"} inputMode={s.kind === "number" || s.kind === "integer" ? "decimal" : undefined}
              value={vals[s.key] ?? ""} onChange={(e) => setVals({ ...vals, [s.key]: e.target.value })} />
          </label>
        )
      ))}
      {err && <p className="error" role="alert">{t("common.invalid")} <span className="src">{err}</span></p>}
      <div className="actions">
        <button type="submit" className="primary">{t("common.save")}</button>
        <button type="button" onClick={onCancel}>{t("common.cancel")}</button>
      </div>
    </form>
  );
}

// ---------- A. Verifier finding card ----------

function IssueCard({ issue, index, state, draft, reviewer, onDecide }: {
  issue: VerificationIssue; index: number; state: ContainmentState; draft: OrderAssessment; reviewer: string;
  onDecide: (input: Parameters<typeof recordVerifierDecision>[1]) => string | null;
}) {
  const { t } = useI18n();
  const { field: fieldName } = useFormat();
  const [mode, setMode] = useState<"none" | "edit" | "reject">("none");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const done = finalDecision(state, issue.id);
  const field = issue.field;
  const quote = field ? draft[field].quote : null;
  const proposed = issue.proposed_correction;
  const proposedIsEstimate = !!proposed && proposed.value !== null && typeof proposed.value === "object" && (proposed.value as { is_estimated?: boolean }).is_estimated === true;
  const decidedLabel = done ? (done.decision === "edit" && done.new_value === null ? t("rv.decided.unknown") : t(`rv.decided.${done.decision}`)) : null;

  const act = (input: Parameters<typeof recordVerifierDecision>[1]) => {
    if (!reviewer.trim()) { setErr(t("rv.need_name")); return; }
    const e = onDecide(input);
    setErr(e ? t("common.invalid") + " " + e : null);
    if (!e) setMode("none");
  };

  return (
    <article className={`issue ${done ? "issue-done" : ""}`} aria-labelledby={`issue-${issue.id}`}>
      <header className="issue-head">
        <h3 id={`issue-${issue.id}`}><span className="issue-n">{index}</span> {field ? fieldName(field) : "—"}</h3>
        <div className="issue-chips">
          <Chip tone="crit" icon={<IconAlert size={12} />}>{t(`problem.${issue.problem}`)}</Chip>
          {done ? <Chip tone="good" icon={<IconCheck size={12} />}>{decidedLabel}</Chip> : <Chip tone="warn">{t("rv.awaiting")}</Chip>}
        </div>
      </header>

      <div className="issue-grid">
        <div className="issue-col">
          <h4><IconSparkle size={14} /> {t("rv.original")}</h4>
          <div className="value-box">{showValue(issue.original_value, t("common.unknown"))}</div>
          <Prov kind="ai_original" />
        </div>
        <div className="issue-col">
          <h4><IconFile size={14} /> {t("rv.evidence")}</h4>
          {issue.evidence.length ? issue.evidence.map((ev, i) => (
            <blockquote key={i} className="evidence"><span lang="">{ev.quote}</span><cite>{ev.source_ref ?? ""}</cite></blockquote>
          )) : quote ? <blockquote className="evidence"><span>{quote}</span></blockquote> : <p className="src">{t("rv.no_evidence")}</p>}
        </div>
        <div className="issue-col">
          <h4><IconSearch size={14} /> {t("rv.identified")}</h4>
          <p>{t(`explain.${issue.problem}`)}</p>
          {issue.detected_by === "ai_verifier" && issue.detail && (
            <p className="src"><strong>{t("rv.verifier_text")}:</strong> {issue.detail}</p>
          )}
          <Prov kind={issue.detected_by === "ai_verifier" ? "ai_verifier" : "calculation"} />
          {issue.detected_by !== "ai_verifier" && <span className="src"> {t("rv.code_check")}</span>}
        </div>
        <div className="issue-col issue-fix">
          <h4><IconEdit size={14} /> {t("rv.proposed")}</h4>
          {proposed ? (
            <>
              <div className="value-box">{showValue(proposed.value, t("common.unknown"))}</div>
              {proposedIsEstimate && <Chip tone="warn">{t("rv.estimate")}</Chip>}
              {proposed.value === null && <Chip tone="muted">{t("rv.missing")}</Chip>}
            </>
          ) : <p className="src">{t("rv.no_proposal")}</p>}
        </div>
      </div>

      <div className="issue-decision">
        <h4><IconUser size={14} /> {t("common.reviewer")}</h4>
        {done ? (
          <p>
            <strong>{decidedLabel}</strong>
            {(done.decision === "approve" || done.decision === "edit") && done.new_value !== null && <> · {showValue(done.new_value)}</>}
            {done.reason && <> · “{done.reason}”</>}
            <span className="src"> · {t("common.by_at", { who: done.decided_by, when: done.decided_at.slice(0, 16).replace("T", " ") })}</span>
          </p>
        ) : mode === "edit" && field ? (
          <ValueEditor field={field} initial={proposed ? proposed.value : issue.original_value}
            onSubmit={(v) => { const e = reviewer.trim() ? onDecide({ issueId: issue.id, decision: "edit", editedValue: v }) : t("rv.need_name"); if (!e) setMode("none"); return e; }}
            onCancel={() => setMode("none")} />
        ) : mode === "reject" ? (
          <form className="value-editor" onSubmit={(e) => { e.preventDefault(); act({ issueId: issue.id, decision: "reject", note: reason }); }}>
            <label className="field"><span>{t("rv.reject_reason")}</span><input value={reason} onChange={(e) => setReason(e.target.value)} required /></label>
            <div className="actions">
              <button type="submit" disabled={!reason.trim()}>{t("rv.reject_fix")}</button>
              <button type="button" onClick={() => setMode("none")}>{t("common.cancel")}</button>
            </div>
          </form>
        ) : (
          <div className="actions">
            <button type="button" className="primary" disabled={!proposed} onClick={() => act({ issueId: issue.id, decision: "approve" })}>
              <IconCheck size={15} /> {t("rv.approve_fix")}
            </button>
            <button type="button" disabled={!field} onClick={() => setMode("edit")}><IconEdit size={15} /> {t("rv.correct")}</button>
            <button type="button" disabled={!field} onClick={() => act({ issueId: issue.id, decision: "edit", editedValue: null })}>{t("rv.mark_unknown")}</button>
            <button type="button" className="ghost" onClick={() => setMode("reject")}>{t("rv.reject_fix")}</button>
          </div>
        )}
        {err && <p className="error" role="alert">{err}</p>}
      </div>
    </article>
  );
}

// ---------- B / C. Field review helpers ----------

const OPTIONAL_RELEVANT: AssessableFieldName[] = ["insurance_cost", "order_date", "expected_delivery_date", "payment_due_date"];

function rowField(r: ReviewRow): string {
  return r.target.type === "field" ? r.target.field : `cost_items.${r.target.index}`;
}

function rowLabel(r: ReviewRow, t: (k: string) => string): string {
  if (r.target.type === "cost") return `${r.label.replace(/^Cost item: /, "").replace(/ - \w+$/, "")} (${t(`sub.${r.target.sub}`)})`;
  return r.target.sub ? `${t(`field.${r.target.field}`)} (${t(`sub.${r.target.sub}`)})` : t(`field.${r.target.field}`);
}

function effective(r: ReviewRow, d: Decision | undefined): unknown {
  if (!d) return r.extracted;
  if (d.kind === "unknown") return null;
  if (d.kind === "correct") return d.value;
  if (d.kind === "choose") return r.conflictOptions[d.option]?.value ?? null;
  return r.extracted;
}

function RowInput({ row, onSave }: { row: ReviewRow; onSave: (v: string) => string | null }) {
  const { t } = useI18n();
  const [v, setV] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <form className="row-input" onSubmit={(e) => { e.preventDefault(); setErr(onSave(v)); }}>
      <label className="sr-only" htmlFor={`in-${row.id}`}>{row.label}</label>
      <input id={`in-${row.id}`} type={row.kind === "date" ? "date" : "text"} value={v} onChange={(e) => setV(e.target.value)}
        inputMode={["number", "integer", "percent"].includes(row.kind) ? "decimal" : undefined} placeholder={row.kind === "currency" ? "SGD" : ""} />
      <button type="submit" disabled={!v.trim()}>{t("common.save")}</button>
      {err && <span className="error" role="alert">{err}</span>}
    </form>
  );
}

export function StepReview({ session, update }: { session: AssessmentSession; update: Update }) {
  const { t } = useI18n();
  const fmt = useFormat();
  const [reviewer, setReviewerState] = useState(() => getReviewer());
  const [editing, setEditing] = useState<string | null>(null);
  const containment = session.containment!;
  const draft = containment.draft;
  const issues = containment.verification.issues;
  const findingsDone = canProceed(containment).ok;
  const failed = containment.verification.verdict === "FAIL" || issues.length > 0;
  const decisions = session.factDecisions;
  const readOnly = !!session.approved;

  const corrected = useMemo(
    () => (findingsDone ? buildCorrectedAssessment(containment, reviewer.trim() || "reviewer") : null),
    // reviewer only labels the unblock audit entry; recomputing on each keystroke is unnecessary
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [containment, findingsDone],
  );
  const rows = useMemo(() => (corrected ? buildRows(corrected.assessment, corrected.approvedFields) : []), [corrected]);

  const setReviewer = (v: string) => { setReviewerState(v); saveReviewer(v); };
  const setDecisions = (patch: Record<string, Decision | null>) => update((s) => {
    const next = { ...s.factDecisions };
    for (const [k, d] of Object.entries(patch)) { if (d) next[k] = d; else delete next[k]; }
    return { ...s, factDecisions: next };
  });

  const decideIssue = (input: Parameters<typeof recordVerifierDecision>[1]) => {
    const r = recordVerifierDecision(containment, input, reviewer);
    if (!r.ok) return r.error;
    update({ containment: r.state });
    return null;
  };

  // Group rows into cards
  const groups = useMemo(() => {
    const visible = rows.filter((r) => r.kind !== "bool");
    const conflicts = new Map<string, ReviewRow[]>();
    const missing = new Map<string, ReviewRow[]>();
    const estimates = new Map<string, ReviewRow[]>();
    const used = new Set<string>();
    for (const r of visible) {
      const f = rowField(r);
      if (r.conflictOptions.length) { conflicts.set(f, [...(conflicts.get(f) ?? []), r]); used.add(r.id); }
    }
    for (const r of visible) {
      if (used.has(r.id)) continue;
      const f = rowField(r);
      const relevant = needsApproval(r) || (r.target.type === "field" && OPTIONAL_RELEVANT.includes(r.target.field));
      if (r.extracted === null && relevant && !conflicts.has(f)) { missing.set(f, [...(missing.get(f) ?? []), r]); used.add(r.id); }
    }
    for (const r of visible) {
      if (used.has(r.id)) continue;
      const f = rowField(r);
      if (r.estimated && r.aiGenerated && !r.preApproved && !missing.has(f) && !conflicts.has(f)) { estimates.set(f, [...(estimates.get(f) ?? []), r]); used.add(r.id); }
    }
    // Keep sibling rows (e.g. currency of a missing amount) inside the same card.
    for (const r of visible) {
      if (used.has(r.id)) continue;
      const f = rowField(r);
      for (const m of [missing, estimates]) if (m.has(f)) { m.get(f)!.push(r); used.add(r.id); }
    }
    return { conflicts, missing, estimates, table: visible.filter((r) => !used.has(r.id)) };
  }, [rows]);

  const estimateFlagRow = (f: string) => rows.find((r) => r.kind === "bool" && rowField(r) === f);

  // Approval gate (bulk-confirm the remaining AI-extracted values only when the human approves)
  const bulk = useMemo(() => Object.fromEntries(
    rows.filter((r) => needsApproval(r) && canConfirm(r) && !decisions[r.id]).map((r) => [r.id, { kind: "confirm" } as Decision]),
  ), [rows, decisions]);
  const allDecisions = { ...decisions, ...bulk };
  const gate = corrected ? canContinue(rows, allDecisions, reviewer) : { ok: false, blockers: [] as string[] };
  const openFindings = issues.filter((i) => !finalDecision(containment, i.id)).length;
  const blockerCount = openFindings + gate.blockers.filter((b) => !b.startsWith("Enter your name")).length;

  const approve = () => {
    if (!corrected || !gate.ok) return;
    const result = applyDecisions(corrected.assessment, rows, allDecisions, reviewer.trim());
    const fresh = buildCorrectedAssessment(containment, reviewer.trim());
    update({
      approved: { ...result, audit: [...fresh.audit, ...result.audit] },
      factDecisions: allDecisions, fx: null, recommendation: { origin: null, state: null, released: null }, step: 3,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const save = (r: ReviewRow, raw: string): string | null => {
    const p = parseInput(r.kind, raw);
    if (!p.ok) return t("common.invalid");
    setDecisions({ [r.id]: { kind: "correct", value: p.value } });
    setEditing(null);
    return null;
  };

  const provFor = (r: ReviewRow, d: Decision | undefined) =>
    d?.kind === "correct" ? "user" as const
      : r.preApproved ? (r.source === "user" ? "human_edit" as const : "ai_correction_approved" as const)
      : r.extracted === null ? "unknown" as const : r.estimated ? "estimate" as const : r.aiGenerated ? "document" as const : r.source as "user";

  return (
    <div className="step-body">
      {failed && !findingsDone ? (
        <Banner tone="blocked" title={t("rv.blocked_title", { n: openFindings })}>{t("rv.blocked_body")}</Banner>
      ) : readOnly ? (
        <Banner tone="success" title={t("rv.approved_title")}>
          {t("rv.approved_by", { who: session.approved!.assessment.approved_by ?? "", when: fmt.when(session.approved!.assessment.approval_timestamp) })}
        </Banner>
      ) : !failed ? (
        <Banner tone="success" title={t("rv.passed_title")}>{t("rv.passed_body")}</Banner>
      ) : gate.ok ? (
        <Banner tone="pending" title={t("rv.ready_title")}>{t("rv.ready_body")}</Banner>
      ) : (
        <Banner tone="pending" title={t("rv.blockers", { n: blockerCount })} />
      )}

      <div className="card reviewer-card">
        <label className="field reviewer-field">
          <span>{t("common.reviewer")} <span className="req" aria-hidden>*</span></span>
          <input value={reviewer} onChange={(e) => setReviewer(e.target.value)} disabled={readOnly} autoComplete="name" aria-describedby="reviewer-help" required />
        </label>
        <p id="reviewer-help" className="src">{t("common.reviewer_help")}</p>
      </div>

      {issues.length > 0 && (
        <section className="card">
          <SectionHead title={t("rv.findings")} sub={t("rv.findings_sub")} />
          <p className="note-info"><IconSearch size={14} /> {t("rv.verifier_cannot_approve")}</p>
          {issues.map((issue, i) => (
            <IssueCard key={issue.id} issue={issue} index={i + 1} state={containment} draft={draft} reviewer={readOnly ? "" : reviewer}
              onDecide={readOnly ? () => t("rv.approved_title") : decideIssue} />
          ))}
        </section>
      )}

      <section className="card">
        <SectionHead title={t("rv.needs")} sub={t("rv.needs_sub")} />
        {!corrected ? <p className="locked-note">{t("rv.needs_locked")}</p> : (
          groups.conflicts.size + groups.missing.size + groups.estimates.size === 0 ? <p className="src">{t("risk.none")}</p> : (
            <div className="need-grid">
              {[...groups.conflicts.entries()].map(([f, rs]) => {
                const decided = rs.every((r) => decisions[r.id]);
                return (
                  <article key={f} className="need-card need-conflict">
                    <header><h3>{t(`field.${f}`)}</h3><Chip tone="crit" icon={<IconAlert size={12} />}>{t("rv.conflict")}</Chip></header>
                    <fieldset disabled={readOnly}>
                      <legend>{t("rv.conflict_pick")}</legend>
                      {rs[0].conflictOptions.map((o, i) => (
                        <label key={i} className="option">
                          <input type="radio" name={`c-${f}`} checked={rs.every((r) => decisions[r.id]?.kind === "choose" && (decisions[r.id] as { option: number }).option === i)}
                            onChange={() => setDecisions(Object.fromEntries(rs.map((r) => [r.id, { kind: "choose", option: i } as Decision])))} />
                          <span>
                            <strong>{rs.map((r) => showValue(r.conflictOptions[i]?.value)).join(" · ")}</strong>
                            {o.quote && <blockquote className="evidence"><span>{o.quote}</span><cite>{o.sourceRef ?? ""}</cite></blockquote>}
                          </span>
                        </label>
                      ))}
                    </fieldset>
                    {!readOnly && (
                      <div className="actions">
                        <button type="button" onClick={() => setDecisions(Object.fromEntries(rs.map((r) => [r.id, { kind: "unknown" } as Decision])))}>{t("rv.mark_unknown")}</button>
                        {decided && <button type="button" className="ghost" onClick={() => setDecisions(Object.fromEntries(rs.map((r) => [r.id, null])))}>{t("common.undo")}</button>}
                      </div>
                    )}
                  </article>
                );
              })}

              {[...groups.missing.entries()].map(([f, rs]) => {
                const required = rs.some((r) => needsApproval(r));
                const decidedRows = rs.filter((r) => decisions[r.id]);
                const flag = estimateFlagRow(f);
                return (
                  <article key={f} className="need-card need-missing">
                    <header>
                      <h3>{t(`field.${f}`)}</h3>
                      <Chip tone="muted">{t("rv.missing")}</Chip>
                      {!required && <Chip tone="info">{t("common.optional")}</Chip>}
                    </header>
                    {!required && <p className="src">{t("rv.optional_note")}</p>}
                    {rs.filter((r) => r.kind !== "bool").map((r) => (
                      <div key={r.id} className="need-row">
                        <span className="need-label">{rowLabel(r, t)}</span>
                        {decisions[r.id] ? (
                          <span><strong>{showValue(effective(r, decisions[r.id]), t("common.unknown"))}</strong> <Prov kind={decisions[r.id]!.kind === "correct" ? "user" : "unknown"} />
                            {!readOnly && <button type="button" className="ghost sm" onClick={() => setDecisions({ [r.id]: null })}>{t("common.undo")}</button>}</span>
                        ) : readOnly ? <span className="unknown">{t("common.unknown")}</span> : (
                          <RowInput row={r} onSave={(v) => {
                            const e = save(r, v);
                            if (!e && flag && !decisions[flag.id]) setDecisions({ [flag.id]: { kind: "correct", value: false } });
                            return e;
                          }} />
                        )}
                      </div>
                    ))}
                    {!readOnly && required && decidedRows.length < rs.length && (
                      <button type="button" onClick={() => setDecisions(Object.fromEntries(rs.filter((r) => !decisions[r.id]).map((r) => [r.id, { kind: "unknown" } as Decision])))}>
                        {t("rv.keep_unknown")}
                      </button>
                    )}
                  </article>
                );
              })}

              {[...groups.estimates.entries()].map(([f, rs]) => {
                const amount = rs.find((r) => r.target.type === "cost" ? r.target.sub === "amount" : r.target.sub === "amount") ?? rs[0];
                const flag = estimateFlagRow(f);
                const d = decisions[amount.id];
                return (
                  <article key={f} className="need-card need-estimate">
                    <header><h3>{f.startsWith("cost_items") ? rowLabel(amount, t).replace(/ \(.*\)$/, "") : t(`field.${f}`)}</h3><Chip tone="warn">{t("rv.estimate")}</Chip></header>
                    <p className="big-value">{showValue(effective(amount, d))} {(!d || d.kind === "confirm") && <Prov kind="estimate" />}{d?.kind === "correct" && <Prov kind="user" />}</p>
                    {amount.quote && <blockquote className="evidence"><span>{amount.quote}</span><cite>{amount.sourceRef ?? ""}</cite></blockquote>}
                    {readOnly ? null : d ? (
                      <button type="button" className="ghost sm" onClick={() => setDecisions(Object.fromEntries(rs.map((r) => [r.id, null]).concat(flag ? [[flag.id, null]] : [])))}>{t("common.undo")}</button>
                    ) : editing === f ? (
                      <RowInput row={amount} onSave={(v) => {
                        const e = save(amount, v);
                        if (!e) setDecisions({ ...Object.fromEntries(rs.filter((r) => r.id !== amount.id).map((r) => [r.id, { kind: "confirm" } as Decision])), ...(flag ? { [flag.id]: { kind: "correct", value: false } as Decision } : {}) });
                        return e;
                      }} />
                    ) : (
                      <div className="actions">
                        <button type="button" onClick={() => setDecisions(Object.fromEntries(rs.map((r) => [r.id, { kind: "confirm" } as Decision])))}>{t("rv.keep_estimate")}</button>
                        <button type="button" onClick={() => setEditing(f)}>{t("rv.enter_confirmed")}</button>
                        <button type="button" className="ghost" onClick={() => setDecisions({ [amount.id]: { kind: "unknown" } })}>{t("rv.mark_unknown")}</button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )
        )}
      </section>

      <section className="card">
        <SectionHead title={t("rv.values")} sub={t("rv.values_sub")} />
        {!corrected ? <p className="locked-note">{t("rv.needs_locked")}</p> : (
          <div className="table-wrap">
            <table className="review">
              <thead>
                <tr>
                  <th scope="col">{t("rv.col.field")}</th><th scope="col">{t("rv.col.value")}</th><th scope="col">{t("rv.col.source")}</th>
                  <th scope="col">{t("rv.col.confidence")}</th><th scope="col">{t("rv.col.status")}</th><th scope="col"><span className="sr-only">{t("common.edit")}</span></th>
                </tr>
              </thead>
              <tbody>
                {groups.table.map((r) => {
                  const d = decisions[r.id];
                  const st = d ? rowStatus(r, d) : bulk[r.id] || !needsApproval(r) ? rowStatus(r, bulk[r.id]) : rowStatus(r, d);
                  return (
                    <tr key={r.id}>
                      <th scope="row">{rowLabel(r, t)}</th>
                      <td>{editing === r.id ? <RowInput row={r} onSave={(v) => save(r, v)} /> : (
                        <><span className={effective(r, d) === null ? "unknown" : ""}>{showValue(effective(r, d), t("common.unknown"))}</span>
                          {r.quote && !d && <div className="quote-line">“{r.quote}”</div>}</>
                      )}</td>
                      <td><Prov kind={provFor(r, d)} /></td>
                      <td>{r.confidence ? <span className={`conf conf-${r.confidence}`}><span className="conf-bars" aria-hidden><i /><i /><i /></span>{t(`conf.${r.confidence}`)}</span> : <span className="src">—</span>}</td>
                      <td><span className={`badge badge-${st.toLowerCase()}`}>{t(`rv.status.${st}`)}</span></td>
                      <td>
                        {!readOnly && (d?.kind === "correct"
                          ? <button type="button" className="ghost sm" onClick={() => setDecisions({ [r.id]: null })}>{t("common.undo")}</button>
                          : editing === r.id ? <button type="button" className="ghost sm" onClick={() => setEditing(null)}>{t("common.cancel")}</button>
                          : <button type="button" className="ghost sm" onClick={() => setEditing(r.id)}><IconEdit size={13} /> {t("common.edit")}</button>)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="action-bar sticky">
        <div className="action-bar-left">
          <button type="button" onClick={() => update({ step: 1 })}><IconArrowLeft size={15} /> {t("common.back")}</button>
          {!readOnly && <span className="src">
            {!reviewer.trim() ? t("rv.need_name") : blockerCount > 0 ? t("rv.blockers", { n: blockerCount }) : t("rv.approve_note", { n: Object.keys(bulk).length })}
          </span>}
        </div>
        {readOnly ? (
          <div className="actions">
            <button type="button" onClick={() => update({ approved: null, fx: null, recommendation: { origin: null, state: null, released: null } })} title={t("rv.edit_review_note")}>
              <IconEdit size={15} /> {t("rv.edit_review")}
            </button>
            <button type="button" className="primary" onClick={() => update({ step: 3 })}>{t("common.next")} <IconArrowRight size={15} /></button>
          </div>
        ) : (
          <button type="button" className="primary lg" disabled={!gate.ok || !reviewer.trim()} onClick={approve}>
            <IconCheck size={16} /> {t("rv.approve_continue")}
          </button>
        )}
      </div>
    </div>
  );
}
