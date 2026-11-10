"""Collect sourced player honours for the AWS supplemental projections.

Only join a PitchAPI player to Wikidata when the name and an observed team
identify exactly one footballer. The Wikipedia honours section is an incomplete
source, so an empty or unavailable section must never be interpreted as zero.
"""

import json
import re
import time
import unicodedata
from calendar import monthrange
from datetime import datetime, timezone
from html.parser import HTMLParser
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen


USER_AGENT = "StatArena/1.0 (https://github.com/OrionQuantPlatform/STATARENA)"
WIKIDATA = "https://www.wikidata.org/w/api.php"
WIKIPEDIA = "https://en.wikipedia.org/w/api.php"
MESSI_ID = "p_1mZO3B"
SEASON = re.compile(r"\b(?:18|19|20)\d{2}(?:\s*[–—−/-]\s*(?:\d{4}|\d{2}))?\b")
PLACEMENT = re.compile(r"\b(?:runner[ -]?up|runners[ -]?up|second place|third place|silver medal|bronze medal)\b", re.I)
IGNORED_AWARD = re.compile(
    r"\b(?:man of the match|player of the match|player of the (?:month|week)|"
    r"team of the (?:year|season|month|week)|squad of the (?:year|season)|"
    r"goal of the (?:month|week)|team of the tournament|dream team|world team|world xi|world 11)\b",
    re.I,
)


def api(url, **params):
    params.setdefault("format", "json")
    request = Request(url + "?" + urlencode(params), headers={"User-Agent": USER_AGENT})
    with urlopen(request, timeout=20) as response:
        result = json.load(response)
    if "error" in result:
        raise ValueError("MediaWiki API error: " + str(result["error"].get("code")))
    return result


def normalized(value):
    value = unicodedata.normalize("NFKD", value or "")
    value = "".join(ch for ch in value if not unicodedata.combining(ch)).casefold()
    return re.sub(r"[^a-z0-9]+", " ", value).strip()


def team_names(value):
    name = normalized(value)
    # Common club suffixes vary by language; never discard a distinctive word.
    stripped = re.sub(r"(?:\s+(?:f c|fc|c f|cf|a f c|afc))+$", "", name).strip()
    return {name, stripped} - {""}


def names(entity):
    labels = [item.get("value", "") for item in entity.get("labels", {}).values()]
    aliases = [item.get("value", "") for group in entity.get("aliases", {}).values() for item in group]
    return labels + aliases


def value_id(statement):
    return statement.get("mainsnak", {}).get("datavalue", {}).get("value", {}).get("id")


def qualifier_date(statement, prop):
    values = statement.get("qualifiers", {}).get(prop, [])
    dates = []
    for item in values:
        value = item.get("datavalue", {}).get("value", {})
        match = re.match(r"^\+(\d{4})-(\d{2})-(\d{2})", value.get("time", ""))
        if not match:
            continue
        year, month, day = map(int, match.groups())
        if not month:
            month = 1 if prop == "P580" else 12
        if not day:
            day = 1 if prop == "P580" else monthrange(year, month)[1]
        dates.append(f"{year:04d}-{month:02d}-{day:02d}")
    return dates


def overlaps(statement, day):
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day or ""):
        return True
    starts, ends = qualifier_date(statement, "P580"), qualifier_date(statement, "P582")
    return not ((starts and min(starts) > day) or (ends and max(ends) < day))


def entities(ids, props="labels|aliases|claims|sitelinks"):
    if not ids:
        return {}
    result = {}
    for start in range(0, len(ids), 50):
        result.update(api(WIKIDATA, action="wbgetentities", ids="|".join(ids[start:start + 50]),
                          props=props, languages="en|fr|es|de|it|pt").get("entities", {}))
    return result


def resolve_player(name, observations):
    """Return a unique Wikidata entity, or None when the join is ambiguous."""
    result = api(WIKIDATA, action="wbsearchentities", search=name, language="en", type="item", limit=50)
    search = result.get("search", [])
    if len(search) >= 50:
        return None
    ids = [row["id"] for row in search if re.fullmatch(r"Q[1-9]\d*", row.get("id", ""))]
    candidates = entities(ids)
    exact = {qid: entity for qid, entity in candidates.items()
             if normalized(name) in {normalized(n) for n in names(entity)}
             and any(value_id(s) == "Q5" and s.get("rank") != "deprecated" for s in entity.get("claims", {}).get("P31", []))
             and entity.get("sitelinks", {}).get("enwiki", {}).get("title")}
    team_ids = sorted({value_id(s) for entity in exact.values()
                       for s in entity.get("claims", {}).get("P54", [])
                       if s.get("rank") != "deprecated" and value_id(s)})
    teams = entities(team_ids, props="labels|aliases")
    matched = []
    for qid, entity in exact.items():
        for statement in entity.get("claims", {}).get("P54", []):
            if statement.get("rank") == "deprecated":
                continue
            team = teams.get(value_id(statement), {})
            variants = set().union(*(team_names(n) for n in names(team))) if team else set()
            if any(team_names(item["team"]) & variants and overlaps(statement, item.get("date")) for item in observations):
                matched.append((qid, entity))
                break
    return matched[0] if len(matched) == 1 else None


class HonoursHTML(HTMLParser):
    """Read top-level award lists and their team/individual headings."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.section = None
        self.in_paragraph = False
        self.in_bold = False
        self.heading = []
        self.item = None
        self.list_depth = 0
        self.suppressed = 0
        self.items = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if self.suppressed:
            self.suppressed += 1
            return
        if tag in ("sup", "style", "script") or "mw-editsection" in attrs.get("class", ""):
            self.suppressed = 1
            return
        if tag == "p" and self.list_depth == 0:
            self.in_paragraph, self.heading = True, []
        elif tag in ("b", "strong") and self.in_paragraph:
            self.in_bold = True
        elif tag == "ul":
            self.list_depth += 1
        elif tag == "li" and self.list_depth == 1:
            self.item = []

    def handle_endtag(self, tag):
        if self.suppressed:
            self.suppressed -= 1
            return
        if tag in ("b", "strong"):
            self.in_bold = False
        elif tag == "p" and self.in_paragraph:
            heading = " ".join("".join(self.heading).split()).strip(" :")
            if heading:
                self.section = heading
            self.in_paragraph = False
        elif tag == "li" and self.list_depth == 1 and self.item is not None:
            self.items.append((self.section, " ".join("".join(self.item).split())))
            self.item = None
        elif tag == "ul":
            self.list_depth = max(0, self.list_depth - 1)

    def handle_data(self, text):
        if self.suppressed:
            return
        if self.in_bold and self.in_paragraph:
            self.heading.append(text)
        if self.item is not None and self.list_depth == 1:
            self.item.append(text)


def parse_honours(html):
    parser = HonoursHTML()
    parser.feed(html)
    rows = []
    for team, item in parser.items:
        if not team or ":" not in item:
            continue
        if re.search(r"\b(?:orders|decorations|honorific|honorary degrees)\b", normalized(team)):
            continue
        name, seasons_text = (part.strip() for part in item.split(":", 1))
        if not name or PLACEMENT.search(name):
            continue
        # A list may contain winners and runners-up in the same bullet.
        seasons_text = re.split(r";\s*(?:runner[ -]?up|runners[ -]?up|second place|third place|silver medal|bronze medal)\s*:", seasons_text, flags=re.I)[0]
        individual = normalized(team) in {"individual", "individual awards", "individual honours"}
        if individual and IGNORED_AWARD.search(name):
            continue
        seasons = []
        for value in SEASON.findall(seasons_text):
            season = re.sub(r"\s*[—−/-]\s*", "–", value).replace(" ", "")
            full = re.fullmatch(r"(\d{4})–(\d{4})", season)
            if full and int(full.group(2)) == int(full.group(1)) + 1:
                season = full.group(1) + "–" + full.group(2)[-2:]
            if season not in seasons:
                seasons.append(season)
        if seasons:
            rows.append({"name": name, "team": None if individual else team,
                         "category": "individual" if individual else "team", "seasons": seasons})
    return rows


def collect_player(name, observations):
    identity = resolve_player(name, observations)
    if not identity:
        return None
    qid, entity = identity
    title = entity["sitelinks"]["enwiki"]["title"]
    info = api(WIKIPEDIA, action="parse", page=title, prop="sections")
    section = next((s for s in info.get("parse", {}).get("sections", [])
                    if re.fullmatch(r"hono[u]?rs", s.get("line", ""), re.I)), None)
    if not section:
        return None
    parsed = api(WIKIPEDIA, action="parse", page=title, section=section["index"], prop="text|revid").get("parse", {})
    rows = parse_honours(parsed.get("text", {}).get("*", ""))
    if not rows:
        return None
    return {"available": True, "source": "Wikipédia", "identitySourceUrl": "https://www.wikidata.org/wiki/" + qid,
            "sourceUrl": "https://en.wikipedia.org/w/index.php?title=" + quote(title.replace(" ", "_"))
                         + "&oldid=" + str(parsed.get("revid")) + "#Honours",
            "revision": parsed.get("revid"), "fetchedAt": datetime.now(timezone.utc).isoformat(),
            "honours": rows}


def unpack(table):
    keys, dictionaries = table["keys"], table.get("dictionaries", {})
    for row in table["rows"]:
        yield {key: dictionaries[str(index)][value] if value is not None and str(index) in dictionaries else value
               for index, (key, value) in enumerate(zip(keys, row))}


def candidates_from_manifest(store, seasons=None, player_id=None):
    seasons = seasons if seasons is not None else store.json("computed/dashboard/index.json").get("seasons", [])
    players = {}
    for season in seasons:
        for chunk in season.get("chunks", []):
            tables = store.json(chunk["path"])["tables"]
            details = {p["id"]: p for p in unpack(tables["players"])}
            for performance in unpack(tables["performances"]):
                if player_id and performance.get("playerId") != player_id:
                    continue
                player = details.get(performance.get("playerRef")) or {}
                pid, name, team = performance.get("playerId"), player.get("name"), performance.get("team")
                if not (pid and name and team and (performance.get("minutes") or 0) > 0):
                    continue
                entry = players.setdefault(pid, {"name": name, "observations": {}, "minutes": 0})
                entry["minutes"] += performance["minutes"]
                day = performance.get("date") or ""
                key = (name, team)
                if day > entry["observations"].get(key, ""):
                    entry["observations"][key] = day
    return players


def refresh_seasons(seasons, rotation):
    """Alternate current players with one older season, each with its own cursor."""
    if rotation % 2 == 0 or len(seasons) <= 2:
        return "recent", seasons[:2]
    season = seasons[2 + (rotation // 2) % (len(seasons) - 2)]
    return season["id"], [season]


def player_candidate(store, manifest, player_id):
    """Read only the archived competition partitions that contain this player."""
    path = manifest.get("scouting", {}).get("playerRoutes", {}).get("path")
    routes = store.json(path).get("routes", {}).get(player_id, {}) if path else {}
    seasons = [
        {**season, "chunks": [c for c in season.get("chunks", []) if c["leagueId"] in routes.get(season["id"], [])]}
        for season in manifest.get("seasons", [])
        if season["id"] in routes
    ]
    if not seasons:
        seasons = manifest.get("seasons", [])[:2]
    return candidates_from_manifest(store, seasons, player_id).get(player_id)


def run(limit=100, player_id=None):
    from aws_store import Store, canonical
    from psycopg.types.json import Jsonb

    store = Store()
    manifest = store.json("computed/dashboard/index.json")
    rotation_row = store.db.execute("select value from statarena.state where name='player_honours_rotation'").fetchone()
    rotation = int(rotation_row[0]) if rotation_row else 0
    scope, seasons = refresh_seasons(manifest.get("seasons", []), rotation)
    if player_id:
        candidate = player_candidate(store, manifest, player_id)
        if not candidate:
            raise ValueError("Player is absent from the collected match data")
        players = {player_id: candidate}
        scope = "target"
    else:
        players = candidates_from_manifest(store, seasons)
        if MESSI_ID not in players:
            try:
                candidate = player_candidate(store, manifest, MESSI_ID)
            except Exception as error:
                print(json.dumps({"player": MESSI_ID, "error": type(error).__name__}), flush=True)
                candidate = None
            if candidate:
                players[MESSI_ID] = candidate
    # Prioritise frequently observed players, while moving past every attempted
    # candidate. Do not overwrite a previously successful projection on errors.
    ordered = sorted(players, key=lambda pid: (-players[pid]["minutes"], pid))
    cursor_name = "player_honours_cursor:" + scope
    state = store.db.execute("select value from statarena.state where name=%s", (cursor_name,)).fetchone()
    start = int(state[0]) % max(1, len(ordered)) if state else 0
    recent = set() if player_id else {json.loads(row[0]).get("id") for row in store.db.execute(
        "select params from statarena.projections where name='player-honours' and updated_at > now() - interval '7 days'"
    ).fetchall()}
    if not player_id and MESSI_ID in recent:
        fresh_messi = store.db.execute(
            "select 1 from statarena.projections where name='player-honours' and params=%s and updated_at > now() - interval '1 day'",
            (canonical({"id": MESSI_ID}),),
        ).fetchone()
        if not fresh_messi:
            recent.discard(MESSI_ID)
    success = unresolved = failed = attempts = advanced = 0
    priority = [MESSI_ID] if not player_id and MESSI_ID in players and MESSI_ID not in recent else []
    sequence = [(pid, False) for pid in priority] + [
        (ordered[(start + i) % len(ordered)], True) for i in range(len(ordered))
    ]
    seen = set()
    for pid, advances in sequence:
        if attempts >= limit:
            break
        if advances:
            advanced += 1
        if pid in recent or pid in seen:
            continue
        seen.add(pid)
        attempts += 1
        entry = players[pid]
        try:
            by_name = {}
            for (name, team), day in entry["observations"].items():
                by_name.setdefault(name, []).append({"team": team, "date": day})
            results = [collect_player(name, observations) for name, observations in by_name.items()]
            found = [result for result in results if result]
            identities = {result["identitySourceUrl"] for result in found}
            if len(identities) == 1:
                body = found[0]
                store.db.execute("insert into statarena.projections(name,params,body) values(%s,%s,%s) on conflict(name,params) do update set body=excluded.body,updated_at=now()",
                                 ("player-honours", canonical({"id": pid}), Jsonb(body)))
                success += 1
            else:
                unresolved += 1
        except Exception as error:
            failed += 1
            print(json.dumps({"player": pid, "error": type(error).__name__}), flush=True)
        # Commit progress only after the candidate has finished. Priority Messi
        # is outside the rotating sequence and must not move its cursor.
        if not player_id and advances:
            store.db.execute("insert into statarena.state(name,value) values(%s,%s) on conflict(name) do update set value=excluded.value,updated_at=now()",
                             (cursor_name, Jsonb((start + advanced) % max(1, len(ordered)))))
        time.sleep(0.2)
    if not player_id:
        store.db.execute("insert into statarena.state(name,value) values(%s,%s) on conflict(name) do update set value=excluded.value,updated_at=now()",
                         (cursor_name, Jsonb((start + advanced) % max(1, len(ordered)))))
        store.db.execute("insert into statarena.state(name,value) values('player_honours_rotation',%s) on conflict(name) do update set value=excluded.value,updated_at=now()",
                         (Jsonb(rotation + 1),))
    store.db.close()
    print(json.dumps({"playerHonours": {"scope": scope, "success": success, "unresolved": unresolved, "failed": failed, "candidates": len(ordered)}}))
    if player_id and not success:
        raise RuntimeError("No verified honours were collected for the requested player")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=100)
    parser.add_argument("--player-id")
    args = parser.parse_args()
    run(max(0, args.limit), args.player_id)
