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
    const next =
      document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", next === "light" ? "#FFFFFF" : "#0F0F11");
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
