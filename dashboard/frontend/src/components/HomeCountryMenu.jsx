"use client";
import React, { useEffect, useRef, useState } from "react";
import Icon from "./Icon.jsx";
import NationalFlag from "./NationalFlag.jsx";
import {
  countryFlag,
  homeCountryName,
  HOME_COUNTRY_NONE,
} from "../services/home-country.js";

/**
 * « Chez vous » (VI-48): the country button and its menu (the header menus' panel), the
 * manifest's countries then « Ne rien afficher ». Shared by the strip's head and the home's
 * preferences panel, so the choice is never out of reach.
 */
export default function HomeCountryMenu({
  country,
  choice = "",
  countries,
  onChoose,
  id,
}) {
  const [open, setOpen] = useState(false),
    root = useRef(null),
    button = useRef(null),
    panel = useRef(null),
    name = country
      ? homeCountryName(country)
      : choice === HOME_COUNTRY_NONE
        ? "Ne rien afficher"
        : "Aucun pays";
  useEffect(() => {
    if (!open) return undefined;
    panel.current
      ?.querySelector('[aria-checked="true"]')
      ?.scrollIntoView({ block: "nearest" });
    const onPointer = (event) => {
      if (!root.current?.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => {
      if (event.key !== "Escape") return;
      // Inside the preferences dialog, Escape closes the menu only, not the dialog.
      event.preventDefault();
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const choose = (code) => {
    setOpen(false);
    onChoose(code);
  };
  return (
    <div className="home-local-picker" ref={root}>
      <button
        type="button"
        ref={button}
        id={id}
        className="filter-input-wrap home-local-country"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Pays : ${name}`}
        onClick={() => setOpen((value) => !value)}
      >
        {country && <NationalFlag code={countryFlag(country)} name={name} />}
        <span>{name}</span>
        <Icon name="chevron" className="select-chevron" />
      </button>
      {open && (
        <div
          className="nav-menu-panel home-local-menu"
          role="menu"
          aria-label="Pays"
          ref={panel}
        >
          <div className="nav-menu-list">
            {countries.map((c) => (
              <button
                key={c.code}
                type="button"
                role="menuitemradio"
                aria-checked={c.code === country}
                className="nav-menu-item"
                onClick={() => choose(c.code)}
              >
                <NationalFlag code={c.flag} name={c.name} />
                <span>{c.name}</span>
              </button>
            ))}
            <button
              type="button"
              role="menuitemradio"
              aria-checked={!country && choice === HOME_COUNTRY_NONE}
              className="nav-menu-item home-local-none"
              onClick={() => choose(HOME_COUNTRY_NONE)}
            >
              <span>Ne rien afficher</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
