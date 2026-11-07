"use client";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useSyncExternalStore,
} from "react";
import { safeResolvedMedia } from "../services/resolved-media.js";
import {
  acceptMediaPayload,
  resolveRegisteredMedia,
  subscribe,
} from "../services/media-registry.js";
const MediaContext = createContext(null);
export function MediaProvider({ media, children }) {
  useEffect(() => {
    if (media) acceptMediaPayload("/api/read/home", { media });
  }, [media]);
  return (
    <MediaContext.Provider value={media || null}>
      {children}
    </MediaContext.Provider>
  );
}
export function useResolvedMedia(source) {
  const media = useContext(MediaContext);
  const initial =
    source && media && Object.hasOwn(media, source)
      ? safeResolvedMedia(media[source])
      : "";
  const get = useCallback(
    () => resolveRegisteredMedia(source, initial),
    [source, initial],
  );
  const getServer = useCallback(() => initial, [initial]);
  return useSyncExternalStore(subscribe, get, getServer);
}
