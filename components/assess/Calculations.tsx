"use client";

import { useEffect, useRef } from "react";
import { BASE_ASSUMPTIONS } from "../../lib/scenarios";
import type { RateLookupResult } from "../../lib/external";
import type { CalcInput, Financials } from "../../lib/financials";
import { formatMoney } from "../../lib/riskCards";
import { useI18n } from "../I18nProvider";
import { IconCalc } from "../Icons";
import { Prov, useFormat } from "../ui";

function fmtValue(v: CalcInput["value"], unit: string | null, unknown: string): string {
  if (v === null) return unknown;
  if (typeof v === "string") return v;
  if (unit === "%") return `${Math.round(v * 100) / 100}%`;
  if (unit && /^[A-Z]{3}$/.test(unit)) return formatMoney(v, unit);
  if (unit && unit.includes("/")) return `${v} ${unit}`;
  return String(Math.round(v * 10000) / 10000);
}

/** "View Calculations": the actual steps from the deterministic engine. */
export function CalculationsDialog({ open, onClose, fin, fx }: { open: boolean; onClose: () => void; fin: Financials; fx: RateLookupResult | null }) {
  const { t } = useI18n();
  const fmt = useFormat();
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const unknown = t("common.unknown");
  return (
    <dialog ref={ref} className="calc-dialog" aria-labelledby="calc-title" onClose={onClose} onCancel={onClose}>
      <header className="dialog-head">
        <h2 id="calc-title"><IconCalc size={18} /> {t("calc.title")}</h2>
        <button type="button" className="ghost" onClick={onClose} aria-label={t("common.close")}>✕</button>
      </header>
      <div className="dialog-body">
        <p className="src">{t("calc.intro")}</p>

        {fx?.rate && (
          <div className="calc-fx">
            <strong>{t("fx.title")}:</strong> {fx.rate.value} · {fx.rate.source}
            {fx.rate.as_of && <> · {t("fx.as_of")} {fx.rate.as_of}</>} · {t("fx.retrieved")} {fmt.when(fx.rate.retrieved_at)}
          </div>
        )}

        {fin.steps.map((s, i) => (
          <details key={s.id} className="calc-step" open={i < 1 || ["gross_profit", "net_profit", "cash_position"].includes(s.id)}>
            <summary>
              <span>{t(`calc.step.${s.id}`)}</span>
              <span className={`calc-result ${s.result === null ? "metric-na" : ""}`}>{fmtValue(s.result, s.unit, t("common.insufficient"))}</span>
            </summary>
            <p className="calc-formula"><span className="src">{t("calc.formula")}:</span> <code>{t(`calc.f.${s.id}`)}</code></p>
            <table className="calc-table">
              <caption className="sr-only">{t("calc.inputs")}</caption>
              <thead><tr><th scope="col">{t("calc.inputs")}</th><th scope="col">{t("common.value")}</th><th scope="col">{t("common.source")}</th></tr></thead>
              <tbody>
                {s.inputs.map((inp, j) => (
                  <tr key={j}>
                    <th scope="row">{inp.raw ? inp.label : t(`calc.in.${inp.label}`)}</th>
                    <td className="num">{fmtValue(inp.value, inp.unit, unknown)}</td>
                    <td><Prov kind={inp.origin} /></td>
                  </tr>
                ))}
                <tr className="calc-total"><th scope="row">{t("calc.result")}</th><td className="num">{fmtValue(s.result, s.unit, t("common.insufficient"))}</td><td /></tr>
              </tbody>
            </table>
          </details>
        ))}

        <h3>{t("calc.missing")}</h3>
        {fin.missing.length ? <ul>{fin.missing.map((m) => <li key={m}>{t(`field.${m}`)}</li>)}</ul> : <p className="src">{t("calc.none")}</p>}
        <h3>{t("calc.assumptions")}</h3>
        <ul>
          <li>{t("calc.assume.financing", { rate: BASE_ASSUMPTIONS.financing_rate_annual_percent })}</li>
          <li>{t("calc.assume.fees")}</li>
          <li>{t("calc.assume.fx")}</li>
        </ul>
      </div>
      <footer className="dialog-foot"><button type="button" className="primary" onClick={onClose}>{t("common.close")}</button></footer>
    </dialog>
  );
}
