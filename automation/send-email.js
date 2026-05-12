#!/usr/bin/env node
/**
 * Email Report Sender — emailsignaturegenerator.ai
 * Sends a report file via Resend API.
 *
 * Usage:
 *   node automation/send-email.js <report-file-path> <subject>
 *
 * Requires RESEND_API_KEY in the environment. For Ryan's machines, run via Doppler.
 */

const https = require('https');
const fs = require('fs');
const SITE_FACTS = require('../js/site-facts');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const TO_EMAIL = process.env.SEO_REPORT_TO || SITE_FACTS.reportEmail;
const FROM_EMAIL = 'seo-reports@emailsignaturegenerator.ai';

if (!RESEND_API_KEY) {
  console.error('RESEND_API_KEY not set. Run with Doppler or provide RESEND_API_KEY in the environment.');
  process.exit(1);
}

const reportPath = process.argv[2];
const subject = process.argv[3] || 'SEO Report — emailsignaturegenerator.ai';

if (!reportPath || !fs.existsSync(reportPath)) {
  console.error(`❌ Report file not found: ${reportPath}`);
  process.exit(1);
}

const reportContent = fs.readFileSync(reportPath, 'utf8');
const today = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });

// Convert markdown to simple HTML
const htmlBody = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  body { font-family: -apple-system, Arial, sans-serif; font-size: 15px; color: #1e293b; max-width: 680px; margin: 0 auto; padding: 32px 24px; }
  h1 { font-size: 22px; color: #0f172a; border-bottom: 2px solid #4F46E5; padding-bottom: 12px; }
  h2 { font-size: 17px; color: #0f172a; margin-top: 28px; }
  h3 { font-size: 15px; color: #334155; }
  pre, code { background: #f1f5f9; padding: 12px; border-radius: 6px; font-size: 13px; white-space: pre-wrap; display: block; }
  .status-healthy { color: #16a34a; font-weight: bold; }
  .status-warning { color: #d97706; font-weight: bold; }
  .status-critical { color: #dc2626; font-weight: bold; }
  hr { border: none; border-top: 1px solid #e2e8f0; margin: 24px 0; }
  .footer { font-size: 12px; color: #94a3b8; margin-top: 32px; padding-top: 16px; border-top: 1px solid #e2e8f0; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0; }
  th { background: #f1f5f9; padding: 8px 12px; text-align: left; font-size: 13px; }
  td { padding: 8px 12px; border-bottom: 1px solid #e2e8f0; font-size: 13px; }
</style>
</head>
<body>
  <h1>${subject}</h1>
  <p style="color:#64748b;font-size:13px;">Generated ${today} · emailsignaturegenerator.ai</p>
  <hr>
  <pre>${reportContent.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
  <div class="footer">
    This is an automated report from your SEO+GEO monitoring system.<br>
    Site: <a href="https://emailsignaturegenerator.ai">emailsignaturegenerator.ai</a>
  </div>
</body>
</html>
`;

const payload = JSON.stringify({
  from: FROM_EMAIL,
  to: [TO_EMAIL],
  subject: `${subject} — ${today}`,
  html: htmlBody,
  text: reportContent,
});

const options = {
  hostname: 'api.resend.com',
  path: '/emails',
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${RESEND_API_KEY}`,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  },
};

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    if (res.statusCode === 200 || res.statusCode === 201) {
      console.log(`Report emailed to ${TO_EMAIL}`);
    } else {
      console.error(`Resend API error ${res.statusCode}: ${data}`);
      process.exit(1);
    }
  });
});

req.on('error', (err) => {
  console.error(`Network error: ${err.message}`);
  process.exit(1);
});

req.write(payload);
req.end();
