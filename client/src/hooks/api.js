// Server data for every screen, cached by TanStack Query. Any change to money data invalidates
// the lists, stats, budgets, accounts and the activity log, so every chart and card updates straight away.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';

const get = (path, query) => () => api(path, { query });
const MONEY_KEYS = ['transactions', 'stats', 'budgets', 'categories', 'recurring', 'accounts', 'activity', 'imports', 'onboarding'];
const refreshMoney = (qc) => Promise.all(MONEY_KEYS.map((key) => qc.invalidateQueries({ queryKey: [key] })));

export const useTransactions = (params) =>
  useQuery({ queryKey: ['transactions', params], queryFn: get('/transactions', params), placeholderData: keepPreviousData });
export const useCategories = () => useQuery({ queryKey: ['categories'], queryFn: get('/categories'), staleTime: 5 * 60_000 });

export const useSummary = (params) =>
  useQuery({ queryKey: ['stats', 'summary', params], queryFn: get('/stats/summary', params), placeholderData: keepPreviousData });
export const useByCategory = (params) =>
  useQuery({ queryKey: ['stats', 'by-category', params], queryFn: get('/stats/by-category', params), placeholderData: keepPreviousData });
export const useByPaymentMethod = (params) =>
  useQuery({ queryKey: ['stats', 'by-payment-method', params], queryFn: get('/stats/by-payment-method', params), placeholderData: keepPreviousData });
export const useMonthly = (params) =>
  useQuery({ queryKey: ['stats', 'monthly', params], queryFn: get('/stats/monthly', params), placeholderData: keepPreviousData });
export const useDaily = (params) =>
  useQuery({ queryKey: ['stats', 'daily', params], queryFn: get('/stats/daily', params), placeholderData: keepPreviousData });

export const useAccounts = ({ includeArchived = false } = {}) =>
  useQuery({ queryKey: ['accounts', { includeArchived }], queryFn: get('/accounts', { includeArchived }) });

export const useBudgets = (month) =>
  useQuery({ queryKey: ['budgets', month], queryFn: get('/budgets', { month }), placeholderData: keepPreviousData });
export const useBudgetHistory = (params) =>
  useQuery({ queryKey: ['budgets', 'history', params], queryFn: get('/budgets/history', params) });

export const useRecurring = () => useQuery({ queryKey: ['recurring', 'list'], queryFn: get('/recurring') });
export const useUpcoming = (days = 30) =>
  useQuery({ queryKey: ['recurring', 'upcoming', days], queryFn: get('/recurring/upcoming', { days }) });

export const useActivity = (params) =>
  useQuery({ queryKey: ['activity', params], queryFn: get('/activity', params), placeholderData: keepPreviousData });

export const useTags = () => useQuery({ queryKey: ['transactions', 'tags'], queryFn: get('/tags') });
export const useTrips = () => useQuery({ queryKey: ['trips'], queryFn: get('/trips') });
export const useTripSummary = (id) => useQuery({ queryKey: ['trips', id, 'summary'], queryFn: get(`/trips/${id}/summary`), enabled: Boolean(id) });
export const useCurrencies = (enabled) =>
  useQuery({ queryKey: ['fx', 'currencies'], queryFn: get('/fx/currencies'), staleTime: 24 * 60 * 60_000, enabled });
export const useFxRate = (currency, date) =>
  useQuery({ queryKey: ['fx', 'rate', currency, date], queryFn: get('/fx/rate', { currency, date }), enabled: Boolean(currency && date), retry: false });

function useTripMutation(fn) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSettled: () => qc.invalidateQueries({ queryKey: ['trips'] }) });
}
export const useStartTrip = () => useTripMutation((body) => api('/trips', { method: 'POST', body }));
export const useUpdateTrip = () => useTripMutation(({ id, ...body }) => api(`/trips/${id}`, { method: 'PATCH', body }));
export const useDeleteTrip = () => useTripMutation((id) => api(`/trips/${id}`, { method: 'DELETE' }));

// Statement imports. A preview saves nothing; importing (and undoing an import) changes money data.
export const useImports = () => useQuery({ queryKey: ['imports', 'list'], queryFn: get('/imports') });
export const useImportRules = () => useQuery({ queryKey: ['imports', 'rules'], queryFn: get('/imports/rules') });
export const useImportLayouts = () => useQuery({ queryKey: ['imports', 'layouts'], queryFn: get('/imports/layouts') });
export const usePreviewImport = () => useMutation({ mutationFn: (body) => api('/imports/preview', { method: 'POST', body }) });
function useImportSetting(fn) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSettled: () => qc.invalidateQueries({ queryKey: ['imports'] }) });
}
export const useSaveRule = () => useImportSetting((body) => api('/imports/rules', { method: 'POST', body }));
export const useDeleteRule = () => useImportSetting((id) => api(`/imports/rules/${id}`, { method: 'DELETE' }));
export const useDeleteLayout = () => useImportSetting((id) => api(`/imports/layouts/${id}`, { method: 'DELETE' }));

export const useReportSettings = () => useQuery({ queryKey: ['reports', 'settings'], queryFn: get('/reports/settings') });

function useMoneyMutation(mutationFn, extra = {}) {
  const qc = useQueryClient();
  return useMutation({ mutationFn, ...extra, onSettled: () => refreshMoney(qc) });
}

export const useSaveTransaction = () =>
  useMoneyMutation(({ id, ...body }) =>
    (id ? api(`/transactions/${id}`, { method: 'PATCH', body }) : api('/transactions', { method: 'POST', body })));

// Deleting removes the row from the screen at once and puts it back if the server says no.
export function useDeleteTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api(`/transactions/${id}`, { method: 'DELETE' }),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['transactions'] });
      const snapshot = qc.getQueriesData({ queryKey: ['transactions'] });
      qc.setQueriesData({ queryKey: ['transactions'] }, (data) =>
        (data?.items ? { ...data, items: data.items.filter((t) => t.id !== id), total: data.total - 1 } : data));
      return { snapshot };
    },
    onError: (_err, _id, ctx) => ctx?.snapshot.forEach(([key, data]) => qc.setQueryData(key, data)),
    onSettled: () => refreshMoney(qc),
  });
}
export const useRestoreTransaction = () => useMoneyMutation((id) => api(`/transactions/${id}/restore`, { method: 'POST' }));
export const useRevertActivity = () => useMoneyMutation((logId) => api(`/activity/${logId}/revert`, { method: 'POST' }));

export const useSaveAccount = () =>
  useMoneyMutation(({ id, ...body }) => (id ? api(`/accounts/${id}`, { method: 'PATCH', body }) : api('/accounts', { method: 'POST', body })));
export const useDeleteAccount = () => useMoneyMutation((id) => api(`/accounts/${id}`, { method: 'DELETE' }));

export const useSaveBudget = () =>
  useMoneyMutation(({ id, ...body }) =>
    (id ? api(`/budgets/${id}`, { method: 'PATCH', body: { limit: body.limit, rollover: body.rollover } }) : api('/budgets', { method: 'PUT', body })));
export const useDeleteBudget = () => useMoneyMutation((id) => api(`/budgets/${id}`, { method: 'DELETE' }));
export const useCopyBudgets = () => useMoneyMutation((body) => api('/budgets/copy', { method: 'POST', body }));

export const useSaveRecurring = () =>
  useMoneyMutation(({ id, ...body }) =>
    (id ? api(`/recurring/${id}`, { method: 'PATCH', body }) : api('/recurring', { method: 'POST', body })));
export const useDeleteRecurring = () => useMoneyMutation((id) => api(`/recurring/${id}`, { method: 'DELETE' }));

// Spaces and members change the space list and the current space's details.
function useSpaceMutation(mutationFn) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: ['spaces'] }), qc.invalidateQueries({ queryKey: ['space-current'] })]),
  });
}
export const useCreateSpace = () => useSpaceMutation((body) => api('/spaces', { method: 'POST', body }));
export const useRenameSpace = () => useSpaceMutation(({ id, name }) => api(`/spaces/${id}`, { method: 'PATCH', body: { name } }));
export const useDeleteSpace = () => useSpaceMutation((id) => api(`/spaces/${id}`, { method: 'DELETE' }));
export const useInvite = () => useSpaceMutation(({ id, email, role = 'editor' }) => api(`/spaces/${id}/invites`, { method: 'POST', body: { email, role } }));
// Batch 12R: a member's role and pocket money, and the space's approval limit (owner only).
export const useUpdateMember = () => useSpaceMutation(({ id, userId, ...body }) => api(`/spaces/${id}/members/${userId}`, { method: 'PATCH', body }));
export const useSpaceSettings = () => useSpaceMutation(({ id, ...body }) => api(`/spaces/${id}/settings`, { method: 'PATCH', body }));
export const useRevokeInvite = () => useSpaceMutation(({ id, inviteId }) => api(`/spaces/${id}/invites/${inviteId}`, { method: 'DELETE' }));
export const useRemoveMember = () => useSpaceMutation(({ id, userId }) => api(`/spaces/${id}/members/${userId}`, { method: 'DELETE' }));

export function useUpdateReportSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => api('/reports/settings', { method: 'PATCH', body }),
    onSuccess: (data) => qc.setQueryData(['reports', 'settings'], data),
  });
}
export const useSendTestReport = () => useMutation({ mutationFn: (body) => api('/reports/send-test', { method: 'POST', body }) });

export const useCommitImport = () => useMoneyMutation((body) => api('/imports', { method: 'POST', body }));
export const useUndoImport = () => useMoneyMutation((id) => api(`/imports/${id}`, { method: 'DELETE' }));
export const useRedoImport = () => useMoneyMutation((id) => api(`/imports/${id}/restore`, { method: 'POST' }));

// Weekly budgets live under 'budgets', so money changes refresh them too.
export const useWeeklyBudgets = () => useQuery({ queryKey: ['budgets', 'weekly'], queryFn: get('/budgets/weekly') });
export const useSaveWeeklyBudget = () => useMoneyMutation((body) => api('/budgets/weekly', { method: 'PUT', body }));
export const useDeleteWeeklyBudget = () => useMoneyMutation((id) => api(`/budgets/weekly/${id}`, { method: 'DELETE' }));

export const useNotificationSettings = () => useQuery({ queryKey: ['notifications'], queryFn: get('/notifications/settings') });
export function useUpdateNotificationSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => api('/notifications/settings', { method: 'PATCH', body }),
    onSuccess: (data) => qc.setQueryData(['notifications'], data),
  });
}
export const useSendTestPush = () => useMutation({ mutationFn: () => api('/notifications/test', { method: 'POST' }) });

// Batch 12E: goals, loans, lent/borrowed, groups and bills. Paying an EMI or a bill also records an
// expense, so those mutations refresh money data too.
export const useGoals = () => useQuery({ queryKey: ['goals'], queryFn: get('/goals') });
export const useLoans = () => useQuery({ queryKey: ['loans'], queryFn: get('/loans') });
export const useLoanPrepayment = (id, amount) =>
  useQuery({ queryKey: ['loans', id, 'prepayment', amount], queryFn: get(`/loans/${id}/prepayment`, { amount }), enabled: Boolean(id && amount), retry: false });
export const useDebts = () => useQuery({ queryKey: ['debts'], queryFn: get('/debts') });
export const useGroups = () => useQuery({ queryKey: ['groups'], queryFn: get('/groups') });
export const useGroup = (id) => useQuery({ queryKey: ['groups', id], queryFn: get(`/groups/${id}`), enabled: Boolean(id) });
export const useBills = () => useQuery({ queryKey: ['bills'], queryFn: get('/bills') });
export const useBillCalendar = (month) => useQuery({ queryKey: ['bills', 'calendar', month], queryFn: get('/bills/calendar', { month }), placeholderData: keepPreviousData });
export const useCardCycle = (id, enabled) =>
  useQuery({ queryKey: ['accounts', id, 'cycle'], queryFn: get(`/accounts/${id}/cycle`), enabled, retry: false });

// One mutation for a whole area: mutate({ method, path, body }) and the area's queries refresh.
export function usePlanMutation(key, { money = false } = {}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ method = 'POST', path, body }) => api(path, { method, body }),
    onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: [key] }), money && refreshMoney(qc)]),
  });
}

// Batch 12F. Insights live under 'transactions' so any change to entries refreshes them.
export const useInsight = (path, params, options = {}) =>
  useQuery({ queryKey: ['transactions', 'insights', path, params], queryFn: get(`/insights/${path}`, params), placeholderData: keepPreviousData, retry: false, ...options });
export const useChallenges = () => useQuery({ queryKey: ['transactions', 'challenges'], queryFn: get('/challenges') });
export const useSavedReports = () => useQuery({ queryKey: ['transactions', 'saved-reports'], queryFn: get('/saved-reports') });
export const useRunReport = (id) => useQuery({ queryKey: ['transactions', 'saved-reports', id, 'run'], queryFn: get(`/saved-reports/${id}/run`), enabled: Boolean(id), retry: false });
export const usePreviewReport = () => useMutation({ mutationFn: (body) => api('/saved-reports/preview', { method: 'POST', body }) });

// Batch 12G: tax helper and cash flow. They read entries, so they refresh with them.
export const useTaxRules = (fy) => useQuery({ queryKey: ['tax', 'rules', fy], queryFn: get('/tax/rules', { fy }), staleTime: 60 * 60_000 });
export const useTaxSummary = (params) => useQuery({ queryKey: ['transactions', 'tax', params], queryFn: get('/tax/summary', params), placeholderData: keepPreviousData });
export const useSalaryBreakdown = () => useMutation({ mutationFn: (body) => api('/tax/salary', { method: 'POST', body }) });
export const useCashflow = (days = 60) => useQuery({ queryKey: ['transactions', 'cashflow', days], queryFn: get('/cashflow', { days }) });
// Batch 12M: capital gains come from investment sales, so they refresh with investments; interest, TDS and rent
// receipts read entries and holdings, so they're fetched again whenever their screen opens.
export const useCapitalGains = (params) =>
  useQuery({ queryKey: ['investments', 'capital-gains', params], queryFn: get('/tax/capital-gains', params), placeholderData: keepPreviousData, retry: false });
export const useInterestTds = (fy) =>
  useQuery({ queryKey: ['tax-records', 'interest', fy], queryFn: get('/tax/interest', { fy }), enabled: Boolean(fy), placeholderData: keepPreviousData, staleTime: 0 });
export const useRentProfile = () => useQuery({ queryKey: ['tax-records', 'rent-profile'], queryFn: get('/tax/rent-profile') });
export const useRentReceipts = (fy) =>
  useQuery({ queryKey: ['tax-records', 'rent-receipts', fy], queryFn: get('/tax/rent-receipts', { fy }), enabled: Boolean(fy), staleTime: 0 });
// Batch 12H: investments. The net-worth timeline reads entries too, so it lives under 'transactions'.
export const useInvestments = ({ poll = false } = {}) =>
  useQuery({ queryKey: ['investments'], queryFn: get('/investments'), refetchInterval: poll ? 2000 : false });
export const useSchemeSearch = (q) =>
  useQuery({ queryKey: ['investments', 'schemes', q], queryFn: get('/investments/schemes', { q }), enabled: q.trim().length >= 2, staleTime: 60 * 60_000, retry: false, placeholderData: keepPreviousData });
export const useNetWorth = (months = 12) =>
  useQuery({ queryKey: ['transactions', 'net-worth', months], queryFn: get('/investments/timeline', { months }) });
export const useAfford = (params) => useQuery({ queryKey: ['transactions', 'afford', params], queryFn: get('/cashflow/afford', params), enabled: Boolean(params?.amount), retry: false });
// Batch 12O: envelopes read entries, so they refresh with them; sinking funds and the wishlist have their own keys.
export const useEnvelopes = (month) =>
  useQuery({ queryKey: ['transactions', 'envelopes', month], queryFn: get('/envelopes', { month }), placeholderData: keepPreviousData, retry: false });
export const useSinkingFunds = () => useQuery({ queryKey: ['sinking-funds'], queryFn: get('/sinking-funds') });
export const useWishlist = () => useQuery({ queryKey: ['wishlist'], queryFn: get('/wishlist') });
// Batch 12P: vehicles, the vault, card rewards (they read entries) and FIRE (entries and investments).
export const useVehicles = () => useQuery({ queryKey: ['vehicles'], queryFn: get('/vehicles') });
export const useVault = () => useQuery({ queryKey: ['vault'], queryFn: get('/vault') });
export const useCardRewards = () => useQuery({ queryKey: ['transactions', 'card-rewards'], queryFn: get('/card-rewards') });
export const useFire = (params) =>
  useQuery({ queryKey: ['transactions', 'fire', params], queryFn: get('/fire', params), placeholderData: keepPreviousData, retry: false });
// Batch 12R: big expenses waiting for the owner.
export const useApprovals = (enabled = true) => useQuery({ queryKey: ['transactions', 'approvals'], queryFn: get('/approvals'), enabled });
// Batch 12S: the private calendar address.
export const useCalendarFeed = () => useQuery({ queryKey: ['calendar-feed'], queryFn: get('/integrations/calendar') });

// "Get started" checklist: read from what is really in the space. Money changes refresh it.
export const useOnboarding = () => useQuery({ queryKey: ['onboarding'], queryFn: get('/onboarding') });
export function useDismissChecklist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api('/auth/checklist/dismiss', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['onboarding'] }),
  });
}
export const useResendVerification = () => useMutation({ mutationFn: () => api('/auth/verify-email/send', { method: 'POST' }) });
