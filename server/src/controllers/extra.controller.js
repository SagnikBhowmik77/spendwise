import * as fx from '../services/fx.service.js';
import * as trips from '../services/trip.service.js';
import * as receipts from '../services/receipt.service.js';
import { tags as listTags } from '../services/transaction.service.js';

const ctx = (req) => ({ space: req.space, user: req.user });

export async function currencies(_req, res) {
  res.json({ currencies: await fx.currencies() });
}

// What a foreign amount would be in rupees on a day (for the form's live preview).
export async function rate(req, res) {
  const { currency, date } = req.valid.query;
  res.json({ currency, ...(await fx.rateFor(currency, date)) });
}

export async function tags(req, res) {
  res.json({ tags: await listTags(req.space._id) });
}

export async function listTrips(req, res) {
  res.json({ trips: await trips.list(req.space._id) });
}
export async function startTrip(req, res) {
  res.status(201).json({ trip: await trips.start(ctx(req), req.valid.body) });
}
export async function updateTrip(req, res) {
  res.json({ trip: await trips.update(req.space._id, req.params.id, req.valid.body) });
}
export async function deleteTrip(req, res) {
  await trips.remove(req.space._id, req.params.id);
  res.status(204).end();
}
export async function tripSummary(req, res) {
  res.json(await trips.summarize(req.space._id, req.params.id));
}

export async function uploadReceipt(req, res) {
  res.status(201).json(await receipts.upload(ctx(req), req.params.id, req.body));
}
export async function getReceipt(req, res) {
  await receipts.stream(req.space._id, req.params.id, res);
}
export async function deleteReceipt(req, res) {
  await receipts.remove(ctx(req), req.params.id);
  res.status(204).end();
}
