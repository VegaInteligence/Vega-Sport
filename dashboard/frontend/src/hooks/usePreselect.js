"use client";
// Effects 9, 10 and 12 (#69, preference-effects.js): an existing filter starts on a preference's value. Once per
// mount, after the preferences are read; never over a URL value; and once the visitor changes a preselected value,
// it is not preselected again this visit (sessionStorage: a cleared filter stays cleared).
import { useEffect, useRef } from "react";
import { preselect, preselectMemory } from "../services/preference-effects.js";
import { PRESELECT_KEY as KEY } from "../services/user-preferences.js"; // forgotten at sign-out (clearPreferences)

function read() {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(KEY) || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}
function write(memory) {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(memory));
  } catch {}
}

/** `ready`: the preferences and the control's options are known; `current`: the control's value now. */
export default function usePreselect(key, { ready, candidate, inUrl, options, current, apply }) {
  const done = useRef(false),
    applied = useRef(null),
    previous = useRef(current);
  useEffect(() => {
    if (!ready || done.current) return;
    done.current = true;
    const memory = read();
    const value = preselect({ inUrl, cleared: memory[key]?.cleared === true, candidate, options });
    if (!value) return;
    applied.current = value;
    write(preselectMemory(memory, { key, applied: value }));
    apply(value);
  });
  useEffect(() => {
    if (previous.current === current) return;
    previous.current = current;
    if (applied.current === null || current === applied.current) return;
    // The visitor changed the preselected value: cleared for the visit.
    write(preselectMemory(read(), { key, current }));
    applied.current = null;
  }, [key, current]);
}
