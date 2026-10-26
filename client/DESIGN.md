# Spendwise design system and redesign notes (step 11)

Visual and UX only: no behaviour, API, route, validation or test changes. Real data only; empty states stay honest.

## 1. Audit (25 Oct 2026)

Screens: every signed-in page plus login, at 1280 and 390 px, light and dark (104 screenshots, `scripts/shots.mjs`, a temporary
account with three months of entries, deleted afterwards). No page errors and no horizontal scroll anywhere. Ranked:

| # | Problem | Where |
|---|---|---|
| 1 | **Holes in the layout.** Dashboard: the recent-transactions card stretches to the height of the three cards beside it and leaves a large empty block; a tall "Coming up" empty state; the 6-month chart is half empty air. Insights: "Unusual" and "Worth it?" cards are mostly blank next to tall neighbours. Budgets: the limits card ends far above "Last 6 months". | `pages/Dashboard.jsx`, `pages/Insights.jsx`, `pages/Budgets.jsx` (grids that stretch cards), `components/ui.jsx` EmptyState |
| 2 | **Random colours.** The donut and legends use six unrelated hues (indigo, sky, amber, pink, teal, violet); bars are saturated green/red; payment-method bars, tags and icons each have their own tint. | `components/charts.jsx`, `pages/Dashboard.jsx` |
| 3 | **Purple-to-navy gradient login**, the most "template" screen in the app. | `components/AuthLayout.jsx` |
| 4 | **Every element is a bordered card at the same weight**, so nothing leads: stat cards, charts, lists, filters and empty states all look equal. | `components/ui.jsx` Card, `components/StatCard.jsx`, every page |
| 5 | **Numbers don't lead.** Stat values are 24 px with ".00" at full weight, next to tinted icon tiles that compete; subtitles are cut off ("2.9% more than Septemb…"). | `components/StatCard.jsx` |
| 6 | **Flat 20-item sidebar** with no grouping; Activity and Settings fall below the fold at 860 px high. | `components/AppLayout.jsx` |
| 7 | **The transaction filter panel is always open**: seven fields and a type switch take a full screen on phones before any entry shows. | `pages/Transactions.jsx` |
| 8 | **Transaction rows are noisy**: a red circle on every expense, meta lines of 4-5 parts that truncate on phones, edit and delete icons on every row, no grouping by day. | `components/TransactionList.jsx` |
| 9 | **Red everywhere for spending**: every expense amount, the daily line and half the bars are red, so red stops meaning "watch out". | `components/ui.jsx` Amount, `components/charts.jsx` |
| 10 | **Chart clutter**: full gridlines, square bars, empty months drawn as gaps, a tiny legend under the chart, a spiky smoothed line that exaggerates one rent day. | `components/charts.jsx` |
| 11 | **Inconsistent page headers**: actions sit right on some pages and under the subtitle on others (Budgets); quick add floats as a full-width bar under two different headers. | `components/ui.jsx` PageHeader, `pages/Budgets.jsx`, `pages/Dashboard.jsx`, `pages/Transactions.jsx` |
| 12 | **Phone stat cards stack one per row**: four full-width cards before the first chart. | `pages/Dashboard.jsx`, `pages/Transactions.jsx` |
| 13 | **Cold blue-grey neutrals and near-pure white / slate-950**: light mode feels clinical, dark mode navy rather than graphite. | `index.css` |
| 14 | **Default-looking controls**: browser select arrows, thin grey rings, no hover state, focus only from the browser outline; page tabs and small toggles share one look. | `components/ui.jsx` |
| 15 | **No motion language**: modals pop, skeletons pulse, nothing eases; phones get a centred dialog instead of a bottom sheet. | `components/Modal.jsx`, `components/ui.jsx` Skeleton |

## 2. Design system

All tokens live in `src/index.css` (`@theme`). Shared primitives live in `src/components/ui.jsx`, `StatCard.jsx` and `Modal.jsx`.
Specimen page (development only): `/ui`.

**Colour.** Warm neutrals replace `slate` (so every existing screen moves at once): canvas `slate-50` / `slate-950`, surface `white` /
`slate-900` (never pure #fff or #000), hairlines as 6% ink instead of grey borders. One accent, cobalt, replaces `indigo` / `brand`:
primary buttons, links, focus, selected states and key figures only. Emerald = money in, rose = money out and errors, amber = warning,
each toned down from Tailwind's defaults. Expense amounts in lists are ink with a minus sign; red is kept for "over" and errors.
Charts read `--chart-*` variables derived from the accent and neutrals.

**Type.** Inter with tabular figures. Scale 12 caption / 14 small / 16 body / 20 heading / 28 title / 40 display, with tighter tracking
from 20 up. Card titles 15 semibold. Paise render smaller and muted (`Money`).

**Space.** Tailwind's 4 px grid; cards 16 / 20 / 24 px padding; 12-16 px gaps in grids; page header 24-32 px below.

**Radii.** 8 small pieces, 10 controls, 14 cards, 18 dialogs.

**Elevation.** Resting surfaces: hairline plus a 1 px shadow in light, hairline only in dark. Floating things (dialogs, menus, toasts):
a layered `shadow-lg`.

**Motion.** 150 ms for hover and press (buttons scale to 0.98), 200-220 ms rise for dialogs, 500 ms for progress bars, shimmer for
skeletons. Everything is switched off under `prefers-reduced-motion`.

**Primitives.** Button (primary, secondary, ghost, danger; sm, md, lg, icon; loading), Input, Select (own chevron), Textarea, Field,
Card (`padding` md, lg, none), CardHeader, Badge (tones, optional dot), ProgressBar (ink when on track), Skeleton, EmptyState
(`compact` for slots inside cards), ErrorNote, Segmented (small choices), Tabs (page sections, same props), Money, Amount, PageHeader,
Switch, SettingRow, StatCard, Modal (bottom sheet on phones), toasts.

## 3. Login visuals

The connected Higgsfield account has 0 credits on the free plan, and Runway has no free API, so neither can make images or video
for free. Free options: a quiet animated abstract made in CSS/SVG (no numbers), or free-licence stock video (Pexels or Coverr,
downloaded once and served from `public/`).

## 4. Status (26 Oct 2026)

Done: tokens and primitives (`index.css`, `components/ui.jsx`, specimen at `/ui` in dev), app shell (grouped sidebar,
phone tab bar with a round + button, More sheet as list rows, command palette), animated SVG login panel, and every page
restyled with behaviour, labels, ids and API calls unchanged.

Layout rules that came out of the page pass:
- Every grid starts with `grid-cols-1` so long values can't widen a card past a 390px screen.
- Cards of uneven height sit in balanced columns (`lg:columns-2`) or a 12-column row with the shorter side `fill`ed, never
  beside an empty hole. Odd counts span (Investments: 2 wide + 3 narrow on a 6-column grid).
- A waiting/empty panel next to a form fills the form's height with its message centred.
- Names next to a badge wrap (`min-w-0 break-words`), they don't truncate to one letter.
- Tab strips and the heatmap scroll inside their own width; the page itself never scrolls sideways.
- Type is on the 12/14/16/20/28/40 scale only (`text-caption`/`sm`/`body`/`heading`/`title`/`display`); hairlines are
  `slate-900/[0.06]` and `white/[0.06]`.

Checks at the end: client build, 19 client tests, 0 missing Hindi strings, 19 shell behaviour checks, no page wider than
390px on any route, both themes and sizes screenshotted. Server tests: 209 of 209 after fixing a wishlist "days left" bug that showed
one day fewer between midnight and 5:30 am IST (see PLAN.md).
