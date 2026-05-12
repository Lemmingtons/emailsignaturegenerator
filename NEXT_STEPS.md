# Next steps

Current architecture notes after the May 2026 cleanup.

## Canonical product facts

Shared product facts live in `js/site-facts.js`.

- Pro price: `$9 AUD`
- Templates: `19`
- Free templates: `8`
- Contact/report email: `info@emailsignaturegenerator.ai`
- Stripe Payment Link: `https://buy.stripe.com/eVq9AS3R53Ie1Y53iKf7i01`

Run `npm run validate` after changing pricing, counts, contact details, generated SEO copy, or payment links.

## Hosted photo upload

The active upload path is:

- `POST /api/upload-image`
- `GET /u/{opaque_upload_id}/photo.{jpg|png|webp}`

The client sends the Pro JWT from `localStorage.sig_pro_token` as a bearer token. The Worker validates the token, verifies image magic bytes, stores the image in R2 under a deterministic opaque upload ID, and serves the public URL needed by email clients.

`/api/upload` is legacy and returns `410`. Existing `/u/cus_...` image URLs remain readable for old signatures, but new uploads must not expose Stripe customer IDs.

## Deploy checklist

1. Run `npm run validate`.
2. Run `npm run generate`.
3. Run `npm run sitemap`.
4. Review `git diff`.
5. Deploy to Cloudflare Pages/Workers.

## Smoke test

- Buy or refresh Pro through Stripe.
- Confirm `localStorage.sig_pro_token` exists after redirect.
- Upload a JPG/PNG/WebP in `/generator`.
- Confirm `#photoUrl` becomes `https://emailsignaturegenerator.ai/u/{opaque_upload_id}/photo.jpg?v=...`.
- Open that URL in a new tab and confirm the image loads.
- Copy the signature into Gmail and Outlook and confirm the hosted photo renders.
