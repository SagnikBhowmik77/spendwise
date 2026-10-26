import mongoose from 'mongoose';
import { HttpError } from '../errors.js';
import { ActivityLog, Account, Transaction, User, serializeTransaction } from '../models/index.js';
import { currentAccess, runAs } from '../access.js';

// Batch 12R: other members' private accounts and their entries, to leave out of the history.
async function hiddenIds() {
  const hidden = currentAccess()?.hidden ?? [];
  if (!hidden.length) return [];
  const either = { $or: [{ account: { $in: hidden } }, { toAccount: { $in: hidden } }], pending: { $in: [true, false, null] } };
  const txs = await runAs({ hidden: [] }, () => Transaction.distinct('_id', either).exec());
  return [...hidden, ...txs];
}

// The fields of an entry that a version snapshot keeps.
export const TX_FIELDS = ['type', 'amountPaise', 'category', 'note', 'date', 'account', 'toAccount', 'paymentMethod', 'tags', 'splits', 'time', 'original', 'merchant', 'worth'];
export const snapshotTx = (t) => Object.fromEntries(TX_FIELDS.map((f) => [f, t[f] ?? null]));

export async function logActivity({ space, user, entity, entityId, action, summary, before = null, after = null }) {
  await ActivityLog.create({ space, user, entity, entityId, action, summary, before, after });
}

export async function listActivity(spaceId, { page = 1, limit = 30, entityId } = {}) {
  const filter = { space: spaceId };
  if (entityId) filter.entityId = entityId;
  const hide = await hiddenIds();
  if (hide.length) filter.entityId = entityId ? { $eq: entityId, $nin: hide } : { $nin: hide };
  const [rows, total] = await Promise.all([
    ActivityLog.find(filter).sort({ at: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    ActivityLog.countDocuments(filter),
  ]);
  const users = await User.find({ _id: { $in: [...new Set(rows.map((r) => String(r.user)))] } }).select('name').lean();
  const names = new Map(users.map((u) => [String(u._id), u.name]));
  return {
    items: rows.map((r) => ({
      id: String(r._id),
      entity: r.entity,
      entityId: String(r.entityId),
      action: r.action,
      summary: r.summary,
      at: r.at,
      user: { id: r.user ? String(r.user) : null, name: names.get(String(r.user)) ?? 'Former member' },
      // Entry edits can be rolled back to the version before them; deletions can be undone.
      canRestore: r.entity === 'transaction' && (r.action === 'update' || r.action === 'delete'),
      before: r.before,
      after: r.after,
    })),
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  };
}

// Puts an entry back the way it was: undoes a deletion, or restores the version before an edit.
export async function revert({ space, user }, logId) {
  if (!mongoose.isValidObjectId(logId)) throw new HttpError(404, 'activity_not_found', 'Activity not found');
  const log = await ActivityLog.findOne({ _id: logId, space: space._id }).lean();
  if (!log) throw new HttpError(404, 'activity_not_found', 'Activity not found');
  if (log.entity !== 'transaction' || !['update', 'delete'].includes(log.action)) {
    throw new HttpError(400, 'not_restorable', 'Only edits and deletions of entries can be restored');
  }
  const tx = await Transaction.findOne({ _id: log.entityId, space: space._id });
  if (!tx) throw new HttpError(410, 'entry_gone', 'This entry was permanently removed, so it can no longer be restored');

  const current = snapshotTx(tx);
  let summary;
  if (log.action === 'delete') {
    if (!tx.deletedAt) throw new HttpError(409, 'already_restored', 'This entry has already been restored');
    tx.deletedAt = null;
    summary = `Restored ${log.summary.replace(/^Deleted /, '')}`;
  } else {
    const ids = [log.before.account, log.before.toAccount].filter(Boolean);
    const found = await Account.countDocuments({ _id: { $in: ids }, space: space._id });
    if (found !== ids.length) throw new HttpError(409, 'account_gone', "An account this version used no longer exists, so it can't be restored");
    // Versions saved before a field existed have no value for it: use that field's empty value.
    const empty = { tags: [], splits: undefined };
    for (const f of TX_FIELDS) tx[f] = log.before[f] ?? (f in empty ? empty[f] : null);
    if (tx.deletedAt) tx.deletedAt = null;
    summary = `Restored an earlier version: ${log.summary.replace(/^Edited /, '')}`;
  }
  await tx.save();
  await logActivity({
    space: space._id, user: user._id, entity: 'transaction', entityId: tx._id,
    action: log.action === 'delete' ? 'restore' : 'revert', summary, before: current, after: snapshotTx(tx),
  });
  return serializeTransaction(tx);
}
