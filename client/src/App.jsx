import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router';
import { PublicOnly, RequireAuth } from './components/RouteGuards.jsx';
import { Skeleton } from './components/ui.jsx';
import { PageBoundary } from './components/ErrorBoundary.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import NotFound from './pages/NotFound.jsx';

// Signed-in pages (and the shell around them) load on demand, so the login screen downloads only what it shows.
const AppLayout = lazy(() => import('./components/AppLayout.jsx'));
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const Transactions = lazy(() => import('./pages/Transactions.jsx'));
const Accounts = lazy(() => import('./pages/Accounts.jsx'));
const Budgets = lazy(() => import('./pages/Budgets.jsx'));
const Recurring = lazy(() => import('./pages/Recurring.jsx'));
const Household = lazy(() => import('./pages/Household.jsx'));
const Trips = lazy(() => import('./pages/Trips.jsx'));
const Import = lazy(() => import('./pages/Import.jsx'));
const Goals = lazy(() => import('./pages/Goals.jsx'));
const Debts = lazy(() => import('./pages/Debts.jsx'));
const Groups = lazy(() => import('./pages/Groups.jsx'));
const Bills = lazy(() => import('./pages/Bills.jsx'));
const Insights = lazy(() => import('./pages/Insights.jsx'));
const Plan = lazy(() => import('./pages/Plan.jsx'));
const Investments = lazy(() => import('./pages/Investments.jsx'));
const Integrations = lazy(() => import('./pages/Integrations.jsx'));
const Activity = lazy(() => import('./pages/Activity.jsx'));
const Settings = lazy(() => import('./pages/Settings.jsx'));
const Invite = lazy(() => import('./pages/Invite.jsx'));
// Design-system specimen, development only (not in the built app).
const UiPreview = import.meta.env.DEV ? lazy(() => import('./pages/UiPreview.jsx')) : null;
const Vehicles = lazy(() => import('./components/Life.jsx').then((m) => ({ default: m.Vehicles })));
const Vault = lazy(() => import('./components/Life.jsx').then((m) => ({ default: m.Vault })));
const Approvals = lazy(() => import('./pages/Approvals.jsx'));
const Share = lazy(() => import('./pages/Share.jsx'));
const ForgotPassword = lazy(() => import('./pages/EmailLinks.jsx').then((m) => ({ default: m.ForgotPassword })));
const ResetPassword = lazy(() => import('./pages/EmailLinks.jsx').then((m) => ({ default: m.ResetPassword })));
const VerifyEmail = lazy(() => import('./pages/EmailLinks.jsx').then((m) => ({ default: m.VerifyEmail })));
const Privacy = lazy(() => import('./pages/Legal.jsx').then((m) => ({ default: m.Privacy })));
const Terms = lazy(() => import('./pages/Legal.jsx').then((m) => ({ default: m.Terms })));

function PageFallback() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

// A crash inside one page shows a way out there, and clears on the next page.
const page = (Component) => <PageBoundary><Suspense fallback={<PageFallback />}><Component /></Suspense></PageBoundary>;

export default function App() {
  return (
    <Routes>
      <Route element={<PublicOnly />}>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={page(ForgotPassword)} />
      </Route>
      {/* Works signed in or out: explains the invite, then asks you to log in to accept it. */}
      <Route path="/invite/:token" element={page(Invite)} />
      {/* Email links and the legal pages work signed in or out. */}
      <Route path="/reset-password" element={page(ResetPassword)} />
      <Route path="/verify-email" element={page(VerifyEmail)} />
      <Route path="/privacy" element={page(Privacy)} />
      <Route path="/terms" element={page(Terms)} />
      {UiPreview && <Route path="/ui" element={page(UiPreview)} />}
      <Route element={<RequireAuth />}>
        <Route element={<Suspense fallback={null}><AppLayout /></Suspense>}>
          <Route index element={page(Dashboard)} />
          <Route path="transactions" element={page(Transactions)} />
          <Route path="accounts" element={page(Accounts)} />
          <Route path="budgets" element={page(Budgets)} />
          <Route path="recurring" element={page(Recurring)} />
          <Route path="household" element={page(Household)} />
          <Route path="trips" element={page(Trips)} />
          <Route path="import" element={page(Import)} />
          <Route path="goals" element={page(Goals)} />
          <Route path="debts" element={page(Debts)} />
          <Route path="groups" element={page(Groups)} />
          <Route path="bills" element={page(Bills)} />
          <Route path="insights" element={page(Insights)} />
          <Route path="plan" element={page(Plan)} />
          <Route path="investments" element={page(Investments)} />
          <Route path="integrations" element={page(Integrations)} />
          <Route path="activity" element={page(Activity)} />
          <Route path="settings" element={page(Settings)} />
          <Route path="vehicles" element={page(Vehicles)} />
          <Route path="vault" element={page(Vault)} />
          <Route path="approvals" element={page(Approvals)} />
          <Route path="share" element={page(Share)} />
        </Route>
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
