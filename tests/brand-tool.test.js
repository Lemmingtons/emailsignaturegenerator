// Brand extractor page tests: hostile third-party metadata/URLs, SVG logo
// rasterization & tainted-canvas safety (no raw SVG download), and clipboard error handling.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../js/brand-tool.js'), 'utf8');
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6WQAAAAASUVORK5CYII=';
const SVG = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><script>alert(1)</script><rect width="120" height="40"/></svg>').toString('base64');

function makeNode(tag) {
  const attrs = {};
  const node = {
    tagName: String(tag).toUpperCase(),
    className: '',
    textContent: '',
    value: '',
    href: '',
    download: '',
    rel: '',
    target: '',
    alt: '',
    type: '',
    hidden: false,
    disabled: false,
    naturalWidth: 120,
    naturalHeight: 40,
    style: {},
    children: [],
    listeners: {},
    set innerHTML(val) {
      if (val === '') this.children = [];
      else throw new Error('brand-tool.js should not write non-empty innerHTML');
    },
    get innerHTML() { return ''; },
    set src(val) {
      this._src = val;
      if (this.listeners.load) {
        const fn = this.listeners.load;
        queueMicrotask(() => fn());
      }
    },
    get src() { return this._src || ''; },
    setAttribute(k, v) { attrs[k] = String(v); },
    getAttribute(k) { return k in attrs ? attrs[k] : null; },
    removeAttribute(k) { delete attrs[k]; },
    addEventListener(type, fn) { this.listeners[type] = fn; },
    appendChild(child) { this.children.push(child); return child; },
    focus() { this.focused = true; },
    findAll(predicate) {
      const out = [];
      const walk = n => {
        if (predicate(n)) out.push(n);
        for (const c of n.children || []) walk(c);
      };
      walk(this);
      return out;
    },
  };
  return node;
}

function setupBrandTool(options = {}) {
  const ids = {
    brandToolForm: makeNode('form'),
    brandToolSite: makeNode('input'),
    brandToolBtn: makeNode('button'),
    brandToolStatus: makeNode('p'),
    brandToolResults: makeNode('div'),
  };

  const context = {
    document: {
      getElementById: id => ids[id] || null,
      createElement(tag) {
        if (tag === 'canvas') {
          return {
            width: 0,
            height: 0,
            getContext: () => ({ drawImage() {} }),
            toDataURL: () => {
              if (options.taintedCanvas) throw new Error('SecurityError: tainted canvas');
              return PNG;
            },
          };
        }
        return makeNode(tag);
      },
    },
    location: { search: '' },
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    console,
    navigator: {
      clipboard: {
        writeText: options.clipboardWriteText || (async () => {}),
      },
    },
    fetch: async () => ({
      ok: true,
      json: async () => options.payload,
    }),
  };

  vm.runInNewContext(source, context);
  return { ids, context };
}

async function submit(env, site = 'evil.example') {
  env.ids.brandToolSite.value = site;
  env.ids.brandToolForm.listeners.submit({ preventDefault() {} });
  // Wait for fetch + microtasks (including img load)
  await new Promise(r => setTimeout(r, 15));
}

async function main() {
  // 1. Hostile company, phone, social URLs, and raw SVG logo with untainted canvas.
  const hostilePayload = {
    ok: true,
    site: 'https://evil.example',
    company: '<img src=x onerror=alert(1)> Evil Corp',
    phone: '<script>alert(1)</script> +1 555 0100',
    colors: { primary: '#123456', secondary: 'not-a-hex; background:url(javascript:alert(1))' },
    social: {
      linkedin: 'https://linkedin.com/company/evil',
      instagram: 'javascript:alert(1)',
      facebook: 'data:text/html,<script>alert(1)</script>',
      google: 'vbscript:msgbox(1)',
    },
    logo: { type: 'image/svg+xml', dataUri: SVG },
  };

  const untainted = setupBrandTool({ payload: hostilePayload, taintedCanvas: false });
  await submit(untainted);
  const results = untainted.ids.brandToolResults;

  // Company & phone rendered strictly via textContent; no extra img/script injected.
  const scripts = results.findAll(n => n.tagName === 'SCRIPT');
  assert.equal(scripts.length, 0, 'no <script> nodes may be created from hostile data');
  const dds = results.findAll(n => n.tagName === 'DD');
  assert.ok(dds.some(n => n.textContent === hostilePayload.company), 'hostile company string kept as plain textContent');
  assert.ok(dds.some(n => n.textContent === hostilePayload.phone), 'hostile phone string kept as plain textContent');

  // Social links only allow http(s).
  const socialLinks = results.findAll(n => n.tagName === 'A' && n.target === '_blank');
  assert.equal(socialLinks.length, 1, 'hostile non-http(s) social URLs are dropped');
  assert.equal(socialLinks[0].href, 'https://linkedin.com/company/evil');
  assert.equal(socialLinks[0].rel, 'nofollow noopener');

  // SVG logo is NEVER offered as a raw data:image/svg+xml download; rasterized PNG download is offered instead.
  const downloads = results.findAll(n => n.tagName === 'A' && n.className === 'brand-download');
  assert.equal(downloads.length, 1, 'rasterized PNG download offered when canvas is untainted');
  assert.ok(downloads[0].href.startsWith('data:image/png;base64,'), 'download href must be PNG, never SVG');
  assert.ok(!downloads[0].href.includes('svg+xml'), 'download href must never contain svg+xml');
  assert.ok(downloads[0].download.endsWith('-logo.png'), 'download filename must end with .png');

  // 2. Tainted SVG canvas omits the download link completely without throwing.
  const tainted = setupBrandTool({ payload: hostilePayload, taintedCanvas: true });
  await submit(tainted);
  const taintedDownloads = tainted.ids.brandToolResults.findAll(n => n.tagName === 'A' && n.className === 'brand-download');
  assert.equal(taintedDownloads.length, 0, 'tainted SVG canvas must omit download link rather than expose raw SVG');
  assert.equal(tainted.ids.brandToolStatus.className, 'brand-tool-status is-success');

  // 3. Non-image dataUri (e.g. data:text/html) is rejected outright.
  const htmlLogo = setupBrandTool({
    payload: { ok: true, site: 'https://acme.example', logo: { type: 'text/html', dataUri: 'data:text/html,<script>alert(1)</script>' } },
  });
  await submit(htmlLogo, 'acme.example');
  assert.equal(htmlLogo.ids.brandToolResults.findAll(n => n.tagName === 'IMG').length, 0, 'non-image data URI must not render <img>');
  assert.equal(htmlLogo.ids.brandToolResults.findAll(n => n.className === 'brand-download').length, 0);

  // 4. Safe raster PNG logo renders both <img> and direct PNG download link.
  const pngLogo = setupBrandTool({
    payload: { ok: true, site: 'https://acme.example', logo: { type: 'image/png', dataUri: PNG } },
  });
  await submit(pngLogo, 'acme.example');
  const pngDownloads = pngLogo.ids.brandToolResults.findAll(n => n.className === 'brand-download');
  assert.equal(pngDownloads.length, 1);
  assert.equal(pngDownloads[0].href, PNG);
  assert.equal(pngDownloads[0].download, 'acme.example-logo.png');

  // 5. Rejected clipboard writeText is caught gracefully (no unhandled rejection).
  const clipFail = setupBrandTool({
    payload: { ok: true, site: 'https://acme.example', colors: { primary: '#0891B2' } },
    clipboardWriteText: async () => { throw new Error('NotAllowedError'); },
  });
  await submit(clipFail, 'acme.example');
  const copyBtn = clipFail.ids.brandToolResults.findAll(n => n.className.includes('brand-copy'))[0];
  assert.ok(copyBtn, 'copy swatch button exists');
  copyBtn.listeners.click();
  await new Promise(r => setTimeout(r, 10));
  assert.match(clipFail.ids.brandToolStatus.textContent, /Could not copy #0891B2/);
  assert.equal(clipFail.ids.brandToolStatus.className, 'brand-tool-status is-error');

  console.log('Brand tool tests passed (XSS safety, SVG download rasterization, tainted canvas, clipboard guard).');
}

main().catch(err => { console.error(err); process.exitCode = 1; });
