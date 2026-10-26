// Shared test harness: a real throwaway MongoDB plus the app on a random port.
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../src/app.js';
import { connectDb, disconnectDb } from '../src/db.js';

export async function startTestServer() {
  const mongo = await MongoMemoryServer.create();
  await connectDb(mongo.getUri('spendwise-test'));
  const server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  // api('POST', '/api/auth/login', { body, token }) -> { status, body }
  const api = async (method, path, { body, token, headers = {} } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(body !== undefined && { 'content-type': 'application/json' }),
        ...(token && { authorization: `Bearer ${token}` }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
  };

  const stop = async () => {
    server.close();
    await disconnectDb();
    await mongo.stop();
  };

  return { base, api, stop };
}

// A user's personal space and its default ("Cash") account, for tests that insert records directly.
export async function personalSpace(userId) {
  const { Space } = await import('../src/models/index.js');
  const space = await Space.findOne({ owner: userId, kind: 'personal' }).lean();
  return { space: space._id, account: space.defaultAccount };
}

let counter = 0;
export const uniqueEmail = () => `user${Date.now()}${counter++}@example.com`;
export const GOOD_PASSWORD = 'correct horse 42';

// Marks an address as confirmed, as if its owner had clicked the link (for tests about email features).
export async function markVerified(email) {
  const { User } = await import('../src/models/index.js');
  await User.updateOne({ email: email.toLowerCase() }, { $set: { emailVerifiedAt: new Date() } });
}
