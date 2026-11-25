"""Our probable eleven of each club before the provider's line-ups (« Composition probable »).

Display only (FAILURE_MODES.md §61; hugo, 25 Nov 2026): the forecast, the line-up model (lineup.py), the rankings and
core.lineups neither read nor receive anything of it. The match page shows it for a side the provider has sent no
line-up for yet.

The method, probable-v3 (§61.4), is the study v5.1's V51 (blesses-suspendus/onze-probable/v51/etude_onze_postes_v51.py:
`predict_all`, its L75), judged there on its validation in the clubs of the five leagues (1 253 team-matches since 1 Aug
2026) against probable-v2: starters found +0.024 [−0.011; +0.066], starters in the right slot (line and lane) +0.449
[+0.373; +0.521]. Elsewhere it is probable-v2. In a club of the five leagues:
- each slot is labelled (`labels`: its line, its lane by pitch_y); each player's fit to a label, A (`fit`), is his
  weighted starts with it, drawn towards his main role's share of it (`role_shares`, over every eleven the run read);
- the template is probable-v2's; its slots are filled together (`assign`) from the window's available players, by the
  greatest Σ (1 − λ) S + λ S A (λ 0.75, S the score below), each player only in one of his permitted lines
  (`permitted`: his role's, those he started in among the club's last LONG elevens, and his role's frequent ones when
  he has few starts), a keeper only in goal; then re-placed by the greatest Σ S A, ties to probable-v2's slot;
- no assignment within those lines, or no template: probable-v2's eleven.
A template starter absent and out of the eleven is named by whoever takes his slot.

probable-v2 (§61.3), still selectable, is the study v4's H1 (blesses-suspendus/onze-probable/v4/etude_onze_melange.py:
`predict_xis` and `route`), chosen there over probable-v1 on its validation (11 760 team-matches since 1 Aug 2026): 8.43
starters found out of 11 against 7.91 (+0.518, 95 % interval [+0.491; +0.545]); in the clubs of the five leagues 8.18
against 7.87, elsewhere 8.46 against 7.91.
- the window, the absent and the gone: probable-v1's, below;
- the weights (`similarity_weights`, the study's P7 with s 400, λ 0.3): 0.8^k × exp(−the gap between that opponent's
  Elo and this one's / SIMILARITY), × OTHER_KIND when that match's competition type is not this one's, divided by the
  largest;
- each player's score (`scores`, the study's P10 with those weights, P11): his weighted starts over his weighted sheets
  (starter or substitute), drawn towards the window's prior by PULL: a match he was not on the sheet of does not count;
- a club of the five leagues (`five_clubs`): `guess` with the score first in each line, the absent and the gone
  replaced by the best score of their line (P11);
- any other club: the window's latest eleven, each absent or gone starter replaced by the best score of his line, else
  of the other outfield lines, a keeper only by a keeper (P1a).
`share` is that score (0 to 1), not a count of starts.

probable-v1, still selectable (`predict(method="probable-v1")`), is the study's P5 (blesses-suspendus/onze-probable/
etude_onze_probable.py: `guess()` and the absence rule « B connue »), measured there before it was chosen:
- the window: the club's last WINDOW complete confirmed elevens (11 starters, `confirmed` true, a finished match, any
  competition, within LOOKBACK), each weighted 0.8^k, k = 0 for the most recent; fewer than MIN_RECENT: no eleven;
- the eleven: the line split of greatest weight, in each line the players most started (weighted), and a removed
  player replaced by the most used available player of his line (a keeper only by a keeper);
- removed: the absent (an injury or illness started before the match day with no match for his club since; a
  suspension of the match's competition, as the site's `absenceApplies`) and the gone (his latest club line-up is
  another club's, or the club's Transfermarkt squad read after his last appearance does not hold him);
- `share`: his starts in the window / its elevens.

`window_weights` is the one place a window's weights are computed and `predict` the one function a method label goes
through; the tables, the route and the site read `method` from the rows.
"""

from collections import Counter, defaultdict, namedtuple
from datetime import timedelta
from math import exp, hypot

from .forecast import LEAGUE_PHASE_CUPS
from .lineup import year_of
from .power import award_year, role_of

METHOD = "probable-v3"  # the method the worker's step writes
METHODS = ("probable-v1", "probable-v2", "probable-v3")
WINDOW = 10  # the club's last complete confirmed elevens, every competition
LONG = 30  # probable-v3: the club's last LONG of them are read, the history the permitted lines come from
MIN_RECENT = 5  # below this many in the window: no probable eleven for that side
DECAY = 0.8  # weight 0.8^k, k = 0 for the most recent eleven
STARTERS = 11
HORIZON = timedelta(days=7)  # matches not started whose kick-off falls in ]now, now + HORIZON]
LOOKBACK = timedelta(days=400)  # elevens and appearances looked for in the LOOKBACK before now
FRESH_DAYS = 45  # a suspension without an end counts while the player's suspensions were read this recently (174)
EVERY = timedelta(minutes=15)  # the worker's step runs at most this often
# probable-v2's constants, the study v4's (frozen there from v3's grids: P7 s 400, λ 0.3; P10 W 10, a 2).
SIMILARITY = 400.0  # s: a gap of this much Elo between two opponents divides an eleven's weight by e
OTHER_KIND = 0.3  # λ: an eleven of another competition type than the match's (or the match's unknown) weighs this much
MISSING_GAP = 150.0  # the Elo gap counted when either opponent's Elo is unknown
PULL = 2.0  # a: the prior's weight in a player's score
PRIOR = 0.6  # the prior when no eleven of the window has a substitute on its sheet
# probable-v3's constants, the study v5.1's (L75, frozen on its adjustment year; Astra's lines).
FIT_WEIGHT = 0.75  # λ: a player's worth in a slot, (1 − λ) S + λ S A
FIT_PULL = 2.0  # the weight of his role's share in a player's fit A
ROLE_MIN = 20  # a role with fewer labelled starts: its label shares are every role's, its line shares 0
FEW = 3  # a player with fewer labelled starts in the history also takes his role's lines of ROLE_SHARE or more
ROLE_SHARE = 0.10
OUT = -1000.0  # the worth of a player out of his permitted lines, or of a keeper rule broken

LINE = {"goalkeeper": "G", "centre_back": "D", "full_back": "D", "defensive_midfielder": "M", "central_midfielder": "M",
        "wide_midfielder": "M", "attacking_midfielder": "M", "winger": "A", "centre_forward": "A"}
LINES = ("G", "D", "M", "A", "?")

# One eleven of a window, the oldest first. Its first four fields are the study's entry: (day, starters, {player:
# role}, players who appeared); then the match, its competition and the opponent, the formation, {starter:
# (position_id, pitch_x, pitch_y)}, {player: shirt number}; then what probable-v2 weighs by: the players on its sheet
# (starters and substitutes), its competition type (`_KIND`: E, L, O or None) and the opponent's Elo (or None).
Entry = namedtuple("Entry", "day starters roles came match_id competition_id opponent_id formation spots shirts sheet ctype opp_elo",
                   defaults=(frozenset(), None, None))
# A side to guess: its match, season, day (UTC), team, opponent, side and the match's competition; the match's
# competition type, the opponent's latest Elo, and whether the club is of the five leagues that award year.
Target = namedtuple("Target", "match_id season_id day team_id opponent_id side competition_id ctype opp_elo five",
                    defaults=(None, None, False))


def weights(n, decay=DECAY):
    return [decay ** (n - 1 - i) for i in range(n)]


def window_weights(method, window, target):
    """Each eleven's weight in `window` (oldest first) for the match `target`: the one place a method weighs them."""
    if method == "probable-v1":
        return weights(len(window))
    if method in ("probable-v2", "probable-v3"):
        return similarity_weights(window, target)
    raise ValueError(f"unknown method {method!r}")


def similarity_weights(window, target, s=SIMILARITY, lam=OTHER_KIND):
    """The study's P7 weights (its `sim_weights`): 0.8^k × exp(−|that opponent's Elo − the match's opponent's| / s),
    MISSING_GAP when either is unknown, × lam when that eleven's competition type is not the match's or the match's is
    unknown; then each divided by the largest."""
    out = []
    for e, w in zip(window, weights(len(window))):
        w *= exp(-(abs(e.opp_elo - target.opp_elo) if e.opp_elo is not None and target.opp_elo is not None else MISSING_GAP) / s)
        if target.ctype is None or e.ctype != target.ctype:
            w *= lam
        out.append(w)
    top = max(out, default=1.0) or 1.0
    return [w / top for w in out]


def availability(window, wts):
    """The study's P10 counts (its `avail`): ({player: Σ w started}, {player: Σ w on the sheet}, prior). On the sheet:
    starter or substitute. The prior: 11 × Σ w / Σ (w × sheet size) over the elevens whose sheet holds a substitute,
    PRIOR without any; an eleven without substitute counts for its starters only and not in the prior."""
    started, listed, sw, sz = Counter(), Counter(), 0.0, 0.0
    for e, w in zip(window, wts):
        for p in e.sheet:
            listed[p] += w
        for p in e.starters:
            started[p] += w
        if len(e.sheet) > STARTERS:
            sw, sz = sw + w, sz + w * len(e.sheet)
    return started, listed, STARTERS * sw / sz if sz else PRIOR


def scores(window, wts, a=PULL):
    """Each player's score on the window (the study's `score11`): (Σ w started + a × prior) / (Σ w on the sheet + a)."""
    started, listed, prior = availability(window, wts)
    return {p: (started[p] + a * prior) / (v + a) for p, v in listed.items()}


def latest_eleven(window, main_role):
    """The window's latest eleven, [(player, line)], each in the line of his role in it, else of his latest role (P1)."""
    last = window[-1]
    return [(p, LINE.get(last.roles.get(p) or main_role(p), "?")) for p in last.starters]


def _tally(entries, wts, main_role):
    """The study's counts: weighted starts, appearances, the last appearance's index, each player's lines, each
    eleven's line split, the split chosen (greatest weight, ties the most recent)."""
    starts, apps, last, lines_of, shapes, tot = Counter(), Counter(), {}, defaultdict(Counter), [], Counter()
    for i, (e, w) in enumerate(zip(entries, wts)):
        shape = Counter()
        for p in e[1]:
            ln = LINE.get(e[2].get(p) or main_role(p), "?")
            shape[ln] += 1
            starts[p] += w
            lines_of[p][ln] += w
        shapes.append(tuple(shape[x] for x in LINES))
        tot[shapes[-1]] += w
        for p in e[3]:
            apps[p] += w
            last[p] = i
    top = max(tot.values())
    chosen = next(s for s in reversed(shapes) if tot[s] > top - 1e-9)
    return starts, apps, last, lines_of, shapes, chosen


def _lines(apps, lines_of, main_role):
    """Each player's line in a window: that of his weighted starts (ties: the last in LINES' alphabetical order), never a
    starter: his role's."""
    line = {}
    for p in apps:
        lc = lines_of.get(p)
        line[p] = max(sorted(lc), key=lambda x: (round(lc[x], 9), x)) if lc else LINE.get(main_role(p), "?")
    return line


def guess(entries, wts, main_role, gone=frozenset(), score=None, base=None):
    """The guessed eleven of a window (oldest first, weights of the same length): ([(player, line)], [(removed, line,
    replacement or None)]). The study's `guess()` as measured: the split of greatest weight (ties: the most recent);
    in each line the most started (weight), then the most appeared, then the most recent appearance, then the smallest
    id; a player's line is that of his starts. A removed player is replaced by the most used available player of his
    line, else of another (a keeper by a keeper, an outfield player by an outfield one).

    The study v4's two additions (probable-v2): `score` {player: score} comes first in that order (P11); `base`, an
    eleven [(player, line)], is kept as it is instead of the lines' choice, only its removed players replaced (P1a)."""
    starts, apps, last, lines_of, _, shape = _tally(entries, wts, main_role)
    line = _lines(apps, lines_of, main_role)

    def key(p):
        k = round(starts[p], 9), round(apps[p], 9), last.get(p, -1), -p
        return k if score is None else (round(score[p], 9),) + k

    habitual, taken = list(base or ()), {p for p, _ in base or ()}
    if base is None:
        for ln, n in zip(LINES, shape):
            cand = sorted((p for p in starts if line[p] == ln and p not in taken), key=key, reverse=True)[:n]
            habitual += [(p, ln) for p in cand]
            taken.update(cand)
        for p in sorted((p for p in starts if p not in taken), key=key, reverse=True)[:STARTERS - len(habitual)]:
            habitual.append((p, line[p]))
            taken.add(p)
    used, xi, rep = set(taken), [], []
    for p, ln in habitual:
        if p not in gone:
            xi.append((p, ln))
            continue
        pool = [q for q in apps if q not in used and q not in gone and (line[q] == "G") == (ln == "G")]
        same = [q for q in pool if line[q] == ln]
        pick = max(same or pool, key=key) if pool else None
        if pick is not None:
            used.add(pick)
            xi.append((pick, ln))
        rep.append((p, ln, pick))
    return xi, rep


def injury_absence(episodes, last_app, day):
    """The episode that keeps a player out on `day` (the study's « B connue »): an injury or illness started before
    the day and on or after his last appearance for his club (None: he never appeared); its end is not read. The
    latest such episode, or None."""
    out = [e for e in episodes if e["start"] < day and (last_app is None or last_app <= e["start"])]
    return max(out, key=lambda e: e["start"]) if out else None


def suspension_applies(s, competition_id, day, today):
    """A suspension counts for a match of `competition_id` on `day`: of that competition, started that day at the
    latest, not served (matches remaining not 0), its end that day or later, or empty while the player's suspensions
    were read FRESH_DAYS ago at most (`today` is the run's UTC day)."""
    if competition_id is None or s["competition_id"] != competition_id or s["start"] > day or s["remaining"] == 0:
        return False
    if s["end"] is not None:
        return s["end"] >= day
    return s["read_on"] is not None and s["read_on"] >= today - timedelta(days=FRESH_DAYS)


def _complete(e):
    return all(e.spots.get(p) and e.spots[p][1] is not None and e.spots[p][2] is not None for p in e.starters)


def place(xi, rep, window, wts, main_role, latest=False):
    """Each guessed player's slot: (formation, [(player, position_id, pitch_x, pitch_y)] in the template's order).

    The template: among the elevens of the chosen split, the formation of greatest weight (ties: the most recent) and
    its most recent eleven whose starters' places are all known (else the most recent of the split that has them,
    else none: the places stay empty); `latest` (probable-v2's P1a): the latest eleven's formation, among every eleven
    of the window. A guessed player who started in it keeps his slot; a replacement takes the removed player's slot
    when it is free; the others, most used first, the free slot nearest their weighted mean place in the window (ties:
    the template's order)."""
    starts, apps, last, _, shapes, chosen = _tally(window, wts, main_role)
    formation, template, slots = _template(window, wts, shapes, chosen, latest)
    if template is None:
        return formation, [(p, None, None, None) for p, _ in xi]
    slot_of = _slot_of(xi, rep, window, wts, (starts, apps, last), slots)
    placed = sorted(((slot_of[p], p) for p, _ in xi if p in slot_of))
    out = [(p, *slots[k][0]) for k, p in placed]
    return formation, out + [(p, None, None, None) for p, _ in xi if p not in slot_of]


def _template(window, wts, shapes, chosen, latest):
    """`place`'s template: (formation, the template's eleven or None, its slots [((position_id, pitch_x, pitch_y),
    starter)] in the template's order)."""
    if latest:
        split = list(range(len(window)))
        formation = window[-1].formation
    else:
        split = [i for i in range(len(window)) if shapes[i] == chosen]
        weight = Counter()
        for i in split:
            weight[window[i].formation] += wts[i]
        top = max(weight.values())
        formation = next(window[i].formation for i in reversed(split) if weight[window[i].formation] > top - 1e-9)
    template = next((window[i] for i in reversed(split) if window[i].formation == formation and _complete(window[i])), None) \
        or next((window[i] for i in reversed(split) if _complete(window[i])), None)
    if template is None:
        return formation, None, []
    return formation, template, sorted(((template.spots[p], p) for p in template.starters), key=lambda s: (s[0][1], s[0][2], s[0][0] or 0, s[1]))


def _slot_of(xi, rep, window, wts, counts, slots):
    """`place`'s slots of a guessed eleven, {player: index in `slots`} (a player left without a free slot is not in it);
    `counts` the window's (starts, appearances, last appearance) of `_tally`."""
    starts, apps, last = counts
    index = {p: k for k, (_, p) in enumerate(slots)}

    def mean(p):
        sx = sy = sw = 0.0
        for e, w in zip(window, wts):
            spot = e.spots.get(p)
            if p in e.starters and spot and spot[1] is not None and spot[2] is not None:
                sx, sy, sw = sx + w * spot[1], sy + w * spot[2], sw + w
        return (sx / sw, sy / sw) if sw else None

    slot_of, taken = {}, set()
    for p, _ in xi:
        if p in index:
            slot_of[p] = index[p]
            taken.add(index[p])
    replaced = {pick: r for r, _, pick in rep if pick is not None}
    for p, _ in xi:
        r = replaced.get(p)
        if p not in slot_of and r in index and index[r] not in taken:
            slot_of[p] = index[r]
            taken.add(index[r])
    rest = sorted((p for p, _ in xi if p not in slot_of),
                  key=lambda p: (round(starts[p], 9), round(apps[p], 9), last.get(p, -1), -p), reverse=True)
    for p in rest:
        free = [k for k in range(len(slots)) if k not in taken]
        if not free:
            break
        aim = mean(p) or (mean(replaced[p]) if p in replaced else None)
        k = min(free, key=lambda k: (hypot(slots[k][0][1] - aim[0], slots[k][0][2] - aim[1]), k)) if aim else free[0]
        slot_of[p] = k
        taken.add(k)
    return slot_of


# ------------------------------------------------------------------------- probable-v3: slots (line, lane), §61.4

def labels(formation, spots):
    """{starter: (line, lane)} of an eleven's {starter: (position_id, pitch_x, pitch_y)}: the line of his slot's role
    (`role_of` with the eleven's highest slot), the lane by the rank of pitch_y in that line, the lowest L, the highest R,
    the others C; a line of two players or fewer is all C. No line or no pitch_y: no label."""
    top = max((s[0] or 0 for s in spots.values()), default=0)
    by = defaultdict(list)
    for p, (pos, _, y) in spots.items():
        ln = LINE.get(role_of(formation, pos, top), "?")
        if ln != "?" and y is not None:
            by[ln].append((y, pos or 0, p))
    out = {}
    for ln, ms in by.items():
        ms.sort()
        for i, (_, _, p) in enumerate(ms):
            out[p] = (ln, "C" if len(ms) <= 2 or 0 < i < len(ms) - 1 else "L" if i == 0 else "R")
    return out


def assign(val):
    """The assignment that maximises Σ val[i][j], one column per row, each column once (rows <= columns): [each row's
    column]. The Hungarian method, O(n² m), as the study's."""
    n = len(val)
    if not n:
        return []
    m = len(val[0])
    inf = float("inf")
    u, v, p, way = [0.0] * (n + 1), [0.0] * (m + 1), [0] * (m + 1), [0] * (m + 1)
    for i in range(1, n + 1):
        p[0], j0 = i, 0
        minv, used = [inf] * (m + 1), [False] * (m + 1)
        while True:
            used[j0] = True
            i0, delta, j1 = p[j0], inf, 0
            row, ui = val[i0 - 1], u[i0]
            for j in range(1, m + 1):
                if not used[j]:
                    cur = -row[j - 1] - ui - v[j]
                    if cur < minv[j]:
                        minv[j], way[j] = cur, j0
                    if minv[j] < delta:
                        delta, j1 = minv[j], j
            for j in range(m + 1):
                if used[j]:
                    u[p[j]] += delta
                    v[j] -= delta
                else:
                    minv[j] -= delta
            j0 = j1
            if p[j0] == 0:
                break
        while j0:
            j1 = way[j0]
            p[j0] = p[j1]
            j0 = j1
    out = [None] * n
    for j in range(1, m + 1):
        if p[j]:
            out[p[j] - 1] = j - 1
    return out


class RoleShares:
    """Over elevens' labelled starts, each starter under his main role: `label(r, s)` the share of label s among role r's
    (fewer than ROLE_MIN: among every role's), `line(r, ln)` the share of line ln (fewer than ROLE_MIN: 0). A starter
    without a main role counts under None."""

    def __init__(self, entries, main_role):
        self.n, self.labels, self.lines, self.all = Counter(), Counter(), Counter(), Counter()
        for e in entries:
            for p, lab in labels(e.formation, e.spots).items():
                r = main_role(p)
                self.n[r] += 1
                self.labels[(r, lab)] += 1
                self.lines[(r, lab[0])] += 1
                self.all[lab] += 1

    def label(self, role, lab):
        n = self.n[role]
        return self.labels[(role, lab)] / n if n >= ROLE_MIN else self.all[lab] / (self.all.total() or 1)

    def line(self, role, ln):
        n = self.n[role]
        return self.lines[(role, ln)] / n if n >= ROLE_MIN else 0.0


def role_shares(entries, main_role):
    return RoleShares(entries, main_role)


def fit_counts(window, wts):
    """({player: Counter(label: Σ w started with it)}, {player: Σ w started with a label}) over the window."""
    cnt, tot = defaultdict(Counter), Counter()
    for e, w in zip(window, wts):
        for p, lab in labels(e.formation, e.spots).items():
            cnt[p][lab] += w
            tot[p] += w
    return cnt, tot


def fit(p, lab, counts, shares, main_role):
    """A(p, s) = (n_ps + FIT_PULL × q(r, s)) / (n_p + FIT_PULL): his weighted starts with label s, with any label, r his
    main role."""
    cnt, tot = counts
    c = cnt[p].get(lab, 0.0) if p in cnt else 0.0
    return (c + FIT_PULL * shares.label(main_role(p), lab)) / (tot.get(p, 0.0) + FIT_PULL)


def permitted(history, main_role, shares):
    """ok(p): the lines p may be given, {line}: his main role's; every line he started in (labelled) in the history's
    last LONG elevens; with fewer than FEW such starts and a main role, also every outfield line of ROLE_SHARE or more
    of his role's starts. The G slot's keeper rule is the caller's."""
    seen, n = defaultdict(set), Counter()
    for e in history[-LONG:]:
        for p, lab in labels(e.formation, e.spots).items():
            seen[p].add(lab[0])
            n[p] += 1
    memo = {}

    def ok(p):
        if p not in memo:
            r = main_role(p)
            got = {LINE.get(r, "?")} | seen.get(p, set())
            if n[p] < FEW and r is not None:
                got |= {ln for ln in "DMA" if shares.line(r, ln) >= ROLE_SHARE}
            memo[p] = got
        return memo[p]
    return ok


def _fitted(window, wts, main_role, removed, score, history, shares):
    """probable-v3's eleven of a five-league club (the study v5.1's L75): (formation, the template's slots, {player:
    slot index}), or None for v2's (no template, or no assignment within the permitted lines)."""
    starts, apps, last, lines_of, shapes, chosen = _tally(window, wts, main_role)
    formation, template, slots = _template(window, wts, shapes, chosen, latest=False)
    if template is None:
        return None
    of = labels(template.formation, template.spots)
    lab = [of.get(p) for _, p in slots]
    line, counts, ok = _lines(apps, lines_of, main_role), fit_counts(window, wts), permitted(history, main_role, shares)

    def worth(p, lb, lam, prefer=None, k=None):
        if lb is None:
            return 0.0
        if (line.get(p, LINE.get(main_role(p), "?")) == "G") != (lb[0] == "G") or lb[0] not in ok(p):
            return OUT
        s = score.get(p, 0.0)
        return (1 - lam) * s + lam * s * fit(p, lb, counts, shares, main_role) + (1e-6 if prefer and prefer.get(p) == k else 0.0)

    def best(players, lam, prefer=None):
        val = [[worth(p, lb, lam, prefer, k) for p in players] + [0.0] * max(0, len(lab) - len(players)) for k, lb in enumerate(lab)]
        return {players[j]: k for k, j in enumerate(assign(val)) if j is not None and j < len(players)}

    got = best(sorted(p for p in apps if p not in removed), FIT_WEIGHT)
    if any(worth(p, lab[k], FIT_WEIGHT) <= OUT for p, k in got.items()):
        return None
    eleven = sorted(got)
    # Re-placed by max Σ S × A within the permitted lines (λ 1); ties to the slot v2's `place` would give them.
    prefer = _slot_of([(p, line.get(p, "?")) for p in eleven], [], window, wts, (starts, apps, last), slots)
    return formation, slots, best(eleven, 1.0, prefer)


def predict(window, target, main_role, absent, gone, method=METHOD, history=None, shares=None):
    """One side's probable eleven by `method`: {formation, starters: [(player, position_id, pitch_x, pitch_y, share,
    replaces)], absent: [(player, episode)]}. `absent` {player: episode} and `gone` {player} are the window's removed
    players; an absent one is listed and named by his replacement, a gone one neither.

    probable-v1: `guess` on 0.8^k; share = his starts / the window's elevens. probable-v2 (the study v4's H1): a club of
    the five leagues (`target.five`) `guess` with the score first (P11), any other the latest eleven with each removed
    player replaced by the best score (P1a), both on `similarity_weights`; share = his score. probable-v3 (the study
    v5.1's V51, §61.4): a club of the five leagues the template's slots filled together within the permitted lines
    (`_fitted`), `history` (the club's last LONG elevens, oldest first; default the window) giving those lines and
    `shares` (`role_shares`; default the history's) the roles' shares; a template starter absent and out of the eleven
    is named by whoever takes his slot; v2 elsewhere and wherever `_fitted` gives none."""
    wts = window_weights(method, window, target)
    removed = frozenset(absent) | frozenset(gone)
    if method == "probable-v3" and target.five:
        history, score = history or window, scores(window, wts)
        got = _fitted(window, wts, main_role, removed, score, history, shares or role_shares(history, main_role))
        if got is not None:
            formation, slots, slot_of = got
            owner = [p for _, p in slots]
            placed = sorted((k, p) for p, k in slot_of.items())
            starters = [(p, *slots[k][0], score[p], owner[k] if owner[k] in absent and owner[k] not in gone else None)
                        for k, p in placed]
            listed = [(p, e) for p, e in absent.items() if p not in gone]
            return {"formation": formation, "starters": starters, "absent": sorted(listed, key=lambda pe: _absent_order(*pe))}
    if method == "probable-v1":
        xi, rep = guess(window, wts, main_role, removed)
        formation, spots = place(xi, rep, window, wts, main_role)
        count = Counter(p for e in window for p in e.starters)
        share = {p: count[p] / len(window) for p, _ in xi}
    else:
        share = scores(window, wts)
        base = None if target.five else latest_eleven(window, main_role)
        xi, rep = guess(window, wts, main_role, removed, share, base)
        formation, spots = place(xi, rep, window, wts, main_role, latest=base is not None)
    named = {pick: r for r, _, pick in rep if pick is not None and r in absent and r not in gone}
    starters = [(p, pos, x, y, share[p], named.get(p)) for p, pos, x, y in spots]
    listed = [(p, e) for p, e in absent.items() if p not in gone]
    return {"formation": formation, "starters": starters, "absent": sorted(listed, key=lambda pe: _absent_order(*pe))}


def _absent_order(player, e):
    # As the site sorts a club's absences: the suspensions (fewest matches left first), the dated returns, the others.
    if e["kind"] == "suspension":
        return 0, e["remaining"] if e["remaining"] is not None else 99, player
    if e["end"] is not None:
        return 1, e["end"].toordinal(), player
    return 2, -e["start"].toordinal(), player


# -------------------------------------------------------------------------------------------- reads and writes

_DAY = "coalesce(m.match_date, (m.kickoff_at AT TIME ZONE 'UTC')::date)"
_AT = "coalesce(m.kickoff_at, m.match_date::timestamp AT TIME ZONE 'UTC')"
_QUARANTINED = """EXISTS (SELECT 1 FROM ops.provider_links k WHERE k.entity_type = 'player' AND k.provider = 'transfermarkt'
                  AND k.entity_id = {} AND k.quarantined_at IS NOT NULL)"""

# probable-v2: a match's competition type, as the study v4 reads it (its KIND): E a competition of
# forecast.LEAGUE_PHASE_CUPS (Champions, Europa and Conference League); NULL without an edition; O an archive edition;
# a PitchAPI edition L when its competition has a country (not INT…) and is neither a cup nor international; a cup
# source's edition L when it is an open-matchday league (not _CUP_); O otherwise. {cs}, {c}: the edition, the competition.
_KIND = """CASE WHEN EXISTS (SELECT 1 FROM core.provider_ids k WHERE k.entity_type = 'competition' AND k.provider = 'pitchapi'
                       AND k.entity_id = {cs}.competition_id AND k.provider_key = ANY(%(cups)s)) THEN 'E'
  WHEN {cs}.id IS NULL THEN NULL WHEN {cs}.archive_key IS NOT NULL THEN 'O'
  WHEN {cs}.cup_key IS NULL THEN CASE WHEN {c}.country_code IS NOT NULL AND left({c}.country_code, 3) <> 'INT'
    AND {c}.kind IS DISTINCT FROM 'cup' AND {c}.kind IS DISTINCT FROM 'international' THEN 'L' ELSE 'O' END
  WHEN {cs}.cup_key LIKE 'open-matchday:%%' AND split_part({cs}.cup_key, ':', 2) NOT LIKE '%%\\_CUP\\_%%' THEN 'L' ELSE 'O' END"""
# probable-v2: a team's latest Elo before {at}, the elo_after of its latest rated match (agg.team_elo holds finished ones).
_LATEST_ELO = """(SELECT x.elo_after FROM agg.team_elo x WHERE x.team_id = {team} AND x.kickoff_at < {at}
   ORDER BY x.kickoff_at DESC, x.match_id DESC LIMIT 1)"""

# With the match's competition type and each opponent's Elo (its elo_before in the match, else its latest).
TARGETS = f"""
SELECT m.id, m.season_id, {_DAY}, m.home_team_id, m.away_team_id, cs.competition_id, {_KIND.format(cs="cs", c="c")},
  coalesce(eh.elo_before, {_LATEST_ELO.format(team="m.home_team_id", at="m.kickoff_at")}),
  coalesce(ea.elo_before, {_LATEST_ELO.format(team="m.away_team_id", at="m.kickoff_at")})
FROM core.matches m
JOIN core.teams th ON th.id = m.home_team_id AND th.is_national IS NOT TRUE
JOIN core.teams ta ON ta.id = m.away_team_id AND ta.is_national IS NOT TRUE
LEFT JOIN core.competition_seasons cs ON cs.id = m.competition_season_id
LEFT JOIN core.competitions c ON c.id = cs.competition_id
LEFT JOIN agg.team_elo eh ON eh.match_id = m.id AND eh.team_id = m.home_team_id
LEFT JOIN agg.team_elo ea ON ea.match_id = m.id AND ea.team_id = m.away_team_id
WHERE m.status = 'not_started' AND m.kickoff_at > %(now)s AND m.kickoff_at <= %(until)s AND m.home_team_id <> m.away_team_id
ORDER BY m.kickoff_at, m.id"""
# Each team's last WINDOW complete confirmed elevens, most recent first. Per team, its finished matches of the lookback
# newest first (OFFSET 0 keeps the order and the count below it), the starters counted only until WINDOW are found; then,
# for those elevens only, the competition and its type, and the opponent's Elo (his elo_before in it, else his latest).
WINDOWS = f"""
SELECT t.team_id, w.season_id, w.match_id, w.day, w.formation, cs.competition_id, w.opponent_id, {_KIND.format(cs="cs", c="c")},
  coalesce(e.elo_before, {_LATEST_ELO.format(team="w.opponent_id", at="w.at")})
FROM unnest(%(teams)s::integer[]) AS t(team_id)
CROSS JOIN LATERAL (
  SELECT c.* FROM (
    SELECT l.season_id, l.match_id, {_DAY} AS day, l.formation, m.competition_season_id AS edition,
      CASE WHEN m.home_team_id = t.team_id THEN m.away_team_id ELSE m.home_team_id END AS opponent_id, {_AT} AS at
    FROM core.matches m
    JOIN core.lineups l ON l.season_id = m.season_id AND l.match_id = m.id AND l.team_id = t.team_id AND l.confirmed IS TRUE
    WHERE (m.home_team_id = t.team_id OR m.away_team_id = t.team_id) AND m.season_id >= %(first)s AND m.status = 'finished'
      AND {_AT} < %(now)s AND {_AT} >= %(since)s
    ORDER BY at DESC, m.id DESC OFFSET 0) c
  WHERE (SELECT count(*) FROM core.lineup_players p WHERE p.season_id = c.season_id AND p.match_id = c.match_id
         AND p.team_id = t.team_id AND p.is_starter) = {STARTERS}
  LIMIT %(window)s) w
LEFT JOIN core.competition_seasons cs ON cs.id = w.edition
LEFT JOIN core.competitions c ON c.id = cs.competition_id
LEFT JOIN agg.team_elo e ON e.match_id = w.match_id AND e.team_id = w.opponent_id
ORDER BY t.team_id, w.at DESC, w.match_id DESC"""
# probable-v2: the clubs of the five leagues (FAILURE_MODES.md §61.3) among the teams asked, by award year: a match,
# whatever its status, of a PitchAPI edition (no archive or cup key, as forecast.FITTED's) of a competition whose
# PitchAPI key is one of tm_history.LEAGUES, its day in [start, end). Each match's two teams are joined to the teams
# asked by equality (an OR of the two would compare every match with every team).
FIVE = f"""
SELECT DISTINCT s.team_id,
  extract(year FROM {_DAY})::integer - CASE WHEN extract(month FROM {_DAY}) >= 8 THEN 0 ELSE 1 END
FROM core.competition_seasons cs
JOIN core.matches m ON m.competition_season_id = cs.id AND m.season_id = cs.season_id
CROSS JOIN LATERAL (VALUES (m.home_team_id), (m.away_team_id)) AS s(team_id)
JOIN unnest(%(teams)s::integer[]) AS t(team_id) ON t.team_id = s.team_id
WHERE cs.archive_key IS NULL AND cs.cup_key IS NULL AND {_DAY} >= %(start)s AND {_DAY} < %(end)s
  AND EXISTS (SELECT 1 FROM core.provider_ids k WHERE k.entity_type = 'competition' AND k.provider = 'pitchapi'
              AND k.entity_id = cs.competition_id AND k.provider_key = ANY(%(leagues)s))"""
SHEETS = """
SELECT lp.match_id, lp.team_id, lp.player_id, coalesce(lp.is_starter, false), lp.position_id, lp.pitch_x, lp.pitch_y, lp.shirt_number,
  coalesce(s.minutes_played, 0) > 0
FROM unnest(%s::smallint[], %s::integer[], %s::integer[]) AS w(season_id, match_id, team_id)
JOIN core.lineup_players lp ON lp.season_id = w.season_id AND lp.match_id = w.match_id AND lp.team_id = w.team_id
LEFT JOIN core.player_match_stats s ON s.season_id = lp.season_id AND s.match_id = lp.match_id AND s.player_id = lp.player_id"""
MAIN_ROLES = """
SELECT DISTINCT ON (player_id) player_id, role FROM agg.player_power
WHERE player_id = ANY(%s) AND role IS NOT NULL ORDER BY player_id, season_id DESC"""
# A player's last appearance for each club of the scope: starter, or minutes off the bench, in a finished match. Only
# the matches since the club's window began are read: every player it is asked about came in that window.
LAST_APPEARANCES = f"""
SELECT t.team_id, lp.player_id, max({_DAY})
FROM unnest(%(teams)s::integer[], %(team_since)s::date[]) AS t(team_id, since)
JOIN core.matches m ON (m.home_team_id = t.team_id OR m.away_team_id = t.team_id) AND m.season_id >= %(first)s
JOIN core.lineup_players lp ON lp.season_id = m.season_id AND lp.match_id = m.id AND lp.team_id = t.team_id
LEFT JOIN core.player_match_stats s ON s.season_id = lp.season_id AND s.match_id = lp.match_id AND s.player_id = lp.player_id
WHERE m.status = 'finished' AND {_AT} < %(now)s AND {_DAY} >= t.since AND (lp.is_starter OR s.minutes_played > 0)
GROUP BY 1, 2"""
INJURIES = f"""
SELECT i.player_id, i.kind::text, i.label, i.start_date, i.end_date FROM core.player_injuries i
WHERE i.player_id = ANY(%s) AND i.source = 'transfermarkt' AND i.absent_since IS NULL AND i.start_date IS NOT NULL
  AND i.kind IS DISTINCT FROM 'suspension' AND NOT {_QUARANTINED.format("i.player_id")}"""
SUSPENSIONS = f"""
SELECT u.player_id, u.label, u.start_date, u.end_date, u.competition_id,
  CASE WHEN u.matches_possible IS NOT NULL AND u.matches_missed IS NOT NULL THEN greatest(u.matches_possible - u.matches_missed, 0) END,
  (SELECT max(r.read_at) FROM core.provider_ids i
   JOIN ops.transfermarkt_reads r ON r.kind = 'suspensions' AND r.provider_key = i.provider_key AND r.read_at IS NOT NULL
   WHERE i.entity_type = 'player' AND i.provider = 'transfermarkt' AND i.is_current AND i.entity_id = u.player_id)
FROM core.player_suspensions u
WHERE u.player_id = ANY(%s) AND u.source = 'transfermarkt' AND u.absent_since IS NULL AND NOT {_QUARANTINED.format("u.player_id")}"""
# A player's latest line-up with a club (a national team's does not count), of a match kicked off before now. Only from
# the first day of the windows he came in: he has a line-up there, so his latest is not before it.
LATEST_CLUBS = f"""
SELECT DISTINCT ON (lp.player_id) lp.player_id, lp.team_id
FROM unnest(%(players)s::integer[], %(player_since)s::date[]) AS w(player_id, since)
JOIN core.lineup_players lp ON lp.player_id = w.player_id AND lp.season_id >= %(first)s
JOIN core.matches m ON m.id = lp.match_id AND m.season_id = lp.season_id
JOIN core.teams t ON t.id = lp.team_id AND t.is_national IS NOT TRUE
WHERE {_AT} < %(now)s AND {_DAY} >= w.since
ORDER BY lp.player_id, {_AT} DESC, m.id DESC"""
# A club's current Transfermarkt squad, as api.team_absence_players reads it: the latest season held, its members not
# marked absent, the club's link current and not in quarantine; with the day it was read.
SQUADS = """
SELECT i.entity_id, q.player_key, q.read_on
FROM core.provider_ids i
JOIN LATERAL (SELECT max(s.season_year) AS year FROM core.provider_squads s
              WHERE s.provider = 'transfermarkt' AND s.club_key = i.provider_key AND s.absent_since IS NULL) last ON true
JOIN core.provider_squads q ON q.provider = 'transfermarkt' AND q.club_key = i.provider_key AND q.season_year = last.year
  AND q.absent_since IS NULL
WHERE i.entity_type = 'team' AND i.provider = 'transfermarkt' AND i.is_current AND i.entity_id = ANY(%s)
  AND NOT EXISTS (SELECT 1 FROM ops.provider_links k WHERE k.entity_type = 'team' AND k.provider = 'transfermarkt'
                  AND k.provider_key = i.provider_key AND k.quarantined_at IS NOT NULL)"""
PLAYER_LINKS = """
SELECT i.entity_id, i.provider_key FROM core.provider_ids i
WHERE i.entity_type = 'player' AND i.provider = 'transfermarkt' AND i.is_current AND i.entity_id = ANY(%s)
  AND NOT EXISTS (SELECT 1 FROM ops.provider_links k WHERE k.entity_type = 'player' AND k.provider = 'transfermarkt'
                  AND k.provider_key = i.provider_key AND k.quarantined_at IS NOT NULL)"""


def _windows(conn, teams, now, n=WINDOW):
    """{team: [Entry]} (oldest first): its last `n` complete confirmed elevens, for the teams with MIN_RECENT or more."""
    args = {"teams": sorted(teams), "now": now, "since": now - LOOKBACK, "first": (now - LOOKBACK).year - 1, "window": n,
            "cups": list(LEAGUE_PHASE_CUPS)}
    rows = conn.execute(WINDOWS, args).fetchall()
    keys = [(season, match, team) for team, season, match, *_ in rows]
    sheets = defaultdict(list)
    if keys:
        for row in conn.execute(SHEETS, ([k[0] for k in keys], [k[1] for k in keys], [k[2] for k in keys])).fetchall():
            sheets[(row[0], row[1])].append(row[2:])
    found = defaultdict(list)
    for team, season, match, day, formation, competition, opponent, ctype, opp_elo in rows:
        sheet = sheets[(match, team)]
        starters = tuple(p for p, starter, *_ in sheet if starter)
        top = max((pos for p, starter, pos, *_ in sheet if starter and pos), default=0)
        roles = {p: role_of(formation, pos, top) for p, starter, pos, *_ in sheet if starter}
        came = frozenset(p for p, starter, *_, played in sheet if starter or played)
        roles.update({p: None for p in came if p not in roles})
        spots = {p: (pos, x, y) for p, starter, pos, x, y, *_ in sheet if starter}
        shirts = {p: shirt for p, _, _, _, _, shirt, _ in sheet if shirt is not None}
        found[team].append(Entry(day, starters, roles, came, match, competition, opponent, formation, spots, shirts,
                                 frozenset(p for p, *_ in sheet), ctype, opp_elo))
    return {team: entries[::-1] for team, entries in found.items() if len(entries) >= MIN_RECENT}


def five_clubs(conn, teams, years):
    """{(team, award year)} of `teams` that are of the five leagues in one of `years` (FIVE; FAILURE_MODES.md §61.3)."""
    from .sources.tm_history import LEAGUES  # vega.sources imports psycopg: read only where the base is

    years = set(years)
    if not teams or not years:
        return set()
    args = {"teams": sorted(teams), "leagues": sorted(LEAGUES.values()), "start": award_year(min(years))[0],
            "end": award_year(max(years))[1]}
    return {(team, year) for team, year in conn.execute(FIVE, args).fetchall() if year in years}


def compute(conn, now, method=METHOD):
    """Every side in scope: [(Target, window, result of predict by `method`)]. Reads only."""
    until = now + HORIZON
    targets = []
    for match, season, day, home, away, competition, ctype, home_elo, away_elo in conn.execute(
            TARGETS, {"now": now, "until": until, "cups": list(LEAGUE_PHASE_CUPS)}).fetchall():
        targets.append(Target(match, season, day, home, away, "home", competition, ctype, away_elo))
        targets.append(Target(match, season, day, away, home, "away", competition, ctype, home_elo))
    if not targets:
        return []
    # probable-v3 reads each club's last LONG elevens (the history of its permitted lines); the window is the last WINDOW.
    histories = _windows(conn, {t.team_id for t in targets}, now, LONG if method == "probable-v3" else WINDOW)
    windows = {team: entries[-WINDOW:] for team, entries in histories.items()}
    targets = [t for t in targets if t.team_id in windows]
    if not targets:
        return []
    five = five_clubs(conn, {t.team_id for t in targets}, {year_of(t.day) for t in targets})
    targets = [t._replace(five=(t.team_id, year_of(t.day)) in five) for t in targets]
    since = {}
    for entries in windows.values():
        for p in {p for e in entries for p in e.came}:
            since[p] = min(entries[0].day, since.get(p, entries[0].day))
    players = sorted(since)
    teams = sorted(windows)
    args = {"players": players, "player_since": [since[p] for p in players], "teams": teams,
            "team_since": [windows[t][0].day for t in teams], "now": now, "first": (now - LOOKBACK).year - 1}
    # The main roles of the windows' players, and of every starter of the histories (the role shares count them).
    roles = dict(conn.execute(MAIN_ROLES, (sorted(set(players) | {p for h in histories.values() for e in h for p in e.starters}),)).fetchall())
    last_app = {(team, p): day for team, p, day in conn.execute(LAST_APPEARANCES, args).fetchall()}
    injuries = defaultdict(list)
    for p, kind, label, start, end in conn.execute(INJURIES, (players,)).fetchall():
        injuries[p].append({"kind": kind, "label": label, "start": start, "end": end, "remaining": None})
    suspensions = defaultdict(list)
    for p, label, start, end, competition, remaining, read_at in conn.execute(SUSPENSIONS, (players,)).fetchall():
        suspensions[p].append({"kind": "suspension", "label": label, "start": start, "end": end, "competition_id": competition,
                               "remaining": remaining, "read_on": read_at.astimezone(now.tzinfo).date() if read_at else None})
    latest_club = dict(conn.execute(LATEST_CLUBS, args).fetchall())
    squads, squad_read = defaultdict(set), {}
    for team, key, read_on in conn.execute(SQUADS, (teams,)).fetchall():
        squads[team].add(key)
        squad_read[team] = max(read_on, squad_read.get(team, read_on))
    links = defaultdict(set)
    for p, key in conn.execute(PLAYER_LINKS, (players,)).fetchall():
        links[p].add(key)
    today = now.date()
    main_role = roles.get
    shares = role_shares([e for h in histories.values() for e in h], main_role) if method == "probable-v3" else None
    out = []
    for t in targets:
        window = windows[t.team_id]
        came = {p for e in window for p in e.came}
        gone = set()
        for p in came:
            if latest_club.get(p, t.team_id) != t.team_id:
                gone.add(p)
            elif (t.team_id in squads and links[p] and not links[p] & squads[t.team_id]
                  and squad_read[t.team_id] >= last_app.get((t.team_id, p), window[-1].day)):
                gone.add(p)
        absent = {}
        for p in came - gone:
            applies = [s for s in suspensions.get(p, ()) if suspension_applies(s, t.competition_id, t.day, today)]
            if applies:
                absent[p] = max(applies, key=lambda s: s["start"])
                continue
            episode = injury_absence(injuries.get(p, ()), last_app.get((t.team_id, p)), t.day)
            if episode is not None:
                absent[p] = episode
        out.append((t, window, predict(window, t, main_role, absent, gone, method, histories[t.team_id], shares)))
    return out


def refresh(conn, now, method=METHOD):
    """Compute every side in scope by `method`, then replace the stored rows in one transaction (the rows of a match out
    of scope go). Returns {"matches", "sides", "deleted"}: matches and sides written, sides held before and not written
    again. Nothing but agg.match_probable_lineups and agg.match_probable_lineup_players is written."""
    sides = compute(conn, now, method)
    side_rows, player_rows = [], []
    for t, window, result in sides:
        side_rows.append((t.match_id, t.season_id, t.team_id, t.side, method, now, len(window), window[0].day, window[-1].day,
                          result["formation"]))
        shirt = {}
        for e in window:
            shirt.update(e.shirts)
        for k, (p, pos, x, y, share, replaces) in enumerate(result["starters"]):
            player_rows.append((t.match_id, t.team_id, p, "starter", k, shirt.get(p), pos, x, y, share, replaces, None, None, None, None))
        for k, (p, e) in enumerate(result["absent"]):
            player_rows.append((t.match_id, t.team_id, p, "absent", k, shirt.get(p), None, None, None, None, None, e["kind"], e["label"],
                                e["end"], e["remaining"]))
    written = {(r[0], r[2]) for r in side_rows}
    with conn.transaction():
        held = set(conn.execute("SELECT match_id, team_id FROM agg.match_probable_lineups").fetchall())
        conn.execute("DELETE FROM agg.match_probable_lineup_players")
        conn.execute("DELETE FROM agg.match_probable_lineups")
        with conn.cursor() as cur:
            for table, columns, rows in (
                    ("agg.match_probable_lineups", "match_id, season_id, team_id, side, method, computed_at, basis_lineups, basis_from, "
                     "basis_to, formation", side_rows),
                    ("agg.match_probable_lineup_players", "match_id, team_id, player_id, role, ord, shirt_number, position_id, pitch_x, "
                     "pitch_y, share, replaces_player_id, absence_kind, absence_label, expected_return, matches_remaining", player_rows)):
                with cur.copy(f"COPY {table}({columns}) FROM STDIN") as copy:
                    for row in rows:
                        copy.write_row(row)
    return {"matches": len({r[0] for r in side_rows}), "sides": len(side_rows), "deleted": len(held - written)}
