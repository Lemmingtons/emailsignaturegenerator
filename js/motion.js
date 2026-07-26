// ── Scroll reveals and header state ──
// Progressive enhancement only. If this file fails to load, motion.css never
// applies its hiding rules (they are scoped to .js-motion) and the page renders
// exactly as it does today.

(function() {
  'use strict';

  const root = document.documentElement;
  const reduceMotion = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;

  // IntersectionObserver is the only hard requirement. Without it, or when the
  // reader has asked for reduced motion, everything stays visible and static.
  if (!('IntersectionObserver' in window) || reduceMotion) return;

  root.classList.add('js-motion');

  // Stagger siblings within a group so a row of cards arrives in sequence
  // rather than all at once.
  const STAGGER_MS = 70;
  const MAX_STAGGER_MS = 350;

  // Browsers pause requestAnimationFrame in hidden or background tabs. Falling back
  // to a direct call there keeps reveals and header state correct for anyone who
  // opens the page in a background tab and scrolls before it is painted.
  function nextFrame(fn) {
    if (document.hidden) {
      fn();
      return;
    }
    requestAnimationFrame(fn);
  }

  // Items only stagger against others on the same visual row, because a stagger is
  // only meaningful when several items reveal at once. In a single-column mobile
  // layout every item is its own row, so nothing is made to wait — otherwise the
  // last card in a stack would sit blank for the full delay before starting to fade.
  const ROW_TOLERANCE_PX = 8;

  function assignStagger() {
    const groups = document.querySelectorAll('[data-reveal-group]');
    groups.forEach(function(group) {
      const items = group.querySelectorAll(':scope > [data-reveal]');
      const seenInRow = new Map();

      items.forEach(function(item) {
        // Bucket by offsetTop so sub-pixel differences within a grid row group together.
        const row = Math.round(item.offsetTop / ROW_TOLERANCE_PX);
        const position = seenInRow.get(row) || 0;
        seenInRow.set(row, position + 1);
        item.style.setProperty('--reveal-delay', Math.min(position * STAGGER_MS, MAX_STAGGER_MS) + 'ms');
      });
    });
  }

  // Pending elements are tracked here so both the observer and the safety sweep
  // can reveal them. Revealing is idempotent.
  let pending = [];
  let observer = null;

  function reveal(el) {
    if (el.classList.contains('is-visible')) return;
    el.classList.add('is-visible');
    if (observer) observer.unobserve(el);
    // Drop the compositing hint once the transition has finished.
    el.addEventListener('transitionend', function onDone() {
      el.classList.add('reveal-done');
      el.removeEventListener('transitionend', onDone);
    });
  }

  // Reveals anything at or above the fold. This is the safety net: an
  // IntersectionObserver only reports threshold *crossings*, so an element the
  // reader jumps straight past — via an anchor link, a restored scroll position,
  // or a fast flick — can go from "below the viewport" to "above the viewport"
  // without ever being reported as intersecting, and would stay invisible.
  function sweep() {
    if (!pending.length) return;
    const limit = window.innerHeight * 0.92;
    pending = pending.filter(function(el) {
      const rect = el.getBoundingClientRect();
      // top < limit covers elements entering the viewport; bottom < 0 covers
      // elements already scrolled past.
      if (rect.top < limit || rect.bottom < 0) {
        reveal(el);
        return false;
      }
      return true;
    });
  }

  function observeReveals() {
    const targets = document.querySelectorAll('[data-reveal]');
    if (!targets.length) return;

    pending = Array.prototype.slice.call(targets);

    observer = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (!entry.isIntersecting) return;
        reveal(entry.target);
      });
      pending = pending.filter(function(el) { return !el.classList.contains('is-visible'); });
    }, {
      // Kept in step with the sweep's own threshold below, so whichever fires
      // first the element reveals as it enters rather than once it is well inside.
      rootMargin: '0px 0px -8% 0px',
      threshold: 0.01,
    });

    targets.forEach(function(el) { observer.observe(el); });

    let ticking = false;
    function onScroll() {
      if (ticking) return;
      ticking = true;
      nextFrame(function() {
        sweep();
        ticking = false;
      });
    }

    // Crossing a breakpoint changes how many items share a row, so the stagger has
    // to be recalculated or a grid that became a column keeps its stale delays.
    let resizeTimer = null;
    function onResize() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function() {
        assignStagger();
        sweep();
      }, 150);
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize, { passive: true });
    window.addEventListener('hashchange', onScroll);
    // Late images and fonts can shift layout after DOMContentLoaded.
    window.addEventListener('load', sweep);

    sweep();
  }

  // Anything already in view on load (the hero) should animate immediately
  // instead of waiting for a scroll that may never come.
  function revealAboveTheFold() {
    document.querySelectorAll('.landing-hero [data-reveal]').forEach(function(el) {
      nextFrame(function() { reveal(el); });
    });
  }

  function bindHeaderState() {
    const header = document.querySelector('.site-header');
    if (!header) return;

    let ticking = false;
    function update() {
      header.classList.toggle('is-scrolled', window.scrollY > 8);
      ticking = false;
    }

    window.addEventListener('scroll', function() {
      if (ticking) return;
      ticking = true;
      nextFrame(update);
    }, { passive: true });

    update();
  }

  function init() {
    assignStagger();
    observeReveals();
    revealAboveTheFold();
    bindHeaderState();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
