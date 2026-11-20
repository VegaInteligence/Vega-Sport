import { useEffect, useState } from "react";

/** The width a chart is laid out at, measured: drawn at it, its text keeps its size. A callback
 * ref, since the box may appear after the first rendering (data still loading). */
export default function useBoxWidth(fallback) {
  const [node, setNode] = useState(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    if (!node) return undefined;
    const read = () => node.clientWidth && setWidth(Math.round(node.clientWidth));
    read();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(read);
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  return [setNode, width];
}
