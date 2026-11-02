"use client";
import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";
export default function ThemeToggle() {
  const [theme, setTheme] = useState("dark");
  useEffect(() => {
    setTheme(
      document.documentElement.dataset.theme === "light" ? "light" : "dark",
    );
  }, []);
  function toggle() {
    const root = document.documentElement,
      next = root.dataset.theme === "light" ? "dark" : "light";
    // Hover transitions on buttons, fields and cards would otherwise fade
    // those elements into the new theme after everything else: switch with
    // transitions off, then restore them once the new colours are painted.
    root.setAttribute("data-theme-switching", "");
    root.dataset.theme = next;
    void document.body.offsetHeight;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => root.removeAttribute("data-theme-switching")),
    );
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", next === "light" ? "#F6F8FB" : "#0E0F12");
    try {
      localStorage.setItem("statarena.theme", next);
    } catch {}
    setTheme(next);
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
