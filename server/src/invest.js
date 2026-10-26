// Investment maths: returns (XIRR), fixed and recurring deposits, PPF, and AMFI's NAV files.
// Amounts are integer paise; days are UTC-midnight Dates; rates are yearly percentages.

const DAY_MS = 24 * 60 * 60 * 1000;
const YEAR_DAYS = 365;
const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

// Annualised return of dated cash flows (money in negative, value now positive), like a spreadsheet's XIRR.
// Null when it can't be worked out (all one sign, or no solution).
export function xirr(flows) {
  if (flows.length < 2 || !flows.some((f) => f.amount > 0) || !flows.some((f) => f.amount < 0)) return null;
  const t0 = flows.reduce((m, f) => (f.date < m ? f.date : m), flows[0].date);
  const years = flows.map((f) => (f.date - t0) / DAY_MS / YEAR_DAYS);
  const npv = (r) => flows.reduce((s, f, i) => s + f.amount / (1 + r) ** years[i], 0);
  // Bisection on a wide bracket: slow but never diverges.
  let lo = -0.9999;
  let hi = 10;
  let fLo = npv(lo);
  if (fLo * npv(hi) > 0) return null;
  for (let i = 0; i < 200; i += 1) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid);
    if (Math.abs(fMid) < 0.5 || hi - lo < 1e-9) return Math.round(mid * 10000) / 100;
    if (fLo * fMid < 0) hi = mid; else { lo = mid; fLo = fMid; }
  }
  return Math.round(((lo + hi) / 2) * 10000) / 100;
}

const PERIODS = { monthly: 12, quarterly: 4, 'half-yearly': 2, yearly: 1 };

// Whole months between two days (the end month counts only once its day is reached).
export function monthsBetween(from, to) {
  const m = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  return to.getUTCDate() >= from.getUTCDate() ? m : m - 1;
}
export const addMonths = (day, n) => {
  const d = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + n, 1));
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), Math.min(day.getUTCDate(), last)));
};

// A fixed deposit: P × (1 + r/n)^(n × years), or simple interest. `on` defaults to maturity.
export function fdValue({ principalPaise, ratePct, startDate, tenureMonths, compounding = 'quarterly', on }) {
  const maturity = addMonths(startDate, tenureMonths);
  const until = !on || on > maturity ? maturity : on < startDate ? startDate : on;
  const years = (until - startDate) / DAY_MS / YEAR_DAYS;
  const r = ratePct / 100;
  const value = compounding === 'simple'
    ? principalPaise * (1 + r * years)
    : principalPaise * (1 + r / PERIODS[compounding]) ** (PERIODS[compounding] * years);
  return { value: Math.round(value), maturityDate: maturity, matured: on ? on >= maturity : true };
}

// A recurring deposit with quarterly compounding (how Indian banks quote RDs): each monthly instalment
// grows for the time it stays in. `on` defaults to maturity; before then only instalments paid count.
export function rdValue({ monthlyPaise, ratePct, startDate, tenureMonths, on }) {
  const maturity = addMonths(startDate, tenureMonths);
  const until = !on || on > maturity ? maturity : on;
  const r = ratePct / 100;
  let value = 0;
  let paid = 0;
  for (let i = 0; i < tenureMonths; i += 1) {
    const d = addMonths(startDate, i);
    if (d > until) break;
    paid += monthlyPaise;
    value += monthlyPaise * (1 + r / 4) ** (4 * ((until - d) / DAY_MS / YEAR_DAYS));
  }
  return { value: Math.round(value), paid, maturityDate: maturity, matured: until >= maturity };
}

// PPF: interest each month on the lowest balance between the 5th and the end of the month (so a
// deposit counts for a month only if made by the 5th), credited at the end of March each year.
// `deposits`: [{ date, amountPaise }] (withdrawals negative). Returns the balance with interest credited,
// interest earned so far this financial year (not yet credited), and the maturity date (15 full years).
export function ppfValue({ deposits, ratePct, on }) {
  if (!deposits.length) return { balance: 0, accrued: 0, interestCredited: 0, maturityDate: null };
  const sorted = [...deposits].sort((a, b) => a.date - b.date);
  const first = sorted[0].date;
  const fyStartYear = first.getUTCMonth() >= 3 ? first.getUTCFullYear() : first.getUTCFullYear() - 1;
  const maturityDate = new Date(Date.UTC(fyStartYear + 16, 3, 1)); // after 15 complete financial years
  let balance = 0;
  let accrued = 0;
  let credited = 0;
  let i = 0;
  for (let m = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1)); m <= on; m = addMonths(m, 1)) {
    const fifth = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth(), 5));
    const monthEnd = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 0));
    while (i < sorted.length && sorted[i].date <= fifth) balance += sorted[i++].amountPaise;
    const lowest = balance;
    while (i < sorted.length && sorted[i].date <= monthEnd && sorted[i].date <= on) balance += sorted[i++].amountPaise;
    // A month counts once it has ended.
    if (monthEnd <= on) accrued += (Math.max(0, lowest) * ratePct) / 100 / 12;
    if (m.getUTCMonth() === 2 && monthEnd <= on) {
      const add = Math.round(accrued);
      balance += add;
      credited += add;
      accrued = 0;
    }
  }
  return { balance, accrued: Math.round(accrued), interestCredited: credited, maturityDate };
}

// EPF interest rates declared by EPFO's Central Board of Trustees and ratified by the government, per financial
// year. 2025-26: fixed on 2 March 2026, ratified June 2026. Later years use the latest rate until one is declared.
export const EPF_RATES = { '2023-24': 8.25, '2024-25': 8.25, '2025-26': 8.25 };
const fyKey = (d) => {
  const y = d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
};
export const epfRateFor = (d) => {
  const fy = fyKey(d);
  if (EPF_RATES[fy]) return { rate: EPF_RATES[fy], fy, declared: true };
  const known = Object.keys(EPF_RATES).sort();
  return { rate: EPF_RATES[known.at(-1)], fy, declared: false };
};

// EPF: the last balance from your passbook (it already includes interest credited), plus contributions since
// then, plus interest worked out like EPFO does: each month on the balance at its start, added at the end of March.
// deposits: [{ date, amountPaise }] (withdrawals negative); passbook: [{ date, balancePaise }].
export function epfValue({ deposits, passbook = [], on }) {
  const book = passbook.filter((p) => p.date <= on).sort((a, b) => a.date - b.date).at(-1) ?? null;
  const after = deposits.filter((d) => d.date <= on && (!book || d.date > book.date)).sort((a, b) => a.date - b.date);
  const start = book ? book.date : after[0]?.date;
  const invested = (book?.balancePaise ?? 0) + after.reduce((s, d) => s + d.amountPaise, 0);
  if (!start) return { balance: 0, accrued: 0, interestEstimated: 0, invested: 0, ...epfRateFor(on), lastPassbook: null };
  let balance = book?.balancePaise ?? 0;
  let accrued = 0;
  let estimated = 0;
  let declared = true;
  let i = 0;
  // A passbook balance covers its own month; contributions start earning the month after they're made.
  let m = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + (book ? 1 : 0), 1));
  if (book) while (i < after.length && after[i].date < m) balance += after[i++].amountPaise;
  for (; new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 0)) <= on; m = addMonths(m, 1)) {
    const monthEnd = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 0));
    const opening = balance;
    while (i < after.length && after[i].date <= monthEnd) balance += after[i++].amountPaise;
    const r = epfRateFor(m);
    if (!r.declared) declared = false;
    accrued += (Math.max(0, opening) * r.rate) / 1200;
    if (m.getUTCMonth() === 2) {
      const add = Math.round(accrued);
      balance += add;
      estimated += add;
      accrued = 0;
    }
  }
  while (i < after.length) balance += after[i++].amountPaise;
  const now = epfRateFor(on);
  return {
    balance, accrued: Math.round(accrued), interestEstimated: estimated + Math.round(accrued), invested,
    rate: now.rate, fy: now.fy, declared: declared && now.declared, lastPassbook: book,
  };
}

// AMFI's text files: the daily NAVAll.txt (Scheme Code;ISIN…;ISIN…;Scheme Name;Plan;Option;NAV;Date, older
// files without Plan/Option) and the history report (Scheme Code;NAV Name;Plan;Option;ISIN…;ISIN…;NAV;Date).
// Columns are found by name, so either layout works. Fund-house and category lines are skipped.
export function parseNavFile(text) {
  const lines = text.split(/\r?\n/);
  const headerIndex = lines.findIndex((l) => /^Scheme Code;/i.test(l.trim()));
  if (headerIndex === -1) return [];
  const cols = lines[headerIndex].split(';').map((c) => c.trim().toLowerCase());
  const at = (re) => cols.findIndex((c) => re.test(c));
  const ix = {
    code: at(/^scheme code$/), name: at(/^(scheme name|nav name)$/), plan: at(/^plan$/), option: at(/^option$/),
    isin: at(/isin.*growth|isin div payout/), isinReinv: at(/isin div reinvestment/), nav: at(/^net asset value$/), date: at(/^date$/),
  };
  const out = [];
  // Category headings ("Open Ended Schemes(Equity Scheme - Large Cap Fund)") apply to the schemes below them.
  let category = '';
  for (const line of lines.slice(headerIndex + 1)) {
    const heading = /^\s*(?:Open|Close|Interval) Ended Schemes\s*\((.*)\)\s*$/i.exec(line);
    if (heading) { category = heading[1].trim(); continue; }
    const f = line.split(';');
    if (f.length < 5 || !/^\d+$/.test(f[ix.code]?.trim())) continue;
    const nav = Number(f[ix.nav]);
    const dm = /^(\d{2})-([A-Za-z]{3})-(\d{4})$/.exec((f[ix.date] ?? '').trim());
    if (!Number.isFinite(nav) || nav <= 0 || !dm || MONTHS[dm[2]] === undefined) continue;
    const clean = (v) => (v && v.trim() !== '-' ? v.trim() : '');
    out.push({
      code: Number(f[ix.code]),
      name: clean(f[ix.name]),
      plan: ix.plan >= 0 ? clean(f[ix.plan]) : '',
      option: ix.option >= 0 ? clean(f[ix.option]) : '',
      isin: clean(f[ix.isin]),
      isinReinv: ix.isinReinv >= 0 ? clean(f[ix.isinReinv]) : '',
      nav,
      category,
      date: new Date(Date.UTC(Number(dm[3]), MONTHS[dm[2]], Number(dm[1]))),
    });
  }
  return out;
}

// NAV per unit (rupees, up to 4 decimals) to paise per unit, and units bought for an amount.
export const unitsFor = (amountPaise, nav) => Math.round((amountPaise / 100 / nav) * 10000) / 10000;
