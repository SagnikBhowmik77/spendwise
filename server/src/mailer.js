import nodemailer from 'nodemailer';
import { config } from './config.js';

let transport = null;

export function emailConfigured() {
  const { host, user, pass } = config.smtp;
  return Boolean(host && user && pass);
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
  return getTransport().sendMail({ from: config.smtp.from, to, subject, text, html });
}

// Logs in to the SMTP server without sending anything.
export async function verifyMail() {
  return getTransport().verify();
}
