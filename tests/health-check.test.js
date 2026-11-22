// Health Check engine & UI hardening tests: dark-mode pure black detection,
// WCAG AA contrast, tag balance & stray ampersands, oversized file rejection,
// escaped error messages, and reduced-motion scrollIntoView.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../js/health-check.js'), 'utf8');

// Minimal HTML parser sufficient for SignatureHealthCheck's DOM queries
// (children, tagName, getAttribute, hasAttribute, textContent, querySelectorAll,
// querySelector, firstElementChild).
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
  middot: '\u00b7', copy: '\u00a9', reg: '\u00ae', mdash: '\u2014', ndash: '\u2013',
  rarr: '\u2192', bull: '\u2022', lsquo: '\u2018', rsquo: '\u2019',
};

function decodeEntities(str) {
  return String(str).replace(/&(#[0-9]+|#x[0-9a-f]+|[a-z][a-z0-9]*);/gi, (full, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : full;
    }
    const val = NAMED_ENTITIES[body.toLowerCase()];
    return val !== undefined ? val : full;
  });
}

function makeNode(tagName, attrs = {}) {
  const node = {
    nodeType: 1,
    tagName: tagName.toUpperCase(),
    attrs,
    children: [],
    childNodes: [],
    get firstElementChild() { return this.children[0] || null; },
    get textContent() {
      return this.childNodes.map(c => (typeof c === 'string' ? c : c.textContent)).join('');
    },
    getAttribute(name) {
      const key = String(name).toLowerCase();
      return Object.prototype.hasOwnProperty.call(this.attrs, key) ? this.attrs[key] : null;
    },
    hasAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attrs, String(name).toLowerCase());
    },
    querySelectorAll(selector) {
      const out = [];
      const attrMatch = /^([a-z0-9-]+)\[([a-z0-9-]+)\]$/i.exec(selector.trim());
      const tagWanted = (attrMatch ? attrMatch[1] : selector.trim()).toUpperCase();
      const attrWanted = attrMatch ? attrMatch[2].toLowerCase() : null;
      function walk(el) {
        for (const child of el.children) {
          if (child.tagName === tagWanted && (!attrWanted || child.hasAttribute(attrWanted))) out.push(child);
          walk(child);
        }
      }
      walk(this);
      return out;
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    },
  };
  return node;
}

class MiniDOMParser {
  parseFromString(html) {
    const body = makeNode('body');
    const stack = [body];
    const tokenRe = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^>"']*(?:"[^"]*"|'[^']*')?)*?)\s*(\/?)>|([^<]+)/g;
    let m;
    while ((m = tokenRe.exec(String(html || '')))) {
      if (m[0].startsWith('<!--')) continue;
      if (m[5] !== undefined) {
        stack[stack.length - 1].childNodes.push(decodeEntities(m[5]));
        continue;
      }
      const closing = !!m[1];
      const tag = m[2].toLowerCase();
      const attrStr = m[3] || '';
      const selfClose = !!m[4];
      if (closing) {
        for (let i = stack.length - 1; i >= 1; i--) {
          if (stack[i].tagName.toLowerCase() === tag) {
            stack.length = i;
            break;
          }
        }
        continue;
      }
      const attrs = {};
      const attrRe = /([^\s"'=<>\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
      let am;
      while ((am = attrRe.exec(attrStr))) {
        const key = am[1].toLowerCase();
        const val = am[2] ?? am[3] ?? am[4] ?? '';
        attrs[key] = decodeEntities(val);
      }
      const node = makeNode(tag, attrs);
      const parent = stack[stack.length - 1];
      parent.children.push(node);
      parent.childNodes.push(node);
      if (!VOID_TAGS.has(tag) && !selfClose) stack.push(node);
    }
    return { body };
  }
}

function makeUiElement(id) {
  const attrs = {};
  const el = {
    id,
    value: '',
    hidden: false,
    textContent: '',
    innerHTML: '',
    className: '',
    style: {},
    listeners: {},
    parentNode: null,
    scrolled: [],
    setAttribute(k, v) { attrs[k] = String(v); },
    getAttribute(k) { return k in attrs ? attrs[k] : null; },
    addEventListener(type, fn) { this.listeners[type] = fn; },
    focus() { this.focused = true; },
    scrollIntoView(opts) { this.scrolled.push(opts); },
  };
  return el;
}

function loadHealthCheck(options = {}) {
  const ui = new Map();
  const container = {
    children: [],
    insertBefore(node) {
      this.children.push(node);
      if (node.id) ui.set(node.id, node);
      return node;
    },
  };
  for (const id of [
    'signatureInput', 'runCheckBtn', 'clearBtn', 'fileUpload', 'loadSampleBtn',
    'checkResults', 'issueList', 'scoreNumber', 'scoreRing', 'scoreTitle', 'scoreBlurb',
    'countCritical', 'countWarning', 'countInfo', 'countPass', 'rerunBtn',
  ]) {
    const el = makeUiElement(id);
    el.parentNode = container;
    ui.set(id, el);
  }

  let fileReaderReads = 0;
  class MockFileReader {
    readAsText(file) {
      fileReaderReads++;
      this.result = file.content || '';
      if (this.onload) this.onload();
    }
  }

  const windowObj = {
    matchMedia: options.reducedMotion
      ? () => ({ matches: true })
      : () => ({ matches: false }),
  };

  const context = {
    window: windowObj,
    document: {
      getElementById: id => ui.get(id) || null,
      createElement: tag => makeUiElement(tag),
    },
    DOMParser: MiniDOMParser,
    FileReader: MockFileReader,
    Blob: options.Blob || Blob,
    console,
  };

  vm.runInNewContext(source, context);
  return {
    api: windowObj.SignatureHealthCheck,
    ui,
    getFileReaderReads: () => fileReaderReads,
  };
}

// 1. #000000 pure black triggers darkmode critical; #111111 + light wrapper passes.
{
  const { api } = loadHealthCheck();
  const pureBlackHtml = '<table role="presentation" bgcolor="#ffffff" style="background-color:#ffffff;"><tr><td><span style="color:#000000;">Jane Smith</span></td></tr></table>';
  const res = api.runAudit(pureBlackHtml);
  const dark = res.results.find(r => r.id === 'darkmode');
  assert.equal(dark.severity, 'critical', 'pure #000000 text must trigger darkmode critical');
  assert.match(dark.message, /#000000/);

  const safeHtml = '<table role="presentation" bgcolor="#ffffff" style="background-color:#ffffff;"><tr><td bgcolor="#ffffff" style="background-color:#ffffff;"><span style="color:#111111;">Jane Smith</span></td></tr></table>';
  const safeRes = api.runAudit(safeHtml);
  assert.equal(safeRes.results.find(r => r.id === 'darkmode').severity, 'pass', 'explicit white wrapper with #111111 passes darkmode');
}

// 2. WCAG AA contrast check catches low-contrast text and passes high-contrast text.
{
  const { api } = loadHealthCheck();
  const lowContrast = '<table role="presentation" bgcolor="#ffffff" style="background-color:#ffffff;"><tr><td bgcolor="#ffffff" style="background-color:#ffffff;"><span style="color:#b0b0b0;">Marketing Manager</span></td></tr></table>';
  const res = api.runAudit(lowContrast);
  const contrast = res.results.find(r => r.id === 'contrast');
  assert.equal(contrast.severity, 'critical', '#b0b0b0 on #ffffff (<3:1) must fail contrast as critical');

  const highContrast = '<table role="presentation" bgcolor="#ffffff" style="background-color:#ffffff;"><tr><td bgcolor="#ffffff" style="background-color:#ffffff;"><span style="color:#1d1d1f;">Marketing Manager</span></td></tr></table>';
  assert.equal(api.runAudit(highContrast).results.find(r => r.id === 'contrast').severity, 'pass');
}

// 3. Tag balance, unquoted attributes, and stray ampersands.
{
  const { api } = loadHealthCheck();
  const unclosed = '<table role="presentation" bgcolor="#ffffff" style="background-color:#ffffff;"><tr><td><span>Jane Smith</td></tr></table>';
  const unclosedRes = api.runAudit(unclosed).results.find(r => r.id === 'valid');
  assert.equal(unclosedRes.severity, 'critical');
  assert.match(unclosedRes.message, /unclosed &lt;span&gt;/);

  const strayClose = '<table role="presentation" bgcolor="#ffffff" style="background-color:#ffffff;"><tr><td>Jane</span></td></tr></table>';
  assert.equal(api.runAudit(strayClose).results.find(r => r.id === 'valid').severity, 'critical');

  const strayAmp = '<table role="presentation" bgcolor="#ffffff" style="background-color:#ffffff;"><tr><td>Harbour & Co</td></tr></table>';
  const ampRes = api.runAudit(strayAmp).results.find(r => r.id === 'valid');
  assert.equal(ampRes.severity, 'critical');
  assert.match(ampRes.message, /unescaped &amp;/);

  const validAmp = '<table role="presentation" bgcolor="#ffffff" style="background-color:#ffffff;"><tr><td>Harbour &amp; Co &middot; Sales</td></tr></table>';
  assert.equal(api.runAudit(validAmp).results.find(r => r.id === 'valid').severity, 'pass');
}

// 4. Oversized file upload (> 2 MB) is rejected cleanly without reading.
{
  const { ui, getFileReaderReads } = loadHealthCheck();
  const fileUpload = ui.get('fileUpload');
  fileUpload.value = 'C:\\fakepath\\huge.eml';
  fileUpload.listeners.change({ target: { files: [{ name: 'huge.eml', size: 3 * 1024 * 1024, content: '<html>big</html>' }] } });
  assert.equal(getFileReaderReads(), 0, 'oversized file must never be passed to FileReader');
  assert.equal(fileUpload.value, '', 'file input is cleared on rejection');
  const errEl = ui.get('fileUploadError');
  assert.ok(errEl && !errEl.hidden, 'user-visible error is shown for oversized upload');
  assert.match(errEl.textContent, /2 MB/);

  // A normal-sized file succeeds and clears the error.
  fileUpload.listeners.change({ target: { files: [{ name: 'sig.html', size: 1024, content: '<table><tr><td>Hi</td></tr></table>' }] } });
  assert.equal(getFileReaderReads(), 1, 'normal file is read');
  assert.equal(ui.get('signatureInput').value, '<table><tr><td>Hi</td></tr></table>');
  assert.equal(ui.get('fileUploadError').hidden, true);
}

// 5. Error message escaping when a check throws with hostile HTML in err.message.
{
  const ThrowingBlob = function () {
    throw new Error('<img src=x onerror=alert(1)>');
  };
  const { api, ui } = loadHealthCheck({ Blob: ThrowingBlob });
  const res = api.runAudit('<table><tr><td>Hi</td></tr></table>');
  const sizeCheck = res.results.find(r => r.id === 'size');
  assert.equal(sizeCheck.severity, 'info');
  assert.ok(!sizeCheck.message.includes('<img'), 'thrown error message must be HTML-escaped');
  assert.ok(sizeCheck.message.includes('&lt;img src=x onerror=alert(1)&gt;'), 'escaped error text is preserved');

  // Ensure rendering into issueList also contains no raw injected tag.
  ui.get('signatureInput').value = '<table><tr><td>Hi</td></tr></table>';
  ui.get('runCheckBtn').listeners.click();
  assert.ok(!ui.get('issueList').innerHTML.includes('<img src=x'), 'issueList must not receive unescaped error HTML');
}

// 6. prefers-reduced-motion: reduce uses auto scroll behavior instead of smooth.
{
  const { ui } = loadHealthCheck({ reducedMotion: true });
  ui.get('signatureInput').value = '<table role="presentation" bgcolor="#ffffff" style="background-color:#ffffff;"><tr><td>Hi</td></tr></table>';
  ui.get('runCheckBtn').listeners.click();
  assert.equal(ui.get('checkResults').scrolled.length, 1);
  assert.equal(ui.get('checkResults').scrolled[0].behavior, 'auto');
}

console.log('Health check tests passed (dark mode, contrast, HTML validity, file cap, error escaping, reduced motion).');
