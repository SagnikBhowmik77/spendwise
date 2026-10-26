// Every page in the app, grouped. The sidebar, the phone "More" sheet and the command palette all read this list.
import {
  ArrowLeftRight, Calculator, CalendarClock, Car, CheckCheck, FileUp, HandCoins, History, Landmark, LayoutDashboard, Lightbulb,
  PiggyBank, Plane, Plug, Repeat, Settings, ShieldCheck, Target, TrendingUp, Users, UsersRound,
} from 'lucide-react';
import { t } from '../lib/i18n.js';

export const NAV_GROUPS = [
  { label: null, items: [
    { to: '/', label: t('Dashboard'), icon: LayoutDashboard, end: true },
    { to: '/transactions', label: t('Transactions'), icon: ArrowLeftRight },
    { to: '/accounts', label: t('Accounts'), icon: Landmark },
    { to: '/budgets', label: t('Budgets'), icon: PiggyBank },
    { to: '/insights', label: t('Insights'), icon: Lightbulb },
  ] },
  { label: t('Planning'), items: [
    { to: '/investments', label: t('Investments'), icon: TrendingUp },
    { to: '/plan', label: t('Tax & planning'), icon: Calculator },
    { to: '/goals', label: t('Goals'), icon: Target },
    { to: '/bills', label: t('Bills'), icon: CalendarClock },
    { to: '/recurring', label: t('Recurring'), icon: Repeat },
    { to: '/debts', label: t('Loans & debts'), icon: HandCoins },
  ] },
  { label: t('Life'), items: [
    { to: '/vehicles', label: t('Vehicles'), icon: Car },
    { to: '/vault', label: t('Vault'), icon: ShieldCheck },
    { to: '/trips', label: t('Trips'), icon: Plane },
    { to: '/groups', label: t('Groups'), icon: UsersRound },
  ] },
  { label: t('Manage'), items: [
    { to: '/household', label: t('Household'), icon: Users },
    { to: '/approvals', label: t('Approvals'), icon: CheckCheck, sharedOnly: true },
    { to: '/import', label: t('Import'), icon: FileUp },
    { to: '/integrations', label: t('Integrations'), icon: Plug },
    { to: '/activity', label: t('Activity'), icon: History },
    { to: '/settings', label: t('Settings'), icon: Settings },
  ] },
];

export const NAV = NAV_GROUPS.flatMap((g) => g.items);
// Approvals only mean something in a shared space.
export const visibleIn = (shared) => (item) => !item.sharedOnly || shared;
// The phone tab bar: three pages and the add button; everything else is under "More".
export const PHONE_TABS = ['/', '/transactions', '/budgets'].map((to) => NAV.find((n) => n.to === to));
