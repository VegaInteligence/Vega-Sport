"use client";
/* The match page's team colours from the two crests (FAILURE_MODES § 64). Each crest is read once
 * per page load, from the site's own copy (/api/crest/…: a canvas cannot read the API's host). */
import { useEffect, useState } from "react";
import { useResolvedMedia } from "../components/MediaContext.jsx";
import { safeResolvedMedia } from "../services/resolved-media.js";
import { crestColours, matchColours } from "../services/crest-colours.js";

const SIDE = 48;
const read = new Map();

function crestPath(resolved) {
  const address = safeResolvedMedia(resolved);
  return address ? "/api/crest" + new URL(address).pathname : "";
}

function coloursOf(path) {
  if (!path) return Promise.resolve([]);
  if (!read.has(path))
    read.set(
      path,
      new Promise((resolve) => {
        const image = new Image();
        image.decoding = "async";
        image.onload = () => {
          try {
            const canvas = document.createElement("canvas");
            canvas.width = canvas.height = SIDE;
            const context = canvas.getContext("2d", { willReadFrequently: true });
            const scale = Math.min(SIDE / image.naturalWidth, SIDE / image.naturalHeight) || 1;
            const w = image.naturalWidth * scale, h = image.naturalHeight * scale;
            context.drawImage(image, (SIDE - w) / 2, (SIDE - h) / 2, w, h);
            resolve(crestColours(context.getImageData(0, 0, SIDE, SIDE).data));
          } catch {
            resolve([]);
          }
        };
        image.onerror = () => resolve([]);
        image.src = path;
      }),
    );
  return read.get(path);
}

/** `--home` / `--away` for the match page's style; {} until the crests are read, or without colour. */
export default function useCrestColours(home, away) {
  // A provider address resolves to its copy; an address already on the copies' host is kept.
  const homePath = crestPath(useResolvedMedia(home?.imageUrl) || home?.imageUrl);
  const awayPath = crestPath(useResolvedMedia(away?.imageUrl) || away?.imageUrl);
  const [vars, setVars] = useState({});
  useEffect(() => {
    let live = true;
    Promise.all([coloursOf(homePath), coloursOf(awayPath)]).then(([h, a]) => {
      if (!live) return;
      const colours = matchColours(h, a);
      // The shared charts (Charts.jsx: shot tooltip, cumulative xG) follow the same colours.
      if (Object.keys(colours).length) {
        colours["--chart-home"] = colours["--home"] || "var(--home)";
        colours["--chart-away"] = colours["--away"] || "var(--away)";
      }
      setVars(colours);
    });
    return () => {
      live = false;
    };
  }, [homePath, awayPath]);
  // A shot's tooltip is drawn in document.body, outside the page (HoverCard.jsx): the charts' two
  // colours go there too while the page is open (Codex, § 64).
  useEffect(() => {
    const style = document.body.style;
    for (const name of ["--chart-home", "--chart-away"])
      if (vars[name]) style.setProperty(name, vars[name]);
    return () => {
      style.removeProperty("--chart-home");
      style.removeProperty("--chart-away");
    };
  }, [vars]);
  return vars;
}
