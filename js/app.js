// ── Email Signature Generator — App Logic ──

(function() {
  'use strict';

  const FACTS = window.SiteFacts;
  const CORE = window.SignatureGeneratorCore;

  // ── State ──
  let currentTemplate = 'classic';
  let currentCategory = 'all';
  let isPro = false;
  let style = CORE.createStyle();

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
      localStorage.setItem(FACTS.proTokenStorageKey, token);
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

    const previewStyle = CORE.previewStyle;

    container.innerHTML = entries.map(([id, t]) => {
      if (!t._previewHtml) {
        t._previewHtml = t.preview(previewStyle);
      }
      return `<button class="template-card${id === currentTemplate ? ' active' : ''}" data-template="${id}" aria-label="Select ${t.name} template">
        ${t.pro && !isPro ? '<span class="pro-badge">Pro</span>' : ''}
        <div class="template-preview">${t._previewHtml}</div>
        <div class="template-name">${t.name}</div>
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

  function handleProPurchase() {
    window.location.href = FACTS.paymentLink;
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

  async function handlePhotoUpload(input) {
    const file = input.files[0];
    if (!file) return;
    showCropUI(file);
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
    const outputSize = 400;

    const canvas = document.createElement('canvas');
    canvas.width = outputSize;
    canvas.height = outputSize;
    const ctx = canvas.getContext('2d');
    const sx = -cropState.x / cropState.scale;
    const sy = -cropState.y / cropState.scale;
    const sw = viewSize / cropState.scale;
    const sh = viewSize / cropState.scale;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outputSize, outputSize);

    closeCropUI();

    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    const thumb = document.getElementById('photoPreviewThumb');
    thumb.innerHTML = `<img src="${dataUrl}" alt="Photo preview">`;
    thumb.classList.add('has-photo');
    thumb.dataset.previewOnly = dataUrl;
    document.getElementById('photoUrl').value = '';
    document.getElementById('photoRemoveBtn').style.display = '';
    renderPreview();

    const token = localStorage.getItem(FACTS.proTokenStorageKey);
    if (!isPro || !token) {
      setPhotoStatus('Preview ready. Pro hosting is required for Gmail-ready photo URLs.');
      return;
    }

    setPhotoStatus('Uploading hosted photo...');
    canvas.toBlob(async function(blob) {
      try {
        const resp = await fetch('/api/upload-image', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + token,
            'Content-Type': 'image/jpeg',
            'X-Image-Type': 'photo',
          },
          body: blob,
        });

        if (!resp.ok) {
          let code = '';
          try {
            const body = await resp.json();
            code = body.code || body.error || '';
          } catch {}
          throw new Error(code);
        }

        const { url } = await resp.json();
        document.getElementById('photoUrl').value = url;
        delete thumb.dataset.previewOnly;
        setPhotoStatus('Hosted photo ready for Gmail and Outlook.', 'success');
        renderPreview();
      } catch (err) {
        setPhotoStatus(CORE.describeUploadError(err.message), 'error');
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

    const html = buildSignatureHtml(template, data, style);

    preview.innerHTML = html;
    preview.classList.remove('empty');
  }

  function buildSignatureHtml(template, data, style) {
    return CORE.buildSignatureHtml({
      template,
      data,
      style,
      isPro,
      compliance: getActiveCompliance(),
    });
  }

  function getActiveCompliance() {
    return CORE.getActiveCompliance(complianceData, complianceState);
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
    return CORE.escapeAttr(str);
  }

  // ── Validation ──
  function validateField(id) {
    const el = document.getElementById(id);
    const errorEl = document.getElementById(id + '-error');
    if (!el) return true;

    const msg = CORE.validateFieldValue(id, el.value);
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
    const plain = CORE.plainTextFromData(data);

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

    try {
      await navigator.clipboard.writeText(CORE.plainTextFromData(data));
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
    const token = localStorage.getItem(FACTS.proTokenStorageKey);
    if (token) {
      const result = await verifyToken(token);
      if (result.valid) {
        unlockPro();
        return;
      }
      // Token invalid or expired — clear it
      localStorage.removeItem(FACTS.proTokenStorageKey);
    }

    // 2. Legacy fallback for existing customers (30-day grace period)
    // TODO: Remove this block after 2026-05-22 (30 days from deploy)
    const legacy = localStorage.getItem(FACTS.legacyProStorageKey);
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
    toast.textContent = 'Welcome to Pro! You now have access to all ' + FACTS.templateCount + ' templates.';
    toast.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);background:#059669;color:#fff;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600;box-shadow:0 4px 12px rgba(0,0,0,0.15);z-index:9999;transition:opacity 0.5s ease;';
    document.body.appendChild(toast);
    setTimeout(function() { toast.style.opacity = '0'; }, 3000);
    setTimeout(function() { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 3500);
  }

  function showLegacyMigrationBanner() {
    // Don't show if already dismissed
    if (localStorage.getItem(FACTS.legacyDismissedStorageKey) === 'true') return;

    var banner = document.createElement('div');
    banner.id = 'legacy-migration-banner';
    banner.innerHTML = '<strong>Security upgrade:</strong> We\'ve strengthened Pro verification. ' +
      '<a href="' + FACTS.paymentLink + '" style="color:#0f766e;text-decoration:underline;font-weight:600;">Click here to refresh your Pro access</a> ' +
      '(no charge if you already paid). ' +
      '<button id="dismiss-migration" style="margin-left:12px;background:#0f766e;color:#fff;border:none;border-radius:4px;padding:4px 10px;cursor:pointer;font-size:12px;">Dismiss</button>';
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#ccfbf1;color:#115e59;padding:12px 16px;text-align:center;font-size:13px;z-index:10000;border-bottom:1px solid #99f6e4;';
    document.body.appendChild(banner);

    document.getElementById('dismiss-migration').addEventListener('click', function() {
      localStorage.setItem(FACTS.legacyDismissedStorageKey, 'true');
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
