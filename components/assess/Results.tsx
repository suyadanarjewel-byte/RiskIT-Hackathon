"use client";

/**
 * Step 3: financial results, built only from the human-approved assessment.
 * Order: exchange rate -> financial results -> Order Decision Indicator -> payment timeline ->
 * What-If Simulator -> risk explanations -> recommendations -> PDF report. All numbers come from
 * the deterministic engine; the exchange rate is retrieved server-side (/api/fx).
 */
import { useEffect, useMemo, useState } from "react";
import type { RateLookupResult } from "../../lib/external";
import type { Financials } from "../../lib/financials";
import { buildRiskCards, orderIndicator, type Msg, type OrderIndicator } from "../../lib/riskCards";
import { factsFromAssessment, runScenarios } from "../../lib/scenarios";
import type { AssessmentSession } from "../../lib/store";
import { buildTimeline } from "../../lib/timeline";
import { useI18n } from "../I18nProvider";
import { IconAlert, IconArrowLeft, IconCalc, IconCheck, IconDownload, IconGlobe, IconInfo, LoadingCard } from "../Icons";
import { ScenarioChart } from "../dashboard/ScenarioChart";
import { Banner, Chip, Prov, SectionHead, useFormat } from "../ui";
import { AuditLog } from "./AuditLog";
import { CalculationsDialog } from "./Calculations";
import { Recommendations } from "./Recommendations";
import { RiskSection } from "./Risks";
import { WhatIfSimulator } from "./Simulator";
import { PaymentTimeline } from "./Timeline";

type Update = (p: Partial<AssessmentSession> | ((s: AssessmentSession) => AssessmentSession)) => void;

export function useMsg() {
  const { t } = useI18n();
  return (m: Msg) => t(m.key, m.params);
}

// ---------- Exchange rate ----------

function FxPanel({ session, update }: { session: AssessmentSession; update: Update }) {
  const { t } = useI18n();
  const fmt = useFormat();
  const a = session.approved!.assessment;
  const from = a.sales_currency.value;
  const to = a.reporting_currency.value;
  const [manual, setManual] = useState("");
  const [loading, setLoading] = useState(false);
  const fx = session.fx;

  const load = async (manualRate?: number) => {
    if (!from || !to) return;
    setLoading(true);
    try {
      const q = new URLSearchParams({ from, to, ...(manualRate ? { manual: String(manualRate) } : {}) });
      const res = await fetch(`/api/fx?${q}`);
      const body = await res.json();
      update({ fx: res.ok ? (body.result as RateLookupResult) : { status: "unavailable", rate: null, reason: body.error ?? "error" } });
    } catch {
      update({ fx: { status: "unavailable", rate: null, reason: t("err.network") } });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!fx && from && to) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fx, from, to]);

  if (!from || !to) return <Banner tone="pending" title={t("fx.unavailable_title")}>{t("common.missing", { fields: [!from && "@field.sales_currency", !to && "@field.reporting_currency"].filter(Boolean).join(", ") })}</Banner>;
  if (!fx || loading) return <div className="card fx-card" role="status"><span className="spinner" aria-hidden /> {t("fx.loading")}</div>;

  const r = fx.rate;
  const label = r?.reliability === "cached" ? t("fx.cached") : r?.reliability === "user-provided fallback" ? t("fx.manual")
    : r?.reliability === "exact (same currency)" ? t("fx.exact") : r?.reliability === "illustrative sample" ? t("fx.sample") : t("fx.indicative");
  const tone = r?.reliability === "cached" || r?.reliability === "user-provided fallback" ? "warn" : r ? "good" : "crit";

  return (
    <section className={`card fx-card fx-${tone}`} aria-labelledby="fx-title">
      <div className="fx-main">
        <span className="icon-tile"><IconGlobe size={18} /></span>
        <div>
          <h2 id="fx-title" className="fx-title">{t("fx.title")}</h2>
          {r ? (
            from === to ? <p>{t("fx.same", { ccy: to })}</p> : (
              <p className="fx-rate"><strong>{t("fx.pair", { from, to, rate: r.value })}</strong> <Chip tone={tone === "good" ? "good" : "warn"}>{label}</Chip></p>
            )
          ) : <p><strong>{t("fx.unavailable_title")}</strong></p>}
        </div>
      </div>
      {r && from !== to && (
        <dl className="fx-meta">
          <div><dt>{t("fx.source")}</dt><dd>{r.source}</dd></div>
          {r.as_of && <div><dt>{t("fx.as_of")}</dt><dd>{r.as_of}</dd></div>}
          <div><dt>{t("fx.retrieved")}</dt><dd>{fmt.when(r.retrieved_at)}</dd></div>
        </dl>
      )}
      {r && from !== to && <p className="src"><IconInfo size={13} /> {r.reliability === "cached" ? t("fx.cached_note", { when: fmt.when(r.retrieved_at) }) : r.reliability === "user-provided fallback" ? t("fx.manual_note") : t("fx.not_bank")}</p>}
      {!r && (
        <div className="fx-fallback">
          <p>{t("fx.unavailable_body", { from, to })}</p>
          <form className="row-input" onSubmit={(e) => { e.preventDefault(); const n = Number(manual); if (n > 0) void load(n); }}>
            <label className="field"><span>{t("fx.manual_label", { from, to })}</span>
              <input inputMode="decimal" value={manual} onChange={(e) => setManual(e.target.value)} /></label>
            <button type="submit" disabled={!(Number(manual) > 0)}>{t("fx.manual_apply")}</button>
          </form>
          <p className="src">{t("fx.manual_note")}</p>
        </div>
      )}
      {(!r || r.reliability === "cached" || r.reliability === "user-provided fallback") && (
        <button type="button" className="ghost sm" onClick={() => update({ fx: null })}>{t("fx.retry")}</button>
      )}
    </section>
  );
}

// ---------- Metric cards ----------

function MetricCards({ fin, onCalc }: { fin: Financials; onCalc: () => void }) {
  const { t } = useI18n();
  const fmt = useFormat();
  const ccy = fin.currency;
  const missing = fin.missing.length ? t("common.missing", { fields: fin.missing.map((m) => `@field.${m}`).join(", ") }) : "";
  const card = (key: string, value: number | null, kind: "money" | "pct", opts: { hint?: string; emphasis?: boolean } = {}) => (
    <div className={`metric ${opts.emphasis ? "metric-hero" : ""} ${value !== null && value < 0 ? "metric-neg" : ""}`}>
      <div className="metric-label">{t(key)}</div>
      <div className={`metric-value ${value === null ? "metric-na" : ""}`}>{kind === "money" ? fmt.money(value, ccy) : fmt.pct(value)}</div>
      {value === null ? <div className="metric-hint warn"><IconAlert size={12} /> {missing}</div> : opts.hint && <div className="metric-hint">{opts.hint}</div>}
    </div>
  );
  return (
    <section className="card" aria-labelledby="fin-title">
      <SectionHead id="fin-title" title={t("res.title")}
        actions={<button type="button" className="primary" onClick={onCalc}><IconCalc size={15} /> {t("res.view_calc")}</button>} />
      <h3 className="metric-group">{t("res.profit")}</h3>
      <div className="metrics">
        {card("m.revenue", fin.revenue, "money", { hint: t("m.hint.revenue", { ccy }) })}
        {card("m.direct_costs", fin.direct_costs, "money", { hint: t("m.hint.direct_costs") })}
        {card("m.gross_profit", fin.gross_profit, "money", { emphasis: true })}
        {card("m.gross_margin", fin.gross_margin_percent, "pct")}
        {card("m.total_expenses", fin.total_expenses, "money", { hint: t("m.hint.total_expenses") })}
        {card("m.net_profit", fin.net_profit, "money", { emphasis: true })}
        {card("m.net_margin", fin.net_margin_percent, "pct")}
      </div>
      <h3 className="metric-group">{t("res.cash")}</h3>
      <div className="metrics metrics-3">
        {card("m.cash_in", fin.cash_inflows, "money")}
        {card("m.cash_out", fin.cash_outflows, "money", { hint: t("m.hint.cash_out") })}
        {card("m.cash_position", fin.cash_position, "money", { emphasis: true })}
      </div>
      <p className="note-info"><IconInfo size={14} /> {t("res.profit_vs_cash")}</p>
    </section>
  );
}

// ---------- Order decision indicator ----------

function DecisionIndicator({ ind }: { ind: OrderIndicator }) {
  const { t } = useI18n();
  const msg = useMsg();
  const tone = { lower: "good", moderate: "warn", higher: "crit", insufficient: "muted" }[ind.level];
  return (
    <section className={`card indicator indicator-${tone}`} aria-labelledby="ind-title">
      <div className="indicator-head">
        <div>
          <h2 id="ind-title">{t("ind.title")}</h2>
          <p className={`indicator-level level-${tone}`}>
            <span className="level-icon" aria-hidden>{ind.level === "lower" ? <IconCheck size={16} /> : <IconAlert size={16} />}</span>
            {t(`ind.level.${ind.level}`)}
          </p>
        </div>
      </div>
      <div className="indicator-body">
        <div>
          <h3>{t("ind.why")}</h3>
          <ul>{ind.reasons.map((r, i) => <li key={i}>{msg(r)}</li>)}</ul>
        </div>
        <div className="next-step">
          <h3>{t("ind.next")}</h3>
          <ul>{ind.next_steps.map((s, i) => <li key={i}><IconCheck size={14} /> {msg(s)}</li>)}</ul>
        </div>
      </div>
      <p className="src disclaimer-line">{t("ind.disclaimer")}</p>
    </section>
  );
}

// ---------- Step 3 ----------

export function Results({ session, update }: { session: AssessmentSession; update: Update }) {
  const { t, lang } = useI18n();
  const fmt = useFormat();
  const [calcOpen, setCalcOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const approved = session.approved!;
  const a = approved.assessment;
  const rate = session.fx?.rate ?? null;

  const model = useMemo(() => {
    const scenarios = runScenarios(factsFromAssessment(a), rate);
    const base = scenarios.find((s) => s.id === "base")!;
    const timeline = buildTimeline(a, base.financials, new Date().toISOString().slice(0, 10), session.received);
    const cards = buildRiskCards(a, scenarios, rate, timeline);
    const indicator = orderIndicator(a, cards, base, timeline);
    return { scenarios, base, timeline, cards, indicator };
  }, [a, rate, session.received]);

  const exportPdf = async () => {
    setExporting(true);
    try {
      const { generateReport } = await import("../../lib/report");
      generateReport({ session, ...model }, lang);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="step-body">
      <div className="results-bar">
        <div>
          <Banner tone="success" title={t("res.approved")}>
            {t("rv.approved_by", { who: a.approved_by ?? "", when: fmt.when(a.approval_timestamp) })} · <Prov kind="final_approved" />
          </Banner>
        </div>
        <div className="actions">
          <button type="button" onClick={() => update({ step: 2 })}><IconArrowLeft size={15} /> {t("common.back")}</button>
          <button type="button" onClick={() => setCalcOpen(true)} disabled={!session.fx}><IconCalc size={15} /> {t("res.view_calc")}</button>
          <button type="button" className="primary" onClick={exportPdf} disabled={!session.fx || exporting} title={t("res.pdf_lang_note")}>
            <IconDownload size={15} /> {exporting ? t("res.exporting") : t("res.export")}
          </button>
        </div>
      </div>
      {!["en", "id"].includes(lang) && <p className="src pdf-note"><IconInfo size={13} /> {t("res.pdf_lang_note")}</p>}

      <FxPanel session={session} update={update} />

      {!session.fx ? <LoadingCard label={t("fx.loading")} /> : (
        <>
          <MetricCards fin={model.base.financials} onCalc={() => setCalcOpen(true)} />
          <DecisionIndicator ind={model.indicator} />
          <PaymentTimeline timeline={model.timeline} currency={a.reporting_currency.value}
            received={session.received} onToggle={(id) => update((s) => ({ ...s, received: { ...s.received, [id]: !s.received[id] } }))} />
          <WhatIfSimulator assessment={a} fx={rate} base={model.base.financials} />
          <section className="card" aria-labelledby="sc-title">
            <SectionHead id="sc-title" title={t("sc.title")} sub={t("sc.sub")} />
            <ScenarioChart scenarios={model.scenarios.filter((s) => s.id !== "custom")} currency={a.reporting_currency.value} />
          </section>
          <RiskSection cards={model.cards} />
          <Recommendations session={session} update={update} />
          <AuditLog entries={[...approved.audit, ...(session.recommendation.state?.audit ?? [])]} />
          <CalculationsDialog open={calcOpen} onClose={() => setCalcOpen(false)} fin={model.base.financials} fx={session.fx} />
        </>
      )}
    </div>
  );
}
