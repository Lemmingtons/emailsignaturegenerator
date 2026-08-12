# AGENTS.md — Email Signature Generator

Inherit the universal instructions from `~/agent-workbench/AGENTS.md`.

## Scope and sources of truth

This repository is a static site plus Cloudflare Worker for generating email signatures, serving generated SEO pages, and handling approved hosted-image and paid-feature flows.

- `js/site-facts.js` — canonical product facts used by UI, generated content, and validation.
- `js/templates.js` and `js/generator-core.js` — signature templates and rendering behavior.
- `generate-pages.js` and `update-sitemap.js` — generated SEO outputs.
- `_worker.js` and `wrangler.toml` — Worker routes, bindings, uploads, and deployment configuration.
- `scripts/validate-site.js` — local contract and regression gate.
- `NEXT_STEPS.md` — current operational status; do not copy it into this file.

Do not add another source for prices, counts, contacts, payment links, or canonical URLs. Do not hand-edit generated SEO pages when the generator owns them.

## Durable invariants

- Generated signatures must remain portable across major email clients, table-safe where required, and free of script/runtime dependencies.
- Escape user-entered text and URLs. Do not allow generated HTML to execute arbitrary markup or script.
- Free/pro entitlement is verified by the server-side signed token flow, not client flags alone.
- Never expose Stripe customer IDs, signing secrets, or storage keys in public upload URLs, client code, logs, or error bodies.
- Hosted images accept only validated supported image types and bounded sizes. Preserve opaque IDs and legacy-read compatibility unless migration is explicitly scoped.
- Private files and automation sources must not be served by the static asset binding.
- Generated pages, sitemap, robots, structured data, and `llms.txt` must stay consistent with `js/site-facts.js`.

## Commands and risk

### Local-safe

```bash
npm run check
npm run generate
npm run sitemap
```

`generate` and `sitemap` write tracked/generated content. Run them only when those outputs are in scope, then review the diff and rerun `npm run check`.

### External read-only

Public-site, Search Console, analytics, Stripe, Cloudflare, R2, or email inspection must identify the account/environment and perform no replay, upload, checkout, configuration change, or send.

### External write

`npx wrangler deploy`, any automation run with `DEPLOY_AFTER=1`, `automation/send-email.js`, Stripe/payment changes, R2 writes/deletes, Search Console submissions, and production smoke purchases/uploads require explicit current-turn approval naming the account, environment, recipient or artifact, and expected effect.

### Destructive or irreversible

Deleting hosted images, changing active payment links/entitlements, bulk-regenerating live indexed pages, removing legacy routes, or rolling back production requires explicit confirmation and a recovery plan.

## Verification

Run the smallest check covering the change; use `npm run check` when generator, template, shared facts, or generated pages changed. For rendering changes, exercise the affected template and relevant empty/hostile inputs. Test copy/paste in email clients only when portable markup changed, and capture desktop/mobile screenshots only when visual judgment matters. Keep local validation, deployed Worker proof, Stripe proof, email delivery, and live hosted-image proof separate.
