// Batch 12K: the app's languages. The English text is the key: t('Add entry') gives the Hindi when Hindi is
// chosen and a translation exists, and the English otherwise. {name} placeholders are filled from `vars`.
// The language is kept on this device (and on the account, for the Telegram bot); changing it reloads the page.
import { createElement, Fragment } from 'react';

const KEY = 'spendwise.lang';
export const LANGUAGES = [{ value: 'en', label: 'English' }, { value: 'hi', label: 'हिन्दी' }];

const stored = () => {
  try { return localStorage.getItem(KEY); } catch { return null; }
};
let lang = stored() === 'hi' ? 'hi' : 'en';

// Filled by loadLanguage() when Hindi is chosen; English needs no dictionary.
let hi = {};

// Called once by main.jsx before the app loads.
export async function loadLanguage() {
  if (lang === 'hi') hi = (await import('./locales/hi.js')).default;
}

export const language = () => lang;
export const hasStoredLanguage = () => stored() !== null;
// For dates and Intl formatting.
export const localeTag = () => (lang === 'hi' ? 'hi-IN' : 'en-IN');

export function setLanguage(next, { reload = true } = {}) {
  try { localStorage.setItem(KEY, next); } catch { /* this device won't remember it */ }
  if (reload && next !== lang) window.location.reload();
  lang = next;
}

// Marks text that is translated later by a variable, t(x), so the coverage test still finds it.
export const k = (text) => text;

// Tests switch languages without a page.
export const setLanguageForTests = (next, dictionary) => { lang = next; if (dictionary) hi = dictionary; };

const fill = (text, vars) => (vars ? text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : text);

export function t(text, vars) {
  return fill(lang === 'hi' ? hi[text] ?? text : text, vars);
}

// Singular or plural: tn(3, '{n} entry', '{n} entries').
export function tn(n, one, many, vars) {
  return t(n === 1 ? one : many, { n, ...vars });
}

// Text with markup: tr('Tap <b>Start</b> in {bot}', { bot }, { b: (s) => <b>{s}</b> }) gives React nodes.
export function tr(text, vars, tags = {}) {
  const parts = [];
  const re = /<(\w+)>(.*?)<\/\1>/g;
  const s = t(text, vars);
  let last = 0;
  let m;
  while ((m = re.exec(s))) {
    if (m.index > last) parts.push(s.slice(last, m.index));
    const render = tags[m[1]];
    parts.push(render ? createElement(Fragment, { key: parts.length }, render(m[2])) : m[2]);
    last = re.lastIndex;
  }
  if (last < s.length) parts.push(s.slice(last));
  return parts;
}
