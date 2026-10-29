# Spendwise

**Know where your money goes, every month.** Spendwise is a personal finance tracker built for how money works in India:
UPI and card spending, salary credits, EMIs, fixed deposits, PPF, mutual funds and the April–March financial year.

**Live:** https://spendwise-tau-ruddy.vercel.app · **API:** https://spendwise-api-ur0f.onrender.com/api/health ·
**Full API reference:** [docs/API.md](docs/API.md) · **Deployment notes:** [DEPLOY.md](DEPLOY.md)

![Spendwise dashboard](docs/screenshots/readme/dashboard.png)

---

## 1. Introduction

Most people know roughly what they earn, but not where it goes. Bank apps show a list of debits; spreadsheets are left
half-filled after a week. Spendwise turns everyday entries (typed, spoken, scanned from a receipt, imported from a bank
statement or sent from Telegram) into answers: how much went on what, which budget is about to run out, which bill is
due, whether a purchase fits this month, and what tax you would pay under each regime.

It started from a student brief: a full-stack tracker with React, Express, MongoDB, charts, JWT login, budgets and
recurring entries. It then grew into a complete app with over 30 screens, shared household spaces, investments, Indian tax
helpers, Hindi, a Telegram bot, Google Sheets sync and installable offline use. Everything works on real data; nothing in
the app is simulated.

**Highlights**

- Income, expenses and transfers across cash, bank, card and wallet accounts, stored in exact paise (no rounding errors).
- Monthly and weekly budgets, envelopes and sinking funds, with alerts at 80% and 100%.
- Bills calendar, recurring entries, loans and EMIs, money lent and borrowed, group expense splitting.
- Insights: forecast for the month, unusual spending, subscriptions found, savings rate, inflation-adjusted spending.
- India-specific: old vs new tax regime, capital gains, TDS, rent receipts, mutual fund prices from AMFI, PPF and EPF.
- Private by design: two-step login, app lock with PIN or fingerprint, signed-in devices list, export and delete anytime.

---

## 2. Tech stack and why

| Layer | Choice | Why this one |
|---|---|---|
| Web app | **React 19 + Vite 8** | Fast development server and small production builds; React's component model fits a screen-heavy app. Every page loads on demand, so the login screen downloads only what it shows. |
| Styling | **Tailwind CSS v4** | One design system (colours, type scale, spacing) applied everywhere through tokens; light, dark and high-contrast themes from the same classes. |
| Server data | **TanStack Query** | Caching and automatic refresh: when an entry is added, every chart, card and budget updates without manual wiring. |
| Charts | **Recharts** | Declarative charts that follow the app's colour tokens in both themes. |
| API | **Node.js 22 + Express 5** | One language across client and server; Express 5 handles async errors natively. Validation with **zod**. |
| Database | **MongoDB Atlas + Mongoose 9** | Required by the brief, and a good fit for documents of different shapes (entries with splits, tags, receipts). Atlas free tier, hosted in Mumbai. Money is stored as integer paise. |
| Login | **Own JWT auth + bcrypt** | Full control: sessions per device, sign out everywhere, two-step login (TOTP), app lock (PIN and WebAuthn fingerprint), hashed one-time email links. |
| Email | **Nodemailer + Gmail** | Free and reliable for low volume. On the free Render tier outgoing SMTP is blocked, so production mail goes through a small signed relay on Vercel ([DEPLOY.md](DEPLOY.md)). |
| Notifications | **Web Push (VAPID)** | Free browser notifications for budgets and bills, no third-party account. |
| Offline / install | **PWA + service worker + IndexedDB** | Installable on phones; entries made offline are queued and sent later. |
| Receipt reading | **Tesseract.js** | Free, open-source text recognition that runs in the browser, so receipt photos never leave the device for scanning. |
| Hosting | **Vercel** (web) + **Render** (API) | Both have free tiers and deploy automatically on every push to `main`. |
| Tests | **node:test**, **Playwright**, **Lighthouse**, **axe-core** | 219 API tests on a throwaway in-memory MongoDB, 19 client tests, plus browser walkthroughs and accessibility audits. |

---

## 3. Use cases

| Who | What they do with Spendwise |
|---|---|
| **A salaried professional** | Logs UPI payments in seconds ("450 swiggy dinner yesterday upi"), keeps monthly budgets for food and fuel, gets a warning at 80%, and sees on the 1st how last month went. |
| **Someone planning taxes** | Compares the old and new regime on their own salary, tracks 80C and health-insurance limits from tagged expenses, records TDS and prints rent receipts for HRA. |
| **A family or flatmates** | Share one space with roles (owner, editor, viewer, child with pocket money), keep private accounts private, and approve large expenses before they count. |
| **A saver and investor** | Tracks mutual funds priced daily from AMFI, FDs, RDs, PPF, EPF and gold, sees XIRR and a monthly net-worth history, and plans goals and an emergency fund. |
| **Someone with EMIs and bills** | Sees every bill on a calendar, marks it paid in one tap, and checks the cash-flow forecast for the next 60 days before a big purchase ("Can I afford it?"). |
| **A Hindi speaker** | Uses the whole app in Hindi, including the Telegram bot replies, with larger text and high contrast if needed. |

---

## 4. Research

Building for India meant checking real rules and real data sources rather than guessing.

- **Tax rules.** The tax helper follows the Income-tax Act, 2025 (in force from tax year 2026-27) and the 2025-26 rules
  under the 1961 Act: new-regime slabs and the rebate up to ₹12 lakh with marginal relief, standard deduction, the 80C
  and 80D limits, HRA (50% in eight metro cities from the 2026 rules) and capital-gains rates with the ₹1.25 lakh
  exemption. Sources were the Budget speech and memorandum on indiabudget.gov.in and the Act in the Gazette of India.
- **Mutual fund prices.** AMFI publishes every scheme's daily NAV as a text file
  (`portal.amfiindia.com/spages/NAVAll.txt`, about 14,000 schemes). Its format changed to eight columns, so the parser
  reads columns by their header, not by position.
- **Inflation.** "Spending in today's prices" uses the official All-India CPI from MoSPI's API (base 2024=100).
- **Exchange rates.** Foreign-currency entries are converted with the European Central Bank's daily rates via the free
  Frankfurter API.
- **Bank statements.** Indian bank exports differ in date formats (DD/MM), amount columns and UPI/NEFT/IMPS narration
  styles. The importer learns each bank's layout, extracts the merchant from the narration and flags duplicates.
- **Hosting limits.** Render's free tier sleeps after 15 minutes and, since September 2025, blocks outgoing email ports.
  That led to a scheduled keep-awake ping during the day and the signed email relay on Vercel.
- **Design and accessibility.** Contrast checked against WCAG AA with axe-core on 24 pages in light and dark (0
  problems left); Lighthouse on the public pages scores 91–94 for performance and 100 for accessibility, best practices
  and SEO.

---

## 5. How it works

> Screenshots come from a test account on a local, throwaway database filled with sample entries (the name "Aarav
> Mehta" is made up). No real person's data is shown.

### Architecture

```mermaid
flowchart LR
  U[Browser or installed app] -->|HTTPS| V[Vercel: React app]
  U -->|HTTPS, JWT| R[Render: Express API]
  R --> M[(MongoDB Atlas)]
  R -->|signed HTTPS| E[Vercel function: email relay] -->|SMTP| G[Gmail]
  R --> P[Browser push services]
  R <-->|webhook| T[Telegram bot]
  R --> S[Google Sheets]
  R --> D[AMFI NAVs, MoSPI CPI, ECB rates]
```

The web app is static files on Vercel; it talks to the API on Render with a JWT in the `Authorization` header. The API
keeps all data in MongoDB Atlas, runs hourly jobs (recurring entries, reminders, monthly reports, fund prices) and
sends email through the relay. Every request is scoped to one **space** (personal or shared), so members only ever see
that space's data.

### 5.1 Landing page and sign-up

Visitors who aren't signed in see what Spendwise does, with links to the privacy policy and terms. Signing up sends a
confirmation link; until the address is confirmed nothing is emailed to it. Forgot-password links work once, for 30
minutes.

![Landing page](docs/screenshots/readme/landing.png)

![Login](docs/screenshots/readme/login.png)

### 5.2 Dashboard

The month at a glance: income, expenses, balance and net worth; where the money went by category; income against
expenses over six months; daily spending; recent entries grouped by day; budgets closest to their limit; how you paid
(UPI, card, cash); and what's coming up. New accounts also get a "Get started" checklist, worked out from what is really
in the account.

![Dashboard](docs/screenshots/readme/dashboard.png)

### 5.3 Adding an entry

Press **N** anywhere, or the **+** button. Choose expense, income or transfer, the amount, account, category and payment
method; optionally split across categories, add tags, a note, a receipt photo or a foreign currency. The quick-add box
understands plain text and voice ("450 swiggy dinner yesterday upi"), and the Telegram bot accepts the same.

![Add transaction](docs/screenshots/readme/add-form.png)

### 5.4 Transactions

Search, filter by date, category, account, payment method and tag, and export exactly what's shown as CSV or a PDF
statement. Deleted entries go to a bin for 30 days and can be restored.

![Transactions](docs/screenshots/readme/transactions.png)

### 5.5 Budgets

Monthly limits per category or overall, with status (on track, close to limit, over), spending that has no budget yet,
and six months of history. Weekly budgets, envelopes and sinking funds sit in their own tabs. Alerts go out by
notification or email at 80% and 100%.

![Budgets](docs/screenshots/readme/budgets.png)

### 5.6 Accounts and net worth

Cash, bank accounts, credit cards and wallets with live balances. Credit cards show the current statement cycle and when
the bill is due; card rewards are tracked too.

![Accounts](docs/screenshots/readme/accounts.png)

### 5.7 Insights

A forecast for the month, unusual spending, savings rate, subscriptions found automatically, streaks and achievements,
and spending in today's prices using official inflation figures. The Patterns tab shows spending by weekday and a
calendar heatmap of the last year; there are also Merchants, Compare, Year in review and saved Reports.

![Insights](docs/screenshots/readme/insights.png)

![Spending patterns](docs/screenshots/readme/patterns.png)

### 5.8 Tax and planning

The tax helper totals tax-saving items from tagged entries against each section's limit. Other tabs cover capital
gains, interest and TDS, salary under both regimes, a 60-day cash-flow forecast, "Can I afford it?" and a FIRE
(financial independence) calculator.

![Tax helper](docs/screenshots/readme/tax.png)

![Cash flow forecast](docs/screenshots/readme/cashflow.png)

### 5.9 Investments, goals and bills

Holdings with current value, gain and XIRR; mutual funds priced from AMFI; FDs, RDs and PPF valued from their rates; a
reminder a week before anything matures. Goals show how much to put aside each month. Bills appear on a calendar with
mark-as-paid, skip and reminders three days before.

![Investments](docs/screenshots/readme/investments.png)

![Goals](docs/screenshots/readme/goals.png)

![Bills](docs/screenshots/readme/bills.png)

### 5.10 Importing a bank statement

Drop a CSV or Excel statement; every line is previewed with a suggested category (from your rules, your past entries or
a built-in list of Indian merchants) and duplicates are flagged before anything is saved. A whole import can be undone.

![Import](docs/screenshots/readme/import.png)

### 5.11 Shared households

Create a shared space and invite people by email. Members get roles; children can be given pocket money; accounts can
be kept private; large expenses can wait for the owner's approval. Every change is in the activity log and can be
undone.

![Household](docs/screenshots/readme/household.png)

### 5.12 Integrations

A private calendar feed of bills and maturities for Google Calendar or Outlook, a Google Sheet kept up to date, the
Telegram bot, API tokens for your own scripts and signed webhooks.

![Integrations](docs/screenshots/readme/integrations.png)

### 5.13 Settings, security and accessibility

Language, theme, text size, high contrast, lakh/crore or million number style, privacy mode (blurs amounts in public),
notifications, the monthly email report, password, signed-in devices, two-step login, app lock and full backups.

![Settings](docs/screenshots/readme/settings.png)

### 5.14 Phone, dark mode and Hindi

The same app on a phone (with a bottom tab bar and a + button), in dark mode, and in Hindi.

<p>
  <img src="docs/screenshots/readme/phone-dashboard.png" alt="Dashboard on a phone" width="260" />
  <img src="docs/screenshots/readme/dark-dashboard.png" alt="Dashboard in dark mode" width="560" />
</p>

![Dashboard in Hindi](docs/screenshots/readme/hindi.png)

---

## 6. Running it yourself

Requires Node.js 22 or newer and a MongoDB connection string (a free Atlas cluster works).

```bash
# API on http://localhost:8730
cd server
cp .env.example .env      # set MONGODB_URI and JWT_SECRET (at least 32 characters)
npm install
npm start

# Web app on http://localhost:5200, in a second terminal
cd client
npm install
npm run dev
```

Tests: `npm test` in `server/` (219 tests on an in-memory MongoDB, no real database or email needed) and in `client/`
(19 tests). Optional keys (email, push, Google, Telegram) are listed in `server/.env.example`; without them those
features say "not set up" instead of pretending to work.

```
spendwise/
├── client/            React app (pages, components, Hindi strings) + api/send-mail.js (email relay)
├── server/            Express API: routes, controllers, services, Mongoose models, tests
├── docs/API.md        every endpoint and how each feature works
├── DEPLOY.md          how the live site is set up (Vercel, Render, Atlas)
├── PLAN.md            the step-by-step build plan and what was checked at each step
└── render.yaml        Render blueprint for the API
```

---

## 7. Conclusion

Spendwise shows that a free, private finance tracker can cover far more than a list of expenses: budgets that warn,
bills that remind, investments that price themselves, tax answers based on current Indian rules, and a household that
shares one view of its money. It runs end to end on free services (Vercel, Render, MongoDB Atlas, Gmail) and is tested
at every layer.

**Known limits.** The free API server sleeps overnight, so the first request after that can take up to a minute.
Spendwise records money; it does not connect to bank accounts or move money, and its tax figures are estimates, not
advice. Statements in PDF format aren't read (CSV and Excel are).

**What's next.** Freelance income and a tax-filing pack (planned as batch 12N), email-forwarded statements (needs a
custom domain), and a custom domain for the site.
