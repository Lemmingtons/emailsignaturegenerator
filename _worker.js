export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ── Image Upload ──
    if (request.method === 'POST' && url.pathname === '/api/upload') {
      return handleUpload(request, env, url);
    }

    // ── Image Serve ──
    if (request.method === 'GET' && url.pathname.startsWith('/photos/')) {
      return handlePhoto(request, env, url);
    }

    // ── Static Assets ──
    let response = await env.ASSETS.fetch(request);

    // Clean URL fallback: /seo/email-signature-for-lawyers → .html
    if (response.status === 404 && !url.pathname.match(/\.[a-zA-Z0-9]+$/)) {
      const htmlUrl = new URL(request.url);
      htmlUrl.pathname = url.pathname.replace(/\/$/, '') + '.html';
      const htmlRequest = new Request(htmlUrl.toString(), request);
      const htmlResponse = await env.ASSETS.fetch(htmlRequest);
      if (htmlResponse.status === 200) {
        response = htmlResponse;
      }
    }

    const newHeaders = new Headers(response.headers);
    newHeaders.set('X-Frame-Options', 'DENY');
    newHeaders.set('X-Content-Type-Options', 'nosniff');
    newHeaders.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    newHeaders.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    newHeaders.set(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline' https://js.stripe.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; frame-src https://js.stripe.com; img-src 'self' data: https:; connect-src 'self' https://api.stripe.com"
    );

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  },
};

async function handleUpload(request, env, url) {
  let formData;
  try {
    formData = await request.formData();
  } catch {
    return jsonError('Invalid form data', 400);
  }

  const file = formData.get('photo');
  if (!file || typeof file.arrayBuffer !== 'function') {
    return jsonError('No photo field', 400);
  }

  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (!ALLOWED_TYPES.includes(file.type)) {
    return jsonError('Only JPEG, PNG, GIF and WebP images are allowed', 415);
  }

  const buf = await file.arrayBuffer();
  if (buf.byteLength > 5 * 1024 * 1024) {
    return jsonError('Image must be under 5 MB', 413);
  }

  const extMap = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' };
  const key = `${crypto.randomUUID()}.${extMap[file.type]}`;

  await env.PHOTOS.put(key, buf, { httpMetadata: { contentType: file.type } });

  return new Response(JSON.stringify({ url: `${url.origin}/photos/${key}` }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

async function handlePhoto(request, env, url) {
  const key = url.pathname.slice('/photos/'.length);
  if (!key) return new Response('Not Found', { status: 404 });

  const object = await env.PHOTOS.get(key);
  if (!object) return new Response('Not Found', { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('ETag', object.httpEtag);

  return new Response(object.body, { headers });
}

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
