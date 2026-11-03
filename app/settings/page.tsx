"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useI18n } from "../../components/I18nProvider";
import { IconBeaker, IconCheck, IconGear, IconGlobe, IconSparkle, IconTrash, IconUser } from "../../components/Icons";
import { useAiStatus } from "../../components/useAiStatus";
import { LANGUAGES } from "../../lib/i18n";
import { clearSessions, getReviewer, setReviewer } from "../../lib/store";

export default function SettingsPage() {
  const { t, lang, setLang } = useI18n();
  const { status } = useAiStatus();
  const [name, setName] = useState("");
  const [saved, setSaved] = useState(false);
  const [cleared, setCleared] = useState(false);
  useEffect(() => setName(getReviewer()), []);

  return (
    <main className="page narrow">
      <header className="page-head">
        <div>
          <span className="eyebrow"><IconGear size={13} /> {t("nav.settings")}</span>
          <h1>{t("set.title")}</h1>
          <p className="src">{t("set.sub")}</p>
        </div>
      </header>

      <section className="card" aria-labelledby="lang-title">
        <h2 id="lang-title"><IconGlobe size={17} /> {t("set.lang")}</h2>
        <p className="src">{t("set.lang_help")}</p>
        <fieldset className="lang-list">
          <legend className="sr-only">{t("set.lang")}</legend>
          {LANGUAGES.map((l) => (
            <label key={l.code} className={`lang-option ${lang === l.code ? "is-selected" : ""}`}>
              <input type="radio" name="lang" value={l.code} checked={lang === l.code} onChange={() => setLang(l.code)} />
              <span lang={l.code} className="lang-native">{l.native}</span>
              <span className="src">{l.english}</span>
              {lang === l.code && <IconCheck size={15} />}
            </label>
          ))}
        </fieldset>
      </section>

      <section className="card" aria-labelledby="rev-title">
        <h2 id="rev-title"><IconUser size={17} /> {t("set.reviewer")}</h2>
        <form className="row-input" onSubmit={(e) => { e.preventDefault(); setReviewer(name.trim()); setSaved(true); }}>
          <label className="field"><span>{t("common.reviewer")}</span>
            <input value={name} onChange={(e) => { setName(e.target.value); setSaved(false); }} autoComplete="name" aria-describedby="rev-help" /></label>
          <button type="submit" className="primary">{t("common.save")}</button>
          {saved && <span className="saved" role="status"><IconCheck size={14} /> {t("set.saved")}</span>}
        </form>
        <p id="rev-help" className="src">{t("set.reviewer_help")}</p>
      </section>

      <section className="card" aria-labelledby="ai-title">
        <h2 id="ai-title"><IconSparkle size={17} /> {t("set.ai")}</h2>
        <p className={status?.live_ai ? "note-good" : "note-warn"}>{status?.live_ai ? t("set.ai_on") : t("set.ai_off")}</p>
        {status && <p className="src">{t("set.ai_models", status.models)}</p>}
        <h3><IconGlobe size={15} /> {t("set.fx")}</h3>
        <p className="src">{t("set.fx_help")}</p>
      </section>

      <section className="card" aria-labelledby="data-title">
        <h2 id="data-title"><IconTrash size={17} /> {t("set.data")}</h2>
        <p className="src">{t("set.data_help")}</p>
        <button type="button" onClick={() => { if (confirm(t("set.clear") + "?")) { clearSessions(); setCleared(true); } }}>{t("set.clear")}</button>
        {cleared && <p className="saved" role="status"><IconCheck size={14} /> {t("set.cleared")}</p>}
      </section>

      <section className="card testing" aria-labelledby="test-title">
        <details>
          <summary><h2 id="test-title"><IconBeaker size={17} /> {t("set.testing")}</h2></summary>
          <p className="src">{t("set.testing_help")}</p>
          <div className="actions">
            <Link className="btn" href="/assess?test=make-it-fail">{t("set.test_scripted")}</Link>
            {status?.live_ai && <Link className="btn" href="/assess?test=make-it-fail&verifier=live">{t("set.test_live")}</Link>}
          </div>
        </details>
      </section>
    </main>
  );
}
