// Team pack: a second Stripe Payment Link, a shared team design, and seats
// that colleagues claim. R2, the rate limiter and Stripe webhooks are mocked.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

const worker = await import(new URL('../_worker.js', import.meta.url).href);
const FACTS = globalThis.SiteFacts;

function memoryBucket() {
  const store = new Map();
  let version = 0;
  const wrap = (entry) => entry && {
    etag: entry.etag,
    httpEtag: `"${entry.etag}"`,
    body: entry.body,
    text: async () => entry.body,
    customMetadata: entry.customMetadata || {},
  };
  return {
    store,
    async get(key) { return wrap(store.get(key)); },
    async head(key) { return wrap(store.get(key)); },
    async put(key, body, options = {}) {
      if (this.beforePut) await this.beforePut(key);
      const current = store.get(key);
      if (options.onlyIf && options.onlyIf.etagMatches && (!current || current.etag !== options.onlyIf.etagMatches)) return null;
      const entry = { body: String(body), etag: `e${++version}`, customMetadata: options.customMetadata };
      store.set(key, entry);
      return wrap(entry);
    },
    async delete(key) { store.delete(key); },
    async list({ prefix = '', limit = 1000 } = {}) {
      const objects = [...store.keys()].filter((k) => k.startsWith(prefix)).slice(0, limit).map((key) => ({ key }));
      return { objects, truncated: false };
    },
  };
}

const WEBHOOK_SECRET = 'whsec_test';
function makeEnv(overrides = {}) {
  return {
    PRO_SIGNING_SECRET: 'test-signing-secret-0123456789',
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    STRIPE_LIVEMODE: 'false',
    STRIPE_PAYMENT_LINK_ID: 'plink_pro123',
    STRIPE_TEAM_PAYMENT_LINK_ID: 'plink_team123',
    UPLOADS: memoryBucket(),
    RATE_LIMIT: { limit: async () => ({ success: true }) },
    ...overrides,
  };
}

const call = (env, path, init = {}) => worker.default.fetch(new Request('https://emailsignaturegenerator.ai' + path, init), env);
const bearer = (token, init = {}) => ({ ...init, headers: { ...(init.headers || {}), Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } });

async function webhook(env, type, object) {
  const payload = JSON.stringify({ id: 'evt_' + Math.random().toString(36).slice(2), type, livemode: false, created: 1, data: { object } });
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac('sha256', WEBHOOK_SECRET).update(`${t}.${payload}`).digest('hex');
  const res = await call(env, '/api/stripe-webhook', { method: 'POST', headers: { 'Stripe-Signature': `t=${t},v1=${sig}` }, body: payload });
  assert.equal(res.status, 200, 'webhook accepted');
}

async function buy(env, link, n) {
  const session = { id: `cs_test_${link.replace(/_/g, "")}${n}`, mode: 'payment', status: 'complete', payment_status: 'paid', livemode: false, payment_link: link, payment_intent: `pi_${link.replace(/_/g, "")}${n}` };
  await webhook(env, 'checkout.session.completed', session);
  const res = await call(env, `/api/verify-payment?session_id=${session.id}`);
  if (res.status !== 302) return { status: res.status };
  return { status: 302, token: new URL(res.headers.get('Location')).searchParams.get('token'), paymentIntent: session.payment_intent };
}

const verify = async (env, token) => (await call(env, '/api/verify-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) })).json();

// ── Purchase and plan ──
const env = makeEnv();
const owner = await buy(env, 'plink_team123', 1);
assert.equal(owner.status, 302, 'team purchase redeems like a Pro purchase');
assert.deepEqual(await verify(env, owner.token), { valid: true, plan: 'team' });

const single = await buy(env, 'plink_pro123', 2);
assert.deepEqual(await verify(env, single.token), { valid: true, plan: 'pro' });

// A Payment Link that is neither ours nor configured is not honoured.
assert.notEqual((await buy(env, 'plink_other', 3)).status, 302);
// Without the team link configured, a team checkout is not honoured either.
const noTeamEnv = makeEnv({ STRIPE_TEAM_PAYMENT_LINK_ID: '' });
assert.notEqual((await buy(noTeamEnv, 'plink_team123', 4)).status, 302);

// ── Team design ──
const design = { version: 1, template: 'letterhead', style: {}, data: { company: 'Harbour Plumbing', website: 'https://harbour.example.com', fullName: '' } };
let res = await call(env, '/api/team', bearer(single.token, { method: 'POST', body: JSON.stringify(design) }));
assert.equal(res.status, 403, 'a single-person purchase cannot create a team');
assert.equal((await res.json()).code, 'team_plan_required');

res = await call(env, '/api/team', { method: 'POST', body: JSON.stringify(design) });
assert.equal(res.status, 401);

res = await call(env, '/api/team', bearer(owner.token, { method: 'POST', body: JSON.stringify(design) }));
assert.equal(res.status, 200);
const team = await res.json();
assert.match(team.id, /^[A-Za-z0-9_-]{43}$/);
assert.equal(team.url, `https://emailsignaturegenerator.ai/generator?team=${team.id}`);
assert.equal(team.seats, FACTS.teamSeats);

// Saving again keeps the same link.
res = await call(env, '/api/team', bearer(owner.token, { method: 'POST', body: JSON.stringify({ ...design, template: 'classic' }) }));
assert.equal((await res.json()).id, team.id);

res = await call(env, `/api/team/${team.id}`);
assert.equal(res.status, 200);
assert.equal(res.headers.get('Cache-Control'), 'no-store, private');
const read = await res.json();
assert.equal(read.design.template, 'classic');
assert.ok(!('owner' in read), 'the buyer entitlement id is never returned');
assert.equal((await call(env, '/api/team/nope')).status, 404);
assert.equal((await call(env, '/api/team/' + 'A'.repeat(43))).status, 404);

// ── Seats ──
const members = [];
for (let i = 0; i < FACTS.teamSeats - 1; i++) {
  res = await call(env, `/api/team/${team.id}/join`, { method: 'POST', headers: { 'CF-Connecting-IP': '203.0.113.' + i } });
  assert.equal(res.status, 200, 'join ' + i);
  members.push((await res.json()).token);
}
res = await call(env, `/api/team/${team.id}/join`, { method: 'POST' });
assert.equal(res.status, 409, 'the buyer plus nine colleagues fill a ten-seat pack');
assert.equal((await res.json()).code, 'team_full');
assert.equal((await call(env, `/api/team/${team.id}/join`)).status, 405);

assert.deepEqual(await verify(env, members[0]), { valid: true, plan: 'pro' }, 'a colleague gets Pro, not team management');
res = await call(env, '/api/team', bearer(members[0], { method: 'POST', body: JSON.stringify(design) }));
assert.equal(res.status, 403, 'a colleague cannot replace the team design');

// Colleagues' card pages belong to them, not to the buyer or each other.
res = await call(env, '/api/card', bearer(members[0], { method: 'POST', body: JSON.stringify({ fullName: 'Ada Lovelace' }) }));
assert.equal(res.status, 200);
const card = await res.json();
res = await call(env, '/api/card', bearer(members[1], { method: 'POST', body: JSON.stringify({ fullName: 'Grace', slug: card.slug }) }));
assert.equal(res.status, 403);
res = await call(env, `/api/card/${card.slug}`, bearer(owner.token, { method: 'DELETE' }));
assert.equal(res.status, 403);
res = await call(env, `/api/card/${card.slug}`, bearer(members[0], { method: 'DELETE' }));
assert.equal(res.status, 200);

// Colleagues' photos live in their own folders, so one cannot replace another's.
const png = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0]);
const uploadAs = async (token) => (await (await call(env, '/api/upload-image', {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + token, 'X-Image-Type': 'photo' },
  body: png,
})).json()).url;
const photoUrls = [await uploadAs(owner.token), await uploadAs(members[0]), await uploadAs(members[1])]
  .map((u) => new URL(u).pathname);
assert.equal(new Set(photoUrls).size, 3, 'buyer and each colleague get separate photo links');

// ── Retrying a join keeps the same seat ──
const envClaim = makeEnv();
const ownerClaim = await buy(envClaim, 'plink_team123', 7);
const teamClaim = await (await call(envClaim, '/api/team', bearer(ownerClaim.token, { method: 'POST', body: JSON.stringify(design) }))).json();
const joinWith = (claim) => call(envClaim, `/api/team/${teamClaim.id}/join`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ claim }) });
const claimA = 'a'.repeat(32);
const first = await (await joinWith(claimA)).json();
const again = await (await joinWith(claimA)).json();
assert.equal(first.seat, 2);
assert.equal(again.seat, 2, 'the same claim gets the same seat back');
assert.equal((await (await joinWith('b'.repeat(32))).json()).seat, 3);
assert.equal((await (await call(envClaim, `/api/team/${teamClaim.id}`)).json()).members, 2);
assert.equal((await joinWith('short')).status, 200, 'a malformed claim just takes a new seat');
assert.equal((await call(envClaim, `/api/team/${teamClaim.id}/join`, { method: 'POST', body: '{' })).status, 400);

// A buyer saving the design while a colleague joins does not undo the join.
const bucketClaim = envClaim.UPLOADS;
let raced = false;
bucketClaim.beforePut = async (key) => {
  if (raced || !key.startsWith('teams/')) return;
  raced = true;
  assert.equal((await joinWith('c'.repeat(32))).status, 200);
};
res = await call(envClaim, '/api/team', bearer(ownerClaim.token, { method: 'POST', body: JSON.stringify({ ...design, template: 'classic' }) }));
assert.equal(res.status, 200);
bucketClaim.beforePut = null;
const afterRace = await (await call(envClaim, `/api/team/${teamClaim.id}`)).json();
assert.equal(afterRace.members, 4, 'the seat claimed mid-save is kept');
assert.equal(afterRace.design.template, 'classic');

// ── Refund ends the whole team ──
const env2 = makeEnv();
const owner2 = await buy(env2, 'plink_team123', 9);
const team2 = await (await call(env2, '/api/team', bearer(owner2.token, { method: 'POST', body: JSON.stringify(design) }))).json();
const member2 = (await (await call(env2, `/api/team/${team2.id}/join`, { method: 'POST' })).json()).token;
await webhook(env2, 'charge.refunded', { payment_intent: owner2.paymentIntent });
res = await call(env2, `/api/team/${team2.id}/join`, { method: 'POST' });
assert.equal(res.status, 403);
assert.equal((await res.json()).code, 'team_inactive');
assert.equal((await verify(env2, member2)).valid, false, 'a refund revokes colleagues too');

// Joining is rate limited.
const limitedEnv = makeEnv({ RATE_LIMIT: { limit: async ({ key }) => ({ success: !key.startsWith('team-join:') }) } });
assert.equal((await call(limitedEnv, `/api/team/${team.id}/join`, { method: 'POST' })).status, 429);

console.log('Team pack checks passed');
