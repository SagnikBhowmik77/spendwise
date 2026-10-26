import * as spaces from '../services/space.service.js';

export async function list(req, res) {
  res.json({ spaces: await spaces.listSpaces(req.user) });
}

// The space this request resolved to (X-Space-Id, or personal), with its members.
export async function current(req, res) {
  res.json({ space: await spaces.describe(req.space, req.user) });
}

export async function create(req, res) {
  res.status(201).json({ space: await spaces.createShared(req.user, req.valid.body) });
}

export async function rename(req, res) {
  res.json({ space: await spaces.rename(req.user, req.params.id, req.valid.body) });
}

export async function remove(req, res) {
  await spaces.deleteShared(req.user, req.params.id);
  res.status(204).end();
}

export async function invite(req, res) {
  res.status(201).json(await spaces.invite(req.user, req.params.id, req.valid.body));
}

export async function revokeInvite(req, res) {
  await spaces.revokeInvite(req.user, req.params.id, req.params.inviteId);
  res.status(204).end();
}

// Removing yourself means leaving the space.
export async function removeMember(req, res) {
  res.json(await spaces.removeMember(req.user, req.params.id, req.params.userId));
}

export async function getInvite(req, res) {
  res.json({ invite: await spaces.getInvite(req.params.token) });
}

export async function acceptInvite(req, res) {
  res.json({ space: await spaces.acceptInvite(req.user, req.params.token) });
}

// Batch 12R: a member's role or pocket money, and the space's approval limit.
export async function updateMember(req, res) {
  res.json({ space: await spaces.updateMember(req.user, req.params.id, req.params.userId, req.valid.body) });
}

export async function updateSettings(req, res) {
  res.json({ space: await spaces.updateSettings(req.user, req.params.id, req.valid.body) });
}
