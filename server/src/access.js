// Batch 12R: who is asking, for the whole of a request. requireSpace starts a context with the member's role
// and the accounts they can't see (other members' private accounts); the query hooks below leave those
// accounts and their entries out of every read, and entries waiting for approval out of every total.
import { AsyncLocalStorage } from 'node:async_hooks';

const store = new AsyncLocalStorage();

export const runAs = (ctx, fn) => store.run(ctx, fn);
export const currentAccess = () => store.getStore() ?? null;
const hidden = () => {
  const ids = store.getStore()?.hidden;
  return ids?.length ? ids : null;
};

const READS = ['find', 'findOne', 'countDocuments', 'distinct', 'findOneAndUpdate', 'updateOne', 'updateMany'];

// Account: someone else's private account doesn't exist for you.
export function accountPrivacy(schema) {
  schema.pre(READS, function hide() {
    const ids = hidden();
    if (ids) this.and([{ _id: { $nin: ids } }]);
  });
  schema.pre('aggregate', function hide() {
    const ids = hidden();
    if (ids) this.pipeline().unshift({ $match: { _id: { $nin: ids } } });
  });
}

// Transaction: entries in accounts you can't see are left out, and so are entries waiting for the owner's
// approval unless the query asks about `pending` itself (the approvals list does).
export function transactionPrivacy(schema) {
  schema.pre(READS, function hide() {
    const ids = hidden();
    if (ids) this.and([{ account: { $nin: ids } }, { toAccount: { $nin: ids } }]);
    if (!('pending' in this.getFilter())) this.and([{ pending: { $ne: true } }]);
  });
  schema.pre('aggregate', function hide() {
    const ids = hidden();
    const match = this.options.withPending ? {} : { pending: { $ne: true } };
    if (ids) Object.assign(match, { account: { $nin: ids }, toAccount: { $nin: ids } });
    if (Object.keys(match).length) this.pipeline().unshift({ $match: match });
  });
}
