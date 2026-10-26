// Batch 12P maths: vehicle mileage and servicing, card reward values and the FIRE projection.
// Amounts are integer paise; days are UTC-midnight Dates.
import { addMonths } from './invest.js';

// Mileage between full tanks: the km since the previous full tank over the fuel put in since then (part fills
// in between count towards the next full tank). Cost per km: what was spent after the first fill-up over the
// km driven since it.
export function vehicleStats(fills) {
  const sorted = [...fills].sort((a, b) => a.odometerKm - b.odometerKm || a.date - b.date);
  const segments = [];
  let lastFull = null;
  let fuel = 0;
  for (const f of sorted) {
    if (lastFull) fuel += f.quantity;
    if (f.fullTank) {
      if (lastFull && f.odometerKm > lastFull.odometerKm && fuel > 0) {
        segments.push({ to: f.date, km: f.odometerKm - lastFull.odometerKm, quantity: fuel, mileage: (f.odometerKm - lastFull.odometerKm) / fuel });
      }
      lastFull = f;
      fuel = 0;
    }
  }
  const first = sorted[0];
  const last = sorted.at(-1);
  const km = first && last ? last.odometerKm - first.odometerKm : 0;
  const spentAfterFirst = sorted.slice(1).reduce((s, f) => s + f.amountPaise, 0);
  const totalKm = segments.reduce((s, x) => s + x.km, 0);
  const totalFuel = segments.reduce((s, x) => s + x.quantity, 0);
  const round2 = (n) => Math.round(n * 100) / 100;
  return {
    fills: sorted.length,
    odometerKm: last?.odometerKm ?? null,
    kmTracked: km,
    spentPaise: sorted.reduce((s, f) => s + f.amountPaise, 0),
    averageMileage: totalFuel > 0 ? round2(totalKm / totalFuel) : null,
    lastMileage: segments.length ? round2(segments.at(-1).mileage) : null,
    costPerKmPaise: km > 0 ? Math.round(spentAfterFirst / km) : null,
    segments: segments.map((s) => ({ ...s, mileage: round2(s.mileage), quantity: round2(s.quantity) })),
  };
}

// When the next service is due: so many km after the last one, or so many months, whichever comes first.
export function serviceDue(service, odometerKm, today) {
  if (!service || (!service.everyKm && !service.everyMonths)) return null;
  const nextKm = service.everyKm && service.lastKm !== null && service.lastKm !== undefined ? service.lastKm + service.everyKm : null;
  const nextDate = service.everyMonths && service.lastDate ? addMonths(service.lastDate, service.everyMonths) : null;
  const kmLeft = nextKm !== null && odometerKm !== null ? nextKm - odometerKm : null;
  const daysLeft = nextDate ? Math.round((nextDate - today) / 86_400_000) : null;
  const overdue = (kmLeft !== null && kmLeft <= 0) || (daysLeft !== null && daysLeft <= 0);
  const soon = !overdue && ((kmLeft !== null && kmLeft <= 500) || (daysLeft !== null && daysLeft <= 14));
  return { nextKm, nextDate, kmLeft, daysLeft, status: overdue ? 'overdue' : soon ? 'soon' : 'ok' };
}

// What a card gives back on an amount in a category, in paise: the category's rate or the card's default;
// for points, rate is points per ₹100 and each point is worth pointValue rupees.
export function rewardValue(card, category, amountPaise) {
  const rule = card.rules?.find((r) => r.category === category);
  const r = rule ? rule.rate : card.defaultRate;
  if (card.type === 'cashback') return Math.round((amountPaise * r) / 100);
  return Math.round((amountPaise / 10_000) * r * (card.pointValue ?? 0) * 100);
}
// The same as a % back, to compare cards.
export const effectivePct = (card, category) => rewardValue(card, category, 10_000_00) / 10_000;

// Financial independence: the money needed to live off investments (yearly spending ÷ the safe withdrawal rate)
// and the year you'd get there, saving the same amount each year. All in today's money: returns are counted
// after inflation, so the target doesn't move.
export function fireProjection({ annualSpendPaise, corpusPaise, annualSavingPaise, returnPct, inflationPct, withdrawalPct, maxYears = 60 }) {
  const target = Math.round((annualSpendPaise * 100) / withdrawalPct);
  const real = (1 + returnPct / 100) / (1 + inflationPct / 100) - 1;
  const series = [{ year: 0, corpusPaise }];
  let corpus = corpusPaise;
  let years = corpus >= target ? 0 : null;
  for (let y = 1; y <= maxYears && years === null; y += 1) {
    corpus = Math.round(corpus * (1 + real) + annualSavingPaise);
    series.push({ year: y, corpusPaise: corpus });
    if (corpus >= target) years = y;
  }
  return { targetPaise: target, realReturnPct: Math.round(real * 10_000) / 100, years, series };
}
