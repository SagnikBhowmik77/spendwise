// The same quick-add parser as client/src/lib/quickAdd.js (the Telegram bot reads messages with it).
// Keep the two in step; test/quickadd.test.js checks they match.
// "450 swiggy dinner yesterday" -> a pre-filled entry. A plain rules-based parser (no AI): it only fills
// what it can read with confidence, and the form is always shown for checking before anything is saved.
// Batch 12K: it also reads Hindi ("200 चाय कल", "५०००० सैलरी मिली"), typed or from voice entry.

// JavaScript's \b only knows English letters, so Hindi words get a Unicode-aware boundary instead.
// The nukta is dropped before matching (voice and keyboards differ on it), so "ज़" and "ज" match alike.
const fold = (s) => s.normalize('NFD').replace(/़/g, '').normalize('NFC');
const word = (alts, flags = '') => new RegExp(`(?<![\\p{L}\\p{M}\\p{N}_])(?:${fold(alts)})(?![\\p{L}\\p{M}\\p{N}_])`, `u${flags}`);

const MERCHANTS = [
  [/\b(swiggy|zomato|dominos|domino's|pizza|restaurant|cafe|coffee|chai|lunch|dinner|breakfast|dosa|biryani|khana|nashta|samosa)\b/, 'Food & Dining'],
  [/\b(blinkit|zepto|bigbasket|big basket|dmart|grocer(y|ies)|vegetables?|veg|milk|kirana|instamart|sabzi|sabji|doodh|ration)\b/, 'Groceries'],
  [/\b(uber|ola|rapido|auto|metro|bus|cab|taxi|train|irctc|toll|parking)\b/, 'Transport'],
  [/\b(petrol|diesel|fuel|cng)\b/, 'Fuel'],
  [/\b(amazon|flipkart|myntra|ajio|meesho|nykaa|shopping|clothes)\b/, 'Shopping'],
  [/\b(electricity|power bill|water bill|gas bill|cylinder|lpg|maintenance|bijli)\b/, 'Bills & Utilities'],
  [/\b(jio|airtel|vi|vodafone|bsnl|recharge|broadband|wifi|internet)\b/, 'Mobile & Internet'],
  [/\b(rent|kiraya)\b/, 'Rent'],
  [/\b(netflix|prime|hotstar|spotify|movie|cinema|pvr|inox|bookmyshow)\b/, 'Entertainment'],
  [/\b(medicine|pharmacy|apollo|doctor|hospital|clinic|1mg|pharmeasy|lab test|dawai|dawa)\b/, 'Health'],
  [/\b(school|college|tuition|course|books?|fees)\b/, 'Education'],
  [/\b(flight|hotel|indigo|makemytrip|goibibo|oyo|airbnb|trip)\b/, 'Travel'],
  [/\b(emi|loan)\b/, 'EMI & Loans'],
  [/\b(insurance|premium|lic)\b/, 'Insurance'],
  [/\b(salon|haircut|spa|parlour|parlor)\b/, 'Personal care'],
  // The same in Hindi, including brand names as Hindi voice typing spells them.
  [word('चाय|कॉफी|खाना|खाने|नाश्ता|नाश्ते|लंच|डिनर|समोसा|समोसे|रेस्टोरेंट|स्विगी|जोमैटो|पिज्जा|बिरयानी|डोसा'), 'Food & Dining'],
  [word('सब्जी|सब्जियां|सब्जियाँ|दूध|किराना|राशन|फल|ब्लिंकिट|जेप्टो'), 'Groceries'],
  [word('ऑटो|रिक्शा|बस|मेट्रो|टैक्सी|कैब|ट्रेन|उबर|ओला|रैपिडो|टोल|पार्किंग'), 'Transport'],
  [word('पेट्रोल|डीजल|सीएनजी'), 'Fuel'],
  [word('कपड़े|कपड़ा|जूते|शॉपिंग|खरीदारी|अमेजन|अमेजॉन|फ्लिपकार्ट|मिंत्रा'), 'Shopping'],
  [word('बिजली|पानी का बिल|गैस|सिलेंडर|मेंटेनेंस'), 'Bills & Utilities'],
  [word('रिचार्ज|मोबाइल|इंटरनेट|वाईफाई|ब्रॉडबैंड|जियो|एयरटेल'), 'Mobile & Internet'],
  [word('किराया|किराए|किराये|भाड़ा'), 'Rent'],
  [word('फिल्म|मूवी|सिनेमा|नेटफ्लिक्स'), 'Entertainment'],
  [word('दवा|दवाई|दवाइयां|दवाइयाँ|डॉक्टर|अस्पताल|दवाखाना|मेडिकल'), 'Health'],
  [word('स्कूल|कॉलेज|फीस|ट्यूशन|किताब|किताबें|कोर्स'), 'Education'],
  [word('फ्लाइट|होटल|यात्रा|ट्रिप'), 'Travel'],
  [word('ईएमआई|लोन|किस्त'), 'EMI & Loans'],
  [word('बीमा|प्रीमियम'), 'Insurance'],
  [word('सैलून|पार्लर|हेयरकट'), 'Personal care'],
];
const INCOME_WORDS = /\b(salary|received|got|refund|refunded|income|credited|cashback|bonus|interest|dividend|freelance|paid me)\b/;
const INCOME_HINDI = word('सैलरी|वेतन|तनख्वाह|तनखा|मिला|मिली|मिले|रिफंड|कैशबैक|ब्याज|बोनस|आमदनी|कमाई');
const INCOME_CATEGORY = [
  [/\bsalary\b/, 'Salary'], [/\b(refund|refunded|cashback)\b/, 'Refunds'], [/\bfreelance\b/, 'Freelance'], [/\binterest\b/, 'Interest'], [/\bdividend\b/, 'Investments'], [/\bbonus\b/, 'Salary'],
  [word('सैलरी|वेतन|तनख्वाह|तनखा|बोनस'), 'Salary'], [word('रिफंड|कैशबैक'), 'Refunds'], [word('ब्याज'), 'Interest'],
];
const METHODS = [
  [/\b(upi|gpay|google pay|phonepe|phone pe|bhim|paytm)\b/, 'upi'],
  [/\b(credit card|debit card|card)\b/, 'card'],
  [/\b(cash|nakad)\b/, 'cash'],
  [/\b(net ?banking|neft|imps|rtgs)\b/, 'netbanking'],
  [word('यूपीआई|जीपे|गूगल पे|फोनपे|फोन पे|पेटीएम|भीम'), 'upi'],
  [word('क्रेडिट कार्ड|डेबिट कार्ड|कार्ड'), 'card'],
  [word('नकद|नगद|कैश'), 'cash'],
  [word('नेट बैंकिंग|नेफ्ट'), 'netbanking'],
];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const HINDI_DAYS = [['रविवार', 'इतवार'], ['सोमवार'], ['मंगलवार'], ['बुधवार'], ['गुरुवार', 'बृहस्पतिवार'], ['शुक्रवार'], ['शनिवार']];
// Hindi joining words left out of the note ("चाय के लिए 200 दिए" -> "चाय").
const HINDI_FILLER = word('का|की|के|को|में|पर|से|लिए|दिए|दिया|दी|खर्च|खर्चा|खर्चे|किए|किया|किये|रुपये|रुपए|रुपया|रु|मैंने|ने', 'g');

const pad = (n) => String(n).padStart(2, '0');
const toDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDay = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

// Finds a date in the text. Never returns a future day (an entry can't be in the future), so कल is yesterday.
function findDate(text, today) {
  const base = parseDay(today);
  const shift = (n) => { const d = new Date(base); d.setDate(d.getDate() + n); return toDay(d); };
  const weekday = (want, last) => {
    let back = (base.getDay() - want + 7) % 7;
    if (back === 0 && last) back = 7;
    return shift(-back);
  };
  let m;
  if ((m = text.match(/\b(day before yesterday)\b/))) return [shift(-2), m[0]];
  if ((m = text.match(/\b(yesterday|yday)\b/))) return [shift(-1), m[0]];
  if ((m = text.match(/\b(today)\b/))) return [today, m[0]];
  if ((m = text.match(word('परसों|परसो')))) return [shift(-2), m[0]];
  if ((m = text.match(word('कल')))) return [shift(-1), m[0]];
  if ((m = text.match(word('आज')))) return [today, m[0]];
  if ((m = text.match(new RegExp(`\\b(last )?(${DAYS.join('|')})\\b`)))) return [weekday(DAYS.indexOf(m[2]), m[1]), m[0]];
  for (const [i, names] of HINDI_DAYS.entries()) {
    if ((m = text.match(word(`(?:पिछले |पिछला )?(?:${names.join('|')})`)))) return [weekday(i, m[0].startsWith('पिछ')), m[0]];
  }
  const mon = `(${MONTHS.join('|')})[a-z]*`;
  const withYear = (d, mo) => {
    let date = new Date(base.getFullYear(), mo, d);
    if (date.getMonth() !== mo) return null;
    if (date > base) date = new Date(base.getFullYear() - 1, mo, d);
    return toDay(date);
  };
  if ((m = text.match(new RegExp(`\\b(\\d{1,2})(st|nd|rd|th)? ${mon}\\b`)))) {
    const d = withYear(Number(m[1]), MONTHS.indexOf(m[3].slice(0, 3)));
    if (d) return [d, m[0]];
  }
  if ((m = text.match(new RegExp(`\\b${mon} (\\d{1,2})(st|nd|rd|th)?\\b`)))) {
    const d = withYear(Number(m[2]), MONTHS.indexOf(m[1].slice(0, 3)));
    if (d) return [d, m[0]];
  }
  if ((m = text.match(/\b(\d{1,2})[/-](\d{1,2})\b/))) {
    const d = withYear(Number(m[1]), Number(m[2]) - 1);
    if (d) return [d, m[0]];
  }
  return [today, null];
}

function findTime(text) {
  let m = text.match(/\b(\d{1,2})(?::(\d{2}))? ?(am|pm)\b/);
  if (m) {
    let h = Number(m[1]) % 12;
    if (m[3] === 'pm') h += 12;
    const min = Number(m[2] ?? 0);
    if (h < 24 && min < 60) return [`${pad(h)}:${pad(min)}`, m[0]];
  }
  m = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (m) return [`${pad(Number(m[1]))}:${m[2]}`, m[0]];
  return [null, null];
}

// Amount: "450", "₹1,250.50", "rs 99", "1.2k", "2 हजार", "200 रुपये".
function findAmount(text) {
  const m = text.match(/(?:₹|rs\.?|inr|रु\.?)?\s*(\d{1,3}(?:,\d{2,3})+|\d+)(?:\.(\d{1,2}))?(?:\s*(k|हजार))?(?![a-z\d])(?:\s*(?:rs|rupees|inr|रुपये|रुपए|रुपया|रु))?/u);
  if (!m) return [null, null];
  let value = Number(m[1].replace(/,/g, '') + (m[2] ? `.${m[2]}` : ''));
  if (m[3]) value *= 1000;
  if (!(value > 0)) return [null, null];
  return [String(Math.round(value * 100) / 100), m[0]];
}

export function parseQuickAdd(input, { today, accounts = [] } = {}) {
  // Hindi digits (०-९) are read as 0-9.
  const raw = fold(String(input ?? '').trim()).replace(/[०-९]/g, (d) => String(d.charCodeAt(0) - 0x966));
  const lower = ` ${raw.toLowerCase()} `;
  const used = [];
  const take = (piece) => { if (piece) used.push(piece.trim()); };

  const tags = [...lower.matchAll(/#([a-z0-9][a-z0-9-]{0,29})/g)].map((m) => m[1]);
  tags.forEach((t) => take(`#${t}`));
  const [time, timeText] = findTime(lower); take(timeText);
  const [date, dateText] = findDate(lower, today); take(dateText);
  const [amount, amountText] = findAmount(lower.replace(timeText ?? '\u0000', ' ')); take(amountText);

  const type = INCOME_WORDS.test(lower) || INCOME_HINDI.test(lower) ? 'income' : 'expense';
  let category = null;
  for (const [re, cat] of type === 'income' ? INCOME_CATEGORY : MERCHANTS) {
    if (re.test(lower)) { category = cat; break; }
  }
  let paymentMethod = null;
  for (const [re, method] of METHODS) {
    const m = lower.match(re);
    if (m) { paymentMethod = method; take(m[0]); break; }
  }
  // An account named in the text ("hdfc", "paytm wallet") is used if it matches one of yours.
  const account = accounts.find((a) => fold(a.name.toLowerCase()).split(/\s+/).some((w) => w.length > 2 && word(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(lower)))?.id ?? null;

  // Whatever is left (minus filler words) becomes the note: "swiggy dinner" -> "Swiggy dinner".
  let note = lower;
  for (const piece of used) note = note.replace(piece, ' ');
  note = note.replace(/\b(on|for|at|via|by|using|paid|spent|spend|from|of|rs|rupees)\b/g, ' ').replace(HINDI_FILLER, ' ').replace(/\s+/g, ' ').trim();
  note = note ? note[0].toUpperCase() + note.slice(1) : '';

  return { type, amount, category, date, time, paymentMethod, tags, account, note };
}
