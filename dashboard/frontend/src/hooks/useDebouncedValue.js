"use client";
import { useEffect, useState } from "react";

export default function useDebouncedValue(value, delay = 150) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    if (value === settled) return;
    const timer = setTimeout(() => setSettled(value), value ? delay : 0);
    return () => clearTimeout(timer);
  }, [value, settled, delay]);
  return settled;
}
