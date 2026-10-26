import * as accounts from '../services/account.service.js';

const ctx = (req) => ({ space: req.space, user: req.user });

export async function list(req, res) {
  res.json(await accounts.list(req.space, req.valid.query));
}

export async function create(req, res) {
  res.status(201).json({ account: await accounts.create(ctx(req), req.valid.body) });
}

export async function update(req, res) {
  res.json({ account: await accounts.update(ctx(req), req.params.id, req.valid.body) });
}

export async function remove(req, res) {
  await accounts.remove(ctx(req), req.params.id);
  res.status(204).end();
}

export async function cycle(req, res) {
  res.json(await accounts.cycle(req.space, req.params.id));
}
