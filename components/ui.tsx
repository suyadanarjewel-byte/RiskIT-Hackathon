"use client";

/**
 * Shared presentational pieces. Every status or provenance cue pairs colour with text and an
 * icon, so meaning never depends on colour alone. Figures and currency codes are not translated.
 */
import type { ReactNode } from "react";
import type { InputOrigin } from "../lib/financials";
import { formatMoney } from "../lib/riskCards";
import { IconAlert, IconCheck, IconClock, IconLock } from "./Icons";
import { useI18n } from "./I18nProvider";

export type ProvKind = InputOrigin | "ai_original" | "ai_verifier" | "human_edit" | "final_approved" | "ai_correction_approved";

const PROV_GLYPH: Record<ProvKind, string> = {
  document: "D", user: "U", external: "E", cached: "C", assumption: "A", estimate: "~", unknown: "?", calculation: "=",
  ai_original: "AI", ai_verifier: "V", human_edit: "H", final_approved: "✓", ai_correction_approved: "✓",
};

/** Where a value came from, as a labelled badge. */
export function Prov({ kind }: { kind: ProvKind }) {
  const { t } = useI18n();
  return (
    <span className={`prov prov-${kind}`}>
      <span className="prov-glyph" aria-hidden>{PROV_GLYPH[kind]}</span>
      {t(`prov.${kind}`)}
    </span>
  );
}

export type Tone = "good" | "warn" | "crit" | "muted" | "info";

export function Chip({ tone, children, icon }: { tone: Tone; children: ReactNode; icon?: ReactNode }) {
  return <span className={`chip chip-${tone}`}>{icon}{children}</span>;
}

/** Banner for blocked (red), pending (amber), success (green) and info states. */
export function Banner({ tone, title, children, role }: { tone: "blocked" | "pending" | "success" | "info"; title: string; children?: ReactNode; role?: "alert" | "status" }) {
  const Icon = tone === "blocked" ? IconAlert : tone === "pending" ? IconClock : tone === "success" ? IconCheck : IconLock;
  return (
    <div className={`banner banner-${tone}`} role={role ?? (tone === "blocked" ? "alert" : "status")}>
      <span className="banner-icon" aria-hidden><Icon size={16} /></span>
      <div>
        <strong>{title}</strong>
        {children && <div className="banner-body">{children}</div>}
      </div>
    </div>
  );
}

export function SectionHead({ title, sub, actions, id }: { title: string; sub?: string; actions?: ReactNode; id?: string }) {
  return (
    <div className="section-head">
      <div>
        <h2 id={id}>{title}</h2>
        {sub && <p className="src">{sub}</p>}
      </div>
      {actions && <div className="section-actions">{actions}</div>}
    </div>
  );
}

export function useFormat() {
  const { t } = useI18n();
  return {
    money: (v: number | null | undefined, ccy: string | null) => (v === null || v === undefined ? t("common.insufficient") : formatMoney(v, ccy)),
    pct: (v: number | null | undefined) => (v === null || v === undefined ? t("common.insufficient") : `${(Math.round(v * 100) / 100).toFixed(2)}%`),
    when: (iso: string | null | undefined) => (iso ? new Date(iso).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "—"),
    field: (f: string) => t(`field.${f}`),
  };
}

/** Human-readable value for any field shape (money, fees, locations, terms). */
export function showValue(v: unknown, unknown = "UNKNOWN"): string {
  if (v === null || v === undefined) return unknown;
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v !== "object") return String(v);
  const o = v as Record<string, unknown>;
  if ("amount" in o) return o.amount === null ? unknown : `${formatMoney(o.amount as number, (o.currency as string) ?? null)}`;
  if ("percent" in o) {
    const parts = [o.percent !== null ? `${o.percent}%` : null, o.fixed_amount ? formatMoney(o.fixed_amount as number, (o.currency as string) ?? null) : null].filter(Boolean);
    return parts.length ? parts.join(" + ") : unknown;
  }
  if ("net_days" in o) return [o.description, o.net_days !== null ? `(${o.net_days})` : null].filter(Boolean).join(" ") || unknown;
  return Object.values(o).filter((x) => x !== null && x !== undefined).join(", ") || unknown;
}
