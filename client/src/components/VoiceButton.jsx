import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Mic, MicOff } from 'lucide-react';
import { k, language, t } from '../lib/i18n.js';
import { Button, cx } from './ui.jsx';

// Batch 12K: speak an entry ("200 चाय कल", "450 swiggy dinner"); speech engines write numbers as digits. Uses the browser's own speech
// recognition (Chrome and Edge; in Chrome the audio goes to Google's speech service). Where the browser
// can't do it, the button isn't shown at all.
const Recognition = typeof window !== 'undefined' ? window.SpeechRecognition ?? window.webkitSpeechRecognition : undefined;
export const voiceSupported = () => Boolean(Recognition);

const ERRORS = {
  'not-allowed': k('Microphone access was blocked. Allow it in the browser’s site settings, then try again.'),
  'service-not-allowed': k('Microphone access was blocked. Allow it in the browser’s site settings, then try again.'),
  'no-speech': k('Didn’t catch that. Tap the mic and speak again.'),
  'audio-capture': k('No microphone was found.'),
  network: k('Voice typing needs an internet connection.'),
};

// onText(final) gets what was said once you stop; onHeard(partial) shows it while you speak.
export default function VoiceButton({ onText, onHeard, className }) {
  const [listening, setListening] = useState(false);
  const rec = useRef(null);
  useEffect(() => {
    return () => { rec.current?.abort(); };
  }, []);
  if (!Recognition) return null;

  function start() {
    const r = new Recognition();
    r.lang = language() === 'hi' ? 'hi-IN' : 'en-IN';
    r.interimResults = true;
    r.maxAlternatives = 1;
    r.onresult = (e) => {
      const said = [...e.results].map((x) => x[0].transcript).join(' ').trim();
      onHeard?.(said);
      if (e.results[e.results.length - 1].isFinal && said) onText(said);
    };
    r.onerror = (e) => {
      if (e.error !== 'aborted') toast.error(t(ERRORS[e.error] ?? k('Voice typing stopped. Try again.')));
    };
    r.onend = () => { setListening(false); rec.current = null; };
    rec.current = r;
    r.start();
    setListening(true);
  }

  return (
    <Button type="button" variant="secondary" size="icon" aria-pressed={listening}
      aria-label={listening ? t('Stop listening') : t('Speak an entry')}
      title={listening ? t('Listening… speak now') : t('Speak an entry')}
      onClick={() => (listening ? rec.current?.stop() : start())}
      className={cx(listening && 'animate-pulse text-rose-600 ring-rose-400 dark:text-rose-400', className)}>
      {listening ? <MicOff className="h-4 w-4" aria-hidden="true" /> : <Mic className="h-4 w-4" aria-hidden="true" />}
    </Button>
  );
}
