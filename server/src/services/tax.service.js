// Tax helper: how much of each yearly limit is used, from expenses tagged by the person, and a salary
// breakdown. Results are estimates under the rules in src/tax.js, not tax advice.
import { config } from '../config.js';
import { Transaction } from '../models/index.js';
import { dayString } from '../money.js';
import { todayIn } from '../schedule.js';
import { TAX_YEARS, fyOf, fyRange, rulesFor, salaryBreakdown } from '../tax.js';

// Tags that count towards each limit (tags are lower-case, so "80C" typed by someone is "80c").
export const TAX_TAGS = {
  investments: ['80c', 'sec-123'],
  healthSelf: ['80d', 'sec-126'],
  healthParents: ['80d-parents', 'sec-126-parents'],
  rent: ['rent', 'hra'],
};
const money = (paise) => (paise === null ? null : { paise, rupees: paise / 100 });

export const currentFy = () => fyOf(todayIn(config.timeZone));

export function rules(fy) {
  const r = rulesFor(fy);
  const slabs = (list) => list.map(([upTo, rate]) => ({ upTo: Number.isFinite(upTo) ? money(upTo) : null, rate }));
  return {
    fy, label: r.label, law: r.law, sections: r.sections, sources: r.sources,
    newSlabs: slabs(r.newSlabs),
    oldSlabs: Object.fromEntries(Object.entries(r.oldSlabs).map(([k, v]) => [k, slabs(v)])),
    standardDeduction: { new: money(r.standardDeduction.new), old: money(r.standardDeduction.old) },
    rebate: { new: { upTo: money(r.rebate.new.upTo), max: money(r.rebate.new.max) }, old: { upTo: money(r.rebate.old.upTo), max: money(r.rebate.old.max) } },
    limits: Object.fromEntries(Object.entries(r.limits).map(([k, v]) => [k, money(v)])),
    hraFiftyPctCities: r.hraFiftyPctCities,
    cessPct: r.cessPct,
    years: Object.keys(TAX_YEARS),
  };
}

// For one financial year (April to March): totals of tagged expenses against each limit.
export async function summary(spaceId, { fy, selfSenior = false, parentsSenior = false }) {
  const r = rulesFor(fy);
  const { from, to } = fyRange(fy);
  // Rent also counts from the Rent category (batch 12M), the same entries rent receipts are made from.
  const rows = await Transaction.find(
    { space: spaceId, deletedAt: null, type: 'expense', date: { $gte: from, $lte: to }, $or: [{ tags: { $in: Object.values(TAX_TAGS).flat() } }, { category: 'Rent' }] },
    { date: 1, amountPaise: 1, category: 1, note: 1, merchant: 1, tags: 1 },
  ).sort({ date: -1 }).lean();
  const limits = {
    investments: r.limits.investments,
    healthSelf: selfSenior ? r.limits.healthSelfSenior : r.limits.healthSelf,
    healthParents: parentsSenior ? r.limits.healthParentsSenior : r.limits.healthParents,
    rent: null,
  };
  const buckets = Object.fromEntries(Object.entries(TAX_TAGS).map(([key, tags]) => {
    const list = rows.filter((t) => t.tags.some((g) => tags.includes(g)) || (key === 'rent' && t.category === 'Rent'));
    const used = list.reduce((s, t) => s + t.amountPaise, 0);
    const limit = limits[key];
    return [key, {
      tags,
      used: money(used),
      limit: money(limit),
      // What still counts towards the limit this year.
      remaining: limit === null ? null : money(Math.max(0, limit - used)),
      percent: limit ? Math.min(100, Math.round((used * 1000) / limit) / 10) : null,
      count: list.length,
      months: key === 'rent' ? new Set(list.map((t) => dayString(t.date).slice(0, 7))).size : undefined,
      entries: list.slice(0, 10).map((t) => ({ id: String(t._id), date: dayString(t.date), category: t.category, note: t.note, merchant: t.merchant ?? null, amount: money(t.amountPaise) })),
    }];
  }));
  return {
    fy, label: r.label, law: r.law, sections: r.sections, from: dayString(from), to: dayString(to),
    buckets,
    note: 'An estimate from the expenses you tagged. Only the old tax regime allows these deductions; check with the rules or a tax professional before filing.',
  };
}

// The salary breakdown with amounts as { paise, rupees } for the app.
export function salary(input) {
  const s = salaryBreakdown(input);
  const conv = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? money(v) : v]));
  const regime = (x) => ({
    taxable: money(x.taxable), deductions: conv(x.deductions), monthlyTakeHome: money(x.monthlyTakeHome), hraPct: x.hraPct ?? null,
    tax: { ...conv(x.tax), effectiveRate: x.tax.effectiveRate, slabs: x.tax.slabs.map((p) => ({ from: money(p.from), to: money(p.to), rate: p.rate, tax: money(p.tax) })) },
  });
  return { fy: s.fy, salary: conv(s.salary), new: regime(s.new), old: regime(s.old), better: s.better, saving: money(s.saving), sources: rulesFor(s.fy).sources };
}
