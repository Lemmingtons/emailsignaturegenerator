# Purchase confirmation emails

Status: **dormant**. The code ships in `js/purchase-email.js`, but it stores nothing and calls no provider until it is activated below.

The Worker can send one transactional email containing a purchase access link, the purchased plan and amount, and a link to the official Stripe receipt. The access link is `https://emailsignaturegenerator.ai/api/verify-payment#session_id=…`. The checkout session id sits in the URL fragment, so email security scanners, click trackers and request logs never receive it; the page served at that address moves it into the normal redemption request in the buyer's browser. The link restores the buyer's paid access on another device, which is the only recovery path for someone who cleared storage or changed device. It does not restore an unsaved signature draft. Refunds and disputes block that access through the existing entitlement checks.

## Dormant until configured

`PURCHASE_EMAILS.handle` returns immediately unless all three are true:

- `PURCHASE_EMAILS_FROM` is set to a parseable ISO UTC timestamp;
- `RESEND_API_KEY` is set;
- `purchaseEmailFrom` in `js/site-facts.js` is a valid address.

With only one of the two secrets set, webhooks behave exactly as before: no purchase-email records, no provider call, no 503. If `PURCHASE_EMAILS_FROM` is set without a usable credential, `/api/health` reports `checks.purchaseEmails: false` and returns 503, so the uptime monitor alerts instead of buyers silently missing their email.

## Activation (owner, not yet done)

- Stripe account: Email Signature Generator. Keep the existing production webhook URL and its current events, and add `charge.succeeded`. Do not rotate the signing secret or change its API version.
- Cloudflare: Worker `emailsignaturegenerator`, R2 bucket `email-sig-photos`, in the production account.
- Resend: verify the sending domain `mail.emailsignaturegenerator.ai` and create a sending-only API key restricted to it. Disable link and open tracking for that domain: the email contains a private access link.
- `npx wrangler secret put RESEND_API_KEY`, then `npx wrangler secret put PURCHASE_EMAILS_FROM` with the ISO UTC activation time. Earlier Stripe events never send email, including automatic retries of historic purchases.
- Keep Stripe's separate automatic customer receipt emails off when using this combined confirmation, to avoid two purchase emails. The confirmation links to Stripe's receipt.
- The sender (`purchaseEmailFrom`) and reply-to (`supportEmail`) come from `js/site-facts.js`.

## Delivery and retry behavior

The signed checkout event creates paid access first. Checkout and charge events store separate private purchase and receipt records, supporting either arrival order. An email is sent only for an eligible, active, unrevoked purchase after both records exist and the charged currency and amount match.

R2 conditional writes lease one send at a time. The exact provider payload and one idempotency key are persisted before sending. Provider failures return HTTP 503 to Stripe, causing a webhook retry without blocking checkout redemption. A durable sent marker prevents later events from sending again.

Resend's idempotency window is 24 hours. An unconfirmed attempt older than 23 hours is blocked for manual reconciliation instead of risking a duplicate. Look for `purchase_email_delivery_failed` in Worker errors, inspect the associated Stripe event and private R2 delivery record, and check the provider's delivery log before retrying or marking an email sent. Do not delete a pending record or change its payload to force a resend.

Records under `entitlements/purchase-emails/` are private. They contain the checkout email, payment amount, plan, receipt/access details and provider status. They are not served as static assets or hosted images, and `js/purchase-email.js` is excluded from the static asset binding by `.assetsignore`. Never paste the records, receipt/access links, API keys or customer addresses into logs or issue descriptions.

## Verification

`node tests/purchase-email.test.mjs` exercises the composed signed webhook, record persistence, provider call and emailed-link redemption, using synthetic data and a stubbed email provider. It covers the dormant state, both event orders, plan and bulk access, provider failure, replay/concurrent delivery, delayed payments, activation cutoff, invalid inputs and refund/dispute revocation.

A controlled mailbox test is a separate production proof. It should use synthetic purchase data and the approved operator inbox; do not replay real buyers' events or send historical confirmations without separate authorization.
