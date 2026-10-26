import mongoose from 'mongoose';
import { HttpError } from '../errors.js';
import { Transaction, Trip } from '../models/index.js';
import { dayString } from '../money.js';
import { todayIn } from '../schedule.js';
import { config } from '../config.js';
import { buildFilter } from './transaction.service.js';
import { byCategory, summary as totals } from './stats.service.js';

const NOT_FOUND = () => new HttpError(404, 'trip_not_found', 'Trip not found');
const money = (paise) => ({ paise, rupees: paise / 100 });

// "Goa 2026!" -> "trip-goa-2026"
const slug = (name) => `trip-${name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'trip'}`;

async function serialize(trip) {
  const { expense, count } = await totals(trip.space, { tag: trip.tag, type: 'expense' });
  return {
    id: String(trip._id),
    name: trip.name,
    tag: trip.tag,
    budget: trip.budgetPaise ? money(trip.budgetPaise) : null,
    spent: expense,
    entries: count,
    startDate: dayString(trip.startDate),
    endedAt: trip.endedAt,
    active: trip.active,
    percentUsed: trip.budgetPaise ? Math.round((expense.paise * 1000) / trip.budgetPaise) / 10 : null,
  };
}

export async function list(spaceId) {
  const trips = await Trip.find({ space: spaceId }).sort({ active: -1, startDate: -1 }).lean();
  return Promise.all(trips.map(serialize));
}

export async function start({ space, user }, { name, budget }) {
  if (await Trip.exists({ space: space._id, active: true })) {
    throw new HttpError(409, 'trip_running', 'A trip is already running. End it before starting another.');
  }
  // A unique tag even if the same name was used before ("trip-goa", "trip-goa-2").
  const base = slug(name);
  let tag = base;
  for (let n = 2; await Trip.exists({ space: space._id, tag }); n++) tag = `${base}-${n}`;
  const trip = await Trip.create({
    space: space._id, name, tag, budgetPaise: budget ?? null, startDate: todayIn(config.timeZone), createdBy: user._id,
  });
  return serialize(trip.toObject());
}

async function owned(spaceId, id) {
  if (!mongoose.isValidObjectId(id)) throw NOT_FOUND();
  const trip = await Trip.findOne({ _id: id, space: spaceId });
  if (!trip) throw NOT_FOUND();
  return trip;
}

export async function update(spaceId, id, changes) {
  const trip = await owned(spaceId, id);
  if ('name' in changes) trip.name = changes.name;
  if ('budget' in changes) trip.budgetPaise = changes.budget;
  if (changes.end === true && trip.active) {
    trip.endedAt = new Date();
    trip.active = false;
  }
  await trip.save();
  return serialize(trip.toObject());
}

// Deleting a trip keeps its entries and their tag.
export async function remove(spaceId, id) {
  const trip = await owned(spaceId, id);
  await trip.deleteOne();
}

// The end-of-trip summary: total, per category, per day, the biggest expense.
export async function summarize(spaceId, id) {
  const trip = await owned(spaceId, id);
  const filter = buildFilter(spaceId, { tag: trip.tag, type: 'expense' });
  const [base, cats, days, biggest] = await Promise.all([
    serialize(trip.toObject()),
    byCategory(spaceId, { tag: trip.tag, type: 'expense' }),
    Transaction.aggregate([{ $match: filter }, { $group: { _id: '$date' } }]),
    Transaction.findOne(filter).sort({ amountPaise: -1 }).lean(),
  ]);
  return {
    trip: base,
    categories: cats.categories,
    daysWithSpending: days.length,
    perDay: money(days.length ? Math.round(base.spent.paise / days.length) : 0),
    biggest: biggest ? { category: biggest.category, note: biggest.note, date: dayString(biggest.date), amount: money(biggest.amountPaise) } : null,
  };
}
