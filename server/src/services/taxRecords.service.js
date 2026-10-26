// Batch 12M: interest income and TDS for a tax year, and rent receipts for an HRA claim.
// Interest comes from income entries in the "Interest" category plus what cumulative FDs and RDs earned in the
// year (banks tax it as it accrues). TDS comes from income entries that carry it and from the TDS register.
import mongoose from 'mongoose';
import PDFDocument from 'pdfkit';
import { HttpError } from '../errors.js';
import { config } from '../config.js';
import { Holding, RentProfile, TdsEntry, Transaction } from '../models/index.js';
import { addMonths, fdValue, rdValue } from '../invest.js';
import { dayString, formatPaise } from '../money.js';
import { todayIn } from '../schedule.js';
import { fyRange } from '../tax.js';
import { TAX_TAGS } from './tax.service.js';

const money = (paise) => (paise === null ? null : { paise, rupees: paise / 100 });
const sum = (list, key = 'amountPaise') => list.reduce((s, x) => s + (x[key] ?? 0), 0);
const NOT_FOUND = () => new HttpError(404, 'tds_not_found', 'TDS record not found');
// Which TDS kind an income entry's category means.
const TDS_KIND_OF = { Interest: 'interest', Salary: 'salary', Freelance: 'professional', Business: 'professional', 'Rental income': 'rent' };
// Rent paid in a year above which the landlord's PAN is needed for an HRA claim.
export const PAN_NEEDED_ABOVE_PAISE = 100_000_00;
// Cash receipts above this need a revenue stamp.
const STAMP_ABOVE_PAISE = 5_000_00;

// Interest earned by a cumulative FD or an RD between two days (what it grew by, less instalments paid in).
function depositInterest(h, from, to) {
  const maturity = addMonths(h.startDate, h.tenureMonths);
  const start = from < h.startDate ? h.startDate : from;
  const end = to > maturity ? maturity : to;
  if (end <= start) return 0;
  if (h.kind === 'fd') {
    const v = (on) => fdValue({ principalPaise: h.principalPaise, ratePct: h.ratePct, startDate: h.startDate, tenureMonths: h.tenureMonths, compounding: h.compounding, on }).value;
    return v(end) - v(start);
  }
  const a = rdValue({ monthlyPaise: h.monthlyPaise, ratePct: h.ratePct, startDate: h.startDate, tenureMonths: h.tenureMonths, on: start });
  const b = rdValue({ monthlyPaise: h.monthlyPaise, ratePct: h.ratePct, startDate: h.startDate, tenureMonths: h.tenureMonths, on: end });
  return b.value - a.value - (b.paid - a.paid);
}

const serializeTds = (r) => ({
  id: String(r._id), date: dayString(r.date), deductor: r.deductor, kind: r.kind,
  income: money(r.incomePaise ?? null), tds: money(r.tdsPaise), note: r.note,
});

export async function interestAndTds(spaceId, { fy }) {
  const { from, to } = fyRange(fy);
  const today = todayIn(config.timeZone);
  const until = to < today ? to : today;
  const income = await Transaction.find({
    space: spaceId, deletedAt: null, type: 'income', date: { $gte: from, $lte: to },
    $or: [{ category: 'Interest' }, { tdsPaise: { $ne: null } }],
  }).sort({ date: 1 }).lean();
  const interestEntries = income.filter((t) => t.category === 'Interest');
  const deposits = [];
  for (const h of await Holding.find({ space: spaceId, kind: { $in: ['fd', 'rd'] } }).sort({ createdAt: 1 }).lean()) {
    // Payout FDs pay their interest out; record those payments as Interest entries instead.
    if (h.kind === 'fd' && h.compounding === 'simple') continue;
    const interest = depositInterest(h, from, until);
    if (interest > 0) deposits.push({ id: String(h._id), name: h.name, kind: h.kind, interest: money(interest) });
  }
  const records = await TdsEntry.find({ space: spaceId, date: { $gte: from, $lte: to } }).sort({ date: 1 }).lean();
  const fromEntries = income.filter((t) => t.tdsPaise).map((t) => ({
    id: String(t._id), date: dayString(t.date), deductor: t.merchant || t.note || t.category, kind: TDS_KIND_OF[t.category] ?? 'other',
    income: money(t.amountPaise), tds: money(t.tdsPaise), fromEntry: true,
  }));
  const allTds = [...fromEntries.map((x) => ({ kind: x.kind, tdsPaise: x.tds.paise })), ...records];
  const byKind = {};
  for (const r of allTds) byKind[r.kind] = (byKind[r.kind] ?? 0) + r.tdsPaise;
  const depositTotal = deposits.reduce((s, d) => s + d.interest.paise, 0);
  return {
    fy, from: dayString(from), to: dayString(to),
    interest: {
      entries: interestEntries.map((t) => ({ id: String(t._id), date: dayString(t.date), note: t.note, merchant: t.merchant ?? null, amount: money(t.amountPaise), tds: money(t.tdsPaise ?? null) })),
      entriesTotal: money(sum(interestEntries)),
      deposits,
      depositsTotal: money(depositTotal),
      total: money(sum(interestEntries) + depositTotal),
      depositsUntil: dayString(until),
    },
    tds: {
      fromEntries,
      records: records.map(serializeTds),
      byKind: Object.fromEntries(Object.entries(byKind).map(([k, v]) => [k, money(v)])),
      total: money(sum(allTds, 'tdsPaise')),
    },
    note: 'Interest from FDs and RDs is worked out from their rate, as it accrues in the year (payout FDs are left out: record their payments as Interest entries). Match TDS with Form 26AS / AIS before filing.',
  };
}

export async function addTds({ space, user }, body) {
  const r = await TdsEntry.create({
    space: space._id, date: body.date, deductor: body.deductor, kind: body.kind,
    incomePaise: body.income ?? null, tdsPaise: body.tds, note: body.note ?? '', createdBy: user._id,
  });
  return serializeTds(r);
}

export async function updateTds(spaceId, id, changes) {
  const r = mongoose.isValidObjectId(id) ? await TdsEntry.findOne({ _id: id, space: spaceId }) : null;
  if (!r) throw NOT_FOUND();
  for (const [k, field] of [['date', 'date'], ['deductor', 'deductor'], ['kind', 'kind'], ['income', 'incomePaise'], ['tds', 'tdsPaise'], ['note', 'note']]) {
    if (changes[k] !== undefined) r[field] = changes[k];
  }
  await r.save();
  return serializeTds(r);
}

export async function removeTds(spaceId, id) {
  const r = mongoose.isValidObjectId(id) ? await TdsEntry.findOneAndDelete({ _id: id, space: spaceId }) : null;
  if (!r) throw NOT_FOUND();
}

// ── Rent receipts ──

const serializeProfile = (p) => (p ? {
  tenantName: p.tenantName, landlordName: p.landlordName, landlordPan: p.landlordPan, propertyAddress: p.propertyAddress,
} : null);

export async function getRentProfile(space, user) {
  return serializeProfile(await RentProfile.findOne({ space: space._id, user: user._id }).lean());
}

export async function saveRentProfile(space, user, body) {
  const p = await RentProfile.findOneAndUpdate(
    { space: space._id, user: user._id },
    { $set: { tenantName: body.tenantName, landlordName: body.landlordName, landlordPan: body.landlordPan || null, propertyAddress: body.propertyAddress } },
    { upsert: true, new: true, runValidators: true },
  ).lean();
  return serializeProfile(p);
}

// Rent paid in the year: expenses in the Rent category or tagged #rent / #hra, month by month.
async function rentMonths(spaceId, fy) {
  const { from, to } = fyRange(fy);
  const rows = await Transaction.find({
    space: spaceId, deletedAt: null, type: 'expense', date: { $gte: from, $lte: to },
    $or: [{ category: 'Rent' }, { tags: { $in: TAX_TAGS.rent } }],
  }).sort({ date: 1 }).lean();
  const months = new Map();
  for (const t of rows) {
    const key = dayString(t.date).slice(0, 7);
    if (!months.has(key)) months.set(key, { month: key, amountPaise: 0, payments: [] });
    const m = months.get(key);
    m.amountPaise += t.amountPaise;
    m.payments.push({ date: dayString(t.date), amountPaise: t.amountPaise, method: t.paymentMethod ?? null });
  }
  return [...months.values()];
}

export async function rentReceipts(space, user, { fy }) {
  const [profile, months] = await Promise.all([getRentProfile(space, user), rentMonths(space._id, fy)]);
  const total = sum(months);
  const panRequired = total > PAN_NEEDED_ABOVE_PAISE;
  return {
    fy, profile,
    months: months.map((m) => ({ month: m.month, amount: money(m.amountPaise), payments: m.payments.map((p) => ({ date: p.date, method: p.method, amount: money(p.amountPaise) })) })),
    total: money(total),
    panRequired,
    ready: Boolean(profile && months.length && (!panRequired || profile.landlordPan)),
  };
}

const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen',
  'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const upto99 = (n) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? `-${ONES[n % 10]}` : ''}`);
const upto999 = (n) => [n >= 100 ? `${ONES[Math.floor(n / 100)]} hundred` : '', n % 100 ? upto99(n % 100) : ''].filter(Boolean).join(' ');
// Rupees in words the Indian way: 1,25,000 -> "one lakh twenty-five thousand".
export function rupeesInWords(rupees) {
  if (rupees === 0) return 'zero';
  const parts = [];
  const crore = Math.floor(rupees / 10_000_000);
  const lakh = Math.floor((rupees % 10_000_000) / 100_000);
  const thousand = Math.floor((rupees % 100_000) / 1000);
  const rest = rupees % 1000;
  if (crore) parts.push(`${rupeesInWords(crore)} crore`);
  if (lakh) parts.push(`${upto99(lakh)} lakh`);
  if (thousand) parts.push(`${upto99(thousand)} thousand`);
  if (rest) parts.push(upto999(rest));
  return parts.join(' ');
}

const METHOD = { upi: 'UPI', card: 'card', cash: 'cash', netbanking: 'net banking', other: 'other means' };
const monthName = (key) => new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${key}-01T00:00:00Z`));
const shortDay = (s) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${s}T00:00:00Z`));
// Helvetica has no ₹ sign, so receipts say "Rs."
const rs = (paise) => `Rs. ${formatPaise(paise)}`;

// One receipt per month of rent paid in the year, two to a page, ready for the landlord to sign.
export async function writeRentReceiptsPdf(space, user, { fy }, res) {
  const profile = await getRentProfile(space, user);
  if (!profile) throw new HttpError(409, 'rent_profile_missing', 'Add your landlord’s details first');
  const months = await rentMonths(space._id, fy);
  if (!months.length) throw new HttpError(404, 'no_rent', `No rent paid in ${fy}: add rent as expenses in the Rent category (or tagged #rent)`);
  const total = sum(months);
  if (total > PAN_NEEDED_ABOVE_PAISE && !profile.landlordPan) {
    throw new HttpError(400, 'pan_required', `Rent for ${fy} is ${rs(total)}, over Rs. 1,00,000, so the landlord’s PAN is needed`);
  }
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="rent-receipts-${fy}.pdf"`);
  const doc = new PDFDocument({
    size: 'A4', margin: 50, compress: config.env !== 'test',
    info: { Title: `Rent receipts ${fy}`, Author: 'Spendwise', Subject: `Rent receipts for ${profile.tenantName}` },
  });
  doc.pipe(res);
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const half = (doc.page.height - 100) / 2;

  months.forEach((m, i) => {
    if (i > 0 && i % 2 === 0) doc.addPage();
    const top = doc.page.margins.top + (i % 2) * half;
    if (i % 2 === 1) doc.moveTo(left, top - 12).lineTo(left + width, top - 12).dash(4, { space: 4 }).strokeColor('#999').stroke().undash();
    doc.fillColor('#000').font('Helvetica-Bold').fontSize(15).text('RENT RECEIPT', left, top, { width, align: 'center' });
    doc.font('Helvetica').fontSize(9).fillColor('#555')
      .text(`Receipt no. ${fy}/${String(i + 1).padStart(2, '0')}`, left, top + 22)
      .text(`For ${monthName(m.month)}`, left, top + 22, { width, align: 'right' });
    const rupees = Math.floor(m.amountPaise / 100);
    const paidOn = m.payments.map((p) => `${shortDay(p.date)}${p.method ? ` by ${METHOD[p.method]}` : ''}`).join(', ');
    doc.fillColor('#000').fontSize(11).text(
      `Received with thanks from ${profile.tenantName} the sum of ${rs(m.amountPaise)} (Rupees ${rupeesInWords(rupees)}${m.amountPaise % 100 ? ` and ${m.amountPaise % 100} paise` : ''} only) `
      + `as rent for ${monthName(m.month)} for the property at ${profile.propertyAddress}.`,
      left, top + 48, { width, lineGap: 3 },
    );
    doc.moveDown(0.6).fontSize(10).fillColor('#333').text(`Paid on ${paidOn}.`, { width });
    const y = top + half - 120;
    doc.fillColor('#000').fontSize(10)
      .text(`Landlord: ${profile.landlordName}`, left, y)
      .text(`PAN: ${profile.landlordPan ?? 'not given (not needed when the year’s rent is Rs. 1,00,000 or less)'}`, left, y + 15, { width: width / 2 + 40 });
    const cash = m.payments.some((p) => p.method === 'cash');
    if (cash && m.amountPaise > STAMP_ABOVE_PAISE) {
      doc.rect(left + width - 210, y - 6, 80, 60).dash(2, { space: 2 }).strokeColor('#999').stroke().undash();
      doc.fontSize(7).fillColor('#777').text('Revenue stamp (Rs. 1) for cash over Rs. 5,000', left + width - 206, y + 14, { width: 72, align: 'center' });
    }
    doc.moveTo(left + width - 120, y + 50).lineTo(left + width, y + 50).strokeColor('#000').stroke();
    doc.fontSize(9).fillColor('#333').text('Signature of landlord', left + width - 120, y + 55, { width: 120, align: 'center' });
  });
  doc.end();
}
