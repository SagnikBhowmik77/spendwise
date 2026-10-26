// Privacy policy and terms, in plain words. Each line describes what the code really stores and sends;
// change it here whenever a feature changes what leaves the device. The text is in English only (said in Hindi too).
import { Link } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { Logo, ThemeSwitch } from '../components/Brand.jsx';
import { language, t } from '../lib/i18n.js';

const UPDATED = '26 October 2026';
const CONTACT = (import.meta.env.VITE_CONTACT_EMAIL || '').trim();

export function LegalFooter({ className = '' }) {
  return (
    <nav aria-label={t('Legal')} className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-slate-500 dark:text-slate-400 ${className}`}>
      <Link to="/privacy" className="hover:text-slate-900 hover:underline dark:hover:text-white">{t('Privacy')}</Link>
      <Link to="/terms" className="hover:text-slate-900 hover:underline dark:hover:text-white">{t('Terms')}</Link>
    </nav>
  );
}

function LegalPage({ title, children }) {
  return (
    <div className="min-h-dvh bg-slate-50 dark:bg-slate-950">
      <header className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-5 sm:px-6">
        <Link to="/" className="rounded-lg"><Logo /></Link>
        <ThemeSwitch size="sm" />
      </header>
      <main className="mx-auto max-w-3xl px-4 pb-20 pt-6 sm:px-6">
        <Link to="/" className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> {t('Back to Spendwise')}
        </Link>
        <h1 className="mt-6 text-title font-semibold text-slate-900 dark:text-white">{title}</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Last updated {UPDATED}</p>
        {language() !== 'en' && (
          <p className="mt-4 rounded-lg bg-slate-900/[0.04] px-3 py-2 text-sm text-slate-600 dark:bg-white/[0.05] dark:text-slate-300">{t('This page is available in English only.')}</p>
        )}
        <div lang="en" className="mt-8 space-y-8 text-body leading-7 text-slate-700 dark:text-slate-300 [&_h2]:mb-2 [&_h2]:text-heading [&_h2]:font-semibold [&_h2]:text-slate-900 dark:[&_h2]:text-white [&_li]:mt-1.5 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">
          {children}
        </div>
        <LegalFooter className="mt-16 border-t border-slate-900/[0.06] pt-6 dark:border-white/[0.06]" />
      </main>
    </div>
  );
}

const contactLine = CONTACT
  ? <>Questions or requests: write to <a className="font-medium text-indigo-600 underline dark:text-indigo-400" href={`mailto:${CONTACT}`}>{CONTACT}</a>.</>
  : <>Questions or requests: contact the person who runs this copy of Spendwise.</>;

export function Privacy() {
  return (
    <LegalPage title="Privacy policy">
      <section>
        <p>Spendwise is a personal finance tracker. This page says what it keeps about you, where it goes, and how to remove it. In short: your data is used only to run the app for you. There are no ads, no analytics or tracking scripts, and nothing is sold.</p>
      </section>
      <section>
        <h2>What Spendwise stores</h2>
        <ul>
          <li><b>Your account:</b> name, email address, password (stored only as a bcrypt hash, never in readable form), language, and your settings.</li>
          <li><b>Your money records:</b> entries, accounts, budgets, recurring rules, bills, goals, loans, investments, trips, vehicles, warranties and anything else you add. Receipt photos are stored only if you attach one.</li>
          <li><b>Security records:</b> the devices you are signed in on (browser and system name, IP address, and a random id this app keeps on the device), so you can see and sign out sessions and get new-device warnings. Two-step login secrets are encrypted; backup codes and email links are kept only as hashes.</li>
          <li><b>An activity log</b> of changes in each space (who added, edited or deleted what), so changes can be undone.</li>
          <li><b>In shared spaces</b>, the people you invite see the space’s entries, except accounts you mark private.</li>
        </ul>
      </section>
      <section>
        <h2>On your device</h2>
        <p>The app keeps your sign-in token, your preferences (theme, language, text size, privacy mode) and any entries waiting to be sent while offline in your browser’s storage. Spendwise sets no cookies. Reading a receipt photo with text recognition happens in your browser; the photo is not sent anywhere for that.</p>
      </section>
      <section>
        <h2>Services that handle your data</h2>
        <ul>
          <li><b>MongoDB Atlas</b> (hosted on AWS in Mumbai) stores the database.</li>
          <li><b>Render</b> runs the server and <b>Vercel</b> serves the web app; both keep short-lived technical logs.</li>
          <li><b>Gmail</b> sends the emails you ask for: confirmation and reset links, reports, alerts and sign-in warnings.</li>
          <li><b>Your browser’s push service</b> (Google, Mozilla, Apple or Microsoft, depending on the browser) delivers notifications if you turn them on.</li>
          <li><b>Only if you connect them:</b> Google Sheets and Drive (Spendwise can only reach the one sheet it creates), Telegram (the chats you link), your own webhooks and API tokens, and your private calendar feed address.</li>
          <li><b>Public data the server fetches</b> without sending anything about you: exchange rates (Frankfurter), mutual fund prices (AMFI) and inflation figures (MoSPI). The text-recognition model is downloaded to your browser from jsDelivr the first time you scan a receipt.</li>
        </ul>
      </section>
      <section>
        <h2>Keeping and deleting</h2>
        <ul>
          <li>Deleted entries stay in the bin for 30 days so they can be restored, then they are removed.</li>
          <li>You can export your data (CSV, PDF or a full backup) from the app at any time.</li>
          <li>Deleting your account in Settings removes your account, your personal space and everything in it, your sessions, notifications, API tokens and Telegram links. Entries you added to a shared space stay with that household, shown as from a former member.</li>
        </ul>
      </section>
      <section>
        <h2>Security</h2>
        <p>Connections are encrypted (HTTPS). Passwords are hashed, sign-ins can be protected with two-step login and an app lock, and email links work once and expire (30 minutes for a password reset, 24 hours to confirm an email). No system is perfectly secure; if a problem affects your data, the people who run Spendwise will tell those affected by email.</p>
      </section>
      <section>
        <h2>Changes and contact</h2>
        <p>If this policy changes, the date at the top changes too. {contactLine}</p>
      </section>
    </LegalPage>
  );
}

export function Terms() {
  return (
    <LegalPage title="Terms of use">
      <section>
        <p>By creating an account you agree to these terms. They are written to be read, not to trick anyone.</p>
      </section>
      <section>
        <h2>What Spendwise is</h2>
        <p>A free tool for recording and understanding your own money. It works on what you enter or import. It does not move money, connect to your bank, or hold funds.</p>
      </section>
      <section>
        <h2>Not financial or tax advice</h2>
        <p>Tax estimates, capital-gains figures, forecasts, FIRE projections and “can I afford it” answers are calculations from your numbers and published rules. They can be wrong or out of date. Check anything important with a qualified professional, and with official sources before filing a return.</p>
      </section>
      <section>
        <h2>Your account</h2>
        <ul>
          <li>Keep your password to yourself and use your own email address. Use two-step login if you can.</li>
          <li>You are responsible for what you add, and for who you invite to a shared space.</li>
          <li>Don’t use Spendwise to break the law, to attack or overload it, or to get at other people’s data.</li>
        </ul>
      </section>
      <section>
        <h2>Availability</h2>
        <p>Spendwise runs on free hosting and is provided as it is, without guarantees. It may be slow to wake up, be down for a while, change, or stop. Export your data regularly if it matters to you. To the extent the law allows, the people who run it are not liable for losses from using it.</p>
      </section>
      <section>
        <h2>Ending</h2>
        <p>You can delete your account at any time in Settings. An account that breaks these terms may be closed. If these terms change, the date at the top changes too. {contactLine}</p>
      </section>
    </LegalPage>
  );
}
