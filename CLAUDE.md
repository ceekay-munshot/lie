# CLAUDE.md — Lie Detector

Guidance for working in this repository. Read this before making changes.

## 1. What this is

**Lie Detector** is a static dashboard that, for any Indian listed company, extracts every
**measurable** management commitment from its earnings-call transcripts and investor
presentations, verifies each commitment against later reported actuals, scores delivery
reliability, and exports a polished multi-page PDF.

User flow: **search a company → dashboard** (credibility score, status donut, slippage
timeline, track-record cards, master promise table) **→ Export PDF**.

The product is opinionated about one thing: a *promise* is only interesting if it is
**measurable** and can eventually be **tested** against a reported actual. Everything in the
data model exists to support extract → verify → score.

## 2. Architecture

- **Static site, zero build step.** `public/` is served as-is. All third-party libraries
  load from CDN: Tailwind Play, Google Fonts (Inter + JetBrains Mono), Lucide, ECharts 5.
  No bundler. No frontend npm packages.
- **Cloudflare Worker** (`worker/index.js`) serves the static assets via the `ASSETS`
  binding and owns the `/api/*` namespace. Matching static assets are served first; any
  unmatched request falls through to the Worker, which serves `index.html` (SPA fallback)
  or handles `/api/*`. Config in `wrangler.jsonc` (worker name: `lie-detector`).
- **Datastore = committed JSON** under `public/data/`. One file per company
  (`companies/<ticker>.json`) plus a generated `companies/index.json` summary list. No DB.
- **Pipeline** lives under `pipeline/` as Node ESM (`.mjs`). It scrapes, parses, calls the
  LLM, and writes the company JSON. Dependencies are installed `--no-save`; `node_modules/`
  is gitignored. Pipeline output goes to `pipeline/output/` (gitignored).
- **LLM layer** (`pipeline/lib/llm.mjs`) is provider-agnostic over the OpenAI-compatible
  `/chat/completions` API. Primary provider **Gemini**, with failover to
  Groq / Cerebras / Mistral / NVIDIA. Keys come from env / secrets only.
- **Dates** are handled in IST (Asia/Kolkata).

```
schema/lie-detector.schema.json   THE DATA CONTRACT (source of truth)
wrangler.jsonc                    Worker config
worker/index.js                   static assets + /api/* (health; report/company stubs → 501)
public/index.html                 app shell + design-system <style>
public/js/ui.js                   design system + datastore loaders
public/js/app.js                  home page
public/data/companies/vedl.json   GOLDEN FIXTURE (real Vedanta data)
public/data/companies/index.json  generated summary list
pipeline/lib/llm.mjs              LLM client
pipeline/validate.mjs             ajv schema validator (npm run validate)
```

## 3. The data contract (most important)

`schema/lie-detector.schema.json` is the **single source of truth**. Every file under
`public/data/companies/*.json` (except `index.json`) must validate against it. Every
pipeline step reads and writes this shape. **Do not** drift fields ad hoc — if the model
needs to change, change the schema first, then `npm run validate`, then update the fixture.

One object per company. Top-level keys:

- `schema_version` — string.
- `company` — `{ ticker, name, sector?, screener_url?, fiscal_year_end? }`.
- `generated_at` — ISO date-time.
- `coverage` — `{ from, to, as_of? }` (e.g. `Q1FY26` → `Q3FY26`).
- `verification_window` — `{ latest_reported?, latest_reported_date?, note? }`. Outcomes are
  only testable through the latest reported period; later targets are **NYT**.
- `documents[]` — `{ id, type, quarter, date, title?, url?, source, role }`. `type` ∈
  transcript | presentation | press_release | annual_report | other; `role` ∈
  guidance | actuals | both.
- `promises[]` — the core ledger. Each:
  - `id`, `date`, `quarter_context`, `source_id?`, `source_label?`
  - `category` ∈ revenue | ebitda | margin | pat | capex | capacity | working_capital |
    leverage | roce | volume | orderbook | timeline | cost | capital_allocation | other
  - `promise` — short title of the commitment
  - `quote` — **≤25 words, verbatim** from the source
  - `metric` — the measurable being promised
  - `target` — `{ text?, value?, value_high?, unit?, period? }`
  - `test_date` — when it becomes verifiable
  - `confidence` ∈ **H | M | L** (extraction confidence)
  - `actual` — `{ text?, value?, unit?, source_id?, source_date?, what_happened? }`
  - `status` ∈ **MET | PARTIAL | MISSED | NYT** (NYT = not yet testable)
  - `variance` — `{ absolute?, pct?, bps?, days?, text? }`
  - `mgmt_explanation` — **≤25 words**
  - `root_cause` ∈ Demand slowdown | Pricing / mix | Cost inflation | Supply chain |
    Execution | Capacity delay | Regulatory | Working capital | Capital allocation | Other | null
- `financial_trend[]` — `{ quarter, ebitda?, ebitda_margin?, revenue?, pat?,
  net_debt_ebitda?, roce?, unit? }`.
- `aggregates` — `{ total, status_counts, testable?, by_quarter?, root_causes?,
  confidence_mix?, timeline_commitments? }`.
- `credibility` — `{ score?, grade?, timeline_score?, delivery_score?, method?, headline? }`.

### Credibility formula (documented now, implemented for real in Prompt 6)

Confidence-weighted **delivery rate over TESTABLE (non-NYT) promises**:

- Per-promise delivery: `MET = 1`, `PARTIAL = 0.5`, `MISSED = 0`.
- Confidence weights: `H = 1.0`, `M = 0.8`, `L = 0.6`.
- `score = 100 × Σ(weight × delivery) / Σ(weight)` over non-NYT promises.
- **Bands:** `A ≥ 75`, `B ≥ 60`, `C ≥ 45`, `D ≥ 30`, `E < 30`.

NYT promises are excluded from scoring (you cannot grade what cannot yet be tested). The
band lookup lives in `scoreToGrade()` in `public/js/ui.js`.

### Golden fixture

`public/data/companies/vedl.json` is the **reference fixture** — real Vedanta data,
42 promises (2 MET / 2 PARTIAL / 8 MISSED / 30 NYT), credibility **26 / E**. It already
validates against the schema and is the canonical example any pipeline change must keep
reproducing. `index.json` is generated from the company files.

## 4. Conventions

- Keep the **zero-build-step** rule: no bundlers, no frontend packages, CDN only.
- `public/js/ui.js` is the design system. Import colour/number helpers and data loaders
  from there — don't re-define palette values or formatters elsewhere.
- Money is shown in **₹ crore** with **Indian digit grouping** via `fmtINRcr()`.
- Pipeline scripts: Node ESM `.mjs`, deps `--no-save`, write valid schema JSON, never
  commit secrets or `node_modules/`.
- LLM access only through `pipeline/lib/llm.mjs`. Never hardcode keys or base URLs.
- Run `npm run validate` after touching any company JSON or the schema.

## 5. Colour palette (canonical)

Defined once in `public/js/ui.js` (`tokens`) and mirrored as CSS variables in
`public/index.html`. Do not introduce off-palette colours.

| Group | Token | Hex |
| --- | --- | --- |
| Status | MET | `#22C55E` |
| Status | PARTIAL | `#F59E0B` |
| Status | MISSED | `#FB3B53` |
| Status | NYT | `#7C8BB0` |
| Confidence | H | `#FF4D5E` |
| Confidence | M | `#FFB020` |
| Confidence | L | `#7C8BB0` |
| Accent | red | `#FF4D5E` |
| Accent | gold | `#FFB020` |
| Accent | violet | `#8B7BFF` |
| Accent | teal | `#2DD4BF` |
| Accent | cyan | `#38BDF8` |
| Dark | ink | `#0A0E1A` |
| Dark | ink2 | `#0F1626` |
| Dark | card | `#161F33` |
| Dark | line | `#27324D` |
| Dark | muted | `#93A4C7` |
| Dark | text | `#E8EEF9` |
| Light | bg | `#F4F6FB` |
| Light | text | `#0C1426` |
| Light | card | `#FFFFFF` |
| Light | line | `#E4E8F2` |

Grade ramp (derived): `A #22C55E · B #2DD4BF · C #FFB020 · D #F59E0B · E #FB3B53`.

## 6. Roadmap (~12 prompts)

Indicative arc; refine as later prompts land. Only Prompt 1 is built.

- [x] **P1 — Foundation.** Scaffold, Worker + static site, design system, the data
  contract, provider-agnostic LLM client, golden Vedanta fixture, `validate` + `selftest`.
- [ ] **P2 — Ingestion.** Fetch/scrape Screener transcripts, presentations & financials.
- [ ] **P3 — Parsing.** PDF / document text extraction → normalized text per document.
- [ ] **P4 — LLM layer (live).** Confirm provider models/limits, prompt scaffolding,
  structured-output plumbing end-to-end.
- [ ] **P5 — Extraction.** LLM extracts measurable promises → `promises[]`
  (target, metric, ≤25-word quote, confidence).
- [ ] **P6 — Verification & credibility.** Match promises to actuals, assign
  status/variance/root_cause, compute the credibility score & grade (formula above).
- [ ] **P7 — Aggregates & trends.** `status_counts`, `by_quarter`, `root_causes`,
  `confidence_mix`, `timeline_commitments`, `financial_trend`.
- [ ] **P8 — Dashboard core.** Header, credibility score card, status donut.
- [ ] **P9 — Charts & tables.** Slippage timeline, track-record cards, master promise
  table (ECharts, `lie-dark` theme).
- [ ] **P10 — Search & routing.** Company search, multi-company index, per-company routes.
- [ ] **P11 — PDF export.** Polished multi-page PDF.
- [ ] **P12 — QA, polish & deploy.** End-to-end run, accessibility, deploy to Cloudflare.

> Notes carried forward: confirm live LLM models/limits in **P4**; the credibility formula
> is implemented for real in **P6**; `vedl.json` is the reference fixture throughout.
