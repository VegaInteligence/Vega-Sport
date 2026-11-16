"use client";
/* A bubble of detail over the page: hovered or focused, an element shows a few more figures
 * (a match header's cell, a player on the pitch, a node of a pass network). Drawn in a portal,
 * so no card or scrolling table cuts it. */
import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import s from "./MatchTabs.module.css";

/** Where the bubble goes: under its element, or over it near the foot of the window. */
function place(box, width, point) {
  const x = point ? point.x : box.left + box.width / 2;
  const left = Math.min(Math.max(8, x - width / 2), window.innerWidth - width - 8);
  if (point) return { left, top: point.y + 16 };
  return box.bottom + 260 > window.innerHeight && box.top > 280
    ? { left, top: box.top - 8, transform: "translateY(-100%)" }
    : { left, top: box.bottom + 8 };
}

/**
 * Handlers for an element of your own and its bubble: `bind` goes on the element, `bubble` is
 * rendered after it. `follow`: the bubble follows the pointer (charts) rather than the element.
 */
export function useHoverBubble({ width = 320, follow = false } = {}) {
  const [state, setState] = useState(null);
  const id = useId();
  useEffect(() => {
    if (!state) return undefined;
    const hide = () => setState(null);
    window.addEventListener("scroll", hide, { passive: true, capture: true });
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, { capture: true });
      window.removeEventListener("resize", hide);
    };
  }, [state]);
  const show = useCallback((target, content, event) => {
    const box = target.getBoundingClientRect();
    setState({ box, content, point: follow && event?.clientX != null ? { x: event.clientX, y: event.clientY } : null });
  }, [follow]);
  const hide = useCallback(() => setState(null), []);
  const bubble =
    state && typeof document !== "undefined"
      ? createPortal(
          <div id={id} role="tooltip" className={s.bubble} style={{ ...place(state.box, width, state.point), width }}>
            {state.content}
          </div>,
          document.body,
        )
      : null;
  return { show, hide, bubble, open: Boolean(state), id };
}

/**
 * An element that opens its bubble when hovered, focused or touched (a touch toggles it).
 * `content`: what the bubble says.
 */
export default function HoverCard({ content, children, className = "", label, width = 320 }) {
  const ref = useRef(null);
  const { show, hide, bubble, open, id } = useHoverBubble({ width });
  if (!content) return <div className={className}>{children}</div>;
  // A touch toggles the bubble; a mouse already opened it by hovering.
  return (
    <>
      <div
        ref={ref}
        className={`${className} ${s.hoverable}`.trim()}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        aria-label={label}
        onMouseEnter={() => show(ref.current, content)}
        onMouseLeave={hide}
        onFocus={() => show(ref.current, content)}
        onBlur={hide}
        onPointerUp={(event) => {
          if (event.pointerType !== "mouse") (open ? hide() : show(ref.current, content));
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") hide();
          else if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (open) hide();
            else show(ref.current, content);
          }
        }}
      >
        {children}
      </div>
      {bubble}
    </>
  );
}
