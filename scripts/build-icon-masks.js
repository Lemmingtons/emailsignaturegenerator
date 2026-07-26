#!/usr/bin/env node
// Regenerates js/icon-masks.js from the raw masks in assets/icon-masks/.
//
// The .bin files are the source of truth. They were produced by rasterising the
// original icon SVGs to 44px in a browser canvas and keeping the alpha channel;
// see NEXT_STEPS.md if they ever need rebuilding from new artwork.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const NAMES = ['website', 'linkedin', 'instagram', 'facebook', 'google'];
const SIZE = 44;

const entries = NAMES.map((name) => {
  const data = fs.readFileSync(path.join(root, `assets/icon-masks/${name}.bin`));
  if (data.length !== SIZE * SIZE) {
    throw new Error(`${name}.bin is ${data.length} bytes, expected ${SIZE * SIZE}`);
  }
  return `  ${name}: '${data.toString('base64')}',`;
});

const module_ = `// ── Social icon alpha masks ──
// Generated from assets/icon-masks/*.bin by scripts/build-icon-masks.js.
// Do not hand-edit; regenerate instead.
//
// Embedded in the bundle rather than fetched from the assets binding: the binding
// only serves the request the Worker was handed, not ones it constructs, and
// inlining also removes a subrequest per icon.
//
// Each entry is base64 of ICON_SIZE*ICON_SIZE bytes of 8-bit alpha, rasterised
// from the original icon SVGs at 44px (2x the 22px display size).

export const ICON_MASK_SIZE = ${SIZE};

export const ICON_MASKS = {
${entries.join('\n')}
};

export function decodeMask(name) {
  const b64 = ICON_MASKS[name];
  if (!b64) return null;
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
`;

fs.writeFileSync(path.join(root, 'js/icon-masks.js'), module_);
console.log(`wrote js/icon-masks.js from ${NAMES.length} masks`);
