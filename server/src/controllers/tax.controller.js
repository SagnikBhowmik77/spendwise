// Tax helper, salary breakdown, cash-flow calendar and "Can I afford it?" (batch 12G).
import * as tax from '../services/tax.service.js';
import * as flow from '../services/cashflow.service.js';
import * as gains from '../services/capitalGains.service.js';
import * as records from '../services/taxRecords.service.js';

export const rules = async (req, res) => res.json(tax.rules(req.valid.query.fy ?? tax.currentFy()));
export const summary = async (req, res) => {
  const { fy, ...rest } = req.valid.query;
  res.json(await tax.summary(req.space._id, { fy: fy ?? tax.currentFy(), ...rest }));
};
export const salary = async (req, res) => res.json(tax.salary({ ...req.valid.body, fy: req.valid.body.fy ?? tax.currentFy() }));
// Batch 12M: capital gains, interest and TDS, rent receipts.
export const capitalGains = async (req, res) => {
  const { fy, slabPct } = req.valid.query;
  res.json(await gains.report(req.space._id, { fy: fy ?? gains.currentCgYear(), slabPct: slabPct ?? null }));
};
const fyOr = (req) => req.valid.query.fy ?? tax.currentFy();
export const interest = async (req, res) => res.json(await records.interestAndTds(req.space._id, { fy: fyOr(req) }));
export const addTds = async (req, res) => res.status(201).json({ record: await records.addTds(req, req.valid.body) });
export const updateTds = async (req, res) => res.json({ record: await records.updateTds(req.space._id, req.params.id, req.valid.body) });
export const removeTds = async (req, res) => { await records.removeTds(req.space._id, req.params.id); res.status(204).end(); };
export const rentProfile = async (req, res) => res.json({ profile: await records.getRentProfile(req.space, req.user) });
export const saveRentProfile = async (req, res) => res.json({ profile: await records.saveRentProfile(req.space, req.user, req.valid.body) });
export const rentReceipts = async (req, res) => res.json(await records.rentReceipts(req.space, req.user, { fy: fyOr(req) }));
export const rentReceiptsPdf = async (req, res) => records.writeRentReceiptsPdf(req.space, req.user, { fy: fyOr(req) }, res);
export const cashflow = async (req, res) => res.json(await flow.cashflow(req.space, req.valid.query));
export const afford = async (req, res) => res.json(await flow.afford(req.space, req.valid.query));
