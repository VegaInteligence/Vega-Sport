"use client";
import React, { useLayoutEffect, useRef } from "react";
import { getImageProps } from "next/image";

/** The content-addressed source can start before hydration through native srcset. */
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
  const { props } = getImageProps({
    src,
    alt: "",
    width: dimension,
    height: dimension,
    quality: 75,
    loading: "lazy",
  });
  return (
    <img
      {...props}
      {...rest}
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
