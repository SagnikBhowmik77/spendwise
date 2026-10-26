import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, uniqueEmail, GOOD_PASSWORD, markVerified } from './helpers.js';
import { Transaction, Space } from '../src/models/index.js';

let t;
let owner;
let flat;

const register = async (name) => {
  const email = uniqueEmail();
  const { body } = await t.api('POST', '/api/auth/register', { body: { name, email, password: GOOD_PASSWORD } });
  await markVerified(email);
  return { ...body, email };
};
// Requests in a given space send X-Space-Id.
const inSpace = (who, spaceId, method, path, body) =>
  t.api(method, path, { token: who.token, body, headers: spaceId ? { 'x-space-id': spaceId } : {} });
const tokenOf = (link) => link.split('/invite/')[1];

before(async () => {
  t = await startTestServer();
  owner = await register('Priya');
});
after(() => t.stop());

test('everyone starts with a personal space that can’t take members', async () => {
  const { body } = await t.api('GET', '/api/spaces', { token: owner.token });
  assert.deepEqual(body.spaces.map((s) => [s.name, s.kind, s.role]), [['Personal', 'personal', 'owner']]);
  const res = await t.api('POST', `/api/spaces/${body.spaces[0].id}/invites`, { token: owner.token, body: { email: uniqueEmail() } });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'personal_space');
});

test('a shared space has its own accounts and entries, separate from personal ones', async () => {
  const res = await t.api('POST', '/api/spaces', { token: owner.token, body: { name: 'Flat 302' } });
  assert.equal(res.status, 201);
  flat = res.body.space;
  assert.deepEqual([flat.kind, flat.role, flat.members.length], ['shared', 'owner', 1]);

  const accounts = (await inSpace(owner, flat.id, 'GET', '/api/accounts')).body.accounts;
  assert.deepEqual(accounts.map((a) => a.name), ['Shared cash']);
  assert.equal((await inSpace(owner, flat.id, 'POST', '/api/transactions', { type: 'expense', amount: '1800', category: 'Groceries', date: '2026-10-12' })).status, 201);
  assert.equal((await inSpace(owner, null, 'GET', '/api/transactions')).body.total, 0);
  assert.equal((await inSpace(owner, flat.id, 'GET', '/api/transactions')).body.total, 1);
});

test('invites: a link for one email, accepted only by that account', async () => {
  const mateEmail = uniqueEmail();
  const inv = await t.api('POST', `/api/spaces/${flat.id}/invites`, { token: owner.token, body: { email: mateEmail.toUpperCase() } });
  assert.equal(inv.status, 201);
  assert.equal(inv.body.invite.email, mateEmail);
  // No SMTP in tests: it says so, and the link can be shared another way.
  assert.equal(inv.body.emailed, false);
  assert.match(inv.body.link, /\/invite\/[\w-]{40,}$/);
  const token = tokenOf(inv.body.link);

  const info = await t.api('GET', `/api/invites/${token}`);
  assert.deepEqual([info.body.invite.spaceName, info.body.invite.invitedBy, info.body.invite.email], ['Flat 302', 'Priya', mateEmail]);
  assert.equal((await t.api('GET', '/api/invites/not-a-real-token')).status, 404);

  const stranger = await register('Stranger');
  const wrong = await t.api('POST', `/api/invites/${token}/accept`, { token: stranger.token });
  assert.equal(wrong.status, 403);
  assert.equal(wrong.body.error.code, 'invite_wrong_account');

  const mateReg = await t.api('POST', '/api/auth/register', { body: { name: 'Rahul', email: mateEmail, password: GOOD_PASSWORD } });
  await markVerified(mateEmail);
  const mate = { ...mateReg.body, email: mateEmail };
  const ok = await t.api('POST', `/api/invites/${token}/accept`, { token: mate.token });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.space.members.map((m) => [m.name, m.role]), [['Priya', 'owner'], ['Rahul', 'editor']]);
  // The link works once.
  assert.equal((await t.api('GET', `/api/invites/${token}`)).status, 404);
  flat.mate = mate;
  flat.stranger = stranger;
});

test('members share everything in the space and see who added each entry', async () => {
  const { mate, stranger } = flat;
  const added = await inSpace(mate, flat.id, 'POST', '/api/transactions', { type: 'expense', amount: '600', category: 'Bills & Utilities', date: '2026-10-14' });
  assert.equal(added.status, 201);
  const list = (await inSpace(owner, flat.id, 'GET', '/api/transactions')).body.items;
  assert.equal(list.length, 2);
  assert.equal(list.find((x) => x.amountPaise === 60000).createdBy, mate.user.id);

  const current = (await inSpace(mate, flat.id, 'GET', '/api/spaces/current')).body.space;
  assert.equal(current.role, 'editor');
  assert.equal(current.members.find((m) => m.you).name, 'Rahul');

  // People outside the space get nothing.
  assert.equal((await inSpace(stranger, flat.id, 'GET', '/api/transactions')).status, 404);
  assert.equal((await inSpace(stranger, 'zzz', 'GET', '/api/transactions')).status, 404);
});

test('only the owner can invite, rename or remove people', async () => {
  const { mate } = flat;
  assert.equal((await t.api('POST', `/api/spaces/${flat.id}/invites`, { token: mate.token, body: { email: uniqueEmail() } })).status, 403);
  assert.equal((await t.api('PATCH', `/api/spaces/${flat.id}`, { token: mate.token, body: { name: 'Mine now' } })).status, 403);
  assert.equal((await t.api('DELETE', `/api/spaces/${flat.id}/members/${owner.user.id}`, { token: mate.token })).status, 403);
  const renamed = await t.api('PATCH', `/api/spaces/${flat.id}`, { token: owner.token, body: { name: 'Flat 302, Salt Lake' } });
  assert.equal(renamed.body.space.name, 'Flat 302, Salt Lake');
  assert.equal((await t.api('POST', `/api/spaces/${flat.id}/invites`, { token: owner.token, body: { email: flat.mate.email } })).status, 409);
});

test('pending invites can be revoked', async () => {
  const inv = await t.api('POST', `/api/spaces/${flat.id}/invites`, { token: owner.token, body: { email: uniqueEmail() } });
  const listed = (await inSpace(owner, flat.id, 'GET', '/api/spaces/current')).body.space.invites;
  assert.equal(listed.length, 1);
  assert.equal((await t.api('DELETE', `/api/spaces/${flat.id}/invites/${inv.body.invite.id}`, { token: owner.token })).status, 204);
  assert.equal((await t.api('GET', `/api/invites/${tokenOf(inv.body.link)}`)).status, 404);
});

test('when the owner leaves, the space passes to the next member; the last one out deletes it', async () => {
  const { mate } = flat;
  const left = await t.api('DELETE', `/api/spaces/${flat.id}/members/${owner.user.id}`, { token: owner.token });
  assert.deepEqual(left.body, { deleted: false });
  const space = await Space.findById(flat.id).lean();
  assert.equal(String(space.owner), mate.user.id);
  assert.equal((await inSpace(owner, flat.id, 'GET', '/api/transactions')).status, 404);

  const last = await t.api('DELETE', `/api/spaces/${flat.id}/members/${mate.user.id}`, { token: mate.token });
  assert.deepEqual(last.body, { deleted: true });
  assert.equal(await Space.countDocuments({ _id: flat.id }), 0);
  assert.equal(await Transaction.countDocuments({ space: flat.id }), 0);
});

test('deleting your account leaves shared spaces but keeps the entries you added there', async () => {
  const a = await register('Anil');
  const space = (await t.api('POST', '/api/spaces', { token: a.token, body: { name: 'Trip fund' } })).body.space;
  const bEmail = uniqueEmail();
  const inv = await t.api('POST', `/api/spaces/${space.id}/invites`, { token: a.token, body: { email: bEmail } });
  const b = (await t.api('POST', '/api/auth/register', { body: { name: 'Bina', email: bEmail, password: GOOD_PASSWORD } })).body;
  await markVerified(bEmail);
  await t.api('POST', `/api/invites/${tokenOf(inv.body.link)}/accept`, { token: b.token });
  await inSpace(b, space.id, 'POST', '/api/transactions', { type: 'expense', amount: '999', category: 'Travel', date: '2026-10-15' });

  await t.api('DELETE', '/api/auth/me', { token: b.token, body: { password: GOOD_PASSWORD } });
  const view = (await inSpace(a, space.id, 'GET', '/api/spaces/current')).body.space;
  assert.deepEqual(view.members.map((m) => m.name), ['Anil']);
  assert.equal((await inSpace(a, space.id, 'GET', '/api/transactions')).body.total, 1);
  // The owner can delete a shared space and everything in it.
  assert.equal((await t.api('DELETE', `/api/spaces/${space.id}`, { token: a.token })).status, 204);
  assert.equal(await Transaction.countDocuments({ space: space.id }), 0);
});
