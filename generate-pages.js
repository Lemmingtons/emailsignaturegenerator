#!/usr/bin/env node
/**
 * Programmatic SEO Page Generator
 * emailsignaturegenerator.ai
 *
 * Generates static HTML landing pages from datasets.
 * Run: node generate-pages.js
 * Outputs pages to: seo/
 *
 * Page types:
 *   - /seo/email-signature-for-[role].html        (30+ role pages)
 *   - /seo/email-signature-for-[industry].html    (18+ industry pages)
 *   - /seo/email-signature-generator-for-[platform].html  (6 platform pages)
 */

const fs = require('fs');
const path = require('path');

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const SEO_DIR = path.join(__dirname, 'seo');
const SITE_URL = 'https://emailsignaturegenerator.ai';

// Ensure output directory exists
if (!fs.existsSync(SEO_DIR)) {
  fs.mkdirSync(SEO_DIR, { recursive: true });
}

// ─── Templates ─────────────────────────────────────────────────────────────

function rolePageHTML({ slug, label, singular, description, keywords }) {
  const url = `${SITE_URL}/seo/email-signature-for-${slug}`;
  const title = `Email Signature for ${label} — Free Templates | Email Signature Generator`;
  const metaDesc = `Create a professional email signature for ${label.toLowerCase()} in under 2 minutes. Free templates, full customisation. Works with Gmail and Outlook.`;
  const h1 = `Professional Email Signature for ${label}`;

  return pageHTML({
    url, title, metaDesc, h1, slug,
    intro: description,
    keywords,
    ctaText: `Create Your ${singular} Email Signature`,
    seoType: 'role',
    seoLabel: label,
    faqs: [
      {
        q: `What should a ${singular.toLowerCase()} include in their email signature?`,
        a: `A ${singular.toLowerCase()} email signature should include your full name, job title or position, company or firm name, phone number, email address, and a link to your website or professional profile. ${singular}s should also consider adding their professional licence or registration number, relevant credentials, and a call-to-action such as a booking link.`
      },
      {
        q: `What is the best email signature format for ${label.toLowerCase()}?`,
        a: `The best email signature format for ${label.toLowerCase()} uses HTML table-based layouts that render consistently across all email clients including Gmail and Outlook. A clean, professional layout with your photo, name, title, contact details, and social links is ideal. Avoid using images for text, as these can appear broken in some email clients.`
      },
      {
        q: `How do I add my email signature to Gmail as a ${singular.toLowerCase()}?`,
        a: `To add your email signature to Gmail: (1) Create your signature using our free generator above. (2) Click "Copy for Gmail". (3) Open Gmail Settings → See all settings → Signature. (4) Create a new signature and paste with Ctrl+V. (5) Save changes and set as default for new emails.`
      },
      {
        q: `Is this email signature generator free for ${label.toLowerCase()}?`,
        a: `Yes. The free plan includes 6 professional templates with full customisation of colours, fonts, photos, and social links. The Pro plan costs $5 AUD (one-time payment) and unlocks all 19 templates, removes branding, and adds CTA buttons. No subscription required.`
      }
    ]
  });
}

function platformPageHTML({ slug, label, description, installInstructions, keywords }) {
  const url = `${SITE_URL}/seo/email-signature-generator-for-${slug}`;
  const title = `Email Signature Generator for ${label} — Free Templates`;
  const metaDesc = `Create a professional ${label} email signature in under 2 minutes. One-click copy, works perfectly in ${label}. Free templates with full customisation.`;
  const h1 = `Email Signature Generator for ${label}`;

  return pageHTML({
    url, title, metaDesc, h1, slug,
    intro: description,
    keywords,
    ctaText: `Create Your ${label} Signature`,
    seoType: 'platform',
    seoLabel: label,
    installInstructions,
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
        a: `Yes. Our free plan includes 6 professional email signature templates for ${label} with full customisation. The only difference from Pro is a small "Made with emailsignaturegenerator.ai" footer line. Pro costs $5 AUD as a one-time payment and unlocks all 19 templates with no branding.`
      }
    ]
  });
}

function industryPageHTML({ slug, label, description, keywords }) {
  const url = `${SITE_URL}/seo/email-signature-for-${slug}`;
  const title = `Email Signature for ${label} — Professional Templates | Email Signature Generator`;
  const metaDesc = `Create a professional email signature for ${label.toLowerCase()} businesses and professionals. Free templates, full customisation, works with Gmail and Outlook.`;
  const h1 = `Professional Email Signatures for ${label}`;

  return pageHTML({
    url, title, metaDesc, h1, slug,
    intro: description,
    keywords,
    ctaText: `Create Your ${label} Email Signature`,
    seoType: 'industry',
    seoLabel: label,
    faqs: [
      {
        q: `What makes a good email signature for ${label.toLowerCase()} businesses?`,
        a: `A good email signature for ${label.toLowerCase()} should include your name, job title, company name, phone number, and email. Depending on your industry, you may also want to include professional licence numbers, credentials, website links, and a call-to-action button such as a booking or enquiry link.`
      },
      {
        q: `How do I create a professional email signature for a ${label.toLowerCase()} company?`,
        a: `Use our free email signature generator above. Pick a professional template, enter your contact details, customise the colours to match your brand, and copy the finished signature into Gmail, Outlook, or any other email client. It takes under 2 minutes with no design skills required.`
      },
      {
        q: `Is this email signature generator free for ${label.toLowerCase()} professionals?`,
        a: `Yes. The free plan includes 6 templates with full customisation. The Pro plan costs $5 AUD as a one-time payment and unlocks all 19 templates, removes branding, and adds CTA buttons. No subscription, no recurring charges.`
      }
    ]
  });
}

function pageHTML({ url, title, metaDesc, h1, slug, intro, keywords, ctaText, seoType, seoLabel, faqs, installInstructions }) {
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
        ${installInstructions.map(step => `<li>${escapeHtml(step)}</li>`).join('\n        ')}
      </ol>
    </section>` : '';

  const faqHTML = faqs.map(f => `
        <details class="instructions">
          <summary>${escapeHtml(f.q)}</summary>
          <p>${escapeHtml(f.a)}</p>
        </details>`).join('');

  return `<!DOCTYPE html>
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
  </style>
</head>
<body>

  <a href="#main-content" class="skip-link">Skip to content</a>

  <!-- Header -->
  <header class="site-header" role="banner">
    <a href="../index.html" class="site-logo" aria-label="Email Signature Generator home">
      <span class="logo-icon" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
      </span>
      Email Signature Generator
    </a>
    <nav class="site-nav" aria-label="Main navigation">
      <a href="../index.html#templates">Templates</a>
      <a href="../index.html#pricing">Pricing</a>
      <a href="../generator.html" class="nav-cta">Create Signature</a>
    </nav>
  </header>

  <main id="main-content" class="seo-page">

    <nav class="breadcrumb" aria-label="Breadcrumb">
      <a href="../index.html">Home</a> › ${escapeHtml(h1)}
    </nav>

    <h1>${escapeHtml(h1)}</h1>
    <p class="intro">${escapeHtml(intro)}</p>

    <div class="seo-cta-box">
      <h2>${escapeHtml(ctaText)} — Free</h2>
      <p>19 templates. Full customisation. Works with Gmail and Outlook.<br>Pay $5 once for Pro, or use 6 templates free forever.</p>
      <a href="../generator.html" class="btn btn-primary" aria-label="${escapeHtml(ctaText)}">${escapeHtml(ctaText)}</a>
    </div>

    <section aria-label="Features">
      <h2>Everything you need in an email signature</h2>
      <div class="features-grid">
        <div class="feature-item">
          <h3>18 Templates</h3>
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
          <h3>$5 One-Time</h3>
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

    <section class="faq-section" aria-label="Frequently asked questions">
      <h2>Frequently Asked Questions</h2>
      ${faqHTML}
    </section>

    <div class="seo-cta-box" style="margin-top: 48px;">
      <h2>Ready to create your professional email signature?</h2>
      <p>Join thousands of professionals who've ditched the $108/year subscription for a $5 one-time tool.</p>
      <a href="../generator.html" class="btn btn-primary">Create Free Signature</a>
    </div>

  </main>

  <!-- Footer -->
  <footer class="site-footer" role="contentinfo">
    <p>&copy; 2026 emailsignaturegenerator.ai — No subscriptions. No lock-in. Just great signatures.</p>
    <p style="margin-top: 8px;">
      <a href="../generator.html">Generator</a>
      &nbsp;&middot;&nbsp;
      <a href="../index.html#pricing">Pricing</a>
      &nbsp;&middot;&nbsp;
      <a href="mailto:info@strata-reports.ai">Contact</a>
    </p>
  </footer>

</body>
</html>`;
}

// ─── Generate Pages ─────────────────────────────────────────────────────────

let generated = 0;

// Role pages
const roles = JSON.parse(fs.readFileSync(path.join(__dirname, 'datasets/roles.json'), 'utf8'));
// Deduplicate by slug
const uniqueRoles = roles.filter((r, i, a) => a.findIndex(x => x.slug === r.slug) === i);
for (const role of uniqueRoles) {
  const filename = `email-signature-for-${role.slug}.html`;
  const html = rolePageHTML(role);
  fs.writeFileSync(path.join(SEO_DIR, filename), html, 'utf8');
  generated++;
}
console.log(`✓ Generated ${uniqueRoles.length} role pages`);

// Platform pages
const platforms = JSON.parse(fs.readFileSync(path.join(__dirname, 'datasets/platforms.json'), 'utf8'));
for (const platform of platforms) {
  const filename = `email-signature-generator-for-${platform.slug}.html`;
  const html = platformPageHTML(platform);
  fs.writeFileSync(path.join(SEO_DIR, filename), html, 'utf8');
  generated++;
}
console.log(`✓ Generated ${platforms.length} platform pages`);

// Industry pages
const industries = JSON.parse(fs.readFileSync(path.join(__dirname, 'datasets/industries.json'), 'utf8'));
for (const industry of industries) {
  const filename = `email-signature-for-${industry.slug}.html`;
  const html = industryPageHTML(industry);
  fs.writeFileSync(path.join(SEO_DIR, filename), html, 'utf8');
  generated++;
}
console.log(`✓ Generated ${industries.length} industry pages`);

console.log(`\n✅ Total pages generated: ${generated}`);
console.log(`   Output directory: ./seo/`);
console.log('\nNext steps:');
console.log('  1. Run: node update-sitemap.js  (adds new pages to sitemap.xml)');
console.log('  2. Deploy to Cloudflare: npx wrangler pages deploy .');
