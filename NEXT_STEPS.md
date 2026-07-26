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

Three effects: `sweep`, `ring`, `crossfade`. Output is 160x160 and typically lands between 15 KB and 100 KB.

Three invariants that must not regress:

- **Frame 0 is the resting photo.** Classic Outlook on Windows renders only the first frame, so every effect is additive over an already-legible image. Never add an effect that fades in from blank.
- **Error-diffusion dithering stays off for animation.** It propagates change across the whole frame, which defeats inter-frame differencing and roughly triples file size.
- **All encoding goes through `encodeSignatureGif` in `js/app.js`**, never `GifEncoder.encode` directly, so the loop policy stays in one place.

## Loop policy: the breathing loop

Animations repeat, but rest between passes: one pass, then a 5 second hold on the resting frame, forever (`ANIMATION_HOLD_CS` in `js/app.js`).

Playing once looks correct in a test page and fails in a real inbox: a GIF starts when it decodes, not when it is looked at, so a signature under a long email finishes animating before the reader scrolls to it. A tight loop fixes that but reads as an advert, and a long thread shows every copy moving at once.

The hold costs about 0.1 KB — a held frame is identical to its predecessor, so frame differencing collapses it to a single transparent pixel.

An effect may only loop if it returns to its opening frame; `EFFECTS[*].loops` declares this and the validator enforces it. The two-photo crossfade is `loops: false` because it ends on the second photo, and repeating it would flick between two faces.

## R2 lifecycle rules

Applied to the `email-sig-photos` bucket:

| Prefix | Rule |
| --- | --- |
| `users/` | **No expiry.** Deliberate — these images are referenced by signatures already sitting in other people's inboxes, so expiring them would break sent mail. Growth is bounded at two objects per customer by slot eviction. |
| `signatures/` | Expire objects after 365 days (`expire-saved-signatures-365d`). |
| all prefixes | Abort incomplete multipart uploads after 7 days (Cloudflare's default rule, already present). |

Do not add an Infrequent Access transition to `users/`. Those objects are read every time a recipient opens an email, and IA adds a per-retrieval charge.

Check with `npx wrangler r2 bucket lifecycle list email-sig-photos`.

## Swept artwork: CTA button and divider

`js/sweep-animator.js` moves a highlight across any rendered artwork and reuses `js/gif-encoder.js` to encode it. The browser draws the artwork to a canvas at 2x; the animator only moves light across the pixels, so the maths stays free of canvas and testable under Node.

**CTA button** (`renderCtaButtonCanvas`, `cta` slot, ~22 KB). `TEMPLATES._ctaButton` swaps the text anchor for the hosted image when `data.ctaImageUrl` is set, keeping the same link and carrying the label as alt text so clients that block images still show a usable link. Only the two filled-button templates (`ctabox`, `realestate`) use it — `banner` and `meetinglink` render text links, where a sheen has nothing to sweep across.

**Divider rule** (`renderDividerCanvas`, `divider` slot, ~5 KB). `TEMPLATES._divider` swaps the CSS border for the hosted image when `data.dividerImageUrl` is set. The artwork is a fixed 300px wide but emitted at `width="100%"`, because the rule stretches to whatever the content beside it is; a thin horizontal bar scales without visible distortion. Alt text is empty — it is decorative. A narrower band and higher strength than the button: on a two-pixel rule a wide soft band just reads as the colour changing.

Labels, accent colour and divider style are baked into the pixels, so changing any of them rebuilds the GIF (debounced).

## One animation per signature

`claimAnimationSlot` in `js/app.js` enforces it: switching one effect on switches the others off. Three moving parts reads as a free template however well each is made. The validator asserts every effect claims the slot.

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
