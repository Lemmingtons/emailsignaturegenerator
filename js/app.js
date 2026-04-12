// ── Email Signature Generator — App Logic ──

(function() {
  'use strict';

  // ── State ──
  let currentTemplate = 'classic';
  let currentCategory = 'all';
  let isPro = false; // Set to true after Stripe payment

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

  // ── Init ──
  document.addEventListener('DOMContentLoaded', function() {
    renderCategoryTabs();
    renderTemplateGrid();
    bindFormInputs();
    bindStyleControls();
    bindButtons();
    renderPreview();

    // Check for pro unlock via URL param (post-Stripe redirect)
    const params = new URLSearchParams(window.location.search);
    if (params.get('pro') === 'true' || params.get('pro') === 'checkout' || localStorage.getItem('sig_pro') === 'true') {
      unlockPro();
    }

    // Clean up URL params after processing
    if (params.has('pro')) {
      window.history.replaceState({}, '', window.location.pathname);
    }
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

    container.innerHTML = entries.map(([id, t]) =>
      `<button class="template-card${id === currentTemplate ? ' active' : ''}" data-template="${id}" aria-label="Select ${t.name} template">
        ${t.pro && !isPro ? '<span class="pro-badge">Pro</span>' : ''}
        <div class="template-preview">${t.icon}</div>
        <div class="template-name">${t.name}</div>
      </button>`
    ).join('');

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
    const fields = ['fullName', 'title', 'email', 'phone', 'company', 'website', 'instagram', 'facebook', 'linkedin', 'photoUrl'];
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

    if (copyHtmlBtn) copyHtmlBtn.addEventListener('click', function() { copyHTML(this); });
    if (copyTextBtn) copyTextBtn.addEventListener('click', function() { copyPlainText(this); });
    if (buyProBtn) buyProBtn.addEventListener('click', handleProPurchase);
  }

  // ── Pro Purchase ──
  // TODO: Replace this URL with your actual Stripe Payment Link once created.
  // Create one at https://dashboard.stripe.com/payment-links
  // Set the success URL to: https://emailsignaturegenerator.ai/generator.html?pro=true
  const STRIPE_PAYMENT_LINK = '';

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
  function handlePhotoUpload(input) {
    const file = input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
      const dataUri = e.target.result;
      const thumb = document.getElementById('photoPreviewThumb');
      thumb.innerHTML = `<img src="${dataUri}" alt="Photo">`;
      thumb.classList.add('has-photo');

      const removeBtn = document.getElementById('photoRemoveBtn');
      if (removeBtn) removeBtn.style.display = '';

      if (!document.getElementById('photoUrl').value.trim()) {
        thumb.dataset.previewOnly = dataUri;
      }
      renderPreview();
    };
    reader.readAsDataURL(file);
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

    return {
      fullName: get('fullName'),
      title: get('title'),
      phone: get('phone'),
      email: get('email'),
      company: get('company'),
      photoUrl: photoUrl,
      website: get('website'),
      instagram: get('instagram'),
      facebook: get('facebook'),
      linkedin: get('linkedin'),
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

    let html = template.render(data, style);

    // Add free branding if not pro
    if (!isPro) {
      html += `<table cellpadding="0" cellspacing="0" border="0" style="margin-top: 8px;"><tr><td style="font-size: 9px; color: #9ca3af; font-family: Arial, sans-serif;">Made with <a href="https://emailsignaturegenerator.ai/" style="color: #0891B2; text-decoration: none; font-weight: 600;">emailsignaturegenerator.ai</a></td></tr></table>`;
    }

    preview.innerHTML = html;
    preview.classList.remove('empty');
  }

  // ── Copy Functions ──
  async function copyHTML(btn) {
    const data = getFormData();
    if (!data.fullName) {
      alert('Please enter your name to generate a signature.');
      return;
    }

    const template = TEMPLATES[currentTemplate];
    let html = template.render(data, style);

    if (!isPro) {
      html += `<table cellpadding="0" cellspacing="0" border="0" style="margin-top: 8px;"><tr><td style="font-size: 9px; color: #9ca3af; font-family: Arial, sans-serif;">Made with <a href="https://emailsignaturegenerator.ai/" style="color: #0891B2; text-decoration: none; font-weight: 600;">emailsignaturegenerator.ai</a></td></tr></table>`;
    }

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
      alert('Please enter your name.');
      return;
    }

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
  function unlockPro() {
    isPro = true;
    localStorage.setItem('sig_pro', 'true');

    // Hide pro banner
    const banner = document.getElementById('pro-banner');
    if (banner) banner.style.display = 'none';

    // Re-render to remove badges and branding
    renderTemplateGrid();
    renderPreview();
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

  // ── Expose for Stripe callback ──
  window.unlockPro = unlockPro;

})();
