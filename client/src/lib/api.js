// The one way the app talks to the Spendwise API.
// In dev, VITE_API_URL is empty and Vite proxies /api; in production it is the Render URL.
import { t } from './i18n.js';

const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');
const TOKEN_KEY = 'spendwise.token';

export const tokenStore = {
  get() {
    try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
  },
  set(token) {
    try { localStorage.setItem(TOKEN_KEY, token); } catch { /* private mode: session lasts until reload */ }
  },
  clear() {
    try { localStorage.removeItem(TOKEN_KEY); } catch { /* nothing stored */ }
  },
};

// The shared space the user is working in (none = their personal space). Sent as X-Space-Id.
const SPACE_KEY = 'spendwise.space';
export const spaceStore = {
  get() {
    try { return localStorage.getItem(SPACE_KEY); } catch { return null; }
  },
  set(id) {
    try { if (id) localStorage.setItem(SPACE_KEY, id); else localStorage.removeItem(SPACE_KEY); } catch { /* not remembered */ }
  },
};

// A random id for this browser, sent as X-Device-Id, so a sign-in from a new device can be told apart.
const DEVICE_KEY = 'spendwise.device';
export function deviceId() {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) { id = crypto.randomUUID(); localStorage.setItem(DEVICE_KEY, id); }
    return id;
  } catch {
    return '';
  }
}

export class ApiError extends Error {
  constructor(status, error = {}) {
    super(error.message || t('Something went wrong'));
    this.status = status;
    this.code = error.code || 'unknown';
    // [{ field, message }] for validation errors.
    this.details = error.details || [];
  }

  // { amount: 'Amount must be…', … } for showing next to form fields.
  fieldErrors() {
    return Object.fromEntries(this.details.map((d) => [d.field, d.message]));
  }
}

let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

// 423: the app lock is on and this device is locked; the lock screen takes over.
let onLocked = () => {};
export function setLockedHandler(fn) {
  onLocked = fn;
}

function buildUrl(path, query) {
  const url = new URL(`${BASE}/api${path}`, window.location.origin);
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  }
  return url;
}

// spaceId: send to this space instead of the one on screen (the offline queue sends entries where they were added).
async function request(path, { method = 'GET', body, query, signal, spaceId } = {}) {
  const token = tokenStore.get();
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  const space = spaceId === undefined ? spaceStore.get() : spaceId;
  if (token && space) headers['x-space-id'] = space;
  const device = deviceId();
  if (device) headers['x-device-id'] = device;
  try {
    return await fetch(buildUrl(path, query), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError(0, { code: 'network', message: t('Can’t reach the Spendwise server. Check your connection and try again.') });
  }
}

async function failure(res) {
  let error = {};
  try { error = (await res.json()).error || {}; } catch { /* not JSON */ }
  if (res.status === 401 && tokenStore.get()) onUnauthorized();
  if (res.status === 423) onLocked();
  return new ApiError(res.status, error);
}

export async function api(path, options) {
  const res = await request(path, options);
  if (!res.ok) throw await failure(res);
  if (res.status === 204) return null;
  return res.json();
}

// Sends a file as the raw request body (receipt photos).
export async function uploadBlob(path, blob, method = 'PUT') {
  const headers = { 'content-type': blob.type };
  const token = tokenStore.get();
  const space = spaceStore.get();
  if (token) headers.authorization = `Bearer ${token}`;
  if (token && space) headers['x-space-id'] = space;
  let res;
  try {
    res = await fetch(buildUrl(path), { method, headers, body: blob });
  } catch {
    throw new ApiError(0, { code: 'network', message: t('Can’t reach the Spendwise server. Check your connection and try again.') });
  }
  if (!res.ok) throw await failure(res);
  return res.json();
}

// Fetches a protected file (e.g. a receipt photo) as a Blob.
export async function fetchBlob(path) {
  const res = await request(path);
  if (!res.ok) throw await failure(res);
  return res.blob();
}

// Downloads a file the API streams (CSV/PDF) using the logged-in user's token.
export async function download(path, query) {
  const res = await request(path, { query });
  if (!res.ok) throw await failure(res);
  const blob = await res.blob();
  const match = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = match ? match[1] : path.split('/').pop();
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
