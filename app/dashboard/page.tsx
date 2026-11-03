"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useI18n } from "../../components/I18nProvider";
import { IconArrowRight, IconChart, IconPlus, IconTrash } from "../../components/Icons";
import { Chip, useFormat } from "../../components/ui";
import { buildRiskCards, formatMoney, orderIndicator } from "../../lib/riskCards";
import { factsFromAssessment, runScenarios } from "../../lib/scenarios";
import { deleteSession, listSessions, type AssessmentSession } from "../../lib/store";
import { buildTimeline } from "../../lib/timeline";

function summary(s: AssessmentSession) {
  if (!s.approved) return null;
  const a = s.approved.assessment;
  const sc = runScenarios(factsFromAssessment(a), s.fx?.rate ?? null);
  const base = sc.find((x) => x.id === "base")!;
  const tl = buildTimeline(a, base.financials, new Date().toISOString().slice(0, 10), s.received);
  return { fin: base.financials, ind: orderIndicator(a, buildRiskCards(a, sc, s.fx?.rate ?? null, tl), base, tl) };
}

export default function DashboardPage() {
  const { t } = useI18n();
  const fmt = useFormat();
  const [list, setList] = useState<AssessmentSession[] | null>(null);
  useEffect(() => setList(listSessions()), []);

  const status = (s: AssessmentSession) => s.approved ? "results"
    : s.containment && s.containment.verification.verdict === "FAIL" && s.containment.decisions.length < s.containment.verification.issues.length ? "blocked"
    : s.draft ? "review" : "input";
  const tone = { results: "good", blocked: "crit", review: "warn", input: "muted" } as const;
  const indTone = { lower: "good", moderate: "warn", higher: "crit", insufficient: "muted" } as const;

  return (
    <main className="page">
      <header className="page-head">
        <div>
          <span className="eyebrow">{t("nav.dashboard")}</span>
          <h1>{t("dash.title")}</h1>
          <p className="src">{t("dash.sub")}</p>
        </div>
        <Link href="/assess" className="btn primary lg"><IconPlus size={16} /> {t("home.cta_start")}</Link>
      </header>

      {list === null ? null : list.length === 0 ? (
        <div className="empty-state">
          <IconChart size={30} />
          <h2>{t("dash.empty_title")}</h2>
          <p className="src">{t("dash.empty_body")}</p>
          <Link href="/assess" className="btn primary">{t("home.cta_start")} <IconArrowRight size={15} /></Link>
        </div>
      ) : (
        <section className="card">
          <p className="src">{t("dash.count", { n: list.length })}</p>
          <div className="table-wrap">
            <table className="review dash-table">
              <thead>
                <tr>
                  <th scope="col">{t("dash.col.order")}</th><th scope="col">{t("dash.col.created")}</th><th scope="col">{t("dash.col.status")}</th>
                  <th scope="col">{t("dash.col.revenue")}</th><th scope="col">{t("dash.col.net")}</th><th scope="col">{t("dash.col.indicator")}</th>
                  <th scope="col"><span className="sr-only">{t("dash.open")}</span></th>
                </tr>
              </thead>
              <tbody>
                {list.map((s) => {
                  const st = status(s);
                  const sum = summary(s);
                  const a = s.approved?.assessment ?? s.draft;
                  return (
                    <tr key={s.id}>
                      <th scope="row">
                        {a?.product_description.value ?? s.docs.sales.name}
                        <div className="src">{a?.sales_value.value != null ? formatMoney(a.sales_value.value, a.sales_currency.value) : ""}{s.mode === "test" ? ` · ${t("common.simulated")}` : ""}</div>
                      </th>
                      <td className="nowrap">{fmt.when(s.created_at)}</td>
                      <td><Chip tone={tone[st]}>{t(`dash.status.${st}`)}</Chip></td>
                      <td className="num">{sum ? fmt.money(sum.fin.revenue, sum.fin.currency) : "—"}</td>
                      <td className="num">{sum ? fmt.money(sum.fin.net_profit, sum.fin.currency) : "—"}</td>
                      <td>{sum ? <Chip tone={indTone[sum.ind.level]}>{t(`ind.level.${sum.ind.level}`)}</Chip> : "—"}</td>
                      <td className="nowrap">
                        <Link className="btn sm" href={`/assess?id=${s.id}`}>{st === "results" ? t("dash.open") : t("dash.resume")}</Link>{" "}
                        <button type="button" className="ghost sm" aria-label={`${t("dash.delete")}: ${a?.product_description.value ?? s.id}`}
                          onClick={() => { if (confirm(t("dash.confirm_delete"))) { deleteSession(s.id); setList(listSessions()); } }}>
                          <IconTrash size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
