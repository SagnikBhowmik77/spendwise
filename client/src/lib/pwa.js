import { useEffect, useState } from 'react';

// The service worker only runs in production builds; in dev it would cache files Vite is changing.
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* the app works without it */ });
  });
}

// Push needs the service worker, so turning notifications on registers it in dev too. Pages are fetched
// network-first and dev files are never cached, so nothing Vite serves goes stale.
export async function serviceWorkerRegistration() {
  if (!('serviceWorker' in navigator)) return null;
  return (await navigator.serviceWorker.getRegistration('/')) ?? navigator.serviceWorker.register('/sw.js');
}

const isStandalone =() => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

// "Install app": the browser offers it through beforeinstallprompt (Chrome, Edge, Android).
// Safari has no such event; there the user uses Share → Add to Home Screen.
export function useInstallPrompt() {
  const [prompt, setPrompt] = useState(null);
  const [installed, setInstalled] = useState(isStandalone);

  useEffect(() => {
    const onPrompt = (e) => { e.preventDefault(); setPrompt(e); };
    const onInstalled = () => { setInstalled(true); setPrompt(null); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  return {
    installed,
    canInstall: Boolean(prompt),
    install: async () => {
      if (!prompt) return false;
      prompt.prompt();
      const { outcome } = await prompt.userChoice;
      setPrompt(null);
      return outcome === 'accepted';
    },
  };
}
