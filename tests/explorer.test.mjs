import test from 'node:test';
import assert from 'node:assert/strict';
import {reactFixtures} from './react-runtime.mjs';
const { MATCH_SECTIONS, PitchExplorer, media, rawPlayerMetrics, safeImageUrl, structuredData }=await reactFixtures();

const player = {player:{id:'p_000001',name:'Player A'},team_id:'t_000001',stats:[{key:'top_stats',title:'Top stats',stats:{'Accurate passes':{key:'accurate_passes',stat:{value:4,total:4}},'Defensive actions':{key:'defensive_actions',stat:{value:1}},'Was fouled':{key:'was_fouled',stat:{value:null}}}}]};
const makeMatch = (id,league,leagueId,reliable=true) => ({id,league,leagueId,country:'FRA',season:'2026/2027',date:'2026-10-01',status:'finished',home:{id:'t_000001',name:'Home',score:1},away:{id:'t_000002',name:'Away',score:0},coverage:{teamStatsReliable:reliable,shots:reliable},shots:[],stats:[],warnings:[]});
const data = {meta:{endDate:'2026-10-01'},competitions:[],teams:[],matches:[makeMatch('m_000001','Ligue 1','l_000001'),makeMatch('m_000002','3. Liga','l_000002',false)],appearances:[{id:'m_000001:p_000001',playerId:'p_000001',name:'Player A',teamId:'t_000001',matchId:'m_000001'}]};
const makeShard = () => ({availability:{lineups:{state:'collected'},stats:{state:'collected'},players:{state:'collected'},shots:{state:'collected'}},lineups:{data:{home_team:{name:'Home'},away_team:{name:'Away'},home:{starters:[],subs:[]},away:{starters:[],subs:[]}}},stats:{data:{periods:[{period:'All',groups:[]}]}},players:{data:[structuredClone(player)]},shots:{data:{periods:[]}}});
const shards = new Map(data.matches.map(match=>[match.id,makeShard()]));
const explorer = () => new PitchExplorer({ data, redraw() {}, navigate() {}, openLocalMatch() {} });
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => structuredClone(body) });
const rejectExecutableMarkup = html => {
  assert.doesNotMatch(html, /<script(?:\s|>)/i);
  assert.doesNotMatch(html, /<img\s+src=["']?x(?:\s|>)/i);
  assert.doesNotMatch(html, /\son(?:error|load|click)=["']/i);
};

test('provider media allows only HTTPS CDN images and escapes names and attributes', () => {
  const good = 'https://cdn.pitchapi.dev/images/teams/example.webp';
  assert.equal(safeImageUrl(good), good);
  for (const bad of ['javascript:alert(1)', 'data:image/svg+xml,<svg onload="alert(1)"/>', 'http://cdn.pitchapi.dev/a.png', 'https://cdn.pitchapi.dev.evil.example/a.png', 'https://cdn.pitchapi.dev@evil.example/a.png', 'https://user:secret@cdn.pitchapi.dev/a.png', '//cdn.pitchapi.dev/a.png', null]) {
    assert.equal(safeImageUrl(bad), '', String(bad));
    assert.doesNotMatch(media('Club', bad), /<img\s/);
  }
  const html = media('<script>alert(1)</script>', `${good}?name="<img src=x onerror='alert(1)'>`, 'crest" onclick="alert(1)');
  rejectExecutableMarkup(html);
  assert.match(html, /loading="lazy"/);
  assert.match(html, /referrerpolicy="no-referrer"/i);
});

test('structured data retains unknown fields, missingness, zero and nested untrusted text', () => {
  const payload = {
    undefined_rate: null,
    genuine_zero: 0,
    enabled: false,
    '<img src=x onerror="alert(1)">': '<script>alert(1)</script>',
    future_provider_extension: { unrecognized_metric: null, preserved_name: 'Équipe A & B', items: [{ name: '<script>bad</script>', value: 4 }] },
  };
  const before = JSON.stringify(payload);
  const html = structuredData(payload);
  rejectExecutableMarkup(html);
  assert.match(html, /Undefined Rate/);
  assert.match(html, /missing-value/);
  assert.match(html, /Genuine Zero/);
  assert.match(html, /0,0000/);
  assert.match(html, /Future Provider Extension/);
  assert.match(html, /Unrecognized Metric/);
  assert.match(html, /Équipe A &amp; B/);
  assert.match(html, /&lt;script&gt;/);
  assert.equal(JSON.stringify(payload), before);
  const deep = { a: { b: { c: { d: { e: { f: { g: { raw: '<script>deep</script>', missing: null } } } } } } } };
  rejectExecutableMarkup(structuredData(deep));
  assert.match(structuredData(deep), /missing/);
});

test('synthetic shards render their collected families and preserve source warnings', () => {
  const app = explorer();
  assert.equal(shards.size, 2);
  for (const match of data.matches) {
    const shard = shards.get(match.id);
    for (const family of ['lineups', 'stats', 'players', 'shots']) {
      assert.equal(shard.availability[family].state, 'collected');
      const before = JSON.stringify(shard[family].data);
      const html = app.renderPayload(match, family, shard[family].data);
      assert.ok(html.length > 0, `${match.id}/${family}`);
      assert.doesNotMatch(html, /(?:NaN|Infinity)/, `${match.id}/${family}`);
      rejectExecutableMarkup(html);
      assert.equal(JSON.stringify(shard[family].data), before);
    }
    assert.match(app.renderPayload(match, 'lineups', shard.lineups.data), /Titulaires/);
    assert.match(app.renderPayload(match, 'players', shard.players.data), /toutes les métriques/);
    if (!match.coverage.teamStatsReliable) {
      assert.match(app.renderPayload(match, 'stats', shard.stats.data), /incohérences|incohérentes/i);
      assert.match(app.renderPayload(match, 'players', shard.players.data), /incohérences|incohérentes/i);
      assert.match(app.renderPayload(match, 'shots', shard.shots.data), /indisponibles|indisponible/);
    }
  }
});

test('player metrics keep fractions and deduplicate a metric repeated in provider groups', () => {
  const match = data.matches.find(m => m.league === 'Ligue 1');
  const players = shards.get(match.id).players.data;
  const player = players.find(p => p.player.name === 'Player A');
  const metrics = rawPlayerMetrics(player);
  assert.equal(metrics.get('accurate_passes').value, 4);
  assert.equal(metrics.get('accurate_passes').total, 4);
  assert.equal(metrics.get('defensive_actions').value, 1);
  assert.equal([...metrics.keys()].filter(key => key === 'defensive_actions').length, 1);
  const app = explorer();
  app.playerSelection.set(`${match.id}:players`, player.player.id);
  const html = app.playerStats(match, players, 'players');
  assert.match(html, /4,00 \/ 4,00/);
  assert.match(html, /Was fouled/);
  assert.match(html, /<dd>—<\/dd>/);
  const halves = { players: [{ player: player.player, team_id: player.team_id, periods: [
    { period: 'SecondHalf', stats: [{ key: 'top_stats', title: 'Top stats', stats: { Minutes: { key: 'minutes_played', stat: { type: 'integer', value: 17 } } } }] },
  ] }] };
  const halvesHtml = app.playerStats(match, halves, 'players/halves');
  assert.match(halvesHtml, /Seconde mi-temps/);
  assert.doesNotMatch(halvesHtml, /Première mi-temps/);
});

test('upcoming fixtures and H2H meetings retain null scores instead of a zero draw', () => {
  const app = explorer();
  const fixture = { id: 'm_000001', status: 'not_started', date: '2026-11-01', time_utc: '2026-11-01T20:00:00Z', score_home: null, score_away: null, home_team: { id: 't_000001', name: 'Home' }, away_team: { id: 't_000002', name: 'Away' } };
  const normalized = app.normalizedRemote(fixture);
  assert.equal(normalized.home.score, null);
  assert.equal(normalized.away.score, null);
  assert.match(app.fixtureRow(fixture), /À venir/);
  assert.doesNotMatch(app.fixtureRow(fixture), />0\s*<span>–/);
  const h2h = app.headToHead({ home_wins: 0, away_wins: 0, draws: 0, total_matches: 0, recent_matches: [{ home: fixture.home_team, away: fixture.away_team, score_home: null, score_away: null, finished: false }] });
  assert.match(h2h, /À venir/);
  assert.doesNotMatch(h2h, />0\s*<span>–/);
});

test('offline season fixtures include upcoming matches', () => {
  const fixture={id:'m_000003',status:'not_started',season:'2026/2027',league:{id:'l_000001'},home_team:{name:'A'},away_team:{name:'B'},score_home:null,score_away:null};
  const app=new PitchExplorer({data:{...data,fixtures:[fixture]},redraw(){},navigate(){},openLocalMatch(){}});
  assert.equal(app.localFixtures('l_000001','2026/2027')[0].id,'m_000003');
  assert.match(app.fixtureRow(fixture),/À venir/);
});

test('supplemental competitions remain separate and display missing stats as unknown', () => {
  const app=explorer();
  app.supplementalMode=true;
  app.supplementalData={meta:{source_generated_at_utc:'2026-10-31T04:53:24Z'},competitions:[{
    folder:'UKR_1_premier-league',name:'Ukrainian Premier League',country_code:'UKR',
    results:[{date:'2026-08-01',home:'<Club>',away:'Away',ft_home:'1',ft_away:'0',home_shots:'',away_shots:'3',home_corners:'',away_corners:'',source:'soccerway'}],fixtures:[],goals:[],
  }]};
  assert.match(app.renderSupplemental(),/non commercial/);
  app.handleClick({dataset:{supplementalCompetition:'UKR_1_premier-league'}});
  const html=app.renderSupplemental();
  assert.match(html,/Ukrainian Premier League/);
  assert.match(html,/&lt;Club&gt;/);
  assert.match(html,/missing-value/);
  assert.match(html,/<td>1<\/td><td>0<\/td>/);
  assert.doesNotMatch(html,/<Club>/);
  app.handleClick({dataset:{supplementalTab:'fixtures'}});
  assert.match(app.renderSupplemental(),/Aucune donnée/);
});

test('documented sparse heatmaps respect the chosen frame and skip invalid cells', () => {
  const app = explorer();
  const match = data.matches[0];
  const payload = { grid: { length: 16, width: 12, frame: 'home_ltr', cell_length_m: 6.5625, cell_width_m: 5.6667 }, teams: [
    { team: { id: match.home.id, name: 'Home <script>bad</script>' }, side: 'home', actions: 25, cells: [[3, 6, 14], [4, 6, 11], [-1, 0, 999]] },
  ], players: [{ player: { id: 'p_000001', name: 'Player' }, team: { id: match.home.id }, side: 'home', actions: 9, cells: [[5, 4, 9]] }] };
  const html = app.heatmaps(match, payload);
  assert.match(html, /Repère du domicile/);
  assert.match(html, /14 actions · cellule 3, 6/);
  assert.doesNotMatch(html, /999 actions/);
  rejectExecutableMarkup(html);
  app.heatSelection.set(match.id, 'p_000001');
  const playerHtml = app.heatmaps(match, payload);
  assert.match(playerHtml, /9 actions · cellule 5, 4/);
  assert.doesNotMatch(playerHtml, /14 actions · cellule/);
  assert.match(app.heatmaps(match, { grid: payload.grid, teams: [], players: [] }), /indisponible/);
});

test('documented pass networks omit unknown coordinates and unresolved edges', () => {
  const app = explorer();
  const payload = { networks: [{ team: { name: 'Club A' }, window: { kind: 'first_substitution', until_seconds: 3600 }, centralization: null, nodes: [
    { player: { id: 'p_000001', name: 'A' }, avg_x: 60, avg_y: 30, passes: 27 },
    { player: { id: 'p_000002', name: 'B' }, avg_x: 70, avg_y: 40, passes: 10 },
    { player: { id: 'p_000003', name: 'Unlocated' }, avg_x: null, avg_y: null, passes: null },
  ], edges: [
    { from: { id: 'p_000001' }, to: { id: 'p_000002' }, passes: 9 },
    { from: { id: 'p_000001' }, to: { id: 'p_000003' }, passes: 4 },
  ] }] };
  const html = app.networks(payload);
  assert.equal((html.match(/<circle /g) || []).length, 2);
  assert.equal((html.match(/<line /g) || []).length, 1);
  assert.match(html, /9 passes/);
  assert.doesNotMatch(html, /Unlocated|NaN|Infinity/);
  assert.match(html, /60,0 min/);
  assert.match(app.networks({ networks: [] }), /Réseau indisponible/);
});

test('all thirteen families handle an explicit null without manufacturing a chart or metric', () => {
  const app = explorer();
  assert.equal(new Set(MATCH_SECTIONS.map(([key]) => key)).size, 13);
  for (const [family] of MATCH_SECTIONS) {
    const html = app.renderPayload(data.matches[0], family, null);
    assert.match(html, /Données non renseignées/, family);
    assert.doesNotMatch(html, /<svg|<table|>0</, family);
  }
  assert.match(app.events({ events: [] }), /Aucun événement/);
  assert.match(app.momentum(data.matches[0], { points: [] }), /indisponible/);
});

test('untrusted event scores cannot become executable markup', () => {
  const html = explorer().events({ events: [{ event_type: 'Goal', minute: 1, score_home: '<img src=x onerror="alert(1)">', score_away: 0, player: { name: '<script>bad</script>' } }] });
  rejectExecutableMarkup(html);
});

test('documented own-goal flags are labelled CSC and excluded from cumulative xG', () => {
  const match = data.matches[0];
  const payload = { periods: [{ period: 'FirstHalf', shots: [
    { id: 's_000001', player: { id: 'p_000001', name: 'Scorer' }, team_id: match.home.id, x: 90, y: 34, expected_goals: 0.2, minute: 10, event_type: 'Goal', is_own_goal: false },
    { id: 's_000002', player: { id: 'p_000002', name: 'Own goal' }, team_id: match.away.id, x: 100, y: 34, expected_goals: 0.9, minute: 20, event_type: 'Goal', is_own_goal: true },
  ] }] };
  const html = explorer().shots(match, payload);
  assert.match(html, /<td>CSC<\/td>/);
  assert.match(html, /1 événement exclu/);
  assert.match(html, /But contre son camp/);
});

test('all thirteen live families use the proxy routes and preserve a successful null response', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url: String(url), options });
    return response({ data: null });
  });
  const app = explorer();
  const match = data.matches[0];
  app.configured = true;
  for (const [family] of MATCH_SECTIONS) {
    await app.ensureEndpoint(match, family);
    const result = app.payloads.get(`${match.id}:${family}`);
    assert.equal(result.source, 'api');
    assert.equal(result.data, null);
  }
  assert.equal(calls.length, 14); // One local-archive probe, then 13 API calls.
  const routes = new Set(calls.map(call => call.url).filter(url => url.startsWith('/api/pitchapi/')));
  assert.ok(routes.has(`/api/pitchapi/matches/${match.id}`));
  assert.ok(routes.has(`/api/pitchapi/matches/${match.id}/players/halves`));
  assert.ok(routes.has(`/api/pitchapi/matches/${match.id}/advanced/players`));
  assert.ok(routes.has(`/api/pitchapi/matches/${match.id}/advanced/network`));
  assert.ok(routes.has(`/api/pitchapi/matches/${match.id}/heatmaps`));
  assert.equal(routes.size, 13);
  assert.ok([...routes].every(route => route.startsWith('/api/pitchapi/')));
  assert.doesNotMatch(JSON.stringify(calls), /x-api-key|pk_live_|pk_test_|authorization/i);
});

test('missing-key mode loads known snapshot payloads once and keeps advanced data uncollected', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url: String(url), options });
    const id = String(url).match(/\/matches\/(m_[A-Za-z0-9]{6})\.json$/)?.[1];
    if (!id) throw new Error(`Unexpected network route: ${url}`);
    return shards.has(id) ? response(shards.get(id)) : response({}, 404);
  });
  const app = explorer();
  app.configured = false;
  app.statusKnown = true;
  for (const match of data.matches) {
    await app.ensureEndpoint(match, 'players');
    await app.ensureEndpoint(match, 'stats');
    const value = app.payloads.get(`${match.id}:players`);
    assert.equal(value.source, 'snapshot');
    assert.deepEqual(value.data, shards.get(match.id).players.data);
    await app.ensureEndpoint(match, 'advanced');
    const absent = app.payloads.get(`${match.id}:advanced`);
    assert.equal(absent.code, 'NOT_COLLECTED');
    assert.equal(Object.hasOwn(absent, 'data'), false);
  }
  assert.equal(calls.length, data.matches.length * 2); // Archive then static fallback.
  assert.ok(calls.every(call => !call.url.startsWith('https:') && !call.url.includes('/api/pitchapi')));
  assert.doesNotMatch(JSON.stringify(calls), /x-api-key|pk_live_|pk_test_|authorization/i);
});

test('proxy missing-key failure falls back only to a collected family and sends no API credential', async t => {
  const match = data.matches[0];
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url: String(url), options });
    return String(url).startsWith('/api/pitchapi/') ? response({ error: { code: 'PITCHAPI_NOT_CONFIGURED', message: 'Server key missing' } }, 503) : response(shards.get(match.id));
  });
  const app = explorer();
  app.configured = true;
  await app.ensureEndpoint(match, 'lineups');
  assert.equal(app.payloads.get(`${match.id}:lineups`).source, 'snapshot');
  await app.ensureEndpoint(match, 'advanced/network');
  assert.equal(app.payloads.get(`${match.id}:advanced/network`).code, 'PITCHAPI_NOT_CONFIGURED');
  assert.equal(Object.hasOwn(app.payloads.get(`${match.id}:advanced/network`), 'data'), false);
  assert.doesNotMatch(JSON.stringify(calls), /x-api-key|pk_live_|pk_test_|authorization/i);
});

test('fixture fallback is scoped to the original competition and season, including while navigation changes', async () => {
  const app = explorer();
  const original = data.matches[0];
  const other = data.matches.find(m => m.leagueId !== original.leagueId);
  app.competitionId = original.leagueId;
  app.season = original.season;
  let releaseStatus;
  app.statusPromise = new Promise(resolve => { releaseStatus = resolve; });
  const loading = app.loadFixtures();
  app.competitionId = other.leagueId;
  app.season = other.season;
  releaseStatus();
  await loading;
  const result = app.fixtures.get(`${original.leagueId}:${original.season}`);
  assert.equal(result.source, 'snapshot');
  assert.deepEqual(result.matches.map(match => match.id), [original.id]);
});

test('explicit retry recovers a temporarily missing local shard', async t => {
  const match = data.matches[0];
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => ++calls <= 2 ? response({}, 404) : response(shards.get(match.id)));
  const app = explorer();
  await app.ensureEndpoint(match, 'lineups');
  assert.equal(app.payloads.get(`${match.id}:lineups`).code, 'NOT_COLLECTED');
  await app.ensureEndpoint(match, 'lineups', true);
  assert.equal(app.payloads.get(`${match.id}:lineups`).source, 'snapshot');
  assert.equal(calls, 3);
});
