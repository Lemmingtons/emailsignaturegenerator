// Search Console export helpers: date window calculation, row tidying,
// JWT token exchange validation, and bounded pagination without spread overflow.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  accessToken,
  dateWindow,
  query,
  queryAll,
  tidy,
  ROW_LIMIT,
  MAX_START_ROW,
} = require('../scripts/export-search-console');

// dateWindow ends 3 days ago and spans the requested number of inclusive days.
{
  const win = dateWindow(28);
  assert.match(win.startDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(win.endDate, /^\d{4}-\d{2}-\d{2}$/);
  const diffDays = Math.round((Date.parse(win.endDate) - Date.parse(win.startDate)) / 86_400_000);
  assert.equal(diffDays, 27, '28-day inclusive window spans 27 days between start and end');
}

// tidy maps dimension keys and rounds CTR (4 decimals) and position (1 decimal).
{
  const tidied = tidy(
    [{ keys: ['email signature', 'https://emailsignaturegenerator.ai/'], clicks: 12, impressions: 345, ctr: 0.0347826, position: 4.66 }],
    ['query', 'page'],
  );
  assert.deepEqual(tidied, [{
    query: 'email signature',
    page: 'https://emailsignaturegenerator.ai/',
    clicks: 12,
    impressions: 345,
    ctr: 0.0348,
    position: 4.7,
  }]);

  const totals = tidy([{ keys: [], clicks: 5, impressions: 100, ctr: 0.05, position: 10.04 }], []);
  assert.deepEqual(totals, [{ clicks: 5, impressions: 100, ctr: 0.05, position: 10 }]);
}

(async () => {
  const realFetch = global.fetch;
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const key = {
    client_email: 'gsc-test@example.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };

  try {
    // accessToken signs RS256 JWT, passes timeout signal, and validates non-empty token.
    global.fetch = async (url, init) => {
      assert.equal(url, 'https://oauth2.googleapis.com/token');
      assert.ok(init.signal instanceof AbortSignal, 'accessToken passes timeout signal');
      const assertion = init.body.get('assertion');
      assert.equal(assertion.split('.').length, 3, 'assertion is a 3-part JWT');
      return { ok: true, status: 200, json: async () => ({ access_token: 'ya29.test-token' }) };
    };
    assert.equal(await accessToken(key), 'ya29.test-token');

    // Missing or empty access_token must reject.
    for (const payload of [{}, { access_token: '' }, { access_token: '   ' }]) {
      global.fetch = async () => ({ ok: true, status: 200, json: async () => payload });
      await assert.rejects(() => accessToken(key), /missing access_token/);
    }

    // query rejects empty token before sending Authorization header.
    let called = false;
    global.fetch = async () => { called = true; return { ok: true, status: 200, json: async () => ({ rows: [] }) }; };
    await assert.rejects(() => query('', 'sc-domain:example.com', {}), /non-empty/);
    assert.equal(called, false, 'empty token must not trigger fetch');

    // queryAll handles full 25,000-row pages without stack overflow (no spread push).
    const startRows = [];
    global.fetch = async (_url, init) => {
      assert.ok(init.signal instanceof AbortSignal, 'query passes timeout signal');
      const body = JSON.parse(init.body);
      startRows.push(body.startRow);
      if (body.startRow === 0) {
        const page = new Array(ROW_LIMIT);
        for (let i = 0; i < ROW_LIMIT; i++) page[i] = { keys: [`q${i}`], clicks: 1, impressions: 10, ctr: 0.1, position: 5 };
        return { ok: true, status: 200, json: async () => ({ rows: page }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ rows: [{ keys: ['last'], clicks: 2, impressions: 20, ctr: 0.1, position: 3 }] }),
      };
    };
    const combined = await queryAll('ya29.test-token', 'sc-domain:example.com', { dimensions: ['query'] });
    assert.deepEqual(startRows, [0, ROW_LIMIT]);
    assert.equal(combined.length, ROW_LIMIT + 1);
    assert.equal(combined[ROW_LIMIT].keys[0], 'last');

    // queryAll stops at MAX_START_ROW even if the API keeps returning full pages.
    const cappedStarts = [];
    const fullPage = new Array(ROW_LIMIT).fill({ keys: ['x'], clicks: 0, impressions: 1, ctr: 0, position: 9 });
    global.fetch = async (_url, init) => {
      const body = JSON.parse(init.body);
      cappedStarts.push(body.startRow);
      return { ok: true, status: 200, json: async () => ({ rows: fullPage }) };
    };
    const cappedRows = await queryAll('ya29.test-token', 'sc-domain:example.com', { dimensions: ['query'] });
    assert.equal(cappedStarts[cappedStarts.length - 1], MAX_START_ROW, 'pagination caps startRow at 250,000');
    assert.equal(cappedRows.length, cappedStarts.length * ROW_LIMIT);

    console.log('Search Console export checks passed.');
  } finally {
    global.fetch = realFetch;
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
