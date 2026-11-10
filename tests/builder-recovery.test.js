// Builder purchase funnel: checkout-draft recovery, export validation, the
// paywall dialog, token handling and storage failures. The real handlers from
// js/app.js run against small DOM stand-ins; browser layout is checked by hand.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const facts = require('../js/site-facts');
const core = require('../js/generator-core');
const { TEMPLATES, CATEGORIES } = require('../js/templates');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6WQAAAAASUVORK5CYII=';
const TOKEN = 'aaa.bbb.ccc';
const source = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');

function storage() {
  const values = new Map();
  return { getItem: key => (values.has(key) ? values.get(key) : null), setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
}
function blockedStorage() {
  const fail = () => { throw new Error('SecurityError'); };
  return { getItem: fail, setItem: fail, removeItem: fail };
}

function builder(options = {}) {
  const session = options.session || storage();
  const local = options.local || storage();
  const elements = new Map();
  function element() {
    const attrs = {};
    return {
      value: '', dataset: {}, style: {}, checked: false, disabled: false, hidden: false,
      textContent: '', innerHTML: '', listeners: {},
      classList: { add() {}, remove() {}, toggle() {} },
      setAttribute(key, val) { attrs[key] = String(val); }, getAttribute(key) { return key in attrs ? attrs[key] : null; },
      hasAttribute(key) { return key in attrs; }, removeAttribute(key) { delete attrs[key]; },
      addEventListener(type, fn) { this.listeners[type] = fn; },
      querySelectorAll() { return []; }, replaceChildren() {}, appendChild() {},
      scrollIntoView() {}, focus() { this.focused = true; }, closest() { return null; },
    };
  }
  const get = id => {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  };
  const calls = [];
  const copied = [];
  const windowEvents = {};
  const replaced = [];
  const location = Object.assign({ search: '?site=fixture.example.com', hash: '', pathname: '/generator', origin: 'https://fixture.example.com', href: 'builder' }, options.location);
  const context = {
    document: {
      getElementById: get, addEventListener() {}, querySelectorAll() { return []; }, querySelector() { return null; },
      createElement(tag) {
        return tag === 'canvas' ? { getContext: () => ({ drawImage() {} }), toDataURL: () => PNG } : element();
      },
    },
    window: { SiteFacts: facts, SignatureGeneratorCore: core,
      SignatureHealthCheck: { runAudit: () => ({ score: 100, results: [] }) },
      location, history: { state: null, replaceState(state, title, url) { replaced.push(url); } },
      addEventListener(type, fn) { windowEvents[type] = fn; } },
    TEMPLATES, CATEGORIES, localStorage: local, sessionStorage: session,
    URL, URLSearchParams, Blob, atob, btoa, setTimeout, clearTimeout, console,
    Image: class {
      constructor() { this.naturalWidth = 1; this.naturalHeight = 1; }
      set src(value) { this.value = value; queueMicrotask(() => this.onload()); }
    },
    ClipboardItem: class { constructor(items) { this.items = items; } },
    navigator: { clipboard: { writeText: async text => copied.push(text), write: async items => copied.push(items) } },
    fetch: options.fetch || (async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ url: 'https://fixture.example.com/generator?s=saved', seats: 10, members: 0 }) };
    }),
  };
  const testApi = `globalThis.handlers = { handleProPurchase, restoreCheckoutDraft, applyBrand, bindColorPicker, bindPaywall,
    saveSignatureLink, collectSignatureState, getFormData, runSignatureCheck, copyHTML, copyPlainText,
    checkProStatus, takeTokenFromAddress, getProToken, setProToken, copyAccessLink,
    state() { return { isPro, teamId }; }, setTeam(id) { teamId = id; },
    paidFixture() { isPro = true; }, setPhotoCanvas() { photoState.primaryCanvas = { toDataURL: () => ${JSON.stringify(PNG)} }; } };`;
  vm.runInNewContext(source.replace(/\}\)\(\);\s*$/, testApi + '\n})();'), context);
  return { ...context.handlers, get, session, local, location, calls, windowEvents, copied, replaced, context };
}

function fillValid(b) {
  b.get('fullName').value = 'Alex';
  b.get('email').value = 'alex@example.com';
}

async function main() {
  // ── Export validation ──
  const invalid = builder();
  invalid.paidFixture();
  invalid.get('fullName').value = 'Alex';
  invalid.get('email').value = 'bad-email';
  invalid.runSignatureCheck();
  assert.equal(invalid.get('sigCheckScore').textContent, '–', 'invalid contact data cannot receive an HTML-only passing score');
  assert.match(invalid.get('sigCheckTitle').textContent, /Fix your contact details/);
  for (const copy of [invalid.copyHTML, invalid.copyPlainText]) {
    await copy(invalid.get('copyHtmlBtn'));
    assert.equal(invalid.copied.length, 0, 'neither export format may copy an invalid email');
    assert.equal(invalid.get('email').focused, true);
    assert.equal(invalid.get('email').getAttribute('aria-invalid'), 'true');
    assert.match(invalid.get('installStatusHint').textContent, /Fix the highlighted contact details/, 'error is mirrored in the Install step');
  }
  invalid.get('email').value = 'alex@example.com';
  invalid.runSignatureCheck();
  assert.equal(invalid.get('sigCheckScore').textContent, '100', 'correcting the email restores readiness');
  assert.equal(invalid.get('email').getAttribute('aria-invalid'), 'false');
  assert.equal(invalid.get('exportStatusHint').textContent, '', 'corrected details clear the earlier export error');
  await invalid.copyHTML(invalid.get('copyHtmlBtn'));
  await invalid.copyPlainText(invalid.get('copyTextBtn'));
  assert.equal(invalid.copied.length, 2, 'both export formats work after correction');
  assert.match(await invalid.copied[0][0].items['text/html'].text(), /mailto:alex@example.com/);
  assert.match(invalid.copied[1], /alex@example.com/);
  invalid.get('website').value = 'example.com';
  invalid.runSignatureCheck();
  await invalid.copyHTML(invalid.get('copyHtmlBtn'));
  assert.equal(invalid.get('sigCheckScore').textContent, '–');
  assert.equal(invalid.copied.length, 2, 'other field errors also block copying');
  invalid.get('website').value = '';
  invalid.get('email').value = '';
  invalid.runSignatureCheck();
  assert.equal(invalid.get('sigCheckScore').textContent, '100', 'optional contact details may be empty');
  invalid.get('fullName').value = '';
  await invalid.copyHTML(invalid.get('copyHtmlBtn'));
  await invalid.copyPlainText(invalid.get('copyTextBtn'));
  assert.equal(invalid.copied.length, 2, 'both export formats still require a name');
  assert.equal(invalid.get('fullName').focused, true);

  // ── Paywall dialog ──
  const unpaid = builder();
  unpaid.bindPaywall();
  fillValid(unpaid);
  for (const [run, id] of [[unpaid.copyHTML, 'copyHtmlBtn'], [unpaid.copyPlainText, 'copyTextBtn'], [unpaid.saveSignatureLink, 'saveLinkBtn']]) {
    unpaid.get('paywallDialog').removeAttribute('open');
    await run(unpaid.get(id));
    assert.equal(unpaid.get('paywallDialog').hasAttribute('open'), true, `${id} opens the paywall when unpaid`);
  }
  assert.equal(unpaid.copied.length, 0, 'the paywall never copies');
  assert.equal(unpaid.calls.length, 0, 'the paywall saves nothing on the server');
  assert.match(unpaid.get('paywallPreview').innerHTML, /Alex/, 'the dialog shows the visitor\'s own signature');
  assert.notEqual(unpaid.get('exportStatusHint').style.color, '#b91c1c', 'the upsell is not styled as an error');
  assert.equal(unpaid.get('paywallTeam').hidden, false, 'team line shows when a team link is configured');
  assert.equal(unpaid.get('paywallRefundEmail').textContent, facts.contactEmail);
  unpaid.get('paywallBuyBtn').listeners.click();
  assert.equal(unpaid.location.href, facts.paymentLink, 'the dialog button checks out with the draft');
  assert.ok(unpaid.session.getItem(facts.checkoutDraftStorageKey), 'draft saved before leaving');
  unpaid.location.href = 'builder';
  unpaid.get('paywallTeamLink').listeners.click({ preventDefault() {} });
  assert.equal(unpaid.location.href, facts.teamPaymentLink, 'the team line also saves the draft');

  const team = builder();
  team.setTeam('t'.repeat(43));
  fillValid(team);
  await team.copyHTML(team.get('copyHtmlBtn'));
  assert.equal(team.get('paywallDialog').hasAttribute('open'), false, 'a team member is sent to Join, not the paywall');
  assert.match(team.get('exportStatusHint').textContent, /Join your team first/);

  // ── Waiting for the token check ──
  let answer;
  const slow = builder({ fetch: () => new Promise(resolve => { answer = resolve; }) });
  fillValid(slow);
  slow.setProToken(TOKEN);
  slow.checkProStatus();
  const pendingCopy = slow.copyHTML(slow.get('copyHtmlBtn'));
  await new Promise(r => setTimeout(r, 0));
  assert.match(slow.get('exportStatusHint').textContent, /Checking your access/, 'early Copy says it is checking');
  assert.equal(slow.get('paywallDialog').hasAttribute('open'), false, 'a returning buyer does not see the paywall while checking');
  answer({ ok: true, status: 200, json: async () => ({ valid: true }) });
  await pendingCopy;
  assert.equal(slow.state().isPro, true);
  assert.equal(slow.copied.length, 1, 'the copy goes ahead once the token is verified');

  // ── Token in the address ──
  for (const [search, hash, expected] of [['?token=' + TOKEN + '&s=abc', '', '/generator?s=abc'], ['?team=xyz', '#token=' + TOKEN, '/generator?team=xyz']]) {
    const addr = builder({ location: { search, hash } });
    const params = new URLSearchParams(search);
    assert.equal(addr.takeTokenFromAddress(params), TOKEN);
    assert.deepEqual(addr.replaced, [expected], 'token removed from the address and this history entry');
    assert.equal(params.has('token'), false);
  }
  const junk = builder({ location: { search: '', hash: '#token=<script>' } });
  assert.equal(junk.takeTokenFromAddress(new URLSearchParams('')), '', 'malformed tokens are dropped');
  assert.deepEqual(junk.replaced, ['/generator']);

  // ── Access link ──
  const paidLink = builder();
  paidLink.paidFixture();
  paidLink.setProToken(TOKEN);
  await paidLink.copyAccessLink(paidLink.get('accessLinkBtn'));
  assert.deepEqual(paidLink.copied, ['https://fixture.example.com/generator#token=' + TOKEN]);
  assert.match(paidLink.get('accessLinkHint').textContent, /private/);

  // ── Checkout draft encoding ──
  const now = Date.now();
  const minimal = { version: 1, data: { fullName: 'Alex' }, style: {} };
  const encoded = core.encodeCheckoutDraft(minimal, {}, now);
  assert.equal(core.decodeCheckoutDraft(encoded, now).signature.data.fullName, 'Alex');
  assert.equal(core.decodeCheckoutDraft(encoded, now + 24 * 60 * 60 * 1000 + 1), null, 'expired personal data is not restored');
  assert.equal(core.decodeCheckoutDraft(encoded, now - 1), null, 'future timestamps are rejected');
  for (const junkDraft of ['{broken', 'null', '{}', '[]']) assert.equal(core.decodeCheckoutDraft(junkDraft), null);
  assert.throws(() => core.encodeCheckoutDraft(minimal, { huge: 'x'.repeat(4_000_000) }), /draft_too_large/);

  // ── Draft survives checkout ──
  const before = builder();
  before.get('fullName').value = 'Alex Audit';
  before.get('email').value = 'alex@example.com';
  before.get('company').value = 'Fixture Ltd';
  before.get('brandSite').value = 'fixture.example.com';
  before.get('logoPreviewThumb').dataset.previewOnly = PNG;
  before.get('photoPreviewThumb').dataset.previewOnly = PNG;
  before.setPhotoCanvas();
  before.local.setItem(facts.proTokenStorageKey, 'MUST_NOT_ENTER_DRAFT');
  before.bindColorPicker('primaryColor', 'primaryColorHex');
  before.get('primaryColorHex').value = '#123456';
  before.get('primaryColorHex').listeners.input.call(before.get('primaryColorHex'));
  await before.applyBrand({ site: 'https://fixture.example.com/', phone: '01 1111', colors: { secondary: '#ABCDEF' } });
  before.get('buyProBtn');
  before.handleProPurchase(facts.paymentLink);
  assert.equal(before.location.href, facts.paymentLink);
  const saved = before.session.getItem(facts.checkoutDraftStorageKey);
  assert.ok(!saved.includes('MUST_NOT_ENTER_DRAFT'), 'draft excludes access tokens');
  assert.equal(JSON.parse(saved).recovery.previewImages.logo, PNG);

  before.windowEvents.pageshow({ persisted: false });
  assert.equal(before.session.getItem(facts.checkoutDraftStorageKey), saved, 'normal page load retains recovery for restoration');
  before.windowEvents.pageshow({ persisted: true });
  assert.equal(before.session.getItem(facts.checkoutDraftStorageKey), null, 'cached Back return consumes the stale snapshot');
  assert.equal(before.get('fullName').value, 'Alex Audit', 'cached Back return preserves the live form');

  // A paid return (query or fragment token) and a cancelled return restore the
  // same draft. Restoration itself must never unlock Pro or upload images.
  for (const [query, hasToken] of [['token=server-verifies-this', false], ['', true], ['site=fixture.example.com', false], ['', false]]) {
    const session = storage(); session.setItem(facts.checkoutDraftStorageKey, saved);
    const after = builder({ session });
    assert.equal(await after.restoreCheckoutDraft(new URLSearchParams(query), hasToken), true);
    assert.equal(after.get('fullName').value, 'Alex Audit');
    assert.equal(after.get('email').value, 'alex@example.com');
    assert.equal(after.get('brandSite').value, 'fixture.example.com');
    assert.equal(after.get('logoPreviewThumb').dataset.previewOnly, PNG);
    assert.equal(after.get('photoPreviewThumb').dataset.previewOnly, PNG);
    assert.equal(after.collectSignatureState().style.primaryColor, '#123456');
    assert.equal(after.session.getItem(facts.checkoutDraftStorageKey), null, 'remove consumed recovery data');
    assert.equal(after.calls.length, 0, 'draft restoration cannot grant paid server access');
    assert.equal(after.state().isPro, false);
    await after.applyBrand({ site: 'https://other.example.com', colors: { primary: '#0B5FFF', secondary: '#FF8A00' } });
    assert.equal(after.collectSignatureState().style.primaryColor, '#123456', 'manual colour survives checkout and re-import');
    assert.equal(after.collectSignatureState().style.secondaryColor, '#FF8A00', 'unedited colours still import');
    assert.equal(after.get('phone').value, '', 'the first import\'s fields are still replaced by a second import after checkout');
  }

  // Compliance selection (including registration numbers) rides along in the
  // draft; the data file loads asynchronously, so the selection is queued.
  assert.match(source, /applyComplianceSelection\(state\.compliance, true\)/);
  assert.match(source, /pendingCompliance = \{ saved, includePersonal \}/);

  // A second website replaces what the first one filled, but not what the visitor typed.
  const reimport = builder();
  reimport.get('email').value = 'me@typed.example';
  await reimport.applyBrand({ site: 'https://first.example.com/', company: 'First Co', phone: '01 1111',
    social: { linkedin: 'https://linkedin.com/company/first' }, colors: { primary: '#111111', secondary: '#222222' } });
  assert.equal(reimport.get('company').value, 'First Co');
  reimport.get('phone').value = '09 9999';
  await reimport.applyBrand({ site: 'https://second.example.com', company: 'Second Co', colors: { primary: '#333333' } });
  assert.equal(reimport.get('company').value, 'Second Co', 'second import replaces the first company');
  assert.equal(reimport.get('website').value, 'https://second.example.com');
  assert.equal(reimport.get('linkedin').value, '', 'links only the first site had are cleared');
  assert.equal(reimport.get('phone').value, '09 9999', 'a field edited after import is kept');
  assert.equal(reimport.get('email').value, 'me@typed.example');
  assert.equal(reimport.collectSignatureState().style.primaryColor, '#333333');
  assert.equal(reimport.collectSignatureState().style.secondaryColor, core.createStyle().secondaryColor, 'old site colours reset');

  const unrelated = builder();
  unrelated.session.setItem(facts.checkoutDraftStorageKey, saved);
  assert.equal(await unrelated.restoreCheckoutDraft(new URLSearchParams('site=different.example.com'), false), false);
  assert.equal(unrelated.get('fullName').value, '', 'new website journey does not inherit an old draft');

  const stale = builder();
  const old = JSON.parse(saved); old.createdAt = Date.now() - 25 * 60 * 60 * 1000;
  stale.session.setItem(facts.checkoutDraftStorageKey, JSON.stringify(old));
  assert.equal(await stale.restoreCheckoutDraft(new URLSearchParams(''), true), false, 'stale drafts expire');
  assert.equal(stale.session.getItem(facts.checkoutDraftStorageKey), null);

  // ── Storage failures ──
  const quota = builder();
  fillValid(quota);
  quota.session.setItem = () => { throw new Error('quota'); };
  quota.handleProPurchase(facts.paymentLink);
  assert.equal(quota.location.href, 'builder', 'a failed draft save does not silently discard the signature');
  assert.match(quota.get('exportStatusHint').textContent, /could not save this draft/);
  assert.match(quota.get('paywallStatus').textContent, /could not save this draft/, 'the dialog shows the problem too');
  quota.handleProPurchase(facts.paymentLink);
  assert.equal(quota.location.href, facts.paymentLink, 'a second press continues to checkout without the draft');

  // Images too big for storage: words and colours still go, images are asked for again.
  const big = builder();
  fillValid(big);
  big.get('logoPreviewThumb').dataset.previewOnly = PNG;
  const realSet = big.session.setItem;
  big.session.setItem = (key, value) => { if (value.includes('base64')) throw new Error('quota'); realSet(key, value); };
  big.handleProPurchase(facts.paymentLink);
  assert.equal(big.location.href, facts.paymentLink);
  const slim = JSON.parse(big.session.getItem(facts.checkoutDraftStorageKey));
  assert.equal(slim.recovery.imagesDropped, true);
  assert.equal(slim.signature.data.fullName, 'Alex');

  const blocked = builder({ session: blockedStorage(), local: blockedStorage() });
  fillValid(blocked);
  assert.equal(await blocked.restoreCheckoutDraft(new URLSearchParams(''), false), false, 'blocked storage restores nothing and does not throw');
  blocked.setProToken(TOKEN);
  assert.equal(blocked.getProToken(), TOKEN, 'the token is kept in memory when storage is blocked');
  blocked.handleProPurchase(facts.paymentLink);
  blocked.handleProPurchase(facts.paymentLink);
  assert.equal(blocked.location.href, facts.paymentLink, 'blocked storage still lets the buyer reach checkout');

  const importing = builder();
  importing.get('brandImportBtn').disabled = true;
  importing.handleProPurchase(facts.paymentLink);
  assert.equal(importing.location.href, 'builder', 'checkout cannot interrupt brand import');

  console.log('Builder checkout recovery, paywall and export checks passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
