// Worker hardening: partial refunds, token-in-fragment redirect, payment return
// pages, page headers, malformed verify-token input, the published-card cap
// under concurrency, and bounded request bodies. R2, the rate limiter and
// Stripe webhooks are mocked; webhook fixtures are signed like Stripe's.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

const worker = await import(new URL('../_worker.js', import.meta.url).href);
const FACTS = globalThis.SiteFacts;
const ORIGIN = 'https://emailsignaturegenerator.ai';
const tick = () => new Promise((resolve) => setImmediate(resolve));

// Yields on every call, so parallel requests really interleave.
function memoryBucket() {
  const store = new Map();
  let version = 0;
  const wrap = (entry) => entry && { etag: entry.etag, body: entry.body, text: async () => entry.body, customMetadata: entry.customMetadata || {} };
  return {
    store,
    async get(key) { await tick(); return wrap(store.get(key)); },
    async head(key) { await tick(); return wrap(store.get(key)); },
    async put(key, body, options = {}) {
      await tick();
      const current = store.get(key);
      const only = options.onlyIf || {};
      if (only.etagMatches && (!current || current.etag !== only.etagMatches)) return null;
      if (only.etagDoesNotMatch === '*' && current) return null;
      const entry = { body: typeof body === 'string' ? body : String(body), etag: `e${++version}`, customMetadata: options.customMetadata };
      store.set(key, entry);
      return wrap(entry);
    },
    async delete(key) { await tick(); store.delete(key); },
    async list({ prefix = '', limit = 1000 } = {}) {
      await tick();
      return { objects: [...store.keys()].filter((k) => k.startsWith(prefix)).slice(0, limit).map((key) => ({ key })), truncated: false };
    },
  };
}

const WEBHOOK_SECRET = 'whsec_hardening';
const limiterKeys = [];
function makeEnv(overrides = {}) {
  return {
    PRO_SIGNING_SECRET: 'hardening-signing-secret-0123456789',
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    STRIPE_LIVEMODE: 'false',
    STRIPE_PAYMENT_LINK_ID: 'plink_pro123',
    STRIPE_TEAM_PAYMENT_LINK_ID: 'plink_team123',
    UPLOADS: memoryBucket(),
    RATE_LIMIT: { limit: async ({ key }) => { limiterKeys.push(key); return { success: true }; } },
    ASSETS: { fetch: async () => new Response('<!doctype html><title>x</title>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } }) },
    ...overrides,
  };
}

const call = (env, path, init = {}) => worker.default.fetch(new Request(ORIGIN + path, init), env);
const bearer = (token, init = {}) => ({ ...init, headers: { ...(init.headers || {}), Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } });
const tokenFrom = (response) => new URLSearchParams(new URL(response.headers.get('Location')).hash.slice(1)).get('token');

async function webhook(env, type, object) {
  const payload = JSON.stringify({ id: 'evt_' + Math.random().toString(36).slice(2), type, livemode: false, created: Math.floor(Date.now() / 1000), data: { object } });
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac('sha256', WEBHOOK_SECRET).update(`${t}.${payload}`).digest('hex');
  return call(env, '/api/stripe-webhook', { method: 'POST', headers: { 'Stripe-Signature': `t=${t},v1=${sig}` }, body: payload });
}

let purchases = 0;
function sessionFor(link) {
  const n = ++purchases;
  return { id: `cs_test_harden${n}`, mode: 'payment', status: 'complete', payment_status: 'paid', livemode: false, payment_link: link, payment_intent: `pi_harden${n}` };
}
async function buy(env, link = 'plink_pro123') {
  const session = sessionFor(link);
  assert.equal((await webhook(env, 'checkout.session.completed', session)).status, 200);
  const res = await call(env, `/api/verify-payment?session_id=${session.id}`);
  assert.equal(res.status, 302, 'purchase redeems');
  return { token: tokenFrom(res), session, paymentIntent: session.payment_intent };
}
const verify = async (env, token) => (await call(env, '/api/verify-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) })).json();

// ── 1. Only a full refund revokes ───────────────────────────────────────────
{
  const env = makeEnv();
  const owner = await buy(env, 'plink_team123');
  const design = { version: 1, template: 'classic', data: { company: 'Harbour' } };
  const team = await (await call(env, '/api/team', bearer(owner.token, { method: 'POST', body: JSON.stringify(design) }))).json();
  const member = (await (await call(env, `/api/team/${team.id}/join`, { method: 'POST' })).json()).token;

  // A US$5 goodwill refund on a US$29 team pack.
  assert.equal((await webhook(env, 'charge.refunded', { id: 'ch_1', payment_intent: owner.paymentIntent, amount: 2900, amount_refunded: 500, refunded: false })).status, 200);
  assert.equal((await webhook(env, 'refund.created', { id: 're_1', status: 'succeeded', amount: 500, payment_intent: owner.paymentIntent })).status, 200);
  assert.equal((await webhook(env, 'refund.updated', { id: 're_1', status: 'succeeded', amount: 500, payment_intent: owner.paymentIntent })).status, 200);
  assert.deepEqual(await verify(env, owner.token), { valid: true, plan: 'team' }, 'a partial refund keeps the buyer');
  assert.equal((await verify(env, member)).valid, true, 'a partial refund keeps every seat');
  assert.equal((await call(env, `/api/team/${team.id}/join`, { method: 'POST' })).status, 200, 'the team can still be joined');
  assert.ok(![...env.UPLOADS.store.keys()].some((k) => k.startsWith('entitlements/revoked/')), 'no tombstone for a partial refund');

  // A second partial refund that takes the total to the full amount revokes.
  assert.equal((await webhook(env, 'charge.refunded', { id: 'ch_1', payment_intent: owner.paymentIntent, amount: 2900, amount_refunded: 2900 })).status, 200);
  assert.deepEqual(await verify(env, owner.token), { valid: false, reason: 'entitlement_revoked' }, 'a full refund still revokes');
  assert.equal((await verify(env, member)).valid, false, 'and ends the team seats');

  // A late or replayed checkout event cannot undo the revocation.
  assert.equal((await webhook(env, 'checkout.session.completed', owner.session)).status, 200);
  assert.deepEqual(await verify(env, owner.token), { valid: false, reason: 'entitlement_revoked' });
  assert.equal((await call(env, `/api/verify-payment?session_id=${owner.session.id}`)).status, 403);
}
{
  // Stripe's own `refunded: true` flag also revokes, without amount fields.
  const env = makeEnv();
  const buyer = await buy(env);
  await webhook(env, 'charge.refunded', { id: 'ch_2', payment_intent: buyer.paymentIntent, refunded: true });
  assert.equal((await verify(env, buyer.token)).reason, 'entitlement_revoked');
  // A refund event alone (no charge totals) never revokes.
  const other = await buy(env);
  await webhook(env, 'refund.created', { id: 're_2', status: 'succeeded', amount: 900, payment_intent: other.paymentIntent });
  assert.equal((await verify(env, other.token)).valid, true);
}

// ── 2. The token travels in the fragment ────────────────────────────────────
{
  const env = makeEnv();
  const session = sessionFor('plink_pro123');
  await webhook(env, 'checkout.session.completed', session);
  const res = await call(env, `/api/verify-payment?session_id=${session.id}`);
  const location = new URL(res.headers.get('Location'));
  assert.equal(location.pathname, '/generator');
  assert.equal(location.search, '', 'no query string');
  assert.match(location.hash, /^#token=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(res.headers.get('Cache-Control'), 'no-store, private');
  assert.equal(res.headers.get('Referrer-Policy'), 'no-referrer');
  const bulkSession = { ...sessionFor('plink_pro123'), client_reference_id: 'bulk' };
  await webhook(env, 'checkout.session.completed', bulkSession);
  const bulk = new URL((await call(env, `/api/verify-payment?session_id=${bulkSession.id}`)).headers.get('Location'));
  assert.equal(bulk.pathname, '/bulk');
  assert.equal(bulk.search, '');
  assert.ok(bulk.hash.startsWith('#token='));
}

// ── 3. Page CSP allows Cloudflare Web Analytics; HSTS everywhere ────────────
{
  const env = makeEnv();
  const page = await call(env, '/generator');
  const csp = page.headers.get('Content-Security-Policy');
  const directive = (name) => csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(name + ' '));
  assert.equal(directive('script-src'), "script-src 'self' https://static.cloudflareinsights.com");
  assert.equal(directive('connect-src'), "connect-src 'self' https://cloudflareinsights.com");
  assert.equal(directive('base-uri'), "base-uri 'none'");
  assert.equal(directive('form-action'), "form-action 'self'");
  assert.equal(directive('frame-ancestors'), "frame-ancestors 'none'");
  assert.equal(page.headers.get('Referrer-Policy'), 'no-referrer', '/generator sends no-referrer');
  assert.ok(!csp.includes('*'), 'no wildcard hosts');
  assert.equal((await call(env, '/js/home.js')).status, 200, '/js/home.js is a public client script');
  for (const path of ['/', '/generator', '/api/health', '/does-not-exist', '/generator.html', '/api/verify-payment?session_id=cs_test_nope']) {
    assert.equal((await call(env, path)).headers.get('Strict-Transport-Security'), 'max-age=31536000', 'HSTS on ' + path);
  }
  const crash = await call({ ...env, UPLOADS: { get: async () => { throw new Error('r2 down'); } } }, '/api/signature/' + 'A'.repeat(43));
  assert.equal(crash.status, 500);
  assert.equal(crash.headers.get('Strict-Transport-Security'), 'max-age=31536000', 'HSTS on unhandled errors');
}

// ── 4. Payment return pages ─────────────────────────────────────────────────
{
  // Use a real 25/min budget limiter so the full polling loop + emailed restore hop fit within budget.
  let verifyHits = 0;
  const pendingEnv = makeEnv({ RATE_LIMIT: { limit: async () => ({ success: ++verifyHits <= 25 }) } });
  const sid = 'cs_test_pendingforever';
  let res = await call(pendingEnv, `/api/verify-payment?session_id=${sid}`);
  assert.equal(res.status, 202);
  assert.equal(res.headers.get('Retry-After'), '3');
  assert.equal(res.headers.get('Cache-Control'), 'no-store, private');
  assert.equal(res.headers.get('Refresh'), `3;url=/api/verify-payment?session_id=${sid}&attempt=1`);
  let html = await res.text();
  assert.ok(!html.includes(sid), 'the pending page body never contains the session id');

  // Follow the Refresh chain the way a browser does.
  let next = res.headers.get('Refresh').split('url=')[1];
  let hops = 1;
  while (next) {
    res = await call(pendingEnv, next);
    assert.equal(res.status, 202);
    next = res.headers.get('Refresh') && res.headers.get('Refresh').split('url=')[1];
    hops++;
    assert.ok(hops <= 20, 'the pending loop is capped');
  }
  assert.equal(hops, 20, '20 attempts at 3s fit comfortably inside the 25/min limiter');
  html = await res.text();
  assert.match(html, /still being confirmed/);
  assert.match(html, /not lost your payment/);
  assert.ok(html.includes(FACTS.supportEmail), 'support address from site facts');
  assert.ok(!html.includes(sid) && !html.includes('pi_'), 'no Stripe id in the final page');
  assert.equal(res.headers.get('Cache-Control'), 'no-store, private');

  // When genuinely rate-limited, /api/verify-payment returns a branded resumable HTML page.
  const limitedVerify = await call(makeEnv({ RATE_LIMIT: { limit: async () => ({ success: false }) } }), `/api/verify-payment?session_id=${sid}`);
  assert.equal(limitedVerify.status, 429);
  assert.equal(limitedVerify.headers.get('Content-Type'), 'text/html; charset=utf-8');
  assert.match(await limitedVerify.text(), /id="check-again"/);

  // The webhook arrives late: checking again still works.
  await webhook(pendingEnv, 'checkout.session.completed', { ...sessionFor('plink_pro123'), id: sid });
  assert.equal((await call(pendingEnv, `/api/verify-payment?session_id=${sid}&attempt=19`)).status, 302);

  // Each failure case gets its own branded page.
  const env = makeEnv();
  const wrong = { ...sessionFor('plink_other') };
  await webhook(env, 'checkout.session.completed', wrong);
  const refunded = await buy(env);
  await webhook(env, 'charge.refunded', { payment_intent: refunded.paymentIntent, refunded: true });
  const cases = [
    [`/api/verify-payment?session_id=cs_test_nostore`, makeEnv({ UPLOADS: undefined }), 500, /cannot confirm payments right now/],
    [`/api/verify-payment?session_id=${refunded.session.id}`, env, 403, /no longer active/],
    [`/api/verify-payment?session_id=not-a-session`, env, 400, /link is incomplete/],
    [`/api/verify-payment?foo=1`, env, 400, /link is incomplete/],
  ];
  for (const [path, caseEnv, status, wording] of cases) {
    const page = await call(caseEnv, path);
    assert.equal(page.status, status, path);
    assert.equal(page.headers.get('Content-Type'), 'text/html; charset=utf-8');
    assert.equal(page.headers.get('Cache-Control'), 'no-store, private');
    const body = await page.text();
    assert.match(body, wording, path);
    assert.ok(body.includes(FACTS.supportEmail));
    assert.ok(!/cs_test_|pi_|eyJ/.test(body), 'no Stripe id or token in ' + path);
  }
  // A session that never matches one of our Payment Links: 402. (Unknown links are
  // never recorded, so seed the record directly to reach the eligibility check.)
  const seeded = makeEnv();
  const forged = { ...sessionFor('plink_pro123') };
  await webhook(seeded, 'checkout.session.completed', forged);
  const recordKey = [...seeded.UPLOADS.store.keys()].find((k) => k.startsWith('entitlements/checkout-sessions/'));
  const record = JSON.parse(seeded.UPLOADS.store.get(recordKey).body);
  seeded.UPLOADS.store.set(recordKey, { ...seeded.UPLOADS.store.get(recordKey), body: JSON.stringify({ ...record, paymentLink: 'plink_other' }) });
  const ineligible = await call(seeded, `/api/verify-payment?session_id=${forged.id}`);
  assert.equal(ineligible.status, 402);
  assert.match(await ineligible.text(), /could not match this payment/);

  // The emailed link (session id in the fragment) gets the restore page.
  const restore = await call(env, '/api/verify-payment');
  assert.equal(restore.status, 200);
  assert.match(await restore.text(), /location\.hash/);
}

// ── 5. verify-token: malformed input is a 400, never a logged 500 ───────────
{
  const env = makeEnv();
  const errors = [];
  const realError = console.error;
  console.error = (line) => errors.push(String(line));
  const post = (body, headers = { 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.7' }) => call(env, '/api/verify-token', { method: 'POST', headers, body });
  try {
    for (const [label, body, status] of [
      ['bad JSON', '{not json', 400], ['null', 'null', 400], ['array', '[]', 400], ['number', '5', 400],
      ['null token', '{"token":null}', 400], ['number token', '{"token":5}', 400], ['object token', '{"token":{}}', 400],
      ['oversized token', JSON.stringify({ token: 'a'.repeat(5000) }), 400], ['empty body', '', 400],
      ['oversized body', JSON.stringify({ token: 'x', pad: 'p'.repeat(9000) }), 413],
    ]) {
      const res = await post(body);
      assert.equal(res.status, status, label);
      const parsed = await res.json();
      assert.equal(parsed.valid, false, label);
    }
    assert.equal((await (await post('{}')).json()).reason, 'missing_token', 'a missing token keeps its old answer');
    assert.equal((await post(JSON.stringify({ token: 'a.b.c' }))).status, 200, 'a well-formed but bad token is still a verdict');
  } finally {
    console.error = realError;
  }
  assert.deepEqual(errors, [], 'bad input logs nothing');
  assert.ok(limiterKeys.includes('verify-token:198.51.100.7'), 'verify-token is rate limited per IP');
  const limited = await call(makeEnv({ RATE_LIMIT: { limit: async ({ key }) => ({ success: !key.startsWith('verify-token:') }) } }), '/api/verify-token', { method: 'POST', body: '{"token":"a.b.c"}' });
  assert.equal(limited.status, 429);
}

// ── 6. Published-card cap holds under concurrent publishes ──────────────────
{
  const env = makeEnv();
  const buyer = await buy(env);
  const publish = (body) => call(env, '/api/card', bearer(buyer.token, { method: 'POST', body: JSON.stringify(body) }));
  const results = await Promise.all(Array.from({ length: 25 }, (_, i) => publish({ fullName: 'Racer ' + i })));
  const created = results.filter((r) => r.status === 200).length;
  const cards = () => [...env.UPLOADS.store.keys()].filter((k) => k.startsWith('cards/')).length;
  assert.ok(created <= FACTS.maxCardsPerBuyer, `${created} cards created in parallel against a cap of ${FACTS.maxCardsPerBuyer}`);
  assert.equal(cards(), created, 'every accepted publish is a stored card, and only those');
  for (const r of results.filter((x) => x.status !== 200)) {
    assert.equal(r.status, 409);
    assert.ok(['card_limit_reached', 'card_busy'].includes((await r.json()).code));
  }
  // Sequential publishes fill up to the cap and then stop.
  for (let i = cards(); i < FACTS.maxCardsPerBuyer; i++) assert.equal((await publish({ fullName: 'Fill ' + i })).status, 200);
  const over = await publish({ fullName: 'One too many' });
  assert.equal(over.status, 409);
  assert.equal((await over.json()).code, 'card_limit_reached');
  assert.equal(cards(), FACTS.maxCardsPerBuyer);
  // Unpublishing frees exactly one slot, even when publishes race for it.
  const slug = [...env.UPLOADS.store.keys()].find((k) => k.startsWith('cards/')).slice(6, -5);
  assert.equal((await call(env, `/api/card/${slug}`, bearer(buyer.token, { method: 'DELETE' }))).status, 200);
  const refill = await Promise.all(Array.from({ length: 6 }, (_, i) => publish({ fullName: 'Refill ' + i })));
  assert.equal(refill.filter((r) => r.status === 200).length <= 1, true);
  assert.equal(cards(), FACTS.maxCardsPerBuyer);
  // Replacing an owned card at the cap still works.
  const owned = [...env.UPLOADS.store.keys()].find((k) => k.startsWith('cards/')).slice(6, -5);
  assert.equal((await publish({ fullName: 'Renamed', slug: owned })).status, 200);

  // A buyer with cards from before the ledger existed is counted from the index.
  const legacyEnv = makeEnv();
  const legacy = await buy(legacyEnv);
  const legacyPublish = (body) => call(legacyEnv, '/api/card', bearer(legacy.token, { method: 'POST', body: JSON.stringify(body) }));
  for (let i = 0; i < FACTS.maxCardsPerBuyer; i++) assert.equal((await legacyPublish({ fullName: 'Old ' + i })).status, 200);
  for (const key of [...legacyEnv.UPLOADS.store.keys()].filter((k) => k.startsWith('card-quota/'))) legacyEnv.UPLOADS.store.delete(key);
  assert.equal((await legacyPublish({ fullName: 'Old overflow' })).status, 409, 'existing index entries seed the ledger');
}

// ── 7. Request bodies are capped before they are buffered ───────────────────
{
  const env = makeEnv();
  const streamOf = (size) => new ReadableStream({
    start(controller) {
      const chunk = new Uint8Array(64 * 1024).fill(0x61);
      for (let sent = 0; sent < size; sent += chunk.length) controller.enqueue(chunk);
      controller.close();
    },
  });
  const streamed = (path, size, headers = {}) => call(env, path, { method: 'POST', headers, body: streamOf(size), duplex: 'half' });

  const errors = [];
  const realError = console.error;
  console.error = (line) => errors.push(String(line));
  const hook = await streamed('/api/stripe-webhook', 2_000_000, { 'Stripe-Signature': 't=1,v1=00' });
  console.error = realError;
  assert.equal(hook.status, 413, 'an oversized webhook is refused before the signature check');
  assert.ok(!errors.some((line) => line.includes('webhook_signature_rejected')), 'it never reached signature verification');
  assert.equal((await call(env, '/api/stripe-webhook', { method: 'POST', headers: { 'Content-Length': '5000000', 'Stripe-Signature': 't=1,v1=00' }, body: 'x' })).status, 413);

  const owner = await buy(env, 'plink_team123');
  const team = await (await call(env, '/api/team', bearer(owner.token, { method: 'POST', body: JSON.stringify({ version: 1, data: {} }) }))).json();
  assert.equal((await streamed(`/api/team/${team.id}/join`, 70_000)).status, 413, 'team join body is capped');
  assert.equal((await streamed('/api/team', 70_000, { Authorization: 'Bearer ' + owner.token })).status, 413, 'team design body is capped');

  const upload = await streamed('/api/upload-image', 3_200_000, { Authorization: 'Bearer ' + owner.token, 'X-Image-Type': 'photo' });
  assert.equal(upload.status, 413, 'an upload without Content-Length is capped while streaming');
  assert.ok(![...env.UPLOADS.store.keys()].some((k) => k.startsWith('users/')), 'nothing stored');
  const png = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0]);
  const ok = await call(env, '/api/upload-image', { method: 'POST', headers: { Authorization: 'Bearer ' + owner.token, 'X-Image-Type': 'photo' }, body: png });
  assert.equal(ok.status, 200, 'a normal upload still works');
  assert.equal((await ok.json()).bytes, png.length);

  assert.equal((await streamed('/api/signature', 40_000, { Authorization: 'Bearer ' + owner.token })).status, 413);
  assert.equal((await streamed('/api/card', 20_000, { Authorization: 'Bearer ' + owner.token })).status, 413);
}

// ── Checkout clicks: allowlisted placements only, nothing identifying kept ──
{
  const points = [];
  const env = makeEnv({ CHECKOUT_CLICKS: { writeDataPoint: (point) => points.push(point) } });
  const click = (body, headers = {}) => call(env, '/api/checkout-click', { method: 'POST', headers: { 'CF-Connecting-IP': '198.51.100.9', ...headers }, body });
  assert.equal((await click(JSON.stringify({ placement: 'generator-paywall' }), { 'User-Agent': 'Mozilla/5.0 Safari/605' })).status, 204);
  assert.equal((await click(JSON.stringify({ placement: 'bulk-team' }), { 'User-Agent': 'HeadlessChrome/120' })).status, 204);
  assert.deepEqual(points, [
    { indexes: ['generator-paywall'], blobs: ['generator-paywall', 'pro', 'XX', 'browser'], doubles: [1] },
    { indexes: ['bulk-team'], blobs: ['bulk-team', 'team', 'XX', 'automated'], doubles: [1] },
  ], 'only placement, plan, country and a browser/automation flag are written');
  assert.ok(!JSON.stringify(points).includes('198.51.100.9'), 'no IP is stored');
  for (const bad of ['{"placement":"anything"}', '{"placement":"__proto__"}', 'not json', '']) {
    assert.equal((await click(bad)).status, 400, `rejects ${bad || 'an empty body'}`);
  }
  assert.equal((await click('{"placement":"home-pro","pad":"' + 'x'.repeat(400) + '"}')).status, 413, 'body is capped');
  assert.equal((await call(env, '/api/checkout-click')).status, 405, 'GET is refused');
  assert.equal(points.length, 2, 'rejected clicks write nothing');
  assert.ok(limiterKeys.includes('checkout-click:198.51.100.9'), 'clicks are rate limited per IP');
  assert.equal((await call(makeEnv(), '/api/checkout-click', { method: 'POST', body: '{"placement":"home-team"}' })).status, 204, 'a missing dataset binding still answers');
}

// ── 8. M-1: format changes preserve other-extension siblings in the same slot ─
{
  const env = makeEnv();
  const buyer = await buy(env);
  const jpg = new Uint8Array([0xFF, 0xD8, 0xFF, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0]);
  const jpgRes = await call(env, '/api/upload-image', { method: 'POST', headers: { Authorization: 'Bearer ' + buyer.token, 'X-Image-Type': 'photo' }, body: jpg });
  assert.equal(jpgRes.status, 200);
  const jpgUrl = new URL((await jpgRes.json()).url);
  const gifRes = await call(env, '/api/upload-image', { method: 'POST', headers: { Authorization: 'Bearer ' + buyer.token, 'X-Image-Type': 'photo' }, body: gif });
  assert.equal(gifRes.status, 200);
  const gifUrl = new URL((await gifRes.json()).url);
  assert.equal((await call(env, jpgUrl.pathname)).status, 200, 'previous photo.jpg stays live after uploading photo.gif');
  assert.equal((await call(env, gifUrl.pathname)).status, 200, 'new photo.gif is live too');
}

// ── 9. F-03: Rate limits on DELETE /api/card, /api/verify-payment, /sitemap-cards.xml & edge cache ─
{
  const env = makeEnv();
  const buyer = await buy(env);
  const pub = await (await call(env, '/api/card', bearer(buyer.token, { method: 'POST', body: JSON.stringify({ fullName: 'Rate Card' }) }))).json();
  const denyCard = { ...env, RATE_LIMIT: { limit: async ({ key }) => ({ success: !key.startsWith('card:') }) } };
  assert.equal((await call(denyCard, `/api/card/${pub.slug}`, bearer(buyer.token, { method: 'DELETE' }))).status, 429, 'DELETE /api/card/:slug is rate limited');

  const denyVerify = { ...env, RATE_LIMIT: { limit: async ({ key }) => ({ success: !key.startsWith('verify-payment:') }) } };
  assert.equal((await call(denyVerify, '/api/verify-payment?session_id=cs_test_x')).status, 429, '/api/verify-payment is rate limited');

  const denySitemap = { ...env, RATE_LIMIT: { limit: async ({ key }) => ({ success: !key.startsWith('sitemap:') }) } };
  assert.equal((await call(denySitemap, '/sitemap-cards.xml')).status, 429, '/sitemap-cards.xml is rate limited');

  // caches.default caches /i/* and /sitemap-cards.xml when available.
  const cacheStore = new Map();
  let listCalls = 0;
  const origList = env.UPLOADS.list.bind(env.UPLOADS);
  env.UPLOADS.list = async (args) => { listCalls++; return origList(args); };
  const prevCaches = globalThis.caches;
  globalThis.caches = {
    default: {
      async match(req) { const r = cacheStore.get(req.url); return r ? r.clone() : undefined; },
      async put(req, res) { cacheStore.set(req.url, res.clone()); },
    },
  };
  try {
    const s1 = await call(env, '/sitemap-cards.xml');
    const s2 = await call(env, '/sitemap-cards.xml');
    assert.equal(s1.status, 200);
    assert.equal(s2.status, 200);
    assert.equal(listCalls, 1, 'second /sitemap-cards.xml served from caches.default');
    const i1 = await call(env, '/i/linkedin-0891b2.png');
    const i2 = await call(env, '/i/linkedin-0891b2.png?bust=1');
    assert.equal(i1.status, 200);
    assert.equal(i2.status, 200);
    assert.ok(cacheStore.has(ORIGIN + '/i/linkedin-0891b2.png'), '/i/* caches normalized URL without query');
  } finally {
    globalThis.caches = prevCaches;
  }
}

// ── 10. F-12 & F-18: vCard CR escaping, card control-char/email hygiene, collision retry & card CSP ─
{
  const env = makeEnv();
  const buyer = await buy(env);
  const dirty = await call(env, '/api/card', bearer(buyer.token, {
    method: 'POST',
    body: JSON.stringify({
      fullName: 'Jane\r\nSmith\u0000',
      title: 'Lead\rDev',
      phone: '+1\n555\r0100',
      email: 'jane@acme.com?subject=evil',
      website: 'https://acme.com',
    }),
  }));
  assert.equal(dirty.status, 200);
  const { slug } = await dirty.json();
  const cardRes = await call(env, `/c/${slug}`);
  assert.equal(cardRes.status, 200);
  assert.match(cardRes.headers.get('Content-Security-Policy'), /script-src 'none'/, 'card pages enforce script-src none');
  const cardHtml = await cardRes.text();
  assert.ok(!cardHtml.includes('mailto:'), 'query-injected email is stripped from card');

  // Legacy card stored with raw CR still escapes cleanly in vCard output.
  env.UPLOADS.store.set('cards/legacy-cr-111111.json', {
    etag: 'e-legacy',
    body: JSON.stringify({ fullName: 'Bob\rEND:VCARD\r\nBEGIN:VCARD', title: 'A\rB' }),
  });
  const vcf = await (await call(env, '/c/legacy-cr-111111.vcf')).text();
  const vcfLines = vcf.split('\r\n');
  assert.equal(vcfLines.filter((l) => l === 'BEGIN:VCARD').length, 1, 'bare CR cannot inject a second vCard');
  assert.ok(vcf.includes('TITLE:A\\nB'), 'bare CR is escaped to \\n');

  // Collision retry: pre-seed a colliding slug and verify conditional put retries without overwriting.
  const origRandom = crypto.getRandomValues.bind(crypto);
  let calls = 0;
  crypto.getRandomValues = (arr) => {
    calls++;
    if (calls === 1 && arr.length === 3) { arr.set([0xaa, 0xbb, 0xcc]); return arr; }
    return origRandom(arr);
  };
  env.UPLOADS.store.set('cards/collider-aabbcc.json', { etag: 'e-other', body: JSON.stringify({ fullName: 'Original', owner: 'ent_OTHER' }) });
  try {
    const colRes = await call(env, '/api/card', bearer(buyer.token, { method: 'POST', body: JSON.stringify({ fullName: 'Collider' }) }));
    assert.equal(colRes.status, 200);
    const colCard = await colRes.json();
    assert.notEqual(colCard.slug, 'collider-aabbcc', 'collision retries with a fresh suffix');
    assert.equal(JSON.parse(env.UPLOADS.store.get('cards/collider-aabbcc.json').body).owner, 'ent_OTHER', 'existing card is untouched');
    assert.ok(![...env.UPLOADS.store.keys()].some((k) => k.endsWith('/collider-aabbcc')), 'collided slug does not leak into owner index');
  } finally {
    delete crypto.getRandomValues;
  }
}

// ── 11. F-13: Explicit shortcut redirects directly in Worker ────────────────
{
  let assetHits = 0;
  const env = makeEnv({ ASSETS: { fetch: async () => { assetHits++; return new Response('nope', { status: 404 }); } } });
  for (const path of ['/app', '/create', '/generate']) {
    const res = await call(env, path);
    assert.equal(res.status, 301, path + ' redirects');
    assert.equal(res.headers.get('Location'), ORIGIN + '/generator', path + ' redirects to /generator');
  }
  assert.equal(assetHits, 0, 'shortcut redirects never depend on ASSETS/_redirects');
}

// ── 12. F-14: Out-of-order Stripe dispute webhooks cannot re-revoke a won dispute ─
{
  const env = makeEnv();
  const buyer = await buy(env);
  const signedEvent = async (type, object, created, targetEnv = env) => {
    const payload = JSON.stringify({ id: 'evt_dispute_' + created + '_' + type, type, livemode: false, created, data: { object } });
    const t = Math.floor(Date.now() / 1000);
    const sig = createHmac('sha256', WEBHOOK_SECRET).update(`${t}.${payload}`).digest('hex');
    return call(targetEnv, '/api/stripe-webhook', { method: 'POST', headers: { 'Stripe-Signature': `t=${t},v1=${sig}` }, body: payload });
  };
  // Dispute closed (won) arrives BEFORE the older dispute.created event.
  assert.equal((await signedEvent('charge.dispute.closed', { id: 'dp_1', status: 'won', payment_intent: buyer.paymentIntent }, 2000)).status, 200);
  assert.equal((await verify(env, buyer.token)).valid, true);
  assert.equal((await signedEvent('charge.dispute.created', { id: 'dp_1', payment_intent: buyer.paymentIntent }, 1900)).status, 200);
  assert.equal((await verify(env, buyer.token)).valid, true, 'stale dispute.created cannot re-revoke a won dispute');
  // Same-second out-of-order dispute.created for the same dispute id is also ignored.
  assert.equal((await signedEvent('charge.dispute.created', { id: 'dp_1', payment_intent: buyer.paymentIntent }, 2000)).status, 200);
  assert.equal((await verify(env, buyer.token)).valid, true, 'same-second stale dispute.created is ignored');
  // A newer dispute DOES revoke.
  assert.equal((await signedEvent('charge.dispute.created', { id: 'dp_2', payment_intent: buyer.paymentIntent }, 2100)).status, 200);
  assert.equal((await verify(env, buyer.token)).valid, false, 'a newer dispute still revokes');

  // Overlapping first writes (empty key): insert-only onlyIf prevents older create from overwriting newer restore.
  const raceEnv = makeEnv();
  const raceBuyer = await buy(raceEnv);
  const origGet = raceEnv.UPLOADS.get.bind(raceEnv.UPLOADS);
  let holdFirstGet = true;
  let releaseCreateGet;
  const createPaused = new Promise((resolve) => { releaseCreateGet = resolve; });
  let createReachedGet;
  const waitedForCreateGet = new Promise((resolve) => { createReachedGet = resolve; });
  raceEnv.UPLOADS.get = async (key) => {
    const res = await origGet(key);
    if (holdFirstGet && key.endsWith('/dispute.json') && !res) {
      holdFirstGet = false;
      createReachedGet();
      await createPaused;
    }
    return res;
  };
  const raceCreate = signedEvent('charge.dispute.created', { id: 'dp_race', payment_intent: raceBuyer.paymentIntent }, 3000, raceEnv);
  await waitedForCreateGet;
  // Won closure arrives while creation is paused after reading empty key; writes 'restored' first.
  const raceCloseRes = await signedEvent('charge.dispute.closed', { id: 'dp_race', status: 'won', payment_intent: raceBuyer.paymentIntent }, 3100, raceEnv);
  assert.equal(raceCloseRes.status, 200);
  releaseCreateGet();
  const raceCreateRes = await raceCreate;
  assert.equal(raceCreateRes.status, 200);
  assert.equal((await verify(raceEnv, raceBuyer.token)).valid, true, 'overlapping first write cannot let stale dispute.created overwrite restored');

  // Exhausted conditional writes return 503 so Stripe retries instead of dropping the update.
  const busyEnv = makeEnv();
  const busyBuyer = await buy(busyEnv);
  const origBusyPut = busyEnv.UPLOADS.put.bind(busyEnv.UPLOADS);
  busyEnv.UPLOADS.put = async (key, body, opts) => (key.endsWith('/dispute.json') ? null : origBusyPut(key, body, opts));
  const busyRes = await signedEvent('charge.dispute.created', { id: 'dp_busy', payment_intent: busyBuyer.paymentIntent }, 4000, busyEnv);
  assert.equal(busyRes.status, 503, 'exhausted dispute conditional write returns 503 for Stripe retry');
}

// ── 13. F-24/F-25: Clean Refresh header & JSON 500s on /mcp and /a2a/* ──────
{
  const env = makeEnv();
  const pending = await call(env, '/api/verify-payment?session_id=cs_test_cleanrefresh&evil=1&redirect=https://evil.example');
  assert.equal(pending.status, 202);
  assert.equal(pending.headers.get('Refresh'), '3;url=/api/verify-payment?session_id=cs_test_cleanrefresh&attempt=1', 'Refresh carries only session_id and attempt');

  // Force unhandled exception inside /mcp and /a2a/* via throwing env getter.
  const explodingEnv = new Proxy({}, { get() { throw new Error('boom'); } });
  const realError = console.error;
  console.error = () => {};
  try {
    const mcpCrash = await call(explodingEnv, '/mcp', { method: 'POST', headers: { Authorization: 'Bearer a.b.c' } });
    assert.equal(mcpCrash.status, 500);
    assert.equal((await mcpCrash.json()).jsonrpc, '2.0', '/mcp unhandled 500 returns JSON-RPC');
    const a2aCrash = await call(explodingEnv, '/a2a/message:send', { method: 'POST', headers: { Authorization: 'Bearer a.b.c' } });
    assert.equal(a2aCrash.status, 500);
    assert.equal((await a2aCrash.json()).error.code, 500, '/a2a/* unhandled 500 returns A2A JSON');
  } finally {
    console.error = realError;
  }
}

console.log('Worker hardening checks passed: full-refund-only revocation, fragment tokens, capped payment return pages, Web Analytics CSP and HSTS, verify-token input, concurrent card cap, bounded bodies, M-1/F-03/F-12/F-13/F-14/F-24/F-25.');
