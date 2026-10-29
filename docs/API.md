# Spendwise: API and technical reference

Spendwise is a personal finance tracker: log income and expenses, see where money goes with charts, and keep monthly budgets.

**Status:** live at https://spendwise-tau-ruddy.vercel.app. The project overview is in the [README](../README.md); this page is the full API and technical reference.

## Stack

React (Vite) + Tailwind CSS · Node.js + Express · MongoDB + Mongoose · JWT auth · Recharts

## Run locally

Requires Node.js 22 or newer.

```bash
# API (http://localhost:8730)
cd server
cp .env.example .env
npm install
npm start

# Client (http://localhost:5200), in a second terminal
cd client
npm install
npm run dev
```

Run the API tests with `npm test` inside `server/`.

## The app (client/)

Pages: **Dashboard** (greeting, income/expense/balance cards, category pie, 6-month bar chart, daily spending, recent transactions, budgets, upcoming recurring), **Transactions** (search, date presets or a custom range, category, type and sort filters kept in the URL, pagination, add/edit/delete, CSV and PDF export of exactly what's filtered), **Budgets** (per category or overall, progress and status, copy from last month, spending without a budget, 6-month history), **Recurring** (rules, pause/resume, edit, upcoming 30 days) and **Settings** (profile, theme, install, monthly email with preview and test send, password, log out everywhere, delete account).

- React 19 + Vite, Tailwind CSS v4 (mobile-first, light/dark/system theme), Recharts, react-hot-toast, lucide icons.
- Auth state lives in React Context; server data in TanStack Query, so every chart and card refreshes the moment a transaction changes. Deleting a transaction removes it from the screen at once and puts it back if the server refuses.
- Installable PWA: manifest, icons, and a service worker that caches only the app shell (never API data).

| Command (in `client/`) | What it does |
| --- | --- |
| `npm run dev` | dev server on http://localhost:5200 (proxies `/api` to the API) |
| `npm run build` | production build into `dist/` |
| `npm run preview` | serves the build on http://localhost:5201 with the service worker on |
| `npm run icons` | regenerates the PNG app icons from `public/icon.svg` |
| `SHOT_EMAIL=… SHOT_PASSWORD=… node scripts/shots.mjs <dir>` | screenshots of every page (desktop + phone, light + dark); reports page errors and sideways overflow | They use a throwaway local MongoDB, never your real database.

In `server/.env`, set `MONGODB_URI` (MongoDB Atlas connection string) and `JWT_SECRET` (at least 32 random characters). To generate a secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

## API

All errors have the shape `{ "error": { "code", "message", "details"? } }`. Protected routes need `Authorization: Bearer <token>`.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/health` | no | API, database and login status |
| POST | `/api/auth/register` | no | `{ name, email, password }` → `{ token, user }` |
| POST | `/api/auth/login` | no | `{ email, password }` → `{ token, user }` |
| GET | `/api/auth/me` | yes | current user |
| PATCH | `/api/auth/me` | yes | `{ name }` |
| POST | `/api/auth/password` | yes | `{ currentPassword, newPassword }` → new token; other devices are logged out |
| POST | `/api/auth/logout` | yes | revokes this token |
| POST | `/api/auth/logout-all` | yes | revokes every token for this account |
| DELETE | `/api/auth/me` | yes | `{ password }`; deletes the account and all its data |
| POST | `/api/transactions` | yes | `{ type, amount, category, note?, date }` → `{ transaction }` |
| GET | `/api/transactions` | yes | list: `type`, `category` (comma-separated), `from`, `to`, `q`, `sort`, `page`, `limit` |
| GET | `/api/transactions/:id` | yes | one transaction |
| PATCH | `/api/transactions/:id` | yes | any of `type, amount, category, note, date` |
| DELETE | `/api/transactions/:id` | yes | delete one transaction |
| GET | `/api/categories` | yes | suggested categories + the ones you've used |
| GET | `/api/stats/summary` | yes | income, expense, balance and count (summary cards) |
| GET | `/api/stats/by-category` | yes | `type=expense` (default) or `income`: totals and % share per category (pie chart) |
| GET | `/api/stats/monthly` | yes | income vs expense per month; default the last 12 months (bar chart) |
| GET | `/api/stats/daily` | yes | income vs expense per day; default the last 30 days (line chart) |
| GET | `/api/budgets?month=YYYY-MM` | yes | that month's budgets with spent, remaining, % used and status (default: this month) |
| PUT | `/api/budgets` | yes | `{ month, category?, limit }` creates or changes a budget; no category = overall monthly limit |
| PATCH | `/api/budgets/:id` | yes | `{ limit }` |
| DELETE | `/api/budgets/:id` | yes | remove a budget |
| POST | `/api/budgets/copy` | yes | `{ from, to }` copies a month's budgets; ones already set in `to` are kept |
| GET | `/api/budgets/history` | yes | `to`, `months` (1–24, default 6), `category?`: how budgets went month by month |
| GET | `/api/export/transactions.csv` | yes | CSV download (opens in Excel); same filters and `sort` as the list |
| GET | `/api/export/transactions.pdf` | yes | PDF statement with income/expense/balance and the matching rows (up to 5,000) |
| POST | `/api/recurring` | yes | `{ type, amount, category, note?, frequency, interval?, startDate, endDate? }`; entries already due are created at once |
| GET | `/api/recurring` | yes | your rules with `status` (active / paused / ended) and `nextDate` |
| GET | `/api/recurring/upcoming` | yes | `days` (1–90, default 30): entries the active rules will add, with totals |
| GET | `/api/recurring/:id` | yes | one rule |
| PATCH | `/api/recurring/:id` | yes | any of `amount, category, note, endDate, active` (future entries only) |
| DELETE | `/api/recurring/:id` | yes | stop the rule; entries it already made stay |
| GET | `/api/reports/settings` | yes | `{ enabled, lastSentMonth, emailConfigured }` |
| PATCH | `/api/reports/settings` | yes | `{ enabled }` turns the monthly email on or off (503 if the server has no SMTP) |
| GET | `/api/reports/preview?month=YYYY-MM` | yes | the report and its email (subject, text, html); default last month |
| POST | `/api/reports/send-test` | yes | `{ month? }` emails the report to your own address now (5 per hour) |

Transactions: `type` is `income` or `expense`; `amount` is rupees with up to 2 decimals (`"1,250.50"` or `1250.5`), stored as whole paise; `date` is `YYYY-MM-DD` from 2000-01-01 to today. `sort` is `-date` (default), `date`, `-amount` or `amount`; `limit` is 1–100 (default 20). The list returns `{ items, page, limit, total, totalPages }`. Each user only ever sees their own entries; anyone else's id answers 404.

Stats accept the same filters as the list (`type`, `category`, `from`, `to`, `q`), so a chart always matches the list beside it. Money comes back as `{ paise, rupees }`, summed as integers in MongoDB. Months and days with no entries are included as ₹0. Ranges are capped at 60 months and 366 days.

Budgets count only expenses. Status is `ok`, `warning` (80% or more used) or `over` (spent more than the limit; `remaining` goes negative). The monthly view also lists `unbudgeted` categories you spent on without a budget. Budgets can be set up to 12 months ahead.

Exports stream straight from MongoDB. CSV is UTF-8 with a byte-order mark for Excel, and cells starting with `=`, `+`, `-` or `@` get a leading `'` so a spreadsheet never runs them as formulas. The PDF uses the built-in PDF fonts, which have no ₹ sign, so amounts read "Rs. 1,250.50".

Recurring rules run `daily`, `weekly`, `monthly` or `yearly`, every 1–12 periods. The server creates each entry on its due date in India time (`APP_TIMEZONE`, default `Asia/Kolkata`). It checks at start-up, which catches up after a sleeping free-tier server wakes, and then every hour. "Monthly on the 31st" lands on the last day of shorter months. A unique index on (rule, date) means an entry is never created twice, even if two checks overlap. A paused rule skips the dates it missed rather than back-filling them. A start date can be up to a year in the past or ahead.

Monthly email reports are opt-in. Each one covers the previous month: income, expenses, balance, the change versus the month before, the top 5 spending categories and how each budget went. They're sent once per user per month by the same hourly job, which survives overlapping runs and retries a failed send. Turning reports on starts with the current month, so nobody gets a report for a month before they joined. Email needs `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER` and `SMTP_PASS` (a Gmail app password works; Gmail allows about 500 emails a day). `APP_URL` sets the settings link inside the email.

Passwords: 8–72 bytes, at least one letter and one number, stored as bcrypt hashes. Failed logins are limited to 10 per IP per 15 minutes; sign-ups to 20 per IP per hour.

### Accounts, transfers and shared spaces (batch 12A)

Every entry belongs to an **account** (cash, bank, credit card, wallet) in a **space**. Everyone has a private personal space; a shared space (a household, flatmates) has members who all see and edit the same accounts, entries and budgets. Requests pick a shared space with the `X-Space-Id` header; without it they use the personal space.

| Method | Path | Purpose |
| --- | --- | --- |
| GET / POST | `/api/accounts` | accounts with balances + net worth (assets, owed, net); `includeArchived=true` |
| PATCH / DELETE | `/api/accounts/:id` | rename, type, opening balance, `archived`, `isDefault`; delete only without history |
| POST | `/api/transactions/:id/restore` | undo a deletion (deleted entries are kept 30 days) |
| GET | `/api/stats/by-payment-method` | spending by UPI / card / cash / net banking / other |
| GET / POST | `/api/spaces` | your spaces / create a shared one |
| GET | `/api/spaces/current` | the active space with members (and pending invites for the owner) |
| PATCH / DELETE | `/api/spaces/:id` | rename / delete (owner) |
| POST / DELETE | `/api/spaces/:id/invites[/:inviteId]` | invite by email (link valid 7 days, for that email only) / cancel |
| DELETE | `/api/spaces/:id/members/:userId` | remove someone (owner) or leave (yourself) |
| GET / POST | `/api/invites/:token[/accept]` | what an invite is for / accept it |
| GET | `/api/activity` | who changed what, newest first |
| POST | `/api/activity/:id/revert` | restore the version before an edit, or undo a deletion |

Transactions now take `type: "transfer"` with `account` and `toAccount` (no category; never counted as income or spending), an optional `account` for income/expense (default: the space's default account) and an optional `paymentMethod`. Deleting answers `200 { id, restorableUntil }`. Existing data is moved into personal spaces automatically on start-up (`src/migrations.js`).

### Tags, splits, receipts, foreign currency and trips (batch 12B)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/tags` | tags used in the space, with counts |
| GET | `/api/fx/currencies` | currencies with an ECB reference rate (cached 24 h) |
| GET | `/api/fx/rate?currency=USD&date=YYYY-MM-DD` | rupees per unit on that day (latest published rate on or before it) |
| PUT / GET / DELETE | `/api/transactions/:id/receipt` | upload (JPEG, PNG or WebP, max 2 MB, checked by its bytes) / view / remove a receipt photo |
| GET / POST | `/api/trips` | trips / start one (only one runs at a time; gets a tag such as `trip-goa-2026`) |
| PATCH / DELETE | `/api/trips/:id` | rename, change the budget, `end: true` / delete (entries keep their tag) |
| GET | `/api/trips/:id/summary` | spent, per day, budget used, categories, biggest expense |

Transactions now also take `tags` (up to 10, lower-case), `time` (`HH:MM`), `splits` (`[{ category, amount }]` that add up to the amount exactly; category filters, pie charts and budgets count each part) and `currency` + `originalAmount` (converted to rupees at that day's ECB rate from [Frankfurter](https://frankfurter.dev); the rate and its date are stored with the entry). `GET /api/transactions` takes `tag`. Receipts live in MongoDB GridFS (bucket `receipts`); the app shrinks photos to 1600 px JPEG before upload, and an hourly job removes receipts whose entry is gone.

### Importing statements (batch 12C)

The app reads the file (CSV, XLS, XLSX or ODS, up to 5 MB) in the browser with [SheetJS](https://sheetjs.com) and sends only its lines. These routes take bodies up to 6 MB; everything else stays at 100 KB.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/imports/preview` | `{ account, header, rows: [{ line, cells }], mapping }` → each line read as an entry with merchant, payment method, suggested category (`rule`, `learned` or `suggested`), transfer suggestion and duplicate check. Saves nothing |
| POST | `/api/imports` | import the chosen lines as one batch, plus optional new `rules` and a `layout` to remember |
| GET | `/api/imports` | past imports, newest first |
| DELETE | `/api/imports/:id` | undo an import (its entries are deleted, restorable for 30 days) |
| POST | `/api/imports/:id/restore` | bring an undone import back |
| GET / POST | `/api/imports/rules` | category rules ("narration contains swiggy → Food & Dining"); posting the same text again changes the category |
| DELETE | `/api/imports/rules/:id` | remove a rule |
| GET / PUT | `/api/imports/layouts` | saved bank layouts (which column is which), found again by the file's header line |
| DELETE | `/api/imports/layouts/:id` | forget a layout |

`mapping` is `{ date, description, time?, debit + credit | amount (+ drcr?, sign), dateFormat }`, with columns as numbers from 0. Dates are read day first unless the file shows otherwise (`auto`), and Excel date cells are read as real dates. Up to 5,000 lines per import. A line counts as a duplicate when the same line was imported before (a fingerprint of account, date, type, amount and narration), or when an entry with the same amount exists within two days. Imported entries carry `merchant` (searchable) and `importBatchId`.

### Budgets, alerts and notifications (batch 12D)

| Method | Path | Purpose |
| --- | --- | --- |
| PUT / PATCH | `/api/budgets[/:id]` | now also take `rollover: true/false`; budgets return `baseLimit`, `carriedOver` and `limit` (= base + carried over) |
| GET | `/api/budgets/weekly?date=` | weekly budgets for the Monday–Sunday week containing `date` (default today, India time), with `lastWeek` spending |
| PUT / DELETE | `/api/budgets/weekly[/:id]` | set (per category or overall) / remove a weekly budget |
| GET / PATCH | `/api/notifications/settings` | `budgetPush`, `budgetEmail`, `reminder`, `reminderTime` (HH:MM), plus whether push and email are set up and how many devices get push |
| POST / DELETE | `/api/notifications/subscriptions` | save / remove this browser's push subscription (`{ endpoint, keys }`; only Google, Mozilla, Apple and Windows push services are accepted) |
| POST | `/api/notifications/test` | push a test notification to all your devices (10 an hour) |

Rollover adds last month's unspent amount (of last month's budget for the same category, itself including any rollover, looking back up to 24 months) to this month's limit; overspending carries nothing. Any successful change to entries, imports or budgets schedules a budget check for that space shortly after (`ALERT_DELAY_MS`, default 1.5 s); the hourly job checks every space with a budget too. Each budget alerts once at 80% and once at 100% per month or week (a jump straight past 100% sends only that one). The daily reminder is checked every `NOTIFY_EVERY_MS` (default 5 minutes) and goes to people with it on whose time has passed and who added nothing that day.

Push needs `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` (generate with `npx web-push generate-vapid-keys`; free, no account) and optionally `VAPID_SUBJECT`. On a free host that sleeps when idle (Render's free tier), the reminder only fires while the server is awake, so the deployment step adds a free uptime ping.

### Goals, loans, lent/borrowed, groups, bills and card cycles (batch 12E)

| Method | Path | Purpose |
| --- | --- | --- |
| GET / POST | `/api/goals` | goals with saved, percent and `neededPerMonth`, plus an `emergency` suggestion (6 × average monthly spending of the last 3 complete months) / create (`kind: "emergency"` without a target uses the suggestion) |
| PATCH / DELETE | `/api/goals/:id` | name, target, target date / delete |
| POST / DELETE | `/api/goals/:id/entries[/:entryId]` | add or withdraw money (never more than saved) / remove an entry |
| GET / POST | `/api/loans` | loans with balance, interest paid and left, next EMI, payoff date / add (EMI worked out from amount, rate and tenure unless given) |
| PATCH / DELETE | `/api/loans/:id` | change / delete |
| POST / DELETE | `/api/loans/:id/payments[/:paymentId]` | record an EMI or prepayment (`addEntry`, default true, also adds an "EMI & Loans" expense) / remove it and its expense |
| GET | `/api/loans/:id/prepayment?amount=` | what a prepayment saves: keep the EMI and finish sooner, or keep the end date with a lower EMI |
| GET / POST | `/api/debts` | money lent and borrowed, net per person and totals / add |
| PATCH / DELETE | `/api/debts/:id` | change / delete |
| POST / DELETE | `/api/debts/:id/settlements[/:id]` | record a (partial) repayment / remove it |
| GET / POST | `/api/groups` | groups with balances and settle-up suggestions / create (2–50 people, optional UPI IDs) |
| GET / PATCH / DELETE | `/api/groups/:id` | full group with expenses / rename or change people (people with expenses can't be removed) / delete |
| POST / DELETE | `/api/groups/:id/expenses[/:id]` | add (`split: "equal"` among chosen people, or `"exact"` amounts that add up) / remove |
| POST / DELETE | `/api/groups/:id/settlements[/:id]` | "A paid B ₹X" / remove |
| GET / POST | `/api/bills` | bills with next due date and status (overdue, due-soon within 3 days, upcoming) / add (monthly, quarterly, half-yearly or yearly; amount optional for variable bills) |
| GET | `/api/bills/calendar?month=YYYY-MM` | every due date in a month: paid, skipped, overdue, due soon or upcoming |
| PATCH / DELETE | `/api/bills/:id` | change, stop (`active: false`) / delete |
| POST | `/api/bills/:id/pay` · `/skip` · `/undo` | mark the current due date paid (adds the expense) / skip it / undo the last payment or skip |
| GET | `/api/accounts/:id/cycle` | a credit card's last statement (purchases, refunds, balance, due date, paid since, still to pay) and the open cycle; needs `statementDay` and `dueDay` set via `PATCH /api/accounts/:id` |

Loan maths (`src/finance.js`) uses the standard EMI formula and a month-by-month schedule rounded to the paisa, like lenders' amortisation tables. Settle-up pairs the biggest debtor with the biggest creditor, so a group of n people needs at most n − 1 payments. Bill reminders go out once per due date, 3 days or fewer before it, to everyone in the space with bill reminders on (push by default, email optional), checked every `NOTIFY_EVERY_MS`.

### Insights, saved reports and challenges (batch 12F)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/insights/forecast` | this month: spent so far + day-to-day spending at your usual daily rate (last 3 complete months, fixed costs left out) for the days left + recurring entries, bills and EMIs still due; vs last month and the overall budget |
| GET | `/api/insights/unusual?month=` | categories heading for ≥ 1.5× their 3-month average (and ≥ ₹1,000 more), new categories, and single expenses ≥ 3× the category's usual |
| GET | `/api/insights/savings-rate?months=12` | income, spending and % kept per month, average and trend |
| GET | `/api/insights/patterns?from&to` | by weekday (average per day) and time of day (entries with a time), weekend share |
| GET | `/api/insights/compare?aFrom&aTo&bFrom&bTo` | two periods side by side, per category |
| GET | `/api/insights/merchants?from&to` · `/merchants/:name` | spending per merchant / one merchant month by month |
| GET | `/api/insights/subscriptions` | repeating charges (same merchant or note, within 3% in price, about monthly or yearly), next expected date, yearly cost |
| GET | `/api/insights/year?year=` | year in review: totals, savings rate, busiest and lightest month, top categories and merchants, biggest expense, no-spend days |
| GET | `/api/insights/inflation?months=24` | monthly spending as spent and in today's prices, using MoSPI's All India CPI (Combined, General, base 2024=100) |
| GET | `/api/insights/regret?months=3` | "worth it?" ratings: share not worth it, by category and merchant |
| GET | `/api/insights/streaks` · `/achievements` | no-spend and logging streaks / milestones worked out from your entries |
| GET / POST | `/api/challenges` | no-spend challenges (3–30 days, from today or tomorrow, with allowed categories) / start one; status is worked out from entries |
| POST | `/api/challenges/:id/stop` | stop the running challenge |
| GET / POST | `/api/saved-reports` | saved reports / save one (`groupBy`: category, month, merchant, tag, account, paymentMethod, weekday; `period`; `filters`) |
| POST | `/api/saved-reports/preview` | run a report without saving it |
| PUT / DELETE | `/api/saved-reports/:id` | change / delete |
| GET | `/api/saved-reports/:id/run` | run a saved report |

Transactions also take `merchant` (typed by hand) and, for expenses, `worth`: `yes`, `meh`, `no` or null. "Fixed costs" in forecasts, streaks and challenges are entries made by recurring rules or recorded as bill or EMI payments.

**CPI source.** `src/services/cpi.service.js` downloads MoSPI's official figures from `https://api.mospi.gov.in/api/cpi/getCPIData` (free, no key): the Current series from January 2025 and MoSPI's Back series linking 2013–2024 to the same base. They are cached in the `cpiindexes` collection and refreshed at most once a day (`CPI_URL` overrides the address; tests use a local stand-in). MoSPI's server still needs legacy TLS renegotiation, which is allowed for these read-only requests only.

### Tax helper, salary breakdown and cash flow (batch 12G)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/tax/rules?fy=` | the rules for a tax year (`2026-27` default from 1 April 2026, or `2025-26`): law, section names, slabs, rebate, standard deduction, limits, HRA 50% cities, sources |
| GET | `/api/tax/summary?fy&selfSenior&parentsSenior` | expenses tagged `80c`, `80d`, `80d-parents` and `rent` in the financial year (April–March) against each limit |
| POST | `/api/tax/salary` | CTC → gross → taxable income, tax and monthly take-home under the new and old regimes, which is lower and by how much |
| GET | `/api/cashflow?days=60` | cash + bank + wallet balance day by day: recurring income and payments, bills, EMIs, card bills, and usual day-to-day spending; lowest point and first day below zero |
| GET | `/api/cashflow/afford?amount&date` | the same with a purchase added: `yes` (keeps a month of usual spending), `tight` or `no` (goes below zero), and months of saving it would take |

Saved reports and the transaction filters also take `this-fy` and `last-fy`.

**Tax rules (`src/tax.js`).** Tax year 2026-27 follows the Income-tax Act, 2025, in force from 1 April 2026: new-regime slabs in section 202 (nil to ₹4 lakh, then 5/10/15/20/25% per ₹4 lakh, 30% above ₹24 lakh); rebate in section 156 (up to ₹60,000 with marginal relief to ₹12 lakh under the new regime, ₹12,500 up to ₹5 lakh otherwise); standard deduction in section 19 (₹75,000 new, ₹50,000 old); section 123 (was 80C) ₹1,50,000; section 126 (was 80D) ₹25,000 each for self and parents, ₹50,000 for a senior citizen; HRA in Schedule III with the Income-tax Rules, 2026 (50% of salary in Delhi, Mumbai, Kolkata, Chennai, Bengaluru, Hyderabad, Pune and Ahmedabad, 40% elsewhere); old-regime slabs, surcharge (with marginal relief) and 4% cess from the Finance Bill 2026 memorandum; totals rounded to the nearest ₹10 (section 516). 2025-26 uses the same rates under the 1961 Act's sections. Results are estimates, not tax advice. When a Budget changes the rules, a new year is added rather than editing an old one.

**Day-to-day rate.** Forecasts and the cash flow use usual day-to-day spending per day from the last 3 complete months, leaving out fixed costs (recurring entries, bill and EMI payments), lump categories (Rent, EMI & Loans, Insurance, Investments, Bills & Utilities) and single payments of ₹10,000 or more.

### Investments and net worth (batch 12H)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/investments` | every holding with units, price (and where it came from), invested, value, gain, XIRR; totals, split by kind, SIPs a month, what matures in 90 days |
| GET | `/api/investments/schemes?q=` | search AMFI's list of every mutual fund scheme (each word must match, or a scheme code), Direct Growth first, with the latest NAV |
| GET | `/api/investments/timeline?months=12` | month-end net worth: accounts (from entries) + investments − loans, each month marked `snapshot`, `worked-out` or `live` |
| POST | `/api/investments` | add a holding: `mf` (schemeCode), `stock` / `gold` / `other` (name, optional price), `fd` (principal, rate, start, term, compounding), `rd` (monthly, rate, start, term), `ppf` (rate) |
| GET, PATCH, DELETE | `/api/investments/:id` | one holding; change name, note, price, rate or term, or close it |
| POST, DELETE | `/api/investments/:id/trades[/:tradeId]` | a purchase or sale: two of amount, units and price; a fund's price is AMFI's NAV for that day (the next business day on a holiday) when left out; optional `account` records a purchase as an "Investments" expense |
| PUT, DELETE | `/api/investments/:id/sip` | start or change a monthly SIP (amount, first instalment, optional account), or stop it |
| POST, DELETE | `/api/investments/:id/deposits[/:depositId]` | PPF deposits (at most ₹1.5 lakh a financial year) and withdrawals |

**Where the numbers come from.** Mutual fund NAVs come from AMFI (free, no key): the daily `NAVAll.txt` with every scheme (refreshed at most once a day, about 14,000 schemes) and the NAV history report for past days (kept only for schemes people hold). A SIP instalment is bought at its own day's NAV once AMFI publishes it that evening; instalments since a past start date are bought straight away (a few) or in the background (many), and only instalments from the day the SIP was set up are recorded as expenses. FDs use `P × (1 + r/n)^(n × years)` (quarterly by default, or simple interest); RDs compound each instalment quarterly; PPF earns interest each month on the lowest balance between the 5th and the month end, credited on 31 March, and matures on 1 April after 15 full financial years. Stock and gold prices are the ones you enter. XIRR is the yearly return on the dated cash flows and is shown once the first money went in at least 30 days ago. Results are estimates, not investment advice.

**Background jobs.** Hourly: refresh AMFI's list, buy due SIP instalments, and store this month's investment value (the last one in a month stays as that month's snapshot). Every few minutes: FD, RD and PPF maturity reminders a week before (once per maturity date), sent through the bill reminder settings, now called "Bill and maturity reminders".

### Security and trust (batch 12I)

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/auth/login` | with two-factor on, answers `{ twoFactorRequired, challenge }` (a 5-minute token that is never a login) instead of a token |
| POST | `/api/auth/login/2fa` | `{ challenge, code }`: a 6-digit code (each works once) or a backup code; counts towards the failed-login limit, and 10 wrong codes in 15 minutes stop further tries |
| GET | `/api/auth/2fa` | on or off, since when, backup codes left |
| POST | `/api/auth/2fa/setup` · `/enable` · `/disable` · `/backup-codes` | new secret and `otpauth://` link; confirm with a code (returns 10 backup codes, shown once); turn off (password + code); new backup codes (code) |
| GET | `/api/auth/sessions` | signed-in devices: browser and system, IP, signed in, last active, which is this one |
| DELETE | `/api/auth/sessions/:id` | sign that device out (its token stops working at once) |
| POST | `/api/auth/sessions/sign-out-others` | sign out every other device |
| GET, PUT | `/api/auth/lock` | app lock status; turn on or change (password, PIN of 4–8 digits, lock after 1/5/15/30/60 minutes) |
| POST | `/api/auth/lock/disable` · `/lock/now` · `/lock/unlock` | turn off (password); lock this device now; unlock with the PIN (5 wrong PINs sign the device out) |
| POST | `/api/auth/lock/passkeys/options` · `/lock/passkeys` · `DELETE /lock/passkeys/:id` | add a fingerprint (WebAuthn platform passkey, user verification required) or remove one |
| POST | `/api/auth/lock/unlock/options` · `/lock/unlock/passkey` | unlock with the fingerprint |
| GET | `/api/backup` | everything in the space as one JSON file (`format: 1`) |
| POST | `/api/backup/restore` | `{ password, backup }`: replace everything in the space (owner only, up to 20 MB) |

**Two-factor login.** Standard TOTP (RFC 6238: HMAC-SHA1, 6 digits, 30 seconds, one step of clock drift either side), written with Node's own crypto and checked against the RFC's test vectors, so any authenticator app works. The secret is stored encrypted (AES-256-GCM with a key derived from `JWT_SECRET`), backup codes only as keyed hashes. Changing `JWT_SECRET` therefore also breaks existing two-factor set-ups; keep it fixed.

**Devices and the app lock.** Every login token has a session row; signing a device out deletes the row and lists the token as revoked. Tokens issued before this batch get a row the first time they're used. The app lock is enforced by the server, not just the screen: with it on, a device that has been idle longer than the chosen time, or was locked, gets `423 app_locked` for every request except `/api/auth/me`, sign-out and the unlock routes, until the PIN or fingerprint is given. Fingerprints use WebAuthn passkeys tied to the web app's host (`WEBAUTHN_RP_ID`, by default the host of `APP_URL`) and the `CLIENT_ORIGIN` origins.

**New-device emails.** The app sends a random per-browser id (`X-Device-Id`); a login from an id (or, without one, a browser and system) not seen before emails the owner, except for the account's very first device. It can be turned off in Settings (`loginEmail`).

**Backups.** Accounts, entries (not ones in the bin), budgets, weekly budgets, recurring rules, trips, goals, loans, money lent and borrowed, groups, bills, investments, net-worth snapshots, saved reports, challenges and import rules. Restoring gives every record a new id and rewrites the links between them, so a backup can go into another account too. Every record is validated before anything is removed, and if saving fails part-way the space is put back as it was. Receipt photos aren't in backups; restored entries keep a photo only if it is still stored for that space. The activity log keeps a "restored a backup" line.

### Integrations (batch 12J)

| Method | Path | Purpose |
| --- | --- | --- |
| GET, POST | `/api/integrations/tokens` | your personal API tokens; make one (`name`, `scope` `read` or `write`, `expiresInDays`): the token (`sw_…`) is in the answer once |
| DELETE | `/api/integrations/tokens/:id` | revoke |
| GET, POST | `/api/integrations/webhooks` | webhooks of the space; add one (`url`, `events`): the signing secret (`whsec_…`) is in the answer once |
| PATCH, DELETE | `/api/integrations/webhooks/:id` | change the address or events, switch on or off; delete |
| POST | `/api/integrations/webhooks/:id/secret` · `/test` | a new signing secret; send a `ping` now |
| GET | `/api/integrations/webhooks/:id/deliveries` | the last 30 attempts: event, try, status, error, time |
| GET, DELETE | `/api/integrations/google` | Google Sheets status (account, sheet link, last sync, error); disconnect (revokes Google's permission; the sheet stays in Drive) |
| POST | `/api/integrations/google/start` · `/google/sync` | the Google consent address to send the browser to; sync now |
| GET | `/api/integrations/google/callback` | where Google sends the browser back (public; checked with a signed 10-minute `state`) |
| GET | `/api/integrations/telegram` | the bot's name and your linked chats |
| POST | `/api/integrations/telegram/link` | a one-time code (15 minutes) and its `https://t.me/<bot>?start=<code>` link |
| PATCH, DELETE | `/api/integrations/telegram/:id` | daily summary on or off and its time; unlink |
| POST | `/api/integrations/telegram/webhook` | Telegram's updates after deploying (public; needs Telegram's secret header) |

**API tokens (the public API).** Send `Authorization: Bearer sw_…` to any data endpoint above (transactions, stats, budgets, accounts, goals, bills, investments, insights…). A token belongs to one person and one space (`X-Space-Id` is ignored), only its SHA-256 is stored, read-only tokens can only `GET`, and tokens can't reach `/api/auth`, `/api/backup`, `/api/integrations`, `/api/spaces`, `/api/invites` or `/api/notifications`. 120 requests a minute per token.

**Webhooks.** Events: `transaction.created`, `.updated`, `.deleted`, `.restored` (the entry), `transactions.imported` and `transactions.recurring` (counts), `budget.alert` (budget, level, spent, limit), and `ping` from "Send test". The body is `{ id, event, createdAt, spaceId, data }`; headers `X-Spendwise-Event`, `X-Spendwise-Delivery`, `X-Spendwise-Timestamp` and `X-Spendwise-Signature: sha256=<HMAC-SHA256 of "{timestamp}.{body}" with the secret>`. Retries after 30 seconds and 5 minutes; 20 failures in a row switch the webhook off. In production only public `https://` addresses are allowed (no localhost, private or link-local addresses, checked again at each delivery); `WEBHOOKS_ALLOW_PRIVATE=true` allows them, and it is the default outside production.

**Google Sheets.** OAuth with the scopes `openid email https://www.googleapis.com/auth/drive.file`: Spendwise can only open files it created. It makes "Spendwise – Personal" (or the shared space's name) with two tabs, *Transactions* (date, type, amount, category, account, to account, payment method, merchant, note, tags, added by, entry id) and *Monthly* (income, expenses, net, entries), written as plain values so nothing in a note can become a formula. It syncs 20 seconds after the last change in a burst, hourly as a catch-up, and on "Sync now"; a sheet deleted in Drive is made again. The refresh token is stored encrypted (AES-256-GCM, key from `JWT_SECRET`). Set up: a Google Cloud OAuth client (Web application) with the redirect URI `<API_URL>/api/integrations/google/callback`, the Sheets and Drive APIs enabled, and the consent screen in *Testing* with your Google accounts as test users. `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `API_URL` (default `http://localhost:8730`).

**Telegram.** `TELEGRAM_BOT_TOKEN` from @BotFather. On start the server sets the bot's command menu and, without `TELEGRAM_WEBHOOK_URL`, asks Telegram for new messages itself (long polling, one server at a time); with `TELEGRAM_WEBHOOK_URL` set to the API's public address, Telegram calls the webhook route with a secret header instead. Messages are read with the same quick-add parser as the app (a copy in `server/src/quickAdd.js`, checked by a test to match the client's): "add 200 chai", "450 swiggy dinner yesterday upi", "got 50000 salary", plus /today, /summary, /undo (moves the entry to the bin), /help and /unlink. Only private chats that were linked with a code are answered. The daily summary goes out at the chosen India time; a chat that blocks the bot is unlinked.

### Tax data: capital gains, EPF and NPS, interest and TDS, rent receipts (batch 12M)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/tax/capital-gains?fy=&slabPct=` | gains on fund, stock and gold sales in a tax year (`2025-26` or `2026-27`), lot by lot, with set-off, the ₹1.25 lakh exemption, a tax estimate (slab-rate gains only when `slabPct` is given) and warnings |
| GET | `/api/tax/interest?fy=` | Interest-category income entries, what cumulative FDs and RDs earned in the year, and all TDS (from income entries and the register) |
| POST, PATCH, DELETE | `/api/tax/tds`, `/api/tax/tds/:id` | the TDS register (`date`, `deductor`, `kind` interest/salary/rent/professional/other, `income`, `tds`, `note`) |
| GET, PUT | `/api/tax/rent-profile` | your name and the landlord's name, PAN (`ABCDE1234F`) and the property's address, per person per space |
| GET | `/api/tax/rent-receipts?fy=` · `/rent-receipts.pdf?fy=` | rent paid month by month (Rent category or #rent / #hra) and whether the PAN is needed; the receipts as a PDF (409 without details, 404 with no rent, 400 `pan_required` over ₹1,00,000 without a PAN) |
| POST, DELETE | `/api/investments/:id/passbook`, `/passbook/:entryId` | EPF passbook balances |

Transactions take `tds` (rupees, income only, not more than the amount) and return `tdsPaise`. Holdings take `taxClass` (`equity`, `debt`, `listed`, `other` or `null`) and `fmv2018` (rupees per unit on 31 January 2018), and return `category` (AMFI's) and `defaultTaxClass`. New kinds: `epf` (contributions as deposits, plus passbook balances) and `nps` (units at the NAV you enter). New built-in income category: Interest. The Tax helper's rent card now counts the Rent category as well as #rent / #hra tags.

**Capital gains** (`src/capitalGains.js`). Sales are matched to purchases first in, first out. The class decides the rules: `equity` (shares and equity-oriented funds) is long-term after 12 months, 20% short-term (section 196 / was 111A), 12.5% long-term above ₹1,25,000 (section 198 / 112A); `debt` (a Specified Mutual Fund) bought from 1 April 2023 is always short-term at your slab rate (section 76 / 50AA), older units follow `other`; `listed` is long-term after 12 months, `other` after 24, both 12.5% long-term (section 197 / 112) and slab rate short-term (holding periods: section 2(101) / 2(42A)). Equity bought before 1 February 2018 costs the higher of what was paid and the lower of its 31 January 2018 value and the sale price (section 90(7) / 55(2)(ac)); funds use AMFI's NAV for that day. Short-term losses are set off against any gains, long-term ones only against long-term gains, and what's left is reported to carry forward. Default classes come from AMFI's category headings, now stored on every scheme; mixed funds (balanced advantage, multi-asset, fund of funds) are left for you to choose. Rules were checked against the Income-tax Act, 2025 and the Finance Bill 2026 memorandum; 2025-26 uses the 1961 Act's section numbers. Not covered: years before 2025-26, surcharge, losses carried in, bonus issues and splits, gold bonds held to maturity.

**EPF** (`epfValue` in `src/invest.js`): the last passbook balance plus contributions since, with interest on each month's opening balance credited at the end of March, at EPFO's declared rate (8.25% for 2023-24 to 2025-26; later years use the latest until one is declared, and say so). EPFO has no free public API, so balances come from your passbook. **NPS**: no free official NAV file was found (NPS Trust's site only has an internal chart endpoint), so NAVs are entered by you.

**Rent receipts** (`services/taxRecords.service.js`): one per month of rent paid, two to an A4 page, with the amount in words, payment dates and methods, the landlord's name and PAN, a signature line, and a revenue-stamp box for cash over ₹5,000. In English.

### Envelopes, sinking funds and the wishlist (batch 12O)

| Method | Path | Purpose |
| --- | --- | --- |
| GET, PUT, DELETE | `/api/envelopes?month=YYYY-MM` | the month's envelopes (`income` optional, `envelopes: [{ name, categories, amount }]`, a category in one envelope only), with spent and left per envelope from real entries, what is still to share out, and spending outside any envelope |
| POST | `/api/envelopes/copy?month=` | start a month with last month's envelopes (409 if it has some, 404 if last month has none) |
| GET, POST, PATCH, DELETE | `/api/sinking-funds`, `/:id` | big repeating costs (`name`, `amount`, `nextDue`, `everyMonths`, `category`) with what to put aside each month |
| POST | `/api/sinking-funds/:id/contributions` · `/:id/paid` | put money aside or take it out; mark as paid (an expense if `account` is given; the due date moves on and anything left over carries on) |
| GET, POST, PATCH, DELETE | `/api/wishlist`, `/:id` | things you want (`name`, `price`, `url`, `note`, `coolDays`, default 30) |
| POST | `/api/wishlist/:id/decide` | `bought` (409 `still_cooling_off` before the wait ends unless `early: true`; an expense if `account` is given) or `dropped` |

### Vehicles, the vault, card rewards and FIRE (batch 12P)

| Method | Path | Purpose |
| --- | --- | --- |
| GET, POST, PATCH, DELETE | `/api/vehicles`, `/:id` | vehicles (`kind`, `fuel`, `service: { everyKm, everyMonths, lastKm, lastDate }`) with mileage between full tanks, cost per km and when the next service is due |
| POST, DELETE | `/api/vehicles/:id/fills`, `/fills/:fillId` | fill-ups (`date`, `odometerKm`, `quantity`, `amount`, `fullTank`; a Fuel expense if `account` is given; the odometer can't go backwards) |
| POST | `/api/vehicles/:id/serviced` | serviced on a day and reading (today and the last reading by default) |
| GET, POST, PATCH, DELETE | `/api/vault`, `/:id` | warranties and policies (`kind`, `name`, `provider`, `number`, `purchaseDate`, `expiryDate`, `amount`, `sumInsured`, `nominee`, `note`, `transactionId` for the receipt) |
| GET | `/api/card-rewards?months=12` | what each credit card earned on what was spent with it, and the best card per category |
| PUT, DELETE | `/api/card-rewards/:accountId` | a card's rates: `cashback` (% back) or `points` (per ₹100, with `pointValue` in rupees), plus per-category `rules` |
| GET | `/api/fire?annualSpend=&annualSaving=&corpus=&returnPct=&inflationPct=&withdrawalPct=` | the FIRE number (spending ÷ withdrawal rate) and the years to reach it, in today's money; inputs default to the last 12 complete months and the investments' value, assumptions to 10 / 6 / 4% |

Reminders: warranties and policies 30 and 7 days before they end, and a vehicle when its service is due within 500 km or 14 days, once each (bill reminder settings).

### Receipt scanning, sharing and offline entries (batch 12Q)

`POST /api/transactions` takes `clientRef` (8–64 letters, digits, `-` or `_`): sending the same one again returns the entry already saved instead of adding it twice (unique per space). Receipt photos are read in the browser with Tesseract.js (Apache-2.0; its engine and English model, about 10 MB, download once from jsDelivr and are cached), and `client/src/lib/receiptText.js` picks the grand total, the date and the shop for the add form; nothing is saved without you. The manifest has a **share target** (POST `/share`, multipart: text and a photo), handled by the service worker, which keeps the shared item until the `/share` page reads it, and **shortcuts** to `/?add=expense` and `/?add=income`. New entries that can't reach the server wait in IndexedDB (`spendwise-offline`) and are sent, in the space they were added in, when the app opens or comes back online.

### Roles, private accounts and approvals (batch 12R)

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/spaces/:id/invites` | now takes `role`: `editor` (default), `viewer` or `child` |
| PATCH | `/api/spaces/:id/members/:userId` | owner only: `role`, and `pocketMoney` (rupees a month, or `null`) for a child |
| PATCH | `/api/spaces/:id/settings` | owner only: `approvalAbove` (rupees, or `null` to turn approval off) |
| PATCH | `/api/accounts/:id` | now takes `private`: in a shared space, the person who added an account can keep it and its entries to themselves |
| GET | `/api/approvals` | expenses waiting for the owner |
| POST | `/api/approvals/:id` | owner only: `decision` `approve` or `reject` (rejected entries are deleted and can't be restored) |

Roles are checked in `requireSpace`: viewers can only read (403 `read_only_member`), children can only add expenses and their receipt photos (403 `child_member`) and are stopped at the month's pocket money (409 `pocket_money_exceeded`). Earlier `member` roles become `editor` at start-up. Private accounts and waiting entries are left out of every query by Mongoose hooks (`src/access.js`) that know who is asking through AsyncLocalStorage, so lists, totals, budgets, charts, exports, insights and the activity log all agree. An expense by anyone but the owner above `approvalAbovePaise` is saved with `pending: true` and the owner is notified. Not covered: background jobs (reminders, the Telegram bot) still see every account in a space.

### Calendar feed (batch 12S)

| Method | Path | Purpose |
| --- | --- | --- |
| GET, POST, DELETE | `/api/integrations/calendar` | whether you have a private calendar address; make a new one (shown once; the old one stops working); turn it off. One per person per space |
| GET | `/api/integrations/calendar/download` | the same calendar as a `.ics` file |
| GET | `/api/calendar/<secret>.ics` | public, for calendar apps: bills, EMIs, SIPs, credit card due dates, FD / RD / PPF maturities, warranty and policy dates and sinking-fund due dates, a month back to a year ahead, all-day with a reminder at 9 am the day before (RFC 5545; 30 requests a minute) |

Text size (normal, large, larger) and high contrast are kept on the device (`spendwise.textSize`, `spendwise.contrast`) and applied before the app loads.

### Hindi and voice entry (batch 12K)

| Method | Path | Purpose |
| --- | --- | --- |
| PATCH | `/api/auth/me` | now takes `name`, `language` (`en` or `hi`) or both; `user.language` is returned everywhere the user is |

**Languages.** The app's text goes through `client/src/lib/i18n.js`: `t(text, vars)`, `tn(n, one, many, vars)` for counts, `tr(text, vars, tags)` for text with bold or links inside, and `k(text)` to mark text that is translated later through a variable. The English text is the key; Hindi lives in `client/src/lib/locales/hi/*.js`. A test scans the source and fails if any text has no Hindi, or if the `{placeholders}` and `<tags>` differ between the two. The choice is kept on the device (`localStorage` `spendwise.lang`; switching reloads the page) and on the account, so a new device starts in your language and the Telegram bot answers in it (`server/src/botText.js`). Dates use the `hi-IN` format; the Devanagari font is Noto Sans Devanagari (OFL, bundled). Entries are always stored in English (built-in category names are translated only on screen). Not translated: the server's error messages and emails, Activity lines (written in English when each change is made), tax-law names and sources, the device names on the sign-in list, and the Google Sheet's column headings.

**Voice entry.** The mic button by Quick add and in the command palette uses the browser's speech recognition (`SpeechRecognition`, in Chrome and Edge; Chrome sends the audio to Google's speech service), in `hi-IN` or `en-IN` to match the app. What you say goes through the quick-add parser and opens the add form for checking. The button doesn't appear in browsers without speech recognition (Firefox). The parser reads Hindi too: Devanagari digits, आज / कल (yesterday, since an entry can't be in the future) / परसों and weekdays, Hindi words for categories, income, payment methods and rupees, a few Hinglish words (khana, sabzi, dawai…), with the nukta ignored so either spelling matches.
