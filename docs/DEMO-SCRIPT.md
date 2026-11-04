# Spendwise demo script (for the video)

Follow this in order and every feature gets shown once. Each step says **where to click** and **what to type**.
All example values are made up; use them as they are, or change them.

- **Site:** https://spendwise-tau-ruddy.vercel.app
- **Sample files:** [`docs/demo/sample-statement.csv`](demo/sample-statement.csv) (a bank statement to import) and
  [`docs/demo/sample-receipt.png`](demo/sample-receipt.png) (a shop receipt to scan). Download both before recording.
- **Length:** about 25–35 minutes if you show everything; skip parts marked *(optional)* for a shorter video.

## Before you record

1. **Wake the server.** Open https://spendwise-api-ur0f.onrender.com/api/health and wait until it shows `"ok":true`
   (up to a minute if it was asleep). Then open the site.
2. **Use a fresh demo account**, so the video starts from zero and your real data stays private. Gmail delivers
   `yourname+demo@gmail.com` to your normal inbox, so you can sign up with that and still get the confirmation email.
3. Use **Chrome on a computer** (voice input and fingerprint unlock need Chrome). Keep your **phone** nearby for Telegram,
   the phone layout and installing the app.
4. Close other tabs and turn off notifications from other apps, so nothing pops up on screen.

---

## Part 1: First look and sign-up (2 min)

| # | Where | What to do | What it shows |
|---|---|---|---|
| 1.1 | Landing page `/` | Scroll slowly: headline, features, "Private by design", footer links | The public front page |
| 1.2 | Footer | Click **Privacy**, scroll, go back; click **Terms** | Plain-English legal pages |
| 1.3 | Top | Click **Create a free account** | Sign-up form with the Terms/Privacy consent line |
| 1.4 | Sign-up form | Name `Riya Sharma`, Email `yourname+demo@gmail.com`, Password `DemoVideo2026` → **Create account** | You land on the dashboard |
| 1.5 | Dashboard | Point at the yellow **Confirm your email** banner and the **Get started** checklist (0 of 4 done) | First-run guidance |
| 1.6 | Your inbox | Open "Confirm your email for Spendwise" → click **Confirm my email** | "Email confirmed"; the banner disappears |
| 1.7 | *(optional)* | Log out (bottom-left), click **Log in** → **Forgot password?**, enter the email → **Send reset link** | "Check your inbox"; the reset link works once, for 30 minutes |

---

## Part 2: Accounts (2 min) — sidebar **Accounts**

| # | What to do | What it shows |
|---|---|---|
| 2.1 | **Add account** → Name `HDFC Savings`, Type **Bank account**, Opening balance (₹) `85000` → **Add account** | A bank account with its balance |
| 2.2 | **Add account** → Name `ICICI Amazon Pay`, Type **Credit card** → **Add account** | A credit card |
| 2.3 | **Add account** → Name `Paytm`, Type **Wallet**, Opening balance (₹) `2000` → **Add account** | A wallet |
| 2.4 | On HDFC Savings, open the **⋯** menu → **Make default** | New entries use this account |
| 2.5 | Under **Credit card cycles**, on ICICI Amazon Pay → **Change days** → Statement day `12`, Payment due day `2` → **Save** | Statement cycle and due date |
| 2.6 | Point at **Net worth**, Assets and Owed at the top | Everything you own minus what you owe |

The **Get started** checklist on the dashboard now shows "Add your bank account or card" ticked.

---

## Part 3: Adding money (4 min)

| # | Where | What to do | What it shows |
|---|---|---|---|
| 3.1 | Anywhere | Press **I** (income) → Amount `92000`, Category `Salary` → **Add** | Keyboard shortcut + income |
| 3.2 | Anywhere | Press **N** (expense) → Amount `22000`, Category `Rent`, Paid with **UPI** → **Add** | An expense |
| 3.3 | Press **N** | Amount `2450`, Category `Groceries`; click **Split across categories**: Groceries `1950` + Household `500`; Tags `home` → **Add** | One bill split into two categories, with a tag |
| 3.4 | Press **N** | Amount `3000`, Category `Fuel`, Paid from **ICICI Amazon Pay**, Paid with **Card** → **Add** | Spending on the credit card |
| 3.5 | Press **T** (transfer) | Amount `8000`, from **HDFC Savings** to **ICICI Amazon Pay**, Note `Card bill` → **Add** | Paying the card bill moves money, it isn't spending |
| 3.6 | Press **N** → **More** | Amount `12.50`, Currency **USD**, Category `Shopping`, Note `App Store` → **Add** | Foreign currency converted to ₹ at the day's rate |
| 3.7 | Press **N** | Click **Scan a receipt** → choose `sample-receipt.png` → wait for it to read **₹1,250**, 28 Oct 2026, Fresh Mart → Category `Groceries` → **Add** | Receipt reading in the browser; the photo stays attached |
| 3.8 | Dashboard quick-add box | Type `450 swiggy dinner yesterday upi` → Enter → check the filled form → **Add** | Plain-text entry |
| 3.9 | Quick-add box | Click the **microphone**, allow the mic, say "two hundred chai today cash" → **Add** | Voice entry (Chrome) |
| 3.10 | Anywhere | Press **Ctrl+K** → type `250 auto` → pick the quick-add row → **Add** | The command palette also adds entries |
| 3.11 | Anywhere | Press **?** to show all shortcuts, **Esc** to close; press **P** to blur amounts (privacy mode), **P** again | Shortcuts and privacy mode |

---

## Part 4: Transactions (2 min) — sidebar **Transactions**

| # | What to do | What it shows |
|---|---|---|
| 4.1 | Scroll the list: entries grouped by day, with account and payment method | The full history |
| 4.2 | Search box: `swiggy` | Instant search |
| 4.3 | **Filters** → Category **Groceries** → then clear; date menu → **Last month** → back to **This month** | Filters (kept in the address bar) |
| 4.4 | Click **CSV**, then **PDF** | Exports of exactly what's shown |
| 4.5 | Click an entry → change the amount → **Save** | Editing |
| 4.6 | Delete the `250 auto` entry → click **Undo** in the message | Deleted entries can be brought back for 30 days |

---

## Part 5: Budgets (3 min) — sidebar **Budgets**

| # | What to do | What it shows |
|---|---|---|
| 5.1 | **Add budget** → Category `Food & Dining`, Monthly limit `6000` → **Save** | A category budget with a progress bar |
| 5.2 | **Add budget** → Category `Groceries`, Monthly limit `5000` → **Save** | Status: on track / close to limit / over |
| 5.3 | **Add budget** → leave the category empty (overall), limit `45000` → **Save** | An overall monthly limit |
| 5.4 | Point at **Spent without a budget** (Rent, Fuel…) and **Last 6 months** | Gaps and history |
| 5.5 | **Add weekly budget** → Category `Food & Dining`, Weekly limit (₹) `1500` → **Save weekly budget** | A limit that resets every Monday |
| 5.6 | Tab **Envelopes** → share out this month's money (for example `60000`) and give each envelope an amount: Rent `22000`, Groceries `5000`, Food & Dining `6000`, the rest to savings → **Save** | Envelope budgeting: every rupee gets a job |
| 5.7 | Tab **Sinking funds** → **Add sinking fund**: What it's for `Car insurance`, Cost `14400`, Comes round every (months) `12` → **Save** → **Put aside** `1200` | Saving up for a yearly cost |

---

## Part 6: Recurring entries and bills (2 min)

| # | Where | What to do | What it shows |
|---|---|---|---|
| 6.1 | **Recurring** | **New rule** → Expense, Amount `649`, Category `Entertainment`, Repeats **Monthly**, Note `Netflix` → **Save** | Added automatically on its date; **Next 30 days** preview |
| 6.2 | **Bills** | **Add bill** → Bill `Electricity`, Amount `1800`, Category **Bills & Utilities**, How often **Monthly**, Next due date: the 5th of next month → **Add bill** | A bill on the calendar, reminder 3 days before |
| 6.3 | **Bills** | **Add bill** → Bill `Car insurance`, Amount `14400`, Category **Insurance**, How often **Yearly** → **Add bill** | Yearly bills too |
| 6.4 | **Bills** | On Electricity → **Mark as paid** → **Mark as paid** | Paying records the expense; also **Skip**, **Edit**, **Stop** |

Bills need a category (the form says "Pick a category"), so don't skip it.

---

## Part 7: Goals and wishlist (2 min) — sidebar **Goals**

| # | What to do | What it shows |
|---|---|---|
| 7.1 | **New goal** → Name `Emergency fund`, Target `300000`, Target date: a year from today → **Save** | Monthly amount needed to get there |
| 7.2 | **Add money** → `10000` → **Add money**; then **Take out** `2000` | The progress ring moves |
| 7.3 | Tab **Wishlist** → **Add to wishlist**: Item `Noise-cancelling headphones`, Price `15000`, Wait before buying `30` days → **Save** | A cooling-off period before buying |
| 7.4 | On the headphones card, under the price, click the **Can I afford it?** button (next to **Buy** and **Don't need it**) | Opens Plan → Can I afford it? with ₹15,000 filled in and the answer already shown |

---

## Part 8: Loans, money lent and groups (3 min)

| # | Where | What to do | What it shows |
|---|---|---|---|
| 8.1 | **Loans & debts** | **Add loan** → Name `Personal loan`, Lender `Bajaj Finance`, Loan amount `500000`, Interest rate `10.5`, Tenure `60` → **Add loan** | EMI, interest and what's left |
| 8.2 | Same | **Pay EMI** → **Pay EMI** | Records the EMI as an expense |
| 8.3 | Same | **What if I prepay?** → If I prepay `50000` | Months and interest saved |
| 8.4 | Tab **Lent & borrowed** | **Add** → **I lent money**, To whom `Rohan`, Amount `2000`, Note `Concert tickets` → **Save** → then **Record repayment** `1000` | Money owed to you |
| 8.5 | **Groups** | **New group** → Group name `Goa trip`, People: `Riya` (you) and `Aman` → **Create group** | A group needs at least 2 people |
| 8.6 | In the group | **Add expense** → What for `Villa`, Amount `6000`, Paid by **Riya** → **Add expense**; add `Dinner` `1800` paid by **Aman** | Shared expenses |
| 8.7 | Same | **Settle up** | Fewest payments to settle, with UPI pay links |

---

## Part 9: Trips, vehicles and the vault (3 min)

| # | Where | What to do | What it shows |
|---|---|---|---|
| 9.1 | **Trips** | Trip name `Goa`, Budget `20000` → **Start trip** | Every new entry is tagged `#trip-goa` |
| 9.2 | Anywhere | Press **N** → `1200` `Food & Dining` → **Add** (note the trip tag) | Trip mode in action |
| 9.3 | **Trips** | Show **Summary so far** → **End trip** | Trip total against its budget |
| 9.4 | **Vehicles** | **Add vehicle** → Name `Activa`, Type **Scooter**, Runs on **Petrol** → **Save** | A vehicle |
| 9.5 | Same | **Fill-up** → Odometer `12400`, Amount paid `500` → **Add fill-up**; again with Odometer `12650`, Amount `520` | Real mileage and cost per km |
| 9.6 | Same | **Serviced today** | Service reminder resets |
| 9.7 | **Vault** | **Warranty** → Product `Samsung TV`, Brand or shop `Croma`, Warranty ends: two years from today, Price `42000` → **Add** | Warranty with reminders 30 and 7 days before it ends (the end date is required) |
| 9.8 | **Vault** | **Policy** → Policy `Family health cover`, Insurer `Star Health`, Renewal date: next year, Premium `18500` → **Add** | Insurance policies too |

---

## Part 10: Investments and net worth (3 min) — sidebar **Investments**

| # | What to do | What it shows |
|---|---|---|
**Use dates in the past.** Something bought today shows a gain of ₹0 and no XIRR, because XIRR appears only once the
first money went in at least 30 days ago. Backdated entries give real gains, because every mutual fund price comes
from AMFI's official NAV for that day. Also, never pick today's date for a fund: AMFI publishes today's NAV only in
the evening.

| # | What to do | What it shows |
|---|---|---|
| 10.1 | **Add investment** → What is it? **Mutual fund** → Fund: type `Parag Parikh Flexi Cap` and pick **Direct Plan - Growth** → **Save** | Real fund prices from AMFI |
| 10.2 | On the fund → **Buy** → Date `05-05-2026`, Amount `10000`; leave Units and NAV empty → **Record purchase** | Units bought at 5 May's official NAV, with a real gain and XIRR today |
| 10.3 | On the fund → **Start SIP** (or **Change SIP**) → Amount a month `5000`, First instalment `05-06-2026` → **Save SIP** | It buys every past instalment (June to October) at each day's NAV, then shows "5 instalments bought. Next on 5 Nov" |
| 10.4 | **Add investment** → **Mutual fund** → `UTI Nifty 50 Index Fund` → **Direct Plan - Growth** → **Save** → **Buy**: Date `01-01-2026`, Amount `20000` | A second fund, bought at the start of the year |
| 10.5 | **Add investment** → **Fixed deposit** → Name `SBI FD`, Amount `150000`, Interest rate `7.1`, Start date `20-11-2025`, Term `12` months → **Save** | Interest earned so far, the value at maturity, and it appears under **Maturing soon** (it matures on 20 Nov 2026) |
| 10.6 | **Add investment** → **PPF** → Name `PPF - SBI`, Interest rate `7.1` → **Save** → **Deposit** `50000`, Date `10-04-2026` | Interest earned this year, and the bar for ₹50,000 of the ₹1,50,000 yearly limit |
| 10.7 | *(optional)* **Add investment** → **Stock** → Name `Infosys` → **Buy**: Date `02-03-2026`, Units `10`, Price per unit: Infosys's closing price on that day (look it up on NSE or Google) → then **Update price** with today's price | Stocks use prices you enter, and the gain follows from them |
| 10.8 | Point at Current value, Invested, Gain, **XIRR**, **Where it is** (Mutual funds, Fixed deposits, PPF), **Maturing soon**; then the **Net worth** tab | The whole portfolio, and net worth month by month |

For 10.7, type real prices only, so the demo shows true figures. If you don't want to look one up, skip stocks.

**If you already bought the fund with today's or yesterday's date:** click **History** on the fund card, delete that
purchase with the bin icon, and buy again with the May date.

**What to say:** *"Every mutual fund price comes from AMFI's official daily NAV, so I just enter the amount and date.
The SIP started in June, so Spendwise bought each month's instalment at that day's real NAV. XIRR is the yearly return
that takes into account when each rupee went in. The FD matures this month, so it's under Maturing soon, and I'll get
a reminder a week before."*

---

## Part 11: Tax and planning (3 min) — sidebar **Tax & planning**

| # | Tab | What to do | What it shows |
|---|---|---|---|
| 11.1 | **Tax helper** | Point at the limits (80C, health insurance, rent). Then press **N** → `25000` `Insurance`, Tags `80d` → back here | Tagged entries count toward tax limits |
| 11.2 | **Tax helper** | **Rent receipts** → fill in the landlord's name and address → download | Printable HRA rent receipts |
| 11.3 | **Capital gains** | Show the fund from Part 10 | Short and long-term gains under current rules |
| 11.4 | **Interest & TDS** | **Add TDS** → an amount such as `1200` | Interest income and tax already deducted |
| 11.5 | **Salary** | CTC a year `1500000`, Basic `40`, Rent paid a year `264000`, City **Mumbai** → **Work it out** | Take-home pay and tax under the old and new regimes |
| 11.6 | **Cash flow** | Scroll the 60-day chart and **Coming up** | Bills, EMIs and card dues ahead |
| 11.7 | **Can I afford it?** | Price `45000`, When: next week → **Check** | Whether the purchase fits, day by day |
| 11.8 | **FIRE** | Leave the numbers from your data → **Work it out** | Your financial-independence number and year |

---

## Part 12: Insights (2 min) — sidebar **Insights**

| # | Tab | What to show |
|---|---|---|
| 12.1 | **Overview** | Month forecast, unusual spending, savings rate, subscriptions found, spending in today's prices, streaks, achievements; start a **7-day no-spend challenge** |
| 12.2 | **Patterns** | Spending by weekday and the year heatmap (switch 30 days / 90 days / 1 year) |
| 12.3 | **Merchants** | Top merchants; click Swiggy for its history |
| 12.4 | **Compare** | This month vs last |
| 12.5 | **Year in review** | The year in one page |
| 12.6 | **Reports** | Save a report, e.g. "Food this year" |

---

## Part 13: Import a bank statement (2 min) — sidebar **Import**

| # | What to do | What it shows |
|---|---|---|
| 13.1 | Import into **HDFC Savings** → **Choose file** → `sample-statement.csv` | 12 lines found |
| 13.2 | Check the guessed columns (Date, Narration, Debit, Credit) → **Preview 12 lines** | Merchants read from UPI/NEFT text, categories suggested, duplicates flagged |
| 13.3 | Change one category, untick a line → import | Entries added in one go |
| 13.4 | Under **Past imports** → **Undo** | A whole import can be reversed |
| 13.5 | **Category rules** → Narration contains `swiggy` → Category `Food & Dining` → **Add rule** | Rules for future imports |

---

## Part 14: Shared household (2 min) — sidebar **Household**

| # | What to do | What it shows |
|---|---|---|
| 14.1 | New shared space `Flat 302` → **Create** | A space shared with others |
| 14.2 | Invite by email: a second address of yours, As **Editor** → **Send invite** | The invite email arrives (the invitee must confirm their email to accept) |
| 14.3 | Set "Expenses above this need your approval" `5000` → **Save** | Approvals for big expenses (see **Approvals** in the sidebar) |
| 14.4 | Switch spaces with the space menu at the top of the sidebar | Personal and shared data stay separate |
| 14.5 | **Activity** (sidebar) → pick a change → **Undo** | Every change is logged and reversible |

Switch back to your personal space before Part 15.

---

## Part 15: Integrations (3 min) — sidebar **Integrations**

| # | What to do | What it shows |
|---|---|---|
| 15.1 | **Calendar** → **Make a calendar address** → **Copy**, or **Download .ics** | Bills and maturities in Google Calendar or Outlook |
| 15.2 | **Google Sheets** → **Connect Google Sheets** → sign in → **Open the sheet** | A live Google Sheet of your entries (Google may show an "unverified app" screen: Advanced → continue) |
| 15.3 | **Telegram** → **Link Telegram** → on your phone send the code to the bot, then send `add 200 chai` | The entry appears in the app; try `/today` and `/summary` |
| 15.4 | **API tokens** → Name `Demo`, Can **Read only** → **Make token** | Tokens for your own scripts |
| 15.5 | **Webhooks** → Address `https://example.com/hooks/spendwise` → **Add webhook** → **Send test** | Signed webhooks |

---

## Part 16: Settings, security and accessibility (3 min) — sidebar **Settings**

| # | What to do | What it shows |
|---|---|---|
| 16.1 | **Language** → हिन्दी, show the dashboard in Hindi, switch back to English | Full Hindi interface |
| 16.2 | **Theme**: Light → Dark → System | Dark mode |
| 16.3 | **Text size**: Larger → Normal; **High contrast** on → off | Accessibility settings |
| 16.4 | **Big numbers**: Million → Lakh / crore | ₹1.2M vs ₹12 lakh |
| 16.5 | **Notifications in this browser** → allow → **Send a test notification** | A real push notification |
| 16.6 | **Monthly email report** → **Preview**, then **Email it to me now** | The report email in your inbox |
| 16.7 | **Two-factor login** → **Set up two-factor login** → scan the QR with Google Authenticator → enter the code | Two-step login and backup codes |
| 16.8 | **App lock** → **Turn on app lock**, PIN `1234` → **Lock now** → unlock with the PIN (or **Add fingerprint on this device**) | PIN or fingerprint lock |
| 16.9 | **Signed-in devices** | Every session, with sign-out |
| 16.10 | **Backup** → **Download backup** | Full export of your data |

---

## Part 17: Phone, install and offline (2 min, on your phone)

| # | What to do | What it shows |
|---|---|---|
| 17.1 | Open the site on your phone and log in | Bottom tab bar, the round **+** button, **More** menu |
| 17.2 | Chrome menu → **Install app** (or Add to Home screen) | Opens like a normal app |
| 17.3 | Turn on airplane mode → add `100 tea` → turn airplane mode off | The entry is queued offline and sent when back online |
| 17.4 | *(Android, optional)* In WhatsApp, share a payment message to Spendwise | Shared text opens the add form |

---

## Wrap-up (1 min)

Back to the **Dashboard**: the Get started checklist is complete, and every chart now has data. Log out to show the
landing page again.

## Checklist: every feature in this script

- [ ] Landing, privacy, terms, sign-up, email confirmation, forgot password
- [ ] Accounts (bank, card, wallet), default account, card cycle, net worth
- [ ] Income, expense, split, tags, transfer, foreign currency, receipt scan, quick add, voice, palette, shortcuts, privacy mode
- [ ] Transactions: search, filters, CSV, PDF, edit, delete and undo
- [ ] Budgets: category, overall, weekly, envelopes, sinking funds
- [ ] Recurring rules, bills calendar, mark as paid
- [ ] Goals, add/take money, wishlist, "Can I afford it?"
- [ ] Loans, EMI, prepayment, lent and borrowed, groups and settle up
- [ ] Trips, vehicles and fill-ups, warranty and insurance vault
- [ ] Mutual fund, SIP, FD, PPF, gold, XIRR, net worth history
- [ ] Tax helper, rent receipts, capital gains, TDS, salary, cash flow, afford, FIRE
- [ ] Insights: overview, patterns, merchants, compare, year in review, reports, challenge
- [ ] Statement import, category rules, undo import
- [ ] Shared space, invite, roles, approvals, activity and undo
- [ ] Calendar feed, Google Sheets, Telegram bot, API token, webhook
- [ ] Hindi, dark mode, text size, contrast, number style, push, monthly report, 2FA, app lock, devices, backup
- [ ] Phone layout, install, offline entry, share to app
