#!/usr/bin/env python3
"""Pre-code full workflows for the four typed FIFA and UEFA ranking routes."""
from __future__ import annotations
import argparse
from collections import Counter
from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import traceback
from urllib.parse import urlencode

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'docs/verification/orion-pro-rankings-20261105'
PRODUCT = ROOT / 'dashboard/backend/services/orion-pro-rankings.js'
COMP = ROOT / 'tests/orion_pro_competitions_local.py'
COMP_SHA = '65b0a91252c566a47dbdc15e39e6c537f9c143406e9947a8827902916ca30dde'


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


assert sha(COMP) == COMP_SHA, 'Qualified owned runtime differs'
spec = importlib.util.spec_from_file_location('rankings_owned_runtime', COMP)
owned = importlib.util.module_from_spec(spec)
spec.loader.exec_module(owned)
owned.BASE, owned.PRODUCT = BASE, PRODUCT
Runtime, BOUNDS, NODE, PG, save = owned.Runtime, owned.BOUNDS, owned.NODE, owned.PG, owned.save


def url(path, **params):
    query = urlencode({k: v for k, v in params.items() if v is not None})
    return '/api/' + path + ('?' + query if query else '')


def edition(kind, key, **params):
    return url('rankings/edition', kind=kind, edition=key, **params)


INDEX = '/api/rankings/index'
FIFA = edition('fifa-men', '2026-10-12.fifa')
CLUB_EDITION = edition('uefa-clubs', '2026.uefa')
CLUB_NEXT = edition('uefa-clubs', '2027.uefa')
ASSOC = url('rankings/associations', year='2026')
ASSOC_NEXT = url('rankings/associations', year='2027')
CLUB = url('rankings/club', club='t_000001')
UNMAPPED = url('rankings/club', club='t_000003')
PATHS = [INDEX, FIFA, ASSOC, CLUB]


def inputs():
    manifest = owned.inputs()
    seen = {Path(__file__).resolve(), COMP, ROOT / 'docs/verification/orion-pro-competitions-20261105/fixture.py',
            ROOT / 'docs/verification/orion-pro-enrichment-20261105/http_server.mjs',
            ROOT / 'dashboard/backend/services/relational-catalog.js',
            ROOT / 'dashboard/scripts/collect_rankings.py'}
    pending = [ROOT / 'dashboard/frontend/src/services' / n for n in ('catalog-client.js', 'standings-zones.js')]
    while pending:
        p = pending.pop().resolve()
        if p in seen:
            continue
        assert p.is_file() and p.is_relative_to(ROOT), p
        seen.add(p)
        refs = re.findall(r'''(?:from\s+|import\s*\(\s*|import\s+)["'](\.[^"']+)["']''', p.read_text())
        pending.extend(p.parent / ref for ref in refs)
    manifest.update({str(p.relative_to(ROOT)): sha(p) for p in seen})
    return dict(sorted(manifest.items()))


def token(c):
    manifest = c.ok(c.http('/api/dashboard/manifest'))
    return next(e['representationToken'] for e in manifest['editions'] if e['leagueId'] == 'l_000001')


def same(a, b):
    assert (a['status'], a['body'], a['headers']['etag']) == (b['status'], b['body'], b['headers']['etag'])


def unavailable_edition(c, kind, key, state):
    index = c.ok(c.http(INDEX))
    assert any((e['kind'], e['edition'], e['state']) == (kind, key, state) for e in index['unavailableEditions'])
    assert all((e['kind'], e['edition']) != (kind, key) for e in index['editions'])
    c.fail(c.http(edition(kind, key), headers={'If-None-Match': '*'}), 503)


def R00(c):
    assert c.ready['node'].startswith('v24.') and len(c.ready['calibration']) == 8
    assert c.ready['identity'] == {'role': 'statarena_runtime', 'readonly': 'on', 'statement': '8s',
                                   'locks': '1s', 'idle': '5s', 'ssl': True}


def R01(c):
    for path in PATHS:
        c.fail(c.http(path, headers={'If-None-Match': '*'}), 503)


def R02(c):
    for path in (INDEX + '?kind=fifa-men', '/api/rankings/edition', edition('fifa-men', '2026.uefa'),
                 edition('fifa-men', '2026-02-29.fifa'), edition('uefa-clubs', '2026-10-12.fifa'),
                 edition('uefa-clubs', '0000.uefa'), ASSOC + '&year=2027', url('rankings/associations', year='26'),
                 url('rankings/club', club='t_bad'), INDEX + '?v=pro1.9223372036854775808.' + 'a' * 64):
        r = c.http(path)
        c.fail(r, 400)
        assert r['sql'] == []
    r = c.http(INDEX, method='POST')
    c.fail(r, 405)
    assert r['sql'] == [] and r['headers']['allow'] == 'GET, HEAD'
    r = c.http('/api/rankings/other')
    assert r['status'] == 501 and r['sql'] == []


def R03(c):
    c.report['sportingFixture'] = c.fixture.prepare_competitions()
    original = token(c)
    c.report['rankingFixture'] = c.fixture.prepare_rankings()
    generation = c.fixture.rankings_generation
    c.fixture.set_catalogue(generation)
    for path in PATHS:
        c.fail(c.http(path), 503)
    c.fail(c.http(url('rankings/index', v=original)), 503)
    wrong = original[:-1] + ('a' if original[-1] != 'a' else 'b')
    c.fail(c.http(url('rankings/index', v=wrong)), 400)
    c.fail(c.http(url('rankings/index', v='pro1.9223372036854775807.' + '0' * 64)), 503)
    c.report['rankingsPublication'] = c.fixture.publish_rankings(generation)
    c.old = token(c)
    assert c.old != original
    c.control_paths = [url('dashboard/manifest', v=c.old), url('matches/m_000001/summary', v=c.old),
                       url('fixtures', league='l_000001', season='2026/2027', limit=2, v=c.old),
                       url('pitchapi/matches/m_000001/shots', v=c.old)]
    c.control = [c.http(path) for path in c.control_paths]
    assert all(r['status'] == 200 for r in c.control)


def R04(c):
    r = c.http(INDEX)
    index = c.ok(r)
    assert index['schemaVersion'] == 1 and index['coverage'] == 'partial'
    assert [(e['kind'], e['edition'], e['provider'], e['rows']) for e in index['editions']] == [
        ('uefa-clubs', '2027.uefa', 'UEFA', 1), ('uefa-clubs', '2026.uefa', 'UEFA', 2),
        ('uefa-clubs', '2026-11-04.sportsapi', 'SportsAPI', 1),
        ('uefa-associations', '2027.uefa', 'UEFA', 3), ('uefa-associations', '2026.uefa', 'UEFA', 3),
        ('fifa-men', '2026-10-12.fifa', 'FIFA', 2)]
    assert index['unavailableEditions'] == [
        {'kind': 'uefa-associations', 'edition': '2026-11-04.sportsapi', 'provider': 'SportsAPI', 'state': 'pending'}]
    assert all('path' not in e and 'sha256' not in e for e in index['editions'])


def R05(c):
    r = c.http(FIFA)
    body = c.ok(r)
    assert body['provider'] == 'FIFA' and body['officialEdition'] is True
    assert body['sourceUrl'] == 'https://inside.fifa.com/api/ranking-overview?locale=en&dateId=FRS_20261012&rankingType=football'
    assert [body[k] for k in ('effectiveOn', 'publishedAt', 'sourceUpdatedAt', 'retrievedAt')] == [
        '2026-10-12', '2026-10-14T12:30:00.000000Z', '2026-10-16T13:45:00.000000Z', '2026-11-04T17:00:00.000000Z']
    assert [(e['entityId'], e['entityName'], e['position'], e['points'], e['previousPosition']) for e in body['rows']] == [
        ('fifa:0001', 'Brasil', 1, Decimal('9007199254.740993'), 3),
        ('fifa:2', 'France', 2, Decimal('18.123456'), None)]
    assert '"points":9007199254.740993' in r['body']


def R06(c):
    x = c.ok(c.http(CLUB_EDITION))
    assert [r['entityId'] for r in x['rows']] == ['uefa:20', 'uefa:0000012345']
    assert [r['position'] for r in x['rows']] == [2, 2]
    assert [r['points'] for r in x['rows']] == [None, Decimal('123.450001')]
    assert x['rows'][1]['earnedPoints'] == 0 and x['rows'][1]['previousPosition'] == 5
    c.club_next = c.http(CLUB_NEXT)
    c.ok(c.club_next)


def R07(c):
    a = c.http(ASSOC)
    b = c.http(edition('uefa-associations', '2026.uefa'))
    assert c.ok(a) == c.ok(b) and a['body'] == b['body']
    assert [(r['countryCode'], r['position']) for r in c.ok(a)['rows']] == [('FRA', 1), ('ESP', 2), ('ITA', 2)]
    c.fail(c.http(url('rankings/associations', year='2025'), headers={'If-None-Match': '*'}), 404)


def R08(c):
    body = c.ok(c.http(ASSOC_NEXT))
    assert body['effectiveOn'] is body['publishedAt'] is body['sourceUpdatedAt'] is None
    seasons = [r['sourceRow']['seasonRankings'][0] for r in body['rows']]
    assert [r['seasonYear'] for r in seasons] == [2027, 2027, 2027]
    assert [r['nationalAssociationPoints'] for r in seasons] == [0, None, Decimal('7.25')]
    assert [r['totalPoints'] for r in seasons] == [70, Decimal('8.125001'), 2]
    assert [r['numberOfTeamsStillInPlaying'] for r in seasons] == [0, 2, 1]
    assert all('numberOfTeamsStillInPlaying' not in r['sourceRow']['overallRanking'] for r in body['rows'])


def R09(c):
    x = c.ok(c.http(edition('uefa-clubs', '2026-11-04.sportsapi')))
    assert x['provider'] == 'SportsAPI' and x['officialEdition'] is False
    assert [(r['entityId'], r['points']) for r in x['rows']] == [('sportsapi:soc-007', Decimal('3.456789'))]
    c.fail(c.http(edition('uefa-associations', '2026-11-04.sportsapi')), 503)
    c.fail(c.http(edition('uefa-clubs', '2025.uefa')), 404)


def R10(c):
    rows = c.ok(c.http(CLUB))['rows']
    assert [item['edition']['edition'] for item in rows] == ['2027.uefa', '2026.uefa']
    assert rows[0]['row'] is None
    assert rows[1]['row']['entityId'] == 'uefa:0000012345' and rows[1]['row']['position'] == 2
    assert rows[1]['row']['points'] == Decimal('123.450001')


def R11(c):
    x = c.ok(c.http(UNMAPPED))
    assert x['rows'] is None and x['coverage'] == 'unmapped'
    c.fail(c.http(url('rankings/club', club='t_999999')), 404)


def R12(c):
    before = c.native_state()
    save(c.run / 'lineage-before.json', before)
    try:
        c.fixture.foreign_lineage()
    except c.psycopg.Error as error:
        assert error.sqlstate == '23514' and 'Ranking entry source record requires' in error.diag.message_primary
        c.report['lineageRejection'] = {'sqlstate': error.sqlstate, 'message': error.diag.message_primary}
    else:
        raise AssertionError('Native seal accepted a ranking entry from unrelated lineage')
    after = c.native_state()
    save(c.run / 'lineage-after.json', after)
    assert before['tables'] == after['tables']
    c.report['rollbackSequenceDeltas'] = {
        n: [v, after['sequences'][n]] for n, v in before['sequences'].items() if v != after['sequences'][n]}


def R13(c):
    wire = {path: {k: r[k] for k in ('body', 'status')}
            for path in [ASSOC, ASSOC_NEXT, CLUB, UNMAPPED] for r in [c.http(path)]}
    p = c.run / 'consumer-wire.json'
    save(p, wire)
    c.report['consumers'] = json.loads(c.command([c.args.node24, BASE / 'consumer_oracle.mjs', p], 'consumers').stdout)


def R14(c):
    for path in PATHS:
        g = c.http(path)
        c.ok(g)
        tag = g['headers']['etag']
        assert tag.startswith('W/"orion-rankings1-')
        for method, headers, status in [('HEAD', {}, 200), ('GET', {'If-None-Match': tag}, 304)]:
            r = c.http(path, method=method, headers=headers)
            assert r['status'] == status and not r['body'] and r['headers']['etag'] == tag
            assert not any('orion:rankingsbody' in q['sql'] for q in r['sql'])
        if path != INDEX:
            assert any('orion:rankingsbody' in q['sql'] for q in g['sql'])
    c.fail(c.http(edition('uefa-associations', '2026-11-04.sportsapi'),
                  method='HEAD', headers={'If-None-Match': '*'}), 503)


def R15(c):
    old_path = edition('uefa-clubs', '2026.uefa', v=c.old)
    old = c.http(old_path)
    before = c.http(CLUB_EDITION)
    change = c.fixture.correction('bound')
    same(before, c.http(CLUB_EDITION))
    c.report['boundCorrection'] = c.fixture.publish_rankings(change['generation'])
    current = c.http(CLUB_EDITION)
    body = c.ok(current)
    assert body['rows'][0]['entityName'] == 'Corrected Club' and body['rows'][0]['points'] == Decimal('71.876543')
    assert current['headers']['etag'] != before['headers']['etag']
    assert c.ok(old)['rows'][1]['entityName'] == 'First Ranked Club'
    same(old, c.http(old_path))
    c.corrected = current


def R16(c):
    change = c.fixture.correction('unbound')
    c.report['unboundCorrection'] = c.fixture.publish_rankings(change['generation'])
    assert c.http(CLUB_EDITION)['body'] == c.corrected['body']
    assert c.http(CLUB_NEXT)['body'] == c.club_next['body']


def R17(c):
    before = c.http(CLUB)
    c.ok(before)
    change = c.fixture.correction('link_ambiguous')
    c.report['ambiguousClubLink'] = c.fixture.publish_rankings(change['generation'])
    c.fail(c.http(CLUB, headers={'If-None-Match': before['headers']['etag']}), 503)
    assert c.http(CLUB_EDITION)['body'] == c.corrected['body']


def R18(c):
    change = c.fixture.correction('incomplete')
    c.report['pendingEdition'] = c.fixture.publish_rankings(change['generation'])
    unavailable_edition(c, 'uefa-clubs', '2027.uefa', 'pending')
    c.fail(c.http(url('rankings/club', club='t_000002'), headers={'If-None-Match': '*'}), 503)


def R19(c):
    change = c.fixture.correction('method_ambiguous')
    c.report['ambiguousMethod'] = c.fixture.publish_rankings(change['generation'])
    unavailable_edition(c, 'uefa-clubs', '2026.uefa', 'ambiguous')
    assert c.ok(c.http(FIFA))['provider'] == 'FIFA'


def R20(c):
    change = c.fixture.correction('no_profile')
    c.report['unverifiedObservation'] = c.fixture.publish_rankings(change['generation'])
    unavailable_edition(c, 'fifa-men', '2026-11-02.fifa', 'unverified')


def R21(c):
    before = c.native_state()
    save(c.run / 'native-read-before.json', before)
    for path, expected in zip(c.control_paths, c.control):
        same(c.http(path), expected)
    r = c.http(FIFA)
    c.ok(r)
    assert c.http(FIFA, headers={'If-None-Match': r['headers']['etag']})['status'] == 304
    with c.connect('statarena_runtime') as db:
        try:
            db.execute("INSERT INTO football.players(display_name) VALUES('forbidden')")
        except c.psycopg.Error as error:
            assert error.sqlstate in {'25006', '42501'}
            c.report['readOnlySqlstate'] = error.sqlstate
        else:
            raise AssertionError('Ordinary runtime wrote')
    after = c.native_state()
    save(c.run / 'native-read-after.json', after)
    assert before == after


def R22(c):
    assert c.traces()['attempts'] == []
    assert all('statarena_app.' not in q['sql'] for r in c.report['requests'] for q in r['sql'])
    assert all(s not in r['body'] for r in c.report['requests'] for s in ('"source_record_id"', 'raw/rankings/', 'storage_bucket', 'Stable BRA'))


def R23(c):
    assert inputs() == c.report['inputHashes'] and len(c.traces()['calibration']) == 8
    c.report['inputsUnchanged'] = True
    actors = Counter(re.findall(r'^\[\d+\] app=([^ ]+) LOG:  (?:statement:|execute )',
                                (c.run / 'postgres.log').read_text(), re.MULTILINE))
    observed = c.budget.read()['counts']
    assert sum(actors.values()) == observed['sql'], (actors, observed)
    assert len(c.report['requests']) == observed['http']
    c.report['serverSqlByActor'] = dict(actors)


CASES = [R00, R01, R02, R03, R04, R05, R06, R07, R08, R09, R10, R11,
         R12, R13, R14, R15, R16, R17, R18, R19, R20, R21, R22, R23]


def main():
    p=argparse.ArgumentParser(description=__doc__);m=p.add_mutually_exclusive_group();m.add_argument('--precode-red',action='store_true');m.add_argument('--run-owned',action='store_true');m.add_argument('--manifest',action='store_true')
    p.add_argument('--release',type=Path);p.add_argument('--release-sha256');p.add_argument('--node24',type=Path,default=NODE);p.add_argument('--pg-bin',type=Path,default=PG);p.add_argument('--actual-app',action='store_true');p.add_argument('--label',default='rankings');args=p.parse_args()
    assert [f.__name__ for f in CASES]==[x['id'] for x in json.loads((BASE/'FAILURE_MATRIX.json').read_text())['cases']]
    if args.manifest:print(json.dumps(inputs(),indent=2));return 0
    if not args.run_owned and not args.precode_red:
        print(json.dumps({'kind':'rankings_e2e_offline_inventory','caseFunctions':24,'productPresent':PRODUCT.exists(),'pgStarts':0,'sourceCalls':0,'bounds':BOUNDS}));return 0
    assert re.fullmatch('[A-Za-z0-9][A-Za-z0-9-]{0,70}',args.label)
    manifest=inputs();release=None
    if args.run_owned:
        assert PRODUCT.is_file() and args.release and args.release.is_absolute() and args.release.is_relative_to(BASE) and sha(args.release)==args.release_sha256
        release=json.loads(args.release.read_text());assert set(release)=={'kind','scope','allocationId','inputHashes','bounds','ownedBaseCommit','expiresAt','actualApp'}
        assert release['kind']=='rankings_owned_e2e_release_v1' and release['scope']=='owned_source_free_only' and release['inputHashes']==manifest and release['bounds']==BOUNDS and release['actualApp'] is args.actual_app
        assert datetime.now(timezone.utc)<datetime.fromisoformat(release['expiresAt']) and re.fullmatch('[a-f0-9]{40}',release['ownedBaseCommit']) and re.fullmatch('[A-Za-z0-9-]{1,80}',release['allocationId'])
        assert not any(k.startswith('PG') for k in os.environ)
        consumed=BASE/(release['allocationId']+'.consumed.json');assert not consumed.exists()
    started=time.monotonic();stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ');run=BASE/'runs'/(stamp+'-'+args.label);(run/'inputs').mkdir(parents=True)
    report={'kind':'typed_rankings_e2e_v1','command':[sys.executable,*sys.argv],'expected':'FAILURE_MATRIX.json R00-R23 authored before the adapter','inputHashes':manifest,'bounds':BOUNDS,'sourceCalls':0,'cloudCalls':0,'cases':[],'requests':[],'actualApp':args.actual_app}
    for name,digest in manifest.items():
        dst=run/'inputs'/name;dst.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(ROOT/name,dst);assert sha(dst)==digest
    if args.precode_red:
        assert not PRODUCT.exists()
        argv=[str(args.node24),'--input-type=module','-e','await import('+json.dumps(PRODUCT.as_uri())+')']
        r=subprocess.run(argv,env={'PATH':'/usr/bin:/bin'},capture_output=True,text=True,timeout=10)
        (run/'node.stderr.log').write_text(r.stderr);(run/'node.stdout.log').write_text(r.stdout)
        assert r.returncode!=0 and 'ERR_MODULE_NOT_FOUND' in r.stderr and PRODUCT.name in r.stderr
        report.update(status='expected_precode_red',nodeCommand=argv,nodeExit=r.returncode,pgStarts=0,cleanup={'noOwnedServicesStarted':True},cases=[{'id':f.__name__,'status':'unverified'} for f in CASES]);save(run/'result.json',report)
        print(json.dumps({'status':report['status'],'receipt':str(run/'result.json'),'sha256':sha(run/'result.json')}));return 1
    with consumed.open('x') as f:f.write(json.dumps({'releaseSha256':args.release_sha256,'run':str(run.relative_to(ROOT))})+'\n')
    shutil.copyfile(args.release,run/'release.json')
    c=Runtime(args,run,report);failure=None
    try:
        c.setup(release)
        for f in CASES:
            before=time.monotonic()
            try:f(c);c.resource_check()
            except Exception as exc:report['cases'].append({'id':f.__name__,'status':'fail','error':str(exc),'traceback':traceback.format_exc()});raise
            report['cases'].append({'id':f.__name__,'status':'pass','elapsedMs':round((time.monotonic()-before)*1000,3)})
    except Exception as exc:failure={'error':str(exc),'traceback':traceback.format_exc()}
    finally:
        try:
            report['cleanup']=c.close()
            assert all(report['cleanup'].values())
        except Exception as exc:report['cleanup']={'failure':str(exc)};failure=failure or {'error':'Cleanup: '+str(exc)}
        report['commands']=c.commands
        if hasattr(c,'budget'):report['budget']=c.budget.read()
        report['cases'] += [{'id':f.__name__,'status':'unverified'} for f in CASES if f.__name__ not in {x['id'] for x in report['cases']}]
        report.update(status='fail' if failure else 'pass',failure=failure,elapsedSeconds=round(time.monotonic()-started,3))
        report['summary']={s:sum(x['status']==s for x in report['cases']) for s in ('pass','fail','unverified')};save(run/'result.json',report)
    print(json.dumps({'status':report['status'],'summary':report['summary'],'receipt':str(run/'result.json'),'sha256':sha(run/'result.json'),'cleanup':report['cleanup']}));return int(bool(failure))

if __name__=='__main__':raise SystemExit(main())
