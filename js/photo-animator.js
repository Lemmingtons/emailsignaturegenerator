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
    },
    ring: {
      id: 'ring',
      label: 'Ring orbit',
      description: 'An accent ring sits around the photo with a highlight travelling round it.',
      frames: 18,
      delay: 6,
      needsSecondPhoto: false,
    },
    crossfade: {
      id: 'crossfade',
      label: 'Two-photo crossfade',
      description: 'Rests on your first photo, dissolves to the second, holds.',
      frames: 16,
      delay: 8,
      needsSecondPhoto: true,
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
      else crossfadeFrame(photo, options.secondPhoto, frame, size, t);

      applyShape(frame, size, coverage, background);
      frames.push(frame);
    }

    return { frames, delay: spec.delay, effect: spec };
  }

  return Object.freeze({
    EFFECTS,
    buildFrames,
    hexToRgb,
  });
});
