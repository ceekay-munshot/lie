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

## Deploy

The whole app is static (it reads committed JSON under `public/data/`), so it can be hosted
two ways. Asset/data paths are resolved relative to the page, so the site works both at a
domain root and under a project subpath.

- **GitHub Pages (preview — no accounts/secrets).** `.github/workflows/ci.yml` publishes
  `public/` to GitHub Pages on every push to `main`. One-time: **repo Settings → Pages →
  Build and deployment → Source = "GitHub Actions"** (the workflow also tries to enable this
  automatically). Site URL: `https://<owner>.github.io/<repo>/` — here
  **https://ceekay-munshot.github.io/lie/**. `/api/*` does not run on Pages, but the UI reads
  the JSON datastore directly, so it doesn't need it.
- **Cloudflare Workers (production — optional).** The repo is also a Worker
  (`wrangler.jsonc` + `worker/index.js`) that serves `public/` via the `ASSETS` binding and
  owns `/api/*`. CI deploys it on push to `main` **only if** `CLOUDFLARE_API_TOKEN` and
  `CLOUDFLARE_ACCOUNT_ID` repo secrets are set (otherwise the step skips cleanly); or run
  `npx wrangler login && npx wrangler deploy` locally.

> This repo does **not** use Cloudflare Pages. If a `lie-ekp` Pages project is still
> connected, deleting it stops its 404 deployments (Cloudflare dashboard → Workers & Pages →
> `lie-ekp` → Settings → Delete project).

See [CLAUDE.md](./CLAUDE.md) for the full architecture, the data contract, the colour
palette and the 12-prompt roadmap.
