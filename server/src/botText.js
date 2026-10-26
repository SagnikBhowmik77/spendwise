// Batch 12K: the Telegram bot's replies in Hindi, for people who chose Hindi in the app (user.language).
// Like the app, the English text is the key; a missing Hindi line falls back to English.

const HI = {
  // Commands menu
  'Add an entry, e.g. /add 200 chai': 'एंट्री जोड़ें, जैसे /add 200 chai',
  'What you spent today': 'आज कितना खर्च हुआ',
  'This month so far': 'इस महीने अब तक',
  'Remove the last entry added here': 'यहाँ से जोड़ी आख़िरी एंट्री हटाएँ',
  'What I can do': 'मैं क्या कर सकता हूँ',
  'Stop using this chat with Spendwise': 'इस चैट को Spendwise से हटाएँ',

  // Help
  'Send me what you spent, the way you’d say it:': 'जो खर्च किया, वैसे ही लिखकर भेजें जैसे बोलते हैं:',
  '• got 50000 salary': '• 50000 सैलरी मिली',
  '/today – today’s spending': '/today – आज का खर्च',
  '/summary – this month so far': '/summary – इस महीने अब तक',
  '/undo – remove the last entry added here': '/undo – यहाँ से जोड़ी आख़िरी एंट्री हटाएँ',
  '/unlink – stop using this chat': '/unlink – इस चैट को हटाएँ',

  // Today and month
  'Nothing added today yet.': 'आज अभी कुछ नहीं जोड़ा।',
  'Today: {total} spent': 'आज: {total} खर्च',
  ' in {n} entry': ' {n} एंट्री में',
  ' in {n} entries': ' {n} एंट्री में',
  ', {amount} income': ', {amount} आमदनी',
  '…and {n} more': '…और {n}',
  'Nothing recorded in {month} yet.': '{month} में अभी कुछ दर्ज नहीं।',
  '{month} so far: {spent} spent, {income} income': '{month} अब तक: {spent} खर्च, {income} आमदनी',
  ', {amount} left': ', {amount} बचे',
  'Most spent on:': 'सबसे ज़्यादा खर्च:',
  'Your day in Spendwise': 'Spendwise में आपका दिन',

  // Adding and undoing
  'I couldn’t find an amount in that. Try: add 200 chai': 'इसमें रकम नहीं मिली। ऐसे लिखें: 200 चाय',
  'today': 'आज',
  'Added income of {amount}': '{amount} की आमदनी जोड़ी',
  'Added spending of {amount}': '{amount} का खर्च जोड़ा',
  'Wrong? Send /undo.': 'ग़लत है? /undo भेजें।',
  'There’s nothing from this chat to undo.': 'इस चैट से हटाने के लिए कुछ नहीं है।',
  'That entry was already removed.': 'वह एंट्री पहले ही हट चुकी है।',
  'Removed {amount} {category}{note}. It stays in the bin in Spendwise for {days} days if you change your mind.': '{amount} {category}{note} हटा दिया। मन बदले तो यह Spendwise के कूड़ेदान में {days} दिन तक रहेगा।',

  // Linking and errors
  'Linked to Spendwise as {name}. 🎉': 'Spendwise से {name} के रूप में जुड़ गए। 🎉',
  'This chat was unlinked from Spendwise. Link it again from the app any time.': 'यह चैट Spendwise से हटा दी गई। ऐप से कभी भी फिर जोड़ें।',
  'You’re no longer in the space this chat was linked to, so it was unlinked. Link it again from the app.': 'आप अब उस स्पेस में नहीं हैं जिससे यह चैट जुड़ी थी, इसलिए इसे हटा दिया। ऐप से फिर जोड़ें।',
  'Unlinked. This chat won’t add anything to Spendwise any more.': 'हटा दिया। यह चैट अब Spendwise में कुछ नहीं जोड़ेगी।',
  'What should I add? For example: /add 200 chai': 'क्या जोड़ूँ? जैसे: /add 200 chai',
  'I don’t know /{cmd}.': 'मुझे /{cmd} नहीं आता।',
  'To add something, include the amount, like “add 200 chai”.': 'कुछ जोड़ने के लिए रकम लिखें, जैसे “200 चाय”।',
  'That didn’t work: {error}': 'यह नहीं हुआ: {error}',

  // Built-in categories (stored in English, shown in Hindi)
  Salary: 'वेतन', Freelance: 'फ़्रीलांस', Business: 'व्यापार', Interest: 'ब्याज', Investments: 'निवेश', 'Rental income': 'किराये की आमदनी',
  Gifts: 'उपहार', Refunds: 'रिफ़ंड', Other: 'अन्य', 'Food & Dining': 'खाना-पीना', Groceries: 'किराना', Rent: 'किराया',
  Transport: 'आना-जाना', Fuel: 'ईंधन', Shopping: 'ख़रीदारी', 'Bills & Utilities': 'बिल और सुविधाएँ',
  'Mobile & Internet': 'मोबाइल और इंटरनेट', Health: 'सेहत', Education: 'पढ़ाई', Entertainment: 'मनोरंजन', Travel: 'यात्रा',
  'Personal care': 'निजी देखभाल', 'EMI & Loans': 'EMI और लोन', Insurance: 'बीमा', 'Gifts & Donations': 'उपहार और दान',
};

const CATEGORIES = new Set([
  'Salary', 'Freelance', 'Business', 'Interest', 'Investments', 'Rental income', 'Gifts', 'Refunds', 'Other', 'Food & Dining', 'Groceries',
  'Rent', 'Transport', 'Fuel', 'Shopping', 'Bills & Utilities', 'Mobile & Internet', 'Health', 'Education', 'Entertainment',
  'Travel', 'Personal care', 'EMI & Loans', 'Insurance', 'Gifts & Donations',
]);

const fill = (s, vars = {}) => s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));

export const say = (lang, text, vars) => fill(lang === 'hi' ? HI[text] ?? text : text, vars);
export const sayN = (lang, n, one, many, vars) => say(lang, n === 1 ? one : many, { n, ...vars });
// A category in the reader's language; people's own categories stay as typed.
export const categoryIn = (lang, name) => (lang === 'hi' && CATEGORIES.has(name) ? HI[name] : name);
export const localeFor = (lang) => (lang === 'hi' ? 'hi-IN' : 'en-IN');
