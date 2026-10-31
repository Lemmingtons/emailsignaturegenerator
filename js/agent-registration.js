import { readBulkJson } from './bulk-api.js';

const WINDOW = 600;
const LIFETIME = 24 * 60 * 60;
const SCOPES = ['templates:read', 'signatures:generate'];
const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store, private', Vary: 'Authorization', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: HEADERS });
const error = (status, code) => json({ error: code, code }, status);
const now = () => Math.floor(Date.now() / 1000);
const hex = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
const random = (length) => hex(crypto.getRandomValues(new Uint8Array(length)));
const hash = async (text) => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))));
const fields = (value, allowed) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every((key) => allowed.includes(key));

// Registration is stateless until a paid buyer approves it. Only grant metadata
// is stored; purchase tokens, claim secrets and employee details are never saved.
export function createAgentRegistration({ signJwt, verifyJwt, bulkAccess, uploadBucket }) {
  async function verified(token, kind, env) {
    if (typeof token !== 'string' || token.length > 4096) return null;
    const result = await verifyJwt(token, `signature-agent-${kind}-v1:${env.PRO_SIGNING_SECRET}`);
    const p = result.payload;
    return result.valid && p?.aud === `signature-agent-${kind}-v1` && /^[a-f0-9]{32}$/.test(p.rid) &&
      Number.isInteger(p.iat) && p.iat <= now() && p.exp - p.iat === WINDOW ? p : null;
  }

  async function limited(request, env) {
    if (typeof env.RATE_LIMIT?.limit !== 'function') return error(503, 'rate_limit_unavailable');
    const ip = request.headers.get('CF-Connecting-IP') || 'local';
    const result = await env.RATE_LIMIT.limit({ key: `agent-registration:${await hash(ip)}` });
    return result?.success === true ? null : error(result?.success === false ? 429 : 503, result?.success === false ? 'rate_limited' : 'rate_limit_unavailable');
  }

  async function handle(request, env) {
    const url = new URL(request.url);
    const action = url.pathname.slice('/api/v1/agent/'.length);
    if (!['register', 'preview', 'approve', 'token'].includes(action)) return error(404, 'not_found');
    if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'method_not_allowed', code: 'method_not_allowed' }), { status: 405, headers: { ...HEADERS, Allow: 'POST' } });
    const origin = request.headers.get('Origin');
    if (origin !== null && origin !== url.origin) return error(403, 'invalid_origin');
    if ((request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase() !== 'application/json' ||
        (request.headers.has('Content-Encoding') && request.headers.get('Content-Encoding').toLowerCase() !== 'identity')) return error(415, 'json_required');
    if (!env.PRO_SIGNING_SECRET || !uploadBucket(env)) return error(503, 'registration_unavailable');
    const limit = await limited(request, env);
    if (limit) return limit;
    const parsed = await readBulkJson(request, 8192);
    if (parsed instanceof Response) return parsed;
    const input = parsed.value;
    if (action === 'register') {
      if (!fields(input, ['agent_name']) || typeof input.agent_name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,79}$/.test(input.agent_name)) return error(400, 'invalid_agent_name');
      const rid = random(16), secret = random(32), issued = now();
      const code = random(4).toUpperCase();
      const common = { rid, iat: issued, exp: issued + WINDOW };
      const requestToken = await signJwt({ ...common, aud: 'signature-agent-request-v1', agent: input.agent_name, codeHash: await hash(code), proofHash: await hash(secret) }, `signature-agent-request-v1:${env.PRO_SIGNING_SECRET}`);
      const claimToken = await signJwt({ ...common, aud: 'signature-agent-claim-v1', proof: secret }, `signature-agent-claim-v1:${env.PRO_SIGNING_SECRET}`);
      return json({ registration_id: rid, claim_token: claimToken, scopes: SCOPES, claim: {
        verification_uri: `${globalThis.SiteFacts.origin}/connect-agent?request=${encodeURIComponent(requestToken)}`,
        user_code: code.slice(0, 4) + '-' + code.slice(4), expires_in: WINDOW, interval: 5,
      } });
    }
    if (action === 'preview' || action === 'approve') {
      if (!fields(input, action === 'preview' ? ['request_token'] : ['request_token', 'user_code'])) return error(400, 'invalid_request');
      const p = await verified(input.request_token, 'request', env);
      if (!p || typeof p.agent !== 'string' || !/^[a-f0-9]{64}$/.test(p.codeHash) || !/^[a-f0-9]{64}$/.test(p.proofHash)) return error(400, 'invalid_or_expired_request');
      if (action === 'preview') return json({ agent_name: p.agent, expires_at: p.exp, scopes: SCOPES, access_expires_in: LIFETIME });
      const code = typeof input.user_code === 'string' ? input.user_code.replace(/[ -]/g, '').toUpperCase() : '';
      if (!/^[A-F0-9]{8}$/.test(code) || await hash(code) !== p.codeHash) return error(400, 'invalid_code');
      const paid = await bulkAccess.purchase(request, env);
      if (paid instanceof Response) return paid;
      // Reuse the buyer's generation-only key domain and revocation nonce. An
      // agent grant cannot become a browser purchase or key-management token.
      const managed = await bulkAccess.manage(new Request(url.origin + '/api/v1/access-key', {
        method: 'POST', headers: { Authorization: request.headers.get('Authorization'), 'Content-Type': 'application/json' }, body: '{"action":"create"}',
      }), env);
      if (!managed.ok) return managed;
      const key = (await managed.json()).key;
      const checked = await verifyJwt(key.slice('esg_bulk_'.length), `signature-bulk-api-v1:${env.PRO_SIGNING_SECRET}`);
      if (!checked.valid) return error(503, 'registration_unavailable');
      const issuedAt = now();
      const grant = { version: 1, status: 'approved', entitlementId: paid.verified.payload.sub, nonce: checked.payload.bkv, proofHash: p.proofHash, issuedAt, expiresAt: issuedAt + LIFETIME };
      const written = await uploadBucket(env).put(`bulk-api/registrations/${p.rid}.json`, JSON.stringify(grant), {
        httpMetadata: { contentType: 'application/json', cacheControl: 'no-store' }, onlyIf: { etagDoesNotMatch: '*' },
      });
      return written === null ? error(409, 'already_approved') : json({ approved: true, scopes: SCOPES, expires_in: LIFETIME, maxRows: paid.maxRows });
    }
    if (!fields(input, ['claim_token'])) return error(400, 'invalid_request');
    const p = await verified(input.claim_token, 'claim', env);
    if (!p || !/^[a-f0-9]{64}$/.test(p.proof)) return error(400, 'invalid_or_expired_claim');
    const bucket = uploadBucket(env);
    const path = `bulk-api/registrations/${p.rid}.json`;
    const object = await bucket.get(path);
    if (!object) return json({ status: 'authorization_pending' }, 202);
    const grant = JSON.parse(await object.text());
    if (grant.proofHash !== await hash(p.proof)) return error(400, 'invalid_or_expired_claim');
    if (grant.status !== 'approved') return error(409, 'already_exchanged');
    if (!Number.isInteger(grant.expiresAt) || grant.expiresAt <= now()) return error(400, 'invalid_or_expired_claim');
    const key = 'esg_bulk_' + await signJwt({ aud: 'signature-bulk-api-v1', sub: grant.entitlementId, ent: 1, bkv: grant.nonce, iat: grant.issuedAt, exp: grant.expiresAt }, `signature-bulk-api-v1:${env.PRO_SIGNING_SECRET}`);
    const access = await bulkAccess.authorize(new Request(url.origin + '/api/v1/templates', { headers: { Authorization: 'Bearer ' + key } }), env);
    if (access instanceof Response) return access;
    const written = await bucket.put(path, JSON.stringify({ ...grant, status: 'exchanged' }), {
      httpMetadata: { contentType: 'application/json', cacheControl: 'no-store' }, onlyIf: { etagMatches: object.etag },
    });
    if (written === null) return error(409, 'already_exchanged');
    return json({ access_token: key, token_type: 'Bearer', expires_in: grant.expiresAt - now(), scope: SCOPES.join(' '), maxRows: access.maxRows });
  }

  return async (request, env) => {
    try { return await handle(request, env); }
    catch { return error(503, 'registration_unavailable'); }
  };
}
