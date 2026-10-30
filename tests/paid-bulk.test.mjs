import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

const worker = await import(new URL('../_worker.js', import.meta.url).href);
const FACTS = globalThis.SiteFacts;
const BATCH_ROUTE = '/api/v1/signatures/batch';
const KEY_ROUTE = '/api/v1/access-key';
const ORIGIN = 'https://emailsignaturegenerator.ai';
const SIGNING_SECRET = 'fixture-only-paid-bulk-signing-secret';
const WEBHOOK_SECRET = 'fixture-only-paid-bulk-webhook-secret';

function memoryBucket() {
  const store = new Map();
  let version = 0;
  const wrap = (entry) => entry && ({
    etag: entry.etag,
    httpEtag: `"${entry.etag}"`,
    body: entry.body,
    text: async () => entry.body,
    customMetadata: entry.customMetadata || {},
  });
  return {
    store,
    async get(key) {
      if (this.beforeGet) await this.beforeGet(key);
      return wrap(store.get(key));
    },
    async head(key) { return wrap(store.get(key)); },
    async put(key, body, options = {}) {
      const current = store.get(key);
      if (options.onlyIf?.etagMatches && (!current || current.etag !== options.onlyIf.etagMatches)) return null;
      if (options.onlyIf?.etagDoesNotMatch === '*' && current) return null;
      const entry = { body: String(body), etag: `paid-bulk-${++version}`, customMetadata: options.customMetadata };
      store.set(key, entry);
      return wrap(entry);
    },
    async delete(key) { store.delete(key); },
  };
}

function makeEnv() {
  const limiterKeys = [];
  return {
    PRO_SIGNING_SECRET: SIGNING_SECRET,
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    STRIPE_LIVEMODE: 'false',
    STRIPE_PAYMENT_LINK_ID: 'plink_fixturepro',
    STRIPE_TEAM_PAYMENT_LINK_ID: 'plink_fixtureteam',
    UPLOADS: memoryBucket(),
    limiterKeys,
    RATE_LIMIT: { limit: async ({ key }) => { limiterKeys.push(key); return { success: true }; } },
  };
}

const call = (env, path, init = {}) => worker.default.fetch(new Request(ORIGIN + path, init), env);
const bearer = (token, init = {}) => ({ ...init, headers: { 'Content-Type': 'application/json', ...init.headers, Authorization: 'Bearer ' + token } });
const batch = (count) => ({ template: 'classic', defaults: { company: 'Fixture Studio' }, employees: Array.from({ length: count }, (_, i) => ({ fullName: `Fixture Person ${i + 1}`, email: `person${i + 1}@example.com` })) });
const generate = (env, token, count, suffix = '') => call(env, BATCH_ROUTE + suffix, bearer(token, { method: 'POST', body: JSON.stringify(batch(count)) }));
const manage = (env, token, action, extra = {}) => call(env, KEY_ROUTE, bearer(token, { method: 'POST', body: JSON.stringify({ action }), ...extra }));
const info = (env, token) => call(env, KEY_ROUTE, bearer(token));
let eventNumber = 0;
async function webhook(env, type, object) {
  const payload = JSON.stringify({ id: `evt_paidbulk${++eventNumber}`, type, livemode: false, created: 1, data: { object } });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac('sha256', WEBHOOK_SECRET).update(`${timestamp}.${payload}`).digest('hex');
  const response = await call(env, '/api/stripe-webhook', { method: 'POST', headers: { 'Stripe-Signature': `t=${timestamp},v1=${signature}` }, body: payload });
  assert.equal(response.status, 200, 'signed fixture webhook accepted');
}
let purchaseNumber = 0;
async function buy(env, plan, returnTo = '') {
  const n = ++purchaseNumber;
  const session = {
    id: `cs_test_paidbulk${n}`, payment_intent: `pi_paidbulk${n}`,
    mode: 'payment', status: 'complete', payment_status: 'paid', livemode: false,
    payment_link: plan === 'team' ? env.STRIPE_TEAM_PAYMENT_LINK_ID : env.STRIPE_PAYMENT_LINK_ID,
    client_reference_id: returnTo,
  };
  await webhook(env, 'checkout.session.completed', session);
  const response = await call(env, `/api/verify-payment?session_id=${session.id}`);
  assert.equal(response.status, 302, 'paid checkout redeems');
  const location = new URL(response.headers.get('Location'));
  assert.equal(location.pathname, returnTo === 'bulk' ? '/bulk' : '/generator', 'only the whitelisted bulk marker changes the return page');
  return { token: location.searchParams.get('token'), paymentIntent: session.payment_intent };
}
async function keyFor(env, token, action = 'create') {
  const response = await manage(env, token, action);
  assert.equal(response.status, 200, `${action} key succeeds`);
  assert.equal(response.headers.get('Cache-Control'), 'no-store, private');
  const result = await response.json();
  assert.match(result.key, /^esg_bulk_[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  return result.key;
}

const env = makeEnv();
const individual = await buy(env, 'pro', 'bulk');
const team = await buy(env, 'team');
await buy(env, 'pro', 'https://example.com/redirect');
let response = await info(env, individual.token);
assert.deepEqual(await response.json(), { active: true, plan: 'pro', maxRows: FACTS.bulkIndividualMaxRows, hasKey: false });
const individualKey = await keyFor(env, individual.token);
assert.equal(await keyFor(env, individual.token), individualKey, 'showing an existing key does not invalidate agents');
assert.equal((await (await info(env, individual.token)).json()).hasKey, true);
const teamKey = await keyFor(env, team.token);
for (const token of [individual.token, individualKey]) {
  response = await generate(env, token, FACTS.bulkIndividualMaxRows);
  assert.equal(response.status, 200, 'individual browser or scoped key can generate 19 signatures');
  assert.equal((await response.json()).valid, FACTS.bulkIndividualMaxRows);
  response = await generate(env, token, FACTS.bulkIndividualMaxRows + 1);
  assert.equal(response.status, 403, '20 signatures requires Team');
  assert.equal((await response.json()).code, 'team_plan_required');
}
for (const token of [team.token, teamKey]) {
  response = await generate(env, token, FACTS.bulkMaxRows);
  assert.equal(response.status, 200, 'Team browser or scoped key can generate 250 signatures');
  assert.equal((await response.json()).valid, FACTS.bulkMaxRows);
  assert.equal((await generate(env, token, FACTS.bulkMaxRows + 1)).status, 413, 'global row limit remains independent of plan');
}
response = await generate(env, individualKey, 2, '?format=zip');
assert.equal(response.status, 200);
assert.equal(response.headers.get('Content-Type'), 'application/zip');
assert.equal(response.headers.get('X-Bulk-Valid-Rows'), '2');
assert.equal(new DataView(await response.arrayBuffer()).getUint32(0, true), 0x04034b50, 'paid key produces a ZIP');
response = await call(env, '/api/v1/templates', bearer(individualKey));
assert.equal((await response.json()).maxRows, FACTS.bulkIndividualMaxRows);

// Browser and derived keys share the same purchased request allowance, including rotation.
env.limiterKeys.length = 0;
await generate(env, individual.token, 1);
await generate(env, individualKey, 1);
const replacement = await keyFor(env, individual.token, 'rotate');
assert.notEqual(replacement, individualKey, 'rotation changes the agent credential');
await generate(env, replacement, 1);
assert.equal(new Set(env.limiterKeys.filter((value) => value.startsWith('bulk:'))).size, 1, 'rotation cannot create a fresh rate-limit identity');
assert.equal((await generate(env, individualKey, 1)).status, 401, 'rotation revokes the old key');
response = await manage(env, individual.token, 'revoke');
assert.equal(response.status, 200);
assert.equal((await response.json()).revoked, true);
assert.equal((await generate(env, replacement, 1)).status, 401, 'revoked key cannot generate');
const recreated = await keyFor(env, individual.token);
assert.notEqual(recreated, replacement);
assert.equal((await generate(env, recreated, 1)).status, 200);

// A generation key is not a Pro token and cannot manage credentials or paid resources.
for (const path of ['/api/upload-image', '/api/team', '/api/signature']) {
  response = await call(env, path, bearer(recreated, { method: 'POST', body: '{}' }));
  assert.ok([401, 403].includes(response.status), `${path} rejects the scoped key`);
  response = await call(env, path, bearer(recreated.slice('esg_bulk_'.length), { method: 'POST', body: '{}' }));
  assert.ok([401, 403].includes(response.status), `${path} also rejects the unprefixed derived JWT`);
}
assert.equal((await info(env, recreated)).status, 401);
assert.equal((await manage(env, recreated, 'rotate')).status, 401);
response = await call(env, '/api/verify-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: recreated.slice('esg_bulk_'.length) }) });
assert.equal((await response.json()).valid, false, 'derived signing domain cannot mint Pro benefits');
for (const { body } of env.UPLOADS.store.values()) {
  assert.ok(!body.includes(recreated) && !body.includes(teamKey) && !body.includes('esg_bulk_'), 'raw agent keys are never persisted');
}
const jwt = JSON.parse(Buffer.from(recreated.slice('esg_bulk_'.length).split('.')[1], 'base64url').toString());
assert.match(jwt.sub, /^ent_/);
assert.ok(!JSON.stringify(jwt).includes('pi_') && !JSON.stringify(jwt).includes('cus_'), 'agent keys do not expose Stripe identifiers');

const design = { version: 1, template: 'classic', style: {}, data: { company: 'Fixture Studio' } };
response = await call(env, '/api/team', bearer(team.token, { method: 'POST', body: JSON.stringify(design) }));
assert.equal(response.status, 200);
const sharedTeam = await response.json();
response = await call(env, `/api/team/${sharedTeam.id}/join`, { method: 'POST' });
assert.equal(response.status, 200);
const member = (await response.json()).token;
assert.equal((await info(env, member)).status, 403, 'a colleague cannot manage the buyer\'s API key');
assert.equal((await manage(env, member, 'create')).status, 403);
assert.equal((await generate(env, member, 1)).status, 403, 'the buyer controls bulk generation');

// Refunds and disputes revoke both browser and agent access through the existing entitlement path.
for (const type of ['charge.refunded', 'charge.dispute.created']) {
  const target = makeEnv();
  const purchase = await buy(target, 'team', 'bulk');
  const key = await keyFor(target, purchase.token);
  await webhook(target, type, { payment_intent: purchase.paymentIntent });
  assert.equal((await info(target, purchase.token)).status, 401);
  assert.equal((await generate(target, purchase.token, 1)).status, 401);
  assert.equal((await generate(target, key, 1)).status, 401);
}

for (const limiter of [undefined, { limit: async () => null }, { limit: async () => { throw new Error('private fixture detail'); } }]) {
  const unavailable = { ...env, RATE_LIMIT: limiter };
  assert.equal((await info(unavailable, individual.token)).status, 503);
  response = await generate(unavailable, recreated, 1);
  assert.equal(response.status, 503);
  assert.ok(!(await response.text()).includes('private fixture detail'));
}
const limited = { ...env, RATE_LIMIT: { limit: async () => ({ success: false }) } };
response = await manage(limited, individual.token, 'rotate');
assert.equal(response.status, 429);
assert.equal(response.headers.get('Retry-After'), '60');
assert.equal((await generate(limited, recreated, 1)).status, 429);
response = await manage(env, individual.token, 'rotate', { headers: { Origin: 'https://evil.example.com' } });
assert.equal(response.status, 403);
assert.equal((await manage(env, individual.token, 'unknown')).status, 400);
assert.equal((await manage(env, individual.token, 'create', { body: '{' })).status, 400);
assert.equal((await manage(env, individual.token, 'create', { body: JSON.stringify({ action: 'create', extra: true }) })).status, 400);
assert.equal((await manage(env, individual.token, 'create', { headers: { 'Content-Type': 'text/plain' } })).status, 415);
let cancelled = false;
const oversized = new ReadableStream({
  pull(controller) { controller.enqueue(new Uint8Array(256)); },
  cancel() { cancelled = true; },
});
response = await call(env, KEY_ROUTE, bearer(individual.token, { method: 'POST', body: oversized, duplex: 'half' }));
assert.equal(response.status, 413);
assert.equal(cancelled, true, 'actual key-management stream bytes are bounded and cancelled');

// Two simultaneous first-time requests must converge on one active key.
const raceEnv = makeEnv();
const racePurchase = await buy(raceEnv, 'pro');
let waiting = 0;
let release;
const barrier = new Promise((resolve) => { release = resolve; });
raceEnv.UPLOADS.beforeGet = async (path) => {
  if (!path.startsWith('bulk-api/access/') || waiting >= 2) return;
  if (++waiting === 2) release();
  await barrier;
};
const [first, second] = await Promise.all([keyFor(raceEnv, racePurchase.token), keyFor(raceEnv, racePurchase.token)]);
assert.equal(first, second, 'conditional create returns one key to concurrent callers');
assert.equal((await generate(raceEnv, first, 1)).status, 200);
assert.equal([...raceEnv.UPLOADS.store.keys()].filter((path) => path.startsWith('bulk-api/access/')).length, 1);

console.log('Paid bulk checks passed: checkout return, plan limits, scoped key lifecycle, ownership, revocation, rate limits and concurrent creation.');
