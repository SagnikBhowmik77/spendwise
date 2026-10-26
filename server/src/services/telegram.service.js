// Batch 12J: the Telegram bot. Link a chat from the app (a one-time code in a t.me link), then message it:
// "add 200 chai", "450 swiggy dinner yesterday", /today, /summary, /undo. Only private chats are answered.
// Locally the server asks Telegram for new messages (long polling); after deploying, Telegram calls a webhook.
// Batch 12K: replies follow the linked person's app language (user.language), English or Hindi.
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { HttpError } from '../errors.js';
import { config } from '../config.js';
import { Account, Space, TelegramLink, TelegramLinkCode, Transaction, User, UNDO_DAYS } from '../models/index.js';
import { parseQuickAdd } from '../quickAdd.js';
import { dayString, formatPaise, monthRange, parseDay, rupeesToPaise } from '../money.js';
import { todayIn } from '../schedule.js';
import { sha256 } from '../security.js';
import { categoryIn, localeFor, say, sayN } from '../botText.js';
import { create as createTx, remove as removeTx } from './transaction.service.js';

const CODE_MINUTES = 15;
const inr = (paise) => `₹${formatPaise(paise)}`;
const NOT_FOUND = () => new HttpError(404, 'telegram_not_found', 'That Telegram chat isn’t linked');
export const telegramConfigured = () => Boolean(config.telegram.token);
// Telegram sends this header with webhook calls, so only Telegram can post updates.
export const webhookSecret = () => sha256(`telegram-webhook:${config.telegram.token}`).slice(0, 48);

export const COMMANDS = [
  { command: 'add', description: 'Add an entry, e.g. /add 200 chai' },
  { command: 'today', description: 'What you spent today' },
  { command: 'summary', description: 'This month so far' },
  { command: 'undo', description: 'Remove the last entry added here' },
  { command: 'help', description: 'What I can do' },
  { command: 'unlink', description: 'Stop using this chat with Spendwise' },
];
const help = (lang) => [
  say(lang, 'Send me what you spent, the way you’d say it:'),
  lang === 'hi' ? '• 200 चाय' : '• add 200 chai',
  lang === 'hi' ? '• 450 swiggy डिनर कल' : '• 450 swiggy dinner yesterday',
  '• 1500 petrol card #trip-goa',
  say(lang, '• got 50000 salary'),
  '',
  say(lang, '/today – today’s spending'),
  say(lang, '/summary – this month so far'),
  say(lang, '/undo – remove the last entry added here'),
  say(lang, '/unlink – stop using this chat'),
].join('\n');

async function tg(method, params = {}, { timeoutMs = 20_000 } = {}) {
  const res = await fetch(`${config.telegram.apiUrl}/bot${config.telegram.token}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params), signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) {
    const err = new Error(`Telegram ${method}: ${data.description ?? `HTTP ${res.status}`}`);
    err.code = data.error_code ?? res.status;
    throw err;
  }
  return data.result;
}

let me = null;
export async function botInfo() {
  me ??= await tg('getMe');
  return me;
}

export const sendMessage = (chatId, text) => tg('sendMessage', { chat_id: chatId, text, disable_web_page_preview: true });

// The app's "Link Telegram" button: a code valid for 15 minutes, as a t.me link that opens the bot.
export async function createLinkCode({ space, user }) {
  if (!telegramConfigured()) throw new HttpError(503, 'telegram_not_configured', 'Telegram isn’t set up on this server');
  const bot = await botInfo();
  const code = crypto.randomBytes(12).toString('base64url');
  const expiresAt = new Date(Date.now() + CODE_MINUTES * 60_000);
  await TelegramLinkCode.create({ hash: sha256(code), user: user._id, space: space._id, expiresAt });
  return { code, url: `https://t.me/${bot.username}?start=${code}`, botUsername: bot.username, expiresAt };
}

const serialize = (l, spaceName) => ({
  id: String(l._id), username: l.username, firstName: l.firstName, space: String(l.space), spaceName,
  dailySummary: l.dailySummary, summaryTime: l.summaryTime, linkedAt: l.createdAt,
});

export async function status(user) {
  const links = await TelegramLink.find({ user: user._id }).sort({ createdAt: 1 }).lean();
  const spaces = await Space.find({ _id: { $in: links.map((l) => l.space) } }).select('name kind').lean();
  const names = new Map(spaces.map((s) => [String(s._id), s.kind === 'personal' ? 'Personal' : s.name]));
  let botUsername = null;
  if (telegramConfigured()) { try { botUsername = (await botInfo()).username; } catch { /* shown as not reachable */ } }
  return { configured: telegramConfigured(), botUsername, links: links.map((l) => serialize(l, names.get(String(l.space)) ?? 'A space you left')) };
}

export async function updateLink(user, id, { dailySummary, summaryTime }) {
  const l = mongoose.isValidObjectId(id) ? await TelegramLink.findOne({ _id: id, user: user._id }) : null;
  if (!l) throw NOT_FOUND();
  if (dailySummary !== undefined) l.dailySummary = dailySummary;
  if (summaryTime !== undefined) { l.summaryTime = summaryTime; l.lastSummaryDay = null; }
  await l.save();
  return serialize(l);
}

export async function unlink(user, id) {
  const l = mongoose.isValidObjectId(id) ? await TelegramLink.findOneAndDelete({ _id: id, user: user._id }) : null;
  if (!l) throw NOT_FOUND();
  sendMessage(l.chatId, say(user.language, 'This chat was unlinked from Spendwise. Link it again from the app any time.')).catch(() => {});
}

// Today's entries in the space (spending listed, income totalled).
async function todayText(link, lang) {
  const today = todayIn(config.timeZone);
  const rows = await Transaction.find({ space: link.space, deletedAt: null, date: today, type: { $in: ['expense', 'income'] } }).sort({ createdAt: 1 }).lean();
  if (!rows.length) return say(lang, 'Nothing added today yet.');
  const spent = rows.filter((r) => r.type === 'expense');
  const income = rows.filter((r) => r.type === 'income').reduce((s, r) => s + r.amountPaise, 0);
  const total = spent.reduce((s, r) => s + r.amountPaise, 0);
  const lines = spent.slice(-10).map((r) => `• ${inr(r.amountPaise)} ${categoryIn(lang, r.category)}${r.note ? ` – ${r.note}` : ''}`);
  const head = `${say(lang, 'Today: {total} spent', { total: inr(total) })}${spent.length ? sayN(lang, spent.length, ' in {n} entry', ' in {n} entries') : ''}${income ? say(lang, ', {amount} income', { amount: inr(income) }) : ''}.`;
  return [head, ...lines, spent.length > 10 ? say(lang, '…and {n} more', { n: spent.length - 10 }) : ''].filter(Boolean).join('\n');
}

async function monthText(link, lang) {
  const today = todayIn(config.timeZone);
  const { from } = monthRange(dayString(today).slice(0, 7));
  const [rows] = await Transaction.aggregate([
    { $match: { space: new mongoose.Types.ObjectId(String(link.space)), deletedAt: null, date: { $gte: from, $lte: today }, type: { $in: ['expense', 'income'] } } },
    { $facet: {
      totals: [{ $group: { _id: '$type', total: { $sum: '$amountPaise' } } }],
      top: [{ $match: { type: 'expense' } }, { $group: { _id: '$category', total: { $sum: '$amountPaise' } } }, { $sort: { total: -1 } }, { $limit: 3 }],
    } },
  ]);
  const by = Object.fromEntries(rows.totals.map((t) => [t._id, t.total]));
  const label = new Intl.DateTimeFormat(localeFor(lang), { month: 'long', timeZone: 'UTC' }).format(from);
  if (!by.expense && !by.income) return say(lang, 'Nothing recorded in {month} yet.', { month: label });
  return [
    `${say(lang, '{month} so far: {spent} spent, {income} income', { month: label, spent: inr(by.expense ?? 0), income: inr(by.income ?? 0) })}${by.income ? say(lang, ', {amount} left', { amount: inr((by.income ?? 0) - (by.expense ?? 0)) }) : ''}.`,
    ...(rows.top.length ? [say(lang, 'Most spent on:'), ...rows.top.map((t) => `• ${categoryIn(lang, t._id)}: ${inr(t.total)}`)] : []),
  ].join('\n');
}

async function addFromText(link, user, space, text) {
  const lang = user.language;
  const accounts = (await Account.find({ space: space._id, archived: false }).select('name').lean()).map((a) => ({ id: String(a._id), name: a.name }));
  const today = dayString(todayIn(config.timeZone));
  const p = parseQuickAdd(text, { today, accounts });
  const amount = p.amount ? rupeesToPaise(p.amount) : null;
  if (!amount) return say(lang, 'I couldn’t find an amount in that. Try: add 200 chai');
  const tx = await createTx({ space, user }, {
    type: p.type, amount, category: p.category ?? 'Other', note: p.note, date: parseDay(p.date), time: p.time,
    paymentMethod: p.paymentMethod ?? undefined, tags: p.tags, account: p.account ?? undefined,
  });
  await TelegramLink.updateOne({ _id: link._id }, { $set: { lastTransaction: tx.id } });
  const accountName = (await Account.findById(tx.account).select('name').lean())?.name;
  const when = p.date === today ? say(lang, 'today') : new Intl.DateTimeFormat(localeFor(lang), { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(parseDay(p.date));
  const what = say(lang, p.type === 'income' ? 'Added income of {amount}' : 'Added spending of {amount}', { amount: inr(amount) });
  return `${what} · ${categoryIn(lang, tx.category)}${tx.note ? ` · ${tx.note}` : ''} · ${when}${accountName ? ` · ${accountName}` : ''}.\n${say(lang, 'Wrong? Send /undo.')}`;
}

async function undo(link, user, space) {
  const lang = user.language;
  if (!link.lastTransaction) return say(lang, 'There’s nothing from this chat to undo.');
  const tx = await Transaction.findOne({ _id: link.lastTransaction, space: space._id, deletedAt: null }).lean();
  await TelegramLink.updateOne({ _id: link._id }, { $set: { lastTransaction: null } });
  if (!tx) return say(lang, 'That entry was already removed.');
  await removeTx({ space, user }, tx._id);
  return say(lang, 'Removed {amount} {category}{note}. It stays in the bin in Spendwise for {days} days if you change your mind.', {
    amount: inr(tx.amountPaise), category: categoryIn(lang, tx.category), note: tx.note ? ` (${tx.note})` : '', days: UNDO_DAYS,
  });
}

// One message from Telegram. Returns what was replied (tests read it).
export async function handleUpdate(update) {
  const msg = update?.message;
  if (!msg?.text || msg.chat?.type !== 'private') return null;
  const chatId = msg.chat.id;
  const text = msg.text.trim();
  const reply = async (t) => { await sendMessage(chatId, t); return t; };
  const [, command, rest = ''] = text.match(/^\/([a-z_]+)(?:@\w+)?\s*([\s\S]*)$/i) ?? [];
  const cmd = command?.toLowerCase();

  if (cmd === 'start' && rest) {
    const found = await TelegramLinkCode.findOneAndDelete({ hash: sha256(rest.trim()), expiresAt: { $gt: new Date() } });
    if (!found) return reply('That link has expired or was already used. In Spendwise, open Integrations → Telegram and tap “Link Telegram” again.');
    const user = await User.findById(found.user).lean();
    if (!user) return reply('That Spendwise account no longer exists.');
    await TelegramLink.findOneAndUpdate(
      { chatId },
      { $set: { user: found.user, space: found.space, username: msg.from?.username ?? '', firstName: msg.from?.first_name ?? '', lastTransaction: null } },
      { upsert: true },
    );
    return reply(`${say(user.language, 'Linked to Spendwise as {name}. 🎉', { name: user.name })}\n\n${help(user.language)}`);
  }

  const link = await TelegramLink.findOne({ chatId });
  if (!link) return reply('This chat isn’t linked to Spendwise yet. In the app, open Integrations → Telegram and tap “Link Telegram”.');
  const [user, space] = await Promise.all([User.findById(link.user), Space.findOne({ _id: link.space, 'members.user': link.user })]);
  if (!user || !space) {
    await TelegramLink.deleteOne({ _id: link._id });
    return reply(say(user?.language, 'You’re no longer in the space this chat was linked to, so it was unlinked. Link it again from the app.'));
  }
  const lang = user.language;
  try {
    if (cmd === 'start' || cmd === 'help') return await reply(help(lang));
    if (cmd === 'today') return await reply(await todayText(link, lang));
    if (cmd === 'summary' || cmd === 'month') return await reply(await monthText(link, lang));
    if (cmd === 'undo') return await reply(await undo(link, user, space));
    if (cmd === 'unlink') {
      await TelegramLink.deleteOne({ _id: link._id });
      return await reply(say(lang, 'Unlinked. This chat won’t add anything to Spendwise any more.'));
    }
    if (cmd === 'add') return await reply(rest ? await addFromText(link, user, space, rest) : say(lang, 'What should I add? For example: /add 200 chai'));
    if (cmd) return await reply(`${say(lang, 'I don’t know /{cmd}.', { cmd })}\n\n${help(lang)}`);
    const body = text.replace(/^add\s+/i, '');
    if (!/[\d०-९]/.test(body)) return await reply(`${say(lang, 'To add something, include the amount, like “add 200 chai”.')}\n\n${help(lang)}`);
    return await reply(await addFromText(link, user, space, body));
  } catch (err) {
    return reply(say(lang, 'That didn’t work: {error}', { error: err.details?.[0]?.message ?? err.message }));
  }
}

// The daily summary, at each chat's chosen time (India time), once a day.
export async function sendDailySummaries({ now = new Date() } = {}) {
  if (!telegramConfigured()) return { sent: 0 };
  const today = dayString(todayIn(config.timeZone, now));
  const hhmm = new Intl.DateTimeFormat('en-GB', { timeZone: config.timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
  let sent = 0;
  for (const link of await TelegramLink.find({ dailySummary: true, lastSummaryDay: { $ne: today } }).lean()) {
    if (hhmm < link.summaryTime) continue;
    const claim = await TelegramLink.updateOne({ _id: link._id, lastSummaryDay: { $ne: today } }, { $set: { lastSummaryDay: today } });
    if (!claim.modifiedCount) continue;
    try {
      const lang = (await User.findById(link.user).select('language').lean())?.language;
      await sendMessage(link.chatId, `${say(lang, 'Your day in Spendwise')}\n\n${await todayText(link, lang)}\n\n${await monthText(link, lang)}`);
      sent += 1;
    } catch (err) {
      // The person blocked the bot or deleted the chat: stop sending.
      if (err.code === 403) await TelegramLink.deleteOne({ _id: link._id });
      else console.error(`Telegram summary failed: ${err.message}`);
    }
  }
  return { sent };
}

// Starts receiving messages: a webhook when there's a public address, otherwise long polling.
export async function startTelegram(log = console) {
  if (!telegramConfigured()) return;
  try {
    const bot = await botInfo();
    await tg('setMyCommands', { commands: COMMANDS });
    // People whose Telegram app is in Hindi see the menu in Hindi.
    await tg('setMyCommands', { commands: COMMANDS.map((c) => ({ ...c, description: say('hi', c.description) })), language_code: 'hi' });
    if (config.telegram.webhookUrl) {
      await tg('setWebhook', { url: `${config.telegram.webhookUrl}/api/integrations/telegram/webhook`, secret_token: webhookSecret(), allowed_updates: ['message'] });
      log.log(`Telegram: @${bot.username} receives messages by webhook`);
      return;
    }
    if (!config.telegram.polling) return;
    await tg('deleteWebhook', { drop_pending_updates: false });
    log.log(`Telegram: @${bot.username} is listening (long polling)`);
    poll(log);
  } catch (err) {
    log.error('Telegram start failed:', err.message);
  }
}

let polling = false;
async function poll(log) {
  if (polling) return;
  polling = true;
  let offset = 0;
  while (polling) {
    try {
      const updates = await tg('getUpdates', { offset, timeout: 25, allowed_updates: ['message'] }, { timeoutMs: 35_000 });
      for (const u of updates) {
        offset = u.update_id + 1;
        await handleUpdate(u).catch((err) => log.error('Telegram message failed:', err.message));
      }
    } catch (err) {
      if (err.code === 409) { log.error('Telegram: another server is receiving this bot’s messages; polling stopped'); polling = false; return; }
      if (err.name !== 'TimeoutError') log.error('Telegram polling:', err.message);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}
export const stopPolling = () => { polling = false; };
