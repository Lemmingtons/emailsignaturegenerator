# Next steps — Pro hosted photo upload (2026-04-28)

This commit ships the Pro hosted-photo-upload feature **and** raises the Pro price from $5 → $9. The code is in place but **two manual steps in dashboards are required before the feature works** and **one of them must happen ASAP** to keep checkout honest.

---

## ⚠️ Time-sensitive: Stripe price mismatch

Right now the deployed site advertises **$9** everywhere, but Stripe Payment Link `6oUeVc0ET92yauBf1sf7i00` still charges **$5**. Customers who buy during this window will pay less than advertised. Fix this **first**.

### Action

1. Open Stripe Dashboard → Payment Links → edit Payment Link `6oUeVc0ET92yauBf1sf7i00`.
2. Change amount to **AUD 9.00**.
3. Save.

If Stripe forces you to create a new Payment Link instead of editing:

- Grep the repo for `6oUeVc0ET92yauBf1sf7i00`:
  ```sh
  grep -rn '6oUeVc0ET92yauBf1sf7i00' --include='*.html' --include='*.js' .
  ```
- Replace with the new URL in:
  - `index.html` (checkoutBtn href)
  - `js/app.js` (`STRIPE_PAYMENT_LINK` constant near line 271)
  - `js/app.js` (legacy migration banner near line 918)
- Verify the new Payment Link's success URL is set to:
  `https://emailsignaturegenerator.ai/api/verify-payment?session_id={CHECKOUT_SESSION_ID}`

---

## Bindings to enable photo upload

The new `/api/upload-image` and `/u/{cus_xxx}/photo.{ext}` endpoints are deployed but currently return 500 `storage_not_configured` because the R2 and KV bindings are **commented out** in `wrangler.toml` (deliberately, so the first deploy doesn't break). Once you've created the resources below, uncomment and redeploy.

### 1. Create the R2 bucket

Cloudflare Dashboard → R2 → Create bucket
- Name: `esg-user-uploads`
- Location: Automatic
- Public access: **OFF** (the Worker is the only reader; `/u/...` is the public route)

### 2. Create the KV namespace

Cloudflare Dashboard → Workers & Pages → KV → Create namespace
- Name: `esg-rate-limit`
- Copy the namespace **ID** (32-char hex)

### 3. Uncomment + paste in `wrangler.toml`

Open `wrangler.toml` — at the bottom there's a commented block. Uncomment both `[[r2_buckets]]` and `[[kv_namespaces]]` sections, and paste the KV id where it says `PASTE_KV_NAMESPACE_ID_HERE`.

### 4. Deploy

`git push` to `main` (triggers Cloudflare Pages auto-deploy), or `npx wrangler deploy`.

No new secrets are needed — `STRIPE_SECRET_KEY` and `PRO_SIGNING_SECRET` are already configured.

---

## Smoke test after deploy

Once bindings are live, walk through these to confirm everything works:

- [ ] Buy Pro at $9 via Stripe (use a real card or Stripe test mode)
- [ ] After redirect, JWT lands in `localStorage.sig_pro_token` and pro banner disappears
- [ ] On `/generator`, upload a 3 MB JPG → resize happens client-side → `#photoUrl` auto-populates with `https://emailsignaturegenerator.ai/u/cus_xxx/photo.jpg?v=...`
- [ ] Open the returned URL in a new tab → image loads, response has `Cache-Control: public, max-age=31536000, immutable`
- [ ] Re-upload a PNG → R2 ends up with only `users/cus_xxx/photo.png` (jpg sibling deleted)
- [ ] Copy the signature into Gmail compose → photo renders inline
- [ ] Send a test email to a fresh Gmail account + Outlook.com + Apple Mail → photo loads in all three
- [ ] Try uploading a renamed `.exe` → returns 415 `unsupported_format`
- [ ] Try uploading 11 times within an hour → 11th returns 429 `rate_limited`

---

## What changed in this commit

### New endpoints (`_worker.js`)
- `POST /api/upload-image` — JWT-gated, magic-byte-validated, R2-backed, KV-rate-limited
- `GET /u/{cus_xxx}/photo.{ext}` — public, regex-validated, immutable cache

### New helpers (`_worker.js`)
- `sniffImage(buf)` — first-12-byte magic detection for JPG/PNG/WebP (authoritative; client MIME ignored)
- `apiError(status, code, detail)` — consistent JSON error shape

### Client (`js/app.js`)
- `resizeImage()` — createImageBitmap + canvas + toBlob('image/jpeg', 0.88) → strips EXIF, caps at 400×400
- `setPhotoStatus()` / `defaultPhotoStatus()` — write to `#photoStatusHint`
- `handlePhotoUpload()` — rewritten for the resize → preview → optional Pro upload flow
- `unlockPro()` and `removePhoto()` now refresh the upload-area hint

### HTML
- `generator.html` — added `id="photoStatusHint"`, tightened `accept` to JPG/PNG/WebP, hint copy mentions Pro hosting
- `privacy.html` — new page covering data handling, hosted photo specifics, acceptable use, deletion, refunds
- Footers in `index.html` and `generator.html` link to `/privacy`
- `sitemap.xml` includes `/privacy`

### Pricing
- `$5` → `$9` across 58 files (landing page, generator, llms.txt, blog post, all SEO pages, generate-pages.js)
- JSON-LD `"price": "5.00"` → `"9.00"` in index.html and generator.html
- Blog "46× less" math line rewritten to "same as a single month — yours for life"

### Security
- CSP `img-src` now includes `blob:` (in `_worker.js` and `_headers`) so canvas previews work without violations

---

## Out of scope for this release (intentional)

- Logo upload (still paste-a-URL only — Pro logo upload is the obvious v2)
- SVG support (XML attack surface)
- CSAM / content moderation (Pro payment is the v1 abuse filter)
- In-app "delete my hosted photo" UI (manual via support email)
- JWT revocation / denylist (acceptable for one-time $9 product)

---

## If you need to roll this back

The change is two logical pieces:

1. **Pro upload feature** — to disable, leave the bindings commented in `wrangler.toml`. The endpoints will return 500 but everything else works.
2. **Price change** — to revert just the pricing, run:
   ```sh
   find . -type f \( -name '*.html' -o -name '*.js' -o -name '*.txt' \) \
     -not -path './node_modules/*' \
     | xargs grep -lE '\$9([^0-9]|$)' \
     | while read f; do sed -i '' -E 's/\$9([^0-9]|$)/\$5\1/g' "$f"; done
   ```
   Then manually revert the math line in `blog/free-vs-paid-email-signature-generators.html` and the JSON-LD `"price": "9.00"` values.

---

## Reference

- Plan file: `/Users/homesafeinspections/.claude/plans/yes-lets-plan-this-shimmering-nova.md`
- Memory: `/Users/homesafeinspections/.claude/projects/-Users-homesafeinspections-Saas-Projects/memory/project_signature_generator.md`
