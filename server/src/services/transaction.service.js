import mongoose from 'mongoose';
import { HttpError } from '../errors.js';
import { Account, MONEY_TYPES, Transaction, UNDO_DAYS, serializeTransaction } from '../models/index.js';
import { DEFAULT_CATEGORIES } from '../categories.js';
import { currentMonth, formatPaise, monthRange } from '../money.js';
import { logActivity, snapshotTx } from './activity.service.js';
import { emitSpaceEvent } from '../events.js';
import { rateFor, toPaise } from './fx.service.js';
import { currentAccess } from '../access.js';
import { config } from '../config.js';
import { todayIn } from '../schedule.js';
import { notifySpace } from './alert.service.js';

// Every query here is scoped to one space: another space's entry is indistinguishable from a missing one.
const NOT_FOUND = () => new HttpError(404, 'transaction_not_found', 'Transaction not found');
const oid = (id) => new mongoose.Types.ObjectId(String(id));
const fieldError = (field, message) => new HttpError(400, 'validation_failed', 'Some fields are missing or invalid', [{ field, message }]);

const ownedFilter = (spaceId, id, { deleted = false } = {}) => {
  if (!mongoose.isValidObjectId(id)) throw NOT_FOUND();
  return { _id: id, space: spaceId, deletedAt: deleted ? { $ne: null } : null };
};

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The filter shared by the list, stats, budgets and exports. Money totals never include transfers
// (moving money between your own accounts isn't income or spending); the list shows them.
export function buildFilter(spaceId, { type, category, from, to, q, account, paymentMethod, tag } = {}, { includeTransfers = false } = {}) {
  const filter = { space: oid(spaceId), deletedAt: null };
  if (type) filter.type = type;
  else if (!includeTransfers) filter.type = { $in: MONEY_TYPES };
  if (paymentMethod) filter.paymentMethod = paymentMethod;
  if (tag) filter.tags = tag;
  if (from || to) {
    filter.date = {};
    if (from) filter.date.$gte = from;
    if (to) filter.date.$lte = to;
  }
  const and = [];
  // A split entry matches a category if any of its parts has it.
  if (category?.length) and.push({ $or: [{ category: { $in: category } }, { 'splits.category': { $in: category } }] });
  if (account) and.push({ $or: [{ account: oid(account) }, { toAccount: oid(account) }] });
  if (q) {
    const re = new RegExp(escapeRegex(q), 'i');
    and.push({ $or: [{ note: re }, { category: re }, { merchant: re }] });
  }
  if (and.length) filter.$and = and;
  return filter;
}

// Splits counted per part: one row per (part category, part amount); entries without splits stay as they are.
// Used wherever money is grouped by category, so a Big Bazaar bill counts under Groceries and Personal care.
export const explodeSplits = (category) => [
  {
    $addFields: {
      parts: {
        $cond: [
          { $gt: [{ $size: { $ifNull: ['$splits', []] } }, 0] },
          '$splits',
          [{ category: '$category', amountPaise: '$amountPaise' }],
        ],
      },
    },
  },
  { $unwind: '$parts' },
  { $set: { category: '$parts.category', amountPaise: '$parts.amountPaise' } },
  ...(category?.length ? [{ $match: { category: { $in: category } } }] : []),
];

const SORT_SPECS = {
  // Within a day, entries with a time come in time order.
  '-date': { date: -1, time: -1, _id: -1 },
  date: { date: 1, time: 1, _id: 1 },
  '-amount': { amountPaise: -1, _id: -1 },
  amount: { amountPaise: 1, _id: 1 },
};

export const describeTx = (t) => (t.type === 'transfer'
  ? `transfer of ₹${formatPaise(t.amountPaise)}`
  : `${t.type} of ₹${formatPaise(t.amountPaise)} · ${t.category}`);

// Accounts must belong to this space and not be archived.
async function checkAccounts(spaceId, { type, account, toAccount }) {
  const wanted = [['account', account], ...(type === 'transfer' ? [['toAccount', toAccount]] : [])];
  const found = await Account.find({ _id: { $in: wanted.map(([, id]) => id).filter(Boolean) }, space: spaceId }).lean();
  for (const [field, id] of wanted) {
    const a = found.find((x) => String(x._id) === String(id));
    if (!a) throw fieldError(field, 'Choose one of your accounts');
    if (a.archived) throw fieldError(field, `"${a.name}" is archived. Unarchive it or pick another account.`);
  }
}

const cleanTags = (tags) => [...new Set((tags ?? []).map((t) => t.replace(/^#/, '').toLowerCase()))];

function checkSplits(splits, amountPaise) {
  if (!splits?.length) return;
  const sum = splits.reduce((s, p) => s + p.amountPaise, 0);
  if (sum !== amountPaise) {
    throw fieldError('splits', `The parts add up to ₹${formatPaise(sum)}, not ₹${formatPaise(amountPaise)}`);
  }
}

// A foreign-currency amount becomes INR paise at that day's ECB rate.
async function convert({ currency, originalAmount, date }) {
  const { rate, rateDate } = await rateFor(currency, date);
  return { amountPaise: toPaise(originalAmount, rate), original: { currency, amountMinor: originalAmount, rate, rateDate } };
}

// Batch 12R: a child's expenses this month, waiting ones included, against their pocket money.
async function checkPocketMoney(space, user, member, amountPaise) {
  if (!member?.pocketMoneyPaise) return;
  const { from, to } = monthRange(currentMonth(todayIn(config.timeZone)));
  const [row] = await Transaction.aggregate([
    { $match: { space: space._id, user: user._id, type: 'expense', deletedAt: null, date: { $gte: from, $lte: to } } },
    { $group: { _id: null, paise: { $sum: '$amountPaise' } } },
  ]).option({ withPending: true });
  const left = member.pocketMoneyPaise - (row?.paise ?? 0);
  if (amountPaise > left) {
    throw new HttpError(409, 'pocket_money_exceeded', left > 0 ? `That’s more than the ₹${formatPaise(left)} of pocket money left this month` : 'This month’s pocket money is used up');
  }
}

// The same offline entry sent again: the one already saved.
const byClientRef = (space, clientRef) => Transaction.findOne({ space: space._id, clientRef, pending: { $in: [true, false, null] } });

export async function create({ space, user, direct = false }, body) {
  if (body.clientRef) {
    const seen = await byClientRef(space, body.clientRef);
    if (seen) return serializeTransaction(seen);
  }
  const who = currentAccess();
  const fx = body.currency ? await convert(body) : null;
  const splits = body.type === 'transfer' ? undefined : body.splits?.map((s) => ({ category: s.category, amountPaise: s.amount }));
  const data = {
    type: body.type,
    amountPaise: fx ? fx.amountPaise : body.amount,
    original: fx?.original ?? null,
    tags: cleanTags(body.tags),
    time: body.time ?? null,
    splits: splits?.length ? splits : undefined,
    category: body.type === 'transfer' ? 'Transfer' : splits?.length ? 'Split' : body.category,
    note: body.note ?? '',
    date: body.date,
    account: body.account ?? space.defaultAccount,
    toAccount: body.type === 'transfer' ? body.toAccount : null,
    paymentMethod: body.type === 'transfer' ? null : body.paymentMethod ?? null,
    merchant: body.merchant || null,
    worth: body.type === 'expense' ? body.worth ?? null : null,
    tdsPaise: body.type === 'income' ? body.tds ?? null : null,
  };
  if (!data.account) throw fieldError('account', 'Choose an account');
  if (data.type === 'transfer' && String(data.account) === String(data.toAccount)) throw fieldError('toAccount', 'Pick two different accounts');
  // A foreign amount's parts are in that currency; they're converted at the same rate.
  if (data.splits && fx) {
    const raw = data.splits.reduce((s, p) => s + p.amountPaise, 0);
    if (raw !== body.originalAmount) throw fieldError('splits', `The parts add up to ${formatPaise(raw)}, not ${formatPaise(body.originalAmount)} ${body.currency}`);
  }
  if (data.splits && fx) data.splits = data.splits.map((s) => ({ ...s, amountPaise: toPaise(s.amountPaise, fx.original.rate) }));
  if (data.splits && fx) data.splits.at(-1).amountPaise += data.amountPaise - data.splits.reduce((s, p) => s + p.amountPaise, 0);
  checkSplits(data.splits, data.amountPaise);
  await checkAccounts(space._id, data);
  if (who?.role === 'child') await checkPocketMoney(space, user, who.member, data.amountPaise);
  // A big expense typed in by someone other than the owner waits for the owner to approve it.
  const pending = direct && data.type === 'expense' && Boolean(space.approvalAbovePaise) && data.amountPaise > space.approvalAbovePaise
    && String(space.owner) !== String(user._id);
  let doc;
  try {
    doc = await Transaction.create({ ...data, space: space._id, user: user._id, pending: pending || undefined, clientRef: body.clientRef });
  } catch (err) {
    if (err.code === 11000 && body.clientRef) return serializeTransaction(await byClientRef(space, body.clientRef));
    throw err;
  }
  if (pending) {
    await logActivity({
      space: space._id, user: user._id, entity: 'transaction', entityId: doc._id, action: 'create',
      summary: `Asked to add ${describeTx(doc)} (waiting for approval)`, after: snapshotTx(doc),
    });
    const owner = space.members.filter((m) => String(m.user) === String(space.owner));
    await notifySpace({ ...space.toObject?.() ?? space, members: owner }, {
      kind: 'budget', title: `${user.name} wants to spend ₹${formatPaise(doc.amountPaise)}`,
      body: `${doc.category}${doc.note ? ` – ${doc.note}` : ''} in ${space.name}. Approve it or turn it down.`,
      path: '/approvals', tag: `approval-${doc._id}`, linkText: 'See what’s waiting',
    });
    return serializeTransaction(doc);
  }
  await logActivity({
    space: space._id, user: user._id, entity: 'transaction', entityId: doc._id, action: 'create',
    summary: `Added ${describeTx(doc)}`, after: snapshotTx(doc),
  });
  const out = serializeTransaction(doc);
  emitSpaceEvent(space._id, 'transaction.created', out);
  return out;
}

export async function list(spaceId, query) {
  const { sort, page, limit } = query;
  const filter = buildFilter(spaceId, query, { includeTransfers: true });
  const [rows, total] = await Promise.all([
    Transaction.find(filter).sort(SORT_SPECS[sort]).skip((page - 1) * limit).limit(limit).lean(),
    Transaction.countDocuments(filter),
  ]);
  return { items: rows.map(serializeTransaction), page, limit, total, totalPages: Math.ceil(total / limit) };
}

export async function get(spaceId, id) {
  const doc = await Transaction.findOne(ownedFilter(spaceId, id)).lean();
  if (!doc) throw NOT_FOUND();
  return serializeTransaction(doc);
}

export async function update({ space, user }, id, changes) {
  const doc = await Transaction.findOne(ownedFilter(space._id, id));
  if (!doc) throw NOT_FOUND();
  const before = snapshotTx(doc);
  const transfer = doc.type === 'transfer';
  if ('type' in changes && (changes.type === 'transfer') !== transfer) {
    throw fieldError('type', "A transfer can't become income or an expense, or the other way round. Delete it and add a new entry.");
  }
  if ('type' in changes) doc.type = changes.type;
  if ('amount' in changes) { doc.amountPaise = changes.amount; doc.original = null; }
  if ('note' in changes) doc.note = changes.note;
  if ('date' in changes) doc.date = changes.date;
  if ('time' in changes) doc.time = changes.time;
  if ('tags' in changes) doc.tags = cleanTags(changes.tags);
  if ('merchant' in changes) doc.merchant = changes.merchant || null;
  if ('worth' in changes) doc.worth = doc.type === 'expense' ? changes.worth : null;
  if ('tds' in changes) doc.tdsPaise = changes.tds;
  if (doc.type !== 'income') doc.tdsPaise = null;
  if (doc.tdsPaise && doc.tdsPaise > doc.amountPaise) throw fieldError('tds', 'TDS can’t be more than the amount');
  // A foreign amount is converted again when its amount, currency or day changes.
  const currency = changes.currency ?? doc.original?.currency;
  if (currency && ('currency' in changes || 'originalAmount' in changes || ('date' in changes && doc.original))) {
    const fx = await convert({ currency, originalAmount: changes.originalAmount ?? doc.original?.amountMinor, date: doc.date });
    doc.amountPaise = fx.amountPaise;
    doc.original = fx.original;
  }
  if (!transfer && 'splits' in changes) {
    const parts = changes.splits?.map((s) => ({ category: s.category, amountPaise: s.amount }));
    doc.splits = parts?.length ? parts : undefined;
    if (parts?.length) doc.category = 'Split';
    else if (doc.category === 'Split' && !changes.category) throw fieldError('category', 'Pick a category for the whole amount');
  }
  if ('account' in changes) doc.account = changes.account;
  if (!transfer && 'category' in changes && !doc.splits?.length) doc.category = changes.category;
  if (!transfer && 'paymentMethod' in changes) doc.paymentMethod = changes.paymentMethod;
  if (transfer && 'toAccount' in changes) doc.toAccount = changes.toAccount;
  if (transfer && String(doc.account) === String(doc.toAccount)) throw fieldError('toAccount', 'Pick two different accounts');
  if ('account' in changes || 'toAccount' in changes) await checkAccounts(space._id, doc);
  checkSplits(doc.splits, doc.amountPaise);
  await doc.save();
  await logActivity({
    space: space._id, user: user._id, entity: 'transaction', entityId: doc._id, action: 'update',
    summary: `Edited ${describeTx(doc)}`, before, after: snapshotTx(doc),
  });
  const out = serializeTransaction(doc);
  emitSpaceEvent(space._id, 'transaction.updated', out);
  return out;
}

// Soft delete: the entry disappears everywhere at once but can be restored for UNDO_DAYS days.
export async function remove({ space, user }, id) {
  const doc = await Transaction.findOne(ownedFilter(space._id, id));
  if (!doc) throw NOT_FOUND();
  doc.deletedAt = new Date();
  await doc.save();
  await logActivity({
    space: space._id, user: user._id, entity: 'transaction', entityId: doc._id, action: 'delete',
    summary: `Deleted ${describeTx(doc)}`, before: snapshotTx(doc),
  });
  emitSpaceEvent(space._id, 'transaction.deleted', serializeTransaction(doc));
  return { id: String(doc._id), restorableUntil: new Date(doc.deletedAt.getTime() + UNDO_DAYS * 24 * 60 * 60 * 1000) };
}

export async function restore({ space, user }, id) {
  const doc = await Transaction.findOne(ownedFilter(space._id, id, { deleted: true }));
  if (!doc) throw new HttpError(404, 'nothing_to_restore', 'There is no deleted entry to restore');
  doc.deletedAt = null;
  await doc.save();
  await logActivity({
    space: space._id, user: user._id, entity: 'transaction', entityId: doc._id, action: 'restore',
    summary: `Restored ${describeTx(doc)}`, after: snapshotTx(doc),
  });
  const out = serializeTransaction(doc);
  emitSpaceEvent(space._id, 'transaction.restored', out);
  return out;
}

// Tags used in this space, most used first.
export async function tags(spaceId) {
  const rows = await Transaction.aggregate([
    { $match: { space: oid(spaceId), deletedAt: null } },
    { $unwind: '$tags' },
    { $group: { _id: '$tags', count: { $sum: 1 } } },
    { $sort: { count: -1, _id: 1 } },
  ]);
  return rows.map((r) => ({ tag: r._id, count: r.count }));
}

// Suggested categories plus any typed in this space.
export async function categories(spaceId) {
  const used = await Transaction.aggregate([
    { $match: { space: oid(spaceId), deletedAt: null, type: { $in: MONEY_TYPES } } },
    ...explodeSplits(),
    { $group: { _id: { type: '$type', category: '$category' } } },
  ]);
  const custom = { income: [], expense: [] };
  for (const { _id } of used) {
    if (!DEFAULT_CATEGORIES[_id.type].includes(_id.category)) custom[_id.type].push(_id.category);
  }
  custom.income.sort((a, b) => a.localeCompare(b));
  custom.expense.sort((a, b) => a.localeCompare(b));
  return { defaults: DEFAULT_CATEGORIES, custom };
}
