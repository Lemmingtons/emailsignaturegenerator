#!/usr/bin/env node
/**
 * Programmatic SEO Page Generator
 * emailsignaturegenerator.ai
 *
 * Generates the platform guides, comparison pages, profession guides and the
 * template gallery from the datasets in datasets/.
 * Run: node generate-pages.js
 * Outputs pages to: seo/ and email-signature-templates/
 *
 * Page type:
 *   - /seo/email-signature-generator-for-[platform].html  (platform guides)
 *   - /seo/[competitor]-alternative.html and /seo/best-email-signature-generators.html
 *   - /seo/[profession]-email-signature.html  (profession guides)
 *   - /email-signature-templates.html and /email-signature-templates/[id].html
 *   - /brand-extractor.html  (the page; the tool itself is js/brand-tool.js)
 */

const fs = require('fs');
const path = require('path');
const SITE_FACTS = require('./js/site-facts');

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// "2026-10-09" -> "9 October 2026", matching the blog's byline format.
function formatLongDate(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${day} ${months[month - 1]} ${year}`;
}

const SEO_DIR = path.join(__dirname, 'seo');
const SITE_URL = SITE_FACTS.origin;
const PRICE = SITE_FACTS.proPrice.displayWithCurrency;
const PRICE_SHORT = SITE_FACTS.proPrice.display;
const TEMPLATE_COUNT = SITE_FACTS.templateCount;
const FONT_COUNT = require('./js/generator-core').fontFamilies.length;

function readDataset(name) {
  const filePath = path.join(__dirname, 'datasets', name);
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!Array.isArray(data)) {
    throw new Error(`${name} must contain an array`);
  }
  data.forEach((entry, index) => {
    for (const field of ['slug', 'label', 'description', 'shortAnswer', 'datePublished', 'dateModified', 'keywords']) {
      if (!entry[field]) throw new Error(`${name}[${index}] missing ${field}`);
    }
  });
  return data;
}

function ensureOutputDir() {
  if (!fs.existsSync(SEO_DIR)) {
    fs.mkdirSync(SEO_DIR, { recursive: true });
  }
}

// ─── Templates ─────────────────────────────────────────────────────────────

function platformPageHTML({
  slug,
  label,
  description,
  shortAnswer,
  datePublished,
  dateModified,
  installInstructions,
  guideSections,
  troubleshooting,
  additionalFaqs,
  keywords,
  seoTitle,
  metaDescription,
  heading,
  relatedLinks,
}) {
  const url = `${SITE_URL}/seo/email-signature-generator-for-${slug}`;
  const title = seoTitle || `Email Signature Generator for ${label} — Free Builder`;
  const metaDesc = metaDescription || `Build a professional ${label} email signature in under 2 minutes. Free to build with all ${TEMPLATE_COUNT} templates, $9 once to use it. Works perfectly in ${label}.`;
  const h1 = heading || `Email Signature Generator for ${label}`;

  return pageHTML({
    url, title, metaDesc, h1, slug,
    intro: description,
    shortAnswer,
    datePublished,
    dateModified,
    keywords,
    ctaText: `Create Your ${label} Signature`,
    seoLabel: label,
    guideSections,
    troubleshooting,
    installInstructions,
    relatedLinks,
    faqs: [
      {
        q: `How do I add a professional email signature to ${label}?`,
        a: `To add an email signature to ${label}: (1) Use our free generator above to create your signature. (2) Click "Copy HTML" (the same table-based HTML works across the major email clients). (3) Open ${label} settings and find the Signature section. (4) Paste your signature and save. It usually takes under 2 minutes.`
      },
      {
        q: `Do your email signatures work in ${label}?`,
        a: `Yes. All our email signatures use HTML table-based layouts that are compatible with ${label} and the other major email clients, including Gmail, Outlook, Apple Mail, and Yahoo Mail. We test every template across major email clients to ensure consistent rendering.`
      },
      {
        q: `Is there a free email signature generator for ${label}?`,
        a: `You can build and preview an email signature for ${label} free, with no account — all ${TEMPLATE_COUNT} templates and full customisation. Copying it into your email client costs ${PRICE} as a one-time payment. There is no subscription and no branding on your signature.`
      }
    ].concat(additionalFaqs || [])
  });
}

function fillFacts(value) {
  if (typeof value === 'string') {
    return value.replace(/\{\{price\}\}/g, PRICE).replace(/\{\{templates\}\}/g, String(TEMPLATE_COUNT));
  }
  if (Array.isArray(value)) return value.map(fillFacts);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, fillFacts(inner)]));
  }
  return value;
}

function comparisonPageHTML(entry) {
  const competitor = fillFacts(entry);
  for (const field of ['seoTitle', 'metaDescription', 'heading', 'checkedOn', 'sources', 'rows', 'whenTheyFit', 'whenWeFit', 'faqs']) {
    if (!competitor[field] || (Array.isArray(competitor[field]) && !competitor[field].length)) {
      throw new Error(`competitors.json ${competitor.slug} missing ${field}`);
    }
  }

  return pageHTML({
    url: `${SITE_URL}/seo/${competitor.slug}`,
    title: competitor.seoTitle,
    metaDesc: competitor.metaDescription,
    h1: competitor.heading,
    slug: competitor.slug,
    intro: competitor.description,
    shortAnswer: competitor.shortAnswer,
    datePublished: competitor.datePublished,
    dateModified: competitor.dateModified,
    keywords: competitor.keywords,
    ctaText: 'Build Your Signature From Your Website',
    brandForm: true,
    seoLabel: competitor.label,
    comparison: {
      label: competitor.label,
      rows: competitor.rows,
      checkedOn: competitor.checkedOn,
      sources: competitor.sources,
    },
    guideSections: [
      { heading: `When ${competitor.label} is the better choice`, items: competitor.whenTheyFit },
      { heading: 'When this generator is the better choice', items: competitor.whenWeFit },
    ],
    relatedLinks: [
      { href: '/generator', label: 'Email signature generator', description: 'type your website and see your signature' },
      { href: '/#pricing', label: 'Pricing', description: `${PRICE} once, no subscription` },
      { href: '/health-check', label: 'Signature health check', description: 'test any signature for Gmail, Outlook and dark mode' },
    ],
    faqs: competitor.faqs,
  });
}

function pageHTML({ url, title, metaDesc, h1, slug, intro, shortAnswer, datePublished, dateModified, keywords, ctaText, seoLabel, faqs, installInstructions, guideSections, troubleshooting, relatedLinks, comparison, brandForm }) {
  const faqSchema = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": faqs.map(f => ({
      "@type": "Question",
      "name": f.q,
      "acceptedAnswer": { "@type": "Answer", "text": f.a }
    }))
  }, null, 2);

  const articleSchema = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": h1,
    "description": metaDesc,
    "datePublished": datePublished,
    "dateModified": dateModified,
    "image": `${SITE_URL}/assets/og-image.png`,
    "author": { "@type": "Organization", "name": "Email Signature Generator", "url": `${SITE_URL}/` },
    "publisher": { "@type": "Organization", "name": "Email Signature Generator", "url": `${SITE_URL}/` },
    "mainEntityOfPage": { "@type": "WebPage", "@id": url },
    "inLanguage": "en"
  }, null, 2);

  const breadcrumbSchema = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://emailsignaturegenerator.ai/" },
      { "@type": "ListItem", "position": 2, "name": h1, "item": url }
    ]
  }, null, 2);

  const installHTML = installInstructions ? `
    <section class="install-section">
      <h2>How to add your signature to ${escapeHtml(seoLabel)}</h2>
      <ol class="install-steps">
        ${installInstructions.map(step => `<li>${step}</li>`).join('\n        ')}
      </ol>
    </section>` : '';

  const guideHTML = guideSections ? guideSections.map(section => `
    <section class="guide-section">
      <h2>${escapeHtml(section.heading)}</h2>
      ${(section.paragraphs || []).map(paragraph => `<p>${escapeHtml(paragraph)}</p>`).join('\n      ')}
      ${section.items ? `<ul class="guide-list">
        ${section.items.map(item => `<li>${escapeHtml(item)}</li>`).join('\n        ')}
      </ul>` : ''}
    </section>`).join('\n') : '';

  const troubleshootingHTML = troubleshooting ? `
    <section class="troubleshooting-section">
      <h2>${escapeHtml(seoLabel)} signature troubleshooting</h2>
      <div class="troubleshooting-grid">
        ${troubleshooting.map(item => `
        <div class="troubleshooting-item">
          <h3>${escapeHtml(item.issue)}</h3>
          <p>${escapeHtml(item.fix)}</p>
        </div>`).join('\n        ')}
      </div>
    </section>` : '';

  const relatedHTML = relatedLinks ? `
    <section class="guide-section" aria-label="Related guides">
      <h2>Related signature guides</h2>
      <ul class="guide-list">
        ${relatedLinks.map(link => `<li><a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a>${link.description ? ` — ${escapeHtml(link.description)}` : ''}</li>`).join('\n        ')}
      </ul>
    </section>` : '';

  const comparisonHTML = comparison ? `
    <section class="comparison-section" aria-label="Comparison">
      <h2>Email Signature Generator vs ${escapeHtml(comparison.label)}</h2>
      <div class="comparison-scroll">
        <table class="comparison-table">
          <thead>
            <tr><th scope="col"></th><th scope="col">Email Signature Generator</th><th scope="col">${escapeHtml(comparison.label)}</th></tr>
          </thead>
          <tbody>
            ${comparison.rows.map(row => `<tr><th scope="row">${escapeHtml(row.feature)}</th><td>${escapeHtml(row.us)}</td><td>${escapeHtml(row.them)}</td></tr>`).join('\n            ')}
          </tbody>
        </table>
      </div>
      <p class="comparison-note">${escapeHtml(comparison.label)} details checked on <time datetime="${escapeHtml(comparison.checkedOn)}">${escapeHtml(formatLongDate(comparison.checkedOn))}</time> from ${comparison.sources.map(source => `<a href="${escapeHtml(source.url)}" rel="nofollow noopener" target="_blank">${escapeHtml(source.label)}</a>`).join(' and ')}. Prices and features change, so check their site before you decide.</p>
    </section>` : '';

  const ctaActionHTML = brandForm ? `<form class="seo-brand-form" action="/generator" method="get">
        <label for="seoSite">Your company website</label>
        <div class="seo-brand-row">
          <input type="text" id="seoSite" name="site" inputmode="url" autocomplete="url" spellcheck="false" placeholder="yourcompany.com" maxlength="300">
          <button type="submit" class="btn btn-primary">Build my signature</button>
        </div>
        <p class="seo-brand-alt">No website? <a href="/generator">Start from a template</a></p>
      </form>` : `<a href="/generator" class="btn btn-primary" aria-label="${escapeHtml(ctaText)}">${escapeHtml(ctaText)}</a>`;

  const faqHTML = faqs.map(f => `
        <details class="instructions">
          <summary>${escapeHtml(f.q)}</summary>
          <p>${escapeHtml(f.a)}</p>
        </details>`).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(metaDesc)}">
  <meta name="robots" content="index, follow">
  <link rel="icon" type="image/svg+xml" href="../favicon.svg">
  <link rel="canonical" href="${url}">

  <!-- Open Graph -->
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(metaDesc)}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="https://emailsignaturegenerator.ai/assets/og-image.png">
  <meta property="og:site_name" content="Email Signature Generator">

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(metaDesc)}">
  <meta name="twitter:image" content="https://emailsignaturegenerator.ai/assets/og-image.png">

${dateModified ? `  <!-- Article Schema -->
  <script type="application/ld+json">
  ${articleSchema}
  </script>

` : ''}  <!-- Breadcrumb Schema -->
  <script type="application/ld+json">
  ${breadcrumbSchema}
  </script>

  <!-- FAQ Schema -->
  <script type="application/ld+json">
  ${faqSchema}
  </script>

  <link rel="stylesheet" href="../css/styles.css">
  <style>
    .seo-page { max-width: 780px; margin: 0 auto; padding: 40px 24px 80px; }
    .seo-page h1 { font-size: clamp(1.75rem, 4vw, 2.5rem); margin-bottom: 16px; }
    .seo-page .post-meta { font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 20px; }
    .seo-page .short-answer { font-size: 1.05rem; line-height: 1.7; margin-bottom: 16px; padding: 16px 20px; border-left: 3px solid var(--accent); background: var(--surface); border-radius: 8px; }
    .seo-page .intro { font-size: 1.1rem; color: var(--text-secondary); line-height: 1.7; margin-bottom: 40px; }
    .seo-cta-box { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 32px; text-align: center; margin: 40px 0; }
    .seo-cta-box h2 { font-size: 1.4rem; margin-bottom: 8px; }
    .seo-cta-box p { color: var(--text-secondary); margin-bottom: 24px; }
    .install-section { margin: 40px 0; }
    .install-section h2 { font-size: 1.3rem; margin-bottom: 16px; }
    .install-steps { padding-left: 24px; line-height: 2; }
    .faq-section h2 { font-size: 1.3rem; margin-bottom: 16px; }
    .breadcrumb { font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 24px; }
    .breadcrumb a { color: var(--text-secondary); text-decoration: none; }
    .breadcrumb a:hover { text-decoration: underline; }
    .features-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin: 32px 0; }
    .feature-item { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 16px; }
    .feature-item h3 { font-size: 0.95rem; margin-bottom: 4px; }
    .feature-item p { font-size: 0.85rem; color: var(--text-secondary); margin: 0; }
    .guide-section { margin: 40px 0; }
    .guide-section h2, .troubleshooting-section h2 { font-size: 1.3rem; margin-bottom: 14px; }
    .guide-section p { color: var(--text-secondary); line-height: 1.8; margin-bottom: 14px; }
    .guide-list { padding-left: 24px; color: var(--text-secondary); line-height: 1.8; }
    .troubleshooting-section { margin: 40px 0; }
    .troubleshooting-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-top: 16px; }
    .troubleshooting-item { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 16px; }
    .troubleshooting-item h3 { font-size: 0.95rem; margin-bottom: 6px; }
    .troubleshooting-item p { font-size: 0.88rem; color: var(--text-secondary); margin: 0; }
    .comparison-section { margin: 40px 0; }
    .comparison-section h2 { font-size: 1.3rem; margin-bottom: 14px; }
    .comparison-scroll { overflow-x: auto; border: 1px solid var(--border); border-radius: 12px; }
    .comparison-table { width: 100%; border-collapse: collapse; font-size: 0.92rem; min-width: 520px; }
    .comparison-table th, .comparison-table td { padding: 12px 14px; text-align: left; vertical-align: top; border-bottom: 1px solid var(--border); line-height: 1.55; }
    .comparison-table thead th { background: var(--surface); font-size: 0.9rem; }
    .comparison-table tbody th { font-weight: 600; width: 24%; }
    .comparison-table td:nth-child(2) { background: var(--surface); }
    .comparison-table tr:last-child th, .comparison-table tr:last-child td { border-bottom: 0; }
    .comparison-note { font-size: 0.85rem; color: var(--text-secondary); margin-top: 12px; line-height: 1.6; }
    .seo-brand-form { max-width: 520px; margin: 0 auto; text-align: left; }
    .seo-brand-form label { display: block; font-weight: 600; font-size: 0.9rem; margin-bottom: 8px; }
    .seo-brand-row { display: flex; gap: 8px; }
    .seo-brand-row input { flex: 1; min-width: 0; padding: 12px 14px; font-size: 1rem; border: 1px solid var(--border); border-radius: 8px; background: #fff; color: var(--text); font-family: inherit; }
    .seo-brand-row .btn { white-space: nowrap; }
    .seo-brand-alt { font-size: 0.85rem; margin: 10px 0 0 !important; text-align: center; }
    @media (max-width: 600px) { .comparison-table { min-width: 0; font-size: 0.82rem; } .comparison-table th, .comparison-table td { padding: 10px 8px; } .comparison-table tbody th { width: 22%; } }
    @media (max-width: 480px) { .seo-brand-row { flex-direction: column; } }
  </style>
</head>
<body>

  <a href="#main-content" class="skip-link">Skip to content</a>

${siteHeaderHTML()}

  <main id="main-content" class="seo-page">

    <nav class="breadcrumb" aria-label="Breadcrumb">
      <a href="/">Home</a> › ${escapeHtml(h1)}
    </nav>

    <h1>${escapeHtml(h1)}</h1>
${dateModified ? `    <p class="post-meta">By Email Signature Generator · Updated <time datetime="${escapeHtml(dateModified)}">${escapeHtml(formatLongDate(dateModified))}</time></p>
` : ''}${shortAnswer ? `    <p class="short-answer"><strong>The short answer:</strong> ${escapeHtml(shortAnswer)}</p>
` : ''}    <p class="intro">${escapeHtml(intro)}</p>
${comparisonHTML}
    <div class="seo-cta-box">
      <h2>${escapeHtml(ctaText)} — Free</h2>
      <p>${TEMPLATE_COUNT} templates. Full customisation. Works with Gmail and Outlook.<br>Free to build and preview. ${PRICE_SHORT} once when you are ready to use it.</p>
      ${ctaActionHTML}
    </div>

    <section aria-label="Features">
      <h2>Everything you need in an email signature</h2>
      <div class="features-grid">
        <div class="feature-item">
          <h3>Brand From Your Website</h3>
          <p>Type your website and your logo, brand colours and social links are filled in.</p>
        </div>
        <div class="feature-item">
          <h3>${TEMPLATE_COUNT} Templates</h3>
          <p>Professional, Creative, Minimal, Social-First, Sales, and Industry designs.</p>
        </div>
        <div class="feature-item">
          <h3>Full Customisation</h3>
          <p>Custom colours, ${FONT_COUNT} email-safe fonts, photo shapes, and icon styles.</p>
        </div>
        <div class="feature-item">
          <h3>Works Everywhere</h3>
          <p>Table-based HTML for Gmail, Outlook, Apple Mail, Yahoo Mail, and other major email clients.</p>
        </div>
        <div class="feature-item">
          <h3>${PRICE_SHORT} One-Time</h3>
          <p>No subscription. Pay once, use forever.</p>
        </div>
        <div class="feature-item">
          <h3>No Account Needed</h3>
          <p>No login and no tracking. Details stay in your browser unless you host a photo or logo, or save an edit link.</p>
        </div>
        <div class="feature-item">
          <h3>One-Click Copy</h3>
          <p>Copy as rich HTML for Gmail or plain text. Paste and done.</p>
        </div>
      </div>
    </section>

    ${installHTML}

    ${guideHTML}

    ${troubleshootingHTML}

    ${relatedHTML}

    <section class="faq-section" aria-label="Frequently asked questions">
      <h2>Frequently Asked Questions</h2>
      ${faqHTML}
    </section>

    <div class="seo-cta-box" style="margin-top: 48px;">
      <h2>Ready to create your professional email signature?</h2>
      <p>Skip the monthly subscription. Build free, then pay ${PRICE_SHORT} once when you are ready to use your signature.</p>
      <a href="/generator" class="btn btn-primary">Create Free Signature</a>
    </div>

  </main>

${siteFooterHTML()}

</body>
</html>`;

  return html.replace(/[ \t]+$/gm, '');
}

// ─── Shared shell ──────────────────────────────────────────────────────────
// Hand-written pages carry the same header and footer markup; update them
// together (npm run check compares the nav on every page).

// socialImageUrl carries a cache-busting version once site-facts defines it.
const SOCIAL_IMAGE = SITE_FACTS.socialImageUrl || `${SITE_URL}/assets/og-image.png`;

const NAV_LINKS = [
  { href: '/email-signature-templates', label: 'Templates' },
  { href: '/email-signature-examples', label: 'Examples' },
  { href: '/health-check', label: 'Health Check' },
  { href: '/blog/', label: 'Guides' },
  { href: '/#pricing', label: 'Pricing' },
];

const FOOTER_LINKS = [
  { href: '/generator', label: 'Generator' },
  { href: '/email-signature-templates', label: 'Templates' },
  { href: '/email-signature-examples', label: 'Examples' },
  { href: '/health-check', label: 'Health Check' },
  { href: '/brand-extractor', label: 'Brand Extractor' },
  { href: '/seo/best-email-signature-generators', label: 'Compare Generators' },
  { href: '/blog/', label: 'Guides' },
  { href: '/#pricing', label: 'Pricing' },
  { href: '/privacy', label: 'Privacy &amp; Terms' },
  { href: `mailto:${SITE_FACTS.contactEmail}`, label: 'Contact' },
];

function siteHeaderHTML() {
  return `  <!-- Header -->
  <header class="site-header" role="banner">
    <a href="/" class="site-logo" aria-label="Email Signature Generator home">
      <span class="logo-icon" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
      </span>
      Email Signature Generator
    </a>
    <nav class="site-nav" aria-label="Main navigation">
${NAV_LINKS.map(link => `      <a href="${link.href}">${link.label}</a>`).join('\n')}
      <a href="/generator" class="nav-cta">Create Signature</a>
    </nav>
  </header>`;
}

function siteFooterHTML() {
  return `  <!-- Footer -->
  <footer class="site-footer" role="contentinfo">
    <p>&copy; 2026 emailsignaturegenerator.ai — No subscriptions. No lock-in. Just great signatures.</p>
    <p style="margin-top: 8px;">
${FOOTER_LINKS.map(link => `      <a href="${link.href}">${link.label}</a>`).join('\n      &nbsp;&middot;&nbsp;\n')}
    </p>
  </footer>`;
}

// A light page frame for the template, profession and comparison pages.
function shellHTML({ url, title, metaDesc, schemas, css, body, bodyClass, scripts }) {
  const schemaHTML = (schemas || []).map(schema => `  <script type="application/ld+json">
  ${JSON.stringify(schema, null, 2)}
  </script>`).join('\n\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(metaDesc)}">
  <meta name="robots" content="index, follow">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="canonical" href="${url}">

  <!-- Open Graph -->
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(metaDesc)}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="${escapeHtml(SOCIAL_IMAGE)}">
  <meta property="og:site_name" content="Email Signature Generator">

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(metaDesc)}">
  <meta name="twitter:image" content="${escapeHtml(SOCIAL_IMAGE)}">

${schemaHTML}

  <link rel="stylesheet" href="/css/styles.css">
  <style>
${SHELL_CSS}${css || ''}
  </style>
</head>
<body>

  <a href="#main-content" class="skip-link">Skip to content</a>

${siteHeaderHTML()}

  <main id="main-content" class="${bodyClass || 'content-page'}">
${body}
  </main>

${siteFooterHTML()}
${(scripts || []).map(src => `\n  <script src="${src}"></script>`).join('')}
</body>
</html>`;

  return html.replace(/[ \t]+$/gm, '');
}

const SHELL_CSS = `    .content-page { max-width: 980px; margin: 0 auto; padding: 40px 24px 80px; }
    .content-page h1 { font-size: clamp(1.75rem, 4vw, 2.5rem); margin-bottom: 16px; }
    .content-page h2 { font-size: 1.35rem; margin: 48px 0 14px; }
    .content-page h3 { font-size: 1.05rem; margin-bottom: 6px; }
    .content-page p, .content-page li { line-height: 1.75; }
    .content-page .lede { font-size: 1.08rem; color: var(--text-secondary); max-width: 720px; }
    .content-page .post-meta { font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 20px; }
    .content-page .short-answer { font-size: 1.02rem; margin: 0 0 20px; padding: 16px 20px; border-left: 3px solid var(--accent); background: var(--surface); border-radius: 8px; max-width: 760px; }
    .content-page .breadcrumb { font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 24px; }
    .content-page .breadcrumb a { color: var(--text-secondary); text-decoration: none; }
    .content-page .breadcrumb a:hover { text-decoration: underline; }
    .content-page .guide-list { padding-left: 22px; color: var(--text-secondary); }
    .content-page .guide-list li { margin-bottom: 6px; }
    .content-page .faq-section details { margin-bottom: 10px; }
    .sig-specimen { background: #ffffff; border: 1px solid var(--border); border-radius: 12px; padding: 22px 24px; overflow-x: auto; }
    .sig-specimen a { cursor: default; }
    .specimen-caption { font-size: 0.85rem; color: var(--text-secondary); margin: 8px 0 0; }
    .page-cta { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 28px; margin: 40px 0; text-align: center; }
    .page-cta h2 { margin: 0 0 8px; }
    .page-cta p { color: var(--text-secondary); margin: 0 0 18px; }
    .page-cta .btn + .btn { margin-left: 8px; }
    .fact-table { width: 100%; border-collapse: collapse; font-size: 0.92rem; }
    .fact-table th, .fact-table td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--border); vertical-align: top; line-height: 1.55; }
    .fact-table th { width: 38%; font-weight: 600; }
    .table-scroll { overflow-x: auto; border: 1px solid var(--border); border-radius: 12px; }
    @media (max-width: 600px) {
      .content-page { padding: 28px 16px 64px; }
      .sig-specimen { padding: 16px; }
      .sig-specimen > * { zoom: 0.8; }
      .page-cta .btn { display: block; width: 100%; }
      .page-cta .btn + .btn { margin: 10px 0 0; }
    }
`;

// ─── Signature specimens ───────────────────────────────────────────────────
// Specimens are rendered at build time with the real templates, so crawlers and
// readers see exactly what the generator produces. Links are stripped: the
// sample companies are fictional and should not send anyone to a real domain.

global.SiteFacts = SITE_FACTS;
const core = require('./js/generator-core');
const { TEMPLATES, CATEGORIES } = require('./js/templates');
const COMPLIANCE = JSON.parse(fs.readFileSync(path.join(__dirname, 'datasets', 'compliance.json'), 'utf8'));

const SAMPLE_PERSON = Object.freeze({
  fullName: 'Sarah Mitchell',
  title: 'Senior Account Manager',
  company: 'Harbour & Co',
  phone: '+1 555 012 3456',
  email: 'sarah@harbourco.com',
  website: 'https://harbourco.com',
  photoUrl: '/assets/sample-headshot.jpg',
  linkedin: 'https://linkedin.com/in/sarahmitchell',
  instagram: 'https://instagram.com/harbourco',
  facebook: 'https://facebook.com/harbourco',
});

// Shown in the Branded template, which is built around a company logo.
const SAMPLE_LOGO = '/assets/sample-logo.svg';

const SECOND_PERSON = Object.freeze({
  fullName: 'Daniel Brooks',
  title: 'Operations Director',
  company: 'Northwind Studio',
  phone: '+1 555 017 8820',
  email: 'daniel@northwindstudio.com',
  website: 'https://northwindstudio.com',
  linkedin: 'https://linkedin.com/in/danielbrooks',
});

function stripLinks(html) {
  return html.replace(/<a\b([^>]*)>/gi, (match, attrs) => `<a${attrs.replace(/\s(?:href|target|rel)="[^"]*"/gi, '')}>`);
}

function renderSpecimen(templateId, data, style, compliance) {
  const template = TEMPLATES[templateId];
  if (!template) throw new Error(`Unknown template ${templateId}`);
  return stripLinks(core.buildSignatureHtml({ template, data, style, compliance: compliance || null }));
}

// The character count a client would store, measured on the exportable HTML
// with the real links in place.
function exportLength(templateId, data, style) {
  return core.buildSignatureHtml({ template: TEMPLATES[templateId], data, style, compliance: null }).length;
}

function complianceFor(role, values) {
  const country = COMPLIANCE.roles[role] && COMPLIANCE.roles[role].countries.US;
  if (!country) throw new Error(`compliance.json has no US entry for ${role}`);
  const fields = country.fields
    .filter(field => values && values[field.label])
    .map(field => ({ label: field.label, value: values[field.label] }));
  return { fields, disclaimer: country.disclaimer };
}

function categoryName(id) {
  const category = CATEGORIES.find(entry => entry.id === id);
  return category ? category.name : id;
}

function breadcrumbSchema(items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({ '@type': 'ListItem', position: index + 1, name: item.name, item: item.url })),
  };
}

function faqSchema(faqs) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
  };
}

function faqSectionHTML(faqs) {
  return `    <section class="faq-section" aria-label="Frequently asked questions">
      <h2>Frequently asked questions</h2>
${faqs.map(f => `      <details class="instructions">
        <summary>${escapeHtml(f.q)}</summary>
        <p>${escapeHtml(f.a)}</p>
      </details>`).join('\n')}
    </section>`;
}

// ─── Template gallery ──────────────────────────────────────────────────────

const TEMPLATE_HUB_PATH = '/email-signature-templates';
const TEMPLATE_DIR = path.join(__dirname, 'email-signature-templates');
const GALLERY_DATE = '2026-10-25';
const GMAIL_SIGNATURE_LIMIT = 10000;

function readTemplateCopy() {
  const entries = JSON.parse(fs.readFileSync(path.join(__dirname, 'datasets', 'templates.json'), 'utf8'));
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  for (const id of Object.keys(TEMPLATES)) {
    const entry = byId.get(id);
    if (!entry) throw new Error(`datasets/templates.json is missing template ${id}`);
    for (const field of ['summary', 'bestFor', 'notes']) {
      if (!entry[field] || (Array.isArray(entry[field]) && !entry[field].length)) throw new Error(`datasets/templates.json ${id} missing ${field}`);
    }
  }
  for (const id of byId.keys()) {
    if (!TEMPLATES[id]) throw new Error(`datasets/templates.json lists unknown template ${id}`);
  }
  return Object.keys(TEMPLATES).map(id => ({ id, name: TEMPLATES[id].name, category: TEMPLATES[id].category, ...byId.get(id) }));
}

function templateFeatures(id) {
  const style = { primaryColor: '#0E5A8A', ctaText: 'Book a meeting', ctaUrl: 'https://example.com/book' };
  const html = core.buildSignatureHtml({ template: TEMPLATES[id], data: SAMPLE_PERSON, style, compliance: null });
  return {
    photo: html.includes(SAMPLE_PERSON.photoUrl),
    cta: html.includes('Book a meeting'),
    icons: /<img[^>]+\/i\/[a-z]+-/.test(html),
    images: (html.match(/<img\b/g) || []).length,
    length: exportLength(id, SAMPLE_PERSON, style),
  };
}

const TEMPLATE_CSS = `    .gallery-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(420px, 1fr)); gap: 20px; margin-top: 18px; }
    .gallery-card { border: 1px solid var(--border); border-radius: 14px; overflow: hidden; background: var(--surface); display: flex; flex-direction: column; }
    .content-page.gallery-page { max-width: 1120px; }
    .gallery-card .sig-specimen { border: 0; border-bottom: 1px solid var(--border); border-radius: 0; min-height: 150px; padding: 18px 20px; }
    .gallery-card .sig-specimen > * { zoom: 0.86; }
    .gallery-card-body { padding: 16px 18px 18px; display: flex; flex-direction: column; gap: 8px; flex: 1; }
    .gallery-card-body h3 { margin: 0; font-size: 1.05rem; }
    .gallery-card-body h3 a { color: inherit; text-decoration: none; }
    .gallery-card-body h3 a:hover { text-decoration: underline; }
    .gallery-card-body p { margin: 0; color: var(--text-secondary); font-size: 0.92rem; line-height: 1.6; }
    .gallery-card-links { margin-top: auto; padding-top: 6px; display: flex; gap: 16px; font-size: 0.9rem; font-weight: 600; }
    .category-jump { display: flex; flex-wrap: wrap; gap: 8px; margin: 18px 0 8px; padding: 0; list-style: none; }
    .category-jump a { display: inline-block; padding: 6px 12px; border: 1px solid var(--border); border-radius: 999px; font-size: 0.88rem; text-decoration: none; color: var(--text); }
    .category-jump a:hover { border-color: var(--accent); }
    .specimen-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .related-templates { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; padding: 0; list-style: none; }
    .related-templates a { display: block; padding: 12px 14px; border: 1px solid var(--border); border-radius: 10px; text-decoration: none; color: var(--text); }
    .related-templates a span { display: block; font-size: 0.82rem; color: var(--text-secondary); margin-top: 2px; }
    @media (max-width: 900px) { .specimen-pair { grid-template-columns: 1fr; } }
    @media (max-width: 520px) { .gallery-grid { grid-template-columns: 1fr; } }
`;

function templateHubHTML(templates) {
  const url = `${SITE_URL}${TEMPLATE_HUB_PATH}`;
  const title = `${TEMPLATE_COUNT} Email Signature Templates for Gmail and Outlook`;
  const metaDesc = `Browse ${TEMPLATE_COUNT} HTML email signature templates rendered live: professional, minimal, creative, social, sales and industry designs. Customise any of them free, then pay ${PRICE} once.`;
  const categories = CATEGORIES.filter(category => category.id !== 'all');

  const faqs = [
    { q: 'Are these email signature templates free?', a: `You can open any of the ${TEMPLATE_COUNT} templates, fill in your details and preview it free, with no account. Copying the finished signature into Gmail, Outlook or Apple Mail costs ${PRICE} once. There is no subscription and no branding on your signature.` },
    { q: 'Which email signature template works best in Outlook?', a: 'Every template uses table-based HTML with inline styles, which is what Outlook needs. The safest choices for classic Outlook on Windows are the layouts without gradients or rounded panels, such as Classic, Executive, Corporate, Minimal and Text Only. Always send yourself a test email after installing.' },
    { q: 'How long can an email signature be in Gmail?', a: `Gmail limits a signature to ${GMAIL_SIGNATURE_LIMIT.toLocaleString('en-US')} characters, including the HTML. Each template page lists the size of its HTML with sample details so you can see how much room is left. Hosted images count as a short link, not as the image itself.` },
    { q: 'Can I use my own logo and brand colours in a template?', a: 'Yes. Type your company website in the generator and it looks for your logo, brand colours, company name, phone number and social links, then applies them to whichever template you choose. You can also set every colour by hand.' },
    { q: 'What is the difference between a template and an example?', a: `A template is a layout the generator can fill with your details. Examples show finished signatures for particular jobs and situations. This page lists the ${TEMPLATE_COUNT} templates; the examples page shows 52 finished signatures and which template each one starts from.` },
  ];

  const sections = categories.map(category => {
    const inCategory = templates.filter(template => template.category === category.id);
    if (!inCategory.length) return '';
    return `    <section id="${category.id}" aria-labelledby="cat-${category.id}">
      <h2 id="cat-${category.id}">${escapeHtml(category.name)} templates (${inCategory.length})</h2>
      <div class="gallery-grid">
${inCategory.map(template => `        <article class="gallery-card">
          <div class="sig-specimen">${renderSpecimen(template.id, template.id === 'branded' ? { ...SAMPLE_PERSON, logoUrl: SAMPLE_LOGO } : SAMPLE_PERSON, { primaryColor: '#0E5A8A', secondaryColor: '#F2A93B', ctaText: 'Book a meeting', ctaUrl: 'https://example.com' })}</div>
          <div class="gallery-card-body">
            <h3><a href="${TEMPLATE_HUB_PATH}/${template.id}">${escapeHtml(template.name)}</a></h3>
            <p>${escapeHtml(template.summary)}</p>
            <div class="gallery-card-links">
              <a href="/generator?template=${template.id}">Use this template</a>
              <a href="${TEMPLATE_HUB_PATH}/${template.id}" aria-label="${escapeHtml(template.name)} template details">Details</a>
            </div>
          </div>
        </article>`).join('\n')}
      </div>
    </section>`;
  }).join('\n\n');

  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Email signature templates',
    numberOfItems: templates.length,
    itemListElement: templates.map((template, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: `${template.name} email signature template`,
      url: `${SITE_URL}${TEMPLATE_HUB_PATH}/${template.id}`,
    })),
  };

  const body = `    <nav class="breadcrumb" aria-label="Breadcrumb">
      <a href="/">Home</a> › Email signature templates
    </nav>

    <h1>${TEMPLATE_COUNT} Email Signature Templates</h1>
    <p class="post-meta">By Email Signature Generator · Updated <time datetime="${GALLERY_DATE}">${formatLongDate(GALLERY_DATE)}</time></p>
    <p class="short-answer"><strong>The short answer:</strong> Pick a template by what the reader should do next. Professional and minimal layouts suit most office jobs, sales templates add a booking button, social templates make your profiles bigger, and industry templates put the phone number or a booking link first. Every template below is the real HTML the generator exports, shown with sample details.</p>
    <p class="lede">Each design uses table-based HTML and inline styles built for Gmail, Outlook, Apple Mail and Yahoo Mail. Open any template in the generator, type your website to bring in your logo and colours, and see your own signature in seconds.</p>

    <ul class="category-jump" aria-label="Jump to a category">
${categories.map(category => `      <li><a href="#${category.id}">${escapeHtml(category.name)}</a></li>`).join('\n')}
    </ul>

${sections}

    <section aria-labelledby="choose">
      <h2 id="choose">How to choose an email signature template</h2>
      <ul class="guide-list">
        <li><strong>Start with the next step.</strong> If you want meetings booked, use a Sales template with a button. If clients phone you, use a layout that puts the phone first, such as Trades.</li>
        <li><strong>Decide on a photo.</strong> A headshot helps people who have not met you. If you do not want one, Monogram, Minimal, Clean, Dash and Text Only look finished without it.</li>
        <li><strong>Match your brand.</strong> Templates with an accent rule or bar carry your brand colour without needing a logo. Branded and Letterhead are built around the company name or logo.</li>
        <li><strong>Think about long threads.</strong> Short, wide layouts such as Classic, Clean and Boardroom take up less space when every reply repeats your signature.</li>
        <li><strong>Test before you roll it out.</strong> Install it, send yourself an email and check it on a phone and in dark mode. The free <a href="/health-check">signature health check</a> flags the common problems.</li>
      </ul>
    </section>

    <div class="page-cta">
      <h2>See your details in any template</h2>
      <p>Type your company website and your logo, brand colours and links are filled in. Free to build and preview, ${PRICE_SHORT} once to use it.</p>
      <a href="/generator" class="btn btn-primary">Build my signature</a>
      <a href="/email-signature-examples" class="btn btn-secondary">See 52 examples</a>
    </div>

${faqSectionHTML(faqs)}`;

  return shellHTML({
    url, title, metaDesc,
    schemas: [breadcrumbSchema([{ name: 'Home', url: `${SITE_URL}/` }, { name: 'Email signature templates', url }]), itemList, faqSchema(faqs)],
    css: TEMPLATE_CSS,
    body,
    bodyClass: 'content-page gallery-page',
  });
}

function templatePageHTML(template, templates) {
  const url = `${SITE_URL}${TEMPLATE_HUB_PATH}/${template.id}`;
  const category = categoryName(template.category);
  const title = `${template.name} Email Signature Template (${category}) | Gmail & Outlook`;
  const metaDesc = `${template.summary} See the ${template.name} email signature template rendered live and customise it with your own logo and colours.`;
  const features = templateFeatures(template.id);
  const brandStyle = { primaryColor: '#0E5A8A', secondaryColor: '#F2A93B', ctaText: 'Book a meeting', ctaUrl: 'https://example.com' };
  const altStyle = { primaryColor: '#15803D', secondaryColor: '#0EA5E9', ctaText: 'Book a call', ctaUrl: 'https://example.com', photoShape: 'rounded' };
  const related = templates.filter(other => other.category === template.category && other.id !== template.id)
    .concat(templates.filter(other => other.category !== template.category && other.id !== template.id))
    .slice(0, 6);

  const faqs = [
    { q: `Does the ${template.name} template work in Gmail and Outlook?`, a: `Yes. The ${template.name} template is table-based HTML with inline styles, designed for Gmail, Outlook, Apple Mail and Yahoo Mail. Rendering varies by client, so send yourself a test email after installing it.` },
    { q: `Can I use the ${template.name} template without a photo?`, a: features.photo ? `Yes. Leave the photo empty and the layout closes up around your details, as in the second example on this page.` : `It does not use a headshot. Your name and details carry the design, so it looks finished without a photo.` },
    { q: `How much does the ${template.name} template cost?`, a: `Building and previewing it is free with no account. Copying the finished signature into your email client costs ${PRICE} once, which unlocks all ${TEMPLATE_COUNT} templates. There is no subscription.` },
  ];

  const facts = [
    ['Category', category],
    ['Headshot', features.photo ? 'Optional photo, shown circular, rounded or square' : 'No photo in this layout'],
    ['Call-to-action', features.cta ? 'Built-in button or link for a booking or offer' : 'None. Use a Sales template if you need one'],
    ['Social icons', features.icons ? 'Hosted icons for LinkedIn, Instagram, Facebook and Google reviews' : 'Written as text links'],
    ['Images used', features.images ? `${features.images} with a photo and three social profiles` : 'None. Text only'],
    ['HTML size', `About ${features.length.toLocaleString('en-US')} characters with sample details, ${Math.round(features.length / GMAIL_SIGNATURE_LIMIT * 100)}% of Gmail's ${GMAIL_SIGNATURE_LIMIT.toLocaleString('en-US')}-character limit`],
    ['Email clients', 'Gmail, Outlook (new, classic, web and Mac), Apple Mail, Yahoo Mail'],
  ];

  const body = `    <nav class="breadcrumb" aria-label="Breadcrumb">
      <a href="/">Home</a> › <a href="${TEMPLATE_HUB_PATH}">Templates</a> › ${escapeHtml(template.name)}
    </nav>

    <h1>${escapeHtml(template.name)} Email Signature Template</h1>
    <p class="post-meta">${escapeHtml(category)} template · Updated <time datetime="${GALLERY_DATE}">${formatLongDate(GALLERY_DATE)}</time></p>
    <p class="lede">${escapeHtml(template.summary)}</p>

    <div class="specimen-pair">
      <figure>
        <div class="sig-specimen">${renderSpecimen(template.id, template.id === 'branded' ? { ...SAMPLE_PERSON, logoUrl: SAMPLE_LOGO } : SAMPLE_PERSON, brandStyle)}</div>
        <figcaption class="specimen-caption">${template.id === 'branded' ? 'With a company logo, a headshot and three social profiles.' : 'With a headshot and three social profiles.'}</figcaption>
      </figure>
      <figure>
        <div class="sig-specimen">${renderSpecimen(template.id, SECOND_PERSON, altStyle)}</div>
        <figcaption class="specimen-caption">Without a photo, in a different brand colour.</figcaption>
      </figure>
    </div>

    <div class="page-cta">
      <h2>Use the ${escapeHtml(template.name)} template</h2>
      <p>Open it with your own details, or type your website to bring in your logo and colours. Free to preview, ${PRICE_SHORT} once to use.</p>
      <a href="/generator?template=${template.id}" class="btn btn-primary">Use this template</a>
      <a href="${TEMPLATE_HUB_PATH}" class="btn btn-secondary">All ${TEMPLATE_COUNT} templates</a>
    </div>

    <section aria-labelledby="best-for">
      <h2 id="best-for">Who the ${escapeHtml(template.name)} template suits</h2>
      <ul class="guide-list">
${template.bestFor.map(item => `        <li>${escapeHtml(item)}</li>`).join('\n')}
      </ul>
      <p>${escapeHtml(template.notes)}</p>
    </section>

    <section aria-labelledby="details">
      <h2 id="details">Template details</h2>
      <div class="table-scroll">
        <table class="fact-table">
          <tbody>
${facts.map(([label, value]) => `            <tr><th scope="row">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`).join('\n')}
          </tbody>
        </table>
      </div>
    </section>

    <section aria-labelledby="install">
      <h2 id="install">How to install it</h2>
      <ol class="guide-list">
        <li>Open the template in the <a href="/generator?template=${template.id}">generator</a> and add your details, or type your company website to fill them in.</li>
        <li>Choose your colours, font and photo shape, and check the light and dark previews.</li>
        <li>Unlock copying with the ${PRICE} one-time purchase and click Copy HTML.</li>
        <li>Paste it into your email client's signature settings: <a href="/blog/how-to-add-email-signature-in-gmail">Gmail</a>, <a href="/blog/how-to-add-email-signature-in-outlook">Outlook</a> or <a href="/seo/email-signature-generator-for-apple-mail">Apple Mail</a>.</li>
      </ol>
    </section>

    <section aria-labelledby="related">
      <h2 id="related">Similar templates</h2>
      <ul class="related-templates">
${related.map(other => `        <li><a href="${TEMPLATE_HUB_PATH}/${other.id}">${escapeHtml(other.name)}<span>${escapeHtml(categoryName(other.category))}</span></a></li>`).join('\n')}
      </ul>
    </section>

${faqSectionHTML(faqs)}`;

  return shellHTML({
    url, title, metaDesc,
    schemas: [
      breadcrumbSchema([{ name: 'Home', url: `${SITE_URL}/` }, { name: 'Email signature templates', url: `${SITE_URL}${TEMPLATE_HUB_PATH}` }, { name: template.name, url }]),
      faqSchema(faqs),
    ],
    css: TEMPLATE_CSS,
    body,
  });
}

// ─── Profession guides ─────────────────────────────────────────────────────

function readProfessions() {
  const entries = JSON.parse(fs.readFileSync(path.join(__dirname, 'datasets', 'professions.json'), 'utf8'));
  for (const entry of entries) {
    for (const field of ['slug', 'label', 'seoTitle', 'metaDescription', 'heading', 'shortAnswer', 'description', 'datePublished', 'dateModified', 'include', 'avoid', 'examples', 'faqs']) {
      if (!entry[field] || (Array.isArray(entry[field]) && !entry[field].length)) throw new Error(`professions.json ${entry.slug} missing ${field}`);
    }
    if (!/^[a-z0-9-]+-email-signature$/.test(entry.slug)) throw new Error(`professions.json slug ${entry.slug} must end in -email-signature`);
    for (const example of entry.examples) {
      if (!TEMPLATES[example.template]) throw new Error(`professions.json ${entry.slug} uses unknown template ${example.template}`);
    }
  }
  return entries;
}

function professionPageHTML(entry) {
  const url = `${SITE_URL}/seo/${entry.slug}`;
  const examplesHTML = entry.examples.map(example => {
    const style = Object.assign({}, example.style, example.cta ? { ctaText: example.cta.text, ctaUrl: example.cta.url } : {});
    const compliance = example.compliance ? complianceFor(entry.complianceRole, example.complianceValues) : null;
    return `      <figure class="profession-example">
        <h3>${escapeHtml(example.title)}</h3>
        <div class="sig-specimen">${renderSpecimen(example.template, example.data, style, compliance)}</div>
        <figcaption class="specimen-caption">${escapeHtml(example.why)} Template: <a href="${TEMPLATE_HUB_PATH}/${example.template}">${escapeHtml(TEMPLATES[example.template].name)}</a>${compliance ? ', with the compliance fields turned on' : ''}.</figcaption>
        <p><a href="/generator?template=${example.template}&amp;role=${encodeURIComponent(example.data.title).replace(/%20/g, '+')}">Start with this layout and title</a></p>
      </figure>`;
  }).join('\n');

  const article = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: entry.heading,
    description: entry.metaDescription,
    datePublished: entry.datePublished,
    dateModified: entry.dateModified,
    image: SOCIAL_IMAGE,
    author: { '@type': 'Organization', name: 'Email Signature Generator', url: `${SITE_URL}/` },
    publisher: { '@type': 'Organization', name: 'Email Signature Generator', url: `${SITE_URL}/` },
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    inLanguage: 'en',
  };

  const body = `    <nav class="breadcrumb" aria-label="Breadcrumb">
      <a href="/">Home</a> › <a href="/email-signature-examples">Examples</a> › ${escapeHtml(entry.heading)}
    </nav>

    <h1>${escapeHtml(entry.heading)}</h1>
    <p class="post-meta">By Email Signature Generator · Updated <time datetime="${entry.dateModified}">${formatLongDate(entry.dateModified)}</time></p>
    <p class="short-answer"><strong>The short answer:</strong> ${escapeHtml(entry.shortAnswer)}</p>
    <p class="lede">${escapeHtml(entry.description)}</p>

    <section aria-labelledby="examples">
      <h2 id="examples">${escapeHtml(entry.label)} email signature examples</h2>
${examplesHTML}
    </section>

    <section aria-labelledby="include">
      <h2 id="include">What to include</h2>
      <ul class="guide-list">
${entry.include.map(item => `        <li>${escapeHtml(item)}</li>`).join('\n')}
      </ul>
    </section>

    <section aria-labelledby="avoid">
      <h2 id="avoid">What to leave out</h2>
      <ul class="guide-list">
${entry.avoid.map(item => `        <li>${escapeHtml(item)}</li>`).join('\n')}
      </ul>
      <p class="specimen-caption">Licence, disclaimer and credential wording on this page is general information, not legal advice. Check the current rules with your regulator, employer or brokerage.</p>
    </section>

    <div class="page-cta">
      <h2>Build your ${escapeHtml(entry.label.toLowerCase())} signature from your website</h2>
      <p>Type your ${entry.slug.startsWith('real-estate') ? 'brokerage' : entry.slug.startsWith('nurse') ? 'employer' : 'firm'} website to bring in the logo and colours, then turn on the compliance fields. Free to preview, ${PRICE_SHORT} once to use.</p>
      <form class="profession-brand-form" action="/generator" method="get">
        <label for="professionSite" class="visually-hidden">Website</label>
        <input type="text" id="professionSite" name="site" inputmode="url" autocomplete="url" spellcheck="false" placeholder="yourcompany.com" maxlength="300">
        <button type="submit" class="btn btn-primary">Build my signature</button>
      </form>
    </div>

${faqSectionHTML(entry.faqs)}

    <section aria-labelledby="more">
      <h2 id="more">More signature guides</h2>
      <ul class="guide-list">
        <li><a href="/email-signature-examples">52 email signature examples</a> for other jobs and situations</li>
        <li><a href="${TEMPLATE_HUB_PATH}">All ${TEMPLATE_COUNT} email signature templates</a></li>
        <li><a href="/blog/email-signature-credentials">How to list credentials in an email signature</a></li>
        <li><a href="/health-check">Free signature health check</a> for dark mode, Outlook and size problems</li>
      </ul>
    </section>`;

  return shellHTML({
    url,
    title: entry.seoTitle,
    metaDesc: entry.metaDescription,
    schemas: [
      article,
      breadcrumbSchema([{ name: 'Home', url: `${SITE_URL}/` }, { name: 'Examples', url: `${SITE_URL}/email-signature-examples` }, { name: entry.heading, url }]),
      faqSchema(entry.faqs),
    ],
    css: `    .content-page { max-width: 820px; }
    .profession-example { margin: 0 0 32px; }
    .profession-example h3 { margin: 0 0 10px; }
    .profession-example p { margin: 6px 0 0; font-size: 0.92rem; font-weight: 600; }
    .profession-brand-form { display: flex; gap: 8px; max-width: 520px; margin: 0 auto; }
    .profession-brand-form input { flex: 1; min-width: 0; padding: 12px 14px; font-size: 1rem; border: 1px solid var(--border); border-radius: 8px; font-family: inherit; }
    .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
    @media (max-width: 480px) { .profession-brand-form { flex-direction: column; } }
`,
    body,
  });
}

// ─── Brand extractor ───────────────────────────────────────────────────────
// The tool runs in js/brand-tool.js against /api/brand. The measured figures
// below come from a timed run against the live lookup; re-measure before
// changing them.

const BRAND_TEST = Object.freeze({ date: '2026-10-25', sites: 12, logos: 10, colours: 9, medianSeconds: 0.45, maxSeconds: 2.6 });

function brandExtractorHTML() {
  const url = `${SITE_URL}/brand-extractor`;
  const title = 'Website Brand Colour and Logo Extractor (Free)';
  const metaDesc = 'Type any website and get its logo, brand colours as hex codes, company name, phone number and social links. Free, no account, results in a few seconds.';
  const faqs = [
    { q: 'How do I find the brand colours of a website?', a: 'Type the website address above. The extractor reads the homepage, checks the theme colour, web app manifest and the colours used in the site\'s CSS, and returns the two most likely brand colours as hex codes you can copy.' },
    { q: 'How do I download a logo from a website?', a: 'Type the website address and, if a logo is found, click Download logo. The extractor checks the site\'s structured data, logo images and icons. Only download logos you have the right to use, such as your own company\'s.' },
    { q: 'Why did it not find a logo or colours?', a: 'Some sites block automated visits, and some draw their logo or set their colours with JavaScript after the page loads. The extractor reads the page as delivered, so those sites return less. You can still enter the details by hand in the generator.' },
    { q: 'Is the brand extractor free?', a: 'Yes. It is free with no account, and nothing you look up is stored. Lookups are rate limited to stop abuse.' },
    { q: 'What can I do with the results?', a: 'Copy the hex codes into your design tools, or click Make a signature with this brand to open the email signature generator with the logo, colours and links already filled in.' },
  ];

  const app = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Website Brand Extractor',
    url,
    applicationCategory: 'DesignApplication',
    operatingSystem: 'Web',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    featureList: ['Logo detection and download', 'Primary and secondary brand colours as hex codes', 'Company name and phone number', 'LinkedIn, Instagram, Facebook and Google review links'],
    description: metaDesc,
  };

  const body = `    <nav class="breadcrumb" aria-label="Breadcrumb">
      <a href="/">Home</a> › Brand extractor
    </nav>

    <h1>Website Brand Colour and Logo Extractor</h1>
    <p class="lede">Type any website and get its logo, brand colours as hex codes, company name, phone number and social links. Free, with no account.</p>

    <form class="brand-tool-form" id="brandToolForm" action="/brand-extractor" method="get" novalidate>
      <label for="brandToolSite">Website address</label>
      <div class="brand-tool-row">
        <input type="text" id="brandToolSite" name="site" inputmode="url" autocomplete="url" spellcheck="false" placeholder="acme.com" maxlength="300" required>
        <button type="submit" class="btn btn-primary" id="brandToolBtn">Extract brand</button>
      </div>
      <p class="brand-tool-status" id="brandToolStatus" role="status" aria-live="polite"></p>
    </form>

    <div id="brandToolResults" hidden></div>

    <section aria-labelledby="how">
      <h2 id="how">How it works</h2>
      <ol class="guide-list">
        <li>We fetch the homepage you type, the way a browser would on first load.</li>
        <li>The name comes from the site's structured data or its social sharing tags. The logo comes from structured data, logo images or the site icon.</li>
        <li>Colours come from the theme colour, the web app manifest and a ranking of the colours used in the page's CSS, ignoring greys.</li>
        <li>The phone number comes from structured data or the first tap-to-call link, and social links from links to LinkedIn, Instagram, Facebook and Google reviews.</li>
      </ol>
      <p>In our test of ${BRAND_TEST.sites} public websites on ${formatLongDate(BRAND_TEST.date)}, every lookup answered within ${BRAND_TEST.maxSeconds} seconds, with a median under half a second. It found a logo on ${BRAND_TEST.logos} of the ${BRAND_TEST.sites} sites and brand colours on ${BRAND_TEST.colours}. Sites that block automated visits, or draw their branding with JavaScript, return less.</p>
    </section>

    <section aria-labelledby="privacy">
      <h2 id="privacy">What happens to the address you type</h2>
      <p>The address is sent to our server so it can read the public page. Nothing is stored, and the logo is returned to your browser rather than saved on our site. Only public pages on standard web ports can be read. See <a href="/privacy">Privacy &amp; Terms</a>.</p>
    </section>

    <div class="page-cta">
      <h2>Need an email signature in these colours?</h2>
      <p>The email signature generator uses the same lookup to fill in your logo, colours and links across ${TEMPLATE_COUNT} templates. Free to preview, ${PRICE_SHORT} once to use.</p>
      <a href="/generator" class="btn btn-primary">Open the signature generator</a>
      <a href="${TEMPLATE_HUB_PATH}" class="btn btn-secondary">Browse templates</a>
    </div>

${faqSectionHTML(faqs)}`;

  return shellHTML({
    url, title, metaDesc,
    schemas: [breadcrumbSchema([{ name: 'Home', url: `${SITE_URL}/` }, { name: 'Brand extractor', url }]), app, faqSchema(faqs)],
    css: `    .content-page { max-width: 820px; }
    .brand-tool-form { margin: 24px 0 8px; padding: 22px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); }
    .brand-tool-form label { display: block; font-weight: 600; margin-bottom: 8px; }
    .brand-tool-row { display: flex; gap: 8px; }
    .brand-tool-row input { flex: 1; min-width: 0; padding: 12px 14px; font-size: 1rem; border: 1px solid var(--border); border-radius: 8px; font-family: inherit; }
    .brand-tool-status { min-height: 1.5em; margin: 10px 0 0; font-size: 0.92rem; color: var(--text-secondary); }
    .brand-tool-status.is-error { color: #b42318; }
    .brand-tool-status.is-success { color: #067647; }
    .brand-tool-card { margin: 16px 0 8px; border: 1px solid var(--border); border-radius: 14px; padding: 22px; }
    .brand-tool-card h2 { margin: 0 0 14px; font-size: 1.2rem; }
    .brand-tool-list { margin: 0; }
    .brand-result-row { display: grid; grid-template-columns: 140px 1fr; gap: 12px; padding: 12px 0; border-top: 1px solid var(--border); }
    .brand-tool-list dt { font-weight: 600; }
    .brand-tool-list dd { margin: 0; color: var(--text-secondary); }
    .brand-logo-box { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
    .brand-logo-box img { max-width: 220px; max-height: 90px; padding: 10px; border: 1px solid var(--border); border-radius: 8px; background: #ffffff; }
    .brand-swatches { display: flex; flex-direction: column; gap: 10px; }
    .brand-swatch { display: flex; align-items: center; gap: 12px; }
    .brand-swatch-chip { width: 40px; height: 40px; border-radius: 8px; border: 1px solid var(--border); flex-shrink: 0; }
    .brand-swatch-text { display: flex; flex-direction: column; min-width: 90px; }
    .brand-swatch-text strong { color: var(--text); font-size: 0.9rem; }
    .brand-copy { padding: 6px 12px; min-height: 36px; font-size: 0.85rem; }
    .brand-social { margin: 0; padding-left: 18px; }
    .brand-tool-next { margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--border); }
    .brand-tool-next p { margin: 0 0 12px; }
    .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
    @media (max-width: 520px) {
      .brand-tool-row { flex-direction: column; }
      .brand-result-row { grid-template-columns: 1fr; gap: 6px; }
    }
`,
    body,
    scripts: ['/js/brand-tool.js'],
  });
}

// ─── Generator comparison ──────────────────────────────────────────────────

function readGeneratorComparison() {
  const entry = fillFacts(JSON.parse(fs.readFileSync(path.join(__dirname, 'datasets', 'generators.json'), 'utf8')));
  for (const field of ['slug', 'seoTitle', 'metaDescription', 'heading', 'shortAnswer', 'intro', 'checkedOn', 'method', 'columns', 'tools', 'chooser', 'faqs']) {
    if (!entry[field] || (Array.isArray(entry[field]) && !entry[field].length)) throw new Error(`generators.json missing ${field}`);
  }
  // Counts in the title and description must match the table, which lists every tool.
  for (const field of ['seoTitle', 'metaDescription']) {
    for (const match of entry[field].matchAll(/\b(\d+) (?:tools|email signature generators)\b/gi)) {
      if (Number(match[1]) !== entry.tools.length) throw new Error(`generators.json ${field} says ${match[0]} but lists ${entry.tools.length} tools`);
    }
  }
  for (const tool of entry.tools) {
    if (tool.cells.length !== entry.columns.length) throw new Error(`generators.json ${tool.name} needs ${entry.columns.length} cells`);
    if (!tool.self && !tool.sources.length) throw new Error(`generators.json ${tool.name} needs a source`);
  }
  return entry;
}

function generatorComparisonHTML(entry) {
  const url = `${SITE_URL}/seo/${entry.slug}`;
  const others = entry.tools.filter(tool => !tool.self);

  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: entry.heading,
    numberOfItems: entry.tools.length,
    itemListElement: entry.tools.map((tool, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      item: { '@type': 'SoftwareApplication', name: tool.name.replace(' (us)', ''), url: tool.url, applicationCategory: 'BusinessApplication' },
    })),
  };
  const article = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: entry.heading,
    description: entry.metaDescription,
    datePublished: entry.datePublished,
    dateModified: entry.dateModified,
    image: SOCIAL_IMAGE,
    author: { '@type': 'Organization', name: 'Email Signature Generator', url: `${SITE_URL}/` },
    publisher: { '@type': 'Organization', name: 'Email Signature Generator', url: `${SITE_URL}/` },
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    inLanguage: 'en',
  };

  const sourceLinks = tool => tool.sources.map(source => `<a href="${escapeHtml(source.url)}" rel="nofollow noopener" target="_blank">${escapeHtml(source.label)}</a>`).join(', ');

  const body = `    <nav class="breadcrumb" aria-label="Breadcrumb">
      <a href="/">Home</a> › <a href="/blog/">Guides</a> › Best email signature generators
    </nav>

    <h1>${escapeHtml(entry.heading)}</h1>
    <p class="post-meta">By Email Signature Generator · Prices checked <time datetime="${entry.checkedOn}">${formatLongDate(entry.checkedOn)}</time></p>
    <p class="short-answer"><strong>The short answer:</strong> ${escapeHtml(entry.shortAnswer)}</p>
    <p class="lede">${escapeHtml(entry.intro)}</p>

    <section aria-labelledby="compare">
      <h2 id="compare">${entry.tools.length} email signature generators side by side</h2>
      <div class="table-scroll">
        <table class="compare-table">
          <thead>
            <tr><th scope="col">Tool</th>${entry.columns.map(column => `<th scope="col">${escapeHtml(column)}</th>`).join('')}</tr>
          </thead>
          <tbody>
${entry.tools.map(tool => `            <tr${tool.self ? ' class="is-self"' : ''}><th scope="row">${escapeHtml(tool.name)}</th>${tool.cells.map(cell => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('\n')}
          </tbody>
        </table>
      </div>
      <p class="specimen-caption">Checked on ${formatLongDate(entry.checkedOn)} from each vendor's own pages. Prices are shown as each page shows them and can change, so check before you buy.</p>
    </section>

    <section aria-labelledby="pick">
      <h2 id="pick">Which one should you pick?</h2>
      <div class="table-scroll">
        <table class="fact-table">
          <thead><tr><th scope="col">If you need</th><th scope="col">Pick</th></tr></thead>
          <tbody>
${entry.chooser.map(row => `            <tr><td>${escapeHtml(row.need)}</td><td><strong>${escapeHtml(row.pick)}</strong></td></tr>`).join('\n')}
          </tbody>
        </table>
      </div>
    </section>

    <section aria-labelledby="reviews">
      <h2 id="reviews">Each tool in brief</h2>
${entry.tools.map(tool => `      <article class="tool-brief${tool.self ? ' is-self' : ''}">
        <h3>${escapeHtml(tool.name)}</h3>
        <p><strong>Best for:</strong> ${escapeHtml(tool.bestFor)}</p>
        <p><strong>Limits:</strong> ${escapeHtml(tool.limits)}</p>
        ${tool.self ? `<p><a href="/generator">Try it with your website</a> · <a href="/#pricing">Pricing</a></p>` : `<p class="specimen-caption">Source: ${sourceLinks(tool)}</p>`}
      </article>`).join('\n')}
    </section>

    <section aria-labelledby="method">
      <h2 id="method">How we compared them</h2>
      <ul class="guide-list">
${entry.method.map(item => `        <li>${escapeHtml(item)}</li>`).join('\n')}
      </ul>
      <p>If a detail here is wrong or out of date, email <a href="mailto:${SITE_FACTS.contactEmail}">${SITE_FACTS.contactEmail}</a> and we will correct it. Direct comparisons: <a href="/seo/wisestamp-alternative">WiseStamp</a> and <a href="/seo/hubspot-email-signature-generator-alternative">HubSpot</a>.</p>
    </section>

    <div class="page-cta">
      <h2>Try the website import</h2>
      <p>Type your company website and see your logo, colours and links in a signature. Free to build and preview, ${PRICE_SHORT} once to use it.</p>
      <form class="profession-brand-form" action="/generator" method="get">
        <label for="compareSite" class="visually-hidden">Website</label>
        <input type="text" id="compareSite" name="site" inputmode="url" autocomplete="url" spellcheck="false" placeholder="yourcompany.com" maxlength="300">
        <button type="submit" class="btn btn-primary">Build my signature</button>
      </form>
    </div>

${faqSectionHTML(entry.faqs)}`;

  if (!others.length) throw new Error('generators.json needs competitors');

  return shellHTML({
    url,
    title: entry.seoTitle,
    metaDesc: entry.metaDescription,
    schemas: [
      article,
      breadcrumbSchema([{ name: 'Home', url: `${SITE_URL}/` }, { name: 'Guides', url: `${SITE_URL}/blog/` }, { name: entry.heading, url }]),
      itemList,
      faqSchema(entry.faqs),
    ],
    css: `    .compare-table { width: 100%; border-collapse: collapse; font-size: 0.88rem; min-width: 860px; }
    .compare-table th, .compare-table td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--border); vertical-align: top; line-height: 1.5; }
    .compare-table thead th { background: var(--surface); }
    .compare-table tbody th { font-weight: 600; min-width: 150px; }
    .compare-table tr.is-self th, .compare-table tr.is-self td { background: #f5f5f7; }
    .tool-brief { border-top: 1px solid var(--border); padding: 18px 0 4px; }
    .tool-brief p { margin: 4px 0; color: var(--text-secondary); }
    .profession-brand-form { display: flex; gap: 8px; max-width: 520px; margin: 0 auto; }
    .profession-brand-form input { flex: 1; min-width: 0; padding: 12px 14px; font-size: 1rem; border: 1px solid var(--border); border-radius: 8px; font-family: inherit; }
    .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
    @media (max-width: 480px) { .profession-brand-form { flex-direction: column; } }
`,
    body,
  });
}

function writePage(filename, html) {
  fs.writeFileSync(path.join(SEO_DIR, filename), html, 'utf8');
}

function removeObsoleteGeneratedPages(retainedPlatformSlugs, retainedComparisonSlugs = [], retainedProfessionSlugs = []) {
  const retainedFiles = new Set(
    retainedPlatformSlugs.map((slug) => `email-signature-generator-for-${slug}.html`)
  );
  const retainedComparisons = new Set(retainedComparisonSlugs.map((slug) => `${slug}.html`));
  const retainedProfessions = new Set(retainedProfessionSlugs.map((slug) => `${slug}.html`));
  let removed = 0;

  for (const filename of fs.readdirSync(SEO_DIR)) {
    const isRoleOrIndustryPage = /^email-signature-for-[a-z0-9-]+\.html$/.test(filename);
    const isRemovedPlatformPage = /^email-signature-generator-for-[a-z0-9-]+\.html$/.test(filename)
      && !retainedFiles.has(filename);

    const isRemovedComparisonPage = /^[a-z0-9-]+-alternative\.html$/.test(filename)
      && !retainedComparisons.has(filename);

    const isRemovedProfessionPage = /^[a-z0-9-]+-email-signature\.html$/.test(filename)
      && !retainedProfessions.has(filename);

    if (isRoleOrIndustryPage || isRemovedPlatformPage || isRemovedComparisonPage || isRemovedProfessionPage) {
      fs.unlinkSync(path.join(SEO_DIR, filename));
      removed++;
    }
  }

  if (fs.existsSync(TEMPLATE_DIR)) {
    for (const filename of fs.readdirSync(TEMPLATE_DIR)) {
      if (filename.endsWith('.html') && !TEMPLATES[filename.replace(/\.html$/, '')]) {
        fs.unlinkSync(path.join(TEMPLATE_DIR, filename));
        removed++;
      }
    }
  }

  return removed;
}

function generatePages() {
  ensureOutputDir();
  const platforms = readDataset('platforms.json');
  const competitors = readDataset('competitors.json');
  for (const competitor of competitors) {
    if (!/^[a-z0-9-]+-alternative$/.test(competitor.slug)) {
      throw new Error(`competitors.json slug ${competitor.slug} must end in -alternative`);
    }
  }
  const professions = readProfessions();
  const templates = readTemplateCopy();
  const generatorComparison = readGeneratorComparison();
  const removed = removeObsoleteGeneratedPages(
    platforms.map((platform) => platform.slug),
    competitors.map((competitor) => competitor.slug),
    professions.map((profession) => profession.slug)
  );

  for (const platform of platforms) {
    writePage(`email-signature-generator-for-${platform.slug}.html`, platformPageHTML(platform));
  }

  for (const competitor of competitors) {
    writePage(`${competitor.slug}.html`, comparisonPageHTML(competitor));
  }

  for (const profession of professions) {
    writePage(`${profession.slug}.html`, professionPageHTML(profession));
  }

  writePage(`${generatorComparison.slug}.html`, generatorComparisonHTML(generatorComparison));

  fs.writeFileSync(path.join(__dirname, 'email-signature-templates.html'), templateHubHTML(templates), 'utf8');
  fs.writeFileSync(path.join(__dirname, 'brand-extractor.html'), brandExtractorHTML(), 'utf8');
  if (!fs.existsSync(TEMPLATE_DIR)) fs.mkdirSync(TEMPLATE_DIR, { recursive: true });
  for (const template of templates) {
    fs.writeFileSync(path.join(TEMPLATE_DIR, `${template.id}.html`), templatePageHTML(template, templates), 'utf8');
  }

  console.log(`Removed ${removed} obsolete generated pages`);
  console.log(`Generated ${platforms.length} retained platform guides`);
  console.log(`Generated ${competitors.length + 1} comparison pages`);
  console.log(`Generated ${professions.length} profession guides`);
  console.log(`Generated the template gallery and ${templates.length} template pages`);
  console.log('Generated the brand extractor page');
  return {
    generated: platforms.length + competitors.length + professions.length + 1 + templates.length + 2,
    removed,
    platforms: platforms.length,
    comparisons: competitors.length + 1,
    professions: professions.length,
    templates: templates.length,
  };
}

if (require.main === module) {
  generatePages();
}

module.exports = {
  comparisonPageHTML,
  generatePages,
  pageHTML,
  platformPageHTML,
  readDataset,
  removeObsoleteGeneratedPages,
};
