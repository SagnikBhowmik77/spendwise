// Batch 12M: the capital gains report for a tax year, from the fund, stock and gold sales recorded under
// Investments. An estimate under the rules in src/capitalGains.js, not tax advice.
import { config } from '../config.js';
import { AmfiScheme, Holding } from '../models/index.js';
import { CG_YEARS, CG_YEAR_KEYS, GRANDFATHER_DAY, salesOf, yearTotals } from '../capitalGains.js';
import { fyOf, fyRange } from '../tax.js';
import { dayString } from '../money.js';
import { todayIn } from '../schedule.js';
import { defaultTaxClass } from './investment.service.js';
import { ensureSchemes, navOn } from './nav.service.js';

const money = (paise) => (paise === null ? null : { paise, rupees: paise / 100 });
const moneyAll = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, money(v)]));
// NPS, EPF, PPF and deposits aren't sold on the market, so only these kinds can have capital gains.
const CAPITAL_KINDS = ['mf', 'stock', 'gold', 'other'];
const BEFORE_2018 = new Date('2018-02-01T00:00:00Z');
export const SLAB_RATES = [0, 5, 10, 15, 20, 25, 30];

export function currentCgYear() {
  const fy = fyOf(todayIn(config.timeZone));
  return CG_YEARS[fy] ? fy : CG_YEAR_KEYS[0];
}

// A fund's NAV on 31 January 2018 (its fair market value for units bought before February 2018). Null if AMFI
// has nothing for that exact day.
async function navOn2018(code) {
  const hit = await navOn(code, new Date(`${GRANDFATHER_DAY}T00:00:00Z`));
  return hit && dayString(hit.date) === GRANDFATHER_DAY ? hit.nav : null;
}

export async function report(spaceId, { fy, slabPct = null }) {
  const r = CG_YEARS[fy];
  const range = fyRange(fy);
  const holdings = await Holding.find({ space: spaceId, kind: { $in: CAPITAL_KINDS }, 'trades.type': 'sell' }).lean();
  const codes = holdings.filter((h) => h.kind === 'mf' && h.schemeCode).map((h) => h.schemeCode);
  if (codes.length) await ensureSchemes().catch(() => null);
  const categories = new Map((await AmfiScheme.find({ code: { $in: codes } }).select('code category').lean()).map((s) => [s.code, s.category]));

  const sales = [];
  const warnings = { needsClass: [], needsFmv: [], unmatched: [], fmvUnavailable: [] };
  for (const h of holdings) {
    const soldThisYear = h.trades.some((t) => t.type === 'sell' && t.date >= range.from && t.date <= range.to);
    if (!soldThisYear) continue;
    const taxClass = h.taxClass ?? defaultTaxClass(h.kind, categories.get(h.schemeCode));
    let fmv2018 = h.fmv2018 ?? null;
    let fmvSource = fmv2018 ? 'you' : null;
    const old = h.trades.some((t) => t.type === 'buy' && t.date < BEFORE_2018);
    if (taxClass === 'equity' && old && !fmv2018 && h.kind === 'mf' && h.schemeCode) {
      try {
        fmv2018 = await navOn2018(h.schemeCode);
        if (fmv2018) fmvSource = 'amfi';
      } catch {
        warnings.fmvUnavailable.push({ id: String(h._id), name: h.name });
      }
    }
    const found = salesOf({ id: String(h._id), name: h.name, kind: h.kind, taxClass, fmv2018, trades: h.trades }, range);
    if (!taxClass) warnings.needsClass.push({ id: String(h._id), name: h.name, category: categories.get(h.schemeCode) ?? null });
    if (found.some((s) => s.lots.some((l) => l.needsFmv))) warnings.needsFmv.push({ id: String(h._id), name: h.name });
    for (const s of found) {
      if (s.unmatchedUnits > 0) warnings.unmatched.push({ id: String(h._id), name: h.name, date: dayString(s.saleDate), units: s.unmatchedUnits });
      sales.push({ ...s, fmv2018, fmvSource });
    }
  }
  sales.sort((a, b) => a.saleDate - b.saleDate);
  const totals = yearTotals(sales, { fy, slabPct });

  return {
    fy, from: dayString(range.from), to: dayString(range.to), law: r.law, sections: r.sections, sources: r.sources,
    rates: r.rates, cessPct: r.cessPct, surchargeCapPct: r.surchargeCapPct, slabPct,
    years: CG_YEAR_KEYS,
    sales: sales.map((s) => ({
      holdingId: s.holdingId, name: s.name, kind: s.kind, taxClass: s.taxClass, date: dayString(s.saleDate), units: s.units,
      proceeds: money(s.proceeds), fmv2018: s.fmv2018, fmvSource: s.fmvSource,
      gain: money(s.lots.reduce((x, l) => x + l.gain, 0)),
      lots: s.lots.map((l) => ({
        bought: dayString(l.buyDate), units: l.units, proceeds: money(l.proceeds), cost: money(l.cost), paid: money(l.paidCost),
        gain: money(l.gain), term: l.long === null ? null : l.long ? 'long' : 'short', bucket: l.bucket, grandfathered: l.grandfathered,
      })),
    })),
    totals: {
      gross: moneyAll(totals.gross), net: moneyAll(totals.net), taxable: moneyAll(totals.taxable),
      exemption: money(totals.exemption), exemptionUsed: money(totals.exemptionUsed),
      tax: moneyAll(totals.tax), taxBeforeCess: money(totals.taxBeforeCess), cess: money(totals.cess), total: money(totals.total),
      carryForward: moneyAll(totals.carryForward),
    },
    warnings,
    note: 'An estimate from the sales you recorded, matched first in, first out. Surcharge (capped at 15% on this income) and losses carried in from earlier years aren’t included. Check with Form 26AS / AIS and your broker’s or fund house’s capital gains statement before filing.',
  };
}
