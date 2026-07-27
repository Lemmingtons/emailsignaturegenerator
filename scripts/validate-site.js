#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const fromRoot = (file) => path.join(root, file);

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

// The icon styles the generator actually offers, read from the markup rather than
// hardcoded, so a new toggle is covered by the checks below the moment it ships.
function iconStylesOffered() {
  const html = fs.readFileSync(fromRoot('generator.html'), 'utf8');
  const group = html.match(/id="icon-style-toggles"[\s\S]*?<\/div>/);
  if (!group) {
    fail('generator.html no longer has an #icon-style-toggles group');
    return [];
  }
  return [...group[0].matchAll(/data-value="([^"]+)"/g)].map((m) => m[1]);
}

function checkSyntax(file, mode) {
  const args = ['--check'];
  const options = { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] };
  if (mode === 'module') {
    args.push('--input-type=module');
    options.input = fs.readFileSync(fromRoot(file));
    options.stdio = ['pipe', 'pipe', 'pipe'];
  } else {
    args.push(file);
  }
  try {
    execFileSync(process.execPath, args, options);
  } catch (err) {
    fail(`${file} failed syntax check:\n${String(err.stderr || err.message)}`);
  }
}

function checkWorkerBehavior() {
  const script = [
    "import fs from 'node:fs';",
    // Imported from its real path, not a data: URL, so the Worker's own relative
    // imports (the PNG encoder) resolve the way they do under wrangler.
    "const worker = await import(new URL('_worker.js', 'file://' + process.cwd() + '/').href);",
    "function text(value) { return new TextEncoder().encode(value); }",
    "function b64url(value) { return Buffer.from(value).toString('base64').replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/g, ''); }",
    "async function signJwt(payload, secret) {",
    "  const header = b64url(text(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));",
    "  const body = b64url(text(JSON.stringify(payload)));",
    "  const input = header + '.' + body;",
    "  const key = await crypto.subtle.importKey('raw', text(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);",
    "  const sig = await crypto.subtle.sign('HMAC', key, text(input));",
    "  return input + '.' + b64url(sig);",
    "}",
    "const stored = new Map();",
    "const bucket = {",
    "  delete: async (key) => { stored.delete(key); },",
    "  put: async (key, body, options) => { stored.set(key, { body, httpMetadata: options.httpMetadata }); },",
    "  get: async (key) => {",
    "    const value = stored.get(key);",
    "    if (!value) return null;",
    "    return { body: value.body, httpMetadata: value.httpMetadata, httpEtag: 'test-etag', writeHttpMetadata(headers) { headers.set('Content-Type', value.httpMetadata.contentType); } };",
    "  },",
    "};",
    "const assetRequests = [];",
    "const env = { PRO_SIGNING_SECRET: 'test-secret', UPLOADS: bucket, ASSETS: { fetch: async (request) => {",
    "  const pathname = new URL(request.url).pathname;",
    "  assetRequests.push(pathname);",
    "  if (pathname === '/does-not-exist' || pathname === '/does-not-exist.html' || pathname === '/missing.js') return new Response('asset failure', { status: 500 });",
    "  if (pathname === '/scripts/validate-site.js') throw new Error('private asset path reached');",
    "  return new Response('missing', { status: 404 });",
    "} } };",
    "const token = await signJwt({ sub: 'cus_TEST123', exp: Math.floor(Date.now() / 1000) + 60 }, env.PRO_SIGNING_SECRET);",
    "const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0]);",
    "const upload = await worker.default.fetch(new Request('https://example.com/api/upload-image', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'image/jpeg', 'X-Image-Type': 'photo' }, body: jpeg }), env);",
    "if (upload.status !== 200) throw new Error('upload returned ' + upload.status + ': ' + await upload.text());",
    "const uploaded = await upload.json();",
    "if (uploaded.url.includes('cus_TEST123')) throw new Error('public upload URL exposes Stripe customer id');",
    "const served = await worker.default.fetch(new Request(uploaded.url), env);",
    "if (served.status !== 200) throw new Error('served upload returned ' + served.status);",
    "if (!uploaded.url.includes('/photo.jpg')) throw new Error('photo slot url mismatch: ' + uploaded.url);",
    // Logo slot: must store alongside the photo, not replace it.
    "const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);",
    "const logoUp = await worker.default.fetch(new Request('https://example.com/api/upload-image', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'image/png', 'X-Image-Type': 'logo' }, body: png }), env);",
    "if (logoUp.status !== 200) throw new Error('logo upload returned ' + logoUp.status + ': ' + await logoUp.text());",
    "const logoUploaded = await logoUp.json();",
    "if (!logoUploaded.url.includes('/logo.png')) throw new Error('logo slot url mismatch: ' + logoUploaded.url);",
    "if (logoUploaded.url.includes('cus_TEST123')) throw new Error('public logo URL exposes Stripe customer id');",
    "const logoServed = await worker.default.fetch(new Request(logoUploaded.url), env);",
    "if (logoServed.status !== 200) throw new Error('served logo returned ' + logoServed.status);",
    "const photoStillThere = await worker.default.fetch(new Request(uploaded.url), env);",
    "if (photoStillThere.status !== 200) throw new Error('logo upload evicted the photo slot');",
    // Animated GIF support for the animated-photo feature.
    "const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0]);",
    "const gifUp = await worker.default.fetch(new Request('https://example.com/api/upload-image', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'image/gif', 'X-Image-Type': 'photo' }, body: gif }), env);",
    "if (gifUp.status !== 200) throw new Error('gif upload returned ' + gifUp.status + ': ' + await gifUp.text());",
    "const gifUploaded = await gifUp.json();",
    "if (gifUploaded.contentType !== 'image/gif') throw new Error('gif content type mismatch: ' + gifUploaded.contentType);",
    "const gifServed = await worker.default.fetch(new Request(gifUploaded.url), env);",
    "if (gifServed.status !== 200) throw new Error('served gif returned ' + gifServed.status);",
    "if (gifServed.headers.get('Content-Type') !== 'image/gif') throw new Error('served gif content type mismatch');",
    // Uploading a GIF into the photo slot must evict the previous jpg for that slot.
    "const evictedJpg = await worker.default.fetch(new Request(uploaded.url), env);",
    "if (evictedJpg.status !== 404) throw new Error('same-slot different-extension file was not evicted');",
    // Unknown slots are rejected outright.
    "const badSlot = await worker.default.fetch(new Request('https://example.com/api/upload-image', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'image/png', 'X-Image-Type': 'banner' }, body: png }), env);",
    "if (badSlot.status !== 400) throw new Error('unknown image slot returned ' + badSlot.status);",
    // Social icons: tinted PNGs rendered on demand from masks embedded in the bundle.
    "const icon = await worker.default.fetch(new Request('https://example.com/i/linkedin-0891b2.png'), env);",
    "if (icon.status !== 200) throw new Error('icon returned ' + icon.status);",
    "if (icon.headers.get('Content-Type') !== 'image/png') throw new Error('icon content type mismatch');",
    "const iconBytes = new Uint8Array(await icon.arrayBuffer());",
    "const pngSig = [137, 80, 78, 71, 13, 10, 26, 10];",
    "if (!pngSig.every((b, i) => iconBytes[i] === b)) throw new Error('icon is not a PNG');",
    // Different platforms and different tints must produce different bytes.
    "const iconB = await worker.default.fetch(new Request('https://example.com/i/facebook-0891b2.png'), env);",
    "const bytesB = new Uint8Array(await iconB.arrayBuffer());",
    "if (iconBytes.length === bytesB.length && iconBytes.every((b, i) => b === bytesB[i])) throw new Error('different platforms produced identical icons');",
    "const iconC = await worker.default.fetch(new Request('https://example.com/i/linkedin-ea580c.png'), env);",
    "const bytesC = new Uint8Array(await iconC.arrayBuffer());",
    "if (iconBytes.length === bytesC.length && iconBytes.every((b, i) => b === bytesC[i])) throw new Error('different tints produced identical icons');",
    // Reject anything not on the allow-list.
    "const badIcon = await worker.default.fetch(new Request('https://example.com/i/nonsense-0891b2.png'), env);",
    "if (badIcon.status !== 404) throw new Error('unknown icon platform returned ' + badIcon.status);",
    "const badHex = await worker.default.fetch(new Request('https://example.com/i/linkedin-zzzzzz.png'), env);",
    "if (badHex.status !== 404) throw new Error('invalid icon hex returned ' + badHex.status);",
    // Saved signatures: Pro-gated write, capability-id read, no personal data cached.
    "const sigBody = JSON.stringify({ version: 1, template: 'classic', data: { fullName: 'Jane Smith', email: 'jane@example.com' }, style: { primaryColor: '#0891B2' } });",
    "const sigSave = await worker.default.fetch(new Request('https://example.com/api/signature', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: sigBody }), env);",
    "if (sigSave.status !== 200) throw new Error('signature save returned ' + sigSave.status + ': ' + await sigSave.text());",
    "const saved = await sigSave.json();",
    "if (!/^[A-Za-z0-9_-]{40,64}$/.test(saved.id)) throw new Error('signature id is not an opaque capability: ' + saved.id);",
    "if (saved.id.includes('cus_TEST123')) throw new Error('signature id exposes Stripe customer id');",
    "const sigRead = await worker.default.fetch(new Request('https://example.com/api/signature/' + saved.id), env);",
    "if (sigRead.status !== 200) throw new Error('signature read returned ' + sigRead.status);",
    "if (!(sigRead.headers.get('Cache-Control') || '').includes('no-store')) throw new Error('saved signature must not be cached');",
    "const readBack = await sigRead.json();",
    "if (readBack.data.fullName !== 'Jane Smith') throw new Error('saved signature did not round-trip');",
    "const sigNoAuth = await worker.default.fetch(new Request('https://example.com/api/signature', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: sigBody }), env);",
    "if (sigNoAuth.status !== 401) throw new Error('unauthenticated signature save returned ' + sigNoAuth.status);",
    "const sigBadJson = await worker.default.fetch(new Request('https://example.com/api/signature', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: 'not json' }), env);",
    "if (sigBadJson.status !== 400) throw new Error('malformed signature save returned ' + sigBadJson.status);",
    "const sigMissing = await worker.default.fetch(new Request('https://example.com/api/signature/" + 'A'.repeat(43) + "'), env);",
    "if (sigMissing.status !== 404) throw new Error('unknown signature id returned ' + sigMissing.status);",
    "const legacy = await worker.default.fetch(new Request('https://example.com/api/upload', { method: 'POST' }), env);",
    "if (legacy.status !== 410) throw new Error('legacy upload returned ' + legacy.status);",
    "const missingRoute = await worker.default.fetch(new Request('https://example.com/does-not-exist'), env);",
    "if (missingRoute.status !== 404) throw new Error('missing clean route returned ' + missingRoute.status);",
    "const missingAsset = await worker.default.fetch(new Request('https://example.com/missing.js'), env);",
    "if (missingAsset.status !== 404) throw new Error('missing asset returned ' + missingAsset.status);",
    "const privateAsset = await worker.default.fetch(new Request('https://example.com/scripts/validate-site.js'), env);",
    "if (privateAsset.status !== 404) throw new Error('private asset returned ' + privateAsset.status);",
    "if (assetRequests.includes('/scripts/validate-site.js')) throw new Error('private asset reached static asset binding');",
    "const noAssets = await worker.default.fetch(new Request('https://example.com/does-not-exist'), { PRO_SIGNING_SECRET: 'test-secret', UPLOADS: bucket });",
    "if (noAssets.status !== 404) throw new Error('missing asset binding returned ' + noAssets.status);",
    "const googleVerify = await worker.default.fetch(new Request('https://example.com/googlee8f6af86faea90b4.html'), {});",
    "if (googleVerify.status !== 200) throw new Error('google verification returned ' + googleVerify.status);",
    "if ((await googleVerify.text()).trim() !== 'google-site-verification: googlee8f6af86faea90b4.html') throw new Error('google verification body mismatch');",
  ].join('\n');

  try {
    execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    fail(`Worker behavior check failed:\n${String(err.stderr || err.message)}`);
  }
}

function read(file) {
  return fs.readFileSync(fromRoot(file), 'utf8');
}

function assert(condition, message) {
  if (!condition) fail(message);
}

checkSyntax('js/site-facts.js');
checkSyntax('js/generator-core.js');
checkSyntax('js/templates.js');
checkSyntax('js/gif-encoder.js');
checkSyntax('js/photo-animator.js');
checkSyntax('js/sweep-animator.js');
checkSyntax('js/motion.js');
checkSyntax('js/app.js');
checkSyntax('js/health-check.js');
checkSyntax('generate-pages.js');
checkSyntax('update-sitemap.js');
checkSyntax('automation/send-email.js');
checkSyntax('_worker.js', 'module');

const facts = require('../js/site-facts');
global.SiteFacts = facts;
const core = require('../js/generator-core');
const { TEMPLATES } = require('../js/templates');

const templates = Object.entries(TEMPLATES);
assert(templates.length === facts.templateCount, `Expected ${facts.templateCount} templates, found ${templates.length}`);
// Single paid plan: every template is available in the builder, and nothing in
// site-facts should reintroduce a free/paid template split.
assert(facts.freeTemplateCount === undefined, 'freeTemplateCount must not come back — there is one plan');
assert(facts.freeBrandingText === undefined, 'freeBrandingText must not come back — signatures carry no branding');

// Animated photo pipeline: the GIF must be structurally valid, animate, and keep
// frame 0 as the resting image (classic Outlook renders only that frame).
{
  const GifEncoder = require('../js/gif-encoder');
  const PhotoAnimator = require('../js/photo-animator');

  const size = 64;
  const photo = new Uint8ClampedArray(size * size * 4);
  const second = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      photo[i] = 40 + x * 2; photo[i + 1] = 90; photo[i + 2] = 200 - y; photo[i + 3] = 255;
      second[i] = 200 - x; second[i + 1] = 30 + y; second[i + 2] = 80; second[i + 3] = 255;
    }
  }

  for (const [id, spec] of Object.entries(PhotoAnimator.EFFECTS)) {
    const built = PhotoAnimator.buildFrames({
      photo, size, effect: id, shape: 'circle',
      background: '#ffffff', accentColor: '#0891B2',
      secondPhoto: spec.needsSecondPhoto ? second : null,
    });

    assert(built.frames.length === spec.frames, `${id} produced ${built.frames.length} frames, expected ${spec.frames}`);

    // Frame 0 must be the untouched photo inside the shape, so the Outlook still is
    // a clean headshot rather than a mid-animation state.
    const centre = ((size / 2) * size + size / 2) * 4;
    assert(
      Math.abs(built.frames[0][centre] - photo[centre]) <= 1,
      `${id} frame 0 must rest on the source photo at the centre`
    );

    // Corners sit outside the circle and must be the baked background, not stray pixels.
    assert(built.frames[0][0] === 255 && built.frames[0][1] === 255 && built.frames[0][2] === 255,
      `${id} must composite the circular mask onto the background colour`);

    // Something has to actually move.
    let moved = 0;
    const last = built.frames[built.frames.length - 1];
    for (const frame of built.frames) {
      for (let p = 0; p < frame.length; p += 4) {
        if (frame[p] !== built.frames[0][p]) { moved++; break; }
      }
    }
    assert(moved > 0, `${id} produced no motion`);
    assert(last.length === photo.length, `${id} final frame is the wrong size`);

    const bytes = GifEncoder.encode({
      width: size, height: size, frames: built.frames,
      delay: built.delay, loop: false, dither: false,
    });

    // Any effect declared loopable must return to its opening frame, or repeating
    // it would jump. The crossfade is correctly declared non-looping.
    if (spec.loops) {
      const opening = built.frames[0];
      const closing = built.frames[built.frames.length - 1];
      for (let p = 0; p < opening.length; p += 4) {
        assert(Math.abs(opening[p] - closing[p]) <= 1,
          `${id} is declared loopable but does not return to its opening frame`);
      }
    }

    assert(Buffer.from(bytes.subarray(0, 6)).toString('latin1') === 'GIF89a', `${id} missing GIF89a header`);
    assert(bytes[bytes.length - 1] === 0x3B, `${id} missing GIF trailer`);
    // One image descriptor (0x2C) per frame.
    let descriptors = 0;
    for (let i = 0; i < bytes.length - 1; i++) if (bytes[i] === 0x2C) descriptors++;
    assert(descriptors >= spec.frames, `${id} encoded ${descriptors} image descriptors for ${spec.frames} frames`);
    // Looping must stay off: the Netscape block is what makes a GIF repeat forever.
    assert(!Buffer.from(bytes).includes(Buffer.from('NETSCAPE2.0')), `${id} must not loop by default`);
  }

  // The breathing loop: one pass, then a long hold on the resting frame, repeating.
  // The hold must be near-free, or the whole approach is not worth having.
  {
    const size = 64;
    const spec = PhotoAnimator.EFFECTS.ring;
    const built = PhotoAnimator.buildFrames({
      photo, size, effect: 'ring', shape: 'circle',
      background: '#ffffff', accentColor: '#0891B2',
    });

    const once = GifEncoder.encode({
      width: size, height: size, frames: built.frames,
      delay: built.delay, loop: false, dither: false,
    });
    const breathing = GifEncoder.encode({
      width: size, height: size,
      frames: built.frames.concat([built.frames[0]]),
      delay: built.frames.map(() => built.delay).concat([500]),
      loop: true, dither: false,
    });

    const netscape = Buffer.from('NETSCAPE2.0');
    assert(!Buffer.from(once).includes(netscape), 'play-once GIF must omit the looping block');
    assert(Buffer.from(breathing).includes(netscape), 'breathing GIF must carry the looping block');
    assert(breathing.length < once.length * 1.05,
      `held frame is not free: ${once.length} -> ${breathing.length} bytes`);
    assert(spec.loops === true, 'ring must be declared loopable');
    assert(PhotoAnimator.EFFECTS.crossfade.loops === false,
      'crossfade must stay play-once: it ends on the second photo');
  }

  // The app must route every encode through the shared loop policy rather than
  // calling the encoder directly, so the two effects cannot drift apart.
  {
    const appSource = read('js/app.js');
    assert(appSource.includes('function encodeSignatureGif'), 'app must define the shared loop policy');
    assert(!/GifEncoder\.encode\(/.test(appSource.replace(/function encodeSignatureGif[\s\S]*?\n  }\n/, '')),
      'animation encoding must go through encodeSignatureGif, not GifEncoder.encode directly');
    assert(/ANIMATION_HOLD_CS = 500/.test(appSource), 'breathing hold should be 5 seconds');
  }

  // Frame differencing must actually shrink a static sequence.
  const still = [];
  for (let i = 0; i < 8; i++) still.push(photo.slice());
  const optimised = GifEncoder.encode({ width: size, height: size, frames: still, dither: false, optimise: true });
  const unoptimised = GifEncoder.encode({ width: size, height: size, frames: still, dither: false, optimise: false });
  assert(optimised.length * 2 < unoptimised.length,
    `Frame differencing ineffective: ${optimised.length} vs ${unoptimised.length} bytes`);
}

// Animated CTA button: frame 0 must be the resting button, motion must exist, and
// the templates must degrade to a text anchor when no CTA image is hosted.
{
  const GifEncoder = require('../js/gif-encoder');
  const SweepAnimator = require('../js/sweep-animator');

  const w = 160;
  const h = 40;
  const button = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    button[i] = 8; button[i + 1] = 145; button[i + 2] = 178; button[i + 3] = 255;
  }

  const built = SweepAnimator.buildFrames({ artwork: button, width: w, height: h });
  assert(built.frames.length === SweepAnimator.DEFAULTS.frames, 'CTA frame count mismatch');

  // Frame 0 and the final frame are the untouched button — the sheen enters and
  // leaves the canvas, so Outlook's first-frame still is a normal button.
  const first = built.frames[0];
  const last = built.frames[built.frames.length - 1];
  for (let i = 0; i < button.length; i += 4) {
    assert(Math.abs(first[i] - button[i]) <= 1, 'CTA frame 0 must equal the resting button');
    assert(Math.abs(last[i] - button[i]) <= 1, 'CTA final frame must return to rest');
  }

  // A middle frame must actually be brighter somewhere.
  const mid = built.frames[Math.floor(built.frames.length / 2)];
  let brighter = 0;
  for (let i = 0; i < mid.length; i += 4) if (mid[i] > button[i] + 2) brighter++;
  assert(brighter > 0, 'CTA sheen produced no visible highlight');

  const bytes = GifEncoder.encode({
    width: w, height: h, frames: built.frames,
    delay: built.delay, loop: false, dither: false,
  });
  assert(Buffer.from(bytes.subarray(0, 6)).toString('latin1') === 'GIF89a', 'CTA gif missing header');
  assert(!Buffer.from(bytes).includes(Buffer.from('NETSCAPE2.0')), 'CTA gif must not loop');
  // Flat button art should stay small; a blown-up figure means differencing broke.
  assert(bytes.length < 60_000, `CTA gif unexpectedly large: ${bytes.length} bytes`);

  // Template integration: image button when hosted, text anchor otherwise.
  // Local sample rather than the shared one below, so this block stays self-contained.
  const ctaSample = { fullName: 'Jane Smith', title: 'Marketing Manager', email: 'jane@acme.com' };
  const ctaStyle = { ...core.previewStyle, ctaText: 'Book a Meeting', ctaUrl: 'https://example.com' };
  const plain = core.buildSignatureHtml({
    template: TEMPLATES.ctabox, data: ctaSample, style: ctaStyle, compliance: null,
  });
  assert(plain.includes('Book a Meeting') && !plain.includes('cta.gif'),
    'CTA must render as a text anchor when no animated image is hosted');

  const animated = core.buildSignatureHtml({
    template: TEMPLATES.ctabox,
    data: { ...ctaSample, ctaImageUrl: 'https://emailsignaturegenerator.ai/u/abcdef0123456789/cta.gif', ctaImageWidth: 160, ctaImageHeight: 40 },
    style: ctaStyle,
    compliance: null,
  });
  assert(animated.includes('cta.gif'), 'CTA must use the hosted animated image when present');
  assert(/alt="Book a Meeting"/.test(animated),
    'Animated CTA needs the label as alt text for clients that block images');
  assert(animated.includes('href="https://example.com"'), 'Animated CTA must stay inside its link');
}

// Animated divider: swaps the border rule for a hosted image, and degrades to the
// plain border when none is hosted.
{
  const dividerStyle = { ...core.previewStyle, dividerStyle: 'line' };
  const sample = { fullName: 'Jane Smith', title: 'Marketing Manager', email: 'jane@acme.com' };

  const plain = core.buildSignatureHtml({
    template: TEMPLATES.classic, data: sample, style: dividerStyle, compliance: null,
  });
  assert(plain.includes('border-top: 2px solid'), 'divider must fall back to a CSS border');
  assert(!plain.includes('divider.gif'), 'divider must not reference an image when none is hosted');

  const animated = core.buildSignatureHtml({
    template: TEMPLATES.classic,
    data: { ...sample, dividerImageUrl: 'https://emailsignaturegenerator.ai/u/abcdef0123456789/divider.gif', dividerImageHeight: 6 },
    style: dividerStyle,
    compliance: null,
  });
  assert(animated.includes('divider.gif'), 'divider must use the hosted image when present');
  // Full-width so it fills the cell exactly as the border does.
  assert(/width="100%"[^>]*height="6"|height="6"[^>]*width="100%"/.test(animated),
    'animated divider must be full width with an explicit height');
  assert(/alt=""/.test(animated), 'decorative divider must have empty alt text');

  // `none` means no rule at all, animated or otherwise.
  const hidden = core.buildSignatureHtml({
    template: TEMPLATES.classic,
    data: { ...sample, dividerImageUrl: 'https://example.com/u/x/divider.gif', dividerImageHeight: 6 },
    style: { ...core.previewStyle, dividerStyle: 'none' },
    compliance: null,
  });
  assert(!hidden.includes('divider.gif'), 'divider style "none" must suppress the animated rule too');
}

// Saved signatures must bring their animation back. The hosted image URLs ride
// along in `data`, but they live in module state rather than form inputs, so the
// generic "set every input by id" restore skips them and the signature silently
// reopens without the animation it was saved with.
{
  const appSource = read('js/app.js');
  assert(appSource.includes('function restoreAnimationState'),
    'restoring a saved signature must restore its animation state');
  assert(/restoreAnimationState\(state\)/.test(appSource),
    'applySignatureState must call restoreAnimationState');
  for (const field of ['ctaImageUrl', 'dividerImageUrl']) {
    assert(new RegExp(`data\\.${field}`).test(appSource),
      `restore must read ${field} back out of the saved payload`);
  }
  // These are what getFormData writes into the saved payload; if a field is
  // renamed on one side only, restore silently stops working.
  for (const field of ['ctaImageUrl', 'ctaImageWidth', 'ctaImageHeight', 'dividerImageUrl', 'dividerImageHeight']) {
    assert(appSource.includes(`${field}:`), `getFormData must still emit ${field}`);
  }
}

// One animation per signature: enabling any effect must clear the others.
{
  const appSource = read('js/app.js');
  assert(appSource.includes('function claimAnimationSlot'), 'app must enforce one animation per signature');
  for (const slot of ['photo', 'cta', 'divider']) {
    assert(appSource.includes(`claimAnimationSlot('${slot}')`), `${slot} animation must claim the single slot`);
  }
}

// No template may emit an inline `data:` image. Gmail and Outlook strip them, so
// anything that reaches a signature this way is invisible to the recipient — which
// is exactly how the social icons shipped broken.
{
  const iconStyles = iconStylesOffered();
  const rich = {
    fullName: 'Jane Smith', title: 'Marketing Manager', company: 'Acme Corp',
    phone: '+61 400 000 000', email: 'jane@acme.com',
    website: 'https://acme.com', linkedin: 'https://linkedin.com/in/jane',
    instagram: 'https://instagram.com/jane', facebook: 'https://facebook.com/jane',
    google: 'https://google.com/jane',
    photoUrl: 'https://emailsignaturegenerator.ai/u/abcdef0123456789/photo.jpg',
  };

  for (const [id, template] of templates) {
    for (const iconStyle of iconStyles) {
      const html = core.buildSignatureHtml({
        template, data: rich,
        style: core.createStyle({ iconStyle, ctaText: 'Book a Meeting', ctaUrl: 'https://example.com' }),
        compliance: null,
      });
      assert(!/src="data:/i.test(html),
        `${id} (${iconStyle}) emits an inline data: image, which Gmail and Outlook strip`);
      assert(!/src="[^"]*\.svg"/i.test(html),
        `${id} (${iconStyle}) references an SVG, which Outlook cannot render`);
    }
  }

  // Icons must be absolute URLs on the live origin, or they break outside the site.
  const withIcons = core.buildSignatureHtml({
    template: TEMPLATES.classic, data: rich,
    style: core.createStyle({ iconStyle: 'mono' }), compliance: null,
  });
  const iconUrls = (withIcons.match(/https:\/\/[^"]*\/i\/[a-z]+-[0-9a-f]{6}\.png/g) || []);
  assert(iconUrls.length >= 4, `expected hosted icon URLs, found ${iconUrls.length}`);
  assert(iconUrls.every((u) => u.startsWith(facts.origin)), 'icon URLs must point at the live origin');

  // The colour style must actually track the customer's brand colour.
  const tinted = core.buildSignatureHtml({
    template: TEMPLATES.classic, data: rich,
    style: core.createStyle({ iconStyle: 'color', primaryColor: '#EA580C' }), compliance: null,
  });
  assert(tinted.includes('-ea580c.png'), 'colour icon style must tint with the primary colour');

  // Every icon style on offer must change the signature. 'rounded' and 'square'
  // shipped for a while producing output byte-identical to 'mono', so the picker
  // had two options that silently did nothing.
  assert(iconStyles.length > 0, 'generator.html must offer at least one icon style');
  const renderedByStyle = new Map();
  for (const iconStyle of iconStyles) {
    const html = core.buildSignatureHtml({
      template: TEMPLATES.classic, data: rich,
      style: core.createStyle({ iconStyle, primaryColor: '#EA580C' }), compliance: null,
    });
    const twin = renderedByStyle.get(html);
    assert(!twin, `icon styles "${twin}" and "${iconStyle}" produce identical output; remove one`);
    renderedByStyle.set(html, iconStyle);
  }
}

// Preview-only images must never survive into an exported signature.
{
  const dataUri = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
  const hosted = 'https://emailsignaturegenerator.ai/u/abcdef0123456789/photo.jpg';
  assert(
    core.previewOnlyImageSlots({ photoUrl: dataUri, logoUrl: dataUri }).join(',') === 'photo,logo',
    'previewOnlyImageSlots must flag both inline image slots'
  );
  assert(
    core.previewOnlyImageSlots({ photoUrl: hosted, logoUrl: '' }).length === 0,
    'previewOnlyImageSlots must not flag hosted URLs'
  );
  const cleaned = core.withoutPreviewOnlyImages({ photoUrl: dataUri, logoUrl: hosted, fullName: 'Jane' });
  assert(cleaned.photoUrl === '', 'withoutPreviewOnlyImages must strip inline photos');
  assert(cleaned.logoUrl === hosted, 'withoutPreviewOnlyImages must keep hosted logos');
  assert(cleaned.fullName === 'Jane', 'withoutPreviewOnlyImages must preserve non-image fields');

  const exported = core.buildSignatureHtml({
    template: TEMPLATES.classic,
    data: cleaned,
    style: core.previewStyle,
    isPro: true,
    compliance: null,
  });
  assert(!exported.includes('data:image'), 'Exported signature must contain no inline data: images');
}

const sampleData = {
  fullName: 'Jane Smith',
  title: 'Marketing Manager',
  company: 'Acme Corp',
  phone: '0400 000 000',
  email: 'jane@example.com',
  website: 'https://example.com',
  linkedin: 'https://linkedin.com/in/jane',
};

for (const [id, template] of templates) {
  const html = core.buildSignatureHtml({
    template,
    data: sampleData,
    style: core.defaultStyle,
    compliance: null,
  });
  assert(html.includes(sampleData.fullName) || html.includes(sampleData.fullName.toUpperCase()), `${id} output missing fullName`);
  assert(html.includes('mailto:'), `${id} output missing mailto link`);
  assert(!html.includes('undefined') && !html.includes('null'), `${id} output leaks undefined/null`);
  // No branding footer on any signature, paid or not. Checks the footer's own
  // wording rather than the domain, which now legitimately appears in icon URLs.
  assert(!/Made with/i.test(html), `${id} output must not carry a branding footer`);
}

const app = read('js/app.js');
assert(app.includes('/api/upload-image'), 'Client must upload through /api/upload-image');
assert(!app.includes("fetch('/api/upload'"), 'Client still uploads through legacy /api/upload');
assert(app.includes("uploadImageBlob(blob, 'logo')"), 'Logo uploads must be hosted, not preview-only data URIs');
assert(app.includes('CORE.previewOnlyImageSlots'), 'Copy path must guard against preview-only data: URIs');
assert(!/range\.selectNodeContents\(preview\)/.test(app), 'Clipboard fallback must not copy from the live preview');

const coreSource = read('js/generator-core.js');
assert(coreSource.includes('previewOnlyImageSlots'), 'generator-core must expose preview-only image detection');

// Motion must stay progressive enhancement: content is only ever hidden behind the
// .js-motion class that motion.js sets, so a script failure cannot blank the page.
{
  const motionCss = read('css/motion.css');
  const motionJs = read('js/motion.js');

  const hidingRules = motionCss.match(/^[^{}]*\[data-reveal\][^{}]*\{[^}]*opacity:\s*0[^}]*\}/gm) || [];
  hidingRules.forEach((rule) => {
    assert(rule.includes('.js-motion'), `Reveal hiding rule must be scoped to .js-motion:\n${rule}`);
  });
  assert(hidingRules.length > 0, 'motion.css should hide reveal targets behind .js-motion');

  assert(motionJs.includes("classList.add('js-motion')"), 'motion.js must opt in to the hiding rules itself');
  assert(motionJs.includes('prefers-reduced-motion'), 'motion.js must honour reduced-motion');
  // The sweep is what stops jumped-past content from staying invisible forever.
  assert(/function sweep\(/.test(motionJs), 'motion.js needs the scroll sweep safety net');
  assert(motionJs.includes('rect.bottom < 0'), 'sweep must reveal content the reader has scrolled past');
  // Stagger must be per-row, not per-index. Indexing across a single-column mobile
  // stack leaves the last card waiting the full delay before it starts to fade in.
  assert(motionJs.includes('offsetTop'), 'stagger must be computed from layout rows, not item index');
  assert(!/items\.forEach\(function\([a-z]+, index\)/.test(motionJs), 'stagger must not be assigned by flat item index');
  assert(motionJs.includes('assignStagger();') && /addEventListener\('resize'/.test(motionJs),
    'stagger must be recomputed on resize so breakpoint changes do not leave stale delays');
  // Touch targets on the compact upload controls.
  assert(/\.btn-sm\s*\{[^}]*min-height:\s*44px/.test(motionCss.replace(/\s+/g, ' ')),
    'btn-sm must reach a 44px touch target on small screens');

  for (const page of ['index.html', 'generator.html']) {
    const html = read(page);
    if (!html.includes('data-reveal')) continue;
    assert(html.includes('js/motion.js'), `${page} uses data-reveal but never loads motion.js`);
    assert(html.includes('css/motion.css'), `${page} uses data-reveal but never loads motion.css`);
  }
}

const worker = read('_worker.js');
assert(worker.includes("url.pathname === '/api/upload-image'"), 'Worker missing /api/upload-image');
assert(worker.includes('legacy_upload_removed'), 'Worker must explicitly reject legacy upload writes');
assert(worker.includes('publicUploadId'), 'Worker must use opaque public upload ids');
checkWorkerBehavior();

const contentFiles = [
  'index.html',
  'generator.html',
  'email-signature-examples.html',
  'generate-pages.js',
  'llms.txt',
  'assets/og-image.svg',
  'health-check.html',
  ...fs.readdirSync(fromRoot('blog')).filter(f => f.endsWith('.html')).map(f => `blog/${f}`),
  ...fs.readdirSync(fromRoot('seo')).filter(f => f.endsWith('.html')).map(f => `seo/${f}`),
];

const stalePatterns = [
  /info@strata-reports\.ai/,
  /6oUeVc0ET92yauBf1sf7i00/,
  /\$5 one-time/i,
  /6 free templates/i,
  /6 signature templates/i,
  // There is one paid plan. Nothing may advertise a free tier or a branding footer.
  /\b8 free templates/i,
  /\b8 templates free/i,
  /free plan/i,
  /free forever/i,
  /Made with emailsignaturegenerator\.ai/i,
  /18 professional email signature templates/i,
  /18 signature templates across/i,
  /\b18 templates\b/i,
  /numberOfItems": 18/,
  /<td>18\+<\/td>/i,
  /All 18/i,
];

for (const file of contentFiles) {
  const text = read(file);
  for (const pattern of stalePatterns) {
    assert(!pattern.test(text), `${file} contains stale fact: ${pattern}`);
  }
}

if (!process.exitCode) {
  console.log('Validation passed');
}
