import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, uniqueEmail, GOOD_PASSWORD, personalSpace } from './helpers.js';
import { formatPaise } from '../src/money.js';
import { csvCell, MAX_PDF_ROWS } from '../src/services/export.service.js';
import { Transaction } from '../src/models/index.js';

let t;
let token;

const newUser = async () =>
  (await t.api('POST', '/api/auth/register', { body: { name: 'Neel', email: uniqueEmail(), password: GOOD_PASSWORD } })).body;

// Raw download: the shared helper parses JSON, exports are files.
const download = async (path, tk = token) => {
  const res = await fetch(t.base + path, { headers: tk ? { authorization: `Bearer ${tk}` } : {} });
  return { status: res.status, headers: res.headers, bytes: Buffer.from(await res.arrayBuffer()) };
};

before(async () => {
  t = await startTestServer();
  token = (await newUser()).token;
  const entries = [
    { type: 'income', amount: '50000', category: 'Salary', date: '2026-09-30', note: 'September salary' },
    { type: 'expense', amount: '1250.5', category: 'Food & Dining', date: '2026-10-05', note: 'Dinner, with "team"' },
    { type: 'expense', amount: '99', category: 'Shopping', date: '2026-10-06', note: '=HYPERLINK("http://x")', paymentMethod: 'upi' },
    { type: 'expense', amount: '0.05', category: 'Other', date: '2026-10-07', note: 'line one\nline two' },
  ];
  for (const body of entries) assert.equal((await t.api('POST', '/api/transactions', { token, body })).status, 201);
});
after(() => t.stop());

test('amounts are formatted exactly, with Indian digit grouping', () => {
  assert.equal(formatPaise(12345050), '1,23,450.50');
  assert.equal(formatPaise(-526975), '-5,269.75');
  assert.equal(formatPaise(5), '0.05');
  assert.equal(formatPaise(12345050, { grouping: false }), '123450.50');
});

test('CSV cells are quoted and protected against spreadsheet formulas', () => {
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('=1+1'), "'=1+1");
  assert.equal(csvCell('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(csvCell('-5'), "'-5");
  assert.equal(csvCell('two\nlines'), '"two\nlines"');
  assert.equal(csvCell(null), '');
});

test('CSV export downloads every matching row as a UTF-8 file', async () => {
  const res = await download('/api/export/transactions.csv');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/csv/);
  assert.match(res.headers.get('content-disposition'), /^attachment; filename="spendwise-transactions-\d{4}-\d{2}-\d{2}\.csv"$/);
  assert.deepEqual([...res.bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);

  const text = res.bytes.subarray(3).toString('utf8');
  assert.equal(
    text,
    [
      'Date,Time,Type,Category,Amount (INR),Account,To account,Payment method,Tags,Original amount,Note',
      '2026-10-07,,expense,Other,0.05,Cash,,,,,"line one\nline two"',
      "2026-10-06,,expense,Shopping,99.00,Cash,,UPI,,,\"'=HYPERLINK(\"\"http://x\"\")\"",
      '2026-10-05,,expense,Food & Dining,1250.50,Cash,,,,,"Dinner, with ""team"""',
      '2026-09-30,,income,Salary,50000.00,Cash,,,,,September salary',
      '',
    ].join('\r\n'),
  );
});

test('CSV export uses the same filters and sort as the list', async () => {
  const income = (await download('/api/export/transactions.csv?type=income')).bytes.toString('utf8');
  assert.equal(income.trim().split('\r\n').length, 2);
  assert.match(income, /Salary/);

  const byAmount = (await download('/api/export/transactions.csv?type=expense&sort=-amount')).bytes.toString('utf8');
  const amounts = byAmount.trim().split('\r\n').slice(1).map((line) => line.split(',')[4]);
  assert.deepEqual(amounts, ['1250.50', '99.00', '0.05']);

  assert.equal((await download('/api/export/transactions.csv?from=2026-10-09&to=2026-10-01')).status, 400);
});

test('PDF export is a real, multi-page PDF statement', async () => {
  const res = await download('/api/export/transactions.pdf');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  assert.match(res.headers.get('content-disposition'), /filename="spendwise-transactions-.*\.pdf"/);
  const pdf = res.bytes.toString('latin1');
  assert.ok(pdf.startsWith('%PDF-'));
  assert.ok(pdf.trimEnd().endsWith('%%EOF'));
  // pdfkit writes the title as its own object: "/Title 14 0 R" ... "(Spendwise statement)".
  assert.match(pdf, /\/Title \d+ 0 R/);
  assert.match(pdf, /\(Spendwise statement\)/);
  // Text is hex-encoded in the page stream; the balance card reads "Rs. 48,650.45".
  assert.ok(pdf.includes(Buffer.from(' 48,650.45').toString('hex')));
  assert.equal(pdf.match(/\/Type \/Page\b/g).length, 1);

  // Enough rows to need several pages.
  const { user, token: busy } = await newUser();
  const ps = await personalSpace(user.id);
  await Transaction.insertMany(Array.from({ length: 120 }, (_, i) => ({
    ...ps, user: user.id, type: 'expense', amountPaise: 100 + i, category: 'Groceries', date: new Date('2026-10-01'),
  })));
  const big = (await download('/api/export/transactions.pdf', busy)).bytes.toString('latin1');
  assert.ok(big.match(/\/Type \/Page\b/g).length >= 3);
});

test('PDF export refuses huge exports with a clear JSON error; empty exports still work', async () => {
  const { user, token: huge } = await newUser();
  const ps = await personalSpace(user.id);
  await Transaction.insertMany(Array.from({ length: MAX_PDF_ROWS + 1 }, () => ({
    ...ps, user: user.id, type: 'expense', amountPaise: 100, category: 'Other', date: new Date('2026-10-01'),
  })));
  const res = await t.api('GET', '/api/export/transactions.pdf', { token: huge });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'too_many_rows');
  // Narrowing the filters, or using CSV, still works.
  assert.equal((await download('/api/export/transactions.csv', huge)).status, 200);

  const empty = await download('/api/export/transactions.pdf', (await newUser()).token);
  assert.equal(empty.status, 200);
  assert.ok(empty.bytes.toString('latin1').startsWith('%PDF-'));
});

test('exports need a login and only contain the user’s own data', async () => {
  assert.equal((await download('/api/export/transactions.csv', null)).status, 401);
  assert.equal((await download('/api/export/transactions.pdf', null)).status, 401);
  const other = (await download('/api/export/transactions.csv', (await newUser()).token)).bytes.toString('utf8');
  assert.equal(other, '﻿Date,Time,Type,Category,Amount (INR),Account,To account,Payment method,Tags,Original amount,Note\r\n');
});
