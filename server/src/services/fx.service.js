import { HttpError } from '../errors.js';
import { config } from '../config.js';
import { FxRate } from '../models/index.js';
import { dayString } from '../money.js';

// Exchange rates from Frankfurter (ECB reference rates; free, no key). The entry stays in INR paise;
// the foreign amount and the rate used are kept next to it.
const UNAVAILABLE = () =>
  new HttpError(503, 'fx_unavailable', "Couldn't get the exchange rate right now. Try again, or enter the amount in rupees.");

let currencyCache = null;

async function fetchJson(path) {
  let res;
  try {
    res = await fetch(`${config.fxUrl}${path}`, { signal: AbortSignal.timeout(8000) });
  } catch {
    throw UNAVAILABLE();
  }
  if (res.status === 404) return null;
  if (!res.ok) throw UNAVAILABLE();
  return res.json();
}

// { USD: 'United States Dollar', … } without INR. Cached for a day.
export async function currencies() {
  if (currencyCache && currencyCache.at > Date.now() - 24 * 60 * 60 * 1000) return currencyCache.list;
  const data = await fetchJson('/currencies');
  if (!data) throw UNAVAILABLE();
  delete data.INR;
  currencyCache = { at: Date.now(), list: data };
  return data;
}

// INR per 1 unit of `currency` for a day. A future day uses the latest rate available.
export async function rateFor(currency, date) {
  const today = dayString(new Date());
  const day = dayString(date) > today ? today : dayString(date);
  const cached = await FxRate.findOne({ currency, day }).lean();
  // Today's rate can still be published later in the day, so it is only cached for an hour.
  if (cached && (day !== today || cached.fetchedAt > new Date(Date.now() - 60 * 60 * 1000))) {
    return { rate: cached.rate, rateDate: cached.rateDate };
  }
  const data = await fetchJson(`/${day}?base=${encodeURIComponent(currency)}&symbols=INR`);
  if (!data) throw new HttpError(400, 'unknown_currency', `No exchange rate is published for ${currency}`);
  const rate = data.rates?.INR;
  if (!Number.isFinite(rate) || rate <= 0) throw UNAVAILABLE();
  await FxRate.updateOne({ currency, day }, { $set: { rate, rateDate: data.date, fetchedAt: new Date() } }, { upsert: true });
  return { rate, rateDate: data.date };
}

// Foreign amount in minor units (cents) -> INR paise, rounded to the nearest paisa.
export const toPaise = (minor, rate) => Math.round(minor * rate);
