"use client";
import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";
import { applyTheme, THEME_EVENT } from "../services/local-preferences.js";
import { preferencesChanged } from "../services/user-preferences.js";
export default function ThemeToggle() {
  const [theme, setTheme] = useState("dark");
  useEffect(() => {
    setTheme(
      document.documentElement.dataset.theme === "light" ? "light" : "dark",
    );
    // The account's theme, applied by the preferences sync.
    const follow = (event) => setTheme(event.detail === "light" ? "light" : "dark");
    window.addEventListener(THEME_EVENT, follow);
    return () => window.removeEventListener(THEME_EVENT, follow);
  }, []);
  function toggle() {
    applyTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light");
    preferencesChanged();
  }
  const label =
    theme === "dark" ? "Activer le thème clair" : "Activer le thème sombre";
  const Symbol = theme === "dark" ? Sun : Moon;
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-label={label}
      title={label}
    >
      <Symbol size={18} strokeWidth={1.7} aria-hidden="true" />
    </button>
  );
}
