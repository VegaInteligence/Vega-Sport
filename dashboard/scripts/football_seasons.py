"""Canonical July-June sporting season assignment for provider match records.

Store the original provider edition unchanged in statarena.fixtures.body;
the typed SQL season is the normalized sporting cohort. Do not split a
tournament's June/July fixtures into two seasons.
"""
import re
import unicodedata

SEASON = re.compile(r"^([12]\d{3})(?:/([12]\d{3}))?$")
WORLD_CUP_ID = "l_1XLtP0"
EXCEPTIONS = {
    ("world_cup", 2022): 2022,   # Qatar was played in Nov–Dec 2022.
    ("afcon", 2025): 2025,       # Morocco Dec 2025–Jan 2026.
    ("afcon", 2023): 2023,       # Played Jan 2024.
    ("afcon", 2021): 2021,       # Played Jan 2022.
    ("euro", 2020): 2020,        # Played in 2021.
    ("asian_cup", 2023): 2023,
}


def _plain(value):
    value = unicodedata.normalize("NFKD", str(value or ""))
    return "".join(c for c in value if not unicodedata.combining(c)).lower()


def tournament_kind(league_id=None, league_name=None):
    name = _plain(league_name)
    if re.search(r"\b(qualif\w*|preliminary)\b", name):
        return None
    if league_id == WORLD_CUP_ID:
        return "world_cup"
    if "club world cup" in name or "coupe du monde des clubs" in name:
        return "club_world_cup"
    if "world cup" in name or "coupe du monde" in name:
        return "world_cup"
    if any(k in name for k in ("africa cup of nations", "african cup of nations",
                               "coupe d'afrique des nations","coupe d afrique des nations",
                               "afcon","caf africa cup")) or name.strip() == "can":
        return "afcon"
    if name.strip() in ("euro", "uefa euro") or "european championship" in name:
        return "euro"
    if "copa america" in name:
        return "copa_america"
    if "asian cup" in name:
        return "asian_cup"
    if "gold cup" in name:
        return "gold_cup"
    return None


def sporting_season(source_season, league_id=None, league_name=None):
    """Accept a provider edition, not an already-normalized SQL value."""
    raw = str(source_season or "")
    found = SEASON.fullmatch(raw)
    if not found:
        return raw
    year = int(found.group(1))
    if found.group(2) is not None and int(found.group(2)) != year + 1:
        return raw
    kind = tournament_kind(league_id, league_name)
    if not kind:
        # Calendar-year leagues use the existing year/year+1 convention,
        # but must never be shifted into the preceding season.
        return raw if found.group(2) else f"{year}/{year+1}"
    start = EXCEPTIONS.get((kind, year), year - 1)
    return f"{start}/{start+1}"


def fixture_sporting_season(match):
    raw = str(match.get("season") or "")
    found = SEASON.fullmatch(raw)
    kickoff = str(match.get("date") or match.get("day") or
                  match.get("time_utc") or "")[:10]
    # A source may already send the proper cohort (e.g. World Cup 2018
    # as 2017/2018). Preserve it if the match was held in its ending year.
    if found and found.group(2) and len(kickoff) == 10 and kickoff[:4].isdigit() and kickoff[4] == "-":
        if int(kickoff[:4]) == int(found.group(2)):
            return raw
    league = match.get("league") or {}
    if isinstance(league, dict):
        ident = league.get("id") or match.get("league_id")
        name = league.get("name") or match.get("league_name")
    else:
        ident = match.get("league_id")
        name = match.get("league_name")
    return sporting_season(raw, ident, name)
