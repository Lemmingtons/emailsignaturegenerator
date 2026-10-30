import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import worker from '../_worker.js';

const origin = 'https://emailsignaturegenerator.ai';
const secret = 'fixture-only-not-a-production-secret';
const env = {
  ASSETS: { fetch: async () => new Response('<!doctype html><html><body><main>Public homepage</main></body></html>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } }) },
  PRO_SIGNING_SECRET: secret,
  UPLOADS: new Proxy({}, { get() { throw new Error('Discovery and rejected requests must not touch customer storage'); } }),
};
const call = (path, init = {}, bindings = env) => worker.fetch(new Request(origin + path, init), bindings);
const metadataPaths = ['/.well-known/api-catalog', '/openapi.json', '/agents.md', '/.well-known/mcp/server-card.json', '/.well-known/agent-skills/index.json', '/.well-known/agent-skills/generate-signatures/SKILL.md'];

// Public discovery is independent of bindings, credentials and customer state.
const noBindings = new Proxy({}, { get(_target, name) {
  if (name === 'SANDBOX_MODE') return undefined;
  throw new Error('Discovery must not inspect private environment bindings');
} });
for (const path of metadataPaths) {
  const response = await call(path, {}, noBindings);
  assert.equal(response.status, 200, path);
  assert.equal(response.headers.get('Cache-Control'), 'public, max-age=3600');
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  const body = await response.text();
  assert.ok(!body.includes(secret));
  const head = await call(path, { method: 'HEAD' }, noBindings);
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('Content-Type'), response.headers.get('Content-Type'));
  assert.equal(await head.text(), '');
  const post = await call(path, { method: 'POST', body: '{}' }, noBindings);
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('Allow'), 'GET, HEAD');
}

const catalogResponse = await call('/.well-known/api-catalog');
assert.match(catalogResponse.headers.get('Content-Type'), /^application\/linkset\+json/);
const catalog = await catalogResponse.json();
const specUrl = new URL(catalog.linkset[0]['service-desc'][0].href);
const spec = await (await call(specUrl.pathname)).json();
assert.equal(spec.openapi, '3.1.0');
assert.deepEqual(Object.keys(spec.paths), ['/api/v1/templates', '/api/v1/signatures/batch']);
assert.deepEqual(spec.security, [{ AgentKey: [] }]);
assert.equal(spec.components.securitySchemes.AgentKey.scheme, 'bearer');
assert.equal(spec.paths['/api/v1/signatures/batch'].post.requestBody.content['application/json'].schema.properties.employees.maxItems, globalThis.SiteFacts.bulkMaxRows);
assert.equal(spec.paths['/api/v1/signatures/batch'].post.requestBody.content['application/json'].schema.additionalProperties, false);

const card = await (await call('/.well-known/mcp/server-card.json')).json();
assert.equal(card.transport.endpoint, origin + '/mcp');
assert.equal(card.transport.type, 'streamable-http');
assert.equal(card.authentication.required, true);
assert.deepEqual(card.tools.map((tool) => tool.name), ['list_templates', 'generate_signatures']);

const skills = await (await call('/.well-known/agent-skills/index.json')).json();
const skillPath = new URL(skills.skills[0].url).pathname;
const skill = await (await call(skillPath)).text();
assert.equal(skills.skills[0].digest, 'sha256:' + createHash('sha256').update(skill).digest('hex'));
assert.match(skill, /^---\nname: generate-signatures\n/);
assert.match(skill, /never ask for the browser purchase token/i);

// Advertised methods still reach the existing entitlement checks, even with a
// Markdown Accept header. Neither a schema nor metadata supplies credentials.
for (const [path, init] of [
  ['/api/v1/templates', {}],
  ['/api/v1/signatures/batch', { method: 'POST', body: JSON.stringify({ employees: [{ fullName: 'Fixture Person' }] }) }],
  ['/mcp', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) }],
  ['/api/v1/access-key', {}],
]) {
  const response = await call(path, { ...init, headers: { 'Content-Type': 'application/json', Accept: 'text/markdown, application/json, text/event-stream' } });
  assert.equal(response.status, 401, path + ' remains protected');
  assert.match(response.headers.get('Cache-Control'), /no-store/);
  const body = await response.text();
  assert.ok(!body.includes('Fixture Person') && !body.includes(secret));
}

for (const accept of ['text/markdown', 'text/markdown, text/html;q=0.8', 'TEXT/MARKDOWN;Q=1, text/html;q=0.5']) {
  const response = await call('/', { headers: { Accept: accept } }, noBindings);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Content-Type'), /^text\/markdown/);
  assert.equal(response.headers.get('Vary'), 'Accept');
  assert.match(response.headers.get('Link'), /rel="api-catalog"/);
  const text = await response.text();
  assert.match(text, new RegExp(globalThis.SiteFacts.proPrice.displayWithCurrency.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(text, /No OAuth sign-in flow is offered/);
  assert.ok(!/<html/i.test(text));
}
for (const accept of ['', '*/*', 'text/html', 'text/markdown;q=0', 'text/markdown;q=0.1, text/html;q=0.9', 'text/markdown;q=0.2, */*', 'text/markdown;q=invalid']) {
  const response = await call('/', { headers: { Accept: accept } });
  assert.match(response.headers.get('Content-Type'), /^text\/html/);
  assert.match(await response.text(), /Public homepage/);
  assert.equal(response.headers.get('Vary'), 'Accept');
  assert.match(response.headers.get('Link'), /rel="service-desc"/);
}
const head = await call('/', { method: 'HEAD', headers: { Accept: 'text/markdown' } }, noBindings);
assert.match(head.headers.get('Content-Type'), /^text\/markdown/);
assert.equal(await head.text(), '');
assert.equal((await call('/', { method: 'POST', body: '{}' })).status, 404);
for (const path of ['/', '/openapi.json', '/agents.md']) {
  const response = await call(path, { headers: { Accept: 'text/markdown' } }, { SANDBOX_MODE: 'true' });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, nofollow, noarchive');
}

// The new server module is not a new public asset route. Unknown metadata and
// private sources cannot fall through to a permissive static binding.
for (const path of ['/js/agent-discovery.js', '/js/bulk-mcp.js', '/docs/mcp.md', '/.well-known/missing', '/openapi.json/extra', '/auth.md']) {
  const response = await call(path, { headers: { Accept: 'text/markdown' } });
  assert.equal(response.status, 404, path);
}

console.log('Agent discovery: public metadata, schema/skill integrity, Markdown negotiation and preserved paid/private boundaries passed.');
