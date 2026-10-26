// Mutual fund NAVs from AMFI (Association of Mutual Funds in India), free and without a key:
// the daily NAVAll.txt with every scheme's latest NAV, and the NAV history report for past days.
import { HttpError } from '../errors.js';
import { config } from '../config.js';
import { parseNavFile } from '../invest.js';
import { AmfiScheme, Holding, NavHistory } from '../models/index.js';
import { addDays, todayIn } from '../schedule.js';

export const AMFI_SOURCE = 'AMFI (amfiindia.com), daily NAVs';
const REFRESH_MS = 20 * 60 * 60 * 1000;
// A purchase on a holiday gets the next business day's NAV; a week is the longest gap.
const LOOK_AHEAD_DAYS = 6;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const amfiDay = (d) => `${String(d.getUTCDate()).padStart(2, '0')}-${MONTHS[d.getUTCMonth()]}-${d.getUTCFullYear()}`;

// AMFI's portal answers browsers only, so a browser-like User-Agent is sent.
async function getText(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Spendwise)' },
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`AMFI answered ${res.status}`);
  return res.text();
}

const heldCodes = async () => new Set((await Holding.distinct('schemeCode', { kind: 'mf' })).filter(Boolean));

async function saveHistory(rows) {
  await NavHistory.bulkWrite(rows.map((r) => ({
    updateOne: { filter: { code: r.code, date: r.date }, update: { $set: { nav: r.nav } }, upsert: true },
  })), { ordered: false });
}

// Downloads the daily file and stores every scheme with its latest NAV.
export async function syncSchemes({ now = new Date() } = {}) {
  const rows = parseNavFile(await getText(config.amfiNavUrl));
  if (!rows.length) throw new Error('AMFI sent no NAVs');
  for (let i = 0; i < rows.length; i += 2000) {
    await AmfiScheme.bulkWrite(rows.slice(i, i + 2000).map((r) => ({
      updateOne: {
        filter: { code: r.code },
        update: { $set: { name: r.name, plan: r.plan, option: r.option, isin: r.isin, isinReinv: r.isinReinv, category: r.category, nav: r.nav, navDate: r.date, fetchedAt: now } },
        upsert: true,
      },
    })), { ordered: false });
  }
  // The latest NAVs of held schemes go into the history too, so past values stay known.
  const held = await heldCodes();
  const keep = rows.filter((r) => held.has(r.code));
  if (keep.length) await saveHistory(keep);
  return { schemes: rows.length };
}

// Refreshes the scheme list when it's older than ~a day. If AMFI can't be reached the stored list is
// used; with nothing stored, a clear 503.
export async function ensureSchemes({ now = new Date() } = {}) {
  const newest = await AmfiScheme.findOne().sort({ fetchedAt: -1 }).select('fetchedAt').lean();
  // Lists saved before categories were kept (batch 12M) are fetched again once.
  const hasCategories = newest && await AmfiScheme.exists({ category: { $nin: ['', null] } });
  if (newest && hasCategories && now - newest.fetchedAt < REFRESH_MS) return;
  try {
    await syncSchemes({ now });
  } catch (err) {
    if (!newest) throw new HttpError(503, 'amfi_unavailable', `AMFI's NAV list could not be reached: ${err.message}`);
  }
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const serializeScheme = (s) => ({
  code: s.code, name: s.name, plan: s.plan, option: s.option, isin: s.isin,
  nav: s.nav, navDate: s.navDate.toISOString().slice(0, 10),
});

// Schemes whose name has every word typed (or the scheme code), Direct Growth plans first.
export async function searchSchemes(q, { limit = 20 } = {}) {
  await ensureSchemes();
  const text = q.trim();
  const filter = /^\d+$/.test(text)
    ? { code: Number(text) }
    : { $and: text.split(/\s+/).slice(0, 8).map((w) => ({ name: { $regex: escapeRegex(w), $options: 'i' } })) };
  const found = await AmfiScheme.find(filter).limit(300).lean();
  const rank = (s) => (/direct/i.test(`${s.plan} ${s.name}`) ? 0 : 1) + (/growth/i.test(`${s.option} ${s.name}`) ? 0 : 2);
  return found.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)).slice(0, limit).map(serializeScheme);
}

export async function scheme(code) {
  await ensureSchemes();
  const s = await AmfiScheme.findOne({ code }).lean();
  return s ? serializeScheme(s) : null;
}

// The latest NAV of each code: Map(code -> { nav, date, category }).
export async function latestNavs(codes) {
  if (!codes.length) return new Map();
  await ensureSchemes();
  const rows = await AmfiScheme.find({ code: { $in: codes } }).select('code nav navDate category').lean();
  return new Map(rows.map((r) => [r.code, { nav: r.nav, date: r.navDate, category: r.category ?? '' }]));
}

// The NAV a purchase on `day` gets: that day's, or the next business day's within a week.
// Null when AMFI hasn't published it yet (a day's NAVs come out that evening).
// A past day already downloaded in this process isn't asked for again; yesterday and today are
// asked again after an hour, since AMFI may not have published them the first time.
const fetchedDays = new Map();
export async function navOn(code, day, { today = todayIn(config.timeZone) } = {}) {
  for (let i = 0; i <= LOOK_AHEAD_DAYS; i += 1) {
    const d = addDays(day, i);
    if (d > today) return null;
    const cached = await NavHistory.findOne({ code, date: d }).lean();
    if (cached) return { nav: cached.nav, date: d };
    const latest = await AmfiScheme.findOne({ code, navDate: d }).lean();
    if (latest) return { nav: latest.nav, date: d };
    const key = d.getTime();
    const recent = d >= addDays(today, -1);
    if (fetchedDays.has(key) && !(recent && Date.now() - fetchedDays.get(key) > 60 * 60 * 1000)) continue;
    let rows;
    try {
      rows = parseNavFile(await getText(`${config.amfiHistoryUrl}?${new URLSearchParams({ frmdt: amfiDay(d), todt: amfiDay(d) })}`));
    } catch (err) {
      throw new HttpError(503, 'amfi_unavailable', `AMFI's NAV history could not be reached: ${err.message}`);
    }
    fetchedDays.set(key, Date.now());
    const held = await heldCodes();
    held.add(code);
    const keep = rows.filter((r) => held.has(r.code) && +r.date === key);
    if (keep.length) await saveHistory(keep);
    const hit = keep.find((r) => r.code === code);
    if (hit) return { nav: hit.nav, date: d };
  }
  return null;
}
