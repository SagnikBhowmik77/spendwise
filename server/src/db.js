import mongoose from 'mongoose';
import { HttpError } from './errors.js';

// Fail fast instead of queueing queries while the database is down.
mongoose.set('bufferCommands', false);
mongoose.set('strictQuery', true);

const state = { configured: false, problem: 'MONGODB_URI is not set', lastError: null };

export function markNotConfigured(problem) {
  state.configured = false;
  state.problem = problem;
}

export async function connectDb(uri) {
  state.configured = true;
  state.problem = null;
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });
    state.lastError = null;
    // Data upgrades first: a new unique index (e.g. budgets per space) can only be built once old rows fit it.
    const { runMigrations } = await import('./migrations.js');
    await runMigrations();
    // Builds the indexes declared on the models (unique email, user+date, ...).
    await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
  } catch (err) {
    state.lastError = err.message;
    throw err;
  }
}

mongoose.connection.on('disconnected', () => { if (state.configured) state.lastError = 'Disconnected from MongoDB'; });
mongoose.connection.on('connected', () => { state.lastError = null; });

export async function disconnectDb() {
  await mongoose.disconnect();
}

export function dbStatus() {
  const connected = mongoose.connection.readyState === 1;
  const status = { configured: state.configured, connected };
  if (!state.configured) status.problem = state.problem;
  else if (!connected && state.lastError) status.problem = state.lastError;
  return status;
}

// Route guard for anything that reads or writes data (used from step 2 on).
export function requireDb(_req, _res, next) {
  const { configured, connected } = dbStatus();
  if (!configured) return next(new HttpError(503, 'db_not_configured', 'The database is not configured on this server'));
  if (!connected) return next(new HttpError(503, 'db_unavailable', 'The database is unreachable right now; try again shortly'));
  next();
}
