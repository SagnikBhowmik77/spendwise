import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { bodyRows, findHeaderRow, guessMapping, headerSignature, matchLayout, readStatement } from './importFile.js';

const csv = [
  'Account statement for XXXXXXXX1234',
  'Period,01/10/2026 to 23/10/2026',
  '',
  'Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance',
  '05/10/26,"UPI-SWIGGY-SWIGGY8@YBL-YESB0YBLUPI-312345678901-PAYMENT",0000312345678901,05/10/26,450.00,,"49,550.00"',
  '15/10/26,NEFT CR-HDFC0000001-ACME CORP,N123,15/10/26,,"25,000.00","74,550.00"',
].join('\n');

test('a CSV keeps its text exactly, and the header row is found under the account details', async () => {
  const [sheet] = await readStatement(new TextEncoder().encode(csv), 'hdfc.csv');
  const h = findHeaderRow(sheet.rows);
  assert.equal(h, 3);
  assert.deepEqual(sheet.rows[4].slice(0, 5), ['05/10/26', 'UPI-SWIGGY-SWIGGY8@YBL-YESB0YBLUPI-312345678901-PAYMENT', '0000312345678901', '05/10/26', '450.00']);
  assert.deepEqual(bodyRows(sheet.rows, h).map((r) => r.line), [5, 6]);
  assert.deepEqual(guessMapping(sheet.rows[h]), {
    date: 0, description: 1, time: null, amount: null, debit: 4, credit: 5, drcr: null, sign: 'negative-is-spending', dateFormat: 'auto',
  });
});

test('Excel dates become YYYY-MM-DD, numbers stay unformatted', async () => {
  const ws = XLSX.utils.aoa_to_sheet([
    ['Transaction Date', 'Details', 'Amount', 'Dr/Cr'],
    [new Date(2026, 9, 5), 'SWIGGY BANGALORE IN', 1234.5, 'Dr'],
  ], { cellDates: false });
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, ws, 'Statement');
  const data = XLSX.write(book, { type: 'array', bookType: 'xlsx' });
  const [sheet] = await readStatement(new Uint8Array(data), 'card.xlsx');
  assert.equal(sheet.name, 'Statement');
  assert.deepEqual(sheet.rows[1], ['2026-10-05', 'SWIGGY BANGALORE IN', '1234.5', 'Dr']);
  const m = guessMapping(sheet.rows[0], { card: true });
  assert.deepEqual([m.date, m.description, m.amount, m.debit, m.drcr, m.sign], [0, 1, 2, null, 3, 'positive-is-spending']);
});

test('a saved layout is recognised by its header', () => {
  const rows = [['Bank of X'], ['Date', 'Narration', 'Amount'], ['05/10/26', 'A', '1']];
  const layouts = [{ name: 'X', signature: headerSignature(['date', ' Narration ', 'AMOUNT']) }];
  assert.deepEqual(matchLayout(rows, layouts), { layout: layouts[0], headerIndex: 1 });
  assert.equal(matchLayout(rows, []), null);
});

test('files that are not statements are refused clearly', async () => {
  await assert.rejects(readStatement(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]), 'broken.xlsx'), /couldn’t be read/);
});
