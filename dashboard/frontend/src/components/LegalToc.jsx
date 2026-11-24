"use client";
// The legal pages' « Sommaire »: a sticky column on a wide screen, a bar under the header on a phone that
// names the section being read and opens the list. The section in view is marked while scrolling.
import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";

export default function LegalToc({ items }) {
  const [active, setActive] = useState(items[0]?.id);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const header =
        document.querySelector(".topbar")?.getBoundingClientRect().bottom ?? 0;
      const line = header + Math.min(160, window.innerHeight * 0.3);
      const root = document.documentElement;
      let current = items[0]?.id;
      if (window.scrollY + window.innerHeight >= root.scrollHeight - 4) {
        // The end of the page: the last section, even when it is too short to reach the line.
        const last = [...items].reverse().find((item) => {
          const heading = document.getElementById(item.id);
          return (
            heading && heading.getBoundingClientRect().top < window.innerHeight
          );
        });
        current = last?.id ?? current;
      } else {
        for (const item of items) {
          const heading = document.getElementById(item.id);
          if (heading && heading.getBoundingClientRect().top <= line)
            current = item.id;
        }
      }
      setActive(current);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [items]);

  useEffect(() => {
    if (!open) return;
    const close = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);

  const current = items.find((item) => item.id === active) || items[0];
  return (
    <nav
      className="legal-toc"
      aria-label="Sommaire"
      data-open={open ? "true" : "false"}
    >
      <h2 className="legal-toc-title">Sommaire</h2>
      <button
        type="button"
        className="legal-toc-toggle"
        aria-expanded={open}
        aria-controls="legal-toc-list"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="legal-toc-toggle-label">Sommaire</span>
        <span className="legal-toc-toggle-current">
          <span className="legal-num">{current?.number}</span>
          {current?.title}
        </span>
        <ChevronDown size={18} strokeWidth={1.8} aria-hidden="true" />
      </button>
      <ol id="legal-toc-list" className="legal-toc-list">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              aria-current={item.id === active ? "true" : undefined}
              onClick={() => setOpen(false)}
            >
              <span className="legal-num">{item.number}</span>
              <span>{item.title}</span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
