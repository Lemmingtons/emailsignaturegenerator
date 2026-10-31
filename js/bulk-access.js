import './site-facts.js';

const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store, private', Vary: 'Authorization', 'X-Content-Type-Options': 'nosniff' };
const PREFIX = 'esg_bulk_';
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { ...HEADERS, ...headers } });
const failure = (status, code) => json({ error: code, code }, status, status === 401 ? { 'WWW-Authenticate': 'Bearer' } : {});
const bearer = (request) => /^Bearer (\S{1,4096})$/i.exec(request.headers.get('Authorization') || '')?.[1] || '';
const encode = (value) => new TextEncoder().encode(value);

export function createBulkAccess({ verifyProAccess, verifyJwt, signJwt, readJsonObject, isEntitlementRevoked, uploadBucket }) {
  async function identity(subject, secret) {
    const key = await crypto.subtle.importKey('raw', encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, encode(`bulk-api-owner:${subject}`)));
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function owner(verified) {
    return verified.valid && verified.record && verified.payload.ent === 1 && !verified.payload.tm &&
      ['pro', 'team'].includes(verified.record.plan);
  }

  function accessInfo(verified, id) {
    return { id, plan: verified.record.plan, maxRows: verified.record.plan === 'team' ? globalThis.SiteFacts.bulkMaxRows : globalThis.SiteFacts.bulkIndividualMaxRows };
  }

  async function purchase(request, env) {
    const token = bearer(request);
    if (!token || token.startsWith(PREFIX)) return failure(401, 'invalid_token');
    const verified = await verifyProAccess(token, env);
    if (!verified.valid) return failure(verified.status || 401, 'invalid_token');
    if (!owner(verified)) return failure(403, 'purchase_owner_required');
    const id = await identity(verified.payload.sub, env.PRO_SIGNING_SECRET);
    return { verified, ...accessInfo(verified, id) };
  }

  async function authorize(request, env) {
    const token = bearer(request);
    if (!token.startsWith(PREFIX)) {
      const paid = await purchase(request, env);
      return paid instanceof Response ? paid : { id: paid.id, plan: paid.plan, maxRows: paid.maxRows };
    }
    if (!env.PRO_SIGNING_SECRET || !uploadBucket(env)) return failure(503, 'bulk_unavailable');
    // A separate signing domain prevents an agent's key being accepted by Pro
    // upload, saved-signature or team-management endpoints.
    const checked = await verifyJwt(token.slice(PREFIX.length), `signature-bulk-api-v1:${env.PRO_SIGNING_SECRET}`);
    const payload = checked.payload;
    if (!checked.valid || !payload || payload.aud !== 'signature-bulk-api-v1' || payload.ent !== 1 ||
        typeof payload.sub !== 'string' || !/^ent_[A-Za-z0-9_-]{40,64}$/.test(payload.sub) ||
        typeof payload.bkv !== 'string' || !/^[a-f0-9]{48}$/.test(payload.bkv)) return failure(401, 'invalid_api_key');
    const bucket = uploadBucket(env);
    if (await isEntitlementRevoked(bucket, payload.sub)) return failure(401, 'invalid_api_key');
    const record = await readJsonObject(bucket, `entitlements/active/${payload.sub}.json`);
    if (!record || record.status !== 'active' || record.entitlementId !== payload.sub || !['pro', 'team'].includes(record.plan)) return failure(401, 'invalid_api_key');
    const id = await identity(payload.sub, env.PRO_SIGNING_SECRET);
    const state = await readJsonObject(bucket, `bulk-api/access/${id}.json`);
    if (!state || state.active !== true || state.nonce !== payload.bkv) return failure(401, 'invalid_api_key');
    return accessInfo({ record }, id);
  }

  async function manage(request, env) {
    if (!['GET', 'POST'].includes(request.method)) return json({ error: 'method_not_allowed', code: 'method_not_allowed' }, 405, { Allow: 'GET, POST' });
    const origin = request.headers.get('Origin');
    if (origin && origin !== new URL(request.url).origin) return failure(403, 'invalid_origin');
    const paid = await purchase(request, env);
    if (paid instanceof Response) return paid;
    if (!env.RATE_LIMIT || typeof env.RATE_LIMIT.limit !== 'function') return failure(503, 'rate_limit_unavailable');
    let limited;
    try { limited = await env.RATE_LIMIT.limit({ key: `bulk-key:${paid.id}` }); } catch { return failure(503, 'rate_limit_unavailable'); }
    if (!limited || typeof limited.success !== 'boolean') return failure(503, 'rate_limit_unavailable');
    if (!limited.success) return json({ error: 'rate_limited', code: 'rate_limited' }, 429, { 'Retry-After': '60' });
    const bucket = uploadBucket(env);
    const path = `bulk-api/access/${paid.id}.json`;
    if (request.method === 'GET') {
      const state = await readJsonObject(bucket, path);
      return json({ active: true, plan: paid.plan, maxRows: paid.maxRows, hasKey: state?.active === true });
    }
    if ((request.headers.get('Content-Type') || '').split(';')[0] !== 'application/json') return failure(415, 'json_required');
    const reader = request.body?.getReader();
    if (!reader) return failure(400, 'invalid_action');
    let bytes = 0, body = '';
    const decoder = new TextDecoder('utf-8', { fatal: true });
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 512) { await reader.cancel(); return failure(413, 'too_large'); }
        body += decoder.decode(value, { stream: true });
      }
      body += decoder.decode();
    } catch { return failure(400, 'invalid_json'); }
    finally { reader.releaseLock(); }
    let action;
    try {
      const input = JSON.parse(body);
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((key) => key !== 'action')) return failure(400, 'invalid_action');
      action = input.action;
    } catch { return failure(400, 'invalid_json'); }
    if (!['create', 'rotate', 'revoke'].includes(action)) return failure(400, 'invalid_action');
    for (let attempt = 0; attempt < 3; attempt++) {
      const object = await bucket.get(path);
      let state = null;
      try { if (object) state = JSON.parse(await object.text()); } catch { /* replace invalid state using the current ETag */ }
      if (action !== 'create' || !state?.active || !/^[a-f0-9]{48}$/.test(state.nonce || '')) {
        state = {
          version: 1, active: action !== 'revoke',
          nonce: Array.from(crypto.getRandomValues(new Uint8Array(24)), (byte) => byte.toString(16).padStart(2, '0')).join(''),
          issuedAt: Math.floor(Date.now() / 1000),
        };
        const written = await bucket.put(path, JSON.stringify(state), {
          httpMetadata: { contentType: 'application/json', cacheControl: 'no-store' },
          onlyIf: object ? { etagMatches: object.etag } : { etagDoesNotMatch: '*' },
        });
        if (written === null) continue;
      }
      if (!state.active) return json({ revoked: true, plan: paid.plan, maxRows: paid.maxRows });
      const token = await signJwt({
        aud: 'signature-bulk-api-v1', sub: paid.verified.payload.sub, ent: 1,
        bkv: state.nonce, iat: state.issuedAt, exp: state.issuedAt + 100 * 365 * 24 * 60 * 60,
      }, `signature-bulk-api-v1:${env.PRO_SIGNING_SECRET}`);
      return json({ key: PREFIX + token, plan: paid.plan, maxRows: paid.maxRows });
    }
    return failure(409, 'key_busy');
  }
  return { authorize, manage, purchase };
}
