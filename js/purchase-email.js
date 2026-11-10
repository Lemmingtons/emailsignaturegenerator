// Server-only purchase delivery. Inputs come only from verified Stripe events.
//
// Dormant by default: nothing is stored and no provider is called unless both
// PURCHASE_EMAILS_FROM (an ISO activation time) and RESEND_API_KEY are set and
// facts.purchaseEmailFrom is a valid address. See docs/purchase-emails.md.
export function createPurchaseEmails({ facts, entitlementId, uploadBucket, readJsonObject, isEntitlementRevoked }) {
  const prefix = id => `entitlements/purchase-emails/${id}`;
  const metadata = { httpMetadata: { contentType: 'application/json', cacheControl: 'no-store' } };
  const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

  function configured(env) {
    if (!env.PURCHASE_EMAILS_FROM) return false;
    return Number.isFinite(Date.parse(env.PURCHASE_EMAILS_FROM)) && Boolean(env.RESEND_API_KEY) &&
      /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(facts.purchaseEmailFrom || '');
  }

  function receiptUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && url.hostname === 'pay.stripe.com' && !url.port &&
        !url.username && !url.password && url.pathname.startsWith('/receipts/') ? url.href : '';
    } catch { return ''; }
  }

  function message(draft, receipt) {
    // The session id rides in the fragment, so link scanners, click trackers
    // and request logs never see it; /api/verify-payment moves it client-side.
    const access = new URL('/api/verify-payment', facts.origin);
    access.hash = `session_id=${draft.sessionId}`;
    const plan = draft.plan === 'team' ? 'Team Pack' : 'Individual Pro';
    const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: draft.currency.toUpperCase() });
    const decimals = ['isk', 'ugx'].includes(draft.currency) ? 2 : formatter.resolvedOptions().maximumFractionDigits;
    const amount = formatter.format(draft.amount / 10 ** decimals);
    const benefits = draft.plan === 'team'
      ? `Your Team Pack includes ${facts.teamSeats} editing seats in total: you and ${facts.teamSeats - 1} colleagues. Create your company design in the builder, then choose “Copy team link” to share it. You can also generate up to ${facts.bulkMaxRows} signatures per batch from a spreadsheet.`
      : `Your Individual Pro purchase unlocks signature export, hosted images, animations and saved edit links. You can also generate up to ${facts.bulkIndividualMaxRows} signatures per batch from a spreadsheet.`;
    const text = `Thanks for your purchase.\n\n${plan} — ${amount} ${draft.currency.toUpperCase()}, paid once. No subscription.\n\nAccess your purchase: ${access.href}\n\n${benefits}\n\nView your Stripe receipt: ${receipt.url}\n\nKeep this email and your access link private. Use it to restore your paid access on another device. It restores your purchase, not an unsaved signature draft. Copy your finished signature into your email application's signature settings.\n\nQuestions? ${facts.supportEmail}`;
    const html = `<!doctype html><html><body style="margin:0;background:#f5f6fa;color:#172033;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="560" style="max-width:100%;background:white;border:1px solid #e3e7ef;border-radius:12px" cellspacing="0" cellpadding="0"><tr><td style="padding:32px"><p style="font-size:13px;color:#626b7b;margin:0 0 20px">${escape(facts.siteName)}</p><h1 style="font-size:25px;line-height:1.3;margin:0 0 16px">Your ${escape(plan)} is ready</h1><p style="line-height:1.6">Thanks for your purchase. You paid <strong>${escape(amount)} ${escape(draft.currency.toUpperCase())}</strong> once. There is no subscription.</p><p style="margin:26px 0"><a href="${escape(access.href)}" style="display:inline-block;background:#4f46e5;color:white;text-decoration:none;padding:14px 20px;border-radius:6px;font-weight:bold">Access your purchase</a></p><p style="line-height:1.6">${escape(benefits)}</p><p style="line-height:1.6"><a href="${escape(receipt.url)}">View your Stripe receipt</a> and download a copy for your records.</p><p style="font-size:13px;color:#626b7b;line-height:1.6">Keep this email and your access link private. You can use it to restore paid access on another device. It restores your purchase, not an unsaved signature draft. Copy your finished signature into your email application's signature settings.</p><p style="font-size:13px;line-height:1.6;margin-bottom:0">Questions? <a href="mailto:${escape(facts.supportEmail)}">${escape(facts.supportEmail)}</a></p></td></tr></table></td></tr></table></body></html>`;
    return { from: `${facts.siteName} <${facts.purchaseEmailFrom}>`, to: [draft.email], reply_to: facts.supportEmail,
      subject: `Your ${facts.siteName} ${plan} — receipt and access`, html, text };
  }

  async function deliver(id, env) {
    const bucket = uploadBucket(env);
    const [draft, receipt, active] = await Promise.all([
      readJsonObject(bucket, `${prefix(id)}/purchase.json`),
      readJsonObject(bucket, `${prefix(id)}/receipt.json`),
      readJsonObject(bucket, `entitlements/active/${id}.json`),
    ]);
    if (!draft || !receipt || !active || active.status !== 'active' || await isEntitlementRevoked(bucket, id)) return;
    if (receipt.amount !== draft.amount || receipt.currency !== draft.currency) throw new Error('PurchaseEmailReceiptMismatch');

    const key = `${prefix(id)}/delivery.json`;
    const object = await bucket.get(key);
    const previous = object ? JSON.parse(await object.text()) : null;
    if (previous && previous.state === 'sent') return;
    const now = Date.now();
    if (previous && previous.leaseUntil > now) throw new Error('PurchaseEmailBusy');
    // Resend remembers idempotency keys for 24 hours. An indeterminate send
    // older than that needs reconciliation, rather than risking a second email.
    if (previous && now - previous.firstAttemptAt >= 23 * 60 * 60 * 1000) throw new Error('PurchaseEmailNeedsReconciliation');
    const claim = {
      state: 'pending', firstAttemptAt: previous ? previous.firstAttemptAt : now,
      leaseUntil: now + 60_000, payload: previous ? previous.payload : message(draft, receipt),
    };
    const written = await bucket.put(key, JSON.stringify(claim), {
      ...metadata, onlyIf: object ? { etagMatches: object.etag } : { etagDoesNotMatch: '*' },
    });
    if (!written) throw new Error('PurchaseEmailBusy');
    try {
      if (await isEntitlementRevoked(bucket, id)) return;
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST', signal: AbortSignal.timeout(10_000),
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': `purchase-confirmation/${id}` },
        body: JSON.stringify(claim.payload),
      });
      if (!response.ok) throw new Error('PurchaseEmailProviderRejected');
      const result = await response.json();
      if (typeof result.id !== 'string' || !result.id || result.id.length > 100) throw new Error('PurchaseEmailProviderResponse');
      const saved = await bucket.put(key, JSON.stringify({ state: 'sent', sentAt: Date.now(), providerId: result.id }), {
        ...metadata, onlyIf: { etagMatches: written.etag },
      });
      if (!saved) throw new Error('PurchaseEmailSaveFailed');
    } catch {
      // Preserve the first attempt and the exact payload for safe provider retries.
      await bucket.put(key, JSON.stringify({ ...claim, leaseUntil: 0 }), { ...metadata, onlyIf: { etagMatches: written.etag } });
      throw new Error('PurchaseEmailDeliveryFailed');
    }
  }

  async function handle(event, env, purchase) {
    // Inert unless fully configured: no records, no provider call, no error.
    // A half-configured Worker is reported by /api/health instead.
    if (!configured(env)) return;
    if (!['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'charge.succeeded'].includes(event.type)) return;
    const since = Date.parse(env.PURCHASE_EMAILS_FROM);
    if (!Number.isInteger(event.created) || event.created * 1000 < since) return;
    const bucket = uploadBucket(env);
    if (!bucket) throw new Error('PurchaseEmailStorageMissing');
    const object = event.data.object;
    let id;
    if (event.type === 'charge.succeeded') {
      const intent = typeof object.payment_intent === 'string' ? object.payment_intent : object.payment_intent && object.payment_intent.id;
      if (!/^pi_[A-Za-z0-9]+$/.test(intent || '') || object.paid !== true || object.status !== 'succeeded') return;
      const url = receiptUrl(object.receipt_url);
      if (!url || !Number.isSafeInteger(object.amount) || object.amount <= 0 || !/^[a-z]{3}$/.test(object.currency || '')) throw new Error('PurchaseEmailReceiptMissing');
      id = await entitlementId(intent, env.PRO_SIGNING_SECRET);
      await bucket.put(`${prefix(id)}/receipt.json`, JSON.stringify({ url, amount: object.amount, currency: object.currency }), { ...metadata, onlyIf: { etagDoesNotMatch: '*' } });
    } else {
      if (!purchase) return;
      const email = object.customer_details && object.customer_details.email || object.customer_email;
      if (typeof email !== 'string' || email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) ||
        !Number.isSafeInteger(object.amount_total) || object.amount_total <= 0 || !/^[a-z]{3}$/.test(object.currency || '')) throw new Error('PurchaseEmailDetailsMissing');
      id = purchase.id;
      await bucket.put(`${prefix(id)}/purchase.json`, JSON.stringify({
        email, sessionId: purchase.sessionId, plan: purchase.plan,
        amount: object.amount_total, currency: object.currency,
      }), { ...metadata, onlyIf: { etagDoesNotMatch: '*' } });
    }
    await deliver(id, env);
  }

  return { configured, handle };
}
