"use client";

import Link from "next/link";
import type { ComponentType } from "react";
import { useI18n } from "../components/I18nProvider";
import {
  IconAlert, IconArrowRight, IconChart, IconCheck, IconFile, IconGlobe, IconSearch, IconShield, IconUser,
} from "../components/Icons";
import type { MessageKey } from "../lib/i18n";

const STEPS: { n: 1 | 2 | 3; Icon: ComponentType<{ size?: number }> }[] = [
  { n: 1, Icon: IconFile }, { n: 2, Icon: IconSearch }, { n: 3, Icon: IconChart },
];
const SAFE: { n: 1 | 2 | 3 | 4; Icon: ComponentType<{ size?: number }> }[] = [
  { n: 1, Icon: IconShield }, { n: 2, Icon: IconAlert }, { n: 3, Icon: IconGlobe }, { n: 4, Icon: IconUser },
];

export default function Home() {
  const { t } = useI18n();
  return (
    <main className="page">
      <section className="hero">
        <div className="hero-text">
          <span className="pill"><IconShield size={14} /> {t("home.badge")}</span>
          <h1>{t("home.title")}</h1>
          <p className="lead">{t("home.lead")}</p>
          <div className="hero-cta">
            <Link href="/assess" className="btn primary lg">{t("home.cta_start")} <IconArrowRight size={16} /></Link>
            <Link href="/dashboard" className="btn lg"><IconChart size={16} /> {t("home.cta_dashboard")}</Link>
          </div>
          <ul className="hero-points">
            {(["home.point1", "home.point2", "home.point3"] as MessageKey[]).map((k) => <li key={k}><IconCheck size={14} /> {t(k)}</li>)}
          </ul>
        </div>
        <div className="preview" aria-hidden>
          <div className="preview-head">
            <span className="preview-dot" /><span className="preview-dot" /><span className="preview-dot" />
            <span className="preview-title">DEMO-0001 · USD 12,000</span>
          </div>
          <div className="preview-banner"><IconAlert size={16} /> {t("home.preview.blocked")}</div>
          <div className="preview-row"><span>{t("home.preview.freight")}</span><span>SGD 1,200</span><span className="chip chip-warn">{t("prov.estimate")}</span></div>
          <div className="preview-row"><span>{t("home.preview.insurance")}</span><span className="strike">SGD 0</span><span className="chip chip-muted">{t("common.unknown")}</span></div>
          <div className="preview-kpis">
            <div><div className="preview-label">{t("m.gross_profit")}</div><div className="preview-value">SGD 5,700</div></div>
            <div><div className="preview-label">{t("m.net_profit")}</div><div className="preview-value">—</div></div>
            <div><div className="preview-label">{t("m.cash_position")}</div><div className="preview-value">—</div></div>
          </div>
          <div className="preview-foot">{t("home.preview.foot")}</div>
        </div>
      </section>

      <section className="section" aria-labelledby="how">
        <div className="section-head"><div><h2 id="how">{t("home.how")}</h2><p className="src">{t("home.how_sub")}</p></div></div>
        <ol className="flow flow-3">
          {STEPS.map(({ n, Icon }) => (
            <li key={n} className="flow-step">
              <div className="flow-top"><span className="icon-tile"><Icon size={18} /></span><span className="flow-n">0{n}</span></div>
              <h3>{t(`home.step${n}.title`)}</h3>
              <p>{t(`home.step${n}.text`)}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="section" aria-labelledby="safe">
        <div className="section-head"><div><h2 id="safe">{t("home.safe.title")}</h2></div></div>
        <div className="principles">
          {SAFE.map(({ n, Icon }) => (
            <div key={n} className="card principle">
              <h3><Icon size={16} /> {t(`home.safe${n}.t`)}</h3>
              <p>{t(`home.safe${n}.d`)}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
