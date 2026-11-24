"""Names curated by Vega (dashboard/shared on main), written as core.entity_names.

Player search aliases (shared/player-aliases.js): an alias belongs to one provider
identity, never to every player with that name. An alias whose player is not known
yet is counted as unmatched and written on a later run, once PitchAPI has seen him.
"""

from datetime import date, timedelta
import json
import os
from pathlib import Path

from . import market_value_snapshot, player_fact_snapshot

# main's dashboard/shared (copied into the worker image), read as they are.
SHARED = Path(os.environ.get("VEGA_SHARED_DIR", Path(__file__).resolve().parents[3] / "dashboard/shared"))

# dashboard/shared/player-aliases.js (main); a drift test compares the two.
PLAYER_ALIASES = {"p_3yEwhj": ("cr7",)}
# The contract date below is the formal signing reported by the club on 16 July:
# https://www.fcbarcelona.com/en/news/4314453/lamine-yamal-is-the-fc-barcelona-no10/amp
PLAYER_FACTS = {
    "p_2e0FPo": {
        "birth": date(2007, 7, 13),
        "foot": "left",
        "foot_url": "https://www.uefa.com/uefachampionsleague/news/02a7-211e6967ce56-e8c3af6961a3-1000--lamine-yamal-in-the-champions-league-records-stats-who-h/",
        "club": "t_32jSEF",
        "signed": date(2025, 7, 16),
        "expiry": date(2031, 6, 30),
        "contract_url": "https://www.fcbarcelona.com/en/football/first-team/news/4274403/lamine-yamal-extends-contract-with-fc-barcelona-to-2031/featured",
    },
    "p_1mZO3B": {
        "birth": date(1987, 6, 24),
        "club": "t_1rgPN4",
        "signed": date(2025, 10, 23),
        "end_season_year": 2028,
        "end_season_competition": "MLS",
        "contract_url": "https://www.intermiamicf.com/news/inter-miami-cf-signs-leo-messi-to-contract-extension",
    },
}
# Reviewed UEFA spellings of clubs (club_links() of the previous pipeline's collect_rankings.py
# on main): a club named as the key is also known by the value. A drift test compares them.
CLUB_ALIASES = {
    "Newcastle United": "Newcastle United FC", "Nottingham Forest": "Nottingham Forest FC",
    "Slovan Bratislava": "ŠK Slovan Bratislava", "PSG": "Paris Saint-Germain", "Inter": "Internazionale Milano",
    "Inter Milan": "Internazionale Milano", "Manchester City": "Manchester City FC", "Manchester United": "Manchester United FC",
    "Tottenham": "Tottenham Hotspur", "Bayern München": "Bayern München", "Bayern Munich": "Bayern München",
    "Barcelona": "FC Barcelona", "Atletico Madrid": "Atlético de Madrid", "Atlético Madrid": "Atlético de Madrid",
    "Sporting CP": "Sporting Clube de Portugal", "FC Porto": "FC Porto", "FC København": "FC København", "FCSB": "FCSB",
    "Bodø/Glimt": "Bodø/Glimt",
    # The domestic cups' sources (open-matchday, OpenLigaDB) write PitchAPI's clubs their own way:
    # each spelling below was reviewed against PitchAPI's club of the same country (VI-21, 17 Nov
    # 2026). Near names of other clubs are left out on purpose: « A. Salzburg » (SV Austria
    # Salzburg), « C.F. Benfica » (Clube Futebol Benfica), « Excelsior '31 », « RKAV Volendam »,
    # « FC Lustenau », « FC United » (of Manchester), the U21 teams, « Deportivo » and « Estrela ».
    # Germany.
    "1. FC Union Berlin": "Union Berlin", "1. FC Magdeburg": "Magdeburg", "Bayer 04 Leverkusen": "Bayer Leverkusen",
    "SV Werder Bremen": "Werder Bremen", "VfL Bochum": "Bochum", "VfL Wolfsburg": "Wolfsburg", "FC St. Pauli": "St. Pauli",
    "TSG Hoffenheim": "Hoffenheim", "1. FC Heidenheim 1846": "FC Heidenheim", "SC Freiburg": "Freiburg",
    # open-matchday's Coppa Italia and German cup (the cups' check, 17 Nov 2026).
    "Internazionale": "Inter", "FC Cologne": "1. FC Köln",
    "SV Darmstadt 98": "Darmstadt", "SC Paderborn 07": "Paderborn", "1. FC Kaiserslautern": "Kaiserslautern",
    "SpVgg Greuther Fürth": "Greuther Fürth", "FC Schalke 04": "Schalke 04", "SV 07 Elversberg": "Elversberg",
    "SV Elversberg": "Elversberg", "FC Augsburg": "Augsburg", "1. FSV Mainz 05": "Mainz 05", "Mainz": "Mainz 05",
    "SV Wehen Wiesbaden": "Wehen Wiesbaden", "FC Bayern München": "Bayern München", "SV Waldhof Mannheim": "Waldhof Mannheim",
    "1. FC Saarbrücken": "Saarbrücken", "SC Verl": "Verl", "SC Verl 1924": "Verl", "FC Erzgebirge Aue": "Erzgebirge Aue",
    "SG Sonnenhof Großaspach": "Sonnenhof Großaspach", "SG Sonnenhof Großaspch": "Sonnenhof Großaspach",
    "Grossaspach": "Sonnenhof Großaspach", "Preußen Münster": "Preussen Münster", "TSV Eintracht Braunschweig": "Eintracht Braunschweig",
    "DSC Arminia Bielefeld": "Arminia Bielefeld", "Hamburg SV": "Hamburger SV", "TSV 1860 München": "1860 München",
    "Hertha Berlin": "Hertha BSC",
    # England.
    "Cambridge Utd": "Cambridge United", "Oxford Utd": "Oxford United", "Huddersfield": "Huddersfield Town",
    "Sheffield Wed": "Sheffield Wednesday", "Northampton": "Northampton Town", "Cheltenham": "Cheltenham Town",
    "Shrewsbury": "Shrewsbury Town", "Harrogate": "Harrogate Town", "Leicester": "Leicester City", "Fleetwood": "Fleetwood Town",
    "Mansfield": "Mansfield Town", "Forest Green": "Forest Green Rovers", "Peterborough": "Peterborough United",
    "Hartlepool": "Hartlepool United", "Salford": "Salford City", "Colchester": "Colchester United", "Swindon": "Swindon Town",
    "Grimsby": "Grimsby Town", "Crawley": "Crawley Town", "Rotherham": "Rotherham United", "Doncaster": "Doncaster Rovers",
    "Accrington": "Accrington Stanley", "Exeter": "Exeter City", "Carlisle": "Carlisle United", "Tranmere": "Tranmere Rovers",
    "Plymouth": "Plymouth Argyle", "Luton": "Luton Town", "Newport": "Newport County", "Oldham": "Oldham Athletic",
    "Burton": "Burton Albion", "Sutton": "Sutton United", "Crewe": "Crewe Alexandra", "Wigan": "Wigan Athletic",
    "Wycombe": "Wycombe Wanderers",
    # Scotland, Spain, Italy.
    "Dundee Utd": "Dundee United", "Mirandés": "CD Mirandes", "Huesca": "SD Huesca", "Burgos": "Burgos CF", "CD Sabadell": "Sabadell",
    "Dep. A Coruna": "Deportivo A Coruña", "Ceuta": "AD Ceuta FC", "Alavés": "Deportivo Alavés", "US Avellino": "Avellino",
    "AS Roma": "Roma", "AC Milan": "Milan", "Vicenza": "LR Vicenza",
    # Netherlands, Portugal, Austria, Switzerland, Poland.
    "FC Eindhoven": "Eindhoven", "SC Cambuur": "Cambuur", "FC Den Bosch": "Den Bosch", "Almere City": "Almere City FC",
    "FC Dordrecht": "Dordrecht", "Heerenveen": "SC Heerenveen", "G.A. Eagles": "Go Ahead Eagles", "Zwolle": "PEC Zwolle",
    "Heracles Almelo": "Heracles", "Feyenoord Rotterdam": "Feyenoord", "Roda JC Kerkrade": "Roda JC", "Oss": "TOP Oss",
    "Ajax Amsterdam": "Ajax", "SC Farense": "Farense", "Casa Pia": "Casa Pia AC", "Vitoria Guimaraes": "Vitória de Guimarães",
    "Pacos Ferreira": "Pacos de Ferreira", "Austria Vienna": "Austria Wien", "A. Klagenfurt": "SK Austria Klagenfurt",
    "A. Lustenau": "Austria Lustenau", "SK Rapid": "Rapid Wien", "Tirol": "WSG Tirol", "Admira": "Admira Moedling",
    "Zurich": "FC Zürich", "Grasshoppers": "Grasshopper", "Termalica B-B.": "Termalica Nieciecza",
    # OpenFootball's national cup archives (2024/25), reviewed the same way (VI-21, 17 Nov 2026). Left out on
    # purpose: « CF Benfica » (Lisbon's other club), « ASK Klagenfurt », « Austria Salzburg », « AC Paris 15 »,
    # « TA Rennes », « Excelsior '31 », « Excelsior Maassluis », « RKAV Volendam », « AFC Ajax Zaterdag ».
    "RB Salzburg": "Salzburg", "SCR Altach": "Altach", "SV Ried": "Ried", "TSV Hartberg": "Hartberg", "FC Blau Weiß Linz": "BW Linz",
    "FC Admira Wacker": "Admira Moedling",
    "CA Osasuna": "Osasuna", "CD Alavés": "Deportivo Alavés", "CD Castellón": "Castellón", "CD Eldense": "Eldense", "CD Leganés": "Leganés",
    "CD Tenerife": "Tenerife", "Cádiz CF": "Cádiz", "Córdoba CF": "Córdoba", "Deportivo La Coruña": "Deportivo A Coruña", "Elche CF": "Elche",
    "Espanyol Barcelona": "Espanyol", "Getafe CF": "Getafe", "Girona FC": "Girona", "Granada CF": "Granada", "Levante UD": "Levante",
    "Málaga CF": "Málaga", "RC Celta": "Celta Vigo", "RCD Mallorca": "Mallorca", "SD Eibar": "Eibar", "Sevilla FC": "Sevilla",
    "UD Almería": "Almería", "UD Las Palmas": "Las Palmas", "Valencia CF": "Valencia", "Villarreal CF": "Villarreal",
    "AC Monza": "Monza", "AC Reggiana 1919": "Reggiana", "ACF Fiorentina": "Fiorentina", "Bologna FC": "Bologna", "Cagliari Calcio": "Cagliari",
    "Calcio Padova": "Padova", "Carrarese Calcio": "Carrarese", "Cesena FC": "Cesena", "Como 1907": "Como", "Empoli FC": "Empoli",
    "FC Südtirol": "Südtirol", "Frosinone Calcio": "Frosinone", "Genoa CFC": "Genoa", "Lazio Roma": "Lazio", "Mantova 1911 SSD": "Mantova",
    "Modena FC": "Modena", "Palermo FC": "Palermo", "Parma Calcio 1913": "Parma", "Pisa SC": "Pisa", "SSC Bari": "Bari", "SSC Napoli": "Napoli",
    "Sassuolo Calcio": "Sassuolo", "Spezia Calcio": "Spezia", "Torino FC": "Torino", "US Catanzaro": "Catanzaro", "US Cremonese": "Cremonese",
    "US Lecce": "Lecce", "US Salernitana 1919": "Salernitana", "Udinese Calcio": "Udinese", "Venezia FC": "Venezia",
    "Arsenal FC": "Arsenal", "Barnsley FC": "Barnsley", "Barrow AFC": "Barrow", "Blackpool FC": "Blackpool", "Brentford FC": "Brentford",
    "Bromley FC": "Bromley", "Burnley FC": "Burnley", "Chelsea FC": "Chelsea", "Chesterfield FC": "Chesterfield", "Everton FC": "Everton",
    "Fulham FC": "Fulham", "Gillingham FC": "Gillingham", "Liverpool FC": "Liverpool", "Middlesbrough FC": "Middlesbrough", "Millwall FC": "Millwall",
    "Morecambe FC": "Morecambe", "Port Vale FC": "Port Vale", "Portsmouth FC": "Portsmouth", "Reading FC": "Reading", "Southampton FC": "Southampton",
    "Stevenage FC": "Stevenage", "Sunderland AFC": "Sunderland", "Walsall FC": "Walsall", "Watford FC": "Watford", "Wrexham AFC": "Wrexham",
    "Barnet FC": "Barnet", "Rochdale AFC": "Rochdale",
    "AJ Auxerre": "Auxerre", "AS Monaco": "Monaco", "AS Nancy Lorraine": "Nancy", "AS Saint-Étienne": "Saint-Étienne", "Amiens SC": "Amiens",
    "Angers SCO": "Angers", "Clermont Foot 63": "Clermont Foot", "Dijon FCO": "Dijon", "EA Guingamp": "Guingamp", "ESTAC Troyes": "Troyes",
    "FC Annecy": "Annecy FC", "FC Lorient": "Lorient", "FC Metz": "Metz", "FC Nantes": "Nantes", "FC Sochaux": "Sochaux",
    "Girondins Bordeaux": "Bordeaux", "Grenoble Foot 38": "Grenoble", "Havre AC": "Le Havre", "Le Mans FC": "Le Mans", "Lille OSC": "Lille",
    "Montpellier HSC": "Montpellier", "OGC Nice": "Nice", "Olympique Marseille": "Marseille", "Olympique Lyonnais": "Lyon", "Pau FC": "Pau",
    "RC Lens": "Lens", "RC Strasbourg": "Strasbourg", "Red Star FC": "Red Star", "Rodez AF": "Rodez", "Stade Brestois 29": "Brest",
    "Stade Lavallois": "Laval", "Stade Rennais": "Rennes", "Stade de Reims": "Reims", "Toulouse FC": "Toulouse", "US Boulogne": "Boulogne",
    "USL Dunkerque": "Dunkerque",
    # The five big leagues' archived seasons 2010/11-2020/21 (openfootball, engsoccerdata), reviewed against the site's
    # club of the same country on 23 Nov 2026. « Parma FC » (folded in 2015) is left out on purpose.
    "Athletic Bilbao": "Athletic Club", "RC Celta de Vigo": "Celta Vigo", "Real Betis Balompié": "Real Betis",
    "Real Sociedad de Fútbol": "Real Sociedad", "TSG 1899 Hoffenheim": "Hoffenheim",
    "Atalanta BC": "Atalanta", "Bologna FC 1909": "Bologna", "SS Lazio": "Lazio", "UC Sampdoria": "Sampdoria",
    "Olympique Lyon": "Lyon", "Stade Brest": "Brest", "Stade Reims": "Reims", "Stade Rennes": "Rennes",
    "1899 Hoffenheim": "Hoffenheim", "Bor. Mönchengladbach": "Borussia Mönchengladbach", "FC Ingolstadt 04": "FC Ingolstadt", "SSV Ulm 1846": "Ulm",
    "SV Meppen": "Meppen", "SV Sandhausen": "Sandhausen",
    "AFC Ajax": "Ajax", "SBV Excelsior": "Excelsior", "VVV-Venlo": "VVV",
    "Académico de Viseu": "Académico Viseu", "CD Nacional": "Nacional", "CD Santa Clara": "Santa Clara", "CD Tondela": "Tondela",
    "CS Marítimo": "Marítimo", "Estrela Amadora": "Estrela da Amadora", "FC Alverca": "Alverca", "FC Arouca": "Arouca", "FC Famalicão": "Famalicão",
    "FC Vizela": "Vizela", "GD Chaves": "Chaves", "GD Estoril": "Estoril", "Moreirense FC": "Moreirense", "Portimonense SC": "Portimonense",
    "Rio Ave FC": "Rio Ave", "SL Benfica": "Benfica", "Sporting Braga": "Braga", "Vitória Guimarães": "Vitória de Guimarães", "União Torreense": "Torreense",
    "AC Bellinzona": "Bellinzona", "BSC Young Boys": "Young Boys", "Etoile Carouge FC": "Etoile Carouge", "FC Aarau": "Aarau", "FC Basel 1893": "Basel",
    "FC Lugano": "Lugano", "FC Luzern": "Luzern", "FC Rapperswil-Jona": "Rapperswil-Jona", "FC Schaffhausen": "Schaffhausen", "FC Sion": "Sion",
    "FC St. Gallen": "St. Gallen", "FC Stade Nyonnais": "Stade Nyonnais", "FC Thun Berner Oberland": "Thun", "FC Wil 1900": "Wil",
    "FC Winterthur": "Winterthur", "Grasshopper Club Zürich": "Grasshopper", "Neuchâtel Xamax FCS": "Xamax", "SC Kriens": "Kriens",
    "Servette FC": "Servette", "Yverdon Sport FC": "Yverdon", "FC Lausanne-Sport": "Lausanne",
}


# The home's editorial lists (doc "Accueil": core.editorial_lists), as main's
# relational-home.js writes them in its code: the 29 big clubs, the 18 leagues of the
# title race and the Top 7 (shared/competition-scope.js). A drift test compares them.
EDITORIAL_LISTS = {
    "featured_clubs": ("team", (
        "t_1gkhxH", "t_4R934X", "t_0BrMnM", "t_0UCNPX", "t_2I313i", "t_2eQl9k", "t_4A7FfD", "t_41iFW3", "t_2s2eyG", "t_0xMlRV",
        "t_13gLEF", "t_0tnX1I", "t_4NZcri", "t_32jSEF", "t_3NIiXl", "t_1cpjqO", "t_386iz1", "t_2lHR8t", "t_4ZwKDn", "t_3CPHHF",
        "t_1DYf1D", "t_2toJRF", "t_0RhqmW", "t_0Mzm1V", "t_0dVrhE", "t_1TAfIz", "t_3t08JG", "t_1jOgDP", "t_4KvHFN",
    )),
    "title_race_leagues": ("competition", (
        "l_3FJFUl", "l_0275VP", "l_4WFCIZ", "l_4DWyTT", "l_0ahLw8", "l_1W6idJ", "l_1Isor4", "l_3hvsne", "l_47077Y",
        "l_0ErfuF", "l_3kyHLd", "l_0ALvwF", "l_0jy5yE", "l_4QexZg", "l_4H43wr", "l_49KZaB", "l_0S1uaf", "l_1BFfna",
    )),
    "top_seven": ("competition", ("l_4WFCIZ", "l_0ErfuF", "l_1Isor4", "l_0ALvwF", "l_3FJFUl", "l_4QexZg", "l_4H43wr")),
}


def scopes(now):
    day = timedelta(days=1)
    # national_teams before team_identity: the merge reads the flag it sets.
    return {"player_aliases": day, "player_facts": day, **player_fact_snapshot.scopes(now), **market_value_snapshot.scopes(now),
            "club_aliases": day, "stadium_plans": day, "league_zones": day, "cup_logos": day,
            "sportscore_ids": day, "country_names": day, "national_teams": day, "team_identity": day, "editorial_lists": day}


# The PitchAPI competitions played by national teams: the site's own list (main's
# NATIONAL_COMPETITIONS, dashboard/frontend/src/services/player-team-seasons.js; its other
# entries are cup-source editions, known by their cup key). PitchAPI says of no competition
# or team that it is international: this list is what says it.
NATIONAL_COMPETITIONS = ("l_1XLtP0",)
# The competitions of the cup sources that national teams play: the second part of an
# edition's key ("nations-results:nations-league:2026/2027").
NATIONAL_CUPS = ("nations-league", "euro", "world-cup-history", "afcon", "copa-america", "asian-cup", "gold-cup")


def national_teams(conn):
    """core.competitions.kind = 'international' for NATIONAL_COMPETITIONS, and
    core.teams.is_national for every team of their PitchAPI matches, for every team of
    a cup source's edition of NATIONAL_CUPS, and for every FIFA member International Results names (§51): a national team PitchAPI does not hold (Italy,
    Ukraine, a state that no longer exists) is one all the same. The collect never writes
    either column, so a later collect keeps them."""
    ids = [row[0] for row in conn.execute(
        "SELECT entity_id FROM core.provider_ids WHERE entity_type = 'competition' AND provider = 'pitchapi' AND provider_key = ANY(%s)",
        (list(NATIONAL_COMPETITIONS),),
    )]
    written = conn.execute(
        "UPDATE core.competitions SET kind = 'international', updated_at = now() WHERE id = ANY(%s) AND kind IS DISTINCT FROM 'international'",
        (ids,),
    ).rowcount
    written += conn.execute(
        """UPDATE core.teams t SET is_national = true, updated_at = now()
           WHERE t.is_national IS NOT TRUE AND EXISTS (
             SELECT 1 FROM core.matches m JOIN core.competition_seasons cs ON cs.id = m.competition_season_id
             WHERE cs.competition_id = ANY(%s) AND cs.archive_key IS NULL AND cs.cup_key IS NULL
               AND t.id IN (m.home_team_id, m.away_team_id))""",
        (ids,),
    ).rowcount
    written += conn.execute(
        """UPDATE core.teams t SET is_national = true, updated_at = now()
           WHERE t.is_national IS NOT TRUE AND EXISTS (
             SELECT 1 FROM core.matches m JOIN core.competition_seasons cs ON cs.id = m.competition_season_id
             WHERE split_part(cs.cup_key, ':', 2) = ANY(%s) AND t.id IN (m.home_team_id, m.away_team_id))""",
        (list(NATIONAL_CUPS),),
    ).rowcount
    # A FIFA member International Results keys by a name a held FIFA men's edition lists (through the measurement's
    # map) is a national team, whatever edition created it (FAILURE_MODES.md §51); a merged row's nation is its target.
    from ..power import FIFA_TO_IR

    written += conn.execute(
        """UPDATE core.teams t SET is_national = true, updated_at = now()
           WHERE t.is_national IS NOT TRUE AND t.merged_into IS NULL AND EXISTS (
             SELECT 1 FROM core.provider_ids p
             JOIN core.ranking_rows r ON coalesce(%s::jsonb ->> r.entity_name, r.entity_name) = p.provider_key
             JOIN core.ranking_editions e ON e.id = r.edition_id AND e.kind = 'fifa_men'
             WHERE p.entity_type = 'team' AND p.provider = 'international_results' AND p.entity_id = t.id)""",
        (json.dumps(FIFA_TO_IR),),
    ).rowcount
    return written, len(NATIONAL_COMPETITIONS) - len(ids)


def editorial_lists(conn):
    """core.editorial_lists from EDITORIAL_LISTS: each list in its order (seq), by core id.
    An entry PitchAPI has not seen yet is counted unmatched and written on a later run;
    an entry removed from the list goes away. The home reads api.editorial_lists."""
    written = unmatched = 0
    for kind, (entity, keys) in EDITORIAL_LISTS.items():
        rows = []
        for seq, key in enumerate(keys):
            found = conn.execute(
                "SELECT entity_id FROM core.provider_ids WHERE entity_type=%s AND provider='pitchapi' AND provider_key=%s AND is_current",
                (entity, key),
            ).fetchone()
            if found is None:
                unmatched += 1
            else:
                rows.append((found[0], seq))
        ids = [entity_id for entity_id, _ in rows]
        conn.execute("DELETE FROM core.editorial_lists WHERE list_kind=%s AND NOT (entity_id = ANY(%s))", (kind, ids))
        for entity_id, seq in rows:
            written += conn.execute(
                """INSERT INTO core.editorial_lists(list_kind, entity_type, entity_id, seq) VALUES (%s, %s, %s, %s)
                   ON CONFLICT (list_kind, entity_id) DO UPDATE SET seq = EXCLUDED.seq, entity_type = EXCLUDED.entity_type, updated_at = now()
                   WHERE core.editorial_lists.seq IS DISTINCT FROM EXCLUDED.seq""",
                (kind, entity, entity_id, seq),
            ).rowcount
    return written, unmatched


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
    "CONMEBOL": "Amérique du Sud", "CONCACAF": "Amérique du Nord et centrale", "CAF": "Afrique", "AFC": "Asie",
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
CUP_FAMILY = {"open-cup": "cup:open-cups:", "openligadb": "cup:openligadb:", "open-matchday": "cup:open-matchday:"}
# The same cup under another source's key, which takes the logo of its site key: the site shows each
# as an edition of that cup (cup-archives.js NATIONAL_CUP_ARCHIVES and GERMAN_CUP_FOLDER; cup-catalog.js,
# the Nations League « Ligues A à D » of OpenLigaDB and International Results). Never by a name (VI-27).
CUP_LOGO_ALSO = {
    "open-matchday:AUT_CUP_ofb-cup": ("cup:open-cups:austria-cup-archive",),
    "open-matchday:GER_CUP_dfb-pokal": ("cup:open-cups:germany-cup-archive", "cup:openligadb:germany-cup"),
    "open-matchday:ENG_CUP_fa-cup": ("cup:open-cups:fa-cup-archive",),
    "open-matchday:ENG_CUP_efl-cup": ("cup:open-cups:efl-cup-archive",),
    "open-matchday:ESP_CUP_copa-del-rey": ("cup:open-cups:copa-del-rey-archive",),
    "open-matchday:ITA_CUP_coppa-italia": ("cup:open-cups:coppa-italia-archive",),
    "open-matchday:NED_CUP_knvb-beker": ("cup:open-cups:knvb-beker-archive",),
    "open-matchday:POR_CUP_taca-de-portugal": ("cup:open-cups:portugal-cup-archive",),
    "open-matchday:SUI_CUP_swiss-cup": ("cup:open-cups:swiss-cup-archive",),
    "openligadb:nations-league": ("cup:nations-results:nations-league",),
}


def cup_logos(conn):
    """Competition logos of shared/cup-logos.json (main, SportScore): the logo of a
    cup-source competition, of the same cup under another source's key (CUP_LOGO_ALSO), and of
    a PitchAPI competition that has none. A competition not in the base yet counts unmatched."""
    written = unmatched = 0
    for key, logo in sorted(_shared("cup-logos.json")["logos"].items()):
        family, _, name = key.partition(":")
        if key.startswith("l_"):
            refs = [("pitchapi", key)]
        elif family in CUP_FAMILY:
            refs = [("vega", CUP_FAMILY[family] + name), *(("vega", also) for also in CUP_LOGO_ALSO.get(key, ()))]
        else:
            unmatched += 1  # a site key no source family names (test_source_snapshots L5)
            continue
        asset = None
        for ref in refs:
            row = conn.execute(
                "SELECT c.id, c.logo_asset_id FROM core.provider_ids p JOIN core.competitions c ON c.id = p.entity_id WHERE p.entity_type = 'competition' AND p.provider = %s AND p.provider_key = %s",
                ref,
            ).fetchone()
            if not row or not logo.get("imageUrl"):
                unmatched += 1
                continue
            if (ref[0] == "pitchapi" and row[1] is not None
                    or conn.execute("SELECT core.family_artwork_requires_proof(%s)", (row[0],)).fetchone()[0]):
                continue
            if asset is None:
                # One asset per image, whatever the number of competitions it is the logo of.
                found = conn.execute("SELECT id FROM core.assets WHERE source_url = %s", (logo["imageUrl"],)).fetchone()
                asset = found[0] if found else conn.execute(
                    "INSERT INTO core.assets(kind, source_url, author) VALUES ('logo', %s, %s) RETURNING id", (logo["imageUrl"], logo.get("source"))
                ).fetchone()[0]
                conn.execute("UPDATE core.assets SET author = %s, updated_at = now() WHERE id = %s AND author IS DISTINCT FROM %s",
                             (logo.get("source"), asset, logo.get("source")))
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


# The country a spelling of CLUB_ALIASES was reviewed for, when several clubs bear its name: « Barcelona » is the
# Spanish club, never Ecuador's Barcelona SC (VI-21, 19 Nov 2026; FAILURE_MODES.md §39). A name several clubs bear
# without an entry here gives its spelling to none of them.
CLUB_ALIAS_COUNTRIES = {"Barcelona": "ESP"}


def club_aliases(conn):
    """The reviewed spelling of each club named as a key, written as its alias (FAILURE_MODES.md §39). A name one
    club bears: that club. A name several bear: the one of the country reviewed for it (CLUB_ALIAS_COUNTRIES), and the
    other clubs of that name lose the alias if they held it; with no reviewed country, or not exactly one club of that
    country, nothing is written or removed (each club keeps what it holds), the name is counted unmatched and logged
    for review. The alias replaces a source spelling of the same form on the club (UEFA's « FC Barcelona » on FC
    Barcelona): the identity pass reads aliases, not source spellings."""
    from . import normalize

    written = unmatched = 0
    for name, alias in CLUB_ALIASES.items():
        clubs = conn.execute(
            "SELECT id, country_code FROM core.teams WHERE name = %s AND is_national IS NOT TRUE AND merged_into IS NULL ORDER BY id",
            (name,),
        ).fetchall()
        if len(clubs) > 1:
            country = CLUB_ALIAS_COUNTRIES.get(name)
            chosen = [team for team, code in clubs if country and code == country]
            if len(chosen) != 1:
                # Not reviewed for these clubs: what each holds stays (39l); taking the alias from the club that
                # resolves by it would make the next cup import create a second club.
                unmatched += 1
                print(f"club alias {name!r} shared by {len(clubs)} clubs without a reviewed country: unchanged", flush=True)
                continue
            others = [team for team, _ in clubs if team not in chosen]
            written += conn.execute(
                """DELETE FROM core.entity_names WHERE entity_type = 'team' AND entity_id = ANY(%s) AND normalized = %s
                   AND kind = 'alias' AND source = 'vega'""",
                (others, normalize(alias)),
            ).rowcount
        else:
            chosen = [team for team, _ in clubs]
        for team in chosen:
            written += conn.execute(
                """INSERT INTO core.entity_names(entity_type, entity_id, name, normalized, kind, source)
                   VALUES ('team', %s, %s, %s, 'alias', 'vega')
                   ON CONFLICT (entity_type, entity_id, normalized) DO UPDATE SET name = EXCLUDED.name, kind = 'alias', source = 'vega', updated_at = now()
                   WHERE core.entity_names.kind = 'source_spelling'""",
                (team, alias, normalize(alias)),
            ).rowcount
    return written, unmatched


def player_facts(conn):
    """Write reviewed profile fields against known provider identities."""
    written = unmatched = 0
    for key, facts in PLAYER_FACTS.items():
        player = conn.execute(
            """SELECT p.id FROM core.provider_ids i JOIN core.players p ON p.id = i.entity_id
               WHERE i.entity_type = 'player' AND i.provider = 'pitchapi' AND i.provider_key = %s
                 AND i.is_current AND p.birth_date = %s""",
            (key, facts["birth"]),
        ).fetchone()
        team = conn.execute(
            """SELECT coalesce(t.merged_into, t.id) FROM core.provider_ids i JOIN core.teams t ON t.id = i.entity_id
               WHERE i.entity_type = 'team' AND i.provider = 'pitchapi' AND i.provider_key = %s AND i.is_current""",
            (facts["club"],),
        ).fetchone()
        if player is None or team is None:
            unmatched += 1
            continue
        if "foot" in facts:
            written += conn.execute(
                """UPDATE core.players SET preferred_foot = %s, preferred_foot_source_url = %s, updated_at = now()
                   WHERE id = %s AND (preferred_foot IS NULL OR
                     (preferred_foot = %s AND preferred_foot_source_url IS NULL))""",
                (facts["foot"], facts["foot_url"], player[0], facts["foot"]),
            ).rowcount
        written += conn.execute(
            """INSERT INTO core.player_contracts(player_id, team_id, start_date, end_date, source, as_of, source_url,
                                                 end_season_year, end_season_competition)
               VALUES (%s, %s, %s, %s, 'other', %s, %s, %s, %s)
               ON CONFLICT (player_id, team_id, start_date) DO NOTHING""",
            (player[0], team[0], facts["signed"], facts.get("expiry"), facts["signed"], facts["contract_url"],
             facts.get("end_season_year"), facts.get("end_season_competition")),
        ).rowcount
    return written, unmatched


def run(conn, get, scope, now):
    if scope in player_fact_snapshot.scopes(now):
        return player_fact_snapshot.run(conn, get, scope, now)
    if scope in market_value_snapshot.scopes(now):
        return market_value_snapshot.run(conn, get, scope, now)
    if scope == "team_identity":
        from . import identity

        return identity.run(conn, get, "teams", now)
    for name, handler in (("league_zones", league_zones), ("cup_logos", cup_logos), ("sportscore_ids", sportscore_ids),
                          ("country_names", country_names), ("national_teams", national_teams),
                          ("editorial_lists", editorial_lists), ("player_facts", player_facts)):
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
