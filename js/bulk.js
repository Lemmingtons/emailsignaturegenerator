(function() {
  'use strict';
  const facts = window.SiteFacts;
  const core = window.SignatureGeneratorCore;
  const bulk = window.SignatureBulk;
  const templates = window.SignatureTemplates.TEMPLATES;
  const $ = (id) => document.getElementById(id);
  const local = bulk.safeStorage(() => window.localStorage);
  const session = bulk.safeStorage(() => window.sessionStorage);
  const tokenKey = facts.proTokenStorageKey;
  // Strip the token from the address bar first, then keep it before anything
  // can fail: a paid token that only lives in memory is lost on the first
  // network error, refresh or closed tab.
  const returned = bulk.takeReturnedToken(window.location.href);
  if (returned.changed) history.replaceState(null, '', returned.cleaned);
  const storedToken = local.get(tokenKey) || '';
  let tokenRemembered = true;
  if (returned.token && returned.token !== storedToken) tokenRemembered = local.set(tokenKey, returned.token);
  const restoreHelp = `Open your access link (use “Copy my access link” in the signature builder) or email ${facts.supportEmail}.`;
  let imported = null;
  let batch = null;
  let selected = 0;
  let fileVersion = 0;
  let activeWorker = null;
  let cancelWorkbook = null;
  let downloading = false;
  let payload = null;
  let purchaseToken = returned.token || storedToken;
  // An earlier purchase in this browser, tried if the returned token is rejected.
  let fallbackToken = returned.token && storedToken !== returned.token ? storedToken : '';
  let paidAccess = null;
  let managingKey = false;
  // 'idle' | 'checking' | 'retry': while a stored purchase is unconfirmed the
  // buy buttons stay hidden so a network blip cannot lead to a second purchase.
  let accessState = 'idle';

  function credential() {
    return $('bulk-key').value.trim() || (paidAccess ? purchaseToken : '');
  }

  function updateAccess() {
    const paid = Boolean(paidAccess);
    const team = paid && paidAccess.plan === 'team';
    $('buy-individual').hidden = paid || !facts.paymentLink;
    $('buy-team').hidden = team || !facts.teamPaymentLink;
    $('bulk-purchase').hidden = team || (!paid && accessState !== 'idle');
    $('retry-access').hidden = accessState !== 'retry';
    if (paid) {
      $('paid-status').textContent = `${team ? 'Team' : 'Individual'} lifetime access is active. Up to ${paidAccess.maxRows} signatures per batch.${!team && batch && batch.total > paidAccess.maxRows ? ' Choose Team for this batch of 20 or more.' : ''}`;
      $('agent-status').textContent = `${team ? 'Team' : 'Individual'} access: up to ${paidAccess.maxRows} signatures per batch through the API or MCP.`;
    } else {
      $('paid-status').textContent = accessState === 'checking' ? 'Checking your purchase…' : '';
      $('agent-status').textContent = 'Buy a lifetime plan to create your API and MCP key.';
      $('agent-key').value = '';
      $('agent-key-result').hidden = true;
    }
    ['create-api-key', 'rotate-api-key', 'revoke-api-key'].forEach((id) => { $(id).disabled = !paid || managingKey; });
    updateDownload();
  }

  async function refreshAccess(token = purchaseToken) {
    if (!token || accessState === 'checking') return;
    purchaseToken = token;
    accessState = 'checking';
    showError('purchase-error', '');
    updateAccess();
    let status = 0;
    let info = null;
    try {
      const response = await fetch('/api/v1/access-key', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', credentials: 'omit' });
      status = response.status;
      info = await response.json().catch(() => null);
    } catch { /* offline or blocked: treated as temporarily unavailable */ }
    if (token !== purchaseToken) return;
    let outcome = bulk.accessOutcome(status, info && (info.code || info.error));
    if (outcome === 'active' && !(info && Number.isInteger(info.maxRows) && ['pro', 'team'].includes(info.plan))) outcome = 'unavailable';
    accessState = outcome === 'busy' || outcome === 'unavailable' ? 'retry' : 'idle';
    // The checkout draft is kept until the purchase is settled either way, so a
    // refresh after a failed check still brings the staff list back.
    if (accessState === 'idle') session.remove(facts.bulkCheckoutDraftStorageKey);
    if (outcome === 'active') {
      paidAccess = info;
      if (!tokenRemembered) showError('purchase-error', `Access is active in this tab, but your browser could not remember it. Keep this tab open while you work, or email ${facts.supportEmail} to restore access later.`);
    } else if (outcome === 'rejected') {
      paidAccess = null;
      if (local.get(tokenKey) === token) { if (fallbackToken) local.set(tokenKey, fallbackToken); else local.remove(tokenKey); }
      purchaseToken = '';
      const next = fallbackToken;
      fallbackToken = '';
      if (next) { refreshAccess(next); return; }
      showError('purchase-error', `This purchase access was not accepted. ${restoreHelp}`);
    } else if (outcome === 'not_owner') {
      paidAccess = null;
      showError('purchase-error', `Use the original buyer’s purchase access to manage bulk downloads and API keys. If you have an older Pro purchase, email ${facts.supportEmail} to restore access.`);
    } else {
      showError('purchase-error', outcome === 'busy'
        ? 'Your purchase is saved in this browser, but too many checks were made just now. Wait a minute, then check again.'
        : 'Your purchase is saved in this browser, but we could not confirm it just now. Check your connection, then check again.');
    }
    updateAccess();
  }

  async function manageKey(action) {
    if (!paidAccess || managingKey) return;
    managingKey = true;
    showError('agent-error', '');
    updateAccess();
    try {
      const response = await fetch('/api/v1/access-key', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${purchaseToken}` },
        body: JSON.stringify({ action }), credentials: 'omit', cache: 'no-store',
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.code === 'rate_limited' ? 'Wait a minute before changing your key again.' : 'Could not update your key. Refresh the page and try again.');
      $('agent-key').value = result.key || '';
      $('agent-key-result').hidden = !result.key;
      $('agent-status').textContent = result.revoked ? 'Your API key has been revoked. Agents using it can no longer connect. Your purchase access remains active.' : `Your API and MCP key is ready. Up to ${result.maxRows} signatures per batch.`;
    } catch (err) { showError('agent-error', err.message); }
    finally {
      managingKey = false;
      ['create-api-key', 'rotate-api-key', 'revoke-api-key'].forEach((id) => { $(id).disabled = !paidAccess; });
    }
  }

  function showError(id, message) {
    $(id).textContent = message || '';
    $(id).hidden = !message;
  }

  function saveFile(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  function updateDownload() {
    $('download-zip').disabled = downloading || !batch || !batch.valid || !credential() ||
      (paidAccess && !$('bulk-key').value.trim() && batch && batch.total > paidAccess.maxRows) ||
      (batch.invalid > 0 && !$('allow-partial').checked);
  }

  function previewPerson() {
    const row = batch && batch.results[selected];
    const preview = $('signature-preview');
    preview.replaceChildren();
    showError('preview-error', row && row.errors.length ? row.errors.map((err) => `${err.field}: ${err.message}`).join(' ') : '');
    if (row && !row.errors.length) {
      preview.innerHTML = row.html;
      preview.querySelectorAll('a').forEach((link) => { link.tabIndex = -1; link.setAttribute('aria-disabled', 'true'); });
    }
  }

  function resetResults() {
    batch = null;
    payload = null;
    $('batch-count').textContent = 'No list yet';
    $('preview-empty').hidden = false;
    $('preview-content').hidden = true;
    $('validation-summary').hidden = true;
    $('row-errors').hidden = true;
    $('partial-label').hidden = true;
    $('allow-partial').checked = false;
    $('signature-preview').replaceChildren();
    $('preview-person').replaceChildren();
    $('row-error-list').replaceChildren();
    updateDownload();
  }

  function render() {
    showError('design-error', '');
    showError('download-error', '');
    $('download-status').textContent = '';
    $('allow-partial').checked = false;
    if (!imported) { resetResults(); return; }
    const defaults = {};
    [['company', 'bulk-company'], ['website', 'bulk-website'], ['logoUrl', 'bulk-logo']].forEach(([field, id]) => {
      if ($(id).value.trim()) defaults[field] = $(id).value.trim();
    });
    payload = {
      template: $('bulk-template').value,
      defaults,
      style: {
        primaryColor: $('bulk-primary').value,
        secondaryColor: $('bulk-secondary').value,
        fontFamily: $('bulk-font').value,
      },
      employees: imported.employees,
    };
    try { batch = bulk.generateBatch(payload); }
    catch (err) {
      resetResults();
      showError('design-error', err.message);
      $('batch-count').textContent = 'Check shared details';
      return;
    }
    $('batch-count').textContent = `${batch.total} ${batch.total === 1 ? 'person' : 'people'}`;
    $('preview-empty').hidden = true;
    $('preview-content').hidden = false;
    const picker = $('preview-person');
    picker.replaceChildren();
    batch.results.forEach((row, index) => {
      const option = document.createElement('option');
      option.value = index;
      option.textContent = `${row.fullName || 'Missing name'}${row.email ? ` · ${row.email}` : ''}${row.errors.length ? ' · Needs correction' : ''}`;
      picker.appendChild(option);
    });
    selected = Math.min(selected, batch.results.length - 1);
    picker.value = selected;
    previewPerson();
    $('validation-summary').hidden = false;
    $('validation-summary').textContent = `${batch.valid} ready to download${batch.invalid ? ` · ${batch.invalid} ${batch.invalid === 1 ? 'person needs' : 'people need'} correction` : ' · All rows checked'}`;
    $('row-errors').hidden = !batch.invalid;
    $('row-error-heading').textContent = `${batch.invalid} ${batch.invalid === 1 ? 'row' : 'rows'} to correct`;
    const list = $('row-error-list');
    list.replaceChildren();
    batch.results.filter((row) => row.errors.length).forEach((row) => {
      const item = document.createElement('li');
      item.textContent = `Spreadsheet row ${imported.rowNumbers[row.row - 1]} (${row.fullName || 'missing name'}): ${row.errors.map((err) => `${err.field}: ${err.message}`).join(' ')}`;
      list.appendChild(item);
    });
    $('partial-label').hidden = !batch.invalid;
    $('partial-copy').textContent = `Download the ${batch.valid} valid signatures only. Exclude ${batch.invalid} ${batch.invalid === 1 ? 'person' : 'people'} with errors (included in errors.json).`;
    updateDownload();
    updateAccess();
  }

  function readWorkbook(buffer) {
    return new Promise((resolve, reject) => {
      const worker = new Worker('/js/bulk-spreadsheet-worker.js');
      activeWorker = worker;
      const finish = (err, result) => {
        clearTimeout(timer);
        worker.terminate();
        if (activeWorker === worker) { activeWorker = null; cancelWorkbook = null; }
        if (err) reject(err); else resolve(result);
      };
      const timer = setTimeout(() => finish(new Error('This workbook took too long to read. Export the employee sheet as CSV and try again.')), 10_000);
      cancelWorkbook = () => finish(new Error('Import cancelled.'));
      worker.onmessage = ({ data }) => data.ok ? finish(null, data.parsed) : finish(new Error(data.message));
      worker.onerror = (event) => { event.preventDefault(); finish(new Error('Could not read this workbook. Export the first sheet as CSV and try again.')); };
      worker.postMessage(buffer, [buffer]);
    });
  }

  $('staff-file').addEventListener('change', async () => {
    const version = ++fileVersion;
    if (cancelWorkbook) cancelWorkbook();
    imported = null;
    selected = 0;
    resetResults();
    showError('file-error', '');
    showError('design-error', '');
    showError('download-error', '');
    $('download-status').textContent = '';
    $('import-warning').hidden = true;
    const file = $('staff-file').files[0];
    if (!file) { $('import-status').textContent = ''; return; }
    $('import-status').textContent = `Reading ${file.name}…`;
    try {
      if (file.size > facts.bulkMaxSpreadsheetBytes) throw new Error('Use a spreadsheet under 500 KB.');
      const extension = file.name.split('.').pop().toLowerCase();
      if (!['csv', 'tsv', 'xlsx'].includes(extension)) throw new Error('Choose a CSV, TSV or .xlsx file. Older .xls files must be saved as .xlsx or CSV.');
      const buffer = await file.arrayBuffer();
      if (version !== fileVersion) return;
      const parsed = extension === 'xlsx'
        ? await readWorkbook(buffer)
        : bulk.employeesFromGrid(bulk.parseDelimited(new TextDecoder('utf-8', { fatal: true }).decode(buffer)));
      if (version !== fileVersion) return;
      imported = parsed;
      $('import-status').textContent = `${file.name} · ${parsed.employees.length} ${parsed.employees.length === 1 ? 'person' : 'people'} imported`;
      if (parsed.ignored.length) {
        $('import-warning').textContent = `These columns were not imported: ${parsed.ignored.join(', ')}. Use the sample CSV for supported headings.`;
        $('import-warning').hidden = false;
      }
      render();
    } catch (err) {
      if (version !== fileVersion) return;
      $('import-status').textContent = '';
      showError('file-error', err instanceof TypeError ? 'Could not read this file. Save CSV files with UTF-8 encoding, or use .xlsx.' : err.message);
    }
  });

  $('sample-file').addEventListener('click', () => {
    saveFile(new Blob([
      'Full Name,Job Title,Email,Phone,Company,Website,Logo URL,Photo URL,LinkedIn\r\n',
      'Alex Morgan,Studio Director,alex@example.com,+61 2 5550 0101,Example Studio,https://example.com,,,\r\n',
      'Sam Lee,Designer,sam@example.com,+61 2 5550 0102,Example Studio,https://example.com,,,\r\n',
    ], { type: 'text/csv;charset=utf-8' }), 'staff-signatures-sample.csv');
  });

  ['bulk-template', 'bulk-font', 'bulk-primary', 'bulk-secondary'].forEach((id) => $(id).addEventListener('change', render));
  ['bulk-company', 'bulk-website', 'bulk-logo'].forEach((id) => $(id).addEventListener('input', render));
  $('bulk-key').addEventListener('input', () => { showError('download-error', ''); updateDownload(); });
  $('allow-partial').addEventListener('change', updateDownload);
  $('preview-person').addEventListener('change', () => { selected = Number($('preview-person').value); previewPerson(); });
  $('signature-preview').addEventListener('click', (event) => event.preventDefault());
  $('bulk-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if ($('download-zip').disabled || !payload) return;
    downloading = true;
    $('bulk-editor').disabled = true;
    $('download-zip').textContent = 'Preparing your ZIP…';
    $('download-status').textContent = '';
    showError('download-error', '');
    updateDownload();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const body = JSON.stringify(payload);
      if (new TextEncoder().encode(body).length > facts.bulkMaxInputBytes) throw new Error('The imported details exceed the API limit. Split the list into smaller batches.');
      const response = await fetch('/api/v1/signatures/batch?format=zip', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${credential()}` },
        body, signal: controller.signal, credentials: 'omit', cache: 'no-store',
      });
      if (!response.ok) {
        const info = await response.json().catch(() => ({}));
        const messages = {
          invalid_api_key: 'That bulk access key was not accepted. Check the key or request bulk access.',
          bulk_not_configured: `Bulk downloads are not enabled on this server yet. Email ${facts.supportEmail} for access.`,
          rate_limited: 'You have reached the request limit. Wait a minute and try again.',
          rate_limit_not_configured: 'Bulk downloads are temporarily unavailable. Try again later.',
          rate_limit_unavailable: 'Bulk downloads are temporarily unavailable. Try again later.',
          too_large: 'The batch is too large. Split your list into smaller batches.',
          no_valid_rows: 'No valid signatures were found. Correct your spreadsheet before downloading.',
          team_plan_required: 'This batch needs Team access. Individual access supports up to 19 signatures per batch.',
          invalid_token: `Your purchase access could not be verified. ${restoreHelp}`,
        };
        throw new Error(messages[info.code || info.error] || `Could not generate your ZIP (${response.status}). Check your details and try again.`);
      }
      if (!(response.headers.get('Content-Type') || '').startsWith('application/zip')) throw new Error('The server did not return a ZIP file. Try again later.');
      const file = await response.blob();
      saveFile(file, 'email-signatures.zip');
      const valid = response.headers.get('X-Bulk-Valid-Rows') || batch.valid;
      const invalid = response.headers.get('X-Bulk-Invalid-Rows') || batch.invalid;
      $('download-status').textContent = `Downloaded ${valid} signatures${Number(invalid) ? `; ${invalid} excluded. See errors.json in the ZIP.` : '. Open README.txt for installation instructions.'}`;
    } catch (err) {
      showError('download-error', err.name === 'AbortError' ? 'The download timed out. Try again or split your list into smaller batches.' : err.message);
    } finally {
      clearTimeout(timeout);
      downloading = false;
      $('bulk-editor').disabled = false;
      $('download-zip').textContent = 'Download signatures (.zip) ↓';
      updateDownload();
    }
  });

  Object.entries(templates).forEach(([id, template]) => {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = template.name;
    $('bulk-template').appendChild(option);
  });
  core.fontFamilies.forEach((font) => {
    const option = document.createElement('option');
    option.value = font;
    option.textContent = font.split(',')[0].replace(/'/g, '');
    $('bulk-font').appendChild(option);
  });
  $('bulk-contact').href = `mailto:${facts.contactEmail}?subject=${encodeURIComponent('Bulk signature access')}`;
  document.querySelectorAll('[data-bulk-limit]').forEach((el) => { el.textContent = facts.bulkMaxRows; });
  document.querySelectorAll('[data-individual-limit]').forEach((el) => { el.textContent = facts.bulkIndividualMaxRows; });
  document.querySelectorAll('[data-pro-price]').forEach((el) => { el.textContent = facts.proPrice.display; });
  document.querySelectorAll('[data-team-price]').forEach((el) => { el.textContent = facts.teamPrice.display; });
  document.querySelectorAll('[data-team-seats]').forEach((el) => { el.textContent = facts.teamSeats; });
  // Named only when the configured checkout really is Stripe's hosted page.
  let checkoutHost = '';
  try { checkoutHost = new URL(facts.paymentLink).hostname; } catch { /* no individual checkout configured */ }
  if (checkoutHost === 'stripe.com' || checkoutHost.endsWith('.stripe.com')) {
    $('checkout-note').textContent = 'Secure checkout by Stripe. One-time payment, no subscription.';
    $('checkout-note').hidden = false;
  }
  [['buy-individual', facts.paymentLink], ['buy-team', facts.teamPaymentLink]].forEach(([id, link]) => {
    if (!link) { $(id).hidden = true; return; }
    const checkout = new URL(link);
    checkout.searchParams.set('client_reference_id', 'bulk');
    $(id).href = checkout.toString();
    $(id).addEventListener('click', (event) => {
      if (imported && !payload) {
        event.preventDefault();
        showError('purchase-error', 'Correct the shared design details before checkout so your staff list can be restored.');
        return;
      }
      if (imported && payload) {
        try { sessionStorage.setItem(facts.bulkCheckoutDraftStorageKey, bulk.encodeBulkCheckoutDraft(payload, imported)); }
        catch {
          event.preventDefault();
          showError('purchase-error', 'Your browser could not keep your staff list safe through checkout. Allow tab storage or buy before importing your list.');
        }
      }
    });
  });
  $('create-api-key').addEventListener('click', () => manageKey('create'));
  $('rotate-api-key').addEventListener('click', () => manageKey('rotate'));
  $('revoke-api-key').addEventListener('click', () => manageKey('revoke'));
  $('copy-api-key').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('agent-key').value); $('agent-status').textContent = 'API key copied. Paste it only into your agent’s private configuration.'; }
    catch { showError('agent-error', 'Could not copy automatically. Select the key field and copy it manually.'); }
  });
  $('mcp-url').textContent = `${facts.origin}/mcp`;
  $('mcp-command').textContent = `claude mcp add --transport http signatures ${facts.origin}/mcp --header "Authorization: Bearer YOUR_API_KEY"`;
  $('retry-access').addEventListener('click', () => refreshAccess());
  resetResults();
  try {
    const saved = session.get(facts.bulkCheckoutDraftStorageKey);
    const draft = bulk.decodeBulkCheckoutDraft(saved);
    // Without a purchase to confirm there is nothing to wait for; otherwise the
    // draft is cleared once the access check settles.
    if (!draft || !purchaseToken) session.remove(facts.bulkCheckoutDraftStorageKey);
    if (draft) {
      const savedPayload = draft.payload;
      imported = { employees: savedPayload.employees, rowNumbers: draft.rowNumbers, ignored: [] };
      $('bulk-template').value = savedPayload.template || 'classic';
      const style = core.createStyle(savedPayload.style);
      $('bulk-primary').value = style.primaryColor;
      $('bulk-secondary').value = style.secondaryColor;
      $('bulk-font').value = style.fontFamily;
      [['bulk-company', 'company'], ['bulk-website', 'website'], ['bulk-logo', 'logoUrl']].forEach(([id, field]) => { $(id).value = savedPayload.defaults?.[field] || ''; });
      $('import-status').textContent = `Restored ${imported.employees.length} people after checkout.`;
      render();
    }
  } catch { showError('purchase-error', 'This browser could not restore a checkout draft. You can import your spreadsheet again.'); }
  updateAccess();
  refreshAccess();
  window.addEventListener('storage', (event) => {
    if (event.key !== tokenKey || !event.newValue || event.newValue === purchaseToken) return;
    tokenRemembered = true;
    accessState = 'idle';
    refreshAccess(event.newValue);
  });
})();
