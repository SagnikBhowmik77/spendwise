// Goals, loans, money lent/borrowed, group expenses and bills (batch 12E).
import * as goals from '../services/goal.service.js';
import * as loans from '../services/loan.service.js';
import * as debts from '../services/debt.service.js';
import * as groups from '../services/group.service.js';
import * as bills from '../services/bill.service.js';

const ctx = (req) => ({ space: req.space, user: req.user });
const sid = (req) => req.space._id;

export const listGoals = async (req, res) => res.json(await goals.list(sid(req)));
export const createGoal = async (req, res) => res.status(201).json({ goal: await goals.create(ctx(req), req.valid.body) });
export const updateGoal = async (req, res) => res.json({ goal: await goals.update(sid(req), req.params.id, req.valid.body) });
export const deleteGoal = async (req, res) => { await goals.remove(sid(req), req.params.id); res.status(204).end(); };
export const addGoalEntry = async (req, res) => res.status(201).json({ goal: await goals.addEntry(ctx(req), req.params.id, req.valid.body) });
export const deleteGoalEntry = async (req, res) => res.json({ goal: await goals.removeEntry(sid(req), req.params.id, req.params.entryId) });

export const listLoans = async (req, res) => res.json({ loans: await loans.list(sid(req)) });
export const createLoan = async (req, res) => res.status(201).json({ loan: await loans.create(ctx(req), req.valid.body) });
export const updateLoan = async (req, res) => res.json({ loan: await loans.update(sid(req), req.params.id, req.valid.body) });
export const deleteLoan = async (req, res) => { await loans.remove(sid(req), req.params.id); res.status(204).end(); };
export const addLoanPayment = async (req, res) => res.status(201).json({ loan: await loans.addPayment(ctx(req), req.params.id, req.valid.body) });
export const deleteLoanPayment = async (req, res) => res.json({ loan: await loans.removePayment(ctx(req), req.params.id, req.params.paymentId) });
export const loanPrepayment = async (req, res) => res.json(await loans.prepayment(sid(req), req.params.id, req.valid.query));

export const listDebts = async (req, res) => res.json(await debts.list(sid(req)));
export const createDebt = async (req, res) => res.status(201).json({ debt: await debts.create(ctx(req), req.valid.body) });
export const updateDebt = async (req, res) => res.json({ debt: await debts.update(sid(req), req.params.id, req.valid.body) });
export const deleteDebt = async (req, res) => { await debts.remove(sid(req), req.params.id); res.status(204).end(); };
export const settleDebt = async (req, res) => res.status(201).json({ debt: await debts.settle(sid(req), req.params.id, req.valid.body) });
export const deleteDebtSettlement = async (req, res) => res.json({ debt: await debts.removeSettlement(sid(req), req.params.id, req.params.settlementId) });

export const listGroups = async (req, res) => res.json({ groups: await groups.list(sid(req)) });
export const getGroup = async (req, res) => res.json({ group: await groups.get(sid(req), req.params.id) });
export const createGroup = async (req, res) => res.status(201).json({ group: await groups.create(ctx(req), req.valid.body) });
export const updateGroup = async (req, res) => res.json({ group: await groups.update(sid(req), req.params.id, req.valid.body) });
export const deleteGroup = async (req, res) => { await groups.remove(sid(req), req.params.id); res.status(204).end(); };
export const addGroupExpense = async (req, res) => res.status(201).json({ group: await groups.addExpense(sid(req), req.params.id, req.valid.body) });
export const deleteGroupExpense = async (req, res) => res.json({ group: await groups.removeExpense(sid(req), req.params.id, req.params.expenseId) });
export const addGroupSettlement = async (req, res) => res.status(201).json({ group: await groups.addSettlement(sid(req), req.params.id, req.valid.body) });
export const deleteGroupSettlement = async (req, res) => res.json({ group: await groups.removeSettlement(sid(req), req.params.id, req.params.settlementId) });

export const listBills = async (req, res) => res.json({ bills: await bills.list(sid(req)) });
export const billCalendar = async (req, res) => res.json(await bills.calendar(sid(req), req.valid.query.month));
export const createBill = async (req, res) => res.status(201).json({ bill: await bills.create(ctx(req), req.valid.body) });
export const updateBill = async (req, res) => res.json({ bill: await bills.update(sid(req), req.params.id, req.valid.body) });
export const deleteBill = async (req, res) => { await bills.remove(sid(req), req.params.id); res.status(204).end(); };
export const payBill = async (req, res) => res.json({ bill: await bills.pay(ctx(req), req.params.id, req.valid.body) });
export const skipBill = async (req, res) => res.json({ bill: await bills.skip(sid(req), req.params.id) });
export const undoBillPayment = async (req, res) => res.json({ bill: await bills.undoLast(ctx(req), req.params.id) });
