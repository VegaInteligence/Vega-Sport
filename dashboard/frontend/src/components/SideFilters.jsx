"use client";
/* B (VI-41): a page's filters move to a sidebar on wide screens. Each page
 * wraps its filters in <SideFilters>; with data-nav="b" and room for the
 * sidebar they render into Layout's #filter-side, otherwise where they are. */
import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const WIDE = "(min-width: 1100px)";

function useSideSlot() {
  const [slot, setSlot] = useState(null);
  useEffect(() => {
    const root = document.documentElement,
      wide = window.matchMedia(WIDE);
    const read = () =>
      setSlot(
        root.dataset.nav === "b" && wide.matches
          ? document.getElementById("filter-side")
          : null,
      );
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ["data-nav"] });
    wide.addEventListener("change", read);
    return () => {
      observer.disconnect();
      wide.removeEventListener("change", read);
    };
  }, []);
  return slot;
}

export default function SideFilters({ children }) {
  const slot = useSideSlot();
  if (slot) return createPortal(<div className="side-filters-group">{children}</div>, slot);
  // Hidden until placed when B is on (navigation.css), so nothing jumps on load.
  return <div className="side-filters-source">{children}</div>;
}
