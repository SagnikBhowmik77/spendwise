import * as budgets from '../services/budget.service.js';

export async function list(req, res) {
  res.json(await budgets.list(req.space._id, req.valid.query));
}

export async function upsert(req, res) {
  const { created, budget } = await budgets.upsert(req.space._id, req.valid.body, req.user._id);
  res.status(created ? 201 : 200).json({ budget });
}

export async function update(req, res) {
  res.json({ budget: await budgets.update(req.space._id, req.params.id, req.valid.body) });
}

export async function remove(req, res) {
  await budgets.remove(req.space._id, req.params.id);
  res.status(204).end();
}

export async function copy(req, res) {
  res.json(await budgets.copy(req.space._id, req.valid.body, req.user._id));
}

export async function history(req, res) {
  res.json(await budgets.history(req.space._id, req.valid.query));
}

export async function weekly(req, res) {
  res.json(await budgets.weekly(req.space._id, req.valid.query));
}

export async function upsertWeekly(req, res) {
  const { created, budget } = await budgets.upsertWeekly(req.space._id, req.valid.body, req.user._id);
  res.status(created ? 201 : 200).json({ budget });
}

export async function removeWeekly(req, res) {
  await budgets.removeWeekly(req.space._id, req.params.id);
  res.status(204).end();
}
