const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const siteFacts = require('../js/site-facts.js');
const generatorCore = require('../js/generator-core.js');
const templates = require('../js/templates.js');
const bulkCore = require('../js/bulk-core.js');
const bulkUiSource = fs.readFileSync(path.join(root, 'js/bulk.js'), 'utf8');
const bulkHtml = fs.readFileSync(path.join(root, 'bulk.html'), 'utf8');

assert.match(bulkHtml, /id="toggle-api-key"[^>]*aria-pressed="false"[^>]*aria-controls="agent-key"[^>]*>Show key</);

function makeElement(id, defaults = {}) {
  const listeners = new Map();
  const attrs = new Map();
  const children = [];
  let replaceCount = 0;
  return {
    id,
    textContent: '',
    innerHTML: '',
    value: '',
    href: '',
    type: '',
    hidden: false,
    disabled: false,
    checked: false,
    files: [],
    children,
    get replaceCount() { return replaceCount; },
    setAttribute(k, v) { attrs.set(k, String(v)); },
    getAttribute(k) { return attrs.get(k) ?? null; },
    replaceChildren(...nodes) {
      replaceCount += 1;
      children.length = 0;
      children.push(...nodes);
    },
    appendChild(node) {
      children.push(node);
      return node;
    },
    querySelectorAll() { return []; },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    async trigger(type, event = {}) {
      const fns = listeners.get(type) || [];
      for (const fn of fns) await fn({ preventDefault() {}, ...event });
    },
    ...defaults,
  };
}

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function nonJsonResponse(status) {
  return { ok: status >= 200 && status < 300, status, json: async () => { throw new SyntaxError('Unexpected token <'); } };
}

function makeBulkHarness({ href = 'https://emailsignaturegenerator.ai/bulk', storedToken = '', confirmImpl = () => false, fetchImpl, sessionDraft = null }) {
  const ids = [
    'bulk-key', 'buy-individual', 'buy-team', 'bulk-purchase', 'retry-access',
    'paid-status', 'agent-status', 'agent-key', 'agent-key-result', 'toggle-api-key',
    'create-api-key', 'rotate-api-key', 'revoke-api-key', 'copy-api-key',
    'purchase-error', 'agent-error', 'design-error', 'download-error', 'file-error',
    'preview-error', 'download-zip', 'allow-partial', 'signature-preview', 'batch-count',
    'preview-empty', 'preview-content', 'validation-summary', 'row-errors', 'row-error-heading',
    'row-error-list', 'partial-label', 'partial-copy', 'preview-person', 'download-status',
    'bulk-template', 'bulk-company', 'bulk-website', 'bulk-logo', 'bulk-primary',
    'bulk-secondary', 'bulk-font', 'staff-file', 'import-status', 'import-warning',
    'sample-file', 'bulk-form', 'bulk-editor', 'bulk-contact', 'checkout-note',
    'mcp-url', 'mcp-command',
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, makeElement(id)]));
  elements['agent-key'].type = 'password';
  elements['toggle-api-key'].textContent = 'Show key';
  elements['toggle-api-key'].setAttribute('aria-pressed', 'false');
  elements['bulk-template'].value = 'classic';
  elements['bulk-primary'].value = '#0891b2';
  elements['bulk-secondary'].value = '#7c3aed';
  elements['bulk-font'].value = generatorCore.fontFamilies[0];

  const localStore = new Map();
  if (storedToken) localStore.set(siteFacts.proTokenStorageKey, storedToken);
  const localSets = [];
  const sessionStore = new Map();
  if (sessionDraft) sessionStore.set(siteFacts.bulkCheckoutDraftStorageKey, sessionDraft);

  const timers = [];
  let nextTimerId = 1;
  const confirmCalls = [];
  const windowListeners = new Map();

  const windowObj = {
    location: { href },
    SiteFacts: siteFacts,
    SignatureGeneratorCore: generatorCore,
    SignatureTemplates: templates,
    SignatureBulk: bulkCore,
    localStorage: {
      getItem: (k) => (localStore.has(k) ? localStore.get(k) : null),
      setItem: (k, v) => { localSets.push([k, String(v)]); localStore.set(k, String(v)); },
      removeItem: (k) => localStore.delete(k),
    },
    sessionStorage: {
      getItem: (k) => (sessionStore.has(k) ? sessionStore.get(k) : null),
      setItem: (k, v) => sessionStore.set(k, String(v)),
      removeItem: (k) => sessionStore.delete(k),
    },
    confirm: (msg) => {
      confirmCalls.push(msg);
      return confirmImpl(msg);
    },
    addEventListener: (type, fn) => {
      if (!windowListeners.has(type)) windowListeners.set(type, []);
      windowListeners.get(type).push(fn);
    },
  };

  const context = {
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    AbortController,
    Blob,
    window: windowObj,
    history: { replaceState() {} },
    localStorage: windowObj.localStorage,
    sessionStorage: windowObj.sessionStorage,
    navigator: { sendBeacon() {}, clipboard: { writeText: async () => {} } },
    document: {
      getElementById: (id) => elements[id] || null,
      querySelectorAll: () => [],
      createElement: (tag) => makeElement(tag),
    },
    fetch: (url, init) => fetchImpl(url, init, { localStore }),
    setTimeout: (fn, ms) => {
      const id = nextTimerId++;
      timers.push({ id, fn, ms, cleared: false });
      return id;
    },
    clearTimeout: (id) => {
      const t = timers.find((item) => item.id === id);
      if (t) t.cleared = true;
    },
    console,
  };

  vm.createContext(context);
  vm.runInContext(bulkUiSource, context);

  return {
    elements,
    localStore,
    localSets,
    confirmCalls,
    timers,
    flushAsync: () => new Promise((resolve) => setImmediate(resolve)),
  };
}

(async () => {
  // 1. M-2: Existing storedToken + attacker returned token rejected (401) must NEVER overwrite localStorage.
  {
    const seenAuth = [];
    let storageDuringFirstFetch = null;
    const h = makeBulkHarness({
      href: 'https://emailsignaturegenerator.ai/bulk#token=attacker-bad-token',
      storedToken: 'legit-existing-token',
      fetchImpl: async (url, init = {}, ctx = {}) => {
        const auth = init.headers?.Authorization;
        seenAuth.push(auth);
        if (seenAuth.length === 1) {
          storageDuringFirstFetch = ctx.localStore.get(siteFacts.proTokenStorageKey);
          return jsonResponse(401, { code: 'invalid_token' });
        }
        return jsonResponse(200, { active: true, plan: 'team', maxRows: 250 });
      },
    });
    await h.flushAsync();
    await h.flushAsync();
    assert.equal(storageDuringFirstFetch, 'legit-existing-token', 'localStorage must not be overwritten before verification');
    assert.deepEqual(seenAuth, ['Bearer attacker-bad-token', 'Bearer legit-existing-token']);
    assert.equal(h.localStore.get(siteFacts.proTokenStorageKey), 'legit-existing-token');
    assert.equal(h.localSets.length, 0, 'rejected returned token must never write to localStorage');
    assert.equal(h.confirmCalls.length, 0, 'rejected token must not prompt confirm()');
    assert.match(h.elements['paid-status'].textContent, /Team lifetime access is active/);
  }

  // 2. M-2: Existing storedToken + valid different returned token + user declines confirm() keeps storedToken.
  {
    const seenAuth = [];
    const h = makeBulkHarness({
      href: 'https://emailsignaturegenerator.ai/bulk#token=other-valid-token',
      storedToken: 'legit-existing-token',
      confirmImpl: () => false,
      fetchImpl: async (url, init = {}) => {
        const auth = init.headers?.Authorization;
        seenAuth.push(auth);
        if (auth === 'Bearer other-valid-token') return jsonResponse(200, { active: true, plan: 'pro', maxRows: 19 });
        return jsonResponse(200, { active: true, plan: 'team', maxRows: 250 });
      },
    });
    await h.flushAsync();
    await h.flushAsync();
    assert.equal(h.confirmCalls.length, 1, 'must ask user confirmation before replacing existing token');
    assert.equal(h.localSets.length, 0, 'declining confirm must leave localStorage untouched');
    assert.equal(h.localStore.get(siteFacts.proTokenStorageKey), 'legit-existing-token');
    assert.deepEqual(seenAuth, ['Bearer other-valid-token', 'Bearer legit-existing-token']);
    assert.match(h.elements['paid-status'].textContent, /Team lifetime access is active/);
  }

  // 3. M-2: Existing storedToken + valid different returned token + user accepts confirm() updates localStorage.
  {
    const h = makeBulkHarness({
      href: 'https://emailsignaturegenerator.ai/bulk#token=new-valid-token',
      storedToken: 'old-token',
      confirmImpl: () => true,
      fetchImpl: async () => jsonResponse(200, { active: true, plan: 'team', maxRows: 250 }),
    });
    assert.equal(h.localStore.get(siteFacts.proTokenStorageKey), 'old-token', 'must not overwrite before async verification');
    await h.flushAsync();
    assert.equal(h.confirmCalls.length, 1);
    assert.equal(h.localStore.get(siteFacts.proTokenStorageKey), 'new-valid-token');
    assert.match(h.elements['paid-status'].textContent, /Team lifetime access is active/);
  }

  // 4. First-time purchase (no storedToken) persists returned token immediately.
  {
    const h = makeBulkHarness({
      href: 'https://emailsignaturegenerator.ai/bulk#token=first-token',
      storedToken: '',
      fetchImpl: async () => jsonResponse(200, { active: true, plan: 'pro', maxRows: 19 }),
    });
    assert.equal(h.localStore.get(siteFacts.proTokenStorageKey), 'first-token');
    await h.flushAsync();
    assert.equal(h.confirmCalls.length, 0);
  }

  // 5. Show/Hide key toggle + non-JSON error handling in manageKey.
  {
    let postAttempt = 0;
    const h = makeBulkHarness({
      storedToken: 'owner-token',
      fetchImpl: async (url, init = {}) => {
        if (!init.method || init.method === 'GET') return jsonResponse(200, { active: true, plan: 'pro', maxRows: 19 });
        postAttempt += 1;
        if (postAttempt === 1) return jsonResponse(200, { key: 'esg_bulk_secret_123', maxRows: 19 });
        if (postAttempt === 2) return nonJsonResponse(502);
        return jsonResponse(200, { revoked: true });
      },
    });
    await h.flushAsync();
    await h.elements['create-api-key'].trigger('click');
    await h.flushAsync();
    assert.equal(h.elements['agent-key'].value, 'esg_bulk_secret_123');
    assert.equal(h.elements['agent-key'].type, 'password');
    assert.equal(h.elements['toggle-api-key'].textContent, 'Show key');
    assert.equal(h.elements['toggle-api-key'].getAttribute('aria-pressed'), 'false');

    await h.elements['toggle-api-key'].trigger('click');
    assert.equal(h.elements['agent-key'].type, 'text');
    assert.equal(h.elements['toggle-api-key'].textContent, 'Hide key');
    assert.equal(h.elements['toggle-api-key'].getAttribute('aria-pressed'), 'true');

    await h.elements['toggle-api-key'].trigger('click');
    assert.equal(h.elements['agent-key'].type, 'password');
    assert.equal(h.elements['toggle-api-key'].textContent, 'Show key');
    assert.equal(h.elements['toggle-api-key'].getAttribute('aria-pressed'), 'false');

    // Non-JSON 502 error from /api/v1/access-key POST is caught cleanly.
    await h.elements['rotate-api-key'].trigger('click');
    await h.flushAsync();
    assert.equal(h.elements['agent-error'].hidden, false);
    assert.match(h.elements['agent-error'].textContent, /Could not update your key/);
    assert.equal(h.elements['rotate-api-key'].disabled, false);

    // Revoking resets visibility back to password.
    await h.elements['toggle-api-key'].trigger('click');
    assert.equal(h.elements['agent-key'].type, 'text');
    await h.elements['revoke-api-key'].trigger('click');
    await h.flushAsync();
    assert.equal(h.elements['agent-key'].type, 'password');
    assert.equal(h.elements['toggle-api-key'].getAttribute('aria-pressed'), 'false');
  }

  // 6. Debounced shared-defaults input (150ms) and #preview-person options not rebuilt on default keystrokes.
  {
    const employees = [
      { fullName: 'Alex Morgan', email: 'alex@example.com' },
      { fullName: 'Sam Lee', email: 'sam@example.com' },
    ];
    const draft = bulkCore.encodeBulkCheckoutDraft(
      { template: 'classic', defaults: {}, style: generatorCore.defaultStyle, employees },
      { rowNumbers: [2, 3] },
    );
    const h = makeBulkHarness({
      storedToken: 'owner-token',
      sessionDraft: draft,
      fetchImpl: async () => jsonResponse(200, { active: true, plan: 'pro', maxRows: 19 }),
    });
    await h.flushAsync();
    const initialReplaces = h.elements['preview-person'].replaceCount;
    assert.equal(h.elements['preview-person'].children.length, 2);

    // Rapid typing into bulk-company schedules a 150ms debounce and cancels earlier timers.
    h.elements['bulk-company'].value = 'Acme';
    await h.elements['bulk-company'].trigger('input');
    h.elements['bulk-company'].value = 'Acme Studio';
    await h.elements['bulk-company'].trigger('input');

    const debounceTimers = h.timers.filter((t) => t.ms === 150);
    assert.equal(debounceTimers.length, 2);
    assert.equal(debounceTimers[0].cleared, true, 'first debounce timer cancelled by second keystroke');
    assert.equal(debounceTimers[1].cleared, false);
    assert.ok(!h.elements['signature-preview'].innerHTML.includes('Acme Studio'), 'render does not run synchronously before debounce');

    debounceTimers[1].fn();
    assert.match(h.elements['signature-preview'].innerHTML, /Acme Studio/, 'debounced render applies new shared company');
    assert.equal(h.elements['preview-person'].replaceCount, initialReplaces, '#preview-person options must not be rebuilt on shared-defaults edit');
  }

  console.log('Bulk UI tests passed (token fixation protection, Show/Hide key toggle, non-JSON errors, debounced defaults & picker stability).');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
