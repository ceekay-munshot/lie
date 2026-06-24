/**
 * Lie Detector — Cloudflare Worker entrypoint.
 *
 * Routing model (see wrangler.jsonc):
 *   - Static assets in ./public are served FIRST by the platform. This Worker
 *     is only invoked when no static asset matches the request path.
 *   - Therefore the Worker handles exactly two things:
 *       1. /api/*  → JSON API (health now; report/company are 501 stubs,
 *          wired up in later prompts).
 *       2. everything else → SPA fallback: serve /index.html so client-side
 *          routing works for deep links.
 *
 * No data lives here. The datastore is committed JSON under public/data/.
 */

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

/**
 * Handle /api/* routes. Returns a Response, or null if the path is not a
 * recognised API route (so the caller can 404 it).
 */
function handleApi(url) {
  const path = url.pathname;

  // GET /api/health → liveness probe.
  if (path === "/api/health") {
    return json({ ok: true });
  }

  // GET /api/report/:ticker → full report payload (wired in a later prompt).
  const reportMatch = path.match(/^\/api\/report\/([^/]+)\/?$/);
  if (reportMatch) {
    const ticker = decodeURIComponent(reportMatch[1]);
    return json(
      { ok: false, error: "not_implemented", ticker, hint: "Report API is wired up in a later prompt." },
      501,
    );
  }

  // GET /api/company/:ticker → company summary (wired in a later prompt).
  const companyMatch = path.match(/^\/api\/company\/([^/]+)\/?$/);
  if (companyMatch) {
    const ticker = decodeURIComponent(companyMatch[1]);
    return json(
      { ok: false, error: "not_implemented", ticker, hint: "Company API is wired up in a later prompt." },
      501,
    );
  }

  // Unknown /api/* route.
  return json({ ok: false, error: "not_found" }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      return handleApi(url);
    }

    // SPA fallback: this Worker only runs for non-asset paths, so serve the
    // app shell (200 at the original URL) and let client-side routing take
    // over. We fetch the root "/" rather than "/index.html" because the asset
    // server 307-redirects the explicit index.html to "/", which would drop
    // the deep-link path.
    const rootUrl = new URL("/", url.origin);
    return env.ASSETS.fetch(new Request(rootUrl, request));
  },
};
