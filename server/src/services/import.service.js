import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { HttpError } from '../errors.js';
import { config } from '../config.js';
import { Account, ImportBatch, ImportProfile, ImportRule, MONEY_TYPES, Transaction } from '../models/index.js';
import { formatPaise, parseDay } from '../money.js';
import { headerSignature, normaliseRows } from '../statement.js';
import { builtinCategory, extractMerchant, guessPaymentMethod, transferHint } from '../merchants.js';
import { logActivity } from './activity.service.js';
import { emitSpaceEvent } from '../events.js';

export const MAX_IMPORT_ROWS = 5000;
const DAY_MS = 24 * 60 * 60 * 1000;
// Bank posting dates can trail the day you noted an entry by a day or two.
const DUPLICATE_WINDOW_DAYS = 2;

const fieldError = (field, message) => new HttpError(400, 'validation_failed', 'Some fields are missing or invalid', [{ field, message }]);
const NOT_FOUND = () => new HttpError(404, 'import_not_found', 'Import not found');
const sameId = (a, b) => String(a) === String(b);
// Entry days are stored as UTC midnight; moments (when something was imported) are shown in the app's time zone.
const shortDay = (d, timeZone = 'UTC') => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone });

async function spaceAccounts(spaceId) {
  return Account.find({ space: spaceId }).lean();
}

function usableAccount(accounts, id, field = 'account') {
  const a = accounts.find((x) => sameId(x._id, id));
  if (!a) throw fieldError(field, 'Choose one of your accounts');
  if (a.archived) throw fieldError(field, `"${a.name}" is archived. Unarchive it or pick another account.`);
  return a;
}

// The same statement line gives the same fingerprint whichever file format it came in, so importing
// a statement twice is caught. Identical lines in one file (two ₹150 Uber rides) get their own.
function fingerprints(accountId, entries) {
  const seen = new Map();
  for (const e of entries) {
    if (e.error) continue;
    const key = [accountId, e.date, e.type, e.amountPaise, e.description.toLowerCase()].join('|');
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    e.ref = crypto.createHash('sha256').update(`${key}|${n}`).digest('hex').slice(0, 32);
  }
}

// Categories this space already uses for a merchant: from imported entries' merchant names, then
// from words in hand-typed notes ("Swiggy dinner" teaches that Swiggy is Food & Dining).
async function learnedCategories(spaceId) {
  const past = await Transaction.find(
    { space: spaceId, deletedAt: null, type: { $in: MONEY_TYPES }, category: { $ne: 'Split' }, date: { $gte: new Date(Date.now() - 730 * DAY_MS) } },
    { merchant: 1, note: 1, category: 1, type: 1 },
  ).sort({ date: -1 }).limit(5000).lean();
  const byMerchant = new Map();
  const byWord = new Map();
  const bump = (map, key, category) => {
    const counts = map.get(key) ?? new Map();
    counts.set(category, (counts.get(category) ?? 0) + 1);
    map.set(key, counts);
  };
  for (const t of past) {
    if (t.merchant) bump(byMerchant, `${t.type}|${t.merchant.toLowerCase()}`, t.category);
    else for (const w of new Set(t.note?.toLowerCase().match(/[a-z][a-z0-9]{2,}/g) ?? [])) bump(byWord, `${t.type}|${w}`, t.category);
  }
  const top = (counts) => (counts ? [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0] : null);
  return (type, merchant) => {
    if (!merchant) return null;
    const name = merchant.toLowerCase();
    return top(byMerchant.get(`${type}|${name}`)) ?? top(byWord.get(`${type}|${name.split(' ')[0]}`));
  };
}

// The longest matching rule wins, so "swiggy instamart" beats "swiggy".
function ruleMatcher(rules) {
  const sorted = [...rules].sort((a, b) => b.pattern.length - a.pattern.length);
  return (type, text) => sorted.find((r) => r.type === type && text.includes(r.pattern))?.category ?? null;
}

// The account on the other side of an ATM withdrawal (your cash) or a card bill (your one card, or
// from the card's side, your one bank account). Null when it isn't clear which account that is.
function transferCounterpart(hint, account, accounts) {
  const others = accounts.filter((a) => !a.archived && !sameId(a._id, account._id));
  const only = (type) => {
    const list = others.filter((a) => a.type === type);
    return list.length === 1 ? list[0] : null;
  };
  if (hint === 'atm') return account.type === 'cash' ? null : only('cash');
  if (hint === 'card') return account.type === 'credit_card' ? only('bank') : only('credit_card');
  return null;
}

// Marks lines that are already in the space: imported before (same fingerprint), or entered by hand or
// from another statement (same amount within a couple of days). Each existing entry matches one line.
async function markDuplicates(spaceId, accountId, entries) {
  const live = entries.filter((e) => !e.error);
  if (!live.length) return;
  const imported = await Transaction.find({ space: spaceId, deletedAt: null, importRef: { $in: live.map((e) => e.ref) } }).lean();
  const byRef = new Map(imported.map((t) => [t.importRef, t]));
  const days = live.map((e) => e.date).sort();
  const candidates = await Transaction.find({
    space: spaceId,
    deletedAt: null,
    amountPaise: { $in: [...new Set(live.map((e) => e.amountPaise))] },
    date: { $gte: new Date(parseDay(days[0]) - DUPLICATE_WINDOW_DAYS * DAY_MS), $lte: new Date(+parseDay(days.at(-1)) + DUPLICATE_WINDOW_DAYS * DAY_MS) },
  }).lean();
  const used = new Set();
  for (const e of live) {
    const hit = byRef.get(e.ref);
    if (hit) {
      used.add(String(hit._id));
      e.duplicate = { kind: 'imported', transactionId: String(hit._id), message: `Already imported on ${shortDay(hit.createdAt, config.timeZone)}` };
    }
  }
  const touches = (t) => sameId(t.account, accountId) || sameId(t.toAccount, accountId);
  const typeFits = (t, e) => t.type === e.type || t.type === 'transfer' || e.type === 'transfer';
  for (const e of live) {
    if (e.duplicate) continue;
    const day = +parseDay(e.date);
    const options = candidates
      .filter((t) => !used.has(String(t._id)) && t.amountPaise === e.amountPaise && typeFits(t, e)
        && Math.abs(+t.date - day) <= DUPLICATE_WINDOW_DAYS * DAY_MS)
      // Closest day first, then entries in this account.
      .sort((a, b) => Math.abs(+a.date - day) - Math.abs(+b.date - day) || touches(b) - touches(a));
    const match = options[0];
    if (!match) continue;
    used.add(String(match._id));
    const what = match.type === 'transfer' ? 'a transfer' : match.category;
    e.duplicate = {
      kind: 'existing',
      transactionId: String(match._id),
      message: `Looks like ₹${formatPaise(match.amountPaise)} · ${what} on ${shortDay(match.date)}${match.note ? ` (${match.note.slice(0, 40)})` : ''}`,
    };
  }
}

// Reads the statement lines with the chosen columns and suggests a category, payment method, merchant
// and duplicates for each. Nothing is saved.
export async function preview(spaceId, { account: accountId, rows, mapping }) {
  const accounts = await spaceAccounts(spaceId);
  const account = usableAccount(accounts, accountId);
  const { rows: entries, dateFormat } = normaliseRows(rows, mapping);
  fingerprints(String(account._id), entries);

  const [rules, learned] = await Promise.all([ImportRule.find({ space: spaceId }).lean(), learnedCategories(spaceId)]);
  const byRule = ruleMatcher(rules);
  for (const e of entries) {
    e.merchant = extractMerchant(e.description);
    e.paymentMethod = guessPaymentMethod(e.description);
    e.duplicate = null;
    e.otherAccount = null;
    e.direction = null;
    if (e.error) continue;
    const hint = transferHint(e.description);
    const other = hint && transferCounterpart(hint, account, accounts);
    if (other) {
      e.direction = e.type === 'expense' ? 'out' : 'in';
      e.type = 'transfer';
      e.otherAccount = String(other._id);
      e.category = null;
      e.categorySource = null;
      e.transferHint = hint;
      continue;
    }
    e.transferHint = hint;
    const text = `${e.description} ${e.merchant ?? ''}`.toLowerCase();
    const rule = byRule(e.type, text);
    const past = !rule && learned(e.type, e.merchant);
    const builtin = !rule && !past && builtinCategory(text, e.type);
    e.category = rule || past || builtin || 'Other';
    e.categorySource = rule ? 'rule' : past ? 'learned' : builtin ? 'suggested' : null;
  }
  await markDuplicates(spaceId, account._id, entries);

  const counts = { ready: 0, duplicates: 0, skipped: 0 };
  for (const e of entries) {
    if (e.error) counts.skipped += 1;
    else if (e.duplicate) counts.duplicates += 1;
    else counts.ready += 1;
  }
  return {
    dateFormat,
    counts,
    rows: entries.map(({ cells: _cells, ...e }) => e),
  };
}

// Saves the chosen lines as entries in one import, plus any new rules and the bank's layout.
export async function commit({ space, user }, { account: accountId, fileName, rows, rules, layout }) {
  const accounts = await spaceAccounts(space._id);
  const account = usableAccount(accounts, accountId);
  rows.forEach((r, i) => {
    if (r.type === 'transfer') {
      const other = usableAccount(accounts, r.otherAccount, `rows.${i}.otherAccount`);
      if (sameId(other._id, account._id)) throw fieldError(`rows.${i}.otherAccount`, 'Pick a different account for the other side');
    }
  });

  const batch = await ImportBatch.create({ space: space._id, user: user._id, account: account._id, fileName, count: rows.length });
  const docs = rows.map((r) => {
    const transfer = r.type === 'transfer';
    const [from, to] = r.direction === 'in' ? [r.otherAccount, account._id] : [account._id, r.otherAccount];
    return {
      space: space._id,
      user: user._id,
      type: r.type,
      amountPaise: r.amountPaise,
      category: transfer ? 'Transfer' : r.category,
      note: r.note,
      date: r.date,
      time: r.time ?? null,
      account: transfer ? from : account._id,
      toAccount: transfer ? to : null,
      paymentMethod: transfer ? null : r.paymentMethod ?? null,
      merchant: r.merchant || null,
      importRef: r.ref,
      importBatch: batch._id,
    };
  });
  try {
    await Transaction.insertMany(docs, { ordered: true });
  } catch (err) {
    // Nothing half-imported is left behind.
    await Promise.all([Transaction.deleteMany({ importBatch: batch._id }), ImportBatch.deleteOne({ _id: batch._id })]);
    throw err;
  }

  for (const r of rules) {
    await ImportRule.updateOne(
      { space: space._id, pattern: r.pattern, type: r.type },
      { $set: { category: r.category }, $setOnInsert: { createdBy: user._id } },
      { upsert: true },
    );
  }
  if (layout) await saveLayout({ space, user }, layout);
  emitSpaceEvent(space._id, 'transactions.imported', { batchId: String(batch._id), count: rows.length, account: String(account._id), fileName: fileName ?? null });

  const where = fileName ? ` from ${fileName}` : '';
  await logActivity({
    space: space._id, user: user._id, entity: 'import', entityId: batch._id, action: 'create',
    summary: `Imported ${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}${where} into ${account.name}`,
  });
  return serializeBatch(batch.toObject(), accounts);
}

function serializeBatch(b, accounts) {
  return {
    id: String(b._id),
    fileName: b.fileName,
    account: String(b.account),
    accountName: accounts.find((a) => sameId(a._id, b.account))?.name ?? 'Account',
    count: b.count,
    createdBy: String(b.user),
    createdAt: b.createdAt,
    undoneAt: b.undoneAt,
  };
}

export async function list(spaceId) {
  const [batches, accounts] = await Promise.all([
    ImportBatch.find({ space: spaceId }).sort({ createdAt: -1 }).limit(30).lean(),
    spaceAccounts(spaceId),
  ]);
  return batches.map((b) => serializeBatch(b, accounts));
}

async function findBatch(spaceId, id) {
  if (!mongoose.isValidObjectId(id)) throw NOT_FOUND();
  const batch = await ImportBatch.findOne({ _id: id, space: spaceId });
  if (!batch) throw NOT_FOUND();
  return batch;
}

// Undo removes every entry of the import that's still there (they stay restorable for 30 days);
// redo brings back exactly the entries that undo removed.
export async function undo({ space, user }, id) {
  const batch = await findBatch(space._id, id);
  if (batch.undoneAt) throw new HttpError(409, 'already_undone', 'This import has already been undone');
  const at = new Date();
  const { modifiedCount } = await Transaction.updateMany({ space: space._id, importBatch: batch._id, deletedAt: null }, { $set: { deletedAt: at } });
  batch.undoneAt = at;
  await batch.save();
  await logActivity({
    space: space._id, user: user._id, entity: 'import', entityId: batch._id, action: 'delete',
    summary: `Undid an import: removed ${modifiedCount} ${modifiedCount === 1 ? 'entry' : 'entries'}${batch.fileName ? ` from ${batch.fileName}` : ''}`,
  });
  return { removed: modifiedCount };
}

export async function redo({ space, user }, id) {
  const batch = await findBatch(space._id, id);
  if (!batch.undoneAt) throw new HttpError(409, 'not_undone', 'This import has not been undone');
  const { modifiedCount } = await Transaction.updateMany({ space: space._id, importBatch: batch._id, deletedAt: batch.undoneAt }, { $set: { deletedAt: null } });
  if (!modifiedCount) throw new HttpError(410, 'entries_gone', 'These entries were permanently removed, so the import can no longer be brought back');
  batch.undoneAt = null;
  await batch.save();
  await logActivity({
    space: space._id, user: user._id, entity: 'import', entityId: batch._id, action: 'restore',
    summary: `Brought back ${modifiedCount} imported ${modifiedCount === 1 ? 'entry' : 'entries'}${batch.fileName ? ` from ${batch.fileName}` : ''}`,
  });
  return { restored: modifiedCount };
}

const serializeRule = (r) => ({ id: String(r._id), pattern: r.pattern, type: r.type, category: r.category, createdAt: r.createdAt });

export async function listRules(spaceId) {
  return (await ImportRule.find({ space: spaceId }).sort({ pattern: 1 }).lean()).map(serializeRule);
}

export async function saveRule({ space, user }, { pattern, type, category }) {
  const rule = await ImportRule.findOneAndUpdate(
    { space: space._id, pattern, type },
    { $set: { category }, $setOnInsert: { createdBy: user._id } },
    { upsert: true, returnDocument: 'after', includeResultMetadata: true },
  );
  return { rule: serializeRule(rule.value), created: !rule.lastErrorObject?.updatedExisting };
}

export async function removeRule(spaceId, id) {
  if (!mongoose.isValidObjectId(id)) throw new HttpError(404, 'rule_not_found', 'Rule not found');
  const { deletedCount } = await ImportRule.deleteOne({ _id: id, space: spaceId });
  if (!deletedCount) throw new HttpError(404, 'rule_not_found', 'Rule not found');
}

const serializeProfile = (p) => ({ id: String(p._id), name: p.name, signature: p.signature, mapping: p.mapping, updatedAt: p.updatedAt });

export async function listLayouts(spaceId) {
  return (await ImportProfile.find({ space: spaceId }).sort({ name: 1 }).lean()).map(serializeProfile);
}

// One layout per name; saving the same name again replaces it.
export async function saveLayout({ space, user }, { name, header, mapping }) {
  const p = await ImportProfile.findOneAndUpdate(
    { space: space._id, name },
    { $set: { signature: headerSignature(header), mapping }, $setOnInsert: { createdBy: user._id } },
    { upsert: true, returnDocument: 'after' },
  ).lean();
  return serializeProfile(p);
}

export async function removeLayout(spaceId, id) {
  if (!mongoose.isValidObjectId(id)) throw new HttpError(404, 'layout_not_found', 'Layout not found');
  const { deletedCount } = await ImportProfile.deleteOne({ _id: id, space: spaceId });
  if (!deletedCount) throw new HttpError(404, 'layout_not_found', 'Layout not found');
}
