// Batch 12R: big expenses waiting for the owner. They count nowhere until approved; turned down, they are deleted
// (and, unlike a normal delete, can't be restored from the bin).
import mongoose from 'mongoose';
import { HttpError } from '../errors.js';
import { Transaction, User, serializeTransaction } from '../models/index.js';
import { formatPaise } from '../money.js';
import { logActivity } from './activity.service.js';
import { emitSpaceEvent } from '../events.js';
import { notifySpace } from './alert.service.js';
import { describeTx } from './transaction.service.js';
import { requireOwner } from './space.service.js';

const NOT_FOUND = () => new HttpError(404, 'approval_not_found', 'Nothing is waiting with that id');
const PENDING = (spaceId) => ({ space: spaceId, pending: true, deletedAt: null });

export async function list(spaceId) {
  const docs = await Transaction.find(PENDING(spaceId)).sort({ createdAt: 1 }).lean();
  const users = await User.find({ _id: { $in: docs.map((d) => d.user) } }).select('name').lean();
  const names = new Map(users.map((u) => [String(u._id), u.name]));
  return { pending: docs.map((d) => ({ ...serializeTransaction(d), requestedBy: names.get(String(d.user)) ?? 'Former member' })) };
}

export async function decide({ space, user }, id, { decision }) {
  requireOwner(space, user);
  if (!mongoose.isValidObjectId(id)) throw NOT_FOUND();
  const doc = await Transaction.findOne({ _id: id, ...PENDING(space._id) });
  if (!doc) throw NOT_FOUND();
  const approved = decision === 'approve';
  // Claimed in one step, so two clicks can't approve and turn down the same entry.
  const claim = await Transaction.updateOne(
    { _id: doc._id, pending: true, deletedAt: null },
    approved ? { $unset: { pending: 1 } } : { $set: { deletedAt: new Date() } },
  );
  if (!claim.modifiedCount) throw NOT_FOUND();
  await logActivity({
    space: space._id, user: user._id, entity: 'transaction', entityId: doc._id, action: approved ? 'approve' : 'reject',
    summary: `${approved ? 'Approved' : 'Turned down'} ${describeTx(doc)}`,
  });
  const fresh = await Transaction.findOne({ _id: doc._id, pending: { $in: [true, false, null] } }).lean();
  if (approved) emitSpaceEvent(space._id, 'transaction.created', serializeTransaction(fresh));
  const asker = space.members.filter((m) => String(m.user) === String(doc.user) && String(m.user) !== String(user._id));
  if (asker.length) {
    await notifySpace({ ...(space.toObject?.() ?? space), members: asker }, {
      kind: 'budget',
      title: `₹${formatPaise(doc.amountPaise)} ${doc.category} ${approved ? 'approved' : 'turned down'}`,
      body: approved ? `${user.name} approved it, so it now counts in ${space.name}.` : `${user.name} turned it down, so it was removed from ${space.name}.`,
      path: approved ? '/transactions' : '/approvals', tag: `approval-${doc._id}`, linkText: 'Open Spendwise',
    });
  }
  return { transaction: serializeTransaction(fresh), decision };
}
