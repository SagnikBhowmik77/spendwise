import { rateLimit } from 'express-rate-limit';
import { config } from '../config.js';
import { HttpError } from '../errors.js';

const limited = (message) => (_req, _res, next) => next(new HttpError(429, 'rate_limited', message));

// Created per app instance so each test server starts with fresh counters.
export function createAuthLimiters() {
  return {
    login: rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: config.rateLimit.loginMax,
      skipSuccessfulRequests: true,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: limited('Too many failed login attempts. Try again in 15 minutes.'),
    }),
    register: rateLimit({
      windowMs: 60 * 60 * 1000,
      limit: config.rateLimit.registerMax,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: limited('Too many accounts created from this network. Try again later.'),
    }),
    // Forgot-password requests and reset/verify links: slows down guessing and inbox flooding.
    emailLink: rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: config.rateLimit.emailLinkMax,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: limited('Too many tries. Wait 15 minutes and try again.'),
    }),
  };
}
