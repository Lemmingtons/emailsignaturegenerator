# Operational Runbooks

Operational procedures for `emailsignaturegenerator.ai` (Cloudflare Worker `emailsignaturegenerator`, R2 bucket `email-sig-photos`, Stripe live account).

All external writes, secret rotations, R2 mutations, and production rollbacks require explicit operator approval before execution.

---

## 1. `PRO_SIGNING_SECRET` — Key-Derivation Coupling & Rotation

> **WARNING: DO NOT rotate `PRO_SIGNING_SECRET` in place.**

`PRO_SIGNING_SECRET` is not only a JWT signing secret. The Worker also uses it as the HMAC-SHA256 key to derive deterministic R2 storage paths and public identifiers across six subsystems:

| Helper | Location | Derivation | What breaks if rotated in place |
| --- | --- | --- | --- |
| `entitlementId` | `_worker.js` | `ent_` + `HMAC("stripe-entitlement:" + paymentIntentId)` | Stripe refund/dispute webhooks derive a new ID and fail to revoke existing purchases; active entitlement lookups (`entitlements/active/<id>.json`) miss. |
| `checkoutSessionStorageId` | `_worker.js` | `HMAC("stripe-checkout-session:" + sessionId)` | `/api/verify-payment` and emailed purchase access links fail to locate `entitlements/checkout-sessions/<id>.json`. |
| `publicUploadId` | `_worker.js` | `HMAC("upload-public-url:" + sub).slice(0, 32)` | New uploads write to a different `users/<uploadId>/` folder; existing `/u/<uploadId>/...` URLs embedded in sent emails remain immutable on R2, creating split storage per buyer. |
| `cardOwnerPrefix` | `_worker.js` | `card-owners/<publicUploadId>/` & `card-quota/<publicUploadId>.json` | Existing buyers lose ownership checks and quota tracking on published `/c/<slug>` cards. |
| `teamIdFor` | `_worker.js` | `HMAC("team:" + sub)` | Existing team share links (`/generator?team=<id>`) and `teams/<id>.json` become unreachable from the buyer's token. |
| `bulkAccess.identity` | `js/bulk-access.js` | `HMAC("bulk-api-owner:" + sub)` and JWT key `signature-bulk-api-v1:<secret>` | Existing bulk API/MCP keys (`esg_bulk_...`) and `bulk-api/access/<id>.json` stop authenticating. |

In addition, every issued Pro token, team-member token, and bulk API key is signed with `PRO_SIGNING_SECRET` (or a domain-separated derivative of it) and has lifetime validity checked against R2. Replacing `PRO_SIGNING_SECRET` immediately invalidates every active buyer's browser token and access link.

### Dual-key migration strategy (when rotation is required)

Only rotate `PRO_SIGNING_SECRET` if compromise is suspected or required by incident response, and always via a code-deployed dual-key migration:

1. **Decouple signing from storage derivation in code first.**
   - Introduce a new secret for new JWT signatures (e.g., `PRO_JWT_SIGNING_SECRET`) while keeping the existing secret bound as `PRO_SIGNING_SECRET_PREVIOUS` (or dedicated storage-derivation key `PRO_STORAGE_HMAC_SECRET`).
   - Update `verifyJwt` / `verifyProAccess` and `js/bulk-access.js` to accept tokens verified by the new key first, falling back to the previous key.
2. **Preserve storage-key lookups during transition.**
   - Keep `entitlementId`, `checkoutSessionStorageId`, `publicUploadId`, `cardOwnerPrefix`, `teamIdFor`, and `bulkAccess.identity` reading under the original derivation key until all live records are migrated — or check new derivation first, then fall back to the previous derivation for reads and revocations.
   - Never delete or move existing `users/<uploadId>/*` objects: those `/u/...` URLs sit permanently inside recipients' email inboxes.
3. **Deploy the dual-key code via `main` (CI green) before changing secrets.**
   - Add the new secret with `npx wrangler secret put ...` while keeping the old secret intact.
   - Confirm `GET /api/health` returns `200` and verify existing Pro tokens, team links, and Stripe webhooks still pass.
4. **Migrate or re-issue affected state if the old key was compromised.**
   - Re-key R2 records (`entitlements/`, `teams/`, `card-owners/`, `card-quota/`, `bulk-api/access/`) offline/scripted with explicit operator approval and backup verification.
   - Only remove the previous signing key once compromised tokens must be invalidated and buyers have a recovery path via `/api/verify-payment` or support.

---

## 2. Stripe Webhook Secret Rotation (`STRIPE_WEBHOOK_SECRET`)

`verifyStripeWebhookSignature` in `_worker.js` checks every `v1=` signature present in the `Stripe-Signature` header (with a 300-second timestamp tolerance).

1. Open the **Stripe Dashboard** (live account: *Email Signature Generator*) → **Developers → Webhooks** → production endpoint (`https://emailsignaturegenerator.ai/api/stripe-webhook`).
2. Confirm the endpoint remains subscribed to:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `charge.refunded`
   - `charge.dispute.created`
   - `charge.dispute.closed`
   - `charge.succeeded` (required when purchase confirmation emails are active)
3. Click **Roll secret** and choose a non-zero overlap window (e.g., 1–24 hours) so Stripe signs requests with both the old and new `v1=` secrets during the cutover.
4. Update the Worker secret:
   ```bash
   npx wrangler secret put STRIPE_WEBHOOK_SECRET
   ```
5. Verify immediately:
   - `GET https://emailsignaturegenerator.ai/api/health` returns `200` with `checks.webhook: true`.
   - Check Cloudflare Workers Logs for any `webhook_signature_rejected` events.
   - Check Stripe Dashboard → Webhooks → Recent deliveries for `200` responses.
6. After confirming live deliveries succeed with the new secret, expire the old secret in Stripe (or let the overlap window close).

---

## 3. Production Rollback Procedure

Production deploys automatically via **Cloudflare Workers Builds** on every merge to `main`.

### Immediate rollback (Cloudflare Dashboard)

1. Open **Cloudflare Dashboard** (production account) → **Workers & Pages** → `emailsignaturegenerator` → **Deployments** tab.
2. Locate the last known-good deployment version and click **Rollback**.
   - Rollback restores Worker code and static assets immediately.
   - Rollback does **not** revert R2 objects, Cloudflare secrets, or Stripe configuration.
3. Verify recovery:
   - `GET https://emailsignaturegenerator.ai/api/health` returns `200` (`{ "ok": true, ... }`).
   - Run read-only `node scripts/monitor-site.js`.

### Follow-up in Git (mandatory)

Workers Builds redeploys `main` on the next merge, which would re-introduce the broken commit if left on `main`:

1. Open a revert PR against `main` (`git revert <bad-commit>`).
2. Confirm `.github/workflows/ci.yml` is green.
3. Merge the revert PR and re-verify `/api/health` and `node scripts/monitor-site.js`.

---

## 4. Purchase-Email Reconciliation (>23 h Resend Window)

See [`docs/purchase-emails.md`](purchase-emails.md) for the delivery state machine and activation checklist.

Resend's idempotency window is 24 hours. To prevent duplicate emails, `js/purchase-email.js` refuses automatic retries once an unconfirmed delivery attempt is older than 23 hours (`PurchaseEmailNeedsReconciliation`), logs a structured error without PII, and returns `200` to stop blind Stripe retries.

### Reconciliation steps

1. **Locate the failure in Workers Logs.**
   - Filter for `purchase_email_error` or `purchase_email_delivery_failed`.
   - Record `eventId`, `eventType`, `reason`, and `providerStatus`.
2. **Check Stripe.**
   - Look up `eventId` in Stripe Dashboard → Developers → Events.
   - Verify the checkout session completed, currency/amount match, and no full refund or open dispute exists.
3. **Inspect private R2 state** (read-only first; never paste email addresses, session IDs, or access links into logs or issues):
   - Prefix: `entitlements/purchase-emails/<entitlementId>/`
   - Check `delivery.json` (status, `idempotencyKey`, `attemptedAt`, `providerId`, `lastError`), plus `purchase.json` and `receipt.json` if still present.
4. **Check Resend delivery logs.**
   - Search Resend's dashboard by the recorded `idempotencyKey` or timestamp.
   - **If Resend accepted/delivered the email:** do not resend. Update `delivery.json` to mark delivery complete so no future event retries it.
   - **If Resend never accepted the email:** do **not** delete `delivery.json` or mutate its payload to trigger a blind webhook replay. Either send a manual confirmation/recovery link to the buyer from support (`info@emailsignaturegenerator.ai`) with explicit operator approval, or perform a controlled one-off reconciliation after confirming the buyer's entitlement is still active.

---

## 5. Cloudflare / R2 Outage Triage

### Symptoms

- `/api/health` returns `503` with `checks.storage: false` (`bucket.head('health/probe')` failed) or `checks.rateLimit: false`.
- Hourly GitHub Actions site monitor (`.github/workflows/monitor.yml`) goes red.
- Workers Logs report `unhandled_error`, `api_error` (`500`/`503`), or `health_failed`.
- Stripe reports webhook delivery failures (`5xx`).

### Triage steps

1. **Confirm platform status:** check [Cloudflare Status](https://www.cloudflarestatus.com/) for Workers, R2, and Rate Limiting incidents.
2. **Assess customer impact:**
   - Public static pages and browser-side signature preview continue to work if `ASSETS` is healthy.
   - Pro endpoints (`/api/verify-payment`, `/api/verify-token`, `/api/upload-image`, `/api/signature`, `/api/card`, `/api/team`, `/api/v1/*`, `/u/*`) require R2 and fail closed.
   - **Payments are not lost:** Stripe retries `5xx` webhook deliveries automatically for up to 3 days, and `/api/verify-payment` serves a `202` retry page ("Confirming your payment…") telling buyers not to pay again.
3. **Do not make destructive changes during an upstream incident.**
   - Do not delete R2 objects, rotate secrets, or deploy speculative workarounds while R2/Workers are degraded.
4. **Post-recovery verification:**
   - Confirm `GET https://emailsignaturegenerator.ai/api/health` returns `200` with all checks `true`.
   - Run read-only `node scripts/monitor-site.js`.
   - Inspect Stripe Dashboard → Developers → Webhooks → Failed deliveries and trigger retries for any events that exhausted automatic retry during an extended outage.
