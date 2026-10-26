import mongoose from 'mongoose';
import { HttpError } from '../errors.js';
import { config } from '../config.js';
import { Account, RecurringRule, Transaction } from '../models/index.js';
import { occurrenceDate, todayIn, addDays } from '../schedule.js';
import { dayString } from '../money.js';
import { emitSpaceEvent } from '../events.js';

// Entries one rule may create in a single run (a daily rule started a year ago needs 366).
export const MAX_PER_RUN = 1000;

const NOT_FOUND = () => new HttpError(404, 'recurring_not_found', 'Recurring rule not found');
const fieldError = (field, message) => new HttpError(400, 'validation_failed', 'Some fields are missing or invalid', [{ field, message }]);
const today = () => todayIn(config.timeZone);
const occurrence = (rule, i) => occurrenceDate(rule.startDate, rule.frequency, rule.interval, i);
// Date of occurrence i, or null if it falls after the rule's end date.
const dateOrEnd = (rule, i) => {
  const d = occurrence(rule, i);
  return rule.endDate && d > rule.endDate ? null : d;
};

export function serialize(rule) {
  let status = 'active';
  if (!rule.nextRunDate) status = 'ended';
  else if (!rule.active) status = 'paused';
  return {
    id: String(rule._id),
    type: rule.type,
    amountPaise: rule.amountPaise,
    amount: rule.amountPaise / 100,
    category: rule.category,
    note: rule.note ?? '',
    account: rule.account ? String(rule.account) : null,
    paymentMethod: rule.paymentMethod ?? null,
    frequency: rule.frequency,
    interval: rule.interval,
    startDate: dayString(rule.startDate),
    endDate: rule.endDate ? dayString(rule.endDate) : null,
    active: rule.active,
    status,
    nextDate: rule.nextRunDate ? dayString(rule.nextRunDate) : null,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
  };
}

// Creates every entry that is due for one rule, then moves the rule on. Safe to run twice at once:
// entries are upserted on (rule, date), which a unique index guards, and the rule only advances
// if no other run advanced it first.
async function runRule(rule, onOrBefore) {
  const ops = [];
  let i = rule.nextIndex;
  for (; ops.length < MAX_PER_RUN; i++) {
    const date = dateOrEnd(rule, i);
    if (!date || date > onOrBefore) break;
    ops.push({
      updateOne: {
        // An upsert copies these two fields from the filter into the new entry.
        filter: { recurringRule: rule._id, date },
        update: {
          $setOnInsert: {
            space: rule.space, user: rule.user, type: rule.type, amountPaise: rule.amountPaise,
            category: rule.category, note: rule.note, account: rule.account, toAccount: null,
            paymentMethod: rule.paymentMethod ?? null, deletedAt: null,
          },
        },
        upsert: true,
      },
    });
  }
  let created = 0;
  if (ops.length) {
    try {
      created = (await Transaction.bulkWrite(ops, { ordered: false })).upsertedCount;
    } catch (err) {
      // Two runs racing on the same new entry: the unique index lets only one through. Anything else is real.
      const errors = err.writeErrors ?? [err];
      if (!errors.every((e) => (e.code ?? e.err?.code) === 11000)) throw err;
      created = err.result?.upsertedCount ?? 0;
    }
  }
  await RecurringRule.updateOne(
    { _id: rule._id, nextIndex: rule.nextIndex },
    { $set: { nextIndex: i, nextRunDate: dateOrEnd(rule, i) } },
  );
  if (created) emitSpaceEvent(rule.space, 'transactions.recurring', { ruleId: String(rule._id), count: created });
  return created;
}

// Runs every active rule that is due. `today` is only passed by tests.
export async function processDue({ today: onOrBefore = today(), spaceId, ruleId } = {}) {
  const filter = { active: true, nextRunDate: { $ne: null, $lte: onOrBefore } };
  if (spaceId) filter.space = spaceId;
  if (ruleId) filter._id = ruleId;
  let created = 0;
  for (const rule of await RecurringRule.find(filter).lean()) created += await runRule(rule, onOrBefore);
  return { created };
}

const owned = async (spaceId, id) => {
  if (!mongoose.isValidObjectId(id)) throw NOT_FOUND();
  const rule = await RecurringRule.findOne({ _id: id, space: spaceId });
  if (!rule) throw NOT_FOUND();
  return rule;
};

async function checkAccount(spaceId, accountId) {
  const a = await Account.findOne({ _id: accountId, space: spaceId }).lean();
  if (!a) throw fieldError('account', 'Choose one of your accounts');
  if (a.archived) throw fieldError('account', `"${a.name}" is archived. Pick another account.`);
}

export async function create({ space, user }, { amount, account, ...fields }) {
  const draft = { ...fields, amountPaise: amount, space: space._id, user: user._id, account: account ?? space.defaultAccount, nextIndex: 0 };
  await checkAccount(space._id, draft.account);
  draft.nextRunDate = dateOrEnd(draft, 0);
  const rule = await RecurringRule.create(draft);
  // Entries already due (start date today or earlier) are created straight away.
  const { created } = await processDue({ ruleId: rule._id });
  return { rule: serialize(await RecurringRule.findById(rule._id).lean()), created };
}

export async function list(spaceId) {
  const rules = await RecurringRule.find({ space: spaceId }).lean();
  const order = { active: 0, paused: 1, ended: 2 };
  return rules
    .map(serialize)
    .sort((a, b) => order[a.status] - order[b.status]
      || (a.nextDate ?? '').localeCompare(b.nextDate ?? '')
      || a.category.localeCompare(b.category));
}

export async function get(spaceId, id) {
  return serialize(await owned(spaceId, id));
}

// Changes apply to entries created from now on; entries that already exist are left as they are.
export async function update(spaceId, id, changes) {
  const rule = await owned(spaceId, id);
  if ('amount' in changes) rule.amountPaise = changes.amount;
  if ('category' in changes) rule.category = changes.category;
  if ('note' in changes) rule.note = changes.note;
  if ('paymentMethod' in changes) rule.paymentMethod = changes.paymentMethod;
  if ('account' in changes) {
    await checkAccount(spaceId, changes.account);
    rule.account = changes.account;
  }
  if ('endDate' in changes) {
    if (changes.endDate && changes.endDate < rule.startDate) throw fieldError('endDate', 'End date must be on or after the start date');
    rule.endDate = changes.endDate;
  }
  if ('active' in changes) {
    if (changes.active && !rule.active) {
      // Resuming skips what was missed while paused; today's entry (if due) is still created.
      const t = today();
      let i = rule.nextIndex;
      while (occurrence(rule, i) < t && i < rule.nextIndex + 100_000) i++;
      rule.nextIndex = i;
    }
    rule.active = changes.active;
  }
  rule.nextRunDate = dateOrEnd(rule, rule.nextIndex);
  await rule.save();
  await processDue({ ruleId: rule._id });
  return serialize(await RecurringRule.findById(rule._id).lean());
}

// Stops the rule. Entries it already created stay: they are real history.
export async function remove(spaceId, id) {
  const rule = await owned(spaceId, id);
  await rule.deleteOne();
}

// What the active rules will add over the next `days` days, for an "upcoming bills" list.
export async function upcoming(spaceId, { days }) {
  const from = today();
  const to = addDays(from, days);
  const rules = await RecurringRule.find({ space: spaceId, active: true, nextRunDate: { $ne: null, $lte: to } }).lean();
  const items = [];
  for (const rule of rules) {
    for (let i = rule.nextIndex, n = 0; n < 100; i++, n++) {
      const date = dateOrEnd(rule, i);
      if (!date || date > to) break;
      items.push({
        ruleId: String(rule._id), date: dayString(date), type: rule.type, account: String(rule.account),
        amountPaise: rule.amountPaise, amount: rule.amountPaise / 100, category: rule.category, note: rule.note,
      });
    }
  }
  items.sort((a, b) => a.date.localeCompare(b.date) || a.category.localeCompare(b.category));
  const sumOf = (type) => items.filter((x) => x.type === type).reduce((s, x) => s + x.amountPaise, 0);
  return {
    from: dayString(from),
    to: dayString(to),
    items,
    totals: {
      income: { paise: sumOf('income'), rupees: sumOf('income') / 100 },
      expense: { paise: sumOf('expense'), rupees: sumOf('expense') / 100 },
    },
  };
}
