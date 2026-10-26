// Investments, SIPs, PPF deposits, AMFI fund search and the net-worth timeline (batch 12H).
import * as inv from '../services/investment.service.js';
import { AMFI_SOURCE, searchSchemes } from '../services/nav.service.js';

const ctx = (req) => ({ space: req.space, user: req.user });
const sid = (req) => req.space._id;

export const list = async (req, res) => res.json(await inv.list(sid(req)));
export const get = async (req, res) => res.json({ holding: await inv.get(sid(req), req.params.id) });
export const create = async (req, res) => res.status(201).json({ holding: await inv.create(ctx(req), req.valid.body) });
export const update = async (req, res) => res.json({ holding: await inv.update(sid(req), req.params.id, req.valid.body) });
export const remove = async (req, res) => { await inv.remove(sid(req), req.params.id); res.status(204).end(); };
export const addTrade = async (req, res) => res.status(201).json({ holding: await inv.addTrade(ctx(req), req.params.id, req.valid.body) });
export const removeTrade = async (req, res) => res.json({ holding: await inv.removeTrade(ctx(req), req.params.id, req.params.tradeId) });
export const setSip = async (req, res) => res.json({ holding: await inv.setSip(ctx(req), req.params.id, req.valid.body) });
export const stopSip = async (req, res) => res.json({ holding: await inv.stopSip(sid(req), req.params.id) });
export const addDeposit = async (req, res) => res.status(201).json({ holding: await inv.addDeposit(sid(req), req.params.id, req.valid.body) });
export const removeDeposit = async (req, res) => res.json({ holding: await inv.removeDeposit(sid(req), req.params.id, req.params.depositId) });
export const addPassbook = async (req, res) => res.status(201).json({ holding: await inv.addPassbook(sid(req), req.params.id, req.valid.body) });
export const removePassbook = async (req, res) => res.json({ holding: await inv.removePassbook(sid(req), req.params.id, req.params.entryId) });
export const schemes = async (req, res) => res.json({ schemes: await searchSchemes(req.valid.query.q), source: AMFI_SOURCE });
export const timeline = async (req, res) => res.json(await inv.timeline(sid(req), req.valid.query));
