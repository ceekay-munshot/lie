/**
 * Lie Detector — provider-agnostic LLM client (OpenAI-compatible).
 *
 * One thin layer over the `/chat/completions` API shared by Gemini (OpenAI
 * compat), Groq, Cerebras, Mistral and NVIDIA. Configuration is entirely via
 * environment / secrets — no keys ever live in the repo.
 *
 *   LLM_PROVIDER   primary provider name (default: gemini)
 *   LLM_API_KEY    primary provider key (or <PROVIDER>_API_KEY, e.g. GROQ_API_KEY)
 *   LLM_BASE_URL   override base URL for the primary provider
 *   LLM_MODEL      override model for the primary provider
 *   LLM_FALLBACKS  comma-separated provider names to fail over to, in order
 *
 * Exports:
 *   PROVIDER_PRESETS          base URL + default model per provider
 *   resolveChain(env)         ordered [primary, ...fallbacks] resolved configs
 *   chat(messages, opts)      → assistant text (string)
 *   completeJSON(msgs, schema, opts) → validated object (ajv + 1 repair retry)
 *
 * CLI:
 *   node pipeline/lib/llm.mjs --selftest
 *     Prints the resolved provider/model/baseURL and "config OK" WITHOUT a key.
 *     Sends a single 1-token ping only if a key is configured.
 *
 * No network calls happen on import or during normal build/validate.
 */

import process from "node:process";
import { pathToFileURL } from "node:url";

/* ------------------------------------------------------------------ *
 * Provider presets. NOTE: live model names / rate limits are confirmed
 * in Prompt 4 — treat the models below as sensible defaults. `jsonSchema`
 * marks providers known to accept response_format:{type:"json_schema"};
 * the rest fall back to json_object mode.
 * ------------------------------------------------------------------ */
export const PROVIDER_PRESETS = {
  gemini: {
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    model: "gemini-2.5-flash",
    jsonSchema: true,
  },
  groq: {
    baseURL: "https://api.groq.com/openai/v1",
    model: "llama-3.3-70b-versatile",
    jsonSchema: true,
  },
  cerebras: {
    baseURL: "https://api.cerebras.ai/v1",
    model: "llama-3.3-70b",
    jsonSchema: true,
  },
  mistral: {
    baseURL: "https://api.mistral.ai/v1",
    model: "mistral-large-latest",
    jsonSchema: true,
  },
  nvidia: {
    baseURL: "https://integrate.api.nvidia.com/v1",
    model: "meta/llama-3.3-70b-instruct",
    jsonSchema: false,
  },
};

export const DEFAULT_PROVIDER = "gemini";

/* ------------------------------------------------------------------ *
 * Errors & small utilities
 * ------------------------------------------------------------------ */
export class LLMError extends Error {
  constructor(message, { status = null, provider = null, cause = null } = {}) {
    super(message);
    this.name = "LLMError";
    this.status = status;
    this.provider = provider;
    if (cause) this.cause = cause;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function joinURL(base, path) {
  return `${String(base).replace(/\/+$/, "")}/${String(path).replace(/^\/+/, "")}`;
}

function backoffMs(attempt, res) {
  if (res && typeof res.headers?.get === "function") {
    const ra = res.headers.get("retry-after");
    if (ra && !Number.isNaN(Number(ra))) return Math.min(Number(ra) * 1000, 30_000);
  }
  const base = 500 * 2 ** attempt;
  return Math.min(base, 16_000) + Math.floor(Math.random() * 250);
}

function isRetryableNetworkError(err) {
  // Aborts (timeouts) and transient fetch/network failures are retryable.
  return (
    err?.name === "AbortError" ||
    err?.name === "TypeError" || // fetch network failure surfaces as TypeError
    /network|fetch failed|ECONN|ETIMEDOUT|EAI_AGAIN/i.test(err?.message || "")
  );
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ *
 * Config resolution
 * ------------------------------------------------------------------ */

/** Resolve a single provider's config, honouring overrides + per-provider key. */
function resolveProvider(name, env, { allowGenericKey = false } = {}) {
  const key = String(name || "").toLowerCase();
  const preset = PROVIDER_PRESETS[key] || {};
  const perProviderKey = env[`${key.toUpperCase()}_API_KEY`];
  return {
    provider: key,
    baseURL: (allowGenericKey && env.LLM_BASE_URL) || preset.baseURL || null,
    model: (allowGenericKey && env.LLM_MODEL) || preset.model || null,
    apiKey: perProviderKey || (allowGenericKey && env.LLM_API_KEY) || null,
    supportsJsonSchema: preset.jsonSchema ?? false,
    known: Boolean(PROVIDER_PRESETS[key]),
  };
}

/**
 * Build the ordered provider chain: the primary (LLM_PROVIDER, with
 * LLM_BASE_URL/LLM_MODEL/LLM_API_KEY overrides) followed by LLM_FALLBACKS.
 */
export function resolveChain(env = process.env) {
  const primaryName = (env.LLM_PROVIDER || DEFAULT_PROVIDER).toLowerCase();
  const primary = resolveProvider(primaryName, env, { allowGenericKey: true });

  const fallbackNames = (env.LLM_FALLBACKS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .filter((n) => n !== primaryName);

  const fallbacks = fallbackNames.map((n) => resolveProvider(n, env));
  return [primary, ...fallbacks];
}

/* ------------------------------------------------------------------ *
 * Core request
 * ------------------------------------------------------------------ */

function buildResponseFormat(cfg, jsonSchema, jsonMode, strict) {
  if (jsonSchema) {
    if (cfg.supportsJsonSchema) {
      const name = (jsonSchema.title || "result").replace(/[^a-zA-Z0-9_]+/g, "_").slice(0, 60) || "result";
      return { type: "json_schema", json_schema: { name, schema: jsonSchema, strict: strict ?? true } };
    }
    return { type: "json_object" };
  }
  if (jsonMode) return { type: "json_object" };
  return undefined;
}

/** POST one chat request to a single provider, with retry on 429/5xx/network. */
async function callProvider(cfg, body, { retries, timeoutMs }) {
  const url = joinURL(cfg.baseURL, "chat/completions");
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    let res;
    try {
      res = await fetchWithTimeout(
        url,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${cfg.apiKey}`,
          },
          body: JSON.stringify(body),
        },
        timeoutMs,
      );
    } catch (err) {
      lastErr = new LLMError(`${cfg.provider}: request failed — ${err.message}`, {
        provider: cfg.provider,
        cause: err,
      });
      if (attempt < retries && isRetryableNetworkError(err)) {
        await sleep(backoffMs(attempt));
        continue;
      }
      throw lastErr;
    }

    if (res.status === 429 || res.status >= 500) {
      lastErr = new LLMError(`${cfg.provider}: HTTP ${res.status}`, {
        status: res.status,
        provider: cfg.provider,
      });
      if (attempt < retries) {
        await sleep(backoffMs(attempt, res));
        continue;
      }
      throw lastErr;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new LLMError(`${cfg.provider}: HTTP ${res.status} — ${text.slice(0, 300)}`, {
        status: res.status,
        provider: cfg.provider,
      });
    }

    return res.json();
  }
  throw lastErr || new LLMError(`${cfg.provider}: exhausted retries`, { provider: cfg.provider });
}

/**
 * Send a chat completion, failing over across the resolved provider chain.
 * @param {Array<{role:string,content:string}>} messages
 * @param {object} [opts] temperature, maxTokens, jsonSchema, jsonMode, strict,
 *                        retries, timeoutMs, chain, raw, onProviderError
 * @returns {Promise<string|object>} assistant text, or full JSON if opts.raw
 */
export async function chat(messages, opts = {}) {
  const chain = (opts.chain || resolveChain()).filter((c) => c.apiKey && c.baseURL && c.model);
  if (chain.length === 0) {
    throw new LLMError(
      "No LLM provider configured with an API key. Set LLM_API_KEY (and optionally LLM_PROVIDER / LLM_FALLBACKS).",
    );
  }

  const retries = opts.retries ?? 3;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  let lastErr;

  for (const cfg of chain) {
    try {
      const body = {
        model: cfg.model,
        messages,
        temperature: opts.temperature ?? 0.2,
        ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
        ...(() => {
          const rf = buildResponseFormat(cfg, opts.jsonSchema, opts.jsonMode, opts.strict);
          return rf ? { response_format: rf } : {};
        })(),
      };
      const json = await callProvider(cfg, body, { retries, timeoutMs });
      if (opts.raw) return json;
      return json?.choices?.[0]?.message?.content ?? "";
    } catch (err) {
      lastErr = err;
      if (typeof opts.onProviderError === "function") opts.onProviderError(cfg, err);
      // fall through to the next provider in the chain
    }
  }
  throw lastErr || new LLMError("All providers failed");
}

/* ------------------------------------------------------------------ *
 * Structured JSON completion (ajv-validated + one repair retry)
 * ------------------------------------------------------------------ */

// ajv is imported lazily so --selftest works without it installed.
async function compileValidator(schema) {
  // Use the 2020-12 dialect (our data contract declares it); also accepts
  // schemas with no $schema set.
  const { default: Ajv2020 } = await import("ajv/dist/2020.js");
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  try {
    const { default: addFormats } = await import("ajv-formats");
    addFormats(ajv);
  } catch {
    /* ajv-formats optional; unknown formats are ignored */
  }
  return ajv.compile(schema);
}

function stripFences(text) {
  const t = String(text).trim();
  const fenced = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : t;
}

function tryParseJSON(text) {
  if (typeof text !== "string") return { ok: false, error: "non-string response" };
  const t = stripFences(text);
  try {
    return { ok: true, value: JSON.parse(t) };
  } catch (e) {
    const m = t.match(/[{[][\s\S]*[}\]]/);
    if (m) {
      try {
        return { ok: true, value: JSON.parse(m[0]) };
      } catch {
        /* fall through */
      }
    }
    return { ok: false, error: e.message };
  }
}

function formatAjvErrors(errs) {
  if (!errs || !errs.length) return "(no details)";
  return errs.map((e) => `- ${e.instancePath || "/"} ${e.message}`).join("\n");
}

/**
 * Complete to a JSON object validated against `jsonSchema`. Uses native
 * structured output where the provider supports it, validates with ajv, and
 * performs exactly one repair retry feeding the validation errors back.
 * @returns {Promise<object>} the validated object
 */
export async function completeJSON(messages, jsonSchema, opts = {}) {
  if (!jsonSchema || typeof jsonSchema !== "object") {
    throw new LLMError("completeJSON: a JSON schema object is required");
  }
  const validate = await compileValidator(jsonSchema);
  const msgs = [...messages];
  let lastDetail = "";

  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await chat(msgs, { ...opts, jsonSchema, jsonMode: true });
    const parsed = tryParseJSON(text);

    if (parsed.ok && validate(parsed.value)) {
      return parsed.value;
    }
    lastDetail = parsed.ok ? formatAjvErrors(validate.errors) : `invalid JSON: ${parsed.error}`;

    if (attempt === 0) {
      // Repair retry: show the model its output and the precise failures.
      msgs.push({ role: "assistant", content: text });
      msgs.push({
        role: "user",
        content:
          "Your previous response did not satisfy the required JSON schema.\n" +
          `Problems:\n${lastDetail}\n\n` +
          "Return ONLY corrected JSON that conforms to the schema. No prose, no markdown fences.",
      });
    }
  }

  throw new LLMError(`completeJSON: output failed schema validation after one repair.\n${lastDetail}`);
}

/* ------------------------------------------------------------------ *
 * CLI self-test
 * ------------------------------------------------------------------ */
async function selftest() {
  const chain = resolveChain();
  const primary = chain[0];
  const line = (k, v) => console.log(`  ${k.padEnd(10)}: ${v}`);

  console.log("Lie Detector — LLM config self-test");
  line("provider", primary.provider + (primary.known ? "" : "  (unknown preset)"));
  line("model", primary.model ?? "(unset)");
  line("baseURL", primary.baseURL ?? "(unset)");
  line("apiKey", primary.apiKey ? "set (hidden)" : "not set");
  line("json", primary.supportsJsonSchema ? "json_schema" : "json_object");
  line("fallbacks", chain.slice(1).map((c) => c.provider).join(", ") || "(none)");

  if (primary.apiKey) {
    process.stdout.write("  ping      : ");
    try {
      await chat([{ role: "user", content: "ping" }], { maxTokens: 1, temperature: 0, retries: 1 });
      console.log("ok");
    } catch (err) {
      console.log(`failed — ${err.message}`);
    }
  } else {
    line("ping", "skipped (no key set)");
  }

  console.log("config OK");
}

const invokedDirectly = (() => {
  try {
    return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
})();

if (invokedDirectly && process.argv.includes("--selftest")) {
  await selftest();
}
