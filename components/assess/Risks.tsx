"use client";

import { useState } from "react";
import type { RiskCard, RiskLevel } from "../../lib/riskCards";
import { useI18n } from "../I18nProvider";
import { IconAlert, IconCheck, IconChevron, IconInfo } from "../Icons";
import { Prov, SectionHead } from "../ui";
import { useMsg } from "./Results";

const TONE: Record<RiskLevel, string> = { LOW: "good", MEDIUM: "warn", HIGH: "crit", UNKNOWN: "muted" };

function RiskCardView({ card }: { card: RiskCard }) {
  const { t } = useI18n();
  const msg = useMsg();
  const [open, setOpen] = useState(false);
  const tone = TONE[card.level];
  const panel = `why-${card.category}`;
  const list = (items: { key: string }[], render: (i: number) => string) =>
    items.length ? <ul>{items.map((_, i) => <li key={i}>{render(i)}</li>)}</ul> : <p className="src">{t("risk.none")}</p>;

  return (
    <article className={`card risk-card risk-${tone}`} aria-labelledby={`risk-${card.category}`}>
      <header>
        <h3 id={`risk-${card.category}`}>{t(`risk.cat.${card.category}`)}</h3>
        <span className={`status status-${tone}`}>
          <span className="status-icon" aria-hidden>{card.level === "LOW" ? <IconCheck size={12} /> : card.level === "UNKNOWN" ? "?" : <IconAlert size={12} />}</span>
          {t(`level.${card.level}`)}
        </span>
      </header>
      <p>{msg(card.reason)}</p>
      <dl className="risk-metrics">
        {card.metrics.map((m) => (
          <div key={m.key}><dt>{t(m.key)}</dt><dd>{m.value} <Prov kind={m.origin} /></dd></div>
        ))}
      </dl>
      {card.gaps.length > 0 && <p className="note-warn small"><IconInfo size={13} /> {card.gaps.map(msg).join(" ")}</p>}
      <button type="button" className="why-btn" aria-expanded={open} aria-controls={panel} onClick={() => setOpen(!open)}>
        <IconChevron size={14} className={open ? "rot" : ""} /> {open ? t("risk.hide") : t("risk.why")}
      </button>
      {open && (
        <div id={panel} className="why-panel">
          <h4>{t("risk.causes")}</h4>
          {list(card.explain.causes, (i) => msg(card.explain.causes[i]))}
          <h4>{t("risk.info")}</h4>
          <ul>{card.metrics.map((m) => <li key={m.key}>{t(m.key)}: {m.value}</li>)}</ul>
          <h4>{t("risk.evidence")}</h4>
          {card.explain.evidence.length ? card.explain.evidence.map((e) => (
            <blockquote key={e.field} className="evidence"><span>{e.quote}</span><cite>{t(`field.${e.field}`)}{e.source_ref ? ` · ${e.source_ref}` : ""}</cite></blockquote>
          )) : <p className="src">{t("risk.none")}</p>}
          <h4>{t("risk.impact")}</h4>
          {list(card.explain.impact, (i) => msg(card.explain.impact[i]))}
          <h4>{t("risk.actions")}</h4>
          {list(card.explain.actions, (i) => msg(card.explain.actions[i]))}
          <h4>{t("risk.uncertainty")}</h4>
          {list(card.explain.uncertainty, (i) => msg(card.explain.uncertainty[i]))}
          <p className="src">{t("risk.rule_note")}</p>
        </div>
      )}
    </article>
  );
}

export function RiskSection({ cards }: { cards: RiskCard[] }) {
  const { t } = useI18n();
  return (
    <section aria-labelledby="risk-title" className="risk-section">
      <SectionHead id="risk-title" title={t("risk.title")} sub={t("risk.rule_note")} />
      <div className="risk-grid">{cards.map((c) => <RiskCardView key={c.category} card={c} />)}</div>
    </section>
  );
}
