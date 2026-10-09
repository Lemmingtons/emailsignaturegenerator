// Runs the live-site monitor against a local server built from the committed
// files, so the checks it makes stay in step with the pages they inspect.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { monitor } = require('../scripts/monitor-site');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

function serve(overrides) {
  const routes = {
    '/': () => [200, read('index.html')],
    '/generator': () => [200, read('generator.html')],
    '/api/health': () => [200, JSON.stringify({ ok: true, checks: { storage: true, webhook: true } })],
    '/sitemap.xml': () => [200, read('sitemap.xml')],
    '/robots.txt': () => [200, read('robots.txt')],
    '/llms.txt': () => [200, read('llms.txt')],
    ...overrides,
  };
  const server = http.createServer((req, res) => {
    const route = routes[req.url];
    const [status, body, headers] = route ? route() : [404, 'missing'];
    res.writeHead(status, headers);
    res.end(body);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function run(overrides) {
  const server = await serve(overrides);
  try {
    return await monitor(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
  }
}

(async () => {
  assert.deepStrictEqual(await run({}), [], 'committed site should pass the monitor');

  const unhealthy = await run({
    '/api/health': () => [503, JSON.stringify({ ok: false, checks: { storage: true, webhook: false } })],
  });
  assert.ok(unhealthy.some((f) => f.includes('/api/health') && f.includes('webhook')), 'monitor missed a failing health check');

  const shrunk = await run({
    '/sitemap.xml': () => [200, read('sitemap.xml').replace(/<url>\s*<loc>[^<]*\/blog\/email-signature-best-practices<\/loc>[\s\S]*?<\/url>/, '')],
  });
  assert.ok(shrunk.some((f) => f.includes('email-signature-best-practices')), 'monitor missed a URL dropped from the live sitemap');

  const down = await run({ '/': () => [500, 'error'] });
  assert.ok(down.some((f) => f.startsWith('/ returned HTTP 500')), 'monitor missed a down homepage');

  const noSchema = await run({ '/': () => [200, read('index.html').replace(/"@type":\s*"FAQPage"/, '"@type": "Thing"')] });
  assert.ok(noSchema.some((f) => f.includes('FAQPage')), 'monitor missed missing structured data');

  const generatorFallback = await run({ '/generator': () => [200, read('index.html')] });
  assert.ok(generatorFallback.some((f) => f.includes('signature editor')), 'monitor accepted the homepage as the generator');

  const generatorRedirect = await run({ '/generator': () => [302, '', { Location: '/' }] });
  assert.ok(generatorRedirect.some((f) => f.includes('/generator redirected to /')), 'monitor followed a generator redirect to the homepage');

  const llmsFallback = await run({ '/llms.txt': () => [200, read('index.html')] });
  assert.ok(llmsFallback.some((f) => f.includes('llms.txt')), 'monitor accepted an HTML fallback for llms.txt');

  console.log('Site monitor checks passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
