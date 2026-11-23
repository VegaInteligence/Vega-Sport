"use client";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

/**
 * A page's open tab, mirrored in `?<param>=` without a navigation. The first key is the
 * default and leaves the parameter out; an unknown value (an old link to a removed tab)
 * opens the default and is dropped from the address.
 */
export function useTabParam(param, keys) {
  const params = useSearchParams();
  const requested = params?.get(param) || "";
  const [tab, setTab] = useState(() =>
    keys.includes(requested) ? requested : keys[0],
  );
  const write = useCallback(
    (next) => {
      const url = new URL(window.location.href);
      if (next === keys[0]) url.searchParams.delete(param);
      else url.searchParams.set(param, next);
      const target = url.pathname + url.search + url.hash;
      if (
        target !==
        window.location.pathname + window.location.search + window.location.hash
      )
        window.history.replaceState(window.history.state, "", target);
    },
    // The keys are a constant table of the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [param],
  );
  useEffect(() => {
    if (requested && !keys.includes(requested)) write(keys[0]);
    // Only the address the page opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const change = useCallback(
    (next) => {
      setTab(next);
      write(next);
    },
    [write],
  );
  return [tab, change];
}
