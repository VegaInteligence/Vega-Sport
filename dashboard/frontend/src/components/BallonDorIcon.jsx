"use client";
import React, { useId } from "react";

export default function BallonDorIcon({ className = "" }) {
  const gradient = useId();
  return (
    <svg
      className={`ballon-dor-icon ${className}`}
      viewBox="0 0 40 48"
      fill="none"
      aria-hidden="true"
      focusable="false"
      data-icon="ballon-dor"
    >
      <defs>
        <linearGradient
          id={gradient}
          x1="8"
          y1="4"
          x2="33"
          y2="42"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#fff0b5" />
          <stop offset="0.44" stopColor="#e6b748" />
          <stop offset="1" stopColor="#946019" />
        </linearGradient>
      </defs>
      <path d="m13 30-5 11 5 5 15-1 5-5-7-10Z" fill={`url(#${gradient})`} />
      <path
        d="m13 32 3 7-3 7m3-7 12 6m-5-13-7 7 16 1"
        stroke="#8d621e"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
      <circle
        cx="20"
        cy="17"
        r="14"
        fill={`url(#${gradient})`}
        stroke="#f1d17a"
        strokeWidth="0.8"
      />
      <path d="m20 10 6 4-2 7h-8l-2-7Z" fill="#aa791f" fillOpacity="0.6" />
      <path
        d="M20 3v7m-12-1 6 5m-7 8 9-1m-4 8 4-8m12 8-4-8m9 1-9-1m8-12-6 5m-12 0 6-4 6 4-2 7h-8Z"
        stroke="#8d621e"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
      <path
        d="M12 10a10 10 0 0 1 7-4"
        stroke="#fff5cc"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.8"
      />
    </svg>
  );
}
