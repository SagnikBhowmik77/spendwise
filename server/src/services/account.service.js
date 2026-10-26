import mongoose from 'mongoose';
import { HttpError } from '../errors.js';
import { Account, RecurringRule, Space, Transaction, serializeAccount } from '../models/index.js';
import { config } from '../config.js';
import { cardCycle } from '../finance.js';
import { dayString, formatPaise } from '../money.js';
import { todayIn } from '../schedule.js';
import { logActivity } from './activity.service.js';

const NOT_FOUND = () => new HttpError(404, 'account_not_found', 'Account not found');
const oid = (id) => new mongoose.Types.ObjectId(String(id));
const TYPE_LABEL = { cash: 'cash', bank: 'bank account', credit_card: 'credit card', wallet: 'wallet', other: 'account' };

// Per-account movement from live entries: + income − expense − transfers out + transfers in.
async function flows(spaceId) {
  const [res] = await Transaction.aggregate([
    { $match: { space: oid(spaceId), deletedAt: null } },
    {
      $facet: {
        own: [
          {
            $group: {
              _id: '$account',
              delta: {
                $sum: {
                  $switch: {
                    branches: [
                      { case: { $eq: ['$type', 'income'] }, then: '$amountPaise' },
                      { case: { $eq: ['$type', 'expense'] }, then: { $multiply: ['$amountPaise', -1] } },
                    ],
                    default: { $multiply: ['$amountPaise', -1] },
                  },
                },
              },
              entries: { $sum: 1 },
            },
          },
        ],
        incoming: [
          { $match: { type: 'transfer' } },
          { $group: { _id: '$toAccount', delta: { $sum: '$amountPaise' }, entries: { $sum: 1 } } },
        ],
      },
    },
  ]);
  const out = new Map();
  for (const row of [...res.own, ...res.incoming]) {
    const key = String(row._id);
    const prev = out.get(key) ?? { delta: 0, entries: 0 };
    out.set(key, { delta: prev.delta + row.delta, entries: prev.entries + row.entries });
  }
  return out;
}

const money = (paise) => ({ paise, rupees: paise / 100 });

export async function list(space, { includeArchived = false } = {}) {
  const [accounts, moves] = await Promise.all([
    Account.find({ space: space._id }).sort({ archived: 1, createdAt: 1 }).lean(),
    flows(space._id),
  ]);
  const items = accounts.map((a) => {
    const f = moves.get(String(a._id)) ?? { delta: 0, entries: 0 };
    return serializeAccount(a, {
      balancePaise: a.openingBalancePaise + f.delta,
      entries: f.entries,
      isDefault: String(space.defaultAccount) === String(a._id),
    });
  });
  // Net worth counts every account, archived ones too: the money in them still exists.
  const assets = items.reduce((s, a) => s + Math.max(0, a.balance.paise), 0);
  const liabilities = items.reduce((s, a) => s + Math.max(0, -a.balance.paise), 0);
  return {
    accounts: includeArchived ? items : items.filter((a) => !a.archived),
    archivedCount: items.filter((a) => a.archived).length,
    netWorth: { assets: money(assets), liabilities: money(liabilities), net: money(assets - liabilities) },
  };
}

async function owned(space, id) {
  if (!mongoose.isValidObjectId(id)) throw NOT_FOUND();
  const account = await Account.findOne({ _id: id, space: space._id });
  if (!account) throw NOT_FOUND();
  return account;
}

const duplicate = (err) => {
  if (err.code === 11000) return new HttpError(409, 'account_exists', 'You already have an account with that name');
  return err;
};

export async function create({ space, user }, { name, type, openingBalance = 0 }) {
  let account;
  try {
    account = await Account.create({ space: space._id, name, type, openingBalancePaise: openingBalance, createdBy: user._id });
  } catch (err) {
    throw duplicate(err);
  }
  await logActivity({
    space: space._id, user: user._id, entity: 'account', entityId: account._id, action: 'create',
    summary: `Added the ${TYPE_LABEL[type]} "${name}"${openingBalance ? ` with ₹${formatPaise(openingBalance)}` : ''}`,
  });
  return (await list(space, { includeArchived: true })).accounts.find((a) => a.id === String(account._id));
}

async function anotherActiveAccount(space, exceptId) {
  return Account.findOne({ space: space._id, archived: false, _id: { $ne: exceptId } }).sort({ createdAt: 1 }).lean();
}

export async function update({ space, user }, id, changes) {
  const account = await owned(space, id);
  const isDefault = String(space.defaultAccount) === String(account._id);
  const notes = [];
  if ('name' in changes && changes.name !== account.name) { notes.push(`renamed to "${changes.name}"`); account.name = changes.name; }
  if ('type' in changes) account.type = changes.type;
  for (const f of ['statementDay', 'dueDay']) {
    if (f in changes && changes[f] !== account[f]) { account[f] = changes[f]; if (!notes.includes('card cycle')) notes.push('card cycle'); }
  }
  if ('openingBalance' in changes && changes.openingBalance !== account.openingBalancePaise) {
    notes.push(`opening balance ₹${formatPaise(changes.openingBalance)}`);
    account.openingBalancePaise = changes.openingBalance;
  }
  if (changes.archived === true && !account.archived) {
    if (isDefault) {
      const next = await anotherActiveAccount(space, account._id);
      if (!next) throw new HttpError(400, 'last_account', 'Keep at least one active account');
      await Space.updateOne({ _id: space._id }, { $set: { defaultAccount: next._id } });
      space.defaultAccount = next._id;
    }
    account.archived = true;
    notes.push('archived');
  } else if (changes.archived === false && account.archived) {
    account.archived = false;
    notes.push('unarchived');
  }
  // Batch 12R: in a shared space, the person who added an account can keep it (and its entries) to themselves.
  if (changes.private === true && !account.privateTo) {
    if (space.kind !== 'shared') throw new HttpError(400, 'personal_space', 'Accounts in your personal space are already only yours');
    if (String(account.createdBy) !== String(user._id)) throw new HttpError(403, 'not_your_account', 'Only the person who added an account can make it private');
    if (isDefault) throw new HttpError(400, 'default_account', 'Make another account the default first');
    account.privateTo = user._id;
  } else if (changes.private === false && account.privateTo) {
    account.privateTo = null;
  }
  if (changes.isDefault === true && !isDefault) {
    if (account.privateTo) throw new HttpError(400, 'private_account', 'A private account can’t be the default');
    if (account.archived) throw new HttpError(400, 'archived_account', "An archived account can't be the default");
    await Space.updateOne({ _id: space._id }, { $set: { defaultAccount: account._id } });
    space.defaultAccount = account._id;
    notes.push('made the default');
  }
  try {
    await account.save();
  } catch (err) {
    throw duplicate(err);
  }
  if (notes.length) {
    await logActivity({ space: space._id, user: user._id, entity: 'account', entityId: account._id, action: 'update', summary: `Account "${account.name}": ${notes.join(', ')}` });
  }
  return (await list(space, { includeArchived: true })).accounts.find((a) => a.id === String(account._id));
}

// Only an account with no history can be deleted; one with entries is archived instead, so the history stays.
export async function remove({ space, user }, id) {
  const account = await owned(space, id);
  const [entries, rules] = await Promise.all([
    Transaction.countDocuments({ space: space._id, $or: [{ account: account._id }, { toAccount: account._id }] }),
    RecurringRule.countDocuments({ space: space._id, account: account._id }),
  ]);
  if (entries || rules) {
    throw new HttpError(409, 'account_in_use',
      `"${account.name}" has ${entries} entr${entries === 1 ? 'y' : 'ies'}${rules ? ` and ${rules} recurring rule${rules === 1 ? '' : 's'}` : ''}. Archive it instead, so its history stays.`);
  }
  if (String(space.defaultAccount) === String(account._id)) {
    const next = await anotherActiveAccount(space, account._id);
    if (!next) throw new HttpError(400, 'last_account', 'Keep at least one active account');
    await Space.updateOne({ _id: space._id }, { $set: { defaultAccount: next._id } });
  }
  await account.deleteOne();
  await logActivity({ space: space._id, user: user._id, entity: 'account', entityId: account._id, action: 'delete', summary: `Deleted the account "${account.name}"` });
}

// Money on one account between two days (inclusive; open ends allowed): purchases, refunds, payments in and transfers out.
async function cardFlows(spaceId, accountId, from, to) {
  const match = { space: oid(spaceId), deletedAt: null, $or: [{ account: oid(accountId) }, { toAccount: oid(accountId) }] };
  if (from || to) match.date = { ...(from && { $gte: from }), ...(to && { $lte: to }) };
  const totals = { charges: 0, credits: 0, paymentsIn: 0, out: 0 };
  for (const t of await Transaction.find(match, { type: 1, amountPaise: 1, toAccount: 1 }).lean()) {
    if (t.type === 'expense') totals.charges += t.amountPaise;
    else if (t.type === 'income') totals.credits += t.amountPaise;
    else if (String(t.toAccount) === String(accountId)) totals.paymentsIn += t.amountPaise;
    else totals.out += t.amountPaise;
  }
  return { ...totals, delta: totals.credits + totals.paymentsIn - totals.charges - totals.out };
}

// A credit card's billing cycle: what the last statement came to, when it's due and how much is still
// to pay, and what has been charged since. Amounts owed are positive.
export async function cycle(space, id) {
  const account = await owned(space, id);
  if (account.type !== 'credit_card') throw new HttpError(400, 'not_a_card', 'Billing cycles are for credit card accounts');
  if (!account.statementDay || !account.dueDay) throw new HttpError(400, 'cycle_not_set', 'Set the statement day and due day for this card first');
  const today = todayIn(config.timeZone);
  const c = cardCycle({ statementDay: account.statementDay, dueDay: account.dueDay, today });
  const [atStatement, last, current, now] = await Promise.all([
    cardFlows(space._id, account._id, null, c.last.to),
    cardFlows(space._id, account._id, c.last.from, c.last.to),
    cardFlows(space._id, account._id, c.current.from, null),
    cardFlows(space._id, account._id, null, null),
  ]);
  const statementBalance = Math.max(0, -(account.openingBalancePaise + atStatement.delta));
  const paidSince = current.paymentsIn + current.credits;
  const remaining = Math.max(0, statementBalance - paidSince);
  let status = 'paid';
  if (remaining > 0) status = today > c.dueDate ? 'overdue' : 'due';
  return {
    statementDay: account.statementDay,
    dueDay: account.dueDay,
    lastStatement: {
      from: dayString(c.last.from), to: dayString(c.last.to),
      purchases: money(last.charges), refunds: money(last.credits), payments: money(last.paymentsIn),
      balance: money(statementBalance), dueDate: dayString(c.dueDate), paidSince: money(paidSince), remaining: money(remaining), status,
    },
    currentCycle: {
      from: dayString(c.current.from), to: dayString(c.current.to), purchases: money(current.charges),
      daysLeft: Math.round((c.current.to - today) / 86_400_000),
    },
    // What's owed on the card right now (negative = money in your favour).
    outstanding: money(-(account.openingBalancePaise + now.delta)),
  };
}
