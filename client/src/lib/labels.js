// Display names for values the API uses.
import { Banknote, Coins, CreditCard, Landmark, Wallet } from 'lucide-react';
import { t } from './i18n.js';
import { BUILTIN_CATEGORIES } from './categoryNames.js';

export const PAYMENT_METHODS = [
  { value: 'upi', label: t('UPI') },
  { value: 'card', label: t('Card') },
  { value: 'cash', label: t('Cash') },
  { value: 'netbanking', label: t('Net banking') },
  { value: 'other', label: t('Other') },
];
export const METHOD_LABEL = { ...Object.fromEntries(PAYMENT_METHODS.map((m) => [m.value, m.label])), unspecified: t('Not set') };

export const ACCOUNT_TYPES = [
  { value: 'cash', label: t('Cash'), icon: Banknote },
  { value: 'bank', label: t('Bank account'), icon: Landmark },
  { value: 'credit_card', label: t('Credit card'), icon: CreditCard },
  { value: 'wallet', label: t('Wallet (Paytm, PhonePe…)'), icon: Wallet },
  { value: 'other', label: t('Other'), icon: Coins },
];
export const ACCOUNT_TYPE = Object.fromEntries(ACCOUNT_TYPES.map((x) => [x.value, x]));

export const TYPE_LABEL = { income: t('Income'), expense: t('Expense'), transfer: t('Transfer') };

// A category's name on screen. The built-in ones are translated; ones you made yourself are shown as typed.
export const catLabel = (name) => (BUILTIN_CATEGORIES.has(name) ? t(name) : name);
