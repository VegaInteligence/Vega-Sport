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
SAMPLES = (("open-cups", "euro", "2024", EURO_2024), ("open-cups", "euro", "2028", EURO_2028),
           ("openligadb", "germany-cup", "2025/2026", GERMANY_CUP), ("nations-results", "nations-league", "2026/2027", NATIONS))
