"""Names curated by Vega (dashboard/shared on main), written as core.entity_names.

Player search aliases (shared/player-aliases.js): an alias belongs to one provider
identity, never to every player with that name. An alias whose player is not known
yet is counted as unmatched and written on a later run, once PitchAPI has seen him.
"""

from datetime import timedelta
import json
import os
from pathlib import Path

# main's dashboard/shared (copied into the worker image), read as they are.
SHARED = Path(os.environ.get("VEGA_SHARED_DIR", Path(__file__).resolve().parents[3] / "dashboard/shared"))

# dashboard/shared/player-aliases.js (main); a drift test compares the two.
PLAYER_ALIASES = {"p_3yEwhj": ("cr7",)}
# Reviewed UEFA spellings of clubs (club_links() of dashboard/scripts/collect_rankings.py
# on main): a club named as the key is also known by the value. A drift test compares them.
CLUB_ALIASES = {
    "Newcastle United": "Newcastle United FC", "Nottingham Forest": "Nottingham Forest FC",
    "Slovan Bratislava": "ŠK Slovan Bratislava", "PSG": "Paris Saint-Germain", "Inter": "Internazionale Milano",
    "Inter Milan": "Internazionale Milano", "Manchester City": "Manchester City FC", "Manchester United": "Manchester United FC",
    "Tottenham": "Tottenham Hotspur", "Bayern München": "Bayern München", "Bayern Munich": "Bayern München",
    "Barcelona": "FC Barcelona", "Atletico Madrid": "Atlético de Madrid", "Atlético Madrid": "Atlético de Madrid",
    "Sporting CP": "Sporting Clube de Portugal", "FC Porto": "FC Porto", "FC København": "FC København", "FCSB": "FCSB",
    "Bodø/Glimt": "Bodø/Glimt",
}


def scopes(now):
    day = timedelta(days=1)
    return {"player_aliases": day, "club_aliases": day, "stadium_plans": day, "league_zones": day, "cup_logos": day,
            "sportscore_ids": day, "country_names": day, "team_identity": day}


def _shared(name):
    return json.loads((SHARED / name).read_text())


def league_zones(conn):
    """Promotion and relegation places of shared/league-rules.json (main) as
    core.competition_zones of each league's current edition, when the edition has the
    recorded number of teams (docs/calculs 03-resultats/03). European places stay derived
    from the UEFA coefficient, as on the site."""
    written = unmatched = 0
    for key, rule in sorted(_shared("league-rules.json")["leagues"].items()):
        edition = conn.execute(
            """SELECT cs.id, (SELECT count(*) FROM core.team_seasons ts WHERE ts.competition_season_id = cs.id)
               FROM core.provider_ids p JOIN core.competition_seasons cs ON cs.competition_id = p.entity_id AND cs.is_current
               WHERE p.entity_type = 'competition' AND p.provider = 'pitchapi' AND p.provider_key = %s ORDER BY cs.season_id DESC LIMIT 1""",
            (key,),
        ).fetchone()
        teams = int(rule.get("teams") or 0)
        if not edition or edition[1] != teams or teams < 2:
            unmatched += 1
            continue
        conn.execute("DELETE FROM core.competition_zones WHERE competition_season_id = %s AND source = 'vega'", (edition[0],))
        up, up_po, down_po, down = (int(rule.get(k) or 0) for k in ("promotion", "promotionPlayoff", "relegationPlayoff", "relegation"))
        for zone, first, last in (("promotion", 1, up), ("promotion_playoff", up + 1, up + up_po),
                                  ("relegation_playoff", teams - down - down_po + 1, teams - down), ("relegation", teams - down + 1, teams)):
            if last >= first >= 1:
                conn.execute(
                    "INSERT INTO core.competition_zones(competition_season_id, zone, position_from, position_to, source) VALUES (%s,%s,%s,%s,'vega')",
                    (edition[0], zone, first, last),
                )
                written += 1
    return written, unmatched


# COUNTRY_NAMES of frontend/src/services/competition-selector.js (main): the French names
# the archives name countries by. A drift test compares the two.
COUNTRY_NAMES_FR = {
    "ARG": "Argentine", "AUS": "Australie", "AUT": "Autriche", "BEL": "Belgique", "BOL": "Bolivie", "BRA": "Brésil",
    "CAN": "Canada", "CHI": "Chili", "CHN": "Chine", "COL": "Colombie", "CRO": "Croatie", "CYP": "Chypre",
    "CZE": "Tchéquie", "DEN": "Danemark", "ECU": "Équateur", "EGY": "Égypte", "ENG": "Angleterre", "ESP": "Espagne",
    "FIN": "Finlande", "FRA": "France", "GER": "Allemagne", "GRE": "Grèce", "IND": "Inde", "INT": "International",
    "INT-2": "Europe", "IRL": "Irlande", "IRE": "Irlande", "ISL": "Islande", "ISR": "Israël", "ITA": "Italie",
    "JPN": "Japon", "KAZ": "Kazakhstan", "KOR": "Corée du Sud", "KSA": "Arabie saoudite", "LVA": "Lettonie", "MEX": "Mexique",
    "NED": "Pays-Bas", "NOR": "Norvège", "PAR": "Paraguay", "PER": "Pérou", "POL": "Pologne", "POR": "Portugal",
    "QAT": "Qatar", "ROU": "Roumanie", "RSA": "Afrique du Sud", "RUS": "Russie", "SCO": "Écosse", "SRB": "Serbie",
    "SUI": "Suisse", "SVK": "Slovaquie", "SVN": "Slovénie", "SWE": "Suède", "THA": "Thaïlande", "TUR": "Turquie",
    "UAE": "Émirats arabes unis", "UKR": "Ukraine", "USA": "États-Unis", "VEN": "Venezuela", "WAL": "Pays de Galles", "UEFA": "Europe",
}


def country_names(conn):
    """French country names (core.countries.name_fr), which tie an archive team's country
    to a PitchAPI club's (identity.py)."""
    written = 0
    for code, name in sorted(COUNTRY_NAMES_FR.items()):
        written += conn.execute(
            """INSERT INTO core.countries(code, name_fr) VALUES (%s, %s)
               ON CONFLICT (code) DO UPDATE SET name_fr = EXCLUDED.name_fr, updated_at = now()
               WHERE core.countries.name_fr IS DISTINCT FROM EXCLUDED.name_fr""",
            (code, name),
        ).rowcount
    return written, 0


# Site keys of shared/cup-logos.json -> the Vega key of the cup-source competition.
CUP_FAMILY = {"open-cup": "cup:open-cups:", "openligadb": "cup:openligadb:"}


def cup_logos(conn):
    """Competition logos of shared/cup-logos.json (main, SportScore): the logo of a
    cup-source competition, and of a PitchAPI one that has none."""
    written = unmatched = 0
    for key, logo in sorted(_shared("cup-logos.json")["logos"].items()):
        family, _, name = key.partition(":")
        if key.startswith("l_"):
            ref = ("pitchapi", key)
        elif family in CUP_FAMILY:
            ref = ("vega", CUP_FAMILY[family] + name)
        else:
            continue  # open-matchday: main's frozen catalogue
        row = conn.execute(
            "SELECT c.id, c.logo_asset_id FROM core.provider_ids p JOIN core.competitions c ON c.id = p.entity_id WHERE p.entity_type = 'competition' AND p.provider = %s AND p.provider_key = %s",
            ref,
        ).fetchone()
        if not row or not logo.get("imageUrl"):
            unmatched += 1
            continue
        if ref[0] == "pitchapi" and row[1] is not None:
            continue
        asset = conn.execute(
            """INSERT INTO core.assets(kind, source_url, author) VALUES ('logo', %s, %s)
               ON CONFLICT (source_url) DO UPDATE SET author = EXCLUDED.author RETURNING id""",
            (logo["imageUrl"], logo.get("source")),
        ).fetchone()[0]
        conn.execute("UPDATE core.competitions SET logo_asset_id = %s, updated_at = now() WHERE id = %s AND logo_asset_id IS DISTINCT FROM %s", (asset, row[0], asset))
        written += 1
    return written, unmatched


def sportscore_ids(conn):
    """The reviewed PitchAPI-to-SportScore competition mapping (sportscore.LEAGUES, a copy
    of main's sportscore-standings.js) as SportScore provider ids."""
    from .sportscore import LEAGUES

    written = unmatched = 0
    for key, slug in sorted(LEAGUES.items()):
        row = conn.execute(
            "SELECT entity_id FROM core.provider_ids WHERE entity_type = 'competition' AND provider = 'pitchapi' AND provider_key = %s", (key,)
        ).fetchone()
        if not row:
            unmatched += 1
            continue
        written += conn.execute(
            """INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('competition', 'sportscore', %s, %s)
               ON CONFLICT (entity_type, provider, provider_key) DO UPDATE SET entity_id = EXCLUDED.entity_id""",
            (slug, row[0]),
        ).rowcount
    return written, unmatched


def stadium_plans(conn):
    """Stadium plans of frontend/src/services/stadium-plans.js (main), on the venues of the
    same Wikidata id; a stadium not known yet is counted unmatched and written later."""
    from . import wikidata

    written = unmatched = 0
    for qid, plans in (wikidata.bridge("plans") or {}).items():
        venue = wikidata._entity(conn, "venue", qid)
        if venue is None:
            unmatched += 1
            continue
        conn.execute("DELETE FROM core.venue_plans WHERE venue_id=%s", (venue,))
        for seq, plan in enumerate(plans):
            image = None
            if plan.get("imageUrl"):
                image = conn.execute(
                    """INSERT INTO core.assets(kind, source_url) VALUES ('venue_plan', %s)
                       ON CONFLICT (source_url) DO UPDATE SET source_url=EXCLUDED.source_url RETURNING id""",
                    (plan["imageUrl"],),
                ).fetchone()[0]
            conn.execute(
                """INSERT INTO core.venue_plans(venue_id, seq, title, url, image_asset_id, source, detail, format, is_embedded, allow_geolocation)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                (venue, seq, plan["title"], plan.get("url"), image, plan.get("source"), plan.get("detail"), plan.get("format"),
                 bool(plan.get("embedded")), bool(plan.get("allowGeolocation"))),
            )
            written += 1
    return written, unmatched


def club_aliases(conn):
    """The reviewed spelling of each club named as a key (several clubs may share a name:
    each gets it; the UEFA link still needs the same country and a unique match)."""
    from . import normalize

    written = 0
    for name, alias in CLUB_ALIASES.items():
        for (team,) in conn.execute("SELECT id FROM core.teams WHERE name = %s AND is_national IS NOT TRUE", (name,)).fetchall():
            written += conn.execute(
                """INSERT INTO core.entity_names(entity_type, entity_id, name, normalized, kind, source)
                   VALUES ('team', %s, %s, %s, 'alias', 'vega') ON CONFLICT DO NOTHING""",
                (team, alias, normalize(alias)),
            ).rowcount
    return written, 0


def run(conn, get, scope, now):
    if scope == "team_identity":
        from . import identity

        return identity.run(conn, get, "teams", now)
    for name, handler in (("league_zones", league_zones), ("cup_logos", cup_logos), ("sportscore_ids", sportscore_ids),
                          ("country_names", country_names)):
        if scope == name:
            return handler(conn)
    if scope == "club_aliases":
        return club_aliases(conn)
    if scope == "stadium_plans":
        return stadium_plans(conn)
    if scope != "player_aliases":
        raise ValueError(scope)
    written = unmatched = 0
    known = set()
    for key, aliases in PLAYER_ALIASES.items():
        row = conn.execute(
            "SELECT entity_id FROM core.provider_ids WHERE entity_type='player' AND provider='pitchapi' AND provider_key=%s AND is_current",
            (key,),
        ).fetchone()
        if row is None:
            unmatched += 1
            continue
        for alias in aliases:
            known.add((row[0], alias))
            written += conn.execute(
                """INSERT INTO core.entity_names(entity_type, entity_id, name, normalized, kind, source)
                   VALUES ('player', %s, %s, %s, 'alias', 'vega')
                   ON CONFLICT (entity_type, entity_id, normalized) DO NOTHING""",
                (row[0], alias, alias.lower()),
            ).rowcount
    # An alias removed from the list goes away; names of other sources are not touched.
    for entity_id, normalized in conn.execute(
        "SELECT entity_id, normalized FROM core.entity_names WHERE entity_type='player' AND kind='alias' AND source='vega'"
    ).fetchall():
        if (entity_id, normalized) not in known:
            conn.execute(
                "DELETE FROM core.entity_names WHERE entity_type='player' AND entity_id=%s AND normalized=%s AND source='vega'",
                (entity_id, normalized),
            )
            written += 1
    return written, unmatched
