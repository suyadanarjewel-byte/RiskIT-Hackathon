"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_LANG, isLang, translate, type Lang, type MessageKey, type Params } from "../lib/i18n";

const STORAGE_KEY = "riskit.lang";

interface I18n {
  lang: Lang;
  setLang: (l: Lang) => void;
  /** Translate a known key, or any dynamic key built from data (falls back safely). */
  t: (key: MessageKey | (string & {}), params?: Params) => string;
}

const Ctx = createContext<I18n>({ lang: DEFAULT_LANG, setLang: () => {}, t: (k, p) => translate(DEFAULT_LANG, k, p) });

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(DEFAULT_LANG);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (isLang(saved)) setLangState(saved);
    } catch { /* storage unavailable: keep English */ }
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try { localStorage.setItem(STORAGE_KEY, l); } catch { /* ignore */ }
  }, []);

  const value = useMemo<I18n>(() => ({ lang, setLang, t: (k, p) => translate(lang, k, p) }), [lang, setLang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  return useContext(Ctx);
}
