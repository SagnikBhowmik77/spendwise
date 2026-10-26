import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, spaceStore } from '../lib/api.js';
import { t } from '../lib/i18n.js';
import { useAuth } from './AuthContext.jsx';

const SpaceContext = createContext(null);

// Which space (personal or a shared household) the app is showing. The choice is remembered on
// this device and sent with every request; switching clears cached data so nothing leaks between spaces.
export function SpaceProvider({ children }) {
  const qc = useQueryClient();
  const { status } = useAuth();
  const signedIn = status === 'authenticated';
  const [spaceId, setSpaceId] = useState(() => spaceStore.get());

  const spaces = useQuery({ queryKey: ['spaces'], queryFn: () => api('/spaces'), enabled: signedIn });
  const current = useQuery({ queryKey: ['space-current', spaceId], queryFn: () => api('/spaces/current'), enabled: signedIn, retry: false });

  const switchTo = useCallback((id) => {
    spaceStore.set(id || null);
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'spaces' });
    setSpaceId(id || null);
  }, [qc]);

  // A remembered space you've left or been removed from: go back to your personal space.
  useEffect(() => {
    if (spaceId && current.error?.status === 404) switchTo(null);
  }, [spaceId, current.error, switchTo]);

  // Signing out forgets the chosen space.
  useEffect(() => {
    if (status === 'anonymous' && spaceId) { spaceStore.set(null); setSpaceId(null); }
  }, [status, spaceId]);

  const value = useMemo(() => {
    const space = current.data?.space ?? null;
    return {
      spaces: spaces.data?.spaces ?? [],
      space,
      spaceId,
      loading: current.isLoading,
      shared: space?.kind === 'shared',
      // id -> name, for "added by" labels.
      memberName: (id) => space?.members.find((m) => m.id === id)?.name ?? t('Former member'),
      switchTo,
      refresh: () => Promise.all([qc.invalidateQueries({ queryKey: ['spaces'] }), qc.invalidateQueries({ queryKey: ['space-current'] })]),
    };
  }, [spaces.data, current.data, current.isLoading, spaceId, switchTo, qc]);

  return <SpaceContext.Provider value={value}>{children}</SpaceContext.Provider>;
}

export function useSpace() {
  const ctx = useContext(SpaceContext);
  if (!ctx) throw new Error('useSpace must be used inside <SpaceProvider>');
  return ctx;
}
