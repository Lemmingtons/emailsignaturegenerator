#!/usr/bin/env node
// Builds the animated demo photos used by the landing-page carousel.
//
// One-off asset builder, not part of `npm run check`. Run it when the carousel's
// accent colours change or the sample headshot is replaced:
//
//   node scripts/build-demo-animations.js
//
// Requires python3 with Pillow, used only to decode the sample JPEG to raw RGBA
// (the browser uses canvas for this; Node has neither). Everything after that is
// the project's own code, so the output is byte-for-byte what the product ships.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const GifEncoder = require(path.join(root, 'js/gif-encoder.js'));
const PhotoAnimator = require(path.join(root, 'js/photo-animator.js'));
const SweepAnimator = require(path.join(root, 'js/sweep-animator.js'));

// Smaller than the 160px the generator produces: the carousel renders photos at
// 80-100px, and halving the pixel count roughly halves the file.
const SIZE = 120;
const HOLD_CS = 500; // must match ANIMATION_HOLD_CS in js/app.js

// The ring bakes its accent colour into the pixels, so it needs one file per
// carousel accent. The shine sweep only lightens, so a single file serves every
// slide whatever its colour.
const DEMOS = [
  { file: 'demo-photo-ring-0891B2.gif', effect: 'ring', accent: '#0891B2' },
  { file: 'demo-photo-ring-0D9488.gif', effect: 'ring', accent: '#0D9488' },
  { file: 'demo-photo-sweep.gif', effect: 'sweep', accent: '#0891B2' },
];

function loadHeadshot(size) {
  const source = path.join(root, 'assets/sample-headshot.jpg');
  const raw = path.join(root, `.wrangler/tmp-headshot-${size}.raw`);
  fs.mkdirSync(path.dirname(raw), { recursive: true });

  execFileSync('python3', ['-c', `
from PIL import Image
im = Image.open(${JSON.stringify(source)}).convert("RGB").resize((${size}, ${size}), Image.LANCZOS)
data = im.tobytes()
out = bytearray()
for i in range(0, len(data), 3):
    out += data[i:i+3] + b"\\xff"
open(${JSON.stringify(raw)}, "wb").write(bytes(out))
`]);

  const bytes = new Uint8ClampedArray(fs.readFileSync(raw));
  fs.unlinkSync(raw);
  return bytes;
}

// Mirrors CTA_STYLE and renderCtaButtonCanvas in js/app.js. If those change, this
// must change with them or the carousel will advertise a button the generator does
// not produce. PIL and canvas measure text slightly differently, so the height can
// land a pixel either side of the browser's — harmless for a demo, but it is why
// the slide carries an explicit height rather than inferring one.
const CTA = { scale: 2, paddingX: 20, paddingY: 8, radius: 5, fontSize: 12 };

function renderCtaButton(label, accent) {
  const raw = path.join(root, '.wrangler/tmp-cta.raw');
  fs.mkdirSync(path.dirname(raw), { recursive: true });

  const meta = execFileSync('python3', ['-c', `
from PIL import Image, ImageDraw, ImageFont
label = ${JSON.stringify(label)}
scale, pad_x, pad_y, radius, size = ${CTA.scale}, ${CTA.paddingX}, ${CTA.paddingY}, ${CTA.radius}, ${CTA.fontSize}
try:
    font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", size * scale)
except Exception:
    font = ImageFont.load_default()
probe = ImageDraw.Draw(Image.new("RGB", (1, 1)))
box = probe.textbbox((0, 0), label, font=font)
tw, th = box[2] - box[0], box[3] - box[1]
w = tw + pad_x * 2 * scale
h = int(size * 1.35 * scale) + pad_y * 2 * scale
im = Image.new("RGB", (w, h), "white")
d = ImageDraw.Draw(im)
d.rounded_rectangle([0, 0, w - 1, h - 1], radius=radius * scale, fill=${JSON.stringify(accent)})
d.text(((w - tw) / 2 - box[0], (h - th) / 2 - box[1]), label, font=font, fill="white")
data = im.tobytes()
out = bytearray()
for i in range(0, len(data), 3):
    out += data[i:i+3] + b"\\xff"
open(${JSON.stringify(raw)}, "wb").write(bytes(out))
print(f"{w},{h}")
`]).toString().trim();

  const [width, height] = meta.split(',').map(Number);
  const bytes = new Uint8ClampedArray(fs.readFileSync(raw));
  fs.unlinkSync(raw);
  return { bytes, width, height };
}

const photo = loadHeadshot(SIZE);
const results = [];

for (const demo of DEMOS) {
  const spec = PhotoAnimator.EFFECTS[demo.effect];
  const built = PhotoAnimator.buildFrames({
    photo,
    size: SIZE,
    effect: demo.effect,
    shape: 'circle',
    background: '#ffffff',
    accentColor: demo.accent,
  });

  if (!spec.loops) throw new Error(`${demo.effect} cannot loop; not suitable as a demo`);

  // Same breathing loop the product ships: one pass, then a long rest.
  const bytes = GifEncoder.encode({
    width: SIZE,
    height: SIZE,
    frames: built.frames.concat([built.frames[0]]),
    delay: built.frames.map(() => built.delay).concat([HOLD_CS]),
    loop: true,
    dither: false,
  });

  const out = path.join(root, 'assets', demo.file);
  fs.writeFileSync(out, Buffer.from(bytes));
  results.push({ file: demo.file, effect: demo.effect, accent: demo.accent, kb: +(bytes.length / 1024).toFixed(1) });
}

// ── Animated CTA button for the Sales / CTA slide ──
{
  const label = 'Book a Meeting';
  const accent = '#EA580C';
  const button = renderCtaButton(label, accent);

  const built = SweepAnimator.buildFrames({
    artwork: button.bytes,
    width: button.width,
    height: button.height,
  });

  const bytes = GifEncoder.encode({
    width: button.width,
    height: button.height,
    frames: built.frames.concat([built.frames[0]]),
    delay: built.frames.map(() => built.delay).concat([HOLD_CS]),
    loop: true,
    dither: false,
  });

  fs.writeFileSync(path.join(root, 'assets/demo-cta-EA580C.gif'), Buffer.from(bytes));
  results.push({
    file: 'demo-cta-EA580C.gif',
    effect: 'button sheen',
    accent,
    kb: +(bytes.length / 1024).toFixed(1),
  });

  console.log(`\nCTA button rendered at ${button.width}x${button.height} (css ${button.width / CTA.scale}x${button.height / CTA.scale}).`);
  console.log('Use those css dimensions for ctaImageWidth / ctaImageHeight in the carousel slide.');
}

console.table(results);
console.log(`\nTotal: ${results.reduce((n, r) => n + r.kb, 0).toFixed(1)} KB across ${results.length} files`);
