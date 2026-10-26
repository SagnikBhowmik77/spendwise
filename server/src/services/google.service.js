// Batch 12J: Google Sheets sync. You connect your Google account (OAuth, scope drive.file: Spendwise can only
// see files it created), Spendwise makes a spreadsheet in your Drive and keeps it filled with the space's entries
// and monthly totals. The sheet is yours; disconnecting stops the sync and leaves it in your Drive.
import jwt from 'jsonwebtoken';
import { HttpError } from '../errors.js';
import { config } from '../config.js';
import { Account, SheetLink, Space, Transaction, User } from '../models/index.js';
import { decryptSecret, encryptSecret } from '../security.js';
import { dayString } from '../money.js';
import { onSpaceEvent } from '../events.js';

export const GOOGLE_SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/drive.file'];
const STATE_AUDIENCE = 'spendwise-google';
const HEADER = ['Date', 'Type', 'Amount (₹)', 'Category', 'Account', 'To account', 'Payment method', 'Merchant', 'Note', 'Tags', 'Added by', 'Entry ID'];
const MONTHLY = ['Month', 'Income (₹)', 'Expenses (₹)', 'Net (₹)', 'Entries'];
const TABS = ['Transactions', 'Monthly'];
// After a change, wait this long for more changes before syncing (tests shorten it).
export const syncDelay = { ms: 20_000 };
const METHOD_LABEL = { upi: 'UPI', card: 'Card', cash: 'Cash', netbanking: 'Net banking', other: 'Other' };

export const googleConfigured = () => Boolean(config.google.clientId && config.google.clientSecret);
export const redirectUri = () => `${config.apiUrl}/api/integrations/google/callback`;

async function call(url, { method = 'GET', token, form, json } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  let body;
  if (form) { headers['content-type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(form); }
  if (json) { headers['content-type'] = 'application/json'; body = JSON.stringify(json); }
  const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(30_000) });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { /* not JSON */ }
  if (!res.ok) {
    const err = new Error(data.error_description || data.error?.message || (typeof data.error === 'string' ? data.error : '') || `Google answered ${res.status}`);
    err.status = res.status;
    err.code = typeof data.error === 'string' ? data.error : data.error?.status;
    throw err;
  }
  return data;
}

// The address to send the browser to. `state` is a signed, 10-minute token saying who is connecting which space.
export function startUrl({ space, user }) {
  if (!googleConfigured()) throw new HttpError(503, 'google_not_configured', 'Google isn’t set up on this server');
  const state = jwt.sign({ space: String(space._id) }, config.jwt.secret, {
    algorithm: 'HS256', subject: String(user._id), issuer: config.jwt.issuer, audience: STATE_AUDIENCE, expiresIn: '10m',
  });
  const params = new URLSearchParams({
    client_id: config.google.clientId, redirect_uri: redirectUri(), response_type: 'code', scope: GOOGLE_SCOPES.join(' '),
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state,
  });
  return `${config.google.authUrl}?${params}`;
}

// Google sends the browser back here. Returns the app page to show next, with the outcome in the query.
export async function finishConnect({ code, state, error }) {
  let claims;
  try {
    claims = jwt.verify(state ?? '', config.jwt.secret, { algorithms: ['HS256'], issuer: config.jwt.issuer, audience: STATE_AUDIENCE });
  } catch {
    return '/integrations?google=expired';
  }
  if (error) return `/integrations?google=${error === 'access_denied' ? 'cancelled' : 'error'}`;
  const user = await User.findById(claims.sub);
  const space = user && await Space.findOne({ _id: claims.space, 'members.user': user._id });
  if (!space || !code) return '/integrations?google=error';
  let tokens;
  try {
    tokens = await call(config.google.tokenUrl, {
      method: 'POST',
      form: { code, client_id: config.google.clientId, client_secret: config.google.clientSecret, redirect_uri: redirectUri(), grant_type: 'authorization_code' },
    });
  } catch (err) {
    console.error(`Google sign-in failed: ${err.message}`);
    return '/integrations?google=error';
  }
  if (!String(tokens.scope ?? '').split(' ').includes('https://www.googleapis.com/auth/drive.file')) return '/integrations?google=noscope';
  if (!tokens.refresh_token) return '/integrations?google=error';
  let email = '';
  try { email = (await call(config.google.userInfoUrl, { token: tokens.access_token })).email ?? ''; } catch { /* the email is only for showing which account */ }
  await SheetLink.findOneAndUpdate(
    { space: space._id },
    {
      $set: { user: user._id, googleEmail: email, refreshTokenEnc: encryptSecret(tokens.refresh_token, config.jwt.secret), lastError: null },
      $setOnInsert: { spreadsheetId: null, spreadsheetUrl: null },
    },
    { upsert: true },
  );
  accessTokens.set(String(space._id), { token: tokens.access_token, until: Date.now() + (Number(tokens.expires_in) || 3600) * 1000 - 60_000 });
  try { await syncSpace(space._id); } catch { /* shown on the page as the sync's error */ }
  return '/integrations?google=connected';
}

// Short-lived access tokens, per space, from the stored refresh token.
const accessTokens = new Map();
async function accessToken(link) {
  const key = String(link.space);
  const cached = accessTokens.get(key);
  if (cached && cached.until > Date.now()) return cached.token;
  try {
    const t = await call(config.google.tokenUrl, {
      method: 'POST',
      form: { client_id: config.google.clientId, client_secret: config.google.clientSecret, refresh_token: decryptSecret(link.refreshTokenEnc, config.jwt.secret).toString(), grant_type: 'refresh_token' },
    });
    accessTokens.set(key, { token: t.access_token, until: Date.now() + (Number(t.expires_in) || 3600) * 1000 - 60_000 });
    return t.access_token;
  } catch (err) {
    if (err.code === 'invalid_grant') throw new Error('Google access was removed (from your Google account, or it expired). Connect again.');
    throw err;
  }
}

async function createSpreadsheet(token, title) {
  return call(`${config.google.sheetsUrl}/spreadsheets`, {
    method: 'POST', token,
    json: {
      // No locale: Sheets refuses some (en_IN among them), and leaving it out uses the Google account's own.
      properties: { title, timeZone: config.timeZone },
      sheets: TABS.map((t) => ({ properties: { title: t, gridProperties: { frozenRowCount: 1 } } })),
    },
  });
}

// The sheet as it should be: every live entry, oldest first, and month-by-month totals.
async function sheetValues(spaceId) {
  const [txs, accounts, space] = await Promise.all([
    Transaction.find({ space: spaceId, deletedAt: null }).sort({ date: 1, createdAt: 1 }).lean(),
    Account.find({ space: spaceId }).select('name').lean(),
    Space.findById(spaceId).lean(),
  ]);
  const accountName = new Map(accounts.map((a) => [String(a._id), a.name]));
  const users = await User.find({ _id: { $in: space.members.map((m) => m.user) } }).select('name').lean();
  const userName = new Map(users.map((u) => [String(u._id), u.name]));
  const rows = txs.map((t) => [
    dayString(t.date), t.type, t.amountPaise / 100, t.category, accountName.get(String(t.account)) ?? '',
    t.toAccount ? accountName.get(String(t.toAccount)) ?? '' : '', METHOD_LABEL[t.paymentMethod] ?? '', t.merchant ?? '',
    t.note ?? '', (t.tags ?? []).map((x) => `#${x}`).join(' '), userName.get(String(t.user)) ?? 'Former member', String(t._id),
  ]);
  const months = new Map();
  for (const t of txs) {
    const m = dayString(t.date).slice(0, 7);
    const row = months.get(m) ?? { income: 0, expense: 0, n: 0 };
    if (t.type === 'income') row.income += t.amountPaise;
    if (t.type === 'expense') row.expense += t.amountPaise;
    row.n += 1;
    months.set(m, row);
  }
  const monthly = [...months].sort(([a], [b]) => b.localeCompare(a)).map(([m, r]) => [m, r.income / 100, r.expense / 100, (r.income - r.expense) / 100, r.n]);
  return { transactions: [HEADER, ...rows], monthly: [MONTHLY, ...monthly], count: rows.length, title: space.kind === 'personal' ? 'Spendwise – Personal' : `Spendwise – ${space.name}` };
}

// Makes sure the spreadsheet (and its two tabs) exist; makes a new one if it was deleted.
async function ensureSheet(token, link, title) {
  if (link.spreadsheetId) {
    try {
      const s = await call(`${config.google.sheetsUrl}/spreadsheets/${link.spreadsheetId}?fields=sheets.properties.title`, { token });
      const have = new Set((s.sheets ?? []).map((x) => x.properties.title));
      const missing = TABS.filter((t) => !have.has(t));
      if (missing.length) {
        await call(`${config.google.sheetsUrl}/spreadsheets/${link.spreadsheetId}:batchUpdate`, {
          method: 'POST', token, json: { requests: missing.map((t) => ({ addSheet: { properties: { title: t, gridProperties: { frozenRowCount: 1 } } } })) },
        });
      }
      return link.spreadsheetId;
    } catch (err) {
      if (err.status !== 404) throw err;
    }
  }
  const made = await createSpreadsheet(token, title);
  await SheetLink.updateOne({ _id: link._id }, { $set: { spreadsheetId: made.spreadsheetId, spreadsheetUrl: made.spreadsheetUrl } });
  return made.spreadsheetId;
}

const running = new Map();
// Rewrites both tabs with the current data. Values are written as plain values (never formulas).
export async function syncSpace(spaceId) {
  const key = String(spaceId);
  if (running.has(key)) return running.get(key);
  const job = (async () => {
    const link = await SheetLink.findOne({ space: spaceId }).select('+refreshTokenEnc');
    if (!link) return null;
    try {
      const token = await accessToken(link);
      const values = await sheetValues(spaceId);
      const id = await ensureSheet(token, link, values.title);
      await call(`${config.google.sheetsUrl}/spreadsheets/${id}/values:batchClear`, { method: 'POST', token, json: { ranges: TABS } });
      await call(`${config.google.sheetsUrl}/spreadsheets/${id}/values:batchUpdate`, {
        method: 'POST', token,
        json: { valueInputOption: 'RAW', data: [{ range: 'Transactions!A1', values: values.transactions }, { range: 'Monthly!A1', values: values.monthly }] },
      });
      await SheetLink.updateOne({ _id: link._id }, { $set: { lastSyncAt: new Date(), rowsSynced: values.count, lastError: null } });
      return { rows: values.count };
    } catch (err) {
      await SheetLink.updateOne({ _id: link._id }, { $set: { lastError: err.message } });
      throw new HttpError(502, 'sheets_sync_failed', `Google Sheets sync failed: ${err.message}`);
    }
  })();
  running.set(key, job);
  try { return await job; } finally { running.delete(key); }
}

export async function status(space) {
  const link = await SheetLink.findOne({ space: space._id }).lean();
  const by = link ? await User.findById(link.user).select('name').lean() : null;
  return {
    configured: googleConfigured(),
    connected: Boolean(link),
    googleEmail: link?.googleEmail ?? null,
    connectedBy: by?.name ?? null,
    spreadsheetUrl: link?.spreadsheetUrl ?? null,
    lastSyncAt: link?.lastSyncAt ?? null,
    rowsSynced: link?.rowsSynced ?? 0,
    lastError: link?.lastError ?? null,
  };
}

// Stops the sync and gives Google's permission back. The spreadsheet stays in the person's Drive.
export async function disconnect(space) {
  const link = await SheetLink.findOne({ space: space._id }).select('+refreshTokenEnc');
  if (!link) throw new HttpError(404, 'not_connected', 'Google Sheets isn’t connected for this space');
  try {
    await call(config.google.revokeUrl, { method: 'POST', form: { token: decryptSecret(link.refreshTokenEnc, config.jwt.secret).toString() } });
  } catch { /* already revoked on Google's side */ }
  accessTokens.delete(String(space._id));
  await SheetLink.deleteOne({ _id: link._id });
}

export async function syncAll() {
  let synced = 0;
  for (const link of await SheetLink.find().select('space').lean()) {
    try { await syncSpace(link.space); synced += 1; } catch { /* kept as lastError */ }
  }
  return { synced };
}

// Changes to entries sync the sheet shortly after the last change in a burst.
const timers = new Map();
onSpaceEvent(async ({ spaceId, event }) => {
  if (!event.startsWith('transaction')) return;
  if (!(await SheetLink.exists({ space: spaceId }))) return;
  clearTimeout(timers.get(spaceId));
  timers.set(spaceId, setTimeout(() => {
    timers.delete(spaceId);
    syncSpace(spaceId).catch(() => {});
  }, syncDelay.ms).unref());
});
