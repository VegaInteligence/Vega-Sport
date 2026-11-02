"""Small immutable player/season routing index; no duplicated football observations."""
import argparse
import hashlib
import json
from pathlib import Path
import build_json_database as db


def build_routes(source=None, previous=None):
    source = source or db.read(db.DATA / 'raw/index.json')
    inputs = sorted((s['id'], c['leagueId'], c['tables']['players']['sha256'], c['tables']['teams']['sha256'])
                    for s in source['seasons'] for c in s['chunks'])
    digest = hashlib.sha256(json.dumps(inputs, separators=(',', ':')).encode()).hexdigest()
    relative = f'computed/scouting/player-routes-{digest[:24]}.json.gz'
    if previous and previous.get('sourceDigest') == digest and (db.DATA / relative).is_file():
        return previous
    routes, club_routes = {}, {}
    for season in source['seasons']:
        for chunk in season['chunks']:
            ref = chunk['tables']['players']
            file = db.DATA / ref['path']
            if hashlib.sha256(file.read_bytes()).hexdigest() != ref['sha256']:
                raise ValueError('Player route checksum mismatch: ' + ref['path'])
            for player in db.read(file):
                player_id = player.get('playerId')
                if not player_id:
                    continue
                leagues = routes.setdefault(player_id, {}).setdefault(season['id'], set())
                leagues.add(chunk['leagueId'])
            team_ref = chunk['tables']['teams']
            team_file = db.DATA / team_ref['path']
            if hashlib.sha256(team_file.read_bytes()).hexdigest() != team_ref['sha256']:
                raise ValueError('Club route checksum mismatch: ' + team_ref['path'])
            for club in db.read(team_file):
                club_routes.setdefault(club['id'], {}).setdefault(season['id'], set()).add(chunk['leagueId'])
    payload = {player_id: {season: sorted(leagues) for season, leagues in sorted(seasons.items())}
               for player_id, seasons in sorted(routes.items())}
    clubs = {club_id: {season: sorted(leagues) for season, leagues in sorted(seasons.items())}
             for club_id, seasons in sorted(club_routes.items())}
    ref = db.write(relative, dict(version=1, routes=payload, clubRoutes=clubs))
    # Only superseded derived routing files, never source football data.
    for file in (db.DATA / 'computed/scouting').glob('player-routes-*.json.gz'):
        if file.relative_to(db.DATA).as_posix() != relative:
            file.unlink()
    return dict(version=1, sourceDigest=digest, playerRoutes=ref, players=len(routes), clubs=len(club_routes))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--data-root', type=Path)
    args = parser.parse_args()
    if args.data_root:
        db.DATA = args.data_root
    print(json.dumps(build_routes()))
