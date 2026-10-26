// Batch 12H: holdings and what they're worth, SIPs bought at AMFI's NAVs, maturity reminders,
// and the net-worth timeline (accounts + investments − loans, month by month).
import mongoose from 'mongoose';
import { HttpError } from '../errors.js';
import { config } from '../config.js';
import { Account, Holding, Loan, MARKET_KINDS, NavHistory, NetWorthSnapshot, Space, Transaction } from '../models/index.js';
import { addMonths, epfValue, fdValue, ppfValue, rdValue, unitsFor, xirr } from '../invest.js';
import { classFromCategory } from '../capitalGains.js';
import { loanState } from '../finance.js';
import { currentMonth, dayString, formatPaise, monthRange, shiftMonth } from '../money.js';
import { todayIn } from '../schedule.js';
import { create as createTx, remove as removeTx } from './transaction.service.js';
import { notifySpace } from './alert.service.js';
import { AMFI_SOURCE, latestNavs, navOn, scheme as findScheme } from './nav.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;
// FD, RD and PPF maturity reminders go out this many days before.
export const MATURITY_REMIND_DAYS = 7;
// PPF accepts at most ₹1.5 lakh in a financial year.
export const PPF_YEAR_LIMIT_PAISE = 15_000_000;
// Returns over less than this aren't annualised: a week's move turned into a yearly rate misleads.
const XIRR_MIN_DAYS = 30;
export const KIND_LABEL = { mf: 'Mutual funds', stock: 'Stocks', gold: 'Gold', fd: 'Fixed deposits', rd: 'Recurring deposits', ppf: 'PPF', epf: 'EPF', nps: 'NPS', other: 'Other' };
// How a holding's sales are taxed when you haven't chosen: from the fund's AMFI category, or by kind.
// NPS, EPF, PPF and deposits aren't capital assets sold on the market, so they have none.
export function defaultTaxClass(kind, category) {
  if (kind === 'mf') return classFromCategory(category ?? '');
  if (kind === 'stock') return 'equity';
  if (kind === 'gold') return 'other';
  return null;
}
const NOT_FOUND = () => new HttpError(404, 'holding_not_found', 'Investment not found');
const money = (paise) => ({ paise, rupees: paise / 100 });
const fieldError = (field, message) => new HttpError(400, 'validation_failed', 'Some fields are missing or invalid', [{ field, message }]);
const round4 = (n) => Math.round(n * 10000) / 10000;
const round2 = (n) => Math.round(n * 100) / 100;
const isMarket = (h) => MARKET_KINDS.includes(h.kind);
const shortDay = (d) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d);
const daysBetween = (a, b) => Math.round((b - a) / DAY_MS);
const fyStart = (d) => new Date(Date.UTC(d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1, 3, 1));
const NO_PRICES = { navLatest: new Map(), navHistory: new Map() };
// Holdings whose SIP instalments are being bought right now.
const sipRuns = new Set();

// Units and the cost of the units still held (average cost), up to a day. A sale takes out its share of the cost.
function position(h, on) {
  let units = 0;
  let cost = 0;
  let realised = 0;
  let lastPrice = null;
  const flows = [];
  for (const t of [...h.trades].filter((x) => x.date <= on).sort((a, b) => a.date - b.date)) {
    if (t.type === 'buy') {
      units = round4(units + t.units);
      cost += t.amountPaise;
      flows.push({ date: t.date, amount: -t.amountPaise });
    } else {
      const soldCost = units > 0 ? Math.round(cost * Math.min(1, t.units / units)) : 0;
      realised += t.amountPaise - soldCost;
      cost -= soldCost;
      units = Math.max(0, round4(units - t.units));
      flows.push({ date: t.date, amount: t.amountPaise });
    }
    lastPrice = { value: t.price, date: t.date, source: 'trade' };
  }
  return { units, cost, realised, flows, lastPrice };
}

// The first sale that takes out more units than were held at the time, if any.
function oversold(trades) {
  let units = 0;
  for (const t of [...trades].sort((a, b) => a.date - b.date || (a.type === 'buy' ? -1 : 1))) {
    units = round4(units + (t.type === 'buy' ? t.units : -t.units));
    if (units < 0) return t;
  }
  return null;
}

// The newest price known on a day: AMFI's NAV (latest, or from the stored history), the price you
// entered, or the last trade's price.
function priceOf(h, on, pos, prices) {
  let best = pos.lastPrice;
  const consider = (p) => { if (p && p.date <= on && (!best || p.date >= best.date)) best = p; };
  if (h.kind === 'mf') {
    const latest = prices.navLatest.get(h.schemeCode);
    if (latest) consider({ value: latest.nav, date: latest.date, source: 'amfi' });
    const hist = prices.navHistory.get(h.schemeCode) ?? [];
    for (let i = hist.length - 1; i >= 0; i -= 1) {
      if (hist[i].date <= on) { consider({ value: hist[i].nav, date: hist[i].date, source: 'amfi' }); break; }
    }
  } else if (h.manualPrice !== null && h.manualPrice !== undefined) {
    consider({ value: h.manualPrice, date: h.manualPriceDate ?? h.updatedAt, source: 'manual' });
  }
  return best;
}

// What a holding was worth on a day, what went in, and its dated cash flows (for XIRR).
function valuation(h, on, prices) {
  if (isMarket(h)) {
    const pos = position(h, on);
    const price = priceOf(h, on, pos, prices);
    const value = price ? Math.round(pos.units * price.value * 100) : pos.cost;
    return { invested: pos.cost, value, flows: pos.flows, units: pos.units, price, realised: pos.realised };
  }
  if (h.kind === 'fd') {
    if (on < h.startDate) return { invested: 0, value: 0, flows: [] };
    const v = fdValue({ principalPaise: h.principalPaise, ratePct: h.ratePct, startDate: h.startDate, tenureMonths: h.tenureMonths, compounding: h.compounding, on });
    return { invested: h.principalPaise, value: v.value, flows: [{ date: h.startDate, amount: -h.principalPaise }] };
  }
  if (h.kind === 'rd') {
    const v = rdValue({ monthlyPaise: h.monthlyPaise, ratePct: h.ratePct, startDate: h.startDate, tenureMonths: h.tenureMonths, on });
    const flows = [];
    for (let i = 0; i < h.tenureMonths; i += 1) {
      const d = addMonths(h.startDate, i);
      if (d > on) break;
      flows.push({ date: d, amount: -h.monthlyPaise });
    }
    return { invested: v.paid, value: v.value, flows };
  }
  if (h.kind === 'epf') {
    const toFlow = (d) => ({ date: d.date, amount: -d.amountPaise });
    const v = epfValue({ deposits: h.deposits ?? [], passbook: h.passbook ?? [], on });
    const book = v.lastPassbook;
    const flows = [...(book ? [{ date: book.date, amount: -book.balancePaise }] : []), ...(h.deposits ?? []).filter((d) => d.date <= on && (!book || d.date > book.date)).map(toFlow)];
    return { invested: v.invested, value: v.balance + v.accrued, flows, epf: v };
  }
  // PPF
  const deposits = h.deposits.filter((d) => d.date <= on);
  if (!deposits.length) return { invested: 0, value: 0, flows: [], ppf: null };
  const v = ppfValue({ deposits: deposits.map((d) => ({ date: d.date, amountPaise: d.amountPaise })), ratePct: h.ratePct, on });
  return {
    invested: deposits.reduce((s, d) => s + d.amountPaise, 0),
    value: v.balance + v.accrued,
    flows: deposits.map((d) => ({ date: d.date, amount: -d.amountPaise })),
    ppf: v,
  };
}

function returnOf(flows, value, on) {
  const first = flows.reduce((m, f) => (!m || f.date < m ? f.date : m), null);
  if (!first || daysBetween(first, on) < XIRR_MIN_DAYS) return null;
  return xirr(value > 0 ? [...flows, { date: on, amount: value }] : flows);
}

// Latest NAVs for the funds held (and, for past days, the stored NAV history). If AMFI can't be
// reached and nothing is stored, values fall back to the last purchase price and navError says why.
async function loadPrices(holdings, { history = false } = {}) {
  const codes = [...new Set(holdings.filter((h) => h.kind === 'mf' && h.schemeCode).map((h) => h.schemeCode))];
  let navLatest = new Map();
  let navError = null;
  try {
    navLatest = await latestNavs(codes);
  } catch (err) {
    navError = err.message;
  }
  const navHistory = new Map();
  if (history && codes.length) {
    for (const r of await NavHistory.find({ code: { $in: codes } }).sort({ date: 1 }).lean()) {
      if (!navHistory.has(r.code)) navHistory.set(r.code, []);
      navHistory.get(r.code).push(r);
    }
  }
  return { navLatest, navHistory, navError };
}

// FDs and RDs mature after their term; PPF on 1 April after 15 full financial years.
export function maturityOf(h) {
  if (h.kind === 'fd' || h.kind === 'rd') return addMonths(h.startDate, h.tenureMonths);
  if (h.kind === 'ppf' && h.deposits.length) {
    const first = h.deposits.reduce((m, d) => (d.date < m ? d.date : m), h.deposits[0].date);
    return new Date(Date.UTC(fyStart(first).getUTCFullYear() + 16, 3, 1));
  }
  return null;
}

// SIP instalments already due but not bought yet (waiting for AMFI's NAV, or being caught up).
function pendingSips(sip, today) {
  if (!sip?.active) return 0;
  let n = 0;
  while (n < 600 && addMonths(sip.startDate, sip.count + n) <= today) n += 1;
  return n;
}

function serialize(h, prices, today) {
  const v = valuation(h, today, prices);
  const out = {
    id: String(h._id),
    kind: h.kind,
    kindLabel: KIND_LABEL[h.kind],
    name: h.name,
    note: h.note,
    closed: h.closed,
    invested: money(v.invested),
    value: money(v.value),
    gain: money(v.value - v.invested),
    gainPct: v.invested > 0 ? round2(((v.value - v.invested) / v.invested) * 100) : null,
    xirr: returnOf(v.flows, v.value, today),
  };
  if (isMarket(h)) {
    const { sip } = h;
    const category = prices.navLatest.get(h.schemeCode)?.category ?? null;
    return Object.assign(out, {
      schemeCode: h.schemeCode,
      category,
      taxClass: h.taxClass ?? null,
      defaultTaxClass: defaultTaxClass(h.kind, category),
      fmv2018: h.fmv2018 ?? null,
      units: v.units,
      price: v.price ? { value: v.price.value, date: dayString(v.price.date), source: v.price.source } : null,
      realised: money(v.realised),
      manualPrice: h.manualPrice,
      trades: [...h.trades].sort((a, b) => b.date - a.date).map((t) => ({
        id: String(t._id), type: t.type, date: dayString(t.date), units: t.units, price: t.price,
        amount: money(t.amountPaise), sip: t.sip, note: t.note, transactionId: t.transaction ? String(t.transaction) : null,
      })),
      sip: sip ? {
        amount: money(sip.amountPaise), dayOfMonth: sip.dayOfMonth, startDate: dayString(sip.startDate),
        nextDate: sip.active ? dayString(addMonths(sip.startDate, sip.count)) : null, count: sip.count, active: sip.active,
        account: sip.account ? String(sip.account) : null, pending: pendingSips(sip, today), catchingUp: sipRuns.has(String(h._id)),
      } : null,
    });
  }
  const maturity = maturityOf(h);
  Object.assign(out, {
    ratePct: h.ratePct,
    startDate: h.startDate ? dayString(h.startDate) : null,
    maturityDate: maturity ? dayString(maturity) : null,
    daysToMaturity: maturity ? daysBetween(today, maturity) : null,
    matured: maturity ? today >= maturity : false,
  });
  if (h.kind === 'fd') {
    return Object.assign(out, {
      principal: money(h.principalPaise), tenureMonths: h.tenureMonths, compounding: h.compounding,
      maturityValue: money(fdValue({ principalPaise: h.principalPaise, ratePct: h.ratePct, startDate: h.startDate, tenureMonths: h.tenureMonths, compounding: h.compounding }).value),
    });
  }
  if (h.kind === 'rd') {
    return Object.assign(out, {
      monthly: money(h.monthlyPaise), tenureMonths: h.tenureMonths,
      maturityValue: money(rdValue({ monthlyPaise: h.monthlyPaise, ratePct: h.ratePct, startDate: h.startDate, tenureMonths: h.tenureMonths }).value),
    });
  }
  const fy = fyStart(today);
  const depositList = [...h.deposits].sort((a, b) => b.date - a.date).map((d) => ({ id: String(d._id), date: dayString(d.date), amount: money(d.amountPaise), note: d.note }));
  if (h.kind === 'epf') {
    return Object.assign(out, {
      balance: money(v.epf.balance),
      accrued: money(v.epf.accrued),
      interestEstimated: money(v.epf.interestEstimated),
      epfRate: { pct: v.epf.rate, fy: v.epf.fy, declared: v.epf.declared },
      lastPassbook: v.epf.lastPassbook ? { date: dayString(v.epf.lastPassbook.date), balance: money(v.epf.lastPassbook.balancePaise) } : null,
      passbook: [...(h.passbook ?? [])].sort((a, b) => b.date - a.date).map((p) => ({ id: String(p._id), date: dayString(p.date), balance: money(p.balancePaise), note: p.note })),
      deposits: depositList,
    });
  }
  return Object.assign(out, {
    balance: money(v.ppf?.balance ?? 0),
    accrued: money(v.ppf?.accrued ?? 0),
    interestCredited: money(v.ppf?.interestCredited ?? 0),
    thisYear: {
      deposited: money(h.deposits.filter((d) => d.date >= fy && d.date <= today && d.amountPaise > 0).reduce((s, d) => s + d.amountPaise, 0)),
      limit: money(PPF_YEAR_LIMIT_PAISE),
    },
    deposits: depositList,
  });
}

async function owned(spaceId, id) {
  if (!mongoose.isValidObjectId(id)) throw NOT_FOUND();
  const h = await Holding.findOne({ _id: id, space: spaceId });
  if (!h) throw NOT_FOUND();
  return h;
}

async function checkAccount(spaceId, account) {
  if (account && !(await Account.exists({ _id: account, space: spaceId }))) throw fieldError('account', 'Choose one of your accounts');
}

async function one(h) {
  const plain = typeof h.toObject === 'function' ? h.toObject() : h;
  return serialize(plain, await loadPrices([plain], { history: true }), todayIn(config.timeZone));
}

// Every holding with its value, plus totals, the split by kind and what matures in the next 90 days.
export async function list(spaceId) {
  const today = todayIn(config.timeZone);
  const holdings = await Holding.find({ space: spaceId }).sort({ createdAt: 1 }).lean();
  const prices = await loadPrices(holdings, { history: true });
  const items = holdings.map((h) => serialize(h, prices, today));
  let invested = 0;
  let value = 0;
  const flows = [];
  const byKind = new Map();
  for (const h of holdings.filter((x) => !x.closed)) {
    const v = valuation(h, today, prices);
    invested += v.invested;
    value += v.value;
    flows.push(...v.flows);
    byKind.set(h.kind, (byKind.get(h.kind) ?? 0) + v.value);
  }
  const allocation = [...byKind].filter(([, p]) => p > 0).sort((a, b) => b[1] - a[1])
    .map(([kind, p]) => ({ kind, label: KIND_LABEL[kind], value: money(p), pct: value > 0 ? round2((p / value) * 100) : 0 }));
  const sipMonthly = holdings.filter((h) => !h.closed && h.sip?.active).reduce((s, h) => s + h.sip.amountPaise, 0);
  const maturing = items.filter((i) => !i.closed && i.daysToMaturity !== null && i.daysToMaturity >= 0 && i.daysToMaturity <= 90)
    .sort((a, b) => a.daysToMaturity - b.daysToMaturity)
    .map((i) => ({ id: i.id, name: i.name, kind: i.kind, maturityDate: i.maturityDate, daysToMaturity: i.daysToMaturity, value: i.maturityValue ?? i.value }));
  return {
    holdings: items,
    summary: {
      invested: money(invested), value: money(value), gain: money(value - invested),
      gainPct: invested > 0 ? round2(((value - invested) / invested) * 100) : null,
      xirr: returnOf(flows, value, today),
      allocation, sipMonthly: money(sipMonthly), maturing,
    },
    navSource: AMFI_SOURCE,
    navError: prices.navError,
  };
}

export async function get(spaceId, id) {
  return one(await owned(spaceId, id));
}

export async function create({ space, user }, body) {
  const doc = { space: space._id, kind: body.kind, name: body.name, note: body.note ?? '', createdBy: user._id };
  if (body.taxClass !== undefined || body.fmv2018 !== undefined) {
    if (!isMarket(body) || body.kind === 'nps') throw fieldError('taxClass', 'Only funds, stocks, gold and other market holdings are taxed as capital gains');
    Object.assign(doc, { taxClass: body.taxClass ?? null, fmv2018: body.fmv2018 ?? null });
  }
  if (body.kind === 'mf') {
    const s = await findScheme(body.schemeCode);
    if (!s) throw fieldError('schemeCode', 'Pick a fund from AMFI’s list');
    doc.schemeCode = s.code;
    doc.name = body.name || [s.name, s.plan, s.option].filter(Boolean).join(' - ');
  } else if (isMarket(body)) {
    if (body.manualPrice !== undefined) Object.assign(doc, { manualPrice: body.manualPrice, manualPriceDate: todayIn(config.timeZone) });
  } else if (body.kind === 'epf') {
    // EPF grows at EPFO's declared rate; its balance comes from contributions and passbook entries.
  } else {
    Object.assign(doc, {
      ratePct: body.ratePct, startDate: body.startDate ?? null, tenureMonths: body.tenureMonths ?? null,
      principalPaise: body.principal ?? null, monthlyPaise: body.monthly ?? null, compounding: body.compounding ?? 'quarterly',
    });
  }
  return one(await Holding.create(doc));
}

const TERM_FIELDS = { principal: 'principalPaise', monthly: 'monthlyPaise', ratePct: 'ratePct', startDate: 'startDate', tenureMonths: 'tenureMonths', compounding: 'compounding' };

export async function update(spaceId, id, changes) {
  const h = await owned(spaceId, id);
  for (const k of ['name', 'note', 'closed']) if (changes[k] !== undefined) h[k] = changes[k];
  for (const k of ['taxClass', 'fmv2018']) {
    if (changes[k] === undefined) continue;
    if (!isMarket(h) || h.kind === 'nps') throw fieldError(k, 'Only funds, stocks, gold and other market holdings are taxed as capital gains');
    h[k] = changes[k];
  }
  if (changes.manualPrice !== undefined) {
    if (!isMarket(h) || h.kind === 'mf') throw fieldError('manualPrice', 'Mutual fund prices come from AMFI; deposits grow at their rate');
    h.manualPrice = changes.manualPrice;
    h.manualPriceDate = todayIn(config.timeZone);
  }
  const terms = Object.keys(TERM_FIELDS).filter((k) => changes[k] !== undefined);
  if (terms.length) {
    if (isMarket(h)) throw fieldError(terms[0], 'Only deposits have a rate and term');
    if (h.kind === 'ppf' && terms.some((k) => k !== 'ratePct')) throw fieldError(terms.find((k) => k !== 'ratePct'), 'PPF only has a rate; add deposits instead');
    if ((changes.principal !== undefined && h.kind !== 'fd') || (changes.monthly !== undefined && h.kind !== 'rd')) throw fieldError(changes.principal !== undefined ? 'principal' : 'monthly', 'Not for this kind of deposit');
    for (const k of terms) h[TERM_FIELDS[k]] = changes[k];
    // A new maturity date means a new reminder.
    h.remindedFor = null;
  }
  await h.save();
  return one(h);
}

export async function remove(spaceId, id) {
  const h = await owned(spaceId, id);
  await Holding.deleteOne({ _id: h._id });
}

// A purchase or sale. Mutual funds get AMFI's NAV for the day (or the next business day) unless a price
// is given; the units or the amount follow from the other. A purchase can also be recorded as an
// "Investments" expense from one of your accounts.
export async function addTrade({ space, user }, id, { type, date, amount, units, price, account, note = '' }) {
  const h = await owned(space._id, id);
  if (!isMarket(h)) throw new HttpError(409, 'not_tradeable', 'Deposits and PPF aren’t bought in units');
  await checkAccount(space._id, account);
  let day = date;
  let unitPrice = price;
  if (unitPrice === undefined && amount !== undefined && units !== undefined) unitPrice = round4(amount / 100 / units);
  if (unitPrice === undefined) {
    if (h.kind !== 'mf') throw fieldError('price', 'Enter the price per unit');
    const nav = await navOn(h.schemeCode, date);
    if (!nav) throw new HttpError(409, 'nav_not_ready', 'AMFI hasn’t published the NAV for that day yet (it comes out in the evening). Try later, or enter the NAV yourself.');
    unitPrice = nav.nav;
    day = nav.date;
  }
  const u = units ?? unitsFor(amount, unitPrice);
  const amountPaise = amount ?? Math.round(u * unitPrice * 100);
  if (!(u >= 0.0001) || !(amountPaise >= 1)) throw fieldError('amount', 'That comes to less than 0.0001 units or ₹0.01');
  const trade = { type, date: day, units: round4(u), price: unitPrice, amountPaise, note };
  const bad = oversold([...h.trades, trade]);
  if (bad) throw fieldError('units', `That sells more units than you held on ${shortDay(bad.date)}`);
  if (type === 'buy' && account) {
    const tx = await createTx({ space, user }, { type: 'expense', amount: amountPaise, category: 'Investments', date: day, note: `Bought ${h.name}`.slice(0, 500), account });
    trade.transaction = tx.id;
  }
  h.trades.push(trade);
  await h.save();
  return one(h);
}

export async function removeTrade({ space, user }, id, tradeId) {
  const h = await owned(space._id, id);
  const t = mongoose.isValidObjectId(tradeId) ? h.trades.id(tradeId) : null;
  if (!t) throw new HttpError(404, 'trade_not_found', 'Purchase or sale not found');
  const bad = oversold(h.trades.filter((x) => String(x._id) !== String(t._id)));
  if (bad) throw new HttpError(409, 'units_negative', `Without this purchase, the sale on ${shortDay(bad.date)} would be more units than you held. Remove the sale first.`);
  if (t.transaction) await removeTx({ space, user }, t.transaction).catch(() => null);
  t.deleteOne();
  await h.save();
  return one(h);
}

// Starts or changes a monthly SIP. Instalments already due are bought at their days' NAVs: a few straight
// away, more in the background (`sip.pending` says how many are still to come). Expense entries are
// recorded only from today on, since earlier instalments were paid before Spendwise knew about them.
export async function setSip({ space, user }, id, { amount, startDate, account = null }) {
  const h = await owned(space._id, id);
  if (h.kind !== 'mf') throw new HttpError(409, 'not_a_fund', 'SIPs are for mutual funds');
  await checkAccount(space._id, account);
  const today = todayIn(config.timeZone);
  const same = h.sip && +h.sip.startDate === +startDate;
  const lastSip = h.trades.filter((t) => t.sip).reduce((m, t) => (!m || t.date > m ? t.date : m), null);
  if (!same && lastSip && startDate <= lastSip) throw fieldError('startDate', `Start after the last SIP purchase (${shortDay(lastSip)})`);
  if (startDate < addMonths(today, -120)) throw fieldError('startDate', 'Add purchases older than 10 years one by one');
  const keepEntries = same && account && h.sip.account && String(h.sip.account) === String(account);
  h.sip = {
    amountPaise: amount, dayOfMonth: startDate.getUTCDate(), startDate, count: same ? h.sip.count : 0, active: true,
    account, entriesFrom: account ? (keepEntries ? h.sip.entriesFrom : today) : null,
  };
  await h.save();
  if (pendingSips(h.sip, today) <= 3) await processHoldingSip(h._id, { today, user });
  else processHoldingSip(h._id, { today, user }).catch((err) => console.error(`SIP catch-up failed: ${err.message}`));
  return one(await Holding.findById(h._id).lean());
}

export async function stopSip(spaceId, id) {
  const h = await owned(spaceId, id);
  if (!h.sip) throw new HttpError(409, 'no_sip', 'This fund has no SIP');
  h.sip.active = false;
  await h.save();
  return one(h);
}

// Buys every instalment that's due and has a NAV, one at a time. The count only moves on if no one else
// bought that instalment first, so the hourly job and a request can't both buy it.
export async function processHoldingSip(holdingId, { today = todayIn(config.timeZone), user = null } = {}) {
  const key = String(holdingId);
  if (sipRuns.has(key)) return 0;
  sipRuns.add(key);
  let bought = 0;
  try {
    for (let guard = 0; guard < 600; guard += 1) {
      const h = await Holding.findById(holdingId).lean();
      if (!h?.sip?.active || h.closed || h.kind !== 'mf') break;
      const due = addMonths(h.sip.startDate, h.sip.count);
      if (due > today) break;
      const nav = await navOn(h.schemeCode, due, { today });
      if (!nav) break;
      const trade = {
        _id: new mongoose.Types.ObjectId(), type: 'buy', date: nav.date, units: unitsFor(h.sip.amountPaise, nav.nav), price: nav.nav,
        amountPaise: h.sip.amountPaise, sip: true, note: `SIP instalment for ${shortDay(due)}`, transaction: null,
      };
      const claim = await Holding.updateOne({ _id: h._id, 'sip.count': h.sip.count, 'sip.active': true }, { $push: { trades: trade }, $inc: { 'sip.count': 1 } });
      if (!claim.modifiedCount) continue;
      bought += 1;
      if (h.sip.account && h.sip.entriesFrom && due >= h.sip.entriesFrom) {
        const space = await Space.findById(h.space).lean();
        const tx = space && await createTx({ space, user: user ?? { _id: h.createdBy } }, {
          type: 'expense', amount: h.sip.amountPaise, category: 'Investments', date: due, note: `SIP: ${h.name}`.slice(0, 500), account: h.sip.account,
        }).catch((err) => { console.error(`SIP expense entry failed: ${err.message}`); return null; });
        if (tx) await Holding.updateOne({ _id: h._id, 'trades._id': trade._id }, { $set: { 'trades.$.transaction': tx.id } });
      }
    }
  } finally {
    sipRuns.delete(key);
  }
  return bought;
}

export async function processSips({ today = todayIn(config.timeZone) } = {}) {
  let bought = 0;
  for (const h of await Holding.find({ 'sip.active': true, closed: false }).select('_id').lean()) {
    bought += await processHoldingSip(h._id, { today });
  }
  return { bought };
}

const fyLabel = (fy) => `${fy.getUTCFullYear()}-${String((fy.getUTCFullYear() + 1) % 100).padStart(2, '0')}`;

// PPF deposits (at most ₹1.5 lakh in a financial year) and withdrawals; EPF contributions and withdrawals.
export async function addDeposit(spaceId, id, { amount, date, direction = 'deposit', note = '' }) {
  const h = await owned(spaceId, id);
  if (h.kind !== 'ppf' && h.kind !== 'epf') throw new HttpError(409, 'not_ppf', 'Deposits are for PPF and EPF; FDs and RDs use their amount and term');
  if (h.kind === 'epf') {
    if (direction === 'withdraw') {
      const v = valuation(h.toObject(), date, NO_PRICES);
      if (amount > v.value) throw fieldError('amount', `The balance on that day was about ₹${formatPaise(v.value)}`);
    }
  } else if (direction === 'deposit') {
    const fy = fyStart(date);
    const next = new Date(Date.UTC(fy.getUTCFullYear() + 1, 3, 1));
    const already = h.deposits.filter((d) => d.date >= fy && d.date < next && d.amountPaise > 0).reduce((s, d) => s + d.amountPaise, 0);
    if (already + amount > PPF_YEAR_LIMIT_PAISE) {
      throw fieldError('amount', `PPF takes at most ₹1,50,000 a financial year; ₹${formatPaise(PPF_YEAR_LIMIT_PAISE - already)} is left for ${fyLabel(fy)}`);
    }
  } else {
    const balance = valuation(h.toObject(), date, NO_PRICES).ppf?.balance ?? 0;
    if (amount > balance) throw fieldError('amount', `The balance on that day was ₹${formatPaise(balance)}`);
  }
  h.deposits.push({ date, amountPaise: direction === 'withdraw' ? -amount : amount, note });
  await h.save();
  return one(h);
}

// EPF: a balance read from the EPFO passbook (with the interest EPFO has credited). Later values build on the latest one.
export async function addPassbook(spaceId, id, { balance, date, note = '' }) {
  const h = await owned(spaceId, id);
  if (h.kind !== 'epf') throw new HttpError(409, 'not_epf', 'Passbook balances are for EPF');
  if (h.passbook.some((p) => +p.date === +date)) throw fieldError('date', 'There’s already a passbook balance for that day');
  h.passbook.push({ date, balancePaise: balance, note });
  await h.save();
  return one(h);
}

export async function removePassbook(spaceId, id, entryId) {
  const h = await owned(spaceId, id);
  const p = mongoose.isValidObjectId(entryId) ? h.passbook.id(entryId) : null;
  if (!p) throw new HttpError(404, 'passbook_not_found', 'Passbook balance not found');
  p.deleteOne();
  await h.save();
  return one(h);
}

export async function removeDeposit(spaceId, id, depositId) {
  const h = await owned(spaceId, id);
  const d = mongoose.isValidObjectId(depositId) ? h.deposits.id(depositId) : null;
  if (!d) throw new HttpError(404, 'deposit_not_found', 'Deposit not found');
  d.deleteOne();
  await h.save();
  return one(h);
}

// Once per maturity date, a week (or less) before it, everyone in the space who wants bill and
// maturity reminders hears about it.
export async function sendMaturityReminders({ today = todayIn(config.timeZone) } = {}) {
  let sent = 0;
  for (const h of await Holding.find({ kind: { $in: ['fd', 'rd', 'ppf'] }, closed: false }).lean()) {
    const maturity = maturityOf(h);
    if (!maturity) continue;
    const days = daysBetween(today, maturity);
    const key = dayString(maturity);
    if (days < 0 || days > MATURITY_REMIND_DAYS || h.remindedFor === key) continue;
    const claim = await Holding.updateOne({ _id: h._id, remindedFor: { $ne: key } }, { $set: { remindedFor: key } });
    if (!claim.modifiedCount) continue;
    const space = await Space.findById(h.space).lean();
    if (!space) continue;
    const { value } = valuation(h, maturity, NO_PRICES);
    const when = days === 0 ? 'matures today' : days === 1 ? 'matures tomorrow' : `matures in ${days} days`;
    await notifySpace(space, {
      kind: 'bill',
      title: `${h.name} ${when}`,
      body: `Worth about ₹${formatPaise(value)} on ${shortDay(maturity)}. Decide whether to renew it or move the money.`,
      path: '/investments',
      tag: `maturity-${h._id}`,
      linkText: 'See your investments',
    });
    sent += 1;
  }
  return { sent };
}

// Stores today's value of each space's investments as this month's snapshot (the last one in a month
// stays), so the timeline keeps real month-end values from here on.
export async function snapshotAll({ today = todayIn(config.timeZone) } = {}) {
  const spaces = await Holding.distinct('space', { closed: false });
  const month = currentMonth(today);
  let saved = 0;
  for (const spaceId of spaces) {
    const holdings = await Holding.find({ space: spaceId, closed: false }).lean();
    const prices = await loadPrices(holdings);
    // Without AMFI's NAVs the value would be wrong; keep the last good snapshot instead.
    if (prices.navError) continue;
    let invested = 0;
    let value = 0;
    for (const h of holdings) {
      const v = valuation(h, today, prices);
      invested += v.invested;
      value += v.value;
    }
    await NetWorthSnapshot.updateOne({ space: spaceId, month }, { $set: { day: today, investedPaise: invested, valuePaise: value } }, { upsert: true });
    saved += 1;
  }
  return { saved };
}

const oid = (id) => new mongoose.Types.ObjectId(String(id));
const monthOf = { $dateToString: { format: '%Y-%m', date: '$date' } };

// Month-end net worth for the last `months` months: account balances from your entries, plus
// investments (that month's stored snapshot, or worked out from deposits' terms and the last known
// prices), minus what's left on your loans.
export async function timeline(spaceId, { months = 12 } = {}) {
  const today = todayIn(config.timeZone);
  const thisMonth = currentMonth(today);
  const span = Array.from({ length: months }, (_, i) => shiftMonth(thisMonth, i - months + 1));
  const [accounts, [moves], holdings, loans, snaps] = await Promise.all([
    Account.find({ space: spaceId }).lean(),
    Transaction.aggregate([
      { $match: { space: oid(spaceId), deletedAt: null, date: { $lte: today } } },
      {
        $facet: {
          own: [{ $group: { _id: { a: '$account', m: monthOf }, d: { $sum: { $cond: [{ $eq: ['$type', 'income'] }, '$amountPaise', { $multiply: ['$amountPaise', -1] }] } } } }],
          incoming: [{ $match: { type: 'transfer' } }, { $group: { _id: { a: '$toAccount', m: monthOf }, d: { $sum: '$amountPaise' } } }],
        },
      },
    ]),
    Holding.find({ space: spaceId, closed: false }).lean(),
    Loan.find({ space: spaceId }).lean(),
    NetWorthSnapshot.find({ space: spaceId, month: { $in: span } }).lean(),
  ]);
  const prices = await loadPrices(holdings, { history: true });
  const snapBy = new Map(snaps.map((s) => [s.month, s]));
  // Each account's balance going into the first month, then its movement month by month.
  const balance = new Map(accounts.map((a) => [String(a._id), a.openingBalancePaise]));
  const delta = new Map();
  for (const r of [...moves.own, ...moves.incoming]) {
    const a = String(r._id.a);
    if (!balance.has(a)) continue;
    if (r._id.m < span[0]) balance.set(a, balance.get(a) + r.d);
    else delta.set(`${a}|${r._id.m}`, (delta.get(`${a}|${r._id.m}`) ?? 0) + r.d);
  }
  const rows = [];
  for (const month of span) {
    const end = month === thisMonth ? today : monthRange(month).to;
    let accountsNet = 0;
    for (const [a, b] of balance) {
      const now = b + (delta.get(`${a}|${month}`) ?? 0);
      balance.set(a, now);
      accountsNet += now;
    }
    let investments = 0;
    let invested = 0;
    let source = month === thisMonth ? 'live' : 'worked-out';
    const snap = snapBy.get(month);
    if (month !== thisMonth && snap) {
      investments = snap.valuePaise;
      invested = snap.investedPaise;
      source = 'snapshot';
    } else {
      for (const h of holdings) {
        const v = valuation(h, end, prices);
        investments += v.value;
        invested += v.invested;
      }
    }
    let loanBalance = 0;
    for (const l of loans) {
      if (end < addMonths(l.firstEmiDate, -1)) continue;
      loanBalance += loanState({
        principalPaise: l.principalPaise, annualRatePct: l.annualRatePct, emiPaise: l.emiPaise, firstEmiDate: l.firstEmiDate,
        payments: l.payments.filter((p) => p.date <= end),
      }).balancePaise;
    }
    rows.push({
      month, day: dayString(end), source,
      accounts: money(accountsNet), investments: money(investments), invested: money(invested), loans: money(loanBalance),
      netWorth: money(accountsNet + investments - loanBalance),
    });
  }
  // Leading months with nothing in them are left out.
  const first = rows.findIndex((r) => r.accounts.paise || r.investments.paise || r.loans.paise);
  return { months: first === -1 ? [] : rows.slice(first), navSource: AMFI_SOURCE };
}
