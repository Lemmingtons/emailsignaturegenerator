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

console.table(results);
console.log(`\nTotal: ${results.reduce((n, r) => n + r.kb, 0).toFixed(1)} KB across ${results.length} files`);
