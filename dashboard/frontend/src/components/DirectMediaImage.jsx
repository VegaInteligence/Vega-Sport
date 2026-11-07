"use client";
import React, { useEffect, useRef } from "react";
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
  current.current.onLoad = onLoad;
  current.current.onError = onError;
  useEffect(() => {
    const state = current.current;
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
  }, [src]);
  const done = (image, state) => {
    if (state.settled) return;
    state.settled = true;
    Promise.resolve()
      .then(() => image.decode?.())
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
