import * as reports from '../services/report.service.js';

export function getSettings(req, res) {
  res.json(reports.getSettings(req.user));
}

export async function updateSettings(req, res) {
  res.json(await reports.updateSettings(req.user, req.valid.body));
}

export async function preview(req, res) {
  res.json(await reports.preview(req.user, req.valid.query.month));
}

export async function sendTest(req, res) {
  res.json(await reports.sendTest(req.user, req.valid.body.month));
}
