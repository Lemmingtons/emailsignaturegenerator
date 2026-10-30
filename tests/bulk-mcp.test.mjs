import assert from 'node:assert/strict';
import { bulkMcpResponse } from '../js/bulk-mcp.js';

const BASE = 'https://example.com/mcp';
const KEY = 'Bearer fixture-agent-key';
const headers = { Authorization: KEY, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
let authorizations = 0;
let grantedRows = globalThis.SiteFacts.bulkMaxRows;
const options = { authorize: async (request) => {
  authorizations++;
  if (request.headers.get('Authorization') !== KEY) return new Response(JSON.stringify({ error: 'invalid_api_key' }), { status: 401, headers: { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer' } });
  return { id: 'fixture-owner', maxRows: grantedRows };
} };
const env = new Proxy({}, { get() { throw Error('MCP generation must not access persistent storage or secrets directly'); } });
const call = (value, init = {}, config = options) => bulkMcpResponse(new Request(BASE, { method: 'POST', headers, body: JSON.stringify(value), ...init }), env, config);
const request = (method, params, id = 1) => ({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
const batch = { template: 'classic', defaults: { company: 'Example Studio' }, employees: [{ fullName: 'Alex Example', email: 'alex@example.com' }, { fullName: '', email: 'invalid' }] };

for (const version of ['2025-03-26', '2025-06-18', '2025-11-25', 'unsupported-client-version']) {
  const response = await call(request('initialize', { protocolVersion: version, capabilities: {}, clientInfo: { name: 'fixture-client', version: '1' } }));
  assert.equal(response.status, 200);
  const reply = await response.json();
  assert.equal(reply.result.protocolVersion, version === 'unsupported-client-version' ? '2025-11-25' : version);
  assert.deepEqual(reply.result.capabilities, { tools: { listChanged: false } });
  assert.equal(response.headers.get('Mcp-Session-Id'), null);
  assert.equal(response.headers.get('Cache-Control'), 'no-store, private');
  assert.equal(response.headers.get('Vary'), 'Authorization');
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
}
assert.equal((await (await call(request('initialize', {}))).json()).error.code, -32602);
const notified = await call({ jsonrpc: '2.0', method: 'notifications/initialized' });
assert.equal(notified.status, 202);
assert.equal(await notified.text(), '');
assert.deepEqual((await (await call(request('ping'))).json()).result, {});

let response = await call(request('tools/list'));
let result = (await response.json()).result;
assert.deepEqual(result.tools.map((tool) => tool.name), ['list_templates', 'generate_signatures']);
assert.equal(result.tools[1].inputSchema.properties.employees.maxItems, globalThis.SiteFacts.bulkMaxRows);
assert.equal(result.tools[1].inputSchema.additionalProperties, false);
assert.equal(Object.hasOwn(result.tools[1].inputSchema.properties.defaults.properties, 'fullName'), false);
assert.ok(result.tools.every((tool) => tool.annotations.readOnlyHint && !tool.annotations.destructiveHint));

response = await call(request('tools/call', { name: 'list_templates', arguments: {} }));
result = (await response.json()).result;
assert.equal(result.isError, false);
assert.equal(result.structuredContent.templates.length, globalThis.SiteFacts.templateCount);
assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
response = await call(request('tools/call', { name: 'generate_signatures', arguments: batch }));
result = (await response.json()).result;
assert.equal(result.isError, false);
assert.equal(result.structuredContent.valid, 1);
assert.equal(result.structuredContent.invalid, 1);
assert.match(result.structuredContent.results[0].html, /Alex Example/);
assert.match(result.structuredContent.results[0].html, /Example Studio/);
assert.equal(result.structuredContent.results[1].html, '');
assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
const hostile = { employees: [{ fullName: '<script>alert(1)</script>', website: 'https://example.com' }, { fullName: 'Unsafe', website: 'javascript:alert(1)' }] };
result = (await (await call(request('tools/call', { name: 'generate_signatures', arguments: hostile }))).json()).result;
assert.equal(result.structuredContent.valid, 1);
assert.ok(!result.structuredContent.results[0].html.includes('<script>'));
assert.match(result.structuredContent.results[0].html, /&lt;script&gt;/);
assert.equal(result.structuredContent.results[1].html, '');
result = (await (await call(request('tools/call', { name: 'generate_signatures', arguments: { employees: [{ fullName: '' }] } }))).json()).result;
assert.equal(result.isError, true);
assert.equal(result.structuredContent.valid, 0);
result = (await (await call(request('tools/call', { name: 'generate_signatures', arguments: { employees: [] } }))).json()).result;
assert.equal(result.isError, true);
assert.equal(result.structuredContent.code, 'invalid_employees');

// Plan limits are enforced before any rendering, and are reflected in discovery.
grantedRows = 19;
response = await call(request('tools/list'));
assert.equal((await response.json()).result.tools[1].inputSchema.properties.employees.maxItems, 19);
result = (await (await call(request('tools/call', { name: 'list_templates' }))).json()).result;
assert.equal(result.structuredContent.maxRows, 19);
result = (await (await call(request('tools/call', { name: 'generate_signatures', arguments: { employees: Array.from({ length: 19 }, () => ({ fullName: 'Fixture' })) } }))).json()).result;
assert.equal(result.structuredContent.valid, 19);
let renderCalls = 0;
const originalBulk = globalThis.SignatureBulk;
globalThis.SignatureBulk = { ...originalBulk, generateBatch: (...args) => { renderCalls++; return originalBulk.generateBatch(...args); } };
result = (await (await call(request('tools/call', { name: 'generate_signatures', arguments: { employees: Array.from({ length: 20 }, () => ({ fullName: 'Fixture' })) } }))).json()).result;
assert.equal(result.isError, true);
assert.equal(result.structuredContent.code, 'team_plan_required');
assert.equal(result.structuredContent.maxRows, 19);
assert.equal(renderCalls, 0);
assert.equal((await call({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'generate_signatures', arguments: batch } })).status, 400);
assert.equal((await call({ jsonrpc: '2.0', method: 'notifications/tools/call', params: { name: 'generate_signatures', arguments: batch } })).status, 202);
assert.equal(renderCalls, 0, 'notifications never execute generation');
globalThis.SignatureBulk = { ...originalBulk, generateBatch: () => { throw new Error('fixture private exception'); } };
response = await call(request('tools/call', { name: 'generate_signatures', arguments: batch }));
assert.equal((await response.json()).error.message, 'Signature generation failed');
globalThis.SignatureBulk = originalBulk;
grantedRows = globalThis.SiteFacts.bulkMaxRows;
result = (await (await call(request('tools/call', { name: 'generate_signatures', arguments: { employees: Array.from({ length: grantedRows + 1 }, () => ({ fullName: 'Fixture' })) } }))).json()).result;
assert.equal(result.structuredContent.code, 'too_many_rows');

for (const value of [[], [request('ping')], null, {}, { ...request('ping'), id: null }, { ...request('ping'), id: false }, { ...request('ping'), id: 1.1 }, { ...request('ping'), params: [] }, { ...request('ping'), extra: 'field' }]) {
  assert.equal((await call(value)).status, 400);
}
assert.equal((await (await call(request('missing-method'))).json()).error.code, -32601);
assert.equal((await (await call(request('tools/call', { name: 'missing-tool' }))).json()).error.code, -32602);
assert.equal((await (await call(request('tools/call', { name: 'list_templates', arguments: { unexpected: 'value' } }))).json()).error.code, -32602);
assert.equal((await (await call(request('tools/list', { cursor: 'not-a-cursor' }))).json()).error.code, -32602);
assert.equal((await (await call(request('tools/call', { name: 'generate_signatures', arguments: [] }))).json()).error.code, -32602);
assert.equal((await call(request('notifications/initialized'))).status, 400);

response = await call(request('ping'), { body: '{broken' });
assert.equal(response.status, 400);
assert.equal((await response.json()).error.code, -32700);
assert.equal((await call(request('ping'), { headers: { ...headers, 'Content-Type': 'text/plain' } })).status, 415);
assert.equal((await call(request('ping'), { headers: { ...headers, 'Content-Encoding': 'gzip' } })).status, 415);
for (const accept of ['', '*/*', 'application/json', 'text/event-stream', 'application/json;q=0, text/event-stream']) {
  assert.equal((await call(request('ping'), { headers: { ...headers, Accept: accept } })).status, 406);
}
assert.equal((await call(request('ping'), { headers: { ...headers, Accept: 'text/event-stream, application/json; q=0.9' } })).status, 200);
assert.equal((await call(request('ping'), { headers: { ...headers, Origin: 'https://evil.example' } })).status, 403);
assert.equal((await call(request('ping'), { headers: { ...headers, Origin: 'null' } })).status, 403);
assert.equal((await call(request('ping'), { headers: { ...headers, Origin: 'https://example.com' } })).status, 200);
assert.equal((await call(request('ping'), { headers: { ...headers, 'MCP-Protocol-Version': '2024-11-05' } })).status, 400);
for (const version of ['2025-03-26', '2025-06-18', '2025-11-25']) {
  assert.equal((await call(request('ping'), { headers: { ...headers, 'MCP-Protocol-Version': version } })).status, 200);
}
for (const method of ['GET', 'DELETE', 'OPTIONS']) {
  response = await bulkMcpResponse(new Request(BASE, { method, headers }), env, options);
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('Allow'), 'POST');
}
for (const method of ['GET', 'POST']) {
  response = await bulkMcpResponse(new Request(BASE, { method, headers: { Accept: headers.Accept, 'Content-Type': 'application/json' }, ...(method === 'POST' ? { body: JSON.stringify(request('tools/list')) } : {}) }), env, options);
  assert.equal(response.status, 401, 'discovery and GET cannot bypass authorization');
  assert.equal(response.headers.get('Cache-Control'), 'no-store, private');
}
response = await call(request('ping'), {}, { authorize: async () => new Response('rate_limited', { status: 429, headers: { 'Retry-After': '60' } }) });
assert.equal(response.status, 429);
assert.equal(response.headers.get('Retry-After'), '60');
assert.equal((await call(request('ping'), {}, {})).status, 503);
assert.equal((await call(request('ping'), {}, { authorize: async () => ({}) })).status, 503);
assert.equal((await call(request('ping'), {}, { authorize: async () => ({ id: 'fixture', maxRows: 0 }) })).status, 503);
response = await call(request('ping'), { body: ' '.repeat(globalThis.SiteFacts.bulkMaxInputBytes + 1) });
assert.equal(response.status, 413);
let cancelled = false;
const oversized = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(globalThis.SiteFacts.bulkMaxInputBytes)); }, cancel() { cancelled = true; } });
response = await bulkMcpResponse(new Request(BASE, { method: 'POST', headers, body: oversized, duplex: 'half' }), env, options);
assert.equal(response.status, 413);
assert.equal(cancelled, true);
assert.ok(authorizations > 50);
console.log('MCP: version negotiation, authenticated discovery/generation, plan limits, row errors, protocol/transport validation and streamed limits passed.');
