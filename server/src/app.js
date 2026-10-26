import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config.js';
import { errorHandler, notFound } from './errors.js';
import { dbStatus } from './db.js';
import { authRouter } from './routes/auth.routes.js';
import { transactionRouter, categoryRouter } from './routes/transaction.routes.js';
import { statsRouter } from './routes/stats.routes.js';
import { budgetRouter } from './routes/budget.routes.js';
import { exportRouter } from './routes/export.routes.js';
import { recurringRouter } from './routes/recurring.routes.js';
import { reportRouter } from './routes/report.routes.js';
import { approvalRouter, spaceRouter, inviteRouter } from './routes/space.routes.js';
import { accountRouter } from './routes/account.routes.js';
import { activityRouter } from './routes/activity.routes.js';
import { fxRouter, receiptRouter, tagRouter, tripRouter } from './routes/extra.routes.js';
import { importRouter } from './routes/import.routes.js';
import { notificationRouter } from './routes/notification.routes.js';
import { billRouter, debtRouter, goalRouter, groupRouter, loanRouter } from './routes/planning.routes.js';
import { envelopeRouter, sinkingFundRouter, wishlistRouter } from './routes/budgeting.routes.js';
import { cardRewardRouter, fireRouter, vaultRouter, vehicleRouter } from './routes/life.routes.js';
import { challengeRouter, insightRouter, savedReportRouter } from './routes/insight.routes.js';
import { cashflowRouter, taxRouter } from './routes/tax.routes.js';
import { investmentRouter } from './routes/investment.routes.js';
import { backupRouter } from './routes/backup.routes.js';
import { calendarFeedRouter, integrationRouter } from './routes/integration.routes.js';
import { onboardingRouter } from './routes/onboarding.routes.js';
import { scheduleAlertCheck } from './services/alert.service.js';
import { emailConfigured } from './mailer.js';
import { authConfigured } from './services/auth.service.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');

  app.use(helmet());
  // Content-Disposition is exposed so the client can read export filenames.
  // The client sends X-Space-Id to pick a shared space; browsers need it allowed explicitly.
  app.use(cors({
    origin: config.clientOrigins,
    exposedHeaders: ['Content-Disposition'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Space-Id', 'X-Device-Id'],
  }));
  // Statement imports and backups parse their own (larger) bodies; everything else is capped at 100 KB.
  const json = express.json({ limit: '100kb' });
  app.use((req, res, next) => (req.path.startsWith('/api/imports') || req.path.startsWith('/api/backup') ? next() : json(req, res, next)));

  // `ok` means the API can serve data: it is false while the database is missing or unreachable.
  app.get('/api/health', (_req, res) => {
    const database = dbStatus();
    // The reason text can mention hosts or users; only show it outside production.
    if (config.env === 'production') delete database.problem;
    res.status(database.connected ? 200 : 503).json({
      ok: database.connected,
      service: 'spendwise-api',
      uptimeSec: Math.round(process.uptime()),
      database,
      auth: { configured: authConfigured() },
      email: { configured: emailConfigured() },
    });
  });

  // Any successful change to entries or budgets may push a budget past 80% or 100%: check soon after.
  const SPENDING_WRITES = /^\/api\/(transactions|imports|activity|budgets|loans|bills|investments)(\/|$)/;
  app.use((req, res, next) => {
    if (req.method !== 'GET' && SPENDING_WRITES.test(req.path)) {
      res.on('finish', () => { if (req.space && res.statusCode < 400) scheduleAlertCheck(req.space._id); });
    }
    next();
  });

  app.use('/api/auth', authRouter());
  app.use('/api/transactions', receiptRouter());
  app.use('/api/transactions', transactionRouter());
  app.use('/api/fx', fxRouter());
  app.use('/api/tags', tagRouter());
  app.use('/api/trips', tripRouter());
  app.use('/api/categories', categoryRouter());
  app.use('/api/stats', statsRouter());
  app.use('/api/budgets', budgetRouter());
  app.use('/api/export', exportRouter());
  app.use('/api/recurring', recurringRouter());
  app.use('/api/reports', reportRouter());
  app.use('/api/spaces', spaceRouter());
  app.use('/api/invites', inviteRouter());
  app.use('/api/approvals', approvalRouter());
  app.use('/api/accounts', accountRouter());
  app.use('/api/activity', activityRouter());
  app.use('/api/onboarding', onboardingRouter());
  app.use('/api/imports', importRouter());
  app.use('/api/notifications', notificationRouter());
  app.use('/api/goals', goalRouter());
  app.use('/api/loans', loanRouter());
  app.use('/api/debts', debtRouter());
  app.use('/api/groups', groupRouter());
  app.use('/api/bills', billRouter());
  app.use('/api/envelopes', envelopeRouter());
  app.use('/api/sinking-funds', sinkingFundRouter());
  app.use('/api/wishlist', wishlistRouter());
  app.use('/api/vehicles', vehicleRouter());
  app.use('/api/vault', vaultRouter());
  app.use('/api/card-rewards', cardRewardRouter());
  app.use('/api/fire', fireRouter());
  app.use('/api/insights', insightRouter());
  app.use('/api/saved-reports', savedReportRouter());
  app.use('/api/challenges', challengeRouter());
  app.use('/api/tax', taxRouter());
  app.use('/api/cashflow', cashflowRouter());
  app.use('/api/investments', investmentRouter());
  app.use('/api/backup', backupRouter());
  app.use('/api/integrations', integrationRouter());
  app.use('/api/calendar', calendarFeedRouter());

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
