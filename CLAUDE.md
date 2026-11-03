# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project: RiskIT

RiskIT is an AI-driven prototype that assesses risk on individual transactions for small cross-border sellers.

**Status:** One demo flow implemented in Python (stdlib plus the `anthropic` SDK only).

## Commands

```bash
pip install -r requirements.txt                                   # only dependency: anthropic
python3 -m riskit samples/docs --scenario samples/scenario.json    # interactive demo (needs ANTHROPIC_API_KEY)
python3 -m unittest discover tests                                 # offline tests, no API calls
python3 -m unittest tests.test_riskit.TestCalc.test_numbers        # single test
```

Env vars: `RISKIT_MODEL` (default `claude-opus-5-5`), `RISKIT_CACHE_DIR` (default `.riskit_cache`).

## Architecture (`riskit/`)

- `llm.py` is the **only** module that calls Claude. It returns structured JSON output and caches responses on disk, keyed by model, prompt, documents and schema, so re-runs on the same inputs make no API calls.
- `ai.py` defines exactly two calls: `extract` (candidate values plus verbatim quotes plus uncertainty notes) and `verify` (an independent check of the raw extraction).
- `fields.py` decides each field's status deterministically. Claude never decides the status:
  - no candidates → `UNKNOWN`
  - more than one distinct value → `CONFLICT`
  - otherwise → `FOUND`

  It also checks that every quote appears verbatim in its document. A failed quote check is treated like a verifier failure.
- `review.py` contains every human step: resolving verifier issues (which unblocks the output), resolving conflicts, approving facts, and approving each flag. All input goes through a `Console` object, so tests can script the answers. `q` or EOF aborts the run and nothing is released.
- `calc.py` does all money math with `Decimal`. Each result is tagged `FACTS` or `FACTS+ASSUMPTION`, and any UNKNOWN input makes the result UNKNOWN.
- `risk.py` applies fixed threshold rules and template text for the four in-scope risk types. These rules don't call Claude.
- `report.py` writes blocked or aborted runs to `out/quarantine/` and approved runs to `out/released/` (JSON and Markdown).
- The scenario JSON (for example, the FX rate and FX shocks) holds assumptions only. Documents never supply the FX rate.
- Web UI (Next.js 16 App Router): `npm install`, then `npm run dev` and open `/demo` (start here), `/dashboard` or `/review`. `npm run typecheck` checks the types and `npm run build` makes a production build. On this machine Node is a portable install: run `export PATH="$HOME/.local/node/bin:$PATH"` first.
- **Structured-output schemas sent to Claude may contain at most 16 union or nullable parameters**; the API returns 400 otherwise. This is why the extraction schema carries values as `value_json` strings and decodes them in code. Keep new schemas union-free.
- **Pages that start the review flow must render client-only** (`next/dynamic` with `ssr: false`). `startContainment` creates audit entries with random ids and timestamps, which breaks hydration if they are server-rendered.
- `components/DocumentReview.tsx` is the fact-review table. All review rules are in `lib/review.ts` (pure functions, no React): `buildRows`, `rowStatus`, `parseInput`, `canContinue` (the only gate for the Continue button) and `applyDecisions`. The UI makes no API calls and never pre-fills user values.
- TS tests: `npm test` (vitest); a single test: `npx vitest run lib/scenarios.test.ts -t "base case"`.
- `lib/external.ts` handles external context and makes **no network or paid API calls**. It reads local sample JSON in `data/external/`. Every external value is an `ExternalValue` with `source`, `retrieved_at` and `reliability`. `lookupExchangeRate` is the single rate lookup and never throws. It tries same currency, then the provider (by default the local sample file), then a manual rate labelled `"user-provided fallback"`, then `unavailable`. Country data is descriptive only and must never become a rating or score.
- `lib/calculators.ts` holds the four deterministic risk calculators (FX, fees, logistics, payment collection) plus a cost-items total. `lib/scenarios.ts` (`runScenarios`) runs them under six scenarios: base, FX adverse, late payment, logistics disruption, combined downside and custom. Every output is labelled `"assumption"`. A missing input, including an unavailable FX rate, gives `null` plus a `data_gaps` entry and never blocks the scenarios.
- `app/api/extract/route.ts` (`POST /api/extract`) is the first of three Claude calls (extract, verify, recommend). It accepts `text/plain` or `{documents:[{name,text}]}`. The prompt, JSON schema and model call live in `lib/extraction.server.ts`, which is server-only and must never be imported into client components. It uses `claude-haiku-5-5` at low effort (override with `RISKIT_EXTRACT_MODEL`) and reads `ANTHROPIC_API_KEY` from `.env.local`. The route caches identical inputs in memory. `missing_fields` is recomputed in code. Every result must pass `validateOrderAssessment` (`lib/validate.ts`) and all of its sources must be `"document"`.
- **Verifier containment** lives in `lib/containment.ts` (pure logic) and `components/VerifierReview.tsx` (UI).
  - A FAIL or any finding sets `human_review_status` to `BLOCKED_PENDING_HUMAN_REVIEW`.
  - Each finding needs a final human decision: `approve`, `edit` or `reject`. `request_more_info` is recorded but keeps the finding open.
  - `buildCorrectedAssessment` refuses to run until every finding is decided.
  - Each decision writes a `VerifierAuditEntry` with the original AI output, the finding, the proposed fix, the decision, the reviewer and the timestamp.
- **`releaseGate`** guards scenario analysis, the dashboard and final recommendations. It requires that the assessment isn't blocked, that no findings are open, and that `human_review_status === "approved"`, which `applyDecisions` in `lib/review.ts` sets.
- **Approval applies only to AI-generated judgments.** `needsApproval` covers AI-extracted rows (source `document`) and conflicts. User-entered, external and assumed values, fields already approved during verifier review, and deterministic calculations need no approval.
- **The `/review` page** runs the whole flow in order: verifier review, fact review, then gated results. It uses the static fixtures `lib/sampleAssessment.ts` (which has two deliberate AI errors) and `lib/sampleVerification.ts`. The live verifier is `/api/verify`.
- **`POST /api/recommendation`** (`app/api/recommendation/route.ts`; Claude call in `lib/recommendation.server.ts`) makes one Claude call for a risk recommendation draft. Default model is `claude-opus-5-5` at low effort, with server-side refusal fallback; override with `RISKIT_RECOMMEND_MODEL`.
  - **Eligibility:** `checkRecommendationEligibility` requires that every verifier finding has a final decision (or the verifier passed), that the assessment is human-approved, and that no conflicts are open.
  - **Server recomputes:** The server works out scenarios, the FX rate and country context itself and never trusts numbers from the client.
  - **Output checks** (`validateRecommendationDraft`):
    - every item needs evidence whose `ref` exists in the input, plus a confidence;
    - any number not present in the input is rejected;
    - creditworthiness, legal, tax, sanctions and compliance wording, and claims of being final, are rejected;
    - there must be two to four recommendations;
    - `human_review_required` is forced to `true`.
  - **Release:** Each item (risk flag, narrative, recommendation, uncertainty) must be approved, edited or rejected via `recordItemDecision` before `releaseRecommendation`. Only approved or edited items are released.
- **The `/dashboard` page** (`app/dashboard/page.tsx` plus `components/dashboard/*`) runs the full demo. It shows:
  - order summary, baseline KPIs and the scenario comparison chart;
  - four risk cards, whose levels come from deterministic rules in `lib/riskCards.ts` (no AI);
  - data-reliability and AI Failure Check panels;
  - the Human Review Gate (verifier findings in four stages, then fact review);
  - the final recommendation, the audit log and the disclaimer.

  Results are behind `releaseGate`. While the verifier blocks, the final recommendation component is not rendered at all. Every value carries a `Prov` label (`components/dashboard/Provenance.tsx`): document fact, user correction, external data, scenario assumption, calculation, original AI output, AI verifier output, human edit, or final approved output.
- **Chart rules** (from the dataviz skill): two small multiples, never a dual axis. Net profit is a diverging bar from zero, cash at risk a single-hue bar. Use the reference palette hexes, keep direct labels selective (base plus the extreme case), and keep the hover/focus tooltip and the table view. Status colors always come with an icon and a text label.
- **The `/demo` page (Make It Fail)** uses fixtures in `lib/demo/makeItFail.ts`: a fictional Singapore seller and a USD 12,000 order, with freight an estimated SGD 1,200 and no insurance mentioned. With the toggle on, the scripted AI draft records freight as confirmed and insurance as SGD 0, and the scripted verifier FAILs on both. With it off, the draft is correct and the verifier passes. The AI draft and verifier output are simulated, so the only real Claude call is the recommendation. `components/dashboard/RiskDashboard.tsx` is the shared dashboard used by both `/dashboard` and `/demo`.
- `MoneyAmount` (used for freight and insurance) has `is_estimated`. A cost that isn't stated is UNKNOWN, never 0. While insurance is UNKNOWN, profit is UNKNOWN.
- **`POST /api/verify`** (`app/api/verify/route.ts`; Claude call in `lib/verification.server.ts`, pure logic in `lib/verification.ts`) is the independent second Claude call. It checks a `pending` extraction draft against the documents using `claude-opus-5-5` at low effort, a different model from the extractor (override with `RISKIT_VERIFY_MODEL`).
  - **Evidence:** quotes must appear word for word in the documents (`quoteInDocuments` in `lib/documents.ts`), or they are removed.
  - **Corrections:** proposed corrections must pass `FIELD_VALUE_CHECKS`, or they are removed.
  - **Code-only backstop:** `deterministicChecks` (quote not in the document, an amount of 0 with no supporting text, an estimate recorded as confirmed) always runs alongside the AI.
  - **Verdict:** decided in code. Any finding means FAIL, and an AI "PASS" cannot override a code-only finding. If the verifier can't run, the route returns an error, never a pass.
- **`/analyze`** runs the live flow: paste, `/api/extract`, `/api/verify`, then `RiskDashboard`. **`/demo`** can switch between scripted and live verifier output; the AI draft stays scripted so the injected errors are reproducible.
- **App shell:** `app/layout.tsx` with `components/AppHeader.tsx` (navigation plus live-AI status). `GET /api/status` reports whether `ANTHROPIC_API_KEY` is set and never returns the key; `components/useAiStatus.tsx` provides `useAiStatus` and `SetupNotice`.
- **Pages:** `/` (landing), `/demo`, `/analyze`, `/dashboard` (UK sample with a conflict). `/review` redirects to `/demo`. `RiskDashboard` takes `draftSource` and `verifierSource` (`"live"` or `"simulated"`) and shows them; **never present simulated AI output as live**.
- **Demo without an API key:** `lib/demo/simulatedRecommendation.ts` is a fixed, labelled simulated draft offered only on `/demo` (`allowSimulatedRecommendation`). It passes the same `validateRecommendationDraft` and Human Review Gate as a live draft, with input from `prepareRecommendationInput` (`lib/recommendationInput.ts`, shared with the API route).
- **Browser tests:** these live outside the repo. They were run with puppeteer-core against the installed Chrome, covering the full live flow and the no-key flow.
- `lib/types.ts` holds the TypeScript data model (`OrderAssessment`, verification, review and audit types). The Python flow doesn't use these types yet. Its field names differ, for example `sale_amount` vs `sales_value`.

## Current web app (supersedes the page notes above)

- **Navigation:**
  - Overview (`/`).
  - Dashboard (`/dashboard`): saved assessments, kept in localStorage via `lib/store.ts`.
  - New Assessment (`/assess`): `components/assess/Wizard.tsx`.
  - Settings (`/settings`, gear icon).
  - `/analyze`, `/review` and `/demo` redirect to `/assess`. The failure test is internal: `/assess?test=make-it-fail[&verifier=live]`, reached from Settings → Testing tools. `components/dashboard/RiskDashboard.tsx` and the other old dashboard components no longer exist.
- **Wizard steps:**
  - `StepInput`: sales and cost cards. `/api/transcribe` turns an uploaded image into text, which the user checks before analysis.
  - `StepReview`: verifier issue cards first, then missing, estimate and conflict cards, then the extracted-values table. **Approve and Continue** calls `lib/review.applyDecisions`.
  - `Results`.
- **Results parts:**
  - FX panel: `/api/fx` → `lib/fx.server.ts`.
  - Metrics: `lib/financials.ts` (`computeFinancials`), the single engine, also used by `scenarios.ts`.
  - `Calculations` dialog: the engine's own calculation steps.
  - Indicator and risks: `lib/riskCards.ts`, which outputs i18n message codes rather than text.
  - `Timeline` (`lib/timeline.ts`), `Simulator` (runs locally, no AI), `Recommendations`, `AuditLog`.
  - PDF: `lib/report.ts` (jsPDF), English and Indonesian only.
- **FX:**
  - `lookupExchangeRate` always needs an explicit provider; rates are never defaulted.
  - Live order of fallbacks: Frankfurter (ECB), then ExchangeRate-API, then a file cache (`.riskit_cache/fx-rates.json`, labelled `cached`), then `unavailable`. A manual rate is labelled `user-provided fallback`.
  - The sample rate file is for tests only.
  - Test hooks (env vars): `RISKIT_FX_OFFLINE=1`, `RISKIT_FX_CACHE_FILE`.
- **i18n:**
  - `lib/i18n`: `en.ts` is the reference catalogue and other languages fall back to it. `i18n.test.ts` keeps all catalogues complete.
  - `components/I18nProvider.tsx` stores the choice as `riskit.lang` in localStorage.
  - AI prompts get `aiLanguageInstruction(lang)`.
  - Never translate figures, currency codes, quotes or source documents.
- **Extraction decoding:** plain-string fields such as dates may come back without JSON quotes. These are accepted as literal strings (`decode` in `extraction.server.ts`) and still validated.

## Pipeline

1. **Input:** Users provide plain-text sales and cost documents.
2. **Extraction (Claude):** Claude extracts structured fields and explains any uncertainty in each extraction.
3. **Verification (second Claude call):** A separate Claude verifier checks the first output for extraction and assessment errors.
4. **Calculation (deterministic code):** All financial calculations run in plain code, never in Claude.
5. **Human review:** Every AI-generated item needs human approval before release.

## Non-negotiable rules

- **No AI-generated numbers:** All financial calculations must be deterministic code. Claude must never produce calculated figures.
- **Missing data:** Mark missing information as `UNKNOWN`. Never invent, infer, or default a value.
- **Conflicting values:** Show every conflicting value with its source document or location, and require the user to resolve the conflict before continuing.
- **Facts vs. assumptions:** Keep scenario assumptions (for example, hypothetical FX rates) structurally separate from facts extracted from documents, in both the data model and the UI.
- **Verifier failure blocks output:** If the AI verifier detects a failure, block and contain the output. It must not be released until a human has reviewed and approved a correction.
- **Human approval gate:** Every AI-generated correction, risk flag, explanation, and recommendation requires human approval before release.

## Scope

Assess only these risk types:
- FX risk
- Payment-collection risk
- Platform/payment-fee risk
- Logistics risk

Do **not** implement KYC, KYB, sanctions screening, tax, legal compliance, or full financial-statement analysis.

## Engineering constraints

- Keep Claude API usage to a minimum: no redundant calls, and send Claude only what each extraction or verification step needs.
- Avoid unnecessary dependencies.
