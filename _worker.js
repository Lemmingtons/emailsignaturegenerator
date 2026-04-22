// Cloudflare Worker for Email Signature Generator
// Handles: clean URL rewriting, security headers, and Pro payment verification

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
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://js.stripe.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; frame-src https://js.stripe.com; img-src 'self' data: https:; connect-src 'self' https://api.stripe.com"
  );
  return newHeaders;
}

// ── Main Worker ──────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

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

    // ── Static Asset Serving ─────────────────────────────────────────────────
    let response = await env.ASSETS.fetch(request);

    // If 404 and path has no file extension, try appending .html for clean URLs
    if (response.status === 404 && !url.pathname.match(/\.[a-zA-Z0-9]+$/)) {
      const htmlUrl = new URL(request.url);
      htmlUrl.pathname = url.pathname.replace(/\/$/, '') + '.html';
      const htmlRequest = new Request(htmlUrl.toString(), request);
      const htmlResponse = await env.ASSETS.fetch(htmlRequest);
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
