const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const generator = read('generator.html');
const landing = read('index.html');
const homeJs = read('js/home.js');
const healthCheck = read('health-check.html');
const styles = read('css/styles.css');
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

// Paywall: a native modal dialog, labelled, opened from the export buttons,
// closed by Escape (native cancel) and the secondary button, returning focus.
assert.match(generator, /<dialog id="paywallDialog"[^>]+aria-labelledby="paywallTitle"[^>]+aria-describedby="paywallLead"/);
assert.match(generator, /id="paywallTitle"[^>]+tabindex="-1"/);
assert.match(generator, /id="paywallPreview"[^>]*\binert\b/);
assert.match(generator, /Prices in USD, tax included\./);
assert.ok(!/tax may be added/i.test(generator), 'prices are tax-inclusive; never say tax is added at checkout');
assert.match(generator, /id="paywallCloseBtn"[^>]*>Keep editing</);
assert.match(generator, /id="paywallStatus"[^>]+role="status"[^>]+aria-live="polite"/);
assert.ok(!/paywallDialog[\s\S]*\$\d/.test(generator.slice(generator.indexOf('<dialog id="paywallDialog"'), generator.indexOf('</dialog>'))), 'paywall prices come from site facts');
assert.match(app, /dialog\.showModal\(\)/);
assert.match(app, /dialog\.addEventListener\('close', restorePaywallFocus\)/);
assert.match(app, /paywallReturnFocus = trigger/);
assert.match(app, /requireProForExport\(btn\)/);
// The Install step mirrors export feedback visually only; one live region.
assert.match(generator, /id="installStatusHint"[^>]+aria-hidden="true"/);
assert.match(generator, /id="accessLinkHint"[^>]+role="status"[^>]+aria-live="polite"/);

assert.match(landing, /id="sigCarouselToggle"[^>]+aria-pressed="false"[^>]*>Pause carousel</);
assert.match(landing, /<script src="js\/home\.js" defer><\/script>/);
assert.ok(!/<script(?![^>]*type="application\/ld\+json")(?![^>]*\bsrc=)/i.test(landing), 'index.html must not contain executable inline scripts');
assert.match(landing, /<section class="anti-sub-banner"[^>]*>\s*<h2>/);
assert.match(homeJs, /prefers-reduced-motion: reduce/);
assert.match(homeJs, /staticOnly \? D\.photoUrl : \(s\.photo \|\| D\.photoUrl\)/);
assert.match(homeJs, /if \(!staticOnly && s\.ctaImage\)/);
assert.ok(!homeJs.includes('Play carousel'), 'carousel toggle label must stay constant when using aria-pressed');
assert.match(homeJs, /if \(timer !== null\) clearInterval\(timer\)/);
assert.match(homeJs, /rotationPaused = !rotationPaused/);
assert.match(homeJs, /function startAuto\(ignoreInteractionPause\)/);
assert.match(homeJs, /!ignoreInteractionPause && \(pointerInside \|\| focusInside\)/);
assert.match(homeJs, /if \(rotationPaused\) stopAuto\(\); else startAuto\(true\)/);
assert.match(homeJs, /mouseenter[^\n]+stopAuto\(\)/);
assert.match(homeJs, /focusin[^\n]+stopAuto\(\)/);
assert.match(homeJs, /rotationToggle\.setAttribute\('aria-pressed', stopped \? 'true' : 'false'\)/);
assert.match(homeJs, /slide\.inert = i !== current/);

assert.match(healthCheck, /id="fileUpload"[^>]+class="file-input-accessible"/);
assert.ok(!/id="fileUpload"[^>]+display:\s*none/i.test(healthCheck), 'file upload input must remain keyboard accessible');
assert.ok(!/for="cardPublishBtn"/.test(generator), 'non-input button must not be targeted by a form label');
assert.match(generator, /<span class="field-label">Card page<\/span>/);
assert.match(generator, /id="dividerEffect"[^>]+aria-label="Divider animation effect"/);
assert.match(styles, /\.error-message\s*\{[^}]*color:\s*#b91c1c;/);
assert.match(styles, /\.sig-dot\s*\{[^}]*min-width:\s*24px;[^}]*min-height:\s*24px;/);

console.log('Frontend accessibility regression checks passed');
