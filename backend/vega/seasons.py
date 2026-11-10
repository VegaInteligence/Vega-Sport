"""Vega sporting season of a provider edition (port of the previous pipeline's football_seasons.py).

The provider edition ("2026", "2025/2026") is kept in core.competition_seasons.native_label.
The Vega season is always "YYYY/YYYY+1" and its id is the starting year, which orders the
season partitions. Tournaments played in June/July belong to the season that ends then.
"""

import re
import unicodedata

SEASON = re.compile(r"^([12]\d{3})(?:/([12]\d{3}))?$")
WORLD_CUP_ID = "l_1XLtP0"
EXCEPTIONS = {
    ("world_cup", 2022): 2022,  # Qatar was played in Nov–Dec 2022.
    ("afcon", 2025): 2025,  # Morocco Dec 2025–Jan 2026.
    ("afcon", 2023): 2023,  # Played Jan 2024.
    ("afcon", 2021): 2021,  # Played Jan 2022.
    ("euro", 2020): 2020,  # Played in 2021.
    ("asian_cup", 2023): 2023,
}
FIRST_SEASON = 1850
LAST_ARCHIVE_SEASON = 2020


def _plain(value):
    value = unicodedata.normalize("NFKD", str(value or ""))
    return "".join(c for c in value if not unicodedata.combining(c)).lower()


def tournament_kind(league_key=None, league_name=None):
    name = _plain(league_name)
    if re.search(r"\b(qualif\w*|preliminary)\b", name):
        return None
    if league_key == WORLD_CUP_ID:
        return "world_cup"
    if "club world cup" in name or "coupe du monde des clubs" in name:
        return "club_world_cup"
    if "world cup" in name or "coupe du monde" in name:
        return "world_cup"
    if (
        any(
            k in name
            for k in (
                "africa cup of nations",
                "african cup of nations",
                "coupe d'afrique des nations",
                "coupe d afrique des nations",
                "afcon",
                "caf africa cup",
            )
        )
        or name.strip() == "can"
    ):
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


def sporting_season(native_label, league_key=None, league_name=None):
    """Return the Vega season label, or None when the edition is not a season label."""
    found = SEASON.fullmatch(str(native_label or ""))
    if not found:
        return None
    year = int(found.group(1))
    if found.group(2) is not None and int(found.group(2)) != year + 1:
        return None
    kind = tournament_kind(league_key, league_name)
    if not kind:
        # Calendar-year leagues use the existing year/year+1 convention.
        start = year
    else:
        start = EXCEPTIONS.get((kind, year), year - 1)
    if not FIRST_SEASON <= start <= 2100:
        return None
    return f"{start}/{start + 1}"


def season_id(label):
    """The id of a Vega season label is its starting year."""
    found = SEASON.fullmatch(str(label or ""))
    if not found or found.group(2) is None or int(found.group(2)) != int(found.group(1)) + 1:
        return None
    return int(found.group(1))
