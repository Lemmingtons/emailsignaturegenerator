#!/usr/bin/env node
/**
 * Compares buy-button clicks (Workers Analytics Engine, /api/checkout-click)
 * with live Stripe Checkout sessions, so abandoned sessions can be split into
 * real clicks and sessions nobody clicked for (link previews, crawlers).
 *
 * Read-only: one Analytics Engine SQL query and Stripe session list calls.
 *
 * Usage: node scripts/checkout-funnel.js [--days 30]
 *
 * Needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (Account Analytics:
 * Read). Stripe uses STRIPE_API_KEY when set (a restricted key with Checkout
 * Sessions read is enough), otherwise the logged-in `stripe` CLI.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// Clicks were first recorded when #46 deployed. Sessions before this have no
// clicks to match, so they are left out rather than reported as previews.
const TRACKING_STARTED_AT = Date.parse('2026-11-20T07:30:00Z');
// A session is matched to a click of the same plan made up to this long before
// it (the visitor reads the page first) or shortly after (clock skew).
const MATCH_BEFORE_MS = 120_000;
const MATCH_AFTER_MS = 15_000;
// Stripe estimates location from the IP before an address is typed, and the
// owner works from Australia, so AU clicks are most likely our own testing.
const OWNER_COUNTRY = 'AU';

function paymentLinkPlans() {
  const toml = fs.readFileSync(path.join(__dirname, '..', 'wrangler.toml'), 'utf8');
  const plans = {};
  for (const [key, plan] of [['STRIPE_PAYMENT_LINK_ID', 'pro'], ['STRIPE_TEAM_PAYMENT_LINK_ID', 'team']]) {
    const match = toml.match(new RegExp(`^${key}\\s*=\\s*"(plink_[A-Za-z0-9]+)"`, 'm'));
    if (match) plans[match[1]] = plan;
  }
  return plans;
}

// Pairs each session with the closest unused click of the same plan inside
// the window. Pure, so tests can drive it with fixtures.
function matchSessions(sessions, clicks) {
  const used = new Set();
  const ordered = [...sessions].sort((a, b) => a.created - b.created);
  return ordered.map((session) => {
    let best = -1;
    clicks.forEach((click, i) => {
      if (used.has(i) || click.plan !== session.plan) return;
      const lead = session.created - click.at;
      if (lead > MATCH_BEFORE_MS || lead < -MATCH_AFTER_MS) return;
      if (best === -1 || Math.abs(lead) < Math.abs(session.created - clicks[best].at)) best = i;
    });
    if (best !== -1) used.add(best);
    return { ...session, click: best === -1 ? null : clicks[best] };
  }).concat(clicks.filter((_, i) => !used.has(i)).map((click) => ({ orphanClick: click })));
}

function summarise(matched) {
  const plans = {};
  const row = (plan) => (plans[plan] ||= {
    sessions: 0, paid: 0, clicked: 0, clickedByOwner: 0, clickedAutomated: 0, outside: 0, noClick: 0, noClickPaid: 0, clicksWithoutSession: 0,
  });
  for (const entry of matched) {
    if (entry.orphanClick) { row(entry.orphanClick.plan).clicksWithoutSession++; continue; }
    const r = row(entry.plan);
    r.sessions++;
    if (entry.paid) r.paid++;
    if (!entry.click) { r.noClick++; if (entry.paid) r.noClickPaid++; continue; }
    r.clicked++;
    if (entry.click.country === OWNER_COUNTRY) r.clickedByOwner++;
    if (entry.click.agent === 'automated') r.clickedAutomated++;
    // Counted directly: an AU automated click is in both groups above.
    if (entry.click.country !== OWNER_COUNTRY && entry.click.agent !== 'automated') r.outside++;
  }
  return plans;
}

async function fetchClicks(sinceMs) {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!account || !token) throw new Error('Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (Account Analytics: Read).');
  const since = new Date(sinceMs).toISOString().replace('T', ' ').slice(0, 19);
  const sql = `SELECT timestamp, blob1 AS placement, blob2 AS plan, blob3 AS country, blob4 AS agent, _sample_interval AS weight
    FROM checkout_clicks WHERE timestamp >= toDateTime('${since}') ORDER BY timestamp FORMAT JSON`;
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/analytics_engine/sql`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: sql,
  });
  const text = await response.text();
  // A dataset nobody has written to yet does not exist.
  if (!response.ok && /unknown table|does not exist/i.test(text)) return [];
  if (!response.ok) throw new Error(`Analytics Engine query failed: HTTP ${response.status} ${text.slice(0, 200)}`);
  const rows = JSON.parse(text).data || [];
  // A sampled row stands for clicks whose times are unknown, so it is never
  // copied into extra clicks; the report warns that matching is approximate.
  const clicks = rows.map((r) => ({
    at: Date.parse(`${r.timestamp.replace(' ', 'T')}Z`), placement: r.placement, plan: r.plan, country: r.country, agent: r.agent,
  }));
  clicks.sampled = rows.some((r) => Number(r.weight) > 1);
  return clicks;
}

function stripePage(sinceSec, startingAfter) {
  const params = { limit: '100', 'created[gte]': String(sinceSec) };
  if (startingAfter) params.starting_after = startingAfter;
  if (process.env.STRIPE_API_KEY) {
    const query = new URLSearchParams(params).toString();
    return fetch(`https://api.stripe.com/v1/checkout/sessions?${query}`, {
      headers: { Authorization: `Bearer ${process.env.STRIPE_API_KEY}` },
    }).then(async (r) => {
      if (!r.ok) throw new Error(`Stripe request failed: HTTP ${r.status}`);
      return r.json();
    });
  }
  const args = ['checkout', 'sessions', 'list', '--live', ...Object.entries(params).flatMap(([k, v]) => ['-d', `${k}=${v}`])];
  const out = execFileSync('stripe', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  // The CLI prints an account banner before the JSON.
  return Promise.resolve(JSON.parse(out.slice(out.indexOf('{'))));
}

async function fetchSessions(sinceMs, plans) {
  const sessions = [];
  let after;
  for (;;) {
    const page = await stripePage(Math.floor(sinceMs / 1000), after);
    for (const s of page.data) {
      const plan = plans[s.payment_link];
      if (!plan) continue;
      sessions.push({ id: s.id, created: s.created * 1000, plan, paid: s.payment_status === 'paid', status: s.status });
    }
    if (!page.has_more || !page.data.length) break;
    after = page.data[page.data.length - 1].id;
  }
  return sessions;
}

function report(plans, sinceMs) {
  console.log(`Checkout funnel since ${new Date(sinceMs).toISOString().slice(0, 16).replace('T', ' ')} UTC\n`);
  const names = Object.keys(plans);
  if (!names.length) { console.log('No Stripe sessions or clicks in this window.'); return; }
  for (const plan of names.sort()) {
    const r = plans[plan];
    console.log(`${plan.toUpperCase()}`);
    console.log(`  Stripe sessions            ${r.sessions}  (${r.paid} paid)`);
    console.log(`  with a button click        ${r.clicked}  (${r.clickedByOwner} from ${OWNER_COUNTRY}, likely you; ${r.clickedAutomated} automated browser)`);
    console.log(`  with no click              ${r.noClick}  (link previews, crawlers or direct links${r.noClickPaid ? `; ${r.noClickPaid} paid` : ''})`);
    console.log(`  clicks with no session     ${r.clicksWithoutSession}  (left before Stripe loaded)`);
    console.log(`  real outside visitors      ${r.outside} clicked through\n`);
  }
}

async function main() {
  const daysIndex = process.argv.indexOf('--days');
  const days = daysIndex === -1 ? 30 : Number(process.argv[daysIndex + 1]);
  if (!Number.isFinite(days) || days <= 0) throw new Error('--days must be a positive number');
  const requested = Date.now() - days * 86_400_000;
  const sinceMs = Math.max(requested, TRACKING_STARTED_AT);
  // Clicks just before the window can still belong to sessions inside it.
  const clicksFrom = Math.max(sinceMs - MATCH_BEFORE_MS, TRACKING_STARTED_AT);
  const [clicks, sessions] = await Promise.all([fetchClicks(clicksFrom), fetchSessions(sinceMs, paymentLinkPlans())]);
  const matched = matchSessions(sessions, clicks).filter((m) => !m.orphanClick || m.orphanClick.at >= sinceMs);
  report(summarise(matched), sinceMs);
  if (clicks.sampled) console.log('Analytics Engine sampled some clicks, so click counts and session matches are approximate.');
  if (requested < TRACKING_STARTED_AT) console.log('Click tracking started on 20 Nov 2026; earlier sessions are not included.');
}

if (require.main === module) {
  main().catch((error) => { console.error(error.message); process.exit(1); });
}

module.exports = { matchSessions, summarise, paymentLinkPlans, fetchSessions, fetchClicks, MATCH_BEFORE_MS, MATCH_AFTER_MS };
