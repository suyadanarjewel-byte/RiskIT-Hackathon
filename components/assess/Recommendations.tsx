"use client";

import { useState } from "react";
import { simulatedRecommendationDraft } from "../../lib/demo/simulatedRecommendation";
import {
  canReleaseRecommendation, draftItems, recordItemDecision, releaseRecommendation, startRecommendationReview,
  validateRecommendationDraft, type DraftItemView, type ItemDecisionInput,
} from "../../lib/recommendation";
import { prepareRecommendationInput } from "../../lib/recommendationInput";
import { getReviewer } from "../../lib/store";
import type { AssessmentSession } from "../../lib/store";
import type { DraftEvidence, RecommendationDraft } from "../../lib/types";
import { useI18n } from "../I18nProvider";
import { IconCheck, IconEdit, IconSparkle } from "../Icons";
import { useAiStatus } from "../useAiStatus";
import { Banner, Chip, Prov, SectionHead, useFormat } from "../ui";
import { ApiError, postJson } from "./Wizard";

type Update = (p: Partial<AssessmentSession> | ((s: AssessmentSession) => AssessmentSession)) => void;

/** Readable names for evidence references (never translates figures or quotes). */
export function useRefLabel() {
  const { t } = useI18n();
  return (ref: string): string => {
    const [kind, a, b] = ref.split(":");
    switch (kind) {
      case "field": return t(`field.${a}`);
      case "scenario": return t(`sc.${a}`);
      case "external": return a === "country" ? b : t("field.fx_rate");
      case "missing": return t("common.missing", { fields: `@field.${a}` });
      case "conflict": return `${t("rv.conflict")}: ${t(`field.${a}`)}`;
      case "finding": return t("rv.findings");
      case "cost": return t("field.cost_items");
      case "calc": return a === "timeline" ? t("tl.title") : a === "indicator" ? t("ind.title") : t("res.title");
      default: return ref;
    }
  };
}

function Evidence({ items }: { items: DraftEvidence[] }) {
  const { t } = useI18n();
  const refLabel = useRefLabel();
  return <p className="src"><strong>{t("rec.evidence")}:</strong> {Array.from(new Set(items.map((e) => refLabel(e.ref)))).join(" · ")}</p>;
}

function ItemCard({ item, decided, onDecide, disabled }: {
  item: DraftItemView; decided: { decision: string; new_value: unknown; reason: string | null } | null;
  onDecide: (input: ItemDecisionInput) => string | null; disabled: boolean;
}) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"none" | "edit" | "reject">("none");
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const submit = (input: ItemDecisionInput) => { const e = onDecide(input); setErr(e); if (!e) setMode("none"); };
  const kindLabel = { risk_flag: t("rec.flags"), narrative: t("rec.narrative"), recommendation: t("rec.actions"), uncertainty: t("rec.uncertainties") }[item.kind];

  return (
    <article className={`rec-item ${decided ? "is-decided" : ""}`}>
      <header>
        <span className="rec-kind">{kindLabel}</span>
        <Prov kind="ai_original" />
        <Chip tone="muted">{t("rec.confidence", { level: t(`conf.${item.confidence}`) })}</Chip>
      </header>
      <p className="rec-text">{decided?.decision === "edit" ? String(decided.new_value) : item.text}</p>
      {item.kind === "recommendation" && <p className="src"><strong>{t("rec.why")}:</strong> {item.heading.split(": ").slice(1).join(": ")}</p>}
      <Evidence items={item.evidence} />
      {decided ? (
        <p className={`decided decided-${decided.decision}`}>
          {decided.decision === "reject" ? "✕" : <IconCheck size={13} />} {t(`rec.decided.${decided.decision}`)}{decided.reason ? ` · “${decided.reason}”` : ""}
        </p>
      ) : mode === "none" ? (
        <div className="actions">
          <button type="button" className="primary" disabled={disabled} onClick={() => submit({ decision: "approve" })}><IconCheck size={14} /> {t("rec.approve")}</button>
          <button type="button" disabled={disabled} onClick={() => { setMode("edit"); setText(item.text); }}><IconEdit size={14} /> {t("common.edit")}</button>
          <button type="button" className="ghost" disabled={disabled} onClick={() => { setMode("reject"); setText(""); }}>{t("rec.reject")}</button>
        </div>
      ) : (
        <form className="value-editor" onSubmit={(e) => { e.preventDefault(); submit(mode === "edit" ? { decision: "edit", text } : { decision: "reject", reason: text }); }}>
          <label className="field"><span>{mode === "reject" ? t("rec.reject_reason") : t("common.edit")}</span>
            <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} required /></label>
          <div className="actions">
            <button type="submit" className="primary" disabled={!text.trim()}>{t("rec.record")}</button>
            <button type="button" onClick={() => setMode("none")}>{t("common.cancel")}</button>
          </div>
        </form>
      )}
      {err && <p className="error" role="alert">{err === "Enter your name as reviewer" ? t("rv.need_name") : err}</p>}
    </article>
  );
}

export function Recommendations({ session, update }: { session: AssessmentSession; update: Update }) {
  const { t, lang } = useI18n();
  const fmt = useFormat();
  const { status } = useAiStatus();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ message: string; details: string[] } | null>(null);
  const [reviewer, setReviewerState] = useState(() => getReviewer() || session.approved?.assessment.approved_by || "");
  const rec = session.recommendation;
  const a = session.approved!.assessment;
  const containment = session.containment!;
  const live = status?.live_ai === true;
  const allowSimulated = session.mode === "test";

  const start = (draft: RecommendationDraft, origin: AssessmentSession["recommendation"]["origin"], model: string) =>
    update({ recommendation: { origin, state: startRecommendationReview(a.id, draft, model), released: null } });

  const generate = async () => {
    setLoading(true);
    setError(null);
    try {
      const fx = session.fx;
      const { data, headers } = await postJson<RecommendationDraft>("/api/recommendation", {
        assessment: a, verification: containment.verification, verifier_decisions: containment.decisions, language: lang,
        ...(fx?.rate?.reliability === "user-provided fallback" ? { manual_fx_rate: fx.rate.value } : {}),
      });
      const model = headers.get("x-riskit-model") ?? "AI";
      start(data, { kind: "live", model }, model);
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError("generic");
      setError({ message: err.message === "network" ? t("err.network") : err.message, details: err.details });
    } finally {
      setLoading(false);
    }
  };

  const useSimulated = () => {
    const input = prepareRecommendationInput(a, containment.verification, containment.decisions, session.fx);
    const v = validateRecommendationDraft(simulatedRecommendationDraft(), input);
    if (!v.ok) { setError({ message: t("rec.error"), details: v.errors }); return; }
    start(v.value, { kind: "simulated" }, "simulated-test-draft");
  };

  const originLabel = rec.origin?.kind === "simulated"
    ? <Chip tone="warn">{t("rec.simulated_label")}</Chip>
    : rec.origin?.kind === "live" ? <Chip tone="info"><IconSparkle size={12} /> {t("rec.live_label", { model: rec.origin.model })}</Chip> : null;

  // Released (human-approved) view
  if (rec.released) {
    const r = rec.released;
    const block = (title: string, items: { text: string; edited: boolean; evidence: DraftEvidence[]; why?: string }[]) => items.length > 0 && (
      <div className="released-group">
        <h3>{title}</h3>
        <ul>{items.map((x, i) => (
          <li key={i}>
            <p>{x.text}</p>
            {x.why && <p className="src"><strong>{t("rec.why")}:</strong> {x.why}</p>}
            <Evidence items={x.evidence} />
            <span className="prov-row"><Prov kind="final_approved" />{x.edited && <Prov kind="human_edit" />}</span>
          </li>
        ))}</ul>
      </div>
    );
    return (
      <section className="card" aria-labelledby="rec-title">
        <SectionHead id="rec-title" title={t("rec.approved_title")} sub={t("rec.approved_by", { who: r.reviewed_by, when: fmt.when(r.reviewed_at) })} actions={originLabel} />
        {block(t("rec.actions"), r.recommendations.map((x) => ({ text: x.action, edited: x.human_edited, evidence: x.evidence, why: x.rationale })))}
        {block(t("rec.flags"), r.risk_flags.map((x) => ({ text: `${x.title}. ${x.explanation}`, edited: x.human_edited, evidence: x.evidence })))}
        {block(t("rec.narrative"), r.narrative.map((x) => ({ text: x.text, edited: x.human_edited, evidence: x.evidence })))}
        {block(t("rec.uncertainties"), r.uncertainties.map((x) => ({ text: x.text, edited: x.human_edited, evidence: x.evidence })))}
      </section>
    );
  }

  // Draft under review
  if (rec.state) {
    const st = rec.state;
    const gate = canReleaseRecommendation(st);
    const items = draftItems(st.draft);
    const decide = (id: string, input: ItemDecisionInput) => {
      const r = recordItemDecision(st, id, input, reviewer);
      if (!r.ok) return r.error;
      update({ recommendation: { ...rec, state: r.state } });
      return null;
    };
    const release = () => {
      const r = releaseRecommendation(st, reviewer);
      update({ recommendation: { ...rec, state: { ...st, audit: r.audit }, released: r.released } });
    };
    return (
      <section className="card" aria-labelledby="rec-title">
        <SectionHead id="rec-title" title={t("rec.title")} sub={t("rec.sub")} actions={originLabel} />
        <Banner tone="pending" title={t("rec.draft_title")}>{t("rec.draft_body")}</Banner>
        <label className="field reviewer-field">
          <span>{t("common.reviewer")} <span className="req" aria-hidden>*</span></span>
          <input value={reviewer} onChange={(e) => setReviewerState(e.target.value)} autoComplete="name" required />
        </label>
        <div className="rec-list">
          {items.map((item) => {
            const d = st.decisions.find((x) => x.target.ref === item.id) ?? null;
            return <ItemCard key={item.id} item={item} decided={d} onDecide={(input) => decide(item.id, input)} disabled={!reviewer.trim()} />;
          })}
        </div>
        <div className="action-bar">
          <span className="src">{gate.ok ? "" : t("rec.pending", { n: gate.blockers.length })}</span>
          <button type="button" className="primary" disabled={!gate.ok || !reviewer.trim()} onClick={release}><IconCheck size={15} /> {t("rec.release")}</button>
        </div>
      </section>
    );
  }

  // Not drafted yet
  return (
    <section className="card" aria-labelledby="rec-title">
      <SectionHead id="rec-title" title={t("rec.title")} sub={t("rec.sub")} />
      {!live && !allowSimulated && <p className="note-info">{t("rec.needs_ai")}</p>}
      <div className="actions">
        {live && (
          <button type="button" className="primary" onClick={generate} disabled={loading}>
            <IconSparkle size={15} /> {loading ? t("rec.generating") : t("rec.generate")}
          </button>
        )}
        {allowSimulated && <button type="button" onClick={useSimulated} disabled={loading}>{t("rec.simulated")}</button>}
      </div>
      {loading && <p className="src" role="status"><span className="spinner sm" aria-hidden /> {t("rec.generating")}</p>}
      {error && (
        <div className="error-card" role="alert">
          <strong>{t("rec.error")}</strong>
          <p>{error.message}</p>
          {error.details.length > 0 && <ul>{error.details.slice(0, 6).map((d) => <li key={d}>{d}</li>)}</ul>}
        </div>
      )}
    </section>
  );
}
