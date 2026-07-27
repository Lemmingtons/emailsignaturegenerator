(function(root, factory) {
  const facts = Object.freeze(factory());

  if (typeof module === 'object' && module.exports) {
    module.exports = facts;
  }

  root.SiteFacts = facts;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  const origin = 'https://emailsignaturegenerator.ai';
  const contactEmail = 'info@emailsignaturegenerator.ai';

  return {
    siteName: 'Email Signature Generator',
    domain: 'emailsignaturegenerator.ai',
    origin,
    homeUrl: origin + '/',
    generatorUrl: origin + '/generator',
    contactEmail,
    supportEmail: contactEmail,
    reportEmail: contactEmail,
    paymentLink: 'https://buy.stripe.com/eVq9AS3R53Ie1Y53iKf7i01',
    proPrice: {
      amount: 9,
      amountText: '9.00',
      currency: 'AUD',
      display: '$9',
      displayWithCurrency: '$9 AUD',
    },
    templateCount: 24,
    emailClientCount: '50+',
    proTokenStorageKey: 'sig_pro_token',
    legacyProStorageKey: 'sig_pro',
    legacyDismissedStorageKey: 'sig_pro_migration_dismissed',
  };
});
