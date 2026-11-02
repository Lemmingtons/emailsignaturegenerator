import './site-facts.js';
import { readBulkJson } from './bulk-api.js';
import { bulkMcpResponse } from './bulk-mcp.js';

const VERSION = '1.0';
const HEADERS = {
  'Content-Type': 'application/a2a+json; charset=utf-8',
  'Cache-Control': 'no-store, private',
  Vary: 'Authorization',
  'X-Content-Type-Options': 'nosniff',
  'A2A-Version': VERSION,
};
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const identifier = (value) => typeof value === 'string' && value.length > 0 && value.length <= 128;
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { ...HEADERS, ...headers } });

function failure(status, message, reason, headers = {}, domain = 'a2a-protocol.org') {
  const names = { 400: 'INVALID_ARGUMENT', 403: 'PERMISSION_DENIED', 404: 'NOT_FOUND', 405: 'UNIMPLEMENTED', 406: 'INVALID_ARGUMENT', 413: 'RESOURCE_EXHAUSTED', 415: 'INVALID_ARGUMENT', 500: 'INTERNAL', 503: 'UNAVAILABLE' };
  return json({ error: {
    code: status, status: names[status] || 'UNKNOWN', message,
    ...(reason ? { details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason, domain }] } : {}),
  } }, status, headers);
}

function responseMediaType(header) {
  const accepted = String(header || '*/*').toLowerCase().split(',').map((value) => {
    const [type, ...parameters] = value.trim().split(';');
    const q = parameters.find((parameter) => /^\s*q\s*=/.test(parameter));
    const weight = q ? Number(q.split('=')[1]) : 1;
    return { type, weight: Number.isFinite(weight) && weight >= 0 && weight <= 1 ? weight : 0 };
  });
  const weight = (type) => {
    const matching = [type, 'application/*', '*/*'].map((pattern) => accepted.filter((item) => item.type === pattern)).find((items) => items.length);
    return matching ? Math.max(...matching.map((item) => item.weight)) : 0;
  };
  const a2a = weight('application/a2a+json');
  const generic = weight('application/json');
  return a2a > 0 && a2a >= generic ? 'application/a2a+json' : generic > 0 ? 'application/json' : null;
}

export function bulkA2aCard() {
  const facts = globalThis.SiteFacts;
  return {
    name: facts.siteName,
    description: 'Paid, synchronous email signature generation from authorised employee details. Accepts a structured operation, not natural-language instructions. Does not install signatures, send email, fetch files or retain staff details.',
    version: '1.0.0',
    supportedInterfaces: [{ url: facts.origin + '/a2a', protocolBinding: 'HTTP+JSON', protocolVersion: VERSION }],
    documentationUrl: facts.origin + '/agents.md',
    capabilities: { streaming: false, pushNotifications: false, extendedAgentCard: false },
    securitySchemes: { agentKey: { httpAuthSecurityScheme: { scheme: 'Bearer', description: 'Customer-approved generation credential. See /auth.md for provisioning and revocation.' } } },
    securityRequirements: [{ schemes: { agentKey: { list: [] } } }],
    defaultInputModes: ['application/json'],
    defaultOutputModes: ['application/json'],
    skills: [
      { id: 'list_templates', name: 'List signature templates', description: 'Send one data part with {"operation":"list_templates","arguments":{}}. Returns templates and the current paid plan limits.', tags: ['email', 'templates'] },
      { id: 'generate_signatures', name: 'Generate email signatures', description: 'Send one data part with {"operation":"generate_signatures","arguments":{"employees":[{"fullName":"Example Person"}]}}. Arguments match the documented batch API. Inspect valid, invalid and row errors before saving the returned HTML and plain text.', tags: ['email', 'signatures', 'bulk'] },
    ],
  };
}

export async function bulkA2aResponse(request, env, options = {}) {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  if (origin !== null && origin !== url.origin) return failure(403, 'Origin not allowed');
  if (typeof options.authorize !== 'function') return failure(503, 'Agent access is unavailable');
  const access = await options.authorize(request, env);
  if (access instanceof Response) {
    const headers = new Headers(HEADERS);
    access.headers.forEach((value, name) => headers.set(name, value));
    return new Response(access.body, { status: access.status, headers });
  }
  if (!access || !identifier(access.id) || !Number.isInteger(access.maxRows) || access.maxRows < 1 || access.maxRows > globalThis.SiteFacts.bulkMaxRows) {
    return failure(503, 'Agent access is unavailable');
  }
  const requestedVersion = request.headers.get('A2A-Version') ?? url.searchParams.get('A2A-Version');
  // A missing version means 0.3 in A2A, which this 1.0-only interface does not implement.
  if (requestedVersion !== VERSION) return failure(400, 'Use A2A-Version: 1.0', 'VERSION_NOT_SUPPORTED');
  if (url.pathname !== '/a2a/message:send') {
    if (url.pathname === '/a2a/message:stream' || url.pathname === '/a2a/extendedAgentCard') return failure(400, 'This synchronous interface does not support this operation', 'UNSUPPORTED_OPERATION');
    if (/^\/a2a\/tasks(?:\/|$)/.test(url.pathname)) return failure(404, 'No persisted task is available', 'TASK_NOT_FOUND');
    return failure(404, 'Agent operation not found');
  }
  if (request.method !== 'POST') return failure(405, 'Use POST', undefined, { Allow: 'POST' });
  const contentType = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (!['application/a2a+json', 'application/json'].includes(contentType)) return failure(415, 'Use Content-Type: application/a2a+json');
  if (request.headers.has('Content-Encoding') && request.headers.get('Content-Encoding').toLowerCase() !== 'identity') return failure(415, 'Encoded request bodies are not supported');
  const responseType = responseMediaType(request.headers.get('Accept'));
  if (!responseType) return failure(406, 'Accept application/a2a+json');
  const parsed = await readBulkJson(request, globalThis.SiteFacts.bulkMaxInputBytes);
  if (parsed instanceof Response) return failure(parsed.status, parsed.status === 413 ? 'Request exceeds the input byte limit' : 'Invalid JSON request');
  const input = parsed.value;
  if (!record(input) || !record(input.message)) return failure(400, 'A message object is required');
  if (input.tenant !== undefined && input.tenant !== '') return failure(400, 'Tenant routing is not supported', 'UNSUPPORTED_OPERATION');
  const message = input.message;
  if (message.role !== 'ROLE_USER' || !identifier(message.messageId)) return failure(400, 'Use ROLE_USER and a nonempty messageId of at most 128 characters');
  if (message.taskId) return failure(404, 'No persisted task is available', 'TASK_NOT_FOUND');
  if (message.contextId !== undefined && !identifier(message.contextId)) return failure(400, 'Invalid contextId');
  if (message.referenceTaskIds !== undefined && (!Array.isArray(message.referenceTaskIds) || message.referenceTaskIds.length)) return failure(400, 'Task references are not supported', 'UNSUPPORTED_OPERATION');
  const configuration = input.configuration;
  if (configuration !== undefined && !record(configuration)) return failure(400, 'Invalid configuration');
  if (configuration?.taskPushNotificationConfig !== undefined) return failure(400, 'Push notifications are not supported', 'PUSH_NOTIFICATION_NOT_SUPPORTED');
  if (configuration?.acceptedOutputModes !== undefined && (!Array.isArray(configuration.acceptedOutputModes) ||
      configuration.acceptedOutputModes.some((mode) => typeof mode !== 'string') ||
      !configuration.acceptedOutputModes.some((mode) => ['application/json', 'application/*', '*/*'].includes(mode)))) {
    return failure(400, 'Output is a structured application/json data part', 'CONTENT_TYPE_NOT_SUPPORTED');
  }
  if (configuration?.returnImmediately !== undefined && typeof configuration.returnImmediately !== 'boolean') return failure(400, 'Invalid returnImmediately');
  if (configuration?.historyLength !== undefined && (!Number.isSafeInteger(configuration.historyLength) || configuration.historyLength < 0)) return failure(400, 'Invalid historyLength');
  if (!Array.isArray(message.parts) || message.parts.length !== 1 || !record(message.parts[0])) return failure(400, 'Send exactly one structured data part', 'CONTENT_TYPE_NOT_SUPPORTED');
  const part = message.parts[0];
  if (!record(part.data) || ['text', 'raw', 'url'].some((field) => Object.hasOwn(part, field)) || (part.mediaType !== undefined && part.mediaType !== 'application/json')) return failure(400, 'Only an application/json data part is supported', 'CONTENT_TYPE_NOT_SUPPORTED');
  const operation = part.data.operation;
  const args = part.data.arguments ?? {};
  if (!['list_templates', 'generate_signatures'].includes(operation) || !record(args) || Object.keys(part.data).some((key) => !['operation', 'arguments'].includes(key))) return failure(400, 'Use list_templates or generate_signatures with object arguments');

  // Reuse the existing tool boundary after the caller has paid and rate-limited
  // this request. No second authorisation or rate allowance is created here.
  const mcp = await bulkMcpResponse(new Request(url.origin + '/mcp', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: operation, arguments: args } }),
  }), env, { authorize: async () => access });
  const result = await mcp.json();
  if (result.error) return failure(result.error.code === -32603 ? 500 : 400, result.error.code === -32603 ? 'Signature generation failed' : 'Invalid operation arguments');
  const value = result.result?.structuredContent;
  if (!record(value)) return failure(500, 'Signature generation failed');
  if (result.result.isError && value.code) {
    const status = value.code === 'team_plan_required' ? 403 : value.code === 'too_many_rows' ? 413 : 400;
    return failure(status, value.error || 'Invalid signature batch', value.code.toUpperCase(), {}, new URL(globalThis.SiteFacts.origin).hostname);
  }
  return json({ message: {
    messageId: crypto.randomUUID(), contextId: message.contextId || crypto.randomUUID(), role: 'ROLE_AGENT',
    parts: [{ mediaType: 'application/json', data: { operation, isError: result.result.isError === true, ...value } }],
  } }, 200, { 'Content-Type': responseType + '; charset=utf-8' });
}
