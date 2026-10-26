import * as recurring from '../services/recurring.service.js';

export async function create(req, res) {
  const { rule, created } = await recurring.create({ space: req.space, user: req.user }, req.valid.body);
  // `created` = entries that were already due and were added straight away.
  res.status(201).json({ rule, created });
}

export async function list(req, res) {
  res.json({ rules: await recurring.list(req.space._id) });
}

export async function get(req, res) {
  res.json({ rule: await recurring.get(req.space._id, req.params.id) });
}

export async function update(req, res) {
  res.json({ rule: await recurring.update(req.space._id, req.params.id, req.valid.body) });
}

export async function remove(req, res) {
  await recurring.remove(req.space._id, req.params.id);
  res.status(204).end();
}

export async function upcoming(req, res) {
  res.json(await recurring.upcoming(req.space._id, req.valid.query));
}
