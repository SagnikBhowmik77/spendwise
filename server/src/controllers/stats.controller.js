import * as stats from '../services/stats.service.js';

export async function summary(req, res) {
  res.json(await stats.summary(req.space._id, req.valid.query));
}

export async function byCategory(req, res) {
  res.json(await stats.byCategory(req.space._id, req.valid.query));
}

export async function byPaymentMethod(req, res) {
  res.json(await stats.byPaymentMethod(req.space._id, req.valid.query));
}

export async function monthly(req, res) {
  res.json(await stats.monthly(req.space._id, req.valid.query));
}

export async function daily(req, res) {
  res.json(await stats.daily(req.space._id, req.valid.query));
}
