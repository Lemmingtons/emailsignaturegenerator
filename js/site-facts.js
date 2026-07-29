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
    templateCount: 24,
    emailClientCount: '50+',
    proTokenStorageKey: 'sig_pro_token',
  };
});
