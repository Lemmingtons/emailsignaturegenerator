const assert = require('node:assert/strict');
require('../js/site-facts.js');
require('../js/generator-core.js');
const { TEMPLATES } = require('../js/templates.js');
const bulk = require('../js/bulk-core.js');
const facts = globalThis.SiteFacts;

// Per-person booking links must survive CSV import, shared defaults and rendering.
const bookingRows = bulk.employeesFromGrid(bulk.parseDelimited('Full Name,Email,ctaText,ctaUrl\nAlex QA,alex@example.com,Book Alex,https://example.com/alex\nJamie QA,jamie@example.com,,\n'));
for (const template of ['ctabox', 'banner', 'meetinglink', 'realestate', 'showcase', 'cardstock']) {
  const result = bulk.generateBatch({ template, style: { ctaText: 'Book the team', ctaUrl: 'https://example.com/team' }, employees: bookingRows.employees });
  assert.equal(result.valid, 2);
  assert.match(result.results[0].html, /href="https:\/\/example.com\/alex"/);
  assert.match(result.results[0].html, /Book Alex/);
  assert.ok(!result.results[0].html.includes('https://example.com/team'), `${template} gives employee booking data precedence`);
  assert.match(result.results[1].html, /href="https:\/\/example.com\/team"/);
  assert.match(result.results[1].html, /Book the team/);
  const defaulted = bulk.generateBatch({ template, defaults: { ctaText: 'Default booking', ctaUrl: 'https://example.com/default' }, employees: [{ fullName: 'Alex' }] });
  assert.match(defaulted.results[0].html, /href="https:\/\/example.com\/default"/);
  const missing = bulk.generateBatch({ template, employees: [{ fullName: 'Alex', ctaText: 'No destination' }] });
  assert.ok(!missing.results[0].html.includes('href="#"'), `${template} never emits a dead booking link`);
  assert.ok(!missing.results[0].html.includes('No destination'), `${template} omits a button without a destination`);
  const unsafe = bulk.generateBatch({ template, employees: [{ fullName: 'Alex', ctaUrl: 'javascript:alert(1)' }] });
  assert.equal(unsafe.invalid, 1);
  const escaped = bulk.generateBatch({ template, employees: [{ fullName: 'Alex', ctaText: '<img src=x onerror=alert(1)>', ctaUrl: 'https://example.com/?a=1&b=2' }] });
  assert.ok(!escaped.results[0].html.includes('<img src=x'));
  assert.match(escaped.results[0].html, /&lt;img/);
  assert.match(escaped.results[0].html, /href="https:\/\/example.com\/\?a=1&amp;b=2"/);
}

const quoted = bulk.employeesFromGrid(bulk.parseDelimited('\uFEFFFull Name,Job Title,Email,Phone,Notes\r\n"Morgan, Alex","Director ""Studio""",alex@example.com,001234,ignore\r\n\r\nSam Lee,Designer,sam@example.com,+61 2 5550 0102,more\r\n'));
assert.equal(quoted.employees[0].fullName, 'Morgan, Alex');
assert.equal(quoted.employees[0].title, 'Director "Studio"');
assert.equal(quoted.employees[0].phone, '001234');
assert.deepEqual(quoted.rowNumbers, [2, 4]);
assert.deepEqual(quoted.ignored, ['Notes']);
assert.equal(bulk.employeesFromGrid(bulk.parseDelimited('Full Name\tEmail\nAlex\talex@example.com')).employees[0].email, 'alex@example.com');
assert.equal(bulk.employeesFromGrid(bulk.parseDelimited('Full Name;Email\nAlex;alex@example.com')).employees[0].email, 'alex@example.com');
assert.equal(bulk.parseDelimited('Full Name,Job Title\nAlex,"A\nB"')[1][1], 'A\nB');
assert.throws(() => bulk.parseDelimited('Full Name\n"Alex'), /closing/);
assert.throws(() => bulk.parseDelimited('Full Name\n"Alex"junk'), /quotation/);
assert.throws(() => bulk.parseDelimited('Full Name\nA"lex'), /quotation/);
assert.throws(() => bulk.parseDelimited('x'.repeat(facts.bulkMaxSpreadsheetBytes + 1)), /500 KB/);
assert.throws(() => bulk.employeesFromGrid([]), /empty/);
assert.throws(() => bulk.employeesFromGrid([['Name']]), /at least one/);
assert.throws(() => bulk.employeesFromGrid([['Email'], ['alex@example.com']]), /Full Name/);
assert.throws(() => bulk.employeesFromGrid([['Name', 'Full Name'], ['A', 'B']]), /same field/);
assert.throws(() => bulk.employeesFromGrid([['Name'], ['Alex', 'extra']]), /beyond/);
assert.throws(() => bulk.employeesFromGrid([['Name'], [new Date()]]), /text/);
assert.throws(() => bulk.employeesFromGrid([['Name'], ...Array.from({ length: facts.bulkMaxRows + 1 }, () => ['Alex'])]), /at most/);

for (const template of Object.keys(TEMPLATES)) {
  const batch = bulk.generateBatch({ template, defaults: { company: 'Example Studio', website: 'https://example.com' }, employees: quoted.employees });
  assert.equal(batch.valid, 2, template);
  assert.match(batch.results[0].html, /Morgan, Alex|MORGAN, ALEX/);
  assert.match(batch.results[0].html, /role="presentation"/);
  assert.ok(!/<script|onerror=|javascript:/i.test(batch.results[0].html));
  assert.ok(!/<table(?![^>]*role="presentation")/i.test(batch.results[0].html));
  assert.ok(batch.results[0].text.includes('001234'));
}
const hostile = bulk.generateBatch({ employees: [
  { fullName: '<script>alert(1)</script>', company: 'A & "B"', email: 'a@example.com', website: 'https://example.com/?x=%22' },
  { fullName: 'Unsafe URL', photoUrl: 'data:image/svg+xml,<svg onload=alert(1)>' },
  { fullName: 'Unsafe URL', website: 'javascript:alert(1)' },
  { fullName: 'Missing protocol', linkedin: '//example.com' },
  { fullName: 'Credentialed URL', website: 'https://user:pass@example.com' },
  { fullName: '', email: 'bad' },
  { fullName: 'Object', email: { value: 'a@example.com' } },
  null,
] });
assert.equal(hostile.valid, 1);
assert.equal(hostile.invalid, 7);
assert.ok(!hostile.results[0].html.includes('<script>'));
assert.match(hostile.results[0].html, /&lt;script&gt;/);
assert.ok(hostile.results.slice(1).every((row) => row.html === '' && row.errors.length));
const duplicate = bulk.generateBatch({ employees: [{ fullName: 'Alex', email: 'ALEx@example.com' }, { fullName: 'Sam', email: 'alex@example.com' }] });
assert.equal(duplicate.invalid, 2);
assert.ok(duplicate.results.every((row) => row.errors.some((e) => e.field === 'email')));
assert.throws(() => bulk.createZip(duplicate), /at least one/);
const filenames = bulk.generateBatch({ employees: [{ fullName: '../../' }, { fullName: '../../' }, { fullName: '李明' }] });
assert.equal(new Set(filenames.results.map((row) => row.filename)).size, 3);
assert.ok(filenames.results.every((row) => /^[a-z0-9-]+$/.test(row.filename)));
for (const payload of [null, [], {}, { employees: [] }, { employees: [{}], template: '__proto__' }, { employees: [{}], template: 'render' }]) {
  assert.throws(() => bulk.generateBatch(payload));
}
for (const style of [null, [], { primaryColor: 'red' }, { fontFamily: 'Arial; color:red' }, { ctaUrl: 'javascript:alert(1)' }, { unexpected: 'value' }]) {
  assert.throws(() => bulk.generateBatch({ style, employees: [{ fullName: 'Alex' }] }), /Style|style/);
}
assert.throws(() => bulk.generateBatch({ defaults: { fullName: 'Everyone' }, employees: [{}] }), /Unsupported/);
assert.throws(() => bulk.generateBatch({ defaults: { logoUrl: 'data:image/png;base64,AAA' }, employees: [{}] }), /URL/);
assert.equal(bulk.generateBatch({ employees: [{ fullName: 'No optional fields' }] }).valid, 1);
assert.equal(bulk.generateBatch({ employees: [{ fullName: 'Too long'.repeat(50) }] }).results[0].html, '');
assert.throws(() => bulk.checkXlsxArchive(new ArrayBuffer(0)), /valid/);
assert.throws(() => bulk.checkXlsxArchive(new ArrayBuffer(facts.bulkMaxSpreadsheetBytes + 1)), /500 KB/);
const draftPayload = { template: 'classic', defaults: { company: 'Example' }, employees: quoted.employees };
const draftNow = Date.now();
const draft = bulk.encodeBulkCheckoutDraft(draftPayload, quoted, draftNow);
assert.deepEqual(bulk.decodeBulkCheckoutDraft(draft, draftNow).payload, draftPayload);
assert.deepEqual(bulk.decodeBulkCheckoutDraft(draft, draftNow).rowNumbers, [2, 4]);
assert.equal(bulk.decodeBulkCheckoutDraft(draft, draftNow + 24 * 60 * 60 * 1000 + 1), null);
assert.equal(bulk.decodeBulkCheckoutDraft(draft, draftNow - 1), null);
assert.equal(bulk.decodeBulkCheckoutDraft('{broken'), null);
assert.equal(bulk.decodeBulkCheckoutDraft(JSON.stringify({ version: 1, createdAt: draftNow, payload: draftPayload, rowNumbers: [2] }), draftNow), null);
assert.ok(!draft.includes('token') && !draft.includes('key'));
console.log(`Bulk core tests passed (${Object.keys(TEMPLATES).length} templates, CSV/TSV, validation and hostile inputs).`);
