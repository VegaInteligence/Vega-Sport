"""What pass H1 reads (backend/panna/FAILURE_MODES.md): its two datasets, their columns as the release holds them and
as backend/panna/sql/001_panna.sql stores them, and each competition's season convention."""

from dataclasses import dataclass
import datetime
import re

REPO = "peteowen1/pannadata"
RELEASE = "opta-latest"
GITHUB_API = "https://api.github.com"
# The window: Vega season 2021/22 onwards; a day from 2021-01-01 for what is decided by its day.
FIRST_SEASON = 2021
FIRST_DAY = datetime.date(2021, 1, 1)
# An event key without a fixture and without a readable season waits this many days, then is unresolved.
PENDING_DAYS = 3

# Arrow type names a source column may have for each stored type (string and large_string both hold UTF-8 text).
ACCEPTED = {"text": {"string", "large_string"}, "bigint": {"int64"}, "double precision": {"double"}}
# Another source type a column may have, read by an exact conversion (backend/panna/FAILURE_MODES.md GH278-am): the
# release of 28 Nov 2026 stores the six integer columns of events_EPL.parquet and events_Scottish_Premiership.parquet
# as double. Every value of the object must be an exact integer within ±2^53, else the object is refused
# (LOSSY_CONVERSION); the receipt keeps the file's types and the load records the conversion.
CONVERTIBLE = {"bigint": {"double": "exact_integer"}}


@dataclass(frozen=True)
class Column:
    name: str
    pg_type: str
    physical: int  # its place in the table, fixed-width columns first


@dataclass(frozen=True)
class Dataset:
    name: str
    pattern: re.Pattern
    columns: tuple  # in the source's order
    key: str
    depends: str | None
    # Bytes of a stored row for the projections, as panna.datasets holds them (001). Measured with the B-tree of 003
    # (README, Measured): events 308 at 30.8 M rows, under 330; fixtures 232, over 220 by 1.3 MB for the whole file.
    bytes_per_row: int

    def matches(self, container, name):
        return container == RELEASE and bool(self.pattern.fullmatch(name))

    def physical(self):
        return sorted(self.columns, key=lambda c: c.physical)


FIXTURES = Dataset(
    "opta_fixtures", re.compile(r"opta_fixtures\.parquet"),
    tuple(Column(n, "text", i) for i, n in enumerate((
        "match_id", "match_date", "match_status", "home_team", "away_team", "home_team_id", "away_team_id",
        "home_score", "away_score", "home_score_ht", "away_score_ht", "competition", "season"))),
    key="match_id", depends=None, bytes_per_row=220)
EVENTS = Dataset(
    "opta_events", re.compile(r"events_[A-Za-z0-9_]+\.parquet"),
    (Column("match_id", "text", 10), Column("event_id", "bigint", 0), Column("type_id", "bigint", 1),
     Column("player_id", "text", 11), Column("player_name", "text", 12), Column("team_id", "text", 13),
     Column("minute", "bigint", 2), Column("second", "bigint", 3), Column("x", "double precision", 4),
     Column("y", "double precision", 5), Column("end_x", "double precision", 6), Column("end_y", "double precision", 7),
     Column("outcome", "bigint", 8), Column("period_id", "bigint", 9), Column("qualifier_json", "text", 14),
     Column("competition", "text", 15), Column("season", "text", 16)),
    key="match_id", depends="opta_fixtures", bytes_per_row=330)
DATASETS = {d.name: d for d in (FIXTURES, EVENTS)}
FAMILIES = {"opta_fixtures": FIXTURES, "opta_events": EVENTS}


def dataset_of(container, name):
    for dataset in DATASETS.values():
        if dataset.matches(container, name):
            return dataset
    return None


# Each competition's convention for a plain or host year label (« 2021 », « 2022 Qatar »). A split label
# (« 2021-2022 ») needs none. Named tournaments follow Vega's sporting_season (backend/vega/seasons.py and its
# EXCEPTIONS: Euro 2020 played in 2021 is 2020/21, AFCON 2021 played in 2022 is 2021/22); qualifiers and friendlies are
# decided by their day; calendar leagues and cups by their year. A competition absent from here is decided both ways,
# and unresolved where the two disagree (backend/panna/FAILURE_MODES.md GH278-g).
TOURNAMENT = {
    "World_Cup": "World Cup", "UEFA_Euros": "UEFA Euro", "Copa_America": "Copa America",
    "CONCACAF_Gold_Cup": "Gold Cup", "AFCON": "Africa Cup of Nations", "AFC_Asian_Cup": "Asian Cup",
    "Club_World_Cup": "Club World Cup",
}
DATED = frozenset({
    "AFCON_Qualifiers", "AFC_WC_Qualifiers", "Asian_Cup_Qualifiers", "CAF_WC_Qualifiers", "CONMEBOL_WC_Qualifiers",
    "Concacaf_WC_Qualifiers", "UEFA_Euro_Qualifiers", "UEFA_WC_Qualifiers", "Intl_Friendlies",
})
# Vega's sporting_season knows no Gulf Cup of Nations among the tournaments: its year, as for a calendar league.
CALENDAR = frozenset({
    "AFC_Champions_League_Elite", "Allsvenskan", "Argentine_Liga_Profesional", "Brazilian_Serie_A", "CAF_CL",
    "CAF_Confederation_Cup", "CONMEBOL_Libertadores", "CONMEBOL_Sudamericana", "Concacaf_Champions_Cup", "Eliteserien",
    "FIFA_Intercontinental_Cup", "Gulf_Champions_League", "Gulf_Cup_of_Nations", "Icelandic_Premier", "Irish_Premier",
    "Kazakhstan_Premier", "Leagues_Cup", "MLS", "Moroccan_Cup", "NZ_Chatham_Cup", "NZ_National_League",
    "OFC_Champions_League", "Suomen_Cup", "Tunisian_Cup", "UAE_Presidents_Cup", "Veikkausliiga", "WSL",
})
# A competition not listed whose name says it is a qualifier or a friendly is decided by its day too.
DATED_NAME = re.compile(r"qualif|friendl", re.I)
