import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';

const worker = await import(new URL('../_worker.js', import.meta.url).href);
const KEY_SECRET = 'local-test-secret-000000000000000000000000';
const KEY = `fixture.${KEY_SECRET}`;
const route = '/api/v1/signatures/batch';
const limiterKeys = [];
let storageCalls = 0;
const env = {
  PRO_SIGNING_SECRET: 'fixture-only-pro-signing-secret',
  BULK_API_KEYS: JSON.stringify({ fixture: KEY_SECRET }),
  RATE_LIMIT: { limit: async ({ key }) => { limiterKeys.push(key); return { success: true }; } },
  UPLOADS: new Proxy({}, { get() { storageCalls++; throw new Error('Bulk must not access storage'); } }),
  ASSETS: { fetch: async () => new Response('public fixture') },
};
const call = (path = route, init = {}, targetEnv = env) => worker.default.fetch(new Request(`https://example.com${path}`, init), targetEnv);
const headers = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const batch = {
  template: 'classic',
  defaults: { company: 'Example Studio', website: 'https://example.com' },
  style: { primaryColor: '#123456' },
  employees: [{ fullName: 'Alice Example', title: 'Designer', email: 'alice@example.com' }, { fullName: '', email: 'invalid' }],
};
const post = (value, path = route, targetEnv = env, extraHeaders = {}) => call(path, { method: 'POST', headers: { ...headers, ...extraHeaders }, body: JSON.stringify(value) }, targetEnv);

function archiveEntries(buffer) {
  const bytes = Buffer.from(buffer);
  const eocd = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocd >= 0, 'ZIP has a central directory');
  const entries = new Map();
  let offset = bytes.readUInt32LE(eocd + 16);
  const count = bytes.readUInt16LE(eocd + 10);
  for (let i = 0; i < count; i++) {
    assert.equal(bytes.readUInt32LE(offset), 0x02014b50);
    const method = bytes.readUInt16LE(offset + 10);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const localOffset = bytes.readUInt32LE(offset + 42);
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    assert.ok(!name.includes('..') && !name.startsWith('/'), 'archive filenames stay relative');
    const contentOffset = localOffset + 30 + bytes.readUInt16LE(localOffset + 26) + bytes.readUInt16LE(localOffset + 28);
    const compressed = bytes.subarray(contentOffset, contentOffset + compressedSize);
    assert.ok(method === 0 || method === 8, 'supported ZIP compression');
    entries.set(name, (method === 8 ? inflateRawSync(compressed) : compressed).toString('utf8'));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

// Bulk access is independent of Pro and rejects absent, malformed, wrong or revoked keys.
for (const authorization of ['', 'Bearer fixture.wrong', `Bearer unknown.${KEY_SECRET}`, `Bearer fixture.${'a'.repeat(40)}`, 'Bearer eyJhbGciOiJIUzI1NiJ9.pro.token']) {
  const response = await post(batch, route, env, { Authorization: authorization });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('WWW-Authenticate'), 'Bearer');
  const body = await response.text();
  assert.ok(!body.includes(KEY_SECRET) && !body.includes('Alice'));
}
for (const config of [undefined, '', '{broken', '[]', '{}', '{"fixture":"short"}', JSON.stringify({ fixture: KEY_SECRET, other: 'short' })]) {
  const response = await post(batch, route, { ...env, BULK_API_KEYS: config });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, 'bulk_not_configured');
}
const rotated = { ...env, BULK_API_KEYS: JSON.stringify({ fixture: 'rotated-local-test-secret-0000000000000' }) };
assert.equal((await post(batch, route, rotated)).status, 401, 'configuration changes revoke an old key immediately');
assert.equal(limiterKeys.length, 0, 'invalid credentials never reach the limiter');

for (const limiter of [undefined, { limit: async () => null }, { limit: async () => { throw new Error('private provider detail'); } }]) {
  assert.equal((await post(batch, route, { ...env, RATE_LIMIT: limiter })).status, 503);
}
const throttled = await post(batch, route, { ...env, RATE_LIMIT: { limit: async () => ({ success: false }) } });
assert.equal(throttled.status, 429);
assert.equal(throttled.headers.get('Retry-After'), '60');

let response = await post(batch);
assert.equal(response.status, 200);
assert.equal(response.headers.get('Cache-Control'), 'no-store, private');
assert.equal(response.headers.get('Vary'), 'Authorization');
assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
assert.equal(response.headers.get('Access-Control-Allow-Origin'), null, 'no cross-origin browser access is granted');
const result = await response.json();
assert.deepEqual([result.total, result.valid, result.invalid], [2, 1, 1]);
assert.match(result.results[0].html, /Alice Example/);
assert.match(result.results[0].html, /Example Studio/);
assert.match(result.results[0].html, /#123456/i);
assert.match(result.results[0].html, /role="presentation"/);
assert.equal(result.results[1].html, '');
assert.ok(result.results[1].errors.length > 0);
assert.equal(limiterKeys.at(-1), 'bulk:fixture');

for (const template of ['ctabox', 'banner', 'meetinglink', 'realestate', 'showcase']) {
  const booking = { template, employees: [{ fullName: 'Alex QA', email: 'alex@example.com', ctaText: 'Book Alex', ctaUrl: 'https://example.com/alex' }] };
  const jsonResponse = await post(booking);
  assert.equal(jsonResponse.status, 200);
  const generated = await jsonResponse.json();
  assert.match(generated.results[0].html, /href="https:\/\/example.com\/alex"/);
  assert.match(generated.results[0].html, /Book Alex/);
  const zipResponse = await post(booking, route + '?format=zip');
  assert.equal(zipResponse.status, 200);
  const files = archiveEntries(await zipResponse.arrayBuffer());
  const html = [...files.entries()].find(([name]) => name.endsWith('.html'))?.[1];
  assert.equal(html?.match(/<body>([\s\S]*)<\/body>/)?.[1], generated.results[0].html,
    `${template} preserves the booking link inside the ZIP document wrapper`);
}

response = await post({ ...batch, employees: Array.from({ length: globalThis.SiteFacts.bulkMaxRows }, (_, i) => ({ fullName: `Employee ${i + 1}` })) });
assert.equal(response.status, 200);
const fullBatch = await response.json();
assert.equal(fullBatch.valid, globalThis.SiteFacts.bulkMaxRows, 'the full supported batch succeeds');
assert.equal(new Set(fullBatch.results.map((row) => row.filename)).size, globalThis.SiteFacts.bulkMaxRows);

response = await post({ template: 'classic', employees: [{ fullName: '<img src=x onerror=alert(1)>', company: 'A & B' }, { fullName: 'Rejected', website: 'javascript:alert(1)' }] });
const hostile = await response.json();
assert.deepEqual([hostile.valid, hostile.invalid], [1, 1]);
assert.ok(!hostile.results[0].html.includes('<img src=x'), 'employee markup is escaped at the composed API boundary');
assert.match(hostile.results[0].html, /&lt;img/);
assert.equal(hostile.results[1].html, '', 'unsafe URLs cannot become downloadable signatures');

response = await post(batch, `${route}?format=zip`);
assert.equal(response.status, 200);
assert.equal(response.headers.get('Content-Type'), 'application/zip');
assert.equal(response.headers.get('X-Bulk-Valid-Rows'), '1');
assert.equal(response.headers.get('X-Bulk-Invalid-Rows'), '1');
assert.equal(response.headers.get('Content-Disposition'), 'attachment; filename="email-signatures.zip"');
const entries = archiveEntries(await response.arrayBuffer());
assert.equal([...entries.keys()].filter((name) => name.endsWith('.html')).length, 1);
assert.ok([...entries].some(([name, body]) => name.endsWith('.html') && body.includes('Alice Example')));
assert.ok([...entries].some(([name, body]) => name.endsWith('.txt') && body.includes('Alice Example')));
assert.ok(entries.has('errors.json'), 'a partial ZIP reports the rejected rows');
assert.match(entries.get('errors.json'), /email|fullName/);
assert.ok([...entries.keys()].some((name) => /readme/i.test(name)), 'ZIP includes installation instructions');

response = await post({ ...batch, employees: [{ fullName: '', email: 'bad' }] }, `${route}?format=zip`);
assert.equal(response.status, 422);
assert.equal((await response.json()).code, 'no_valid_rows');
assert.equal((await post({ ...batch, employees: Array.from({ length: globalThis.SiteFacts.bulkMaxRows + 1 }, () => ({ fullName: 'Fixture' })) })).status, 413);
assert.equal((await post({ ...batch, template: 'not-a-template' })).status, 400);
assert.equal((await post({ ...batch, employees: 'not-an-array' })).status, 400);
assert.equal((await post(null)).status, 400);
assert.equal((await post(batch, `${route}?format=exe`)).status, 400);
assert.equal((await post(batch, route, env, { 'Content-Type': 'text/plain' })).status, 415);
assert.equal((await post(batch, route, env, { 'Content-Encoding': 'gzip' })).status, 415);
assert.equal((await call(route, { method: 'POST', headers, body: '{broken' })).status, 400);
assert.equal((await call(route, { method: 'POST', headers, body: new Uint8Array([255]) })).status, 400);
assert.equal((await call(route, { method: 'POST', headers })).status, 400);
response = await call(route, { headers });
assert.equal(response.status, 405);
assert.equal(response.headers.get('Allow'), 'POST');

// Enforce the actual streamed byte count, even if Content-Length lies or is absent.
for (const declaredLength of [undefined, '4']) {
  let cancelled = false;
  const stream = new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array(Math.ceil(globalThis.SiteFacts.bulkMaxInputBytes / 2)));
    },
    cancel() { cancelled = true; },
  });
  response = await call(route, { method: 'POST', headers: { ...headers, ...(declaredLength ? { 'Content-Length': declaredLength } : {}) }, body: stream, duplex: 'half' });
  assert.equal(response.status, 413);
  assert.equal(cancelled, true, 'oversized streams are cancelled');
}
response = await call(route, { method: 'POST', headers: { ...headers, 'Content-Length': String(globalThis.SiteFacts.bulkMaxInputBytes + 1) }, body: '{}' });
assert.equal(response.status, 413);

response = await call('/api/v1/templates', { headers });
assert.equal(response.status, 200);
const catalogue = await response.json();
assert.equal(catalogue.templates.length, globalThis.SiteFacts.templateCount);
assert.equal(catalogue.maxRows, globalThis.SiteFacts.bulkMaxRows);
assert.ok(catalogue.templates.some((template) => template.id === 'classic'));
assert.equal((await call('/api/v1/templates')).status, 401);

for (const path of ['/js/bulk-api.js', '/docs/bulk-api.md']) {
  assert.equal((await call(path)).status, 404, 'server sources are never exposed as assets');
}
for (const path of ['/bulk', '/js/bulk.js', '/js/bulk-core.js']) {
  assert.equal((await call(path)).status, 200, 'bulk UI assets are reachable through the Worker');
}
for (const path of ['/bulk', '/js/bulk-spreadsheet-worker.js']) {
  assert.match((await call(path)).headers.get('Content-Security-Policy'), /worker-src 'self' blob:/, 'spreadsheet workers are allowed only where needed');
}
assert.ok(!(await call('/generator')).headers.get('Content-Security-Policy').includes('worker-src'), 'existing page policy stays unchanged');
assert.equal(storageCalls, 0, 'bulk generation never reads or writes persistent storage');
console.log('Bulk API: auth, limits, JSON, ZIP, partial errors and static boundary passed.');
