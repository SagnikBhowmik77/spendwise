// Security helpers with no database: one-time codes (TOTP, RFC 6238), encryption of the 2FA secret at
// rest, backup codes and readable device names. Everything uses Node's own crypto.
import crypto from 'node:crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text) {
  const clean = text.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i === -1) throw new Error('Not base32');
    value = ((value << 5) | i) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const TOTP_PERIOD = 30;
export const newTotpSecret = () => crypto.randomBytes(20);
export const totpStep = (now = Date.now()) => Math.floor(now / 1000 / TOTP_PERIOD);

// The code for one 30-second step (HMAC-SHA1, dynamic truncation), as authenticator apps compute it.
export function totpAt(secret, step, digits = 6) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = crypto.createHmac('sha1', secret).update(counter).digest();
  const offset = mac[mac.length - 1] & 0xf;
  const n = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(n % 10 ** digits).padStart(digits, '0');
}

// The step a code matches (this one, or one either side for clock drift), or null. Steps at or before
// `after` don't count, so a code can't be used twice.
export function verifyTotp(secret, code, { now = Date.now(), window = 1, after = -1 } = {}) {
  if (!/^\d{6}$/.test(code)) return null;
  const step = totpStep(now);
  for (let s = step - window; s <= step + window; s += 1) {
    if (s <= after) continue;
    if (crypto.timingSafeEqual(Buffer.from(totpAt(secret, s)), Buffer.from(code))) return s;
  }
  return null;
}

// The link an authenticator app reads from the QR code.
export const otpauthUrl = (secretB32, email) =>
  `otpauth://totp/${encodeURIComponent(`Spendwise:${email}`)}?${new URLSearchParams({ secret: secretB32, issuer: 'Spendwise', algorithm: 'SHA1', digits: '6', period: String(TOTP_PERIOD) })}`;

// AES-256-GCM with a key derived from the server's secret: a database leak alone doesn't reveal 2FA secrets.
const keyFrom = (serverSecret) => crypto.createHash('sha256').update(`spendwise-2fa:${serverSecret}`).digest();
export function encryptSecret(plain, serverSecret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFrom(serverSecret), iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}
export function decryptSecret(stored, serverSecret) {
  const raw = Buffer.from(stored, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyFrom(serverSecret), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]);
}

// Backup codes: 10 codes like "k7m2-x9qp" (no 0/o/1/l/i), stored only as keyed hashes.
const CODE_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';
export const BACKUP_CODE_COUNT = 10;
export const normaliseBackupCode = (code) => code.toLowerCase().replace(/[^a-z0-9]/g, '');
export function newBackupCodes() {
  return Array.from({ length: BACKUP_CODE_COUNT }, () => {
    const s = [...crypto.randomBytes(8)].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
    return `${s.slice(0, 4)}-${s.slice(4)}`;
  });
}
export const hashBackupCode = (code, serverSecret) =>
  crypto.createHmac('sha256', keyFrom(serverSecret)).update(normaliseBackupCode(code)).digest('hex');

// "Chrome on Windows" from a User-Agent header (enough to recognise your own devices).
export function deviceLabel(ua = '') {
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
    : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : null;
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS'
    : /CrOS/.test(ua) ? 'ChromeOS' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : null;
  if (browser && os) return `${browser} on ${os}`;
  return browser || os || 'Unknown device';
}

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
