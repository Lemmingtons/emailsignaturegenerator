import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import worker from '../_worker.js';

const origin = 'https://emailsignaturegenerator.ai';
const secret = 'fixture-agent-registration-signing';
const webhookSecret = 'fixture-agent-registration-webhook';
const store = new Map();
let version = 0;
const wrap = (entry) => entry && ({ etag: entry.etag, text: async () => entry.body, customMetadata: {} });
const bucket = {
  async get(key) { return wrap(store.get(key)); },
  async head(key) { return wrap(store.get(key)); },
  async put(key, body, options = {}) {
    const current = store.get(key);
    if (options.onlyIf?.etagMatches && current?.etag !== options.onlyIf.etagMatches) return null;
    if (options.onlyIf?.etagDoesNotMatch === '*' && current) return null;
    const entry = { body: String(body), etag: 'grant-fixture-' + ++version };
    store.set(key, entry);
    return wrap(entry);
  },
  async delete(key) { store.delete(key); },
};
const env = { PRO_SIGNING_SECRET: secret, STRIPE_WEBHOOK_SECRET: webhookSecret, STRIPE_LIVEMODE: 'false', STRIPE_PAYMENT_LINK_ID: 'plink_fixture', STRIPE_TEAM_PAYMENT_LINK_ID: 'plink_fixtureteam', UPLOADS: bucket, RATE_LIMIT: { limit: async () => ({ success: true }) } };
const call = (path, init = {}, bindings = env) => worker.fetch(new Request(origin + path, init), bindings);
const post = (path, value, token = '', extra = {}) => call(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...extra.headers }, body: JSON.stringify(value) }, extra.env || env);
const agent = (action, value, token, extra) => post('/api/v1/agent/' + action, value, token, extra);
let purchaseIndex = 0;
async function webhook(type, object) {
  const payload = JSON.stringify({ id: 'evt_agent' + ++purchaseIndex, type, livemode: false, data: { object } });
  const time = Math.floor(Date.now() / 1000);
  const sig = createHmac('sha256', webhookSecret).update(time + '.' + payload).digest('hex');
  const response = await call('/api/stripe-webhook', { method: 'POST', headers: { 'Stripe-Signature': `t=${time},v1=${sig}` }, body: payload });
  assert.equal(response.status, 200);
}
async function buy(plan = 'pro') {
  const id = ++purchaseIndex;
  const session = { id: 'cs_test_agent' + id, payment_intent: 'pi_agent' + id, mode: 'payment', status: 'complete', payment_status: 'paid', livemode: false, payment_link: plan === 'team' ? 'plink_fixtureteam' : 'plink_fixture' };
  await webhook('checkout.session.completed', session);
  const response = await call('/api/verify-payment?session_id=' + session.id);
  assert.equal(response.status, 302);
  return { token: new URL(response.headers.get('Location')).searchParams.get('token'), paymentIntent: session.payment_intent };
}
async function register(name = 'Fixture Assistant') {
  const response = await agent('register', { agent_name: name });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Cache-Control'), /no-store/);
  const value = await response.json();
  const requestToken = new URL(value.claim.verification_uri).searchParams.get('request');
  assert.ok(!value.claim.verification_uri.includes(value.claim_token));
  assert.match(value.claim.user_code, /^[A-F0-9]{4}-[A-F0-9]{4}$/);
  return { ...value, requestToken };
}
const approve = (reg, token, code = reg.claim.user_code) => agent('approve', { request_token: reg.requestToken, user_code: code }, token);
const exchange = (reg) => agent('token', { claim_token: reg.claim_token });
const generate = (token, count = 1) => post('/api/v1/signatures/batch', { employees: Array.from({ length: count }, (_, i) => ({ fullName: 'Synthetic Colleague ' + i })) }, token);

const owner = await buy();
const other = await buy('team');
const before = store.size;
const reg = await register();
assert.equal(store.size, before, 'unapproved registrations write no storage');
let response = await exchange(reg);
assert.equal(response.status, 202, 'polling before buyer approval grants no access');
assert.equal((await response.json()).status, 'authorization_pending');
assert.equal(store.size, before);
response = await agent('preview', { request_token: reg.requestToken });
assert.equal((await response.json()).agent_name, 'Fixture Assistant');
assert.equal((await approve(reg, '')).status, 401, 'no purchase cannot approve');
assert.equal((await approve(reg, owner.token, reg.claim.user_code.replace(/^[A-F0-9]/, (c) => c === 'A' ? 'B' : 'A'))).status, 400, 'the browser must provide the matching code');
assert.equal((await approve(reg, owner.token)).status, 200);
assert.equal((await approve(reg, other.token)).status, 409, 'another buyer cannot rebind an approved request');
const concurrent = await Promise.all([exchange(reg), exchange(reg)]);
assert.deepEqual(concurrent.map((r) => r.status).sort(), [200, 409], 'exactly one exchange wins');
const credential = await concurrent.find((r) => r.status === 200).json();
const key = credential.access_token;
assert.ok(credential.expires_in > 86395 && credential.expires_in <= 86400);
assert.equal(credential.scope, 'templates:read signatures:generate');
assert.equal((await generate(key)).status, 200);
response = await call('/a2a/message:send', { method: 'POST', headers: { 'Content-Type': 'application/a2a+json', 'A2A-Version': '1.0', Authorization: 'Bearer ' + key }, body: JSON.stringify({ message: { messageId: crypto.randomUUID(), role: 'ROLE_USER', parts: [{ mediaType: 'application/json', data: { operation: 'generate_signatures', arguments: { employees: [{ fullName: 'Synthetic Colleague' }] } } }] } }) });
assert.equal(response.status, 200, 'a buyer-approved credential works through the advertised A2A interface');
const a2aResult = await response.json();
assert.equal(a2aResult.message.parts[0].data.valid, 1);
assert.match(a2aResult.message.parts[0].data.results[0].html, /Synthetic Colleague/);
assert.equal((await generate(key, 20)).status, 403, 'temporary credentials keep the original Individual limit');
assert.equal((await agent('approve', { request_token: reg.requestToken, user_code: reg.claim.user_code }, key)).status, 401, 'an agent cannot approve itself');
assert.equal((await post('/api/v1/access-key', { action: 'rotate' }, key)).status, 401);
for (const path of ['/api/upload-image', '/api/team', '/api/signature']) assert.ok([401, 403].includes((await post(path, {}, key)).status), path);
for (const { body } of store.values()) {
  for (const privateValue of [key, owner.token, reg.claim_token, reg.requestToken, 'Synthetic Colleague']) assert.ok(!body.includes(privateValue), 'grant storage contains no raw secrets or employee inputs');
}

const teamReg = await register();
assert.equal((await approve(teamReg, other.token)).status, 200);
const teamKey = (await (await exchange(teamReg)).json()).access_token;
assert.equal((await generate(teamKey, 250)).status, 200);
assert.equal((await generate(teamKey, 251)).status, 413);
await post('/api/v1/access-key', { action: 'revoke' }, owner.token);
assert.equal((await generate(key)).status, 401, 'the buyer can revoke a connected agent');
await webhook('charge.refunded', { payment_intent: other.paymentIntent });
assert.equal((await generate(teamKey)).status, 401, 'refunds revoke temporary grants');

const paid = await buy();
const pending = await register();
assert.equal((await approve(pending, paid.token)).status, 200);
await post('/api/v1/access-key', { action: 'rotate' }, paid.token);
assert.equal((await exchange(pending)).status, 401, 'rotation before exchange fails closed');
const time = Date.now;
const expiring = await register();
const liveGrant = await register();
assert.equal((await approve(liveGrant, paid.token)).status, 200);
const shortKey = (await (await exchange(liveGrant)).json()).access_token;
assert.equal((await generate(shortKey)).status, 200);
try {
  Date.now = () => time() + 601_000;
  assert.equal((await approve(expiring, paid.token)).status, 400, 'expired requests cannot be approved');
  assert.equal((await exchange(expiring)).status, 400, 'expired claim tokens cannot be exchanged');
  Date.now = () => time() + 86_401_000;
  assert.equal((await generate(shortKey)).status, 401, 'an otherwise active temporary key expires independently of purchase status');
  assert.equal((await generate(paid.token)).status, 200, 'expiry does not revoke the buyer purchase');
} finally { Date.now = time; }

const attacked = await register();
const changed = attacked.requestToken.slice(0, -10) + 'X'.repeat(10);
assert.equal((await agent('preview', { request_token: changed })).status, 400);
assert.equal((await agent('register', { agent_name: '<script>unsafe</script>' })).status, 400);
assert.equal((await agent('register', { agent_name: 'Fixture', scopes: ['admin'] })).status, 400);
assert.equal((await agent('register', { agent_name: 'Fixture' }, '', { headers: { Origin: 'https://foreign.example' } })).status, 403);
assert.equal((await agent('register', { agent_name: 'Fixture' }, '', { headers: { 'Content-Encoding': 'gzip' } })).status, 415);
assert.equal((await agent('register', { agent_name: 'X'.repeat(9000) })).status, 413);
assert.equal((await call('/api/v1/agent/register')).status, 405);
assert.equal((await agent('missing', {})).status, 404);
assert.equal((await agent('register', { agent_name: 'Fixture' }, '', { env: { ...env, RATE_LIMIT: undefined } })).status, 503);
assert.equal((await agent('register', { agent_name: 'Fixture' }, '', { env: { ...env, RATE_LIMIT: { limit: async () => ({ success: false }) } } })).status, 429);
assert.equal((await agent('register', { agent_name: 'Fixture' }, '', { env: { ...env, UPLOADS: null } })).status, 503);
response = await agent('token', { claim_token: attacked.claim_token }, '', { env: { ...env, UPLOADS: { get: async () => { throw new Error('private storage identifier'); } } } });
assert.equal(response.status, 503);
assert.ok(!(await response.text()).includes('private storage identifier'));
console.log('Agent registration: paid buyer approval, one-time concurrent exchange, generation-only access, plan limits, expiry, rotation/refunds and private-data boundaries passed.');
