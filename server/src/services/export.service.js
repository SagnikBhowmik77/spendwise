import PDFDocument from 'pdfkit';
import { HttpError } from '../errors.js';
import { Account, Transaction } from '../models/index.js';
import { config } from '../config.js';
import { dayString, formatPaise } from '../money.js';
import { buildFilter } from './transaction.service.js';
import { summary } from './stats.service.js';

// A PDF statement is meant to be read; above this many rows the filters should be narrowed (CSV has no cap).
export const MAX_PDF_ROWS = 5000;

const SORT = {
  '-date': { date: -1, _id: -1 },
  date: { date: 1, _id: 1 },
  '-amount': { amountPaise: -1, _id: -1 },
  amount: { amountPaise: 1, _id: 1 },
};

export function exportFilename(ext, now = new Date()) {
  return `spendwise-transactions-${dayString(now)}.${ext}`;
}

// Quotes a CSV cell when needed. Cells that a spreadsheet would run as a formula (=, +, -, @, tab, CR)
// get a leading apostrophe so a note like "=HYPERLINK(...)" stays plain text.
export function csvCell(value) {
  let s = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const CSV_HEADER = ['Date', 'Time', 'Type', 'Category', 'Amount (INR)', 'Account', 'To account', 'Payment method', 'Tags', 'Original amount', 'Note'];

// "Split: Groceries 300.00; Personal care 150.00", or the category.
const categoryText = (t) => (t.splits?.length
  ? `Split: ${t.splits.map((s) => `${s.category} ${formatPaise(s.amountPaise, { grouping: false })}`).join('; ')}`
  : t.category);
// "USD 12.00 @ 94.93 (2026-10-20)"
const originalText = (t) => (t.original
  ? `${t.original.currency} ${formatPaise(t.original.amountMinor, { grouping: false })} @ ${t.original.rate} (${t.original.rateDate})`
  : '');
const METHOD_LABEL = { upi: 'UPI', card: 'Card', cash: 'Cash', netbanking: 'Net banking', other: 'Other' };

async function accountNames(spaceId) {
  const accounts = await Account.find({ space: spaceId }).select('name').lean();
  const names = new Map(accounts.map((a) => [String(a._id), a.name]));
  return (id) => (id ? names.get(String(id)) ?? '' : '');
}

// Streams rows straight from MongoDB to the response, so a large history never sits in memory.
// Transfers are included as rows (they're part of the history) but never in income or expense totals.
export async function writeCsv(spaceId, query, res) {
  const nameOf = await accountNames(spaceId);
  const cursor = Transaction.find(buildFilter(spaceId, query, { includeTransfers: true })).sort(SORT[query.sort]).lean().cursor();
  // The byte-order mark lets Excel open the file as UTF-8 (names and notes in any language).
  res.write('﻿' + CSV_HEADER.join(',') + '\r\n');
  for await (const t of cursor) {
    const row = [
      dayString(t.date), t.time ?? '', t.type, categoryText(t), formatPaise(t.amountPaise, { grouping: false }),
      nameOf(t.account), nameOf(t.toAccount), METHOD_LABEL[t.paymentMethod] ?? '', (t.tags ?? []).map((g) => `#${g}`).join(' '),
      originalText(t), t.note,
    ];
    if (!res.write(row.map(csvCell).join(',') + '\r\n')) await new Promise((resolve) => res.once('drain', resolve));
  }
  res.end();
}

const describeFilters = ({ type, category, from, to, q }) => {
  const parts = [];
  parts.push(from || to ? `${from ? dayString(from) : 'start'} to ${to ? dayString(to) : 'today'}` : 'All dates');
  if (type) parts.push({ income: 'Income only', expense: 'Expenses only', transfer: 'Transfers only' }[type]);
  if (category?.length) parts.push(`Categories: ${category.join(', ')}`);
  if (q) parts.push(`Search: "${q}"`);
  return parts.join(' | ');
};

// The built-in PDF fonts have no ₹ glyph, so amounts are written as "Rs. 1,250.50".
const rs = (paise) => `Rs. ${formatPaise(paise)}`;

export async function countForPdf(spaceId, query) {
  const count = await Transaction.countDocuments(buildFilter(spaceId, query, { includeTransfers: true }));
  if (count > MAX_PDF_ROWS) {
    throw new HttpError(400, 'too_many_rows',
      `That's ${count} transactions; a PDF holds up to ${MAX_PDF_ROWS}. Narrow the dates or filters, or export CSV instead.`);
  }
  return count;
}

export async function writePdf(space, user, query, res) {
  const [totals, rowCount, nameOf] = await Promise.all([
    summary(space._id, query),
    countForPdf(space._id, query),
    accountNames(space._id),
  ]);
  const doc = new PDFDocument({
    size: 'A4',
    margin: 40,
    // Keeps every page open so "Page n of N" can be written at the end.
    bufferPages: true,
    // Uncompressed in tests so the content can be checked.
    compress: config.env !== 'test',
    info: { Title: 'Spendwise statement', Author: 'Spendwise', Subject: `Transactions for ${user.name}` },
  });
  doc.pipe(res);

  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const cols = [
    { label: 'Date', w: 62 },
    { label: 'Type', w: 50 },
    { label: 'Category', w: 92 },
    { label: 'Account', w: 92 },
    { label: 'Note', w: width - 62 - 50 - 92 - 92 - 90 },
    { label: 'Amount', w: 90, align: 'right' },
  ];
  const AMOUNT = cols.length - 1;

  doc.font('Helvetica-Bold').fontSize(18).text('Spendwise statement');
  doc.moveDown(0.3).font('Helvetica').fontSize(10).fillColor('#444')
    .text(`${user.name} | ${user.email}${space.kind === 'shared' ? ` | Space: ${space.name}` : ''}`)
    .text(describeFilters(query))
    .text(`Generated ${dayString(new Date())}`);

  doc.moveDown(0.8);
  const cards = [['Income', totals.income.paise], ['Expenses', totals.expense.paise], ['Balance', totals.balance.paise]];
  const cardW = width / 3;
  const cardY = doc.y;
  cards.forEach(([label, paise], i) => {
    doc.font('Helvetica').fontSize(9).fillColor('#666').text(label, left + i * cardW, cardY, { width: cardW });
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#000').text(rs(paise), left + i * cardW, cardY + 12, { width: cardW });
  });
  const transfers = rowCount - totals.count;
  doc.font('Helvetica').fontSize(9).fillColor('#666').text(
    `${totals.count} transactions${transfers ? ` + ${transfers} transfer${transfers === 1 ? '' : 's'} between your accounts (not counted in the totals)` : ''}`,
    left, cardY + 36,
  );
  doc.moveDown(0.8);

  const drawHeader = () => {
    const y = doc.y;
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#000');
    let x = left;
    for (const c of cols) {
      doc.text(c.label, x + 2, y, { width: c.w - 4, align: c.align ?? 'left' });
      x += c.w;
    }
    doc.moveTo(left, y + 13).lineTo(left + width, y + 13).strokeColor('#999').stroke();
    doc.y = y + 18;
  };

  drawHeader();
  const bottom = () => doc.page.height - doc.page.margins.bottom - 20;

  if (rowCount === 0) {
    doc.font('Helvetica').fontSize(9).fillColor('#666').text('No transactions match these filters.', left, doc.y);
  }

  const sign = { expense: '-', income: '+', transfer: '' };
  const cursor = Transaction.find(buildFilter(space._id, query, { includeTransfers: true })).sort(SORT[query.sort]).lean().cursor();
  for await (const t of cursor) {
    const account = t.type === 'transfer' ? `${nameOf(t.account)} -> ${nameOf(t.toAccount)}` : nameOf(t.account);
    const extra = [originalText(t), (t.tags ?? []).map((g) => `#${g}`).join(' ')].filter(Boolean).join(' | ');
    const note = [t.note, extra].filter(Boolean).join(' | ');
    const cells = [dayString(t.date), t.type, categoryText(t), account, note, sign[t.type] + rs(t.amountPaise)];
    doc.font('Helvetica').fontSize(9);
    const rowH = Math.max(...cells.map((text, i) => doc.heightOfString(text, { width: cols[i].w - 4 }))) + 6;
    if (doc.y + rowH > bottom()) {
      doc.addPage();
      drawHeader();
      doc.font('Helvetica').fontSize(9);
    }
    const y = doc.y;
    let x = left;
    cells.forEach((text, i) => {
      let color = '#000';
      if (i === AMOUNT) color = { expense: '#b00020', income: '#0a7a33', transfer: '#444' }[t.type];
      doc.fillColor(color).text(text, x + 2, y, { width: cols[i].w - 4, align: cols[i].align ?? 'left' });
      x += cols[i].w;
    });
    doc.y = y + rowH;
  }

  // Page numbers, written once every page exists.
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.font('Helvetica').fontSize(8).fillColor('#888')
      .text(`Page ${i + 1} of ${range.count}`, left, doc.page.height - doc.page.margins.bottom - 10, {
        width, align: 'right', lineBreak: false,
      });
  }
  doc.end();
}
