import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Load server/.env when it exists (Node's built-in loader; no dotenv needed).
// On Render the variables come from the dashboard instead.
const envFile = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envFile) && process.env.NODE_ENV !== 'test') process.loadEnvFile(envFile);

const list = (value, fallback) =>
  (value || fallback).split(',').map((s) => s.trim()).filter(Boolean);

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 8730,
  // Browser origins allowed to call the API (comma-separated).
  clientOrigins: list(process.env.CLIENT_ORIGIN, 'http://localhost:5200'),
  // Behind Render's proxy this must be 1 so rate limits see the real client IP.
  trustProxy: Number(process.env.TRUST_PROXY) || 0,
  mongodb: mongoConfig(process.env.MONGODB_URI),
  // Optional DNS servers for Node's own lookups (comma-separated), e.g. 1.1.1.1,8.8.8.8.
  // Needed where Node's resolver can't answer the SRV query that mongodb+srv:// relies on.
  dnsServers: list(process.env.DNS_SERVERS, ''),
  jwt: {
    // At least 32 characters; without it the auth routes answer 503 "not configured".
    secret: (process.env.JWT_SECRET || '').length >= 32 ? process.env.JWT_SECRET : null,
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    issuer: 'spendwise',
  },
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS) || 12,
  // "Today" for recurring entries: a rent due on the 1st appears at midnight India time, not 5:30 am.
  timeZone: process.env.APP_TIMEZONE || 'Asia/Kolkata',
  // How often background jobs (recurring entries, monthly reports) run; they also run once at start-up.
  jobsEveryMs: Number(process.env.JOBS_EVERY_MS) || 60 * 60 * 1000,
  // Free ECB reference rates (no key). Tests point this at a local stub.
  fxUrl: (process.env.FX_URL || 'https://api.frankfurter.dev/v1').replace(/\/+$/, ''),
  // India's official Consumer Price Index (MoSPI, free, no key). Tests point this at a local stub.
  cpiUrl: process.env.CPI_URL || 'https://api.mospi.gov.in/api/cpi/getCPIData',
  // Mutual fund NAVs from AMFI (free, no key): the daily file of every scheme and the history report.
  // Tests point these at a local stub.
  amfiNavUrl: process.env.AMFI_NAV_URL || 'https://portal.amfiindia.com/spages/NAVAll.txt',
  amfiHistoryUrl: process.env.AMFI_HISTORY_URL || 'https://portal.amfiindia.com/DownloadNAVHistoryReport_Po.aspx',
  // Where the web app lives, for links inside emails.
  appUrl: (process.env.APP_URL || 'http://localhost:5200').replace(/\/+$/, ''),
  // Batch 12J integrations. The URLs can point at local stand-ins in tests.
  // Where this API can be reached from a browser (for Google's redirect back), e.g. https://spendwise-api.onrender.com.
  apiUrl: (process.env.API_URL || `http://localhost:${Number(process.env.PORT) || 8730}`).replace(/\/+$/, ''),
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    authUrl: process.env.GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: process.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token',
    revokeUrl: process.env.GOOGLE_REVOKE_URL || 'https://oauth2.googleapis.com/revoke',
    userInfoUrl: process.env.GOOGLE_USERINFO_URL || 'https://openidconnect.googleapis.com/v1/userinfo',
    sheetsUrl: (process.env.GOOGLE_SHEETS_URL || 'https://sheets.googleapis.com/v4').replace(/\/+$/, ''),
  },
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN || '',
    apiUrl: (process.env.TELEGRAM_API_URL || 'https://api.telegram.org').replace(/\/+$/, ''),
    // With a public HTTPS address (after deploying), Telegram calls us; otherwise the server asks Telegram (long polling).
    webhookUrl: (process.env.TELEGRAM_WEBHOOK_URL || '').replace(/\/+$/, ''),
    // Off in tests, which drive the bot directly.
    polling: process.env.TELEGRAM_POLLING ? process.env.TELEGRAM_POLLING === 'true' : process.env.NODE_ENV !== 'test',
  },
  // Webhooks may only call public addresses in production (no localhost or private networks).
  webhooksAllowPrivate: process.env.WEBHOOKS_ALLOW_PRIVATE ? process.env.WEBHOOKS_ALLOW_PRIVATE === 'true' : process.env.NODE_ENV !== 'production',
  // Fingerprint unlock (WebAuthn passkeys) is tied to the web app's host name and origins.
  webauthn: {
    rpId: process.env.WEBAUTHN_RP_ID || new URL(process.env.APP_URL || 'http://localhost:5200').hostname,
    origins: list(process.env.CLIENT_ORIGIN, 'http://localhost:5200'),
  },
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT) || 465,
    user: process.env.SMTP_USER || '',
    // Gmail shows app passwords in groups of four; the spaces aren't part of it.
    pass: (process.env.SMTP_PASS || '').replace(/\s+/g, ''),
    from: process.env.SMTP_FROM || (process.env.SMTP_USER ? `Spendwise <${process.env.SMTP_USER}>` : ''),
  },
  // Production mail relay (client/api/send-mail.js on Vercel), because Render's free tier blocks outgoing SMTP.
  // Both set: mail goes there over HTTPS, signed with the shared secret. Unset: SMTP as above.
  mailRelay: {
    url: (process.env.MAIL_RELAY_URL || '').replace(/\/+$/, ''),
    secret: process.env.MAIL_RELAY_SECRET || '',
  },
  // Browser push (Web Push with VAPID keys; free, no account). Off unless both keys are set.
  push: {
    publicKey: process.env.VAPID_PUBLIC_KEY || '',
    privateKey: process.env.VAPID_PRIVATE_KEY || '',
    // A contact for the push services (Google, Mozilla, Apple) if this app misbehaves.
    subject: process.env.VAPID_SUBJECT || (process.env.SMTP_USER ? `mailto:${process.env.SMTP_USER}` : 'mailto:admin@spendwise.invalid'),
  },
  // Budget alerts and the daily reminder are checked this often (the reminder fires at its time, give or take this).
  notifyEveryMs: Number(process.env.NOTIFY_EVERY_MS) || 5 * 60 * 1000,
  // After an entry or budget changes, budget alerts are checked this long after the last change in a burst.
  alertDelayMs: process.env.ALERT_DELAY_MS !== undefined ? Number(process.env.ALERT_DELAY_MS) : 1500,
  rateLimit: {
    // Failed logins per IP per 15 minutes (successful logins don't count).
    loginMax: Number(process.env.LOGIN_RATE_LIMIT) || 10,
    // New accounts per IP per hour.
    registerMax: Number(process.env.REGISTER_RATE_LIMIT) || 20,
    // "Forgot password" requests and link checks per IP per 15 minutes.
    emailLinkMax: Number(process.env.EMAIL_LINK_RATE_LIMIT) || 10,
  },
};

// Returns { uri } when usable, or { uri: null, problem } explaining what is missing.
function mongoConfig(raw) {
  const uri = (raw || '').trim();
  if (!uri) return { uri: null, problem: 'MONGODB_URI is not set' };
  if (uri.includes('<db_password>')) {
    return { uri: null, problem: 'MONGODB_URI still contains <db_password>; put the real password in server/.env' };
  }
  if (!/^mongodb(\+srv)?:\/\//.test(uri)) {
    return { uri: null, problem: 'MONGODB_URI must start with mongodb:// or mongodb+srv://' };
  }
  return { uri };
}
