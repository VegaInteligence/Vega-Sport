// The account screens' drawing (VI-38, docs/COMPTES_SITE.md S8): training pitches at night seen from above, as in
// the presentation film behind the share image. Inline SVG, decorative, no request. Night and ivory in both themes.
import { useId } from "react";

const W = 105, H = 68, GAP = 18, COLS = 4, ROWS = 6;
const PLAN_W = COLS * W + (COLS + 1) * GAP;
const PLAN_H = ROWS * H + (ROWS + 1) * GAP;
/** Cells drawn as two small pitches side by side (column, row). */
const SPLIT = new Set(["1,1", "3,2", "0,4", "2,5"]);
/** Floodlight masts, at crossings of the alleys (column line, row line). */
const MASTS = [
  [1, 1],
  [3, 2],
  [2, 3],
  [1, 4],
  [3, 5],
];
const cellX = (col) => GAP + col * (W + GAP);
const cellY = (row) => GAP + row * (H + GAP);
const mastX = (col) => GAP / 2 + col * (W + GAP);
const mastY = (row) => GAP / 2 + row * (H + GAP);

function PitchLines() {
  return (
    <>
      <rect x="0" y="0" width={W} height={H} />
      <path d={`M${W / 2} 0V${H}`} />
      <circle cx={W / 2} cy={H / 2} r="9.15" />
      <rect x="0" y="13.85" width="16.5" height="40.3" />
      <rect x={W - 16.5} y="13.85" width="16.5" height="40.3" />
      <rect x="0" y="24.85" width="5.5" height="18.3" />
      <rect x={W - 5.5} y="24.85" width="5.5" height="18.3" />
      <path d="M16.5 26.69A9.15 9.15 0 0 1 16.5 41.31" />
      <path d={`M${W - 16.5} 26.69A9.15 9.15 0 0 0 ${W - 16.5} 41.31`} />
      <rect x="-2.2" y="30.34" width="2.2" height="7.32" />
      <rect x={W} y="30.34" width="2.2" height="7.32" />
    </>
  );
}

function Plan({ pitch }) {
  const cells = [];
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const x = cellX(col), y = cellY(row);
      if (!SPLIT.has(`${col},${row}`)) {
        cells.push(<use key={`${col},${row}`} href={`#${pitch}`} x={x} y={y} />);
        continue;
      }
      // Two small pitches, turned a quarter: each H tall, H * H / W wide.
      const scale = H / W, side = H * scale;
      for (const [i, left] of [x + (W / 2 - side) / 2, x + W / 2 + (W / 2 - side) / 2].entries())
        cells.push(
          <use key={`${col},${row},${i}`} href={`#${pitch}`} transform={`translate(${left + side} ${y}) rotate(90) scale(${scale})`} />,
        );
    }
  }
  return cells;
}

export default function AccountArt({ className = "" }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const pitch = `p${id}`, pool = `g${id}`, lit = `l${id}`, mask = `m${id}`;
  return (
    <div className={`account-art ${className}`.trim()} aria-hidden="true">
      <svg className="account-art-plan" viewBox={`0 0 ${PLAN_W} ${PLAN_H}`} preserveAspectRatio="xMidYMid slice" focusable="false">
        <defs>
          <g id={pitch}>
            <PitchLines />
          </g>
          <radialGradient id={pool}>
            <stop offset="0" stopColor="#5f9a76" stopOpacity="0.5" />
            <stop offset="0.35" stopColor="#3a6b50" stopOpacity="0.26" />
            <stop offset="1" stopColor="#1d3a2b" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={lit}>
            <stop offset="0" stopColor="#fff" stopOpacity="1" />
            <stop offset="0.5" stopColor="#fff" stopOpacity="0.45" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
          <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width={PLAN_W} height={PLAN_H}>
            {MASTS.map(([col, row]) => (
              <circle key={`${col},${row}`} cx={mastX(col)} cy={mastY(row)} r="150" fill={`url(#${lit})`} />
            ))}
          </mask>
        </defs>
        {MASTS.map(([col, row]) => (
          <circle key={`${col},${row}`} cx={mastX(col)} cy={mastY(row)} r="170" fill={`url(#${pool})`} />
        ))}
        <g className="account-art-lines account-art-lines-far">
          <Plan pitch={pitch} />
        </g>
        <g className="account-art-lines" mask={`url(#${mask})`}>
          <Plan pitch={pitch} />
        </g>
        {MASTS.map(([col, row]) => (
          <circle key={`${col},${row}`} className="account-art-mast" cx={mastX(col)} cy={mastY(row)} r="1.5" />
        ))}
      </svg>
    </div>
  );
}
