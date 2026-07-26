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

## Hosted image upload

The active upload path is:

- `POST /api/upload-image` with `X-Image-Type: photo` or `logo`
- `GET /u/{opaque_upload_id}/{photo|logo}.{jpg|png|webp|gif}`

The client sends the Pro JWT from `localStorage.sig_pro_token` as a bearer token. The Worker validates the token, verifies image magic bytes, stores the image in R2 under a deterministic opaque upload ID, and serves the public URL needed by email clients.

Each slot holds at most one file: uploading a new extension into a slot evicts the old one, but `photo` and `logo` are independent. Size cap is 3 MB; rate limit is 25 uploads per hour per customer.

`/api/upload` is legacy and returns `410`. Existing `/u/cus_...` image URLs remain readable for old signatures, but new uploads must not expose Stripe customer IDs.

## Animated photos

Pro users can render the photo as an animated GIF via `js/photo-animator.js` (effects) and `js/gif-encoder.js` (a self-contained GIF89a writer). Encoding happens in the browser off the existing crop canvas — nothing is rendered server-side.

Three effects: `sweep`, `ring`, `crossfade`. Output is 160x160, plays once, and typically lands between 15 KB and 100 KB.

Two invariants that must not regress:

- **Frame 0 is the resting photo.** Classic Outlook on Windows renders only the first frame, so every effect is additive over an already-legible image. Never add an effect that fades in from blank.
- **Error-diffusion dithering stays off for animation.** It propagates change across the whole frame, which defeats inter-frame differencing and roughly triples file size.

## R2 lifecycle rules

Applied to the `email-sig-photos` bucket:

| Prefix | Rule |
| --- | --- |
| `users/` | **No expiry.** Deliberate — these images are referenced by signatures already sitting in other people's inboxes, so expiring them would break sent mail. Growth is bounded at two objects per customer by slot eviction. |
| `signatures/` | Expire objects after 365 days (`expire-saved-signatures-365d`). |
| all prefixes | Abort incomplete multipart uploads after 7 days (Cloudflare's default rule, already present). |

Do not add an Infrequent Access transition to `users/`. Those objects are read every time a recipient opens an email, and IA adds a per-retrieval charge.

Check with `npx wrangler r2 bucket lifecycle list email-sig-photos`.

## Saved signatures

- `POST /api/signature` (Pro only) stores the signature JSON and returns `{ id, url }`
- `GET /api/signature/{id}` returns it

The id is 256 bits of randomness and acts as a bearer capability: anyone holding the link can read the saved name, email and phone. It is never derived from the customer ID, and responses are `no-store`. The generator restores from `?s={id}` on load.

## Motion layer

`css/motion.css` and `js/motion.js` add scroll reveals and micro-interactions. Reveal styles are scoped behind `.js-motion`, which the script adds to `<html>` itself — so if the script fails, nothing is ever hidden. `js/motion.js` also runs a scroll sweep alongside the IntersectionObserver, because an observer alone never fires for content the reader jumps straight past (anchor links, restored scroll), which would leave it invisible.

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
- Upload a company logo and confirm `#logoUrl` becomes a hosted `/u/{id}/logo.png` URL.
- Pick an animation effect, confirm the status reports a KB size, and open the `.gif` URL directly.
- Click "Save & get link", open the copied link in a private window, and confirm the fields, colours, and template come back.

### Local testing without production credentials

`npx wrangler dev --local` simulates R2. Put a throwaway `PRO_SIGNING_SECRET` in `.dev.vars` (gitignored), then mint a matching JWT and load `/generator?token=...` to exercise the Pro paths.
