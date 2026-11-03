# Spendwise: video narration script (7–10 minutes)

This is what to **say**, word for word, in the order of the brief:

1. Introduce yourself
2. Introduce the project
3. The tech stack and why
4. Use cases
5. Research
6. A walkthrough of the whole frontend
7. Conclusion and links

Spoken at a normal pace, the script runs about **9 minutes**.

- *Italic lines* are what to show on screen.
- **"Quoted lines"** are what to say.
- Text in [brackets] is for you to fill in.

**Links to put in the video description and the submission form:**

| What | Link |
|---|---|
| GitHub | https://github.com/SagnikBhowmik77/spendwise |
| Frontend (Vercel) | https://spendwise-tau-ruddy.vercel.app |
| Backend (Render) | https://spendwise-api-ur0f.onrender.com/api/health |
| Documentation | the README on GitHub, plus `docs/API.md` and `DEPLOY.md` |

---

## Before you press record

1. **Wake the server.** Open https://spendwise-api-ur0f.onrender.com/api/health and wait until it shows `"ok":true`.
   The free server sleeps overnight, and its first answer can take up to a minute.
2. **Fill a demo account in advance.** The walkthrough only has about 4 minutes, so don't type everything on camera.
   - Sign up as `yourname+demo@gmail.com` and confirm the email.
   - Then follow parts 2–10 of [DEMO-SCRIPT.md](DEMO-SCRIPT.md) to add the accounts, entries, budgets, bills, a goal, a
     loan, a group and an investment.
   - On camera, add only **one** entry live (section 6.3).
3. **Open these tabs, in order:**
   - the GitHub repo
   - the live app, signed in
   - the health link
4. **Get the window ready.**
   - Zoom Chrome to 100%.
   - Close other tabs.
   - Turn off notifications so nothing pops up while you record.
5. **Rehearse once with a timer.** If you run over, cut the lines marked *(optional)*.

---

## 1. Introduce yourself (0:00–0:20)

*Show: your face, or the landing page of the live app.*

**"Hi, I'm Sagnik Bhowmik, [a final-year B.Tech student in Computer Science at your college]. In this video I'll
present my full-stack project, Spendwise: a personal finance tracker built for India."**

---

## 2. Introduction of the project (0:20–1:05)

*Show: the landing page at spendwise-tau-ruddy.vercel.app. Scroll slowly.*

**"Most of us know roughly what we earn, but not where it goes. The bank app shows a long list of UPI debits, and a
spreadsheet usually gets abandoned after a week."**

**"Spendwise solves this. You add your spending quickly: by typing, by voice, by scanning a receipt, by importing a bank
statement, or even from Telegram. The app then turns those entries into answers. How much did I spend on food? Which
budget is about to run out? Which bill is due this week? Can I afford this purchase? And how much tax would I pay under
the old and the new regime?"**

**"It's built for how money works in India: UPI, salary credits, EMIs, fixed deposits, PPF, mutual funds, and the
April-to-March financial year. It has more than 30 screens and works in English and Hindi. It also runs on the phone
as an installable app. Everything you'll see works on real data. Nothing in the app is a mock-up."**

---

## 3. Tech stack and reason behind it (1:05–2:30)

*Show: the README on GitHub, scrolled to the "Tech stack and why" table, or the architecture diagram.*

**"Let me walk you through the tech stack, and why I chose each part."**

**"The frontend is React 19 with Vite. Vite gives a very fast development server and small production builds, and
React's components suit an app with this many screens. Every page loads only when it's opened, so the login page
downloads only what it needs."**

**"For styling I used Tailwind CSS version 4. One set of design tokens drives the whole app, so light mode, dark mode
and high contrast all come from the same classes."**

**"For server data I used TanStack Query. When I add an expense, every chart, card and budget on screen refreshes by
itself, with no manual wiring. Charts are drawn with Recharts."**

**"The backend is Node.js 22 with Express 5. That means one language, JavaScript, on both sides, and Express 5 handles
errors in async code properly. Every request is validated with zod."**

**"The database is MongoDB Atlas, through Mongoose. Financial entries come in different shapes, with splits, tags and
receipts, and a document database handles that well. One important decision: money is stored as whole paise, never as
decimals, so there are no rounding errors."**

**"I wrote the login myself, with JWT and bcrypt, instead of using a ready-made service. That gave me full control:
each device has its own session, you can sign out everywhere, and there's two-step login with an authenticator app. On
top of that, the app can be locked with a PIN or a fingerprint."**

**"For other features I picked free, open-source tools. Tesseract reads receipts inside the browser, so the photo
never leaves your device. Web Push sends the notifications. A service worker and IndexedDB let it work offline."**

**"For hosting, the frontend is on Vercel and the backend is on Render. Both are free and both redeploy automatically
on every push to GitHub. Finally, testing: there are 219 backend tests and 19 frontend tests, plus browser
walkthroughs and accessibility audits."**

---

## 4. Use cases (2:30–3:20)

*Show: the README's "Use cases" table, or flip between the matching screens in the app.*

**"Who is this for? Here are some real use cases."**

**"First, a salaried professional. They log a UPI payment in two seconds by typing '450 swiggy dinner yesterday upi'.
They set a monthly food budget, get a warning at 80 percent, and see on the 1st how the last month went."**

**"Second, someone planning their taxes. They compare the old and new regime on their own salary, and track 80C and
health-insurance limits from their tagged expenses. They can also record TDS and print rent receipts for HRA."**

**"Third, a family or flatmates. They share one household space with roles like owner, editor, viewer, or a child
with pocket money. Private accounts stay private, and large expenses can wait for approval."**

**"Fourth, a saver or investor. They track mutual funds priced every day from AMFI, along with FDs, PPF and gold. They
see their returns and a monthly net-worth history."**

**"And fifth, someone with EMIs and bills. They see every bill on a calendar, mark it paid in one tap, and check a
60-day cash-flow forecast before a big purchase."**

---

## 5. Research part (3:20–4:30)

*Show: the README's "Research" section.*

**"A finance app for India can't guess the rules, so I researched them from official sources."**

**"Tax first. The tax helper follows the new Income-tax Act 2025, which applies from tax year 2026-27, and the 2025-26
rules under the old Act. That covers the new-regime slabs, the rebate up to 12 lakh with marginal relief, the standard
deduction, the 80C and 80D limits, HRA, and capital-gains tax with the 1.25 lakh exemption. I took these from the
Budget documents on indiabudget.gov.in and from the Act in the Gazette of India."**

**"For mutual fund prices, I used AMFI's official daily file, which lists about 14,000 schemes. During development its
format changed, so my parser reads columns by their names, not by their position."**

**"For inflation, the 'spending in today's prices' view uses the official consumer price index from MoSPI's API. For
foreign currency, it uses the European Central Bank's daily rates."**

**"I also studied real Indian bank statements. They differ in date format, in their amount columns, and in how they
write UPI, NEFT and IMPS lines. So the importer learns each bank's layout, pulls the merchant name out of the
narration, and flags duplicates."**

**"Finally, I researched hosting limits. Render's free tier sleeps after 15 minutes and blocks outgoing email. So I
added a scheduled keep-awake ping, and I built a small, signed email relay on Vercel so that confirmation and
password-reset emails still get delivered."** *(optional)* **"I also checked accessibility. Every page passes WCAG AA
contrast checks, and Lighthouse gives 100 for accessibility, best practices and SEO."**

---

## 6. Walkthrough of the entire frontend (4:30–8:40)

Keep moving: about 15–20 seconds per screen.

### 6.1 Landing, sign-up and login (4:30–4:50)

*Show the landing page, click **Sign up**, show the form, then go to the Login page.*

**"This is the landing page that visitors see. Sign-up sends a confirmation email, and until the email is confirmed,
the app sends nothing to it. There's also 'Forgot password', which emails a one-time link that expires after 30
minutes. I've already signed in to a demo account."**

### 6.2 Dashboard (4:50–5:20)

*Show the dashboard, and hover over a chart.*

**"This is the dashboard: the month at a glance. Income, expenses, balance and net worth at the top. Below that is
where the money went by category, income against expenses over six months, and daily spending. Then the recent
entries, the budgets closest to their limit, how I paid (UPI, card or cash), and what's coming up next. New users also
get this 'Get started' checklist, worked out from their real data."**

### 6.3 Adding an entry live (5:20–5:50)

*Press **N**. Fill in: Expense, **₹350**, category **Food**, method **UPI**, note "Lunch". Save. Then type
**450 swiggy dinner yesterday upi** in quick add.*

**"I can press N anywhere to add an entry. I'll add a 350 rupee lunch on UPI. It can also be split across
categories, tagged, given a receipt photo, or entered in another currency. Or I can just type a sentence like this
into quick add, and it works out the amount, category, date and payment method. Notice the dashboard updated on its
own."**

### 6.4 Transactions (5:50–6:05)

*Open Transactions, filter by **Food**, then click **Export**.*

**"Transactions can be searched and filtered by date, category, account, payment method or tag, and exported as CSV
or as a PDF statement. Anything I delete goes to a bin for 30 days."**

### 6.5 Accounts (6:05–6:15)

*Open Accounts.*

**"Accounts: cash, bank, credit card and wallet, with live balances. The credit card shows its statement cycle and
due date."**

### 6.6 Budgets (6:15–6:35)

*Open Budgets, then click the Weekly, Envelopes and Sinking funds tabs.*

**"Budgets show each category's limit with a status: on track, close to the limit, or over. It also shows spending
that has no budget yet. There are weekly budgets, envelopes and sinking funds too, and alerts arrive at 80 and 100
percent."**

### 6.7 Bills, recurring entries, goals and loans (6:35–7:00)

*Open Bills (the calendar), click **Mark as paid**, then open Goals, then Loans.*

**"Bills appear on a calendar. One tap marks a bill paid, and it reminds me three days before. Recurring entries like
salary or Netflix are added automatically. Goals tell me how much to save each month. Loans show the EMI schedule and
how much is left."**

### 6.8 Groups, trips, vehicles and the vault (7:00–7:15) *(optional, cut if short on time)*

*Click quickly through Groups, Trips, Vehicles and Vault.*

**"Groups split shared expenses and show who owes whom. Trips total a holiday's spending. Vehicles track fuel and
mileage. The vault keeps warranties and reminds me before they expire."**

### 6.9 Investments and net worth (7:15–7:35)

*Open Investments, then the Net worth tab.*

**"Investments shows current value, gain and XIRR. Mutual funds are priced every day from AMFI, while FDs and PPF are
valued from their interest rates. Net worth is tracked month by month."**

### 6.10 Tax and planning (7:35–7:55)

*Open Plan: show the tax tab, then Salary (old vs new), then Cash flow, then "Can I afford it?".*

**"The planning section has the tax helper, which totals tax-saving items against each section's limit. It compares
old and new regime on a salary, and forecasts cash flow for the next 60 days. 'Can I afford it?' answers whether a
purchase fits. There's even a FIRE calculator for early retirement."**

### 6.11 Insights (7:55–8:10)

*Open Insights, then click Patterns (the heatmap) and Merchants.*

**"Insights forecasts the month, spots unusual spending, finds subscriptions automatically and shows the savings
rate. Patterns has a heatmap of the whole year, and Merchants shows where I spend the most."**

### 6.12 Import, household and integrations (8:10–8:25)

*Open Import and show the preview of `docs/demo/sample-statement.csv` (prepared earlier). Then open Household, then
Integrations.*

**"Import takes a bank statement in CSV or Excel. It previews every line with a suggested category and flags
duplicates before saving. Household shares a space with family, using roles and approvals. Integrations connects a
Google Calendar feed, Google Sheets and a Telegram bot."**

### 6.13 Settings, phone, dark mode and Hindi (8:25–8:40)

*Open Settings and switch to Dark. Switch the language to Hindi for 2 seconds, then back. Optionally press F12, switch
on phone view and show the bottom bar.*

**"Finally, settings: theme, text size, high contrast, lakh and crore formatting, privacy mode that hides amounts, and
two-step login, app lock and full backups. The whole app works in dark mode, in Hindi, and on the phone."**

---

## 7. Conclusion and links (8:40–9:10)

*Show the GitHub repo, then the live links.*

**"To sum up: Spendwise is a free, private finance tracker that goes well beyond a list of expenses. Budgets warn you,
bills remind you, investments price themselves, and tax answers follow current Indian rules. It's built with React,
Express and MongoDB, deployed on Vercel and Render, and tested at every layer."**

**"The code and full documentation are on GitHub at github.com/SagnikBhowmik77/spendwise. The live app is at
spendwise-tau-ruddy.vercel.app, and the backend runs on Render. All the links are in the description. Thank you for
watching."**

---

## If you're running long or short

- **Over 10 minutes:** cut 6.8, the optional line in Research, and the third use case.
- **Under 7 minutes:** slow down in 6.3. Also show a receipt scan using `docs/demo/sample-receipt.png`, and the Year in
  review tab in Insights.
- **If the server is slow on camera:** say **"the free server is waking up; this happens only on the first request"**
  and keep talking. Don't cut the recording.
