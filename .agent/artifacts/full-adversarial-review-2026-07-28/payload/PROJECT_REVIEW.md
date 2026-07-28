# Full adversarial project review, repair and verification

Review date: 28 July 2026 (UTC)  
Repository: `Lemmingtons/emailsignaturegenerator`  
Baseline: `main` at `a015eff`

## 1. Executive summary

### Outcome

The project was functional and had a strong Node/Worker validation script, but it was not ready for an unattended release. The review confirmed high-risk scheduled publishing behavior, missing production upload throttling, public access to internal repository files, permissive paid-token expiry checks, an administrative email injection weakness, and several keyboard/screen-reader barriers in the generator.

All confirmed repository-level issues were repaired and retested. The final code passes the project validator, new automation and accessibility regression suites, JavaScript and shell syntax checks, a Cloudflare deployment dry run, independent review, route reconciliation, real-browser interaction, keyboard checks, responsive checks, and public-preview verification.

**Launch recommendation: Ready after minor fixes.** No Critical or unresolved High code finding remains. Before production release, complete the external acceptance checks listed in section 9: a real Stripe test purchase/refund state, a real Cloudflare upload/rate-limit check, Gmail/Outlook paste tests, and an approved test email. These require live services or customer-visible writes and were intentionally not performed.

### Scores

- **Pre-repair: 5.5/10.** Core generation and Worker tests passed, but internal files were served publicly, one scheduled task published by default, upload throttling was not configured, permanent signed tokens were accepted, and core accessibility behavior was incomplete.
- **Post-repair: 8.5/10.** Confirmed repository defects are fixed with regression coverage and independent review. The remaining 1.5 points reflect unperformed live payment, email-client, deployment, and external-service acceptance rather than known failing code.

### Most serious findings and repairs

- Scheduled weekly content work could deploy automatically; scheduled work is now read/write-safe by default, and email/deploy actions require explicit approval gates.
- Production upload throttling existed only as an optional code path; a native Cloudflare rate-limit binding is now configured and enforced.
- Internal files such as `AGENTS.md`, `.gitignore`, and a generated lockfile were publicly reachable; static delivery now uses a public allowlist and Worker-first asset handling.
- Signed Pro tokens without an expiry were accepted indefinitely; a finite future expiry is now mandatory.
- The photo crop dialog allowed keyboard focus to escape and did not support Escape/focus restoration; it now implements full keyboard modal behavior.

### Blocked or external-only areas

- Real Stripe purchase, refund/dispute, and entitlement-revocation behavior.
- Production Cloudflare deployment, R2 lifecycle state, and real upload-rate behavior.
- Real Resend delivery and email rendering.
- Copy/paste rendering in Gmail, Outlook, Apple Mail, Yahoo Mail, and Microsoft 365.
- Search Console, analytics, live cache behavior, and production monitoring.

The older vault overview says $5, 18 templates, and three free templates. It is stale. Current source-of-truth code and runtime show $9 AUD, 24 templates, and eight free templates.

## 2. Application inventory and coverage matrix

### Product and users

The product is a static email-signature builder with a Cloudflare Worker. It serves anonymous/free builders, paid Pro customers identified by a signed token, and public recipients who view card pages or hosted assets. There is no account registration, password login, administrator screen, tenant model, relational database, subscription-management screen, or native mobile app.

Primary workflows:

1. Discover the product through home, blog, examples, or generated SEO pages.
2. Build and preview a signature with 24 templates.
3. Validate an existing signature through the health checker.
4. Purchase Pro through Stripe and receive a signed entitlement token.
5. Upload hosted photo/logo/CTA/divider assets.
6. Copy HTML/plain text, save an edit link, or restore a saved signature.
7. Publish, update, view, download, or unpublish a public contact card.
8. Run daily, weekly, and monthly operational automation.

### Route inventory

- Core screens: home, generator, examples, health checker, privacy, blog index, four blog articles, and Google verification.
- Generated pages: 54 files under `seo/`, sharing role, industry, platform, and checker families.
- Dynamic Worker routes: public cards, vCards, hosted images, generated icons, and card sitemap.
- APIs: payment verification, token verification, image upload, saved signatures, card create/delete, and legacy compatibility routes.
- Sitemap: 64 unique URLs; all 64 returned HTTP 200 in final local Worker reconciliation.
- Additional unique pages and expected failures were checked: blog index/articles and verification returned 200; missing routes and `test.html` returned 404.

### Coverage matrix

| Area | Items identified | Tested | Initially passed | Initially failed | Repaired | Verified | Blocked | Final coverage |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Sitemap routes | 64 | 64 | 64 | 0 | 0 | 64 | 0 | 100% |
| Unique screen/page families | 8 | 8 | 8 | 0 | 0 | 8 | 0 | 100% |
| Dynamic/public route families | 5 | 5 | 5 | 0 | 0 | 5 | 0 | 100% local |
| API endpoint families | 8 | 8 | 5 | 3 | 3 | 8 | 0 | 100% local/mocked |
| Generator component families | 17 | 17 | 12 | 5 | 5 | 17 | 0 | 100% |
| Forms | 2 | 2 | 2 | 0 | 0 | 2 | 0 | 100% |
| Fixed user-facing field groups | 28 | 28 | 27 | 1 | 1 | 28 | 0 | 100% |
| Buttons/control groups | 14 | 14 | 9 | 5 | 5 | 14 | 0 | 100% |
| Links/navigation families | 8 | 8 | 8 | 0 | 0 | 8 | 0 | 100% |
| Major user flows | 9 | 9 | 6 | 3 | 3 | 9 | 4 external acceptance checks | 100% local |
| Access levels | 3 | 3 | 3 | 0 | 0 | 3 | 0 | 100% simulated/local |
| Responsive widths | 8 | 8 | 8 | 0 | 0 | 8 | 0 | 100% overflow check |
| Accessibility check groups | 12 | 12 | 7 | 5 | 5 | 12 | 0 | 100% |
| Automated test suites/checks | 3 | 3 | 1 | 2 missing | 2 added | 3 | 0 | 100% final |

Responsive widths checked against the real generator: 320, 375, 390, 430, 768, 1024, 1280, and 1440 pixels. None had horizontal overflow. Detailed screenshots were captured at mobile and desktop sizes. Portrait and landscape dimensions were included. Browser zoom/system-font behavior was assessed through responsive layout and scalable CSS review; no native mobile keyboard or notched physical device was available.

## 3. Issue register

No Critical issue was confirmed.

### High

#### OPS-001 — Weekly scheduled work deployed by default

- **Confidence:** High
- **Affected:** `automation/run-weekly.sh`, `automation/run-task.sh`, `automation/setup-cron.sh`
- **Reproduction:** Run the weekly wrapper without `DEPLOY_AFTER`; it previously set `DEPLOY_AFTER=1` and invoked Wrangler after generated content work.
- **Impact:** Unreviewed AI-generated content could be published to production.
- **Root cause:** The weekly wrapper overrode the safe runner default.
- **Repair:** Default email and deployment to off. External writes require `ALLOW_EXTERNAL_WRITES=1`; deployment additionally requires an exact approved HEAD, a completely clean checkout, and passing validation.
- **Regression:** `automation/test-automation.sh` covers default, approval, dirty-tree, mismatched-commit, failed-agent, missing-report, empty-report, and failed-validation paths using fakes only.
- **Status:** Fixed and verified.

#### SEC-001 — Production upload rate limiting was not configured

- **Confidence:** High
- **Affected:** `_worker.js`, `wrangler.toml`, `NEXT_STEPS.md`
- **Reproduction:** The Worker only limited uploads when an optional binding existed, while the committed binding was commented out.
- **Impact:** A stolen or shared paid token could drive repeated Worker/R2 usage and cost.
- **Root cause:** An optional KV path was documented as active without deployment configuration.
- **Repair:** Configure Cloudflare's native rate limiter at 25 requests per 60 seconds and fail closed if it is missing, unavailable, or malformed.
- **Regression:** Worker behavior checks cover allowed, exhausted, missing, throwing, malformed, and customer-key paths. Wrangler dry run resolves the binding.
- **Status:** Fixed and verified.

#### A11Y-001 — Photo crop dialog was not keyboard-safe

- **Confidence:** High
- **Affected:** `generator.html`, `js/app.js`, `css/styles.css`
- **Reproduction:** Open the crop dialog by keyboard, press Tab repeatedly or Escape.
- **Impact:** Keyboard and assistive-technology users could leave the modal, could not dismiss it with Escape, and lost their return point.
- **Root cause:** Visual modal styling lacked dialog lifecycle behavior.
- **Repair:** Add labelled title/description, initial focus, Tab/Shift+Tab containment, Escape dismissal, hidden-state guard, and focus restoration.
- **Regression:** Frontend accessibility checks plus real-browser upload, Escape, and focus-restoration test.
- **Status:** Fixed and verified.

### Medium

#### SEC-002 — Internal repository files were publicly served

- **Evidence:** Local Worker returned 200 for `AGENTS.md`, `.gitignore`, and a generated `package-lock.json`. A harmless `/.dev.vars` marker probe returned 404, so no secret disclosure was claimed.
- **Impact:** Internal project guidance and repository metadata were exposed, and future files could be exposed by omission.
- **Root cause:** Static serving used a growing private-path denylist.
- **Repair:** Replace it with a public static allowlist, run the Worker before assets, restrict methods, and expand `.assetsignore`.
- **Regression:** Public routes/assets return 200; source/config/internal/hidden paths return 404 before reaching the asset binding.
- **Status:** Fixed and verified.

#### SEC-003 — Tokens without a valid expiry were accepted

- **Evidence:** `verifyJwt` only rejected expiry when a truthy `exp` was present.
- **Impact:** Accidentally issued signed tokens without `exp` could remain valid indefinitely.
- **Repair:** Require a finite numeric future expiry and remove raw exception detail from token-verification errors.
- **Regression:** Missing, string, null, malformed, expired, and valid expiry cases.
- **Status:** Fixed and verified.

#### SEC-004 — Email report subject allowed HTML/control-character injection

- **Evidence:** Command-line subject text was interpolated directly into the HTML heading.
- **Impact:** Administrative reports could contain injected markup or unsafe header control characters.
- **Repair:** Normalize CR/LF, limit length, and HTML-escape display text. Fixed task-to-subject mapping prevents prompt-controlled subjects.
- **Regression:** Special-character, CR/LF, and overlength payload tests with a fake request layer.
- **Status:** Fixed and verified.

#### OPS-002 — Automation prompts referenced a stale workstation path

- **Impact:** Scheduled agents could inspect or write the wrong directory.
- **Repair:** Inject the runner's resolved repository and report path; prompts declare the current directory authoritative and prohibit external writes.
- **Status:** Fixed and verified.

#### OPS-003 — Automation did not mechanically validate its output

- **Impact:** A successful agent exit could be treated as completion despite a missing/empty report; an approved deployment lacked a strong review boundary.
- **Repair:** Map exact reports, require non-empty output, validate before deployment, and require an approved exact clean commit.
- **Status:** Fixed and verified.

#### OPS-004 — Repository-local reports blocked approved deployment

- **Impact:** Normal cron output dirtied the checkout and made the clean-reviewed-commit gate unusable.
- **Repair:** Store reports under `$XDG_STATE_HOME/emailsignaturegenerator` or `$HOME/.local/state/emailsignaturegenerator`, while respecting explicit `REPORT_DIR`.
- **Status:** Fixed and verified.

#### A11Y-002 — Dynamic success/error feedback was not announced

- **Affected:** copy, save, upload, card, and export status regions.
- **Repair:** Add live status semantics and assertive error announcements through a shared helper.
- **Status:** Fixed and verified.

#### A11Y-003 — Validation errors were not associated with fields

- **Repair:** Add `aria-describedby`, synchronize `aria-invalid`, and use alert semantics for active errors.
- **Status:** Fixed and verified with invalid/corrected email and hostile URL tests.

#### A11Y-004 — Template/category ARIA patterns were incomplete

- **Repair:** Use grouped native buttons with `aria-pressed` instead of incomplete tab/listbox roles.
- **Status:** Fixed and verified through the accessibility tree and Creative-filter interaction.

#### A11Y-005 — Auto-rotating carousel had no persistent pause

- **Repair:** Add Pause/Play control, safe timer lifecycle, reduced-motion behavior, inert hidden slides, and accessible selected states.
- **Status:** Fixed and verified.

#### A11Y-006 — Play state initially did not restart while focused

- **Discovery:** Independent review after the first repair found that focus-based pause overrode explicit Play.
- **Repair:** Explicit Play can override current hover/focus pause; ordinary hover/focus still pauses.
- **Status:** Fixed and independently re-reviewed.

### Low

No separate Low-severity defect was confirmed. Minor visual/style hypotheses were not recorded as issues without reproduction.

## 4. User-flow results

| Flow | Initial result | Problems and repairs | Edge/failure cases | Final result |
|---|---|---|---|---|
| Discover/browse | Passed | No confirmed route or navigation break | 64 sitemap URLs, blog families, clean URLs, 404s | Passed |
| Build/preview | Passed | Corrected control semantics and error associations | Empty, invalid URL/email, Unicode, hostile markup, category filtering | Passed |
| Copy/export | Functional but inaccessible feedback | Live status/error semantics added | Free-user Pro gate, clipboard status, hostile content | Passed locally |
| Crop/upload preview | Keyboard failure | Full modal focus lifecycle added | Escape, focus return, sample image, mobile layout | Passed |
| Purchase/entitlement | Local logic passed | Strict expiry; raw errors removed | Missing/malformed/expired/valid tokens | Passed locally; live Stripe blocked |
| Hosted upload | Throttle absent | Native Cloudflare limiter configured | Auth, type, size, slots, missing/failed limiter | Passed local/dry-run; live R2 blocked |
| Save/restore | Passed | No confirmed defect | Invalid JSON/size/not-found/cache behavior | Passed Worker tests; cross-device live check blocked |
| Public card/vCard | Passed | No confirmed defect | Ownership, hostile fields, URLs, create/update/delete, sitemap pagination | Passed Worker tests |
| Scheduled operations | Unsafe defaults | Explicit write gates, exact approved commit, external state directory | Agent/report/validation failure, dirty tree, email/deploy gates | Passed fake-only tests |

## 5. UI and UX repairs

### Visual design and layout

The existing visual system was preserved. Changes were limited to controls needed for accessibility and clarity. Mobile and desktop screenshots show no clipping, overlap, or horizontal scrolling.

### Responsive behavior

The generator remained visible and overflow-free at all eight required widths. Detailed mobile testing at 390×844 covered the filled preview, export controls, guides, mobile navigation actions, and crop dialog. Desktop testing covered the two-column preview dock and complete control hierarchy.

### Navigation and interactions

- Template categories and cards now expose their pressed state through correct native-button semantics.
- Carousel controls correctly pause, play, move next/previous, wrap, hide inactive slides, and honor reduced motion.
- Browser console and page-error checks were empty after final interaction tests.

### Forms and content

- Field errors identify the exact problem and are programmatically connected.
- Hostile markup and Unicode remain text, with no executable script/image injection.
- Operational prompts now use current paths and plain, explicit safety language.

### Accessibility

- Crop dialog focus containment, Escape, and restoration are verified.
- Dynamic status and error changes are announced.
- Selected states are available without relying only on color.
- Keyboard navigation and visible focus were exercised in real browser flows.

## 6. Technical repairs

### Frontend

Added modal lifecycle helpers, live-status handling, correct field accessibility state, native grouped-button semantics, carousel controls, hidden-slide isolation, and regression checks.

### Backend/APIs/security

Added a fail-closed public asset policy, Worker-first asset routing, mandatory JWT expiry, generic server errors, native request throttling, and expanded behavioral checks. Existing card ownership, hostile-input escaping, image magic-byte checks, upload size caps, opaque IDs, and no-store saved-signature behavior continued to pass.

### Database/data

No relational database or migrations exist. R2 object operations were tested through the Worker harness, including images, signatures, cards, ownership, deletion, and sitemap pagination.

### Performance/reliability

A public-preview navigation sample recorded approximately 309 ms to DOMContentLoaded, 384 ms to load, 18 resource entries, about 70 KB transferred for resources, and no observed long tasks. These sandbox figures are indicative, not production Core Web Vitals. No meaningful performance regression was found.

### Architecture/automation

Scheduled output is now mechanically validated and kept outside the checkout. External writes are off by default and require explicit approval. Deployment is tied to a reviewed exact commit and clean checkout.

### Automated tests

- Existing `scripts/validate-site.js` expanded for asset policy, JWT, and rate limiting.
- Added `automation/test-automation.sh` with fake tools only.
- Added `tests/frontend-accessibility.test.js` for durable semantic contracts.

## 7. Files changed

| File | Purpose | Issues | Coverage |
|---|---|---|---|
| `.assetsignore` | Exclude internal/raw files from static assets | SEC-002 | Worker validation/public probe |
| `NEXT_STEPS.md` | Correct active limiter description | SEC-001 | Documentation assertion/manual review |
| `_worker.js` | Public allowlist, strict expiry, generic errors, native limiter | SEC-001/002/003 | `npm run check`, API probes |
| `wrangler.toml` | Worker-first assets and native limiter binding | SEC-001/002 | Wrangler dry run, validator |
| `scripts/validate-site.js` | Worker security/API regression expansion | SEC-001/002/003 | `npm run check` |
| `automation/run-task.sh` | Output validation and external-write gates | OPS-001/003/004 | automation suite |
| `automation/run-weekly.sh` | Safe default | OPS-001 | automation suite |
| `automation/setup-cron.sh` | Explicit safe flags/external state directory | OPS-001/004 | automation suite |
| `automation/send-email.js` | Subject normalization/escaping | SEC-004 | automation suite |
| `automation/prompts/*.txt` | Current paths and no-write contract | OPS-001/002/003/004 | automation suite |
| `automation/test-automation.sh` | Fake-only operational regression coverage | OPS/SEC findings | direct execution |
| `generator.html` | Dialog labels, live regions, field relationships, native groups | A11Y-001/002/003/004 | frontend suite/browser |
| `js/app.js` | Modal, live status, invalid state, pressed state | A11Y-001/002/003/004 | frontend suite/browser |
| `index.html` | Pause/Play carousel and accessible slide state | A11Y-005/006 | frontend suite/browser |
| `css/styles.css` | Modal heading and carousel control styling | A11Y-001/005 | screenshots/browser |
| `tests/frontend-accessibility.test.js` | Frontend semantic regression checks | A11Y findings | direct execution |
| `package.json` | Expose frontend/automation test commands | Test coverage | npm scripts |
| `.agent/artifacts/full-adversarial-review-2026-07-28/` | Reviewer-ready report and exact evidence | Handoff | checksums/manifest |

## 8. Commands and checks run

| Command/check | Final result |
|---|---|
| `npm install` | Passed; zero package vulnerabilities; generated lockfile was not retained |
| `npm audit --json` | Zero vulnerabilities |
| `npm run check` | Passed: `Validation passed` |
| `npm run test:automation` | Passed; fake-only, no external send/deploy |
| `npm run test:frontend` | Passed |
| Node syntax checks for Worker, generators, browser scripts, tests, and automation | Passed |
| `bash -n automation/*.sh` | Passed |
| `git diff --check` | Passed |
| `npx --yes wrangler deploy --dry-run` | Passed; assets, R2, and rate-limit bindings resolved; no deploy |
| Local Wrangler route/API tests | Passed |
| 64-URL sitemap reconciliation | 64/64 HTTP 200 |
| Public/private static path probes | Intended public 200; internal/source paths 404 |
| Browser automation: generator and landing page | Passed |
| Keyboard crop dialog and carousel flows | Passed |
| Responsive checks at 320/375/390/430/768/1024/1280/1440 | Passed, no horizontal overflow |
| Browser console and page errors | Empty in final flows |
| Independent code review | No remaining actionable findings |
| Simplification review | One redundant timer clear removed; no other meaningful simplification |

One early public-preview attempt returned 502 and showed an upstream-error page. It was not counted as application evidence. The server/tunnel was restarted and the final public URL returned 200 for home and generator, rendered the real app, and passed browser checks.

## 9. Remaining blocked or unresolved work

### Live Stripe acceptance

- **Why blocked:** Requires a real payment or approved Stripe test environment and external API access.
- **Completed:** Local payment/token logic, strict expiry, error paths, and entitlement-protected endpoints.
- **Needed:** Approved account/environment and a test session covering paid, unpaid, refunded/disputed, and expired entitlement behavior.
- **Risk:** Payment-provider configuration may differ from repository assumptions.
- **Next action:** Perform an approved Stripe test purchase and verify token issuance, refresh, refund/dispute handling, and all paid endpoints.

### Production Cloudflare/R2 acceptance

- **Why blocked:** Deployment and R2 writes are external/customer-visible actions requiring explicit approval.
- **Completed:** Local Worker tests and deployment dry run, including native limiter binding resolution.
- **Needed:** Approved production deployment and named smoke-test artifacts.
- **Risk:** Production bindings, lifecycle policies, or cache behavior may differ.
- **Next action:** Deploy under approval, perform one bounded image upload per slot, confirm rate limiting/cache headers, and check R2 lifecycle rules.

### Real email-client rendering

- **Why blocked:** Gmail/Outlook/Apple/Yahoo paste testing requires external accounts/clients.
- **Completed:** Table-safe/export invariants, hostile input, hosted image rules, and browser preview.
- **Needed:** Test mailboxes/clients and permission to send test messages.
- **Risk:** Client-specific HTML transformations cannot be proven by browser preview.
- **Next action:** Paste representative free/Pro templates into Gmail and desktop Outlook, send test messages, and inspect desktop/mobile/dark mode/image blocking.

### Resend delivery

- **Why blocked:** Sending email is an external write requiring named approval and recipient.
- **Completed:** Subject safety and fake transport tests.
- **Needed:** Approved recipient/environment and one test report.
- **Risk:** Domain, sender, or rendering configuration may fail despite local payload correctness.
- **Next action:** Send one approved non-sensitive report and verify receipt/rendering.

## 10. Final launch recommendation

**Ready after minor fixes.** The repository is reviewer-ready and no known Critical or High code issue remains. Treat the four external acceptance checks above as release gates. If production must launch without those checks, the recommendation becomes “Not ready until remaining high-priority issues are resolved” because payment, live uploads, and email-client rendering are central customer outcomes that local tests cannot prove.
