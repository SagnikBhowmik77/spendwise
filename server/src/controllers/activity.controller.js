import * as activity from '../services/activity.service.js';

export async function list(req, res) {
  res.json(await activity.listActivity(req.space._id, req.valid.query));
}

// Undo a deletion, or put an entry back to the version before an edit.
export async function revert(req, res) {
  res.json({ transaction: await activity.revert({ space: req.space, user: req.user }, req.params.id) });
}
