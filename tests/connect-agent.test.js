const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const siteFacts = require('../js/site-facts.js');
const scriptSource = fs.readFileSync(path.join(root, 'js/connect-agent.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(root, 'connect-agent.html'), 'utf8');

assert.match(htmlSource, /id="retry-purchase"[^>]*hidden/);

function makeElement(id, defaults = {}) {
  const listeners = new Map();
  return {
    id,
    textContent: '',
    href: '',
    value: '',
    hidden: false,
    disabled: false,
    ...defaults,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    async trigger(type, event = {}) {
      const fns = listeners.get(type) || [];
      for (const fn of fns) await fn({ preventDefault() {}, ...event });
    },
  };
}

async function runPage({ href, storedToken = '', fetchImpl }) {
  const elements = {
    'purchase-support': makeElement('purchase-support'),
    'connection-status': makeElement('connection-status'),
    'connection-error': makeElement('connection-error', { hidden: true }),
    'connection-details': makeElement('connection-details', { hidden: true }),
    'agent-name': makeElement('agent-name'),
    'purchase-status': makeElement('purchase-status'),
    'retry-purchase': makeElement('retry-purchase', { hidden: true }),
    'purchase-help': makeElement('purchase-help', { hidden: true }),
    'approve-agent': makeElement('approve-agent'),
    'agent-code': makeElement('agent-code'),
    'approve-connection': makeElement('approve-connection', { disabled: true, textContent: 'Allow access for 24 hours' }),
    'connection-complete': makeElement('connection-complete', { hidden: true }),
  };
  const replacedUrls = [];
  const storage = new Map();
  if (storedToken) storage.set(siteFacts.proTokenStorageKey, storedToken);

  const context = {
    URL,
    location: { href },
    history: { replaceState: (_s, _t, u) => replacedUrls.push(u) },
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k),
    },
    document: { getElementById: (id) => elements[id] || null },
    window: { SiteFacts: siteFacts },
    fetch: fetchImpl,
    console,
  };
  vm.createContext(context);
  await vm.runInContext(scriptSource, context);
  return { elements, replacedUrls, storage };
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function textResponse(status, text) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => { throw new SyntaxError(`Unexpected token in ${text}`); },
  };
}

(async () => {
  // 1. Strips ?request= immediately and errors when missing.
  {
    const { elements, replacedUrls } = await runPage({
      href: 'https://emailsignaturegenerator.ai/connect-agent',
      fetchImpl: async () => { throw new Error('should not fetch'); },
    });
    assert.deepEqual(replacedUrls, ['/connect-agent']);
    assert.equal(elements['connection-error'].hidden, false);
    assert.match(elements['connection-error'].textContent, /missing a valid connection request/i);
  }

  // 2. Preview 503 and 429 show temporary-error copy rather than claiming "expired".
  for (const status of [500, 503, 429]) {
    const { elements, replacedUrls } = await runPage({
      href: 'https://emailsignaturegenerator.ai/connect-agent?request=req-token-123',
      fetchImpl: async () => jsonResponse(status, { code: 'unavailable' }),
    });
    assert.deepEqual(replacedUrls, ['/connect-agent'], 'request param stripped before fetch');
    assert.equal(elements['connection-error'].hidden, false);
    assert.ok(!/expired/i.test(elements['connection-error'].textContent), `HTTP ${status} preview error must not claim request expired`);
    assert.match(elements['connection-error'].textContent, /temporarily unavailable|too many requests/i);
  }

  // 3. Preview 400 still reports expired / unverified request.
  {
    const { elements } = await runPage({
      href: 'https://emailsignaturegenerator.ai/connect-agent?request=req-expired',
      fetchImpl: async () => jsonResponse(400, { code: 'invalid_request' }),
    });
    assert.match(elements['connection-error'].textContent, /expired/i);
  }

  // 4. Transient 5xx/429 purchase check shows #retry-purchase (never tells user to reload),
  // and clicking #retry-purchase re-runs the check and allows full approval with in-memory requestToken.
  {
    let accessCalls = 0;
    let approveBody = null;
    const { elements } = await runPage({
      href: 'https://emailsignaturegenerator.ai/connect-agent?request=req-live-456',
      storedToken: 'buyer-token-1',
      fetchImpl: async (url, init = {}) => {
        if (url === '/api/v1/agent/preview') return jsonResponse(200, { agent_name: 'Helper Bot' });
        if (url === '/api/v1/access-key') {
          accessCalls += 1;
          if (accessCalls === 1) return jsonResponse(503, { code: 'unavailable' });
          if (accessCalls === 2) return jsonResponse(429, { code: 'rate_limited' });
          return jsonResponse(200, { active: true, plan: 'team', maxRows: 250 });
        }
        if (url === '/api/v1/agent/approve') {
          approveBody = JSON.parse(init.body);
          return jsonResponse(200, { approved: true });
        }
        throw new Error('Unexpected fetch: ' + url);
      },
    });
    assert.equal(elements['agent-name'].textContent, 'Helper Bot');
    assert.equal(elements['connection-details'].hidden, false);
    assert.equal(elements['retry-purchase'].hidden, false, 'transient 503 shows in-place retry button');
    assert.equal(elements['purchase-help'].hidden, true);
    assert.equal(elements['approve-connection'].disabled, true);
    assert.ok(!/reload/i.test(elements['purchase-status'].textContent), 'must not tell user to reload after stripping ?request=');

    // Retry hits 429 -> still offers retry.
    await elements['retry-purchase'].trigger('click');
    assert.equal(elements['retry-purchase'].hidden, false);
    assert.match(elements['purchase-status'].textContent, /too many/i);

    // Second retry succeeds -> enables approval.
    await elements['retry-purchase'].trigger('click');
    assert.equal(elements['retry-purchase'].hidden, true);
    assert.equal(elements['approve-connection'].disabled, false);
    assert.match(elements['purchase-status'].textContent, /Team access/);

    // Approve with in-memory requestToken.
    elements['agent-code'].value = 'ABCD-1234';
    await elements['approve-agent'].trigger('submit');
    assert.deepEqual(approveBody, { request_token: 'req-live-456', user_code: 'ABCD-1234' });
    assert.equal(elements['connection-complete'].hidden, false);
    assert.equal(elements['connection-details'].hidden, true);
  }

  // 5. Purchase 401 shows recovery help without retry button.
  {
    const { elements } = await runPage({
      href: 'https://emailsignaturegenerator.ai/connect-agent?request=req-401',
      storedToken: 'expired-token',
      fetchImpl: async (url) => {
        if (url === '/api/v1/agent/preview') return jsonResponse(200, { agent_name: 'Helper Bot' });
        if (url === '/api/v1/access-key') return jsonResponse(401, { code: 'invalid_token' });
        throw new Error('Unexpected fetch: ' + url);
      },
    });
    assert.equal(elements['retry-purchase'].hidden, true);
    assert.equal(elements['purchase-help'].hidden, false);
    assert.equal(elements['approve-connection'].disabled, true);
  }

  // 6. Approval non-JSON 502 error and known error codes are handled gracefully without throwing SyntaxError.
  {
    let approveAttempt = 0;
    const { elements } = await runPage({
      href: 'https://emailsignaturegenerator.ai/connect-agent?request=req-errors',
      storedToken: 'buyer-token-2',
      fetchImpl: async (url) => {
        if (url === '/api/v1/agent/preview') return jsonResponse(200, { agent_name: 'Helper Bot' });
        if (url === '/api/v1/access-key') return jsonResponse(200, { active: true, plan: 'pro', maxRows: 19 });
        if (url === '/api/v1/agent/approve') {
          approveAttempt += 1;
          if (approveAttempt === 1) return textResponse(502, '<html>Bad Gateway</html>');
          if (approveAttempt === 2) return jsonResponse(400, { code: 'invalid_code' });
          return jsonResponse(429, { code: 'rate_limited' });
        }
        throw new Error('Unexpected fetch: ' + url);
      },
    });
    elements['agent-code'].value = '1111-2222';
    await elements['approve-agent'].trigger('submit');
    assert.equal(elements['connection-error'].hidden, false);
    assert.match(elements['connection-error'].textContent, /Could not approve this connection/);
    assert.equal(elements['approve-connection'].disabled, false);

    await elements['approve-agent'].trigger('submit');
    assert.match(elements['connection-error'].textContent, /code does not match/i);

    await elements['approve-agent'].trigger('submit');
    assert.match(elements['connection-error'].textContent, /wait a minute/i);
  }

  console.log('Connect-agent UI tests passed (URL stripping, transient preview/purchase recovery, approval and non-JSON error handling).');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
