// India income-tax maths for estimates (never tax advice). Amounts are integer paise.
// Every figure below was checked against official documents; the sources are listed with each year.
// When a Budget changes the rules, add a new year here instead of editing an old one.

const L = (rupees) => rupees * 100; // rupees -> paise
const INF = Number.POSITIVE_INFINITY;

const SLABS_OLD = {
  below60: [[L(250000), 0], [L(500000), 5], [L(1000000), 20], [INF, 30]],
  senior: [[L(300000), 0], [L(500000), 5], [L(1000000), 20], [INF, 30]],
  superSenior: [[L(500000), 0], [L(1000000), 20], [INF, 30]],
};
const SLABS_NEW = [[L(400000), 0], [L(800000), 5], [L(1200000), 10], [L(1600000), 15], [L(2000000), 20], [L(2400000), 25], [INF, 30]];
const COMMON = {
  newSlabs: SLABS_NEW,
  oldSlabs: SLABS_OLD,
  standardDeduction: { new: L(75000), old: L(50000) },
  rebate: { new: { upTo: L(1200000), max: L(60000) }, old: { upTo: L(500000), max: L(12500) } },
  // [income above, rate %]; above ₹5 crore the new regime stays at 25%.
  surcharge: [[L(5000000), 10], [L(10000000), 15], [L(20000000), 25], [L(50000000), { new: 25, old: 37 }]],
  cessPct: 4,
  limits: { investments: L(150000), healthSelf: L(25000), healthSelfSenior: L(50000), healthParents: L(25000), healthParentsSenior: L(50000), checkup: L(5000) },
};

export const TAX_YEARS = {
  '2026-27': {
    ...COMMON,
    label: 'Tax year 2026-27 (1 April 2026 to 31 March 2027)',
    law: 'Income-tax Act, 2025',
    sections: {
      investments: 'Section 123 (was 80C)', health: 'Section 126 (was 80D)', rebate: 'Section 156 (was 87A)',
      newRegime: 'Section 202 (was 115BAC)', rentWithoutHra: 'Section 134 (was 80GG)', hra: 'Schedule III, item 11 (was 10(13A))',
      standardDeduction: 'Section 19',
    },
    // HRA: 50% of salary in these cities, 40% elsewhere (Income-tax Rules, 2026, notified 20 March 2026).
    hraFiftyPctCities: ['Delhi', 'Mumbai', 'Kolkata', 'Chennai', 'Bengaluru', 'Hyderabad', 'Pune', 'Ahmedabad'],
    sources: [
      'Income-tax Act, 2025 (Gazette of India, 21 Aug 2025): sections 19, 123, 126, 134, 156, 202, Schedule III',
      'Finance Bill 2026 memorandum (indiabudget.gov.in): rates for tax year 2026-27, surcharge, 4% cess; no change in rates',
      'Budget speech 2026-27: Income-tax Act, 2025 in force from 1 April 2026',
      'Income-tax Rules, 2026 (notified 20 March 2026): HRA 50% cities extended to Bengaluru, Hyderabad, Pune, Ahmedabad',
    ],
  },
  '2025-26': {
    ...COMMON,
    label: 'Financial year 2025-26 (1 April 2025 to 31 March 2026)',
    law: 'Income-tax Act, 1961',
    sections: {
      investments: 'Section 80C', health: 'Section 80D', rebate: 'Section 87A', newRegime: 'Section 115BAC',
      rentWithoutHra: 'Section 80GG', hra: 'Section 10(13A)', standardDeduction: 'Section 16(ia)',
    },
    hraFiftyPctCities: ['Delhi', 'Mumbai', 'Kolkata', 'Chennai'],
    sources: ['Income Tax Department, "Tax slabs for AY 2026-27" (incometax.gov.in)', 'Finance Bill 2026 memorandum: rates for AY 2026-27 unchanged'],
  },
};
export const TAX_YEAR_KEYS = Object.keys(TAX_YEARS);

// "2026-27" for any day from 1 April 2026 to 31 March 2027.
export function fyOf(day) {
  const y = day.getUTCFullYear();
  const start = day.getUTCMonth() >= 3 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}
export function fyRange(fy) {
  const start = Number(fy.slice(0, 4));
  return { from: new Date(Date.UTC(start, 3, 1)), to: new Date(Date.UTC(start + 1, 2, 31)) };
}

export function rulesFor(fy) {
  const r = TAX_YEARS[fy];
  if (!r) throw Object.assign(new Error(`No tax rules for ${fy}`), { code: 'unknown_tax_year' });
  return r;
}

// Progressive tax on the slabs, with the amount taxed in each.
function onSlabs(income, slabs) {
  let tax = 0;
  let floor = 0;
  const parts = [];
  for (const [upTo, rate] of slabs) {
    if (income <= floor) break;
    const inSlab = Math.min(income, upTo) - floor;
    const t = Math.round((inSlab * rate) / 100);
    if (rate) parts.push({ from: floor, to: Math.min(income, upTo), rate, tax: t });
    tax += t;
    floor = upTo;
  }
  return { tax, parts };
}

// Income-tax Act, 2025, section 516 (section 288A/288B before): total income and tax payable are rounded
// to the nearest ₹10, ignoring paise first; a last digit of 5 or more rounds up.
export function roundTen(paise) {
  const rupees = Math.floor(paise / 100);
  const last = rupees % 10;
  return (last >= 5 ? rupees - last + 10 : rupees - last) * 100;
}

function surchargeRate(income, regime, rules) {
  let rate = 0;
  for (const [above, r] of rules.surcharge) if (income > above) rate = typeof r === 'number' ? r : r[regime];
  return rate;
}

// Income tax for a tax year: slab tax, rebate (with marginal relief under the new regime), surcharge
// (with marginal relief at each threshold) and 4% cess. `age`: below60 | senior | superSenior.
export function computeTax({ fy, regime, taxable, age = 'below60' }) {
  const rules = rulesFor(fy);
  const income = roundTen(Math.max(0, Math.round(taxable)));
  const slabs = regime === 'new' ? rules.newSlabs : rules.oldSlabs[age];
  const base = onSlabs(income, slabs);
  const rb = rules.rebate[regime];
  let rebate = 0;
  if (income <= rb.upTo) rebate = Math.min(base.tax, rb.max);
  // New regime just above ₹12 lakh: tax can't exceed the income above ₹12 lakh.
  else if (regime === 'new' && base.tax > income - rb.upTo) rebate = base.tax - (income - rb.upTo);
  const afterRebate = base.tax - rebate;
  const rate = surchargeRate(income, regime, rules);
  let surcharge = Math.round((afterRebate * rate) / 100);
  if (rate) {
    // Marginal relief: tax + surcharge may rise by no more than the income above the threshold.
    const threshold = [...rules.surcharge].reverse().find(([above]) => income > above)[0];
    const atThreshold = onSlabs(threshold, slabs).tax;
    const prevRate = surchargeRate(threshold, regime, rules);
    const cap = atThreshold + Math.round((atThreshold * prevRate) / 100) + (income - threshold);
    surcharge = Math.max(0, Math.min(surcharge, cap - afterRebate));
  }
  const cess = Math.round(((afterRebate + surcharge) * rules.cessPct) / 100);
  const total = roundTen(afterRebate + surcharge + cess);
  return { taxable: income, slabTax: base.tax, slabs: base.parts, rebate, surcharge, cess, total, effectiveRate: income ? Math.round((total * 1000) / income) / 10 : 0 };
}

// HRA exempt under the old regime: the least of HRA received, rent minus 10% of salary (basic + DA),
// and 50% (listed cities) or 40% of salary.
export function hraExemption({ fy, hraReceived, rentPaid, salary, city }) {
  const rules = rulesFor(fy);
  const fifty = rules.hraFiftyPctCities.some((c) => c.toLowerCase() === String(city ?? '').trim().toLowerCase());
  const options = [hraReceived, rentPaid - Math.round(salary / 10), Math.round((salary * (fifty ? 50 : 40)) / 100)];
  return { exempt: Math.max(0, Math.min(...options)), pct: fifty ? 50 : 40, options };
}

// CTC to take-home under both regimes. All amounts yearly, in paise.
//   ctc, basicPct (of CTC), hra (yearly HRA in the salary), pf: 'full' | 'capped' | 'none',
//   gratuityInCtc, professionalTax, rentPaid, city, age, investments (other than EPF), healthSelf, healthParents,
//   selfSenior, parentsSenior
export function salaryBreakdown(input) {
  const { fy, ctc, basicPct = 40, pf = 'capped', gratuityInCtc = false, professionalTax = L(2500), rentPaid = 0, city = '', age = 'below60' } = input;
  const rules = rulesFor(fy);
  const basic = Math.round((ctc * basicPct) / 100);
  const hra = Math.min(input.hra ?? Math.round((basic * (rules.hraFiftyPctCities.some((c) => c.toLowerCase() === city.toLowerCase()) ? 50 : 40)) / 100), ctc);
  // EPF: 12% of basic from both sides; "capped" is the ₹15,000 wage ceiling (₹1,800 a month).
  const pfYear = pf === 'none' ? 0 : pf === 'capped' ? Math.min(Math.round(basic * 0.12), L(21600)) : Math.round(basic * 0.12);
  const gratuity = gratuityInCtc ? Math.round(basic * 0.0481) : 0;
  const gross = ctc - pfYear - gratuity;
  const takeHome = (tax) => Math.round((gross - pfYear - professionalTax - tax) / 12);

  const newTaxable = Math.max(0, gross - rules.standardDeduction.new);
  const newTax = computeTax({ fy, regime: 'new', taxable: newTaxable, age });

  const hraEx = rentPaid ? hraExemption({ fy, hraReceived: hra, rentPaid, salary: basic, city }) : { exempt: 0, pct: null };
  const lim = rules.limits;
  const sec123 = Math.min(lim.investments, pfYear + (input.investments ?? 0));
  const sec126 = Math.min(input.healthSelf ?? 0, input.selfSenior ? lim.healthSelfSenior : lim.healthSelf)
    + Math.min(input.healthParents ?? 0, input.parentsSenior ? lim.healthParentsSenior : lim.healthParents);
  const oldDeductions = { hra: hraEx.exempt, standardDeduction: rules.standardDeduction.old, professionalTax, investments: sec123, health: sec126 };
  const oldTaxable = Math.max(0, gross - Object.values(oldDeductions).reduce((a, b) => a + b, 0));
  const oldTax = computeTax({ fy, regime: 'old', taxable: oldTaxable, age });

  const better = newTax.total <= oldTax.total ? 'new' : 'old';
  return {
    fy,
    salary: { ctc, basic, hra, employerPf: pfYear, gratuity, gross, employeePf: pfYear, professionalTax },
    new: { taxable: newTaxable, deductions: { standardDeduction: rules.standardDeduction.new }, tax: newTax, monthlyTakeHome: takeHome(newTax.total) },
    old: { taxable: oldTaxable, deductions: oldDeductions, hraPct: hraEx.pct, tax: oldTax, monthlyTakeHome: takeHome(oldTax.total) },
    better,
    saving: Math.abs(newTax.total - oldTax.total),
  };
}
