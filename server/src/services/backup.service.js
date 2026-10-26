// Batch 12I: everything in a space as one JSON file, and putting it back.
// A restore replaces what's in the space. Every record is checked before anything is removed, and if
// saving fails part-way the space is put back exactly as it was.
import mongoose from 'mongoose';
import { HttpError } from '../errors.js';
import {
  Account, Bill, Budget, BudgetAlert, Challenge, Debt, Goal, Group, Holding, ImportBatch, ImportProfile, ImportRule, Loan,
  CardReward, EnvelopePlan, NetWorthSnapshot, VaultItem, Vehicle, RecurringRule, RentProfile, SinkingFund, WishItem, SavedReport, Space, TdsEntry, Transaction, Trip, WeeklyBudget,
} from '../models/index.js';
import { checkPassword } from './auth.service.js';
import { logActivity } from './activity.service.js';
import { spaceReceiptIds } from './receipt.service.js';

export const BACKUP_FORMAT = 1;
const SETS = [
  ['accounts', Account], ['trips', Trip], ['recurringRules', RecurringRule], ['transactions', Transaction, { deletedAt: null }],
  ['budgets', Budget], ['weeklyBudgets', WeeklyBudget], ['goals', Goal], ['loans', Loan], ['debts', Debt], ['groups', Group],
  ['bills', Bill], ['holdings', Holding], ['netWorthSnapshots', NetWorthSnapshot], ['savedReports', SavedReport],
  ['challenges', Challenge], ['importRules', ImportRule], ['importProfiles', ImportProfile],
  ['tdsEntries', TdsEntry], ['rentProfiles', RentProfile],
  ['envelopePlans', EnvelopePlan], ['sinkingFunds', SinkingFund], ['wishItems', WishItem],
  ['vehicles', Vehicle], ['vaultItems', VaultItem], ['cardRewards', CardReward],
];
export const BACKUP_SETS = SETS.map(([key]) => key);
const MAX_RECORDS = 100_000;
const { ObjectId } = mongoose.Types;
const ID_RE = /^[a-f\d]{24}$/i;
// Fields naming a person: kept if that person is in the space, otherwise the one restoring.
const USER_KEYS = new Set(['user', 'createdBy', 'by']);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const bad = (message, details = []) => new HttpError(400, 'invalid_backup', message, details);

export async function exportSpace(space) {
  const data = {};
  for (const [key, Model, extra] of SETS) {
    data[key] = (await Model.find({ space: space._id, ...extra }).lean()).map(({ __v, ...doc }) => doc);
  }
  return {
    app: 'spendwise',
    format: BACKUP_FORMAT,
    exportedAt: new Date().toISOString(),
    space: { name: space.name, kind: space.kind, defaultAccount: space.defaultAccount ? String(space.defaultAccount) : null },
    counts: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length])),
    data,
  };
}

// Rewrites every reference: record ids to new ones, people outside the space to the person restoring.
function remap(value, ids, members, userId, key) {
  if (Array.isArray(value)) return value.map((v) => remap(v, ids, members, userId));
  if (value instanceof Date) return value;
  if (value instanceof ObjectId) return remap(String(value), ids, members, userId, key);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, remap(v, ids, members, userId, k)]));
  }
  if (typeof value === 'string' && ID_RE.test(value)) {
    if (USER_KEYS.has(key)) return members.has(value) ? value : String(userId);
    if (ids.has(value)) return ids.get(value);
  }
  return value;
}

// Checks a backup and turns it into documents for this space. `keepIds` is for putting a space back.
async function prepare(backup, space, userId, { keepIds = false } = {}) {
  if (!backup || backup.app !== 'spendwise' || !backup.data || typeof backup.data !== 'object') throw bad('This isn’t a Spendwise backup file');
  if (backup.format !== BACKUP_FORMAT) throw bad(`This backup is format ${backup.format}; this version of Spendwise reads format ${BACKUP_FORMAT}`);
  let total = 0;
  for (const [key] of SETS) {
    const list = backup.data[key] ?? [];
    if (!Array.isArray(list) || list.some((d) => !d || typeof d !== 'object' || Array.isArray(d))) throw bad(`“${key}” in the backup isn’t a list of records`);
    total += list.length;
  }
  if (total > MAX_RECORDS) throw bad(`The backup has ${total} records; at most ${MAX_RECORDS} can be restored at once`);
  const ids = new Map();
  for (const [key] of SETS) {
    for (const d of backup.data[key] ?? []) {
      const id = String(d._id ?? '');
      if (ID_RE.test(id)) ids.set(id, keepIds ? id : String(new ObjectId()));
    }
  }
  const members = new Set(space.members.map((m) => String(m.user)));
  const photos = await spaceReceiptIds(space._id);
  const plan = [];
  const problems = [];
  for (const [key, Model] of SETS) {
    const docs = (backup.data[key] ?? []).map((d) => {
      const doc = remap(d, ids, members, userId);
      doc.space = space._id;
      if (!ID_RE.test(String(doc._id ?? ''))) doc._id = new ObjectId();
      if (key === 'transactions') {
        doc.deletedAt = null;
        // Photos aren't in backups: an entry keeps its photo only if that photo is still stored for this space.
        if (doc.receipt && !photos.has(String(doc.receipt))) doc.receipt = null;
      }
      return doc;
    });
    docs.forEach((doc, i) => {
      const err = new Model(doc).validateSync();
      if (err && problems.length < 10) {
        const [first] = Object.values(err.errors);
        problems.push({ field: `${key}[${i}].${first.path}`, message: first.message });
      }
    });
    plan.push([key, Model, docs]);
  }
  const names = plan[0][2].map((a) => String(a.name).toLowerCase());
  const dupe = names.find((n, i) => names.indexOf(n) !== i);
  if (dupe) problems.push({ field: 'accounts', message: `Two accounts are called “${dupe}”` });
  if (problems.length) throw bad('Some records in the backup aren’t valid, so nothing was changed', problems);
  const oldDefault = backup.space?.defaultAccount ? String(backup.space.defaultAccount) : null;
  return { plan, defaultAccount: oldDefault && ids.has(oldDefault) ? ids.get(oldDefault) : null, total };
}

async function wipe(spaceId) {
  await Promise.all([
    ...SETS.map(([, Model]) => Model.deleteMany({ space: spaceId })),
    BudgetAlert.deleteMany({ space: spaceId }),
    ImportBatch.deleteMany({ space: spaceId }),
  ]);
}

async function insertAll({ plan }) {
  for (const [, Model, docs] of plan) if (docs.length) await Model.insertMany(docs, { ordered: true });
}

// Replaces everything in the space with the backup. Only the space's owner can, with their password.
export async function restore({ space, user }, { password, backup }) {
  if (String(space.owner) !== String(user._id)) throw new HttpError(403, 'not_owner', 'Only the owner of this space can restore a backup into it');
  await checkPassword(user, password);
  const fresh = await Space.findById(space._id);
  const next = await prepare(backup, fresh, user._id);
  const previous = await prepare(await exportSpace(fresh), fresh, user._id, { keepIds: true });
  await wipe(fresh._id);
  try {
    await insertAll(next);
  } catch (err) {
    await wipe(fresh._id);
    await insertAll(previous);
    throw new HttpError(400, 'restore_failed', `The backup couldn’t be restored (${err.message}). Your data was put back as it was.`);
  }
  let defaultAccount = next.defaultAccount ?? next.plan[0][2][0]?._id ?? null;
  if (!defaultAccount) defaultAccount = (await Account.create({ space: fresh._id, name: 'Cash', type: 'cash', createdBy: user._id }))._id;
  await Space.updateOne({ _id: fresh._id }, { $set: { defaultAccount } });
  const counts = Object.fromEntries(next.plan.map(([k, , docs]) => [k, docs.length]));
  const when = backup.exportedAt ? new Date(backup.exportedAt) : null;
  await logActivity({
    space: fresh._id, user: user._id, entity: 'space', entityId: fresh._id, action: 'restore',
    summary: `Restored a backup${when && !Number.isNaN(+when) ? ` from ${when.toISOString().slice(0, 10)}` : ''}: ${plural(counts.transactions, 'entry', 'entries')} and ${plural(counts.accounts, 'account', 'accounts')} (${next.total} records in all)`,
  });
  return { restored: counts };
}
