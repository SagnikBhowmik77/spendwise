import { Router } from 'express';
import { requireDb } from '../db.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireSpace } from '../middleware/requireSpace.js';
import * as ctrl from '../controllers/planning.controller.js';
import * as s from '../schemas/planning.schemas.js';

const spaceRouter = () => {
  const router = Router();
  router.use(requireDb, requireAuth, requireSpace);
  return router;
};

export function goalRouter() {
  const r = spaceRouter();
  r.get('/', ctrl.listGoals);
  r.post('/', validate({ body: s.goalCreate }), ctrl.createGoal);
  r.patch('/:id', validate({ body: s.goalUpdate }), ctrl.updateGoal);
  r.delete('/:id', ctrl.deleteGoal);
  r.post('/:id/entries', validate({ body: s.goalEntry }), ctrl.addGoalEntry);
  r.delete('/:id/entries/:entryId', ctrl.deleteGoalEntry);
  return r;
}

export function loanRouter() {
  const r = spaceRouter();
  r.get('/', ctrl.listLoans);
  r.post('/', validate({ body: s.loanCreate }), ctrl.createLoan);
  r.patch('/:id', validate({ body: s.loanUpdate }), ctrl.updateLoan);
  r.delete('/:id', ctrl.deleteLoan);
  r.post('/:id/payments', validate({ body: s.loanPayment }), ctrl.addLoanPayment);
  r.delete('/:id/payments/:paymentId', ctrl.deleteLoanPayment);
  r.get('/:id/prepayment', validate({ query: s.prepaymentQuery }), ctrl.loanPrepayment);
  return r;
}

export function debtRouter() {
  const r = spaceRouter();
  r.get('/', ctrl.listDebts);
  r.post('/', validate({ body: s.debtCreate }), ctrl.createDebt);
  r.patch('/:id', validate({ body: s.debtUpdate }), ctrl.updateDebt);
  r.delete('/:id', ctrl.deleteDebt);
  r.post('/:id/settlements', validate({ body: s.debtSettle }), ctrl.settleDebt);
  r.delete('/:id/settlements/:settlementId', ctrl.deleteDebtSettlement);
  return r;
}

export function groupRouter() {
  const r = spaceRouter();
  r.get('/', ctrl.listGroups);
  r.post('/', validate({ body: s.groupCreate }), ctrl.createGroup);
  r.get('/:id', ctrl.getGroup);
  r.patch('/:id', validate({ body: s.groupUpdate }), ctrl.updateGroup);
  r.delete('/:id', ctrl.deleteGroup);
  r.post('/:id/expenses', validate({ body: s.groupExpense }), ctrl.addGroupExpense);
  r.delete('/:id/expenses/:expenseId', ctrl.deleteGroupExpense);
  r.post('/:id/settlements', validate({ body: s.groupSettlement }), ctrl.addGroupSettlement);
  r.delete('/:id/settlements/:settlementId', ctrl.deleteGroupSettlement);
  return r;
}

export function billRouter() {
  const r = spaceRouter();
  r.get('/', ctrl.listBills);
  r.get('/calendar', validate({ query: s.calendarQuery }), ctrl.billCalendar);
  r.post('/', validate({ body: s.billCreate }), ctrl.createBill);
  r.patch('/:id', validate({ body: s.billUpdate }), ctrl.updateBill);
  r.delete('/:id', ctrl.deleteBill);
  r.post('/:id/pay', validate({ body: s.billPay }), ctrl.payBill);
  r.post('/:id/skip', ctrl.skipBill);
  r.post('/:id/undo', ctrl.undoBillPayment);
  return r;
}
