// India's official Consumer Price Index, for spending in today's prices.
// Source: MoSPI (National Statistics Office), All India, Combined (rural + urban), CPI (General),
// base 2024=100, from MoSPI's public API. The 2024-base series starts in January 2025; MoSPI's
// "Back" series links 2013-2024 to the same base. Figures are cached and refreshed at most once a day.
import crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { HttpError } from '../errors.js';
import { config } from '../config.js';
import { CpiIndex } from '../models/index.js';

export const CPI_SOURCE = 'MoSPI, All India CPI (Combined, General), base 2024=100';
const BASE_YEAR = '2024';
const FIRST_YEAR = 2013;
const CURRENT_FROM = 2025;
const REFRESH_MS = 24 * 60 * 60 * 1000;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// MoSPI's server still uses legacy TLS renegotiation, which Node refuses by default. It is allowed for
// these requests only: they are read-only downloads of public statistics, with nothing secret sent.
const mospiAgent = new https.Agent({ secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT, keepAlive: false });

function getJson(url) {
  const client = url.startsWith('https:') ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.get(url, { agent: url.startsWith('https:') ? mospiAgent : undefined, headers: { 'User-Agent': 'Spendwise' }, timeout: 20_000 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`MoSPI answered ${res.statusCode}`));
        try { resolve(JSON.parse(body)); } catch { reject(new Error('MoSPI sent something that is not JSON')); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('MoSPI took too long to answer')));
    req.on('error', reject);
  });
}

async function fetchSeries(series, years) {
  const rows = [];
  for (let page = 1; page <= 20; page += 1) {
    const params = new URLSearchParams({
      base_year: BASE_YEAR, series, year: years.join(','), state_code: '1', sector_code: '3', division_code: '0',
      Format: 'JSON', limit: '100', page: String(page),
    });
    const body = await getJson(`${config.cpiUrl}?${params}`);
    for (const r of body.data ?? []) {
      const m = MONTHS.indexOf(r.month) + 1;
      const index = Number(r.index);
      // Only the all-India combined general index; MoSPI marks months without a figure with an empty index.
      if (!m || !Number.isFinite(index) || index <= 0 || r.sector !== 'Combined' || r.division !== 'CPI (General)') continue;
      rows.push({ month: `${r.year}-${String(m).padStart(2, '0')}`, index, series });
    }
    if (!body.meta_data || page >= body.meta_data.totalPages) break;
  }
  return rows;
}

// Downloads both series and stores them (the current series wins where both cover a month).
export async function refreshCpi({ now = new Date() } = {}) {
  const thisYear = now.getUTCFullYear();
  const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  const back = await fetchSeries('Back', range(FIRST_YEAR, CURRENT_FROM - 1));
  const current = await fetchSeries('Current', range(CURRENT_FROM, thisYear));
  const byMonth = new Map([...back, ...current].map((r) => [r.month, r]));
  if (!byMonth.size) throw new Error('MoSPI returned no CPI figures');
  await CpiIndex.bulkWrite([...byMonth.values()].map((r) => ({
    updateOne: {
      filter: { month: r.month, baseYear: BASE_YEAR },
      update: { $set: { index: r.index, series: r.series, fetchedAt: now } },
      upsert: true,
    },
  })));
  return { months: byMonth.size, latest: [...byMonth.keys()].sort().at(-1) };
}

// Map("YYYY-MM" -> index), refreshed when older than a day. If MoSPI can't be reached, the stored
// figures are used; with none stored, a clear 503.
export async function cpiTable({ now = new Date() } = {}) {
  const newest = await CpiIndex.findOne({ baseYear: BASE_YEAR }).sort({ fetchedAt: -1 }).lean();
  if (!newest || now - newest.fetchedAt > REFRESH_MS) {
    try {
      await refreshCpi({ now });
    } catch (err) {
      if (!newest) throw new HttpError(503, 'cpi_unavailable', `India's price index (MoSPI) could not be reached: ${err.message}`);
    }
  }
  const rows = await CpiIndex.find({ baseYear: BASE_YEAR }).sort({ month: 1 }).lean();
  return {
    index: new Map(rows.map((r) => [r.month, r.index])),
    latestMonth: rows.at(-1)?.month ?? null,
    fetchedAt: rows.reduce((t, r) => (r.fetchedAt > t ? r.fetchedAt : t), new Date(0)),
    source: CPI_SOURCE,
  };
}
