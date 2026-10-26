// Batch 12M: capital gains on fund and stock sales for one tax year, worked out lot by lot (first in, first
// out). Estimates under the rules below, never tax advice. Amounts are integer paise; days are UTC midnights.
import { addMonths } from './invest.js';

const L = (rupees) => rupees * 100;
const day = (s) => new Date(`${s}T00:00:00Z`);

// How a holding is taxed when sold:
// equity  - equity shares and equity-oriented funds (STT paid): 12 months; short-term 20%; long-term 12.5% above ₹1.25 lakh
// debt    - a "Specified Mutual Fund" (more than 65% in debt): bought on or after 1 April 2023 always short-term, taxed at
//           your slab rate; bought before, like `other`
// listed  - other listed securities (ETFs that aren't equity, listed bonds, gold bonds bought on the exchange): 12 months
// other   - everything else (gold, unlisted fund units such as fund of funds): 24 months
// Long-term gains on listed, other and older debt units: 12.5% without indexation. Short-term ones: your slab rate.
export const TAX_CLASSES = ['equity', 'debt', 'listed', 'other'];
const HOLD_MONTHS = { equity: 12, listed: 12, debt: 24, other: 24 };
const SPECIFIED_FUND_FROM = day('2023-04-01');
const GRANDFATHER_BEFORE = day('2018-02-01');
export const GRANDFATHER_DAY = '2018-01-31';

const COMMON = {
  rates: { stcgEquity: 20, ltcgEquity: 12.5, ltcgOther: 12.5 },
  exemption: L(125000),
  cessPct: 4,
  surchargeCapPct: 15,
};
// Only years whose rules were checked against the law are offered.
export const CG_YEARS = {
  '2026-27': {
    ...COMMON,
    law: 'Income-tax Act, 2025',
    sections: {
      holding: 'Section 2(101) (was 2(42A))', stcgEquity: 'Section 196 (was 111A)', ltcgEquity: 'Section 198 (was 112A)',
      ltcgOther: 'Section 197 (was 112)', specifiedFund: 'Section 76 (was 50AA)', grandfather: 'Section 90(7)–(8) (was 55(2)(ac))',
    },
    sources: [
      'Income-tax Act, 2025 (Gazette of India, 21 Aug 2025): section 2(101) holding periods (12 months for listed securities and equity-oriented funds, 24 months otherwise); section 196 short-term gains on equity at 20%; section 198 long-term gains on equity at 12.5% above ₹1,25,000; section 197 other long-term gains at 12.5%; section 76 Specified Mutual Fund units bought on or after 1 April 2023 always short-term; section 90(7)–(8) cost of equity bought before 1 February 2018',
      'Finance Bill 2026 memorandum (indiabudget.gov.in): no change to these rates; surcharge on this income capped at 15%',
    ],
  },
  '2025-26': {
    ...COMMON,
    law: 'Income-tax Act, 1961',
    sections: {
      holding: 'Section 2(42A)', stcgEquity: 'Section 111A', ltcgEquity: 'Section 112A', ltcgOther: 'Section 112',
      specifiedFund: 'Section 50AA', grandfather: 'Section 55(2)(ac)',
    },
    sources: [
      'Income-tax Act, 1961 as amended by the Finance (No. 2) Act, 2024 (rates for transfers from 23 July 2024): section 111A 20%, section 112A 12.5% above ₹1,25,000, section 112 12.5% without indexation, section 50AA, section 55(2)(ac)',
      'Finance Bill 2026 memorandum: rates for 2025-26 unchanged; surcharge on this income capped at 15%',
    ],
  },
};
export const CG_YEAR_KEYS = Object.keys(CG_YEARS);

// A default tax class from AMFI's category heading ("Equity Scheme - Large Cap Fund", "Income/Debt Oriented
// Schemes - Liquid Fund"…); null when the category doesn't settle it (you pick it for the holding).
export function classFromCategory(category = '') {
  const c = category.toLowerCase();
  if (/^equity scheme|elss|index funds - equity|equity etf|aggressive hybrid|arbitrage|equity savings/.test(c)) return 'equity';
  if (/debt|gilt|liquid|money market|overnight|income\b|conservative hybrid|credit risk|corporate bond|banking and psu|floating|duration|maturity fund|dynamic term|dynamic bond|ultra short|short term|medium|long term/.test(c)) return 'debt';
  if (/etf/.test(c)) return 'listed';
  return null;
}

// Long-term when held for more than the period: a lot bought on 10 May 2025 is long-term from 11 May 2026.
const isLongTerm = (buy, sale, months) => sale > addMonths(buy, months);

// Which tax bucket a sold lot falls into.
function bucketOf(cls, buy, sale) {
  if (cls === 'debt' && buy >= SPECIFIED_FUND_FROM) return { bucket: 'stcgSlab', long: false };
  const long = isLongTerm(buy, sale, HOLD_MONTHS[cls]);
  if (cls === 'equity') return { bucket: long ? 'ltcgEquity' : 'stcgEquity', long };
  return { bucket: long ? 'ltcgOther' : 'stcgSlab', long };
}

const share = (total, part, whole) => (whole > 0 ? Math.round((total * part) / whole) : 0);

// Sales of one holding in [from, to], each matched to the oldest units still held.
// holding: { id, name, kind, taxClass, fmv2018 (rupees per unit on 31 Jan 2018, equity bought before 1 Feb 2018), trades }
export function salesOf(holding, { from, to }) {
  const lots = [];
  const sales = [];
  const trades = [...holding.trades].sort((a, b) => a.date - b.date || (a.type === 'buy' ? -1 : 1));
  for (const t of trades) {
    if (t.type === 'buy') { lots.push({ date: t.date, units: t.units, cost: t.amountPaise }); continue; }
    let left = t.units;
    const parts = [];
    while (left > 1e-9 && lots.length) {
      const lot = lots[0];
      const take = Math.min(lot.units, left);
      const cost = take >= lot.units - 1e-9 ? lot.cost : share(lot.cost, take, lot.units);
      parts.push({ buyDate: lot.date, units: Math.round(take * 10000) / 10000, cost });
      lot.cost -= cost;
      lot.units = Math.round((lot.units - take) * 10000) / 10000;
      if (lot.units <= 1e-9) lots.shift();
      left = Math.round((left - take) * 10000) / 10000;
    }
    if (t.date < from || t.date > to) continue;
    const cls = holding.taxClass;
    let proceedsLeft = t.amountPaise;
    let unitsLeft = t.units;
    const rows = parts.map((p) => {
      const proceeds = p.units >= unitsLeft - 1e-9 ? proceedsLeft : share(t.amountPaise, p.units, t.units);
      proceedsLeft -= proceeds;
      unitsLeft -= p.units;
      const { bucket, long } = cls ? bucketOf(cls, p.buyDate, t.date) : { bucket: null, long: null };
      let cost = p.cost;
      let grandfathered = false;
      // Equity held since before February 2018: cost is the higher of what was paid and the lower of
      // the 31 January 2018 value and what it sold for.
      if (cls === 'equity' && long && p.buyDate < GRANDFATHER_BEFORE) {
        if (holding.fmv2018) {
          const fmv = Math.round(holding.fmv2018 * p.units * 100);
          cost = Math.max(p.cost, Math.min(fmv, proceeds));
          grandfathered = true;
        }
      }
      return { buyDate: p.buyDate, units: p.units, proceeds, cost, paidCost: p.cost, gain: proceeds - cost, bucket, long, grandfathered,
        needsFmv: cls === 'equity' && long && p.buyDate < GRANDFATHER_BEFORE && !holding.fmv2018 };
    });
    sales.push({
      holdingId: holding.id, name: holding.name, kind: holding.kind, taxClass: cls, saleDate: t.date, units: t.units,
      proceeds: t.amountPaise, unmatchedUnits: Math.max(0, Math.round(left * 10000) / 10000), lots: rows,
    });
  }
  return sales;
}

// Totals per bucket for a year, with losses set off the way the law allows: short-term losses against any
// gains (slab-rate gains first, then 20%, then 12.5%), long-term losses only against long-term gains
// (the 12.5% ones without the exemption first). Then the ₹1.25 lakh exemption and an estimate of the tax.
// slabPct: your income-tax slab rate, to estimate tax on slab-rate gains (optional).
export function yearTotals(sales, { fy, slabPct = null }) {
  const r = CG_YEARS[fy];
  const gross = { stcgSlab: 0, stcgEquity: 0, ltcgOther: 0, ltcgEquity: 0 };
  for (const s of sales) for (const l of s.lots) if (l.bucket) gross[l.bucket] += l.gain;
  const net = { ...gross };
  const absorb = (pool, order) => {
    let left = pool;
    for (const b of order) {
      if (left <= 0) break;
      const use = Math.min(left, Math.max(0, net[b]));
      net[b] -= use;
      left -= use;
    }
    return left;
  };
  let stLoss = 0;
  for (const b of ['stcgSlab', 'stcgEquity']) if (net[b] < 0) { stLoss -= net[b]; net[b] = 0; }
  let ltLoss = 0;
  for (const b of ['ltcgOther', 'ltcgEquity']) if (net[b] < 0) { ltLoss -= net[b]; net[b] = 0; }
  const stCarry = absorb(stLoss, ['stcgSlab', 'stcgEquity', 'ltcgOther', 'ltcgEquity']);
  const ltCarry = absorb(ltLoss, ['ltcgOther', 'ltcgEquity']);
  const exemptionUsed = Math.min(r.exemption, net.ltcgEquity);
  const taxable = { ...net, ltcgEquity: net.ltcgEquity - exemptionUsed };
  const tax = {
    stcgEquity: Math.round((taxable.stcgEquity * r.rates.stcgEquity) / 100),
    ltcgEquity: Math.round((taxable.ltcgEquity * r.rates.ltcgEquity) / 100),
    ltcgOther: Math.round((taxable.ltcgOther * r.rates.ltcgOther) / 100),
    stcgSlab: slabPct === null ? null : Math.round((taxable.stcgSlab * slabPct) / 100),
  };
  const before = tax.stcgEquity + tax.ltcgEquity + tax.ltcgOther + (tax.stcgSlab ?? 0);
  const cess = Math.round((before * r.cessPct) / 100);
  return {
    gross, net, exemption: r.exemption, exemptionUsed, taxable, tax,
    taxBeforeCess: before, cess, total: before + cess,
    carryForward: { shortTerm: stCarry, longTerm: ltCarry },
  };
}
