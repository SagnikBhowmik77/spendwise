import { config } from './config.js';
import { processDue } from './services/recurring.service.js';
import { sendMonthlyReports } from './services/report.service.js';
import { removeOrphanReceipts } from './services/receipt.service.js';
import { checkAllSpaces, sendReminders } from './services/alert.service.js';
import { sendBillReminders } from './services/bill.service.js';
import { cpiTable } from './services/cpi.service.js';
import { ensureSchemes } from './services/nav.service.js';
import { processSips, sendMaturityReminders, snapshotAll } from './services/investment.service.js';
import { syncAll as syncSheets } from './services/google.service.js';
import { sendDailySummaries } from './services/telegram.service.js';
import { sendLifeReminders } from './services/life.service.js';

// Background work, run at start-up (catching up after a sleeping server wakes) and then every hour.
export function startJobs(log = console) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const { created } = await processDue();
      if (created) log.log(`Recurring: created ${created} due transaction(s)`);
    } catch (err) {
      log.error('Recurring run failed:', err.message);
    }
    try {
      const { month, sent, failed } = await sendMonthlyReports({ log });
      if (sent || failed) log.log(`Monthly reports for ${month}: ${sent} sent, ${failed} failed`);
    } catch (err) {
      log.error('Monthly report run failed:', err.message);
    }
    try {
      const removed = await removeOrphanReceipts();
      if (removed) log.log(`Receipts: removed ${removed} photo(s) whose entry no longer exists`);
    } catch (err) {
      log.error('Receipt cleanup failed:', err.message);
    }
    try {
      // Entries created by recurring rules above can cross a budget threshold too.
      const { sent } = await checkAllSpaces();
      // Keeps India's CPI fresh for the inflation view (MoSPI is asked at most once a day).
      await cpiTable().catch((err) => log.error('CPI refresh failed:', err.message));
      if (sent) log.log(`Budget alerts: ${sent} sent`);
    } catch (err) {
      log.error('Budget alert run failed:', err.message);
    }
    try {
      // AMFI's daily NAVs (at most once a day), then SIP instalments whose NAV is out, then this month's
      // investment snapshot for the net-worth timeline.
      await ensureSchemes();
      const { bought } = await processSips();
      if (bought) log.log(`SIPs: bought ${bought} instalment(s)`);
      await snapshotAll();
    } catch (err) {
      log.error('Investment run failed:', err.message);
    }
    try {
      // Google Sheets: catches up anything a quick sync after a change missed.
      const { synced } = await syncSheets();
      if (synced) log.log(`Google Sheets: ${synced} synced`);
    } catch (err) {
      log.error('Google Sheets run failed:', err.message);
    }
    running = false;
  };
  tick();
  setInterval(tick, config.jobsEveryMs).unref();

  // The daily reminder needs a finer clock than the hourly jobs.
  let reminding = false;
  const remind = async () => {
    if (reminding) return;
    reminding = true;
    try {
      const { sent } = await sendReminders();
      if (sent) log.log(`Reminders: ${sent} sent`);
      const bills = await sendBillReminders();
      if (bills.sent) log.log(`Bill reminders: ${bills.sent} sent`);
      const maturing = await sendMaturityReminders();
      if (maturing.sent) log.log(`Maturity reminders: ${maturing.sent} sent`);
      const life = await sendLifeReminders();
      if (life.sent) log.log(`Warranty, policy and service reminders: ${life.sent} sent`);
      const daily = await sendDailySummaries();
      if (daily.sent) log.log(`Telegram summaries: ${daily.sent} sent`);
    } catch (err) {
      log.error('Reminder run failed:', err.message);
    }
    reminding = false;
  };
  remind();
  setInterval(remind, config.notifyEveryMs).unref();
}
