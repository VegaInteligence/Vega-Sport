"""Bounded fresh-source pilot; artifacts contain measurements, never response bodies."""
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import os
from pathlib import Path
import statistics
import sys
import time

import psycopg
from .normalize import NormalizedFamily, NormalizationError, normalize_family
from .pitchapi import PitchClient, PitchError
from .store import FAMILY_TABLES, Store, StoreError, connect_local, migrate

# Order reuses the names observed in lineups/basic stats before ID-only networks.
DETAILS = (
    ('summary', '', 'summary'), ('lineups', '/lineups', 'lineups'),
    ('player_stats', '/players', 'players'), ('team_stats', '/stats', 'stats'),
    ('shots', '/shots', 'shots'), ('events', '/events', 'events'),
    ('momentum', '/momentum', 'momentum'), ('player_halves', '/players/halves', 'players_halves'),
    ('advanced', '/advanced', 'advanced'), ('advanced_players', '/advanced/players', 'advanced_players'),
    ('network', '/advanced/network', 'advanced_network'), ('heatmaps', '/heatmaps', 'heatmaps'),
    ('h2h', '/h2h', 'h2h'),
)


class Pilot:
    def __init__(self, store, key, *, interval=0.5):
        self.store = store
        self.events = []
        self.client = PitchClient(key, interval=interval, on_attempt=self.events.append)
        self.writes = defaultdict(list)
        self.results = Counter()
        self.errors = Counter()
        self.started = time.perf_counter()
        self.edition = None
        self.available_matches = 0
        self.selected_matches = 0
        self.completed_matches = 0
        self.fatal_error = None

    def fetch(self, family, endpoint, params=None, *, kind=None, ident=None):
        self.events.clear()
        try: return self.client.fetch(endpoint, params)
        finally:
            for event in self.events:
                self.store.log_attempt(family, event, entity_type=kind, entity_id=ident, competition_season_id=self.edition if family=='league_matches' else None,global_key='catalogue' if endpoint=='/leagues' else None)

    def hydrate(self, batch):
        grouped = defaultdict(dict)
        for ref in batch.references:
            if ref.provider_key and ref.entity_type != 'match':
                grouped[(ref.entity_type, ref.provider_key)].update({k:v for k,v in ref.fields.items() if v is not None})
        for (kind, key), fields in grouped.items():
            if fields.get('name') or self.store.has(kind, key): continue
            endpoint = {'competition': '/leagues/', 'team': '/teams/', 'player': '/players/'}[kind]+key
            parser = 'league' if kind=='competition' else kind
            result = self.fetch(parser, endpoint)
            profile = normalize_family(parser, result.data)
            if kind in ('team','player'):
                from .profiles import save_profile
                save_profile(self.store,kind,key,profile)
            else: self.store.save_references(profile,family=parser)

    def run(self, *, season, league_name, max_matches, resume=False, profile_limit=0):
        catalogue = self.fetch('league', '/leagues').data
        leagues = [x for x in catalogue.get('leagues', []) if x.get('name')==league_name and x.get('country_code') in ('FRA','FR')]
        if len(leagues)!=1: raise StoreError('LEAGUE_SELECTION_NOT_UNIQUE')
        league = leagues[0]
        if season not in league.get('seasons', []): raise StoreError('SEASON_NOT_AVAILABLE')
        # Catalogue is bounded to the explicitly requested competition/season.
        reference = {k:v for k,v in league.items() if k!='seasons'}
        reference['season'] = season
        self.store.save_references(normalize_family('league', reference))
        competition_id = self.store.resolve('competition', league['id'])
        with self.store.conn.transaction(): self.edition, _ = self.store.edition(competition_id, season)
        result = self.fetch('league_matches', '/leagues/'+league['id']+'/matches', {'season':season, 'status':'all'})
        identity = result.data.get('league',{})
        if identity.get('id') != league['id'] or identity.get('season',season) != season: raise StoreError('CALENDAR_IDENTITY_MISMATCH')
        calendar = normalize_family('league_matches', result.data)
        self.hydrate(calendar)
        self.store.save_matches(calendar, self.edition, family='league_matches')
        matches = [row for row in calendar.rows.get('core.matches',[]) if row.get('status')=='finished']
        matches.sort(key=lambda r: (str(r.get('kickoff_at') or r.get('match_date') or ''), r['id']), reverse=True)
        self.available_matches = len(matches)
        chosen = matches[:max_matches]
        self.selected_matches = len(chosen)
        if not chosen: raise StoreError('NO_FINISHED_MATCH')
        for count, match in enumerate(chosen, 1):
            mid = self.store.resolve('match', match['id'])
            for family, suffix, parser in DETAILS:
                if resume and family!='summary' and self.store.conn.execute("SELECT 1 FROM ops.family_state WHERE match_id=%s AND family=%s AND status IN ('ok','unavailable')", (mid,family)).fetchone():
                    self.results[(family,'resumed')]+=1; continue
                try:
                    result = self.fetch(family, '/matches/'+match['id']+suffix, kind='match', ident=mid)
                    batch = normalize_family(parser, result.data, match_id=match['id']) if result.coverage=='ok' else NormalizedFamily(coverage='unavailable')
                    self.hydrate(batch)
                    start = time.perf_counter()
                    if family=='summary': self.store.save_matches(batch, self.edition)
                    else: self.store.save_family(mid, family, batch)
                    self.writes[family].append((time.perf_counter()-start)*1000)
                    self.results[(family,result.coverage)]+=1
                except (PitchError, NormalizationError, StoreError, psycopg.Error) as error:
                    code = safe_code(error)
                    self.errors[(family,code)]+=1
                    self.store.record_failure(mid, family, code)
                    print(f'family={family} error={code}', flush=True)
            self.completed_matches += 1
            print(f'matches={count}/{len(chosen)} attempts={self.client.requests} failures={sum(self.errors.values())}', flush=True)
        self.collect_profiles(profile_limit)
        return not self.errors

    def collect_profiles(self, limit):
        """Explicitly bounded smoke, alternating team and player profiles."""
        from .jobs import claim
        from .profiles import save_profile,record_failure
        for index in range(limit):
            kind=('team','player')[index%2]
            with self.store.conn.transaction(): job=claim(self.store.conn,'reference',family=kind,lease_seconds=300)
            if not job: continue
            key=self.store.conn.execute("SELECT provider_key FROM core.provider_ids WHERE entity_type=%s AND provider='pitchapi' AND entity_id=%s",(kind,job['entity_id'])).fetchone()[0]
            lease=(job['id'],job['lease_token'])
            try:
                result=self.fetch(kind,'/'+kind+'s/'+key,kind=kind,ident=job['entity_id'])
                batch=normalize_family(kind,result.data)
                start=time.perf_counter()
                save_profile(self.store,kind,key,batch,lease)
                self.writes[kind].append((time.perf_counter()-start)*1000)
                self.results[(kind,'ok')]+=1
            except (PitchError,NormalizationError,StoreError,psycopg.Error) as error:
                code=safe_code(error);self.errors[(kind,code)]+=1
                record_failure(self.store,kind,key,code,lease)
                print(f'family={kind} error={code}',flush=True)

    def report(self, path):
        conn = self.store.conn
        seconds = time.perf_counter()-self.started
        # Relations use physical leaf sizes; parent tables are not counted twice.
        sizes = conn.execute("SELECT n.nspname,sum(pg_relation_size(c.oid)),sum(pg_indexes_size(c.oid)),sum(pg_total_relation_size(c.oid)) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('core','agg','ops') AND c.relkind='r' GROUP BY n.nspname ORDER BY n.nspname").fetchall()
        requests = conn.execute('SELECT family,http_status,error_code,count(*),round(avg(duration_ms)),percentile_cont(0.95) WITHIN GROUP(ORDER BY duration_ms) FROM ops.fetch_log GROUP BY family,http_status,error_code ORDER BY family,http_status,error_code').fetchall()
        unknown = conn.execute('SELECT family,field_path,occurrences FROM ops.unknown_fields ORDER BY family,field_path').fetchall()
        outcome = self.fatal_error or ('incomplete' if self.completed_matches!=self.selected_matches else 'family_errors' if self.errors else 'ok')
        rows = ['# Vega v2 isolated pilot', '', f'UTC: {datetime.now(timezone.utc).isoformat()}',
            f'PostgreSQL: {conn.execute("SHOW server_version").fetchone()[0]}',
            f'Overall result: {outcome}',
            f'Finished matches available: {self.available_matches}', f'Selected matches: {self.selected_matches}',
            f'Completed match loops: {self.completed_matches}', f'HTTP attempts this run (including retries/profiles): {self.client.requests}',
            f'Wall seconds: {seconds:.2f}', f'Family failures: {sum(self.errors.values())}', '',
            f'Calendar rows actually stored: {conn.execute("SELECT count(*) FROM core.matches").fetchone()[0]}',
            'A completed collection stores the whole competition calendar, and details only for selected matches.',
            'Database size includes empty schema/index overhead; do not extrapolate one-match bytes to a season.',
            'Only metadata, counts and timings are exported. No database dump, response or football row is exported.', '',
            '| Schema | Heap bytes | Index bytes | Total bytes including TOAST |', '|---|---:|---:|---:|']
        rows += [f'| {s} | {h} | {i} | {t} |' for s,h,i,t in sizes]
        rows += ['', '| Family | Outcome | Count |', '|---|---|---:|']
        rows += [f'| {f} | {status} | {n} |' for (f,status),n in sorted(self.results.items())]
        rows += ['', '| Family | SQL write median ms | SQL write p95 ms |', '|---|---:|---:|']
        for family,values in sorted(self.writes.items()):
            p95=statistics.quantiles(values,n=20,method='inclusive')[-1] if len(values)>1 else values[0]
            rows.append(f'| {family} | {statistics.median(values):.2f} | {p95:.2f} |')
        rows += ['', '| Family | HTTP status | Error | Attempts in database | Mean ms | P95 ms |', '|---|---|---|---:|---:|---:|']
        rows += [f'| {f} | {status} | {code or ""} | {n} | {mean} | {p95:.2f} |' for f,status,code,n,mean,p95 in requests]
        rows += ['', '| Family | Controlled error | Count |', '|---|---|---:|']
        rows += [f'| {f} | {code} | {n} |' for (f,code),n in sorted(self.errors.items())]
        rows += ['', '| Family | Unknown field path (no values) | Count |', '|---|---|---:|']
        rows += [f'| {f} | {field} | {n} |' for f,field,n in unknown]
        rows += ['', 'Named embedded references do not prove an explicit profile has been fetched.',
            '', '| Reference kind | Explicit profile success | Registered references |', '|---|---:|---:|']
        for kind,success,total in conn.execute("SELECT entity_type,count(last_success_at),count(*) FROM ops.reference_state WHERE provider='pitchapi' GROUP BY entity_type ORDER BY entity_type"):
            rows.append(f'| {kind} | {success} | {total} |')
        rows += ['', '| Typed fact table | Stored rows |', '|---|---:|']
        for table in sorted({t for tables in FAMILY_TABLES.values() for t in tables}):
            count=conn.execute(psycopg.sql.SQL('SELECT count(*) FROM core.{}').format(psycopg.sql.Identifier(table))).fetchone()[0]
            rows.append(f'| {table} | {count} |')
        rows += ['', 'Coverage counts below count source observations, including explicit zero; NULL is not zero.',
            '', '| Fact table | Metric | Non-NULL rows | Total rows |', '|---|---|---:|---:|']
        for table,metrics in {
            'player_match_stats':('minutes_played','goals','rating','xg','distance_m','sprints','top_speed_kmh'),
            'team_match_stats':('total_shots','xg','accurate_passes','accurate_passes_pct','distance_m'),
            'player_match_advanced':('xt_total','vaep_total','pv_total','xag'),
            'team_match_advanced':('xt_total','ppda','field_tilt'),
        }.items():
            for metric in metrics:
                covered,total=conn.execute(psycopg.sql.SQL('SELECT count({}),count(*) FROM core.{}').format(psycopg.sql.Identifier(metric),psycopg.sql.Identifier(table))).fetchone()
                rows.append(f'| {table} | {metric} | {covered} | {total} |')
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        Path(path).write_text('\n'.join(rows)+'\n', encoding='utf-8')


def safe_code(error):
    if isinstance(error, psycopg.Error): return 'DATABASE_'+(error.sqlstate or 'ERROR')
    return str(error) if isinstance(error,(PitchError, NormalizationError, StoreError)) else 'PILOT_ERROR'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--season',default='2025/2026')
    parser.add_argument('--league',default='Ligue 1')
    parser.add_argument('--max-matches',type=int,default=1)
    parser.add_argument('--report',default='work/vega-v2-pilot.md')
    parser.add_argument('--resume',action='store_true')
    parser.add_argument('--vector',action='store_true')
    parser.add_argument('--profile-limit',type=int,default=2)
    args = parser.parse_args()
    if not 1<=args.max_matches<=306: parser.error('max-matches must be between 1 and 306')
    if not 0<=args.profile_limit<=100: parser.error('profile-limit must be between 0 and 100')
    pilot = None
    try:
        with connect_local(os.environ.get('V2_DATABASE_URL','')) as conn:
            migrate(conn,vector=args.vector)
            pilot = Pilot(Store(conn),os.environ.get('PITCHAPI_API_KEY',''))
            try: ok=pilot.run(season=args.season,league_name=args.league,max_matches=args.max_matches,resume=args.resume,profile_limit=args.profile_limit)
            except Exception as error:
                pilot.fatal_error=safe_code(error)
                raise
            finally: pilot.report(args.report)
            return 0 if ok else 1
    except Exception as error:
        print('pilot_error='+safe_code(error),flush=True)
        if isinstance(error,PitchError): print(f'http_status={error.status} envelope_shape={getattr(error,"envelope_shape",None)} access_reason={getattr(error,"access_reason",None)}',flush=True)
        return 1


if __name__=='__main__': sys.exit(main())
