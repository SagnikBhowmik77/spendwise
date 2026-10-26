import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

let server;
let base;

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

test('GET /api/health says plainly when no database is configured', async () => {
  const res = await fetch(`${base}/api/health`);
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.service, 'spendwise-api');
  assert.equal(body.database.configured, false);
  assert.equal(body.database.connected, false);
  assert.match(body.database.problem, /MONGODB_URI/);
});

test('unknown routes return the standard 404 error shape', async () => {
  const res = await fetch(`${base}/api/nope`);
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.error.code, 'not_found');
});

test('malformed JSON bodies get a 400, not a 500', async () => {
  const res = await fetch(`${base}/api/health`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{bad',
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, 'bad_json');
});

test('CORS allows the dev client origin and not others', async () => {
  const ok = await fetch(`${base}/api/health`, { headers: { origin: 'http://localhost:5200' } });
  assert.equal(ok.headers.get('access-control-allow-origin'), 'http://localhost:5200');
  const other = await fetch(`${base}/api/health`, { headers: { origin: 'https://evil.example' } });
  assert.equal(other.headers.get('access-control-allow-origin'), null);
});
