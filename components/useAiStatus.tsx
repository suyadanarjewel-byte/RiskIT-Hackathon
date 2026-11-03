"use client";

import { useEffect, useState } from "react";
import { useI18n } from "./I18nProvider";

export interface AiStatus {
  live_ai: boolean;
  models: { extract: string; verify: string; recommend: string };
  setup: string | null;
}

let cached: Promise<AiStatus | null> | null = null;

/** Whether live AI calls are configured on the server (null while loading or if unreachable). */
export function useAiStatus(): { status: AiStatus | null; loading: boolean } {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    cached ??= fetch("/api/status").then((r) => (r.ok ? r.json() : null)).catch(() => null);
    cached.then((s) => { setStatus(s); setLoading(false); });
  }, []);
  return { status, loading };
}

/** Clear, translated explanation of the missing API key and how to fix it. */
export function SetupNotice() {
  const { t } = useI18n();
  return (
    <div className="setup-notice" role="note">
      <strong>{t("in.setup_title")}</strong>
      <p>{t("in.setup_body")}</p>
      <code>ANTHROPIC_API_KEY=your-key</code>
    </div>
  );
}
