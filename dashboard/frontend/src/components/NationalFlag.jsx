import React from "react";
import "flag-icons/css/flag-icons.min.css";
import { nationalFlagCode } from "../services/national-flags.js";

export default function NationalFlag({ name, season, className = "" }) {
  const code = nationalFlagCode(name, season);
  return code ? (
    <span
      className={`fi fi-${code} national-flag ${className}`}
      aria-hidden="true"
    />
  ) : null;
}
