"""Publish and replay immutable, single-snapshot coverage evidence."""
import argparse
import csv
import gzip
import hashlib
import io
import json
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.parse
import zipfile
from collections import Counter
from pathlib import Path

REPLAY_GUIDE = '# Vérification hors réseau\n\nL’entrée est la transaction PostgreSQL du 18 novembre 2026 à 02:02:22 UTC, avec 44 SELECT, le calcul d’admission Elo et leur reçu de transport. Le contrôle doit vérifier l’empreinte de chaque résultat et de chaque requête, les clés d’édition et d’année, les deux distributions du rôle, les sommes des notes et l’égalité avec les comptages SQL par partition. Une édition sans source statistique conserve un effectif observé nul et une couverture sportive inconnue.\n\nDepuis le dossier de cette livraison, exécuter `python3 replay.py --verify .`. Le contrôle recrée les trois tables de la grille dans un dossier temporaire, compare leur contenu décompressé, puis recalcule le CSV joueurs et son bilan à partir des fichiers SQL/JSON gelés. Les sorties attendues sont 2 149 éditions, 6 447 cellules dans la grille d’entités, 2 282 580 notes joueurs valides et 15 033 entrées admises sans intermédiaire. Les cinq compteurs complémentaires demandés valent zéro. Il vérifie en outre les corps HTTPS par leurs empreintes et contrôle le second relevé de 02:11:08 UTC. Les deux répartitions inverses doivent concorder avec le nombre d’intermédiaires. Le journal de la vérification figure dans `verification.log`.\n\nDepuis la racine de l’audit complet, régénérer cette livraison avec `python3 tracks/5-players/atomic-coverage/publish.py tracks/5-players/atomic-coverage/after-cooldown delivery/notes-transaction`. Cette commande relit également la grille antérieure pour produire les écarts historiques.\n'

REPLAY_GUIDE += """
La publication corrigée se vérifie avec Python 3 et Node.js. Le programme régénère les colonnes de présentation des grilles, confronte les deux groupes de signaux par édition, vérifie les SHA par chemin et requête des 46 invocations Lambda et des 46 corps HTTPS, puis extrait les valeurs des 27 clés et reconstitue les dix vérifications HTTPS supplémentaires. Il exécute la fonction frontend `boardRows` avec le module extrait du commit déployé et les corps HTTPS gelés. Le relevé de 02:00 utilisait des événements GET synthétiques transmis par AWS CLI. L’observation réseau signée a eu lieu sur l’origine AWS à 02:22 et 02:24 UTC. Le CDN, Vercel et le navigateur restent hors de ce parcours.

La première publication reste reproductible dans [son archive](archive/initial-delivery.zip). Son inventaire original conserve le SHA-256 `d05f8c369e56e41b7ee27cd685a27def0b8e57741e3bae7712617b02edeb2ec5`. Le rejeu portable décompresse cette archive dans un dossier temporaire et exécute son script de vérification d’origine. Les anciens libellés en restent des traces historiques. Toute interprétation des signaux de participation doit se fonder sur les noms et les unités de la publication corrigée.
"""

TABLES = ('coverage-by-edition-and-entity.csv', 'coverage-by-season-and-entity.csv', 'score-query-snapshots.csv')
SCORE = ('stats_records', 'positive_minutes', 'minutes_unknown', 'zero_or_negative_minutes',
         'unknown_or_wrong_team', 'positive_minutes_in_excluded_domain', 'positive_minutes_outside_award_window',
         'algorithm_inputs_before_coverage', 'admitted_without_power_match', 'insufficient_contribution',
         'insufficient_role_reference', 'proven_scorable', 'scorable_valid_persisted', 'missing_grade_for_computed_index',
         'stale_grade_metadata', 'displayed_under_current_rule', 'intentionally_hidden_cameo')
PENDING = ('no_published_award', 'stats_newer_than_run', 'role_before_published_run')
ROLE = ('current_assignable', 'current_assignable_touches', 'recovered_by_award_history',
        'no_model_role_after_award_history', 'valid_stats_slot_shadowed_by_lineup',
        'assignable_stats_older_than_latest_player_start')
REQUIRED = ('unknown_or_wrong_team', 'positive_minutes_outside_award_window', 'no_published_award',
            'insufficient_contribution', 'insufficient_role_reference')
IDENTITY = ('edition_id', 'season_id', 'season', 'competition_id', 'competition', 'competition_kind', 'country_code',
            'cup_key', 'archive_key')
COLUMNS = tuple(dict.fromkeys((*REQUIRED, *SCORE, *PENDING, *ROLE)))

def read(p):
    return json.loads(p.read_bytes())

def fr(n):
    return f'{n:,}'.replace(',', '\u202f')

def table(path):
    source = read(path)
    return [dict(zip(source['columns'], values, strict=True)) for values in source['rows']]

def check(condition, message):
    if not condition:
        raise ValueError(message)

def digest(raw):
    return hashlib.sha256(raw).hexdigest()

def verify_receipt(base):
    receipt = read(base / 'receipt.json')
    snap = read(base / 'snapshot.json')
    check(receipt['definition_end_state'] == 'INACTIVE' and receipt['exit_code'] == 0 and
          snap['read_only'] == 'on' and snap['isolation'] == 'repeatable read' and receipt['common_snapshot'] == snap and
          receipt['running_digest'] == receipt['image_digest'], 'Unverified snapshot or image')
    paths = list((base / 'db').rglob('*.json')) + [base / 'snapshot.json']
    check({p.stem for p in paths} == receipt['result_sha256_transport'].keys() and
          len(paths) == len(receipt['result_sha256_transport']), 'Result inventory')
    for path in paths:
        obj = read(path)
        check(all(obj[k] == v for k, v in snap.items()), f'Snapshot {path}')
        check(digest(json.dumps(obj, ensure_ascii=False).encode()) == receipt['result_sha256_transport'][path.stem],
              f'Result digest {path}')
    sql = list((base / 'db').rglob('*.sql'))
    check({p.stem for p in sql} == receipt['query_sha256'].keys() and len(sql) == len(receipt['query_sha256']), 'SQL inventory')
    for path in sql:
        normalized = re.sub(r'--[^\n]*', '', path.read_text()).strip().rstrip(';')
        check(digest(normalized.encode()) == receipt['query_sha256'][path.stem], f'SQL digest {path}')
    for name, expected in receipt['inputs'].items():
        check(digest((base / name).read_bytes()) == expected, f'Grid algorithm digest {name}')
    return snap, receipt

def indexed(base, group, prefix, key_fields):
    result = {}
    paths = sorted((base / 'db' / group).glob(prefix + '-*.json'))
    partitions = {int(path.stem.rsplit('-', 1)[1]) for path in paths}
    for source in paths:
        year = int(source.stem.rsplit('-', 1)[1])
        for row in table(source):
            key = tuple(row[field] for field in key_fields)
            check(key not in result, f'Duplicate group {source} {key}')
            result[key] = (year, row)
    return result, partitions

def player_report(base):
    snap, receipt = verify_receipt(base)
    db = base / 'db'
    editions = table(db / 'catalog_verified/editions.json')
    edition_map = {e['edition_id']: e for e in editions}
    check(len(edition_map) == len(editions), 'Non-unique edition')
    support = {r['season_id'] for r in table(db / 'catalog_verified/season-universe.json') if r['domain'] in ('stats','player_grade')}
    scores, score_years = indexed(base, 'grades_verified', 'player-scores', ('edition_id',))
    pending, pending_years = indexed(base, 'pending_verified', 'player-pending', ('edition_id','award'))
    roles, role_years = indexed(base, 'longitudinal', 'award-role', ('edition_id','award'))
    check(support <= score_years == pending_years == role_years and pending.keys() == roles.keys(), 'Incomplete partitions or groups')
    by_edition = {eid:Counter() for eid in edition_map}
    for (eid,), (year, s) in scores.items():
        check(edition_map[eid]['season_id'] == year, f'Edition season {eid}')
        by_edition[eid].update({field:s[field] for field in SCORE})
    published = {}
    for (eid, award), (year, p) in pending.items():
        ry, r = roles[eid, award]
        check(ry == year == edition_map[eid]['season_id'], f'Award input partition {eid}/{award}')
        check(p['pending_inputs'] == r['pending'] == r['current_assignable'] + r['recovered_by_award_history'] + r['no_model_role_after_award_history']
              and p['definitely_assignable_role'] == r['current_assignable'] and p['with_role_and_measured_touches'] == r['current_assignable_touches'],
              f'Role reconciliation {eid}/{award}')
        run = [r['latest_player_run'], r['latest_player_start']]
        check(published.setdefault(award, run) == run, f'Conflicting run for award {award}')
        by_edition[eid].update({field:p[field] for field in PENDING})
        by_edition[eid].update({field:r[field] for field in ROLE})
    rows = []
    totals = Counter()
    for eid in sorted(edition_map):
        ed, counts = edition_map[eid], by_edition[eid]
        check(counts['stats_records'] == counts['positive_minutes'] + counts['minutes_unknown'] + counts['zero_or_negative_minutes'], f'Minutes {eid}')
        check(counts['algorithm_inputs_before_coverage'] == counts['admitted_without_power_match'] + counts['insufficient_contribution']
              + counts['insufficient_role_reference'] + counts['proven_scorable'], f'Input reconciliation {eid}')
        check(counts['admitted_without_power_match'] == sum(counts[k] for k in ('current_assignable', 'recovered_by_award_history',
              'no_model_role_after_award_history')), f'Role total {eid}')
        check(counts['proven_scorable'] == counts['scorable_valid_persisted'] == counts['displayed_under_current_rule'] + counts['intentionally_hidden_cameo'], f'Score reconciliation {eid}')
        domain = ('archive' if ed['archive_key'] is not None else 'complementary_cup' if ed['cup_key'] is not None else 'native')
        rows.append({**{k:ed[k] for k in IDENTITY}, 'domain':domain, 'recorded_matches':ed['recorded_matches'],
                     'finished_matches':ed['finished'], 'source_coverage':'observed_stats' if counts['stats_records'] else 'no_observed_stats',
                     **{k:counts[k] for k in COLUMNS}})
        totals.update({k:counts[k] for k in COLUMNS})
    by_domain = Counter(r['domain'] for r in rows)
    observed = Counter(r['domain'] for r in rows if r['stats_records'])
    stats = {'snapshot':snap, 'deployed_sha':receipt['image'].rsplit(':',1)[1],
             'observed_method_versions':sorted({x['method_version'] for x in table(db / 'publication/run-times.json') if x['kind']=='players'}),
             'edition_count':len(rows), 'sql_count':len(receipt['query_sha256']), 'source_partitions':sorted(score_years),
             'pending_edition_award_groups':len(roles), 'editions_with_pending':sum(r['admitted_without_power_match'] > 0 for r in rows),
             'editions_by_domain':dict(by_domain), 'editions_with_observed_stats_by_domain':{k:observed[k] for k in by_domain},
             'latest_published_player_run_among_pending_awards':dict(sorted(published.items())),
             'five_requested_fields':{k:totals[k] for k in REQUIRED}, 'totals':dict(totals)}
    buffer=io.StringIO(newline='')
    writer=csv.DictWriter(buffer, fieldnames=rows[0].keys(),lineterminator='\n')
    writer.writeheader()
    writer.writerows(rows)
    return buffer.getvalue().encode(), stats

def verify_reverse(base, atomic_receipt):
    package = base / 'reverse-intermediate'
    source = package / 'reverse-intermediate.sql'
    receipt = read(package / 'receipt.json')
    deactivation = read(package / 'deactivation-receipt.json')
    normalized = re.sub(r'--[^\n]*', '', source.read_text()).strip().rstrip(';')
    check(receipt['query_sha256']['reverse-intermediate'] == digest(normalized.encode()), 'Independent SQL digest')
    check(receipt['exit_code'] == 0 and not receipt['sql_errors'] and receipt['image'] == atomic_receipt['image'] and
          deactivation['definition'] == receipt['definition'] and deactivation['end_state'] == 'INACTIVE', 'Independent task receipt')
    witness = read(package / 'local/local-verification.json')
    check((package / 'local/select.sql').read_bytes() == source.read_bytes() and
          witness['query_sha256'] == digest(source.read_bytes()), 'Local PostgreSQL fixture SQL')
    result = read(package / 'reverse-intermediate.json')
    rows = table(package / 'reverse-intermediate.json')
    check(len(rows) == 1 and result['database'] == 'vega_v2', 'Independent result')
    r = rows[0]
    check(r['stored_rows'] == sum(r[k] for k in ('admitted_source_rows','missing_source_rows','ineligible_source_rows','wrong_award_rows'))
          and r['stored_rows'] == r['distinct_match_player_pairs'] + r['excess_award_rows'], 'Independent bijections')
    return {'at': result['at'], **r}

def file_digests(base):
    return {p.relative_to(base).as_posix():digest(p.read_bytes()) for p in sorted(base.rglob('*'))
            if p.is_file() and p.name not in ('file-sha256.json', 'verification.log', '.DS_Store')}

def reader_counts(base):
    observations = read(base / 'reader-0200/observations.json')
    receipts = read(base / 'reader-0200/response-digests.json')
    check(len({o['key'] for o in observations}) == len(observations), 'Non-unique public sample')
    indexed_receipts = {(r['path'], r['utc']):r for r in receipts}
    for o in observations:
        for path, observed_at in [('/api/read/performance',o['performance_observed_at']),
                                  (f"/api/matches/{o['input']['public_match']}/players",o['match_observed_at'])]:
            receipt = indexed_receipts[(path,observed_at)]
            check(receipt['status'] == 200 and re.fullmatch('[0-9a-f]{64}',receipt['body_sha256']), 'HTTP receipt')
        check(o['found_as_requested'] and o['match_player_rows'] == 1 and o['performance_http'] == o['match_http'] == 200, 'HTTP identity')
    mismatch = [o['key'] for o in observations if o['performance_grade'] is None and o['match_grade'] is not None]
    null = sum(o['performance_grade'] is None and o['match_grade'] is None for o in observations)
    agree = sum(o['performance_grade'] is not None and o['match_grade'] is not None and
                abs(o['performance_grade'] - o['match_grade']) < 0.000000000001 for o in observations)
    check(len(mismatch) + null + agree == len(observations), 'Unreported public discrepancy')
    return {'transport':'aws lambda invoke with constructed GET events','status_source':'Lambda envelope statusCode',
            'observations':len(observations),'distinct_lambda_envelopes':len(receipts),'match_only':mismatch, 'null_on_both':null,'agree_numeric':agree}

PAIR = 'recorded_match_player_id_pairs_with_participation_cues'
ABSENT = 'recorded_cue_pairs_without_stats'
NO_MIN = 'recorded_cue_pairs_with_stats_without_positive_minutes'

def consumable_grid(name, raw):
    if name == 'score-query-snapshots.csv':
        return raw
    old = csv.DictReader(io.StringIO(raw.decode()))
    families = {'known_participations_minimum':(PAIR,'recorded_finished_team_sides'),
                'known_participants_without_stats':(ABSENT,),
                'known_participants_without_measured_minutes':(NO_MIN,)}
    aliases = {key+suffix:tuple(f+suffix for f in replacements) for key,replacements in families.items()
               for suffix in ('', '_verified_editions')}
    fields = [dst for source in old.fieldnames for dst in aliases.get(source,(source,))]
    buffer = io.StringIO(newline='')
    writer = csv.DictWriter(buffer, fieldnames=fields, lineterminator='\n')
    writer.writeheader()
    for row in old:
        is_player = row['entity_type'] == 'player'
        for source, dest in aliases.items():
            if source not in row:
                continue
            val = row.pop(source)
            row[dest[0]] = val if is_player else ''
            if len(dest) == 2:
                row[dest[1]] = '' if is_player else val
        writer.writerow(row)
    return buffer.getvalue().encode()

def participation_evidence(base):
    base_rows, byear = indexed(base, 'participants_verified','player-participations',('edition_id',))
    more_rows, myear = indexed(base, 'events_verified','player-event-cues',('edition_id',))
    check(byear == myear, 'Inconsistent source years')
    all_rows = table(base / 'db/catalog_verified/editions.json')
    buffer = io.StringIO(newline='')
    fields = ('edition_id','season_id','competition','season',
              'base_cue_pairs','additional_event_cue_pairs',PAIR,
              'base_cue_pairs_without_stats','additional_event_cue_pairs_without_stats',ABSENT,
              'base_cue_pairs_with_stats_without_positive_minutes','additional_event_cue_pairs_with_stats_without_positive_minutes',NO_MIN)
    grades = {r['edition_id']:r for r in csv.DictReader(io.StringIO(gzip.decompress((base/'coverage-by-edition-and-entity.csv.gz').read_bytes()).decode())) if r['entity_type']=='player'}
    writer = csv.DictWriter(buffer,fieldnames=fields,lineterminator='\n')
    writer.writeheader()
    totals = Counter()
    for e in sorted(all_rows,key=lambda row:row['edition_id']):
        eid = e['edition_id']
        b = base_rows.get((eid,), (None,{}))[1]
        m = more_rows.get((eid,), (None,{}))[1]
        out = {k:e[k] for k in fields[:4]}
        for dest1, dest2, total, key1, key2 in [
                (*fields[4:7],'confirmed_participations','additional_confirmed_participations'),
                (*fields[7:10],'participants_without_stats','additional_without_stats'),
                (*fields[10:13],'participants_without_measured_minutes','additional_without_measured_minutes')]:
            out[dest1],out[dest2]=int(b.get(key1,0)),int(m.get(key2,0))
            out[total]=out[dest1]+out[dest2]
            check(int(grades[str(eid)][total]) == out[total], f'Cue groups {eid}/{total}')
        writer.writerow(out)
        totals.update({k:out[k] for k in fields[4:]})
    return buffer.getvalue().encode(), dict(totals)

def verify_origin(base):
    folder = base / 'origin-https'
    origin, extra = read(folder/'origin-observations.json'),read(folder/'actor-ranking.json')
    original = read(base/'reader-0200/response-digests.json')
    frozen = {r['path'].lstrip('/') + ('?'+r['query'] if r['query'] else ''):r['body_sha256'] for r in original}
    primary = {r['path']:r['body_sha256'] for r in origin['receipts']}
    check(primary == frozen and len(primary)==len(original)==46,'Origin/Lambda digests by path and query')
    check(origin['summary']['origin']['auth']=='AWS_IAM' and origin['summary']['release']['function']=='vega-v2-api', 'Origin authentication')
    bodies={}
    for r in [*origin['receipts'],*extra['receipts']]:
        content=(folder/'origin-bodies'/(r['body_sha256']+'.json')).read_bytes()
        check(r['status']==200 and digest(content)==r['body_sha256'] and r['path'] not in bodies,'HTTPS receipt and bytes')
        val=json.loads(content)
        bodies[r['path']]=val.get('data',val)
    checks={r['key']:r for r in origin['observations']}
    for row in read(base/'reader-0200/observations.json'):
        subject=row['input']
        query=urllib.parse.urlencode({'season':'2021/2022','league':subject['public_competition'],'appearance':row['key']})
        performance=bodies['api/read/performance?'+query]
        performance=performance.get('row',performance)
        players=[v for v in bodies['api/matches/'+subject['public_match']+'/players'] if v['player']['id']==subject['public_player']]
        check(performance['id']==row['key'] and len(players)==1,'HTTPS subject')
        grades=[v['stat']['value'] for g in players[0].get('stats',[]) for v in g['stats'].values() if v['key']=='vega_grade']
        check(len(grades)<=1 and (grades[0] if grades else None)==row['match_grade']==checks[row['key']]['match'] and
              performance.get('grade')==row['performance_grade']==checks[row['key']]['appearance'] and performance.get('gradeZ')==row['performance_z'],
              'Body extraction '+row['key'])
    check(len(extra['receipts'])==10 and len(checks)==27 and len(bodies)==56,'Bounded request count')
    for expected in extra['actor_observations']:
        m,pid=expected['match'],expected['player']
        prefix='api/matches/'+m+'/'
        def has_actor(obj):
            if isinstance(obj,list):return any(has_actor(v) for v in obj)
            if isinstance(obj,dict):return any(has_actor(v) for v in obj.values())
            return obj==pid
        events=[[a.get('minute'),a.get('event_type'),a.get('player',{}).get('id'),a.get('sub_in_player',{}).get('id')]
                for a in bodies[prefix+'events']['events'] if has_actor(a)]
        shots=[[a.get('minute'),a.get('minute_added'),a.get('event_type')] for group in bodies[prefix+'shots']['periods']
               for a in group['shots'] if a.get('player',{}).get('id')==pid]
        check(has_actor(bodies[prefix+'lineups'])==expected['in_lineup'] and
              any(a['player']['id']==pid for a in bodies[prefix+'players'])==expected['in_players'] and
              events==expected['events'] and shots==expected['shots'],'Actor evidence '+pid)
    board = subprocess.run(['node',str(folder/'board-portable.mjs')],check=True,text=True,capture_output=True)
    check(board.stdout == (folder/'board.jsonl').read_text(),'Runtime boardRows')
    return {'lambda_envelopes':len(original), 'signed_https_identical_to_envelope_body':len(primary),
            'additional_signed_https':len(extra['receipts']),'offline_extractions':len(checks),
            'board_rows':len(board.stdout.splitlines())}

def publish_corrections(root, out):
    initial = root.parents[2] / 'delivery/notes-transaction/archive/initial-delivery.zip'
    check(digest(initial.read_bytes()) == 'a859f2cff805ba33786534112b611f63251cf9dbf8c03cdba39ccfc6af764690','Frozen historical delivery')
    (out / 'archive').mkdir(exist_ok=True)
    if initial.resolve() != (out / 'archive/initial-delivery.zip').resolve():
        shutil.copyfile(initial, out / 'archive/initial-delivery.zip')
    review = root.parent / 'reviews/astra62-final-current'
    target = out / 'origin-https'
    target.mkdir(exist_ok=True)
    for name in ('origin-observations.json','actor-ranking.json','board.jsonl','board.mjs','origin.py','actor_ranking.py'):
        shutil.copyfile(review/name,target/name)
    shutil.copytree(review/'origin-bodies',target/'origin-bodies',dirs_exist_ok=True)
    shutil.copyfile(root/'reader.py',out/'reader-0200/reader.py')
    scope = read(root.parent/'scope.json')
    source = subprocess.check_output(['git','-C',scope['worktree'],'show',scope['production']+':dashboard/frontend/src/services/match-tabs.js'])
    check(digest(source)=='d437fa28def9d71bad523014ad5cd7162e1d97c348c7deb08317b412f385d600','Frozen board source')
    (target/'match-tabs.mjs').write_bytes(source)
    board = (review/'board.mjs').read_text()
    start,end = board.index("const root="),board.index("const o1=")
    board = board[:start] + """const o=fileURLToPath(new URL('.',import.meta.url));
const read=f=>JSON.parse(readFileSync(join(o,f)));
const sha='8018e0836ca0f32e8b2eb51fc2847154abff7f13';
const moduleUrl=new URL('match-tabs.mjs',import.meta.url);
assert.equal(createHash('sha256').update(readFileSync(moduleUrl)).digest('hex'),'d437fa28def9d71bad523014ad5cd7162e1d97c348c7deb08317b412f385d600');
const {boardRows}=await import(moduleUrl);
""" + board[end:]
    (target/'board-portable.mjs').write_text(board)
    official = read(root.parent/'participation-cues/adjudications/primary-receipt.json')
    positive = [r for r in official if r['source'] in ('laval','uefa','copenhagen')]
    check(len(positive) == 3 and all(r['status'] == 200 for r in positive), 'Official witnesses')
    (target/'official-actor-receipts.json').write_text(json.dumps(positive,indent=2,ensure_ascii=False)+'\n')
    source_review = root.parent / 'astra-review.md'
    check(digest(source_review.read_bytes())=='6ffbbd9e5f29270ca0b60cc152d9e8af57782ff308cba2910b0c68cb057d5a26','Independent review')
    cues, counts = participation_evidence(out)
    (out/'participation-cues-by-edition.csv').write_bytes(cues)
    (out/'participation-cues-summary.json').write_text(json.dumps(counts,indent=2)+'\n')
    verify = read(review/'independent-counts.json')
    check(counts['base_cue_pairs']==verify['base_playing_cues']['confirmed_participations'] and
          counts['additional_event_cue_pairs']==verify['additional_event_cues']['additional_confirmed_participations'] and
          counts[PAIR]==verify['total_distinct_recorded_cues'], 'Independent participation sums')
    results=verify_origin(out)
    (target/'transport-summary.json').write_text(json.dumps(results,indent=2)+'\n')
    return counts, results

def verify_package(base):
    check(file_digests(base) == read(base / 'file-sha256.json'), 'Published file digest')
    check(reader_counts(base) == read(base / 'reader-0200/summary.json'), 'Public observations')
    origin = verify_origin(base)
    cues, cue_counts = participation_evidence(base)
    check(cues == (base / 'participation-cues-by-edition.csv').read_bytes() and
          cue_counts == read(base / 'participation-cues-summary.json'), 'Participation cues')
    check(origin == read(base / 'origin-https/transport-summary.json'), 'HTTPS versus Lambda')
    encoded, numbers = player_report(base)
    verify_reverse(base, read(base / 'receipt.json'))
    check(encoded == (base / 'player-reasons-by-edition.csv').read_bytes(), 'Edition CSV mismatch')
    check(json.loads(json.dumps(numbers)) == read(base / 'player-reasons-summary.json'), 'Report mismatch')
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        shutil.copytree(base / 'db', work / 'db')
        shutil.copytree(base / 'scores', work / 'scores')
        shutil.copyfile(base / 'verify_grid.py', work / 'verify_grid.py')
        subprocess.run([sys.executable, str(work / 'scores/build-score-grid.py')],cwd=work,check=True)
        subprocess.run([sys.executable, str(work / 'verify_grid.py')],cwd=work,check=True)
        for name in TABLES:
            check(consumable_grid(name, (work / 'scores' / name).read_bytes()) == gzip.decompress((base / (name + '.gz')).read_bytes()), f'Grid mismatch {name}')
    print('Publication vérifiée', numbers['edition_count'], 'éditions,', numbers['pending_edition_award_groups'],
          'groupes en attente,',numbers['sql_count'],'SELECT, cinq compteurs',list(numbers['five_requested_fields'].values()))

    initial = base / 'archive/initial-delivery.zip'
    check(digest(initial.read_bytes())=='a859f2cff805ba33786534112b611f63251cf9dbf8c03cdba39ccfc6af764690','Initial delivery archive')
    with tempfile.TemporaryDirectory() as temp:
        with zipfile.ZipFile(initial) as archive:
            archive.extractall(temp)
        subprocess.run([sys.executable,str(Path(temp)/'replay.py'),'--verify',temp],check=True,capture_output=True)
    print('Initial delivery replayed. Source groups',cue_counts['base_cue_pairs'],cue_counts['additional_event_cue_pairs'],
          'transport',origin)

if len(sys.argv) > 1 and sys.argv[1] == '--verify':
    verify_package(Path(sys.argv[2]).resolve())
    sys.exit(0)
root = Path(__file__).resolve().parent
a = argparse.ArgumentParser()
a.add_argument('input', type=Path)
a.add_argument('output', type=Path)
args = a.parse_args()
capture, out = args.input.resolve(), args.output.resolve()
out.mkdir(exist_ok=True, parents=True)
snap, r = verify_receipt(capture)
shutil.copytree(capture / 'db', out / 'db', dirs_exist_ok=True)
for name in r['inputs']:
    dst = out / name
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(capture / name, dst)
reverse_source = root.parents[2] / 'db/t5_reverse_intermediates_nov18_verified'
reverse_target = out / 'reverse-intermediate'
shutil.copytree(reverse_source, reverse_target, dirs_exist_ok=True)
shutil.copyfile(root.parents[2] / 'db/retry-receipt-t5_reverse_intermediates_nov18.json', reverse_target / 'deactivation-receipt.json')
shutil.copytree(root / 'reverse-intermediate', reverse_target / 'local', dirs_exist_ok=True)
shutil.copytree(root / 'reader-after-cooldown', out / 'reader-0200', dirs_exist_ok=True)
reverse = verify_reverse(out, r)
http = reader_counts(out)
(out / 'reader-0200/summary.json').write_text(json.dumps(http, indent=2) + '\n')
shutil.copyfile(Path(__file__), out / 'replay.py')
encoded, numbers = player_report(capture)
(out / 'player-reasons-by-edition.csv').write_bytes(encoded)
(out / 'player-reasons-summary.json').write_text(json.dumps(numbers,indent=2,ensure_ascii=False) + '\n')
subprocess.run([sys.executable,str(root/'compare.py'),str(capture),str(out/'comparaison.json')],check=True)
delta=read(out/'comparaison.json'); state=delta['values_by_entity']
for entity, changes in state.items():
    for version in ('earlier','atomic','delta'):
        values=changes[version]
        if 'known_participations_minimum' in values:
            values[PAIR if entity=='player' else 'recorded_finished_team_sides'] = values.pop('known_participations_minimum')
        for old, new in [('known_participants_without_stats',ABSENT),('known_participants_without_measured_minutes',NO_MIN)]:
            if old in values:
                values[new]=values.pop(old)
delta['participation_unit']='Recorded match/player-id pairs with a playing cue. Actual people, appearances and owed grades are unknown.'
(out / 'comparaison.json').write_text(json.dumps(delta, indent=2, sort_keys=True, ensure_ascii=False) + '\n')
for name in ['coverage-by-edition-and-entity.csv','coverage-by-season-and-entity.csv','score-query-snapshots.csv']:
 (out/(name+'.gz')).write_bytes(gzip.compress(consumable_grid(name,(capture/'scores'/name).read_bytes()),compresslevel=9,mtime=0))
cues, transport = publish_corrections(root,out)
for name in ('snapshot.json','receipt.json'):shutil.copyfile(capture/name,out/name)
for name in ['sample-keys','run-times']:shutil.copyfile(capture/'db/publication'/(name+'.json'),out/(name+'.json'))
for name in ['player-scores','player-participations','player-pending','player-event-cues']:
 paths=sorted((capture/'db').rglob(name+'-*.sql'))
 assert paths
 for p in paths:shutil.copyfile(p,out/p.name)
for name in ['team-sides-all','team-grade-integrity','editions','sample-keys','run-times','season-universe']:
 p=next((capture/'db').rglob(name+'.sql'));shutil.copyfile(p,out/p.name)
row=state['player']['atomic'];cases=delta['same_23_keys']['atomic'];summary=read(capture/'scores/grid-validation.json')
text=f'''# Couverture des notes au {snap["at"][:19]} UTC

Les {fr(summary["edition_entity_rows"])} lignes couvrent {fr(summary["editions"])} éditions, {fr(summary["competitions"])} compétitions et {fr(summary["seasons"])} saisons. La grille des statistiques et des notes provient d’une seule transaction RDS en lecture seule. Le contrôle inverse et les lectures de l’API ont chacun leur propre horodatage. Les tables détaillées comptent chaque type d’entité pour chaque édition et chaque saison. [Par édition](coverage-by-edition-and-entity.csv.gz) · [Par saison](coverage-by-season-and-entity.csv.gz) · [Horaires et requêtes](score-query-snapshots.csv.gz) · [Instantané PostgreSQL](snapshot.json)

| Entité et population mesurée | Attendu selon la règle déployée | Valeurs valides persistées | Évolution des valeurs valides depuis le relevé du 17 au soir |
| --- | ---: | ---: | ---: |
'''
for kind,label in [('player','Joueurs avec indice interne calculé'),('club','Clubs admis au calcul Elo'),('national team','Sélections admises au calcul Elo')]:
 v=state[kind];text+='| '+label+' | '+fr(v['atomic']['expected_proven'])+' | '+fr(v['atomic']['actual_valid'])+' | '+fr(v['delta']['actual_valid'])+' |\n'
text+=f'''
La base enregistre {fr(row['algorithm_inputs_before_coverage'])} couples match–identifiant joueur avec des minutes positives admis au calcul. Pour {fr(row['admitted_without_power_match'])} d’entre eux, l’intermédiaire manque à la date du relevé. Le seuil de la fiche performance masque {fr(row['intentionally_hidden_cameo'])} notes déjà enregistrées.

## Ce que compte une apparition enregistrée

| Couples match–identifiant joueur de matchs terminés | Durée positive, titularisation ou remplacement | Candidats supplémentaires détectés par but ou tir, gardien compris | Total enregistré |
| --- | ---: | ---: | ---: |
| Avec un indice de participation | {fr(cues['base_cue_pairs'])} | {fr(cues['additional_event_cue_pairs'])} | {fr(cues[PAIR])} |
| Sans ligne de statistiques | {fr(cues['base_cue_pairs_without_stats'])} | {fr(cues['additional_event_cue_pairs_without_stats'])} | {fr(cues[ABSENT])} |
| Avec ligne de statistiques mais sans durée positive mesurée | {fr(cues['base_cue_pairs_with_stats_without_positive_minutes'])} | {fr(cues['additional_event_cue_pairs_with_stats_without_positive_minutes'])} | {fr(cues[NO_MIN])} |

Les identifiants sont dédupliqués au sein de chaque match. Une même personne ou un même fait de jeu peut toutefois être rattaché à plusieurs identifiants. Une durée positive peut aussi figurer sur la ligne de la mauvaise personne. Le nombre de personnes ayant véritablement joué et le nombre de notes qui leur étaient dues restent inconnus. Le chiffre {fr(cues[PAIR])} ne fournit aucune borne physique. Les {fr(cues['additional_event_cue_pairs'])} identifiants supplémentaires sont des candidats à vérifier. [Décompositions pour les 2 149 éditions](participation-cues-by-edition.csv) · [Totaux](participation-cues-summary.json)

Sur Laval–Saint-Étienne, Vega attribue le but de la 51ᵉ minute à Miguel Belem, absent de ses familles composition et joueurs. Le tir victorieux de la même minute est rattaché à Ben Old, que le club désigne comme buteur. Sur PSV–Copenhague, Vega attribue le tir à 90+5 à Oscar Højlund. La feuille UEFA et le compte rendu de Copenhague désignent Emil Højlund, que Vega enregistre entrant à la 86ᵉ. Ces deux erreurs sont constatées sur des relevés nominatifs distincts du recensement agrégé. Leur incidence exacte sur son total reste inconnue. [Témoins de l’origine AWS](origin-https/actor-ranking.json) · [Reçus officiels bornés](origin-https/official-actor-receipts.json) · [Feuille ASSE](https://www.asse.fr/fr/lives/laval-asse-l8856/) · [Composition UEFA](https://match.uefa.com/v5/matches/2033414/lineups?language=EN) · [Compte rendu de Copenhague](https://fck.dk/nyhed/kampreferat-en-af-vores-mest-forrygende-kampe-nogensinde)

La grille brute archivée nommait ce champ `known_participations_minimum`. La grille de lecture diffusée et le CSV de décomposition utilisent `recorded_match_player_id_pairs_with_participation_cues` pour les joueurs. Les équipes ont une colonne propre, `recorded_finished_team_sides`. Les SQL et leurs sorties conservent les noms originaux avec leurs empreintes. [Archive et rejeu initiaux](archive/initial-delivery.zip) · [SQL des signaux de base](db/participants_verified/) · [SQL des actions supplémentaires](db/events_verified/)

Sur les 23 mêmes couples joueur–match de 2021/22, {cases['with_intermediate']} possèdent maintenant l’intermédiaire et {cases['stored_numeric']} une note persistée, dont {cases['public_display_numeric']} satisfont la règle d’affichage. Le calcul local antérieur avait produit 21 valeurs et deux rôles indéterminés. [23 clés et nouvelles valeurs](sample-keys.json) · [Publications du worker](run-times.json) · [Écarts mesurés](comparaison.json)
'''
with (capture/'scores/coverage-by-edition-and-entity.csv').open() as handle:
 editions=list(csv.DictReader(handle))
unresolved=[v for v in editions if v['entity_type']=='player' and int(v['admitted_without_power_match'] or 0)>0]
unresolved.sort(key=lambda v:(-int(v['admitted_without_power_match']),int(v['edition_id'])))
text+='\n## Éditions avec le plus de participations en attente d’un indice joueur\n\n'
text+='| Édition | Saison | Participations admises | Notes persistées | Sans indice |\n| --- | --- | ---: | ---: | ---: |\n'
for c in unresolved[:12]:
 text+='| '+ c['competition'].replace('|','\\|')+' ('+c['edition_id']+') | '+c['season']+' | '+fr(int(c['algorithm_inputs_before_coverage']))+' | '+fr(int(c['actual_valid']))+' | '+fr(int(c['admitted_without_power_match']))+' |\n'
text+='\nCe tableau compte les entrées admises par l’algorithme avant attribution du poste. La grille détaille les statistiques absentes et les notes déjà calculées mais masquées. Le CSV joueurs ci-dessous explique comment les postes se répartissent parmi les lignes en attente.\n'
totals = numbers['totals']
requested_labels = {
    'unknown_or_wrong_team':'Minutes positives avec équipe absente ou étrangère aux deux adversaires',
    'positive_minutes_outside_award_window':'Minutes positives en domaine natif, sans date ou hors fenêtre de récompense',
    'no_published_award':'Entrées admises sans intermédiaire, sans publication joueurs dans leur année',
    'insufficient_contribution':'Entrées admises avec intermédiaire, contribution absente',
    'insufficient_role_reference':'Entrées admises avec contribution dans un intermédiaire, indice absent'
}
text += '\n## Causes mesurées pour les joueurs\n\n'
text += f"Le [CSV joueurs](player-reasons-by-edition.csv) contient une ligne par édition. La table s’appuie sur les six partitions source de 2021 à 2026 et le recensement global des partitions. Les {fr(numbers['pending_edition_award_groups'])} groupes en attente contiennent des années de récompense de 2020 à 2026. Le fichier de synthèse conserve l’heure du relevé, le SHA déployé, la méthode observée et les identifiants des publications par année concernée. [Synthèse et années](player-reasons-summary.json) · [Catalogue](db/catalog_verified/editions.json) · [Partitions](db/catalog_verified/season-universe.json)\n\n"
text += '| Compteur SQL demandé | Population contrôlée | Total |\n| --- | --- | ---: |\n'
for field, label in requested_labels.items():
    text += f'| `{field}` | {label} | {fr(totals[field])} |\n'
text += f"""
Dans les {fr(totals['stats_records'])} lignes de statistiques de matchs terminés, {fr(totals['minutes_unknown'])} ont une durée inconnue et {fr(totals['positive_minutes'])} une durée positive. La valeur zéro ou négative apparaît {fr(totals['zero_or_negative_minutes'])} fois. Les {fr(totals['algorithm_inputs_before_coverage'])} entrées admises se répartissent entre {fr(totals['scorable_valid_persisted'])} indices valides persistés et {fr(totals['admitted_without_power_match'])} entrées sans intermédiaire. Dans les notes valides, {fr(totals['displayed_under_current_rule'])} franchissent le seuil de la fiche joueur et {fr(totals['intentionally_hidden_cameo'])} restent masquées sur cette fiche.

Parmi les entrées sans intermédiaire, {fr(totals['current_assignable'])} ont un poste assignable immédiatement, {fr(totals['recovered_by_award_history'])} retrouvent un poste détaillé dans une autre apparition de la même année et {fr(totals['no_model_role_after_award_history'])} restent sans poste. Les statistiques de {fr(totals['stats_newer_than_run'])} entrées en attente portent une écriture postérieure au démarrage de la dernière publication. Le contrôle des postes assignables dont l’écriture précède ou coïncide avec ce démarrage donne {fr(totals['assignable_stats_older_than_latest_player_start'])}. Ces horodatages décrivent l’état observé et ne démontrent pas la visibilité transactionnelle d’une ligne au démarrage du worker. [Six sorties annuelles et six sources SQL](db/longitudinal/) · [Statistiques et indices](db/grades_verified/) · [Entrées en attente](db/pending_verified/) · [Contrôle inverse des notes par partition](db/grade_integrity_verified/)

Sur {fr(numbers['editions_by_domain']['native'])} éditions natives, {fr(numbers['editions_with_observed_stats_by_domain']['native'])} ont des statistiques joueurs sur matchs terminés. Les {fr(numbers['editions_by_domain']['complementary_cup'])} éditions de coupe complémentaires et {fr(numbers['editions_by_domain']['archive'])} éditions d’archives ont respectivement {fr(numbers['editions_with_observed_stats_by_domain']['complementary_cup'])} et {fr(numbers['editions_with_observed_stats_by_domain']['archive'])} éditions avec de telles statistiques. Une absence de source laisse la population sportive réelle inconnue. Les compteurs portent sur les lignes conservées en base. Les champs d’équipe, d’année, de chronologie et de provenance peuvent se recouper au sein d’une population. Les six requêtes annuelles établissent la disponibilité du poste parmi les cas en attente. Elles ne permettent pas d’attribuer à chaque joueur noté la voie de résolution de son poste, de séparer dans le compteur de fenêtre les dates absentes, ou d’énumérer les clés individuelles à partir des groupes. Les matchs non terminés et les rencontres sans statistiques restent comptés dans le catalogue des éditions. Le contrôle inverse des intermédiaires et des paires multi-annuelles utilise une transaction indépendante.

Le second relevé, à {reverse['at'][:19]} UTC, a parcouru {fr(reverse['stored_rows'])} intermédiaires, soit {fr(reverse['distinct_match_player_pairs'])} paires match/joueur distinctes. Il retrouve {fr(reverse['admitted_source_rows'])} sources admises. Les effectifs sans source, à source inéligible, à année incorrecte, sur plusieurs années ou en excédent sont respectivement {fr(reverse['missing_source_rows'])}, {fr(reverse['ineligible_source_rows'])}, {fr(reverse['wrong_award_rows'])}, {fr(reverse['multiple_award_pairs'])} et {fr(reverse['excess_award_rows'])}. Cette transaction a son propre reçu et sa propre heure. [Résultat indépendant](reverse-intermediate/reverse-intermediate.json) · [Reçu indépendant](reverse-intermediate/receipt.json) · [Requête](reverse-intermediate/reverse-intermediate.sql) · [Cas témoins sur PostgreSQL 18.3](reverse-intermediate/local/local-verification.json)

## Lecteurs et valeur transmise au tableau

À 02 h 00 UTC, le collecteur a transmis des événements GET construits localement avec `aws lambda invoke`. Les {http['distinct_lambda_envelopes']} invocations distinctes de `vega-v2-api` ont produit des enveloppes contenant `statusCode=200`. Le collecteur a conservé les valeurs extraites et les SHA-256 des corps. À 02 h 22 UTC, le relecteur a adressé les mêmes chemins et requêtes à l’URL de fonction AWS par HTTPS, avec signature SigV4 et authentification IAM. Les {transport['signed_https_identical_to_envelope_body']} corps reçus ont chacun le même SHA-256 que celui consigné à 02 h 00. Le paquet contient ces corps pour rejouer la vérification hors réseau. [Collecteur Lambda](reader-0200/reader.py) · [Empreintes des enveloppes](reader-0200/response-digests.json) · [Reçus HTTPS et clés](origin-https/origin-observations.json) · [Corps indexés par SHA-256](origin-https/origin-bodies/)

Pour les 27 clés relues, les deux lecteurs retrouvent le même identifiant. Pour 23 clés, les notes numériques concordent. Pour deux autres, les deux valeurs sont nulles. Dix GET HTTPS signés supplémentaires à 02 h 24 UTC couvrent les événements, tirs, joueurs et compositions des deux matchs à attribution contestée et le classement de deux matchs avec caméo. Tous ont répondu HTTP 200. Pour ces deux caméos, la fiche performance et le classement rendent une note nulle alors que la famille joueurs contient une note numérique. Sur les corps HTTPS, la fonction frontend de production `boardRows` restitue 53,7018086536606 pour Alexandru Mățan (7 minutes) et 55,053611690361 pour Samuel Moutoussamy (1 minute). Le contrôle porte sur les données des lignes de tableau exécutées sous Node.js. Le chemin CDN/Vercel et le rendu dans un navigateur restent non observés. [Dix reçus supplémentaires](origin-https/actor-ranking.json) · [Sorties du tableau](origin-https/board.jsonl) · [Module figé](origin-https/match-tabs.mjs) · [Protocole de rejeu](rejeu.md)
"""
(out/'README.md').write_text(text)
(out / 'rejeu.md').write_text(REPLAY_GUIDE)
(out / 'file-sha256.json').write_text(json.dumps(file_digests(out),sort_keys=True,indent=2) + '\n')
print(summary['edition_entity_rows'],delta['snapshot']['at'])
