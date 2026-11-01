/** Small, dependency-free visualizations of the supplied observations. */
const COLORS = { home: '#c6f36b', away: '#b2a7df', grid: '#2b3426', text: '#9da98f', dark: '#e8efde', surface: '#172015' };
const isNumber = value => typeof value === 'number' && Number.isFinite(value);
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const fmt = (value, digits = 2) => isNumber(value) ? value.toLocaleString('fr-FR', { maximumFractionDigits: digits }) : 'Non renseigné';
const plural = (count, singular, multiple = `${singular}s`) => count === 1 ? singular : multiple;
const num = value => Number(value.toFixed(3));

function emptyState(title, detail) {
  return `<div class="chart-empty" role="status"><span class="chart-empty-mark" aria-hidden="true">—</span><strong>${esc(title)}</strong><p>${esc(detail)}</p></div>`;
}

function scaleExtent(values, targetTicks = 4) {
  const low = values.reduce((min, value) => Math.min(min, value), 0);
  const high = values.reduce((max, value) => Math.max(max, value), 0);
  const span = high - low || 1;
  const rough = span / targetTicks;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const factor = rough / magnitude;
  const step = (factor <= 1 ? 1 : factor <= 2 ? 2 : factor <= 2.5 ? 2.5 : factor <= 5 ? 5 : 10) * magnitude;
  const min = Math.floor(low / step) * step;
  const max = Math.ceil((high || 1) / step) * step;
  const ticks = [];
  for (let index = 0; index <= Math.round((max - min) / step); index += 1) ticks.push(num(min + index * step));
  return { min, max, ticks };
}

function axisGrid({ width, height, margin, xDomain, yDomain, xLabel, yLabel, minuteAxis = false }) {
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const x = value => margin.left + ((value - xDomain.min) / (xDomain.max - xDomain.min || 1)) * innerWidth;
  const y = value => margin.top + innerHeight - ((value - yDomain.min) / (yDomain.max - yDomain.min || 1)) * innerHeight;
  const lines = yDomain.ticks.map(value => `<line class="chart-grid" x1="${margin.left}" y1="${num(y(value))}" x2="${width - margin.right}" y2="${num(y(value))}" stroke="${COLORS.grid}"/><text class="chart-tick" x="${margin.left - 12}" y="${num(y(value) + 4)}" text-anchor="end" fill="${COLORS.text}" font-size="11">${esc(fmt(value))}</text>`).join('');
  const labels = xDomain.ticks.map(value => `<text class="chart-tick" x="${num(x(value))}" y="${height - margin.bottom + 23}" text-anchor="middle" fill="${COLORS.text}" font-size="11">${esc(fmt(value))}${minuteAxis ? '′' : ''}</text>`).join('');
  const html = `${lines}${labels}<text class="chart-axis" x="${margin.left}" y="15" fill="${COLORS.text}" font-size="11">${esc(yLabel)}</text><text class="chart-axis" x="${width - margin.right}" y="${height - 5}" text-anchor="end" fill="${COLORS.text}" font-size="11">${esc(xLabel)}</text>`;
  return { x, y, html };
}

function playerInteraction(id, label) {
  return `${id ? `data-open-player="${esc(id)}" role="button"` : 'role="img"'} tabindex="0" aria-label="${esc(label)}"`;
}

/** One point is one player appearance; missing values are never replaced by zero. */
export function scatterPlot(appearances, options = {}) {
  const { xKey = 'xg', yKey = 'xa', xLabel = 'xG', yLabel = 'xA' } = options;
  const source = Array.isArray(appearances) ? appearances : [];
  const available = source.filter(appearance => isNumber(appearance[xKey]) && isNumber(appearance[yKey]));
  if (!available.length) return emptyState('Pas de points à afficher', `Aucune apparition ne dispose de ${xLabel} et de ${yLabel} renseignés dans ce périmètre.`);

  const width = 640;
  const height = 310;
  const margin = { left: 44, right: 25, top: 31, bottom: 47 };
  const xDomain = scaleExtent(available.map(appearance => appearance[xKey]));
  const yDomain = scaleExtent(available.map(appearance => appearance[yKey]));
  const axis = axisGrid({ width, height, margin, xDomain, yDomain, xLabel, yLabel });
  // Limit SVG nodes for full-season datasets while keeping the original domain.
  const maxPoints = 1200;
  const shown = available.length > maxPoints
    ? Array.from({ length: maxPoints }, (_, index) => available[Math.floor(index * available.length / maxPoints)])
    : available;
  const points = shown.map(appearance => {
    const label = `${appearance.name} · ${typeof appearance.team === 'string' ? appearance.team : appearance.team?.name || ''} · ${xLabel} : ${fmt(appearance[xKey])} · ${yLabel} : ${fmt(appearance[yKey])}${isNumber(appearance.minutes) ? ` · ${fmt(appearance.minutes, 0)} minutes` : ''}`;
    return `<circle class="chart-point" cx="${num(axis.x(appearance[xKey]))}" cy="${num(axis.y(appearance[yKey]))}" r="4.4" fill="${COLORS.home}" fill-opacity="0.64" stroke="${COLORS.surface}" stroke-width="1.1" ${playerInteraction(appearance.id, label)}><title>${esc(label)}</title></circle>`;
  }).join('');
  const missing = source.length - available.length;
  const description = `${available.length} apparitions avec les deux mesures renseignées. Axe horizontal : ${xLabel}. Axe vertical : ${yLabel}. Chaque point ouvre la fiche de l'apparition.`;
  return `<figure class="chart-figure scatter-chart"><svg viewBox="0 0 ${width} ${height}" width="100%" role="group" aria-label="${esc(`${xLabel} et ${yLabel} par apparition`)}" xmlns="http://www.w3.org/2000/svg"><title>${esc(`${xLabel} et ${yLabel} par apparition`)}</title><desc>${esc(description)}</desc>${axis.html}${points}</svg><figcaption class="chart-caption">Un point = une apparition · ${fmt(available.length, 0)} avec les deux mesures${shown.length < available.length ? ` · ${fmt(shown.length, 0)} points affichés` : ''}${missing ? ` · ${fmt(missing, 0)} ${plural(missing, 'apparition sans les deux mesures', 'apparitions sans les deux mesures')}` : ''}.</figcaption></figure>`;
}

function selectedShots(match, teamId) {
  return (Array.isArray(match?.shots) ? match.shots : []).filter(shot => teamId === 'all' || shot.teamId === teamId);
}

function teamFor(match, teamId) {
  if (teamId === match?.home?.id) return { name: match.home.name, color: COLORS.home };
  if (teamId === match?.away?.id) return { name: match.away.name, color: COLORS.away };
  return { name: 'Équipe non renseignée', color: COLORS.away };
}

function shotLabel(shot, match) {
  const types = { Goal: 'But', OwnGoal: 'But contre son camp', AttemptSaved: 'Tentative arrêtée ou contrée', Miss: 'Tir non cadré', Post: 'Montant' };
  const outcome = shot.isOwnGoal ? 'But contre son camp' : shot.isGoal ? 'But' : types[shot.type] || shot.type || 'Tir';
  return `${shot.playerName || 'Joueur non renseigné'} · ${teamFor(match, shot.teamId).name} · ${isNumber(shot.minute) ? `${fmt(shot.minute)}′` : 'Minute non renseignée'} · ${outcome} · xG : ${fmt(shot.xg)}`;
}

function teamLegend(match, teamId, values) {
  return `<div class="chart-legend">${['home', 'away'].filter(side => teamId === 'all' || teamId === match?.[side]?.id).map(side => {
    const team = match[side];
    const value = values?.[side];
    return `<span class="chart-legend-item"><span class="chart-legend-dot" style="display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;background:${COLORS[side]}" aria-hidden="true"></span>${esc(team?.name || 'Équipe')}${values ? ` <strong>${isNumber(value) ? `${esc(fmt(value))} xG` : 'xG non renseignés'}</strong>` : ''}</span>`;
  }).join('')}</div>`;
}

/** Full provider coordinate space. Never reverses a team's coordinates. */
export function shotMap(match, options = {}) {
  const { teamId = 'all' } = options;
  if (!Array.isArray(match?.shots) || !match.shots.length) return emptyState('Tirs indisponibles', 'Le relevé ne contient pas de données de tirs exploitables pour ce match.');
  const shots = selectedShots(match, teamId);
  const located = shots.filter(shot => isNumber(shot.x) && isNumber(shot.y));
  if (!located.length) return emptyState('Carte indisponible', 'Aucun tir avec des coordonnées renseignées dans ce périmètre.');

  const width = 660;
  const height = 443;
  const left = 26;
  const top = 22;
  const fieldWidth = 608;
  const fieldHeight = fieldWidth * 68 / 105;
  const x = value => left + value * fieldWidth / 105;
  const y = value => top + value * fieldHeight / 68;
  const centerY = y(34);
  const fieldStroke = '#3a4a30';
  const pitch = `<rect x="${left}" y="${top}" width="${fieldWidth}" height="${num(fieldHeight)}" rx="3" fill="#141e11" stroke="${fieldStroke}"/><g stroke="${fieldStroke}" fill="none" stroke-width="1"><line x1="${num(x(52.5))}" y1="${top}" x2="${num(x(52.5))}" y2="${num(y(68))}"/><circle cx="${num(x(52.5))}" cy="${num(centerY)}" r="${num(9.15 * fieldWidth / 105)}"/><rect x="${left}" y="${num(y(13.84))}" width="${num(16.5 * fieldWidth / 105)}" height="${num(40.32 * fieldHeight / 68)}"/><rect x="${num(x(88.5))}" y="${num(y(13.84))}" width="${num(16.5 * fieldWidth / 105)}" height="${num(40.32 * fieldHeight / 68)}"/><rect x="${left}" y="${num(y(24.84))}" width="${num(5.5 * fieldWidth / 105)}" height="${num(18.32 * fieldHeight / 68)}"/><rect x="${num(x(99.5))}" y="${num(y(24.84))}" width="${num(5.5 * fieldWidth / 105)}" height="${num(18.32 * fieldHeight / 68)}"/><rect x="${left - 5}" y="${num(y(30.34))}" width="5" height="${num(7.32 * fieldHeight / 68)}"/><rect x="${left + fieldWidth}" y="${num(y(30.34))}" width="5" height="${num(7.32 * fieldHeight / 68)}"/></g><g fill="${fieldStroke}"><circle cx="${num(x(52.5))}" cy="${num(centerY)}" r="2"/><circle cx="${num(x(11))}" cy="${num(centerY)}" r="2"/><circle cx="${num(x(94))}" cy="${num(centerY)}" r="2"/></g>`;
  // Draw goals last so they remain visible when several events share coordinates.
  const points = [...located].sort((a, b) => Number(Boolean(a.isGoal || a.isOwnGoal)) - Number(Boolean(b.isGoal || b.isOwnGoal))).map(shot => {
    const color = teamFor(match, shot.teamId).color;
    const goal = Boolean(shot.isGoal || shot.isOwnGoal);
    const radius = isNumber(shot.xg) ? 4 + 9 * Math.sqrt(Math.max(0, Math.min(1, shot.xg))) : 5;
    const label = shotLabel(shot, match);
    const id = shot.playerId ? `${match.id}:${shot.playerId}` : null;
    return `<circle class="chart-point shot-point" cx="${num(x(shot.x))}" cy="${num(y(shot.y))}" r="${num(radius)}" fill="${goal ? color : COLORS.surface}" fill-opacity="${goal ? '0.96' : '0.7'}" stroke="${color}" stroke-width="${goal ? 1.8 : 1.4}"${isNumber(shot.xg) ? '' : ' stroke-dasharray="2 2"'} ${playerInteraction(id, label)}><title>${esc(label)}</title></circle>`;
  }).join('');
  const missingXg = located.filter(shot => !isNumber(shot.xg)).length;
  const missingCoordinates = shots.length - located.length;
  return `<figure class="chart-figure shot-map">${teamLegend(match, teamId)}<svg viewBox="0 0 ${width} ${height}" width="100%" role="group" aria-label="Carte des tirs" xmlns="http://www.w3.org/2000/svg"><title>Carte des tirs</title><desc>${esc(`${located.length} tirs positionnés dans les coordonnées du fournisseur, sans inversion selon l'équipe. Les buts sont pleins, les autres tirs sont creux. Taille selon les xG renseignés.`)}</desc>${pitch}${points}</svg><figcaption class="chart-caption">Coordonnées du fournisseur · buts en plein, autres tirs en contour · taille selon xG${missingXg ? ` · ${fmt(missingXg, 0)} ${plural(missingXg, 'xG absent')} en pointillé` : ''}${missingCoordinates ? ` · ${fmt(missingCoordinates, 0)} sans coordonnées` : ''}.</figcaption></figure>`;
}

/** Cumulative known xG, with a step at the actual recorded minute of each shot. */
export function xgTimeline(match, options = {}) {
  const { teamId = 'all' } = options;
  if (!Array.isArray(match?.shots) || !match.shots.length) return emptyState('Chronologie indisponible', 'Les données de tirs de ce match ne permettent pas de tracer les xG.');
  const shots = selectedShots(match, teamId);
  const valid = shots.filter(shot => isNumber(shot.minute) && isNumber(shot.xg) && !shot.isOwnGoal).sort((a, b) => a.minute - b.minute || String(a.id || '').localeCompare(String(b.id || '')));
  if (!valid.length) return emptyState('xG indisponibles', 'Aucun tir avec minute et xG renseignés dans ce périmètre.');

  const sides = ['home', 'away'].filter(side => teamId === 'all' || teamId === match?.[side]?.id);
  const series = sides.map(side => {
    let total = 0;
    const events = valid.filter(shot => shot.teamId === match[side]?.id).map(shot => ({ shot, total: (total += shot.xg) }));
    return { side, events, total: events.length ? total : null };
  });
  const knownSeries = series.filter(item => item.events.length);
  if (!knownSeries.length) return emptyState('Équipes non identifiées', 'Les tirs renseignés ne sont pas rattachés aux équipes de ce match.');

  const width = 640;
  const height = 280;
  const margin = { left: 44, right: 25, top: 31, bottom: 47 };
  const lastMinute = Math.max(...valid.map(shot => shot.minute));
  const xDomain = scaleExtent([lastMinute]);
  const yDomain = scaleExtent(knownSeries.map(item => item.total));
  const axis = axisGrid({ width, height, margin, xDomain, yDomain, xLabel: 'Minute du tir', yLabel: 'xG cumulés renseignés', minuteAxis: true });
  const paths = knownSeries.map(({ side, events }) => {
    const color = COLORS[side];
    let path = `M ${num(axis.x(0))} ${num(axis.y(0))}`;
    for (const event of events) path += ` H ${num(axis.x(event.shot.minute))} V ${num(axis.y(event.total))}`;
    path += ` H ${num(axis.x(lastMinute))}`;
    const area = `${path} V ${num(axis.y(0))} H ${num(axis.x(0))} Z`;
    const points = events.map(({ shot, total }) => {
      const label = `${shotLabel(shot, match)} · xG cumulés : ${fmt(total)}`;
      return `<circle class="chart-point" cx="${num(axis.x(shot.minute))}" cy="${num(axis.y(total))}" r="3" fill="${color}" stroke="${COLORS.surface}" stroke-width="1" tabindex="0" role="img" aria-label="${esc(label)}"><title>${esc(label)}</title></circle>`;
    }).join('');
    return `<path d="${area}" fill="${color}" fill-opacity="0.07"/><path d="${path}" fill="none" stroke="${color}" stroke-width="2.3" stroke-linejoin="round"${side === 'away' ? ' stroke-dasharray="5 3"' : ''}/>${points}`;
  }).join('');
  const totals = Object.fromEntries(series.map(item => [item.side, item.total]));
  const excluded = shots.length - valid.length;
  return `<figure class="chart-figure xg-timeline">${teamLegend(match, teamId, totals)}<svg viewBox="0 0 ${width} ${height}" width="100%" role="group" aria-label="Évolution des xG cumulés renseignés" xmlns="http://www.w3.org/2000/svg"><title>Évolution des xG cumulés renseignés</title><desc>${esc(`Cumul des xG à la minute de chaque tir disponible, jusqu'à la ${fmt(lastMinute)}e minute observée. Les événements sans minute, sans xG ou contre son camp sont exclus.`)}</desc>${axis.html}${paths}</svg><figcaption class="chart-caption">Cumul à chaque tir disponible · dernier tir à ${fmt(lastMinute)}′${excluded ? ` · ${fmt(excluded, 0)} ${plural(excluded, 'événement exclu', 'événements exclus')} (xG ou minute absent, ou CSC)` : ''}.</figcaption></figure>`;
}
