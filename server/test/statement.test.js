// Batch 12C: reading statement lines. Narrations follow the formats Indian banks print.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectDateFormat, normaliseRows, parseAmount, parseDateCell } from '../src/statement.js';
import { builtinCategory, extractMerchant, guessPaymentMethod, transferHint } from '../src/merchants.js';

test('amounts in the shapes banks print them', () => {
  assert.deepEqual(parseAmount('₹1,23,456.78'), { paise: 12345678, marker: null });
  assert.deepEqual(parseAmount('1234.5 Dr'), { paise: 123450, marker: 'dr' });
  assert.deepEqual(parseAmount('CR 10'), { paise: 1000, marker: 'cr' });
  assert.deepEqual(parseAmount('(250.00)'), { paise: -25000, marker: null });
  assert.deepEqual(parseAmount('-99'), { paise: -9900, marker: null });
  assert.deepEqual(parseAmount('99-'), { paise: -9900, marker: null });
  assert.deepEqual(parseAmount('Rs. 40'), { paise: 4000, marker: null });
  assert.deepEqual(parseAmount('1234.5600000001'), { paise: 123456, marker: null });
  assert.deepEqual(parseAmount('0.995'), { paise: 100, marker: null });
  assert.equal(parseAmount('  '), null);
  assert.deepEqual(parseAmount('abc'), { invalid: true });
});

test('dates in day-first, month-first, ISO and month-name forms', () => {
  assert.deepEqual(parseDateCell('23/10/2026'), { day: '2026-10-23', time: null });
  assert.deepEqual(parseDateCell('23-10-26'), { day: '2026-10-23', time: null });
  assert.deepEqual(parseDateCell('23.10.2026 21:05'), { day: '2026-10-23', time: '21:05' });
  assert.deepEqual(parseDateCell('10/23/2026', 'MDY'), { day: '2026-10-23', time: null });
  assert.deepEqual(parseDateCell('2026-10-23 09:30:00'), { day: '2026-10-23', time: '09:30' });
  assert.deepEqual(parseDateCell('23-Oct-2026'), { day: '2026-10-23', time: null });
  assert.deepEqual(parseDateCell("23 Oct '26 10:15 PM"), { day: '2026-10-23', time: '22:15' });
  assert.deepEqual(parseDateCell('Oct 23, 2026'), { day: '2026-10-23', time: null });
  assert.equal(parseDateCell('31/02/2026'), null);
  assert.equal(parseDateCell('Opening balance'), null);
  assert.equal(detectDateFormat(['05/10/2026', '23/10/2026']), 'DMY');
  assert.equal(detectDateFormat(['10/05/2026', '10/23/2026']), 'MDY');
  assert.equal(detectDateFormat(['05/10/2026']), 'DMY');
});

test('merchant names from UPI, NEFT, IMPS, ACH, card and POS narrations', () => {
  const cases = [
    ['UPI-SWIGGY-SWIGGY8@YBL-YESB0YBLUPI-123456789012-PAYMENT FROM PHONE', 'Swiggy'],
    ['UPI/DR/312345678901/SWIGGY/YESB/swiggy@ybl/Payme', 'Swiggy'],
    ['UPI/P2M/312345678901/SWIGGY LIMITED/UPI/AXIS BANK', 'Swiggy'],
    ['UPI/312345678901/Payment from Ph/zomato@icici/Zomato Limi', 'Zomato'],
    ['NEFT-HDFCN52026101234567-ACME TECHNOLOGIES PVT LTD-SALARY OCT', 'Acme Technologies'],
    ['NEFT CR-HDFC0000001-ACME CORP-OCT SALARY', 'Acme Corp'],
    ['IMPS/P2A/312345678901/RAHUL SHARMA/HDFC/xxxx', 'Rahul Sharma'],
    ['ACH D- TP ACH BAJAJ FINANCE-1234567', 'Bajaj Finance'],
    ['BIL/ONL/000123456789/AIRTEL/AIRTEL0001', 'Airtel'],
    ['POS 416021XXXXXX1234 AMAZON PAY IN E COMM POS DEBIT', 'Amazon Pay'],
    ['SWIGGY BANGALORE IN', 'Swiggy'],
    ['WWW.MAKEMYTRIP.COM NEW DELHI IN', 'Makemytrip'],
    ['KFC GURGAON', 'KFC'],
  ];
  for (const [narration, merchant] of cases) assert.equal(extractMerchant(narration), merchant, narration);
  assert.equal(extractMerchant('ATW-416021XXXXXX1234-S1ANMU12-MUMBAI'), null);
  assert.equal(extractMerchant('123456789012'), null);
});

test('payment method, transfer hints and built-in categories', () => {
  assert.equal(guessPaymentMethod('UPI/DR/312345678901/SWIGGY'), 'upi');
  assert.equal(guessPaymentMethod('POS 416021XXXXXX1234 AMAZON'), 'card');
  assert.equal(guessPaymentMethod('NEFT-HDFC0000001-ACME'), 'netbanking');
  assert.equal(guessPaymentMethod('SWIGGY BANGALORE'), null);
  assert.equal(transferHint('NWD-416021XXXXXX1234-S1ANMU12'), 'atm');
  assert.equal(transferHint('CC PAYMENT 4160XXXXXXXX1234'), 'card');
  assert.equal(transferHint('PAYMENT RECEIVED - THANK YOU'), 'card');
  assert.equal(transferHint('UPI/DR/312345678901/SWIGGY'), null);
  assert.equal(builtinCategory('UPI/DR/1/SWIGGY INSTAMART/YESB', 'expense'), 'Groceries');
  assert.equal(builtinCategory('UPI/DR/1/SWIGGY/YESB', 'expense'), 'Food & Dining');
  assert.equal(builtinCategory('NEFT-X-ACME-SALARY OCT', 'income'), 'Salary');
  assert.equal(builtinCategory('NEFT-X-ACME-SALARY OCT', 'expense'), null);
  assert.equal(builtinCategory('JIOMART ORDER', 'expense'), 'Groceries');
});

test('rows become entries; header, balance and total lines are reported, not imported', () => {
  const rows = [
    ['01/10/2026', 'Opening balance', '', '', '10,000.00'],
    ['05/10/2026', 'UPI/DR/312345678901/SWIGGY/YESB', '450.00', '', '9,550.00'],
    ['23/10/2026', 'NEFT CR-HDFC0000001-ACME CORP-SALARY', '', '85,000.00', '94,550.00'],
    ['', '', '', '', ''],
    ['Total', '', '450.00', '85,000.00', ''],
    ['26/10/2026', 'Next week', '1', '', ''],
  ].map((cells, i) => ({ line: i + 2, cells }));
  const { rows: out, dateFormat } = normaliseRows(rows, { date: 0, description: 1, debit: 2, credit: 3 }, { now: new Date('2026-10-24T06:00:00Z') });
  assert.equal(dateFormat, 'DMY');
  assert.deepEqual(out.map((r) => [r.line, r.date, r.type, r.amountPaise, r.error]), [
    [2, '2026-10-01', null, null, 'No amount'],
    [3, '2026-10-05', 'expense', 45000, null],
    [4, '2026-10-23', 'income', 8500000, null],
    [6, null, null, null, 'No date that can be read'],
    [7, null, null, null, 'Date is in the future'],
  ]);
});

test('one amount column: sign styles, Dr/Cr markers and a Dr/Cr column', () => {
  const rows = [['2026-10-05', 'A', '-120'], ['2026-10-06', 'B', '300'], ['2026-10-07', 'C', '50 Cr'], ['2026-10-08', 'D', '75', 'DR']]
    .map((cells, i) => ({ line: i + 1, cells }));
  const now = { now: new Date('2026-10-24T06:00:00Z') };
  const bank = normaliseRows(rows, { date: 0, description: 1, amount: 2, drcr: 3, sign: 'negative-is-spending' }, now).rows;
  assert.deepEqual(bank.map((r) => r.type), ['expense', 'income', 'income', 'expense']);
  const card = normaliseRows(rows, { date: 0, description: 1, amount: 2, drcr: 3, sign: 'positive-is-spending' }, now).rows;
  assert.deepEqual(card.map((r) => r.type), ['income', 'expense', 'income', 'expense']);
});
