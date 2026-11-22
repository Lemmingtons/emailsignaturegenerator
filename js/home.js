(function () {
  'use strict';

  // The hero box shows "https://" beside the field, so drop a scheme the
  // visitor pastes or autofills rather than showing it twice.
  var heroSite = document.getElementById('heroSite');
  if (heroSite) {
    heroSite.addEventListener('input', function () {
      var bare = heroSite.value.replace(/^\s*https?:\/\//i, '');
      if (bare !== heroSite.value) heroSite.value = bare;
    });
  }

  // Records a real buy-button click before it leaves for Stripe, so abandoned
  // Stripe sessions can be told apart from link previews. Never blocks checkout.
  function trackCheckoutClick(placement) {
    try { navigator.sendBeacon('/api/checkout-click', JSON.stringify({ placement: placement })); } catch (e) { /* best effort */ }
  }
  // A middle-click opens Stripe in a new tab and fires auxclick, not click.
  function trackCheckoutLink(link, placement) {
    link.addEventListener('click', function () { trackCheckoutClick(placement); });
    link.addEventListener('auxclick', function (event) { if (event.button === 1) trackCheckoutClick(placement); });
  }

  var checkoutButton = document.getElementById('checkoutBtn');
  if (checkoutButton && window.SiteFacts) {
    checkoutButton.href = window.SiteFacts.paymentLink;
    trackCheckoutLink(checkoutButton, 'home-pro');
  }

  // The team pack shows only once its Stripe link exists.
  var teamOffer = document.getElementById('teamOffer');
  if (teamOffer && window.SiteFacts && window.SiteFacts.teamPaymentLink) {
    var facts = window.SiteFacts;
    document.getElementById('teamOfferLink').href = facts.teamPaymentLink;
    trackCheckoutLink(document.getElementById('teamOfferLink'), 'home-team');
    teamOffer.querySelectorAll('[data-team-price]').forEach(function (el) { el.textContent = facts.teamPrice.display; });
    teamOffer.querySelectorAll('[data-team-seats]').forEach(function (el) { el.textContent = String(facts.teamSeats); });
    teamOffer.querySelectorAll('[data-team-threshold]').forEach(function (el) { el.textContent = String(facts.bulkIndividualMaxRows + 1); });
    teamOffer.querySelectorAll('[data-bulk-limit]').forEach(function (el) { el.textContent = String(facts.bulkMaxRows); });
    document.getElementById('teamOfferLink').setAttribute('aria-label', 'Buy the team pack for ' + facts.teamPrice.display);
    document.getElementById('pricingGrid').classList.remove('pricing-grid-single');
    teamOffer.hidden = false;
  }

  if (window.SiteFacts && window.SiteFacts.contactEmail) {
    document.querySelectorAll('[data-contact-email]').forEach(function (el) {
      el.href = 'mailto:' + window.SiteFacts.contactEmail;
      el.textContent = window.SiteFacts.contactEmail;
    });
  }

  function demoAsset(path) {
    try { return new URL(path, window.location.origin).href; } catch { return path; }
  }

  var D = {
    fullName: 'Sarah Mitchell',
    title: 'Senior Account Manager',
    company: 'Acme Corporation',
    phone: '+1 555 012 3456',
    email: 'sarah@acmecorp.com',
    website: 'https://acmecorp.com',
    photoUrl: demoAsset('assets/sample-headshot.jpg'),
    linkedin: 'https://linkedin.com/in/sarahmitchell',
    instagram: 'https://instagram.com/sarahmitchell',
    facebook: '',
  };

  // Each slide demonstrates one animation, matching the shipped rule of a single
  // moving element per signature. The ring bakes its accent into the pixels so it
  // needs a colour-matched file; the shine sweep only lightens, so one file serves
  // every slide. Regenerate with: node scripts/build-demo-animations.js
  var RING_TEAL = demoAsset('assets/demo-photo-ring-0891B2.gif');
  var RING_PINE = demoAsset('assets/demo-photo-ring-0D9488.gif');
  var SWEEP = demoAsset('assets/demo-photo-sweep.gif');

  var SLIDES = [
    {
      id: 'classic', category: 'Professional', name: 'Classic',
      effect: 'Ring orbit', photo: RING_TEAL,
      desc: 'Clean and corporate-safe. Works perfectly in Gmail, Outlook, and every major client.',
      style: { primaryColor: '#0891B2', textColor: '#1d1d1f', fontFamily: "'Segoe UI', -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif", dividerStyle: 'line', photoShape: 'circle', iconStyle: 'mono' }
    },
    {
      id: 'bold', category: 'Creative', name: 'Bold',
      effect: 'Shine sweep', photo: SWEEP,
      desc: 'Bold colours and modern typography. Stand out in every inbox.',
      style: { primaryColor: '#0F766E', textColor: '#1d1d1f', fontFamily: "'Segoe UI', -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif", dividerStyle: 'line', photoShape: 'circle', iconStyle: 'color' }
    },
    {
      id: 'gradient', category: 'Creative', name: 'Gradient',
      effect: 'Shine sweep', photo: SWEEP,
      desc: 'Gradient accents and bold colour. Makes a strong impression without sacrificing professionalism.',
      style: { primaryColor: '#7C3AED', secondaryColor: '#EC4899', textColor: '#1d1d1f', fontFamily: "'Segoe UI', -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif", dividerStyle: 'line', photoShape: 'circle', iconStyle: 'color' }
    },
    {
      id: 'creator', category: 'Social', name: 'Creator',
      effect: 'Shine sweep', photo: SWEEP,
      desc: 'Social icons front and centre. Perfect for influencers and content creators.',
      style: { primaryColor: '#22C55E', textColor: '#1d1d1f', fontFamily: "'Segoe UI', -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif", dividerStyle: 'none', photoShape: 'circle', iconStyle: 'color' }
    },
    {
      // ctabox rather than meetinglink: meetinglink renders its call to action as
      // a text link, and a sheen needs a filled shape to travel across. The photo
      // stays still here so this slide demonstrates exactly one moving element.
      id: 'ctabox', category: 'Sales / CTA', name: 'CTA Box',
      effect: 'Button sheen',
      ctaImage: { url: demoAsset('assets/demo-cta-EA580C.gif'), width: 129, height: 32 },
      desc: 'Drive meetings and demos with a call-to-action button that catches the eye.',
      style: { primaryColor: '#EA580C', textColor: '#1d1d1f', fontFamily: "'Segoe UI', -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif", dividerStyle: 'line', photoShape: 'circle', iconStyle: 'mono', ctaText: 'Book a Meeting', ctaUrl: '#' }
    },
    {
      id: 'consultant', category: 'Industry', name: 'Consultant',
      effect: 'Ring orbit', photo: RING_PINE,
      desc: 'Purpose-built for consulting and professional services. Tailored layout for your field.',
      style: { primaryColor: '#0D9488', textColor: '#1d1d1f', fontFamily: "'Segoe UI', -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif", dividerStyle: 'line', photoShape: 'circle', iconStyle: 'mono' }
    },
  ];

  var track = document.getElementById('sigCarouselTrack');
  var dotsContainer = document.getElementById('sigDots');
  var carousel = document.getElementById('sigCarousel');
  var carouselSection = document.querySelector('.sig-carousel-section');
  var rotationToggle = document.getElementById('sigCarouselToggle');
  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var current = 0;
  var timer = null;
  var rotationPaused = reducedMotion.matches;
  var pointerInside = false;
  var focusInside = false;

  function renderSlidePreview(s, staticOnly) {
    var data = Object.assign({}, D, { photoUrl: staticOnly ? D.photoUrl : (s.photo || D.photoUrl) });
    if (!staticOnly && s.ctaImage) {
      data.ctaImageUrl = s.ctaImage.url;
      data.ctaImageWidth = s.ctaImage.width;
      data.ctaImageHeight = s.ctaImage.height;
    }
    return TEMPLATES[s.id].render(data, s.style);
  }

  // Build slides and dots
  var previewFrames = [];
  SLIDES.forEach(function (s, i) {
    var html = renderSlidePreview(s, reducedMotion.matches);
    var badge = '<span class="showcase-badge animated">' + s.effect + '</span>';

    var slide = document.createElement('div');
    slide.className = 'sig-carousel-slide';
    slide.setAttribute('aria-label', s.category + ' template');
    slide.setAttribute('aria-hidden', i === 0 ? 'false' : 'true');
    slide.inert = i !== 0;
    slide.innerHTML =
      '<div class="sig-slide-meta">' +
        '<span class="sig-category-label">' + s.category +
          '<span class="sig-template-name">\u2014 ' + s.name + '</span>' +
        '</span>' + badge +
      '</div>' +
      '<div class="sig-preview-frame">' + html + '</div>' +
      '<div class="sig-slide-footer">' + s.desc + '</div>';
    track.appendChild(slide);
    previewFrames.push(slide.querySelector('.sig-preview-frame'));

    var dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'sig-dot' + (i === 0 ? ' active' : '');
    dot.setAttribute('aria-pressed', i === 0 ? 'true' : 'false');
    dot.setAttribute('aria-label', 'Slide ' + (i + 1) + ': ' + s.category);
    dot.addEventListener('click', function (idx) {
      return function () { goTo(idx, true); restartAuto(); };
    }(i));
    dotsContainer.appendChild(dot);
  });

  var dots = dotsContainer.querySelectorAll('.sig-dot');
  var slides = track.querySelectorAll('.sig-carousel-slide');

  function updateSlidePreviews() {
    SLIDES.forEach(function (s, i) {
      if (previewFrames[i]) previewFrames[i].innerHTML = renderSlidePreview(s, reducedMotion.matches);
    });
  }

  function goTo(idx, announce) {
    current = (idx + SLIDES.length) % SLIDES.length;
    carousel.setAttribute('aria-live', announce || rotationPaused ? 'polite' : 'off');
    track.style.transform = 'translateX(-' + (current * 100) + '%)';
    dots.forEach(function (d, i) {
      d.classList.toggle('active', i === current);
      d.setAttribute('aria-pressed', i === current ? 'true' : 'false');
    });
    slides.forEach(function (slide, i) {
      slide.setAttribute('aria-hidden', i === current ? 'false' : 'true');
      slide.inert = i !== current;
    });
  }

  function stopAuto() {
    if (timer !== null) clearInterval(timer);
    timer = null;
  }

  function startAuto(ignoreInteractionPause) {
    stopAuto();
    if (rotationPaused || reducedMotion.matches || (!ignoreInteractionPause && (pointerInside || focusInside))) return;
    carousel.setAttribute('aria-live', 'off');
    timer = setInterval(function () { goTo(current + 1, false); }, 4000);
  }

  function restartAuto() {
    startAuto();
  }

  function syncRotationControl() {
    var stopped = rotationPaused || reducedMotion.matches;
    rotationToggle.setAttribute('aria-pressed', stopped ? 'true' : 'false');
    rotationToggle.disabled = reducedMotion.matches;
    carousel.setAttribute('aria-live', stopped ? 'polite' : 'off');
  }

  document.getElementById('sigPrev').addEventListener('click', function () { goTo(current - 1, true); restartAuto(); });
  document.getElementById('sigNext').addEventListener('click', function () { goTo(current + 1, true); restartAuto(); });
  rotationToggle.addEventListener('click', function () {
    rotationPaused = !rotationPaused;
    syncRotationControl();
    if (rotationPaused) stopAuto(); else startAuto(true);
  });

  carouselSection.addEventListener('mouseenter', function () { pointerInside = true; stopAuto(); });
  carouselSection.addEventListener('mouseleave', function () { pointerInside = false; startAuto(); });
  carouselSection.addEventListener('focusin', function () { focusInside = true; stopAuto(); });
  carouselSection.addEventListener('focusout', function (e) {
    if (carouselSection.contains(e.relatedTarget)) return;
    focusInside = false;
    startAuto();
  });

  // Touch swipe
  var touchStartX = 0;
  carousel.addEventListener('touchstart', function (e) { touchStartX = e.touches[0].clientX; }, { passive: true });
  carousel.addEventListener('touchend', function (e) {
    var diff = touchStartX - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 40) { goTo(current + (diff > 0 ? 1 : -1), true); restartAuto(); }
  }, { passive: true });

  function handleReducedMotion() {
    track.style.transition = reducedMotion.matches ? 'none' : '';
    updateSlidePreviews();
    if (reducedMotion.matches) {
      rotationPaused = true;
      stopAuto();
    }
    syncRotationControl();
    if (!reducedMotion.matches) startAuto();
  }
  if (reducedMotion.addEventListener) reducedMotion.addEventListener('change', handleReducedMotion);
  else reducedMotion.addListener(handleReducedMotion);
  handleReducedMotion();
})();
