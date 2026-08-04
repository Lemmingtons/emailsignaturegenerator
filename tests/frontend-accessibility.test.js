const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const generator = read('generator.html');
const landing = read('index.html');
const app = read('js/app.js');

assert.match(generator, /id="cropModal"[^>]+aria-labelledby="cropModalTitle"[^>]+aria-hidden="true"/);
assert.match(generator, /id="cropModalTitle"[^>]+tabindex="-1"/);
assert.match(app, /e\.key === 'Escape'/);
assert.match(app, /e\.key !== 'Tab'/);
assert.match(app, /cropReturnFocus\.focus\(\)/);
assert.match(app, /modal\.getAttribute\('aria-hidden'\) === 'true'/);

for (const id of ['fullName', 'email', 'website', 'linkedin', 'instagram', 'facebook', 'google']) {
  assert.match(generator, new RegExp(`id="${id}"[^>]+aria-describedby="${id}-error"[^>]+aria-invalid="false"`));
  assert.match(generator, new RegExp(`id="${id}-error"[^>]+role="alert"`));
}
assert.match(app, /setAttribute\('aria-invalid', 'true'\)/);
assert.match(app, /setAttribute\('aria-invalid', 'false'\)/);

assert.match(generator, /id="category-tabs" role="group"/);
assert.match(generator, /id="template-grid" role="group"/);
assert.match(app, /class="category-tab[^`]+aria-pressed=/);
assert.match(app, /class="template-card[^`]+aria-pressed=/);

for (const id of ['photoStatusHint', 'logoStatusHint', 'cardStatusHint', 'exportStatusHint', 'saveLinkHint']) {
  assert.match(generator, new RegExp(`id="${id}"[^>]+role="status"[^>]+aria-live="polite"`));
}
assert.match(app, /function updateLiveStatus/);
assert.match(app, /kind === 'error' \? 'assertive' : 'polite'/);

assert.match(landing, /id="sigCarouselToggle"[^>]+aria-pressed="false"[^>]*>Pause carousel</);
assert.match(landing, /prefers-reduced-motion: reduce/);
assert.match(landing, /if \(timer !== null\) clearInterval\(timer\)/);
assert.match(landing, /rotationPaused = !rotationPaused/);
assert.match(landing, /function startAuto\(ignoreInteractionPause\)/);
assert.match(landing, /!ignoreInteractionPause && \(pointerInside \|\| focusInside\)/);
assert.match(landing, /if \(rotationPaused\) stopAuto\(\); else startAuto\(true\)/);
assert.match(landing, /mouseenter[^\n]+stopAuto\(\)/);
assert.match(landing, /focusin[^\n]+stopAuto\(\)/);
assert.match(landing, /rotationToggle\.setAttribute\('aria-pressed', stopped \? 'true' : 'false'\)/);
assert.match(landing, /slide\.inert = i !== current/);

console.log('Frontend accessibility regression checks passed');
