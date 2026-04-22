/* ──────────────────────────────────────────────────────────────
   Email Signature Health Check
   emailsignaturegenerator.ai/health-check

   Runs entirely client-side. Parses pasted HTML with DOMParser and
   runs a battery of audit checks, scoring the signature out of 100.

   Severity levels:
     critical  = will visibly break for many recipients
     warning   = works but risks cross-client issues
     info      = minor / polish
────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  // ── Known tracker domains (sample list, not exhaustive) ──
  const TRACKER_DOMAINS = [
    'mailtrack.io', 'mxtoolbox.com', 'bananatag.com', 'yesware.com',
    'mixmax.com', 'outreach.io', 'hubspotlinks.com', 'intellimail.com',
    'sidekickopen', 'signals.hubspot', 'superhuman.com', 'mailgun',
    'sendgrid.net', 'mailchimp.com', 'pipedrive.com', 'salesloft.com',
    'activecampaign.com', 'clearbit', 'postmark', 'constantcontact',
    'cirrusinsight.com', 'docsend.com',
  ];

  // Hex colour patterns & helpers ─────────────────────────
  const HEX_SHORT = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i;
  const HEX_LONG = /^#([0-9a-f]{6})$/i;

  function parseColor(str) {
    if (!str) return null;
    str = String(str).trim().toLowerCase();

    // Named colour shortcuts
    const named = {
      black: '#000000', white: '#ffffff', red: '#ff0000',
      blue: '#0000ff', green: '#008000', gray: '#808080',
      grey: '#808080', navy: '#000080', silver: '#c0c0c0',
    };
    if (named[str]) str = named[str];

    // #rgb → #rrggbb
    let m = str.match(HEX_SHORT);
    if (m) return { r: parseInt(m[1] + m[1], 16), g: parseInt(m[2] + m[2], 16), b: parseInt(m[3] + m[3], 16) };
    m = str.match(HEX_LONG);
    if (m) {
      const h = m[1];
      return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
    }
    // rgb(...) / rgba(...)
    m = str.match(/^rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (m) return { r: +m[1], g: +m[2], b: +m[3] };
    return null;
  }

  function relLuminance({ r, g, b }) {
    const srgb = [r, g, b].map(c => {
      c /= 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
  }

  function contrastRatio(c1, c2) {
    const l1 = relLuminance(c1);
    const l2 = relLuminance(c2);
    const bright = Math.max(l1, l2);
    const dark = Math.min(l1, l2);
    return (bright + 0.05) / (dark + 0.05);
  }

  // ── Style-attribute parser ──────────────────────────────
  function parseInlineStyle(styleStr) {
    const out = {};
    if (!styleStr) return out;
    styleStr.split(';').forEach(pair => {
      const idx = pair.indexOf(':');
      if (idx < 0) return;
      const k = pair.slice(0, idx).trim().toLowerCase();
      const v = pair.slice(idx + 1).trim();
      if (k) out[k] = v;
    });
    return out;
  }

  // ── Walk every node and collect effective colour pairs ──
  function collectColorPairs(root) {
    const pairs = [];
    function walk(node, inheritedBg) {
      if (!node || node.nodeType !== 1) return;
      const inline = parseInlineStyle(node.getAttribute && node.getAttribute('style'));
      const bgAttr = node.getAttribute && (node.getAttribute('bgcolor') || node.getAttribute('background-color'));
      let bg = inline['background-color'] || inline['background'] || bgAttr || inheritedBg;
      // Extract just the colour out of shorthand background
      if (bg && !parseColor(bg)) {
        const m = bg.match(/(#[0-9a-f]{3,6}|rgba?\([^)]+\)|\b(black|white|red|blue|green|gray|grey)\b)/i);
        if (m) bg = m[1];
      }
      const color = inline['color'] || (node.getAttribute && node.getAttribute('color'));
      const bgCol = parseColor(bg);
      const fgCol = parseColor(color);
      if (fgCol && (node.textContent || '').trim()) {
        pairs.push({
          fg: fgCol,
          bg: bgCol,
          raw: { color, bg },
          element: node.tagName,
          text: (node.textContent || '').trim().slice(0, 60),
          hasExplicitBg: !!bgCol,
        });
      }
      for (let i = 0; i < node.children.length; i++) walk(node.children[i], bg || inheritedBg);
    }
    walk(root, null);
    return pairs;
  }

  // ── Individual checks ──────────────────────────────────
  const checks = [];

  function addCheck(def) { checks.push(def); }

  addCheck({
    id: 'size',
    label: 'Total HTML size',
    run(ctx) {
      const bytes = new Blob([ctx.html]).size;
      const kb = (bytes / 1024).toFixed(1);
      if (bytes > 25 * 1024) return { severity: 'critical', message: `Signature is ${kb}KB — Gmail clips messages over 102KB and large signatures eat that budget fast.`, fix: 'Remove embedded base64 images, unused CSS, or oversized tables. Target under 10KB.' };
      if (bytes > 10 * 1024) return { severity: 'warning', message: `Signature is ${kb}KB — larger than recommended.`, fix: 'Aim for under 10KB to avoid Gmail clipping on long threads.' };
      return { severity: 'pass', message: `Size: ${kb}KB — well under the Gmail clipping limit.` };
    },
  });

  addCheck({
    id: 'darkmode',
    label: 'Gmail dark-mode safety',
    run(ctx) {
      const issues = [];
      const pairs = ctx.pairs;
      // pure black text
      const pureBlack = pairs.filter(p => p.fg && p.fg.r === 0 && p.fg.g === 0 && p.fg.b === 0);
      if (pureBlack.length) issues.push(`${pureBlack.length} text node(s) use pure #000000 — Gmail auto-inverts this to white in dark mode, which can invisibly bleed into your background.`);
      // text with no explicit background
      const noBg = pairs.filter(p => p.fg && !p.hasExplicitBg);
      if (noBg.length > 2) issues.push(`${noBg.length} text node(s) have no explicit background-color. Gmail dark mode will place them on a dark background — low-luminance colours (greys, brand colours) become unreadable.`);
      // unwrapped outer element
      const outer = ctx.doc.body.firstElementChild;
      let hasLightWrap = false;
      if (outer) {
        const s = parseInlineStyle(outer.getAttribute('style'));
        const bgAttr = outer.getAttribute('bgcolor');
        hasLightWrap = !!(s['background-color'] || s['background'] || bgAttr);
      }
      if (!hasLightWrap) issues.push('Outer element has no background-color — recipients in dark mode will see your signature on their dark background, not yours.');

      if (issues.length) {
        const severity = (pureBlack.length || !hasLightWrap) ? 'critical' : 'warning';
        return { severity, message: `Dark-mode risks detected: ${issues.join(' ')}`, fix: 'Wrap the whole signature in a <table bgcolor="#ffffff"> with an explicit background-color inline style, and replace pure #000 text with #111111. Gmail leaves one-byte-off values alone.' };
      }
      return { severity: 'pass', message: 'Outer element has an explicit background and no pure-black text — signature should survive Gmail dark mode.' };
    },
  });

  addCheck({
    id: 'contrast',
    label: 'WCAG AA contrast',
    run(ctx) {
      const white = { r: 255, g: 255, b: 255 };
      const dark = { r: 31, g: 31, b: 31 }; // common Gmail dark bg
      const isDecorative = (txt) => !txt || txt.length <= 3 || /^[\s·•|\/\-–—]+$/.test(txt);
      const problems = [];
      const decorative = [];
      ctx.pairs.forEach(p => {
        if (!p.fg) return;
        const bg = p.bg || white;
        const ratio = contrastRatio(p.fg, bg);
        const hex = '#' + [p.fg.r, p.fg.g, p.fg.b].map(v => v.toString(16).padStart(2, '0')).join('');
        if (ratio < 4.5) {
          const bucket = isDecorative(p.text) ? decorative : problems;
          bucket.push({ text: p.text, ratio: ratio.toFixed(2), hex });
        }
        // Also flag text that will fail on Gmail dark bg when no explicit bg wraps it
        if (!p.hasExplicitBg) {
          const darkRatio = contrastRatio(p.fg, dark);
          if (darkRatio < 4.5) {
            const bucket = isDecorative(p.text) ? decorative : problems;
            bucket.push({ text: p.text || '(element)', ratio: darkRatio.toFixed(2), hex, onDark: true });
          }
        }
      });
      if (problems.length === 0 && decorative.length === 0) return { severity: 'pass', message: 'All text/background colour pairs pass WCAG AA (≥4.5:1).' };
      if (problems.length === 0) {
        return { severity: 'info', message: `${decorative.length} decorative element(s) (dividers, punctuation) have low contrast. Cosmetic but consider darkening for low-vision users.`, fix: 'Darken divider characters (e.g. #9ca3af → #4b5563) so they remain visible in both themes.' };
      }
      const top = problems.slice(0, 3).map(p => `"${p.text.slice(0, 30)}" (${p.hex} → ${p.ratio}:1${p.onDark ? ' on dark bg' : ''})`).join('; ');
      const severity = problems.some(p => parseFloat(p.ratio) < 3) ? 'critical' : 'warning';
      return { severity, message: `${problems.length} colour pair(s) fail WCAG AA 4.5:1. Examples: ${top}.`, fix: 'Darken foreground text or add an explicit background-color. Use #4b5563 for muted grays instead of #6b7280.' };
    },
  });

  addCheck({
    id: 'outlook',
    label: 'Outlook compatibility',
    run(ctx) {
      const issues = [];
      const htmlLower = ctx.html.toLowerCase();
      if (/display\s*:\s*flex/.test(htmlLower)) issues.push('<code>display:flex</code> — Outlook 2007–2019 ignores it, collapsing your layout.');
      if (/display\s*:\s*grid/.test(htmlLower)) issues.push('<code>display:grid</code> — Outlook strips grid; use nested tables.');
      if (/<style[\s>]/.test(htmlLower) && !/@media/.test(htmlLower)) issues.push('Embedded <code>&lt;style&gt;</code> block — Outlook and some webmail clients strip it. Use inline styles.');
      if (/<link[^>]+stylesheet/.test(htmlLower)) issues.push('External stylesheet (<code>&lt;link rel="stylesheet"&gt;</code>) — almost all email clients strip this.');
      if (/<td[^>]*style="[^"]*margin/.test(htmlLower)) issues.push('<code>margin</code> on <code>&lt;td&gt;</code> — Outlook ignores margin on table cells. Use padding instead.');
      if (/\bposition\s*:\s*(absolute|fixed|sticky)/.test(htmlLower)) issues.push('CSS positioning (<code>position:absolute/fixed</code>) — not supported in Outlook.');
      if (/[^a-z]rem\b|[^a-z]vh\b|[^a-z]vw\b/.test(htmlLower)) issues.push('Viewport/rem units — Outlook uses Word rendering; stick to px.');

      if (!issues.length) return { severity: 'pass', message: 'No Outlook-breaking patterns detected. HTML should render consistently across desktop and webmail.' };
      const severity = issues.length >= 2 ? 'critical' : 'warning';
      return { severity, message: `${issues.length} Outlook rendering issue(s): ${issues.join(' ')}`, fix: 'Use nested HTML tables with inline styles. Padding on <td>, not margin.' };
    },
  });

  addCheck({
    id: 'trackers',
    label: 'Tracker pixels',
    run(ctx) {
      const imgs = ctx.doc.querySelectorAll('img');
      const trackers = [];
      imgs.forEach(img => {
        const src = img.getAttribute('src') || '';
        const w = parseInt(img.getAttribute('width') || '0', 10);
        const h = parseInt(img.getAttribute('height') || '0', 10);
        const style = parseInlineStyle(img.getAttribute('style'));
        const sw = parseInt(style.width || '0', 10);
        const sh = parseInt(style.height || '0', 10);
        const effW = w || sw;
        const effH = h || sh;
        if ((effW === 1 && effH === 1) || /pixel|tracking|track\.|analytics|open-tracker/i.test(src)) {
          trackers.push(src.slice(0, 60));
        }
        TRACKER_DOMAINS.forEach(d => {
          if (src.toLowerCase().includes(d) && !trackers.includes(src.slice(0, 60))) {
            trackers.push(src.slice(0, 60));
          }
        });
      });
      if (!trackers.length) return { severity: 'pass', message: 'No tracker pixels detected.' };
      return { severity: 'warning', message: `${trackers.length} likely tracker pixel(s) found. Recipient spam filters often block these and can down-rank the whole signature.`, fix: 'Remove tracking pixels — they degrade deliverability and most clients block them anyway.' };
    },
  });

  addCheck({
    id: 'responsive',
    label: 'Responsive width',
    run(ctx) {
      const tables = ctx.doc.querySelectorAll('table');
      let maxFixed = 0;
      tables.forEach(t => {
        const w = parseInt(t.getAttribute('width') || '0', 10);
        const style = parseInlineStyle(t.getAttribute('style'));
        const sw = parseInt((style.width || '0').replace('px', ''), 10);
        const ew = Math.max(w, sw);
        if (ew > maxFixed) maxFixed = ew;
      });
      if (maxFixed > 700) return { severity: 'warning', message: `Largest fixed-width table is ${maxFixed}px. On mobile that forces horizontal scroll or tiny font.`, fix: 'Keep tables under 600px; use percentage widths on inner cells.' };
      return { severity: 'pass', message: `Largest fixed table width is ${maxFixed}px — mobile-safe.` };
    },
  });

  addCheck({
    id: 'accessibility',
    label: 'Accessibility',
    run(ctx) {
      const problems = [];
      const imgs = ctx.doc.querySelectorAll('img');
      let missingAlt = 0;
      imgs.forEach(img => {
        if (!img.hasAttribute('alt')) missingAlt++;
      });
      if (missingAlt) problems.push(`${missingAlt} image(s) missing <code>alt</code>. Screen readers skip them.`);
      const tables = ctx.doc.querySelectorAll('table');
      let missingRole = 0;
      tables.forEach(t => {
        if (t.getAttribute('role') !== 'presentation') missingRole++;
      });
      if (missingRole) problems.push(`${missingRole} layout table(s) without <code>role="presentation"</code> — announced as data tables.`);
      const links = ctx.doc.querySelectorAll('a');
      let emptyLinks = 0;
      links.forEach(a => {
        if (!(a.textContent || '').trim() && !a.querySelector('img[alt]')) emptyLinks++;
      });
      if (emptyLinks) problems.push(`${emptyLinks} link(s) with no accessible text.`);

      if (!problems.length) return { severity: 'pass', message: 'All images have alt text; tables have presentation role; links have accessible text.' };
      return { severity: 'warning', message: `Accessibility issues: ${problems.join(' ')}`, fix: 'Add alt attributes to every <img>. Add role="presentation" to layout tables. Give every <a> visible or aria-labelled text.' };
    },
  });

  addCheck({
    id: 'valid',
    label: 'Valid HTML',
    run(ctx) {
      // Parse as XML to actually catch unclosed tags and malformed markup
      const xmlParser = new DOMParser();
      const xmlDoc = xmlParser.parseFromString(ctx.html, 'application/xml');
      const xmlErrs = xmlDoc.querySelectorAll('parsererror');
      if (xmlErrs.length) return { severity: 'critical', message: 'Parser errors detected — the HTML is malformed and will render unpredictably.', fix: 'Close every tag, escape & characters as &amp;, and quote attribute values.' };
      return { severity: 'pass', message: 'HTML parses cleanly.' };
    },
  });

  addCheck({
    id: 'links',
    label: 'Link formatting',
    run(ctx) {
      const links = ctx.doc.querySelectorAll('a');
      const issues = [];
      let emails = 0, tels = 0, bareUrls = 0;
      links.forEach(a => {
        const h = (a.getAttribute('href') || '').trim();
        if (!h) return;
        if (/^[^:]+@/.test(h)) emails++;
        if (/^\+?[\d\s().-]+$/.test(h)) tels++;
        if (!/^(https?:|mailto:|tel:|#)/i.test(h)) bareUrls++;
      });
      if (emails) issues.push(`${emails} email link(s) missing <code>mailto:</code> prefix.`);
      if (tels) issues.push(`${tels} phone link(s) missing <code>tel:</code> prefix.`);
      if (bareUrls) issues.push(`${bareUrls} link(s) missing protocol (<code>https://</code>).`);
      if (!issues.length) return { severity: 'pass', message: 'All links have proper protocols (mailto:, tel:, https://).' };
      return { severity: 'info', message: `Link formatting: ${issues.join(' ')}`, fix: 'Prefix email hrefs with mailto:, phone hrefs with tel:, and URLs with https://.' };
    },
  });

  addCheck({
    id: 'images',
    label: 'Image hosts',
    run(ctx) {
      const imgs = ctx.doc.querySelectorAll('img');
      const issues = [];
      let httpCount = 0, dataUri = 0, missingDims = 0;
      imgs.forEach(img => {
        const src = img.getAttribute('src') || '';
        if (/^http:\/\//i.test(src)) httpCount++;
        if (/^data:/i.test(src)) dataUri++;
        if (!img.getAttribute('width') && !img.getAttribute('height')) missingDims++;
      });
      if (httpCount) issues.push(`${httpCount} image(s) use <code>http://</code> — Gmail blocks mixed-content images.`);
      if (dataUri) issues.push(`${dataUri} image(s) use base64 <code>data:</code> URIs — Gmail strips these from display; host them instead.`);
      if (missingDims) issues.push(`${missingDims} image(s) missing width/height attributes — layout jumps before load.`);
      if (!issues.length) return { severity: 'pass', message: 'All images use HTTPS hosts and declare dimensions.' };
      const severity = (httpCount || dataUri) ? 'warning' : 'info';
      return { severity, message: `Image issues: ${issues.join(' ')}`, fix: 'Host images on an HTTPS server (Imgur, your CDN). Set explicit width/height attributes.' };
    },
  });

  // ── Runner ─────────────────────────────────────────────
  const SEVERITY_WEIGHTS = { critical: 20, warning: 7, info: 2 };

  function runAudit(rawHtml) {
    const html = (rawHtml || '').trim();
    if (!html) return null;

    // Strip full-document <html>/<head> if the user pasted a whole email
    let fragment = html;
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    if (bodyMatch) fragment = bodyMatch[1];

    const doc = new DOMParser().parseFromString(fragment, 'text/html');
    const pairs = collectColorPairs(doc.body);
    const ctx = { html, fragment, doc, pairs };

    const results = checks.map(c => {
      try {
        const r = c.run(ctx);
        return Object.assign({ id: c.id, label: c.label }, r);
      } catch (err) {
        return { id: c.id, label: c.label, severity: 'info', message: 'Check could not run: ' + err.message };
      }
    });

    let penalty = 0;
    results.forEach(r => {
      if (r.severity && SEVERITY_WEIGHTS[r.severity]) penalty += SEVERITY_WEIGHTS[r.severity];
    });
    const score = Math.max(0, Math.min(100, 100 - penalty));

    return {
      score,
      results,
      counts: {
        critical: results.filter(r => r.severity === 'critical').length,
        warning: results.filter(r => r.severity === 'warning').length,
        info: results.filter(r => r.severity === 'info').length,
        pass: results.filter(r => r.severity === 'pass').length,
      },
    };
  }

  // ── UI wiring ──────────────────────────────────────────
  const input = document.getElementById('signatureInput');
  const runBtn = document.getElementById('runCheckBtn');
  const clearBtn = document.getElementById('clearBtn');
  const fileInput = document.getElementById('fileUpload');
  const loadSampleBtn = document.getElementById('loadSampleBtn');
  const resultsSection = document.getElementById('checkResults');
  const issueList = document.getElementById('issueList');
  const scoreNumber = document.getElementById('scoreNumber');
  const scoreRing = document.getElementById('scoreRing');
  const scoreTitle = document.getElementById('scoreTitle');
  const scoreBlurb = document.getElementById('scoreBlurb');
  const countCritical = document.getElementById('countCritical');
  const countWarning = document.getElementById('countWarning');
  const countInfo = document.getElementById('countInfo');
  const countPass = document.getElementById('countPass');
  const rerunBtn = document.getElementById('rerunBtn');

  const SEVERITY_ICONS = {
    critical: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
    warning: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    info: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    pass: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  };

  function scoreCategory(score) {
    if (score >= 90) return { title: 'Excellent signature.', blurb: 'Your signature is in great shape. Minor polish items below.', ringClass: 'score-excellent' };
    if (score >= 75) return { title: 'Good, with room to improve.', blurb: 'A few fixable issues could push this to 90+.', ringClass: 'score-good' };
    if (score >= 50) return { title: 'Needs work.', blurb: 'Several recipients will see a broken or degraded signature.', ringClass: 'score-warn' };
    return { title: 'Critical issues found.', blurb: 'This signature likely breaks for a large share of recipients. Review the critical items below.', ringClass: 'score-bad' };
  }

  function renderIssue(r) {
    if (r.severity === 'pass') {
      return `<div class="check-issue pass" role="listitem">
        <span class="issue-icon" aria-hidden="true">${SEVERITY_ICONS.pass}</span>
        <div class="issue-body">
          <div class="issue-head"><strong>${r.label}</strong><span class="issue-severity pass">Pass</span></div>
          <p class="issue-message">${r.message}</p>
        </div>
      </div>`;
    }
    return `<div class="check-issue ${r.severity}" role="listitem">
      <span class="issue-icon" aria-hidden="true">${SEVERITY_ICONS[r.severity] || ''}</span>
      <div class="issue-body">
        <div class="issue-head"><strong>${r.label}</strong><span class="issue-severity ${r.severity}">${r.severity}</span></div>
        <p class="issue-message">${r.message}</p>
        ${r.fix ? `<p class="issue-fix"><strong>Fix:</strong> ${r.fix}</p>` : ''}
      </div>
    </div>`;
  }

  function render(result) {
    if (!result) {
      resultsSection.hidden = true;
      return;
    }
    const cat = scoreCategory(result.score);
    scoreNumber.textContent = result.score;
    scoreRing.className = 'check-score-ring ' + cat.ringClass;
    scoreTitle.textContent = cat.title;
    scoreBlurb.textContent = cat.blurb;
    countCritical.textContent = result.counts.critical;
    countWarning.textContent = result.counts.warning;
    countInfo.textContent = result.counts.info;
    countPass.textContent = result.counts.pass;

    const order = { critical: 0, warning: 1, info: 2, pass: 3 };
    const sorted = result.results.slice().sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9));
    issueList.innerHTML = sorted.map(renderIssue).join('');
    resultsSection.hidden = false;
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  runBtn.addEventListener('click', function () {
    const result = runAudit(input.value);
    if (!result) {
      input.focus();
      return;
    }
    render(result);
  });

  rerunBtn && rerunBtn.addEventListener('click', function () {
    const result = runAudit(input.value);
    render(result);
  });

  clearBtn.addEventListener('click', function () {
    input.value = '';
    resultsSection.hidden = true;
    input.focus();
  });

  fileInput.addEventListener('change', function (e) {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = function () {
      let text = String(reader.result || '');
      // For .eml: extract the HTML body if present
      const m = text.match(/<html[\s\S]*<\/html>/i);
      if (f.name.toLowerCase().endsWith('.eml') && m) text = m[0];
      input.value = text;
    };
    reader.readAsText(f);
  });

  loadSampleBtn.addEventListener('click', function () {
    input.value = SAMPLE_BAD_SIGNATURE;
    // auto-run so the user sees the value immediately
    const result = runAudit(input.value);
    render(result);
  });

  // A deliberately flawed sample so visitors can see what the audit catches.
  const SAMPLE_BAD_SIGNATURE = `<table>
  <tr>
    <td>
      <img src="http://example.com/photo.jpg" />
    </td>
    <td style="display: flex; padding: 12px;">
      <span style="color: #000000; font-family: Arial;">
        <b>Jane Smith</b><br>
        <span style="color: #888888;">Marketing Manager</span><br>
        <a href="jane@example.com">jane@example.com</a>
        &middot;
        <a href="0400000000">0400 000 000</a>
      </span>
      <img src="http://track.example.com/pixel.gif" width="1" height="1" />
    </td>
  </tr>
</table>`;

})();
