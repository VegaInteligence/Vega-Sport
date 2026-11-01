import React from "react";
import { Empty } from "./UI.jsx";
import { number } from "../services/format.js";

export const periodLabel = (period) =>
  ({
    All: "Match entier",
    FirstHalf: "Première mi-temps",
    SecondHalf: "Seconde mi-temps",
    ExtraFirstHalf: "Prolongation · première période",
    ExtraSecondHalf: "Prolongation · seconde période",
  })[period] || period;

export default function PlayerMetrics({ row }) {
  if (!row?.stats?.length) return <Empty>Statistiques non renseignées.</Empty>;
  return (
    <div className="source-metric-groups">
      {row.stats.map((group, index) => (
        <section key={`${group.key}:${index}`}>
          <h3>{group.title || group.key}</h3>
          <dl className="performance-stat-list">
            {Object.entries(group.stats || {}).map(([label, item]) => (
              <div key={label} data-metric-key={item.key || label}>
                <dt>{label}</dt>
                <dd>
                  {item.stat?.value == null
                    ? "—"
                    : item.stat?.total != null
                      ? `${number(item.stat.value, 2)} / ${number(item.stat.total, 2)}`
                      : typeof item.stat.value === "number"
                        ? number(
                            item.stat.value,
                            item.stat.type === "double" ? 3 : 0,
                          )
                        : String(item.stat.value)}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
