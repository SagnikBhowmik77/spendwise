import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { HttpError } from '../errors.js';
import { config } from '../config.js';
import {
  Space, SpaceInvite, Account, User, Transaction, Budget, RecurringRule, ActivityLog, Trip, MAX_MEMBERS, roleName,
  ImportBatch, ImportProfile, ImportRule, WeeklyBudget, BudgetAlert, Goal, Loan, Debt, Group, Bill, SavedReport, Challenge, Holding, NetWorthSnapshot,
  ApiToken, CalendarFeed, Webhook, WebhookDelivery, SheetLink, TelegramLink, TdsEntry, RentProfile, EnvelopePlan, SinkingFund, WishItem, Vehicle, VaultItem, CardReward,
} from '../models/index.js';
import { purgeSpaceReceipts } from './receipt.service.js';
import { emailConfigured, sendMail } from '../mailer.js';
import { logActivity } from './activity.service.js';
import { formatPaise } from '../money.js';

export const INVITE_DAYS = 7;
export const MAX_SHARED_SPACES = 10;

const NOT_FOUND = () => new HttpError(404, 'space_not_found', 'Space not found');
const OWNER_ONLY = () => new HttpError(403, 'owner_only', 'Only the owner of this space can do that');
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const sameId = (a, b) => String(a) === String(b);
const roleOf = (space, userId) => { const r = space.members.find((m) => sameId(m.user, userId))?.role; return r ? roleName(r) : null; };
const money = (paise) => (paise === null || paise === undefined ? null : { paise, rupees: paise / 100 });
const ROLE_WORDS = { editor: 'an editor', viewer: 'a viewer', child: 'a child' };
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function requireOwner(space, user) {
  if (roleOf(space, user._id) !== 'owner') throw OWNER_ONLY();
}

async function createSpaceWithAccount({ name, kind, owner, accountName }) {
  const space = await Space.create({ name, kind, owner, members: [{ user: owner, role: 'owner' }] });
  const account = await Account.create({ space: space._id, name: accountName, type: 'cash', createdBy: owner });
  space.defaultAccount = account._id;
  await space.save();
  return space;
}

// Every user has exactly one personal space, created with a "Cash" account the first time it's needed.
export async function ensurePersonalSpace(user) {
  const existing = await Space.findOne({ owner: user._id, kind: 'personal' });
  if (existing) return existing;
  try {
    return await createSpaceWithAccount({ name: 'Personal', kind: 'personal', owner: user._id, accountName: 'Cash' });
  } catch (err) {
    if (err.code === 11000) return Space.findOne({ owner: user._id, kind: 'personal' });
    throw err;
  }
}

// The space a request works in: the one named in X-Space-Id (if the user belongs to it), else their personal one.
export async function resolveSpace(user, requestedId) {
  if (!requestedId) return ensurePersonalSpace(user);
  if (!mongoose.isValidObjectId(requestedId)) throw NOT_FOUND();
  const space = await Space.findOne({ _id: requestedId, 'members.user': user._id });
  if (!space) throw NOT_FOUND();
  return space;
}

async function memberSpace(user, spaceId) {
  if (!mongoose.isValidObjectId(spaceId)) throw NOT_FOUND();
  const space = await Space.findOne({ _id: spaceId, 'members.user': user._id });
  if (!space) throw NOT_FOUND();
  return space;
}

export async function describe(space, viewer) {
  const users = await User.find({ _id: { $in: space.members.map((m) => m.user) } }).select('name email').lean();
  const byId = new Map(users.map((u) => [String(u._id), u]));
  const role = roleOf(space, viewer._id);
  const out = {
    id: String(space._id),
    name: space.name,
    kind: space.kind,
    role,
    defaultAccount: space.defaultAccount ? String(space.defaultAccount) : null,
    approvalAbove: money(space.approvalAbovePaise),
    members: space.members
      .map((m) => ({
        id: String(m.user),
        name: byId.get(String(m.user))?.name ?? 'Former member',
        email: byId.get(String(m.user))?.email ?? null,
        role: roleName(m.role),
        pocketMoney: money(m.pocketMoneyPaise),
        joinedAt: m.joinedAt,
        you: sameId(m.user, viewer._id),
      }))
      .sort((a, b) => (a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : new Date(a.joinedAt) - new Date(b.joinedAt))),
    invites: [],
  };
  if (role === 'owner' && space.kind === 'shared') {
    const invites = await SpaceInvite.find({ space: space._id, expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 }).lean();
    out.invites = invites.map((i) => ({ id: String(i._id), email: i.email, role: i.role ?? 'editor', expiresAt: i.expiresAt }));
  }
  return out;
}

export async function listSpaces(user) {
  await ensurePersonalSpace(user);
  const spaces = await Space.find({ 'members.user': user._id }).lean();
  return spaces
    .map((s) => ({ id: String(s._id), name: s.name, kind: s.kind, role: roleOf(s, user._id), memberCount: s.members.length }))
    .sort((a, b) => (a.kind === 'personal' ? -1 : b.kind === 'personal' ? 1 : a.name.localeCompare(b.name)));
}

export async function createShared(user, { name }) {
  const owned = await Space.countDocuments({ owner: user._id, kind: 'shared' });
  if (owned >= MAX_SHARED_SPACES) throw new HttpError(409, 'too_many_spaces', `You can own up to ${MAX_SHARED_SPACES} shared spaces`);
  const space = await createSpaceWithAccount({ name, kind: 'shared', owner: user._id, accountName: 'Shared cash' });
  await logActivity({ space: space._id, user: user._id, entity: 'space', entityId: space._id, action: 'create', summary: `Created the space "${name}"` });
  return describe(space, user);
}

export async function rename(user, spaceId, { name }) {
  const space = await memberSpace(user, spaceId);
  requireOwner(space, user);
  const old = space.name;
  space.name = name;
  await space.save();
  await logActivity({ space: space._id, user: user._id, entity: 'space', entityId: space._id, action: 'update', summary: `Renamed the space from "${old}" to "${name}"` });
  return describe(space, user);
}

// Removes a space and everything in it.
async function purgeSpace(spaceId) {
  await purgeSpaceReceipts(spaceId);
  const hooks = await Webhook.find({ space: spaceId }).select('_id').lean();
  await WebhookDelivery.deleteMany({ webhook: { $in: hooks.map((h) => h._id) } });
  await Promise.all([
    Trip.deleteMany({ space: spaceId }),
    ImportBatch.deleteMany({ space: spaceId }),
    ImportProfile.deleteMany({ space: spaceId }),
    ImportRule.deleteMany({ space: spaceId }),
    RecurringRule.deleteMany({ space: spaceId }),
    Transaction.deleteMany({ space: spaceId }),
    Budget.deleteMany({ space: spaceId }),
    WeeklyBudget.deleteMany({ space: spaceId }),
    ...[Goal, Loan, Debt, Group, Bill, SavedReport, Challenge, Holding, NetWorthSnapshot, ApiToken, CalendarFeed, Webhook, SheetLink, TelegramLink, TdsEntry, RentProfile, EnvelopePlan, SinkingFund, WishItem, Vehicle, VaultItem, CardReward].map((M) => M.deleteMany({ space: spaceId })),
    BudgetAlert.deleteMany({ space: spaceId }),
    Account.deleteMany({ space: spaceId }),
    ActivityLog.deleteMany({ space: spaceId }),
    SpaceInvite.deleteMany({ space: spaceId }),
  ]);
  await Space.deleteOne({ _id: spaceId });
}

export async function deleteShared(user, spaceId) {
  const space = await memberSpace(user, spaceId);
  requireOwner(space, user);
  if (space.kind === 'personal') throw new HttpError(400, 'personal_space', "Your personal space can't be deleted");
  await purgeSpace(space._id);
}

export async function invite(user, spaceId, { email, role = 'editor' }) {
  const space = await memberSpace(user, spaceId);
  requireOwner(space, user);
  if (space.kind === 'personal') {
    throw new HttpError(400, 'personal_space', 'Your personal space is just for you. Create a shared space to invite someone.');
  }
  if (email === user.email) throw new HttpError(400, 'invite_self', "You're already in this space");
  const existingUser = await User.findOne({ email }).select('_id').lean();
  if (existingUser && roleOf(space, existingUser._id)) throw new HttpError(409, 'already_member', 'That person is already in this space');
  const pending = await SpaceInvite.countDocuments({ space: space._id, email: { $ne: email }, expiresAt: { $gt: new Date() } });
  if (space.members.length + pending >= MAX_MEMBERS) throw new HttpError(409, 'space_full', `A space can have up to ${MAX_MEMBERS} people`);

  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000);
  const inv = await SpaceInvite.findOneAndUpdate(
    { space: space._id, email },
    { $set: { tokenHash: hashToken(token), invitedBy: user._id, expiresAt, role } },
    { upsert: true, new: true },
  );
  const link = `${config.appUrl}/invite/${token}`;

  let emailed = false;
  if (emailConfigured()) {
    try {
      await sendMail({
        to: email,
        subject: `${user.name} invited you to "${space.name}" on Spendwise`,
        text: `${user.name} invited you to share the "${space.name}" space on Spendwise.\n\nAccept: ${link}\n\nThe link works for ${INVITE_DAYS} days. Log in (or sign up) with ${email} to accept it.`,
        html: `<p>${escapeHtml(user.name)} invited you to share the <b>${escapeHtml(space.name)}</b> space on Spendwise.</p>
<p><a href="${escapeHtml(link)}">Accept the invite</a></p>
<p style="color:#6b7280;font-size:12px">The link works for ${INVITE_DAYS} days. Log in (or sign up) with ${escapeHtml(email)} to accept it.</p>`,
      });
      emailed = true;
    } catch {
      emailed = false;
    }
  }
  // The link is also returned so the owner can share it another way (e.g. WhatsApp) if email isn't set up.
  return { invite: { id: String(inv._id), email, role, expiresAt }, link, emailed };
}

export async function revokeInvite(user, spaceId, inviteId) {
  const space = await memberSpace(user, spaceId);
  requireOwner(space, user);
  if (!mongoose.isValidObjectId(inviteId)) throw new HttpError(404, 'invite_not_found', 'Invite not found');
  const { deletedCount } = await SpaceInvite.deleteOne({ _id: inviteId, space: space._id });
  if (!deletedCount) throw new HttpError(404, 'invite_not_found', 'Invite not found');
}

async function findInvite(token) {
  const inv = await SpaceInvite.findOne({ tokenHash: hashToken(String(token)), expiresAt: { $gt: new Date() } }).lean();
  if (!inv) throw new HttpError(404, 'invite_not_found', 'This invite link is invalid or has expired');
  return inv;
}

// Public: what an invite link is for, so the accept page can explain it before logging in.
export async function getInvite(token) {
  const inv = await findInvite(token);
  const [space, inviter] = await Promise.all([
    Space.findById(inv.space).select('name').lean(),
    User.findById(inv.invitedBy).select('name').lean(),
  ]);
  if (!space) throw new HttpError(404, 'invite_not_found', 'This invite link is invalid or has expired');
  return { spaceName: space.name, invitedBy: inviter?.name ?? 'Someone', email: inv.email, expiresAt: inv.expiresAt };
}

export async function acceptInvite(user, token) {
  const inv = await findInvite(token);
  if (inv.email !== user.email) {
    throw new HttpError(403, 'invite_wrong_account', `This invite is for ${inv.email}. Log in with that email to accept it.`);
  }
  // Matching the address isn't enough: anyone can sign up with someone else's. The owner must have confirmed it.
  if (!user.emailVerifiedAt) {
    throw new HttpError(403, 'email_not_verified', `Confirm your email address first: open the link we sent to ${user.email}, then accept the invite.`);
  }
  const space = await Space.findById(inv.space);
  if (!space) throw new HttpError(404, 'invite_not_found', 'This invite link is invalid or has expired');
  if (!roleOf(space, user._id)) {
    if (space.members.length >= MAX_MEMBERS) throw new HttpError(409, 'space_full', `A space can have up to ${MAX_MEMBERS} people`);
    space.members.push({ user: user._id, role: inv.role ?? 'editor', joinedAt: new Date() });
    await space.save();
    await logActivity({ space: space._id, user: user._id, entity: 'space', entityId: space._id, action: 'join', summary: `${user.name} joined the space` });
  }
  await SpaceInvite.deleteOne({ _id: inv._id });
  return describe(space, user);
}

// Leaving: the owner hands the space to the longest-standing member; the last person out deletes it.
async function leave(space, user) {
  if (space.kind === 'personal') throw new HttpError(400, 'personal_space', "You can't leave your personal space");
  const others = space.members.filter((m) => !sameId(m.user, user._id)).sort((a, b) => a.joinedAt - b.joinedAt);
  if (!others.length) {
    await purgeSpace(space._id);
    return { deleted: true };
  }
  if (roleOf(space, user._id) === 'owner') {
    others[0].role = 'owner';
    space.owner = others[0].user;
  }
  space.members = others;
  await space.save();
  await RentProfile.deleteOne({ space: space._id, user: user._id });
  await CalendarFeed.deleteMany({ space: space._id, user: user._id });
  await logActivity({ space: space._id, user: user._id, entity: 'space', entityId: space._id, action: 'leave', summary: `${user.name} left the space` });
  return { deleted: false };
}

export async function removeMember(user, spaceId, memberId) {
  const space = await memberSpace(user, spaceId);
  if (sameId(memberId, user._id)) return leave(space, user);
  requireOwner(space, user);
  const target = space.members.find((m) => sameId(m.user, memberId));
  if (!target) throw new HttpError(404, 'member_not_found', "That person isn't in this space");
  const removed = await User.findById(memberId).select('name').lean();
  space.members = space.members.filter((m) => !sameId(m.user, memberId));
  await space.save();
  await RentProfile.deleteOne({ space: space._id, user: memberId });
  await CalendarFeed.deleteMany({ space: space._id, user: memberId });
  await logActivity({ space: space._id, user: user._id, entity: 'space', entityId: space._id, action: 'remove', summary: `Removed ${removed?.name ?? 'a member'} from the space` });
  return { deleted: false };
}

// Account deletion: the personal space goes; shared spaces lose this member (entries they added stay).
export async function removeUserFromAllSpaces(user) {
  const spaces = await Space.find({ 'members.user': user._id });
  for (const space of spaces) {
    if (space.kind === 'personal') await purgeSpace(space._id);
    else await leave(space, user);
  }
  await SpaceInvite.deleteMany({ invitedBy: user._id });
  await CalendarFeed.deleteMany({ user: user._id });
  // Their landlord details on rent receipts, in shared spaces too.
  await RentProfile.deleteMany({ user: user._id });
}


// Batch 12R: what a member may do, and a child's pocket money. Only the owner can change these.
export async function updateMember(user, spaceId, memberId, { role, pocketMoney }) {
  const space = await memberSpace(user, spaceId);
  requireOwner(space, user);
  const target = space.members.find((m) => sameId(m.user, memberId));
  if (!target) throw new HttpError(404, 'member_not_found', "That person isn't in this space");
  if (roleName(target.role) === 'owner') throw new HttpError(400, 'owner_role', 'The owner’s role can’t be changed');
  const notes = [];
  if (role !== undefined && role !== roleName(target.role)) { target.role = role; notes.push(`made ${ROLE_WORDS[role]}`); }
  if (roleName(target.role) !== 'child') target.pocketMoneyPaise = null;
  else if (pocketMoney !== undefined) {
    target.pocketMoneyPaise = pocketMoney;
    notes.push(pocketMoney ? `pocket money ₹${formatPaise(pocketMoney)} a month` : 'no pocket-money limit');
  }
  await space.save();
  if (notes.length) {
    const who = await User.findById(memberId).select('name').lean();
    await logActivity({ space: space._id, user: user._id, entity: 'space', entityId: space._id, action: 'update', summary: `${who?.name ?? 'A member'}: ${notes.join(', ')}` });
  }
  return describe(space, user);
}

// Expenses above this amount by anyone but the owner wait for approval (null turns it off).
export async function updateSettings(user, spaceId, { approvalAbove }) {
  const space = await memberSpace(user, spaceId);
  requireOwner(space, user);
  if (space.kind === 'personal') throw new HttpError(400, 'personal_space', 'Approvals are for shared spaces');
  space.approvalAbovePaise = approvalAbove;
  await space.save();
  await logActivity({
    space: space._id, user: user._id, entity: 'space', entityId: space._id, action: 'update',
    summary: approvalAbove ? `Expenses over ₹${formatPaise(approvalAbove)} now need the owner’s approval` : 'Turned off approval for big expenses',
  });
  return describe(space, user);
}

// Spaces made before batch 12R called editors "member".
export async function migrateRoles() {
  await Space.updateMany({ 'members.role': 'member' }, { $set: { 'members.$[m].role': 'editor' } }, { arrayFilters: [{ 'm.role': 'member' }] });
}
