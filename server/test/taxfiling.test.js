// Batch 12M: capital gains (lot by lot, holding periods, Specified Mutual Funds, the 2018 rule, set-off and the
// ₹1.25 lakh exemption), EPF, interest and TDS, and rent receipts. AMFI's files come from a local stand-in that
// has category headings and answers the history report for any weekday, 31 January 2018 included.
import http from 'node:http';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const amfiDay = (d) => `${String(d.getUTCDate()).padStart(2, '0')}-${MON[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
const parseAmfi = (s) => { const [dd, mm, yy] = s.split('-'); return new Date(Date.UTC(Number(yy), MON.indexOf(mm), Number(dd))); };
const weekday = (d) => d.getUTCDay() !== 0 && d.getUTCDay() !== 6;
// Made-up NAVs for the stand-in: a fixed price per scheme.
const SCHEMES = [
  { code: 122639, name: 'Parag Parikh Flexi Cap Fund', plan: 'Direct Plan', option: 'Growth', category: 'Equity Scheme - Flexi Cap Fund', nav: 150 },
  { code: 119800, name: 'Example Liquid Fund', plan: 'Direct Plan', option: 'Growth', category: 'Debt Scheme - Liquid Fund', nav: 12 },
  { code: 120000, name: 'Example Balanced Advantage Fund', plan: 'Direct Plan', option: 'Growth', category: 'Hybrid Scheme - Dynamic Asset Allocation or Balanced Advantage', nav: 40 },
];
const stub = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  res.setHeader('content-type', 'text/plain');
  if (u.pathname === '/NAVAll.txt') {
    const lines = ['Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Plan;Option;Net Asset Value;Date', ''];
    for (const s of SCHEMES) lines.push(`Open Ended Schemes(${s.category})`, '', 'Some Mutual Fund', '', `${s.code};INF000;-;${s.name};${s.plan};${s.option};${s.nav.toFixed(4)};${amfiDay(new Date(Date.UTC(2026, 9, 23)))}`, '');
    return res.end(lines.join('\r\n'));
  }
  const d = parseAmfi(u.searchParams.get('frmdt'));
  const lines = ['Scheme Code;NAV Name;Plan;Option;ISIN Div Payout/ISIN Growth;ISIN Div Reinvestment;Net Asset Value;Date', ''];
  // On 31 January 2018 the flexi-cap fund's NAV was 130 in this stand-in.
  if (weekday(d)) for (const s of SCHEMES) lines.push(`${s.code};${s.name};${s.plan};${s.option};INF000;;${(+d === Date.UTC(2018, 0, 31) && s.code === 122639 ? 130 : s.nav).toFixed(4)};${amfiDay(d)}`);
  return res.end(lines.join('\n'));
});
await new Promise((r) => stub.listen(0, '127.0.0.1', r));
process.env.AMFI_NAV_URL = `http://127.0.0.1:${stub.address().port}/NAVAll.txt`;
process.env.AMFI_HISTORY_URL = `http://127.0.0.1:${stub.address().port}/history`;

const { test, before, after } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const { startTestServer, uniqueEmail, GOOD_PASSWORD } = await import('./helpers.js');
const { salesOf, yearTotals, classFromCategory } = await import('../src/capitalGains.js');
const { epfValue, fdValue } = await import('../src/invest.js');
const { rupeesInWords } = await import('../src/services/taxRecords.service.js');

const D = (s) => new Date(`${s}T00:00:00Z`);
const buy = (date, units, rupees) => ({ type: 'buy', date: D(date), units, amountPaise: rupees * 100 });
const sell = (date, units, rupees) => ({ type: 'sell', date: D(date), units, amountPaise: rupees * 100 });
const FY2526 = { from: D('2025-04-01'), to: D('2026-03-31') };

let t;
const newUser = async () => (await t.api('POST', '/api/auth/register', { body: { name: 'Ira Rao', email: uniqueEmail(), password: GOOD_PASSWORD } })).body.token;
const call = (method, path, body, tk) => t.api(method, path, { token: tk, body });
before(async () => { t = await startTestServer(); });
after(async () => { await t.stop(); stub.close(); });

test('lots are sold oldest first, and a lot is long-term only once held for more than 12 months', () => {
  const h = { id: 'h', name: 'Infosys', kind: 'stock', taxClass: 'equity', trades: [buy('2024-05-10', 100, 100000), buy('2025-06-01', 100, 120000), sell('2025-07-01', 150, 210000)] };
  const [s] = salesOf(h, FY2526);
  assert.deepEqual(s.lots.map((l) => [l.units, l.cost, l.proceeds, l.gain, l.bucket]), [
    [100, 10_000_000, 14_000_000, 4_000_000, 'ltcgEquity'],
    [50, 6_000_000, 7_000_000, 1_000_000, 'stcgEquity'],
  ]);
  const totals = yearTotals([s], { fy: '2025-26' });
  // ₹40,000 long-term is inside the ₹1.25 lakh exemption; ₹10,000 short-term at 20%, plus 4% cess.
  assert.deepEqual([totals.exemptionUsed, totals.taxable.ltcgEquity, totals.tax.stcgEquity, totals.cess, totals.total], [4_000_000, 0, 200_000, 8_000, 208_000]);
  const exactlyAYear = salesOf({ ...h, trades: [buy('2024-05-10', 10, 1000), sell('2025-05-10', 10, 1500)] }, FY2526)[0].lots[0];
  const aDayMore = salesOf({ ...h, trades: [buy('2024-05-10', 10, 1000), sell('2025-05-11', 10, 1500)] }, FY2526)[0].lots[0];
  assert.deepEqual([exactlyAYear.bucket, aDayMore.bucket], ['stcgEquity', 'ltcgEquity']);
});

test('debt funds bought from April 2023 are always short-term; older ones turn long-term after 24 months', () => {
  const fund = (trades) => salesOf({ id: 'd', name: 'Liquid', kind: 'mf', taxClass: 'debt', trades }, FY2526)[0].lots[0];
  assert.equal(fund([buy('2023-05-01', 100, 1000), sell('2025-09-01', 100, 1200)]).bucket, 'stcgSlab');
  assert.equal(fund([buy('2022-05-01', 100, 1000), sell('2025-06-01', 100, 1200)]).bucket, 'ltcgOther');
  // A sale before the year isn't in it.
  assert.equal(salesOf({ id: 'd', taxClass: 'debt', trades: [buy('2023-03-01', 100, 1000), sell('2025-03-31', 100, 1200)] }, FY2526).length, 0);
  const gold = salesOf({ id: 'g', name: 'Gold coin', kind: 'gold', taxClass: 'other', trades: [buy('2024-01-01', 10, 60000), sell('2025-12-01', 10, 80000)] }, FY2526)[0].lots[0];
  assert.equal(gold.bucket, 'stcgSlab'); // 23 months: short-term for gold
  const totals = yearTotals([{ lots: [{ bucket: 'stcgSlab', gain: 2_000_000 }] }], { fy: '2025-26', slabPct: 30 });
  assert.equal(totals.tax.stcgSlab, 600_000);
});

test('equity bought before February 2018 uses the 31 January 2018 value; losses are set off as the law allows', () => {
  const old = { id: 'o', name: 'Old shares', kind: 'stock', taxClass: 'equity', trades: [buy('2017-06-01', 1000, 100000), sell('2025-08-01', 1000, 200000)] };
  const lot = salesOf({ ...old, fmv2018: 150 }, FY2526)[0].lots[0];
  assert.deepEqual([lot.cost, lot.gain, lot.grandfathered], [15_000_000, 5_000_000, true]);
  assert.equal(salesOf(old, FY2526)[0].lots[0].needsFmv, true);
  // A short-term loss of ₹30,000 goes against other long-term gains first, then equity; then the exemption.
  const totals = yearTotals([{ lots: [
    { bucket: 'stcgEquity', gain: -3_000_000 }, { bucket: 'ltcgOther', gain: 1_000_000 }, { bucket: 'ltcgEquity', gain: 20_000_000 },
  ] }], { fy: '2026-27' });
  assert.deepEqual([totals.net.ltcgOther, totals.net.ltcgEquity, totals.taxable.ltcgEquity, totals.tax.ltcgEquity], [0, 18_000_000, 5_500_000, 687_500]);
  // A long-term loss can't touch short-term gains, and what's left is carried forward.
  const lt = yearTotals([{ lots: [{ bucket: 'ltcgEquity', gain: -500_000 }, { bucket: 'stcgEquity', gain: 1_000_000 }] }], { fy: '2026-27' });
  assert.deepEqual([lt.net.stcgEquity, lt.carryForward.longTerm], [1_000_000, 500_000]);
});

test('AMFI categories give each fund its default tax class', () => {
  assert.equal(classFromCategory('Equity Scheme - Large Cap Fund'), 'equity');
  assert.equal(classFromCategory('Hybrid Scheme - Arbitrage Fund'), 'equity');
  assert.equal(classFromCategory('Income/Debt Oriented Schemes - Liquid Fund'), 'debt');
  assert.equal(classFromCategory('Exchange Traded Funds (ETFs) - Gold ETF'), 'listed');
  assert.equal(classFromCategory('Hybrid Scheme - Multi Asset Allocation'), null);
});

test('EPF: passbook balance plus contributions, with interest at EPFO’s rate on each month’s opening balance', () => {
  const v = epfValue({
    passbook: [{ date: D('2025-03-31'), balancePaise: 10_000_000 }],
    deposits: [{ date: D('2025-04-15'), amountPaise: 500_000 }, { date: D('2025-05-15'), amountPaise: 500_000 }],
    on: D('2025-06-30'),
  });
  // 8.25% a year: ₹1,00,000 in April, ₹1,05,000 in May, ₹1,10,000 in June.
  assert.deepEqual([v.balance, v.accrued, v.rate, v.declared, v.invested], [11_000_000, 216_563, 8.25, true, 11_000_000]);
  const later = epfValue({ passbook: [{ date: D('2025-03-31'), balancePaise: 10_000_000 }], deposits: [], on: D('2026-04-30') });
  assert.equal(later.interestEstimated, 825_000 + Math.round((10_825_000 * 8.25) / 1200));
  assert.equal(later.declared, false); // 2026-27's rate isn't declared yet
});

test('capital gains report from recorded sales, with default classes, the 2018 NAV from AMFI and warnings', async () => {
  const tk = await newUser();
  const add = async (body) => (await call('POST', '/api/investments', body, tk)).body.holding;
  const trade = (id, body) => call('POST', `/api/investments/${id}/trades`, body, tk);
  const infy = await add({ kind: 'stock', name: 'Infosys' });
  for (const b of [{ type: 'buy', date: '2024-05-10', units: 100, price: 1000 }, { type: 'buy', date: '2025-06-01', units: 100, price: 1200 }, { type: 'sell', date: '2025-07-01', units: 150, price: 1400 }]) {
    assert.equal((await trade(infy.id, b)).status, 201);
  }
  const flexi = await add({ kind: 'mf', schemeCode: 122639 });
  assert.equal(flexi.defaultTaxClass, 'equity');
  await trade(flexi.id, { type: 'buy', date: '2017-06-01', units: 1000, price: 100 });
  await trade(flexi.id, { type: 'sell', date: '2025-08-01', units: 1000, price: 200 });
  const liquid = await add({ kind: 'mf', schemeCode: 119800 });
  assert.equal(liquid.defaultTaxClass, 'debt');
  await trade(liquid.id, { type: 'buy', date: '2024-01-10', units: 1000, price: 10 });
  await trade(liquid.id, { type: 'sell', date: '2025-09-01', units: 1000, price: 11 });
  const baf = await add({ kind: 'mf', schemeCode: 120000 });
  assert.equal(baf.defaultTaxClass, null);
  await trade(baf.id, { type: 'buy', date: '2025-04-10', units: 10, price: 40 });
  await trade(baf.id, { type: 'sell', date: '2025-10-10', units: 10, price: 45 });

  const r = await call('GET', '/api/tax/capital-gains?fy=2025-26&slabPct=30', undefined, tk);
  assert.equal(r.status, 200);
  assert.equal(r.body.sections.stcgEquity, 'Section 111A');
  const g = r.body.totals.gross;
  // Infosys ₹40,000 long + flexi-cap ₹70,000 long (cost ₹1,30,000 from the 31 Jan 2018 NAV) = ₹1,10,000 equity long-term.
  assert.deepEqual([g.ltcgEquity.paise, g.stcgEquity.paise, g.stcgSlab.paise], [11_000_000, 1_000_000, 100_000]);
  const flexiSale = r.body.sales.find((s) => s.holdingId === flexi.id);
  assert.deepEqual([flexiSale.fmv2018, flexiSale.fmvSource, flexiSale.lots[0].grandfathered], [130, 'amfi', true]);
  assert.equal(r.body.totals.tax.stcgSlab.paise, 30_000);
  assert.deepEqual(r.body.warnings.needsClass.map((w) => w.name), [baf.name]);

  // Choosing the class for the balanced-advantage fund puts it in the report.
  assert.equal((await call('PATCH', `/api/investments/${baf.id}`, { taxClass: 'equity' }, tk)).status, 200);
  const again = (await call('GET', '/api/tax/capital-gains?fy=2025-26', undefined, tk)).body;
  assert.equal(again.totals.gross.stcgEquity.paise, 1_005_000);
  assert.equal(again.warnings.needsClass.length, 0);
  assert.equal(again.totals.tax.stcgSlab, null);

  assert.equal((await call('GET', '/api/tax/capital-gains?fy=2026-27', undefined, tk)).body.sales.length, 0);
  assert.equal((await call('GET', '/api/tax/capital-gains?fy=2025-26&slabPct=7', undefined, tk)).status, 400);
  assert.equal((await call('GET', '/api/tax/capital-gains?fy=2024-25', undefined, tk)).status, 400);
  const nps = await add({ kind: 'nps', name: 'NPS Tier I', manualPrice: 45 });
  assert.equal((await call('PATCH', `/api/investments/${nps.id}`, { taxClass: 'equity' }, tk)).status, 400);
});

test('EPF holdings: passbook balances, contributions and the estimate from the API', async () => {
  const tk = await newUser();
  const epf = (await call('POST', '/api/investments', { kind: 'epf', name: 'EPF (Acme Ltd)' }, tk)).body.holding;
  assert.equal((await call('POST', `/api/investments/${epf.id}/passbook`, { balance: '100000', date: '2025-03-31' }, tk)).status, 201);
  const h = (await call('POST', `/api/investments/${epf.id}/deposits`, { amount: '5000', date: '2025-04-15' }, tk)).body.holding;
  assert.deepEqual([h.lastPassbook.balance.paise, h.epfRate.pct, h.deposits.length], [10_000_000, 8.25, 1]);
  assert.ok(h.value.paise > 10_500_000);
  assert.equal((await call('POST', `/api/investments/${epf.id}/passbook`, { balance: '1', date: '2025-03-31' }, tk)).status, 400);
  const stock = (await call('POST', '/api/investments', { kind: 'stock', name: 'TCS' }, tk)).body.holding;
  assert.equal((await call('POST', `/api/investments/${stock.id}/passbook`, { balance: '1', date: '2025-03-31' }, tk)).status, 409);
});

test('interest and TDS: Interest entries, cumulative FDs as they accrue, and the TDS register', async () => {
  const tk = await newUser();
  const income = (body) => call('POST', '/api/transactions', { type: 'income', category: 'Interest', date: '2025-09-30', ...body }, tk);
  assert.equal((await income({ amount: '5000', tds: '500', note: 'Savings interest' })).status, 201);
  assert.equal((await income({ amount: '100', tds: '200' })).status, 400);
  await call('POST', '/api/investments', { kind: 'fd', name: 'SBI FD', principal: '100000', ratePct: 7, startDate: '2025-04-01', tenureMonths: 12 }, tk);
  await call('POST', '/api/investments', { kind: 'fd', name: 'Payout FD', principal: '100000', ratePct: 7, startDate: '2025-04-01', tenureMonths: 12, compounding: 'simple' }, tk);
  assert.equal((await call('POST', '/api/tax/tds', { date: '2026-03-31', deductor: 'SBI', kind: 'interest', income: '7000', tds: '700' }, tk)).status, 201);
  assert.equal((await call('POST', '/api/tax/tds', { date: '2026-03-31', deductor: 'SBI', kind: 'interest', income: '100', tds: '700' }, tk)).status, 400);

  const r = (await call('GET', '/api/tax/interest?fy=2025-26', undefined, tk)).body;
  assert.equal(r.interest.entriesTotal.paise, 500_000);
  assert.deepEqual(r.interest.deposits.map((d) => d.name), ['SBI FD']);
  // What the FD grew by from 1 April 2025 to 31 March 2026 (it matures on 1 April).
  const expected = fdValue({ principalPaise: 10_000_000, ratePct: 7, startDate: D('2025-04-01'), tenureMonths: 12, on: D('2026-03-31') }).value - 10_000_000;
  assert.equal(r.interest.deposits[0].interest.paise, expected);
  assert.deepEqual([r.tds.total.paise, r.tds.byKind.interest.paise, r.tds.fromEntries.length, r.tds.records.length], [120_000, 120_000, 1, 1]);
});

test('rent receipts: a month each from real rent payments; the landlord’s PAN is needed over ₹1 lakh a year', async () => {
  const tk = await newUser();
  assert.equal((await call('PUT', '/api/tax/rent-profile', { tenantName: 'Ira Rao', landlordName: 'S. Kumar', landlordPan: 'ABC123', propertyAddress: 'Flat 4B, MG Road, Pune' }, tk)).status, 400);
  assert.equal((await call('PUT', '/api/tax/rent-profile', { tenantName: 'Ira Rao', landlordName: 'S. Kumar', propertyAddress: 'Flat 4B, MG Road, Pune' }, tk)).status, 200);
  for (let m = 0; m < 12; m += 1) {
    const d = new Date(Date.UTC(2025, 3 + m, 5)).toISOString().slice(0, 10);
    const r = await call('POST', '/api/transactions', { type: 'expense', category: 'Rent', amount: '10000', date: d, paymentMethod: m === 0 ? 'cash' : 'upi' }, tk);
    assert.equal(r.status, 201);
  }
  const preview = (await call('GET', '/api/tax/rent-receipts?fy=2025-26', undefined, tk)).body;
  assert.deepEqual([preview.months.length, preview.total.paise, preview.panRequired, preview.ready], [12, 12_000_000, true, false]);
  const download = (tok) => fetch(`${t.base}/api/tax/rent-receipts.pdf?fy=2025-26`, { headers: { authorization: `Bearer ${tok}` } });
  const refused = await download(tk);
  assert.equal(refused.status, 400);
  assert.equal((await refused.json()).error.code, 'pan_required');
  await call('PUT', '/api/tax/rent-profile', { tenantName: 'Ira Rao', landlordName: 'S. Kumar', landlordPan: 'abcde1234f', propertyAddress: 'Flat 4B, MG Road, Pune' }, tk);
  assert.equal((await call('GET', '/api/tax/rent-profile', undefined, tk)).body.profile.landlordPan, 'ABCDE1234F');
  const res = await download(tk);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  const pdf = Buffer.from(await res.arrayBuffer()).toString('latin1');
  assert.ok(pdf.startsWith('%PDF-'));
  assert.equal(pdf.match(/\/Type \/Page\b/g).length, 6);
  // Text is hex-encoded in the page stream (and split where letters are kerned, so digits are checked).
  assert.ok(pdf.includes(Buffer.from('10,000.00').toString('hex')));
  assert.ok(pdf.includes(Buffer.from('1234').toString('hex')));
  // Someone with no rent entries gets nothing.
  const other = await newUser();
  await call('PUT', '/api/tax/rent-profile', { tenantName: 'B', landlordName: 'C', propertyAddress: 'Somewhere 1' }, other);
  assert.equal((await download(other)).status, 404);
});

test('rupees in words, the Indian way', () => {
  assert.equal(rupeesInWords(125000), 'one lakh twenty-five thousand');
  assert.equal(rupeesInWords(10000), 'ten thousand');
  assert.equal(rupeesInWords(21534567), 'two crore fifteen lakh thirty-four thousand five hundred sixty-seven');
});
