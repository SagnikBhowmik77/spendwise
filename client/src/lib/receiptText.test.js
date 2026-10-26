import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReceipt } from './receiptText.js';

const today = '2026-10-25';

test('a restaurant bill: the grand total, not the sub total, and the shop from the top', () => {
  const text = [
    'TAX INVOICE',
    'Hotel Saravana Bhavan',
    'GSTIN 33AAAAA0000A1Z5',
    'Date: 21/10/2026  Time 13:05',
    'Masala Dosa 2 x 90.00   180.00',
    'Filter Coffee           60.00',
    'Sub Total              240.00',
    'CGST 2.5%                6.00',
    'SGST 2.5%                6.00',
    'Grand Total  Rs. 252.00',
  ].join('\n');
  assert.deepEqual(parseReceipt(text, { today }), { amount: '252', date: '2026-10-21', merchant: 'Hotel Saravana Bhavan' });
});

test('amounts with Indian commas, dates written with a month name, and no total line', () => {
  const text = 'Croma\nReliance Retail\n12 Oct 2026\nSamsung 43in TV 1,24,999.00\nCard ending 1234';
  assert.deepEqual(parseReceipt(text, { today }), { amount: '124999', date: '2026-10-12', merchant: 'Croma' });
});

test('a date in the future or an impossible one is not used', () => {
  assert.equal(parseReceipt('Shop\n31/02/2026\nTotal 50', { today }).date, null);
  assert.equal(parseReceipt('Shop\n01/12/2026\nTotal 50', { today }).date, null);
  assert.equal(parseReceipt('Shop\n01-10-26\nTotal 50', { today }).date, '2026-10-01');
});

test('nothing found is null, never a guess', () => {
  assert.deepEqual(parseReceipt('', { today }), { amount: null, date: null, merchant: null });
});
