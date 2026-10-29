// Email relay (a Vercel Function). Render's free tier blocks outgoing SMTP, so the API posts each email here over HTTPS
// and this sends it through Gmail. Every request must be signed with MAIL_RELAY_SECRET (HMAC-SHA256 of
// "<timestamp>.<body>", like Spendwise's webhooks) and be under 5 minutes old; the From address is always this
// server's own, so a leaked request can't be turned into mail from someone else.
import { createHmac, timingSafeEqual } from 'node:crypto';
import nodemailer from 'nodemailer';

const MAX_AGE_MS = 5 * 60 * 1000;
const MAX_BODY = 600_000;
const EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;

const smtpReady = (env) => Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);

export function sign(secret, timestamp, body) {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

let cached = null;
function gmail(env) {
  const port = Number(env.SMTP_PORT) || 465;
  cached ??= nodemailer.createTransport({
    host: env.SMTP_HOST, port, secure: port === 465,
    auth: { user: env.SMTP_USER, pass: String(env.SMTP_PASS).replace(/\s+/g, '') },
  });
  return cached;
}

// The whole decision, kept apart from HTTP so it can be tested: returns { status, body }.
export async function relay({ method, headers, raw }, { env = process.env, transport, now = Date.now() } = {}) {
  const secret = env.MAIL_RELAY_SECRET || '';
  if (method === 'GET') return { status: 200, body: { ok: true, configured: Boolean(secret) && smtpReady(env) } };
  if (method !== 'POST') return { status: 405, body: { error: 'method_not_allowed' } };
  if (!secret || !smtpReady(env)) return { status: 503, body: { error: 'relay_not_configured' } };

  const timestamp = Number(headers['x-spendwise-timestamp']);
  const given = String(headers['x-spendwise-signature'] || '');
  if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > MAX_AGE_MS) return { status: 401, body: { error: 'stale_request' } };
  const expected = sign(secret, timestamp, raw);
  if (given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return { status: 401, body: { error: 'bad_signature' } };
  }

  let msg;
  try { msg = JSON.parse(raw); } catch { return { status: 400, body: { error: 'bad_json' } }; }
  const to = [].concat(msg.to ?? []);
  const valid = to.length >= 1 && to.length <= 5 && to.every((a) => typeof a === 'string' && a.length <= 254 && EMAIL.test(a))
    && typeof msg.subject === 'string' && msg.subject.length > 0 && msg.subject.length <= 300
    && typeof msg.text === 'string' && msg.text.length <= 200_000
    && (msg.html === undefined || (typeof msg.html === 'string' && msg.html.length <= 400_000));
  if (!valid) return { status: 400, body: { error: 'bad_message' } };

  const from = env.SMTP_FROM || `Spendwise <${env.SMTP_USER}>`;
  const info = await (transport ?? gmail(env)).sendMail({ from, to, subject: msg.subject, text: msg.text, html: msg.html });
  return { status: 200, body: { ok: true, messageId: info.messageId ?? null } };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > MAX_BODY) { reject(new Error('too_large')); req.destroy(); }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  let result;
  try {
    const raw = req.method === 'POST' ? await readBody(req) : '';
    result = await relay({ method: req.method, headers: req.headers, raw });
  } catch (err) {
    // The SMTP error (not the message) goes back, so the API's log says why a send failed.
    result = { status: err.message === 'too_large' ? 413 : 502, body: { error: 'send_failed', reason: String(err.message).slice(0, 200) } };
  }
  res.statusCode = result.status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(result.body));
}
