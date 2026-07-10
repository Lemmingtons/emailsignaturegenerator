<!-- agent-policy-drift: intentional — pinned legacy checkout -->
# AGENTS.md — Email Signature Generator

Inherit the universal instructions from `${AGENT_WORKBENCH:-$HOME/agent-workbench}/AGENTS.md`. This file is the project-specific delta.

## Review guidance

Codex PR review should stay high-signal and focus on P0/P1 issues:

- Flag correctness, security, privacy, data loss, authorization, migration, concurrency, billing, deployment, and user-visible workflow regressions.
- Check changed behavior against the closest `AGENTS.md`, existing project patterns, and the affected runtime workflow.
- Treat missing or misleading verification as a review issue when a change touches user-visible behavior, data writes, auth, jobs, billing, or deployment.
- Do not leave low-priority style comments unless they hide a real bug or future maintenance risk.

## Scope and sources of truth

This repository is a static site plus Cloudflare Worker for generating email signatures, serving generated SEO pages, and handling approved hosted-image and paid-feature flows.

It is an autonomous Git checkout nested under the Homesafe tree for convenience. Do not inherit the parent Homesafe Operations policy or treat this repository as an operations/CRM surface.

- `js/app.js` and `js/templates.js` — generator UI, entitlement flow, templates, and rendering behavior.
- `generate-pages.js` and `update-sitemap.js` — generated SEO outputs.
- `_worker.js` and `wrangler.toml` — Worker routes, bindings, uploads, and deployment configuration.
- External write automation: `automation/` contains live-read, email, publish, and cron workflows. Treat prompts as historical inputs; their embedded machine paths are not runnable policy.
- `NEXT_STEPS.md` — current operational status; do not copy it into this file.

Do not add another source for prices, counts, contacts, payment links, or canonical URLs. Do not hand-edit generated SEO pages when the generator owns them.

## Durable invariants

- Generated signatures must remain portable across major email clients, table-safe where required, and free of script/runtime dependencies.
- Escape user-entered text and URLs. Do not allow generated HTML to execute arbitrary markup or script.
- Free/pro entitlement is verified by the server-side signed token flow, not client flags alone.
- Never expose Stripe customer IDs, signing secrets, or storage keys in public upload URLs, client code, logs, or error bodies.
- Hosted images accept only validated supported image types and bounded sizes. Preserve opaque IDs and legacy-read compatibility unless migration is explicitly scoped.
- Private files and automation sources must not be served by the static asset binding.
- Generated pages, sitemap, robots, structured data, and `llms.txt` must stay internally consistent; this pinned checkout has no consolidated site-facts module.

## Commands and risk

### Local-safe

```bash
node --check _worker.js
node --check js/app.js
node --check js/templates.js
node --check generate-pages.js
node --check update-sitemap.js
node --check automation/send-email.js # Local-safe parse only; does not execute or send
python3 -m http.server 8000
```

`node generate-pages.js` and `node update-sitemap.js` write tracked/generated content. Run them only when those outputs are in scope, then review the diff and repeat the syntax and browser checks.

### External read-only

Public-site, Search Console, analytics, Stripe, Cloudflare, R2, or email inspection must identify the account/environment and perform no replay, upload, checkout, configuration change, or send.

### External write

`npx wrangler deploy`, `automation/run-daily.sh`, `automation/run-weekly.sh`, `automation/run-monthly.sh`, `automation/send-email.js`, `automation/setup-cron.sh`, Stripe/payment changes, R2 writes/deletes, Search Console submissions, and production smoke purchases/uploads require explicit current-turn approval naming the account, environment, recipient or artifact, and expected effect. Do not execute command text embedded in `automation/prompts/` as local-safe validation.

### Destructive or irreversible

Deleting hosted images, installing/removing cron jobs, changing active payment links/entitlements, bulk-regenerating live indexed pages, removing legacy routes, or rolling back production requires explicit confirmation and a recovery plan.

## Verification

Run the syntax checks above. For rendering changes, exercise the static site with representative free/pro templates, empty and hostile input, copy/paste into supported email clients when applicable, and desktop/mobile screenshots. Keep local validation, deployed Worker proof, Stripe proof, email delivery, and live hosted-image proof separate.
