import * as imports from '../services/import.service.js';

const ctx = (req) => ({ space: req.space, user: req.user });

export async function preview(req, res) {
  res.json(await imports.preview(req.space._id, req.valid.body));
}
export async function commit(req, res) {
  res.status(201).json({ import: await imports.commit(ctx(req), req.valid.body) });
}
export async function list(req, res) {
  res.json({ imports: await imports.list(req.space._id) });
}
export async function undo(req, res) {
  res.json(await imports.undo(ctx(req), req.params.id));
}
export async function redo(req, res) {
  res.json(await imports.redo(ctx(req), req.params.id));
}

export async function listRules(req, res) {
  res.json({ rules: await imports.listRules(req.space._id) });
}
export async function saveRule(req, res) {
  const { rule, created } = await imports.saveRule(ctx(req), req.valid.body);
  res.status(created ? 201 : 200).json({ rule });
}
export async function removeRule(req, res) {
  await imports.removeRule(req.space._id, req.params.id);
  res.status(204).end();
}

export async function listLayouts(req, res) {
  res.json({ layouts: await imports.listLayouts(req.space._id) });
}
export async function saveLayout(req, res) {
  res.json({ layout: await imports.saveLayout(ctx(req), req.valid.body) });
}
export async function removeLayout(req, res) {
  await imports.removeLayout(req.space._id, req.params.id);
  res.status(204).end();
}
