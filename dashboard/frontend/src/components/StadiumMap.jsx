"use client";
import React, { useEffect, useRef, useState } from "react";

let loader;
function loadMapLibre() {
  if (window.maplibregl) return Promise.resolve(window.maplibregl);
  if (loader) return loader;
  loader = new Promise((resolve, reject) => {
    if (!document.getElementById("statarena-maplibre-css")) {
      const style = document.createElement("link");
      style.id = "statarena-maplibre-css";
      style.rel = "stylesheet";
      style.href = "https://unpkg.com/maplibre-gl@5.6.2/dist/maplibre-gl.css";
      style.integrity = "sha256-Q8HYhrX98KrE5xNb1vhLgj2fSCg6ZIASZl+b5SwBOJ8=";
      style.crossOrigin = "anonymous";
      document.head.appendChild(style);
    }
    const script = document.createElement("script");
    script.src = "https://unpkg.com/maplibre-gl@5.6.2/dist/maplibre-gl.js";
    script.integrity = "sha256-FSX5cSI9gfFp8EnxzlAIPm8WQ6prDqBxZlOlUNLVf8I=";
    script.crossOrigin = "anonymous";
    const fail = () => {
      clearTimeout(timeout);
      script.remove();
      reject(new Error("MapLibre unavailable"));
    };
    const timeout = setTimeout(fail, 15000);
    script.onload = () => {
      clearTimeout(timeout);
      if (window.maplibregl) resolve(window.maplibregl);
      else fail();
    };
    script.onerror = fail;
    document.head.appendChild(script);
  }).catch((error) => {
    loader = null;
    throw error;
  });
  return loader;
}

export default function StadiumMap({ name, coordinates }) {
  const container = useRef(null);
  const [status, setStatus] = useState("loading");
  const lat = coordinates.lat,
    lon = coordinates.lon;
  useEffect(() => {
    let active = true,
      map,
      timer;
    setStatus("loading");
    loadMapLibre()
      .then((lib) => {
        if (!active) return;
        map = new lib.Map({
          container: container.current,
          style: "https://tiles.openfreemap.org/styles/bright",
          center: [lon, lat],
          zoom: window.innerWidth <= 620 ? 15.9 : 16.4,
          pitch: 55,
          bearing: -20,
          attributionControl: false,
        });
        map.addControl(
          new lib.NavigationControl({ visualizePitch: true }),
          "top-right",
        );
        map.addControl(
          new lib.AttributionControl({ compact: true }),
          "bottom-right",
        );
        map.on("load", () => {
          if (!active) return;
          try {
            const label = map
              .getStyle()
              .layers.find(
                (layer) =>
                  layer.type === "symbol" && layer.layout?.["text-field"],
              )?.id;
            map.addSource("stadium-buildings", {
              type: "vector",
              url: "https://tiles.openfreemap.org/planet",
            });
            map.addLayer(
              {
                id: "stadium-buildings-3d",
                source: "stadium-buildings",
                "source-layer": "building",
                type: "fill-extrusion",
                minzoom: 15,
                filter: [
                  "all",
                  ["has", "render_height"],
                  ["!=", ["get", "hide_3d"], true],
                ],
                paint: {
                  "fill-extrusion-color": "#9caea0",
                  "fill-extrusion-height": [
                    "coalesce",
                    ["get", "render_height"],
                    0,
                  ],
                  "fill-extrusion-base": [
                    "coalesce",
                    ["get", "render_min_height"],
                    0,
                  ],
                  "fill-extrusion-opacity": 0.9,
                },
              },
              label,
            );
            new lib.Marker({ color: "#245d3b" })
              .setLngLat([lon, lat])
              .addTo(map);
            map
              .getCanvas()
              .setAttribute("aria-label", `Carte 3D autour de ${name}`);
            clearTimeout(timer);
            setStatus("ready");
          } catch {
            clearTimeout(timer);
            setStatus("error");
          }
        });
        timer = setTimeout(() => {
          if (active) setStatus("error");
        }, 18000);
      })
      .catch(() => {
        if (active) setStatus("error");
      });
    return () => {
      active = false;
      clearTimeout(timer);
      map?.remove();
    };
  }, [lat, lon, name]);
  return (
    <div className="stadium-map-wrap">
      <div
        ref={container}
        className="stadium-map"
        role="region"
        aria-label={`Carte autour de ${name}`}
      />
      {status === "loading" && (
        <div className="stadium-map-state" role="status">
          Chargement de la carte 3D…
        </div>
      )}
      {status === "error" && (
        <div className="stadium-map-state" role="status">
          La carte 3D est momentanément indisponible.{" "}
          <a
            href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Ouvrir la carte OpenStreetMap
          </a>
        </div>
      )}
    </div>
  );
}
