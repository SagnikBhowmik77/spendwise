// Batch 12Q: reads the text OCR found on a receipt (or a shared message) and picks out the total, the date and the
// shop. It only suggests: everything goes into the add form for checking before it is saved.

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
// Lines that name the amount to pay, best first.
const TOTAL_WORDS = [/grand\s*total/i, /net\s*(amount|payable|total)/i, /amount\s*(payable|due|paid)/i, /total\s*(amount|payable|rs|inr|₹)?/i, /\bamount\b/i];
const NOT_A_SHOP = /invoice|receipt|bill\s*no|tax|gst|date|time|cashier|table|order|^tel|^ph|^mob|www\.|@/i;
const MONEY = /(?:₹|rs\.?|inr)?\s*(\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+\.\d{1,2}|\d+)(?!\s*%)/gi;

const pad = (n) => String(n).padStart(2, '0');
const toNumber = (s) => Number(s.replace(/,/g, ''));
const iso = (y, m, d) => {
  const year = y < 100 ? y + 2000 : y;
  const date = new Date(Date.UTC(year, m - 1, d));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${year}-${pad(m)}-${pad(d)}`;
};

function amountsIn(line) {
  return [...line.matchAll(MONEY)].map((m) => toNumber(m[1])).filter((n) => n > 0 && n < 10_000_000);
}

export function findTotal(lines) {
  for (const word of TOTAL_WORDS) {
    for (const line of [...lines].reverse()) {
      if (!word.test(line)) continue;
      // "Sub total" is before tax, so only "grand total" may come from such a line.
      if (/sub\s*-?\s*total/i.test(line) && word !== TOTAL_WORDS[0]) continue;
      const found = amountsIn(line.replace(word, ' '));
      if (found.length) return found.at(-1);
    }
  }
  // No "total" line: the largest amount written with paise.
  const withPaise = lines.flatMap((l) => [...l.matchAll(/\d{1,3}(?:,\d{2,3})*\.\d{2}|\d+\.\d{2}/g)].map((m) => toNumber(m[0])));
  return withPaise.length ? Math.max(...withPaise) : null;
}

export function findDate(text, today) {
  const candidates = [];
  for (const m of text.matchAll(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/g)) candidates.push(iso(Number(m[3]), Number(m[2]), Number(m[1])));
  for (const m of text.matchAll(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g)) candidates.push(iso(Number(m[1]), Number(m[2]), Number(m[3])));
  for (const m of text.matchAll(/\b(\d{1,2})[\s-]*([a-z]{3})[a-z]*[\s,-]*(\d{2,4})\b/gi)) {
    const month = MONTHS.indexOf(m[2].toLowerCase()) + 1;
    if (month) candidates.push(iso(Number(m[3]), month, Number(m[1])));
  }
  return candidates.find((d) => d && d >= '2000-01-01' && (!today || d <= today)) ?? null;
}

export function findShop(lines) {
  const line = lines.slice(0, 6).find((l) => (l.match(/[a-z]/gi) ?? []).length >= 3 && !NOT_A_SHOP.test(l) && !/^\W*\d/.test(l));
  if (!line) return null;
  return line.replace(/[^\p{L}\p{N}&'.\- ]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || null;
}

export function parseReceipt(text, { today } = {}) {
  const lines = String(text ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const total = findTotal(lines);
  return {
    amount: total ? String(Math.round(total * 100) / 100) : null,
    date: findDate(lines.join('\n'), today),
    merchant: findShop(lines),
  };
}
