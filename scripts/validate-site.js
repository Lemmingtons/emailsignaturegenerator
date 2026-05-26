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
    "const source = fs.readFileSync('_worker.js', 'utf8');",
    "const worker = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));",
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
assert(templates.filter(([, t]) => !t.pro).length === facts.freeTemplateCount, `Expected ${facts.freeTemplateCount} free templates`);

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
    isPro: false,
    compliance: null,
  });
  assert(html.includes(sampleData.fullName) || html.includes(sampleData.fullName.toUpperCase()), `${id} output missing fullName`);
  assert(html.includes('mailto:'), `${id} output missing mailto link`);
  assert(!html.includes('undefined') && !html.includes('null'), `${id} output leaks undefined/null`);
  assert(html.includes('emailsignaturegenerator.ai'), `${id} free output missing branding`);
}

const app = read('js/app.js');
assert(app.includes('/api/upload-image'), 'Client must upload through /api/upload-image');
assert(!app.includes("fetch('/api/upload'"), 'Client still uploads through legacy /api/upload');

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
