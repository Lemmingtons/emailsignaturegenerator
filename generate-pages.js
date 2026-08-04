#!/usr/bin/env node
/**
 * Programmatic SEO Page Generator
 * emailsignaturegenerator.ai
 *
 * Generates the retained static platform setup guides from the platform dataset.
 * Run: node generate-pages.js
 * Outputs pages to: seo/
 *
 * Page type:
 *   - /seo/email-signature-generator-for-[platform].html  (3 platform guides)
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

const SEO_DIR = path.join(__dirname, 'seo');
const SITE_URL = SITE_FACTS.origin;
const PRICE = SITE_FACTS.proPrice.displayWithCurrency;
const PRICE_SHORT = SITE_FACTS.proPrice.display;
const TEMPLATE_COUNT = SITE_FACTS.templateCount;

function readDataset(name) {
  const filePath = path.join(__dirname, 'datasets', name);
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!Array.isArray(data)) {
    throw new Error(`${name} must contain an array`);
  }
  data.forEach((entry, index) => {
    for (const field of ['slug', 'label', 'description', 'keywords']) {
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
        a: `To add an email signature to ${label}: (1) Use our free generator above to create your signature. (2) Click "Copy for Gmail" (our HTML format works across all major email clients). (3) Open ${label} settings and find the Signature section. (4) Paste your signature and save. It usually takes under 2 minutes.`
      },
      {
        q: `Do your email signatures work in ${label}?`,
        a: `Yes. All our email signatures use HTML table-based layouts that are compatible with ${label} and 50+ other email clients. We test every template across major email clients to ensure consistent rendering.`
      },
      {
        q: `Is there a free email signature generator for ${label}?`,
        a: `You can build and preview an email signature for ${label} free, with no account — all ${TEMPLATE_COUNT} templates and full customisation. Copying it into your email client costs ${PRICE} as a one-time payment. There is no subscription and no branding on your signature.`
      }
    ].concat(additionalFaqs || [])
  });
}

function pageHTML({ url, title, metaDesc, h1, slug, intro, keywords, ctaText, seoLabel, faqs, installInstructions, guideSections, troubleshooting, relatedLinks }) {
  const faqSchema = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": faqs.map(f => ({
      "@type": "Question",
      "name": f.q,
      "acceptedAnswer": { "@type": "Answer", "text": f.a }
    }))
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

  <!-- Breadcrumb Schema -->
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
  </style>
</head>
<body>

  <a href="#main-content" class="skip-link">Skip to content</a>

  <!-- Header -->
  <header class="site-header" role="banner">
    <a href="/" class="site-logo" aria-label="Email Signature Generator home">
      <span class="logo-icon" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
      </span>
      Email Signature Generator
    </a>
    <nav class="site-nav" aria-label="Main navigation">
      <a href="/#templates">Templates</a>
      <a href="/#pricing">Pricing</a>
      <a href="/generator" class="nav-cta">Create Signature</a>
    </nav>
  </header>

  <main id="main-content" class="seo-page">

    <nav class="breadcrumb" aria-label="Breadcrumb">
      <a href="/">Home</a> › ${escapeHtml(h1)}
    </nav>

    <h1>${escapeHtml(h1)}</h1>
    <p class="intro">${escapeHtml(intro)}</p>

    <div class="seo-cta-box">
      <h2>${escapeHtml(ctaText)} — Free</h2>
      <p>${TEMPLATE_COUNT} templates. Full customisation. Works with Gmail and Outlook.<br>Free to build and preview. ${PRICE_SHORT} once when you are ready to use it.</p>
      <a href="/generator" class="btn btn-primary" aria-label="${escapeHtml(ctaText)}">${escapeHtml(ctaText)}</a>
    </div>

    <section aria-label="Features">
      <h2>Everything you need in an email signature</h2>
      <div class="features-grid">
        <div class="feature-item">
          <h3>${TEMPLATE_COUNT} Templates</h3>
          <p>Professional, Creative, Minimal, Social-First, Sales, and Industry designs.</p>
        </div>
        <div class="feature-item">
          <h3>Full Customisation</h3>
          <p>Custom colours, 8 email-safe fonts, photo shapes, and icon styles.</p>
        </div>
        <div class="feature-item">
          <h3>Works Everywhere</h3>
          <p>Gmail, Outlook, Apple Mail, Yahoo, and 50+ other email clients.</p>
        </div>
        <div class="feature-item">
          <h3>$9 One-Time</h3>
          <p>No subscription. Pay once, use forever. 30-day money-back guarantee.</p>
        </div>
        <div class="feature-item">
          <h3>No Account Needed</h3>
          <p>Works in your browser. No login, no tracking, no stored data.</p>
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
      <p>Join thousands of professionals who've ditched the $108/year subscription for a ${PRICE_SHORT} one-time tool.</p>
      <a href="/generator" class="btn btn-primary">Create Free Signature</a>
    </div>

  </main>

  <!-- Footer -->
  <footer class="site-footer" role="contentinfo">
    <p>&copy; 2026 emailsignaturegenerator.ai — No subscriptions. No lock-in. Just great signatures.</p>
    <p style="margin-top: 8px;">
      <a href="/generator">Generator</a>
      &nbsp;&middot;&nbsp;
      <a href="/#pricing">Pricing</a>
      &nbsp;&middot;&nbsp;
      <a href="mailto:${SITE_FACTS.contactEmail}">Contact</a>
    </p>
  </footer>

</body>
</html>`;

  return html.replace(/[ \t]+$/gm, '');
}

function writePage(filename, html) {
  fs.writeFileSync(path.join(SEO_DIR, filename), html, 'utf8');
}

function removeObsoleteGeneratedPages(retainedPlatformSlugs) {
  const retainedFiles = new Set(
    retainedPlatformSlugs.map((slug) => `email-signature-generator-for-${slug}.html`)
  );
  let removed = 0;

  for (const filename of fs.readdirSync(SEO_DIR)) {
    const isRoleOrIndustryPage = /^email-signature-for-[a-z0-9-]+\.html$/.test(filename);
    const isRemovedPlatformPage = /^email-signature-generator-for-[a-z0-9-]+\.html$/.test(filename)
      && !retainedFiles.has(filename);

    if (isRoleOrIndustryPage || isRemovedPlatformPage) {
      fs.unlinkSync(path.join(SEO_DIR, filename));
      removed++;
    }
  }

  return removed;
}

function generatePages() {
  ensureOutputDir();
  const platforms = readDataset('platforms.json');
  const removed = removeObsoleteGeneratedPages(platforms.map((platform) => platform.slug));

  for (const platform of platforms) {
    writePage(`email-signature-generator-for-${platform.slug}.html`, platformPageHTML(platform));
  }

  console.log(`Removed ${removed} obsolete generated SEO pages`);
  console.log(`Generated ${platforms.length} retained platform guides`);
  console.log('Output directory: ./seo/');
  return { generated: platforms.length, removed, platforms: platforms.length };
}

if (require.main === module) {
  generatePages();
}

module.exports = {
  generatePages,
  pageHTML,
  platformPageHTML,
  readDataset,
  removeObsoleteGeneratedPages,
};
