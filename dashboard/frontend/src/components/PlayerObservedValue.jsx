import React from "react";
import { number } from "../services/format.js";

export default function PlayerObservedValue({
  value,
  count,
  total,
  decimals = 0,
}) {
  return (
    <>
      {number(value, decimals)}
      {count > 0 && count < total && (
        <span
          className="player-history-partial"
          title={`${count} matchs renseignés sur ${total}`}
        >
          *
        </span>
      )}
    </>
  );
}
