import { Router } from 'express';
import { requireDb } from '../db.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireSpace } from '../middleware/requireSpace.js';
import { emailConfigured } from '../mailer.js';
import { Account, Budget, TelegramLink, Transaction, WeeklyBudget } from '../models/index.js';

// The dashboard's "Get started" checklist: each step is read from what is really in the space, never stored.
// A new space has only the "Cash" account, so a second account (or a renamed or non-cash one) counts as set up.
export async function checklist(user, space) {
  const [accounts, entry, budget, weekly, telegram] = await Promise.all([
    Account.find({ space: space._id }).select('name type').lean(),
    Transaction.exists({ space: space._id, deletedAt: null }),
    Budget.exists({ space: space._id }),
    WeeklyBudget.exists({ space: space._id }),
    TelegramLink.exists({ user: user._id }),
  ]);
  const account = accounts.length > 1 || accounts.some((a) => a.type !== 'cash' || a.name !== 'Cash');
  return {
    dismissed: Boolean(user.checklistDismissedAt),
    // Confirming the email is only a step when this server can send email.
    steps: {
      account,
      entry: Boolean(entry),
      budget: Boolean(budget || weekly),
      ...(emailConfigured() && { email: Boolean(user.emailVerifiedAt) }),
      telegram: Boolean(telegram),
    },
  };
}

export function onboardingRouter() {
  const router = Router();
  router.use(requireDb, requireAuth, requireSpace);
  router.get('/', async (req, res) => res.json(await checklist(req.user, req.space)));
  return router;
}
