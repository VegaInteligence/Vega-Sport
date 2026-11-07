"use client";
import React, { useCallback, useEffect, useRef } from "react";
import useVisibleIntent from "../hooks/useVisibleIntent.js";
import { apiUrl } from "../data-url.js";
import { acquirePublicImage } from "../services/public-api-fetch.js";

/** Only public /api/assets images use this queue; local/external assets stay native. */
export default function ApiImage({
  src,
  onLoad,
  onError,
  loading = "lazy",
  ...props
}) {
  const [visibilityRef, visible] = useVisibleIntent(src, Boolean(src));
  const imageRef = useRef(null);
  const requestRef = useRef(null);
  const handlersRef = useRef({ onLoad, onError });
  const ref = useCallback(
    (node) => {
      imageRef.current = node;
      visibilityRef(node);
    },
    [visibilityRef],
  );
  useEffect(() => {
    handlersRef.current = { onLoad, onError };
  }, [onLoad, onError]);
  useEffect(() => {
    const node = imageRef.current;
    if (!src || !visible || !node) return;
    const controller = new AbortController();
    const request = {
      node,
      controller,
      started: false,
      settled: false,
      release: null,
    };
    requestRef.current = request;
    let url;
    Promise.resolve()
      .then(() => {
        url = apiUrl(src);
        if (
          new URL(url, "https://statarena.invalid").pathname !== "/api/assets"
        )
          throw new Error("Route d’image invalide.");
        return acquirePublicImage({ signal: controller.signal });
      })
      .then((release) => {
        if (controller.signal.aborted || requestRef.current !== request) {
          release();
          return;
        }
        request.release = release;
        request.started = true;
        // Keep browser image decoding, HTTP caching and cross-origin redirects.
        // React does not own src; this effect removes it before releasing a
        // cancelled request, including when a different source replaces it.
        node.src = url;
      })
      .catch((error) => {
        if (
          !controller.signal.aborted &&
          requestRef.current === request &&
          !request.settled
        ) {
          request.settled = true;
          request.release?.();
          handlersRef.current.onError?.(error);
        }
      });
    return () => {
      if (requestRef.current === request) requestRef.current = null;
      node.removeAttribute("src");
      controller.abort();
      request.release?.();
    };
  }, [src, visible]);
  const settle = (handler, event) => {
    const request = requestRef.current;
    if (
      !request?.started ||
      request.settled ||
      request.controller.signal.aborted ||
      request.node !== event.currentTarget
    )
      return;
    request.settled = true;
    request.release?.();
    handlersRef.current[handler]?.(event);
  };
  return (
    <img
      {...props}
      key={src}
      ref={ref}
      loading={visible ? "eager" : loading}
      onLoad={(event) => settle("onLoad", event)}
      onError={(event) => settle("onError", event)}
    />
  );
}
