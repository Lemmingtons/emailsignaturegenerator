// Renders every template with full, minimal, hostile and scheme-less input and
// checks the markup that would land in a recipient's inbox.
const assert = require('node:assert/strict');
require('../js/site-facts.js');
const core = require('../js/generator-core.js');
const { TEMPLATES } = require('../js/templates.js');
const facts = globalThis.SiteFacts;

const ids = Object.keys(TEMPLATES);
assert.equal(ids.length, facts.templateCount, 'every advertised template is covered');

const HOSTED_PHOTO = `${facts.origin}/u/0123456789abcdef0123456789abcdef/photo.jpg`;
const HOSTED_LOGO = `${facts.origin}/u/0123456789abcdef0123456789abcdef/logo.png`;
const PLACEHOLDERS = ['Professional', 'Licensed Agent'];

const scenarios = {
  full: {
    fullName: 'Jordan Rivera', title: 'Head of Growth', company: 'Northwind Studio', phone: '+61 2 5550 0101',
    email: 'jordan@northwind.example', website: 'https://northwind.example', photoUrl: HOSTED_PHOTO, logoUrl: HOSTED_LOGO,
    linkedin: 'https://linkedin.com/in/jordan', instagram: 'https://instagram.com/northwind', facebook: 'https://facebook.com/northwind',
    google: 'https://g.page/northwind', ctaText: 'Book a call', ctaUrl: 'https://cal.example/jordan', nameLinkUrl: 'https://northwind.example/jordan',
  },
  nameOnly: { fullName: 'Jordan Rivera' },
  hostile: {
    fullName: '<img src=x onerror=1>', title: '"><script>alert(1)</script>', company: '\'"><svg onload=alert(1)>',
    phone: '"><b>1</b>', email: 'x@y.co"><script>alert(1)</script>', website: 'javascript:alert(1)',
    linkedin: 'JaVaScRiPt:alert(1)', instagram: 'java\tscript:alert(1)', facebook: 'vbscript:msgbox(1)', google: 'file:///etc/passwd',
    ctaText: '<b>Book</b>', ctaUrl: 'javascript:alert(1)', nameLinkUrl: ' javascript:alert(1)',
    photoUrl: 'javascript:alert(1)', logoUrl: 'data:text/html,<script>alert(1)</script>',
  },
  schemeless: {
    fullName: 'Jordan Rivera', title: 'Head of Growth', company: 'Acme', website: 'acme.com',
    linkedin: 'linkedin.com/in/jordan', instagram: 'www.instagram.com/acme', facebook: 'facebook.com/acme', google: 'g.page/acme',
    ctaText: 'Book a call', ctaUrl: 'cal.example/jordan', nameLinkUrl: 'acme.com/jordan',
  },
};

const attrValues = (html, name) => [...html.matchAll(new RegExp(`\\s${name}="([^"]*)"`, 'gi'))].map((m) => m[1]);
const decode = (value) => value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, '\'');

function checkCommon(html, label) {
  assert.ok(!/<script/i.test(html), `${label}: no script element`);
  assert.ok(!/<[a-z][^>]*\son[a-z]+\s*=/i.test(html), `${label}: no event-handler attribute`);
  assert.ok(!/<(svg|iframe|object|embed|form|input)\b/i.test(html), `${label}: no active element`);
  assert.ok(!/(javascript|vbscript|file):/i.test(attrValues(html, 'href').concat(attrValues(html, 'src')).join(' ')), `${label}: no dangerous scheme`);
  for (const href of attrValues(html, 'href')) {
    assert.match(decode(href), /^(https?:\/\/[^/\s]+|mailto:|tel:)/i, `${label}: href "${href}" is absolute`);
  }
  for (const src of attrValues(html, 'src')) {
    assert.match(src, /^https:\/\//, `${label}: image "${src}" is a hosted https URL`);
    assert.ok(!/^data:/i.test(src) && !/\.svg(\?|#|$)/i.test(src), `${label}: no data: or SVG image`);
  }
  assert.ok(!/(&middot;|·|\|)<\/span>\s*<\/td>/.test(html), `${label}: no separator left dangling at the end of a cell`);
}

for (const id of ids) {
  const template = TEMPLATES[id];
  const render = (data, style) => core.buildSignatureHtml({ template, data, style: core.createStyle(style) });

  const full = render(scenarios.full, { ctaText: 'Book a call', ctaUrl: 'https://cal.example/team' });
  checkCommon(full, `${id}/full`);
  for (const text of ['Jordan Rivera', 'Head of Growth', 'Northwind Studio']) {
    assert.ok(full.includes(text) || full.includes(text.toUpperCase()), `${id}/full shows "${text}"`);
  }
  for (const word of PLACEHOLDERS) assert.ok(!full.includes(`>${word}<`), `${id}/full has no placeholder "${word}"`);
  assert.ok(attrValues(full, 'src').filter((src) => src.includes('/u/')).every((src) => src === HOSTED_PHOTO || src === HOSTED_LOGO),
    `${id}/full keeps hosted image URLs unchanged`);

  const minimal = render(scenarios.nameOnly, {});
  checkCommon(minimal, `${id}/name-only`);
  assert.ok(minimal.includes('Jordan Rivera') || minimal.includes('JORDAN RIVERA'), `${id}/name-only shows the name`);
  for (const word of PLACEHOLDERS) assert.ok(!minimal.includes(word), `${id}/name-only invents no "${word}" title`);
  // The title sits straight after the name in every layout.
  assert.ok(!/(<\/strong>|<\/a>)(<br\/>)?\s*<span[^>]*>\s*<\/span>/.test(minimal), `${id}/name-only leaves no empty title span`);
  assert.ok(!/background:[^;"]+;[^"]*padding: 3px 10px[^>]*>\s*<\/span>/.test(minimal), `${id}/name-only leaves no empty badge`);

  const hostile = render(scenarios.hostile, { ctaText: '<i>x</i>', ctaUrl: '' });
  checkCommon(hostile, `${id}/hostile`);
  assert.ok(hostile.toLowerCase().includes('&lt;img src=x onerror=1&gt;'), `${id}/hostile escapes the name`);
  assert.ok(!hostile.includes('<b>'), `${id}/hostile escapes markup in text fields`);

  const schemeless = render(scenarios.schemeless, { ctaText: 'Book a call', ctaUrl: '' });
  checkCommon(schemeless, `${id}/scheme-less`);
  const hrefs = attrValues(schemeless, 'href').map(decode);
  assert.ok(!hrefs.some((href) => /^https?:\/\/https?:/i.test(href)), `${id}/scheme-less never double-prefixes`);
  if (/>acme\.com</.test(schemeless)) assert.ok(hrefs.includes('https://acme.com'), `${id}/scheme-less links the typed website`);
  assert.ok(!schemeless.includes('>https://acme.com<'), `${id}/scheme-less keeps the website text as typed`);
  for (const expected of ['https://linkedin.com/in/jordan', 'https://www.instagram.com/acme', 'https://facebook.com/acme', 'https://g.page/acme']) {
    if (/linkedin|instagram|facebook|google/i.test(schemeless)) assert.ok(hrefs.includes(expected), `${id}/scheme-less links ${expected}`);
  }
  assert.ok(hrefs.includes('https://acme.com/jordan'), `${id}/scheme-less links the name`);
}

// Defects called out individually in review.
const render = (id, data) => core.buildSignatureHtml({ template: TEMPLATES[id], data, style: core.createStyle({}) });
for (const id of ['branded', 'socialstar']) assert.ok(render(id, { fullName: 'A', company: 'Acme Pty' }).includes('Acme Pty'), `${id} shows the company`);
const monogram = render('monogram', { fullName: 'A B', company: 'Acme' });
assert.match(monogram, /Acme\s*<\/td>/, 'monogram leaves no trailing separator after the company');
assert.ok(!render('bold', { fullName: 'A' }).includes('padding: 3px 10px'), 'bold draws no empty title badge');
assert.ok(render('bold', { fullName: 'A', company: 'Acme' }).includes('Acme</span>'), 'bold still shows a company without a title');
assert.ok(!/<br\/>\s*<span[^>]*>Acme/.test(render('realestate', { fullName: 'A', company: 'Acme' })), 'realestate starts with the company when there is no title');

// escapeUrl contract (explicit scheme allowlist + control char stripping).
const t = TEMPLATES.classic;
const cases = [
  ['acme.com', 'href', 'https://acme.com'],
  ['https://acme.com/a?b=1&c=2', 'href', 'https://acme.com/a?b=1&amp;c=2'],
  ['HTTP://ACME.COM', 'href', 'HTTP://ACME.COM'],
  ['//acme.com/x', 'href', 'https://acme.com/x'],
  ['//acme', 'href', ''],
  ['acme.com:8080/x', 'href', 'https://acme.com:8080/x'],
  ['mailto:a@acme.com', 'href', 'mailto:a@acme.com'],
  ['tel:+61255500101', 'href', 'tel:+61255500101'],
  ['https://acme.com/a\nb\r\tc\x00d', 'href', 'https://acme.com/abcd'],
  ['/about', 'href', ''], ['#top', 'href', ''], ['acme', 'href', ''], ['@acme', 'href', ''],
  ['javascript:alert(1)', 'href', ''], [' JAVA\tSCRIPT:alert(1)', 'href', ''], ['vbscript:x', 'href', ''],
  ['file:///etc/passwd', 'href', ''], ['data:text/html,x', 'href', ''], ['data:image/png;base64,AA', 'href', ''],
  ['blob:https://acme.com/123', 'href', ''], ['ms-msdt:/id', 'href', ''], ['intent://scan/#Intent;end', 'href', ''],
  ['ftp://acme.com/file.zip', 'href', ''],
  [HOSTED_PHOTO, 'src', HOSTED_PHOTO], ['data:image/png;base64,AA', 'src', 'data:image/png;base64,AA'],
  ['data:image/jpeg;base64,AA', 'src', 'data:image/jpeg;base64,AA'],
  ['data:image/webp;base64,AA', 'src', 'data:image/webp;base64,AA'],
  ['data:image/gif;base64,AA', 'src', 'data:image/gif;base64,AA'],
  ['data:image/svg+xml;base64,PHN2Zz4=', 'src', ''], ['data:image/svg+xml,<svg>', 'src', ''],
  ['data:text/html,x', 'src', ''], ['javascript:alert(1)', 'src', ''],
  ['blob:https://acme.com/123', 'src', ''], ['ms-msdt:/id', 'src', ''],
];
for (const [input, context, expected] of cases) assert.equal(t.escapeUrl(input, context), expected, `escapeUrl(${JSON.stringify(input)}, ${context})`);

// F-17: Gmail dark-mode _safeColor across all 28 templates (pure #000000 never emitted).
for (const id of ids) {
  const darkSafe = core.buildSignatureHtml({
    template: TEMPLATES[id],
    data: scenarios.full,
    style: { primaryColor: '#000000', secondaryColor: '#000000', textColor: '#000000', ctaText: 'Book', ctaUrl: 'https://cal.example/x' },
  });
  assert.ok(!/#000000\b/i.test(darkSafe), `${id}: must never emit #000000 in rendered output`);
}

// F-17: Outlook layout & portability checks.
// Dynamic colspan on banner and signature.
const bannerNoPhoto = core.buildSignatureHtml({ template: TEMPLATES.banner, data: { fullName: 'Alex' }, style: { ctaText: 'Book', ctaUrl: 'https://cal.example' } });
assert.ok(bannerNoPhoto.includes('colspan="1"') && !bannerNoPhoto.includes('colspan="2"'), 'banner uses colspan="1" without photo');
const bannerWithPhoto = core.buildSignatureHtml({ template: TEMPLATES.banner, data: { fullName: 'Alex', photoUrl: HOSTED_PHOTO }, style: { ctaText: 'Book', ctaUrl: 'https://cal.example' } });
assert.ok(bannerWithPhoto.includes('colspan="2"'), 'banner uses colspan="2" with photo');

const sigNoPhoto = core.buildSignatureHtml({ template: TEMPLATES.signature, data: { fullName: 'Alex', logoUrl: HOSTED_LOGO }, style: {} });
assert.ok(sigNoPhoto.includes('colspan="1"') && !sigNoPhoto.includes('colspan="2"'), 'signature uses colspan="1" without photo');
const sigWithPhoto = core.buildSignatureHtml({ template: TEMPLATES.signature, data: { fullName: 'Alex', photoUrl: HOSTED_PHOTO, logoUrl: HOSTED_LOGO }, style: {} });
assert.ok(sigWithPhoto.includes('colspan="2"'), 'signature uses colspan="2" with photo');

// dash omits empty social table when no socials exist.
assert.ok(!render('dash', { fullName: 'Alex' }).includes('<tbody></tbody>'), 'dash omits empty social table');

// creator omits empty photo / social spacer rows.
const creatorMin = render('creator', { fullName: 'Alex' });
assert.ok(!creatorMin.includes('padding-bottom: 10px'), 'creator omits empty photo row');
assert.ok(!creatorMin.includes('padding-bottom: 6px'), 'creator omits empty social row');

// cardstock omits orphaned divider & footer when no socials or CTA exist.
const cardMin = render('cardstock', { fullName: 'Alex' });
assert.ok(!cardMin.includes('padding-top: 16px'), 'cardstock omits orphaned footer divider when socials & CTA are absent');

// portrait renders 80x80 square photo instead of stretched 72x90.
const portraitHtml = render('portrait', { fullName: 'Alex', photoUrl: HOSTED_PHOTO });
assert.ok(portraitHtml.includes('width="80" height="80"'), 'portrait renders 80x80 square photo');
assert.ok(!portraitHtml.includes('height="90"'), 'portrait no longer stretches photo to 72x90');

// corporate, modern, trades put padding on <td> rather than <table>.
for (const id of ['corporate', 'modern', 'trades']) {
  const html = render(id, scenarios.full);
  const tableTags = [...html.matchAll(/<table\b[^>]*>/gi)].map((m) => m[0]);
  for (const tag of tableTags) {
    assert.ok(!/padding(?:-top|-left|-right|-bottom)?\s*:/i.test(tag), `${id}: no padding on <table> (${tag})`);
  }
}

// Unicode / non-BMP initials never produce broken lone surrogates.
assert.equal(t._initials('Jane Smith'), 'JS');
assert.equal(t._initials('🚀 Alice'), '🚀A');
assert.equal(t._initials('𠀀 李'), '𠀀李');
assert.equal(t._initials('😊'), '😊');
assert.ok(!/[\uD800-\uDFFF]/.test(t._initials('🚀 Alice').replace(/🚀/g, '')), 'no broken lone surrogates');

console.log(`Template output tests passed (${ids.length} templates x 4 scenarios + dark-mode, allowlist, layout & Unicode checks).`);
