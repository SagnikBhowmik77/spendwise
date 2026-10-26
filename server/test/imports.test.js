// Batch 12C: importing bank and card statements.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, uniqueEmail, GOOD_PASSWORD } from './helpers.js';

let t;
const newUser = async () =>
  (await t.api('POST', '/api/auth/register', { body: { name: 'Kabir', email: uniqueEmail(), password: GOOD_PASSWORD } })).body.token;
const call = (method, path, body, tk) => t.api(method, path, { token: tk, body });

// An HDFC-style savings statement: separate withdrawal and deposit columns, a balance column,
// plus the opening-balance and total lines real statements have.
const HEADER = ['Date', 'Narration', 'Chq./Ref.No.', 'Withdrawal Amt.', 'Deposit Amt.', 'Closing Balance'];
const LINES = [
  ['01/10/26', 'OPENING BALANCE', '', '', '', '50,000.00'],
  ['05/10/26', 'UPI-SWIGGY-SWIGGY8@YBL-YESB0YBLUPI-312345678901-PAYMENT FROM PHONE', '0000312345678901', '450.00', '', '49,550.00'],
  ['06/10/26', 'UPI-ZEPTO MARKETPLACE-ZEPTO@YBL-YESB0YBLUPI-312345678902-ORDER', '0000312345678902', '812.40', '', '48,737.60'],
  ['07/10/26', 'NWD-416021XXXXXX1234-S1ANMU12-MUMBAI', '000123', '2,000.00', '', '46,737.60'],
  ['15/10/26', 'NEFT CR-HDFC0000001-ACME CORP-OCT INVOICE', 'N123456789', '', '25,000.00', '71,737.60'],
  ['20/10/26', 'POS 416021XXXXXX1234 DMART AVENUE SUPERMARTS', '000124', '1,240.00', '', '70,497.60'],
  ['', 'STATEMENT SUMMARY', '', '4,502.40', '25,000.00', ''],
];
const MAPPING = { date: 0, description: 1, debit: 3, credit: 4, dateFormat: 'auto' };
const rows = (lines = LINES) => lines.map((cells, i) => ({ line: i + 2, cells }));

let tk;
let cash;
let hdfc;
before(async () => {
  t = await startTestServer();
  tk = await newUser();
  cash = (await call('GET', '/api/accounts', undefined, tk)).body.accounts[0].id;
  hdfc = (await call('POST', '/api/accounts', { name: 'HDFC Savings', type: 'bank', openingBalance: '50000' }, tk)).body.account.id;
});
after(() => t.stop());

const preview = (body = {}, token = tk) =>
  call('POST', '/api/imports/preview', { account: hdfc, header: HEADER, rows: rows(), mapping: MAPPING, ...body }, token);
// What the app sends back after the preview: every line that's ready, as previewed.
const toCommit = (previewRows, { duplicates = false } = {}) => previewRows.filter((r) => !r.error && (duplicates || !r.duplicate)).map((r) => ({
  ref: r.ref, date: r.date, time: r.time, type: r.type, direction: r.direction ?? undefined, otherAccount: r.otherAccount,
  amountPaise: r.amountPaise, category: r.category ?? undefined, merchant: r.merchant, note: r.description, paymentMethod: r.paymentMethod,
}));

test('a preview reads the statement, suggests categories and spots transfers and duplicates', async () => {
  // A hand-typed entry teaches that Zepto is "Household" here, and this ₹450 Swiggy order is already noted.
  await call('POST', '/api/transactions', { type: 'expense', amount: '300', category: 'Household', note: 'Zepto top-up', date: '2026-09-20' }, tk);
  await call('POST', '/api/transactions', { type: 'expense', amount: '450', category: 'Food & Dining', note: 'Swiggy', date: '2026-10-04' }, tk);
  // A rule for the client who pays invoices.
  assert.equal((await call('POST', '/api/imports/rules', { pattern: 'ACME Corp', type: 'income', category: 'Freelance' }, tk)).status, 201);

  const res = await preview();
  assert.equal(res.status, 200);
  assert.equal(res.body.dateFormat, 'DMY');
  assert.deepEqual(res.body.counts, { ready: 4, duplicates: 1, skipped: 2 });
  const byLine = Object.fromEntries(res.body.rows.map((r) => [r.line, r]));
  assert.equal(byLine[2].error, 'No amount');
  assert.equal(byLine[8].error, 'No date that can be read');

  assert.equal(byLine[3].merchant, 'Swiggy');
  assert.equal(byLine[3].paymentMethod, 'upi');
  assert.equal(byLine[3].duplicate.kind, 'existing');
  assert.match(byLine[3].duplicate.message, /₹450\.00 · Food & Dining on 4 Oct/);

  assert.deepEqual([byLine[4].merchant, byLine[4].category, byLine[4].categorySource], ['Zepto Marketplace', 'Household', 'learned']);
  // The ATM withdrawal becomes a transfer into the Cash account.
  assert.deepEqual([byLine[5].type, byLine[5].direction, byLine[5].otherAccount, byLine[5].transferHint], ['transfer', 'out', cash, 'atm']);
  assert.deepEqual([byLine[6].type, byLine[6].amountPaise, byLine[6].category, byLine[6].categorySource], ['income', 2500000, 'Freelance', 'rule']);
  assert.deepEqual([byLine[7].merchant, byLine[7].category, byLine[7].categorySource, byLine[7].paymentMethod], ['Dmart Avenue Supermarts', 'Groceries', 'suggested', 'card']);
  // Nothing is saved by a preview.
  assert.equal((await call('GET', '/api/transactions', undefined, tk)).body.total, 2);
});

test('importing saves the entries, the layout and new rules; the same statement is caught next time', async () => {
  const p = (await preview()).body;
  const res = await call('POST', '/api/imports', {
    account: hdfc,
    fileName: 'hdfc-oct.csv',
    rows: toCommit(p.rows),
    rules: [{ pattern: 'dmart', type: 'expense', category: 'Groceries' }],
    layout: { name: 'HDFC savings', header: HEADER, mapping: MAPPING },
  }, tk);
  assert.equal(res.status, 201);
  assert.deepEqual([res.body.import.count, res.body.import.accountName, res.body.import.fileName], [4, 'HDFC Savings', 'hdfc-oct.csv']);

  const list = (await call('GET', '/api/transactions?account=' + hdfc, undefined, tk)).body.items;
  assert.equal(list.length, 4);
  const swiggyless = list.find((x) => x.merchant === 'Zepto Marketplace');
  assert.deepEqual([swiggyless.category, swiggyless.paymentMethod, swiggyless.importBatchId], ['Household', 'upi', res.body.import.id]);
  // Balances: 50,000 − 812.40 − 2,000 (to cash) + 25,000 − 1,240 = 70,947.60; cash gains 2,000 (it started with 300 + 450 spent).
  const accounts = Object.fromEntries((await call('GET', '/api/accounts', undefined, tk)).body.accounts.map((a) => [a.id, a.balance.paise]));
  assert.equal(accounts[hdfc], 7094760);
  assert.equal(accounts[cash], 200000 - 75000);
  // The ATM transfer is not spending.
  assert.equal((await call('GET', '/api/stats/summary?from=2026-10-01&to=2026-10-31', undefined, tk)).body.expense.paise, 45000 + 81240 + 124000);
  // Merchant names are searchable.
  assert.equal((await call('GET', '/api/transactions?q=zepto%20market', undefined, tk)).body.total, 1);

  assert.deepEqual((await call('GET', '/api/imports/rules', undefined, tk)).body.rules.map((r) => [r.pattern, r.category]), [['acme corp', 'Freelance'], ['dmart', 'Groceries']]);
  const layouts = (await call('GET', '/api/imports/layouts', undefined, tk)).body.layouts;
  assert.deepEqual([layouts[0].name, layouts[0].signature, layouts[0].mapping.debit], ['HDFC savings', 'date|narration|chq./ref.no.|withdrawal amt.|deposit amt.|closing balance', 3]);

  const again = (await preview()).body;
  assert.deepEqual(again.counts, { ready: 0, duplicates: 5, skipped: 2 });
  assert.ok(again.rows.filter((r) => r.duplicate).every((r) => r.duplicate.kind === 'imported' || r.line === 3));
  assert.match((await call('GET', '/api/activity', undefined, tk)).body.items[0].summary, /^Imported 4 entries from hdfc-oct\.csv into HDFC Savings$/);
});

test('an import can be undone and brought back as a whole', async () => {
  const [batch] = (await call('GET', '/api/imports', undefined, tk)).body.imports;
  assert.equal((await call('DELETE', `/api/imports/${batch.id}`, undefined, tk)).body.removed, 4);
  assert.equal((await call('GET', '/api/transactions?account=' + hdfc, undefined, tk)).body.total, 0);
  assert.equal((await call('DELETE', `/api/imports/${batch.id}`, undefined, tk)).status, 409);
  assert.ok((await call('GET', '/api/imports', undefined, tk)).body.imports[0].undoneAt);
  // Undone lines are no longer "already imported".
  assert.equal((await preview()).body.counts.ready, 4);

  // Another person can't touch it.
  const stranger = await newUser();
  assert.equal((await call('POST', `/api/imports/${batch.id}/restore`, undefined, stranger)).status, 404);
  assert.equal((await call('POST', '/api/imports/preview', { account: hdfc, header: HEADER, rows: rows(), mapping: MAPPING }, stranger)).status, 400);

  assert.equal((await call('POST', `/api/imports/${batch.id}/restore`, undefined, tk)).body.restored, 4);
  assert.equal((await call('GET', '/api/transactions?account=' + hdfc, undefined, tk)).body.total, 4);
  assert.equal((await call('POST', `/api/imports/${batch.id}/restore`, undefined, tk)).status, 409);
});

test('imported merchants teach the next import; card statements use one signed amount column', async () => {
  const card = (await call('POST', '/api/accounts', { name: 'ICICI Amazon Pay card', type: 'credit_card' }, tk)).body.account.id;
  const lines = [
    ['18 Oct 2026', 'ZEPTO MARKETPLACE BANGALORE IN', '640.00'],
    ['19 Oct 2026', 'AMAZON PAY INDIA PRIVATE LIMITED MUMBAI', '1,999.00'],
    ['21 Oct 2026', 'PAYMENT RECEIVED - THANK YOU', '-5,000.00'],
    ['22 Oct 2026', 'NETFLIX.COM MUMBAI', '649.00'],
  ];
  const res = await call('POST', '/api/imports/preview', {
    account: card, header: ['Date', 'Details', 'Amount'], rows: rows(lines),
    mapping: { date: 0, description: 1, amount: 2, sign: 'positive-is-spending' },
  }, tk);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.rows.map((r) => [r.merchant, r.type, r.amountPaise, r.category, r.categorySource]), [
    ['Zepto Marketplace', 'expense', 64000, 'Household', 'learned'],
    ['Amazon Pay', 'expense', 199900, 'Shopping', 'suggested'],
    // The card bill payment comes from the one bank account.
    ['Payment Received Thank You', 'transfer', 500000, null, null],
    ['Netflix', 'expense', 64900, 'Entertainment', 'suggested'],
  ]);
  assert.deepEqual([res.body.rows[2].direction, res.body.rows[2].otherAccount], ['in', hdfc]);
});

test('bad mappings, other spaces\' accounts and big files', async () => {
  const noAmount = await preview({ mapping: { date: 0, description: 1, debit: 3 } });
  assert.equal(noAmount.status, 400);
  assert.equal(noAmount.body.error.details[0].field, 'mapping.credit');
  assert.equal((await preview({ mapping: { date: 0, description: 1 } })).body.error.details[0].field, 'mapping.amount');
  assert.equal((await preview({ rows: [] })).status, 400);

  const stranger = await newUser();
  const theirs = (await call('GET', '/api/accounts', undefined, stranger)).body.accounts[0].id;
  assert.equal((await preview({ account: theirs })).status, 400);
  const p = (await preview()).body;
  const bad = await call('POST', '/api/imports', { account: hdfc, rows: toCommit(p.rows, { duplicates: true }).map((r) => (r.type === 'transfer' ? { ...r, otherAccount: theirs } : r)) }, tk);
  assert.equal(bad.status, 400);
  assert.match(bad.body.error.details[0].field, /^rows\.\d+\.otherAccount$/);
  assert.equal((await call('POST', '/api/imports', { account: hdfc, rows: [{ ...toCommit(p.rows, { duplicates: true })[1], category: undefined, type: 'expense' }] }, tk)).status, 400);

  // A year of daily lines (well over the usual 100 KB body limit) previews fine.
  const many = Array.from({ length: 3000 }, (_, i) => [`2026-0${1 + (i % 9)}-${String(1 + (i % 28)).padStart(2, '0')}`, `UPI/DR/${312345678000 + i}/CHAI POINT/YESB/chai@ybl/Tea`, '', '20.00', '', '']);
  const big = await call('POST', '/api/imports/preview', { account: hdfc, header: HEADER, rows: rows(many), mapping: { date: 0, description: 1, amount: 3, sign: 'positive-is-spending' } }, tk);
  assert.equal(big.status, 200);
  assert.equal(big.body.counts.ready + big.body.counts.duplicates, 3000);
  const tooMany = Array.from({ length: 5001 }, () => ({ line: 1, cells: ['x'] }));
  assert.equal((await call('POST', '/api/imports/preview', { account: hdfc, rows: tooMany, mapping: MAPPING }, tk)).status, 400);
});

test('rules and layouts can be changed and removed', async () => {
  const again = await call('POST', '/api/imports/rules', { pattern: 'dmart', type: 'expense', category: 'Household' }, tk);
  assert.equal(again.status, 200);
  assert.equal(again.body.rule.category, 'Household');
  assert.equal((await call('POST', '/api/imports/rules', { pattern: 'x', type: 'expense', category: 'A' }, tk)).status, 400);
  assert.equal((await call('DELETE', `/api/imports/rules/${again.body.rule.id}`, undefined, tk)).status, 204);
  assert.equal((await call('DELETE', `/api/imports/rules/${again.body.rule.id}`, undefined, tk)).status, 404);

  const saved = await call('PUT', '/api/imports/layouts', { name: 'HDFC savings', header: HEADER, mapping: { ...MAPPING, dateFormat: 'DMY' } }, tk);
  assert.equal(saved.body.layout.mapping.dateFormat, 'DMY');
  assert.equal((await call('GET', '/api/imports/layouts', undefined, tk)).body.layouts.length, 1);
  assert.equal((await call('DELETE', `/api/imports/layouts/${saved.body.layout.id}`, undefined, tk)).status, 204);
  assert.equal((await call('GET', '/api/imports/layouts', undefined, tk)).body.layouts.length, 0);
});
