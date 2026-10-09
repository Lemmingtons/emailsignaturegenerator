#!/usr/bin/env node
/**
 * Live-site monitor for emailsignaturegenerator.ai.
 *
 * Read-only: GET requests against the public site, compared with the committed
 * sitemap. Exits 1 with a list of failures so a scheduled GitHub Actions run
 * goes red, which emails the repository owner.
 *
 * Usage: node scripts/monitor-site.js [base-url]
 */

const fs = require('fs');
const path = require('path');
const SITE_FACTS = require('../js/site-facts');

const TIMEOUT_MS = 15000;
const HOME_SCHEMA_TYPES = ['SoftwareApplication', 'FAQPage', 'Organization', 'WebSite'];
// Present only in the generator's editor, so a redirect or fallback page that
// happens to return 200 does not pass for the generator.
const GENERATOR_MARKER = 'id="photoUrl"';
const HOME_OG_TAGS = ['og:title', 'og:description', 'og:url', 'og:image'];

async function get(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'emailsignaturegenerator-monitor' },
    });
    return { status: response.status, url: response.url, body: await response.text() };
  } catch (err) {
    return { status: 0, body: '', error: (err && err.name) || 'Error' };
  } finally {
    clearTimeout(timer);
  }
}

function describe(result) {
  return result.status ? `HTTP ${result.status}` : `request failed (${result.error})`;
}

function finalPath(result) {
  try {
    return new URL(result.url).pathname;
  } catch {
    return '';
  }
}

function committedLlmsHeading() {
  return fs.readFileSync(path.join(__dirname, '..', 'llms.txt'), 'utf8').split('\n')[0].trim();
}

// Every committed sitemap URL plus every page in blog/ and seo/, so a page
// committed without a sitemap entry is caught rather than trusted.
function expectedSitemapPaths(canonicalOrigin) {
  const root = path.join(__dirname, '..');
  const xml = fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8');
  const paths = new Set([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(canonicalOrigin, '')));
  for (const dir of ['blog', 'seo']) {
    for (const file of fs.readdirSync(path.join(root, dir))) {
      if (!file.endsWith('.html')) continue;
      paths.add(file === 'index.html' ? `/${dir}/` : `/${dir}/${file.replace(/\.html$/, '')}`);
    }
  }
  return [...paths];
}

async function monitor(baseUrl, canonicalOrigin = SITE_FACTS.origin) {
  const base = baseUrl.replace(/\/$/, '');
  const failures = [];
  const fail = (message) => failures.push(message);

  const home = await get(`${base}/`);
  if (home.status !== 200) {
    fail(`/ returned ${describe(home)}`);
  } else {
    if (!/<meta name="description" content="[^"]+"/.test(home.body)) fail('/ is missing its meta description');
    if (!home.body.includes(`<link rel="canonical" href="${canonicalOrigin}/"`)) fail('/ canonical is missing or wrong');
    for (const tag of HOME_OG_TAGS) {
      if (!new RegExp(`<meta property="${tag}" content="[^"]+"`).test(home.body)) fail(`/ is missing ${tag}`);
    }
    for (const type of HOME_SCHEMA_TYPES) {
      if (!new RegExp(`"@type":\\s*"${type}"`).test(home.body)) fail(`/ is missing ${type} structured data`);
    }
  }

  const generator = await get(`${base}/generator`);
  if (generator.status !== 200) {
    fail(`/generator returned ${describe(generator)}`);
  } else if (finalPath(generator) !== '/generator') {
    fail(`/generator redirected to ${finalPath(generator) || 'an unknown URL'}`);
  } else if (!generator.body.includes(GENERATOR_MARKER)) {
    fail('/generator loaded a page without the signature editor');
  }

  const health = await get(`${base}/api/health`);
  let healthBody = null;
  try {
    healthBody = JSON.parse(health.body);
  } catch {
    healthBody = null;
  }
  if (health.status !== 200 || !healthBody || healthBody.ok !== true) {
    const failing = healthBody && healthBody.checks
      ? Object.keys(healthBody.checks).filter((k) => !healthBody.checks[k])
      : [];
    fail(`/api/health returned ${describe(health)}${failing.length ? `, failing: ${failing.join(', ')}` : ''}`);
  }

  const sitemap = await get(`${base}/sitemap.xml`);
  if (sitemap.status !== 200) {
    fail(`/sitemap.xml returned ${describe(sitemap)}`);
  } else {
    const missing = expectedSitemapPaths(canonicalOrigin)
      .filter((p) => !sitemap.body.includes(`<loc>${canonicalOrigin}${p}</loc>`));
    if (missing.length) fail(`live sitemap is missing committed URLs: ${missing.join(', ')}`);
  }

  const robots = await get(`${base}/robots.txt`);
  if (robots.status !== 200) {
    fail(`/robots.txt returned ${describe(robots)}`);
  } else {
    if (!robots.body.includes(`Sitemap: ${canonicalOrigin}/sitemap.xml`)) fail('robots.txt is missing its Sitemap directive');
    if (!/User-agent: PerplexityBot\s+Allow: \//.test(robots.body)) fail('robots.txt no longer allows PerplexityBot');
    if (!/User-agent: GPTBot\s+Disallow: \//.test(robots.body)) fail('robots.txt no longer blocks GPTBot');
  }

  const llms = await get(`${base}/llms.txt`);
  if (llms.status !== 200) {
    fail(`/llms.txt returned ${describe(llms)}`);
  } else if (!llms.body.startsWith(committedLlmsHeading())) {
    fail('/llms.txt did not serve the committed document');
  }

  return failures;
}

async function main() {
  const base = process.argv[2] || SITE_FACTS.origin;
  const failures = await monitor(base);
  const summary = failures.length
    ? `## Site monitor: ${failures.length} problem(s) on ${base}\n\n${failures.map((f) => `- ${f}`).join('\n')}\n`
    : `## Site monitor: ${base} is healthy\n`;
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  console.log(summary);
  process.exit(failures.length ? 1 : 0);
}

if (require.main === module) main();

module.exports = { monitor };
