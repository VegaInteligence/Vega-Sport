import React from "react";
import "flag-icons/css/flag-icons.min.css";
import { nationalFlagCode } from "../services/national-flags.js";

/** A country's flag by its name, or by its flag-icons `code` when the caller knows it. */
export default function NationalFlag({
  name,
  season,
  code: known,
  className = "",
}) {
  const code = known || nationalFlagCode(name, season);
  return code ? (
    <span
      className={`fi fi-${code} national-flag ${className}`}
      aria-hidden="true"
    />
  ) : null;
}
