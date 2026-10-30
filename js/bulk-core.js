(function(root, factory) {
  const bulk = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = bulk;
  root.SignatureBulk = bulk;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(root) {
  const fields = Object.freeze([
    'fullName', 'title', 'company', 'phone', 'email', 'website',
    'photoUrl', 'logoUrl', 'linkedin', 'instagram', 'facebook', 'google', 'ctaText', 'ctaUrl', 'nameLinkUrl',
  ]);
  const urlFields = new Set(['website', 'photoUrl', 'logoUrl', 'linkedin', 'instagram', 'facebook', 'google', 'ctaUrl', 'nameLinkUrl']);
  const aliases = {
    name: 'fullName', fullname: 'fullName', employeename: 'fullName',
    jobtitle: 'title', role: 'title', companyname: 'company', organisation: 'company', organization: 'company',
    phonenumber: 'phone', telephone: 'phone', emailaddress: 'email',
    url: 'website', websiteurl: 'website', companywebsite: 'website',
    photo: 'photoUrl', photourl: 'photoUrl', logo: 'logoUrl', logourl: 'logoUrl',
    linkedinurl: 'linkedin', instagramurl: 'instagram', facebookurl: 'facebook', googleurl: 'google',
  };
  const normalizedFields = Object.fromEntries(fields.map((field) => [field.toLowerCase(), field]));
  const encoder = new TextEncoder();

  function error(code, message, status = 400) {
    return Object.assign(new Error(message), { code, status });
  }

  function record(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function httpUrl(value) {
    if (/[\u0000-\u0020\u007f]/.test(value)) return false;
    try {
      const url = new URL(value);
      return /^https?:$/.test(url.protocol) && Boolean(url.hostname) && !url.username && !url.password;
    } catch { return false; }
  }

  function cleanData(input, isDefault = false) {
    if (!record(input)) return { data: {}, errors: [{ field: 'row', message: 'Each employee must be an object.' }] };
    const data = {};
    const errors = [];
    Object.keys(input).forEach((field) => {
      if (!fields.includes(field) || (isDefault && ['fullName', 'email', 'photoUrl', 'nameLinkUrl'].includes(field))) {
        errors.push({ field, message: 'Unsupported field.' });
        return;
      }
      const value = input[field];
      if (typeof value !== 'string') {
        errors.push({ field, message: 'Use text for this field.' });
        return;
      }
      data[field] = value.trim();
      if (data[field].length > (urlFields.has(field) ? 2048 : 300)) {
        errors.push({ field, message: 'This value is too long.' });
      } else if (/[\u0000-\u001f\u007f]/.test(data[field])) {
        errors.push({ field, message: 'Remove line breaks and control characters.' });
      } else if (urlFields.has(field) && data[field] && !httpUrl(data[field])) {
        errors.push({ field, message: 'Use a full http:// or https:// URL without spaces or credentials.' });
      } else if (field === 'email' && data[field] && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data[field])) {
        errors.push({ field, message: 'Enter a valid email address.' });
      }
    });
    return { data, errors };
  }

  function generateBatch(payload) {
    const facts = root.SiteFacts;
    const core = root.SignatureGeneratorCore;
    const templates = root.SignatureTemplates.TEMPLATES;
    if (!record(payload) || Object.keys(payload).some((key) => !['template', 'style', 'defaults', 'employees'].includes(key))) {
      throw error('invalid_payload', 'Use template, style, defaults and employees only.');
    }
    if (!Array.isArray(payload.employees) || !payload.employees.length) throw error('invalid_employees', 'Add at least one employee.');
    if (payload.employees.length > facts.bulkMaxRows) throw error('too_many_rows', `Use at most ${facts.bulkMaxRows} employees per batch.`, 413);
    const templateId = payload.template === undefined ? 'classic' : payload.template;
    if (typeof templateId !== 'string' || !Object.hasOwn(templates, templateId)) throw error('invalid_template', 'Choose an available template.');
    const defaults = cleanData(payload.defaults === undefined ? {} : payload.defaults, true);
    if (defaults.errors.length) throw error('invalid_defaults', defaults.errors.map((e) => `${e.field}: ${e.message}`).join(' '));
    const inputStyle = payload.style === undefined ? {} : payload.style;
    if (!record(inputStyle)) throw error('invalid_style', 'Style must be an object.');
    const style = core.createStyle(inputStyle);
    for (const [key, value] of Object.entries(inputStyle)) {
      if (!Object.hasOwn(style, key) || typeof value !== 'string' || value !== style[key] || value.length > 2048 ||
          (key === 'ctaUrl' && value && !httpUrl(value)) || /[\u0000-\u001f\u007f]/.test(value)) {
        throw error('invalid_style', `Invalid style option: ${key}.`);
      }
    }
    const cleaned = payload.employees.map((input) => {
      const row = cleanData(input);
      row.data = { ...defaults.data, ...row.data };
      if (!row.data.fullName) row.errors.push({ field: 'fullName', message: 'A full name is required.' });
      return row;
    });
    const emails = new Map();
    cleaned.forEach(({ data }, index) => {
      if (!data.email) return;
      const key = data.email.toLowerCase();
      emails.set(key, [...(emails.get(key) || []), index]);
    });
    emails.forEach((indices) => {
      if (indices.length > 1) indices.forEach((index) => cleaned[index].errors.push({ field: 'email', message: 'This email appears more than once in the batch.' }));
    });
    const results = cleaned.map(({ data, errors }, index) => {
      const stem = String(data.fullName || 'employee').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60).toLowerCase() || 'employee';
      return {
        row: index + 1, fullName: data.fullName || '', email: data.email || '',
        filename: `${String(index + 1).padStart(3, '0')}-${stem}`,
        html: errors.length ? '' : core.buildSignatureHtml({ template: templates[templateId], data, style }),
        text: errors.length ? '' : core.plainTextFromData(data), errors,
      };
    });
    const valid = results.filter((row) => !row.errors.length).length;
    return { template: templateId, total: results.length, valid, invalid: results.length - valid, results };
  }

  // A small, uncompressed ZIP writer. Bounded batches do not need compression,
  // streaming, ZIP64, or an extra runtime dependency.
  function zipFiles(files) {
    const chunks = [];
    const entries = [];
    let offset = 0;
    for (const [name, text] of files) {
      const path = encoder.encode(name);
      const bytes = encoder.encode(text);
      let crc = 0xffffffff;
      for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
      }
      crc = (crc ^ 0xffffffff) >>> 0;
      const local = new Uint8Array(30 + path.length);
      const view = new DataView(local.buffer);
      view.setUint32(0, 0x04034b50, true);
      view.setUint16(4, 20, true);
      view.setUint16(6, 0x800, true);
      view.setUint16(12, 0x21, true); // 1980-01-01, a valid DOS date.
      view.setUint32(14, crc, true);
      view.setUint32(18, bytes.length, true);
      view.setUint32(22, bytes.length, true);
      view.setUint16(26, path.length, true);
      local.set(path, 30);
      const directory = new Uint8Array(46 + path.length);
      const dir = new DataView(directory.buffer);
      dir.setUint32(0, 0x02014b50, true);
      dir.setUint16(4, 20, true);
      dir.setUint16(6, 20, true);
      dir.setUint16(8, 0x800, true);
      dir.setUint16(14, 0x21, true);
      dir.setUint32(16, crc, true);
      dir.setUint32(20, bytes.length, true);
      dir.setUint32(24, bytes.length, true);
      dir.setUint16(28, path.length, true);
      dir.setUint32(42, offset, true);
      directory.set(path, 46);
      entries.push(directory);
      chunks.push(local, bytes);
      offset += local.length + bytes.length;
    }
    const directorySize = entries.reduce((sum, item) => sum + item.length, 0);
    const end = new Uint8Array(22);
    const view = new DataView(end.buffer);
    view.setUint32(0, 0x06054b50, true);
    view.setUint16(8, entries.length, true);
    view.setUint16(10, entries.length, true);
    view.setUint32(12, directorySize, true);
    view.setUint32(16, offset, true);
    const result = new Uint8Array(offset + directorySize + end.length);
    let position = 0;
    for (const part of [...chunks, ...entries, end]) { result.set(part, position); position += part.length; }
    return result;
  }

  function createZip(batch) {
    if (!batch.valid) throw error('no_valid_rows', 'Fix at least one employee before downloading.', 422);
    const files = [['README.txt', `EMAIL SIGNATURES\n\n${batch.valid} generated; ${batch.invalid} need correction.\n\nEach employee has an HTML signature and a plain-text fallback in signatures/.\nOpen their HTML file in a browser, select the rendered signature and copy it into their email signature settings. Do not paste the HTML source.\nGmail: Settings > See all settings > General > Signature.\nOutlook: Settings > Accounts > Signatures (wording varies by version).\nTest a message to yourself after installing. No mailbox settings have been changed automatically.\nImages must stay available at their original public URLs.\n\nmanifest.json lists every employee. errors.json lists excluded entries. Row numbers are 1-based positions in the employees array, excluding the spreadsheet header and blank rows.\nThis archive contains staff contact details. Share it only with the appropriate people.\n`]];
    batch.results.filter((row) => !row.errors.length).forEach((row) => {
      files.push([`signatures/${row.filename}.html`, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src https: http:;"><title>${root.SignatureGeneratorCore.escapeAttr(row.fullName)} — Email signature</title></head><body>${row.html}</body></html>`]);
      files.push([`signatures/${row.filename}.txt`, row.text]);
    });
    const manifest = batch.results.map(({ row, fullName, email, filename, errors }) => ({ row, fullName, email, file: errors.length ? null : `signatures/${filename}.html`, errors }));
    files.push(['manifest.json', JSON.stringify(manifest, null, 2)]);
    files.push(['errors.json', JSON.stringify(manifest.filter((row) => row.errors.length), null, 2)]);
    return zipFiles(files);
  }

  function parseDelimited(text) {
    if (typeof text !== 'string' || encoder.encode(text).length > root.SiteFacts.bulkMaxSpreadsheetBytes) throw error('file_too_large', 'Use a spreadsheet under 500 KB.');
    text = text.replace(/^\uFEFF/, '');
    const firstLine = text.split(/\r?\n/, 1)[0];
    const delimiter = firstLine.includes('\t') ? '\t' : firstLine.includes(';') && !firstLine.includes(',') ? ';' : ',';
    const rows = [];
    let row = [], value = '', quoted = false, closed = false;
    function cell() { row.push(value); value = ''; closed = false; }
    function finish() {
      cell(); rows.push(row); row = [];
      if (rows.length > 5000) throw error('too_many_rows', 'Remove unused rows from the spreadsheet.');
    }
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"' && text[i + 1] === '"') { value += '"'; i++; }
        else if (ch === '"') { quoted = false; closed = true; }
        else value += ch;
      } else if (ch === delimiter) cell();
      else if (ch === '\r' || ch === '\n') { if (ch === '\r' && text[i + 1] === '\n') i++; finish(); }
      else if (ch === '"' && !value && !closed) quoted = true;
      else if (closed || ch === '"') throw error('invalid_csv', 'Check the quotation marks in the CSV file.');
      else value += ch;
      if (row.length > 64) throw error('too_many_columns', 'Use at most 64 columns.');
    }
    if (quoted) throw error('invalid_csv', 'A quoted CSV cell has no closing quotation mark.');
    if (value || row.length || closed) finish();
    return rows;
  }

  function employeesFromGrid(grid) {
    if (!Array.isArray(grid) || grid.length > 5000) throw error('invalid_spreadsheet', 'Use a header and a short employee list.');
    const nonempty = grid.map((cells, index) => ({ cells, number: index + 1 }))
      .filter(({ cells }) => Array.isArray(cells) && cells.some((value) => value !== null && value !== undefined && String(value).trim()));
    if (!nonempty.length) throw error('empty_file', 'The spreadsheet is empty.');
    const header = nonempty.shift().cells;
    if (header.length > 64) throw error('too_many_columns', 'Use at most 64 columns.');
    const ignored = [];
    const columns = header.map((value) => {
      const name = String(value || '').trim();
      const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, '');
      const field = Object.hasOwn(normalizedFields, normalized) ? normalizedFields[normalized]
        : Object.hasOwn(aliases, normalized) ? aliases[normalized] : null;
      if (!field && name) ignored.push(name);
      return field || null;
    });
    if (!columns.includes('fullName')) throw error('missing_name_column', 'Add a Full Name column, or download the sample spreadsheet.');
    const used = columns.filter(Boolean);
    if (new Set(used).size !== used.length) throw error('duplicate_columns', 'Two columns map to the same field. Keep one column per field.');
    if (!nonempty.length) throw error('empty_file', 'Add at least one employee below the header.');
    if (nonempty.length > root.SiteFacts.bulkMaxRows) throw error('too_many_rows', `Use at most ${root.SiteFacts.bulkMaxRows} employees per batch.`, 413);
    const employees = nonempty.map(({ cells, number }) => {
      if (cells.length > 64 || cells.slice(header.length).some((cell) => cell !== null && cell !== undefined && String(cell).trim())) {
        throw error('unheaded_cells', `Spreadsheet row ${number} has values beyond the column headings.`);
      }
      const employee = {};
      columns.forEach((field, index) => {
        const value = cells[index];
        if (!field || value === null || value === undefined || value === '') return;
        if (!['string', 'number'].includes(typeof value)) throw error('invalid_cell', `Use text in spreadsheet row ${number}.`);
        employee[field] = String(value).trim();
      });
      return employee;
    });
    return { employees, rowNumbers: nonempty.map((row) => row.number), ignored };
  }

  // Bound claimed expansion before handing an XLSX archive to the parser.
  // Parsing itself happens in a disposable worker with a time limit.
  function checkXlsxArchive(buffer) {
    const view = new DataView(buffer);
    if (buffer.byteLength > root.SiteFacts.bulkMaxSpreadsheetBytes) throw error('file_too_large', 'Use a spreadsheet under 500 KB.');
    let end = -1;
    for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 65557); i--) {
      if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === buffer.byteLength) { end = i; break; }
    }
    if (end < 0 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) throw error('invalid_xlsx', 'Use a valid, unencrypted .xlsx workbook.');
    const count = view.getUint16(end + 10, true);
    const directorySize = view.getUint32(end + 12, true);
    let offset = view.getUint32(end + 16, true), expanded = 0;
    if (!count || count > 256 || offset + directorySize !== end) throw error('invalid_xlsx', 'The workbook is too complex. Export a smaller sheet or CSV.');
    const directoryEnd = offset + directorySize;
    for (let entry = 0; entry < count; entry++) {
      if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50 || view.getUint16(offset + 8, true) & 1) throw error('invalid_xlsx', 'Use a valid, unencrypted .xlsx workbook.');
      expanded += view.getUint32(offset + 24, true);
      if (expanded > 8_000_000) throw error('xlsx_too_large', 'The expanded workbook is too large. Export only the employee sheet as CSV.');
      offset += 46 + view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
    }
    if (offset !== directoryEnd) throw error('invalid_xlsx', 'The workbook archive is invalid.');
  }

  function encodeBulkCheckoutDraft(payload, imported, now = Date.now()) {
    const value = JSON.stringify({ version: 1, createdAt: now, payload, rowNumbers: imported.rowNumbers });
    if (encoder.encode(value).length > root.SiteFacts.bulkMaxInputBytes) throw error('draft_too_large', 'This staff list is too large to preserve through checkout. Split it into smaller batches.');
    return value;
  }

  function decodeBulkCheckoutDraft(value, now = Date.now()) {
    if (typeof value !== 'string' || encoder.encode(value).length > root.SiteFacts.bulkMaxInputBytes) return null;
    try {
      const draft = JSON.parse(value);
      if (draft.version !== 1 || !Number.isFinite(draft.createdAt) || draft.createdAt > now || now - draft.createdAt > 24 * 60 * 60 * 1000) return null;
      const batch = generateBatch(draft.payload);
      if (!Array.isArray(draft.rowNumbers) || draft.rowNumbers.length !== batch.total || !draft.rowNumbers.every((n) => Number.isInteger(n) && n > 0 && n <= 5000)) return null;
      return { payload: draft.payload, rowNumbers: draft.rowNumbers };
    } catch { return null; }
  }

  return Object.freeze({ fields, generateBatch, createZip, parseDelimited, employeesFromGrid, checkXlsxArchive, encodeBulkCheckoutDraft, decodeBulkCheckoutDraft });
});
