// Things that happen in a space, for webhooks and the Google Sheets sync (batch 12J). Listeners run after
// the change is saved and never hold it up; a failing listener is logged and otherwise ignored.
const listeners = new Set();

export function onSpaceEvent(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emitSpaceEvent(spaceId, event, data) {
  const payload = { spaceId: String(spaceId), event, data, at: new Date() };
  for (const fn of listeners) {
    Promise.resolve().then(() => fn(payload)).catch((err) => console.error(`${event} listener failed: ${err.message}`));
  }
}
