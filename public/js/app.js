/**
 * Lie Detector — home page.
 *
 * Foundation scope (Prompt 1): load the committed company index, render a
 * minimal card list, draw the status/confidence legend, and fade the boot
 * splash. The per-company dashboard, charts and PDF export arrive in later
 * prompts — clicking a card just acknowledges that for now.
 */

import {
  statusColor,
  confColor,
  gradeColor,
  scoreToGrade,
  fmtINRcr,
  loadIndex,
  fadeBoot,
} from "./ui.js";

/* ---- tiny DOM helpers ---- */
const $ = (sel) => document.querySelector(sel);

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
  );
}

/** hex → rgba() with alpha, for subtle tints. */
function hexA(hex, a) {
  const h = String(hex).replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** Format an ISO timestamp as a date in IST (Asia/Kolkata). */
function fmtDateIST(iso) {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "Asia/Kolkata",
    }).format(new Date(iso));
  } catch {
    return String(iso);
  }
}

function refreshIcons() {
  if (window.lucide && typeof window.lucide.createIcons === "function") {
    window.lucide.createIcons();
  }
}

/* ---- legend ---- */
const STATUS_LEGEND = [
  ["MET", "Met"],
  ["PARTIAL", "Partial"],
  ["MISSED", "Missed"],
  ["NYT", "Not yet tested"],
];
const CONF_LEGEND = [
  ["H", "High"],
  ["M", "Medium"],
  ["L", "Low"],
];

function chip(color, label) {
  return `<span class="chip"><span class="dot" style="background:${color}"></span>${escapeHtml(label)}</span>`;
}

function renderLegend() {
  const statusChips = STATUS_LEGEND.map(([code, label]) => chip(statusColor(code), label)).join("");
  const confChips = CONF_LEGEND.map(([code, label]) => chip(confColor(code), `${code} · ${label}`)).join("");
  $("#legend").innerHTML = `
    <div class="legend-group"><span class="glabel">Status</span>${statusChips}</div>
    <div class="legend-group"><span class="glabel">Confidence</span>${confChips}</div>`;
}

/* ---- company cards ---- */
function companyCard(c) {
  const grade = scoreToGrade(c.credibility_score);
  const col = gradeColor(grade);
  const badge =
    `style="color:${col};background:${hexA(col, 0.12)};border-color:${hexA(col, 0.4)}"`;
  return `
    <button class="ccard" data-ticker="${escapeHtml(c.ticker)}" data-name="${escapeHtml(c.name)}"
            data-sector="${escapeHtml(c.sector ?? "")}">
      <div class="ccard-top">
        <div>
          <div class="ccard-ticker">${escapeHtml(c.ticker)}</div>
          <div class="ccard-name">${escapeHtml(c.name)}</div>
          <div class="ccard-sector">${escapeHtml(c.sector ?? "—")}</div>
        </div>
        <div class="grade-badge" ${badge}>
          <span class="gscore">${escapeHtml(c.credibility_score ?? "—")}</span>
          <span class="gletter">${escapeHtml(grade ?? "—")}</span>
        </div>
      </div>
      <div class="ccard-foot">
        <span class="cov">${escapeHtml(c.coverage ?? "—")}</span>
        <span>Updated ${escapeHtml(fmtDateIST(c.updated_at))} <i data-lucide="arrow-right" style="width:14px;height:14px;vertical-align:-2px"></i></span>
      </div>
    </button>`;
}

let toastTimer;
function toast(msg) {
  let t = $("#toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "toast";
    t.style.cssText =
      "position:fixed;left:50%;bottom:28px;transform:translateX(-50%) translateY(12px);" +
      "background:var(--card);border:1px solid var(--line);color:var(--fg);padding:11px 16px;" +
      "border-radius:12px;font-size:13px;box-shadow:0 12px 32px rgba(0,0,0,.4);opacity:0;" +
      "transition:opacity .2s ease,transform .2s ease;z-index:80;pointer-events:none";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  requestAnimationFrame(() => {
    t.style.opacity = "1";
    t.style.transform = "translateX(-50%) translateY(0)";
  });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.style.opacity = "0";
    t.style.transform = "translateX(-50%) translateY(12px)";
  }, 2400);
}

/* ---- search (local filter over loaded index) ---- */
function wireSearch(companies) {
  const input = $("#search");
  const kbd = document.querySelector(".search .kbd");
  const setCount = (n) => {
    if (kbd) kbd.textContent = String(n);
  };
  setCount(companies.length);
  if (!input) return;
  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    let shown = 0;
    document.querySelectorAll(".ccard").forEach((card) => {
      const hay = `${card.dataset.ticker} ${card.dataset.name} ${card.dataset.sector}`.toLowerCase();
      const match = !q || hay.includes(q);
      card.style.display = match ? "" : "none";
      if (match) shown++;
    });
    setCount(shown);
  });
}

/* ---- footer ---- */
function renderFooter(count) {
  // The ₹ sample doubles as a live check that Indian digit grouping renders.
  $("#foot").innerHTML = `
    <span>Figures in ₹ crore, Indian grouping — e.g. <span class="font-mono">${fmtINRcr(123456)}</span></span>
    <span>${count} compan${count === 1 ? "y" : "ies"} tracked · data contract: <span class="font-mono">schema/lie-detector.schema.json</span></span>`;
}

/* ---- boot ---- */
async function main() {
  refreshIcons();
  renderLegend();

  const listEl = $("#companies");
  try {
    const companies = await loadIndex();
    if (!Array.isArray(companies) || companies.length === 0) {
      listEl.innerHTML = `<div class="state">No companies yet.</div>`;
    } else {
      listEl.innerHTML = companies.map(companyCard).join("");
      listEl.querySelectorAll(".ccard").forEach((card) => {
        card.addEventListener("click", () =>
          toast(`${card.dataset.ticker} dashboard ships in an upcoming build.`),
        );
      });
      wireSearch(companies);
    }
    renderFooter(Array.isArray(companies) ? companies.length : 0);
  } catch (err) {
    listEl.innerHTML = `<div class="state err">Couldn't load companies: ${escapeHtml(err.message)}</div>`;
    renderFooter(0);
  } finally {
    refreshIcons();
    $("#app").classList.add("app--ready");
    fadeBoot();
  }
}

main();
