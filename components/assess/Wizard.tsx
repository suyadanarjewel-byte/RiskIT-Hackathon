"use client";

/**
 * New Transaction Assessment: a guided three-step flow.
 *   1. Document input  2. AI verification & human review  3. Financial results
 * Uses the existing pipeline: /api/extract -> /api/verify (independent second AI) ->
 * containment (blocks on failure) -> human decisions -> approval -> deterministic results.
 * Every change is saved on this device so the assessment can be resumed from the dashboard.
 */
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { startContainment } from "../../lib/containment";
import { DEMO_DOCUMENT, DEMO_DOCUMENT_NAME, FAILING_VERIFICATION, failingDraft } from "../../lib/demo/makeItFail";
import { getSession, newSession, saveSession, type AssessmentSession, type Step } from "../../lib/store";
import type { OrderAssessment, VerificationResult } from "../../lib/types";
import { useI18n } from "../I18nProvider";
import { IconCheck, IconLock, LoadingCard } from "../Icons";
import { Banner } from "../ui";
import { Results } from "./Results";
import { StepInput } from "./StepInput";
import { StepReview } from "./StepReview";

export class ApiError extends Error {
  constructor(message: string, readonly details: string[] = []) {
    super(message);
  }
}

export async function postJson<T>(url: string, body: unknown): Promise<{ data: T; headers: Headers }> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new ApiError("network");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `HTTP ${res.status}`, data.details ?? []);
  return { data, headers: res.headers };
}

export function Wizard() {
  const { t, lang } = useI18n();
  const params = useSearchParams();
  const router = useRouter();
  const [session, setSession] = useState<AssessmentSession | null>(null);
  const [notFound, setNotFound] = useState(false);

  // Load or create the session once.
  useEffect(() => {
    const id = params.get("id");
    if (id) {
      const s = getSession(id);
      if (s) setSession(s); else setNotFound(true);
      return;
    }
    const test = params.get("test") === "make-it-fail";
    const s = newSession(test ? "test" : "live");
    if (test) {
      s.docs.sales = { name: DEMO_DOCUMENT_NAME, text: DEMO_DOCUMENT };
      s.verifier_source = params.get("verifier") === "live" ? "live" : "simulated";
    }
    setSession(s);
  }, [params]);

  const update = useCallback((patch: Partial<AssessmentSession> | ((s: AssessmentSession) => AssessmentSession)) => {
    setSession((prev) => (prev ? (typeof patch === "function" ? patch(prev) : { ...prev, ...patch }) : prev));
  }, []);

  // Persist once there is something worth saving, and give the assessment a resumable URL.
  useEffect(() => {
    if (!session?.draft) return;
    saveSession(session);
    if (params.get("id") !== session.id) router.replace(`/assess?id=${session.id}`, { scroll: false });
  }, [session, params, router]);

  /** Step 1 -> 2: extraction, then the independent verifier. */
  const analyse = useCallback(async (s: AssessmentSession) => {
    const documents = [s.docs.sales, s.docs.cost]
      .filter((d) => d.text.trim())
      .map((d, i) => ({ name: d.name.trim() || `document_${i + 1}.txt`, text: d.text }));
    let draft: OrderAssessment;
    let verification: VerificationResult;
    if (s.mode === "test") {
      draft = failingDraft(); // scripted AI draft with two injected errors (labelled Simulated)
      verification = s.verifier_source === "live"
        ? (await postJson<VerificationResult>("/api/verify", { documents, assessment: draft, language: lang })).data
        : FAILING_VERIFICATION;
    } else {
      draft = (await postJson<OrderAssessment>("/api/extract", { documents })).data;
      verification = (await postJson<VerificationResult>("/api/verify", { documents, assessment: draft, language: lang })).data;
    }
    update({
      ...s, draft, verification, containment: startContainment(draft, verification),
      factDecisions: {}, approved: null, fx: null, received: {},
      recommendation: { origin: null, state: null, released: null }, step: 2,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [lang, update]);

  if (notFound) return <main className="page"><Banner tone="info" title={t("wiz.not_found")} /></main>;
  if (!session) return <main className="page"><LoadingCard label={t("common.loading")} /></main>;

  const reachable = (n: Step) => n === 1 || (n === 2 && !!session.draft) || (n === 3 && !!session.approved);
  const steps: { n: Step; label: string }[] = [
    { n: 1, label: t("wiz.step1") }, { n: 2, label: t("wiz.step2") }, { n: 3, label: t("wiz.step3") },
  ];
  const go = (n: Step) => { if (reachable(n)) { update({ step: n }); window.scrollTo({ top: 0 }); } };

  return (
    <main className="page wizard">
      <header className="page-head">
        <div>
          <span className="eyebrow">{t("wiz.step_of", { n: session.step })}</span>
          <h1>{t("wiz.title")}</h1>
          <p className="src">{t("wiz.subtitle")}</p>
        </div>
      </header>

      <nav aria-label={t("wiz.title")}>
        <ol className="wizard-steps">
          {steps.map(({ n, label }) => {
            const state = session.step === n ? "current" : n < session.step || (n === 2 && session.approved) ? "done" : reachable(n) ? "open" : "locked";
            return (
              <li key={n} className={`wstep wstep-${state}`}>
                <button type="button" onClick={() => go(n)} disabled={!reachable(n)} aria-current={session.step === n ? "step" : undefined}>
                  <span className="wstep-icon" aria-hidden>{state === "done" ? <IconCheck size={14} /> : state === "locked" ? <IconLock size={13} /> : n}</span>
                  <span className="wstep-label">{label}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {session.mode === "test" && <Banner tone="pending" title={t("common.simulated")}>{t("wiz.test_mode")}</Banner>}

      {session.step === 1 && <StepInput session={session} update={update} onAnalyse={analyse} />}
      {session.step === 2 && session.containment && <StepReview session={session} update={update} />}
      {session.step === 3 && session.approved && <Results session={session} update={update} />}
    </main>
  );
}
