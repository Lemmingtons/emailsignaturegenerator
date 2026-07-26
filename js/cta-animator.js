// ── Animated CTA button ──
// Sweeps a soft highlight across an already-rendered call-to-action button and
// returns the frame sequence for GifEncoder.
//
// Same two constraints as the animated photo:
//
// 1. Frame 0 is the finished, resting button. Classic Outlook on Windows renders
//    only the first frame, so the still fallback must be a normal button — the
//    sheen is additive on top of something already legible.
// 2. GIF has no soft alpha, so the caller composites the button onto the
//    signature's background colour before passing pixels in. Rounded corners are
//    baked, not transparent.
//
// The caller renders the button (shape, colour and text) to a canvas; this module
// only moves light across it. That keeps the maths pure and testable under Node,
// exactly like js/photo-animator.js.

(function(root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  root.CtaAnimator = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {

  const DEFAULTS = Object.freeze({
    frames: 14,
    delay: 6,
    // How much of the button width the highlight covers. Narrow reads as a
    // deliberate glint; wide reads as the whole button flashing.
    bandWidth: 0.17,
    // Peak lightening, 0..1. Kept low so text stays readable as it passes.
    strength: 0.42,
    // Horizontal shift per unit of height, matching the skewed CSS sheen used on
    // the website's own buttons.
    skew: 0.35,
  });

  // Beyond this many band-widths the Gaussian is visually zero, so it is both the
  // per-pixel skip threshold and the clearance the band travels past each edge.
  const CUTOFF_SIGMAS = 4;

  function clamp01(value) {
    return value < 0 ? 0 : value > 1 ? 1 : value;
  }

  /**
   * @param {object} options
   * @param {Uint8ClampedArray|Uint8Array} options.button RGBA, width*height*4,
   *   already composited onto an opaque background
   * @param {number} options.width
   * @param {number} options.height
   * @param {number} [options.frames]
   * @param {number} [options.strength]
   * @returns {{frames: Array<Uint8ClampedArray>, delay: number}}
   */
  function buildFrames(options) {
    const width = options.width;
    const height = options.height;
    const button = options.button;

    if (!width || !height) throw new Error('cta_dimensions_required');
    if (!button || button.length !== width * height * 4) throw new Error('cta_size_mismatch');

    const count = Math.max(2, options.frames || DEFAULTS.frames);
    const bandWidth = options.bandWidth || DEFAULTS.bandWidth;
    const strength = options.strength == null ? DEFAULTS.strength : options.strength;
    const skew = options.skew == null ? DEFAULTS.skew : options.skew;

    // Precompute the skewed horizontal coordinate for every pixel; it does not
    // change between frames, only the band's centre does.
    const positions = new Float32Array(width * height);
    let minPos = Infinity;
    let maxPos = -Infinity;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const u = (x + (height - y) * skew) / width;
        positions[y * width + x] = u;
        if (u < minPos) minPos = u;
        if (u > maxPos) maxPos = u;
      }
    }

    // Start and end far enough outside the pixel range that the Gaussian
    // contributes nothing at either end. Derived from the real range rather than
    // hardcoded, so the first and last frames are exactly the resting button
    // whatever the button's aspect ratio or skew.
    const clearance = CUTOFF_SIGMAS * bandWidth;
    const start = minPos - clearance;
    const end = maxPos + clearance;

    const frames = [];
    for (let f = 0; f < count; f++) {
      const t = f / (count - 1);
      const centre = start + t * (end - start);
      const frame = new Uint8ClampedArray(width * height * 4);

      for (let p = 0; p < width * height; p++) {
        const i = p * 4;
        const d = (positions[p] - centre) / bandWidth;
        const glow = d > CUTOFF_SIGMAS || d < -CUTOFF_SIGMAS ? 0 : Math.exp(-d * d) * strength;

        if (glow < 0.003) {
          frame[i] = button[i];
          frame[i + 1] = button[i + 1];
          frame[i + 2] = button[i + 2];
        } else {
          const k = clamp01(glow);
          frame[i] = button[i] + (255 - button[i]) * k;
          frame[i + 1] = button[i + 1] + (255 - button[i + 1]) * k;
          frame[i + 2] = button[i + 2] + (255 - button[i + 2]) * k;
        }
        frame[i + 3] = 255;
      }

      frames.push(frame);
    }

    return { frames, delay: options.delay || DEFAULTS.delay };
  }

  return Object.freeze({
    DEFAULTS,
    buildFrames,
  });
});
