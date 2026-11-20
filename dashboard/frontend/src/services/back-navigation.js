/**
 * « ← » buttons go back to the page the visitor came from.
 *
 * A page is its path plus the parameters that open one item (`id`, an archive
 * match `m`, a World Cup archive match `cdm`): tabs, filters, seasons and views
 * are the same page, so going back skips them. The tab's history comes from the
 * Navigation API; without it, or with no earlier page of the site in this tab,
 * the button keeps its fixed link.
 *
 * The name shown is the page's main heading, read when the visitor left it and
 * kept for the tab's session under the history entry's key.
 */
import { useEffect } from "react";
import { pages } from "../../../shared/pages.js";

const ITEM_PARAMS = ["id", "m", "cdm"];
const STORE = "vega:back-labels";
const KEEP = 60;

export function pageIdentity(href) {
  let url;
  try {
    url = new URL(href, "http://vega.local");
  } catch {
    return String(href);
  }
  const path = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
  return [
    path,
    ...ITEM_PARAMS.map((key) => url.searchParams.get(key) || ""),
  ].join("|");
}

function tabHistory() {
  const navigation = typeof window === "undefined" ? null : window.navigation;
  if (!navigation?.currentEntry || typeof navigation.entries !== "function")
    return null;
  return navigation;
}

/** The nearest earlier entry of this tab that is another page, with how many steps back it is. */
export function previousPage() {
  const navigation = tabHistory();
  if (!navigation) return null;
  const current = navigation.currentEntry;
  if (current.index < 1 || !current.url) return null;
  const here = pageIdentity(current.url);
  const entries = navigation.entries();
  for (let index = current.index - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!entry?.url) return null;
    if (pageIdentity(entry.url) !== here) {
      return {
        key: entry.key,
        url: entry.url,
        steps: current.index - index,
        label: storedLabel(entry.key) || pageTitle(entry.url),
      };
    }
  }
  return null;
}

function pageTitle(href) {
  try {
    const path = pageIdentity(href).split("|")[0];
    return pages.find((item) => item.path === path)?.title || null;
  } catch {
    return null;
  }
}

function readStore() {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(STORE) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function storedLabel(key) {
  return readStore().find((item) => item[0] === key)?.[1] || null;
}

function currentHeading() {
  const heading = document.querySelector("#main h1");
  const text = heading?.textContent?.replace(/\s+/g, " ").trim();
  return text ? (text.length > 60 ? `${text.slice(0, 59)}…` : text) : null;
}

/** Reads the heading just before the visitor acts (a click, a choice, a search), while it is still this page's. */
export function useBackMemory() {
  useEffect(() => {
    const events = ["click", "change", "submit"];
    events.forEach((name) =>
      document.addEventListener(name, rememberCurrentPage, true),
    );
    return () =>
      events.forEach((name) =>
        document.removeEventListener(name, rememberCurrentPage, true),
      );
  }, []);
}

/** Keeps the current page's heading under its history entry, so the next page can name it. */
export function rememberCurrentPage() {
  const navigation = tabHistory();
  if (!navigation) return;
  const key = navigation.currentEntry.key;
  const label = currentHeading();
  if (!key || !label) return;
  try {
    const kept = readStore().filter((item) => item[0] !== key);
    kept.push([key, label]);
    window.sessionStorage.setItem(STORE, JSON.stringify(kept.slice(-KEEP)));
  } catch {
    // Private windows or blocked storage: the button falls back to the page's section name.
  }
}

export function goBack(steps) {
  window.history.go(-steps);
}
