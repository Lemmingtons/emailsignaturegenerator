// ── Email Signature Generator — App Logic ──

(function() {
  'use strict';

  // ── State ──
  let currentTemplate = 'classic';
  let currentCategory = 'all';
  let isPro = false; // Set to true after Stripe payment
  let darkPreview = false; // Toggles the preview container's background to simulate recipient dark mode

  const defaultStyle = {
    primaryColor: '#0891B2',
    secondaryColor: '#7c3aed',
    textColor: '#1e293b',
    fontFamily: 'Arial, Helvetica, sans-serif',
    dividerStyle: 'line',
    photoShape: 'circle',
    iconStyle: 'mono',
    ctaText: '',
    ctaUrl: '',
  };

  let style = { ...defaultStyle };

  // Compliance state — populated after compliance.json loads
  let complianceData = null;
  const complianceState = {
    country: '',
    role: '',
    fieldValues: {},
    includeDisclaimer: true,
  };

  // ── Init ──
  document.addEventListener('DOMContentLoaded', function() {
    renderCategoryTabs();
    renderTemplateGrid();
    bindFormInputs();
    bindStyleControls();
    bindButtons();
    bindValidation();
    initCompliance();
    renderPreview();

    // Check for pro unlock via URL param (post-Stripe redirect with token)
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    if (token) {
      localStorage.setItem('sig_pro_token', token);
      window.history.replaceState({}, '', window.location.pathname);
    }

    // Verify Pro status (new token-based or legacy fallback)
    checkProStatus();
  });

  // ── Category Tabs ──
  function renderCategoryTabs() {
    const container = document.getElementById('category-tabs');
    if (!container) return;
    container.innerHTML = CATEGORIES.map(cat =>
      `<button class="category-tab${cat.id === currentCategory ? ' active' : ''}" data-category="${cat.id}" aria-label="Filter ${cat.name} templates">${cat.name}</button>`
    ).join('');

    container.querySelectorAll('.category-tab').forEach(btn => {
      btn.addEventListener('click', function() {
        currentCategory = this.dataset.category;
        renderCategoryTabs();
        renderTemplateGrid();
      });
    });
  }

  // ── Template Grid ──
  function renderTemplateGrid() {
    const container = document.getElementById('template-grid');
    if (!container) return;

    const entries = Object.entries(TEMPLATES).filter(([, t]) =>
      currentCategory === 'all' || t.category === currentCategory
    );

    const previewStyle = {
      primaryColor: '#0891B2',
      secondaryColor: '#7c3aed',
      textColor: '#1e293b',
      fontFamily: 'Arial, Helvetica, sans-serif',
      dividerStyle: 'line',
      photoShape: 'circle',
      iconStyle: 'mono',
      ctaText: 'Book a Meeting',
      ctaUrl: 'https://calendly.com',
    };

    container.innerHTML = entries.map(([id, t]) => {
      if (!t._previewHtml) {
        t._previewHtml = t.preview(previewStyle);
      }
      return `<button class="template-card${id === currentTemplate ? ' active' : ''}" data-template="${id}" aria-label="Select ${t.name} template">
        ${t.pro && !isPro ? '<span class="pro-badge">Pro</span>' : ''}
        <div class="template-preview">${t._previewHtml}</div>
        <div class="template-name">${t.name}</div>
        <span class="dark-safe-badge" title="Renders correctly in Gmail dark mode">Dark-safe</span>
      </button>`;
    }).join('');

    container.querySelectorAll('.template-card').forEach(card => {
      card.addEventListener('click', function() {
        const id = this.dataset.template;
        const template = TEMPLATES[id];

        if (template.pro && !isPro) {
          showProPrompt();
          return;
        }

        currentTemplate = id;
        renderTemplateGrid();
        renderPreview();
      });
    });
  }

  // ── Form Binding ──
  function bindFormInputs() {
    const fields = ['fullName', 'title', 'email', 'phone', 'company', 'website', 'instagram', 'facebook', 'linkedin', 'google', 'photoUrl', 'logoUrl'];
    fields.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', renderPreview);
    });

    // Photo upload
    const photoFile = document.getElementById('photoFile');
    if (photoFile) {
      photoFile.addEventListener('change', function() {
        handlePhotoUpload(this);
      });
    }

    const photoRemoveBtn = document.getElementById('photoRemoveBtn');
    if (photoRemoveBtn) {
      photoRemoveBtn.addEventListener('click', removePhoto);
    }

    // Logo upload
    const logoFile = document.getElementById('logoFile');
    if (logoFile) {
      logoFile.addEventListener('change', function() {
        handleLogoUpload(this);
      });
    }

    const logoRemoveBtn = document.getElementById('logoRemoveBtn');
    if (logoRemoveBtn) {
      logoRemoveBtn.addEventListener('click', removeLogo);
    }
  }

  // ── Style Controls ──
  function bindStyleControls() {
    // Color pickers
    bindColorPicker('primaryColor', 'primaryColorHex');
    bindColorPicker('secondaryColor', 'secondaryColorHex');
    bindColorPicker('textColor', 'textColorHex');

    // Font selector
    const fontSelect = document.getElementById('fontFamily');
    if (fontSelect) {
      fontSelect.addEventListener('change', function() {
        style.fontFamily = this.value;
        renderPreview();
      });
    }

    // Toggle groups
    bindToggleGroup('divider-toggles', 'dividerStyle');
    bindToggleGroup('photo-shape-toggles', 'photoShape');
    bindToggleGroup('icon-style-toggles', 'iconStyle');

    // Preview background toggle (simulates recipient's light vs dark inbox)
    document.querySelectorAll('.preview-bg-toggle .toggle-option').forEach(btn => {
      btn.addEventListener('click', function() {
        document.querySelectorAll('.preview-bg-toggle .toggle-option').forEach(o => {
          o.classList.remove('active');
          o.setAttribute('aria-checked', 'false');
        });
        this.classList.add('active');
        this.setAttribute('aria-checked', 'true');
        darkPreview = this.dataset.previewBg === 'dark';
        renderPreview();
      });
    });

    // CTA fields
    const ctaText = document.getElementById('ctaText');
    const ctaUrl = document.getElementById('ctaUrl');
    if (ctaText) ctaText.addEventListener('input', function() { style.ctaText = this.value; renderPreview(); });
    if (ctaUrl) ctaUrl.addEventListener('input', function() { style.ctaUrl = this.value; renderPreview(); });
  }

  function bindColorPicker(pickerId, hexId) {
    const picker = document.getElementById(pickerId);
    const hex = document.getElementById(hexId);
    if (!picker) return;

    picker.addEventListener('input', function() {
      style[pickerId] = this.value;
      if (hex) hex.value = this.value;
      renderPreview();
    });

    if (hex) {
      hex.addEventListener('input', function() {
        const val = this.value.startsWith('#') ? this.value : '#' + this.value;
        if (/^#[0-9a-fA-F]{6}$/.test(val)) {
          style[pickerId] = val;
          picker.value = val;
          renderPreview();
        }
      });
    }
  }

  function bindToggleGroup(containerId, styleKey) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.querySelectorAll('.toggle-option').forEach(opt => {
      opt.addEventListener('click', function() {
        container.querySelectorAll('.toggle-option').forEach(o => {
          o.classList.remove('active');
          o.setAttribute('aria-checked', 'false');
        });
        this.classList.add('active');
        this.setAttribute('aria-checked', 'true');
        style[styleKey] = this.dataset.value;
        renderPreview();
      });
    });
  }

  // ── Buttons ──
  function bindButtons() {
    const copyHtmlBtn = document.getElementById('copyHtmlBtn');
    const copyTextBtn = document.getElementById('copyTextBtn');
    const buyProBtn = document.getElementById('buyProBtn');
    const mobilePreviewFab = document.getElementById('mobilePreviewFab');
    const mobileBackToForm = document.getElementById('mobileBackToForm');

    if (copyHtmlBtn) copyHtmlBtn.addEventListener('click', function() { copyHTML(this); });
    if (copyTextBtn) copyTextBtn.addEventListener('click', function() { copyPlainText(this); });
    if (buyProBtn) buyProBtn.addEventListener('click', handleProPurchase);

    if (mobilePreviewFab) {
      mobilePreviewFab.addEventListener('click', () => {
        document.querySelector('.preview-column').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
    if (mobileBackToForm) {
      mobileBackToForm.addEventListener('click', () => {
        document.querySelector('.controls-column').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }

  // ── Pro Purchase ──
  // TODO: Replace this URL with your actual Stripe Payment Link once created.
  // Create one at https://dashboard.stripe.com/payment-links
  // Set the success URL to: https://emailsignaturegenerator.ai/generator.html?pro=true
  const STRIPE_PAYMENT_LINK = 'https://buy.stripe.com/6oUeVc0ET92yauBf1sf7i00';

  function handleProPurchase() {
    if (STRIPE_PAYMENT_LINK) {
      window.location.href = STRIPE_PAYMENT_LINK;
    } else {
      // Dev/preview mode — unlock directly for testing
      if (confirm('Stripe not configured yet. Unlock Pro for testing?')) {
        unlockPro();
      }
    }
  }

  // ── Photo Handling ──

  // Default hint copy when the user hasn't done anything yet — restored on remove.
  const PHOTO_STATUS_DEFAULT_FREE = 'Upload for preview only. Use a hosted URL for Gmail.';
  const PHOTO_STATUS_DEFAULT_PRO = 'Upload — we\'ll host it for Gmail-ready use.';

  function setPhotoStatus(text, kind) {
    const el = document.getElementById('photoStatusHint');
    if (!el) return;
    el.textContent = text;
    el.style.color = kind === 'error' ? '#b91c1c' : kind === 'success' ? '#059669' : '';
  }

  function defaultPhotoStatus() {
    setPhotoStatus(isPro ? PHOTO_STATUS_DEFAULT_PRO : PHOTO_STATUS_DEFAULT_FREE);
  }

  // Resize an image File to fit within maxDim x maxDim, returning a Blob.
  // JPEG output (re-encoded) for opaque images — strips EXIF and shrinks size.
  // PNG passthrough only when source is PNG (logos may need transparency, but for photos
  // we still re-encode to JPEG to keep payload small).
  async function resizeImage(file, maxDim) {
    const bitmap = await createImageBitmap(file);
    const ratio = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * ratio));
    const h = Math.max(1, Math.round(bitmap.height * ratio));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close && bitmap.close();
    return await new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('canvas_encode_failed'))),
        'image/jpeg',
        0.88
      );
    });
  }

  function describeUploadError(code) {
    switch (code) {
      case 'rate_limited': return 'Too many uploads this hour — try again later.';
      case 'too_large': return 'Image too large (max 2 MB after resize).';
      case 'unsupported_format': return 'JPG, PNG, or WebP only.';
      case 'invalid_token': return 'Pro session expired — please reconnect.';
      case 'storage_not_configured': return 'Hosting is offline right now — try again shortly.';
      default: return 'Upload failed — please try again.';
    }
  }

  async function handlePhotoUpload(input) {
    const file = input.files[0];
    if (!file) return;

    const thumb = document.getElementById('photoPreviewThumb');
    const removeBtn = document.getElementById('photoRemoveBtn');

    setPhotoStatus('Processing image…');

    let blob;
    try {
      blob = await resizeImage(file, 400);
    } catch (e) {
      setPhotoStatus('Could not read that image — try a JPG or PNG.', 'error');
      return;
    }

    // Local preview (works for Free + Pro). Use object URL for the thumb img.
    const previewUrl = URL.createObjectURL(blob);
    thumb.innerHTML = `<img src="${previewUrl}" alt="Photo">`;
    thumb.classList.add('has-photo');
    if (removeBtn) removeBtn.style.display = '';

    // Read as data URI for previewOnly fallback (used in getFormData when no hosted URL exists).
    const reader = new FileReader();
    reader.onload = function(e) {
      if (!document.getElementById('photoUrl').value.trim()) {
        thumb.dataset.previewOnly = e.target.result;
      }
      renderPreview();
    };
    reader.readAsDataURL(blob);

    if (!isPro) {
      setPhotoStatus('Preview only — upgrade to Pro for permanent hosting.');
      return;
    }

    // Pro path — upload to Worker, replace #photoUrl with the hosted URL.
    const token = localStorage.getItem('sig_pro_token');
    if (!token) {
      setPhotoStatus('Pro session missing — please reconnect.', 'error');
      return;
    }

    setPhotoStatus('Saving to your Pro account…');
    try {
      const res = await fetch('/api/upload-image', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + token,
          'Content-Type': 'image/jpeg',
          'X-Image-Type': 'photo',
        },
        body: blob,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (json.code === 'invalid_token') {
          isPro = false;
          showProPrompt();
        }
        setPhotoStatus(describeUploadError(json.code), 'error');
        return;
      }
      const photoInput = document.getElementById('photoUrl');
      photoInput.value = json.url;
      delete thumb.dataset.previewOnly;
      setPhotoStatus('Saved ✓ Hosted URL ready for Gmail.', 'success');
      renderPreview();
    } catch (e) {
      setPhotoStatus('Upload failed — please try again.', 'error');
    }
  }

  function removePhoto() {
    document.getElementById('photoUrl').value = '';
    document.getElementById('photoFile').value = '';

    const thumb = document.getElementById('photoPreviewThumb');
    thumb.innerHTML = '<span class="photo-placeholder">No photo</span>';
    thumb.classList.remove('has-photo');
    delete thumb.dataset.previewOnly;

    const removeBtn = document.getElementById('photoRemoveBtn');
    if (removeBtn) removeBtn.style.display = 'none';

    defaultPhotoStatus();
    renderPreview();
  }

  // ── Logo Handling ──
  function handleLogoUpload(input) {
    const file = input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
      const dataUri = e.target.result;
      const thumb = document.getElementById('logoPreviewThumb');
      if (!thumb) return;
      const img = document.createElement('img');
      img.src = dataUri;
      img.alt = 'Logo';
      thumb.replaceChildren(img);
      thumb.classList.add('has-logo');

      const removeBtn = document.getElementById('logoRemoveBtn');
      if (removeBtn) removeBtn.style.display = '';

      if (!document.getElementById('logoUrl').value.trim()) {
        thumb.dataset.previewOnly = dataUri;
      }
      renderPreview();
    };
    reader.readAsDataURL(file);
  }

  function removeLogo() {
    document.getElementById('logoUrl').value = '';
    document.getElementById('logoFile').value = '';

    const thumb = document.getElementById('logoPreviewThumb');
    thumb.innerHTML = '<span class="logo-placeholder">No logo</span>';
    thumb.classList.remove('has-logo');
    delete thumb.dataset.previewOnly;

    const removeBtn = document.getElementById('logoRemoveBtn');
    if (removeBtn) removeBtn.style.display = 'none';

    renderPreview();
  }

  // ── Get Form Data ──
  function getFormData() {
    const get = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };

    // Use hosted URL if available, otherwise fall back to uploaded preview data URI
    let photoUrl = get('photoUrl');
    if (!photoUrl) {
      const thumb = document.getElementById('photoPreviewThumb');
      if (thumb && thumb.dataset.previewOnly) {
        photoUrl = thumb.dataset.previewOnly;
      }
    }

    let logoUrl = get('logoUrl');
    if (!logoUrl) {
      const thumb = document.getElementById('logoPreviewThumb');
      if (thumb && thumb.dataset.previewOnly) {
        logoUrl = thumb.dataset.previewOnly;
      }
    }

    return {
      fullName: get('fullName'),
      title: get('title'),
      phone: get('phone'),
      email: get('email'),
      company: get('company'),
      photoUrl: photoUrl,
      logoUrl: logoUrl,
      website: get('website'),
      instagram: get('instagram'),
      facebook: get('facebook'),
      linkedin: get('linkedin'),
      google: get('google'),
    };
  }

  // ── Render Preview ──
  function renderPreview() {
    const data = getFormData();
    const preview = document.getElementById('signature-preview');
    if (!preview) return;

    if (!data.fullName) {
      preview.innerHTML = 'Start typing to preview your signature';
      preview.classList.add('empty');
      return;
    }

    const template = TEMPLATES[currentTemplate];
    if (!template) return;

    const html = darkPreview
      ? buildDarkPreviewHtml(template, data, style)
      : buildSignatureHtml(template, data, style);

    preview.innerHTML = html;
    preview.classList.remove('empty');
    applyDarkPreviewClass();
  }

  // Wraps the rendered template + optional compliance block + optional branding
  // in a Gmail-dark-mode-safe light island. Used by both renderPreview and
  // copyHTML so what the user sees is exactly what recipients get.
  function buildSignatureHtml(template, data, style) {
    let inner = template.render(data, style);

    const complianceHtml = buildComplianceForTemplate(template);
    if (complianceHtml) inner += complianceHtml;

    if (!isPro) {
      inner += `<table cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="margin-top: 8px; background-color: #ffffff;"><tr><td bgcolor="#ffffff" style="font-size: 9px; color: #9ca3af; font-family: Arial, sans-serif; background-color: #ffffff;">Made with <a href="https://emailsignaturegenerator.ai/" style="color: #0891B2; text-decoration: none; font-weight: 600;">emailsignaturegenerator.ai</a></td></tr></table>`;
    }
    return template._darkSafeWrap(inner);
  }

  function isDarkColor(hex) {
    const h = hex.replace('#', '');
    let r, g, b;
    if (h.length === 3) {
      r = parseInt(h[0] + h[0], 16);
      g = parseInt(h[1] + h[1], 16);
      b = parseInt(h[2] + h[2], 16);
    } else {
      r = parseInt(h.substr(0, 2), 16);
      g = parseInt(h.substr(2, 2), 16);
      b = parseInt(h.substr(4, 2), 16);
    }
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance < 0.5;
  }

  function buildDarkPreviewHtml(template, data, style) {
    let html = template.render(data, style);

    const complianceHtml = buildComplianceForTemplate(template);
    if (complianceHtml) html += complianceHtml;

    if (!isPro) {
      html += `<table cellpadding="0" cellspacing="0" border="0" style="margin-top: 8px;"><tr><td style="font-size: 9px; color: #9ca3af; font-family: Arial, sans-serif;">Made with <a href="https://emailsignaturegenerator.ai/" style="color: #0891B2; text-decoration: none; font-weight: 600;">emailsignaturegenerator.ai</a></td></tr></table>`;
    }

    // Build a list of colour swaps for the dark preview.
    const swaps = [];

    // Replace the user's chosen text colour if it's dark.
    const textLower = style.textColor.toLowerCase();
    if (isDarkColor(textLower)) {
      swaps.push({ from: textLower, to: '#e5e7eb' });
    }

    // General light → dark map.
    const colorMap = {
      '#ffffff': '#1f1f1f',
      '#fefefe': '#1f1f1f',
      '#fafafa': '#2d2d2d',
      '#f3f4f6': '#2d2d2d',
      '#f9fafb': '#2d2d2d',
      '#1e293b': '#e5e7eb',
      '#111111': '#eeeeee',
      '#000000': '#e5e7eb',
      '#000': '#e5e7eb',
      '#4b5563': '#9ca3af',
      '#6b7280': '#9ca3af',
      '#374151': '#d1d5db',
      '#e5e7eb': '#9ca3af',
      '#d1d5db': '#9ca3af',
      '#9ca3af': '#9ca3af',
    };

    Object.entries(colorMap).forEach(([from, to]) => {
      // Skip if the user's text colour already covers this source colour
      // so we don't create duplicate/conflicting swaps.
      if (from !== textLower) {
        swaps.push({ from, to });
      }
    });

    // Two-pass replacement using unique placeholders so destination colours
    // that also appear as source colours don't chain-replace.
    swaps.forEach((swap, i) => {
      const regex = new RegExp(swap.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      html = html.replace(regex, '__DARK_PREVIEW_COLOR_' + i + '__');
    });
    swaps.forEach((swap, i) => {
      html = html.replace(new RegExp('__DARK_PREVIEW_COLOR_' + i + '__', 'g'), swap.to);
    });

    return html;
  }

  function buildComplianceForTemplate(template) {
    const conf = getActiveCompliance();
    if (!conf) return '';
    return template._complianceBlock(conf, style.fontFamily);
  }

  function getActiveCompliance() {
    if (!complianceData) return null;
    const country = complianceState.country;
    const role = complianceState.role;
    if (!country || country === 'OTHER') {
      // Fall back to generic confidentiality disclaimer if user opted in without a regulated role
      if (country === 'OTHER' && complianceState.includeDisclaimer) {
        return {
          fields: [],
          disclaimer: complianceData.defaultDisclaimer || '',
        };
      }
      return null;
    }
    if (!role) return null;

    const roleEntry = complianceData.roles[role];
    if (!roleEntry) return null;
    const countryEntry = roleEntry.countries[country];
    if (!countryEntry) return null;

    const filledFields = (countryEntry.fields || []).map(f => ({
      label: f.label,
      value: (complianceState.fieldValues[f.id] || '').trim(),
    })).filter(f => f.value);

    const disclaimer = complianceState.includeDisclaimer ? (countryEntry.disclaimer || '') : '';

    if (!filledFields.length && !disclaimer) return null;

    return { fields: filledFields, disclaimer };
  }

  // ── Compliance Module ──
  function initCompliance() {
    const countrySel = document.getElementById('complianceCountry');
    const roleSel = document.getElementById('complianceRole');
    if (!countrySel || !roleSel) return;

    fetch('datasets/compliance.json')
      .then(r => {
        if (!r.ok) throw new Error('compliance.json fetch failed: ' + r.status);
        return r.json();
      })
      .then(data => {
        complianceData = data;
        populateComplianceCountries();
        bindComplianceInputs();
      })
      .catch(err => {
        console.warn('Compliance data unavailable:', err.message);
      });
  }

  function populateComplianceCountries() {
    const sel = document.getElementById('complianceCountry');
    if (!sel || !complianceData) return;
    const opts = complianceData.countries.map(c =>
      `<option value="${c.code}">${c.name}</option>`).join('');
    sel.innerHTML = '<option value="">Select country…</option>' + opts;
  }

  function populateComplianceRoles() {
    const sel = document.getElementById('complianceRole');
    if (!sel || !complianceData) return;
    const country = complianceState.country;

    if (!country) {
      sel.innerHTML = '<option value="">Select country first…</option>';
      sel.disabled = true;
      return;
    }

    if (country === 'OTHER') {
      sel.innerHTML = '<option value="">Generic confidentiality only</option>';
      sel.disabled = true;
      return;
    }

    const roles = Object.entries(complianceData.roles)
      .filter(([, r]) => r.countries[country])
      .map(([slug, r]) => `<option value="${slug}">${r.label}</option>`)
      .join('');
    sel.innerHTML = '<option value="">Select profession…</option>' + roles;
    sel.disabled = false;
  }

  function renderComplianceFields() {
    const container = document.getElementById('complianceFields');
    const discRow = document.getElementById('complianceDisclaimerRow');
    const discPreview = document.getElementById('complianceDisclaimerPreview');
    if (!container || !discRow) return;

    const { country, role } = complianceState;

    // Hide everything if country not chosen
    if (!country) {
      container.innerHTML = '';
      container.hidden = true;
      discRow.hidden = true;
      renderPreview();
      return;
    }

    // "Other" country — just a generic disclaimer toggle, no fields
    if (country === 'OTHER') {
      container.innerHTML = '';
      container.hidden = true;
      discRow.hidden = false;
      if (discPreview) discPreview.textContent = complianceData.defaultDisclaimer || '';
      renderPreview();
      return;
    }

    if (!role) {
      container.innerHTML = '';
      container.hidden = true;
      discRow.hidden = true;
      renderPreview();
      return;
    }

    const roleEntry = complianceData.roles[role];
    const countryEntry = roleEntry && roleEntry.countries[country];
    if (!countryEntry) {
      container.innerHTML = '';
      container.hidden = true;
      discRow.hidden = true;
      renderPreview();
      return;
    }

    const fieldsHtml = (countryEntry.fields || []).map(f => `
      <div class="form-group">
        <label for="${f.id}">${escapeAttr(f.label)}</label>
        <input type="text" id="${f.id}" data-compliance-field="${escapeAttr(f.id)}" placeholder="${escapeAttr(f.placeholder || '')}" value="${escapeAttr(complianceState.fieldValues[f.id] || '')}">
      </div>`).join('');

    container.innerHTML = fieldsHtml
      ? `<div class="compliance-fields-grid">${fieldsHtml}</div>`
      : '';
    container.hidden = !fieldsHtml;

    // Bind field inputs
    container.querySelectorAll('[data-compliance-field]').forEach(input => {
      input.addEventListener('input', function() {
        complianceState.fieldValues[this.dataset.complianceField] = this.value;
        renderPreview();
      });
    });

    discRow.hidden = false;
    if (discPreview) discPreview.textContent = countryEntry.disclaimer || '';

    renderPreview();
  }

  function bindComplianceInputs() {
    const countrySel = document.getElementById('complianceCountry');
    const roleSel = document.getElementById('complianceRole');
    const disclaimerChk = document.getElementById('complianceIncludeDisclaimer');

    if (countrySel) {
      countrySel.addEventListener('change', function() {
        complianceState.country = this.value;
        complianceState.role = '';
        complianceState.fieldValues = {};
        populateComplianceRoles();
        renderComplianceFields();
      });
    }

    if (roleSel) {
      roleSel.addEventListener('change', function() {
        complianceState.role = this.value;
        complianceState.fieldValues = {};
        renderComplianceFields();
      });
    }

    if (disclaimerChk) {
      disclaimerChk.addEventListener('change', function() {
        complianceState.includeDisclaimer = this.checked;
        renderPreview();
      });
    }
  }

  function escapeAttr(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // ── Validation ──
  const validators = {
    fullName: { validate: (val) => val.trim() ? '' : 'Please enter your full name.' },
    email: {
      validate: (val) => {
        if (!val.trim()) return '';
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val) ? '' : 'Please enter a valid email address.';
      },
    },
    website: { validate: urlValidator },
    linkedin: { validate: urlValidator },
    instagram: { validate: urlValidator },
    facebook: { validate: urlValidator },
    google: { validate: urlValidator },
  };

  function urlValidator(val) {
    if (!val.trim()) return '';
    return /^https?:\/\//.test(val) ? '' : 'URL must start with http:// or https://';
  }

  function validateField(id) {
    const el = document.getElementById(id);
    const errorEl = document.getElementById(id + '-error');
    const validator = validators[id];
    if (!el || !validator) return true;

    const msg = validator.validate(el.value);
    if (msg) {
      el.classList.add('input-error');
      if (errorEl) errorEl.textContent = msg;
      return false;
    } else {
      el.classList.remove('input-error');
      if (errorEl) errorEl.textContent = '';
      return true;
    }
  }

  function clearFieldError(id) {
    const el = document.getElementById(id);
    const errorEl = document.getElementById(id + '-error');
    if (el) el.classList.remove('input-error');
    if (errorEl) errorEl.textContent = '';
  }

  function bindValidation() {
    const fields = ['fullName', 'email', 'website', 'linkedin', 'instagram', 'facebook', 'google'];
    fields.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('blur', () => validateField(id));
      el.addEventListener('input', () => clearFieldError(id));
    });
  }

  function applyDarkPreviewClass() {
    const preview = document.getElementById('signature-preview');
    if (!preview) return;
    preview.classList.toggle('dark-preview', darkPreview);

    const note = document.querySelector('.preview-toolbar-note');
    if (note) {
      note.textContent = darkPreview
        ? 'Copied HTML stays Gmail dark-mode safe'
        : 'Signatures are Gmail dark-mode safe';
    }
  }

  // ── Copy Functions ──
  async function copyHTML(btn) {
    const data = getFormData();
    if (!data.fullName) {
      validateField('fullName');
      alert('Please enter your name to generate a signature.');
      return;
    }
    ['email', 'website', 'linkedin', 'instagram', 'facebook', 'google'].forEach(validateField);

    const template = TEMPLATES[currentTemplate];
    const html = buildSignatureHtml(template, data, style);

    // Plain text fallback
    const plain = [data.fullName, data.title, data.phone, data.email, data.website].filter(Boolean).join('\n');

    try {
      const blob = new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plain], { type: 'text/plain' }),
      });
      await navigator.clipboard.write([blob]);
      showCopied(btn);
    } catch (err) {
      // Fallback: select and copy from preview
      try {
        const preview = document.getElementById('signature-preview');
        const range = document.createRange();
        range.selectNodeContents(preview);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand('copy');
        sel.removeAllRanges();
        showCopied(btn);
      } catch (e) {
        alert('Could not copy. Please select the preview manually and press Ctrl+C.');
      }
    }
  }

  async function copyPlainText(btn) {
    const data = getFormData();
    if (!data.fullName) {
      validateField('fullName');
      alert('Please enter your name.');
      return;
    }
    ['email', 'website', 'linkedin', 'instagram', 'facebook', 'google'].forEach(validateField);

    const lines = [data.fullName, data.title, data.company, data.phone, data.email, data.website].filter(Boolean);

    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      showCopied(btn);
    } catch (e) {
      alert('Could not copy to clipboard.');
    }
  }

  function showCopied(btn) {
    btn.classList.add('copied');
    setTimeout(() => btn.classList.remove('copied'), 2000);
  }

  // ── Pro Unlock ──
  async function checkProStatus() {
    // 1. Try new token-based verification first
    const token = localStorage.getItem('sig_pro_token');
    if (token) {
      const result = await verifyToken(token);
      if (result.valid) {
        unlockPro();
        return;
      }
      // Token invalid or expired — clear it
      localStorage.removeItem('sig_pro_token');
    }

    // 2. Legacy fallback for existing customers (30-day grace period)
    // TODO: Remove this block after 2026-05-22 (30 days from deploy)
    const legacy = localStorage.getItem('sig_pro');
    if (legacy === 'true') {
      showLegacyMigrationBanner();
    }
  }

  async function verifyToken(token) {
    try {
      const res = await fetch('/api/verify-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token })
      });
      return await res.json();
    } catch (e) {
      return { valid: false };
    }
  }

  function unlockPro() {
    isPro = true;

    // Hide pro banner
    const banner = document.getElementById('pro-banner');
    if (banner) banner.style.display = 'none';

    // Show success toast
    showProSuccessToast();

    // Refresh upload hint copy now that hosting is unlocked
    defaultPhotoStatus();

    // Re-render to remove badges and branding
    renderTemplateGrid();
    renderPreview();
  }

  function showProSuccessToast() {
    var toast = document.createElement('div');
    toast.textContent = 'Welcome to Pro! You now have access to all 19 templates.';
    toast.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);background:#059669;color:#fff;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600;box-shadow:0 4px 12px rgba(0,0,0,0.15);z-index:9999;transition:opacity 0.5s ease;';
    document.body.appendChild(toast);
    setTimeout(function() { toast.style.opacity = '0'; }, 3000);
    setTimeout(function() { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 3500);
  }

  function showLegacyMigrationBanner() {
    // Don't show if already dismissed
    if (localStorage.getItem('sig_pro_migration_dismissed') === 'true') return;

    var banner = document.createElement('div');
    banner.id = 'legacy-migration-banner';
    banner.innerHTML = '<strong>Security upgrade:</strong> We\'ve strengthened Pro verification. ' +
      '<a href="https://buy.stripe.com/6oUeVc0ET92yauBf1sf7i00" style="color:#0f766e;text-decoration:underline;font-weight:600;">Click here to refresh your Pro access</a> ' +
      '(no charge if you already paid). ' +
      '<button id="dismiss-migration" style="margin-left:12px;background:#0f766e;color:#fff;border:none;border-radius:4px;padding:4px 10px;cursor:pointer;font-size:12px;">Dismiss</button>';
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#ccfbf1;color:#115e59;padding:12px 16px;text-align:center;font-size:13px;z-index:10000;border-bottom:1px solid #99f6e4;';
    document.body.appendChild(banner);

    document.getElementById('dismiss-migration').addEventListener('click', function() {
      localStorage.setItem('sig_pro_migration_dismissed', 'true');
      banner.remove();
    });
  }

  function showProPrompt() {
    const banner = document.getElementById('pro-banner');
    if (banner) {
      banner.style.animation = 'none';
      banner.offsetHeight; // trigger reflow
      banner.style.animation = 'pulse 0.5s ease';
      banner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

})();
