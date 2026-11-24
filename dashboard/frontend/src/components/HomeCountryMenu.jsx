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
 * The visitor's country (VI-48): the button and its menu (the header menus' panel), the
 * manifest's countries then « Aucun pays » (none: the cards choose as without a country).
 * A line of the home's preferences panel; the cards follow the choice at once.
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
    name = country ? homeCountryName(country) : "Aucun pays";
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
    <div className="home-country-picker" ref={root}>
      <button
        type="button"
        ref={button}
        id={id}
        className="filter-input-wrap home-country-button"
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
          className="nav-menu-panel home-country-menu"
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
              className="nav-menu-item home-country-none"
              onClick={() => choose(HOME_COUNTRY_NONE)}
            >
              <span>Aucun pays</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
