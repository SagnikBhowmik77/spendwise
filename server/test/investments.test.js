// Batch 12H API: holdings, fund search, NAV-priced purchases, SIPs, FD/RD/PPF, maturity reminders and
// the net-worth timeline. AMFI's two files come from a local stand-in answering in AMFI's own layouts.
// Dates are relative to today so the tests keep passing on any day.
import http from 'node:http';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 86_400_000;
const amfiDay = (d) => `${String(d.getUTCDate()).padStart(2, '0')}-${MON[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
const parseAmfi = (s) => { const [dd, mm, yy] = s.split('-'); return new Date(Date.UTC(Number(yy), MON.indexOf(mm), Number(dd))); };
const istToday = () => new Date(`${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())}T00:00:00Z`);
const weekday = (d) => d.getUTCDay() !== 0 && d.getUTCDay() !== 6;
// Made-up NAVs for the stub only: they rise a paisa a day.
const SCHEMES = [
  { code: 122639, name: 'Parag Parikh Flexi Cap Fund', plan: 'Direct Plan', option: 'Growth', isin: 'INF879O01027', base: 50 },
  { code: 122640, name: 'Parag Parikh Flexi Cap Fund', plan: 'Regular Plan', option: 'Growth', isin: 'INF879O01019', base: 47 },
  { code: 118989, name: 'HDFC Mid-Cap Opportunities Fund', plan: 'Direct Plan', option: 'IDCW', isin: 'INF179K01XQ0', base: 120 },
];
const navFor = (s, d) => Math.round((s.base + ((d - Date.UTC(2020, 0, 1)) / DAY_MS) * 0.01) * 10000) / 10000;
// The latest published day: the last weekday before today (today's NAVs aren't out yet).
const latestDay = () => { let d = new Date(istToday() - DAY_MS); while (!weekday(d)) d = new Date(d - DAY_MS); return d; };
let historyCalls = 0;
const stub = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  res.setHeader('content-type', 'text/plain');
  if (u.pathname === '/NAVAll.txt') {
    const d = latestDay();
    const lines = ['Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Plan;Option;Net Asset Value;Date', '', 'PPFAS Mutual Fund', ''];
    for (const s of SCHEMES) lines.push(`${s.code};${s.isin};-;${s.name};${s.plan};${s.option};${navFor(s, d).toFixed(4)};${amfiDay(d)}`);
    return res.end(lines.join('\r\n'));
  }
  historyCalls += 1;
  const d = parseAmfi(u.searchParams.get('frmdt'));
  const lines = ['Scheme Code;NAV Name;Plan;Option;ISIN Div Payout/ISIN Growth;ISIN Div Reinvestment;Net Asset Value;Date', ''];
  if (weekday(d) && d < istToday()) {
    for (const s of SCHEMES) lines.push(`${s.code};${s.name} - ${s.plan} - ${s.option};${s.plan};${s.option};${s.isin};;${navFor(s, d).toFixed(4)};${amfiDay(d)}`);
  }
  return res.end(lines.join('\n'));
});
await new Promise((r) => stub.listen(0, '127.0.0.1', r));
const stubBase = `http://127.0.0.1:${stub.address().port}`;
process.env.AMFI_NAV_URL = `${stubBase}/NAVAll.txt`;
process.env.AMFI_HISTORY_URL = `${stubBase}/history`;

const { test, before, after } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const { startTestServer, uniqueEmail, GOOD_PASSWORD } = await import('./helpers.js');
const { todayIn, addDays } = await import('../src/schedule.js');
const { dayString } = await import('../src/money.js');
const { addMonths, fdValue, unitsFor } = await import('../src/invest.js');
const { sendMaturityReminders, snapshotAll } = await import('../src/services/investment.service.js');
const { Holding, NetWorthSnapshot } = await import('../src/models/index.js');

let t;
const newUser = async () => (await t.api('POST', '/api/auth/register', { body: { name: 'Ira', email: uniqueEmail(), password: GOOD_PASSWORD } })).body.token;
const call = (method, path, body, tk) => t.api(method, path, { token: tk, body });
const now = todayIn('Asia/Kolkata');
const ago = (n) => dayString(addDays(now, -n));
const pp = SCHEMES[0];
// The weekday on or after a day (a purchase on a holiday gets the next business day's NAV).
const nextWeekday = (d) => { let x = d; while (!weekday(x)) x = addDays(x, 1); return x; };

before(async () => { t = await startTestServer(); });
after(async () => { await t.stop(); stub.close(); });

test('fund search: every word must match, Direct Growth first; a scheme code works too', async () => {
  const tk = await newUser();
  const r = await call('GET', '/api/investments/schemes?q=parag%20flexi', undefined, tk);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.schemes.map((s) => s.code), [122639, 122640]);
  assert.equal(r.body.schemes[0].nav, navFor(pp, latestDay()));
  assert.equal(r.body.schemes[0].navDate, dayString(latestDay()));
  assert.deepEqual((await call('GET', '/api/investments/schemes?q=118989', undefined, tk)).body.schemes.map((s) => s.name), ['HDFC Mid-Cap Opportunities Fund']);
  assert.equal((await call('GET', '/api/investments/schemes?q=x', undefined, tk)).status, 400);
});

test('mutual fund: a purchase gets that day’s NAV (the next weekday on a holiday), value at the latest NAV', async () => {
  const tk = await newUser();
  const created = await call('POST', '/api/investments', { kind: 'mf', schemeCode: 122639 }, tk);
  assert.equal(created.status, 201);
  const h = created.body.holding;
  assert.equal(h.name, 'Parag Parikh Flexi Cap Fund - Direct Plan - Growth');
  // A Saturday 3–4 weeks ago.
  let sat = addDays(now, -21);
  while (sat.getUTCDay() !== 6) sat = addDays(sat, -1);
  const r = await call('POST', `/api/investments/${h.id}/trades`, { type: 'buy', date: dayString(sat), amount: '10000' }, tk);
  assert.equal(r.status, 201);
  const monday = addDays(sat, 2);
  const [trade] = r.body.holding.trades;
  assert.equal(trade.date, dayString(monday));
  assert.equal(trade.price, navFor(pp, monday));
  assert.equal(trade.units, unitsFor(1_000_000, navFor(pp, monday)));
  const latest = navFor(pp, latestDay());
  assert.equal(r.body.holding.price.source, 'amfi');
  assert.equal(r.body.holding.value.paise, Math.round(trade.units * latest * 100));
  assert.equal(r.body.holding.invested.paise, 1_000_000);
  assert.equal(r.body.holding.xirr, null); // under 30 days: not annualised
  // A NAV that isn't out yet.
  const tooSoon = await call('POST', `/api/investments/${h.id}/trades`, { date: dayString(now), amount: '500' }, tk);
  assert.equal(tooSoon.status, 409);
  assert.equal(tooSoon.body.error.code, 'nav_not_ready');
  // Or you enter the NAV yourself.
  const own = await call('POST', `/api/investments/${h.id}/trades`, { date: dayString(now), amount: '500', price: 60.5 }, tk);
  assert.equal(own.body.holding.trades[0].units, unitsFor(50_000, 60.5));
});

test('purchases can be recorded as expenses; sales use average cost and can’t exceed units held', async () => {
  const tk = await newUser();
  const acc = (await call('POST', '/api/accounts', { name: 'HDFC', type: 'bank', openingBalance: '100000' }, tk)).body.account;
  const h = (await call('POST', '/api/investments', { kind: 'stock', name: 'Infosys', manualPrice: 1500 }, tk)).body.holding;
  // Stocks need a price (or both units and amount).
  assert.equal((await call('POST', `/api/investments/${h.id}/trades`, { date: ago(100), units: 10 }, tk)).status, 400);
  let r = await call('POST', `/api/investments/${h.id}/trades`, { date: ago(100), units: 10, price: 1200, account: acc.id }, tk);
  assert.equal(r.status, 201);
  const txId = r.body.holding.trades[0].transactionId;
  assert.ok(txId);
  const tx = (await call('GET', `/api/transactions/${txId}`, undefined, tk)).body.transaction;
  assert.deepEqual([tx.type, tx.category, tx.amountPaise], ['expense', 'Investments', 1_200_000]);
  r = await call('POST', `/api/investments/${h.id}/trades`, { date: ago(50), units: 10, amount: '14000' }, tk);
  assert.equal(r.body.holding.trades[0].price, 1400);
  assert.equal(r.body.holding.invested.paise, 2_600_000);
  assert.equal((await call('POST', `/api/investments/${h.id}/trades`, { type: 'sell', date: ago(10), units: 25, price: 1500 }, tk)).status, 400);
  r = await call('POST', `/api/investments/${h.id}/trades`, { type: 'sell', date: ago(10), units: 5, price: 1500 }, tk);
  const s = r.body.holding;
  assert.equal(s.units, 15);
  assert.equal(s.invested.paise, 2_600_000 - 650_000); // average cost ₹1,300 a share
  assert.equal(s.realised.paise, 750_000 - 650_000);
  // The price entered today (₹1,500) is newer than the sale, so it values the shares.
  assert.deepEqual([s.price.source, s.value.paise], ['manual', 15 * 150_000]);
  assert.ok(s.xirr > 0);
  // Removing the first purchase also removes its expense entry.
  const first = s.trades.find((x) => x.transactionId);
  r = await call('DELETE', `/api/investments/${h.id}/trades/${first.id}`, undefined, tk);
  assert.equal(r.status, 200);
  assert.equal((await call('GET', `/api/transactions/${txId}`, undefined, tk)).status, 404);
  // Without the second purchase too, the sale would be more than was held.
  const second = r.body.holding.trades.find((x) => x.type === 'buy');
  assert.equal((await call('DELETE', `/api/investments/${h.id}/trades/${second.id}`, undefined, tk)).status, 409);
  // A new price updates the value.
  r = await call('PATCH', `/api/investments/${h.id}`, { manualPrice: 1600 }, tk);
  assert.deepEqual([r.body.holding.price.source, r.body.holding.value.paise], ['manual', 5 * 160_000]);
  const fund = (await call('POST', '/api/investments', { kind: 'mf', schemeCode: 118989 }, tk)).body.holding;
  assert.equal((await call('PATCH', `/api/investments/${fund.id}`, { manualPrice: 10 }, tk)).status, 400);
});

test('SIP: due instalments are bought at each date’s NAV; today waits for AMFI', async () => {
  const tk = await newUser();
  const acc = (await call('POST', '/api/accounts', { name: 'SBI', type: 'bank' }, tk)).body.account;
  const h = (await call('POST', '/api/investments', { kind: 'mf', schemeCode: 122639 }, tk)).body.holding;
  const start = addMonths(now, -2);
  const r = await call('PUT', `/api/investments/${h.id}/sip`, { amount: '5000', startDate: dayString(start), account: acc.id }, tk);
  assert.equal(r.status, 200);
  const got = r.body.holding;
  assert.equal(got.sip.count, 2);
  assert.equal(got.sip.pending, 1); // today's instalment
  assert.equal(got.sip.nextDate, dayString(addMonths(start, 2)));
  const buys = [...got.trades].reverse();
  assert.deepEqual(buys.map((x) => x.date), [0, 1].map((i) => dayString(nextWeekday(addMonths(start, i)))));
  assert.ok(buys.every((x) => x.sip && x.amount.paise === 500_000 && x.price === navFor(pp, new Date(`${x.date}T00:00:00Z`))));
  // Instalments before today were paid before Spendwise knew: no expense entries for them.
  assert.ok(buys.every((x) => x.transactionId === null));
  const list = (await call('GET', '/api/investments', undefined, tk)).body;
  assert.equal(list.summary.sipMonthly.paise, 500_000);
  // Starting again before the last SIP purchase would buy instalments twice.
  assert.equal((await call('PUT', `/api/investments/${h.id}/sip`, { amount: '5000', startDate: dayString(addMonths(start, 1)) }, tk)).status, 400);
  const stopped = (await call('DELETE', `/api/investments/${h.id}/sip`, undefined, tk)).body.holding;
  assert.deepEqual([stopped.sip.active, stopped.sip.nextDate, stopped.sip.pending], [false, null, 0]);
});

test('SIP catch-up: many past instalments are bought in the background', async () => {
  const tk = await newUser();
  const h = (await call('POST', '/api/investments', { kind: 'mf', schemeCode: 122640 }, tk)).body.holding;
  // Starting a day after "8 months ago" makes exactly 8 instalments due on any date: the 9th is always tomorrow.
  // (Plain "8 months ago" gave 9 near month ends, when February clamps the start to the 28th.)
  const r = await call('PUT', `/api/investments/${h.id}/sip`, { amount: '2000', startDate: dayString(addDays(addMonths(now, -8), 1)) }, tk);
  assert.equal(r.status, 200);
  let holding = r.body.holding;
  for (let i = 0; i < 100 && holding.sip.count < 8; i += 1) {
    await new Promise((res) => setTimeout(res, 100));
    holding = (await call('GET', `/api/investments/${h.id}`, undefined, tk)).body.holding;
  }
  assert.equal(holding.sip.count, 8);
  assert.equal(holding.trades.length, 8);
  assert.equal(holding.invested.paise, 8 * 200_000);
  assert.ok(holding.xirr !== null);
});

test('fixed and recurring deposits: value to date, maturity value and a reminder a week before', async () => {
  const tk = await newUser();
  const start = addMonths(now, -12);
  const fd = (await call('POST', '/api/investments', { kind: 'fd', name: 'SBI FD', principal: '100000', ratePct: 7, startDate: dayString(start), tenureMonths: 12 }, tk)).body.holding;
  assert.equal(fd.maturityValue.paise, fdValue({ principalPaise: 10_000_000, ratePct: 7, startDate: start, tenureMonths: 12 }).value);
  assert.equal(fd.maturityDate, dayString(addMonths(start, 12)));
  assert.equal(fd.matured, fd.daysToMaturity <= 0);
  const soonStart = addDays(addMonths(now, -6), 3);
  const rd = (await call('POST', '/api/investments', { kind: 'rd', name: 'HDFC RD', monthly: '2000', ratePct: 6.5, startDate: dayString(soonStart), tenureMonths: 6 }, tk)).body.holding;
  assert.equal(rd.daysToMaturity, Math.round((addMonths(soonStart, 6) - now) / DAY_MS));
  assert.equal(rd.invested.paise, 6 * 200_000 - (addMonths(soonStart, 5) > now ? 200_000 : 0));
  assert.ok(rd.value.paise >= rd.invested.paise && rd.maturityValue.paise > 6 * 200_000);
  assert.equal((await call('POST', '/api/investments', { kind: 'fd', name: 'No amount', ratePct: 7, startDate: ago(1), tenureMonths: 12 }, tk)).status, 400);
  const list = (await call('GET', '/api/investments', undefined, tk)).body;
  assert.deepEqual(list.summary.maturing.map((m) => m.name), ['SBI FD', 'HDFC RD']);
  assert.deepEqual(list.summary.allocation.map((a) => a.kind), ['fd', 'rd']);
  assert.equal(list.summary.value.paise, fd.value.paise + rd.value.paise);
  // Reminders: each maturity once (push and email are off in tests, so only the claim is recorded).
  assert.equal((await sendMaturityReminders({ today: now })).sent, 2);
  assert.equal((await sendMaturityReminders({ today: now })).sent, 0);
  assert.equal((await Holding.findById(fd.id).lean()).remindedFor, fd.maturityDate);
  // A new term means a new reminder.
  await call('PATCH', `/api/investments/${fd.id}`, { tenureMonths: 13 }, tk);
  assert.equal((await Holding.findById(fd.id).lean()).remindedFor, null);
});

test('PPF: deposits up to ₹1.5 lakh a financial year, interest credited each March', async () => {
  const tk = await newUser();
  const ppf = (await call('POST', '/api/investments', { kind: 'ppf', name: 'PPF at SBI', ratePct: 7.1 }, tk)).body.holding;
  const fyStartYear = now.getUTCMonth() >= 3 ? now.getUTCFullYear() - 1 : now.getUTCFullYear() - 2; // last financial year
  let r = await call('POST', `/api/investments/${ppf.id}/deposits`, { amount: '150000', date: `${fyStartYear}-04-03` }, tk);
  assert.equal(r.status, 201);
  assert.equal(r.body.holding.interestCredited.paise, 1_065_000);
  assert.equal(r.body.holding.maturityDate, `${fyStartYear + 16}-04-01`);
  r = await call('POST', `/api/investments/${ppf.id}/deposits`, { amount: '1', date: `${fyStartYear}-12-01` }, tk);
  assert.equal(r.status, 400);
  assert.match(r.body.error.details[0].message, /₹0\.00 is left/);
  assert.equal((await call('POST', `/api/investments/${ppf.id}/deposits`, { direction: 'withdraw', amount: '200000', date: dayString(now) }, tk)).status, 400);
  assert.equal((await call('POST', `/api/investments/${ppf.id}/trades`, { date: ago(1), units: 1, price: 1 }, tk)).status, 409);
});

test('net-worth timeline: accounts from entries + investments − loans, and a stored snapshot for this month', async () => {
  const tk = await newUser();
  const acc = (await call('POST', '/api/accounts', { name: 'Axis', type: 'bank', openingBalance: '20000' }, tk)).body.account;
  const monthsAgo = (n) => dayString(addMonths(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), -n));
  await call('POST', '/api/transactions', { type: 'income', amount: '50000', category: 'Salary', account: acc.id, date: monthsAgo(2) }, tk);
  await call('POST', '/api/transactions', { type: 'expense', amount: '10000', category: 'Rent', account: acc.id, date: monthsAgo(1) }, tk);
  await call('POST', '/api/investments', { kind: 'fd', name: 'FD', principal: '30000', ratePct: 7, startDate: monthsAgo(1), tenureMonths: 24 }, tk);
  assert.equal((await call('POST', '/api/loans', { name: 'Bike', principal: '60000', annualRatePct: 10, tenureMonths: 12, firstEmiDate: dayString(addDays(now, 5)) }, tk)).status, 201);
  const r = await call('GET', '/api/investments/timeline?months=4', undefined, tk);
  assert.equal(r.status, 200);
  const [m3, m2, m1, m0] = r.body.months;
  // The Cash account is 0; Axis opened with ₹20,000.
  assert.equal(m3.accounts.paise, 2_000_000);
  assert.equal(m2.accounts.paise, 7_000_000);
  assert.equal(m1.accounts.paise, 6_000_000);
  assert.equal(m2.investments.paise, 0);
  assert.ok(m1.investments.paise > 3_000_000);
  assert.equal(m1.source, 'worked-out');
  assert.equal(m0.source, 'live');
  assert.equal(m0.loans.paise, 6_000_000);
  assert.equal(m0.netWorth.paise, m0.accounts.paise + m0.investments.paise - 6_000_000);
  await snapshotAll({ today: now });
  const holding = await Holding.findOne({ name: 'FD', principalPaise: 3_000_000 }).sort({ createdAt: -1 }).lean();
  const snap = await NetWorthSnapshot.findOne({ space: holding.space, month: dayString(now).slice(0, 7) }).lean();
  assert.equal(snap.valuePaise, m0.investments.paise);
});

test('investments are private to the space and removed with the account', async () => {
  const a = await newUser();
  const b = await newUser();
  const h = (await call('POST', '/api/investments', { kind: 'gold', name: 'Sovereign Gold Bond', manualPrice: 7000 }, a)).body.holding;
  assert.equal((await call('GET', `/api/investments/${h.id}`, undefined, b)).status, 404);
  assert.equal((await call('DELETE', '/api/auth/me', { password: GOOD_PASSWORD }, a)).status, 204);
  assert.equal(await Holding.countDocuments({ _id: h.id }), 0);
  assert.ok(historyCalls > 0);
});
