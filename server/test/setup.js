// Loaded before every test file: tests never read server/.env (no real keys or database).
process.env.NODE_ENV = 'test';
// Test-only secret (not the one in .env). Low bcrypt cost keeps the suite fast.
process.env.JWT_SECRET ??= 'test-secret-test-secret-test-secret-0123456789';
process.env.BCRYPT_ROUNDS ??= '4';
// High limits so normal tests never trip them; rate-limit.test.js sets its own low limits.
process.env.LOGIN_RATE_LIMIT ??= '1000';
process.env.REGISTER_RATE_LIMIT ??= '1000';
process.env.EMAIL_LINK_RATE_LIMIT ??= '1000';
