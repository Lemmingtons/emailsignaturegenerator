// Purchase confirmation email: dormant unless configured, then sent once per
// paid purchase with a fragment-form access link. The provider is stubbed.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

const worker = await import(new URL('../_worker.js', import.meta.url).href);
const signing = 'fixture-purchase-email-signing';
const webhookSecret = 'fixture-purchase-email-webhook';
const now = Math.floor(Date.now() / 1000);
const requests = [];
const acceptedKeys = new Set();
let providerStatus = 200;
let providerWait = null;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  assert.equal(url, 'https://api.resend.com/emails', 'only the email provider is called');
  requests.push({ payload: JSON.parse(options.body), key: options.headers['Idempotency-Key'] });
  if (providerWait) await providerWait;
  if (providerStatus === 200) acceptedKeys.add(options.headers['Idempotency-Key']);
  return Response.json(providerStatus === 200 ? { id: 'fixture-message-id' } : { message: 'private provider error' }, { status: providerStatus });
};

function environment() {
  const store = new Map();
  let version = 0;
  const wrap = entry => entry && ({ etag: entry.etag, text: async () => entry.body });
  const bucket = {
    store,
    async get(key) { return wrap(store.get(key)); },
    async head(key) { return wrap(store.get(key)); },
    async put(key, body, options = {}) {
      const current = store.get(key);
      if (options.onlyIf?.etagDoesNotMatch === '*' && current) return null;
      if (options.onlyIf?.etagMatches && current?.etag !== options.onlyIf.etagMatches) return null;
      const entry = { body: String(body), etag: `fixture-${++version}` };
      store.set(key, entry);
      return wrap(entry);
    },
    async delete(key) { store.delete(key); },
  };
  return {
    UPLOADS: bucket, PRO_SIGNING_SECRET: signing, STRIPE_WEBHOOK_SECRET: webhookSecret,
    STRIPE_LIVEMODE: 'false', STRIPE_PAYMENT_LINK_ID: 'plink_fixturepro', STRIPE_TEAM_PAYMENT_LINK_ID: 'plink_fixtureteam',
    PURCHASE_EMAILS_FROM: new Date((now - 10) * 1000).toISOString(), RESEND_API_KEY: 'fixture-email-secret',
    RATE_LIMIT: { limit: async () => ({ success: true }) },
    ASSETS: { fetch: async () => new Response('fixture asset') },
  };
}
function session(n, overrides = {}) {
  return { id: `cs_test_email${n}`, payment_intent: `pi_email${n}`, mode: 'payment', status: 'complete', payment_status: 'paid', livemode: false,
    payment_link: 'plink_fixtureteam', customer_details: { email: 'buyer@example.com' }, amount_total: 2900, currency: 'usd', ...overrides };
}
function charge(n, overrides = {}) {
  return { id: `ch_email${n}`, payment_intent: `pi_email${n}`, paid: true, status: 'succeeded', amount: 2900, currency: 'usd', receipt_url: `https://pay.stripe.com/receipts/payment/fixture${n}`, ...overrides };
}
async function event(env, type, object, extra = {}, validSignature = true) {
  const payload = JSON.stringify({ id: 'evt_fixtureemail', created: now, livemode: false, type, data: { object }, ...extra });
  const signature = createHmac('sha256', webhookSecret).update(`${now}.${payload}`).digest('hex');
  return worker.default.fetch(new Request('https://emailsignaturegenerator.ai/api/stripe-webhook', {
    method: 'POST', body: payload, headers: { 'Stripe-Signature': `t=${now},v1=${validSignature ? signature : '00'.repeat(32)}` },
  }), env);
}
const paid = (env, n, overrides, extra) => event(env, 'checkout.session.completed', session(n, overrides), extra);
const receipt = (env, n, overrides) => event(env, 'charge.succeeded', charge(n, overrides));
const redeem = (env, n) => worker.default.fetch(new Request(`https://emailsignaturegenerator.ai/api/verify-payment?session_id=cs_test_email${n}`), env);
const tokenFrom = (response) => new URLSearchParams(new URL(response.headers.get('location')).hash.slice(1)).get('token');
const purchaseEmailKeys = (env) => [...env.UPLOADS.store.keys()].filter((key) => key.startsWith('entitlements/purchase-emails/'));
const verify = async (env, token) => (await worker.default.fetch(new Request('https://emailsignaturegenerator.ai/api/verify-token', {
  method: 'POST', body: JSON.stringify({ token }), headers: { 'Content-Type': 'application/json' },
}), env)).json();

try {
  // ── Dormant: nothing is stored or sent unless both settings are present ──
  for (const [label, unset] of [['neither', ['PURCHASE_EMAILS_FROM', 'RESEND_API_KEY']], ['activation time only', ['RESEND_API_KEY']], ['credential only', ['PURCHASE_EMAILS_FROM']]]) {
    const dormant = environment();
    for (const key of unset) delete dormant[key];
    assert.equal((await receipt(dormant, 90)).status, 200, `${label}: charge webhook is unaffected`);
    assert.equal((await paid(dormant, 90)).status, 200, `${label}: checkout webhook is unaffected`);
    assert.equal(requests.length, 0, `${label}: no email provider call`);
    assert.deepEqual(purchaseEmailKeys(dormant), [], `${label}: no purchase-email records`);
    assert.equal((await redeem(dormant, 90)).status, 302, `${label}: the purchase still redeems`);
  }

  let env = environment();
  assert.equal((await receipt(env, 1)).status, 200);
  assert.equal(requests.length, 0, 'a charge alone grants no access and sends no email');
  assert.equal((await paid(env, 1)).status, 200);
  assert.equal(requests.length, 1);
  const first = requests[0];
  assert.deepEqual(first.payload.to, ['buyer@example.com']);
  assert.equal(first.payload.from, 'Email Signature Generator <purchases@mail.emailsignaturegenerator.ai>');
  assert.match(first.payload.text, /Team Pack/);
  assert.match(first.payload.text, /10 editing seats/);
  assert.match(first.payload.text, /250 signatures per batch/);
  assert.match(first.payload.text, /29\.00 USD/);
  assert.match(first.payload.html, /View your Stripe receipt/);
  const access = first.payload.text.match(/Access your purchase: (\S+)/)[1];
  assert.equal(new URL(access).origin, globalThis.SiteFacts.origin);
  assert.equal(new URL(access).search, '', 'the emailed link keeps the session id out of the query');
  assert.equal(new URL(access).hash, '#session_id=cs_test_email1');
  assert.ok(first.payload.html.includes('/api/verify-payment#session_id=cs_test_email1'), 'the HTML button uses the fragment link too');
  // What the server receives for the emailed link: the path only.
  const restorePage = await worker.default.fetch(new Request(new URL(access).origin + new URL(access).pathname), env);
  assert.equal(restorePage.status, 200);
  assert.equal(restorePage.headers.get('Cache-Control'), 'no-store, private');
  const restoreHtml = await restorePage.text();
  assert.ok(!restoreHtml.includes('cs_test_email1'), 'the restore page never prints the session id');
  assert.match(restoreHtml, /location\.hash/, 'the restore page reads the fragment in the browser');
  // The browser then redeems on our origin, as the page's script does.
  const sessionFromHash = new URLSearchParams(new URL(access).hash.slice(1)).get('session_id');
  const response = await worker.default.fetch(new Request(`${new URL(access).origin}/api/verify-payment?session_id=${sessionFromHash}`), env);
  assert.equal(response.status, 302, 'emailed link restores purchase on a fresh device');
  const token = tokenFrom(response);
  assert.deepEqual(await verify(env, token), { valid: true, plan: 'team' });
  await Promise.all([paid(env, 1), receipt(env, 1), paid(env, 1)]);
  assert.equal(requests.length, 1, 'duplicate events do not resend');
  const saved = [...env.UPLOADS.store].find(([key]) => key.endsWith('/delivery.json'));
  assert.deepEqual(Object.keys(JSON.parse(saved[1].body)).sort(), ['providerId', 'sentAt', 'state']);
  await event(env, 'charge.refunded', { payment_intent: 'pi_email1', amount: 2900, amount_refunded: 2900, refunded: true });
  assert.equal((await redeem(env, 1)).status, 403, 'emailed link respects refunds');

  env = environment();
  await paid(env, 2, { payment_link: 'plink_fixturepro', amount_total: 900, client_reference_id: 'bulk' });
  assert.equal(requests.length, 1, 'checkout waits for the receipt when events arrive in the other order');
  await receipt(env, 2, { amount: 900 });
  assert.equal(requests.length, 2);
  assert.match(requests[1].payload.text, /Individual Pro/);
  assert.match(requests[1].payload.text, /19 signatures per batch/);
  assert.equal(new URL((await redeem(env, 2)).headers.get('location')).pathname, '/bulk');

  env = environment(); providerStatus = 503;
  await receipt(env, 3);
  assert.equal((await paid(env, 3)).status, 503, 'provider failure asks Stripe to retry');
  assert.equal((await redeem(env, 3)).status, 302, 'provider failure does not block paid access');
  const failed = requests.at(-1);
  providerStatus = 200;
  assert.equal((await paid(env, 3)).status, 200);
  assert.deepEqual(requests.at(-1), failed, 'retry uses the identical payload and idempotency key');

  env = environment();
  await receipt(env, 13);
  const originalPut = env.UPLOADS.put.bind(env.UPLOADS);
  let failSavedMarker = true;
  env.UPLOADS.put = async (key, body, options) => {
    if (failSavedMarker && key.endsWith('/delivery.json') && JSON.parse(body).state === 'sent') {
      failSavedMarker = false; throw new Error('fixture storage interruption');
    }
    return originalPut(key, body, options);
  };
  const acceptedBefore = acceptedKeys.size;
  assert.equal((await paid(env, 13)).status, 503, 'accepted email with failed durable acknowledgement remains retryable');
  const acceptedAttempt = requests.at(-1);
  await paid(env, 13);
  assert.deepEqual(requests.at(-1), acceptedAttempt);
  assert.equal(acceptedKeys.size, acceptedBefore + 1, 'provider idempotency covers accepted-but-unacknowledged sends');

  env = environment();
  await receipt(env, 4);
  let release;
  providerWait = new Promise(resolve => { release = resolve; });
  const sending = paid(env, 4);
  // Wait for the first request to reach the stubbed provider, without real I/O.
  while (!requests.at(-1).payload.text.includes('cs_test_email4')) await new Promise(resolve => setTimeout(resolve, 0));
  const before = requests.length;
  assert.equal((await paid(env, 4)).status, 503, 'a concurrent send leaves a retryable webhook');
  release(); await sending; providerWait = null;
  assert.equal(requests.length, before, 'conditional lease prevents concurrent email calls');
  await paid(env, 4);
  assert.equal(requests.length, before);

  env = environment();
  await paid(env, 5);
  await event(env, 'charge.dispute.created', { payment_intent: 'pi_email5' });
  await receipt(env, 5);
  assert.equal(requests.length, before, 'revoked purchase never receives an access email');
  assert.equal((await redeem(env, 5)).status, 403);

  env = environment();
  await receipt(env, 6);
  await paid(env, 6, { payment_status: 'unpaid' });
  assert.equal(requests.length, before);
  await event(env, 'checkout.session.async_payment_succeeded', session(6));
  assert.equal(requests.length, before + 1, 'delayed payment sends only after success');

  env = environment();
  const count = requests.length;
  await paid(env, 7, {}, { created: now - 100 });
  await receipt(env, 7);
  await paid(env, 8, { payment_link: 'plink_other' });
  await receipt(env, 8);
  assert.equal((await event(env, 'checkout.session.completed', session(9), {}, false)).status, 400);
  assert.equal((await event(env, 'checkout.session.completed', session(9), { livemode: true })).status, 400);
  assert.equal(requests.length, count, 'old, unrelated, unsigned or wrong-mode payments send nothing');
  assert.equal((await receipt(env, 10, { receipt_url: 'https://pay.stripe.com.evil.example/receipts/phishing' })).status, 503);
  assert.equal((await paid(env, 10, { customer_details: { email: 'victim@example.com\r\nBcc:other@example.com' } })).status, 503);
  assert.equal(requests.length, count);

  env = environment();
  await receipt(env, 11, { amount: 2901 });
  assert.equal((await paid(env, 11)).status, 503, 'mismatched receipt amount cannot be emailed');
  assert.equal(requests.length, count);
  assert.equal((await redeem(env, 11)).status, 302);

  env = environment();
  await receipt(env, 14, { amount: 2900, currency: 'jpy' });
  await paid(env, 14, { amount_total: 2900, currency: 'jpy' });
  assert.match(requests.at(-1).payload.text, /2,900 JPY/, 'zero-decimal currencies show the actual charged amount');

  env = environment(); providerStatus = 503;
  await receipt(env, 12); await paid(env, 12);
  const delivery = [...env.UPLOADS.store].find(([key]) => key.endsWith('/delivery.json'));
  const pending = JSON.parse(delivery[1].body); pending.firstAttemptAt = Date.now() - 24 * 60 * 60 * 1000;
  await env.UPLOADS.put(delivery[0], JSON.stringify(pending));
  const attempts = requests.length; providerStatus = 200;
  assert.equal((await paid(env, 12)).status, 503);
  assert.equal(requests.length, attempts, 'indeterminate sends beyond provider deduplication need reconciliation');

  env = environment(); env.RESEND_API_KEY = '';
  const health = await worker.default.fetch(new Request('https://emailsignaturegenerator.ai/api/health'), env);
  assert.equal(health.status, 503);
  assert.equal((await health.json()).checks.purchaseEmails, false);
  const unconfigured = environment(); delete unconfigured.PURCHASE_EMAILS_FROM; delete unconfigured.RESEND_API_KEY;
  const quiet = await (await worker.default.fetch(new Request('https://emailsignaturegenerator.ai/api/health'), unconfigured)).json();
  assert.ok(!('purchaseEmails' in quiet.checks), 'a dormant Worker does not report purchase emails at all');
  assert.equal((await worker.default.fetch(new Request('https://emailsignaturegenerator.ai/js/purchase-email.js'), env)).status, 404);
  console.log('Purchase emails passed: dormant until configured, fragment access link, signed payment + receipt, both event orders, restored access, plan copy, bulk return, retries, replay, concurrency, revocation, delayed payments, cutoff, unsafe input and provider deduplication boundary.');
} finally { globalThis.fetch = originalFetch; }
