(function(root, factory) {
  const core = factory(root.SiteFacts);

  if (typeof module === 'object' && module.exports) {
    module.exports = core;
  }

  root.SignatureGeneratorCore = core;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(siteFacts) {
  const facts = siteFacts || {
    homeUrl: 'https://emailsignaturegenerator.ai/',
  };

  const defaultStyle = Object.freeze({
    primaryColor: '#0891B2',
    secondaryColor: '#7c3aed',
    textColor: '#1e293b',
    fontFamily: 'Arial, Helvetica, sans-serif',
    dividerStyle: 'line',
    photoShape: 'circle',
    iconStyle: 'mono',
    ctaText: '',
    ctaUrl: '',
  });

  const previewStyle = Object.freeze({
    ...defaultStyle,
    ctaText: 'Book a Meeting',
    ctaUrl: 'https://calendly.com',
  });

  function createStyle(overrides) {
    return { ...defaultStyle, ...(overrides || {}) };
  }

  function escapeAttr(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function urlValidator(val) {
    if (!String(val || '').trim()) return '';
    return /^https?:\/\//.test(val) ? '' : 'URL must start with http:// or https://';
  }

  function validateFieldValue(id, value) {
    if (id === 'fullName') {
      return String(value || '').trim() ? '' : 'Please enter your full name.';
    }
    if (id === 'email') {
      if (!String(value || '').trim()) return '';
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? '' : 'Please enter a valid email address.';
    }
    if (['website', 'linkedin', 'instagram', 'facebook', 'google'].includes(id)) {
      return urlValidator(value);
    }
    return '';
  }

  function getActiveCompliance(complianceData, complianceState) {
    if (!complianceData || !complianceState) return null;

    const country = complianceState.country;
    const role = complianceState.role;

    if (!country || country === 'OTHER') {
      if (country === 'OTHER' && complianceState.includeDisclaimer) {
        return {
          fields: [],
          disclaimer: complianceData.defaultDisclaimer || '',
        };
      }
      return null;
    }

    if (!role) return null;

    const roleEntry = complianceData.roles && complianceData.roles[role];
    if (!roleEntry) return null;

    const countryEntry = roleEntry.countries && roleEntry.countries[country];
    if (!countryEntry) return null;

    const filledFields = (countryEntry.fields || []).map((field) => ({
      label: field.label,
      value: String((complianceState.fieldValues || {})[field.id] || '').trim(),
    })).filter((field) => field.value);

    const disclaimer = complianceState.includeDisclaimer ? (countryEntry.disclaimer || '') : '';
    if (!filledFields.length && !disclaimer) return null;

    return { fields: filledFields, disclaimer };
  }

  // Signatures carry no branding footer. With a single paid plan there is no free
  // tier to distinguish, so every exported signature is clean.
  function buildSignatureHtml({ template, data, style, compliance }) {
    if (!template || typeof template.render !== 'function') {
      throw new Error('template_missing_render');
    }

    let inner = template.render(data || {}, createStyle(style));

    if (compliance && typeof template._complianceBlock === 'function') {
      inner += template._complianceBlock(compliance, (style || defaultStyle).fontFamily || defaultStyle.fontFamily);
    }

    return typeof template._darkSafeWrap === 'function'
      ? template._darkSafeWrap(inner)
      : inner;
  }

  // Inline `data:` images render in our own preview but are stripped by Gmail and
  // Outlook, so a signature copied with one in it arrives with a broken image.
  // Returns the slot names ('photo', 'logo') that are preview-only.
  function previewOnlyImageSlots(data) {
    const d = data || {};
    const slots = [];
    if (/^data:/i.test(String(d.photoUrl || '').trim())) slots.push('photo');
    if (/^data:/i.test(String(d.logoUrl || '').trim())) slots.push('logo');
    return slots;
  }

  // Returns a copy of `data` with every preview-only image removed, so the
  // exported signature degrades to no image rather than a broken one.
  function withoutPreviewOnlyImages(data) {
    const out = { ...(data || {}) };
    previewOnlyImageSlots(out).forEach((slot) => {
      out[slot === 'photo' ? 'photoUrl' : 'logoUrl'] = '';
    });
    return out;
  }

  function plainTextFromData(data) {
    const d = data || {};
    return [d.fullName, d.title, d.company, d.phone, d.email, d.website].filter(Boolean).join('\n');
  }

  function describeUploadError(code) {
    switch (code) {
      case 'not_pro': return 'Pro is required to host images for Gmail and Outlook.';
      case 'invalid_type': return 'That image slot is not supported.';
      case 'rate_limited': return 'Too many uploads in this one-minute window. Try again shortly.';
      case 'too_large': return 'Image too large. Use a smaller JPG, PNG, or WebP.';
      case 'unsupported_format': return 'JPG, PNG, or WebP only.';
      case 'invalid_token': return 'Pro session expired. Refresh Pro access and try again.';
      case 'storage_not_configured': return 'Hosting is offline right now. Try again shortly.';
      case 'empty_body': return 'Image upload was empty. Try another file.';
      default: return 'Upload failed. Try again.';
    }
  }

  return Object.freeze({
    defaultStyle,
    previewStyle,
    createStyle,
    escapeAttr,
    urlValidator,
    validateFieldValue,
    getActiveCompliance,
    buildSignatureHtml,
    previewOnlyImageSlots,
    withoutPreviewOnlyImages,
    plainTextFromData,
    describeUploadError,
  });
});
