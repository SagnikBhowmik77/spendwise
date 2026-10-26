import * as transactions from '../services/transaction.service.js';

// Who is acting, and in which space (set by requireAuth + requireSpace).
const ctx = (req) => ({ space: req.space, user: req.user });

export async function create(req, res) {
  res.status(201).json({ transaction: await transactions.create({ ...ctx(req), direct: true }, req.valid.body) });
}

export async function list(req, res) {
  res.json(await transactions.list(req.space._id, req.valid.query));
}

export async function get(req, res) {
  res.json({ transaction: await transactions.get(req.space._id, req.params.id) });
}

export async function update(req, res) {
  res.json({ transaction: await transactions.update(ctx(req), req.params.id, req.valid.body) });
}

// 200 (not 204): the answer says until when the deletion can be undone.
export async function remove(req, res) {
  res.json(await transactions.remove(ctx(req), req.params.id));
}

export async function restore(req, res) {
  res.json({ transaction: await transactions.restore(ctx(req), req.params.id) });
}

export async function categories(req, res) {
  res.json(await transactions.categories(req.space._id));
}
