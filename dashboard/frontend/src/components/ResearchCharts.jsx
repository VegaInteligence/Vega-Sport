import React, { useRef } from "react";
import { isNumber, number } from "../services/format.js";
import { download } from "../services/resources.js";
const COLORS = ["#3b8eff", "#bc8a37", "#a579df", "#dc6d7a"];
export function exportChart(ref, name) {
  if (!ref.current) return;
  const copy = ref.current.cloneNode(true);
  const original = [ref.current, ...ref.current.querySelectorAll("*")];
  const cloned = [copy, ...copy.querySelectorAll("*")];
  original.forEach((node, i) => {
    const style = getComputedStyle(node);
    for (const key of [
      "fill",
      "stroke",
      "font-family",
      "font-size",
      "font-weight",
      "opacity",
    ])
      cloned[i].style.setProperty(key, style.getPropertyValue(key));
  });
  copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  download(
    name + ".svg",
    new XMLSerializer().serializeToString(copy),
    "image/svg+xml;charset=utf-8",
  );
}
export function ResearchRadar({
  axes,
  series,
  title = "Profil en centiles",
  context = "",
}) {
  const ref = useRef();
  const cx = 200,
    cy = 170,
    radius = 112,
    count = Math.max(3, axes.length);
  const point = (i, value) => [
    cx +
      (Math.cos(-Math.PI / 2 + (2 * Math.PI * i) / count) * radius * value) /
        100,
    cy +
      (Math.sin(-Math.PI / 2 + (2 * Math.PI * i) / count) * radius * value) /
        100,
  ];
  return (
    <figure className="research-chart">
      <svg ref={ref} viewBox="0 0 400 350" role="img" aria-label={title}>
        <title>{title}</title>
        <desc>{context}. Les valeurs absentes ne sont pas tracées.</desc>
        {[25, 50, 75, 100].map((level) => (
          <polygon
            key={level}
            points={Array.from({ length: count }, (_, i) =>
              point(i, level).join(","),
            ).join(" ")}
            fill="none"
            className="radar-grid"
          />
        ))}
        {axes.map((axis, i) => {
          const p = point(i, 100),
            text = point(i, 122);
          return (
            <g key={axis.key}>
              <line
                x1={cx}
                y1={cy}
                x2={p[0]}
                y2={p[1]}
                className="radar-grid"
              />
              <text
                x={text[0]}
                y={text[1]}
                textAnchor={
                  Math.abs(text[0] - cx) < 5
                    ? "middle"
                    : text[0] > cx
                      ? "start"
                      : "end"
                }
                dominantBaseline="central"
                className="research-chart-label"
              >
                {axis.label}
              </text>
            </g>
          );
        })}
        {series.map((item, n) => (
          <g key={item.name}>
            {axes.every((axis) => isNumber(item.values[axis.key])) && (
              <polygon
                points={axes
                  .map((axis, i) => point(i, item.values[axis.key]).join(","))
                  .join(" ")}
                fill={COLORS[n % 4]}
                fillOpacity=".10"
                stroke={COLORS[n % 4]}
                strokeWidth="2"
              />
            )}
            {axes.map((axis, i) =>
              isNumber(item.values[axis.key]) ? (
                <circle
                  key={axis.key}
                  cx={point(i, item.values[axis.key])[0]}
                  cy={point(i, item.values[axis.key])[1]}
                  r="3"
                  fill={COLORS[n % 4]}
                >
                  <title>
                    {item.name} · {axis.label} : {number(item.values[axis.key])}
                    e centile
                  </title>
                </circle>
              ) : null,
            )}
          </g>
        ))}
      </svg>
      <figcaption>
        <span className="research-chart-legend">
          {series.map((item, i) => (
            <span key={item.name}>
              <i style={{ background: COLORS[i % 4] }} />
              {item.name}
            </span>
          ))}
        </span>
        <button
          className="inline-link"
          onClick={() => exportChart(ref, "statarena-profil")}
        >
          Exporter SVG
        </button>
      </figcaption>
    </figure>
  );
}
export function ResearchTrend({ points, label }) {
  const ref = useRef();
  const observed = points.filter((p) => isNumber(p.value));
  if (!observed.length) return null;
  const low = Math.min(0, ...observed.map((p) => p.value)),
    high = Math.max(low + 1, ...observed.map((p) => p.value));
  const x = (i) => 55 + (i * 490) / Math.max(1, points.length - 1),
    y = (v) => 180 - ((v - low) / (high - low)) * 135;
  return (
    <figure className="research-chart">
      <svg ref={ref} viewBox="0 0 600 230" role="img" aria-label={label}>
        <title>{label}</title>
        {[0, 1, 2, 3].map((i) => {
          const value = low + ((high - low) * i) / 3;
          return (
            <g key={i}>
              <line
                x1="55"
                y1={y(value)}
                x2="555"
                y2={y(value)}
                className="radar-grid"
              />
              <text
                x="46"
                y={y(value)}
                textAnchor="end"
                dominantBaseline="central"
                className="research-chart-label"
              >
                {number(value, 1)}
              </text>
            </g>
          );
        })}
        {points.map((p, i) => (
          <g key={p.label}>
            {isNumber(p.value) && (
              <>
                {i > 0 && isNumber(points[i - 1].value) && (
                  <line
                    x1={x(i - 1)}
                    y1={y(points[i - 1].value)}
                    x2={x(i)}
                    y2={y(p.value)}
                    stroke={COLORS[0]}
                    strokeWidth="2"
                  />
                )}
                <circle cx={x(i)} cy={y(p.value)} r="4" fill={COLORS[0]}>
                  <title>
                    {p.label} : {number(p.value, 2)}
                  </title>
                </circle>
              </>
            )}
            <text
              x={x(i)}
              y="211"
              textAnchor="middle"
              className="research-chart-label"
            >
              {p.label}
            </text>
          </g>
        ))}
      </svg>
      <figcaption>
        <span>{label}</span>
        <button
          className="inline-link"
          onClick={() => exportChart(ref, "statarena-evolution")}
        >
          Exporter SVG
        </button>
      </figcaption>
    </figure>
  );
}
