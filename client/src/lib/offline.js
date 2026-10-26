// Batch 12Q: entries added with no connection wait on this device (IndexedDB) and are sent when it's back. Each
// carries a clientRef, so if a send reaches the server but the answer is lost, sending again doesn't add it twice.
import { api } from './api.js';

const DB = 'spendwise-offline';
const STORE = 'entries';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'clientRef' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run(mode, fn) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const out = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(out?.result ?? out);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export const newClientRef = () => `c${Date.now().toString(36)}${crypto.getRandomValues(new Uint32Array(2)).join('').slice(0, 12)}`;
export const offlineSupported = () => typeof indexedDB !== 'undefined';

// body: the POST /transactions body (with its clientRef); spaceId: the space it was added in.
export async function queueEntry(body, spaceId) {
  await run('readwrite', (s) => s.put({ clientRef: body.clientRef, body, spaceId: spaceId ?? null, queuedAt: Date.now() }));
  window.dispatchEvent(new Event('spendwise:queue'));
}

export const queuedEntries = () => run('readonly', (s) => s.getAll()).catch(() => []);
const drop = (ref) => run('readwrite', (s) => s.delete(ref));

let sending = null;
// Sends what's waiting, oldest first. Stops at the first network failure; an entry the server turns down
// (say, its account was deleted meanwhile) is dropped and reported, so it doesn't block the rest.
export function flushQueue() {
  if (!sending) {
    sending = (async () => {
      const result = { sent: 0, rejected: [] };
      const items = (await queuedEntries()).sort((a, b) => a.queuedAt - b.queuedAt);
      for (const item of items) {
        try {
          await api('/transactions', { method: 'POST', body: item.body, spaceId: item.spaceId });
          await drop(item.clientRef);
          result.sent += 1;
        } catch (err) {
          if (err.code === 'network' || err.status >= 500 || err.status === 423 || err.status === 401) break;
          await drop(item.clientRef);
          result.rejected.push({ body: item.body, message: err.details?.[0]?.message ?? err.message });
        }
      }
      window.dispatchEvent(new Event('spendwise:queue'));
      return result;
    })().finally(() => { sending = null; });
  }
  return sending;
}
