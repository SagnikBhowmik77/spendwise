// Batch 12K: every piece of text the app shows through t(), tn(), tr() or k() has a Hindi translation, with the
// same {placeholders}; and the helpers fill, pluralise and mark up correctly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import hi from './locales/hi.js';
import { setLanguageForTests, t, tn, tr } from './i18n.js';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STR = String.raw`'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"`;
const unescape = (s) => s.replace(/\\(.)/g, '$1');

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'locales' ? [] : files(p);
    return /\.(jsx?|mjs)$/.test(e.name) && !e.name.endsWith('.test.js') ? [p] : [];
  });
}

function keys() {
  const found = new Map();
  const add = (s, where) => { if (s) found.set(unescape(s), where); };
  for (const f of files(SRC)) {
    const src = fs.readFileSync(f, 'utf8');
    const where = path.relative(SRC, f);
    for (const m of src.matchAll(new RegExp(String.raw`\b(?:t|tr|k)\(\s*(?:${STR})`, 'g'))) add(m[1] ?? m[2], where);
    for (const m of src.matchAll(new RegExp(String.raw`\btn\(\s*[^,]+,\s*(?:${STR})\s*,\s*(?:${STR})`, 'g'))) {
      add(m[1] ?? m[2], where);
      add(m[3] ?? m[4], where);
    }
  }
  return found;
}

const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
const tags = (s) => [...s.matchAll(/<(\w+)>/g)].map((m) => m[1]).sort().join(',');

test('every text in the app has a Hindi translation', () => {
  const missing = [...keys()].filter(([key]) => !(key in hi)).map(([key, where]) => `${where}: ${key}`);
  assert.equal(missing.length, 0, `Missing Hindi for ${missing.length}:\n${missing.slice(0, 60).join('\n')}`);
});

test('translations keep the same placeholders and markup', () => {
  const bad = Object.entries(hi).filter(([en, h]) => placeholders(en) !== placeholders(h) || tags(en) !== tags(h)).map(([en, h]) => `${en} → ${h}`);
  assert.deepEqual(bad, []);
});

test('t, tn and tr in both languages', () => {
  setLanguageForTests('en');
  assert.equal(t('Hello {name}', { name: 'Ira' }), 'Hello Ira');
  assert.equal(tn(1, '{n} entry', '{n} entries'), '1 entry');
  assert.equal(tn(3, '{n} entry', '{n} entries'), '3 entries');
  assert.equal(t('Something only in English'), 'Something only in English');
  setLanguageForTests('hi', hi);
  assert.equal(t('Dashboard'), hi.Dashboard);
  assert.equal(t('Something only in English'), 'Something only in English');
  const parts = tr('Tap <b>Start</b> there', {}, { b: (s) => `[${s}]` });
  assert.ok(parts.some((p) => typeof p === 'object'));
  setLanguageForTests('en');
});
