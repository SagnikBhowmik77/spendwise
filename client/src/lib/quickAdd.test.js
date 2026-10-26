import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuickAdd } from './quickAdd.js';

// Friday 23 October 2026.
const ctx = { today: '2026-10-23', accounts: [{ id: 'a1', name: 'HDFC Savings' }, { id: 'a2', name: 'Cash' }] };
const parse = (text) => parseQuickAdd(text, ctx);

test('the example from the brief', () => {
  assert.deepEqual(parse('450 swiggy dinner yesterday'), {
    type: 'expense', amount: '450', category: 'Food & Dining', date: '2026-10-22', time: null,
    paymentMethod: null, tags: [], account: null, note: 'Swiggy dinner',
  });
});

test('amounts in different forms', () => {
  assert.equal(parse('₹1,250.50 groceries').amount, '1250.5');
  assert.equal(parse('rs 99 chai').amount, '99');
  assert.equal(parse('1.2k shoes on amazon').amount, '1200');
  assert.equal(parse('lunch with team').amount, null);
});

test('income words, payment methods, tags, accounts and time', () => {
  const r = parse('salary 52000 credited to hdfc');
  assert.deepEqual([r.type, r.category, r.account], ['income', 'Salary', 'a1']);
  const e = parse('350 petrol upi #office 9pm');
  assert.deepEqual([e.category, e.paymentMethod, e.tags, e.time, e.amount], ['Fuel', 'upi', ['office'], '21:00', '350']);
  assert.equal(parse('120 auto 18:45 cash').time, '18:45');
  assert.equal(parse('120 auto 18:45 cash').paymentMethod, 'cash');
});

test('dates never land in the future', () => {
  assert.equal(parse('200 movie monday').date, '2026-10-19');
  assert.equal(parse('200 movie friday').date, '2026-10-23');
  assert.equal(parse('200 movie last friday').date, '2026-10-16');
  assert.equal(parse('500 rent 1 oct').date, '2026-10-01');
  // 5 November hasn't happened yet this year, so it means last year.
  assert.equal(parse('500 gift nov 5').date, '2025-11-05');
  assert.equal(parse('80 milk 20/10').date, '2026-10-20');
  assert.equal(parse('80 milk day before yesterday').date, '2026-10-21');
  assert.equal(parse('80 milk').date, '2026-10-23');
});

test('Hindi: digits, date words, categories and the note', () => {
  assert.deepEqual(parse('२०० चाय कल'), {
    type: 'expense', amount: '200', category: 'Food & Dining', date: '2026-10-22', time: null,
    paymentMethod: null, tags: [], account: null, note: 'चाय',
  });
  // कल can mean tomorrow too, but an entry is never in the future, so it is yesterday.
  assert.equal(parse('500 पेट्रोल परसों').date, '2026-10-21');
  assert.equal(parse('500 पेट्रोल आज').date, '2026-10-23');
  assert.equal(parse('300 दवाई सोमवार').date, '2026-10-19');
  assert.equal(parse('300 फिल्म पिछले शुक्रवार').date, '2026-10-16');
  assert.equal(parse('300 पेट्रोल').category, 'Fuel');
  assert.equal(parse('12000 किराया').category, 'Rent');
  // "दवाखाना" is a clinic, not food, even though it ends in "खाना".
  assert.equal(parse('400 दवाखाना').category, 'Health');
  assert.equal(parse('चाय के लिए 200 रुपये दिए').note, 'चाय');
  assert.equal(parse('चाय के लिए 200 रुपये दिए').amount, '200');
});

test('Hindi: income, amounts in thousands, payment words, nukta either way', () => {
  const r = parse('५०००० सैलरी मिली');
  assert.deepEqual([r.type, r.category, r.amount], ['income', 'Salary', '50000']);
  assert.equal(parse('2 हज़ार कपड़े').amount, '2000');
  assert.equal(parse('2 हज़ार कपड़े').category, 'Shopping');
  assert.equal(parse('250 सब्ज़ी यूपीआई').paymentMethod, 'upi');
  assert.equal(parse('250 सब्जी नकद').paymentMethod, 'cash');
  assert.equal(parse('250 सब्ज़ी').category, 'Groceries');
  assert.equal(parse('80 khana').category, 'Food & Dining');
  assert.equal(parse('640 पड़ोस की दुकान').category, null);
});

test('unknown merchants leave the category for you to pick', () => {
  const r = parse('640 sharma ji ki dukaan');
  assert.equal(r.category, null);
  assert.equal(r.note, 'Sharma ji ki dukaan');
});
