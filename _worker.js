// Cloudflare Worker for Email Signature Generator
// Handles: clean URL rewriting, security headers, and Pro payment verification

const GOOGLE_SITE_VERIFICATION_FILE = '/googlee8f6af86faea90b4.html';
const GOOGLE_SITE_VERIFICATION_BODY = 'google-site-verification: googlee8f6af86faea90b4.html';

// ── JWT Helpers (Web Crypto API) ─────────────────────────────────────────────

function base64url(source) {
  // Convert ArrayBuffer to base64url string
  const bytes = new Uint8Array(source);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(str) {
  // Convert base64url string back to Uint8Array
  // Returns null on any error (invalid chars, bad padding, etc.)
  try {
    const padding = '='.repeat((4 - (str.length % 4)) % 4);
    const base64 = str.replace(/-/g, '+').replace(/_/g, '/') + padding;
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

function textToUint8Array(text) {
  return new TextEncoder().encode(text);
}

async function importKey(secret) {
  // Import raw key for HMAC-SHA256
  return crypto.subtle.importKey(
    'raw',
    textToUint8Array(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

async function signJwt(payload, secret) {
  // Create a signed JWT (header.payload.signature)
  const header = { alg: 'HS256', typ: 'JWT' };
  const headerB64 = base64url(textToUint8Array(JSON.stringify(header)).buffer);
  const payloadB64 = base64url(textToUint8Array(JSON.stringify(payload)).buffer);
  const signingInput = headerB64 + '.' + payloadB64;

  const key = await importKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, textToUint8Array(signingInput));

  return signingInput + '.' + base64url(signature);
}

async function verifyJwt(token, secret) {
  // Verify a JWT's signature and expiry
  const parts = token.split('.');
  if (parts.length !== 3) return { valid: false, reason: 'malformed' };

  const [headerB64, payloadB64, signatureB64] = parts;
  const signingInput = headerB64 + '.' + payloadB64;

  // Decode signature safely
  const signature = base64urlDecode(signatureB64);
  if (!signature) return { valid: false, reason: 'invalid_signature' };

  const key = await importKey(secret);

  let validSig;
  try {
    validSig = await crypto.subtle.verify('HMAC', key, signature, textToUint8Array(signingInput));
  } catch {
    return { valid: false, reason: 'invalid_signature' };
  }

  if (!validSig) return { valid: false, reason: 'invalid_signature' };

  // Check expiry
  const payloadBytes = base64urlDecode(payloadB64);
  if (!payloadBytes) return { valid: false, reason: 'malformed_payload' };

  try {
    const payloadJson = new TextDecoder().decode(payloadBytes);
    const payload = JSON.parse(payloadJson);
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return { valid: false, reason: 'expired' };
    }
    return { valid: true, payload };
  } catch {
    return { valid: false, reason: 'malformed_payload' };
  }
}

// ── Image helpers ────────────────────────────────────────────────────────────

function sniffImage(buf) {
  // Detect JPG / PNG / WebP / GIF from the first 12 bytes. Returns null if no match.
  const b = new Uint8Array(buf);
  if (b.length < 12) return null;
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return { ext: 'jpg', mime: 'image/jpeg' };
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47 &&
      b[4] === 0x0D && b[5] === 0x0A && b[6] === 0x1A && b[7] === 0x0A) return { ext: 'png', mime: 'image/png' };
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return { ext: 'webp', mime: 'image/webp' };
  // GIF87a / GIF89a
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 &&
      (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61) return { ext: 'gif', mime: 'image/gif' };
  return null;
}

// Image slots a Pro user may occupy. One stored file per slot per user.
const IMAGE_SLOTS = ['photo', 'logo', 'cta', 'divider'];
const IMAGE_EXTS = ['jpg', 'png', 'webp', 'gif'];

function apiError(status, code, detail) {
  const body = detail ? { error: code, code, detail } : { error: code, code };
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function uploadBucket(env) {
  return env.UPLOADS || env.PHOTOS;
}

async function publicUploadId(sub, secret) {
  const key = await importKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, textToUint8Array(`upload-public-url:${sub}`));
  return base64url(signature).slice(0, 32);
}

// ── Stripe API Helper ────────────────────────────────────────────────────────

async function verifyStripeSession(sessionId, stripeSecretKey) {
  const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
    headers: {
      'Authorization': `Bearer ${stripeSecretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });

  if (!response.ok) {
    return { paid: false, error: `Stripe API error: ${response.status}` };
  }

  const session = await response.json();
  return { paid: session.payment_status === 'paid', customer: session.customer };
}

// ── Security Headers ─────────────────────────────────────────────────────────

function addSecurityHeaders(response) {
  const newHeaders = new Headers(response.headers);
  newHeaders.set('X-Frame-Options', 'DENY');
  newHeaders.set('X-Content-Type-Options', 'nosniff');
  newHeaders.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  newHeaders.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  newHeaders.set(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://js.stripe.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; frame-src https://js.stripe.com; img-src 'self' data: blob: https:; connect-src 'self' https://api.stripe.com"
  );
  return newHeaders;
}

function notFoundResponse() {
  return new Response('Not found', { status: 404 });
}

function isPrivateAssetPath(pathname) {
  return (
    pathname === '/package.json' ||
    pathname === '/NEXT_STEPS.md' ||
    pathname === '/generate-pages.js' ||
    pathname === '/update-sitemap.js' ||
    pathname === '/wrangler.toml' ||
    pathname === '/test.html' ||
    pathname === '/_worker.js' ||
    pathname.startsWith('/automation/') ||
    pathname.startsWith('/graphify-out/') ||
    pathname.startsWith('/scripts/') ||
    pathname.startsWith('/templates/') ||
    pathname.startsWith('/.git/') ||
    pathname.startsWith('/.wrangler/') ||
    pathname.startsWith('/.claude/')
  );
}

async function fetchStaticAsset(env, request) {
  if (!env.ASSETS || typeof env.ASSETS.fetch !== 'function') {
    return notFoundResponse();
  }

  try {
    const response = await env.ASSETS.fetch(request);
    if (response.status === 500) return notFoundResponse();
    return response;
  } catch {
    return notFoundResponse();
  }
}

// ── Main Worker ──────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === GOOGLE_SITE_VERIFICATION_FILE) {
      return new Response(`${GOOGLE_SITE_VERIFICATION_BODY}\n`, {
        headers: { 'Content-Type': 'text/html; charset=UTF-8' },
      });
    }

    // ── API: Verify Payment (Stripe redirect landing) ────────────────────────
    if (url.pathname === '/api/verify-payment') {
      const sessionId = url.searchParams.get('session_id');

      if (!sessionId) {
        return new Response('Missing session_id', { status: 400 });
      }

      if (!env.STRIPE_SECRET_KEY) {
        return new Response('Server misconfiguration: Stripe secret not set', { status: 500 });
      }

      // Verify the payment with Stripe
      const stripeResult = await verifyStripeSession(sessionId, env.STRIPE_SECRET_KEY);

      if (!stripeResult.paid) {
        return new Response(`Payment verification failed: ${stripeResult.error || 'not paid'}`, { status: 402 });
      }

      if (!env.PRO_SIGNING_SECRET) {
        return new Response('Server misconfiguration: signing secret not set', { status: 500 });
      }

      // Create a signed JWT (expires in 1 year)
      const now = Math.floor(Date.now() / 1000);
      const oneYear = 365 * 24 * 60 * 60;
      const token = await signJwt(
        { sub: stripeResult.customer, iat: now, exp: now + oneYear },
        env.PRO_SIGNING_SECRET
      );

      // Redirect to generator with the token
      const redirectUrl = new URL('/generator.html', url.origin);
      redirectUrl.searchParams.set('token', token);
      return Response.redirect(redirectUrl.toString(), 302);
    }

    // ── API: Verify Token (client-side Pro check) ────────────────────────────
    if (url.pathname === '/api/verify-token' && request.method === 'POST') {
      try {
        if (!env.PRO_SIGNING_SECRET) {
          return new Response(JSON.stringify({ valid: false, reason: 'server_misconfiguration' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        const body = await request.json();
        const token = body.token;

        if (!token) {
          return new Response(JSON.stringify({ valid: false, reason: 'missing_token' }), {
            headers: { 'Content-Type': 'application/json' },
          });
        }

        const result = await verifyJwt(token, env.PRO_SIGNING_SECRET);
        return new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ valid: false, reason: 'server_error', detail: String(err) }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // ── API: Upload Image (Pro only) ─────────────────────────────────────────
    if (url.pathname === '/api/upload-image') {
      if (request.method !== 'POST') return apiError(405, 'method_not_allowed');
      if (!env.PRO_SIGNING_SECRET) return apiError(500, 'server_misconfiguration');
      const bucket = uploadBucket(env);
      if (!bucket) return apiError(500, 'storage_not_configured');

      // Auth
      const authHeader = request.headers.get('Authorization') || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
      if (!token) return apiError(401, 'invalid_token', 'missing');
      const verified = await verifyJwt(token, env.PRO_SIGNING_SECRET);
      if (!verified.valid) return apiError(401, 'invalid_token', verified.reason);
      const sub = verified.payload && verified.payload.sub;
      if (!sub || !/^cus_[A-Za-z0-9]+$/.test(sub)) return apiError(401, 'invalid_token', 'bad_subject');

      // Slot type — each slot stores at most one file per user
      const imageType = request.headers.get('X-Image-Type') || '';
      if (!IMAGE_SLOTS.includes(imageType)) return apiError(400, 'invalid_type');

      // Size pre-check via Content-Length. Animated GIFs run larger than stills.
      const MAX_BYTES = 3_000_000;
      const declaredLen = parseInt(request.headers.get('Content-Length') || '', 10);
      if (declaredLen > MAX_BYTES) return apiError(413, 'too_large');

      // Rate limit: 25 uploads / hour / customer (KV read-modify-write; non-atomic, acceptable).
      // Raised from 10 — photo, logo and animated-GIF retries now share one budget.
      if (env.RATE_LIMIT) {
        const hourBucket = Math.floor(Date.now() / 3_600_000);
        const rlKey = `rl:upload:${sub}:${hourBucket}`;
        const current = parseInt((await env.RATE_LIMIT.get(rlKey)) || '0', 10);
        if (current >= 25) return apiError(429, 'rate_limited');
        await env.RATE_LIMIT.put(rlKey, String(current + 1), { expirationTtl: 7200 });
      }

      // Read body and re-check actual size
      const buf = await request.arrayBuffer();
      if (buf.byteLength === 0) return apiError(400, 'empty_body');
      if (buf.byteLength > MAX_BYTES) return apiError(413, 'too_large');

      // Magic-byte sniff (authoritative — ignore client-declared MIME)
      const sniffed = sniffImage(buf);
      if (!sniffed) return apiError(415, 'unsupported_format');

      const uploadId = await publicUploadId(sub, env.PRO_SIGNING_SECRET);

      // Best-effort delete other-extension siblings so each slot holds at most one file
      await Promise.all(
        IMAGE_EXTS
          .filter((e) => e !== sniffed.ext)
          .map((e) => bucket.delete(`users/${uploadId}/${imageType}.${e}`).catch(() => {}))
      );

      // Store
      const key = `users/${uploadId}/${imageType}.${sniffed.ext}`;
      await bucket.put(key, buf, {
        httpMetadata: {
          contentType: sniffed.mime,
          cacheControl: 'public, max-age=31536000, immutable',
        },
        customMetadata: { uploadedAt: String(Date.now()) },
      });

      const publicUrl = `${url.origin}/u/${uploadId}/${imageType}.${sniffed.ext}?v=${Date.now()}`;
      return new Response(
        JSON.stringify({ url: publicUrl, bytes: buf.byteLength, contentType: sniffed.mime }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }

    // ── Public: Serve uploaded image ─────────────────────────────────────────
    if (url.pathname.startsWith('/u/')) {
      const bucket = uploadBucket(env);
      if (!bucket) return new Response('Storage not configured', { status: 500 });
      // Legacy /u/cus_.../photo.jpg URLs stay readable; `logo` and `gif` are new.
      const match = url.pathname.match(/^\/u\/([A-Za-z0-9_-]{16,64}|cus_[A-Za-z0-9]+)\/(photo|logo|cta|divider)\.(jpg|png|webp|gif)$/);
      if (!match) return new Response('Not found', { status: 404 });
      const key = `users/${match[1]}/${match[2]}.${match[3]}`;
      const obj = await bucket.get(key);
      if (!obj) return new Response('Not found', { status: 404 });

      const headers = new Headers();
      headers.set('Content-Type', (obj.httpMetadata && obj.httpMetadata.contentType) || 'application/octet-stream');
      headers.set('Cache-Control', 'public, max-age=31536000, immutable');
      headers.set('Access-Control-Allow-Origin', '*');
      headers.set('X-Content-Type-Options', 'nosniff');
      return new Response(obj.body, { headers });
    }

    // ── API: Save a signature for later editing (Pro only) ──────────────────
    // The returned id is a 256-bit random capability. Anyone holding the link can
    // read the saved signature, which contains the name, email and phone the user
    // entered, so the id must stay unguessable and must never be derived from the
    // customer id.
    if (url.pathname === '/api/signature') {
      if (request.method !== 'POST') return apiError(405, 'method_not_allowed');
      if (!env.PRO_SIGNING_SECRET) return apiError(500, 'server_misconfiguration');
      const bucket = uploadBucket(env);
      if (!bucket) return apiError(500, 'storage_not_configured');

      const authHeader = request.headers.get('Authorization') || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
      if (!token) return apiError(401, 'invalid_token', 'missing');
      const verified = await verifyJwt(token, env.PRO_SIGNING_SECRET);
      if (!verified.valid) return apiError(401, 'invalid_token', verified.reason);

      const MAX_SIGNATURE_BYTES = 32_000;
      const declaredLen = parseInt(request.headers.get('Content-Length') || '', 10);
      if (declaredLen > MAX_SIGNATURE_BYTES) return apiError(413, 'too_large');

      const raw = await request.text();
      if (!raw) return apiError(400, 'empty_body');
      if (raw.length > MAX_SIGNATURE_BYTES) return apiError(413, 'too_large');

      // Store only what we can parse, so a malformed body never lands in the bucket.
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return apiError(400, 'invalid_json');
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return apiError(400, 'invalid_json');
      }

      const idBytes = new Uint8Array(32);
      crypto.getRandomValues(idBytes);
      const signatureId = base64url(idBytes.buffer);

      await bucket.put(`signatures/${signatureId}.json`, JSON.stringify(parsed), {
        httpMetadata: { contentType: 'application/json', cacheControl: 'no-store' },
        customMetadata: { savedAt: String(Date.now()) },
      });

      return new Response(
        JSON.stringify({ id: signatureId, url: `${url.origin}/generator?s=${signatureId}` }),
        { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
      );
    }

    if (url.pathname.startsWith('/api/signature/')) {
      if (request.method !== 'GET') return apiError(405, 'method_not_allowed');
      const bucket = uploadBucket(env);
      if (!bucket) return apiError(500, 'storage_not_configured');

      const match = url.pathname.match(/^\/api\/signature\/([A-Za-z0-9_-]{40,64})$/);
      if (!match) return apiError(404, 'not_found');

      const obj = await bucket.get(`signatures/${match[1]}.json`);
      if (!obj) return apiError(404, 'not_found');

      return new Response(obj.body, {
        headers: {
          'Content-Type': 'application/json',
          // Saved signatures hold personal details; keep them out of shared caches.
          'Cache-Control': 'no-store, private',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }

    if (request.method === 'POST' && url.pathname === '/api/upload') {
      return apiError(410, 'legacy_upload_removed', 'Use /api/upload-image with a Pro token.');
    }

    if (request.method === 'GET' && url.pathname.startsWith('/photos/')) {
      return handleLegacyPhoto(env, url);
    }

    // ── Static Asset Serving ─────────────────────────────────────────────────
    if (isPrivateAssetPath(url.pathname)) return notFoundResponse();

    let response = await fetchStaticAsset(env, request);

    // If 404 and path has no file extension, try appending .html for clean URLs
    if (response.status === 404 && !url.pathname.match(/\.[a-zA-Z0-9]+$/)) {
      const htmlUrl = new URL(request.url);
      htmlUrl.pathname = url.pathname.replace(/\/$/, '') + '.html';
      const htmlRequest = new Request(htmlUrl.toString(), request);
      const htmlResponse = await fetchStaticAsset(env, htmlRequest);
      if (htmlResponse.status === 200) {
        response = htmlResponse;
      }
    }

    // Add security headers to all responses
    const newHeaders = addSecurityHeaders(response);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  },
};

async function handleLegacyPhoto(env, url) {
  const bucket = uploadBucket(env);
  if (!bucket) return new Response('Storage not configured', { status: 500 });

  const key = url.pathname.slice('/photos/'.length);
  if (!key) return new Response('Not Found', { status: 404 });

  const object = await bucket.get(key);
  if (!object) return new Response('Not Found', { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('ETag', object.httpEtag);

  return new Response(object.body, { headers });
}
