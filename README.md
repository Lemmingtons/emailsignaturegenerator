# Email Signature Generator

Static web app and Cloudflare Worker for [emailsignaturegenerator.ai](https://emailsignaturegenerator.ai/) — a browser-based HTML email signature builder with website brand extraction, hosted images/animations, team & bulk generation, and MCP/A2A agent endpoints.

## Architecture

- **Canonical product facts:** [`js/site-facts.js`](js/site-facts.js) — single source of truth for prices, template count, contact email, canonical URLs, and Stripe Payment Links.
- **Signature engine & templates:** [`js/templates.js`](js/templates.js) and [`js/generator-core.js`](js/generator-core.js) — table-based, inline-styled HTML signatures designed for Gmail, Outlook, Apple Mail, and Yahoo Mail (no runtime script or `data:`/`svg` images).
- **Interactive clients:** `generator.html` (`js/app.js`), `bulk.html` (`js/bulk.js`, `js/bulk-core.js`), `health-check.html` (`js/health-check.js`), `brand-extractor.html` (`js/brand-tool.js`), `connect-agent.html` (`js/connect-agent.js`).
- **Cloudflare Worker & storage:** [`_worker.js`](_worker.js) and [`wrangler.toml`](wrangler.toml) — clean URL routing, security headers, Stripe signed-webhook entitlements stored in R2 (`email-sig-photos`), opaque hosted image uploads (`/u/...`), on-demand PNG social icons (`/i/...`), saved signatures, published `/c/:slug` cards, team packs, `/api/brand`, and paid bulk/MCP/A2A endpoints.
- **Programmatic SEO & sitemap:** [`generate-pages.js`](generate-pages.js) (reads `datasets/*.json` and writes `seo/`, `email-signature-templates/`, `email-signature-templates.html`, `brand-extractor.html`) and [`update-sitemap.js`](update-sitemap.js) (writes `sitemap.xml`).

## Local development

Requires Node.js 22+ and Wrangler (`npx wrangler`).

```bash
npx wrangler dev --local
```

`wrangler dev --local` simulates R2 locally. To exercise Pro flows locally without production credentials, add a throwaway `PRO_SIGNING_SECRET` to `.dev.vars` (gitignored), mint a matching JWT, and open `/generator#token=...`.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run check` | Run the site contract and Worker regression validator (`scripts/validate-site.js`) |
| `npm run generate` | Regenerate programmatic SEO, template gallery, and brand extractor pages |
| `node generate-pages.js --check` | Verify generated pages match committed files without writing |
| `npm run sitemap` | Regenerate `sitemap.xml` from committed HTML pages |
| `npm run test:frontend` | Frontend accessibility and markup regression tests |
| `npm run test:templates` | Signature template output and escaping tests |
| `npm run test:builder` | Builder checkout recovery and paywall tests |
| `npm run test:worker` | Worker payment, auth, and input hardening tests |
| `npm run test:purchase-email` | Purchase confirmation email delivery and retry tests |
| `npm run test:brand` | Website brand extraction tests |
| `npm run test:team` | Team pack seat claiming and revocation tests |
| `npm run test:bulk` | Bulk CSV/XLSX, API, and MCP tests |
| `npm run test:agents` | Agent discovery, registration, and A2A tests |
| `npm run test:monitor` | Live-site monitor logic tests against committed fixtures |
| `npm run test:funnel` | Checkout funnel matching and API helper tests |
| `npm run test:automation` | Automation runner and email-payload safety tests |
| `npm run monitor` | Read-only check against the live production site |
| `npm run funnel` | Read-only Analytics Engine vs Stripe Checkout funnel report |

Additional standalone test files run in CI: `tests/export-search-console.test.js`, `tests/media-encoders.test.js`, `tests/health-check.test.js`, `tests/brand-tool.test.js`, `tests/connect-agent.test.js`, `tests/bulk-ui.test.js`.

## Documentation

- [`AGENTS.md`](AGENTS.md) — durable invariants, authority boundaries, and verification rules
- [`NEXT_STEPS.md`](NEXT_STEPS.md) — current architecture and operational status
- [`docs/runbooks.md`](docs/runbooks.md) — secret rotation (`PRO_SIGNING_SECRET`, Stripe webhook), rollbacks, purchase-email reconciliation, and Cloudflare/R2 outage triage
- [`docs/purchase-emails.md`](docs/purchase-emails.md) — purchase confirmation email design and activation checklist
