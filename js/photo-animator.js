// ── Animated signature photo effects ──
// Turns one (or two) square RGBA photos into a frame sequence for GifEncoder.
//
// Two constraints drive every effect here:
//
// 1. Classic Outlook on Windows renders only the FIRST frame of an animated GIF.
//    So frame 0 is always the finished, resting photo, and every effect is
//    additive on top of an already-legible image. Nothing fades in from blank.
// 2. GIF has no soft alpha, only a 1-bit transparent index. Circular and rounded
//    photos are therefore composited onto an opaque background colour rather than
//    relying on transparency, which would leave a hard jagged edge.
//
// Pure pixel maths, no canvas, so the same code runs in the browser and under Node
// in the validator.

(function(root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  root.PhotoAnimator = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {

  const EFFECTS = Object.freeze({
    sweep: {
      id: 'sweep',
      label: 'Shine sweep',
      description: 'A soft highlight passes once across the photo.',
      frames: 14,
      delay: 6,
      needsSecondPhoto: false,
      // Returns to its opening frame, so it can rest and repeat cleanly.
      loops: true,
    },
    ring: {
      id: 'ring',
      label: 'Ring orbit',
      description: 'An accent ring sits around the photo with a highlight travelling round it.',
      frames: 18,
      delay: 6,
      needsSecondPhoto: false,
      loops: true,
    },
    crossfade: {
      id: 'crossfade',
      label: 'Two-photo crossfade',
      description: 'Rests on your first photo, dissolves to the second, holds.',
      frames: 16,
      delay: 8,
      needsSecondPhoto: true,
      // A one-way transition: it ends on the second photo. Repeating it would
      // flick back and forth between two faces, so this one always plays once.
      loops: false,
    },
    drift: {
      id: 'drift',
      label: 'Slow drift',
      description: 'An almost imperceptible zoom in and back out. Motion you feel rather than watch.',
      // Fewer frames than the other effects on purpose. A drift moves every pixel
      // in every frame, which defeats the encoder's inter-frame differencing, so
      // each extra frame costs roughly a full frame of bytes rather than a delta.
      // At this amplitude the motion still reads as smooth.
      frames: 14,
      delay: 11,
      needsSecondPhoto: false,
      // Zoom returns to exactly where it started, so the loop is seamless.
      loops: true,
    },
    ringdraw: {
      id: 'ringdraw',
      label: 'Ring draw',
      description: 'An accent ring draws itself around the photo once, then rests complete.',
      frames: 20,
      delay: 5,
      needsSecondPhoto: false,
      loops: true,
    },
    monogram: {
      id: 'monogram',
      label: 'Monogram reveal',
      description: 'Your initials resolve into your photo. Doubles as the blocked-image fallback.',
      frames: 18,
      delay: 7,
      needsSecondPhoto: false,
      needsMonogram: true,
      loops: true,
    },
  });

  function clamp(value, min, max) {
    return value < min ? min : value > max ? max : value;
  }

  function hexToRgb(hex) {
    const cleaned = String(hex || '').trim().replace(/^#/, '');
    const full = cleaned.length === 3
      ? cleaned.split('').map((c) => c + c).join('')
      : cleaned;
    if (!/^[0-9a-f]{6}$/i.test(full)) return [8, 145, 178]; // default primary
    return [
      parseInt(full.slice(0, 2), 16),
      parseInt(full.slice(2, 4), 16),
      parseInt(full.slice(4, 6), 16),
    ];
  }

  // Coverage of the photo shape at a pixel, 0..1, softened across roughly one
  // pixel so circular edges do not stair-step.
  function shapeCoverage(x, y, size, shape) {
    if (shape === 'square') return 1;

    const cx = size / 2;
    const cy = size / 2;
    const px = x + 0.5;
    const py = y + 0.5;
    const feather = 1;

    if (shape === 'rounded') {
      const radius = size * 0.16;
      const dx = Math.abs(px - cx) - (size / 2 - radius);
      const dy = Math.abs(py - cy) - (size / 2 - radius);
      const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) - radius;
      return clamp(0.5 - outside / feather, 0, 1);
    }

    // circle
    const dist = Math.hypot(px - cx, py - cy);
    return clamp(0.5 - (dist - size / 2) / feather, 0, 1);
  }

  // Precomputes shape coverage once — it is identical for every frame.
  function coverageMap(size, shape) {
    const map = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        map[y * size + x] = shapeCoverage(x, y, size, shape);
      }
    }
    return map;
  }

  // ── Effects ──
  //
  // Each returns a per-pixel adjustment applied to the source photo for frame `t`
  // (0..1 across the sequence). They must all return the untouched photo at t = 0.

  function sweepFrame(src, out, size, t) {
    // Band travels along the diagonal from fully off one corner to fully off the other.
    const centre = -0.35 + t * 1.7;
    const width = 0.16;
    const strength = 0.5;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        const u = (x + y) / (2 * size);
        const d = (u - centre) / width;
        const glow = Math.exp(-d * d) * strength;

        if (glow < 0.002) {
          out[i] = src[i];
          out[i + 1] = src[i + 1];
          out[i + 2] = src[i + 2];
        } else {
          // Lighten toward white, preserving the photo underneath.
          out[i] = src[i] + (255 - src[i]) * glow;
          out[i + 1] = src[i + 1] + (255 - src[i + 1]) * glow;
          out[i + 2] = src[i + 2] + (255 - src[i + 2]) * glow;
        }
        out[i + 3] = 255;
      }
    }
  }

  function ringFrame(src, out, size, t, accent) {
    // The ring is fully drawn in every frame; only the highlight position moves,
    // so frame 0 stands alone as a finished image.
    const cx = size / 2;
    const cy = size / 2;
    const ringWidth = Math.max(2, size * 0.05);
    const ringRadius = size / 2 - ringWidth / 2;
    const headAngle = -Math.PI / 2 + t * Math.PI * 2;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        out[i] = src[i];
        out[i + 1] = src[i + 1];
        out[i + 2] = src[i + 2];
        out[i + 3] = 255;

        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const dist = Math.hypot(dx, dy);
        const onRing = clamp(0.5 - (Math.abs(dist - ringRadius) - ringWidth / 2) / 1, 0, 1);
        if (onRing <= 0) continue;

        // Angular distance from the travelling highlight, wrapped to [-PI, PI].
        let delta = Math.atan2(dy, dx) - headAngle;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        const highlight = Math.exp(-(delta * delta) / 0.12);

        const r = accent[0] + (255 - accent[0]) * highlight;
        const g = accent[1] + (255 - accent[1]) * highlight;
        const b = accent[2] + (255 - accent[2]) * highlight;

        out[i] = out[i] + (r - out[i]) * onRing;
        out[i + 1] = out[i + 1] + (g - out[i + 1]) * onRing;
        out[i + 2] = out[i + 2] + (b - out[i + 2]) * onRing;
      }
    }
  }

  function crossfadeFrame(src, second, out, size, t) {
    // Hold on photo A, dissolve, hold on photo B. t = 0 is a clean photo A.
    const hold = 0.22;
    const mix = clamp((t - hold) / (1 - hold * 2), 0, 1);
    // Smoothstep keeps the dissolve from starting and stopping abruptly.
    const k = mix * mix * (3 - 2 * mix);

    for (let p = 0; p < size * size; p++) {
      const i = p * 4;
      out[i] = src[i] + (second[i] - src[i]) * k;
      out[i + 1] = src[i + 1] + (second[i + 1] - src[i + 1]) * k;
      out[i + 2] = src[i + 2] + (second[i + 2] - src[i + 2]) * k;
      out[i + 3] = 255;
    }
  }

  // Bilinear sample of the source at fractional coordinates, clamped at the edges.
  // Nearest-neighbour would make the drift visibly stair-step at this zoom range.
  function sampleBilinear(src, size, fx, fy, out, o) {
    const x0 = clamp(Math.floor(fx), 0, size - 1);
    const y0 = clamp(Math.floor(fy), 0, size - 1);
    const x1 = clamp(x0 + 1, 0, size - 1);
    const y1 = clamp(y0 + 1, 0, size - 1);
    const ax = clamp(fx - x0, 0, 1);
    const ay = clamp(fy - y0, 0, 1);

    const i00 = (y0 * size + x0) * 4;
    const i10 = (y0 * size + x1) * 4;
    const i01 = (y1 * size + x0) * 4;
    const i11 = (y1 * size + x1) * 4;

    for (let c = 0; c < 3; c++) {
      const top = src[i00 + c] + (src[i10 + c] - src[i00 + c]) * ax;
      const bottom = src[i01 + c] + (src[i11 + c] - src[i01 + c]) * ax;
      out[o + c] = top + (bottom - top) * ay;
    }
    out[o + 3] = 255;
  }

  // Ken Burns drift. The zoom follows a half-sine so it returns to exactly 1.0 at
  // both ends — frame 0 is the untouched photo and the loop closes invisibly.
  function driftFrame(src, out, size, t) {
    const amplitude = 0.045;
    const zoom = 1 + amplitude * Math.sin(Math.PI * t);
    const centre = (size - 1) / 2;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const fx = centre + (x - centre) / zoom;
        const fy = centre + (y - centre) / zoom;
        sampleBilinear(src, size, fx, fy, out, (y * size + x) * 4);
      }
    }
  }

  // The ring draws itself on rather than orbiting forever. Frame 0 is deliberately
  // the completed ring, because classic Outlook shows only that frame and a
  // partly-drawn arc would look like a rendering fault there. Every later frame
  // sweeps from empty back round to full, so a loop reads as a redraw that rests.
  function ringDrawFrame(src, out, size, t, accent) {
    const cx = size / 2;
    const cy = size / 2;
    const ringWidth = Math.max(2, size * 0.05);
    const ringRadius = size / 2 - ringWidth / 2;
    const progress = t === 0 ? 1 : t;
    const sweptTo = progress * Math.PI * 2;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        out[i] = src[i];
        out[i + 1] = src[i + 1];
        out[i + 2] = src[i + 2];
        out[i + 3] = 255;

        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const dist = Math.hypot(dx, dy);
        const onRing = clamp(0.5 - (Math.abs(dist - ringRadius) - ringWidth / 2) / 1, 0, 1);
        if (onRing <= 0) continue;

        // Angle measured clockwise from twelve o'clock, so the ring draws the way
        // a person would draw it.
        let angle = Math.atan2(dy, dx) + Math.PI / 2;
        while (angle < 0) angle += Math.PI * 2;
        while (angle >= Math.PI * 2) angle -= Math.PI * 2;
        if (angle > sweptTo) continue;

        // Feather the leading end so the arc does not terminate in a hard step.
        const lead = clamp((sweptTo - angle) * size * 0.02, 0, 1);
        const strength = onRing * lead;

        out[i] = out[i] + (accent[0] - out[i]) * strength;
        out[i + 1] = out[i + 1] + (accent[1] - out[i + 1]) * strength;
        out[i + 2] = out[i + 2] + (accent[2] - out[i + 2]) * strength;
      }
    }
  }

  // Monogram resolving into the photo. Frame 0 is the photo for the same
  // Outlook reason as the ring: the still fallback must be the finished result,
  // never the initials tile.
  function monogramFrame(src, monogram, out, size, f, count) {
    if (f === 0) {
      out.set(src);
      return;
    }

    // Frames 1..count-1 run monogram -> photo, holding briefly at each end.
    const t = (f - 1) / Math.max(1, count - 2);
    const hold = 0.18;
    const mix = clamp((t - hold) / (1 - hold * 2), 0, 1);
    const k = mix * mix * (3 - 2 * mix);

    for (let p = 0; p < size * size; p++) {
      const i = p * 4;
      out[i] = monogram[i] + (src[i] - monogram[i]) * k;
      out[i + 1] = monogram[i + 1] + (src[i + 1] - monogram[i + 1]) * k;
      out[i + 2] = monogram[i + 2] + (src[i + 2] - monogram[i + 2]) * k;
      out[i + 3] = 255;
    }
  }

  // Composites the shaped photo onto the opaque background.
  function applyShape(buffer, size, coverage, background) {
    for (let p = 0; p < size * size; p++) {
      const c = coverage[p];
      if (c >= 1) continue;
      const i = p * 4;
      buffer[i] = background[0] + (buffer[i] - background[0]) * c;
      buffer[i + 1] = background[1] + (buffer[i + 1] - background[1]) * c;
      buffer[i + 2] = background[2] + (buffer[i + 2] - background[2]) * c;
      buffer[i + 3] = 255;
    }
  }

  /**
   * Build the RGBA frame sequence for an animated signature photo.
   *
   * @param {object} options
   * @param {Uint8ClampedArray|Uint8Array} options.photo RGBA, size*size*4
   * @param {number} options.size square edge in pixels
   * @param {string} options.effect one of EFFECTS
   * @param {Uint8ClampedArray|Uint8Array} [options.secondPhoto] required for crossfade
   * @param {string} [options.shape] 'circle' | 'rounded' | 'square'
   * @param {string} [options.background] hex, shows behind circular/rounded photos
   * @param {string} [options.accentColor] hex, used by the ring effect
   * @returns {{frames: Array<Uint8ClampedArray>, delay: number, effect: object}}
   */
  function buildFrames(options) {
    const size = options.size;
    const photo = options.photo;
    const spec = EFFECTS[options.effect];

    if (!spec) throw new Error('unknown_effect');
    if (!size || !photo || photo.length !== size * size * 4) throw new Error('photo_size_mismatch');
    if (spec.needsSecondPhoto) {
      if (!options.secondPhoto || options.secondPhoto.length !== size * size * 4) {
        throw new Error('second_photo_required');
      }
    }
    // Rendered by the caller, because drawing glyphs needs a font and this module
    // stays pure pixel maths so it can run identically in Node and the browser.
    if (spec.needsMonogram) {
      if (!options.monogram || options.monogram.length !== size * size * 4) {
        throw new Error('monogram_required');
      }
    }

    const shape = options.shape || 'circle';
    const background = hexToRgb(options.background || '#ffffff');
    const accent = hexToRgb(options.accentColor || '#0891B2');
    const coverage = coverageMap(size, shape);
    const count = spec.frames;

    const frames = [];
    for (let f = 0; f < count; f++) {
      const t = count === 1 ? 0 : f / (count - 1);
      const frame = new Uint8ClampedArray(size * size * 4);

      if (spec.id === 'sweep') sweepFrame(photo, frame, size, t);
      else if (spec.id === 'ring') ringFrame(photo, frame, size, t, accent);
      else if (spec.id === 'drift') driftFrame(photo, frame, size, t);
      else if (spec.id === 'ringdraw') ringDrawFrame(photo, frame, size, t, accent);
      else if (spec.id === 'monogram') monogramFrame(photo, options.monogram, frame, size, f, count);
      else crossfadeFrame(photo, options.secondPhoto, frame, size, t);

      applyShape(frame, size, coverage, background);
      frames.push(frame);
    }

    return { frames, delay: spec.delay, effect: spec };
  }

  /**
   * Bakes the photo shape into a single still frame.
   *
   * Templates ask for circles and rounded corners with CSS `border-radius`, which
   * classic Outlook renders through the Word engine and ignores outright — so an
   * unmasked still arrives there as a hard square whatever the customer chose.
   * Baking the mask into the pixels makes the shape survive every client instead
   * of only the ones with a modern CSS engine.
   *
   * Composited onto an opaque background for the same reason the animated path is:
   * the still is stored as JPEG, which has no alpha channel at all.
   *
   * @param {object} options
   * @param {Uint8ClampedArray|Uint8Array} options.photo RGBA, size*size*4
   * @param {number} options.size square edge in pixels
   * @param {string} [options.shape] 'circle' | 'rounded' | 'square'
   * @param {string} [options.background] hex, shows behind circular/rounded photos
   * @returns {Uint8ClampedArray} a new shaped buffer; the input is left alone
   */
  function shapeStill(options) {
    const size = options.size;
    const photo = options.photo;
    if (!size || !photo || photo.length !== size * size * 4) throw new Error('photo_size_mismatch');

    const out = new Uint8ClampedArray(photo);
    const shape = options.shape || 'circle';
    // A square photo is already its own mask, so skip the per-pixel pass entirely.
    if (shape === 'square') return out;

    applyShape(out, size, coverageMap(size, shape), hexToRgb(options.background || '#ffffff'));
    return out;
  }

  return Object.freeze({
    EFFECTS,
    buildFrames,
    shapeStill,
    hexToRgb,
  });
});
