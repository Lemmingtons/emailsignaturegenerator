(function(root, factory) {
  const facts = Object.freeze(factory());

  if (typeof module === 'object' && module.exports) {
    module.exports = facts;
  }

  root.SiteFacts = facts;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  const origin = 'https://emailsignaturegenerator.ai';
  const contactEmail = 'info@emailsignaturegenerator.ai';
  const hostname = typeof location === 'object' && location ? location.hostname : '';
  const useSandboxPayments = hostname === 'localhost' ||
    (hostname.endsWith('.workers.dev') && hostname.includes('sandbox'));

  return {
    siteName: 'Email Signature Generator',
    domain: 'emailsignaturegenerator.ai',
    origin,
    homeUrl: origin + '/',
    generatorUrl: origin + '/generator',
    socialImageUrl: origin + '/assets/og-image.png?v=website-brand-20261025',
    contactEmail,
    supportEmail: contactEmail,
    reportEmail: contactEmail,
    paymentLink: useSandboxPayments
      ? 'https://buy.stripe.com/test_eVqbJ01JQ8i8gsgd0C2go01'
      : 'https://buy.stripe.com/3cIdR84XH6vdcfKahF5Ne00',
    proPrice: {
      amount: 9,
      amountText: '9.00',
      currency: 'USD',
      display: '$9',
      displayWithCurrency: 'US$9',
    },
    // Every team offer on the site stays hidden while teamPaymentLink is
    // empty. The sandbox has no team link, so it hides the offer there.
    teamPaymentLink: useSandboxPayments ? '' : 'https://buy.stripe.com/7sY4gydud9Hpa7CblJ5Ne01',
    teamPrice: {
      amount: 29,
      amountText: '29.00',
      currency: 'USD',
      display: '$29',
      displayWithCurrency: 'US$29',
    },
    teamSeats: 10,
    templateCount: 28,
    bulkMaxRows: 250,
    bulkIndividualMaxRows: 19,
    bulkCheckoutDraftStorageKey: 'sig_bulk_checkout_draft',
    bulkMaxInputBytes: 1_000_000,
    bulkMaxSpreadsheetBytes: 500_000,
    proTokenStorageKey: 'sig_pro_token',
    checkoutDraftStorageKey: 'sig_checkout_draft',
    maxCardsPerBuyer: 10,
  };
});
