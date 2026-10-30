import './site-facts.js';
import './generator-core.js';
import './templates.js';
import './bulk-core.js';

const responseHeaders = {
  'Cache-Control': 'no-store, private',
  'Vary': 'Authorization',
  'X-Content-Type-Options': 'nosniff',
};

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...responseHeaders, 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

function error(status, code, headers = {}) {
  return json({ error: code, code }, status, headers);
}

function configuredKeys(value) {
  if (typeof value !== 'string' || value.length > 32_000) return null;
  try {
    const keys = JSON.parse(value);
    if (!keys || typeof keys !== 'object' || Array.isArray(keys)) return null;
    const entries = Object.entries(keys);
    if (!entries.length || entries.length > 100) return null;
    if (entries.some(([id, secret]) => !/^[A-Za-z0-9_-]{1,64}$/.test(id) ||
        typeof secret !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(secret))) return null;
    return keys;
  } catch {
    return null;
  }
}

async function authenticate(request, env, paidAuthorizer) {
  if (paidAuthorizer && !/^Bearer [A-Za-z0-9_-]{1,64}\.[A-Za-z0-9_-]{32,128}$/i.test(request.headers.get('Authorization') || '')) {
    return paidAuthorizer(request, env);
  }
  const keys = configuredKeys(env.BULK_API_KEYS);
  if (!keys) return error(503, 'bulk_not_configured');
  const match = /^Bearer ([A-Za-z0-9_-]{1,64})\.([A-Za-z0-9_-]{32,128})$/i.exec(request.headers.get('Authorization') || '');
  if (!match) return error(401, 'invalid_api_key', { 'WWW-Authenticate': 'Bearer' });
  const known = Object.hasOwn(keys, match[1]);
  // Hashes have equal length; compare every byte without exposing a matching prefix.
  const encode = (s) => new TextEncoder().encode(s);
  const [actual, expected] = await Promise.all([
    crypto.subtle.digest('SHA-256', encode(match[2])),
    crypto.subtle.digest('SHA-256', encode(known ? keys[match[1]] : '0'.repeat(32))),
  ]);
  const a = new Uint8Array(actual);
  const b = new Uint8Array(expected);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  if (!known || difference) return error(401, 'invalid_api_key', { 'WWW-Authenticate': 'Bearer' });
  return { id: match[1], plan: 'operator', maxRows: globalThis.SiteFacts.bulkMaxRows };
}

async function rateLimit(env, id) {
  if (!env.RATE_LIMIT || typeof env.RATE_LIMIT.limit !== 'function') return error(503, 'rate_limit_not_configured');
  try {
    const limited = await env.RATE_LIMIT.limit({ key: `bulk:${id}` });
    if (!limited || typeof limited.success !== 'boolean') return error(503, 'rate_limit_unavailable');
    if (!limited.success) return error(429, 'rate_limited', { 'Retry-After': '60' });
  } catch {
    return error(503, 'rate_limit_unavailable');
  }
  return null;
}

export async function readBulkJson(request, maxBytes) {
  const length = request.headers.get('Content-Length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
    return error(413, 'too_large');
  }
  if (!request.body) return error(400, 'empty_body');
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return error(413, 'too_large');
      }
      chunks.push(value);
    }
  } catch {
    return error(400, 'invalid_body');
  } finally {
    reader.releaseLock();
  }
  if (!size) return error(400, 'empty_body');
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) };
  } catch {
    return error(400, 'invalid_json');
  }
}

export async function authorizeBulkRequest(request, env, paidAuthorizer) {
  const access = await authenticate(request, env, paidAuthorizer);
  if (access instanceof Response) return access;
  const limited = await rateLimit(env, access.id);
  return limited || access;
}

export async function bulkApiResponse(request, env, url, paidAuthorizer) {
  const templatesRoute = url.pathname === '/api/v1/templates';
  const method = templatesRoute ? 'GET' : 'POST';
  if (request.method !== method) return error(405, 'method_not_allowed', { Allow: method });
  const access = await authorizeBulkRequest(request, env, paidAuthorizer);
  if (access instanceof Response) return access;
  if (templatesRoute) {
    return json({
      templates: Object.entries(globalThis.SignatureTemplates.TEMPLATES).map(([id, template]) => ({ id, name: template.name, category: template.category })),
      maxRows: access.maxRows,
      maxInputBytes: globalThis.SiteFacts.bulkMaxInputBytes,
    });
  }
  const format = url.searchParams.get('format') || 'json';
  if (!['json', 'zip'].includes(format)) return error(400, 'invalid_format');
  if ((request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase() !== 'application/json') {
    return error(415, 'json_required');
  }
  if (request.headers.has('Content-Encoding') && request.headers.get('Content-Encoding').toLowerCase() !== 'identity') {
    return error(415, 'unsupported_encoding');
  }
  const input = await readBulkJson(request, globalThis.SiteFacts.bulkMaxInputBytes);
  if (input instanceof Response) return input;
  if (Array.isArray(input.value?.employees) && input.value.employees.length > globalThis.SiteFacts.bulkMaxRows) return error(413, 'too_many_rows');
  if (Array.isArray(input.value?.employees) && input.value.employees.length > access.maxRows) {
    return json({ error: 'team_plan_required', code: 'team_plan_required', maxRows: access.maxRows }, 403);
  }
  let batch;
  try {
    batch = globalThis.SignatureBulk.generateBatch(input.value);
  } catch (err) {
    if ([400, 413, 422].includes(err.status) && /^[a-z][a-z0-9_]{0,63}$/.test(err.code)) return error(err.status, err.code);
    throw err;
  }
  if (format === 'json') return json(batch);
  if (!batch.valid) return json({ error: 'no_valid_rows', code: 'no_valid_rows', ...batch }, 422);
  return new Response(globalThis.SignatureBulk.createZip(batch), {
    headers: {
      ...responseHeaders,
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="email-signatures.zip"',
      'X-Bulk-Valid-Rows': String(batch.valid),
      'X-Bulk-Invalid-Rows': String(batch.invalid),
    },
  });
}
