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
    initCompliance();
    renderPreview();

    // Check for pro unlock via URL param (post-Stripe redirect)
    const params = new URLSearchParams(window.location.search);
    if (params.get('pro') === 'true' || localStorage.getItem('sig_pro') === 'true') {
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
        <span class="dark-safe-badge" title="Renders correctly in Gmail dark mode">Dark-safe</span>
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
        applyDarkPreviewClass();
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

    if (copyHtmlBtn) copyHtmlBtn.addEventListener('click', function() { copyHTML(this); });
    if (copyTextBtn) copyTextBtn.addEventListener('click', function() { copyPlainText(this); });
    if (buyProBtn) buyProBtn.addEventListener('click', handleProPurchase);
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
  function handlePhotoUpload(input) {
    const file = input.files[0];
    if (!file) return;
    showCropUI(file);
  }

  function setPhotoStatus(state) {
    const hint = document.getElementById('photoUploadHint');
    if (!hint) return;
    const msgs = {
      idle: 'Drop or click to upload. We host it for you.',
      uploading: 'Uploading…',
      done: 'Photo hosted — ready for Gmail and Outlook.',
      error: 'Upload failed. Preview only — paste a URL above for email clients.',
    };
    hint.textContent = msgs[state] || '';
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

    setPhotoStatus('idle');
    renderPreview();
  }

  // ── Photo Crop ──
  const cropState = { file: null, scale: 1, x: 0, y: 0, dragging: false, lastX: 0, lastY: 0, naturalW: 0, naturalH: 0 };
  let cropHandlersReady = false;

  function showCropUI(file) {
    if (!cropHandlersReady) { initCropHandlers(); cropHandlersReady = true; }
    cropState.file = file;

    const img = document.getElementById('cropImage');
    const viewport = document.getElementById('cropViewport');
    const blobUrl = URL.createObjectURL(file);

    img.onload = function() {
      cropState.naturalW = img.naturalWidth;
      cropState.naturalH = img.naturalHeight;
      const viewSize = viewport.offsetWidth;
      // Scale so the shorter side fills the viewport
      cropState.scale = viewSize / Math.min(img.naturalWidth, img.naturalHeight);
      // Center the image
      cropState.x = (viewSize - img.naturalWidth * cropState.scale) / 2;
      cropState.y = (viewSize - img.naturalHeight * cropState.scale) / 2;
      updateCropTransform();
    };
    img.src = blobUrl;
    document.getElementById('cropModal').style.display = 'flex';
  }

  function updateCropTransform() {
    const img = document.getElementById('cropImage');
    const viewport = document.getElementById('cropViewport');
    const viewSize = viewport.offsetWidth;
    const scaledW = cropState.naturalW * cropState.scale;
    const scaledH = cropState.naturalH * cropState.scale;
    // Clamp so image always covers the viewport
    cropState.x = Math.min(0, Math.max(viewSize - scaledW, cropState.x));
    cropState.y = Math.min(0, Math.max(viewSize - scaledH, cropState.y));
    img.style.width = scaledW + 'px';
    img.style.height = scaledH + 'px';
    img.style.left = cropState.x + 'px';
    img.style.top = cropState.y + 'px';
  }

  function closeCropUI() {
    const modal = document.getElementById('cropModal');
    modal.style.display = 'none';
    const img = document.getElementById('cropImage');
    if (img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
    // Reset file input so re-selecting the same file triggers change again
    document.getElementById('photoFile').value = '';
  }

  async function applyCrop() {
    const viewport = document.getElementById('cropViewport');
    const img = document.getElementById('cropImage');
    const viewSize = viewport.offsetWidth;

    const canvas = document.createElement('canvas');
    canvas.width = viewSize;
    canvas.height = viewSize;
    const ctx = canvas.getContext('2d');
    const sx = -cropState.x / cropState.scale;
    const sy = -cropState.y / cropState.scale;
    const sw = viewSize / cropState.scale;
    const sh = viewSize / cropState.scale;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, viewSize, viewSize);

    closeCropUI();

    // Show preview immediately from canvas
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    const thumb = document.getElementById('photoPreviewThumb');
    thumb.innerHTML = `<img src="${dataUrl}" alt="Photo preview">`;
    thumb.classList.add('has-photo');
    document.getElementById('photoRemoveBtn').style.display = '';
    renderPreview();

    // Upload the cropped image
    setPhotoStatus('uploading');
    canvas.toBlob(async function(blob) {
      try {
        const fd = new FormData();
        fd.append('photo', new File([blob], cropState.file.name, { type: 'image/jpeg' }));
        const resp = await fetch('/api/upload', { method: 'POST', body: fd });
        if (!resp.ok) throw new Error(await resp.text());
        const { url } = await resp.json();
        document.getElementById('photoUrl').value = url;
        setPhotoStatus('done');
        renderPreview();
      } catch {
        setPhotoStatus('error');
      }
    }, 'image/jpeg', 0.92);
  }

  function initCropHandlers() {
    const viewport = document.getElementById('cropViewport');

    document.getElementById('cropCancel').addEventListener('click', closeCropUI);
    document.getElementById('cropApply').addEventListener('click', applyCrop);

    // Mouse drag
    viewport.addEventListener('mousedown', function(e) {
      cropState.dragging = true;
      cropState.lastX = e.clientX;
      cropState.lastY = e.clientY;
      viewport.classList.add('dragging');
      e.preventDefault();
    });
    document.addEventListener('mousemove', function(e) {
      if (!cropState.dragging) return;
      cropState.x += e.clientX - cropState.lastX;
      cropState.y += e.clientY - cropState.lastY;
      cropState.lastX = e.clientX;
      cropState.lastY = e.clientY;
      updateCropTransform();
    });
    document.addEventListener('mouseup', function() {
      cropState.dragging = false;
      viewport.classList.remove('dragging');
    });

    // Scroll to zoom
    viewport.addEventListener('wheel', function(e) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.92 : 1.08;
      const viewSize = viewport.offsetWidth;
      const cx = viewSize / 2;
      const cy = viewSize / 2;
      cropState.x = cx - (cx - cropState.x) * delta;
      cropState.y = cy - (cy - cropState.y) * delta;
      cropState.scale *= delta;
      const minScale = Math.max(viewSize / cropState.naturalW, viewSize / cropState.naturalH);
      if (cropState.scale < minScale) cropState.scale = minScale;
      updateCropTransform();
    }, { passive: false });

    // Touch drag + pinch zoom
    let lastTouchDist = null;
    viewport.addEventListener('touchstart', function(e) {
      if (e.touches.length === 1) {
        cropState.dragging = true;
        cropState.lastX = e.touches[0].clientX;
        cropState.lastY = e.touches[0].clientY;
      } else if (e.touches.length === 2) {
        lastTouchDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
      }
      e.preventDefault();
    }, { passive: false });

    viewport.addEventListener('touchmove', function(e) {
      e.preventDefault();
      const viewSize = viewport.offsetWidth;
      if (e.touches.length === 1 && cropState.dragging) {
        cropState.x += e.touches[0].clientX - cropState.lastX;
        cropState.y += e.touches[0].clientY - cropState.lastY;
        cropState.lastX = e.touches[0].clientX;
        cropState.lastY = e.touches[0].clientY;
        updateCropTransform();
      } else if (e.touches.length === 2) {
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        if (lastTouchDist) {
          const delta = dist / lastTouchDist;
          const cx = viewSize / 2;
          const cy = viewSize / 2;
          cropState.x = cx - (cx - cropState.x) * delta;
          cropState.y = cy - (cy - cropState.y) * delta;
          cropState.scale *= delta;
          const minScale = Math.max(viewSize / cropState.naturalW, viewSize / cropState.naturalH);
          if (cropState.scale < minScale) cropState.scale = minScale;
          updateCropTransform();
        }
        lastTouchDist = dist;
      }
    }, { passive: false });

    viewport.addEventListener('touchend', function() {
      cropState.dragging = false;
      lastTouchDist = null;
    });
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

    const html = buildSignatureHtml(template, data, style);

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
    return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function applyDarkPreviewClass() {
    const preview = document.getElementById('signature-preview');
    if (!preview) return;
    preview.classList.toggle('dark-preview', darkPreview);
  }

  // ── Copy Functions ──
  async function copyHTML(btn) {
    const data = getFormData();
    if (!data.fullName) {
      alert('Please enter your name to generate a signature.');
      return;
    }

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
