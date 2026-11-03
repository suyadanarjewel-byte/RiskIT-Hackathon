"use client";

import { useState } from "react";
import { DEMO_DOCUMENT, DEMO_DOCUMENT_NAME } from "../../lib/demo/makeItFail";
import type { AssessmentSession, DocInput } from "../../lib/store";
import { useI18n } from "../I18nProvider";
import { IconCheck, IconFile, IconImage, IconSearch, IconUpload } from "../Icons";
import { SetupNotice, useAiStatus } from "../useAiStatus";
import { Banner } from "../ui";
import { ApiError, postJson } from "./Wizard";

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function DocCard({ kind, doc, onChange, disabled, live }: {
  kind: "sales" | "cost"; doc: DocInput; onChange: (d: DocInput) => void; disabled: boolean; live: boolean;
}) {
  const { t } = useI18n();
  const [imgState, setImgState] = useState<"idle" | "working" | "error">("idle");
  const [imgError, setImgError] = useState("");
  const words = doc.text.trim() ? doc.text.trim().split(/\s+/).length : 0;
  const id = `doc-${kind}`;

  const uploadText = async (f?: File) => {
    if (f) onChange({ name: f.name, text: await f.text() });
  };
  const uploadImage = async (f?: File) => {
    if (!f) return;
    if (!IMAGE_TYPES.includes(f.type)) { setImgState("error"); setImgError(t("in.image_type")); return; }
    if (f.size > 5 * 1024 * 1024) { setImgState("error"); setImgError(t("in.image_size")); return; }
    setImgState("working");
    try {
      const { data } = await postJson<{ text: string }>("/api/transcribe", { image: await readAsBase64(f), media_type: f.type });
      onChange({ name: f.name.replace(/\.\w+$/, "") + ".txt", text: data.text, transcribed: true });
      setImgState("idle");
    } catch (e) {
      setImgState("error");
      setImgError(e instanceof ApiError && e.message !== "network" ? e.message : t("err.network"));
    }
  };

  return (
    <section className="card doc-card" aria-labelledby={`${id}-title`}>
      <header className="doc-card-head">
        <span className="icon-tile"><IconFile size={18} /></span>
        <div>
          <h2 id={`${id}-title`}>{t(`in.${kind}.title`)} {kind === "cost" && <span className="chip chip-muted">{t("common.optional")}</span>}</h2>
          <p className="src">{t(`in.${kind}.hint`)}</p>
        </div>
        {words > 0 && <span className="chip chip-good"><IconCheck size={12} /> {t("in.words", { n: words })}</span>}
      </header>

      <div className="expected">
        <span className="expected-label">{t("in.expected")}</span>
        <ul>{t(`in.${kind}.examples`).split(" · ").map((x) => <li key={x}>{x}</li>)}</ul>
      </div>

      <div className="doc-card-meta">
        <label className="field">
          <span>{t("in.file_name")}</span>
          <input value={doc.name} disabled={disabled} onChange={(e) => onChange({ ...doc, name: e.target.value })} />
        </label>
        <label className="upload">
          <IconUpload size={15} /> {t("in.upload_text")}
          <input type="file" accept=".txt,text/plain" disabled={disabled} onChange={(e) => uploadText(e.target.files?.[0])} />
        </label>
        <label className={`upload ${!live ? "is-disabled" : ""}`} title={!live ? t("in.image_needs_ai") : undefined}>
          <IconImage size={15} /> {t("in.upload_image")}
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={disabled || !live || imgState === "working"}
            onChange={(e) => uploadImage(e.target.files?.[0])} />
        </label>
      </div>

      <label className="sr-only" htmlFor={id}>{t(kind === "sales" ? "in.paste_sales" : "in.paste_cost")}</label>
      <textarea id={id} className="paste" rows={12} value={doc.text} disabled={disabled}
        placeholder={t(kind === "sales" ? "in.paste_sales" : "in.paste_cost")}
        onChange={(e) => onChange({ ...doc, text: e.target.value, transcribed: doc.transcribed && !!e.target.value })} />
      {imgState === "working" && <p className="src" role="status"><span className="spinner sm" aria-hidden /> {t("in.image_working")}</p>}
      {imgState === "error" && <p className="error" role="alert">{imgError}</p>}
      {doc.transcribed && <p className="note-warn" role="note"><IconImage size={14} /> {t("in.image_done")}</p>}
    </section>
  );
}

export function StepInput({ session, update, onAnalyse }: {
  session: AssessmentSession;
  update: (p: Partial<AssessmentSession>) => void;
  onAnalyse: (s: AssessmentSession) => Promise<void>;
}) {
  const { t } = useI18n();
  const { status, loading } = useAiStatus();
  const [phase, setPhase] = useState<"idle" | "working">("idle");
  const [error, setError] = useState<{ message: string; details: string[] } | null>(null);
  const isTest = session.mode === "test";
  const live = status?.live_ai === true;
  const canRun = session.docs.sales.text.trim().length > 0 && (isTest ? session.verifier_source === "simulated" || live : live);
  const setDoc = (kind: "sales" | "cost", d: DocInput) => update({ docs: { ...session.docs, [kind]: d } });

  const run = async () => {
    setError(null);
    setPhase("working");
    try {
      await onAnalyse(session);
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError("generic");
      setError({ message: err.message === "network" ? t("err.network") : err.message === "generic" ? t("err.generic") : err.message, details: err.details });
      setPhase("idle");
    }
  };
  const working = phase === "working";

  return (
    <div className="step-body">
      {!loading && !live && !isTest && <SetupNotice />}

      <div className="doc-grid">
        <DocCard kind="sales" doc={session.docs.sales} onChange={(d) => setDoc("sales", d)} disabled={working || isTest} live={live} />
        <DocCard kind="cost" doc={session.docs.cost} onChange={(d) => setDoc("cost", d)} disabled={working || isTest} live={live} />
      </div>

      {error && (
        <div className="error-card" role="alert">
          <strong>{t("in.error_title")}</strong>
          <p>{error.message}</p>
          {error.details.length > 0 && <ul>{error.details.slice(0, 5).map((d) => <li key={d}>{d}</li>)}</ul>}
          <p className="src">{t("in.error_safe")}</p>
        </div>
      )}

      {working ? (
        <div className="card working" role="status" aria-live="polite">
          <span className="spinner" aria-hidden />
          <div>
            <strong>{t("in.working_extract")}</strong>
            <p className="src">{t("in.working_verify")}</p>
          </div>
        </div>
      ) : (
        <div className="action-bar">
          <div className="action-bar-left">
            {!isTest && (
              <button type="button" className="ghost" onClick={() => setDoc("sales", { name: DEMO_DOCUMENT_NAME, text: DEMO_DOCUMENT })}>
                {t("in.sample")}
              </button>
            )}
            {!session.docs.sales.text.trim() && <span className="src">{t("in.need_sales")}</span>}
          </div>
          <button type="button" className="primary lg" disabled={!canRun} onClick={run}>
            <IconSearch size={16} /> {t("in.analyse")}
          </button>
        </div>
      )}
    </div>
  );
}
