// Cloudflare Worker for Email Signature Generator
// Handles: clean URL rewriting, security headers, Pro payment verification, and
// on-demand social icon rendering.

import PngEncoder from './js/png-encoder.js';
import { ICON_MASK_SIZE, decodeMask } from './js/icon-masks.js';
import './js/site-facts.js';
import { extractBrand, pickStylesheet, rankColors, normalizeHex } from './js/brand-extract.js';
import { bulkApiResponse, authorizeBulkRequest } from './js/bulk-api.js';
import { createBulkAccess } from './js/bulk-access.js';
import { bulkMcpResponse } from './js/bulk-mcp.js';
import { agentDiscoveryResponse, agentDiscoveryLinks } from './js/agent-discovery.js';
import { createAgentRegistration } from './js/agent-registration.js';
import { bulkA2aResponse } from './js/bulk-a2a.js';
import { createPurchaseEmails } from './js/purchase-email.js';

const FACTS = globalThis.SiteFacts;
const BULK_ACCESS = createBulkAccess({ verifyProAccess, verifyJwt, signJwt, readJsonObject, isEntitlementRevoked, uploadBucket });
const AGENT_REGISTRATION = createAgentRegistration({ signJwt, verifyJwt, bulkAccess: BULK_ACCESS, uploadBucket });
const PURCHASE_EMAILS = createPurchaseEmails({ facts: FACTS, entitlementId, uploadBucket, readJsonObject, isEntitlementRevoked });

const GOOGLE_SITE_VERIFICATION_FILE = '/googlee8f6af86faea90b4.html';
const GOOGLE_SITE_VERIFICATION_BODY = 'google-site-verification: googlee8f6af86faea90b4.html';
const SEO_REPLACEMENT_REDIRECTS = Object.freeze({
  '/seo/email-signature-generator-for-google-workspace': '/seo/email-signature-generator-for-gmail',
  '/seo/email-signature-generator-for-google-workspace.html': '/seo/email-signature-generator-for-gmail',
  '/seo/email-signature-generator-for-microsoft-365': '/seo/email-signature-generator-for-outlook',
  '/seo/email-signature-generator-for-microsoft-365.html': '/seo/email-signature-generator-for-outlook',
  '/seo/email-signature-checker': '/health-check',
  '/seo/email-signature-checker.html': '/health-check',
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
      // The signature is genuine, so callers that re-check a server-side
      // entitlement may still honour it. verify-token never returns this payload.
      return { valid: false, reason: 'expired', payload };
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

// Server-side failures are logged by code only, so Workers Logs can alert on
// them without ever recording tokens, customer ids, or request bodies.
function logServerError(event, fields) {
  console.error(JSON.stringify({ event, ...fields }));
}

function apiError(status, code, detail) {
  if (status >= 500) logServerError('api_error', { status, code });
  const body = detail ? { error: code, code, detail } : { error: code, code };
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function uploadBucket(env) {
  return env.UPLOADS || env.PHOTOS;
}

// Reads a request body without ever holding more than maxBytes, whether or not
// the client sent Content-Length. Returns { bytes } or { error: Response }.
async function readRequestBytes(request, maxBytes) {
  const declared = request.headers.get('Content-Length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) {
    return { error: apiError(413, 'too_large') };
  }
  if (!request.body) return { bytes: new Uint8Array(0) };
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        try { await reader.cancel(); } catch { /* already closed */ }
        return { error: apiError(413, 'too_large') };
      }
      chunks.push(value);
    }
  } catch {
    return { error: apiError(400, 'invalid_body') };
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes };
}

async function readRequestText(request, maxBytes) {
  const read = await readRequestBytes(request, maxBytes);
  if (read.error) return read;
  return { text: new TextDecoder().decode(read.bytes) };
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
    returnTo: stripeResult.returnTo === 'bulk' ? 'bulk' : '',
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
    plan: stripeResult.plan === 'team' ? 'team' : 'pro',
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
  const plan = planForPaymentLink(paymentLink, env);
  if (
    session.mode !== 'payment' ||
    session.status !== 'complete' ||
    session.payment_status !== 'paid' ||
    session.livemode !== (env.STRIPE_LIVEMODE === 'true') ||
    !plan ||
    !paymentIntent
  ) {
    return { paid: false, reason: 'payment_not_eligible' };
  }
  return { paid: true, sessionId, paymentIntent, paymentLink, plan, returnTo: session.client_reference_id === 'bulk' ? 'bulk' : '' };
}

// The team pack is a second Stripe Payment Link. Until STRIPE_TEAM_PAYMENT_LINK_ID
// is set, only the single-person link is honoured.
function planForPaymentLink(paymentLink, env) {
  if (!paymentLink) return '';
  if (paymentLink === env.STRIPE_PAYMENT_LINK_ID) return 'pro';
  if (/^plink_[A-Za-z0-9]+$/.test(env.STRIPE_TEAM_PAYMENT_LINK_ID || '') &&
    paymentLink === env.STRIPE_TEAM_PAYMENT_LINK_ID) return 'team';
  return '';
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
    !planForPaymentLink(redemption.paymentLink, env) ||
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
  return { active: true, id: redemption.entitlementId, returnTo: redemption.returnTo === 'bulk' ? 'bulk' : '' };
}

// The Stripe return page retries while the signed webhook is still on its way,
// counting attempts in the URL so it cannot loop forever.
const PAYMENT_PENDING_ATTEMPTS = 30;
const PAYMENT_PENDING_RETRY_SECONDS = 2;

// Small branded pages for the payment return. They never contain the token or
// any Stripe id: the retry uses a Refresh header, not a link in the body.
const PAYMENT_PAGE_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

function paymentPageHeaders(extra = {}) {
  return {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store, private',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': PAYMENT_PAGE_CSP,
    ...extra,
  };
}

function paymentPageHtml(title, paragraphs, { script = '', action = '' } = {}) {
  const support = escapeHtml(FACTS.supportEmail);
  const body = paragraphs.map((text) => `<p style="color:var(--text-secondary);margin:16px 0">${text}</p>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta name="referrer" content="no-referrer"><title>${escapeHtml(title)} | ${escapeHtml(FACTS.siteName)}</title><link rel="icon" type="image/svg+xml" href="/favicon.svg"><link rel="stylesheet" href="/css/styles.css"></head><body><main id="main-content" style="max-width:640px;margin:0 auto;padding:80px 24px;text-align:center"><p style="color:var(--text-secondary);margin:0 0 24px">${escapeHtml(FACTS.siteName)}</p><h1>${escapeHtml(title)}</h1>${body}${action}<p style="margin-top:32px">Need help? Email <a href="mailto:${support}">${support}</a>.</p></main>${script}</body></html>`;
}

function paymentConfirmationPendingResponse(url) {
  const attempt = Number.parseInt(url.searchParams.get('attempt') || '0', 10);
  const done = Number.isInteger(attempt) && attempt >= 0 ? attempt : 0;
  if (done + 1 >= PAYMENT_PENDING_ATTEMPTS) {
    // "Check again" restarts the count without the page ever printing the URL.
    const script = `<script>document.getElementById('check-again').addEventListener('click',function(){var u=new URL(location.href);u.searchParams.delete('attempt');location.replace(u.pathname+u.search);});</script>`;
    const html = paymentPageHtml('Your payment is still being confirmed', [
      'Stripe has not finished confirming your purchase with us yet. This usually takes a few seconds, but it can occasionally take longer.',
      'You have not lost your payment, and you do not need to pay again. Keep your Stripe receipt email.',
      `Try again in a few minutes. If it still does not work, email ${escapeHtml(FACTS.supportEmail)} with the email address you paid with and we will restore your access.`,
    ], { script, action: '<p style="margin-top:32px"><button type="button" id="check-again" class="btn btn-primary">Check again</button></p>' });
    return new Response(html, { status: 202, headers: paymentPageHeaders() });
  }
  const next = new URL(url);
  next.searchParams.set('attempt', String(done + 1));
  const html = paymentPageHtml('Confirming your payment…', [
    'Stripe is confirming your purchase. This page checks again automatically every few seconds.',
  ]);
  return new Response(html, {
    status: 202,
    headers: paymentPageHeaders({
      'Retry-After': String(PAYMENT_PENDING_RETRY_SECONDS),
      Refresh: `${PAYMENT_PENDING_RETRY_SECONDS};url=${next.pathname}${next.search}`,
    }),
  });
}

const PAYMENT_PROBLEMS = Object.freeze({
  missing_session: {
    status: 400,
    title: 'This purchase link is incomplete',
    paragraphs: [
      'The link you followed is missing part of its address, so we cannot tell which purchase it belongs to.',
      'Open the link from your purchase email again, or copy the whole link into your browser. If you paid and still cannot get in, email us with the email address you paid with.',
    ],
  },
  payment_not_eligible: {
    status: 402,
    title: 'We could not match this payment to a purchase',
    paragraphs: [
      'This checkout did not complete as a payment for this site, so it does not unlock Pro.',
      'If you were charged, you have not lost the money: email us with your Stripe receipt and we will sort it out.',
    ],
  },
  entitlement_revoked: {
    status: 403,
    title: 'This purchase is no longer active',
    paragraphs: [
      'This purchase was refunded or disputed, so it no longer unlocks Pro.',
      'If you think that is a mistake, email us with your Stripe receipt.',
    ],
  },
  server_misconfiguration: {
    status: 500,
    title: 'We cannot confirm payments right now',
    paragraphs: [
      'Our payment confirmation is temporarily unavailable. Your payment is safe and you do not need to pay again.',
      'Try again in a few minutes. If it keeps happening, email us and we will restore your access.',
    ],
  },
});

function paymentProblemResponse(reason) {
  const problem = PAYMENT_PROBLEMS[reason] || PAYMENT_PROBLEMS.payment_not_eligible;
  if (problem.status >= 500) logServerError('api_error', { status: problem.status, code: 'verify_payment_misconfigured' });
  return new Response(paymentPageHtml(problem.title, problem.paragraphs), {
    status: problem.status,
    headers: paymentPageHeaders(),
  });
}

// The emailed access link carries the checkout session id in the fragment, so
// email scanners, link rewriters and click logs never receive it. This page
// moves it into the redemption request on our own origin.
function paymentRestorePageResponse() {
  const script = `<script>(function(){var m=/(?:^#|&)session_id=(cs_(?:(?:test|live)_)?[A-Za-z0-9]+)(?:&|$)/.exec(location.hash);if(!m){document.getElementById('restore-status').hidden=true;document.getElementById('restore-missing').hidden=false;return;}history.replaceState(null,'',location.pathname);location.replace(location.pathname+'?session_id='+encodeURIComponent(m[1]));})();</script>`;
  const html = paymentPageHtml('Restoring your purchase…', [
    '<span id="restore-status">Checking your purchase. This takes a moment.</span><span id="restore-missing" hidden>This purchase link is incomplete. Open the link from your purchase email again, or copy the whole link into your browser.</span>',
  ], { script });
  return new Response(html, { status: 200, headers: paymentPageHeaders() });
}

const MAX_WEBHOOK_BYTES = 1_000_000;
const MAX_VERIFY_TOKEN_BODY_BYTES = 8_000;
// Real tokens are a few hundred characters; anything far longer is not one.
const MAX_TOKEN_LENGTH = 4096;

// A Stripe Charge is fully refunded when Stripe says so, or when the refunded
// total reaches the charged amount.
function isFullyRefundedCharge(charge) {
  if (!charge || typeof charge !== 'object') return false;
  if (charge.refunded === true) return true;
  return Number.isSafeInteger(charge.amount) && charge.amount > 0 &&
    Number.isSafeInteger(charge.amount_refunded) && charge.amount_refunded >= charge.amount;
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
  const payload = verified.payload || {};
  // Pro is sold as lifetime access. Entitlement tokens are re-checked against
  // R2 below on every call, so refunds and disputes still revoke them, and their
  // `exp` is not what ends access. Early tokens were minted with a one-year
  // expiry; honouring them past it stops every buyer being downgraded a year
  // after paying. Legacy customer-id tokens have no server record, so they keep
  // their expiry.
  const lifetimeEntitlement = verified.reason === 'expired' &&
    payload.ent === 1 && typeof payload.sub === 'string' && payload.sub.startsWith('ent_');
  if (!verified.valid && !lifetimeEntitlement) return { valid: false, reason: verified.reason };

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
  return { valid: true, payload, record };
}

// Cloudflare's native binding allows 25 calls / minute per key. Each Pro action
// gets its own key per customer, so a burst of card publishes cannot eat the
// upload budget. Missing, failed or malformed bindings fail closed.
async function enforceRateLimit(env, key) {
  if (!env.RATE_LIMIT || typeof env.RATE_LIMIT.limit !== 'function') {
    return apiError(503, 'rate_limit_not_configured');
  }
  try {
    const limited = await env.RATE_LIMIT.limit({ key });
    if (!limited || typeof limited.success !== 'boolean') {
      return apiError(503, 'rate_limit_unavailable');
    }
    if (!limited.success) return apiError(429, 'rate_limited');
  } catch {
    return apiError(503, 'rate_limit_unavailable');
  }
  return null;
}

// One purchase may publish this many live card pages. Replacing an existing
// card does not count against it, and unpublishing frees a slot. The cap stops a
// single $9 purchase minting thousands of indexable pages on our domain.
const MAX_CARDS_PER_BUYER = FACTS.maxCardsPerBuyer;

// Index of the cards each buyer owns, keyed by the same HMAC-derived id used in
// public image URLs so no entitlement id appears in the key.
async function cardOwnerPrefix(sub, secret) {
  return `card-owners/${await publicUploadId(sub, secret)}/`;
}

// The cap is enforced on one ledger object per buyer, updated with a
// conditional write, so parallel publishes cannot all pass a stale count.
// The per-slug index above stays as before; it seeds the ledger the first
// time a buyer who already has cards publishes again.
function cardLedgerKey(ownerPrefix) {
  return `card-quota/${ownerPrefix.slice('card-owners/'.length, -1)}.json`;
}

async function listOwnedCardSlugs(bucket, prefix, limit) {
  const slugs = [];
  let cursor;
  do {
    const listed = await bucket.list({ prefix, limit: 1000, cursor });
    for (const object of listed.objects) slugs.push(object.key.slice(prefix.length));
    cursor = listed.truncated && slugs.length < limit ? listed.cursor : undefined;
  } while (cursor);
  return slugs;
}

const CARD_LEDGER_ATTEMPTS = 8;

// Applies `change` to the buyer's slug list and writes it only if nobody else
// wrote in between. `change` returns the new list, or a string reason to stop.
async function updateCardLedger(bucket, ownerPrefix, change) {
  const key = cardLedgerKey(ownerPrefix);
  for (let attempt = 0; attempt < CARD_LEDGER_ATTEMPTS; attempt++) {
    const object = await bucket.get(key);
    let slugs = null;
    if (object) {
      try {
        const parsed = JSON.parse(await object.text());
        if (parsed && Array.isArray(parsed.slugs)) slugs = parsed.slugs.filter((slug) => typeof slug === 'string');
      } catch {
        slugs = null;
      }
    }
    if (!slugs) slugs = await listOwnedCardSlugs(bucket, ownerPrefix, MAX_CARDS_PER_BUYER + 1);
    const next = change([...new Set(slugs)]);
    if (typeof next === 'string') return next;
    if (!next) return 'unchanged';
    const written = await bucket.put(key, JSON.stringify({ version: 1, slugs: next, updatedAt: Date.now() }), {
      httpMetadata: { contentType: 'application/json', cacheControl: 'no-store' },
      onlyIf: object ? (object.etag ? { etagMatches: object.etag } : undefined) : { etagDoesNotMatch: '*' },
    });
    if (written !== null) return 'ok';
    await new Promise((resolve) => setTimeout(resolve, 5 + Math.floor(Math.random() * 20)));
  }
  return 'busy';
}

// Team members share their buyer's entitlement, so cards record which member
// published them; one colleague cannot replace another's page.
function cardOwnerId(payload) {
  const member = payload && Number.isInteger(payload.tm) && payload.tm > 0 ? payload.tm : 0;
  return member ? `${payload.sub}:m${member}` : payload.sub;
}

// Only the buyer of a team pack (not a colleague who joined it) manages the team.
function teamOwnerPlan(verified) {
  return Boolean(verified && verified.valid && verified.record &&
    verified.record.plan === 'team' && !(verified.payload && verified.payload.tm));
}

// ── Team pack ────────────────────────────────────────────────────────────────
//
// The buyer saves their branded signature as the team design. Colleagues open
// the team link, type their own details, and claim one of the pack's seats,
// which mints them a Pro token on the buyer's entitlement. A refund or dispute
// on the purchase therefore ends access for the whole team.

const TEAM_SEATS = FACTS.teamSeats;
const TEAM_ID = /^[A-Za-z0-9_-]{43}$/;

async function teamIdFor(sub, secret) {
  const key = await importKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, textToUint8Array(`team:${sub}`));
  return base64url(signature);
}

const TEAM_PERSONAL_FIELDS = ['fullName', 'nameLinkUrl', 'title', 'phone', 'email', 'photoUrl', 'linkedin'];
const TEAM_CLAIM = /^[A-Za-z0-9_-]{22,64}$/;

async function teamClaimHash(claim) {
  const digest = await crypto.subtle.digest('SHA-256', textToUint8Array(`team-claim:${claim}`));
  return base64url(digest).slice(0, 32);
}

function teamClaims(team) {
  const claims = team && team.claims;
  return claims && typeof claims === 'object' && !Array.isArray(claims) ? { ...claims } : {};
}

function teamKey(id) {
  return `teams/${id}.json`;
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, private' },
  });
}

async function bearerProAccess(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) return { valid: false, reason: 'missing' };
  return verifyProAccess(token, env);
}

async function teamResponse(request, env, url) {
  if (!env.PRO_SIGNING_SECRET) return apiError(500, 'server_misconfiguration');
  const bucket = uploadBucket(env);
  if (!bucket) return apiError(500, 'storage_not_configured');

  // Buyer: save or update the team design.
  if (url.pathname === '/api/team') {
    if (request.method !== 'POST') return apiError(405, 'method_not_allowed');
    const verified = await bearerProAccess(request, env);
    if (!verified.valid) return proAuthError(verified);
    if (!teamOwnerPlan(verified)) return apiError(403, 'team_plan_required');
    const sub = verified.payload.sub;
    const limited = await enforceRateLimit(env, `team:${sub}`);
    if (limited) return limited;

    const MAX_TEAM_BYTES = 32_000;
    const body = await readRequestText(request, MAX_TEAM_BYTES);
    if (body.error) return body.error;
    const raw = body.text;
    if (!raw) return apiError(400, 'empty_body');
    let design;
    try {
      design = JSON.parse(raw);
    } catch {
      return apiError(400, 'invalid_json');
    }
    if (!design || typeof design !== 'object' || Array.isArray(design)) return apiError(400, 'invalid_json');
    // Anyone with the team link can read the design, so never store the
    // buyer's own details in it, whatever the client sends.
    if (design.data && typeof design.data === 'object') {
      for (const field of TEAM_PERSONAL_FIELDS) delete design.data[field];
    }
    if (design.compliance && typeof design.compliance === 'object') design.compliance.fieldValues = {};
    delete design.nameLink;

    const id = await teamIdFor(sub, env.PRO_SIGNING_SECRET);
    // Colleagues may claim seats while the buyer saves, so carry the seat count
    // over from the copy just read and only write if it is still the latest.
    for (let attempt = 0; attempt < 3; attempt++) {
      const object = await bucket.get(teamKey(id));
      let previous = null;
      if (object) {
        try {
          previous = JSON.parse(await object.text());
        } catch {
          previous = null;
        }
      }
      const record = {
        version: 1,
        owner: sub,
        seats: TEAM_SEATS,
        members: previous && Number.isInteger(previous.members) ? previous.members : 0,
        claims: teamClaims(previous),
        design,
        updatedAt: Date.now(),
      };
      const written = await bucket.put(teamKey(id), JSON.stringify(record), {
        httpMetadata: { contentType: 'application/json', cacheControl: 'no-store' },
        onlyIf: object && object.etag ? { etagMatches: object.etag } : undefined,
      });
      if (written !== null) {
        return jsonResponse({ id, url: `${url.origin}/generator?team=${id}`, seats: record.seats, members: record.members });
      }
    }
    return apiError(409, 'team_busy');
  }

  const match = url.pathname.match(/^\/api\/team\/([A-Za-z0-9_-]+)(\/join)?$/);
  if (!match || !TEAM_ID.test(match[1])) return apiError(404, 'not_found');
  const id = match[1];

  // Colleague: read the design. The unguessable link is the credential, as with
  // saved signatures.
  if (!match[2]) {
    if (request.method !== 'GET') return apiError(405, 'method_not_allowed');
    const team = await readJsonObject(bucket, teamKey(id));
    if (!team) return apiError(404, 'not_found');
    return jsonResponse({ design: team.design, seats: team.seats, members: team.members });
  }

  // Colleague: claim a seat.
  if (request.method !== 'POST') return apiError(405, 'method_not_allowed');
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const limited = await enforceRateLimit(env, `team-join:${id}:${ip}`);
  if (limited) return limited;

  // The browser sends a random claim id it keeps for this team, so a retry
  // (a lost response, a double click) gets the same seat back.
  let claim = '';
  const joinBody = await readRequestText(request, 1000);
  if (joinBody.error) return joinBody.error;
  const rawJoin = joinBody.text;
  if (rawJoin) {
    try {
      const parsed = JSON.parse(rawJoin);
      claim = parsed && typeof parsed.claim === 'string' && TEAM_CLAIM.test(parsed.claim) ? parsed.claim : '';
    } catch {
      return apiError(400, 'invalid_json');
    }
  }
  const claimHash = claim ? await teamClaimHash(claim) : '';

  const object = await bucket.get(teamKey(id));
  if (!object) return apiError(404, 'not_found');
  let team;
  try {
    team = JSON.parse(await object.text());
  } catch {
    return apiError(404, 'not_found');
  }
  if (!team || !validProSubject(team.owner || '') || !String(team.owner).startsWith('ent_')) {
    return apiError(404, 'not_found');
  }
  if (await isEntitlementRevoked(bucket, team.owner)) return apiError(403, 'team_inactive');
  const entitlement = await readJsonObject(bucket, entitlementKey(team.owner));
  if (!entitlement || entitlement.status !== 'active' || entitlement.plan !== 'team') {
    return apiError(403, 'team_inactive');
  }
  const claims = teamClaims(team);
  const members = Number.isInteger(team.members) ? team.members : 0;
  let member = claimHash && Number.isInteger(claims[claimHash]) ? claims[claimHash] : 0;
  if (!member) {
    // The buyer uses one of the pack's seats themselves.
    if (members >= team.seats - 1) return apiError(409, 'team_full', String(team.seats));
    member = members + 1;
    if (claimHash) claims[claimHash] = member;
    // Only write if nobody else claimed a seat since this read, so two colleagues
    // joining at once cannot both take the last seat.
    const written = await bucket.put(teamKey(id), JSON.stringify({ ...team, members: member, claims, updatedAt: Date.now() }), {
      httpMetadata: { contentType: 'application/json', cacheControl: 'no-store' },
      onlyIf: object.etag ? { etagMatches: object.etag } : undefined,
    });
    if (written === null) return apiError(409, 'team_busy');
  }

  const now = Math.floor(Date.now() / 1000);
  const hundredYears = 100 * 365 * 24 * 60 * 60;
  const token = await signJwt(
    { sub: team.owner, ent: 1, tm: member, iat: now, exp: now + hundredYears },
    env.PRO_SIGNING_SECRET
  );
  return jsonResponse({ token, seat: member + 1, seats: team.seats });
}

function proAuthError(result) {
  return apiError(result.status || 401, 'invalid_token', result.reason);
}

// ── Security Headers ─────────────────────────────────────────────────────────

// Cloudflare injects the Web Analytics beacon into every page. It loads from
// static.cloudflareinsights.com and reports to /cdn-cgi/rum on this origin
// ('self'), or to cloudflareinsights.com when the zone is not proxied. Keep
// `_headers` in step: Wrangler applies it to static asset responses.
const PAGE_CSP = "default-src 'self'; script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; frame-src 'none'; img-src 'self' data: blob: https:; connect-src 'self' https://cloudflareinsights.com";

// One year, this host only: no includeSubDomains or preload, which are hard to
// undo and would bind every subdomain to HTTPS.
const HSTS = 'max-age=31536000';

// Every response, API and error responses included, carries HSTS.
function withTransportSecurity(response) {
  if (!response || response.status === 101) return response;
  const headers = new Headers(response.headers);
  headers.set('Strict-Transport-Security', HSTS);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function addSecurityHeaders(response, bulk = false) {
  const newHeaders = new Headers(response.headers);
  newHeaders.set('X-Frame-Options', 'DENY');
  newHeaders.set('X-Content-Type-Options', 'nosniff');
  newHeaders.set('Referrer-Policy', bulk ? 'no-referrer' : 'strict-origin-when-cross-origin');
  newHeaders.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  newHeaders.set(
    'Content-Security-Policy',
    PAGE_CSP + (bulk ? "; worker-src 'self' blob:" : '')
  );
  return newHeaders;
}

// A real page rather than bare text, so a mistyped or retired URL still leads
// visitors back to the generator and guides. noindex keeps it out of search.
const NOT_FOUND_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Page not found | Email Signature Generator</title><link rel="icon" type="image/svg+xml" href="/favicon.svg"><link rel="stylesheet" href="/css/styles.css"></head><body><main id="main-content" style="max-width:640px;margin:0 auto;padding:80px 24px;text-align:center"><h1>Page not found</h1><p style="color:var(--text-secondary);margin:16px 0 32px">That page doesn't exist or has moved.</p><p><a class="btn btn-primary" href="/generator">Create your signature</a></p><p style="margin-top:24px"><a href="/">Home</a> &middot; <a href="/email-signature-examples">Examples</a> &middot; <a href="/blog/">Guides</a> &middot; <a href="/health-check">Health check</a></p></main></body></html>`;

function notFoundResponse() {
  return new Response(NOT_FOUND_HTML, {
    status: 404,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
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
  '/email-signature-templates.html',
  '/brand-extractor.html',
  '/bulk.html',
  '/connect-agent.html',
  '/privacy.html',
  '/favicon.svg',
  '/robots.txt',
  '/llms.txt',
  '/sitemap.xml',
]);

const PUBLIC_CLIENT_SCRIPTS = new Set([
  '/js/app.js',
  '/js/brand-tool.js',
  '/js/bulk.js',
  '/js/connect-agent.js',
  '/js/bulk-core.js',
  '/js/bulk-spreadsheet-worker.js',
  '/js/vendor/read-excel-file.min.js',
  '/js/vendor/read-excel-file.LICENSE.txt',
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
  if (/^\/(?:blog|seo|email-signature-templates)\/[A-Za-z0-9_-]+\.html$/.test(pathname)) return true;

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

// ── Brand from website ──────────────────────────────────────────────────────
// Reads a company's public homepage and returns its name, logo, colours, social
// links and phone so the generator can fill them in. Nothing is stored. Every
// hop (including redirects) is re-checked so the fetch can only reach a public
// http(s) host on a standard port, never an IP literal or this site itself.

const BRAND_UA = 'Mozilla/5.0 (compatible; EmailSignatureGeneratorBot/1.0; +https://emailsignaturegenerator.ai/generator)';
const BRAND_HTML_MAX = 600_000;
const BRAND_CSS_MAX = 250_000;
const BRAND_LOGO_MAX = 1_000_000;

function brandTargetAllowed(url) {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  if (url.username || url.password) return false;
  if (url.port && url.port !== '80' && url.port !== '443') return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host.includes('.') || host.length > 253) return false;
  if (/^[\d.]+$/.test(host) || host.includes(':') || host.startsWith('[')) return false;
  if (/(^|\.)(localhost|local|internal|intranet|lan|home|corp|test|example|invalid|onion|arpa)$/.test(host)) return false;
  const own = FACTS.domain;
  if (host === own || host.endsWith('.' + own) || host.endsWith('.workers.dev')) return false;
  return true;
}

function normalizeBrandSite(input) {
  let value = String(input || '').trim();
  if (!value || value.length > 300 || /\s/.test(value)) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = 'https://' + value;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (!brandTargetAllowed(url)) return null;
  url.hash = '';
  return url;
}

async function readCapped(response, max) {
  if (!response.body) return { bytes: new Uint8Array(0), truncated: false };
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (total < max) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  try { await reader.cancel(); } catch { /* already closed */ }
  const out = new Uint8Array(Math.min(total, max));
  let offset = 0;
  for (const chunk of chunks) {
    const take = Math.min(chunk.byteLength, out.length - offset);
    if (take <= 0) break;
    out.set(chunk.subarray(0, take), offset);
    offset += take;
  }
  return { bytes: out, truncated: total > max };
}

async function brandFetch(target, accept, max, timeoutMs) {
  let url = target;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    for (let hop = 0; hop < 5; hop++) {
      if (!brandTargetAllowed(url)) return null;
      const response = await fetch(url.href, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'User-Agent': BRAND_UA, Accept: accept, 'Accept-Language': 'en' },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('Location');
        if (!location) return null;
        url = new URL(location, url);
        continue;
      }
      if (!response.ok) return null;
      const body = await readCapped(response, max);
      if (!body) return null;
      return { url, contentType: (response.headers.get('Content-Type') || '').toLowerCase(), ...body };
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function sniffLogoType(bytes) {
  const b = bytes;
  if (b.length < 12) return '';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  const head = new TextDecoder().decode(b.subarray(0, 1024)).replace(/^﻿/, '').trimStart();
  if (head.startsWith('<') && /<svg[\s>]/i.test(head)) return 'image/svg+xml';
  return '';
}

function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

// Tries logo candidates in order, but never past the deadline, so a page
// full of dead logo links can't hold the whole lookup open.
async function fetchBrandLogo(candidates, deadline) {
  for (const candidate of candidates.slice(0, 4)) {
    const remaining = deadline - Date.now();
    if (remaining < 500) break;
    let url;
    try { url = new URL(candidate.url); } catch { continue; }
    const got = await brandFetch(url, 'image/svg+xml,image/png,image/webp,image/jpeg,image/gif;q=0.8', BRAND_LOGO_MAX, Math.min(4000, remaining));
    if (!got || got.truncated) continue;
    const type = sniffLogoType(got.bytes);
    if (!type) continue;
    return { dataUri: `data:${type};base64,${bytesToBase64(got.bytes)}`, type, source: candidate.kind };
  }
  return null;
}

// POST { url } from the generator; GET ?url= for quick checks from a browser.
async function brandResponse(request, env, url) {
  if (request.method !== 'POST' && request.method !== 'GET') return apiError(405, 'method_not_allowed');
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const limited = await enforceRateLimit(env, `brand:${ip}`);
  if (limited) return limited;

  let site = url.searchParams.get('url');
  if (request.method === 'POST') {
    const raw = await readRequestText(request, 4000);
    if (raw.error) return raw.error;
    try {
      const body = JSON.parse(raw.text);
      site = body && body.url;
    } catch {
      return apiError(400, 'invalid_json');
    }
  }
  const target = normalizeBrandSite(site);
  if (!target) return apiError(400, 'invalid_url');

  const started = Date.now();
  const page = await brandFetch(target, 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', BRAND_HTML_MAX, 7000);
  if (!page) return apiError(422, 'site_unreachable');
  if (page.contentType && !/html|xml/.test(page.contentType)) return apiError(422, 'site_not_html');

  const html = new TextDecoder().decode(page.bytes);
  const brand = extractBrand(html, page.url.href);
  const stylesheet = pickStylesheet(brand.stylesheets, page.url.href);

  const [css, manifest, logo] = await Promise.all([
    stylesheet ? brandFetch(new URL(stylesheet), 'text/css,*/*;q=0.1', BRAND_CSS_MAX, 4000) : null,
    !brand.themeColor && brand.manifestUrl ? brandFetch(new URL(brand.manifestUrl), 'application/manifest+json,application/json', 100_000, 3000) : null,
    fetchBrandLogo(brand.logos, started + 12000),
  ]);

  let themeColor = brand.themeColor;
  if (!themeColor && manifest) {
    try {
      themeColor = normalizeHex(JSON.parse(new TextDecoder().decode(manifest.bytes)).theme_color);
    } catch { /* not JSON */ }
  }
  const cssText = brand.inlineCss + '\n' + (css && /css|text\/plain/.test(css.contentType || 'text/css') ? new TextDecoder().decode(css.bytes) : '');
  const colors = rankColors(cssText, themeColor);

  return new Response(JSON.stringify({
    ok: true,
    site: page.url.origin + '/',
    company: brand.company,
    phone: brand.phone,
    social: brand.social,
    colors,
    logo,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}

// ── Main Worker ──────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    return withTransportSecurity(await handleUnsafely(request, env));
  },
};

async function handleUnsafely(request, env) {
    try {
      return await handleRequest(request, env);
    } catch (err) {
      const pathname = new URL(request.url).pathname;
      // Route and error name only: paths and R2 messages can carry saved-signature
      // ids, legacy customer ids, and storage keys.
      logServerError('unhandled_error', { route: routeLabel(pathname), error: (err && err.name) || 'Error' });
      if (pathname.startsWith('/api/')) {
        return new Response(JSON.stringify({ error: 'server_error', code: 'server_error' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        });
      }
      return new Response('Something went wrong. Please try again.', { status: 500 });
    }
}

// The fixed part of a path, never an id: '/api/signature/abc' -> '/api/signature',
// '/u/abc/photo.jpg' -> '/u'.
function routeLabel(pathname) {
  const parts = pathname.split('/');
  return parts.slice(0, parts[1] === 'api' ? 3 : 2).join('/') || '/';
}

// Uptime monitors poll this. It reports only whether each dependency is wired
// up, never a value, and touches R2 with a single cheap HEAD.
async function healthResponse(env) {
  const checks = {
    assets: Boolean(env.ASSETS && typeof env.ASSETS.fetch === 'function'),
    signing: Boolean(env.PRO_SIGNING_SECRET),
    webhook: Boolean(env.STRIPE_WEBHOOK_SECRET),
    stripeMode: ['true', 'false'].includes(env.STRIPE_LIVEMODE),
    paymentLink: /^plink_[A-Za-z0-9]+$/.test(env.STRIPE_PAYMENT_LINK_ID || ''),
    rateLimit: Boolean(env.RATE_LIMIT && typeof env.RATE_LIMIT.limit === 'function'),
    storage: false,
  };
  // Once the live site sells the team pack, the Worker must recognise its
  // link, or buyers would pay and never get access. The sandbox has no team link.
  if (FACTS.teamPaymentLink && env.STRIPE_LIVEMODE === 'true') {
    checks.teamPaymentLink = planForPaymentLink(env.STRIPE_TEAM_PAYMENT_LINK_ID, env) === 'team';
  }
  // Purchase emails are dormant until PURCHASE_EMAILS_FROM is set; once it is,
  // a missing sending credential fails the health check rather than silently
  // skipping buyers' access emails.
  if (env.PURCHASE_EMAILS_FROM) checks.purchaseEmails = PURCHASE_EMAILS.configured(env);
  const bucket = uploadBucket(env);
  if (bucket) {
    try {
      await bucket.head('health/probe');
      checks.storage = true;
    } catch {
      checks.storage = false;
    }
  }
  const ok = Object.values(checks).every(Boolean);
  if (!ok) logServerError('health_failed', { failing: Object.keys(checks).filter((k) => !checks[k]) });
  return new Response(JSON.stringify({ ok, checks }), {
    status: ok ? 200 : 503,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

async function handleRequest(request, env) {
    const url = new URL(request.url);

    const discovery = await agentDiscoveryResponse(request);
    if (discovery) {
      const headers = addSecurityHeaders(discovery);
      if (env.SANDBOX_MODE === 'true') headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
      return new Response(discovery.body, { status: discovery.status, headers });
    }

    if (url.pathname === '/api/health') {
      if (request.method !== 'GET' && request.method !== 'HEAD') return apiError(405, 'method_not_allowed');
      return healthResponse(env);
    }

    if (url.pathname === GOOGLE_SITE_VERIFICATION_FILE) {
      return new Response(`${GOOGLE_SITE_VERIFICATION_BODY}\n`, {
        headers: { 'Content-Type': 'text/html; charset=UTF-8' },
      });
    }

    const replacementPath = SEO_REPLACEMENT_REDIRECTS[url.pathname];
    if (replacementPath) return permanentRedirect(url, replacementPath);

    if (REMOVED_SEO_PATH.test(url.pathname)) return notFoundResponse();

    if (url.pathname === '/api/brand') return brandResponse(request, env, url);
    if (url.pathname.startsWith('/api/v1/agent/')) return AGENT_REGISTRATION(request, env);
    if (url.pathname === '/a2a' || url.pathname.startsWith('/a2a/')) return bulkA2aResponse(request, env, {
      authorize: (req, bindings) => authorizeBulkRequest(req, bindings, BULK_ACCESS.authorize),
    });
    if (url.pathname === '/api/v1/access-key') return BULK_ACCESS.manage(request, env);
    if (url.pathname === '/api/v1/signatures/batch' || url.pathname === '/api/v1/templates') return bulkApiResponse(request, env, url, BULK_ACCESS.authorize);
    if (url.pathname === '/mcp') return bulkMcpResponse(request, env, {
      authorize: (req, bindings) => authorizeBulkRequest(req, bindings, BULK_ACCESS.authorize),
    });
    if (url.pathname === '/api/team' || url.pathname.startsWith('/api/team/')) return teamResponse(request, env, url);

    // ── API: Verify Payment (Stripe redirect landing) ────────────────────────
    if (url.pathname === '/api/verify-payment') {
      if (request.method !== 'GET') return apiError(405, 'method_not_allowed');
      const sessionId = url.searchParams.get('session_id');

      // No query: the emailed link, whose session id is in the fragment.
      if (!sessionId) {
        return url.search ? paymentProblemResponse('missing_session') : paymentRestorePageResponse();
      }

      if (!env.STRIPE_PAYMENT_LINK_ID || !env.PRO_SIGNING_SECRET || !uploadBucket(env)) {
        return paymentProblemResponse('server_misconfiguration');
      }

      // Stripe records the paid session through the signed webhook before this
      // landing page can redeem it. No Stripe API key is stored in the Worker.
      const entitlement = await redeemCheckoutSession(sessionId, env);
      if (!entitlement.active) {
        if (entitlement.reason === 'confirmation_pending') {
          return paymentConfirmationPendingResponse(url);
        }
        return paymentProblemResponse(entitlement.reason === 'invalid_session' ? 'missing_session' : entitlement.reason);
      }

      // Create a signed JWT. The subject is an opaque entitlement id, never a
      // Stripe customer or payment identifier. Access is lifetime: the R2
      // entitlement decides validity, and `exp` is set far out only because the
      // token format requires one (see verifyProAccess).
      const now = Math.floor(Date.now() / 1000);
      const hundredYears = 100 * 365 * 24 * 60 * 60;
      const token = await signJwt(
        { sub: entitlement.id, ent: 1, iat: now, exp: now + hundredYears },
        env.PRO_SIGNING_SECRET
      );

      // The token goes in the fragment, which browsers never send to a server,
      // so it stays out of request logs, Referer headers and analytics.
      const redirectUrl = new URL(entitlement.returnTo === 'bulk' ? '/bulk' : '/generator', url.origin);
      redirectUrl.hash = `token=${token}`;
      return new Response(null, {
        status: 302,
        headers: {
          Location: redirectUrl.toString(),
          'Cache-Control': 'no-store, private',
          'Referrer-Policy': 'no-referrer',
          'X-Robots-Tag': 'noindex, nofollow',
        },
      });
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

      // Bounded before the signature check, so an unsigned body cannot exhaust
      // memory. Stripe event payloads are far below this.
      const webhookBody = await readRequestText(request, MAX_WEBHOOK_BYTES);
      if (webhookBody.error) return webhookBody.error;
      const payload = webhookBody.text;
      const signature = request.headers.get('Stripe-Signature') || '';
      if (!await verifyStripeWebhookSignature(payload, signature, env.STRIPE_WEBHOOK_SECRET)) {
        // A rotated or mistyped STRIPE_WEBHOOK_SECRET fails every purchase here,
        // so it is logged even though the response is a 4xx.
        logServerError('webhook_signature_rejected', { hasSignature: Boolean(signature) });
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
      let emailPurchase = null;
      if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
        const stripeResult = stripeResultFromSession(object, env);
        if (stripeResult.paid) {
          const entitlement = await storeActiveEntitlement(env, stripeResult, 'stripe_webhook');
          if (entitlement.active) emailPurchase = { ...stripeResult, id: entitlement.id };
        }
      } else if (event.type === 'charge.refunded' && isFullyRefundedCharge(object)) {
        // Only a full refund ends access. A partial (goodwill) refund leaves the
        // purchase, and every team seat on it, active. refund.* events carry a
        // single refund, not the charge total, so they cannot show a full refund;
        // Stripe also sends charge.refunded for every refund, which is used here.
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

      // Access is durable before email delivery. A failed send returns 503 so
      // Stripe retries, while the buyer can still finish the checkout redirect.
      // Without PURCHASE_EMAILS_FROM and RESEND_API_KEY this does nothing.
      try {
        await PURCHASE_EMAILS.handle(event, env, emailPurchase);
      } catch {
        return apiError(503, 'purchase_email_delivery_failed');
      }

      return new Response(JSON.stringify({ received: true }), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }

    // Verify the signed token and its current server-side entitlement.
    if (url.pathname === '/api/verify-token' && request.method === 'POST') {
      const tokenResult = (body, status = 200) => new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
      try {
        if (!env.PRO_SIGNING_SECRET) {
          logServerError('api_error', { status: 500, code: 'verify_token_misconfigured' });
          return tokenResult({ valid: false, reason: 'server_misconfiguration' }, 500);
        }
        const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
        const limited = await enforceRateLimit(env, `verify-token:${ip}`);
        if (limited) return limited;

        // A malformed request is the caller's mistake: a 400, never an error log.
        const raw = await readRequestText(request, MAX_VERIFY_TOKEN_BODY_BYTES);
        if (raw.error) return tokenResult({ valid: false, reason: raw.error.status === 413 ? 'too_large' : 'invalid_body' }, raw.error.status);
        let body;
        try {
          body = JSON.parse(raw.text);
        } catch {
          return tokenResult({ valid: false, reason: 'invalid_json' }, 400);
        }
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          return tokenResult({ valid: false, reason: 'invalid_json' }, 400);
        }
        const token = body.token;
        if (token === undefined || token === '') return tokenResult({ valid: false, reason: 'missing_token' });
        if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH) {
          return tokenResult({ valid: false, reason: 'invalid_token' }, 400);
        }

        const result = await verifyProAccess(token, env);
        if (result.status >= 500) logServerError('api_error', { status: result.status, code: result.reason });
        const publicResult = result.valid
          ? { valid: true, plan: teamOwnerPlan(result) ? 'team' : 'pro' }
          : { valid: false, reason: result.reason };
        return tokenResult(publicResult, result.status || 200);
      } catch (err) {
        logServerError('api_error', { status: 500, code: 'verify_token_failed', error: (err && err.name) || 'Error' });
        return tokenResult({ valid: false, reason: 'server_error' }, 500);
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

      // Photo, logo and animated-GIF retries all share the same customer budget.
      const uploadLimited = await enforceRateLimit(env, `upload:${sub}`);
      if (uploadLimited) return uploadLimited;

      // Read the body under the same cap, whether or not Content-Length was sent.
      const uploadBody = await readRequestBytes(request, MAX_BYTES);
      if (uploadBody.error) return uploadBody.error;
      const buf = uploadBody.bytes.buffer;
      if (buf.byteLength === 0) return apiError(400, 'empty_body');

      // Magic-byte sniff (authoritative — ignore client-declared MIME)
      const sniffed = sniffImage(buf);
      if (!sniffed) return apiError(415, 'unsupported_format');

      // Team colleagues share the buyer's entitlement, so each gets their own
      // folder; a buyer's id is unchanged, so existing image links keep working.
      const uploadId = await publicUploadId(cardOwnerId(verified.payload), env.PRO_SIGNING_SECRET);

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
    // A `-c` suffix renders the "circle" style: a brand-coloured disc with the
    // glyph knocked out in white.
    if (url.pathname.startsWith('/i/')) {
      const match = url.pathname.match(/^\/i\/([a-z]+)-([0-9a-fA-F]{6})(-c)?\.png$/);
      if (!match) return notFoundResponse();

      const [, platform, hex, circle] = match;
      if (!ICON_PLATFORMS.includes(platform)) return notFoundResponse();

      const mask = decodeMask(platform);
      if (!mask || mask.length !== ICON_SIZE * ICON_SIZE) return notFoundResponse();

      const rgb = [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
      ];
      const png = PngEncoder.encode(
        circle
          ? PngEncoder.discMask(mask, ICON_SIZE, rgb)
          : PngEncoder.tintMask(mask, ICON_SIZE, ICON_SIZE, rgb),
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
      const signatureLimited = await enforceRateLimit(env, `signature:${verified.payload.sub}`);
      if (signatureLimited) return signatureLimited;

      const MAX_SIGNATURE_BYTES = 32_000;
      const declaredLen = parseInt(request.headers.get('Content-Length') || '', 10);
      if (declaredLen > MAX_SIGNATURE_BYTES) return apiError(413, 'too_large');

      const signatureBody = await readRequestText(request, MAX_SIGNATURE_BYTES);
      if (signatureBody.error) return signatureBody.error;
      const raw = signatureBody.text;
      if (!raw) return apiError(400, 'empty_body');

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
      const ownerId = cardOwnerId(verified.payload);
      const cardLimited = await enforceRateLimit(env, `card:${sub}`);
      if (cardLimited) return cardLimited;

      const MAX_CARD_BYTES = 16_000;
      const declaredLen = parseInt(request.headers.get('Content-Length') || '', 10);
      if (declaredLen > MAX_CARD_BYTES) return apiError(413, 'too_large');

      const cardBody = await readRequestText(request, MAX_CARD_BYTES);
      if (cardBody.error) return cardBody.error;
      const raw = cardBody.text;
      if (!raw) return apiError(400, 'empty_body');

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
      const ownerPrefix = await cardOwnerPrefix(sub, env.PRO_SIGNING_SECRET);

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
        if (owner !== ownerId) return apiError(403, 'not_your_card');
        // Cards published before the ledger existed join it here, best effort:
        // they already exist, so the cap does not apply to replacing them.
        await updateCardLedger(bucket, ownerPrefix, (slugs) => (slugs.includes(slug) ? null : [...slugs, slug]));
      } else {
        slug = `${slugifyName(card.fullName)}-${randomSuffix()}`;
        const reserved = await updateCardLedger(bucket, ownerPrefix, (slugs) => (
          slugs.length >= MAX_CARDS_PER_BUYER ? 'card_limit_reached' : [...slugs, slug]
        ));
        if (reserved === 'card_limit_reached') {
          return apiError(409, 'card_limit_reached', String(MAX_CARDS_PER_BUYER));
        }
        if (reserved !== 'ok') return apiError(409, 'card_busy');
      }

      // The ledger and index entry go first, so a failed card write can only over-count
      // (and a DELETE of that slug clears it), never leave a live uncounted page.
      // Written on every publish, so cards published before the index existed
      // join it the next time their owner republishes them.
      await bucket.put(`${ownerPrefix}${slug}`, '', {
        httpMetadata: { contentType: 'text/plain', cacheControl: 'no-store' },
      });
      await bucket.put(`cards/${slug}.json`, JSON.stringify({ ...card, owner: ownerId, updatedAt: Date.now() }), {
        httpMetadata: { contentType: 'application/json', cacheControl: 'no-store' },
        // Lets the cards sitemap skip thin cards without reading every card body.
        customMetadata: { indexable: isThinCard(card) ? '0' : '1' },
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

      // The index entry lives under the caller's own prefix, so clearing it is
      // safe even when the card is already gone. That way a retry after a
      // half-finished delete still frees the slot instead of hitting a 404 first.
      const ownerPrefix = await cardOwnerPrefix(sub, env.PRO_SIGNING_SECRET);
      const ownerIndexKey = `${ownerPrefix}${match[1]}`;
      const releaseSlot = async () => {
        await bucket.delete(ownerIndexKey);
        // A failed ledger update only over-counts; the next unpublish retries it.
        await updateCardLedger(bucket, ownerPrefix, (slugs) => (slugs.includes(match[1]) ? slugs.filter((slug) => slug !== match[1]) : null));
      };
      const existing = await bucket.get(`cards/${match[1]}.json`);
      if (!existing) {
        await releaseSlot();
        return apiError(404, 'not_found');
      }
      let owner = null;
      try {
        owner = JSON.parse(await existing.text()).owner;
      } catch {
        owner = null;
      }
      if (owner !== cardOwnerId(verified.payload)) return apiError(403, 'not_your_card');

      await bucket.delete(`cards/${match[1]}.json`);
      await releaseSlot();
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
      if (isThinCard(card)) headers.set('X-Robots-Tag', 'noindex, follow');
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
        const listed = await bucket.list({ prefix: 'cards/', limit: 1000, cursor, include: ['customMetadata'] });
        for (const obj of listed.objects) {
          // Cards published before the flag existed have no metadata and stay
          // listed until their owner republishes; their page still sends noindex.
          if (obj.customMetadata && obj.customMetadata.indexable === '0') continue;
          const slug = obj.key.replace(/^cards\//, '').replace(/\.json$/, '');
          if (/^[a-z0-9-]{1,64}$/.test(slug)) slugs.push(slug);
        }
        cursor = listed.truncated ? listed.cursor : undefined;
      } while (cursor && slugs.length < SITEMAP_URL_LIMIT);

      let urls = slugs
        .slice(0, SITEMAP_URL_LIMIT)
        .map((slug) => `  <url><loc>${url.origin}/c/${slug}</loc><changefreq>monthly</changefreq></url>`)
        .join('\n');

      // Google rejects an empty urlset. List the card publishing page until an indexable card exists.
      if (!urls) {
        const generatorPath = new URL(FACTS.generatorUrl).pathname;
        urls = `  <url><loc>${url.origin}${generatorPath}</loc></url>`;
      }

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

    if (response.status === 404) response = notFoundResponse();

    // Add security headers to all responses
    const newHeaders = addSecurityHeaders(response, ['/bulk', '/bulk.html', '/connect-agent', '/connect-agent.html', '/js/bulk-spreadsheet-worker.js'].includes(url.pathname));
    if (['/connect-agent', '/connect-agent.html'].includes(url.pathname)) {
      newHeaders.set('Cache-Control', 'no-store, private');
      newHeaders.set('X-Robots-Tag', 'noindex, nofollow');
      newHeaders.set('Content-Security-Policy', "default-src 'none'; script-src 'self' https://static.cloudflareinsights.com; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self'; connect-src 'self' https://cloudflareinsights.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    }
    if (response.status === 200 && (response.headers.get('Content-Type') || '').includes('text/html')) {
      newHeaders.append('Link', agentDiscoveryLinks());
      if (url.pathname === '/') {
        const vary = newHeaders.get('Vary');
        newHeaders.set('Vary', vary ? `${vary}, Accept` : 'Accept');
      }
    }
    if (env.SANDBOX_MODE === 'true') {
      newHeaders.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
}

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

// A card with only a name (no job title or company), or with no website or
// profile link, is too thin to help search. Its page still works when shared,
// but it stays out of the index and the cards sitemap.
function isThinCard(card) {
  const hasRole = Boolean(card.title || card.company);
  const hasLink = CARD_LINK_FIELDS.some((field) => card[field]);
  return !hasRole || !hasLink;
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
${isThinCard(card) ? '<meta name="robots" content="noindex, follow">' : ''}
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
 .save { display:inline-block; margin-top:24px; padding:11px 20px; border-radius:999px;
         background:#1d1d1f; color:#fff; text-decoration:none; font-size:14px; font-weight:600; }
 .footer { margin-top:24px; font-size:12px; color:#9aa3ad; }
 .footer a { color:#6b7280; }
 @media (prefers-color-scheme: dark) {
   body { background:#0f1214; color:#e8eaec; }
   .card { background:#171a1d; border-color:#272b30; }
   .row { border-color:#272b30; }
   .value { color:#c8ccd0; }
   .save { background:#f5f5f7; color:#1d1d1f; }
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

// The removed /api/upload stored photos at the bucket root as `<uuid>.<ext>`.
// Entitlements, checkout sessions, cards and saved signatures share the bucket,
// so only that exact legacy key shape may be read through this route.
const LEGACY_PHOTO_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|gif|webp)$/;
const LEGACY_PHOTO_TYPES = { jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };

async function handleLegacyPhoto(env, url) {
  const bucket = uploadBucket(env);
  if (!bucket) return new Response('Storage not configured', { status: 500 });

  const key = url.pathname.slice('/photos/'.length);
  const match = key.match(LEGACY_PHOTO_KEY);
  if (!match) return new Response('Not Found', { status: 404 });

  const object = await bucket.get(key);
  if (!object) return new Response('Not Found', { status: 404 });

  const headers = new Headers();
  headers.set('Content-Type', LEGACY_PHOTO_TYPES[match[1]]);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('ETag', object.httpEtag);
  headers.set('X-Content-Type-Options', 'nosniff');

  return new Response(object.body, { headers });
}
