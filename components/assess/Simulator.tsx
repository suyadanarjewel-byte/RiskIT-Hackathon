"use client";

import { useMemo, useState } from "react";
import type { ExternalValue } from "../../lib/external";
import { computeFinancials, type CalcAssumptions, type Financials } from "../../lib/financials";
import { formatMoney } from "../../lib/riskCards";
import { BASE_ASSUMPTIONS, factsFromAssessment } from "../../lib/scenarios";
import { buildTimeline } from "../../lib/timeline";
import type { OrderAssessment } from "../../lib/types";
import { useI18n } from "../I18nProvider";
import { SectionHead } from "../ui";

type Key = "deposit_percent" | "fx_move_percent" | "freight_increase_percent" | "late_payment_days" | "platform_fee_percent" | "payment_fee_percent";

interface Control { key: Key; label: string; min: number; max: number; step: number; unit: "%" | "days"; base: number | null }

/** Local, instant recalculation with the deterministic engine. No AI calls; facts are untouched. */
export function WhatIfSimulator({ assessment, fx, base }: { assessment: OrderAssessment; fx: ExternalValue<number> | null; base: Financials }) {
  const { t } = useI18n();
  const facts = useMemo(() => factsFromAssessment(assessment), [assessment]);
  const controls: Control[] = [
    { key: "deposit_percent", label: t("sim.deposit"), min: 0, max: 100, step: 5, unit: "%", base: assessment.deposit_percent.value },
    { key: "fx_move_percent", label: t("sim.fx"), min: -30, max: 30, step: 1, unit: "%", base: 0 },
    { key: "freight_increase_percent", label: t("sim.freight"), min: 0, max: 100, step: 5, unit: "%", base: 0 },
    { key: "late_payment_days", label: t("sim.delay"), min: 0, max: 120, step: 5, unit: "days", base: 0 },
    { key: "platform_fee_percent", label: t("sim.platform"), min: 0, max: 30, step: 0.5, unit: "%", base: assessment.platform_fee.value?.percent ?? null },
    { key: "payment_fee_percent", label: t("sim.payment"), min: 0, max: 10, step: 0.1, unit: "%", base: assessment.payment_fee.value?.percent ?? null },
  ];
  const [vals, setVals] = useState<Partial<Record<Key, number>>>({});
  const changed = (c: Control) => vals[c.key] !== undefined && vals[c.key] !== c.base;
  const anyChanged = controls.some(changed);

  const custom = useMemo(() => {
    const s: CalcAssumptions = { ...BASE_ASSUMPTIONS };
    for (const c of controls) {
      const v = vals[c.key];
      if (v === undefined || v === c.base) continue;
      (s as unknown as Record<string, number>)[c.key] = v;
    }
    return computeFinancials(facts, fx, s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facts, fx, vals]);

  const today = new Date().toISOString().slice(0, 10);
  const lowestBase = buildTimeline(assessment, base, today).lowest_position;
  const lowestCustom = buildTimeline(assessment, custom, today).lowest_position;
  const ccy = base.currency;
  const total = (f: Financials) => (f.direct_costs === null || f.total_expenses === null ? null : f.direct_costs + f.total_expenses);
  const rows: { label: string; b: number | null; c: number | null; pct?: boolean; days?: boolean }[] = [
    { label: t("m.revenue"), b: base.revenue, c: custom.revenue },
    { label: `${t("m.direct_costs")} + ${t("m.total_expenses")}`, b: total(base), c: total(custom) },
    { label: t("m.gross_profit"), b: base.gross_profit, c: custom.gross_profit },
    { label: t("m.net_profit"), b: base.net_profit, c: custom.net_profit },
    { label: t("m.net_margin"), b: base.net_margin_percent, c: custom.net_margin_percent, pct: true },
    { label: t("m.cash_position"), b: base.cash_position, c: custom.cash_position },
    { label: t("tl.lowest"), b: lowestBase, c: lowestCustom },
    { label: t("sim.days_outstanding"), b: base.days_outstanding, c: custom.days_outstanding, days: true },
  ];
  const show = (v: number | null, r: (typeof rows)[number]) =>
    v === null ? t("common.insufficient") : r.pct ? `${v.toFixed(2)}%` : r.days ? t("sim.days", { n: v }) : formatMoney(v, ccy);
  const delta = (r: (typeof rows)[number]) => {
    if (r.b === null || r.c === null) return "—";
    const d = r.c - r.b;
    if (Math.abs(d) < 0.005) return "—";
    return `${d > 0 ? "+" : ""}${r.pct ? `${d.toFixed(2)} pp` : r.days ? t("sim.days", { n: d }) : formatMoney(d, ccy)}`;
  };

  return (
    <section className="card" aria-labelledby="sim-title">
      <SectionHead id="sim-title" title={t("sim.title")} sub={t("sim.sub")}
        actions={<button type="button" className="ghost" onClick={() => setVals({})} disabled={!anyChanged}>{t("sim.reset")}</button>} />
      <div className="sim-grid">
        <div className="sim-controls">
          {controls.map((c) => {
            const v = vals[c.key] ?? c.base ?? (c.key === "deposit_percent" ? 0 : c.min);
            const id = `sim-${c.key}`;
            const valueText = c.unit === "days" ? t("sim.days", { n: v }) : `${v}%`;
            return (
              <div key={c.key} className={`sim-control ${changed(c) ? "is-changed" : ""}`}>
                <div className="sim-label">
                  <label htmlFor={id}>{c.label}</label>
                  {changed(c) && <span className="chip chip-warn">{t("sim.badge")}</span>}
                  {c.base === null && !changed(c) && <span className="chip chip-muted">{t("common.unknown")}</span>}
                </div>
                <div className="sim-inputs">
                  <input id={id} type="range" min={c.min} max={c.max} step={c.step} value={v} aria-valuetext={valueText}
                    onChange={(e) => setVals({ ...vals, [c.key]: Number(e.target.value) })} />
                  <input type="number" className="sim-number" min={c.min} max={c.max} step={c.step} value={v}
                    aria-label={`${c.label} (${c.unit === "days" ? t("sim.days", { n: "" }).trim() : "%"})`}
                    onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) setVals({ ...vals, [c.key]: Math.min(c.max, Math.max(c.min, n)) }); }} />
                  <span className="sim-unit">{c.unit === "days" ? t("sim.days", { n: "" }).trim() : "%"}</span>
                </div>
              </div>
            );
          })}
        </div>
        <div className="sim-results">
          <table className="compare" aria-live="polite">
            <thead><tr><th scope="col">{t("sim.metric")}</th><th scope="col">{t("sim.base")}</th><th scope="col">{t("sim.custom")}</th><th scope="col">{t("sim.change")}</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label}>
                  <th scope="row">{r.label}</th>
                  <td className="num">{show(r.b, r)}</td>
                  <td className={`num ${anyChanged ? "is-hypo" : ""}`}>{show(r.c, r)}</td>
                  <td className={`num ${r.b !== null && r.c !== null && r.c - r.b < -0.005 ? "neg" : r.b !== null && r.c !== null && r.c - r.b > 0.005 ? "pos" : ""}`}>{delta(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="src">{anyChanged ? t("sim.changed") : t("sim.no_change")}</p>
        </div>
      </div>
    </section>
  );
}
