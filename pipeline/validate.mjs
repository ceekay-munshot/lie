/**
 * Lie Detector — schema validator.
 *
 * Validates every company ledger under public/data/companies/*.json against
 * schema/lie-detector.schema.json (the data contract). index.json is the
 * summary list, not a ledger, so it is skipped.
 *
 * Run via `npm run validate` (which installs ajv + ajv-formats --no-save).
 * Exits non-zero on any validation failure.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA_PATH = join(ROOT, "schema", "lie-detector.schema.json");
const COMPANIES_DIR = join(ROOT, "public", "data", "companies");
const SKIP = new Set(["index.json"]);

function readJSON(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

async function main() {
  // The contract declares JSON Schema draft 2020-12, so use the 2020 dialect.
  const { default: Ajv2020 } = await import("ajv/dist/2020.js");
  const { default: addFormats } = await import("ajv-formats");

  const schema = readJSON(SCHEMA_PATH);
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);

  const files = readdirSync(COMPANIES_DIR)
    .filter((f) => f.endsWith(".json") && !SKIP.has(f))
    .sort();

  if (files.length === 0) {
    console.error("✗ No company JSON files found in public/data/companies/");
    process.exit(1);
  }

  let failures = 0;
  for (const file of files) {
    const data = readJSON(join(COMPANIES_DIR, file));
    if (validate(data)) {
      const n = Array.isArray(data.promises) ? data.promises.length : 0;
      console.log(`✓ ${file}  (${n} promises, credibility ${data.credibility?.score ?? "?"}/${data.credibility?.grade ?? "?"})`);
    } else {
      failures++;
      console.error(`✗ ${file}`);
      for (const err of validate.errors ?? []) {
        console.error(`    ${err.instancePath || "/"} ${err.message}`);
      }
    }
  }

  const total = files.length;
  console.log(`\n${total - failures}/${total} file(s) valid against schema/lie-detector.schema.json`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Validator crashed:", err.message);
  process.exit(1);
});
