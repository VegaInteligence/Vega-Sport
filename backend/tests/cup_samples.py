"""Bodies of main's cup source projections (open-cups, openligadb, nations-results), as
they answer: the cups adapter writes them, the read API must give them back."""

EURO_2024 = {"name": "Euro 2024", "season": "2024", "source": {"name": "OpenFootball", "url": "https://github.com/openfootball/euro.json", "license": "CC0-1.0"}, "matches": [
    {"round": "Matchday 1", "group": "Group A", "date": "2024-06-14", "team1": "Germany", "team2": "Scotland", "score": {"ft": [5, 1], "ht": [3, 0]}},
    {"round": "Round of 16", "date": "2024-07-01", "team1": "Portugal", "team2": "Slovenia", "score": {"ft": [0, 0], "ht": [0, 0], "et": [0, 0], "p": [3, 0]}},
    {"round": "Final", "date": "2024-07-14", "team1": "Spain", "team2": "England", "score": {"ft": [2, 1], "ht": [0, 0]}},
]}
EURO_2028 = {"name": "Euro 2028", "season": "2028", "source": EURO_2024["source"], "matches": [
    {"round": "Matchday 1", "group": "Group A", "num": 1, "date": "2028-06-09", "team1": "England", "team2": "A2"},
]}
GERMANY_CUP = {"competition": "germany-cup", "season": "2025/2026", "source": {
    "name": "OpenLigaDB", "url": "https://www.openligadb.de/", "dataUrl": "https://api.openligadb.de/getmatchdata/dfb/2025", "license": "ODbL-1.0"}, "matches": [
    {"key": "openliga:81500", "date": "2025-08-16", "home": "SC Verl", "away": "FC Kiel", "homeId": "1", "awayId": "2", "score": [1, 1],
     "penalties": [4, 3], "notes": ["après prolongation", "tirs au but 4 – 3"], "status": "finished", "roundName": "Round of 64", "round": "Premier tour", "group": None},
    {"key": "openliga:81581", "date": "2026-05-23", "home": "FC Bayern München", "away": "VfB Stuttgart", "homeId": "40", "awayId": "16",
     "score": [3, 0], "penalties": None, "notes": [], "status": "finished", "roundName": "Final", "round": "Finale", "group": None},
]}
NATIONS = {"season": "2026/2027", "source": {"name": "International Results", "url": "https://github.com/martj42/international_results", "license": "CC0-1.0"}, "matches": [
    {"key": "nations:2026-09-04|Scotland|Switzerland", "date": "2026-09-04", "home": "Écosse", "away": "Suisse", "homeId": "Scotland",
     "awayId": "Switzerland", "score": [1, 1], "status": "finished", "league": "B", "group": 1, "round": "Groupe 1"},
]}
# A tournament of the other confederations (International Results): played in January and
# February 2024, named for 2023; the dataset says whether the ground was neutral.
AFCON_2023 = {"name": "Coupe d’Afrique des nations 2023", "season": "2023", "source": NATIONS["source"], "matches": [
    {"key": "afcon:2024-01-13|Ivory Coast|Guinea-Bissau", "date": "2024-01-13", "home": "Ivory Coast", "away": "Guinea-Bissau", "homeId": "Ivory Coast",
     "awayId": "Guinea-Bissau", "score": [2, 0], "status": "finished", "neutral": False},
    {"key": "afcon:2024-01-14|Nigeria|Equatorial Guinea", "date": "2024-01-14", "home": "Nigeria", "away": "Equatorial Guinea", "homeId": "Nigeria",
     "awayId": "Equatorial Guinea", "score": [1, 1], "status": "finished", "neutral": True},
]}
# Two of the 19 matches of the 1938 World Cup (openfootball/worldcup.json at 516d3825, CC0): the
# source cancels Sweden–Austria (FAILURE_MODES.md §19, 19f); Cuba–Romania went to extra time.
WORLD_CUP_1938 = {"name": "World Cup 1938", "season": "1938", "source": {"name": "OpenFootball", "url": "https://github.com/openfootball/worldcup.json", "license": "CC0-1.0"}, "matches": [
    {"round": "First round", "date": "1938-06-05", "team1": "Sweden", "team2": "Austria", "status": "canceled"},
    {"round": "First round", "date": "1938-06-05", "team1": "Cuba", "team2": "Romania", "score": {"ft": [2, 2], "ht": [1, 1], "et": [3, 3]}},
]}
SAMPLES = (("open-cups", "euro", "2024", EURO_2024), ("open-cups", "euro", "2028", EURO_2028),
           ("open-cups", "world-cup-history", "1938", WORLD_CUP_1938),
           ("openligadb", "germany-cup", "2025/2026", GERMANY_CUP), ("nations-results", "nations-league", "2026/2027", NATIONS),
           ("nations-results", "afcon", "2023", AFCON_2023))
