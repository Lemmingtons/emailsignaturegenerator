(async function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const url = new URL(location.href);
  const requestToken = url.searchParams.get('request') || '';
  // Remove the approval material before loading or navigating anywhere else.
  history.replaceState(null, '', url.pathname);
  let purchaseToken = '';
  const showError = (message) => { $('connection-error').textContent = message; $('connection-error').hidden = false; };
  async function api(action, value, token = '') {
    return fetch('/api/v1/agent/' + action, {
      method: 'POST', credentials: 'omit', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: JSON.stringify(value),
    });
  }
  if (!requestToken || requestToken.length > 4096) {
    $('connection-status').textContent = 'Start the connection from your assistant.';
    showError('This link is missing a valid connection request. Ask your assistant to start a new connection.');
    return;
  }
  try {
    const response = await api('preview', { request_token: requestToken });
    if (!response.ok) throw new Error('This request has expired or could not be verified. Ask your assistant to start a new connection.');
    const request = await response.json();
    $('agent-name').textContent = request.agent_name;
    $('connection-details').hidden = false;
    $('connection-status').textContent = 'Review the permissions below before continuing.';
    try { purchaseToken = localStorage.getItem(window.SiteFacts.proTokenStorageKey) || ''; } catch { /* Show the purchase recovery path below. */ }
    const purchase = purchaseToken ? await fetch('/api/v1/access-key', { headers: { Authorization: 'Bearer ' + purchaseToken }, credentials: 'omit', cache: 'no-store' }) : null;
    if (!purchase?.ok) {
      $('purchase-status').textContent = 'Your original purchase access is needed.';
      $('purchase-help').hidden = false;
      return;
    }
    const paid = await purchase.json();
    $('purchase-status').textContent = `${paid.plan === 'team' ? 'Team' : 'Individual'} access · up to ${paid.maxRows} signatures per batch.`;
    $('approve-connection').disabled = false;
  } catch (err) {
    $('connection-status').textContent = 'Connection unavailable';
    showError(err.message || 'Could not load this request. Try again shortly.');
  }
  $('approve-agent').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = $('approve-connection');
    if (button.disabled || !purchaseToken) return;
    button.disabled = true;
    button.textContent = 'Approving…';
    $('connection-error').hidden = true;
    try {
      const response = await api('approve', { request_token: requestToken, user_code: $('agent-code').value.trim() }, purchaseToken);
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.code === 'invalid_code' ? 'That code does not match. Check the code shown by your assistant.' : result.code === 'already_approved' ? 'This connection was already approved. Return to your assistant.' : result.code === 'rate_limited' ? 'Please wait a minute before trying again.' : 'Could not approve this connection. Check your purchase access or ask your assistant for a new request.');
      }
      purchaseToken = '';
      $('connection-details').hidden = true;
      $('connection-status').hidden = true;
      $('connection-complete').hidden = false;
    } catch (err) {
      showError(err.message || 'Could not approve this connection. Try again shortly.');
      button.disabled = false;
      button.textContent = 'Allow access for 24 hours';
    }
  });
}());
