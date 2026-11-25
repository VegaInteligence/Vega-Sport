"""Our probable eleven of each club before the provider's line-ups (« Composition probable »).

Display only (FAILURE_MODES.md §61; hugo, 25 Nov 2026): the forecast, the line-up model (lineup.py), the rankings and
core.lineups neither read nor receive anything of it. The match page shows it for a side the provider has sent no
line-up for yet.

The method, probable-v1, is the study's P5 (blesses-suspendus/onze-probable/etude_onze_probable.py: `guess()` and the
absence rule « B connue »), measured there before it was chosen:
- the window: the club's last WINDOW complete confirmed elevens (11 starters, `confirmed` true, a finished match, any
  competition, within LOOKBACK), each weighted 0.8^k, k = 0 for the most recent; fewer than MIN_RECENT: no eleven;
- the eleven: the line split of greatest weight, in each line the players most started (weighted), and a removed
  player replaced by the most used available player of his line (a keeper only by a keeper);
- removed: the absent (an injury or illness started before the match day with no match for his club since; a
  suspension of the match's competition, as the site's `absenceApplies`) and the gone (his latest club line-up is
  another club's, or the club's Transfermarkt squad read after his last appearance does not hold him).

A later method weighs each past eleven otherwise (the competition, the opponent): `window_weights` is the one place a
window's weights are computed and `predict` the one function a method label goes through; the tables, the route and
the site read `method` from the rows.
"""

from collections import Counter, defaultdict, namedtuple
from datetime import timedelta
from math import hypot

from .power import role_of

METHOD = "probable-v1"
WINDOW = 10  # the club's last complete confirmed elevens, every competition
MIN_RECENT = 5  # below this many in the window: no probable eleven for that side
DECAY = 0.8  # weight 0.8^k, k = 0 for the most recent eleven
STARTERS = 11
HORIZON = timedelta(days=7)  # matches not started whose kick-off falls in ]now, now + HORIZON]
LOOKBACK = timedelta(days=400)  # elevens and appearances looked for in the LOOKBACK before now
FRESH_DAYS = 45  # a suspension without an end counts while the player's suspensions were read this recently (174)
EVERY = timedelta(minutes=15)  # the worker's step runs at most this often

LINE = {"goalkeeper": "G", "centre_back": "D", "full_back": "D", "defensive_midfielder": "M", "central_midfielder": "M",
        "wide_midfielder": "M", "attacking_midfielder": "M", "winger": "A", "centre_forward": "A"}
LINES = ("G", "D", "M", "A", "?")

# One eleven of a window, the oldest first. Its first four fields are the study's entry: (day, starters, {player:
# role}, players who appeared); then the match, its competition and the opponent (what a later method may weigh by),
# the formation, {starter: (position_id, pitch_x, pitch_y)} and {player: shirt number}.
Entry = namedtuple("Entry", "day starters roles came match_id competition_id opponent_id formation spots shirts")
# A side to guess: its match, season, day (UTC), team, opponent, side and the match's competition.
Target = namedtuple("Target", "match_id season_id day team_id opponent_id side competition_id")


def weights(n, decay=DECAY):
    return [decay ** (n - 1 - i) for i in range(n)]


def window_weights(method, window, target):
    """Each eleven's weight in `window` (oldest first) for the match `target`: the one place a method weighs them."""
    if method == "probable-v1":
        return weights(len(window))
    raise ValueError(f"unknown method {method!r}")


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


def guess(entries, wts, main_role, gone=frozenset()):
    """The guessed eleven of a window (oldest first, weights of the same length): ([(player, line)], [(removed, line,
    replacement or None)]). The study's `guess()` as measured: the split of greatest weight (ties: the most recent);
    in each line the most started (weight), then the most appeared, then the most recent appearance, then the smallest
    id; a player's line is that of his starts. A removed player is replaced by the most used available player of his
    line, else of another (a keeper by a keeper, an outfield player by an outfield one)."""
    starts, apps, last, lines_of, _, shape = _tally(entries, wts, main_role)
    line = {}
    for p in apps:
        lc = lines_of.get(p)
        line[p] = max(sorted(lc), key=lambda x: (round(lc[x], 9), x)) if lc else LINE.get(main_role(p), "?")  # never a starter: his role

    def key(p):
        return round(starts[p], 9), round(apps[p], 9), last.get(p, -1), -p

    habitual, taken = [], set()
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


def place(xi, rep, window, wts, main_role):
    """Each guessed player's slot: (formation, [(player, position_id, pitch_x, pitch_y)] in the template's order).

    The template: among the elevens of the chosen split, the formation of greatest weight (ties: the most recent) and
    its most recent eleven whose starters' places are all known (else the most recent of the split that has them,
    else none: the places stay empty). A guessed player who started in it keeps his slot; a replacement takes the
    removed player's slot when it is free; the others, most used first, the free slot nearest their weighted mean
    place in the window (ties: the template's order)."""
    starts, apps, last, _, shapes, chosen = _tally(window, wts, main_role)
    split = [i for i in range(len(window)) if shapes[i] == chosen]
    weight = Counter()
    for i in split:
        weight[window[i].formation] += wts[i]
    top = max(weight.values())
    formation = next(window[i].formation for i in reversed(split) if weight[window[i].formation] > top - 1e-9)
    template = next((window[i] for i in reversed(split) if window[i].formation == formation and _complete(window[i])), None) \
        or next((window[i] for i in reversed(split) if _complete(window[i])), None)
    if template is None:
        return formation, [(p, None, None, None) for p, _ in xi]
    slots = sorted(((template.spots[p], p) for p in template.starters), key=lambda s: (s[0][1], s[0][2], s[0][0] or 0, s[1]))
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
    placed = sorted(((slot_of[p], p) for p, _ in xi if p in slot_of))
    out = [(p, *slots[k][0]) for k, p in placed]
    return formation, out + [(p, None, None, None) for p, _ in xi if p not in slot_of]


def predict(window, target, main_role, absent, gone, method=METHOD):
    """One side's probable eleven by `method`: {formation, starters: [(player, position_id, pitch_x, pitch_y, share,
    replaces)], absent: [(player, episode)]}. `absent` {player: episode} and `gone` {player} are the window's removed
    players; an absent one is listed and named by his replacement, a gone one neither."""
    wts = window_weights(method, window, target)
    xi, rep = guess(window, wts, main_role, frozenset(absent) | frozenset(gone))
    formation, spots = place(xi, rep, window, wts, main_role)
    named = {pick: r for r, _, pick in rep if pick is not None and r in absent and r not in gone}
    count = Counter(p for e in window for p in e.starters)
    starters = [(p, pos, x, y, count[p] / len(window), named.get(p)) for p, pos, x, y in spots]
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

TARGETS = f"""
SELECT m.id, m.season_id, {_DAY}, m.home_team_id, m.away_team_id, cs.competition_id
FROM core.matches m
JOIN core.teams th ON th.id = m.home_team_id AND th.is_national IS NOT TRUE
JOIN core.teams ta ON ta.id = m.away_team_id AND ta.is_national IS NOT TRUE
LEFT JOIN core.competition_seasons cs ON cs.id = m.competition_season_id
WHERE m.status = 'not_started' AND m.kickoff_at > %(now)s AND m.kickoff_at <= %(until)s AND m.home_team_id <> m.away_team_id
ORDER BY m.kickoff_at, m.id"""
# Each team's last WINDOW complete confirmed elevens, most recent first. Per team, its finished matches of the lookback
# newest first (OFFSET 0 keeps the order and the count below it), the starters counted only until WINDOW are found.
WINDOWS = f"""
SELECT t.team_id, w.season_id, w.match_id, w.day, w.formation, w.competition_id, w.opponent_id
FROM unnest(%(teams)s::integer[]) AS t(team_id)
CROSS JOIN LATERAL (
  SELECT c.* FROM (
    SELECT l.season_id, l.match_id, {_DAY} AS day, l.formation, cs.competition_id,
      CASE WHEN m.home_team_id = t.team_id THEN m.away_team_id ELSE m.home_team_id END AS opponent_id, {_AT} AS at
    FROM core.matches m
    JOIN core.lineups l ON l.season_id = m.season_id AND l.match_id = m.id AND l.team_id = t.team_id AND l.confirmed IS TRUE
    LEFT JOIN core.competition_seasons cs ON cs.id = m.competition_season_id
    WHERE (m.home_team_id = t.team_id OR m.away_team_id = t.team_id) AND m.season_id >= %(first)s AND m.status = 'finished'
      AND {_AT} < %(now)s AND {_AT} >= %(since)s
    ORDER BY at DESC, m.id DESC OFFSET 0) c
  WHERE (SELECT count(*) FROM core.lineup_players p WHERE p.season_id = c.season_id AND p.match_id = c.match_id
         AND p.team_id = t.team_id AND p.is_starter) = {STARTERS}
  LIMIT %(window)s) w
ORDER BY t.team_id, w.at DESC, w.match_id DESC"""
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


def _windows(conn, teams, now):
    """{team: [Entry]} (oldest first) of the teams with MIN_RECENT complete confirmed elevens or more."""
    args = {"teams": sorted(teams), "now": now, "since": now - LOOKBACK, "first": (now - LOOKBACK).year - 1, "window": WINDOW}
    rows = conn.execute(WINDOWS, args).fetchall()
    keys = [(season, match, team) for team, season, match, *_ in rows]
    sheets = defaultdict(list)
    if keys:
        for row in conn.execute(SHEETS, ([k[0] for k in keys], [k[1] for k in keys], [k[2] for k in keys])).fetchall():
            sheets[(row[0], row[1])].append(row[2:])
    found = defaultdict(list)
    for team, season, match, day, formation, competition, opponent in rows:
        sheet = sheets[(match, team)]
        starters = tuple(p for p, starter, *_ in sheet if starter)
        top = max((pos for p, starter, pos, *_ in sheet if starter and pos), default=0)
        roles = {p: role_of(formation, pos, top) for p, starter, pos, *_ in sheet if starter}
        came = frozenset(p for p, starter, *_, played in sheet if starter or played)
        roles.update({p: None for p in came if p not in roles})
        spots = {p: (pos, x, y) for p, starter, pos, x, y, *_ in sheet if starter}
        shirts = {p: shirt for p, _, _, _, _, shirt, _ in sheet if shirt is not None}
        found[team].append(Entry(day, starters, roles, came, match, competition, opponent, formation, spots, shirts))
    return {team: entries[::-1] for team, entries in found.items() if len(entries) >= MIN_RECENT}


def compute(conn, now):
    """Every side in scope: [(Target, window, result of predict)]. Reads only."""
    until = now + HORIZON
    targets = []
    for match, season, day, home, away, competition in conn.execute(TARGETS, {"now": now, "until": until}).fetchall():
        targets.append(Target(match, season, day, home, away, "home", competition))
        targets.append(Target(match, season, day, away, home, "away", competition))
    if not targets:
        return []
    windows = _windows(conn, {t.team_id for t in targets}, now)
    targets = [t for t in targets if t.team_id in windows]
    if not targets:
        return []
    since = {}
    for entries in windows.values():
        for p in {p for e in entries for p in e.came}:
            since[p] = min(entries[0].day, since.get(p, entries[0].day))
    players = sorted(since)
    teams = sorted(windows)
    args = {"players": players, "player_since": [since[p] for p in players], "teams": teams,
            "team_since": [windows[t][0].day for t in teams], "now": now, "first": (now - LOOKBACK).year - 1}
    roles = dict(conn.execute(MAIN_ROLES, (players,)).fetchall())
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
        out.append((t, window, predict(window, t, main_role, absent, gone)))
    return out


def refresh(conn, now):
    """Compute every side in scope, then replace the stored rows in one transaction (the rows of a match out of scope
    go). Returns {"matches", "sides", "deleted"}: matches and sides written, sides held before and not written again.
    Nothing but agg.match_probable_lineups and agg.match_probable_lineup_players is written."""
    sides = compute(conn, now)
    side_rows, player_rows = [], []
    for t, window, result in sides:
        side_rows.append((t.match_id, t.season_id, t.team_id, t.side, METHOD, now, len(window), window[0].day, window[-1].day,
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
