// One-off data upgrades, run on every start before indexes are built. Each is safe to run again.
import { Budget, RecurringRule, Transaction, User } from './models/index.js';
import { ensurePersonalSpace } from './services/space.service.js';

// Batch 12A: entries, budgets and rules from before spaces existed move into their owner's personal
// space; entries and rules also get that space's "Cash" account.
async function moveIntoPersonalSpaces() {
  let moved = 0;
  for (const Model of [Transaction, Budget, RecurringRule]) {
    const userIds = await Model.collection.distinct('user', { space: { $exists: false } });
    for (const userId of userIds) {
      const user = await User.findById(userId);
      if (!user) continue;
      const space = await ensurePersonalSpace(user);
      const set = { space: space._id };
      if (Model !== Budget) set.account = space.defaultAccount;
      const res = await Model.collection.updateMany({ user: userId, space: { $exists: false } }, { $set: set });
      moved += res.modifiedCount;
    }
  }
  return moved;
}

export async function runMigrations(log = console) {
  const moved = await moveIntoPersonalSpaces();
  if (moved) log.log(`Migration: moved ${moved} older record(s) into personal spaces`);
  return { moved };
}
