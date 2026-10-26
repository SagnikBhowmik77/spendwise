import { z } from 'zod';

const name = z.string().trim().min(1, 'Name is required').max(60, 'Name must be at most 60 characters');
const email = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address')).pipe(z.string().max(254));

// bcrypt only uses the first 72 bytes, so longer passwords are refused rather than silently cut.
const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .refine((p) => Buffer.byteLength(p, 'utf8') <= 72, 'Password must be at most 72 bytes')
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'Password must contain a letter and a number');

export const registerSchema = z.object({ name, email, password });

// Login doesn't re-check password rules: a wrong password simply fails to match.
export const loginSchema = z.object({ email, password: z.string().min(1, 'Password is required') });

// Either field on its own: the language switch saves without touching the name.
export const updateProfileSchema = z
  .object({ name: name.optional(), language: z.enum(['en', 'hi'], 'Language must be en or hi').optional() })
  .refine((b) => b.name !== undefined || b.language !== undefined, 'Send a name or a language');

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: password,
});

export const deleteAccountSchema = z.object({ password: z.string().min(1, 'Password is required') });

// Batch 12I: the code step of a two-factor login, setting it up, and the app lock.
const code = z.string().trim().min(6, 'Enter the 6-digit code or a backup code').max(20);
export const loginTwoFactorSchema = z.object({ challenge: z.string().min(1).max(2000), code });
export const twoFactorCodeSchema = z.object({ code });
export const twoFactorDisableSchema = z.object({ password: z.string().min(1, 'Password is required'), code });

const pin = z.string().regex(/^\d{4,8}$/, 'The PIN is 4 to 8 digits');
export const setLockSchema = z.object({
  password: z.string().min(1, 'Password is required'),
  pin: pin.optional(),
  timeoutMinutes: z.coerce.number().int().refine((m) => [1, 5, 15, 30, 60].includes(m), 'Pick 1, 5, 15, 30 or 60 minutes').optional(),
});
export const disableLockSchema = z.object({ password: z.string().min(1, 'Password is required') });
export const unlockPinSchema = z.object({ pin });
// WebAuthn responses are checked by @simplewebauthn; here only their outline.
const webauthnResponse = z.object({ id: z.string().min(1).max(1024), rawId: z.string().max(1024), type: z.literal('public-key') }).passthrough();
export const addPasskeySchema = z.object({ response: webauthnResponse, label: z.string().trim().max(60).optional() });
export const unlockPasskeySchema = z.object({ response: webauthnResponse });

// Email links: forgot password, the new password from a reset link, and confirming the address.
const linkToken = z.string().trim().regex(/^[A-Za-z0-9_-]{20,100}$/, 'This link is invalid. Open the newest one from your email.');
export const forgotPasswordSchema = z.object({ email });
export const resetPasswordSchema = z.object({ token: linkToken, password });
export const verifyEmailSchema = z.object({ token: linkToken });
