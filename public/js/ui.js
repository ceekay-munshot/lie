/**
 * Lie Detector — shared design system & data layer.
 *
 * Native ES module (no bundler). Imported by app.js and every later page.
 * Single source of truth for: the colour palette (tokens), status/confidence/
 * grade colour helpers, Indian-format number helpers, the ECharts dark theme,
 * and the JSON datastore loaders.
 *
 * The committed JSON under /data/companies/*.json conforms to
 * schema/lie-detector.schema.json — that schema is the data contract.
 */

/* ------------------------------------------------------------------ *
 * Palette tokens — must match schema/CLAUDE.md and the <style> block.
 * ------------------------------------------------------------------ */
export const tokens = {
  // Promise outcome statuses.
  status: { MET: "#22C55E", PARTIAL: "#F59E0B", MISSED: "#FB3B53", NYT: "#7C8BB0" },
  // Extraction confidence.
  confidence: { H: "#FF4D5E", M: "#FFB020", L: "#7C8BB0" },
  // Chart / UI accents.
  accent: { red: "#FF4D5E", gold: "#FFB020", violet: "#8B7BFF", teal: "#2DD4BF", cyan: "#38BDF8" },
  // Dark theme (default).
  dark: { ink: "#0A0E1A", ink2: "#0F1626", card: "#161F33", line: "#27324D", muted: "#93A4C7", text: "#E8EEF9" },
  // Light theme.
  light: { bg: "#F4F6FB", text: "#0C1426", card: "#FFFFFF", line: "#E4E8F2" },
  // Credibility grade ramp (A best → E worst). Bands: A>=75 B>=60 C>=45 D>=30 E<30.
  grade: { A: "#22C55E", B: "#2DD4BF", C: "#FFB020", D: "#F59E0B", E: "#FB3B53" },
};

/* ------------------------------------------------------------------ *
 * Colour helpers — defensive (case-insensitive, safe fallback).
 * ------------------------------------------------------------------ */

/** Colour for a promise status (MET | PARTIAL | MISSED | NYT). */
export function statusColor(s) {
  return tokens.status[String(s ?? "").toUpperCase()] ?? tokens.status.NYT;
}

/** Colour for an extraction confidence level (H | M | L). */
export function confColor(c) {
  return tokens.confidence[String(c ?? "").toUpperCase()] ?? tokens.confidence.L;
}

/** Colour for a credibility grade (A–E). */
export function gradeColor(g) {
  return tokens.grade[String(g ?? "").toUpperCase()] ?? tokens.dark.muted;
}

/**
 * Map a 0–100 credibility score to a letter grade.
 * Bands (see CLAUDE.md / credibility method): A>=75 B>=60 C>=45 D>=30 E<30.
 * The real score is computed in the pipeline (Prompt 6); this is the shared
 * band lookup used wherever only the numeric score is on hand.
 */
export function scoreToGrade(score) {
  if (!_isNum(score)) return null;
  const s = Number(score);
  if (s >= 75) return "A";
  if (s >= 60) return "B";
  if (s >= 45) return "C";
  if (s >= 30) return "D";
  return "E";
}

/* ------------------------------------------------------------------ *
 * Number formatters — Indian conventions.
 * ------------------------------------------------------------------ */

const EM_DASH = "—";
const _inr0 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

function _isNum(n) {
  return n !== null && n !== undefined && n !== "" && !Number.isNaN(Number(n));
}

/**
 * Format an amount in ₹ crore with Indian digit grouping (2-2-3),
 * e.g. fmtINRcr(123456) → "₹1,23,456 cr".
 * @param {number|null} n
 * @param {{decimals?:number, symbol?:boolean}} [opts]
 */
export function fmtINRcr(n, { decimals = 0, symbol = true } = {}) {
  if (!_isNum(n)) return EM_DASH;
  const fmt =
    decimals === 0
      ? _inr0
      : new Intl.NumberFormat("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return `${symbol ? "₹" : ""}${fmt.format(Number(n))} cr`;
}

/**
 * Format a percentage. Input is already in percent units (e.g. 41 → "41%").
 * Integers render with no decimals; fractionals default to 1 decimal.
 */
export function fmtPct(n, { decimals } = {}) {
  if (!_isNum(n)) return EM_DASH;
  const num = Number(n);
  const d = decimals ?? (Number.isInteger(num) ? 0 : 1);
  return `${num.toFixed(d)}%`;
}

/**
 * Format a signed number, e.g. fmtSigned(5) → "+5", fmtSigned(-3.2) → "-3.2".
 * Zero renders unsigned as "0".
 */
export function fmtSigned(n, { decimals } = {}) {
  if (!_isNum(n)) return EM_DASH;
  const num = Number(n);
  const d = decimals ?? (Number.isInteger(num) ? 0 : 1);
  const sign = num > 0 ? "+" : "";
  return `${sign}${num.toFixed(d)}`;
}

/* ------------------------------------------------------------------ *
 * ECharts dark theme — registered as "lie-dark" when ECharts is present.
 * Charts arrive in a later prompt; the theme is exported now so every
 * chart page shares one look.
 * ------------------------------------------------------------------ */
export const echartsTheme = {
  color: [
    tokens.accent.cyan,
    tokens.accent.violet,
    tokens.accent.teal,
    tokens.accent.gold,
    tokens.accent.red,
    tokens.status.MET,
  ],
  backgroundColor: "transparent",
  textStyle: { fontFamily: "Inter, system-ui, sans-serif", color: tokens.dark.text },
  title: {
    textStyle: { color: tokens.dark.text },
    subtextStyle: { color: tokens.dark.muted },
  },
  legend: { textStyle: { color: tokens.dark.muted } },
  tooltip: {
    backgroundColor: tokens.dark.card,
    borderColor: tokens.dark.line,
    borderWidth: 1,
    textStyle: { color: tokens.dark.text },
    axisPointer: { lineStyle: { color: tokens.dark.line }, crossStyle: { color: tokens.dark.line } },
  },
  grid: { borderColor: tokens.dark.line, containLabel: true },
  categoryAxis: {
    axisLine: { lineStyle: { color: tokens.dark.line } },
    axisTick: { lineStyle: { color: tokens.dark.line } },
    axisLabel: { color: tokens.dark.muted },
    splitLine: { show: false, lineStyle: { color: tokens.dark.line } },
  },
  valueAxis: {
    axisLine: { show: false, lineStyle: { color: tokens.dark.line } },
    axisTick: { lineStyle: { color: tokens.dark.line } },
    axisLabel: { color: tokens.dark.muted },
    splitLine: { lineStyle: { color: tokens.dark.line, type: "dashed" } },
  },
};

// Register the theme if ECharts is already on the page (harmless no-op otherwise).
if (typeof window !== "undefined" && window.echarts && typeof window.echarts.registerTheme === "function") {
  window.echarts.registerTheme("lie-dark", echartsTheme);
}

/* ------------------------------------------------------------------ *
 * Datastore loaders — read committed JSON under <base>/data/companies/.
 * The directory is resolved relative to THIS module's URL so the app works
 * both at a domain root (Cloudflare Workers: /js/ui.js) and under a project
 * subpath (GitHub Pages: /lie/js/ui.js).
 * ------------------------------------------------------------------ */
const DATA_DIR = new URL("../data/companies/", import.meta.url);

/** Load the company index (array of summary cards). */
export async function loadIndex() {
  const res = await fetch(new URL("index.json", DATA_DIR), { cache: "no-cache" });
  if (!res.ok) throw new Error(`Failed to load company index (HTTP ${res.status})`);
  return res.json();
}

/** Load a single company's full promise ledger by ticker (case-insensitive). */
export async function loadCompany(ticker) {
  const t = String(ticker ?? "").trim().toLowerCase();
  if (!t) throw new Error("loadCompany: ticker is required");
  const res = await fetch(new URL(`${encodeURIComponent(t)}.json`, DATA_DIR), { cache: "no-cache" });
  if (!res.ok) throw new Error(`Failed to load company "${ticker}" (HTTP ${res.status})`);
  return res.json();
}

/* ------------------------------------------------------------------ *
 * Boot loader — full-screen splash that fades once the app has rendered.
 * ------------------------------------------------------------------ */

/** Fade out and remove the #boot splash overlay. Safe to call once. */
export function fadeBoot() {
  const el = document.getElementById("boot");
  if (!el) return;
  el.classList.add("boot--hidden");
  el.addEventListener("transitionend", () => el.remove(), { once: true });
  // Fallback removal in case the transitionend event never fires.
  setTimeout(() => el.remove(), 800);
}
