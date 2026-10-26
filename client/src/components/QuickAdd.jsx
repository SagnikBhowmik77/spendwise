import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useAccounts } from '../hooks/api.js';
import { today } from '../lib/dates.js';
import { parseQuickAdd } from '../lib/quickAdd.js';
import TransactionForm from './TransactionForm.jsx';
import VoiceButton, { voiceSupported } from './VoiceButton.jsx';
import { Button, Input } from './ui.jsx';
import { t } from '../lib/i18n.js';

// "450 swiggy dinner yesterday" -> the add form, filled in, for checking before saving.
export function useQuickAddParser() {
  const { data } = useAccounts();
  return (text) => {
    const parsed = parseQuickAdd(text, { today: today(), accounts: data?.accounts ?? [] });
    return Object.fromEntries(Object.entries(parsed).filter(([, v]) => v !== null && !(Array.isArray(v) && !v.length)));
  };
}

export default function QuickAdd() {
  const parse = useQuickAddParser();
  const [text, setText] = useState('');
  const [defaults, setDefaults] = useState(null);
  return (
    <>
      <form
        className="flex gap-2"
        onSubmit={(e) => { e.preventDefault(); if (text.trim()) setDefaults(parse(text)); }}
      >
        <div className="relative min-w-0 flex-1">
          <Sparkles className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-indigo-500" aria-hidden="true" />
          <Input aria-label={t('Quick add')} value={text} onChange={(e) => setText(e.target.value)} className="pl-9"
            placeholder={voiceSupported() ? t('Quick add: type or speak “450 swiggy dinner yesterday upi”') : t('Quick add: “450 swiggy dinner yesterday upi”')} />
        </div>
        <VoiceButton onHeard={setText} onText={(said) => { setText(said); setDefaults(parse(said)); }} />
        <Button type="submit" variant="secondary" disabled={!text.trim()}>{t('Fill in')}</Button>
      </form>
      <TransactionForm open={defaults !== null} defaults={defaults ?? undefined} onClose={() => { setDefaults(null); setText(''); }} />
    </>
  );
}
