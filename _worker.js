// Cloudflare Worker for Email Signature Generator
// Handles: clean URL rewriting, security headers, Pro payment verification, and
// on-demand social icon rendering.

import PngEncoder from './js/png-encoder.js';
import { ICON_MASK_SIZE, decodeMask } from './js/icon-masks.js';

const GOOGLE_SITE_VERIFICATION_FILE = '/googlee8f6af86faea90b4.html';
const GOOGLE_SITE_VERIFICATION_BODY = 'google-site-verification: googlee8f6af86faea90b4.html';
const SEO_REPLACEMENT_REDIRECTS = Object.freeze({
  '/seo/email-signature-generator-for-google-workspace': '/seo/email-signature-generator-for-gmail',
  '/seo/email-signature-generator-for-google-workspace.html': '/seo/email-signature-generator-for-gmail',
  '/seo/email-signature-generator-for-microsoft-365': '/seo/email-signature-generator-for-outlook',
  '/seo/email-signature-generator-for-microsoft-365.html': '/seo/email-signature-generator-for-outlook',
});
const REMOVED_SEO_PATH = /^\/seo\/(?:email-signature-for-[a-z0-9-]+|email-signature-generator-for-yahoo-mail)(?:\.html)?$/;

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

function hexDecode(value) {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) return null;
  const bytes = new Uint8Array(value.length / 2);
  for (let i = 0; i < value.length; i += 2) {
    bytes[i / 2] = parseInt(value.slice(i, i + 2), 16);
  }
  return bytes;
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
    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
      return { valid: false, reason: 'invalid_expiry' };
    }
    if (payload.exp <= Math.floor(Date.now() / 1000)) {
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

// Social icons rendered by /i/{platform}-{hex}.png. Masks live in
// assets/icon-masks/ as raw 8-bit alpha, ICON_SIZE square (2x the 22px display
// size, for retina). Keep this list in step with TEMPLATES._iconUrl.
const ICON_PLATFORMS = ['website', 'linkedin', 'instagram', 'facebook', 'google'];
const ICON_SIZE = ICON_MASK_SIZE;

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

function stripeId(value, prefix) {
  const id = typeof value === 'string' ? value : value && value.id;
  return typeof id === 'string' && id.startsWith(`${prefix}_`) ? id : '';
}

async function entitlementId(paymentIntentId, secret) {
  const key = await importKey(secret);
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    textToUint8Array(`stripe-entitlement:${paymentIntentId}`)
  );
  return `ent_${base64url(signature)}`;
}

async function checkoutSessionStorageId(sessionId, secret) {
  const key = await importKey(secret);
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    textToUint8Array(`stripe-checkout-session:${sessionId}`)
  );
  return base64url(signature);
}

function entitlementKey(id) {
  return `entitlements/active/${id}.json`;
}

function checkoutSessionKey(id) {
  return `entitlements/checkout-sessions/${id}.json`;
}

function revocationKey(id, reason) {
  return `entitlements/revoked/${id}/${reason}.json`;
}

async function readJsonObject(bucket, key) {
  const object = await bucket.get(key);
  if (!object) return null;
  try {
    return JSON.parse(await object.text());
  } catch {
    return null;
  }
}

async function isEntitlementRevoked(bucket, id) {
  const [refund, dispute] = await Promise.all([
    bucket.get(revocationKey(id, 'refund')),
    bucket.get(revocationKey(id, 'dispute')),
  ]);
  return Boolean(refund || dispute);
}

async function storeActiveEntitlement(env, stripeResult, source) {
  const bucket = uploadBucket(env);
  if (!bucket) return { active: false, reason: 'storage_not_configured' };

  const id = await entitlementId(stripeResult.paymentIntent, env.PRO_SIGNING_SECRET);
  const sessionStorageId = await checkoutSessionStorageId(stripeResult.sessionId, env.PRO_SIGNING_SECRET);
  const revoked = await isEntitlementRevoked(bucket, id);
  await bucket.put(checkoutSessionKey(sessionStorageId), JSON.stringify({
    version: 1,
    entitlementId: id,
    checkoutSession: stripeResult.sessionId,
    paymentIntent: stripeResult.paymentIntent,
    paymentLink: stripeResult.paymentLink,
    status: revoked ? 'revoked' : 'active',
    recordedAt: Date.now(),
  }), {
    httpMetadata: { contentType: 'application/json', cacheControl: 'no-store' },
  });
  if (revoked) {
    return { active: false, reason: 'entitlement_revoked', id };
  }

  const previous = await readJsonObject(bucket, entitlementKey(id));
  const now = Date.now();
  const record = {
    version: 1,
    entitlementId: id,
    status: 'active',
    paymentIntent: stripeResult.paymentIntent,
    paymentLink: stripeResult.paymentLink,
    checkoutSession: stripeResult.sessionId,
    createdAt: previous && previous.createdAt ? previous.createdAt : now,
    verifiedAt: now,
    source,
  };
  await bucket.put(entitlementKey(id), JSON.stringify(record), {
    httpMetadata: { contentType: 'application/json', cacheControl: 'no-store' },
  });
  return { active: true, id };
}

async function revokeEntitlement(env, paymentIntentId, reason, event) {
  const bucket = uploadBucket(env);
  if (!bucket || !env.PRO_SIGNING_SECRET) return false;
  const id = await entitlementId(paymentIntentId, env.PRO_SIGNING_SECRET);
  const tombstone = {
    version: 1,
    entitlementId: id,
    status: 'revoked',
    reason,
    eventId: event.id,
    eventCreated: event.created,
    revokedAt: Date.now(),
  };
  // The separate tombstone means a late checkout retry cannot overwrite a
  // refund or dispute by re-saving the active purchase record.
  await bucket.put(revocationKey(id, reason), JSON.stringify(tombstone), {
    httpMetadata: { contentType: 'application/json', cacheControl: 'no-store' },
  });
  return true;
}

async function restoreDisputedEntitlement(env, paymentIntentId) {
  const bucket = uploadBucket(env);
  if (!bucket || !env.PRO_SIGNING_SECRET) return false;
  const id = await entitlementId(paymentIntentId, env.PRO_SIGNING_SECRET);
  await bucket.delete(revocationKey(id, 'dispute'));
  return true;
}

function stripeResultFromSession(session, env) {
  const sessionId = stripeId(session, 'cs');
  if (!/^cs_(?:(?:test|live)_)?[A-Za-z0-9]+$/.test(sessionId)) {
    return { paid: false, reason: 'invalid_session' };
  }
  if (
    !/^plink_[A-Za-z0-9]+$/.test(env.STRIPE_PAYMENT_LINK_ID || '') ||
    !['true', 'false'].includes(env.STRIPE_LIVEMODE)
  ) {
    return { paid: false, reason: 'server_misconfiguration' };
  }
  const paymentLink = stripeId(session.payment_link, 'plink');
  const paymentIntent = stripeId(session.payment_intent, 'pi');
  if (
    session.mode !== 'payment' ||
    session.status !== 'complete' ||
    session.payment_status !== 'paid' ||
    session.livemode !== (env.STRIPE_LIVEMODE === 'true') ||
    paymentLink !== env.STRIPE_PAYMENT_LINK_ID ||
    !paymentIntent
  ) {
    return { paid: false, reason: 'payment_not_eligible' };
  }
  return { paid: true, sessionId, paymentIntent, paymentLink };
}

async function redeemCheckoutSession(sessionId, env) {
  if (!/^cs_(?:(?:test|live)_)?[A-Za-z0-9]+$/.test(sessionId || '')) {
    return { active: false, reason: 'invalid_session' };
  }
  const bucket = uploadBucket(env);
  if (!bucket || !env.PRO_SIGNING_SECRET) {
    return { active: false, reason: 'server_misconfiguration' };
  }
  const storageId = await checkoutSessionStorageId(sessionId, env.PRO_SIGNING_SECRET);
  const redemption = await readJsonObject(bucket, checkoutSessionKey(storageId));
  if (!redemption) return { active: false, reason: 'confirmation_pending' };
  if (
    redemption.checkoutSession !== sessionId ||
    redemption.paymentLink !== env.STRIPE_PAYMENT_LINK_ID ||
    !/^ent_[A-Za-z0-9_-]{40,64}$/.test(redemption.entitlementId || '')
  ) {
    return { active: false, reason: 'payment_not_eligible' };
  }
  if (await isEntitlementRevoked(bucket, redemption.entitlementId)) {
    return { active: false, reason: 'entitlement_revoked' };
  }
  const entitlement = await readJsonObject(bucket, entitlementKey(redemption.entitlementId));
  if (!entitlement || entitlement.status !== 'active') {
    return { active: false, reason: 'confirmation_pending' };
  }
  return { active: true, id: redemption.entitlementId };
}

function paymentConfirmationPendingResponse(url) {
  const retryUrl = `${url.pathname}${url.search}`.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="2;url=${retryUrl}"><title>Confirming payment</title></head><body><main><h1>Confirming your payment…</h1><p>Stripe is still confirming your purchase. This page will retry automatically.</p></main></body></html>`;
  return new Response(html, {
    status: 202,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Retry-After': '2',
    },
  });
}

async function verifyStripeWebhookSignature(payload, signatureHeader, secret) {
  if (!signatureHeader || !secret) return false;
  const fields = signatureHeader.split(',').map((field) => field.trim());
  const timestampField = fields.find((field) => field.startsWith('t='));
  const signatures = fields
    .filter((field) => field.startsWith('v1='))
    .map((field) => hexDecode(field.slice(3)))
    .filter(Boolean);
  if (!timestampField || signatures.length === 0) return false;

  const timestamp = Number(timestampField.slice(2));
  if (!Number.isInteger(timestamp)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > 300) return false;

  const key = await importKey(secret);
  const signedPayload = textToUint8Array(`${timestamp}.${payload}`);
  for (const signature of signatures) {
    if (await crypto.subtle.verify('HMAC', key, signature, signedPayload)) return true;
  }
  return false;
}

function validProSubject(subject) {
  return /^ent_[A-Za-z0-9_-]{40,64}$/.test(subject) || /^cus_[A-Za-z0-9]+$/.test(subject);
}

async function verifyProAccess(token, env) {
  if (!env.PRO_SIGNING_SECRET) return { valid: false, reason: 'server_misconfiguration', status: 500 };
  const verified = await verifyJwt(token, env.PRO_SIGNING_SECRET);
  if (!verified.valid) return verified;

  const payload = verified.payload || {};
  if (!validProSubject(payload.sub || '')) return { valid: false, reason: 'bad_subject' };

  // Preserve already-issued customer tokens until they expire. Every new
  // purchase uses the opaque, revocable entitlement path below.
  if (payload.ent !== 1) return { valid: true, payload, legacy: true };
  if (!payload.sub.startsWith('ent_')) return { valid: false, reason: 'bad_subject' };

  const bucket = uploadBucket(env);
  if (!bucket) return { valid: false, reason: 'storage_not_configured', status: 500 };
  if (await isEntitlementRevoked(bucket, payload.sub)) {
    return { valid: false, reason: 'entitlement_revoked' };
  }
  const record = await readJsonObject(bucket, entitlementKey(payload.sub));
  if (!record || record.status !== 'active' || record.entitlementId !== payload.sub) {
    return { valid: false, reason: 'entitlement_missing' };
  }
  return { valid: true, payload };
}

function proAuthError(result) {
  return apiError(result.status || 401, 'invalid_token', result.reason);
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
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; frame-src 'none'; img-src 'self' data: blob: https:; connect-src 'self'"
  );
  return newHeaders;
}

function notFoundResponse() {
  return new Response('Not found', { status: 404 });
}

function permanentRedirect(url, pathname) {
  const redirectUrl = new URL(url);
  redirectUrl.pathname = pathname;
  return new Response(null, { status: 301, headers: { Location: redirectUrl.toString() } });
}

const PUBLIC_ROOT_ASSETS = new Set([
  '/',
  '/app',
  '/blog',
  '/blog/',
  '/create',
  '/generate',
  '/index.html',
  '/generator.html',
  '/health-check.html',
  '/email-signature-examples.html',
  '/privacy.html',
  '/favicon.svg',
  '/robots.txt',
  '/llms.txt',
  '/sitemap.xml',
]);

const PUBLIC_CLIENT_SCRIPTS = new Set([
  '/js/app.js',
  '/js/generator-core.js',
  '/js/gif-encoder.js',
  '/js/health-check.js',
  '/js/motion.js',
  '/js/photo-animator.js',
  '/js/site-facts.js',
  '/js/sweep-animator.js',
  '/js/templates.js',
]);

function isPublicStaticAssetPath(pathname) {
  if (PUBLIC_ROOT_ASSETS.has(pathname) || PUBLIC_CLIENT_SCRIPTS.has(pathname)) return true;
  if (/^\/css\/[A-Za-z0-9_-]+\.css$/.test(pathname)) return true;
  if (/^\/assets\/(?:blog\/)?[A-Za-z0-9_-]+\.(?:gif|jpe?g|png|svg|webp)$/.test(pathname)) return true;
  if (pathname === '/datasets/compliance.json') return true;
  if (/^\/(?:blog|seo)\/[A-Za-z0-9_-]+\.html$/.test(pathname)) return true;

  // Clean URLs are public only when their corresponding HTML path is public.
  if (!pathname.endsWith('/') && !/\.[A-Za-z0-9]+$/.test(pathname)) {
    return isPublicStaticAssetPath(`${pathname}.html`);
  }
  return false;
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

    const replacementPath = SEO_REPLACEMENT_REDIRECTS[url.pathname];
    if (replacementPath) return permanentRedirect(url, replacementPath);

    if (REMOVED_SEO_PATH.test(url.pathname)) return notFoundResponse();

    // ── API: Verify Payment (Stripe redirect landing) ────────────────────────
    if (url.pathname === '/api/verify-payment') {
      if (request.method !== 'GET') return apiError(405, 'method_not_allowed');
      const sessionId = url.searchParams.get('session_id');

      if (!sessionId) {
        return new Response('Missing session_id', { status: 400 });
      }

      if (!env.STRIPE_PAYMENT_LINK_ID || !env.PRO_SIGNING_SECRET || !uploadBucket(env)) {
        return new Response('Server misconfiguration: payment verification is unavailable', { status: 500 });
      }

      // Stripe records the paid session through the signed webhook before this
      // landing page can redeem it. No Stripe API key is stored in the Worker.
      const entitlement = await redeemCheckoutSession(sessionId, env);
      if (!entitlement.active) {
        if (entitlement.reason === 'confirmation_pending') {
          return paymentConfirmationPendingResponse(url);
        }
        const status = entitlement.reason === 'entitlement_revoked'
          ? 403
          : entitlement.reason === 'server_misconfiguration' ? 500 : 402;
        return new Response('Pro access is unavailable for this payment', { status });
      }

      // Create a signed JWT (expires in 1 year). The subject is an opaque
      // entitlement id, never a Stripe customer or payment identifier.
      const now = Math.floor(Date.now() / 1000);
      const oneYear = 365 * 24 * 60 * 60;
      const token = await signJwt(
        { sub: entitlement.id, ent: 1, iat: now, exp: now + oneYear },
        env.PRO_SIGNING_SECRET
      );

      // Redirect to generator with the token
      const redirectUrl = new URL('/generator', url.origin);
      redirectUrl.searchParams.set('token', token);
      return Response.redirect(redirectUrl.toString(), 302);
    }

    // Stripe webhook: durable purchase and revocation state.
    if (url.pathname === '/api/stripe-webhook') {
      if (request.method !== 'POST') return apiError(405, 'method_not_allowed');
      if (
        !env.STRIPE_WEBHOOK_SECRET ||
        !env.PRO_SIGNING_SECRET ||
        !uploadBucket(env) ||
        !['true', 'false'].includes(env.STRIPE_LIVEMODE)
      ) {
        return apiError(500, 'server_misconfiguration');
      }

      const payload = await request.text();
      const signature = request.headers.get('Stripe-Signature') || '';
      if (!await verifyStripeWebhookSignature(payload, signature, env.STRIPE_WEBHOOK_SECRET)) {
        return apiError(400, 'invalid_webhook_signature');
      }

      let event;
      try {
        event = JSON.parse(payload);
      } catch {
        return apiError(400, 'invalid_json');
      }
      if (!event || typeof event !== 'object' || !event.data || !event.data.object) {
        return apiError(400, 'invalid_event');
      }
      if (env.STRIPE_LIVEMODE === 'true' && event.livemode !== true) {
        return apiError(400, 'wrong_stripe_mode');
      }
      if (env.STRIPE_LIVEMODE === 'false' && event.livemode !== false) {
        return apiError(400, 'wrong_stripe_mode');
      }

      const object = event.data.object;
      if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
        const stripeResult = stripeResultFromSession(object, env);
        if (stripeResult.paid) await storeActiveEntitlement(env, stripeResult, 'stripe_webhook');
      } else if (
        event.type === 'charge.refunded' ||
        ((event.type === 'refund.created' || event.type === 'refund.updated') && object.status === 'succeeded')
      ) {
        const paymentIntent = stripeId(object.payment_intent, 'pi');
        if (paymentIntent) await revokeEntitlement(env, paymentIntent, 'refund', event);
      } else if (event.type === 'charge.dispute.created') {
        const paymentIntent = stripeId(object.payment_intent, 'pi');
        if (paymentIntent) await revokeEntitlement(env, paymentIntent, 'dispute', event);
      } else if (
        event.type === 'charge.dispute.closed' &&
        (object.status === 'won' || object.status === 'warning_closed')
      ) {
        const paymentIntent = stripeId(object.payment_intent, 'pi');
        if (paymentIntent) await restoreDisputedEntitlement(env, paymentIntent);
      }

      return new Response(JSON.stringify({ received: true }), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }

    // Verify the signed token and its current server-side entitlement.
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

        const result = await verifyProAccess(token, env);
        const publicResult = result.valid
          ? { valid: true }
          : { valid: false, reason: result.reason };
        return new Response(JSON.stringify(publicResult), {
          status: result.status || 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } catch {
        return new Response(JSON.stringify({ valid: false, reason: 'server_error' }), {
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
      const verified = await verifyProAccess(token, env);
      if (!verified.valid) return proAuthError(verified);
      const sub = verified.payload && verified.payload.sub;
      if (!validProSubject(sub || '')) return apiError(401, 'invalid_token', 'bad_subject');

      // Slot type — each slot stores at most one file per user
      const imageType = request.headers.get('X-Image-Type') || '';
      if (!IMAGE_SLOTS.includes(imageType)) return apiError(400, 'invalid_type');

      // Size pre-check via Content-Length. Animated GIFs run larger than stills.
      const MAX_BYTES = 3_000_000;
      const declaredLen = parseInt(request.headers.get('Content-Length') || '', 10);
      if (declaredLen > MAX_BYTES) return apiError(413, 'too_large');

      // Cloudflare's native binding enforces 25 uploads / minute / customer.
      // Photo, logo and animated-GIF retries all share the same customer budget.
      if (!env.RATE_LIMIT || typeof env.RATE_LIMIT.limit !== 'function') {
        return apiError(503, 'rate_limit_not_configured');
      }
      try {
        const limited = await env.RATE_LIMIT.limit({ key: `upload:${sub}` });
        if (!limited || typeof limited.success !== 'boolean') {
          return apiError(503, 'rate_limit_unavailable');
        }
        if (!limited.success) return apiError(429, 'rate_limited');
      } catch {
        return apiError(503, 'rate_limit_unavailable');
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

    // ── Public: Social icon, tinted on demand ────────────────────────────────
    //
    // Email clients render neither `data:` URIs nor SVG, so icons have to be real
    // hosted PNGs. Their colour follows the customer's brand, so there is no fixed
    // file to pre-render — this tints a stored alpha mask instead. Output is a few
    // KB and immutable, so it is served from cache after the first request.
    if (url.pathname.startsWith('/i/')) {
      const match = url.pathname.match(/^\/i\/([a-z]+)-([0-9a-fA-F]{6})\.png$/);
      if (!match) return notFoundResponse();

      const [, platform, hex] = match;
      if (!ICON_PLATFORMS.includes(platform)) return notFoundResponse();

      const mask = decodeMask(platform);
      if (!mask || mask.length !== ICON_SIZE * ICON_SIZE) return notFoundResponse();

      const rgb = [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
      ];
      const png = PngEncoder.encode(
        PngEncoder.tintMask(mask, ICON_SIZE, ICON_SIZE, rgb),
        ICON_SIZE,
        ICON_SIZE
      );

      return new Response(png, {
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=31536000, immutable',
          'Access-Control-Allow-Origin': '*',
          'X-Content-Type-Options': 'nosniff',
        },
      });
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
      const verified = await verifyProAccess(token, env);
      if (!verified.valid) return proAuthError(verified);

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

    // ── API: Publish a public card page (Pro only) ───────────────────────────
    //
    // Unlike a saved signature, this is deliberately public and indexable — it is
    // what the signature's name links to, and every published card is a page on
    // our own domain. That is exactly why publishing is opt-in in the UI and why
    // the stored record carries its owner: a card can only be replaced by the
    // customer who created it.
    if (url.pathname === '/api/card') {
      if (request.method !== 'POST') return apiError(405, 'method_not_allowed');
      if (!env.PRO_SIGNING_SECRET) return apiError(500, 'server_misconfiguration');
      const bucket = uploadBucket(env);
      if (!bucket) return apiError(500, 'storage_not_configured');

      const authHeader = request.headers.get('Authorization') || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
      if (!token) return apiError(401, 'invalid_token', 'missing');
      const verified = await verifyProAccess(token, env);
      if (!verified.valid) return proAuthError(verified);
      const sub = verified.payload && verified.payload.sub;
      if (!validProSubject(sub || '')) return apiError(401, 'invalid_token', 'bad_subject');

      const MAX_CARD_BYTES = 16_000;
      const declaredLen = parseInt(request.headers.get('Content-Length') || '', 10);
      if (declaredLen > MAX_CARD_BYTES) return apiError(413, 'too_large');

      const raw = await request.text();
      if (!raw) return apiError(400, 'empty_body');
      if (raw.length > MAX_CARD_BYTES) return apiError(413, 'too_large');

      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return apiError(400, 'invalid_json');
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return apiError(400, 'invalid_json');
      }
      if (!parsed.fullName || typeof parsed.fullName !== 'string') {
        return apiError(400, 'name_required');
      }

      const card = normaliseCard(parsed);

      // Reusing a slug replaces that page, so the link already pasted into a
      // signature keeps working. Only the original owner may do it.
      let slug = typeof parsed.slug === 'string' ? parsed.slug : '';
      if (slug) {
        if (!/^[a-z0-9-]{1,64}$/.test(slug)) return apiError(400, 'invalid_slug');
        const existing = await bucket.get(`cards/${slug}.json`);
        if (!existing) return apiError(404, 'not_found');
        let owner = null;
        try {
          owner = JSON.parse(await existing.text()).owner;
        } catch {
          owner = null;
        }
        if (owner !== sub) return apiError(403, 'not_your_card');
      } else {
        slug = `${slugifyName(card.fullName)}-${randomSuffix()}`;
      }

      await bucket.put(`cards/${slug}.json`, JSON.stringify({ ...card, owner: sub, updatedAt: Date.now() }), {
        httpMetadata: { contentType: 'application/json', cacheControl: 'no-store' },
      });

      return new Response(
        JSON.stringify({ slug, url: `${url.origin}/c/${slug}` }),
        { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
      );
    }

    // ── API: Unpublish a card page ───────────────────────────────────────────
    if (url.pathname.startsWith('/api/card/') && request.method === 'DELETE') {
      if (!env.PRO_SIGNING_SECRET) return apiError(500, 'server_misconfiguration');
      const bucket = uploadBucket(env);
      if (!bucket) return apiError(500, 'storage_not_configured');

      const match = url.pathname.match(/^\/api\/card\/([a-z0-9-]{1,64})$/);
      if (!match) return apiError(404, 'not_found');

      const authHeader = request.headers.get('Authorization') || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
      if (!token) return apiError(401, 'invalid_token', 'missing');
      const verified = await verifyProAccess(token, env);
      if (!verified.valid) return proAuthError(verified);
      const sub = verified.payload && verified.payload.sub;

      const existing = await bucket.get(`cards/${match[1]}.json`);
      if (!existing) return apiError(404, 'not_found');
      let owner = null;
      try {
        owner = JSON.parse(await existing.text()).owner;
      } catch {
        owner = null;
      }
      if (owner !== sub) return apiError(403, 'not_your_card');

      await bucket.delete(`cards/${match[1]}.json`);
      return new Response(JSON.stringify({ deleted: true }), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }

    // ── Public: vCard download ───────────────────────────────────────────────
    // Checked before the page route because the page pattern would otherwise
    // swallow the .vcf suffix.
    if (url.pathname.startsWith('/c/') && url.pathname.endsWith('.vcf')) {
      const match = url.pathname.match(/^\/c\/([a-z0-9-]{1,64})\.vcf$/);
      if (!match) return notFoundResponse();
      const card = await readCard(env, match[1]);
      if (!card) return notFoundResponse();

      return new Response(buildVCard(card), {
        headers: {
          'Content-Type': 'text/vcard; charset=utf-8',
          'Content-Disposition': `attachment; filename="${match[1]}.vcf"`,
          'Cache-Control': 'public, max-age=300',
        },
      });
    }

    // ── Public: Card page ────────────────────────────────────────────────────
    // Rendered server-side rather than hydrated in the browser, because the whole
    // point of these pages is that search engines and AI crawlers can read them
    // without executing JavaScript.
    if (url.pathname.startsWith('/c/')) {
      const match = url.pathname.match(/^\/c\/([a-z0-9-]{1,64})$/);
      if (!match) return notFoundResponse();
      const card = await readCard(env, match[1]);
      if (!card) return notFoundResponse();

      const html = renderCardPage(card, match[1], url.origin);
      const headers = addSecurityHeaders(new Response(null, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          // Short, because a customer republishing should see the change quickly.
          'Cache-Control': 'public, max-age=300',
        },
      }));
      return new Response(html, { headers });
    }

    // ── Public: Sitemap of published card pages ──────────────────────────────
    // Kept separate from the static sitemap because this set changes whenever a
    // customer publishes, and the static one is generated at build time.
    if (url.pathname === '/sitemap-cards.xml') {
      const bucket = uploadBucket(env);
      if (!bucket) return notFoundResponse();

      // R2 returns at most 1000 keys per call. Listing only the first page would
      // silently cap the feature's whole point once more than 1000 cards exist,
      // so this pages through them. The ceiling is the sitemap protocol's own
      // 50,000-URL limit; past that a sitemap index would be needed.
      const SITEMAP_URL_LIMIT = 50_000;
      const slugs = [];
      let cursor;
      do {
        const listed = await bucket.list({ prefix: 'cards/', limit: 1000, cursor });
        for (const obj of listed.objects) {
          const slug = obj.key.replace(/^cards\//, '').replace(/\.json$/, '');
          if (/^[a-z0-9-]{1,64}$/.test(slug)) slugs.push(slug);
        }
        cursor = listed.truncated ? listed.cursor : undefined;
      } while (cursor && slugs.length < SITEMAP_URL_LIMIT);

      const urls = slugs
        .slice(0, SITEMAP_URL_LIMIT)
        .map((slug) => `  <url><loc>${url.origin}/c/${slug}</loc><changefreq>monthly</changefreq></url>`)
        .join('\n');

      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
        { headers: { 'Content-Type': 'application/xml', 'Cache-Control': 'public, max-age=3600' } }
      );
    }

    if (request.method === 'POST' && url.pathname === '/api/upload') {
      return apiError(410, 'legacy_upload_removed', 'Use /api/upload-image with a Pro token.');
    }

    if (request.method === 'GET' && url.pathname.startsWith('/photos/')) {
      return handleLegacyPhoto(env, url);
    }

    // ── Static Asset Serving ─────────────────────────────────────────────────
    if ((request.method !== 'GET' && request.method !== 'HEAD') || !isPublicStaticAssetPath(url.pathname)) {
      return notFoundResponse();
    }

    if (url.pathname.endsWith('.html')) {
      const cleanPath = url.pathname === '/index.html'
        ? '/'
        : url.pathname.replace(/\/index\.html$/, '/').replace(/\.html$/, '');
      return permanentRedirect(url, cleanPath);
    }

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
    if (env.SANDBOX_MODE === 'true') {
      newHeaders.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  },
};

// ── Card pages ───────────────────────────────────────────────────────────────

const CARD_TEXT_FIELDS = ['fullName', 'title', 'company'];
const CARD_LINK_FIELDS = ['website', 'linkedin', 'instagram', 'facebook', 'google'];

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Only http(s) survives. Everything the card page renders as a link goes through
// here, so a stored `javascript:` URL from any source cannot become a live link.
function safeHttpUrl(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : '';
  } catch {
    return '';
  }
}

// Accepts only the fields a card page renders, each clamped to a sane length, so
// an oversized or unexpected key can never reach storage or the rendered page.
function normaliseCard(input) {
  const out = {};
  for (const field of CARD_TEXT_FIELDS) {
    out[field] = String(input[field] == null ? '' : input[field]).trim().slice(0, 120);
  }
  for (const field of CARD_LINK_FIELDS) {
    out[field] = safeHttpUrl(input[field]).slice(0, 300);
  }
  out.email = String(input.email == null ? '' : input.email).trim().slice(0, 160);
  out.phone = String(input.phone == null ? '' : input.phone).trim().slice(0, 40);
  out.photoUrl = safeHttpUrl(input.photoUrl).slice(0, 300);
  return out;
}

function slugifyName(name) {
  const slug = String(name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug || 'card';
}

function randomSuffix() {
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function readCard(env, slug) {
  const bucket = uploadBucket(env);
  if (!bucket) return null;
  const obj = await bucket.get(`cards/${slug}.json`);
  if (!obj) return null;
  try {
    const parsed = JSON.parse(await obj.text());
    // `owner` is storage bookkeeping, not page content — drop it before rendering
    // so a customer id can never leak into public HTML.
    const { owner, ...card } = parsed;
    return card;
  } catch {
    return null;
  }
}

// RFC 6350 escaping: backslash, comma, semicolon and newline all carry meaning
// inside a vCard value.
function vcardEscape(value) {
  return String(value == null ? '' : value)
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function buildVCard(card) {
  const words = String(card.fullName || '').trim().split(/\s+/).filter(Boolean);
  const last = words.length > 1 ? words[words.length - 1] : '';
  const first = words.length ? words[0] : '';

  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${vcardEscape(card.fullName)}`,
    `N:${vcardEscape(last)};${vcardEscape(first)};;;`,
  ];
  if (card.title) lines.push(`TITLE:${vcardEscape(card.title)}`);
  if (card.company) lines.push(`ORG:${vcardEscape(card.company)}`);
  if (card.phone) lines.push(`TEL;TYPE=CELL:${vcardEscape(card.phone)}`);
  if (card.email) lines.push(`EMAIL;TYPE=INTERNET:${vcardEscape(card.email)}`);
  if (card.website) lines.push(`URL:${vcardEscape(card.website)}`);
  if (card.photoUrl) lines.push(`PHOTO;VALUE=URI:${vcardEscape(card.photoUrl)}`);
  for (const field of ['linkedin', 'instagram', 'facebook']) {
    if (card[field]) lines.push(`X-SOCIALPROFILE;TYPE=${field}:${vcardEscape(card[field])}`);
  }
  lines.push('END:VCARD');

  // vCard requires CRLF line endings.
  return lines.join('\r\n') + '\r\n';
}

function renderCardPage(card, slug, origin) {
  const name = escapeHtml(card.fullName);
  const role = [card.title, card.company].filter(Boolean).join(', ');
  const roleSafe = escapeHtml(role);
  const description = role ? `${card.fullName} — ${role}. Contact details and vCard.` : `${card.fullName} — contact details and vCard.`;

  const links = [
    card.website && { href: card.website, label: 'Website' },
    card.linkedin && { href: card.linkedin, label: 'LinkedIn' },
    card.instagram && { href: card.instagram, label: 'Instagram' },
    card.facebook && { href: card.facebook, label: 'Facebook' },
    card.google && { href: card.google, label: 'Google' },
  ].filter(Boolean);

  // sameAs is what lets an AI or search crawler tie this page to the same person
  // across platforms, which is the entire reason these pages exist.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: card.fullName,
    url: `${origin}/c/${slug}`,
  };
  if (card.title) jsonLd.jobTitle = card.title;
  if (card.company) jsonLd.worksFor = { '@type': 'Organization', name: card.company };
  if (card.photoUrl) jsonLd.image = card.photoUrl;
  if (card.email) jsonLd.email = card.email;
  if (card.phone) jsonLd.telephone = card.phone;
  const sameAs = links.map((l) => l.href);
  if (sameAs.length) jsonLd.sameAs = sameAs;

  // `new URL().toString()` normalises a bare host to a trailing slash. Correct for
  // the href, untidy as display text on a page whose whole job is to look sharp.
  const displayUrl = (href) => href.replace(/^https?:\/\//, '').replace(/\/$/, '');

  const contactRow = (label, href, text) =>
    `<a class="row" href="${escapeHtml(href)}"><span class="label">${label}</span><span class="value">${escapeHtml(text)}</span></a>`;

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${name}${roleSafe ? ' — ' + roleSafe : ''}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(origin)}/c/${escapeHtml(slug)}">
<meta property="og:type" content="profile">
<meta property="og:title" content="${name}">
<meta property="og:description" content="${escapeHtml(description)}">
${card.photoUrl ? `<meta property="og:image" content="${escapeHtml(card.photoUrl)}">` : ''}
<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>
<style>
 :root { color-scheme: light dark; }
 body { margin:0; background:#f6f7f8; color:#141719;
        font:16px/1.6 -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
        display:flex; align-items:center; justify-content:center; min-height:100vh; padding:24px; }
 .card { background:#fff; border:1px solid #e6e8eb; border-radius:16px; padding:32px; max-width:420px; width:100%; }
 img.avatar { width:88px; height:88px; border-radius:50%; object-fit:cover; display:block; margin-bottom:20px; }
 h1 { font-size:24px; letter-spacing:-0.3px; margin:0 0 4px; }
 .role { color:#6b7280; font-size:14px; margin:0 0 24px; }
 .row { display:flex; gap:12px; padding:10px 0; border-top:1px solid #eef1f4; text-decoration:none; color:inherit; }
 /* Fixed, and wide enough for the longest label (INSTAGRAM) so every value in the
    column starts on the same vertical line. */
 .label { flex:0 0 88px; font-size:10px; text-transform:uppercase; letter-spacing:1.1px; color:#9aa3ad; padding-top:4px; }
 .value { font-size:14px; color:#374151; word-break:break-word; }
 .save { display:inline-block; margin-top:24px; padding:11px 20px; border-radius:8px;
         background:#0891B2; color:#fff; text-decoration:none; font-size:14px; font-weight:600; }
 .footer { margin-top:24px; font-size:12px; color:#9aa3ad; }
 .footer a { color:#6b7280; }
 @media (prefers-color-scheme: dark) {
   body { background:#0f1214; color:#e8eaec; }
   .card { background:#171a1d; border-color:#272b30; }
   .row { border-color:#272b30; }
   .value { color:#c8ccd0; }
 }
</style>
</head><body>
<main class="card">
  ${card.photoUrl ? `<img class="avatar" src="${escapeHtml(card.photoUrl)}" alt="${name}">` : ''}
  <h1>${name}</h1>
  ${roleSafe ? `<p class="role">${roleSafe}</p>` : ''}
  ${card.phone ? contactRow('Phone', 'tel:' + String(card.phone).replace(/\s/g, ''), card.phone) : ''}
  ${card.email ? contactRow('Email', 'mailto:' + card.email, card.email) : ''}
  ${links.map((l) => contactRow(l.label, l.href, displayUrl(l.href))).join('\n  ')}
  <a class="save" href="/c/${escapeHtml(slug)}.vcf">Save contact</a>
  <p class="footer">Card by <a href="${escapeHtml(origin)}">Email Signature Generator</a></p>
</main>
</body></html>`;
}

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
