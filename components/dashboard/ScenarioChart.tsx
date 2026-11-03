"use client";

/**
 * Scenario comparison: two small multiples on separate axes (never a dual axis).
 *  - Net profit: diverging bars from a zero baseline (blue = profit, red = loss).
 *  - Cash at risk: single-hue bars.
 * Inline SVG; hover/focus tooltip; selective direct labels; table view below.
 * Colors are the reference palette's diverging pair and sequential blue (light mode).
 */
import { useState } from "react";
import { useI18n } from "../I18nProvider";
import { formatMoney } from "../../lib/riskCards";
import type { ScenarioResult } from "../../lib/scenarios";

const W = 640;
const LABEL_W = 168;
const RIGHT_PAD = 84;
const ROW = 34;
const BAR = 16;
const TOP = 6;
const AXIS_H = 22;

function niceStep(range: number, count: number): number {
  const raw = range / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
}

/** Horizontal bar path: square at the baseline (x0), 4px rounded data end (x1). */
function barPath(x0: number, x1: number, y: number, h: number): string {
  const w = Math.abs(x1 - x0);
  const r = Math.min(4, w / 2, h / 2);
  if (x1 >= x0) {
    return `M${x0},${y}H${x1 - r}Q${x1},${y} ${x1},${y + r}V${y + h - r}Q${x1},${y + h} ${x1 - r},${y + h}H${x0}Z`;
  }
  return `M${x0},${y}H${x1 + r}Q${x1},${y} ${x1},${y + r}V${y + h - r}Q${x1},${y + h} ${x1 + r},${y + h}H${x0}Z`;
}

interface PanelProps {
  title: string;
  names: string[];
  values: (number | null)[];
  currency: string | null;
  diverging: boolean;
  /** Indices that get a direct value label (selective, not every bar). */
  labelled: number[];
  gaps: string[][];
}

function Panel({ title, names, values, currency, diverging, labelled, gaps }: PanelProps) {
  const { t } = useI18n();
  const [hover, setHover] = useState<number | null>(null);
  const known = values.filter((v): v is number => v !== null);
  let lo = Math.min(0, ...known);
  let hi = Math.max(0, ...known);
  if (lo === hi) hi = lo + 1;
  const step = niceStep(hi - lo, 4);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const x = (v: number) => LABEL_W + ((v - lo) / (hi - lo)) * (W - LABEL_W - RIGHT_PAD);
  const ticks: number[] = [];
  for (let t = lo; t <= hi + step / 2; t += step) ticks.push(Math.round(t * 1e6) / 1e6);
  const H = TOP + names.length * ROW + AXIS_H;
  const fmt = (v: number | null) => formatMoney(v, currency);
  const color = (v: number) => (!diverging || v >= 0 ? "var(--viz-pos)" : "var(--viz-neg)");

  const summary = names.map((n, i) => `${n}: ${fmt(values[i])}`).join("; ");

  return (
    <figure className="viz-panel">
      <figcaption className="viz-title">
        {title} <span className="src">({currency ?? "reporting currency"})</span>
      </figcaption>
      {diverging && (
        <div className="viz-legend" aria-hidden>
          <span><i className="swatch" style={{ background: "var(--viz-pos)" }} />{t("sc.profit_legend")}</span>
          <span><i className="swatch" style={{ background: "var(--viz-neg)" }} />{t("sc.loss_legend")}</span>
        </div>
      )}
      <div className="viz-plot">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${title}. ${summary}`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={x(t)} x2={x(t)} y1={TOP} y2={TOP + names.length * ROW}
                stroke={t === 0 ? "var(--viz-baseline)" : "var(--viz-grid)"} strokeWidth={1} />
              <text x={x(t)} y={H - 6} textAnchor="middle" className="viz-tick">{fmt(t)}</text>
            </g>
          ))}
          {names.map((name, i) => {
            const v = values[i];
            const y = TOP + i * ROW + (ROW - BAR) / 2;
            const active = hover === i;
            return (
              <g key={name}
                tabIndex={0}
                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(i)} onBlur={() => setHover(null)}
                className="viz-row">
                {/* hit target: the whole row */}
                <rect x={0} y={TOP + i * ROW} width={W} height={ROW} fill={active ? "var(--viz-hover)" : "transparent"} />
                <text x={LABEL_W - 10} y={y + BAR / 2 + 4} textAnchor="end" className="viz-label">{name}</text>
                {v === null ? (
                  <text x={x(0) + 6} y={y + BAR / 2 + 4} className="viz-unknown">{t("common.unknown")}</text>
                ) : (
                  <path d={barPath(x(0), x(v), y, BAR)} fill={color(v)} />
                )}
                {v !== null && labelled.includes(i) && (
                  <text x={v >= 0 ? x(v) + 6 : x(v) - 6} y={y + BAR / 2 + 4} textAnchor={v >= 0 ? "start" : "end"} className="viz-value">
                    {fmt(v)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        {hover !== null && (
          <div className="viz-tooltip" role="status"
            style={{ left: `${(LABEL_W / W) * 100}%`, top: `${((TOP + (hover + 1) * ROW) / H) * 100}%` }}>
            <strong>{names[hover]}</strong>
            <div>{title}: {fmt(values[hover])}</div>
            <div className="src">{t("prov.assumption")}</div>
          </div>
        )}
      </div>
    </figure>
  );
}

export function ScenarioChart({ scenarios, currency }: { scenarios: ScenarioResult[]; currency: string | null }) {
  const { t } = useI18n();
  const names = scenarios.map((s) => t(`sc.${s.id}`));
  const profit = scenarios.map((s) => s.net_profit.value);
  const cash = scenarios.map((s) => s.cash_at_risk.value);
  const gaps = scenarios.map((s) => s.data_gaps);
  const idxOf = (vals: (number | null)[], pick: (a: number, b: number) => boolean) => {
    let best = -1;
    vals.forEach((v, i) => { if (v !== null && (best < 0 || pick(v, vals[best] as number))) best = i; });
    return best;
  };
  const base = scenarios.findIndex((s) => s.id === "base");
  const worstProfit = idxOf(profit, (a, b) => a < b);
  const mostCash = idxOf(cash, (a, b) => a > b);

  return (
    <div className="viz-root">
      <div className="viz-grid2">
        <Panel title={t("sc.profit")} names={names} values={profit} currency={currency} diverging
          labelled={[base, worstProfit].filter((i) => i >= 0)} gaps={gaps} />
        <Panel title={t("sc.cash")} names={names} values={cash} currency={currency} diverging={false}
          labelled={[base, mostCash].filter((i) => i >= 0)} gaps={gaps} />
      </div>
      <details className="viz-table">
        <summary>{t("sc.table")}</summary>
        <table className="review">
          <thead>
            <tr><th>{t("sc.col.scenario")}</th><th>{t("m.revenue")}</th><th>{t("m.gross_profit")}</th><th>{t("m.net_profit")}</th><th>{t("m.net_margin")}</th><th>{t("m.cash_position")}</th><th>{t("metric.cash_at_risk")}</th></tr>
          </thead>
          <tbody>
            {scenarios.map((s) => (
              <tr key={s.id}>
                <th scope="row">{t(`sc.${s.id}`)}</th>
                <td className="num">{formatMoney(s.expected_revenue.value, currency)}</td>
                <td className="num">{formatMoney(s.financials.gross_profit, currency)}</td>
                <td className="num">{formatMoney(s.net_profit.value, currency)}</td>
                <td className="num">{s.profit_margin_percent.value === null ? t("common.insufficient") : `${s.profit_margin_percent.value}%`}</td>
                <td className="num">{formatMoney(s.financials.cash_position, currency)}</td>
                <td className="num">{formatMoney(s.cash_at_risk.value, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
