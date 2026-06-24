# Lie Detector

A static dashboard that, for any Indian listed company, extracts every **measurable
management commitment** from its earnings-call transcripts & investor presentations,
verifies each against later reported actuals, scores delivery reliability, and exports a
polished multi-page PDF.

> **Status:** Prompt 1 of ~12 — foundation only. The home page proves the data contract,
> golden fixture, app shell and LLM config stand up. Scraping, PDF parsing, live LLM
> extraction, charts and PDF export arrive in later prompts.

## Quick start

```bash
# Run the site + Worker locally (serves ./public, /api/* handled by the Worker)
npm run dev          # → npx wrangler dev

# Validate every company ledger against the data contract
npm run validate     # installs ajv --no-save, then checks public/data/companies/*.json

# Check the LLM client configuration (no key required, makes no LLM calls)
npm run llm:selftest # → node pipeline/lib/llm.mjs --selftest
```

Open the local URL Wrangler prints; the boot splash fades to a home page listing the
tracked companies (currently Vedanta, credibility **26 / E**) read from
`public/data/companies/index.json`.

## Layout

```
schema/lie-detector.schema.json   # THE DATA CONTRACT (source of truth)
worker/index.js                   # Cloudflare Worker: static assets + /api/*
wrangler.jsonc                    # Worker config (name: lie-detector)
public/
  index.html                      # app shell + design-system <style>
  js/ui.js                        # tokens, colour/number helpers, ECharts theme, loaders
  js/app.js                       # home page
  data/companies/
    vedl.json                     # golden fixture (real Vedanta data, validates)
    index.json                    # company summary list (generated)
pipeline/
  lib/llm.mjs                     # provider-agnostic OpenAI-compatible LLM client
  validate.mjs                    # ajv schema validator
CLAUDE.md                         # architecture, conventions, palette, roadmap
```

## Conventions

- **No build step.** `public/` loads dependencies from CDN (Tailwind Play, Google Fonts,
  Lucide, ECharts 5). No bundler, no frontend npm packages.
- **Datastore = committed JSON** under `public/data/`. No database.
- **Pipeline** scripts are Node ESM (`.mjs`); dependencies are installed `--no-save` and
  `node_modules/` is gitignored.
- **Dates** are handled in IST (Asia/Kolkata).
- **LLM keys** come from environment / secrets only — never committed.

See [CLAUDE.md](./CLAUDE.md) for the full architecture, the data contract, the colour
palette and the 12-prompt roadmap.
