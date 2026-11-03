"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType } from "react";
import type { MessageKey } from "../lib/i18n";
import { useI18n } from "./I18nProvider";
import { IconChart, IconGear, IconHome, IconPlus } from "./Icons";
import { useAiStatus } from "./useAiStatus";

const NAV: { href: string; key: MessageKey; Icon: ComponentType<{ size?: number }> }[] = [
  { href: "/", key: "nav.overview", Icon: IconHome },
  { href: "/dashboard", key: "nav.dashboard", Icon: IconChart },
  { href: "/assess", key: "nav.new", Icon: IconPlus },
];

export function AppHeader() {
  const path = usePathname();
  const { t } = useI18n();
  const { status, loading } = useAiStatus();
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <header className="app-header">
      <a href="#main" className="skip-link">{t("skip")}</a>
      <div className="app-header-inner">
        <Link href="/" className="brand" aria-label="RiskIT">
          <span className="brand-mark" aria-hidden>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 18 9.5 12l3.5 3.5L20 7" /><path d="M15 7h5v5" /></svg>
          </span>
          <span className="brand-name">RiskIT</span>
        </Link>
        <nav className="app-nav" aria-label="Main">
          {NAV.map(({ href, key, Icon }) => (
            <Link key={href} href={href} className={active(href) ? "active" : ""} aria-current={active(href) ? "page" : undefined}>
              <Icon size={15} /><span>{t(key)}</span>
            </Link>
          ))}
        </nav>
        <div className={`ai-status ${loading ? "" : status?.live_ai ? "on" : "off"}`} role="status">
          <span className="dot" aria-hidden />
          {loading ? t("status.ai_checking") : status?.live_ai ? t("status.ai_live") : t("status.ai_off")}
        </div>
        <Link href="/settings" className={`settings-btn ${active("/settings") ? "active" : ""}`} aria-current={active("/settings") ? "page" : undefined}>
          <IconGear size={17} /><span>{t("nav.settings")}</span>
        </Link>
      </div>
    </header>
  );
}

export function AppFooter() {
  const { t } = useI18n();
  return (
    <footer className="app-footer">
      <div className="app-footer-inner">
        <div>{t("footer.disclaimer")}</div>
        <div className="src">{t("footer.scope")}</div>
      </div>
    </footer>
  );
}
