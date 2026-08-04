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

  function updateLiveStatus(el, text, kind) {
    if (!el) return;
    el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    el.setAttribute('aria-live', kind === 'error' ? 'assertive' : 'polite');
    el.setAttribute('aria-atomic', 'true');
    el.textContent = text;
    el.style.color = kind === 'error' ? '#b91c1c' : kind === 'success' ? '#059669' : '';
  }

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
    bindPhotoEffect();
    bindCtaAnimation();
    bindDividerAnimation();
    bindCardControls();
    initPreviewDock();
    initCompliance();
    renderPreview();

    // Read every URL param up front: handling the Pro token rewrites the query
    // string, which would otherwise discard a saved-signature id in the same link.
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    const savedSignatureId = params.get('s');

    if (token) {
      localStorage.setItem(FACTS.proTokenStorageKey, token);
      window.history.replaceState({}, '', window.location.pathname + (savedSignatureId ? '?s=' + encodeURIComponent(savedSignatureId) : ''));
    }

    // Verify Pro status from the server-backed signed token.
    checkProStatus();

    // Reopening a saved signature is independent of Pro status — the link itself
    // is the credential.
    restoreSignatureFromLink(savedSignatureId);
  });

  // ── Category Tabs ──
  function renderCategoryTabs() {
    const container = document.getElementById('category-tabs');
    if (!container) return;
    container.innerHTML = CATEGORIES.map(cat =>
      `<button type="button" class="category-tab${cat.id === currentCategory ? ' active' : ''}" data-category="${cat.id}" aria-pressed="${cat.id === currentCategory}">${cat.name}</button>`
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
      // Every template is available to build with. Payment gates export, not design.
      return `<button type="button" class="template-card${id === currentTemplate ? ' active' : ''}" data-template="${id}" aria-pressed="${id === currentTemplate}" aria-label="${t.name} template">
        <div class="template-preview">${t._previewHtml}</div>
        <div class="template-name">${t.name}</div>
      </button>`;
    }).join('');

    container.querySelectorAll('.template-card').forEach(card => {
      card.addEventListener('click', function() {
        currentTemplate = this.dataset.template;
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
    if (ctaText) ctaText.addEventListener('input', function() { style.ctaText = this.value; renderPreview(); scheduleCtaRebuild(); });
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
      if (pickerId === 'primaryColor') { schedulePhotoRebuild('accent'); scheduleCtaRebuild(); scheduleDividerRebuild(); }
    });

    if (hex) {
      hex.addEventListener('input', function() {
        const val = this.value.startsWith('#') ? this.value : '#' + this.value;
        if (/^#[0-9a-fA-F]{6}$/.test(val)) {
          style[pickerId] = val;
          picker.value = val;
          renderPreview();
          if (pickerId === 'primaryColor') { schedulePhotoRebuild('accent'); scheduleCtaRebuild(); scheduleDividerRebuild(); }
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
        if (styleKey === 'photoShape') schedulePhotoRebuild('shape');
        if (styleKey === 'dividerStyle') scheduleDividerRebuild();
      });
    });
  }

  // Photo shape and accent colour are baked into the pixels, so the stored photo
  // has to be rebuilt when they change. Debounced because the colour picker fires
  // continuously while dragging.
  //
  // Shape now affects the still as well as the animation, because the still carries
  // its own baked mask for Outlook's benefit. Accent colour only reaches the pixels
  // through the ring animation, so a still needs no rebuild for it.
  let animatedRebuildTimer = null;

  function schedulePhotoRebuild(trigger) {
    const animated = selectedPhotoEffect() !== 'none' && isPro;
    if (!photoState.primaryCanvas) return;
    // Accent colour and name only reach the pixels through an animation — the ring
    // effects use the accent, the monogram reveal uses both. A still needs neither.
    if ((trigger === 'accent' || trigger === 'name') && !animated) return;
    if (trigger === 'name' && selectedPhotoEffect() !== 'monogram') return;

    clearTimeout(animatedRebuildTimer);
    setPhotoStatus(animated ? 'Animation will rebuild...' : 'Photo will rebuild...');
    animatedRebuildTimer = setTimeout(function() {
      regeneratePhotoAsset();
    }, 700);
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

    const saveLinkBtn = document.getElementById('saveLinkBtn');
    if (saveLinkBtn) saveLinkBtn.addEventListener('click', function() { saveSignatureLink(this); });
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

  function initPreviewDock() {
    const grid = document.querySelector('.generator-grid');
    const column = document.querySelector('.preview-column');
    const preview = document.querySelector('.preview-sticky');
    if (!grid || !column || !preview) return;

    let ticking = false;
    const topOffset = 80;

    function clearDock() {
      preview.style.position = '';
      preview.style.top = '';
      preview.style.left = '';
      preview.style.width = '';
      preview.style.zIndex = '';
    }

    function placeAtBottom(gridRect, columnRect, previewHeight) {
      const columnTop = columnRect.top + window.scrollY;
      const gridBottom = gridRect.bottom + window.scrollY;
      const top = Math.max(0, gridBottom - columnTop - previewHeight);

      preview.style.position = 'absolute';
      preview.style.top = top + 'px';
      preview.style.left = '';
      preview.style.width = columnRect.width + 'px';
      preview.style.zIndex = '40';
    }

    function placeFixed(columnRect) {
      preview.style.position = 'fixed';
      preview.style.top = topOffset + 'px';
      preview.style.left = columnRect.left + 'px';
      preview.style.width = columnRect.width + 'px';
      preview.style.zIndex = '40';
    }

    function updateDock() {
      ticking = false;

      if (window.innerWidth <= 900) {
        clearDock();
        return;
      }

      const gridRect = grid.getBoundingClientRect();
      const columnRect = column.getBoundingClientRect();
      const previewHeight = preview.offsetHeight;

      if (gridRect.height <= previewHeight || gridRect.top > topOffset) {
        clearDock();
        return;
      }

      if (gridRect.bottom - previewHeight <= topOffset) {
        placeAtBottom(gridRect, columnRect, previewHeight);
        return;
      }

      placeFixed(columnRect);
    }

    function requestDockUpdate() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(updateDock);
    }

    window.addEventListener('scroll', requestDockUpdate, { passive: true });
    window.addEventListener('resize', requestDockUpdate);
    if ('ResizeObserver' in window) {
      const observer = new ResizeObserver(requestDockUpdate);
      observer.observe(grid);
      observer.observe(column);
      observer.observe(preview);
    }
    updateDock();
  }

  function handleProPurchase() {
    window.location.href = FACTS.paymentLink;
  }

  // ── Photo Handling ──

  // Default hint copy when the user hasn't done anything yet — restored on remove.
  const PHOTO_STATUS_DEFAULT_UNPAID = 'Upload to preview. Hosting for Gmail unlocks when you buy.';
  const PHOTO_STATUS_DEFAULT_PAID = 'Upload — we\'ll host it for Gmail-ready use.';

  function setPhotoStatus(text, kind) {
    updateLiveStatus(document.getElementById('photoStatusHint'), text, kind);
  }

  function defaultPhotoStatus() {
    setPhotoStatus(isPro ? PHOTO_STATUS_DEFAULT_PAID : PHOTO_STATUS_DEFAULT_UNPAID);
  }

  // ── Card page ──
  //
  // The public page the signature's name can point at. Publishing is deliberately
  // gated twice: on Pro, and on an explicit tick-box, because the page carries the
  // customer's real phone and email and is meant to be indexed. Nothing here runs
  // on its own — a card only ever exists because someone pressed the button.

  const CARD_SLUG_STORAGE_KEY = 'esg_card_slug';

  function setCardStatus(text, kind) {
    updateLiveStatus(document.getElementById('cardStatusHint'), text, kind);
  }

  // Reflects the three things that gate the button — Pro, consent, and a name —
  // and keeps the published URL and Unpublish button in step with cardState.
  function syncCardControls() {
    const consent = document.getElementById('cardPageConsent');
    const publishBtn = document.getElementById('cardPublishBtn');
    const unpublishBtn = document.getElementById('cardUnpublishBtn');
    const urlEl = document.getElementById('cardPageUrl');
    if (!consent || !publishBtn) return;

    const named = !!(document.getElementById('fullName') || {}).value;
    publishBtn.disabled = !(isPro && consent.checked && named);
    publishBtn.textContent = cardState.slug ? 'Update card page' : 'Publish card page';

    if (unpublishBtn) unpublishBtn.style.display = cardState.slug ? '' : 'none';

    if (urlEl) {
      if (cardState.url) {
        urlEl.style.display = '';
        urlEl.innerHTML = '';
        const a = document.createElement('a');
        a.href = cardState.url;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = cardState.url;
        urlEl.appendChild(a);
      } else {
        urlEl.style.display = 'none';
        urlEl.textContent = '';
      }
    }
  }

  function bindCardControls() {
    const consent = document.getElementById('cardPageConsent');
    const publishBtn = document.getElementById('cardPublishBtn');
    const unpublishBtn = document.getElementById('cardUnpublishBtn');
    const target = document.getElementById('nameLinkTarget');

    if (consent) consent.addEventListener('change', syncCardControls);
    if (publishBtn) publishBtn.addEventListener('click', publishCardPage);
    if (unpublishBtn) unpublishBtn.addEventListener('click', unpublishCardPage);
    if (target) target.addEventListener('change', function() {
      renderPreview();
      if (this.value === 'card' && !cardState.url) {
        setCardStatus('Publish your card page and the name link will point at it.', 'error');
      } else if (cardState.url) {
        setCardStatus('Card page is live.', 'success');
      } else {
        // Clear the prompt again when the name stops pointing at a card page, so a
        // stale warning does not sit under an unrelated choice.
        setCardStatus(isPro ? 'Tick the box above, then publish whenever you\'re ready.' : 'Publishing unlocks when you buy.');
      }
    });

    const name = document.getElementById('fullName');
    if (name) name.addEventListener('input', function() {
      syncCardControls();
      // The monogram reveal draws the initials into the GIF, so a name change has
      // to re-encode it. Every other effect ignores this.
      schedulePhotoRebuild('name');
    });

    const savedSlug = localStorage.getItem(CARD_SLUG_STORAGE_KEY);
    if (savedSlug) {
      cardState.slug = savedSlug;
      cardState.url = `${window.location.origin}/c/${savedSlug}`;
      if (consent) consent.checked = true;
    }
    syncCardControls();
  }

  async function publishCardPage() {
    const token = localStorage.getItem(FACTS.proTokenStorageKey);
    if (!isPro || !token) {
      setCardStatus(`A card page unlocks with your ${FACTS.proPrice.displayWithCurrency} purchase.`, 'error');
      showProPrompt();
      return;
    }

    const data = getFormData();
    if (!data.fullName) {
      setCardStatus('Add your name before publishing.', 'error');
      return;
    }

    // A preview-only data: URI cannot be fetched by anyone else, so the card would
    // render with a broken photo. Only a hosted URL is worth sending.
    const photoUrl = /^https?:\/\//.test(data.photoUrl || '') ? data.photoUrl : '';

    setCardStatus('Publishing...');
    try {
      const resp = await fetch('/api/card', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: cardState.slug || undefined,
          fullName: data.fullName,
          title: data.title,
          company: data.company,
          phone: data.phone,
          email: data.email,
          website: data.website,
          linkedin: data.linkedin,
          instagram: data.instagram,
          facebook: data.facebook,
          google: data.google,
          photoUrl: photoUrl,
        }),
      });

      if (!resp.ok) {
        let code = '';
        try {
          const body = await resp.json();
          code = body.code || body.error || '';
        } catch {}
        // A stored slug that the server no longer recognises would otherwise wedge
        // the button forever, so drop it and let the next press mint a fresh page.
        if (code === 'not_found' || code === 'not_your_card') {
          cardState.slug = '';
          cardState.url = '';
          localStorage.removeItem(CARD_SLUG_STORAGE_KEY);
          syncCardControls();
          setCardStatus('That card page is gone. Press publish again to create a new one.', 'error');
          return;
        }
        throw new Error(code);
      }

      const { slug, url } = await resp.json();
      cardState.slug = slug;
      cardState.url = url;
      localStorage.setItem(CARD_SLUG_STORAGE_KEY, slug);
      syncCardControls();
      setCardStatus('Card page is live.', 'success');
      renderPreview();
    } catch (err) {
      setCardStatus(CORE.describeUploadError(err.message), 'error');
    }
  }

  async function unpublishCardPage() {
    const token = localStorage.getItem(FACTS.proTokenStorageKey);
    if (!cardState.slug || !token) return;

    setCardStatus('Removing...');
    try {
      const resp = await fetch('/api/card/' + encodeURIComponent(cardState.slug), {
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer ' + token },
      });
      // A card that is already gone is the outcome the button asked for, so a 404
      // is treated as success rather than an error the customer has to interpret.
      if (!resp.ok && resp.status !== 404) throw new Error('unpublish_failed');

      cardState.slug = '';
      cardState.url = '';
      localStorage.removeItem(CARD_SLUG_STORAGE_KEY);
      syncCardControls();
      setCardStatus('Card page removed.', 'success');
      renderPreview();
    } catch {
      setCardStatus('Could not remove the card page. Try again.', 'error');
    }
  }

  // ── Shared hosted-image upload ──
  // Every image slot (photo, logo) goes through here so hosting rules stay in one place.
  // Throws an Error whose message is an upload error code from CORE.describeUploadError.
  async function uploadImageBlob(blob, slot) {
    const token = localStorage.getItem(FACTS.proTokenStorageKey);
    if (!isPro || !token) throw new Error('not_pro');

    const resp = await fetch('/api/upload-image', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': blob.type || 'application/octet-stream',
        'X-Image-Type': slot,
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
    return url;
  }

  async function handlePhotoUpload(input) {
    const file = input.files[0];
    if (!file) return;
    showCropUI(file, 'primary', input);
  }

  function removePhoto() {
    document.getElementById('photoUrl').value = '';
    document.getElementById('photoFile').value = '';

    photoState.primaryCanvas = null;
    photoState.secondaryCanvas = null;

    const effectSelect = document.getElementById('photoEffect');
    if (effectSelect) effectSelect.value = 'none';
    const secondGroup = document.getElementById('photoSecondGroup');
    if (secondGroup) secondGroup.style.display = 'none';
    const secondThumb = document.getElementById('photoSecondThumb');
    if (secondThumb) {
      secondThumb.innerHTML = '<span class="photo-placeholder">No 2nd photo</span>';
      secondThumb.classList.remove('has-photo');
    }

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

  const LOGO_STATUS_DEFAULT_UNPAID = 'Upload to preview. Hosting for Gmail unlocks when you buy.';
  const LOGO_STATUS_DEFAULT_PAID = 'Upload — we\'ll host it for Gmail-ready use.';
  // Longest side of a stored logo. Keeps hosted files small; templates render far smaller.
  const LOGO_MAX_EDGE = 400;

  function setLogoStatus(text, kind) {
    updateLiveStatus(document.getElementById('logoStatusHint'), text, kind);
  }

  function defaultLogoStatus() {
    setLogoStatus(isPro ? LOGO_STATUS_DEFAULT_PAID : LOGO_STATUS_DEFAULT_UNPAID);
  }

  // Draws the logo onto a canvas capped at LOGO_MAX_EDGE, preserving aspect ratio.
  // PNG output so logos with transparency survive.
  function logoCanvasFromImage(img) {
    const scale = Math.min(1, LOGO_MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  function handleLogoUpload(input) {
    const file = input.files[0];
    if (!file) return;

    const thumb = document.getElementById('logoPreviewThumb');
    if (!thumb) return;

    const blobUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = function() {
      URL.revokeObjectURL(blobUrl);

      const canvas = logoCanvasFromImage(img);
      const dataUri = canvas.toDataURL('image/png');

      const preview = document.createElement('img');
      preview.src = dataUri;
      preview.alt = 'Logo';
      thumb.replaceChildren(preview);
      thumb.classList.add('has-logo');

      const removeBtn = document.getElementById('logoRemoveBtn');
      if (removeBtn) removeBtn.style.display = '';

      // Only fall back to the inline preview when no hosted URL is set. Data URIs are
      // stripped by Gmail and Outlook, so this is a preview aid, never a shippable src.
      document.getElementById('logoUrl').value = '';
      thumb.dataset.previewOnly = dataUri;
      renderPreview();

      if (!isPro || !localStorage.getItem(FACTS.proTokenStorageKey)) {
        setLogoStatus('Preview ready. Hosting for Gmail unlocks when you buy.');
        return;
      }

      setLogoStatus('Uploading hosted logo...');
      canvas.toBlob(async function(blob) {
        try {
          const url = await uploadImageBlob(blob, 'logo');
          document.getElementById('logoUrl').value = url;
          delete thumb.dataset.previewOnly;
          setLogoStatus('Hosted logo ready for Gmail and Outlook.', 'success');
          renderPreview();
        } catch (err) {
          setLogoStatus(CORE.describeUploadError(err.message), 'error');
        }
      }, 'image/png');
    };

    img.onerror = function() {
      URL.revokeObjectURL(blobUrl);
      setLogoStatus('That file could not be read as an image.', 'error');
    };

    img.src = blobUrl;
    // Reset so re-selecting the same file fires change again
    input.value = '';
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

    defaultLogoStatus();
    renderPreview();
  }

  // ── Photo Crop ──
  const cropState = { file: null, slot: 'primary', scale: 1, x: 0, y: 0, dragging: false, lastX: 0, lastY: 0, naturalW: 0, naturalH: 0 };
  let cropHandlersReady = false;
  let cropReturnFocus = null;

  // `slot` is 'primary' for the signature photo, or 'secondary' for the second
  // frame of a crossfade animation.
  function showCropUI(file, slot, trigger) {
    if (!cropHandlersReady) { initCropHandlers(); cropHandlersReady = true; }
    cropReturnFocus = trigger || (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    cropState.file = file;
    cropState.slot = slot || 'primary';

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
    const modal = document.getElementById('cropModal');
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
    document.getElementById('cropModalTitle').focus();
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
    if (!modal || modal.getAttribute('aria-hidden') === 'true') return;
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
    const img = document.getElementById('cropImage');
    if (img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
    // Reset file inputs so re-selecting the same file triggers change again
    document.getElementById('photoFile').value = '';
    const secondFile = document.getElementById('photoSecondFile');
    if (secondFile) secondFile.value = '';
    if (cropReturnFocus && document.contains(cropReturnFocus)) cropReturnFocus.focus();
    cropReturnFocus = null;
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

    const slot = cropState.slot;
    closeCropUI();

    if (slot === 'secondary') {
      photoState.secondaryCanvas = canvas;
      const thumb = document.getElementById('photoSecondThumb');
      if (thumb) {
        thumb.innerHTML = `<img src="${canvas.toDataURL('image/jpeg', 0.9)}" alt="Second photo preview">`;
        thumb.classList.add('has-photo');
      }
      await regeneratePhotoAsset();
      return;
    }

    photoState.primaryCanvas = canvas;
    document.getElementById('photoRemoveBtn').style.display = '';
    await regeneratePhotoAsset();
  }

  // ── Photo asset pipeline ──
  //
  // One place decides what the photo actually becomes: a still JPEG, or an animated
  // GIF built from the chosen effect. Both paths end with a hosted URL for Pro users
  // and a preview-only data URI otherwise.

  const photoState = { primaryCanvas: null, secondaryCanvas: null };

  // Square edge of the generated GIF. The largest photo any template renders is
  // 100px (Executive), so 200 is a true 2x for every template rather than the 1.6x
  // that 160 gave the biggest one. Files stay well inside the 3 MB upload cap.
  const ANIMATED_PHOTO_SIZE = 200;

  // ── Loop policy ──
  //
  // Animations repeat, but they rest between passes: one pass, then five seconds
  // holding the resting frame, forever. Two reasons this beats playing once:
  //
  // - A GIF starts when it decodes, not when it is looked at. In a long email the
  //   signature sits below the fold, so a play-once animation finishes before the
  //   reader ever scrolls to it.
  // - Continuous motion reads as an advert, and a long thread shows the signature
  //   many times at once.
  //
  // The pause is effectively free: a held frame is identical to its predecessor, so
  // frame differencing collapses it to a single transparent pixel.
  const ANIMATION_HOLD_CS = 500; // hundredths of a second

  // Encodes a finished frame sequence with the signature loop policy applied.
  // `canLoop` is false for one-way effects such as the two-photo crossfade, which
  // ends somewhere different from where it started and would jump on repeat.
  function encodeSignatureGif({ frames, width, height, delay, canLoop }) {
    if (!canLoop) {
      return GifEncoder.encode({ width, height, frames, delay, loop: false, dither: false });
    }

    return GifEncoder.encode({
      width,
      height,
      frames: frames.concat([frames[0]]),
      delay: frames.map(() => delay).concat([ANIMATION_HOLD_CS]),
      loop: true,
      dither: false,
    });
  }

  function selectedPhotoEffect() {
    const el = document.getElementById('photoEffect');
    return el ? el.value : 'none';
  }

  // Bakes the chosen photo shape into the still that gets stored and pasted.
  // Without this the shape lives only in the template's CSS `border-radius`, which
  // classic Outlook ignores, so every circular photo lands there as a hard square.
  // Square photos need no mask, and a missing PhotoAnimator degrades to the
  // unshaped canvas rather than losing the photo altogether.
  function shapedStillCanvas(source) {
    const shape = style.photoShape || 'circle';
    if (shape === 'square' || !window.PhotoAnimator || !PhotoAnimator.shapeStill) return source;

    const size = source.width;
    const shaped = document.createElement('canvas');
    shaped.width = size;
    shaped.height = size;
    const ctx = shaped.getContext('2d');
    ctx.drawImage(source, 0, 0);

    try {
      const image = ctx.getImageData(0, 0, size, size);
      image.data.set(PhotoAnimator.shapeStill({
        photo: image.data,
        size,
        shape,
        // Matches the white background the templates already force for dark-mode
        // safety, so the matte is invisible against the signature.
        background: '#ffffff',
      }));
      ctx.putImageData(image, 0, 0);
    } catch {
      return source;
    }

    return shaped;
  }

  // Draws the initials tile the monogram animation dissolves from. Lives here
  // rather than in PhotoAnimator because drawing glyphs needs a font, and that
  // module is kept to pure pixel maths so it runs the same under Node.
  function monogramRgba(size) {
    const name = (document.getElementById('fullName') || {}).value || '';
    const words = String(name).trim().split(/\s+/).filter(Boolean);
    const initials = (words.length
      ? (words.length === 1 ? words[0].slice(0, 1) : words[0].slice(0, 1) + words[words.length - 1].slice(0, 1))
      : '·').toUpperCase();

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = style.primaryColor || '#0891B2';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#ffffff';
    ctx.font = `600 ${Math.round(size * 0.36)}px Georgia, 'Times New Roman', serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Georgia's optical centre sits slightly below the geometric one.
    ctx.fillText(initials, size / 2, size / 2 + size * 0.02);

    return ctx.getImageData(0, 0, size, size).data;
  }

  function canvasToRgba(source, size) {
    const scaled = document.createElement('canvas');
    scaled.width = size;
    scaled.height = size;
    const ctx = scaled.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, size, size);
    return ctx.getImageData(0, 0, size, size).data;
  }

  function showPhotoPreview(dataUrl) {
    const thumb = document.getElementById('photoPreviewThumb');
    thumb.innerHTML = `<img src="${dataUrl}" alt="Photo preview">`;
    thumb.classList.add('has-photo');
    thumb.dataset.previewOnly = dataUrl;
    document.getElementById('photoUrl').value = '';
    renderPreview();
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('preview_failed'));
      reader.readAsDataURL(blob);
    });
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  }

  async function uploadPhotoBlob(blob, successMessage) {
    const thumb = document.getElementById('photoPreviewThumb');
    const token = localStorage.getItem(FACTS.proTokenStorageKey);

    if (!isPro || !token) {
      setPhotoStatus('Preview ready. Hosting for Gmail unlocks when you buy.');
      return;
    }

    setPhotoStatus('Uploading hosted photo...');
    try {
      const url = await uploadImageBlob(blob, 'photo');
      document.getElementById('photoUrl').value = url;
      delete thumb.dataset.previewOnly;
      setPhotoStatus(successMessage, 'success');
      renderPreview();
    } catch (err) {
      setPhotoStatus(CORE.describeUploadError(err.message), 'error');
    }
  }

  async function regeneratePhotoAsset() {
    const canvas = photoState.primaryCanvas;
    if (!canvas) return;

    const effect = selectedPhotoEffect();
    const spec = window.PhotoAnimator && PhotoAnimator.EFFECTS[effect];

    // Still photo: the original path, with the chosen shape baked in.
    if (effect === 'none' || !spec || !isPro) {
      const still = shapedStillCanvas(canvas);
      showPhotoPreview(still.toDataURL('image/jpeg', 0.92));
      const blob = await canvasToBlob(still, 'image/jpeg', 0.92);
      await uploadPhotoBlob(blob, 'Hosted photo ready for Gmail and Outlook.');
      return;
    }

    if (spec.needsSecondPhoto && !photoState.secondaryCanvas) {
      showPhotoPreview(shapedStillCanvas(canvas).toDataURL('image/jpeg', 0.92));
      setPhotoStatus('Add a second photo to build the crossfade.');
      return;
    }

    setPhotoStatus('Building animation...');
    // Yield once so the status text paints before the encode blocks the main thread.
    await new Promise((resolve) => setTimeout(resolve, 0));

    let blob;
    try {
      const size = ANIMATED_PHOTO_SIZE;
      const built = PhotoAnimator.buildFrames({
        photo: canvasToRgba(canvas, size),
        secondPhoto: spec.needsSecondPhoto ? canvasToRgba(photoState.secondaryCanvas, size) : null,
        monogram: spec.needsMonogram ? monogramRgba(size) : null,
        size,
        effect,
        shape: style.photoShape,
        // Baked in because GIF has no soft alpha. Matches the white background the
        // templates already force for dark-mode safety.
        background: '#ffffff',
        accentColor: style.primaryColor,
      });

      // Error-diffusion dithering is off inside encodeSignatureGif: it would defeat
      // inter-frame differencing and roughly triple the file size for no visible
      // gain at this resolution.
      const bytes = encodeSignatureGif({
        frames: built.frames,
        width: size,
        height: size,
        delay: built.delay,
        canLoop: spec.loops,
      });

      blob = new Blob([bytes], { type: 'image/gif' });
    } catch (err) {
      setPhotoStatus('Could not build the animation. Try a different photo.', 'error');
      return;
    }

    showPhotoPreview(await blobToDataUrl(blob));
    const kb = Math.round(blob.size / 1024);
    await uploadPhotoBlob(blob, `Animated photo ready (${kb} KB). Older Outlook shows the first frame.`);
  }

  // ── Animated CTA button ──
  //
  // The button is drawn to a canvas at 2x for retina, swept by SweepAnimator, then
  // encoded and hosted like any other image. Templates swap the text anchor for
  // the resulting <img> when ctaImageUrl is present.

  // Mirrors the inline styles the CTA templates use, so the image matches the
  // static button it replaces.
  const CTA_STYLE = Object.freeze({
    scale: 2,
    paddingX: 20,
    paddingY: 8,
    radius: 5,
    fontSize: 12,
    fontWeight: 700,
  });

  const ctaState = { url: '', width: 0, height: 0 };

  function setCtaStatus(text, kind) {
    updateLiveStatus(document.getElementById('ctaStatusHint'), text, kind);
  }

  function ctaAnimationEnabled() {
    const el = document.getElementById('ctaAnimate');
    return !!(el && el.checked);
  }

  // Draws the button onto an opaque background. GIF has no soft alpha, so the
  // rounded corners are composited here rather than left transparent.
  function renderCtaButtonCanvas(label, background) {
    const s = CTA_STYLE;
    const measure = document.createElement('canvas').getContext('2d');
    const font = `${s.fontWeight} ${s.fontSize * s.scale}px ${style.fontFamily}`;
    measure.font = font;

    const textWidth = measure.measureText(label).width;
    const width = Math.ceil(textWidth + s.paddingX * 2 * s.scale);
    const height = Math.ceil(s.fontSize * 1.35 * s.scale + s.paddingY * 2 * s.scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);

    const r = s.radius * s.scale;
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.arcTo(width, 0, width, height, r);
    ctx.arcTo(width, height, 0, height, r);
    ctx.arcTo(0, height, 0, 0, r);
    ctx.arcTo(0, 0, width, 0, r);
    ctx.closePath();
    ctx.fillStyle = style.primaryColor;
    ctx.fill();

    ctx.font = font;
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, width / 2, height / 2 + 1);

    return canvas;
  }

  function clearCtaImage() {
    ctaState.url = '';
    ctaState.width = 0;
    ctaState.height = 0;
    renderPreview();
  }

  async function regenerateCtaAnimation() {
    const label = (style.ctaText || '').trim();

    if (!ctaAnimationEnabled() || !label) {
      clearCtaImage();
      setCtaStatus(label ? '' : 'Add call-to-action text to animate the button.');
      return;
    }

    if (!isPro) {
      clearCtaImage();
      const toggle = document.getElementById('ctaAnimate');
      if (toggle) toggle.checked = false;
      showProPrompt();
      setCtaStatus(`Animated buttons unlock with your ${FACTS.proPrice.displayWithCurrency} purchase.`, 'error');
      return;
    }

    setCtaStatus('Building button animation...');
    await new Promise((resolve) => setTimeout(resolve, 0));

    let blob;
    let cssWidth;
    let cssHeight;
    try {
      const canvas = renderCtaButtonCanvas(label, '#ffffff');
      const ctx = canvas.getContext('2d');
      const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

      const built = SweepAnimator.buildFrames({
        artwork: rgba,
        width: canvas.width,
        height: canvas.height,
      });

      const bytes = encodeSignatureGif({
        frames: built.frames,
        width: canvas.width,
        height: canvas.height,
        delay: built.delay,
        // The sheen enters and leaves the canvas, so it repeats seamlessly.
        canLoop: true,
      });

      blob = new Blob([bytes], { type: 'image/gif' });
      cssWidth = Math.round(canvas.width / CTA_STYLE.scale);
      cssHeight = Math.round(canvas.height / CTA_STYLE.scale);
    } catch (err) {
      setCtaStatus('Could not build the button animation.', 'error');
      return;
    }

    try {
      const url = await uploadImageBlob(blob, 'cta');
      ctaState.url = url;
      ctaState.width = cssWidth;
      ctaState.height = cssHeight;
      renderPreview();
      setCtaStatus(`Animated button ready (${Math.round(blob.size / 1024)} KB).`, 'success');
    } catch (err) {
      clearCtaImage();
      setCtaStatus(CORE.describeUploadError(err.message), 'error');
    }
  }

  // The label and accent colour are baked into the pixels, so any change to
  // either needs a rebuild. Debounced because both come from live-typing inputs.
  let ctaRebuildTimer = null;

  function scheduleCtaRebuild() {
    if (!ctaAnimationEnabled()) return;
    clearTimeout(ctaRebuildTimer);
    setCtaStatus('Button will rebuild...');
    ctaRebuildTimer = setTimeout(regenerateCtaAnimation, 700);
  }

  function bindCtaAnimation() {
    const toggle = document.getElementById('ctaAnimate');
    if (!toggle) return;
    toggle.addEventListener('change', function() {
      if (toggle.checked) claimAnimationSlot('cta');
      regenerateCtaAnimation();
    });
  }

  // ── Animated divider rule ──
  //
  // The rule is drawn at a generous fixed width and emitted at width="100%", so it
  // fills its cell exactly as the CSS border does. A thin horizontal bar scales
  // without visible distortion, and frame 1 is a plain rule, so older Outlook gets
  // what it renders today.

  const DIVIDER_STYLE = Object.freeze({
    scale: 2,
    width: 300,     // CSS px of artwork; stretched or shrunk to fit the cell
    thickness: 2,   // CSS px, matching the `line` border weight
    padding: 2,     // CSS px of white above and below, so the bar is not clipped
  });

  const dividerState = { url: '', height: 0 };

  // The published card page, when the customer has opted into having one. `slug`
  // is kept so a second publish updates the same page instead of stranding the
  // URL already pasted into their signature.
  const cardState = { url: '', slug: '' };

  function setDividerStatus(text, kind) {
    updateLiveStatus(document.getElementById('dividerStatusHint'), text, kind);
  }

  function dividerAnimationEnabled() {
    const el = document.getElementById('dividerAnimate');
    return !!(el && el.checked);
  }

  function renderDividerCanvas(background) {
    const s = DIVIDER_STYLE;
    const canvas = document.createElement('canvas');
    canvas.width = s.width * s.scale;
    canvas.height = (s.thickness + s.padding * 2) * s.scale;

    const ctx = canvas.getContext('2d');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = style.primaryColor;
    ctx.fillRect(0, s.padding * s.scale, canvas.width, s.thickness * s.scale);

    return canvas;
  }

  function clearDividerImage() {
    dividerState.url = '';
    dividerState.height = 0;
    renderPreview();
  }

  async function regenerateDividerAnimation() {
    if (!dividerAnimationEnabled()) {
      clearDividerImage();
      setDividerStatus('');
      return;
    }

    if (style.dividerStyle === 'none') {
      clearDividerImage();
      setDividerStatus('This template has no divider to animate.');
      return;
    }

    if (!isPro) {
      clearDividerImage();
      const toggle = document.getElementById('dividerAnimate');
      if (toggle) toggle.checked = false;
      showProPrompt();
      setDividerStatus(`Animated dividers unlock with your ${FACTS.proPrice.displayWithCurrency} purchase.`, 'error');
      return;
    }

    setDividerStatus('Building divider animation...');
    await new Promise((resolve) => setTimeout(resolve, 0));

    let blob;
    let cssHeight;
    try {
      const canvas = renderDividerCanvas('#ffffff');
      const rgba = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;

      const effectEl = document.getElementById('dividerEffect');
      const drawOn = effectEl && effectEl.value === 'draw';

      const built = drawOn
        ? SweepAnimator.buildDrawFrames({
          artwork: rgba,
          width: canvas.width,
          height: canvas.height,
          frames: 18,
          background: [255, 255, 255],
          delay: 4,
        })
        : SweepAnimator.buildFrames({
          artwork: rgba,
          width: canvas.width,
          height: canvas.height,
          frames: 16,
          // Tighter and brighter than the button sweep: on a two-pixel rule a wide
          // soft band just looks like the colour changing.
          bandWidth: 0.07,
          strength: 0.85,
          skew: 0,
          delay: 5,
        });

      const bytes = encodeSignatureGif({
        frames: built.frames,
        width: canvas.width,
        height: canvas.height,
        delay: built.delay,
        canLoop: true,
      });

      blob = new Blob([bytes], { type: 'image/gif' });
      cssHeight = Math.round(canvas.height / DIVIDER_STYLE.scale);
    } catch (err) {
      setDividerStatus('Could not build the divider animation.', 'error');
      return;
    }

    try {
      const url = await uploadImageBlob(blob, 'divider');
      dividerState.url = url;
      dividerState.height = cssHeight;
      renderPreview();
      setDividerStatus(`Animated divider ready (${Math.round(blob.size / 1024)} KB).`, 'success');
    } catch (err) {
      clearDividerImage();
      setDividerStatus(CORE.describeUploadError(err.message), 'error');
    }
  }

  let dividerRebuildTimer = null;

  function scheduleDividerRebuild() {
    if (!dividerAnimationEnabled()) return;
    clearTimeout(dividerRebuildTimer);
    setDividerStatus('Divider will rebuild...');
    dividerRebuildTimer = setTimeout(regenerateDividerAnimation, 700);
  }

  function bindDividerAnimation() {
    const toggle = document.getElementById('dividerAnimate');
    if (!toggle) return;
    toggle.addEventListener('change', function() {
      if (toggle.checked) claimAnimationSlot('divider');
      regenerateDividerAnimation();
    });

    // Switching between sweep and draw only matters once the divider is animated;
    // otherwise there is nothing to re-encode.
    const effect = document.getElementById('dividerEffect');
    if (effect) effect.addEventListener('change', function() {
      if (toggle.checked) regenerateDividerAnimation();
    });
  }

  // ── One animation per signature ──
  //
  // Three moving parts reads as a free template however well each is made, so the
  // product allows exactly one. Turning something on turns the others off.
  function claimAnimationSlot(claimed) {
    if (claimed !== 'photo') {
      const select = document.getElementById('photoEffect');
      if (select && select.value !== 'none') {
        select.value = 'none';
        const secondGroup = document.getElementById('photoSecondGroup');
        if (secondGroup) secondGroup.style.display = 'none';
        regeneratePhotoAsset();
      }
    }

    if (claimed !== 'cta') {
      const toggle = document.getElementById('ctaAnimate');
      if (toggle && toggle.checked) {
        toggle.checked = false;
        clearCtaImage();
        setCtaStatus('');
      }
    }

    if (claimed !== 'divider') {
      const toggle = document.getElementById('dividerAnimate');
      if (toggle && toggle.checked) {
        toggle.checked = false;
        clearDividerImage();
        setDividerStatus('');
      }
    }
  }

  function bindPhotoEffect() {
    const select = document.getElementById('photoEffect');
    const secondGroup = document.getElementById('photoSecondGroup');
    const secondFile = document.getElementById('photoSecondFile');
    if (!select) return;

    select.addEventListener('change', async function() {
      const effect = select.value;
      const spec = window.PhotoAnimator && PhotoAnimator.EFFECTS[effect];

      if (effect !== 'none' && !isPro) {
        select.value = 'none';
        if (secondGroup) secondGroup.style.display = 'none';
        showProPrompt();
        return;
      }

      if (secondGroup) {
        secondGroup.style.display = spec && spec.needsSecondPhoto ? '' : 'none';
      }
      if (effect !== 'none') claimAnimationSlot('photo');
      await regeneratePhotoAsset();
    });

    if (secondFile) {
      secondFile.addEventListener('change', function() {
        const file = this.files[0];
        if (file) showCropUI(file, 'secondary', this);
      });
    }
  }

  function initCropHandlers() {
    const modal = document.getElementById('cropModal');
    const viewport = document.getElementById('cropViewport');

    document.getElementById('cropCancel').addEventListener('click', closeCropUI);
    document.getElementById('cropApply').addEventListener('click', applyCrop);

    modal.addEventListener('keydown', function(e) {
      if (modal.getAttribute('aria-hidden') === 'true') return;
      if (e.key === 'Escape') {
        e.preventDefault();
        closeCropUI();
        return;
      }
      if (e.key !== 'Tab') return;

      const focusable = Array.from(modal.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
        .filter(el => el.offsetParent !== null);
      if (!focusable.length) {
        e.preventDefault();
        document.getElementById('cropModalTitle').focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === document.getElementById('cropModalTitle'))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });

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

    // Where the name points. The card page is only available once one has actually
    // been published, so 'card' resolves to '' until then and templates fall back
    // to plain bold text rather than rendering a dead link.
    const linkTargetEl = document.getElementById('nameLinkTarget');
    const linkTarget = linkTargetEl ? linkTargetEl.value : 'none';
    const nameLinkUrl =
      linkTarget === 'card' ? cardState.url
        : linkTarget === 'linkedin' ? get('linkedin')
          : linkTarget === 'website' ? get('website')
            : '';

    return {
      fullName: get('fullName'),
      nameLinkUrl: nameLinkUrl,
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
      // Only set once an animated CTA has been built and hosted; templates fall
      // back to the plain text button when absent.
      ctaImageUrl: ctaState.url,
      ctaImageWidth: ctaState.width,
      ctaImageHeight: ctaState.height,
      dividerImageUrl: dividerState.url,
      dividerImageHeight: dividerState.height,
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
      compliance: getActiveCompliance(),
    });
  }

  // Building and previewing is open to everyone; taking the signature away is what
  // costs money. Returns false and prompts when the visitor has not paid.
  function requireProForExport() {
    if (isPro) return true;
    showProPrompt();
    setExportStatus(
      `Unlock for ${FACTS.proPrice.displayWithCurrency} to copy your signature, host your photo, and save an edit link.`,
      'error'
    );
    return false;
  }

  function setExportStatus(text, kind) {
    updateLiveStatus(document.getElementById('exportStatusHint'), text, kind);
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
      el.setAttribute('aria-invalid', 'true');
      if (errorEl) errorEl.textContent = msg;
      return false;
    } else {
      el.classList.remove('input-error');
      el.setAttribute('aria-invalid', 'false');
      if (errorEl) errorEl.textContent = '';
      return true;
    }
  }

  function clearFieldError(id) {
    const el = document.getElementById(id);
    const errorEl = document.getElementById(id + '-error');
    if (el) {
      el.classList.remove('input-error');
      el.setAttribute('aria-invalid', 'false');
    }
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
    let data = getFormData();
    if (!data.fullName) {
      validateField('fullName');
      alert('Please enter your name to generate a signature.');
      return;
    }
    if (!requireProForExport()) return;
    ['email', 'website', 'linkedin', 'instagram', 'facebook', 'google'].forEach(validateField);

    // Never let a preview-only inline image reach the clipboard — it would paste as a
    // broken image in Gmail and Outlook with no visible warning.
    const previewOnly = CORE.previewOnlyImageSlots(data);
    if (previewOnly.length) {
      const label = previewOnly.length === 2 ? 'photo and logo' : previewOnly[0];
      const fix = isPro
        ? 'Re-upload it so we can host it, or paste a hosted URL.'
        : 'Paste a hosted URL, or unlock Pro and we\'ll host it for you.';
      const proceed = confirm(
        `Your ${label} is preview-only and will not display in Gmail or Outlook.\n\n` +
        `${fix}\n\n` +
        `Press OK to copy the signature without it, or Cancel to fix it first.`
      );
      if (!proceed) return;
      data = CORE.withoutPreviewOnlyImages(data);
    }

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
      // Fallback: copy from an offscreen node holding the same sanitised HTML.
      // Copying from the live preview instead would reintroduce preview-only images.
      try {
        const staging = document.createElement('div');
        staging.innerHTML = html;
        staging.setAttribute('aria-hidden', 'true');
        staging.style.cssText = 'position:fixed;left:-9999px;top:0;';
        document.body.appendChild(staging);

        const range = document.createRange();
        range.selectNodeContents(staging);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand('copy');
        sel.removeAllRanges();
        staging.remove();
        showCopied(btn);
      } catch (e) {
        setExportStatus('Could not copy the signature. Select the preview and copy it manually.', 'error');
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
    if (!requireProForExport()) return;
    ['email', 'website', 'linkedin', 'instagram', 'facebook', 'google'].forEach(validateField);

    try {
      await navigator.clipboard.writeText(CORE.plainTextFromData(data));
      showCopied(btn);
    } catch (e) {
      setExportStatus('Could not copy the plain-text signature.', 'error');
      alert('Could not copy to clipboard.');
    }
  }

  function showCopied(btn) {
    btn.classList.add('copied');
    if (btn.id === 'copyHtmlBtn') setExportStatus('HTML signature copied to the clipboard.', 'success');
    if (btn.id === 'copyTextBtn') setExportStatus('Plain-text signature copied to the clipboard.', 'success');
    setTimeout(() => btn.classList.remove('copied'), 2000);
  }

  // ── Save & restore ──
  //
  // A saved signature is stored server-side under a random capability id. The link
  // is the only credential, which is why the UI says so plainly next to the button.

  function setSaveLinkStatus(text, kind) {
    updateLiveStatus(document.getElementById('saveLinkHint'), text, kind);
  }

  function collectSignatureState() {
    const data = getFormData();
    return {
      version: 1,
      template: currentTemplate,
      style: style,
      // Preview-only images can't be restored on another device and would bloat the
      // payload, so only hosted URLs are saved.
      data: CORE.withoutPreviewOnlyImages(data),
      compliance: complianceState || null,
      photoEffect: selectedPhotoEffect(),
      dividerEffect: (document.getElementById('dividerEffect') || {}).value || 'sweep',
      // Where the name pointed, and which card page it pointed at. Without the slug
      // a restored signature would keep the rendered link but lose the ability to
      // update the page behind it.
      nameLink: {
        target: (document.getElementById('nameLinkTarget') || {}).value || 'none',
        cardSlug: cardState.slug || '',
      },
    };
  }

  async function saveSignatureLink(btn) {
    const token = localStorage.getItem(FACTS.proTokenStorageKey);
    if (!isPro || !token) {
      setSaveLinkStatus(`Saving an edit link unlocks with your ${FACTS.proPrice.displayWithCurrency} purchase.`, 'error');
      showProPrompt();
      return;
    }

    const state = collectSignatureState();
    if (!state.data.fullName) {
      setSaveLinkStatus('Add your name before saving.', 'error');
      return;
    }

    setSaveLinkStatus('Saving...');
    try {
      const resp = await fetch('/api/signature', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify(state),
      });
      if (!resp.ok) {
        let code = '';
        try { code = (await resp.json()).code || ''; } catch {}
        throw new Error(code);
      }

      const { url } = await resp.json();
      try {
        await navigator.clipboard.writeText(url);
        showCopied(btn);
        setSaveLinkStatus('Link copied. Open it on any device to keep editing.', 'success');
      } catch {
        setSaveLinkStatus('Saved. Your link: ' + url, 'success');
      }
    } catch (err) {
      setSaveLinkStatus(CORE.describeUploadError(err.message), 'error');
    }
  }

  async function restoreSignatureFromLink(signatureId) {
    const id = signatureId || new URLSearchParams(window.location.search).get('s');
    if (!id) return;

    try {
      const resp = await fetch('/api/signature/' + encodeURIComponent(id));
      if (!resp.ok) throw new Error('not_found');
      const state = await resp.json();
      applySignatureState(state);
      setSaveLinkStatus('Signature restored from your link.', 'success');
    } catch {
      setSaveLinkStatus('That saved link could not be found.', 'error');
    }
  }

  function applySignatureState(state) {
    if (!state || typeof state !== 'object') return;

    if (state.style && typeof state.style === 'object') {
      Object.assign(style, state.style);
      // Signatures saved before the dead 'rounded'/'square' icon styles were
      // removed still carry them. They always rendered as mono, so map them back
      // onto mono — otherwise the toggle group would show no selected option.
      if (style.iconStyle !== 'color') style.iconStyle = 'mono';
      syncStyleControls();
    }

    if (state.data && typeof state.data === 'object') {
      Object.keys(state.data).forEach(function(key) {
        const el = document.getElementById(key);
        if (el) el.value = state.data[key] || '';
      });
      // Hosted photos and logos come back as plain URLs, so show them as such.
      ['photo', 'logo'].forEach(function(slot) {
        const url = state.data[slot + 'Url'];
        const thumb = document.getElementById(slot + 'PreviewThumb');
        if (!thumb) return;
        delete thumb.dataset.previewOnly;
        if (url) {
          thumb.innerHTML = `<img src="${escapeAttr(url)}" alt="${slot} preview">`;
          thumb.classList.add('has-' + slot);
          const removeBtn = document.getElementById(slot + 'RemoveBtn');
          if (removeBtn) removeBtn.style.display = '';
        }
      });
    }

    if (state.template && TEMPLATES[state.template]) {
      currentTemplate = state.template;
      renderTemplateGrid();
    }

    restoreNameLinkState(state);
    restoreAnimationState(state);
    renderPreview();
  }

  // Signatures saved before name links existed have no `nameLink` block, so the
  // control is left at its default rather than being reset to something the
  // customer never chose.
  function restoreNameLinkState(state) {
    const saved = state && state.nameLink;
    if (!saved || typeof saved !== 'object') return;

    const target = document.getElementById('nameLinkTarget');
    if (target && ['none', 'card', 'linkedin', 'website'].includes(saved.target)) {
      target.value = saved.target;
    }

    if (saved.cardSlug && /^[a-z0-9-]{1,64}$/.test(saved.cardSlug)) {
      cardState.slug = saved.cardSlug;
      cardState.url = `${window.location.origin}/c/${saved.cardSlug}`;
      localStorage.setItem(CARD_SLUG_STORAGE_KEY, saved.cardSlug);
      const consent = document.getElementById('cardPageConsent');
      if (consent) consent.checked = true;
    }
    syncCardControls();
  }

  // Animated CTAs and dividers are hosted images whose URLs ride along in `data`,
  // but they live in module state rather than in form inputs — so the generic
  // "set every input by id" restore above skips them entirely. Without this, a
  // saved signature silently comes back without the animation it was saved with.
  function restoreAnimationState(state) {
    const data = (state && state.data) || {};

    ctaState.url = '';
    ctaState.width = 0;
    ctaState.height = 0;
    dividerState.url = '';
    dividerState.height = 0;

    const ctaToggle = document.getElementById('ctaAnimate');
    const dividerToggle = document.getElementById('dividerAnimate');
    const photoSelect = document.getElementById('photoEffect');
    const secondGroup = document.getElementById('photoSecondGroup');

    if (ctaToggle) ctaToggle.checked = false;
    if (dividerToggle) dividerToggle.checked = false;
    if (photoSelect) photoSelect.value = 'none';
    if (secondGroup) secondGroup.style.display = 'none';

    // Only one animation can be active, so restore the first one present rather
    // than trusting a payload to contain at most one.
    if (data.ctaImageUrl) {
      ctaState.url = data.ctaImageUrl;
      ctaState.width = parseInt(data.ctaImageWidth, 10) || 0;
      ctaState.height = parseInt(data.ctaImageHeight, 10) || 0;
      if (ctaToggle) ctaToggle.checked = true;
      return;
    }

    const dividerEffect = document.getElementById('dividerEffect');
    if (dividerEffect && ['sweep', 'draw'].includes(state && state.dividerEffect)) {
      dividerEffect.value = state.dividerEffect;
    }

    if (data.dividerImageUrl) {
      dividerState.url = data.dividerImageUrl;
      dividerState.height = parseInt(data.dividerImageHeight, 10) || 0;
      if (dividerToggle) dividerToggle.checked = true;
      return;
    }

    // An animated photo returns on its own, because the hosted GIF is the
    // photoUrl. This only re-syncs the control so it stops claiming the photo is
    // unanimated. There is no source canvas after a restore, so the rebuild
    // schedulers correctly decline to re-encode until a new photo is uploaded.
    const effect = state && state.photoEffect;
    if (photoSelect && effect && window.PhotoAnimator && PhotoAnimator.EFFECTS[effect]) {
      photoSelect.value = effect;
      if (secondGroup && PhotoAnimator.EFFECTS[effect].needsSecondPhoto) {
        secondGroup.style.display = '';
      }
    }
  }

  // Pushes the restored style object back onto the controls so the UI matches.
  function syncStyleControls() {
    ['primaryColor', 'secondaryColor', 'textColor'].forEach(function(key) {
      const picker = document.getElementById(key);
      const hex = document.getElementById(key + 'Hex');
      if (picker && style[key]) picker.value = style[key];
      if (hex && style[key]) hex.value = style[key];
    });

    const font = document.getElementById('fontFamily');
    if (font && style.fontFamily) font.value = style.fontFamily;

    [['divider-toggles', 'dividerStyle'], ['photo-shape-toggles', 'photoShape'], ['icon-style-toggles', 'iconStyle']]
      .forEach(function(pair) {
        const container = document.getElementById(pair[0]);
        if (!container) return;
        container.querySelectorAll('.toggle-option').forEach(function(opt) {
          const active = opt.dataset.value === style[pair[1]];
          opt.classList.toggle('active', active);
          opt.setAttribute('aria-checked', active ? 'true' : 'false');
        });
      });

    ['ctaText', 'ctaUrl'].forEach(function(key) {
      const el = document.getElementById(key);
      if (el && style[key] != null) el.value = style[key];
    });
  }

  // ── Pro Unlock ──
  async function checkProStatus() {
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
    defaultLogoStatus();
    setCardStatus('Tick the box above, then publish whenever you\'re ready.');
    syncCardControls();

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
