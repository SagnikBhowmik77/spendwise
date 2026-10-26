import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api, setLockedHandler, setUnauthorizedHandler, tokenStore } from '../lib/api.js';
import { disablePush } from '../lib/push.js';
import { hasStoredLanguage, language, setLanguage, t } from '../lib/i18n.js';

const AuthContext = createContext(null);
// What counts as using the app, for the app lock's idle timer.
const ACTIVITY = ['pointerdown', 'keydown', 'wheel', 'touchstart'];

// Auth state for the whole app. The JWT lives in localStorage and goes in the Authorization header.
// status: 'loading' (checking a saved token) | 'authenticated' | 'anonymous' | 'unreachable' (server down).
// locked: the app lock is on and this device must be unlocked with the PIN or fingerprint first.
export function AuthProvider({ children }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState(() => ({ status: tokenStore.get() ? 'loading' : 'anonymous', user: null, locked: false }));
  const [attempt, setAttempt] = useState(0);

  const endSession = useCallback(() => {
    tokenStore.clear();
    queryClient.clear();
    setState({ status: 'anonymous', user: null, locked: false });
  }, [queryClient]);

  // Any request that gets a 401 (expired or revoked token) ends the session; a 423 shows the lock screen.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      endSession();
      toast.error(t('Your session ended. Please log in again.'), { id: 'session-ended' });
    });
    setLockedHandler(() => setState((s) => (s.status === 'authenticated' ? { ...s, locked: true } : s)));
  }, [endSession]);

  // On load, turn a saved token back into a user (or drop it if it no longer works).
  useEffect(() => {
    if (!tokenStore.get()) return undefined;
    let cancelled = false;
    setState((s) => ({ ...s, status: 'loading' }));
    api('/auth/me')
      .then(({ user, locked }) => { if (!cancelled) setState({ status: 'authenticated', user, locked: Boolean(locked) }); })
      .catch((err) => {
        if (cancelled) return;
        if (err.status === 401) endSession();
        else setState({ status: 'unreachable', user: null, locked: false, error: err });
      });
    return () => { cancelled = true; };
  }, [attempt, endSession]);

  const startSession = useCallback(({ token, user }) => {
    tokenStore.set(token);
    queryClient.clear();
    setState({ status: 'authenticated', user, locked: false });
  }, [queryClient]);

  // The language follows you: a device that never chose one takes the account's (one reload); a device that
  // did choose saves its choice to the account, so the Telegram bot answers in it.
  const userId = state.user?.id;
  const accountLanguage = state.user?.language;
  useEffect(() => {
    if (!userId || !accountLanguage) return;
    if (!hasStoredLanguage()) { if (accountLanguage !== language()) setLanguage(accountLanguage); }
    else if (accountLanguage !== language()) api('/auth/me', { method: 'PATCH', body: { language: language() } }).catch(() => {});
  }, [userId, accountLanguage]);

  const lockNow = useCallback(async () => {
    try { await api('/auth/lock/now', { method: 'POST' }); } catch { /* the server locks it on the next request anyway */ }
    setState((s) => ({ ...s, locked: true }));
  }, []);

  // With the app lock on, lock after the chosen minutes without a tap or key press, or on coming back
  // to the app after that long away.
  const lockMinutes = state.status === 'authenticated' && state.user?.appLock?.enabled && !state.locked ? state.user.appLock.timeoutMinutes : null;
  useEffect(() => {
    if (!lockMinutes) return undefined;
    const ms = lockMinutes * 60_000;
    let last = Date.now();
    let timer = setTimeout(lockNow, ms);
    const active = () => {
      last = Date.now();
      clearTimeout(timer);
      timer = setTimeout(lockNow, ms);
    };
    const back = () => { if (document.visibilityState === 'visible' && Date.now() - last >= ms) lockNow(); };
    for (const e of ACTIVITY) window.addEventListener(e, active, { passive: true });
    document.addEventListener('visibilitychange', back);
    return () => {
      clearTimeout(timer);
      for (const e of ACTIVITY) window.removeEventListener(e, active);
      document.removeEventListener('visibilitychange', back);
    };
  }, [lockMinutes, lockNow]);

  const value = useMemo(() => ({
    ...state,
    // Resolves to null when signed in, or to { challenge } when a two-factor code is needed next.
    login: async (email, password) => {
      const res = await api('/auth/login', { method: 'POST', body: { email, password } });
      if (res.twoFactorRequired) return res;
      startSession(res);
      return null;
    },
    verifyTwoFactor: async (challenge, code) => {
      const res = await api('/auth/login/2fa', { method: 'POST', body: { challenge, code } });
      startSession(res);
      return res;
    },
    register: async (name, email, password) =>
      startSession(await api('/auth/register', { method: 'POST', body: { name, email, password } })),
    logout: async () => {
      // This browser stops getting the person's alerts once they sign out.
      try { await disablePush(); } catch { /* push may not be set up here */ }
      try { await api('/auth/logout', { method: 'POST' }); } catch { /* the token is dropped either way */ }
      endSession();
    },
    // After "log out everywhere" or deleting the account.
    endSession,
    // After a profile or password change (a password change returns a fresh token).
    updateUser: (user) => setState((s) => ({ ...s, user })),
    refreshUser: async () => {
      const { user } = await api('/auth/me');
      setState((s) => ({ ...s, user }));
      return user;
    },
    replaceToken: (token) => tokenStore.set(token),
    lockNow,
    // After the PIN or fingerprint: everything that failed while locked loads again.
    unlocked: () => {
      setState((s) => ({ ...s, locked: false }));
      queryClient.invalidateQueries();
    },
    retry: () => setAttempt((n) => n + 1),
  }), [state, startSession, endSession, lockNow, queryClient]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
