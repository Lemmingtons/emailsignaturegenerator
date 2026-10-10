// Brand-from-website: the HTML extractor and the /api/brand Worker route,
// with the network mocked so every case is deterministic.
import assert from 'node:assert/strict';
import { extractBrand, rankColors, normalizeHex, isBrandColor, pickStylesheet, contrastOnWhite } from '../js/brand-extract.js';

const worker = await import(new URL('../_worker.js', import.meta.url).href);

// ── Extractor ──

const yoast = `<!doctype html><html><head>
<title>Harbour Plumbing | Sydney Plumbers</title>
<meta property="og:site_name" content="Harbour Plumbing &amp; Gas">
<meta name="theme-color" content="#0B5FFF">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">
<link rel="stylesheet" href="/wp-content/themes/harbour/style.css?ver=3">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[
  {"@type":"WebSite","name":"Harbour"},
  {"@type":["Organization","Plumber"],"name":"Harbour Plumbing","logo":{"@type":"ImageObject","url":"https://harbour.example.com/logo.svg"},
   "telephone":"+61 2 9000 0000","sameAs":["https://www.facebook.com/harbourplumbing","https://www.linkedin.com/company/harbour-plumbing/"]}
]}</script>
<style>:root{--brand-primary:#0B5FFF;--brand-secondary:#FF8A00;--grey:#888888}</style>
</head><body>
<header><a class="site-logo" href="/"><img src="/img/header-logo.png" alt="Harbour"></a></header>
<a href="https://instagram.com/harbourplumbing">Insta</a>
<a href="https://www.facebook.com/sharer/sharer.php?u=x">Share</a>
<a href="tel:0290000001">Call</a>
<a href="javascript:alert(1)">x</a>
</body></html>`;

const b = extractBrand(yoast, 'https://harbour.example.com/');
assert.equal(b.company, 'Harbour Plumbing');
assert.equal(b.phone, '+61 2 9000 0000');
assert.equal(b.social.facebook, 'https://www.facebook.com/harbourplumbing');
assert.equal(b.social.linkedin, 'https://www.linkedin.com/company/harbour-plumbing/');
assert.equal(b.social.instagram, 'https://instagram.com/harbourplumbing');
assert.equal(b.social.google, '');
assert.equal(b.logos[0].url, 'https://harbour.example.com/logo.svg');
assert.equal(b.logos[0].kind, 'structured-data');
assert.ok(b.logos.some((l) => l.url === 'https://harbour.example.com/img/header-logo.png' && l.kind === 'page-logo'), 'logo inside a .logo link is found');
assert.ok(b.logos.some((l) => l.kind === 'touch-icon'));
assert.equal(b.themeColor, '#0B5FFF');
assert.equal(pickStylesheet(b.stylesheets, 'https://harbour.example.com/'), 'https://harbour.example.com/wp-content/themes/harbour/style.css?ver=3');

const colors = rankColors(b.inlineCss, b.themeColor);
assert.equal(colors.primary, '#0B5FFF');
assert.equal(colors.secondary, '#FF8A00');

// A bare page: title fallback, tel: link, colours from frequency, no theme colour.
const bare = extractBrand(`<title>Acme Studio — Design</title>
<style>a{color:#e11d48}.btn{background:#E11D48}h1{color:#e11d48}body{color:#111;background:#fff}.x{color:#2563eb}</style>
<a href="tel:+1%20(555)%20010-2000">call</a><img src="data:image/png;base64,AAA" class="logo">`, 'https://acme.example.com/');
assert.equal(bare.company, 'Acme Studio');
assert.equal(bare.phone, '+1 (555) 010-2000');
assert.equal(bare.logos.length, 0, 'inline data: logos are skipped');
const bareColors = rankColors(bare.inlineCss, bare.themeColor);
assert.equal(bareColors.primary, '#E11D48');
assert.equal(bareColors.secondary, '#2563EB');

// Hostile text stays plain text and bounded.
const hostile = extractBrand(`<meta property="og:site_name" content="&lt;script&gt;alert(1)&lt;/script&gt;${'A'.repeat(500)}">
<a href="tel:<img src=x onerror=alert(1)>">`, 'https://evil.example.com/');
assert.ok(!/[<>]/.test(hostile.company), 'company name never carries angle brackets');
assert.ok(hostile.company.length <= 80);
assert.equal(hostile.phone, '');

// A tel: link that isn't valid UTF-8 doesn't sink the lookup.
assert.doesNotThrow(() => extractBrand('<a href="tel:%E0%A4">Call</a><title>Acme</title>', 'https://x.example.com/'));
assert.equal(extractBrand('<a href="tel:%E0%A4">Call</a><title>Acme</title>', 'https://x.example.com/').company, 'Acme');

// Broken JSON-LD and junk never throw.
assert.doesNotThrow(() => extractBrand('<script type="application/ld+json">{nope</script>', 'https://x.example.com/'));
assert.doesNotThrow(() => extractBrand('', 'https://x.example.com/'));

// Colour helpers.
assert.equal(normalizeHex('#abc'), '#AABBCC');
assert.equal(normalizeHex('rgb(11, 95, 255)'), '#0B5FFF');
assert.equal(normalizeHex('rgba(0,0,0,0)'), '');
assert.equal(normalizeHex('red'), '');
assert.equal(isBrandColor('#FFFFFF'), false);
assert.equal(isBrandColor('#111111'), false);
assert.equal(isBrandColor('#808080'), false);
assert.equal(rankColors('body{color:#333;background:#fafafa}', '').primary, '');
assert.equal(rankColors('', '#ffffff').primary, '', 'a white theme-color is not a brand colour');

// A light brand colour (Ray White's yellow) becomes the accent; the primary must read on white.
const yellow = rankColors('.a{color:#FFE512}.b{color:#FFE512}', '');
assert.equal(yellow.secondary, '#FFE512');
assert.ok(contrastOnWhite(yellow.primary) >= 3, 'darkened primary reads on white: ' + yellow.primary);
const yellowAndBlue = rankColors('.a{color:#FFE512}.b{color:#FFE512}.c{color:#1D4ED8}', '#FFE512');
assert.deepEqual(yellowAndBlue, { primary: '#1D4ED8', secondary: '#FFE512' });

// ── Worker route ──

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
const SVG = new TextEncoder().encode('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><rect width="100" height="40" fill="#0B5FFF"/></svg>');
const limiterKeys = [];
const env = { RATE_LIMIT: { limit: async ({ key }) => { limiterKeys.push(key); return { success: true }; } } };

let routes = {};
const fetched = [];
globalThis.fetch = async (input, init = {}) => {
  const href = typeof input === 'string' ? input : input.url;
  fetched.push(href);
  assert.equal(init.redirect, 'manual', 'brand fetches must not follow redirects blindly');
  const route = routes[href];
  if (!route) return new Response('nope', { status: 404 });
  if (route.redirect) return new Response(null, { status: 302, headers: { Location: route.redirect } });
  return new Response(route.body, { status: 200, headers: { 'Content-Type': route.type } });
};

const callBrand = async (url, method = 'POST') => {
  const req = method === 'POST'
    ? new Request('https://emailsignaturegenerator.ai/api/brand', { method, headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.9' }, body: JSON.stringify({ url }) })
    : new Request('https://emailsignaturegenerator.ai/api/brand?url=' + encodeURIComponent(url), { method });
  const res = await worker.default.fetch(req, env);
  return { status: res.status, body: await res.json(), headers: res.headers };
};

routes = {
  'https://harbour.example.com/': { redirect: 'https://www.harbour.example.com/' },
  'https://www.harbour.example.com/': { body: yoast.replaceAll('harbour.example.com', 'www.harbour.example.com'), type: 'text/html; charset=utf-8' },
  'https://www.harbour.example.com/wp-content/themes/harbour/style.css?ver=3': { body: '.a{color:#0B5FFF}', type: 'text/css' },
  'https://www.harbour.example.com/logo.svg': { body: SVG, type: 'image/svg+xml' },
};
let r = await callBrand('harbour.example.com');
assert.equal(r.status, 200, JSON.stringify(r.body));
assert.equal(r.body.site, 'https://www.harbour.example.com/');
assert.equal(r.body.company, 'Harbour Plumbing');
assert.equal(r.body.colors.primary, '#0B5FFF');
assert.equal(r.body.logo.type, 'image/svg+xml');
assert.ok(r.body.logo.dataUri.startsWith('data:image/svg+xml;base64,'));
assert.equal(r.headers.get('Cache-Control'), 'no-store');
assert.ok(limiterKeys.includes('brand:203.0.113.9'), 'brand lookups are rate limited per IP');
assert.ok(!fetched.some((h) => h.includes('fonts.googleapis')), 'font CDNs are not fetched');

// Logo that is not an image (HTML error page served as 200) is skipped for the next candidate.
routes['https://www.harbour.example.com/logo.svg'] = { body: '<html>not found</html>', type: 'image/svg+xml' };
routes['https://www.harbour.example.com/img/header-logo.png'] = { body: PNG, type: 'image/png' };
r = await callBrand('https://harbour.example.com', 'GET');
assert.equal(r.status, 200);
assert.equal(r.body.logo.type, 'image/png');

// Blocked targets: IPs, localhost, odd ports, credentials, other schemes, this site.
for (const bad of ['http://127.0.0.1/', '169.254.169.254', 'http://[::1]/', 'localhost', 'https://intranet.local/', 'https://acme.com:8080/', 'https://user:pw@acme.com/', 'ftp://acme.com/', 'file:///etc/passwd', 'emailsignaturegenerator.ai', 'https://x.workers.dev/', '', 'a b.com', 'x'.repeat(400) + '.com']) {
  fetched.length = 0;
  r = await callBrand(bad);
  assert.equal(r.status, 400, 'should reject ' + bad);
  assert.equal(r.body.code, 'invalid_url');
  assert.equal(fetched.length, 0, 'no fetch for ' + bad);
}

// A redirect into a blocked host is refused, not followed.
routes = { 'https://sneaky.example.com/': { redirect: 'http://169.254.169.254/latest/meta-data/' } };
fetched.length = 0;
r = await callBrand('sneaky.example.com');
assert.equal(r.status, 422);
assert.equal(r.body.code, 'site_unreachable');
assert.deepEqual(fetched, ['https://sneaky.example.com/']);

// Non-HTML and unreachable.
routes = { 'https://pdf.example.com/': { body: '%PDF-1.4', type: 'application/pdf' } };
r = await callBrand('pdf.example.com');
assert.equal(r.body.code, 'site_not_html');
r = await callBrand('down.example.com');
assert.equal(r.body.code, 'site_unreachable');

// Method and rate limit.
const put = await worker.default.fetch(new Request('https://emailsignaturegenerator.ai/api/brand', { method: 'PUT' }), env);
assert.equal(put.status, 405);
const limited = await worker.default.fetch(new Request('https://emailsignaturegenerator.ai/api/brand?url=acme.com'), { RATE_LIMIT: { limit: async () => ({ success: false }) } });
assert.equal(limited.status, 429);

console.log('Brand import checks passed');
