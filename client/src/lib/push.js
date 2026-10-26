// Turning browser push on and off for this device. The browser makes the subscription (with the
// server's public VAPID key); the server stores it and sends budget alerts and reminders to it.
import { api } from './api.js';
import { serviceWorkerRegistration } from './pwa.js';

const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent);

import { t } from './i18n.js';

// { supported, permission, reason }
export function pushSupport() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return {
      supported: false,
      reason: isIos()
        ? t('On iPhone and iPad (iOS 16.4 or later), add Spendwise to your home screen first (Share → Add to Home Screen), then turn this on from the installed app.')
        : "This browser can't receive push notifications.",
    };
  }
  return { supported: true, permission: Notification.permission };
}

function keyBytes(base64url) {
  const b64 = base64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (base64url.length % 4)) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

const sameKey = (sub, publicKey) => {
  const current = sub.options?.applicationServerKey;
  if (!current) return true;
  const a = new Uint8Array(current);
  const b = keyBytes(publicKey);
  return a.length === b.length && a.every((x, i) => x === b[i]);
};

export async function currentSubscription() {
  if (!('serviceWorker' in navigator)) return null;
  const reg = await navigator.serviceWorker.getRegistration('/');
  return reg ? reg.pushManager.getSubscription() : null;
}

export async function enablePush(publicKey) {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error(permission === 'denied'
      ? t('Notifications are blocked for this site. Allow them in the browser’s site settings (the icon left of the address), then try again.')
      : t('Notifications were not allowed.'));
  }
  const reg = await serviceWorkerRegistration();
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  // A subscription made with a different server key can't receive this server's messages.
  if (sub && !sameKey(sub, publicKey)) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  const { endpoint, keys } = sub.toJSON();
  return api('/notifications/subscriptions', { method: 'POST', body: { endpoint, keys } });
}

// Stops push to this device, on the server first so nothing is sent to a browser that no longer listens.
export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  await api('/notifications/subscriptions', { method: 'DELETE', body: { endpoint: sub.endpoint } });
  await sub.unsubscribe();
}
