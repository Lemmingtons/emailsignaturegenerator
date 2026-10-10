// Reads a company's public branding out of its homepage HTML: name, logo
// candidates, colours, social profiles and phone. Pure string work, so it runs
// the same under the Worker and under Node tests. Server-only: never served.
//
// Everything returned is a plain string. The client writes it into form fields
// with .value and the templates escape on render, so nothing here needs to be
// HTML-safe, only bounded and well-formed.

const MAX_TEXT = 120;

const SOCIAL_PATTERNS = {
  linkedin: /^https?:\/\/([a-z]{2,3}\.)?linkedin\.com\/(company|in|school|showcase)\/[^/?#\s]+/i,
  instagram: /^https?:\/\/(www\.)?instagram\.com\/(?!p\/|reel\/|explore\/|accounts\/|share)[A-Za-z0-9_.]+\/?$/i,
  facebook: /^https?:\/\/(www\.|m\.|business\.)?facebook\.com\/(?!sharer|share|dialog|plugins|tr\b|events\/|groups\/)[^?#\s]+/i,
  google: /^https?:\/\/(g\.page\/|g\.co\/kgs\/|maps\.app\.goo\.gl\/|share\.google\/|(www\.)?google\.[a-z.]+\/maps\/place\/|business\.google\.com\/)/i,
};

const ORG_TYPE = /Organization|Corporation|Business|Store|Service|Agency|Agent|Practice|Office|Restaurant|Brand|Company|Dentist|Physician|Attorney|Contractor|Clinic|School|Hotel/i;

export function decodeEntities(value) {
  return String(value || '')
    .replace(/&#(\d+);/g, (_, n) => safeCodePoint(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => safeCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function safeCodePoint(n) {
  return Number.isFinite(n) && n > 31 && n < 0x110000 ? String.fromCodePoint(n) : '';
}

export function cleanText(value, max = MAX_TEXT) {
  const text = decodeEntities(String(value || '').replace(/<[^>]*>/g, ' '))
    .replace(/[\u0000-\u001f\u007f<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? text.slice(0, max).trim() : text;
}

// Attributes of one start tag, lower-cased names, entity-decoded values.
export function parseAttributes(tag) {
  const attrs = {};
  const re = /([^\s=<>"'/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  const body = tag.replace(/^<\s*[a-z0-9-]+/i, '').replace(/\/?>$/, '');
  let m;
  while ((m = re.exec(body))) {
    const name = m[1].toLowerCase();
    if (!(name in attrs)) attrs[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return attrs;
}

function tags(html, name) {
  return html.match(new RegExp(`<${name}\\b[^>]*>`, 'gi')) || [];
}

export function absoluteUrl(href, base) {
  if (!href) return '';
  const trimmed = String(href).trim();
  if (!trimmed || /^(data|javascript|mailto|tel|blob|about):/i.test(trimmed)) return '';
  try {
    const url = new URL(trimmed, base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    url.hash = '';
    return url.href;
  } catch {
    return '';
  }
}

// ── Colours ──

export function normalizeHex(value) {
  const m = String(value || '').trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) {
    const rgb = String(value || '').trim().match(/^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/i);
    if (!rgb) return '';
    if (rgb[4] !== undefined && parseFloat(rgb[4]) === 0) return '';
    const parts = rgb.slice(1, 4).map(Number);
    if (parts.some((n) => n > 255)) return '';
    return '#' + parts.map((n) => n.toString(16).padStart(2, '0')).join('').toUpperCase();
  }
  let hex = m[1];
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  return '#' + hex.toUpperCase();
}

function hsl(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}

// A brand colour has to read as a colour on white: not grey, not near-white,
// not near-black.
export function isBrandColor(hex) {
  if (!hex) return false;
  const { s, l } = hsl(hex);
  return s >= 0.25 && l >= 0.18 && l <= 0.78;
}

function hueDistance(a, b) {
  const d = Math.abs(hsl(a).h - hsl(b).h);
  return Math.min(d, 360 - d);
}

const COLOR_TOKEN = /#[0-9a-f]{6}\b|#[0-9a-f]{3}\b|rgba?\([^)]{5,40}\)/gi;
const BRAND_VAR = /--[a-z0-9-]*(primary|brand|accent|main|theme|secondary|highlight)[a-z0-9-]*\s*:\s*([^;}{]+)/gi;

// Scores every colour in the CSS. Custom properties named like a brand colour
// count heavily; plain uses count once each. Greys, whites and blacks never win.
export function rankColors(css, themeColor) {
  const scores = new Map();
  const add = (hex, weight) => {
    if (!isBrandColor(hex)) return;
    scores.set(hex, (scores.get(hex) || 0) + weight);
  };

  let m;
  BRAND_VAR.lastIndex = 0;
  while ((m = BRAND_VAR.exec(css))) {
    const value = m[2].trim();
    const hex = normalizeHex((value.match(COLOR_TOKEN) || [value])[0]);
    add(hex, /secondary/i.test(m[1]) ? 15 : 30);
  }
  for (const token of css.match(COLOR_TOKEN) || []) add(normalizeHex(token), 1);

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([hex]) => hex);
  const theme = normalizeHex(themeColor);
  const primary = isBrandColor(theme) ? theme : ranked[0] || '';
  if (!primary) return { primary: '', secondary: '' };
  const secondary = ranked.find((hex) => hex !== primary && hueDistance(hex, primary) >= 25) || '';
  return { primary, secondary };
}

// ── Structured data ──

function jsonLdNodes(html) {
  const nodes = [];
  const re = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    let data;
    try {
      data = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    const stack = [data];
    while (stack.length && nodes.length < 200) {
      const node = stack.pop();
      if (Array.isArray(node)) stack.push(...node);
      else if (node && typeof node === 'object') {
        nodes.push(node);
        if (node['@graph']) stack.push(node['@graph']);
        if (node.publisher) stack.push(node.publisher);
        if (node.author && typeof node.author === 'object') stack.push(node.author);
      }
    }
  }
  return nodes;
}

function firstString(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return firstString(value[0]);
  if (value && typeof value === 'object') return firstString(value.url || value.contentUrl || value['@id']);
  return '';
}

function organization(html) {
  const nodes = jsonLdNodes(html);
  const isOrg = (n) => ORG_TYPE.test([].concat(n['@type'] || []).join(' '));
  return nodes.find((n) => isOrg(n) && n.logo) || nodes.find(isOrg) || null;
}

// ── Main ──

export function extractBrand(html, pageUrl) {
  const source = String(html || '').slice(0, 600_000);
  const head = source.slice(0, 300_000);
  const org = organization(source);

  const metas = {};
  for (const tag of tags(head, 'meta')) {
    const a = parseAttributes(tag);
    const key = (a.property || a.name || a.itemprop || '').toLowerCase();
    if (key && a.content && !(key in metas)) metas[key] = a.content;
  }

  const links = tags(head, 'link').map(parseAttributes);
  const title = cleanText((head.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || [])[1]);

  // Company name: structured data, then the site name, then the first part of
  // the title ("Acme Plumbing | Sydney" -> "Acme Plumbing").
  const company = cleanText(
    (org && typeof org.name === 'string' && org.name) ||
    metas['og:site_name'] ||
    metas['application-name'] ||
    title.split(/\s+[|\-–—:·•]\s+/)[0]
  , 80);

  // Logo candidates, best first. og:image is left out: it is usually a photo or
  // a share banner, not a logo.
  const logos = [];
  const pushLogo = (href, kind) => {
    const url = absoluteUrl(href, pageUrl);
    if (url && !logos.some((l) => l.url === url)) logos.push({ url, kind });
  };
  if (org && org.logo) pushLogo(firstString(org.logo), 'structured-data');
  if (metas['og:logo']) pushLogo(metas['og:logo'], 'og-logo');

  const imgRe = /<img\b[^>]*>/gi;
  let im;
  let imgCount = 0;
  while ((im = imgRe.exec(source)) && imgCount < 400) {
    imgCount++;
    const a = parseAttributes(im[0]);
    const before = source.slice(Math.max(0, im.index - 300), im.index);
    const hint = /logo|brand/i.test([a.class, a.id, a.alt, a.src, a['data-src']].join(' ')) ||
      /class\s*=\s*["'][^"']*(logo|brand)[^"']*["'][^<]*(<a\b[^>]*>|<span\b[^>]*>|<div\b[^>]*>|<picture\b[^>]*>|<source\b[^>]*>|\s)*$/i.test(before);
    if (!hint) continue;
    const src = a.src && !/^data:/i.test(a.src) ? a.src : a['data-src'] || (a.srcset || '').split(/\s+/)[0];
    if (src && !/sprite|placeholder|loading|spinner|pixel|tracking/i.test(src)) pushLogo(src, 'page-logo');
    if (logos.length >= 6) break;
  }

  const icons = links.filter((l) => /\bicon\b/i.test(l.rel || '') && l.href);
  for (const l of icons) {
    if (/svg/i.test(l.type || '') || /\.svg(\?|$)/i.test(l.href)) pushLogo(l.href, 'icon-svg');
  }
  for (const l of links) {
    if (/apple-touch-icon/i.test(l.rel || '') && l.href) pushLogo(l.href, 'touch-icon');
  }
  for (const l of icons) {
    const size = parseInt((l.sizes || '').split('x')[0], 10);
    if (size >= 96 && !/\.ico(\?|$)/i.test(l.href)) pushLogo(l.href, 'icon');
  }

  // Social profiles: structured data sameAs first, then links on the page.
  const social = { linkedin: '', instagram: '', facebook: '', google: '' };
  const offerSocial = (href) => {
    const url = absoluteUrl(href, pageUrl);
    if (!url || url.length > 300) return;
    for (const [key, pattern] of Object.entries(SOCIAL_PATTERNS)) {
      if (!social[key] && pattern.test(url)) social[key] = url.replace(/\?.*$/, '');
    }
  };
  if (org && org.sameAs) [].concat(org.sameAs).forEach((s) => typeof s === 'string' && offerSocial(s));
  const hrefs = [];
  for (const tag of tags(source, 'a').slice(0, 2000)) {
    const href = parseAttributes(tag).href;
    if (href) hrefs.push(href);
  }
  hrefs.forEach(offerSocial);

  // Phone: structured data, then the first tel: link.
  let phone = org && typeof org.telephone === 'string' ? org.telephone : '';
  if (!phone) {
    const tel = hrefs.find((h) => /^tel:/i.test(h.trim()));
    if (tel) phone = decodeURIComponent(tel.trim().slice(4).replace(/%(?![0-9a-f]{2})/gi, ''));
  }
  phone = cleanText(phone, 40).replace(/[^\d+()\-.\s]/g, '').trim();
  if (phone.replace(/\D/g, '').length < 6) phone = '';

  // Colours: theme-color, then inline CSS. The caller may append one external
  // stylesheet via `css`.
  const inlineCss = (source.match(/<style\b[^>]*>[\s\S]*?<\/style>/gi) || []).join('\n').slice(0, 250_000) +
    '\n' + (source.match(/\sstyle\s*=\s*"[^"]*"/gi) || []).slice(0, 300).join('\n');
  const manifest = links.find((l) => /\bmanifest\b/i.test(l.rel || '') && l.href);
  const stylesheets = links
    .filter((l) => /\bstylesheet\b/i.test(l.rel || '') && l.href)
    .map((l) => absoluteUrl(l.href, pageUrl))
    .filter(Boolean);

  return {
    company,
    phone,
    social,
    logos: logos.slice(0, 6),
    themeColor: normalizeHex(metas['theme-color'] || metas['msapplication-tilecolor']),
    inlineCss,
    manifestUrl: manifest ? absoluteUrl(manifest.href, pageUrl) : '',
    stylesheets: stylesheets.slice(0, 8),
  };
}

// Picks the stylesheet most likely to hold the site's own colours: same site
// first, skipping font and icon-library CDNs.
export function pickStylesheet(stylesheets, pageUrl) {
  const host = new URL(pageUrl).hostname.replace(/^www\./, '');
  const usable = stylesheets.filter((s) => !/fonts\.googleapis|font-awesome|fontawesome|bootstrap(\.min)?\.css|cdnjs|jsdelivr|unpkg|typekit/i.test(s));
  return usable.find((s) => new URL(s).hostname.replace(/^www\./, '').endsWith(host)) || usable[0] || '';
}
