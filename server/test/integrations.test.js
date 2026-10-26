// Batch 12J: API tokens, webhooks, Google Sheets sync and the Telegram bot. Google and Telegram are local
// stand-ins that answer like the real APIs; a local receiver plays the webhook endpoint.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';

const listen = (handler) => new Promise((resolve) => {
  const server = http.createServer(handler).listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
});
const readBody = (req) => new Promise((resolve) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => resolve(b)); });

// Google: OAuth token, userinfo, revoke and the Sheets endpoints Spendwise uses.
const google = { sheets: new Map(), revoked: [], made: 0, gone: new Set(), raw: true };
const googleStub = await listen(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const body = await readBody(req);
  const send = (status, data) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
  if (u.pathname === '/token') {
    const f = new URLSearchParams(body);
    if (f.get('client_secret') !== 'test-google-secret') return send(401, { error: 'invalid_client' });
    if (f.get('grant_type') === 'authorization_code') {
      if (f.get('code') !== 'good-code') return send(400, { error: 'invalid_grant' });
      return send(200, { access_token: 'at-1', expires_in: 3599, refresh_token: 'rt-1', scope: 'openid https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email', token_type: 'Bearer' });
    }
    return f.get('refresh_token') === 'rt-1' ? send(200, { access_token: 'at-2', expires_in: 3599 }) : send(400, { error: 'invalid_grant' });
  }
  if (u.pathname === '/userinfo') return send(200, { email: 'ira@example.com' });
  if (u.pathname === '/revoke') { google.revoked.push(new URLSearchParams(body).get('token')); return send(200, {}); }
  if (!/^Bearer at-/.test(req.headers.authorization ?? '')) return send(401, { error: { message: 'no token', status: 'UNAUTHENTICATED' } });
  if (req.method === 'POST' && u.pathname === '/v4/spreadsheets') {
    const spec = JSON.parse(body);
    // Like the real API: an unsupported locale (e.g. en_IN) is refused.
    if (spec.properties.locale) return send(400, { error: { message: `Invalid properties: Unsupported locale: ${spec.properties.locale}`, status: 'INVALID_ARGUMENT' } });
    google.made += 1;
    const id = `sheet-${google.made}`;
    google.sheets.set(id, { title: spec.properties.title, tabs: new Map(spec.sheets.map((s) => [s.properties.title, []])) });
    return send(200, { spreadsheetId: id, spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${id}/edit` });
  }
  const m = u.pathname.match(/^\/v4\/spreadsheets\/([^/:]+)(.*)$/);
  const sheet = m && !google.gone.has(m[1]) ? google.sheets.get(m[1]) : null;
  if (!sheet) return send(404, { error: { message: 'Requested entity was not found.', status: 'NOT_FOUND' } });
  if (req.method === 'GET') return send(200, { sheets: [...sheet.tabs.keys()].map((t) => ({ properties: { title: t } })) });
  const data = JSON.parse(body);
  if (m[2] === '/values:batchClear') { for (const r of data.ranges) sheet.tabs.set(r, []); return send(200, {}); }
  if (m[2] === '/values:batchUpdate') {
    if (data.valueInputOption !== 'RAW') google.raw = false;
    for (const d of data.data) sheet.tabs.set(d.range.split('!')[0], d.values);
    return send(200, {});
  }
  return send(400, { error: { message: `unknown ${m[2]}` } });
});

// Telegram: records what the bot sends.
const telegramSent = [];
const telegramStub = await listen(async (req, res) => {
  const method = req.url.split('/').pop();
  const body = JSON.parse((await readBody(req)) || '{}');
  res.setHeader('content-type', 'application/json');
  if (method === 'getMe') return res.end(JSON.stringify({ ok: true, result: { id: 1, is_bot: true, username: 'spendwise_test_bot', first_name: 'Spendwise' } }));
  if (method === 'sendMessage') { telegramSent.push(body); return res.end(JSON.stringify({ ok: true, result: { message_id: telegramSent.length } })); }
  return res.end(JSON.stringify({ ok: true, result: true }));
});

// A webhook receiver that can be told to fail.
const received = [];
let receiverStatus = 200;
const receiver = await listen(async (req, res) => {
  received.push({ headers: req.headers, body: await readBody(req) });
  res.writeHead(receiverStatus);
  res.end('ok');
});

Object.assign(process.env, {
  GOOGLE_CLIENT_ID: 'test-client.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'test-google-secret',
  GOOGLE_AUTH_URL: `${googleStub.url}/auth`, GOOGLE_TOKEN_URL: `${googleStub.url}/token`, GOOGLE_REVOKE_URL: `${googleStub.url}/revoke`,
  GOOGLE_USERINFO_URL: `${googleStub.url}/userinfo`, GOOGLE_SHEETS_URL: `${googleStub.url}/v4`,
  TELEGRAM_BOT_TOKEN: '123456:test-token-for-the-stub-only', TELEGRAM_API_URL: telegramStub.url,
  API_URL: 'http://api.test', APP_URL: 'http://app.test',
});

const { test, before, after } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const { startTestServer, uniqueEmail, GOOD_PASSWORD } = await import('./helpers.js');
const { config } = await import('../src/config.js');
const webhooks = await import('../src/services/webhook.service.js');
const googleSvc = await import('../src/services/google.service.js');
const telegram = await import('../src/services/telegram.service.js');
const { ApiToken, Transaction, TelegramLink } = await import('../src/models/index.js');
const { todayIn } = await import('../src/schedule.js');
const { dayString } = await import('../src/money.js');

let t;
const newUser = async () => (await t.api('POST', '/api/auth/register', { body: { name: 'Ira', email: uniqueEmail(), password: GOOD_PASSWORD } })).body.token;
const call = (method, path, body, token, headers) => t.api(method, path, { token, body, headers });
const waitFor = async (check, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await check()) return true; await new Promise((r) => setTimeout(r, 25)); } return false; };
const today = () => dayString(todayIn('Asia/Kolkata'));

before(async () => {
  t = await startTestServer();
  webhooks.retryDelays.splice(0, 2, 40, 40);
  googleSvc.syncDelay.ms = 50;
});
after(async () => { await t.stop(); for (const s of [googleStub, telegramStub, receiver]) s.server.close(); });

test('Telegram answers in Hindi when the app is in Hindi, and reads Hindi entries', async () => {
  const tk = await newUser();
  assert.equal((await call('PATCH', '/api/auth/me', { language: 'hi' }, tk)).status, 200);
  const link = (await call('POST', '/api/integrations/telegram/link', undefined, tk)).body;
  const msg = (text) => telegram.handleUpdate({ update_id: 1, message: { message_id: 1, chat: { id: 555002, type: 'private' }, from: { id: 555002, first_name: 'Meera' }, text } });

  assert.match(await msg(`/start ${link.code}`), /^Spendwise से .+ के रूप में जुड़ गए। 🎉\n\nजो खर्च किया/);
  assert.match(await msg('२०० चाय कल'), /^₹200\.00 का खर्च जोड़ा · खाना-पीना · चाय · \d+ .+ · Cash\.\nग़लत है\? \/undo भेजें।$/);
  const [tx] = (await call('GET', '/api/transactions', undefined, tk)).body.items;
  // Stored in English like every entry; only the reply is in Hindi.
  assert.deepEqual([tx.amountPaise, tx.category, tx.note], [20_000, 'Food & Dining', 'चाय']);
  assert.match(await msg('/today'), /^आज अभी कुछ नहीं जोड़ा।$/);
  assert.match(await msg('/undo'), /^₹200\.00 खाना-पीना \(चाय\) हटा दिया।/);
  assert.match(await msg('नमस्ते'), /^कुछ जोड़ने के लिए रकम लिखें/);
  await call('DELETE', `/api/integrations/telegram/${(await call('GET', '/api/integrations/telegram', undefined, tk)).body.links[0].id}`, undefined, tk);
});

test('the server’s quick-add parser is the same as the app’s', () => {
  const client = new URL('../../client/src/lib/quickAdd.js', import.meta.url);
  if (!fs.existsSync(client)) return;
  const server = fs.readFileSync(new URL('../src/quickAdd.js', import.meta.url), 'utf8').split('\n').slice(2).join('\n');
  assert.equal(server, fs.readFileSync(client, 'utf8'));
});

test('API tokens: shown once, read-only or read-and-write, kept to money data, revocable', async () => {
  const tk = await newUser();
  const read = await call('POST', '/api/integrations/tokens', { name: 'Home server' }, tk);
  assert.equal(read.status, 201);
  assert.match(read.body.token, /^sw_[A-Za-z0-9_-]{43}$/);
  const list = (await call('GET', '/api/integrations/tokens', undefined, tk)).body.tokens;
  assert.deepEqual(list.map((x) => [x.name, x.scope, x.prefix]), [['Home server', 'read', `${read.body.token.slice(0, 10)}…`]]);
  assert.ok(!JSON.stringify(list).includes(read.body.token));
  assert.ok(!(await ApiToken.findOne({ name: 'Home server' }).lean()).hash.includes(read.body.token));

  assert.equal((await call('GET', '/api/transactions', undefined, read.body.token)).status, 200);
  const blocked = await call('POST', '/api/transactions', { type: 'expense', amount: '50', category: 'Food & Dining', date: today() }, read.body.token);
  assert.deepEqual([blocked.status, blocked.body.error.code], [403, 'read_only_token']);
  for (const path of ['/api/auth/me', '/api/integrations/tokens', '/api/backup']) {
    assert.equal((await call('GET', path, undefined, read.body.token)).body.error.code, 'token_not_allowed', path);
  }
  const write = (await call('POST', '/api/integrations/tokens', { name: 'Shortcut', scope: 'write', expiresInDays: 30 }, tk)).body;
  const added = await call('POST', '/api/transactions', { type: 'expense', amount: '50', category: 'Food & Dining', date: today(), note: 'via API' }, write.token);
  assert.equal(added.status, 201);
  assert.equal((await call('GET', '/api/transactions', undefined, tk)).body.items[0].note, 'via API');
  // A token works in its own space whatever X-Space-Id says.
  assert.equal((await call('GET', '/api/transactions', undefined, write.token, { 'x-space-id': '0123456789abcdef01234567' })).status, 200);
  assert.equal((await call('DELETE', `/api/integrations/tokens/${read.body.id}`, undefined, tk)).status, 204);
  assert.equal((await call('GET', '/api/transactions', undefined, read.body.token)).status, 401);
  await ApiToken.updateOne({ _id: write.id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await call('GET', '/api/transactions', undefined, write.token)).status, 401);
  assert.equal((await call('GET', '/api/transactions', undefined, 'sw_made-up-token')).status, 401);
});

test('webhooks: signed deliveries on entry changes, retries on failure, and a test ping', async () => {
  const tk = await newUser();
  const made = await call('POST', '/api/integrations/webhooks', { url: `${receiver.url}/hook`, events: ['transaction.created', 'transaction.deleted'] }, tk);
  assert.equal(made.status, 201);
  assert.match(made.body.secret, /^whsec_/);
  assert.ok(!JSON.stringify((await call('GET', '/api/integrations/webhooks', undefined, tk)).body).includes(made.body.secret));
  received.length = 0;
  const tx = (await call('POST', '/api/transactions', { type: 'expense', amount: '120', category: 'Transport', date: today(), note: 'Metro' }, tk)).body.transaction;
  assert.ok(await waitFor(() => received.length === 1));
  const [r] = received;
  const body = JSON.parse(r.body);
  assert.deepEqual([r.headers['x-spendwise-event'], body.event, body.data.id, body.data.note], ['transaction.created', 'transaction.created', tx.id, 'Metro']);
  const expected = crypto.createHmac('sha256', made.body.secret).update(`${r.headers['x-spendwise-timestamp']}.${r.body}`).digest('hex');
  assert.equal(r.headers['x-spendwise-signature'], `sha256=${expected}`);
  // Events it didn't ask for aren't sent.
  await call('PATCH', `/api/transactions/${tx.id}`, { note: 'Metro card' }, tk);
  await new Promise((res) => setTimeout(res, 150));
  assert.equal(received.length, 1);
  // A failing receiver gets two more tries, all logged.
  receiverStatus = 500;
  await call('DELETE', `/api/transactions/${tx.id}`, undefined, tk);
  assert.ok(await waitFor(() => received.length === 4));
  await new Promise((res) => setTimeout(res, 100));
  const log = (await call('GET', `/api/integrations/webhooks/${made.body.id}/deliveries`, undefined, tk)).body.deliveries;
  assert.deepEqual(log.slice(0, 3).map((d) => [d.event, d.attempt, d.ok, d.status]), [['transaction.deleted', 3, false, 500], ['transaction.deleted', 2, false, 500], ['transaction.deleted', 1, false, 500]]);
  assert.equal(new Set(received.slice(1).map((x) => x.headers['x-spendwise-delivery'])).size, 1); // the same delivery each time
  receiverStatus = 200;
  const ping = await call('POST', `/api/integrations/webhooks/${made.body.id}/test`, undefined, tk);
  assert.deepEqual([ping.body.ok, ping.body.status], [true, 200]);
  assert.equal(JSON.parse(received.at(-1).body).event, 'ping');
  // A new secret is shown once and used from then on.
  const rotated = (await call('POST', `/api/integrations/webhooks/${made.body.id}/secret`, undefined, tk)).body.secret;
  assert.notEqual(rotated, made.body.secret);
  await call('POST', `/api/integrations/webhooks/${made.body.id}/test`, undefined, tk);
  const last = received.at(-1);
  assert.equal(last.headers['x-spendwise-signature'], `sha256=${crypto.createHmac('sha256', rotated).update(`${last.headers['x-spendwise-timestamp']}.${last.body}`).digest('hex')}`);
});

test('webhooks: only public https addresses outside development', async () => {
  assert.deepEqual(['10.1.2.3', '127.0.0.1', '192.168.1.5', '172.20.0.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:127.0.0.1'].map(webhooks.isPrivateAddress), Array(8).fill(true));
  assert.deepEqual(['8.8.8.8', '142.250.183.14', '2606:4700::1111'].map(webhooks.isPrivateAddress), [false, false, false]);
  const tk = await newUser();
  config.webhooksAllowPrivate = false;
  try {
    assert.match((await call('POST', '/api/integrations/webhooks', { url: `${receiver.url}/hook` }, tk)).body.error.details[0].message, /https/);
    assert.match((await call('POST', '/api/integrations/webhooks', { url: 'https://localhost/hook' }, tk)).body.error.details[0].message, /public internet/);
  } finally {
    config.webhooksAllowPrivate = true;
  }
  assert.equal((await call('POST', '/api/integrations/webhooks', { url: 'ftp://example.com/x' }, tk)).status, 400);
});

test('Google Sheets: connect, a sheet is made and filled, changes sync, disconnect gives access back', async () => {
  const tk = await newUser();
  await call('POST', '/api/transactions', { type: 'expense', amount: '899', category: 'Groceries', date: today(), note: '=HYPERLINK("x")', tags: ['home'] }, tk);
  assert.deepEqual((await call('GET', '/api/integrations/google', undefined, tk)).body, { configured: true, connected: false, googleEmail: null, connectedBy: null, spreadsheetUrl: null, lastSyncAt: null, rowsSynced: 0, lastError: null });
  const { url } = (await call('POST', '/api/integrations/google/start', undefined, tk)).body;
  const start = new URL(url);
  assert.equal(start.origin + start.pathname, `${googleStub.url}/auth`);
  assert.deepEqual(['client_id', 'redirect_uri', 'response_type', 'access_type', 'prompt'].map((k) => start.searchParams.get(k)), ['test-client.apps.googleusercontent.com', 'http://api.test/api/integrations/google/callback', 'code', 'offline', 'consent']);
  assert.ok(start.searchParams.get('scope').split(' ').includes('https://www.googleapis.com/auth/drive.file'));
  const state = start.searchParams.get('state');
  // Google sends the browser back with a code.
  const back = await fetch(`${t.base}/api/integrations/google/callback?code=good-code&state=${encodeURIComponent(state)}`, { redirect: 'manual' });
  assert.deepEqual([back.status, back.headers.get('location')], [302, 'http://app.test/integrations?google=connected']);
  const s = (await call('GET', '/api/integrations/google', undefined, tk)).body;
  assert.deepEqual([s.connected, s.googleEmail, s.rowsSynced, s.lastError], [true, 'ira@example.com', 1, null]);
  const sheetId = s.spreadsheetUrl.match(/d\/([^/]+)/)[1];
  const sheet = google.sheets.get(sheetId);
  assert.equal(sheet.title, 'Spendwise – Personal');
  const rows = sheet.tabs.get('Transactions');
  assert.equal(rows[0][0], 'Date');
  assert.deepEqual([...rows[1].slice(0, 5), rows[1][8], rows[1][9]], [today(), 'expense', 899, 'Groceries', 'Cash', '=HYPERLINK("x")', '#home']);
  assert.ok(google.raw); // written as plain values, so "=HYPERLINK(…)" stays text
  assert.deepEqual(sheet.tabs.get('Monthly')[1], [today().slice(0, 7), 0, 899, -899, 1]);
  // A new entry syncs shortly after.
  await call('POST', '/api/transactions', { type: 'income', amount: '5000', category: 'Freelance', date: today() }, tk);
  assert.ok(await waitFor(() => google.sheets.get(sheetId).tabs.get('Transactions').length === 3));
  // The sheet deleted in Drive: the next sync makes a new one.
  google.gone.add(sheetId);
  const synced = (await call('POST', '/api/integrations/google/sync', undefined, tk)).body;
  assert.equal(synced.rows, 2);
  assert.notEqual(synced.spreadsheetUrl, s.spreadsheetUrl);
  // Disconnect revokes the refresh token; the sheet stays.
  assert.equal((await call('DELETE', '/api/integrations/google', undefined, tk)).status, 204);
  assert.deepEqual(google.revoked, ['rt-1']);
  assert.equal((await call('GET', '/api/integrations/google', undefined, tk)).body.connected, false);
  // Cancelled at Google, or an old link.
  assert.equal((await fetch(`${t.base}/api/integrations/google/callback?error=access_denied&state=${encodeURIComponent(state)}`, { redirect: 'manual' })).headers.get('location'), 'http://app.test/integrations?google=cancelled');
  assert.equal((await fetch(`${t.base}/api/integrations/google/callback?code=good-code&state=forged`, { redirect: 'manual' })).headers.get('location'), 'http://app.test/integrations?google=expired');
});

test('Telegram: link with a one-time code, then add, list, summarise and undo by message', async () => {
  const tk = await newUser();
  const link = (await call('POST', '/api/integrations/telegram/link', undefined, tk)).body;
  assert.equal(link.url, `https://t.me/spendwise_test_bot?start=${link.code}`);
  const msg = (text, chat = { id: 555001, type: 'private' }) => telegram.handleUpdate({ update_id: 1, message: { message_id: 1, chat, from: { id: chat.id, username: 'ira_t', first_name: 'Ira' }, text } });

  assert.match(await msg('add 200 chai'), /isn’t linked/);
  assert.match(await msg(`/start ${link.code}`), /^Linked to Spendwise as Ira/);
  assert.match(await msg(`/start ${link.code}`), /expired or was already used/);
  const status = (await call('GET', '/api/integrations/telegram', undefined, tk)).body;
  assert.deepEqual([status.botUsername, status.links.length, status.links[0].username, status.links[0].spaceName], ['spendwise_test_bot', 1, 'ira_t', 'Personal']);

  assert.match(await msg('add 200 chai'), /^Added spending of ₹200\.00 · Food & Dining · Chai · today · Cash\./);
  const [tx] = (await call('GET', '/api/transactions', undefined, tk)).body.items;
  assert.deepEqual([tx.amountPaise, tx.category, tx.note], [20_000, 'Food & Dining', 'Chai']);
  assert.match(await msg('/add 450 swiggy dinner yesterday upi'), /₹450\.00 · Food & Dining · Swiggy dinner/);
  assert.match(await msg('got 50000 salary'), /^Added income of ₹50,000\.00 · Salary/);
  assert.match(await msg('/today'), /^Today: ₹200\.00 spent in 1 entry, ₹50,000\.00 income\.\n• ₹200\.00 Food & Dining – Chai/);
  assert.match(await msg('/summary'), /so far: ₹\d[\d,]*\.\d\d spent, ₹50,000\.00 income/);
  assert.match(await msg('/undo'), /^Removed ₹50,000\.00 Salary/);
  assert.match(await msg('/undo'), /nothing from this chat to undo/);
  assert.match(await msg('hello'), /include the amount/);
  assert.match(await msg('/frobnicate'), /I don’t know \/frobnicate/);
  assert.equal(await msg('add 99 tea', { id: -100, type: 'group' }), null); // groups are ignored
  assert.equal(await Transaction.countDocuments({ note: 'Tea' }), 0);

  // The daily summary, once a day at the chosen time.
  const id = status.links[0].id;
  await call('PATCH', `/api/integrations/telegram/${id}`, { dailySummary: true, summaryTime: '00:00' }, tk);
  telegramSent.length = 0;
  assert.equal((await telegram.sendDailySummaries()).sent, 1);
  assert.match(telegramSent[0].text, /^Your day in Spendwise/);
  assert.equal((await telegram.sendDailySummaries()).sent, 0);

  // Telegram's webhook needs Telegram's secret header.
  const update = { update_id: 2, message: { message_id: 2, chat: { id: 555001, type: 'private' }, from: { id: 555001 }, text: '/today' } };
  assert.equal((await fetch(`${t.base}/api/integrations/telegram/webhook`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(update) })).status, 401);
  telegramSent.length = 0;
  const ok = await fetch(`${t.base}/api/integrations/telegram/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': telegram.webhookSecret() }, body: JSON.stringify(update) });
  assert.equal(ok.status, 200);
  assert.ok(await waitFor(() => telegramSent.length === 1));

  assert.equal((await call('DELETE', `/api/integrations/telegram/${id}`, undefined, tk)).status, 204);
  assert.equal(await TelegramLink.countDocuments({ chatId: 555001 }), 0);
});
