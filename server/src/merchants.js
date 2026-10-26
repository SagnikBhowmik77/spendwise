// Merchant names, payment methods and categories from bank narrations such as
// "UPI/DR/312345678901/SWIGGY/YESB/swiggy@ybl/Payme" or "POS 416021XXXXXX1234 AMAZON PAY IN".

const CHANNEL = /^(upi|imps|neft|rtgs|ach|nach|mmt|ecs|bil|billpay|inb|ib|tpt|bbps)\b/i;
const CARD_PREFIX = /^(pos|pcd|ecom|vps|ips|vin|me dc si)\b\s*/i;
const ATM = /^(atw|nwd|atm|eaw|cwdr)\b|\batm\s*(wdl|withdrawal|cash)|cash\s*(wdl|withdrawal)/i;
const CARD_BILL = /credit\s*card|\bcc\s*(payment|bill|pymt)|card\s*(payment|bill)|cred\s*club|payment\s*received.*thank\s*you|autopay.*card/i;

// Pieces of a narration that are never the merchant.
const NOISE_WORDS = new Set([
  'dr', 'cr', 'd', 'c', 'p2a', 'p2m', 'p2p', 'upi', 'imps', 'neft', 'rtgs', 'ach', 'nach', 'mmt', 'ecs', 'tp', 'onl', 'inft',
  'bpay', 'bil', 'ref', 'txn', 'na', 'null', 'pos', 'debit', 'credit', 'purchase', 'ecom', 'e', 'comm', 'upiintent',
]);
const BANK_CODES = new Set([
  'yesb', 'hdfc', 'icic', 'sbin', 'utib', 'kkbk', 'punb', 'barb', 'cnrb', 'ubin', 'idib', 'ioba', 'indb', 'idfb', 'fdrl',
  'aubl', 'pytm', 'airp', 'mahb', 'cbin', 'ucba', 'bkid', 'jaka', 'kvbl', 'rbls', 'esfb', 'ybl', 'axl', 'ibl', 'okaxis',
]);
const GENERIC = /^(payment|paid|pay|sent|received|transfer|upi|txn|collect|request|money|to|from)\b/i;
const CITIES = new Set([
  'mumbai', 'bombay', 'bangalore', 'bengaluru', 'delhi', 'new delhi', 'gurgaon', 'gurugram', 'noida', 'pune', 'hyderabad',
  'chennai', 'kolkata', 'ahmedabad', 'jaipur', 'kochi', 'lucknow', 'chandigarh', 'thane', 'navi mumbai', 'indore', 'surat',
]);
const ACRONYMS = new Set(['kfc', 'pvr', 'lic', 'oyo', 'irctc', 'bpcl', 'hpcl', 'iocl', 'bsnl', 'act', 'ola', 'sbi', 'hdfc', 'icici', 'atm', 'emi']);

const isRef = (token) => {
  const t = token.replace(/\s/g, '');
  const digits = (t.match(/\d/g) ?? []).length;
  const letters = (t.match(/[a-z]/gi) ?? []).length;
  return (digits >= 6 && digits > letters) || /^[a-z]{4}0[a-z0-9]{6}$/i.test(t) || /\d*x{3,}\d*/i.test(t);
};
const isBank = (token) => BANK_CODES.has(token.toLowerCase()) || /\bbank$/i.test(token);

// A truncated last word ("Swiggy Limi") or a company suffix is dropped.
const SUFFIXES = ['limited', 'private', 'pvt', 'ltd', 'llp', 'inc', 'india', 'co'];
function tidy(name) {
  let words = name
    .replace(/\bwww\.|\.(com|in|co\.in|net)\b/gi, ' ')
    .replace(/[^a-z0-9&'. ]+/gi, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !NOISE_WORDS.has(w.toLowerCase()) && !isRef(w));
  // Trailing city, country and suffix words, e.g. "SWIGGY BANGALORE IN" or "ACME PVT LTD".
  for (;;) {
    if (words.length < 2) break;
    const last = words.at(-1).toLowerCase().replace(/\.$/, '');
    const lastTwo = words.slice(-2).join(' ').toLowerCase();
    if (CITIES.has(lastTwo) && words.length > 2) words = words.slice(0, -2);
    else if (CITIES.has(last) || ['in', 'ind'].includes(last) || SUFFIXES.some((s) => s.startsWith(last) && last.length >= 2 && (last.length >= 3 || s === last))) words = words.slice(0, -1);
    else break;
  }
  const out = words
    .map((w) => (ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ')
    .slice(0, 40)
    .trim();
  return /[a-z]/i.test(out) ? out : null;
}

// "UPI-SWIGGY-SWIGGY8@YBL-YESB0YBLUPI-123456789012-PAYMENT FROM PHONE" -> "Swiggy". Null when there's no name
// to find (ATM withdrawals, bare reference numbers).
export function extractMerchant(description) {
  const s = String(description ?? '').replace(/\s+/g, ' ').trim();
  if (!s || ATM.test(s)) return null;
  if (CHANNEL.test(s) && /[/\-:]/.test(s)) {
    const tokens = s.split(/[/\-:]/).map((x) => x.trim()).filter(Boolean);
    if (CHANNEL.test(tokens[0])) tokens.shift();
    for (const token of tokens) {
      if (token.includes('@') || isRef(token) || isBank(token) || GENERIC.test(token)) continue;
      if (token.split(/\s+/).every((w) => NOISE_WORDS.has(w.toLowerCase()))) continue;
      const name = tidy(token);
      if (name) return name;
    }
    return null;
  }
  return tidy(s.replace(CARD_PREFIX, ''));
}

export function guessPaymentMethod(description) {
  const s = String(description ?? '');
  if (/(^|[^a-z])upi([^a-z]|$)/i.test(s)) return 'upi';
  if (CARD_PREFIX.test(s) || /\bpos\b|\bcard\b/i.test(s)) return 'card';
  if (/^(neft|imps|rtgs|mmt|inb|ib|bil|tpt|bbps)\b/i.test(s)) return 'netbanking';
  return null;
}

// Money moving between your own accounts: cash from an ATM, or a credit card bill.
export function transferHint(description) {
  const s = String(description ?? '');
  if (ATM.test(s)) return 'atm';
  if (CARD_BILL.test(s)) return 'card';
  return null;
}

// Well-known Indian merchants and words, matched as whole words. The longest match wins,
// so "swiggy instamart" (groceries) beats "swiggy" (food).
const BUILTIN = [
  ['expense', 'Food & Dining', ['swiggy', 'zomato', 'dominos', 'domino s', 'mcdonalds', 'mcdonald s', 'kfc', 'starbucks', 'pizza hut', 'burger king', 'eatsure', 'haldiram', 'haldirams', 'barbeque nation', 'chaayos', 'cafe coffee day', 'subway', 'faasos', 'box8', 'restaurant']],
  ['expense', 'Groceries', ['swiggy instamart', 'instamart', 'bigbasket', 'big basket', 'blinkit', 'zepto', 'dmart', 'avenue supermarts', 'jiomart', 'reliance fresh', 'reliance smart', 'more retail', 'natures basket', 'spencers', 'grofers', 'supermarket', 'kirana']],
  ['expense', 'Transport', ['uber', 'ola', 'rapido', 'namma yatri', 'metro', 'bmtc', 'best', 'fastag', 'parking', 'blusmart']],
  ['expense', 'Fuel', ['indian oil', 'iocl', 'bharat petroleum', 'bpcl', 'hpcl', 'hindustan petroleum', 'petrol', 'fuel', 'filling station', 'nayara']],
  ['expense', 'Shopping', ['amazon', 'flipkart', 'myntra', 'ajio', 'meesho', 'tata cliq', 'croma', 'reliance digital', 'ikea', 'decathlon', 'lifestyle', 'westside', 'pantaloons', 'shoppers stop']],
  ['expense', 'Bills & Utilities', ['electricity', 'bescom', 'msedcl', 'tata power', 'adani electricity', 'torrent power', 'tneb', 'cesc', 'bses', 'water bill', 'indane', 'bharat gas', 'hp gas', 'mahanagar gas', 'igl', 'piped gas']],
  ['expense', 'Mobile & Internet', ['airtel', 'jio', 'vodafone', 'vodafone idea', 'bsnl', 'act fibernet', 'hathway', 'recharge', 'broadband', 'tata play']],
  ['expense', 'Entertainment', ['netflix', 'hotstar', 'jiohotstar', 'spotify', 'prime video', 'bookmyshow', 'pvr', 'inox', 'youtube premium', 'sonyliv', 'zee5', 'apple music', 'district']],
  ['expense', 'Travel', ['makemytrip', 'goibibo', 'irctc', 'indigo', 'interglobe', 'air india', 'akasa', 'spicejet', 'cleartrip', 'yatra', 'oyo', 'airbnb', 'redbus', 'ixigo', 'taj hotels', 'hotel']],
  ['expense', 'Health', ['apollo', 'pharmeasy', 'tata 1mg', '1mg', 'netmeds', 'medplus', 'practo', 'hospital', 'clinic', 'pharmacy', 'medical', 'chemist', 'diagnostics', 'cult fit', 'cultfit']],
  ['expense', 'Education', ['udemy', 'coursera', 'byjus', 'unacademy', 'school', 'college', 'tuition', 'university']],
  ['expense', 'Personal care', ['nykaa', 'salon', 'urban company', 'lakme']],
  ['expense', 'EMI & Loans', ['emi', 'loan', 'bajaj finance', 'home loan']],
  ['expense', 'Insurance', ['lic', 'insurance', 'policybazaar', 'hdfc life', 'icici prudential', 'star health', 'acko', 'digit insurance']],
  ['expense', 'Rent', ['rent', 'nobroker', 'house rent']],
  ['expense', 'Gifts & Donations', ['donation', 'temple', 'charity', 'giveindia']],
  ['income', 'Salary', ['salary', 'sal', 'payroll']],
  ['income', 'Investments', ['interest', 'int pd', 'int paid', 'dividend', 'div', 'sb interest']],
  ['income', 'Refunds', ['refund', 'reversal', 'cashback', 'chargeback']],
];

const words = (text) => ` ${String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;

// -> a default category for this narration, or null.
export function builtinCategory(text, type) {
  const hay = words(text);
  let best = null;
  for (const [t, category, keys] of BUILTIN) {
    if (t !== type) continue;
    for (const key of keys) {
      if (hay.includes(` ${key} `) && (!best || key.length > best.key.length)) best = { key, category };
    }
  }
  return best?.category ?? null;
}
