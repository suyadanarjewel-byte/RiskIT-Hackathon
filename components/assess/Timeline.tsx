"use client";

import type { Timeline, TimelineEvent, TimelineEventId } from "../../lib/timeline";
import { formatMoney } from "../../lib/riskCards";
import { useI18n } from "../I18nProvider";
import { IconAlert, IconArrowLeft, IconArrowRight, IconCheck, IconClock, IconInfo } from "../Icons";
import { Chip, SectionHead } from "../ui";

const STATUS_TONE = { received: "good", expected: "info", upcoming: "info", overdue_unconfirmed: "crit", unknown_date: "muted" } as const;

/** Small step chart of the running cash position (only when every amount is known). */
function PositionChart({ events, currency }: { events: TimelineEvent[]; currency: string | null }) {
  const pts = events.map((e) => e.running_position);
  if (pts.some((p) => p === null)) return null;
  const vals = [0, ...(pts as number[])];
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const W = 640, H = 150, P = 28;
  const x = (i: number) => P + (i * (W - 2 * P)) / (vals.length - 1);
  const y = (v: number) => (hi === lo ? H / 2 : P / 2 + ((hi - v) * (H - P)) / (hi - lo));
  let d = `M${x(0)},${y(vals[0])}`;
  for (let i = 1; i < vals.length; i++) d += ` H${x(i)} V${y(vals[i])}`;
  const desc = events.map((e, i) => `${e.id}: ${formatMoney(pts[i], currency)}`).join("; ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={desc} className="pos-chart">
      <line x1={P} x2={W - P} y1={y(0)} y2={y(0)} className="pos-zero" />
      <path d={d} className="pos-line" fill="none" />
      {vals.slice(1).map((v, i) => (
        <circle key={i} cx={x(i + 1)} cy={y(v)} r={4} className={v < 0 ? "pos-dot neg" : "pos-dot"} />
      ))}
      <text x={P} y={y(0) - 6} className="pos-label">0</text>
      <text x={W - P} y={y(lo) + (lo < 0 ? 16 : -6)} textAnchor="end" className="pos-label">{formatMoney(lo, currency)}</text>
    </svg>
  );
}

export function PaymentTimeline({ timeline, currency, received, onToggle }: {
  timeline: Timeline; currency: string | null; received: Partial<Record<TimelineEventId, boolean>>; onToggle: (id: TimelineEventId) => void;
}) {
  const { t } = useI18n();
  const timing = (e: TimelineEvent) => {
    if (e.date) return e.date;
    if (e.timing.kind === "relative" && e.timing.days !== undefined) return t("tl.relative", { days: e.timing.days });
    if (e.id === "deposit_received" || e.id === "production_costs") return `${t("tl.before_shipment")} · ${t("tl.status.unknown_date")}`;
    if (e.id === "freight_paid") return `${t("tl.at_shipment")} · ${t("tl.status.unknown_date")}`;
    return t("tl.status.unknown_date");
  };
  const lowest = timeline.lowest_position;

  return (
    <section className="card" aria-labelledby="tl-title">
      <SectionHead id="tl-title" title={t("tl.title")} sub={t("tl.sub")} />
      {lowest === null ? (
        <p className="note-warn"><IconAlert size={14} /> {t("tl.unknown_position")}</p>
      ) : lowest < 0 ? (
        <p className="note-warn"><IconAlert size={14} /> {t("tl.shortfall", { amount: formatMoney(-lowest, currency) })}</p>
      ) : <p className="note-good"><IconCheck size={14} /> {t("tl.no_shortfall")}</p>}

      <ol className="timeline">
        {timeline.events.map((e) => {
          const st = e.status;
          return (
            <li key={e.id} className={`tl-event tl-${e.flow}`}>
              <span className="tl-marker" aria-hidden>
                {e.flow === "inflow" ? <IconArrowLeft size={14} /> : e.flow === "outflow" ? <IconArrowRight size={14} /> : <IconClock size={14} />}
              </span>
              <div className="tl-main">
                <div className="tl-top">
                  <strong>{t(`tl.event.${e.id}`)}</strong>
                  <span className={`tl-flow tl-flow-${e.flow}`}>{t(e.flow === "milestone" ? "tl.milestone" : `tl.${e.flow}`)}</span>
                  <Chip tone={STATUS_TONE[st]}>{t(`tl.status.${st}`)}</Chip>
                </div>
                <div className="tl-meta">
                  <span><IconClock size={12} /> {timing(e)}</span>
                  {e.flow !== "milestone" && (
                    <span className={`tl-amount ${e.amount !== null && e.amount < 0 ? "neg" : "pos"}`}>
                      {e.amount === null ? t("common.unknown") : `${e.amount > 0 ? "+" : ""}${formatMoney(e.amount, currency)}`}
                      {e.flow === "inflow" && e.amount !== null && <span className="src"> ({t("tl.after_fees")})</span>}
                    </span>
                  )}
                  {e.flow !== "milestone" && (
                    <span className="src">{t("tl.running")}: <strong className={e.running_position !== null && e.running_position < 0 ? "neg" : ""}>{e.running_position === null ? t("common.unknown") : formatMoney(e.running_position, currency)}</strong></span>
                  )}
                </div>
                {e.flow === "inflow" && (
                  <button type="button" className="ghost sm" aria-pressed={!!received[e.id]} onClick={() => onToggle(e.id)}>
                    {received[e.id] ? t("tl.unmark_received") : t("tl.mark_received")}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <PositionChart events={timeline.events.filter((e) => e.flow !== "milestone")} currency={currency} />
      {lowest !== null && <p className="src">{t("tl.lowest")}: <strong>{formatMoney(lowest, currency)}</strong></p>}
      {timeline.missing.length > 0 && <p className="src"><IconInfo size={13} /> {t("tl.precision", { fields: timeline.missing.map((m) => `@field.${m}`).join(", ") })}</p>}
      <p className="src">{t("tl.note")} {t("calc.assume.fees")}</p>
    </section>
  );
}
