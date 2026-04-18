#!/usr/bin/env node
/**
 * Sitemap Auto-Updater
 * emailsignaturegenerator.ai
 *
 * Scans the seo/ directory and blog/ directory for HTML files,
 * regenerates sitemap.xml with all pages and today's lastmod date.
 * Run: node update-sitemap.js
 */

const fs = require('fs');
const path = require('path');

const SITE_URL = 'https://emailsignaturegenerator.ai';
const TODAY = new Date().toISOString().split('T')[0];

const urls = [];

// ─── Core pages ────────────────────────────────────────────────────────────
urls.push({ loc: `${SITE_URL}/`, priority: '1.0', changefreq: 'monthly' });
urls.push({ loc: `${SITE_URL}/generator`, priority: '0.9', changefreq: 'monthly' });
urls.push({ loc: `${SITE_URL}/health-check`, priority: '0.9', changefreq: 'monthly' });

// ─── SEO programmatic pages ─────────────────────────────────────────────────
const seoDir = path.join(__dirname, 'seo');
if (fs.existsSync(seoDir)) {
  const seoFiles = fs.readdirSync(seoDir).filter(f => f.endsWith('.html'));
  for (const file of seoFiles) {
    const slug = file.replace('.html', '');
    urls.push({
      loc: `${SITE_URL}/seo/${slug}`,
      priority: '0.7',
      changefreq: 'monthly'
    });
  }
  console.log(`  Found ${seoFiles.length} SEO pages`);
}

// ─── Blog pages ─────────────────────────────────────────────────────────────
const blogDir = path.join(__dirname, 'blog');
if (fs.existsSync(blogDir)) {
  const blogFiles = fs.readdirSync(blogDir).filter(f => f.endsWith('.html'));
  for (const file of blogFiles) {
    if (file === 'index.html') {
      urls.push({ loc: `${SITE_URL}/blog/`, priority: '0.8', changefreq: 'weekly' });
    } else {
      const slug = file.replace('.html', '');
      urls.push({ loc: `${SITE_URL}/blog/${slug}`, priority: '0.7', changefreq: 'monthly' });
    }
  }
  console.log(`  Found ${blogFiles.length} blog pages`);
}

// ─── Generate XML ───────────────────────────────────────────────────────────
const urlEntries = urls.map(u => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${TODAY}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join('\n');

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlEntries}
</urlset>
`;

fs.writeFileSync(path.join(__dirname, 'sitemap.xml'), xml, 'utf8');
console.log(`✅ sitemap.xml updated — ${urls.length} URLs, lastmod: ${TODAY}`);
