"use client";
import React, { useEffect, useRef, useState } from "react";
import useVisibleIntent from "../hooks/useVisibleIntent.js";
import { loadMediaAsset } from "../services/media-assets.js";

/** Only public /api/assets images use this queue; local/external assets stay native. */
export default function ApiImage({ src, onError, ...props }) {
  const [ref, visible] = useVisibleIntent(src, Boolean(src));
  const [loaded, setLoaded] = useState(null);
  const errorRef = useRef(onError);
  useEffect(() => {
    errorRef.current = onError;
  }, [onError]);
  useEffect(() => {
    if (!src || !visible) return;
    const controller = new AbortController();
    let objectUrl;
    loadMediaAsset(src, { signal: controller.signal })
      .then((blob) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setLoaded({ source: src, url: objectUrl });
      })
      .catch((error) => {
        if (!controller.signal.aborted) errorRef.current?.(error);
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src, visible]);
  return (
    <img
      {...props}
      ref={ref}
      src={loaded?.source === src ? loaded.url : undefined}
      onError={onError}
    />
  );
}
