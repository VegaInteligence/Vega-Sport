#!/usr/bin/env python3
"""Build the public dashboard snapshot from the checked-in PitchAPI responses.

Only the Python standard library is required. This script does not contact an API,
read credentials, calculate an STATARENA ranking, or modify the source snapshots.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[2]
SAMPLE_PATH = ROOT / "data/sources/pitchapi/samples/pitchapi_premiers_matchs.json"
CATALOG_PATH = ROOT / "data/sources/pitchapi/samples/pitchapi_championnats.json"
DEFAULT_OUTPUT = ROOT / "data/staging/dashboard/football.json"
MATCH_ENDPOINTS = (
    "match", "shots", "momentum", "events", "players", "players/halves",
    "lineups", "h2h", "stats", "advanced", "advanced/players",
    "advanced/network", "heatmaps",
)

# Repeated metrics in provider groups are a single observation, never a sum.
PLAYER_METRICS = {
    "minutes": "minutes_played",
    "rating": "rating_title",
    "goals": "goals",
    "assists": "assists",
    "xg": "expected_goals",
    "npxg": "expected_goals_non_penalty",
    "xa": "expected_assists",
    "xgot": "expected_goals_on_target_variant",
    "shots": "total_shots",
    "shotsOnTarget": "ShotsOnTarget",
    "chancesCreated": "chances_created",
    "bigChancesCreated": "big_chance_created_team_title",
    "passesAccurate": "accurate_passes",
    "defensiveActions": "defensive_actions",
    "interceptions": "interceptions",
    "tackles": "matchstats.headers.tackles",
    "recoveries": "recoveries",
    "duelsWon": "duel_won",
    "duelsLost": "duel_lost",
    "touches": "touches",
    "touchesBox": "touches_opp_box",
    "passesFinalThird": "passes_into_final_third",
    "clearances": "clearances",
    "blocks": "shot_blocks",
    "dribbles": "dribbles_succeeded",
    "saves": "saves",
    "goalsPrevented": "goals_prevented",
}

METRICS = [
    {"key": "minutes", "label": "Minutes", "unit": "min", "decimals": 0},
    {"key": "rating", "label": "Note PitchAPI", "unit": "/10", "decimals": 2},
    {"key": "goals", "label": "Buts", "unit": "", "decimals": 0},
    {"key": "assists", "label": "Passes décisives", "unit": "", "decimals": 0},
    {"key": "xg", "label": "Buts attendus (xG)", "unit": "", "decimals": 2},
    {"key": "xa", "label": "Passes décisives attendues (xA)", "unit": "", "decimals": 2},
    {"key": "shots", "label": "Tirs", "unit": "", "decimals": 0},
    {"key": "chancesCreated", "label": "Occasions créées", "unit": "", "decimals": 0},
    {"key": "passesAccurate", "label": "Passes réussies", "unit": "", "decimals": 0},
    {"key": "passesFinalThird", "label": "Passes dans le dernier tiers", "unit": "", "decimals": 0},
    {"key": "defensiveActions", "label": "Actions défensives", "unit": "", "decimals": 0},
    {"key": "tackles", "label": "Tacles", "unit": "", "decimals": 0},
    {"key": "interceptions", "label": "Interceptions", "unit": "", "decimals": 0},
    {"key": "recoveries", "label": "Récupérations", "unit": "", "decimals": 0},
    {"key": "duelsWon", "label": "Duels gagnés", "unit": "", "decimals": 0},
    {"key": "touches", "label": "Ballons touchés", "unit": "", "decimals": 0},
    {"key": "saves", "label": "Arrêts", "unit": "", "decimals": 0},
]


def number(value):
    """Return a finite source number, never coerce null/bool to zero."""
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return value if math.isfinite(value) else None
    if isinstance(value, str) and re.fullmatch(r"-?\d+(?:\.\d+)?", value.strip()):
        result = float(value)
        return int(result) if result.is_integer() else result
    return None


def first_number(value):
    """Parse the numerator in provider values such as '508 (87%)'."""
    if isinstance(value, str):
        match = re.match(r"^\s*(-?\d+(?:\.\d+)?)", value)
        return number(match.group(1)) if match else None
    return number(value)


def endpoint(sample, name, default):
    response = sample.get(name) or {}
    return response.get("data") if response.get("ok") and response.get("data") is not None else default


def flatten_player_stats(player):
    output = {}
    for group in player.get("stats") or []:
        for metric in (group.get("stats") or {}).values():
            key = metric.get("key")
            if key:
                stat = metric.get("stat") or {}
                # Prefer an observed value over a repeated null; do not sum.
                if key not in output or output[key].get("value") is None:
                    output[key] = stat
    return output


def flatten_team_stats(sample):
    output = {}
    for period in endpoint(sample, "team_stats", {}).get("periods") or []:
        if period.get("period") != "All":
            continue
        for group in period.get("groups") or []:
            for item in group.get("items") or []:
                key = item.get("key")
                if key and key not in output:
                    output[key] = item
    return output


def lineup_lookup(sample):
    result = {}
    data = endpoint(sample, "lineups", {})
    for side in ("home", "away"):
        for list_name, starter in (("starters", True), ("subs", False)):
            for item in (data.get(side) or {}).get(list_name) or []:
                result[item["player_id"]] = dict(item, starter=starter)
    return result


def unique_rows(items, key):
    """Ignore exact duplicate payloads, reject conflicting records."""
    seen = {}
    for item in items:
        identity = key(item)
        if identity in seen:
            if seen[identity] != item:
                raise ValueError(f"Conflicting duplicate record: {identity}")
            continue
        seen[identity] = item
    return list(seen.values())


def build_snapshot(raw, catalog):
    matches = []
    appearances = []
    samples = unique_rows(raw.get("samples") or [], lambda s: s["match"]["id"])
    for sample in samples:
        source_match = sample["match"]
        match_id = source_match["id"]
        teams = {source_match[f"{side}_team"]["id"]: source_match[f"{side}_team"] for side in ("home", "away")}
        players_raw = unique_rows(endpoint(sample, "players", []), lambda p: p["player"]["id"])
        source_stats = flatten_team_stats(sample)
        source_periods = endpoint(sample, "shots", {}).get("periods")
        source_shots = unique_rows(
            [shot for period in source_periods or [] for shot in period.get("shots") or []],
            lambda shot: shot["id"],
        )
        team_shots = source_stats.get("total_shots") or {}
        team_passes = source_stats.get("accurate_passes") or {}
        shot_list_suspect = not source_shots and (
            source_periods is None
            or (number(source_match.get("score_home")) or 0) + (number(source_match.get("score_away")) or 0) > 0
            or any((first_number(team_shots.get(side)) or 0) > 0 for side in ("home", "away"))
        )
        # Missing shot periods plus zero passes/shots are placeholders, including
        # 0-0 fixtures. Retain independently recorded goals/assists/minutes.
        suspicious = (
            not source_shots
            and (source_periods is None or (number(source_match.get("score_home")) or 0) + (number(source_match.get("score_away")) or 0) > 0)
            and all(first_number(item.get(side)) == 0 for item in (team_shots, team_passes) for side in ("home", "away"))
        )
        shots_available = bool((sample.get("shots") or {}).get("ok")) and isinstance(source_periods, list) and not shot_list_suspect
        warnings = []
        if suspicious:
            warnings.append("Les statistiques d’action comportent des zéros incohérents et des tirs absents. Elles sont masquées ; le score, les buts, les passes décisives et les minutes restent ceux du fournisseur.")
        if not shots_available:
            warnings.append("Les données de tirs ne sont pas disponibles pour ce match.")
        lineup = lineup_lookup(sample)
        match_appearances = []
        for source_player in players_raw:
            player = source_player["player"]
            player_id = player["id"]
            stats = flatten_player_stats(source_player)
            position = lineup.get(player_id) or {}
            team = teams.get(source_player.get("team_id")) or {}
            record = {
                "id": f"{match_id}:{player_id}",
                "playerId": player_id,
                "name": player.get("name"),
                "imageUrl": player.get("image_url"),
                "teamId": source_player.get("team_id"),
                "team": team.get("name"),
                "matchId": match_id,
                "leagueId": sample.get("league_id"),
                "league": sample.get("league"),
                "country": sample.get("country"),
                "season": sample.get("season"),
                "date": source_match.get("date"),
                "role": None,
                "starter": position.get("starter"),
                "positionId": position.get("position_id"),
                "rawPitchX": number(position.get("pitch_x")),
                "rawPitchY": number(position.get("pitch_y")),
                "shirtNumber": position.get("shirt_number"),
                "statsReliable": not suspicious,
            }
            for target, source in PLAYER_METRICS.items():
                value = number((stats.get(source) or {}).get("value"))
                record[target] = None if suspicious and target not in {"minutes", "goals", "assists"} else value
            record["passesAttempted"] = None if suspicious else number((stats.get("accurate_passes") or {}).get("total"))
            match_appearances.append(record)
        appearances.extend(match_appearances)
        shots = [
            {
                "id": shot["id"],
                "playerId": (shot.get("player") or {}).get("id"),
                "playerName": (shot.get("player") or {}).get("name"),
                "teamId": shot.get("team_id"),
                "x": number(shot.get("x")),
                "y": number(shot.get("y")),
                "xg": number(shot.get("expected_goals")),
                "xgot": number(shot.get("expected_goals_on_target")),
                "minute": number(shot.get("minute")),
                "type": shot.get("event_type"),
                "shotType": shot.get("shot_type"),
                "situation": shot.get("situation"),
                "isGoal": shot.get("event_type") == "Goal" and shot.get("is_own_goal") is not True,
                "isOwnGoal": shot.get("is_own_goal") is True or shot.get("event_type") == "OwnGoal",
                "isOnTarget": shot.get("is_on_target"),
            }
            for shot in source_shots
        ]
        team_stats = []
        for key, item in source_stats.items():
            reliable = not suspicious or key in {"yellow_cards", "red_cards"}
            team_stats.append({
                "key": key,
                "label": item.get("title"),
                "home": first_number(item.get("home")) if reliable else None,
                "away": first_number(item.get("away")) if reliable else None,
                "homeRaw": item.get("home"),
                "awayRaw": item.get("away"),
                "format": item.get("format_type"),
                "reliable": reliable,
            })
        match_record = {
            "id": match_id,
            "leagueId": sample.get("league_id"),
            "league": sample.get("league"),
            "country": sample.get("country"),
            "season": sample.get("season"),
            "date": source_match.get("date"),
            "timeUtc": source_match.get("time_utc"),
            "status": source_match.get("status"),
            "players": [p["id"] for p in match_appearances],
            "shots": shots,
            "stats": team_stats,
            "warnings": warnings,
            "warningCodes": ["SUSPICIOUS_ZERO_STATS"] if suspicious else [],
        }
        for side in ("home", "away"):
            team = source_match[f"{side}_team"]
            lookup = {s["key"]: s[side] for s in team_stats}
            match_record[side] = {
                "id": team["id"],
                "name": team.get("name"),
                "imageUrl": team.get("image_url"),
                "score": number(source_match.get(f"score_{side}")),
                "xg": lookup.get("expected_goals"),
                "shots": lookup.get("total_shots"),
                "shotsOnTarget": lookup.get("ShotsOnTarget"),
                "possession": lookup.get("BallPossesion"),
                "formation": (endpoint(sample, "lineups", {}).get(side) or {}).get("formation"),
            }
        played = [p for p in match_appearances if p["minutes"] is not None and p["minutes"] > 0]
        match_record["coverage"] = {
            "players": bool((sample.get("players") or {}).get("ok")) and bool(match_appearances),
            "playerStats": bool(played) and not suspicious,
            "ratings": any(p["rating"] is not None for p in played),
            "xg": any(p["xg"] is not None for p in played),
            "xa": any(p["xa"] is not None for p in played),
            "shots": shots_available,
            "teamStatsReliable": bool(source_stats) and not suspicious,
            "listedPlayers": len(match_appearances),
            "playedPlayers": len(played),
            "ratedPlayers": sum(p["rating"] is not None for p in played),
            "xgPlayers": sum(p["xg"] is not None for p in played),
            "xaPlayers": sum(p["xa"] is not None for p in played),
        }
        matches.append(match_record)
    # Stable ordering is independent of JSON object/key ordering or API sample order.
    matches.sort(key=lambda m: (m.get("timeUtc") or "", m["id"]), reverse=True)
    appearances.sort(key=lambda p: (p["matchId"], p["playerId"]))
    competition_lookup = {}
    for league in ((catalog.get("data") or {}).get("leagues") or []):
        competition_lookup[league["id"]] = {
            "id": league["id"],
            "name": league.get("name"),
            "country": league.get("country_code"),
            "seasons": league.get("seasons") or [],
            "imageUrl": league.get("image_url"),
            "sampleMatches": 0,
            "sampleSeasons": [],
        }
    for match in matches:
        competition = competition_lookup.setdefault(match["leagueId"], {
            "id": match["leagueId"], "name": match["league"], "country": match["country"],
            "seasons": [], "imageUrl": None, "sampleMatches": 0, "sampleSeasons": [],
        })
        competition["sampleMatches"] += 1
        if match["season"] not in competition["sampleSeasons"]:
            competition["sampleSeasons"].append(match["season"])
    competitions = sorted(competition_lookup.values(), key=lambda c: (c["name"] or "", c["id"]))
    team_lookup = {}
    for match in matches:
        for side in ("home", "away"):
            source_team = match[side]
            team = team_lookup.setdefault(source_team["id"], {
                "id": source_team["id"], "name": source_team["name"],
                "imageUrl": source_team.get("imageUrl"), "leagueIds": [],
                "seasons": [], "sampleMatches": 0,
            })
            team["sampleMatches"] += 1
            if match["leagueId"] not in team["leagueIds"]:
                team["leagueIds"].append(match["leagueId"])
            if match["season"] not in team["seasons"]:
                team["seasons"].append(match["season"])
    teams = sorted(team_lookup.values(), key=lambda t: (t["name"] or "", t["id"]))
    played = [p for p in appearances if p["minutes"] is not None and p["minutes"] > 0]
    all_shots = [s for m in matches for s in m["shots"]]
    dates = sorted(m["date"] for m in matches if m.get("date"))
    return {
        "meta": {
            "schemaVersion": 1,
            "retrievedAt": raw.get("retrieved_at_utc"),
            "source": "PitchAPI · instantané du dépôt",
            "sourceFiles": ["data/sources/pitchapi/samples/pitchapi_premiers_matchs.json", "data/sources/pitchapi/samples/pitchapi_championnats.json"],
            "ratingSource": "PitchAPI",
            "rankingAvailable": False,
            "matchCount": len(matches),
            "playerCount": len({p["playerId"] for p in appearances}),
            "activePlayerCount": len({p["playerId"] for p in played}),
            "appearanceCount": len(played),
            "listedAppearanceCount": len(appearances),
            "teamCount": len({p["teamId"] for p in appearances if p["teamId"]}),
            "catalogCount": len(((catalog.get("data") or {}).get("leagues") or [])),
            "seasonCount": sum(len(set(c["seasons"])) for c in competitions),
            "catalogSeasons": sorted({season for c in competitions for season in c["seasons"]}),
            "sampleCompetitionCount": len({m["leagueId"] for m in matches}),
            "shotCount": len(all_shots),
            "knownShotXgCount": sum(s["xg"] is not None for s in all_shots),
            "ratedAppearanceCount": sum(p["rating"] is not None for p in played),
            "xgAppearanceCount": sum(p["xg"] is not None for p in played),
            "xaAppearanceCount": sum(p["xa"] is not None for p in played),
            "xgMatchCount": sum(m["coverage"]["xg"] for m in matches),
            "ratedMatchCount": sum(m["coverage"]["ratings"] for m in matches),
            "shotMatchCount": sum(m["coverage"]["shots"] for m in matches),
            "startDate": dates[0] if dates else None,
            "endDate": dates[-1] if dates else None,
            "seasons": sorted({m["season"] for m in matches if m.get("season")}),
            "notes": [
                "Échantillon exploratoire de matchs ; ce n’est pas une saison complète.",
                "Les notes sont celles du fournisseur PitchAPI. Aucun score ni classement STATARENA n’est calculé.",
                "Une donnée manquante reste null. Les zéros suspects sont masqués et signalés.",
                "Les rôles ne sont pas déduits des identifiants de poste non documentés du fournisseur.",
                "Les coordonnées de tirs sont celles du fournisseur ; aucune précision géométrique supplémentaire n’est inférée.",
            ],
        },
        "competitions": competitions,
        "teams": teams,
        "matches": matches,
        "appearances": appearances,
        "metrics": METRICS,
    }


def write_raw_match_shards(raw, output_directory):
    """Expose the complete payloads actually present in the original sample.

    The fixture row is not misrepresented as a fetched /matches/{id} summary.
    Endpoints that were never collected remain explicitly not_collected.
    """
    output_directory = Path(output_directory)
    output_directory.mkdir(parents=True, exist_ok=True)
    for sample in unique_rows(raw.get("samples") or [], lambda s: s["match"]["id"]):
        match_id = sample["match"]["id"]
        if not re.fullmatch(r"m_[A-Za-z0-9]{6}", match_id):
            raise ValueError("Invalid match identifier in source snapshot")
        shard = {
            "meta": {"retrievedAt": raw.get("retrieved_at_utc"), "source": "data/sources/pitchapi/samples/pitchapi_premiers_matchs.json"},
            "match": {"data": sample["match"], "source": "fixture_index"},
            "availability": {key: {"state": "not_collected", "status": None} for key in MATCH_ENDPOINTS},
        }
        shard["availability"]["match"] = {"state": "fixture_only", "status": None}
        for target, source in (("players", "players"), ("lineups", "lineups"), ("stats", "team_stats"), ("shots", "shots")):
            response = sample.get(source)
            if not isinstance(response, dict):
                continue
            shard["availability"][target] = {"state": "collected" if response.get("ok") else "error", "status": response.get("status")}
            if response.get("ok"):
                shard[target] = {"data": response.get("data"), "status": response.get("status")}
        text = json.dumps(shard, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n"
        if re.search(r"pk_(?:live|test)_[A-Za-z0-9_-]+", text):
            raise ValueError("Credential-like value found in raw snapshot; shard not written")
        (output_directory / f"{match_id}.json").write_text(text, encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    if (ROOT / "data/sources/pitchapi/archives/europe_2026_2027/inventory.json").exists():
        if args.output == DEFAULT_OUTPUT:
            from build_multiseason_dashboard import main as build_multiseason
            if build_multiseason():
                raise SystemExit("Some archived matches could not be normalized; inspect multiseason_issues.json.")
            return
        from build_season_dashboard import build
        if build(args.output):
            raise SystemExit("Some archived matches could not be normalized; inspect dashboard_issues.json.")
        return
    manifest = ROOT / 'data/staging/dashboard/football-manifest.json'
    if args.output == DEFAULT_OUTPUT and manifest.is_file() and not SAMPLE_PATH.is_file():
        print('Using checked-in season snapshots from data/staging/dashboard; restore raw archives to regenerate them.')
        return
    sample_bytes = SAMPLE_PATH.read_bytes()
    catalog_bytes = CATALOG_PATH.read_bytes()
    raw = json.loads(sample_bytes.decode("utf-8-sig"))
    snapshot = build_snapshot(raw, json.loads(catalog_bytes.decode("utf-8-sig")))
    snapshot["meta"]["sourceSha256"] = {
        SAMPLE_PATH.name: hashlib.sha256(sample_bytes).hexdigest(),
        CATALOG_PATH.name: hashlib.sha256(catalog_bytes).hexdigest(),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n", encoding="utf-8")
    write_raw_match_shards(raw, args.output.parent / "matches")
    print(f"Dashboard snapshot: {snapshot['meta']['matchCount']} matches, {snapshot['meta']['appearanceCount']} played appearances, {snapshot['meta']['shotCount']} shot events → {args.output}")


if __name__ == "__main__":
    main()
