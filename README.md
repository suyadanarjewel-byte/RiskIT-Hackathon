# RiskIT

Transaction-level risk assessment for small cross-border sellers. A guided three-step journey:

1. **Document input**: paste, type or upload (text or image) a Sales Document and an optional Cost Document.
2. **AI verification & human review**: Claude extracts the order, an independent second Claude call verifies it. Any finding blocks the assessment until a person approves, corrects, marks UNKNOWN or rejects each item, then clicks **Approve and Continue**.
3. **Financial results**: live exchange rate (Frankfurter / ECB, with cached and manual fallbacks), revenue, gross and net profit, cash flow, View Calculations, Order Decision Indicator, payment timeline, What-If Simulator, explainable risks, human-approved recommendations and a PDF report.

All figures come from deterministic code. Missing values stay UNKNOWN and estimates stay estimates. Interface languages: English, 简体中文, Bahasa Indonesia, Tiếng Việt, 한국어 (Settings).

## Run

```bash
npm install
echo "ANTHROPIC_API_KEY=your-key" > .env.local   # needed for live AI extraction, verification and recommendations
npm run build && npm start                      # http://localhost:3000
```

Without a key the app explains what to configure. The internal failure test (Settings → Testing tools) runs the
Singapore USD 12,000 example with two deliberate AI errors using clearly labelled simulated AI output.
Exchange rates need internet access; offline, the app shows the last cached rate (labelled) or asks for a manual rate.

## Tests

```bash
npm test          # unit tests: calculations, FX fallbacks, timeline, risks, verifier, containment, i18n
npm run typecheck
```

RiskIT provides decision support and does not replace professional financial, legal, or compliance judgment.
