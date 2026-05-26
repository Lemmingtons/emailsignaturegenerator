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
const SITE_FACTS = require('./js/site-facts');

const SITE_URL = SITE_FACTS.origin;

function xmlEscape(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fileLastmod(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return stat.mtime.toISOString().split('T')[0];
  } catch {
    return new Date().toISOString().split('T')[0];
  }
}

function collectUrls() {
  const urls = [];

  urls.push({ loc: `${SITE_URL}/`, priority: '1.0', changefreq: 'monthly', file: path.join(__dirname, 'index.html') });
  urls.push({ loc: `${SITE_URL}/generator`, priority: '0.9', changefreq: 'monthly', file: path.join(__dirname, 'generator.html') });
  urls.push({ loc: `${SITE_URL}/email-signature-examples`, priority: '0.9', changefreq: 'monthly', file: path.join(__dirname, 'email-signature-examples.html') });
  urls.push({ loc: `${SITE_URL}/health-check`, priority: '0.9', changefreq: 'monthly', file: path.join(__dirname, 'health-check.html') });
  urls.push({ loc: `${SITE_URL}/privacy`, priority: '0.6', changefreq: 'yearly', file: path.join(__dirname, 'privacy.html') });

  const seoDir = path.join(__dirname, 'seo');
  if (fs.existsSync(seoDir)) {
    const seoFiles = fs.readdirSync(seoDir).filter(f => f.endsWith('.html')).sort();
    for (const file of seoFiles) {
      const slug = file.replace('.html', '');
      urls.push({
        loc: `${SITE_URL}/seo/${slug}`,
        priority: '0.7',
        changefreq: 'monthly',
        file: path.join(seoDir, file)
      });
    }
    console.log(`  Found ${seoFiles.length} SEO pages`);
  }

  const blogDir = path.join(__dirname, 'blog');
  if (fs.existsSync(blogDir)) {
    const blogFiles = fs.readdirSync(blogDir).filter(f => f.endsWith('.html')).sort();
    for (const file of blogFiles) {
      if (file === 'index.html') {
        urls.push({ loc: `${SITE_URL}/blog/`, priority: '0.8', changefreq: 'weekly', file: path.join(blogDir, file) });
      } else {
        const slug = file.replace('.html', '');
        urls.push({ loc: `${SITE_URL}/blog/${slug}`, priority: '0.7', changefreq: 'monthly', file: path.join(blogDir, file) });
      }
    }
    console.log(`  Found ${blogFiles.length} blog pages`);
  }

  return urls;
}

function buildSitemapXml(urls) {
  const urlEntries = urls.map(u => `  <url>
  <loc>${xmlEscape(u.loc)}</loc>
  <lastmod>${fileLastmod(u.file)}</lastmod>
  <changefreq>${u.changefreq}</changefreq>
  <priority>${u.priority}</priority>
</url>`).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlEntries}
</urlset>
`;
}

function updateSitemap() {
  const urls = collectUrls();
  const xml = buildSitemapXml(urls);
  fs.writeFileSync(path.join(__dirname, 'sitemap.xml'), xml, 'utf8');
  console.log(`sitemap.xml updated - ${urls.length} URLs`);
  return urls;
}

if (require.main === module) {
  updateSitemap();
}

module.exports = { collectUrls, buildSitemapXml, updateSitemap };
