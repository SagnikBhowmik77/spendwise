import { createHmac } from 'node:crypto';
import nodemailer from 'nodemailer';
import { config } from './config.js';

let transport = null;

// Render's free tier blocks outgoing SMTP, so in production mail goes over HTTPS to the relay on Vercel
// (client/api/send-mail.js), which sends it through Gmail. Locally, SMTP is used directly.
const relayConfigured = () => Boolean(config.mailRelay.url && config.mailRelay.secret);

export function emailConfigured() {
  if (relayConfigured()) return true;
  const { host, user, pass } = config.smtp;
  return Boolean(host && user && pass);
}

async function sendViaRelay({ to, subject, text, html }) {
  const body = JSON.stringify({ to, subject, text, html });
  const timestamp = Date.now();
  const signature = createHmac('sha256', config.mailRelay.secret).update(`${timestamp}.${body}`).digest('hex');
  const res = await fetch(config.mailRelay.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-spendwise-timestamp': String(timestamp), 'x-spendwise-signature': signature },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  const answer = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Mail relay answered ${res.status}: ${answer.reason || answer.error || 'no detail'}`);
  return answer;
}

// Tests swap in nodemailer's in-memory JSON transport; nothing else should call this.
export function setTransport(t) {
  transport = t;
}

function getTransport() {
  transport ??= nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    // Port 465 is TLS from the first byte; 587 upgrades with STARTTLS.
    secure: config.smtp.port === 465,
    auth: { user: config.smtp.user, pass: config.smtp.pass },
  });
  return transport;
}

export async function sendMail({ to, subject, text, html }) {
  // A transport set by tests always wins, so tests never reach a relay.
  if (!transport && relayConfigured()) return sendViaRelay({ to, subject, text, html });
  return getTransport().sendMail({ from: config.smtp.from, to, subject, text, html });
}

// Checks the mail route without sending anything: the relay says whether it is set up; SMTP logs in.
export async function verifyMail() {
  if (!transport && relayConfigured()) {
    const res = await fetch(config.mailRelay.url, { signal: AbortSignal.timeout(15_000) });
    const answer = await res.json().catch(() => ({}));
    if (!answer.configured) throw new Error('The mail relay is not set up (SMTP or MAIL_RELAY_SECRET missing on Vercel)');
    return true;
  }
  return getTransport().verify();
}
