# Vega Sport: home page recommender

Proposal of 14 November 2026: nothing below is built yet; the decisions it waits for are at the end. Kept in the repository from the shared document.

## What we want

The home page shows the same matches and players in the same order to every visitor. The recommender adds one row, « Pour vous », at the top of the week page: four matches chosen for that visitor by one of a few fixed orderings, and the site learns which ordering visitors open most.

- **Stays as it is:** every existing card, its rules (match of the week, results feed, leaders) and the design. The new row takes the style of the cards beside it.
- **No accounts, no profile:** the row uses what the browser already holds (saved clubs and players) and what the base computes (forecasts, standings, projections).
- **Nothing is personalised by a model trained on one person:** the site chooses between orderings that are the same for everyone in a group of visitors, and counts which one gets clicked.

## How the home page is ordered today

Every visitor gets the same fixed rules (`docs/calculs/06-accueil-et-matchs/01-accueil.md`); the only personal input is the clubs and players a visitor saved, kept in their own browser.

| Block | Rule today |
| --- | --- |
| Results feed | editorial weight: 2 × big clubs (a fixed list of 29) + 3 Champions League, 1 Europa or Conference + 1 Top 5 league + 1 per side ranked in its top 3 |
| Match of the week | 4 × big clubs + points for both sides near the top, the Champions League, the Top 5, shots available; ties go to the latest |
| Coming matches | your saved clubs first (European nights first that day), then editorial weight, then kick-off |
| Leaders, streaks, defences | season tables, the same for everyone |

Nothing tells us which of these a visitor opens. Vercel Web Analytics, already on the site, counts page views without cookies; it does not say which card was clicked, nor in which order the cards were shown.

## The proposal: four orderings, chosen by a bandit

The row is filled by one of four orderings of the week's coming matches; a Thompson-sampling bandit picks the ordering for each visit and moves traffic towards the one visitors click most.

| Ordering | Puts first | Built from |
| --- | --- | --- |
| A. Éditorial (today's rule, the baseline) | the highest editorial weight | the rule above |
| B. Vos équipes | matches of saved clubs and of saved players' clubs, then their leagues, then weight | the browser's saved lists |
| C. Matchs serrés | the most open matches: the smallest gap between home and away win chances in our forecast | `/api/forecasts/match` (form and confirmed line-ups included) |
| D. Enjeu au classement | both clubs in the top four or bottom three of their league's projection | `/api/forecasts/season` |

- **Groups of visitors:** new, returning with saved clubs, returning without. Each group has its own counts, so ordering B can win for visitors with saved clubs and lose for the others.
- **One ordering per visit:** chosen once when the page opens and kept for the visit, so the row never reshuffles under the reader.
- **Choice:** for each ordering and group, a Beta(1 + clicks, 1 + views without a click); each visit draws one value per ordering and shows the highest. Every ordering keeps at least 10 % of visits for the first two weeks.
- **Reward:** a click on one of the row's four cards during the visit.

## What is recorded

Two kinds of event, a view of the row and a click on one of its cards, with no account, no IP address and nothing that follows a visitor from one day to the next.

| Field | Example | Why |
| --- | --- | --- |
| Event | view, click | the reward |
| Minute | 2026-11-21 15:04 | the daily counts |
| Visit | a random id, new for each tab session, never stored past it | one ordering per visit, one reward per visit |
| Group | new, returning with saved clubs, returning without | the bandit's counts |
| Ordering | A, B, C, D | what the visit was shown |
| Card | its position (1–4) and the match's Vega id | which card drew the click |

- **Storage:** typed rows in a new table `ops.home_events`, one partition a day, deleted after 90 days; the worker sums them each night into `agg.home_bandit` (ordering, group, views, clicks), which is all the bandit reads.
- **Write path:** the read API stays read-only. A small separate route takes the events (sent in batches when the tab is hidden, `navigator.sendBeacon`), checks each field against its type and writes through a role that can only insert into that table.
- **Privacy:** recording which card a visitor clicks is new for the site. Whether it needs a consent banner, or counts as anonymous audience measurement that does not, is to be checked against the CNIL's rules before anything is recorded.

## How we judge it

An ordering is kept only if more visits click in the row with it than with today's editorial ordering; the rest are dropped.

- **Main measure:** the share of visits that click one of the row's cards, per ordering and group.
- **Watched beside it:** the share of visits that click anything on the home page (the row must not take clicks from the cards below it), and visits back within seven days.
- **Dropping an ordering:** once it and ordering A each have 2,000 visits in a group, it is dropped for that group if its chance of beating A, read from the two Beta counts, is under 5 %.
- **How long it takes:** telling a 10 % click share from 12 % takes about 3,800 visits per ordering (5 % false alarm, 80 % power). The 10 % is an assumption: the two weeks of recording below give the real figure, and with it the length of the test.
- **Reported:** the counts per ordering and group each week, on the status page.

## Build steps

The row can be built and shown with ordering A alone before anything is recorded; recording waits for the privacy decision.

1. **The row, ordering A only.** « Pour vous » on the week page, four coming matches by today's editorial weight. No recording, nothing changes elsewhere on the page.
2. **Orderings B, C, D in the code**, each tested on the week's real matches; a visit still sees A.
3. **Recording** (after the decision below): the table, its nightly sums, the insert-only route and the site's batched events. Two weeks with A only: the baseline click share, and a check that views and clicks add up.
4. **The bandit on:** the API serves each group's counts; the site draws one ordering per visit from them.
5. **Weekly report** on the status page, and the drop rule applied by hand for the first month.

## Mock-up

The row as it would sit on the week page, above the match of the week, filled here by ordering C on the real coming matches and our real forecasts of 14 November 2026. Only the choice of ordering is invented, and the badge says so; the screenshots come from a local copy of the site, nothing was put on the live site.

![The « Pour vous » row on the week page, desktop](images/pour-vous-bureau.png)

On a phone the four matches become one row that scrolls sideways, like the filters, never a stack of four cards.

![The same row on a phone, scrolling sideways](images/pour-vous-telephone.png)

## Decisions needed from you

- [ ] Record which card a visitor clicks: yes or no, and with a consent banner or as anonymous audience measurement (to check against the CNIL's rules first).
- [ ] The four orderings to test: A to D as above, or others.
- [ ] The row's place: top of the week page (the mock-up), or inside « Matchs à venir » in place of its present order.
- [ ] Step 1 now: the row with ordering A, on the live site, with nothing recorded.
