"use client";
import React, { useState } from "react";
import Icon from "./Icon.jsx";

/**
 * A part of a page that a phone shows on demand, so a long page opens on what
 * matters. The container spreads `fold` (its state, as a data attribute), each
 * part that folds takes the class `phone-fold-part`, and <PhoneFoldToggle>
 * spreads `toggle`: the button that opens and closes them.
 *
 * On a wide screen none of this shows: the parts are always there and the
 * button is hidden (phone.css).
 */
export function usePhoneFold() {
  const [open, setOpen] = useState(false);
  return {
    fold: { "data-phone-fold": open ? "open" : "closed" },
    toggle: { open, onToggle: () => setOpen((value) => !value) },
  };
}

export function PhoneFoldToggle({ open, onToggle, label }) {
  return (
    <button
      type="button"
      className="phone-fold-toggle"
      aria-expanded={open}
      onClick={onToggle}
    >
      <span>{label}</span>
      <Icon name="chevron" />
    </button>
  );
}

/**
 * A card that a phone shows closed: its heading alone, which a touch opens.
 * Spread `section` on the card and `head` on its heading, give `part` as a
 * class to what the heading hides with the body, render `button` at the end
 * of the heading, and pass the body through `wrap`.
 *
 * With `enabled` false there is nothing to spread and `wrap` returns the body
 * untouched: a card that never folds renders as it did.
 */
export function useCardFold(enabled, title) {
  const { fold, toggle } = usePhoneFold();
  if (!enabled)
    return {
      section: {},
      head: {},
      part: "",
      button: null,
      wrap: (children) => children,
    };
  return {
    section: fold,
    head: {
      onClick: (event) => {
        // A link, a field or a button of the heading keeps its own action.
        if (
          event.target.closest(
            "a, select, input, button:not(.phone-fold-toggle)",
          )
        )
          return;
        toggle.onToggle();
      },
    },
    part: "phone-fold-part",
    // No handler of its own: its click reaches the heading's.
    button: (
      <button
        type="button"
        className="phone-fold-toggle is-icon"
        aria-expanded={toggle.open}
        aria-label={`${toggle.open ? "Replier" : "Déplier"} ${title || "la section"}`}
      >
        <Icon name="chevron" />
      </button>
    ),
    wrap: (children) => (
      <div className="phone-fold-part phone-fold-body">{children}</div>
    ),
  };
}
