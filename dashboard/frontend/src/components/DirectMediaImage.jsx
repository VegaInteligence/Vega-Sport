"use client";
import React, { useLayoutEffect, useRef } from "react";

/**
 * An image copy, read from the API's distribution as it is: one request, cached for good,
 * that the server's HTML can start before hydration. The copies are small (7 kB at the
 * median on 11 November 2026); resizing them took a second request and its own wait.
 */
export default function DirectMediaImage({
  src,
  dimension,
  onLoad,
  onError,
  ...rest
}) {
  const ref = useRef(null);
  const current = useRef({
    src,
    onLoad,
    onError,
    settled: false,
    active: true,
  });
  useLayoutEffect(() => {
    if (current.current.src !== src) {
      current.current = { src, onLoad, onError, settled: false, active: true };
    }
    const state = current.current;
    state.onLoad = onLoad;
    state.onError = onError;
    state.active = true;
    const image = ref.current;
    if (image?.complete && image.naturalWidth) done(image, state);
    else if (image?.complete && image.currentSrc && !state.settled) {
      state.settled = true;
      state.onError?.();
    }
    return () => {
      state.active = false;
    };
  }, [src, onLoad, onError]);
  const done = (image, state) => {
    if (state.settled) return;
    state.settled = true;
    let decoding;
    try {
      decoding = image.decode?.();
    } catch (error) {
      if (state.active && current.current === state) state.onError?.(error);
      return;
    }
    Promise.resolve(decoding)
      .then(() => {
        if (state.active && current.current === state) state.onLoad?.();
      })
      .catch((error) => {
        if (state.active && current.current === state) state.onError?.(error);
      });
  };
  return (
    <img
      alt=""
      width={dimension}
      height={dimension}
      loading="lazy"
      decoding="async"
      {...rest}
      src={src}
      ref={ref}
      onLoad={(e) => done(e.currentTarget, current.current)}
      onError={(e) => {
        const state = current.current;
        if (!state.settled && state.active) {
          state.settled = true;
          state.onError?.(e);
        }
      }}
    />
  );
}
