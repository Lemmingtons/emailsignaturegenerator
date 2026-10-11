#!/usr/bin/env node
/**
 * Search Console export
 *
 * Pulls the last 28 days of Google Search Console data (by query, by page, and
 * by query + page) and writes one JSON file per run. The scheduled workflow
 * commits it to the `data/search-console` branch, away from `main`, so the data
 * never deploys and the monthly audit can read it with git.
 *
 * Env:
 *   GSC_SERVICE_ACCOUNT_JSON  service account key (JSON). Required.
 *   GSC_SITE                  property, e.g. "sc-domain:emailsignaturegenerator.ai"
 *                             or "https://emailsignaturegenerator.ai/". Optional;
 *                             both forms are tried when unset.
 *   OUT_DIR                   output directory. Default: search-console/
 *
 * No dependencies: the OAuth JWT is signed with Node's crypto.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DEFAULT_SITES = ['sc-domain:emailsignaturegenerator.ai', 'https://emailsignaturegenerator.ai/'];
const ROW_LIMIT = 25000;

const base64url = (input) => Buffer.from(input).toString('base64url');

async function accessToken(key) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(JSON.stringify({
    iss: key.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600,
  }));
  const signature = crypto.createSign('RSA-SHA256').update(`${header}.${claims}`).sign(key.private_key, 'base64url');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claims}.${signature}`,
    }),
  });
  if (!res.ok) throw new Error(`token request failed: HTTP ${res.status}`);
  return (await res.json()).access_token;
}

// The API returns at most 25,000 rows per request and pages with startRow.
async function queryAll(token, site, body) {
  const rows = [];
  for (let startRow = 0; ; startRow += ROW_LIMIT) {
    const page = await query(token, site, { ...body, rowLimit: ROW_LIMIT, startRow });
    rows.push(...page);
    if (page.length < ROW_LIMIT) return rows;
  }
}

async function query(token, site, body) {
  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = new Error(`searchAnalytics query failed for ${site}: HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return (await res.json()).rows || [];
}

// Search Console data lags by about two days, so the window ends three days ago.
function dateWindow(days = 28) {
  const end = new Date(Date.now() - 3 * 86400000);
  const start = new Date(end.getTime() - (days - 1) * 86400000);
  const iso = (d) => d.toISOString().slice(0, 10);
  return { startDate: iso(start), endDate: iso(end) };
}

const round = (n, places) => Math.round(n * 10 ** places) / 10 ** places;
const tidy = (rows, dims) => rows.map((r) => ({
  ...Object.fromEntries(dims.map((d, i) => [d, r.keys[i]])),
  clicks: r.clicks, impressions: r.impressions, ctr: round(r.ctr, 4), position: round(r.position, 1),
}));

async function main() {
  const raw = process.env.GSC_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GSC_SERVICE_ACCOUNT_JSON is not set');
  const key = JSON.parse(raw);
  const token = await accessToken(key);
  const window = dateWindow();

  const candidates = process.env.GSC_SITE ? [process.env.GSC_SITE] : DEFAULT_SITES;
  // Pick the first property with data; fall back to the first accessible one.
  let site = null;
  let totals = null;
  for (const candidate of candidates) {
    try {
      const rows = await query(token, candidate, { ...window, dimensions: [] });
      if (!site) { site = candidate; totals = rows; }
      if (rows.length) { site = candidate; totals = rows; break; }
    } catch (err) {
      // 403 means this property form isn't the one the service account was added to.
      if (err.status !== 403 && err.status !== 404) throw err;
    }
  }
  if (!site) {
    throw new Error(`no access to ${candidates.join(' or ')}; add ${key.client_email} as a user on the Search Console property`);
  }

  const report = { site, ...window, generatedAt: new Date().toISOString(), totals: tidy(totals, [])[0] || null };
  for (const dims of [['query'], ['page'], ['query', 'page'], ['country'], ['device']]) {
    const rows = await queryAll(token, site, { ...window, dimensions: dims });
    report[dims.join('_')] = tidy(rows, dims);
  }

  const outDir = process.env.OUT_DIR || 'search-console';
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `${window.endDate}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
  fs.writeFileSync(path.join(outDir, 'latest.json'), JSON.stringify(report, null, 2) + '\n');
  const t = report.totals || { clicks: 0, impressions: 0 };
  console.log(`Wrote ${file}: ${t.clicks} clicks, ${t.impressions} impressions, ${report.query.length} queries, ${report.page.length} pages`);
}

main().catch((err) => {
  // Never print the key or token; messages above only name the property and status.
  console.error(err.message);
  process.exit(1);
});
