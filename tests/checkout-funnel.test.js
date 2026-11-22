// Checkout funnel: sessions pair with the nearest same-plan click inside the
// window, each click is used once, and the summary separates likely-owner,
// automated and unclicked sessions.
const assert = require('node:assert/strict');
const {
  matchSessions,
  summarise,
  paymentLinkPlans,
  fetchClicks,
  fetchSessions,
  MATCH_BEFORE_MS,
  MAX_STRIPE_PAGES,
} = require('../scripts/checkout-funnel');

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
  sessions: 5, paid: 1, clicked: 3, clickedByOwner: 1, clickedAutomated: 1, outside: 1, noClick: 2, noClickPaid: 0, clicksWithoutSession: 1,
});
assert.deepEqual(summary.team, {
  sessions: 1, paid: 0, clicked: 1, clickedByOwner: 1, clickedAutomated: 0, outside: 0, noClick: 0, noClickPaid: 0, clicksWithoutSession: 0,
});

// An AU automated click belongs to both excluded groups; it must not hide a
// real outside visitor.
const overlap = summarise(matchSessions(
  [{ id: 'x', created: t, plan: 'pro', paid: false }, { id: 'y', created: t + 600_000, plan: 'pro', paid: false }],
  [{ at: t - 1_000, plan: 'pro', country: 'AU', agent: 'automated' }, { at: t + 599_000, plan: 'pro', country: 'US', agent: 'browser' }],
));
assert.equal(overlap.pro.outside, 1, 'AU automated plus US browser leaves one outside visitor');

// NaN timestamps must never match a session or click.
const nanMatched = matchSessions(
  [
    { id: 'valid', created: t, plan: 'pro', paid: false },
    { id: 'bad-session', created: Number.NaN, plan: 'pro', paid: false },
  ],
  [
    { at: Number.NaN, plan: 'pro', country: 'US', agent: 'browser' },
    { at: t - 1_000, plan: 'pro', country: 'CA', agent: 'browser' },
  ],
);
const nanById = Object.fromEntries(nanMatched.filter((m) => m.id).map((m) => [m.id, m.click]));
assert.equal(nanById.valid && nanById.valid.country, 'CA', 'valid session skips NaN click and pairs with finite click');
assert.equal(nanById['bad-session'], null, 'NaN session timestamp never matches');

(async () => {
  const savedEnv = {
    CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
    CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN,
    STRIPE_API_KEY: process.env.STRIPE_API_KEY,
  };
  const realFetch = global.fetch;
  const realWarn = console.warn;

  try {
    // CLOUDFLARE_ACCOUNT_ID must be 32 hex chars.
    process.env.CLOUDFLARE_ACCOUNT_ID = '../evil';
    process.env.CLOUDFLARE_API_TOKEN = 'cf-token';
    await assert.rejects(() => fetchClicks(t), /32-character hexadecimal/);

    const validAccount = '0123456789abcdef0123456789abcdef';
    process.env.CLOUDFLARE_ACCOUNT_ID = validAccount;

    // Missing Analytics Engine dataset returns empty array cleanly.
    global.fetch = async (url, init) => {
      assert.ok(url.includes(`/accounts/${validAccount}/analytics_engine/sql`));
      assert.ok(init.signal instanceof AbortSignal, 'fetchClicks passes timeout signal');
      return { ok: false, status: 400, text: async () => 'Table checkout_clicks does not exist' };
    };
    assert.deepEqual(await fetchClicks(t), []);

    // Sampled clicks flag is set when any row has weight > 1.
    global.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        data: [
          { timestamp: '2026-11-20 10:00:00', placement: 'home-pro', plan: 'pro', country: 'US', agent: 'browser', weight: 1 },
          { timestamp: '2026-11-20 10:01:00', placement: 'home-team', plan: 'team', country: 'GB', agent: 'browser', weight: 4 },
        ],
      }),
    });
    const sampledClicks = await fetchClicks(t);
    assert.equal(sampledClicks.length, 2);
    assert.equal(sampledClicks.sampled, true, 'sampled flag reflects _sample_interval > 1');
    assert.equal(sampledClicks[0].at, Date.parse('2026-11-20T10:00:00Z'));

    // Non-OK non-missing-table error rejects.
    global.fetch = async () => ({ ok: false, status: 500, text: async () => 'boom' });
    await assert.rejects(() => fetchClicks(t), /HTTP 500/);

    // fetchSessions paginates, filters unknown links, passes timeout signal, and warns on test key.
    const warnings = [];
    console.warn = (msg) => warnings.push(String(msg));
    process.env.STRIPE_API_KEY = 'rk_test_12345';
    const seenUrls = [];
    global.fetch = async (url, init) => {
      seenUrls.push(url);
      assert.ok(init.signal instanceof AbortSignal, 'stripePage passes timeout signal');
      if (!url.includes('starting_after=')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            has_more: true,
            data: [
              { id: 'cs_1', created: 1_800_000_000, payment_link: 'plink_pro', payment_status: 'paid', status: 'complete' },
              { id: 'cs_other', created: 1_800_000_001, payment_link: 'plink_unknown', payment_status: 'unpaid', status: 'open' },
            ],
          }),
        };
      }
      assert.ok(url.includes('starting_after=cs_other'), 'second page uses last session id');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          has_more: false,
          data: [
            { id: 'cs_2', created: 1_800_000_010, payment_link: 'plink_team', payment_status: 'unpaid', status: 'expired' },
          ],
        }),
      };
    };
    const paged = await fetchSessions(t, { plink_pro: 'pro', plink_team: 'team' });
    assert.equal(seenUrls.length, 2);
    assert.deepEqual(paged.map((s) => [s.id, s.plan, s.paid]), [
      ['cs_1', 'pro', true],
      ['cs_2', 'team', false],
    ]);
    assert.ok(warnings.some((w) => w.includes('test-mode key')), 'warns once on rk_test_ key');

    // Malformed Stripe payload missing data array rejects.
    process.env.STRIPE_API_KEY = 'rk_live_12345';
    global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ has_more: false }) });
    await assert.rejects(() => fetchSessions(t, { plink_pro: 'pro' }), /missing data array/);

    // Pagination stops at MAX_STRIPE_PAGES even if has_more stays true.
    let calls = 0;
    warnings.length = 0;
    global.fetch = async () => {
      calls++;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          has_more: true,
          data: [{ id: `cs_${calls}`, created: 1_800_000_000 + calls, payment_link: 'plink_pro', payment_status: 'unpaid', status: 'open' }],
        }),
      };
    };
    const capped = await fetchSessions(t, { plink_pro: 'pro' });
    assert.equal(calls, MAX_STRIPE_PAGES, 'pagination halts at 200-page cap');
    assert.equal(capped.length, MAX_STRIPE_PAGES);
    assert.ok(warnings.some((w) => w.includes('200-page cap')), 'warns when pagination cap is reached');

    console.log('Checkout funnel checks passed: windowed same-plan matching, NaN guards, stubbed fetchClicks and fetchSessions pagination.');
  } finally {
    global.fetch = realFetch;
    console.warn = realWarn;
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
