import dns from 'node:dns';
import { config } from './config.js';
import { createApp } from './app.js';
import { connectDb, markNotConfigured } from './db.js';
import './models/index.js';
import { startJobs } from './jobs.js';
import { emailConfigured } from './mailer.js';
import { startTelegram } from './services/telegram.service.js';
import { migrateRoles } from './services/space.service.js';

const RETRY_MS = 15_000;

if (config.dnsServers.length) dns.setServers(config.dnsServers);

async function connectWithRetry(uri) {
  try {
    await connectDb(uri);
    console.log('Connected to MongoDB');
    await migrateRoles();
    startJobs();
    // The Telegram bot needs the database to look up linked chats.
    startTelegram();
  } catch (err) {
    console.error(`MongoDB connection failed: ${err.message}. Retrying in ${RETRY_MS / 1000} s`);
    setTimeout(() => connectWithRetry(uri), RETRY_MS);
  }
}

const app = createApp();
app.listen(config.port, () => {
  console.log(`Spendwise API listening on http://localhost:${config.port}`);
});

if (!config.jwt.secret) console.warn('Login not configured: JWT_SECRET must be at least 32 characters');
if (!emailConfigured()) console.warn('Email not configured: monthly reports are off until SMTP_HOST, SMTP_USER and SMTP_PASS are set');

if (config.mongodb.uri) {
  connectWithRetry(config.mongodb.uri);
} else {
  markNotConfigured(config.mongodb.problem);
  console.warn(`Database not configured: ${config.mongodb.problem}`);
}
