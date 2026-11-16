"use client";
/* The « i » beside a value's name: hovered, focused or touched, it says in a sentence what the
 * value is (services/glossary.js). The bubble is drawn over the page, so no card or scrolling
 * table cuts it. */
import React, { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { explain } from "../services/glossary.js";

const WIDTH = 260;

function place(box) {
  const left = Math.min(Math.max(8, box.left + box.width / 2 - WIDTH / 2), window.innerWidth - WIDTH - 8);
  return box.top > 90
    ? { left, top: box.top - 8, transform: "translateY(-100%)" }
    : { left, top: box.bottom + 8 };
}

export function Hint({ text, label }) {
  const [box, setBox] = useState(null);
  const ref = useRef(null);
  const id = useId();
  useEffect(() => {
    if (!box) return undefined;
    const hide = () => setBox(null);
    window.addEventListener("scroll", hide, { passive: true, capture: true });
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, { capture: true });
      window.removeEventListener("resize", hide);
    };
  }, [box]);
  if (!text) return null;
  const show = () => setBox(ref.current?.getBoundingClientRect() || null);
  const hide = () => setBox(null);
  return (
    <>
      <span
        ref={ref}
        className="hint"
        role="button"
        tabIndex={0}
        aria-label={label ? `${label} : ${text}` : text}
        aria-describedby={box ? id : undefined}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={(event) => {
          // A heading that folds its card, or a row that opens a page, keeps its own click.
          event.stopPropagation();
          event.preventDefault();
          if (box) hide();
          else show();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") hide();
        }}
      >
        i
      </span>
      {box &&
        createPortal(
          <span id={id} role="tooltip" className="hint-bubble" style={{ ...place(box), maxWidth: WIDTH }}>
            {text}
          </span>,
          document.body,
        )}
    </>
  );
}

/**
 * A value's name followed by its « i », when the glossary (or `hint`) explains it. The « i »
 * stays on the line of the name's last word, never alone on the next one.
 */
export function Term({ children, label, hint }) {
  const name = label ?? (typeof children === "string" ? children : "");
  const text = hint ?? explain(name);
  if (!text) return <>{children}</>;
  if (typeof children === "string") {
    const at = children.trimEnd().lastIndexOf(" ");
    return (
      <>
        {at > 0 ? children.slice(0, at + 1) : ""}
        <span className="term-tail">
          {at > 0 ? children.slice(at + 1).trimEnd() : children.trimEnd()}
          <Hint text={text} label={name} />
        </span>
      </>
    );
  }
  return (
    <>
      {children}
      <Hint text={text} label={name} />
    </>
  );
}
