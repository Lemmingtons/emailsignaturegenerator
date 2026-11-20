// Checkout funnel: sessions pair with the nearest same-plan click inside the
// window, each click is used once, and the summary separates likely-owner,
// automated and unclicked sessions.
const assert = require('node:assert/strict');
const { matchSessions, summarise, paymentLinkPlans, MATCH_BEFORE_MS } = require('../scripts/checkout-funnel');

const plans = paymentLinkPlans();
assert.deepEqual(Object.values(plans).sort(), ['pro', 'team'], 'both payment links are read from wrangler.toml');

const t = 1_800_000_000_000;
const clicks = [
  { at: t - 5_000, plan: 'pro', country: 'US', agent: 'browser' },
  { at: t - 4_000, plan: 'team', country: 'AU', agent: 'browser' },
  { at: t + 50_000, plan: 'pro', country: 'AU', agent: 'browser' },
  { at: t + 300_000, plan: 'pro', country: 'DE', agent: 'automated' },
  { at: t + 900_000, plan: 'pro', country: 'GB', agent: 'browser' },
];
const sessions = [
  { id: 'a', created: t, plan: 'pro', paid: true },
  { id: 'b', created: t + 1_000, plan: 'pro', paid: false },
  { id: 'c', created: t + 51_000, plan: 'pro', paid: false },
  { id: 'd', created: t, plan: 'team', paid: false },
  { id: 'e', created: t + 300_500, plan: 'pro', paid: false },
  { id: 'f', created: t + 40_000 + MATCH_BEFORE_MS + 60_000, plan: 'pro', paid: false },
];

const matched = matchSessions(sessions, clicks);
const byId = Object.fromEntries(matched.filter((m) => m.id).map((m) => [m.id, m.click && m.click.country]));
assert.equal(byId.a, 'US', 'nearest earlier click wins');
assert.equal(byId.b, null, 'a click is used once, so a second session in the same burst has none');
assert.equal(byId.c, 'AU');
assert.equal(byId.d, 'AU', 'plans never cross');
assert.equal(byId.e, 'DE');
assert.equal(byId.f, null, 'clicks outside the window do not match');

const summary = summarise(matched);
assert.deepEqual(summary.pro, {
  sessions: 5, paid: 1, clicked: 3, clickedByOwner: 1, clickedAutomated: 1, noClick: 2, noClickPaid: 0, clicksWithoutSession: 1,
});
assert.deepEqual(summary.team, {
  sessions: 1, paid: 0, clicked: 1, clickedByOwner: 1, clickedAutomated: 0, noClick: 0, noClickPaid: 0, clicksWithoutSession: 0,
});

console.log('Checkout funnel checks passed: windowed same-plan matching, single use of clicks, owner/automated split.');
