import React, { useState } from "react";
import { Segments, StructuredData } from "./UI.jsx";

/** Every source field is reachable; JSON preserves the original value and precision. */
export default function DataExplorer({ value, label = "Format des données" }) {
  const [format, setFormat] = useState("explorer");
  return (
    <section className="data-explorer" aria-label={label}>
      <Segments
        label={label}
        value={format}
        items={[
          ["explorer", "Explorer"],
          ["json", "JSON"],
        ]}
        onChange={setFormat}
      />
      {format === "json" ? (
        <pre
          className="json-view"
          data-source-json
          tabIndex={0}
          aria-label="Données JSON complètes"
        >
          {JSON.stringify(value, null, 2)}
        </pre>
      ) : (
        <StructuredData value={value} lazy />
      )}
    </section>
  );
}
